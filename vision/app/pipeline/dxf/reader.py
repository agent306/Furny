"""DXF reading (06 section 10.1): entities of model space as plain records, unit detection, layer statistics.

Library: ezdxf only (never LibreDWG or the ODA converter). Heavy CPU work: callers run it in a thread.
"""

import codecs
import contextlib
import io
import re
import tempfile
from collections import Counter
from collections.abc import Iterable, Iterator
from dataclasses import dataclass, field
from math import cos, degrees, hypot, radians, sin
from pathlib import Path
from typing import Any, Literal

from ezdxf import recover
from ezdxf.document import Drawing
from ezdxf.entities import ArcEdge, EdgePath, LineEdge, PolylinePath
from ezdxf.filemanagement import read as ezdxf_read
from ezdxf.filemanagement import readfile as ezdxf_readfile
from ezdxf.lldxf.const import DXFError
from ezdxf.math import bulge_to_arc

from app.api.errors import VisionError
from app.pipeline.context import PipelineContext
from app.pipeline.dxf.layers import LayerStats, classify_layers_regex, parallel_pair_share
from app.schemas.api import DxfInfo, RecognizeHints
from app.utils.geometry import Pt

MAX_DXF_ENTITIES = 200_000  # model space plus exploded blocks (06 section 10.1)
MAX_INSERT_DEPTH = 4
MAX_SAMPLE_TEXTS = 3

Kind = Literal["line", "arc", "circle", "hatch", "text", "insert_bbox"]

# $INSUNITS -> mm (06 section 10.1). Other codes are treated like 0: guessed from the extents.
_INSUNITS_MM = {1: 25.4, 2: 304.8, 4: 1.0, 5: 10.0, 6: 1000.0, 14: 100.0}
_ASSUMED_MM = {"mm": 1.0, "cm": 10.0, "m": 1000.0, "in": 25.4, "ft": 304.8}
_BINARY_MAGIC = b"AutoCAD Binary DXF"
_ACADVER = re.compile(rb"\$ACADVER\s*\r?\n\s*1\s*\r?\n\s*(AC\d+)")
_CODEPAGE = re.compile(rb"\$DWGCODEPAGE\s*\r?\n\s*3\s*\r?\n\s*(\S+)")


@dataclass(slots=True)
class DxfEntityRecord:
    """One drawing entity in drawing units. ``points``: line ends, arc ends, hatch polygon, text anchor,
    insert bounding box corners. Arc angles: degrees, counter-clockwise from ``start_deg`` to ``end_deg``."""

    kind: Kind
    layer: str
    points: list[Pt] = field(default_factory=list)
    center: Pt | None = None
    radius: float | None = None
    start_deg: float | None = None
    end_deg: float | None = None
    text: str | None = None


@dataclass
class DxfDrawing:
    records: list[DxfEntityRecord]
    insunits: int
    unit_factor_mm: float
    units_guessed: bool
    layer_stats: dict[str, LayerStats]
    extents: tuple[float, float, float, float]  # minx, miny, maxx, maxy in drawing units


# --- loading --------------------------------------------------------------------------------------------


def _decode(data: bytes) -> str:
    """R2007+ files are UTF-8; older ones use ``$DWGCODEPAGE`` (ANSI_nnnn), falling back to cp1252."""
    head = data[:65_536]
    version = _ACADVER.search(head)
    if version and version.group(1) >= b"AC1021":
        return data.decode("utf-8-sig", errors="replace")
    encoding = "cp1252"
    page = _CODEPAGE.search(head)
    match = re.fullmatch(r"ansi_(\d+)", page.group(1).decode("ascii", "ignore").lower()) if page else None
    if match:
        with contextlib.suppress(LookupError):
            encoding = codecs.lookup(f"cp{match.group(1)}").name
    return data.decode(encoding, errors="replace")


def _load(data: bytes) -> Drawing:
    # The blanket excepts are deliberate: damaged files raise a zoo of exception types inside ezdxf.
    try:
        if data.startswith(_BINARY_MAGIC):
            with tempfile.TemporaryDirectory() as tmp:
                path = Path(tmp) / "in.dxf"
                path.write_bytes(data)
                return ezdxf_readfile(str(path))
        return ezdxf_read(io.StringIO(_decode(data)))
    except Exception:  # retried below with the lenient reader
        pass
    try:
        doc, _auditor = recover.read(io.BytesIO(data))
    except Exception as exc:
        raise VisionError("corrupt_file", "The DXF file could not be read.") from exc
    if len(doc.modelspace()) == 0:  # recovery of garbage yields an empty drawing
        raise VisionError("corrupt_file", "The DXF file could not be read.")
    return doc


