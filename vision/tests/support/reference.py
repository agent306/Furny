"""Reference-image harness (Task 16b): run the raster chain on the committed reference blueprints, register
the ground-truth wall list onto the page and score the extracted walls.

Chain: decode -> normalize -> preprocess -> OCR (replayed from ``<stem>.ocr.json``) -> segments ->
dimension lines -> walls -> wall graph.

**OCR replay.** Real RapidOCR takes seconds per page and its output may drift between onnxruntime builds,
so the tokens are recorded once (``record_ocr``, real engine over the whole normalized page) and replayed:
the tokens whose box centre lies in the plan region are kept, renumbered like ``run_ocr`` does, and the
text mask / ``ink_notext`` are rebuilt exactly as ``run_ocr`` builds them.

**Truth.** ``<stem>.walls.json`` holds the wall centre lines (``nodes`` / ``walls``) and the registration
landmarks: the four outer plan corners in the truth's own units and their positions in *source* image
pixels, measured by hand on the image (ink profiles across the outline strokes, see the JSON's
``registration.method``). The landmarks are mapped through ``page.transform`` into normalized pixels and a
similarity transform (scale, rotation, translation; least squares) is fitted on them.

**Metrics.** Both centre-line sets are sampled every pixel. Recall is the share of truth length within
``0.5 t`` of an extracted centre line (``t`` = that truth wall's thickness in px); precision is the share
of extracted length within ``0.5 t`` of a truth centre line (``t`` of the truth wall it is measured
against).
"""

import json
import math
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from shapely.geometry import LineString
from shapely.ops import polygonize, unary_union

from app.pipeline.binarize import Preprocessed, preprocess
from app.pipeline.decode import decode_raster
from app.pipeline.dimensions import find_dimension_lines
from app.pipeline.normalize import NormalizedPage, normalize
from app.pipeline.ocr_stage import MASK_DILATE_PX, OcrResult
from app.pipeline.segments import detect_segments
from app.pipeline.textparse import parse_token
from app.pipeline.walls import WallExtraction, debug_walls_png, extract_walls, walls_to_graph
from app.schemas.candidates import DimensionLine, Segment, TextToken, WallGraph
from tests.test_normalize import make_ctx

REFERENCE_DIR = Path(__file__).resolve().parent.parent / "fixtures" / "reference"
IMAGES = {"hdb-3room": "hdb-3room.webp", "brochure-2bhk": "brochure-2bhk.png"}


# --- chain ------------------------------------------------------------------------------------------------


def load_page(stem: str) -> NormalizedPage:
    data = (REFERENCE_DIR / IMAGES[stem]).read_bytes()
    decoded = decode_raster(data)
    return normalize(
        decoded.image,
        source_kind="raster",
        is_photo=False,
        corners=None,
        source_page=1,
        dpi=None,
        ctx=make_ctx(),
    )


def _quad_box(quad: list[list[float]]) -> tuple[float, float, float, float]:
    xs = [p[0] for p in quad]
    ys = [p[1] for p in quad]
    return min(xs), min(ys), max(xs), max(ys)


def record_ocr(stem: str) -> Path:
    """Run the real OCR engine over the whole normalized page and write ``<stem>.ocr.json``."""
    import dataclasses

    from app.ocr.engine import OcrEngine
    from app.pipeline.ocr_stage import run_ocr
    from app.utils.geometry import Rect

    page = load_page(stem)
    pre = preprocess(page, make_ctx())
    h, w = page.image.shape[:2]
    full = dataclasses.replace(pre, region=Rect(0, 0, w, h))
    result = run_ocr(page, full, OcrEngine(), make_ctx())
    rows = [
        {
            "text": t.text,
            "quad": [[round(x, 2), round(y, 2)] for x, y in t.quad],
            "angle": t.angle,
            "score": round(t.score, 4),
        }
        for t in result.tokens
    ]
    path = REFERENCE_DIR / f"{stem}.ocr.json"
    path.write_text(json.dumps({"page": [w, h], "tokens": rows}, indent=1) + "\n")
    return path