def _insunits(doc: Drawing) -> int:
    return int(doc.header.get("$INSUNITS", 0) or 0)


def dxf_info(data: bytes) -> DxfInfo:
    """Cheap statistics for /v1/inspect (06 section 5.4); the entity count is model space before explosion."""
    doc = _load(data)
    return DxfInfo(insunits=_insunits(doc), layer_count=len(doc.layers), entity_count=len(doc.modelspace()))


# --- entities -------------------------------------------------------------------------------------------


def _xy(p: Any) -> Pt:
    return (float(p[0]), float(p[1]))


def _arc_end(center: Pt, radius: float, deg: float) -> Pt:
    return (center[0] + radius * cos(radians(deg)), center[1] + radius * sin(radians(deg)))


def _arc(layer: str, center: Pt, radius: float, start: float, end: float) -> DxfEntityRecord:
    start, end = start % 360.0, end % 360.0
    return DxfEntityRecord(
        "arc",
        layer,
        [_arc_end(center, radius, start), _arc_end(center, radius, end)],
        center,
        radius,
        start,
        end,
    )


def _polyline(layer: str, verts: list[tuple[float, float, float]], closed: bool) -> Iterator[DxfEntityRecord]:
    """Edges of a polyline: a bulge becomes an ARC record, anything else a LINE record."""
    n = len(verts)
    for i in range(n if closed else n - 1):
        x0, y0, bulge = verts[i]
        x1, y1, _ = verts[(i + 1) % n]
        if (x0, y0) == (x1, y1):
            continue
        if bulge:
            center, a0, a1, radius = bulge_to_arc((x0, y0), (x1, y1), bulge)  # always counter-clockwise
            yield _arc(layer, _xy(center), float(radius), degrees(a0), degrees(a1))
        else:
            yield DxfEntityRecord("line", layer, [(x0, y0), (x1, y1)])


def _edge_path_points(path: EdgePath) -> list[Pt]:
    pts: list[Pt] = []
    for edge in path.edges:
        if isinstance(edge, LineEdge):
            pts.append(_xy(edge.start))
        elif isinstance(edge, ArcEdge):  # shortcut: eight samples; ellipse and spline edges are skipped
            a0, a1 = float(edge.start_angle), float(edge.end_angle)
            if a1 <= a0:
                a1 += 360.0
            c, r = _xy(edge.center), float(edge.radius)
            ts = [a0 + (a1 - a0) * k / 8 for k in range(8)]
            pts.extend(_arc_end(c, r, t) for t in (ts if edge.ccw else reversed(ts)))
    return pts


def _convert(e: Any, layer: str) -> Iterator[DxfEntityRecord]:
    kind = e.dxftype()
    if kind == "LINE":
        yield DxfEntityRecord("line", layer, [_xy(e.dxf.start), _xy(e.dxf.end)])
    elif kind == "LWPOLYLINE":
        yield from _polyline(layer, [(x, y, b) for x, y, b in e.get_points("xyb")], bool(e.closed))
    elif kind == "POLYLINE" and (e.is_2d_polyline or e.is_3d_polyline):
        verts = [
            (v.dxf.location.x, v.dxf.location.y, v.dxf.bulge if e.is_2d_polyline else 0.0) for v in e.vertices
        ]
        yield from _polyline(layer, verts, bool(e.is_closed))
    elif kind in ("ARC", "CIRCLE"):
        cx, cy = _xy(e.dxf.center)
        start, end = (float(e.dxf.start_angle), float(e.dxf.end_angle)) if kind == "ARC" else (0.0, 0.0)
        if e.dxf.extrusion.z < 0:  # mirrored (OCS flipped): x is negated and the sweep reverses
            cx, start, end = -cx, 180.0 - end, 180.0 - start
        if kind == "ARC":
            yield _arc(layer, (cx, cy), float(e.dxf.radius), start, end)
        else:
            yield DxfEntityRecord("circle", layer, [], (cx, cy), float(e.dxf.radius))
    elif kind == "HATCH" and e.dxf.solid_fill:
        for path in e.paths:
            if isinstance(path, PolylinePath):
                pts = [_xy(v) for v in path.vertices]  # shortcut: bulges of hatch polylines are ignored
            elif isinstance(path, EdgePath):
                pts = _edge_path_points(path)
            else:
                continue
            if len(pts) >= 3:
                yield DxfEntityRecord("hatch", layer, pts)
    elif kind in ("TEXT", "MTEXT"):
        text = " ".join((e.plain_text() if kind == "MTEXT" else e.dxf.text).split())
        if text:
            yield DxfEntityRecord("text", layer, [_xy(e.dxf.insert)], text=text)