def replay_ocr(stem: str, pre: Preprocessed) -> OcrResult:
    """Recorded tokens inside the plan region, with the text mask and ``ink_notext`` of ``run_ocr``."""
    rows = json.loads((REFERENCE_DIR / f"{stem}.ocr.json").read_text())["tokens"]
    h, w = pre.ink.shape[:2]
    region = pre.region.clip(w, h)
    kept = []
    for r in rows:
        x0, y0, x1, y1 = _quad_box(r["quad"])
        if region.contains(((x0 + x1) / 2, (y0 + y1) / 2)):
            kept.append((r, (x0, y0, x1, y1)))
    kept.sort(key=lambda rb: (round(rb[1][1]), round(rb[1][0])))
    tokens: list[TextToken] = []
    for n, (r, box) in enumerate(kept, 1):
        q = [(float(x), float(y)) for x, y in r["quad"]]
        tokens.append(
            TextToken(
                id=f"T{n}",
                text=r["text"],
                quad=(q[0], q[1], q[2], q[3]),
                box=box,
                angle=r["angle"],
                score=r["score"],
                height_px=box[3] - box[1] if r["angle"] == 0 else box[2] - box[0],
                parsed=parse_token(r["text"]),
            )
        )
    mask = np.zeros((h, w), np.uint8)
    for t in tokens:
        x0, y0, x1, y1 = t.box
        mask[
            max(0, int(np.floor(y0)) - MASK_DILATE_PX) : min(h, int(np.ceil(y1)) + MASK_DILATE_PX + 1),
            max(0, int(np.floor(x0)) - MASK_DILATE_PX) : min(w, int(np.ceil(x1)) + MASK_DILATE_PX + 1),
        ] = 255
    ink_notext = pre.ink.copy()
    ink_notext[mask > 0] = 0
    return OcrResult(tokens=tokens, text_mask=mask, ink_notext=ink_notext)


@dataclass
class ChainResult:
    stem: str
    page: NormalizedPage
    pre: Preprocessed
    ocr: OcrResult
    segments: list[Segment]
    dims: list[DimensionLine]
    ext: WallExtraction
    graph: WallGraph
    seconds: dict[str, float] = field(default_factory=dict)


def run_chain(stem: str) -> ChainResult:
    """The full raster chain on one reference image, with per-stage wall-clock seconds."""
    times: dict[str, float] = {}
    t = time.perf_counter()

    def lap(name: str) -> None:
        nonlocal t
        now = time.perf_counter()
        times[name] = now - t
        t = now

    ctx = make_ctx()
    page = load_page(stem)
    lap("normalize")
    pre = preprocess(page, ctx)
    lap("preprocess")
    ocr = replay_ocr(stem, pre)
    lap("ocr_replay")
    segs = detect_segments(page, pre, ocr, ctx)
    lap("segments")
    dims = find_dimension_lines(
        segs, ocr.tokens, pre.region, ink=ocr.ink_notext, check_deadline=ctx.check_deadline
    )
    lap("dimensions")
    ext = extract_walls(page, pre, segs, dims, ctx, ink=ocr.ink_notext, tokens=ocr.tokens)
    lap("walls")
    graph = walls_to_graph(ext, pre.region, check_deadline=ctx.check_deadline)
    lap("graph")
    times["total"] = sum(times.values())
    return ChainResult(stem, page, pre, ocr, segs, dims, ext, graph, times)


# --- truth and registration ---------------------------------------------------------------------------


@dataclass(frozen=True)
class TruthWall:
    a: tuple[float, float]  # normalized page px
    b: tuple[float, float]
    thickness_px: float
    id: str