def geometry_points(r: DxfEntityRecord) -> list[Pt]:
    """Points that bound the record (a circle contributes its bounding box corners)."""
    if r.kind == "circle" and r.center is not None and r.radius is not None:
        (cx, cy), rad = r.center, r.radius
        return [(cx - rad, cy - rad), (cx + rad, cy + rad)]
    return r.points


class _Collector:
    def __init__(self) -> None:
        self.records: list[DxfEntityRecord] = []
        self.seen = 0

    def walk(self, entities: Iterable[Any], parent_layer: str | None, level: int) -> None:
        for e in entities:
            self.seen += 1
            if self.seen > MAX_DXF_ENTITIES:
                raise VisionError("dxf_too_complex", "The DXF file has too many entities.")
            layer = parent_layer if parent_layer is not None and e.dxf.layer == "0" else e.dxf.layer
            if e.dxftype() != "INSERT":
                self.records.extend(_convert(e, layer))
                continue
            if level >= MAX_INSERT_DEPTH:
                continue
            first = len(self.records)
            try:
                self.walk(e.virtual_entities(), layer, level + 1)
            except DXFError:  # a missing block definition: skip the reference
                continue
            pts = [p for r in self.records[first:] for p in geometry_points(r)]
            if pts:
                xs, ys = [p[0] for p in pts], [p[1] for p in pts]
                box = [(min(xs), min(ys)), (max(xs), min(ys)), (max(xs), max(ys)), (min(xs), max(ys))]
                self.records.append(DxfEntityRecord("insert_bbox", layer, box))


def _extents(records: list[DxfEntityRecord]) -> tuple[float, float, float, float]:
    pts = [p for r in records for p in geometry_points(r)]
    if not pts:
        return (0.0, 0.0, 0.0, 0.0)
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    return (min(xs), min(ys), max(xs), max(ys))


# --- units and statistics -------------------------------------------------------------------------------


def _unit_factor(
    insunits: int, records: list[DxfEntityRecord], hints: RecognizeHints, ctx: PipelineContext
) -> tuple[float, bool]:
    if insunits in _INSUNITS_MM:
        return _INSUNITS_MM[insunits], False
    roles = classify_layers_regex(sorted({r.layer for r in records}))
    geometry = [r for r in records if r.kind in ("line", "arc", "hatch")]
    walls = [r for r in geometry if roles.get(r.layer) == "wall"]
    candidates = walls or [r for r in geometry if roles.get(r.layer) not in ("dimension", "other")]
    x0, y0, x1, y1 = _extents(candidates)
    size = max(x1 - x0, y1 - y0)
    imperial = hints.unit_system == "imperial"
    if size >= 2500 or size == 0:
        assumed = "mm"
    elif size >= 250:
        assumed = "in" if imperial else "cm"
    else:
        assumed = "ft" if imperial else "m"
    ctx.warn("dxf_units_guessed", {"assumed": assumed})
    return _ASSUMED_MM[assumed], True


def _layer_stats(records: list[DxfEntityRecord], factor: float) -> dict[str, LayerStats]:
    by_layer: dict[str, list[DxfEntityRecord]] = {}
    for r in records:
        by_layer.setdefault(r.layer, []).append(r)
    stats: dict[str, LayerStats] = {}
    for layer, recs in by_layer.items():
        segments = [
            (
                (r.points[0][0] * factor, r.points[0][1] * factor),
                (r.points[1][0] * factor, r.points[1][1] * factor),
            )
            for r in recs
            if r.kind == "line"
        ]
        texts = list(dict.fromkeys(r.text for r in recs if r.text))[:MAX_SAMPLE_TEXTS]
        stats[layer] = LayerStats(
            entity_counts=dict(Counter(r.kind for r in recs)),
            line_length_mm=sum(hypot(b[0] - a[0], b[1] - a[1]) for a, b in segments),
            parallel_share=parallel_pair_share(segments),
            sample_texts=texts,
        )
    return stats


def read_dxf(data: bytes, hints: RecognizeHints, ctx: PipelineContext) -> DxfDrawing:
    """Model-space entities (blocks exploded up to four levels), unit factor and per-layer statistics.

    Raises ``corrupt_file`` for unreadable files and ``dxf_too_complex`` beyond ``MAX_DXF_ENTITIES``."""
    doc = _load(data)
    collector = _Collector()
    collector.walk(doc.modelspace(), None, 0)
    insunits = _insunits(doc)
    factor, guessed = _unit_factor(insunits, collector.records, hints, ctx)
    return DxfDrawing(
        records=collector.records,
        insunits=insunits,
        unit_factor_mm=factor,
        units_guessed=guessed,
        layer_stats=_layer_stats(collector.records, factor),
        extents=_extents(collector.records),
    )