def similarity_fit(src: np.ndarray, dst: np.ndarray) -> np.ndarray:
    """3x3 similarity (uniform scale, rotation, translation) mapping ``src`` onto ``dst``, least squares."""
    rows, rhs = [], []
    for (x, y), (u, v) in zip(src, dst, strict=True):
        rows += [[x, -y, 1.0, 0.0], [y, x, 0.0, 1.0]]
        rhs += [u, v]
    (a, b, tx, ty), *_ = np.linalg.lstsq(np.array(rows), np.array(rhs), rcond=None)
    return np.array([[a, -b, tx], [b, a, ty], [0.0, 0.0, 1.0]])


def _apply(m: np.ndarray, pts: np.ndarray) -> np.ndarray:
    p = np.hstack([np.asarray(pts, np.float64), np.ones((len(pts), 1))]) @ m.T
    return np.asarray(p[:, :2] / p[:, 2:3])


@dataclass(frozen=True)
class Truth:
    walls: list[TruthWall]
    to_px: np.ndarray  # 3x3 truth units -> normalized px
    landmark_residuals_px: list[float]
    raw: dict[str, Any]

    @property
    def scale(self) -> float:
        return float(math.hypot(self.to_px[0, 0], self.to_px[1, 0]))


def load_truth(stem: str, page: NormalizedPage, kind: str = "walls") -> Truth:
    """``<stem>.<kind>.json``: ``walls`` (mm, registered by a similarity on the four corner landmarks) or
    ``drawing-walls`` (hand-traced in source pixels, mapped through ``page.transform``; thickness in mm is
    converted with the file's ``mm_per_unit``)."""
    raw = json.loads((REFERENCE_DIR / f"{stem}.{kind}.json").read_text())
    transform = np.asarray(page.transform, np.float64)
    if raw["units"] == "source_px":
        m = transform
        residuals: list[float] = []
        scale = math.sqrt(abs(float(np.linalg.det(m[:2, :2])))) / float(raw["mm_per_unit"])
    else:
        reg = raw["registration"]
        src = np.array(reg["truth"], np.float64)
        landmarks_px = _apply(transform, np.array(reg["source_px"], np.float64))
        m = similarity_fit(src, landmarks_px)
        residuals = np.hypot(*(_apply(m, src) - landmarks_px).T).tolist()
        scale = float(math.hypot(m[0, 0], m[1, 0]))
    nodes = {k: (float(v[0]), float(v[1])) for k, v in raw["nodes"].items()}
    walls = []
    for w in raw["walls"]:
        a, b = _apply(m, np.array([nodes[w["a"]], nodes[w["b"]]]))
        walls.append(
            TruthWall((float(a[0]), float(a[1])), (float(b[0]), float(b[1])), w["thickness"] * scale, w["id"])
        )
    return Truth(walls, m, [float(r) for r in residuals], raw)


# --- metrics --------------------------------------------------------------------------------------------


def _samples(p0: tuple[float, float], p1: tuple[float, float]) -> np.ndarray:
    n = max(2, math.ceil(math.hypot(p1[0] - p0[0], p1[1] - p0[1])) + 1)
    t = np.linspace(0.0, 1.0, n)[:, None]
    return np.asarray(np.array(p0) + t * (np.array(p1) - np.array(p0)))


def _dist_to_segments(pts: np.ndarray, a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """(n_pts, n_segs) distances."""
    d = b - a
    ll = np.maximum((d * d).sum(axis=1), 1e-12)
    r = pts[:, None, :] - a[None, :, :]
    t = np.clip((r * d[None]).sum(axis=2) / ll[None], 0.0, 1.0)
    q = a[None] + t[..., None] * d[None]
    return np.asarray(np.hypot(*(pts[:, None, :] - q).transpose(2, 0, 1)))


@dataclass(frozen=True)
class Metrics:
    recall: float
    precision: float
    truth_len: float
    extracted_len: float
    missed: dict[str, float]  # truth wall id -> unmatched share


def wall_metrics(truth: Truth, graph: WallGraph) -> Metrics:
    ta = np.array([w.a for w in truth.walls], np.float64)
    tb = np.array([w.b for w in truth.walls], np.float64)
    tol = np.array([0.5 * w.thickness_px for w in truth.walls])
    ea = np.array([w.a for w in graph.walls], np.float64).reshape(-1, 2)
    eb = np.array([w.b for w in graph.walls], np.float64).reshape(-1, 2)
    hit_t = tot_t = 0.0
    missed: dict[str, float] = {}
    for w, t in zip(truth.walls, tol, strict=True):
        s = _samples(w.a, w.b)
        ok = (_dist_to_segments(s, ea, eb).min(axis=1) <= t) if len(ea) else np.zeros(len(s), bool)
        hit_t += float(ok.mean()) * math.dist(w.a, w.b)
        tot_t += math.dist(w.a, w.b)
        if not ok.all():
            missed[w.id] = round(1.0 - float(ok.mean()), 3)
    hit_e = tot_e = 0.0
    for e in graph.walls:
        s = _samples(e.a, e.b)
        ok = ((_dist_to_segments(s, ta, tb) - tol[None]) <= 0.0).any(axis=1)
        hit_e += float(ok.mean()) * math.dist(e.a, e.b)
        tot_e += math.dist(e.a, e.b)
    return Metrics(
        recall=hit_t / tot_t if tot_t else 0.0,
        precision=hit_e / tot_e if tot_e else 0.0,
        truth_len=tot_t,
        extracted_len=tot_e,
        missed=missed,
    )


def bounded_faces(graph: WallGraph) -> list[Any]:
    """Polygons enclosed by the wall graph's centre lines (shapely ``polygonize`` on the noded edges)."""
    lines = [LineString([w.a, w.b]) for w in graph.walls if math.dist(w.a, w.b) > 0]
    if not lines:
        return []
    return list(polygonize(unary_union(lines)))


def outer_cycle_free_ends(graph: WallGraph) -> int | None:
    """Free wall ends on the boundary of the union of all bounded faces (None when there is no face)."""
    faces = bounded_faces(graph)
    if not faces:
        return None
    outline = unary_union(faces).buffer(0)
    boundary = (
        outline.exterior
        if outline.geom_type == "Polygon"
        else unary_union([g.exterior for g in outline.geoms])
    )
    free = 0
    for w in graph.walls:
        if w.free_ends and LineString([w.a, w.b]).distance(boundary) < 1e-6:
            free += w.free_ends
    return free


def faces_containing(graph: WallGraph, points_px: list[tuple[float, float]]) -> int:
    """How many of ``points_px`` (room anchors) lie in a bounded face of the graph, each face counted once."""
    from shapely.geometry import Point

    faces = bounded_faces(graph)
    used: set[int] = set()
    count = 0
    for p in points_px:
        for k, f in enumerate(faces):
            if k not in used and f.contains(Point(p)):
                used.add(k)
                count += 1
                break
    return count


# --- debug ----------------------------------------------------------------------------------------------


def debug_png(result: ChainResult, truth: Truth | None, path: Path) -> None:
    """``02-walls`` debug image with the registered truth centre lines (green) and tolerance bands."""
    img = debug_walls_png(result.page, result.ext, result.graph)
    if truth is not None:
        band = img.copy()
        for w in truth.walls:
            a = (round(w.a[0]), round(w.a[1]))
            b = (round(w.b[0]), round(w.b[1]))
            cv2.line(band, a, b, (0, 200, 0), max(1, round(w.thickness_px)))
        img = cv2.addWeighted(band, 0.25, img, 0.75, 0.0)
        for w in truth.walls:
            cv2.line(img, (round(w.a[0]), round(w.a[1])), (round(w.b[0]), round(w.b[1])), (0, 150, 0), 1)
    r = result.pre.region
    cv2.rectangle(img, (r.x, r.y), (r.x + r.w - 1, r.y + r.h - 1), (255, 0, 255), 2)
    for d in result.dims:
        cv2.line(img, tuple(round(v) for v in d.p0), tuple(round(v) for v in d.p1), (200, 120, 0), 1)
    cv2.imwrite(str(path), img)
