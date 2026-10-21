"""Assembly of the candidates into a ``PlanDocument`` (06 section 8.7 steps 1-9) with the post-scale metric
filters of section 8.6.

``assemble_document`` runs after labeling and scale. The candidates must already be in the corrected frame
(``CandidateSet.scale_y`` applied when the scale solve resampled along y). Steps: apply the labels (drop
``not_wall`` / ``not_opening`` / excluded rooms and the walls that only border excluded rooms or the outside),
name the rooms, adopt or insert the labeler's missed openings, convert pixels to millimetres, then score
every entity. The face-id map used for the 0.75 t side tests is rebuilt from the room polygons with
``cv2.fillPoly`` unless the caller passes the one ``find_room_faces`` returned (valid for the same frame
only).

``validate_and_repair`` (``validate.py``) then enforces the plan invariants of 03 section 1.1.
"""

import math
import statistics
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field

import cv2
import numpy as np

from app.api.errors import VisionError
from app.pipeline.context import PipelineContext
from app.pipeline.normalize import NormalizedPage
from app.pipeline.scale import MAX_COORD_MM, ScaleResult, _room_samples
from app.schemas.api import RecognizeOptions
from app.schemas.candidates import (
    CandidateSet,
    GapCandidate,
    OpeningCandidate,
    RoomFace,
    TextToken,
    WallCandidate,
)
from app.schemas.labeling import (
    LabelingResult,
    MissedOpening,
    MissedRoom,
    OpeningLabel,
    RoomLabel,
    TextLabel_,
    WallLabel,
)
from app.schemas.meta import MetaWarning, ProviderName, ReasonCode
from app.schemas.plan import (
    Annotations,
    BackgroundImage,
    Opening,
    PlanDocument,
    PlanMeta,
    Point,
    RoomMeta,
    RoomType,
    TextLabel,
    ViewState,
    Wall,
    WallNode,
)
from app.utils.geometry import Pt, project_param
from app.utils.ids import new_id
from app.utils.roomnames import ROOM_DEFAULT_NAMES, match_room_name

__all__ = ["AssembleResult", "ConfidenceMap", "assemble_document", "fit_vertical", "snap_thickness"]

THICKNESS_SNAPS = (75, 100, 110, 115, 150, 200, 230, 250, 300)  # step 5
SNAP_WITHIN_MM = 12
MIN_FACE_M2, MAX_FACE_M2 = 1.0, 200.0  # 8.6: closets stay, a misdetected outside area goes
MIN_WALL_MM, MAX_WALL_MM = 50, 600  # 8.6: outside this a wall is flagged thin_evidence ...
THIN_EVIDENCE = 0.6  # ... and dropped below this evidence
MIN_OPENING_MM, MAX_OPENING_MM = 300, 6000  # 8.6 (03 range)
SIDE_T = 0.75  # step 1: side tests sample this many t off the centre line
ALIGN_TOL_DEG = 3.0  # a wall within this angle of theta0 + k 90 deg counts as snapped (8.1 step 7)
PARTITION_FRAC = 0.6  # step 5
DRYWALL_MAX_MM = 100
HALF_WALL_MM = 1000
ADOPT_RADIUS_MM = 1500  # step 3
ADOPT_CONFIDENCE, INSERT_CONFIDENCE = 0.5, 0.35
MAIN_ENTRANCE_MIN_MM = 900
DOUBLE_DOOR_MIN_MM = 1200
TAG_TEXT_HEIGHTS = 2.0  # step 6: an opening tag within this many text heights
LABEL_FONT_MM = 250
FLOOR_THICKNESS_MM = 150
SMALL_ROOM_M2 = 2.0
SIZE_TOLERANCE = 0.10
DEFAULT_TYPE = {"door": "single_swing", "window": "casement", "opening": "opening"}


@dataclass
class ConfidenceMap:
    """Confidence 0..1 (2 dp) per document entity id, the reasons it is reduced, and the overall score.
    ``validate_and_repair`` prunes the entries of entities it removes."""

    walls: dict[str, float]
    openings: dict[str, float]
    rooms: dict[str, float]
    overall: float
    reasons: dict[str, list[ReasonCode]]


@dataclass
class AssembleResult:
    """``id_map`` maps candidate ids (nodes ``N``, walls ``W``, openings ``O``, rooms ``R``) to document
    ids."""

    document: PlanDocument
    confidence: ConfidenceMap
    warnings: list[MetaWarning]
    id_map: dict[str, str]


def _round_to(x: float, step: int) -> int:
    return math.floor(x / step + 0.5) * step


def snap_thickness(mm: float) -> int:
    """06 8.7 step 5: ``round5`` clamped to 50..1000, then the nearest standard thickness within 12 mm."""
    t = min(1000, max(50, _round_to(mm, 5)))
    nearest = min(THICKNESS_SNAPS, key=lambda s: abs(s - t))
    return nearest if abs(nearest - t) <= SNAP_WITHIN_MM else t


def fit_vertical(sill: int, height: int, wall_height: int) -> tuple[int, int]:
    """``(sill, height)`` held to ``0 <= sill <= 3000`` and ``sill + height <= wall_height`` (03 1.1)."""
    sill = min(max(sill, 0), 3000, max(0, wall_height - 300))
    return sill, max(1, min(height, wall_height - sill))


def _score(x: float) -> float:
    return round(min(1.0, max(0.0, x)), 2)


def _uniq(items: Iterable[ReasonCode]) -> list[ReasonCode]:
    return list(dict.fromkeys(items))


def _centre(t: TextToken) -> Pt:
    return ((t.box[0] + t.box[2]) / 2.0, (t.box[1] + t.box[3]) / 2.0)


def _face_map(page: NormalizedPage, faces: Sequence[RoomFace]) -> np.ndarray:
    """The int32 face-id map (``i`` on the pixels of ``faces[i - 1]``) rebuilt from the room polygons."""
    h, w = page.image.shape[:2]
    for f in faces:
        for x, y in f.polygon_px:
            h, w = max(h, math.ceil(y) + 1), max(w, math.ceil(x) + 1)
    fmap = np.zeros((h, w), np.int32)
    for i, f in enumerate(faces, 1):
        pts = np.round(np.array(f.polygon_px, dtype=np.float64)).astype(np.int32).reshape(-1, 1, 2)
        cv2.fillPoly(fmap, [pts], int(i))
    return fmap


def _face_at(fmap: np.ndarray, p: Pt) -> int:
    x, y = round(p[0]), round(p[1])
    if 0 <= y < fmap.shape[0] and 0 <= x < fmap.shape[1]:
        return int(fmap[y, x])
    return 0


def _wall_sides(w: WallCandidate, fmap: np.ndarray) -> tuple[int, int]:
    """Face ids 0.75 t off the left and the right of the wall's midpoint (0 = outside / no face)."""
    dx, dy = w.b[0] - w.a[0], w.b[1] - w.a[1]
    length = math.hypot(dx, dy)
    if length == 0:
        return 0, 0
    d = SIDE_T * w.thickness_px / length
    mx, my = (w.a[0] + w.b[0]) / 2.0, (w.a[1] + w.b[1]) / 2.0
    return _face_at(fmap, (mx - dy * d, my + dx * d)), _face_at(fmap, (mx + dy * d, my - dx * d))


def _snapped(w: WallCandidate, theta0: float) -> bool:
    angle = math.degrees(math.atan2(w.b[1] - w.a[1], w.b[0] - w.a[0])) - theta0
    off = abs((angle + 45.0) % 90.0 - 45.0)
    return off <= ALIGN_TOL_DEG


@dataclass
class _Wall:
    cand: WallCandidate
    id: str
    a_mm: tuple[int, int]
    b_mm: tuple[int, int]
    sides: tuple[int, int]
    thickness: int
    label_kind: str | None
    llm: float
    thin: bool = False
    unsure: bool = False
    kind: str = "interior"
    reasons: list[ReasonCode] = field(default_factory=list)

    @property
    def length_mm(self) -> float:
        return math.dist(self.a_mm, self.b_mm)


@dataclass
class _Op:
    cand_id: str | None
    wall: _Wall
    kind: str
    type: str
    hinge: str
    swing: str
    centre_px: float  # along the wall's centre line from its a end
    width: int
    confidence: float
    reasons: list[ReasonCode]
    label: str | None = None


class _Assembly:
    def __init__(
        self,
        page: NormalizedPage,
        c: CandidateSet,
        labels: LabelingResult,
        scale: ScaleResult,
        options: RecognizeOptions,
        provider_used: ProviderName,
        face_map: np.ndarray | None,
    ) -> None:
        self.page, self.c, self.labels, self.options = page, c, labels, options
        self.k = scale.mm_per_px
        self.scale_confidence = scale.confidence
        self.heuristic = provider_used == "none"
        self.defaults = options.defaults
        self.wall_height = options.hints.wall_height_mm or self.defaults.wall_height_mm
        self.fmap = face_map if face_map is not None else _face_map(page, c.rooms)
        self.warnings: list[MetaWarning] = []
        self.id_map: dict[str, str] = {}
        self.face_no = {f.id: i for i, f in enumerate(c.rooms, 1)}
        self.room_area: dict[str, float] = {}
        self.text_labels: dict[str, TextLabel] = {}

    # --- helpers ----------------------------------------------------------------------------------------

    def mm(self, v: float) -> int:
        out = round(v * self.k)
        if abs(out) > MAX_COORD_MM:
            raise VisionError("too_complex", "The plan extends beyond the supported size")
        return out

    def warn(self, code: str, params: dict[str, str | int | float], entity_ids: Sequence[str] = ()) -> None:
        self.warnings.append(MetaWarning(code=code, params=params, entity_ids=list(entity_ids)))

    def area_m2(self, f: RoomFace) -> float:
        return f.area_px * self.k * self.k / 1_000_000.0

    # --- walls ------------------------------------------------------------------------------------------

    def select_walls(self, included: set[int], any_excluded: bool) -> tuple[list[_Wall], list[_Wall]]:
        """The surviving walls (step 1, 8.6) and the ones that drop out as outside the unit."""
        labelled = {w.id: w for w in self.labels.walls}
        c = self.c
        kept: list[_Wall] = []
        for w in c.walls:
            lab: WallLabel | None = labelled.get(w.id)
            if lab is not None and lab.verdict == "not_wall":
                continue
            thin = not MIN_WALL_MM <= w.thickness_px * self.k <= MAX_WALL_MM
            if thin and w.evidence < THIN_EVIDENCE:
                continue
            a_node, b_node = c.nodes.get(w.a_node, w.a), c.nodes.get(w.b_node, w.b)
            llm = 0.6 if self.heuristic or lab is None else {"wall": 1.0, "unsure": 0.5}.get(lab.verdict, 0.6)
            kept.append(
                _Wall(
                    cand=w,
                    id="",
                    a_mm=(self.mm(a_node[0]), self.mm(a_node[1])),
                    b_mm=(self.mm(b_node[0]), self.mm(b_node[1])),
                    sides=_wall_sides(w, self.fmap),
                    thickness=snap_thickness(w.thickness_px * self.k),
                    label_kind=lab.kind if lab is not None else None,
                    llm=llm,
                    thin=thin,
                    unsure=lab is not None and not self.heuristic and lab.verdict == "unsure",
                )
            )
        if not (any_excluded and included):
            return kept, []
        inside = [w for w in kept if any(s in included for s in w.sides)]
        return inside, [w for w in kept if w not in inside]

    def classify_walls(self, walls: list[_Wall], included: set[int]) -> None:
        """Step 5 ``kind``: the label's, else exterior on the outer boundary of the included faces, else
        partition (thin) or interior."""
        for w in walls:
            w.kind = w.label_kind or (
                "exterior" if (w.sides[0] in included) != (w.sides[1] in included) else ""
            )
        exterior = [w.thickness for w in walls if w.kind == "exterior"]
        median = statistics.median(exterior) if exterior else None
        for w in walls:
            if not w.kind:
                w.kind = (
                    "partition"
                    if median is not None and w.thickness <= PARTITION_FRAC * median
                    else "interior"
                )

    def wall_confidence(self, w: _Wall) -> float:
        cand = w.cand
        conn = {0: 1.0, 1: 0.6}.get(cand.free_ends, 0.2)
        align = 1.0 if _snapped(cand, self.c.theta0) else 0.6
        flags: list[tuple[bool, ReasonCode]] = [
            (cand.source == "single_line", "single_line_wall"),
            (conn < 1.0, "unconnected"),
            (align < 1.0, "off_axis"),
            (w.unsure, "llm_unsure"),
            (w.thin, "thin_evidence"),
        ]
        w.reasons = [reason for on, reason in flags if on]
        return 0.35 * cand.evidence + 0.25 * align + 0.20 * conn + 0.20 * w.llm

    # --- openings ---------------------------------------------------------------------------------------

    def tag_near(self, w: _Wall, centre_px: float) -> str | None:
        """The ``opening_tag`` text within 2 text heights of the opening's centre (step 6)."""
        roles = {t.id: t for t in self.labels.texts if t.role == "opening_tag"}
        cand = w.cand
        length = math.dist(cand.a, cand.b)
        if length == 0:
            return None
        f = centre_px / length
        at = (cand.a[0] + (cand.b[0] - cand.a[0]) * f, cand.a[1] + (cand.b[1] - cand.a[1]) * f)
        best: tuple[float, str] | None = None
        for t in self.c.texts:
            role = roles.get(t.id)
            if role is None:
                continue
            d = math.dist(_centre(t), at)
            if d <= TAG_TEXT_HEIGHTS * t.height_px and (best is None or d < best[0]):
                best = (d, role.normalized_text or t.text)
        return best[1] if best else None

    @staticmethod
    def labelled_type(lab: OpeningLabel, kind: str) -> str | None:
        """The door / window type the labeler gave for an opening of ``kind`` (a passage has the one type)."""
        return {"door": lab.door_type, "window": lab.window_type}.get(kind, "opening")

    def resolve_opening(self, o: OpeningCandidate, w: _Wall, lab: OpeningLabel | None) -> _Op | None:
        kind, type_ = o.kind, o.type
        reasons: list[ReasonCode] = []
        if kind == "door":
            conf = 0.3 + 0.6 * o.support
        elif kind == "window":
            conf = 0.35 + 0.5 * o.support
        else:
            conf, reasons = 0.45, ["gap_only"]
        if lab is not None:
            v = lab.verdict
            if v in ("door", "window", "opening") and v != kind:
                kind, conf, reasons = v, 0.6, ["llm_disagrees"]
                type_ = DEFAULT_TYPE[kind]
                if self.labelled_type(lab, kind) is None:
                    reasons.append("type_guessed")
            elif not self.heuristic and v == kind:
                conf += 0.15
            elif not self.heuristic and v == "unsure":
                conf, reasons = conf - 0.1, [*reasons, "llm_unsure"]
            type_ = self.labelled_type(lab, kind) or type_
        width = _round_to((o.u1 - o.u0) * self.k, 10)
        if not MIN_OPENING_MM <= width <= MAX_OPENING_MM:
            return None
        return _Op(o.id, w, kind, type_, o.hinge, o.swing, (o.u0 + o.u1) / 2.0, width, conf, reasons)

    def missed_openings(self, walls: dict[str, _Wall]) -> list[_Op]:
        out: list[_Op] = []
        taken: dict[str, list[GapCandidate | OpeningCandidate]] = {}
        for o in self.c.openings:
            taken.setdefault(o.wall_id, []).append(o)
        for m in self.labels.missed_openings:
            w = walls.get(m.wall_id)
            if w is None:
                continue
            made = self.adopt_or_insert(m, w, taken)
            if made is not None:
                out.append(made)
        return out

    def adopt_or_insert(
        self, m: MissedOpening, w: _Wall, taken: dict[str, list[GapCandidate | OpeningCandidate]]
    ) -> _Op | None:
        cand = w.cand
        length_px = math.dist(cand.a, cand.b)
        u = project_param((float(m.x), float(m.y)), cand.a, cand.b) * length_px
        used = taken.setdefault(cand.id, [])
        free = [
            g
            for g in self.c.gaps
            if g.wall_id == cand.id and not any(g.u0 < x.u1 and x.u0 < g.u1 for x in used)
        ]
        near = [g for g in free if abs((g.u0 + g.u1) / 2.0 - u) <= ADOPT_RADIUS_MM / self.k]
        guess: list[ReasonCode] = [] if m.kind == "opening" else ["type_guessed"]
        if near:
            g = min(near, key=lambda g: abs((g.u0 + g.u1) / 2.0 - u))
            width = _round_to((g.u1 - g.u0) * self.k, 10)
            if not MIN_OPENING_MM <= width <= MAX_OPENING_MM:
                return None
            used.append(g)
            reasons: list[ReasonCode] = ["gap_only"] if m.kind == "opening" else guess
            return _Op(
                None, w, m.kind, DEFAULT_TYPE[m.kind], "start", "left", (g.u0 + g.u1) / 2.0, width,
                ADOPT_CONFIDENCE, list(reasons),
            )  # fmt: skip
        width = self.defaults.window_width_mm if m.kind == "window" else self.defaults.door_width_mm
        offset = round(u * self.k)
        if not width / 2 <= offset <= w.length_mm - width / 2:
            return None
        return _Op(
            None, w, m.kind, DEFAULT_TYPE[m.kind], "start", "left", u, width, INSERT_CONFIDENCE,
            ["type_guessed"],
        )  # fmt: skip

    # --- rooms ------------------------------------------------------------------------------------------

    def size_check(self, f: RoomFace, lab: RoomLabel | None) -> tuple[float, list[ReasonCode]]:
        if (
            lab is None
            or lab.width_mm is None
            or lab.depth_mm is None
            or min(lab.width_mm, lab.depth_mm) <= 0
        ):
            return (0.6 if self.heuristic else 0.7), []
        samples = _room_samples(f, lab.width_mm, lab.depth_mm, self.c.theta0, "")
        if all(abs(s.estimate / self.k - 1.0) <= SIZE_TOLERANCE for s in samples):
            return 1.0, []
        return 0.4, ["size_mismatch"]

    def add_label(self, text: str, at: Pt) -> None:
        tid = new_id("t")
        self.text_labels[tid] = TextLabel(
            id=tid,
            position=Point(x=self.mm(at[0]), y=self.mm(at[1])),
            text=text[:200],
            font_size=LABEL_FONT_MM,
            rotation=0,
        )

    def build_rooms(
        self,
        faces: list[RoomFace],
        room_labels: dict[str, RoomLabel],
        reasons: dict[str, list[ReasonCode]],
        conf_over: Mapping[str, float],
        reason_over: Mapping[str, list[ReasonCode]],
    ) -> tuple[dict[str, RoomMeta], dict[str, float]]:
        """Steps 2 and 7: one ``RoomMeta`` per included face, named from the label, the labeler's missed
        rooms or the room type, with extra names kept as text labels."""
        by_no = {self.face_no[f.id]: f for f in faces}
        named_by_missed: dict[int, MissedRoom] = {}
        merged: dict[int, list[tuple[str, Pt]]] = {}
        for m in self.labels.missed_rooms:
            no = _face_at(self.fmap, (float(m.x), float(m.y)))
            f = by_no.get(no)
            if f is None:
                continue
            lab = room_labels.get(f.id)
            if (lab is None or not (lab.name or "").strip()) and no not in named_by_missed:
                named_by_missed[no] = m
            else:
                merged.setdefault(no, []).append((m.name, (float(m.x), float(m.y))))
        name_roles = {t.id: t for t in self.labels.texts if t.role == "room_name"}
        tokens = {t.id: t for t in self.c.texts}

        docs: dict[str, RoomMeta] = {}
        confs: dict[str, float] = {}
        unnamed: list[str] = []
        for f in faces:
            no = self.face_no[f.id]
            lab = room_labels.get(f.id)
            name = (lab.name or "").strip() if lab is not None else ""
            type_: RoomType | None = lab.type if lab is not None else None
            rs: list[ReasonCode] = []
            if f.open:
                rs.append("open_face")
            if not name and no in named_by_missed:
                name, type_ = named_by_missed[no].name, named_by_missed[no].type
            named = 1.0
            if not name:
                if type_ is not None and type_ != "other":
                    name, named = ROOM_DEFAULT_NAMES[type_], 0.5
                    rs.append("name_guessed")
                else:
                    name, named, type_ = ROOM_DEFAULT_NAMES["other"], 0.0, type_ or "other"
                    rs.append("no_name")
            if type_ is None:
                found = match_room_name(name)
                type_ = found[1] if found else "other"
            check, size_reasons = self.size_check(f, lab)
            rs += size_reasons
            conf = 0.4 * (0.5 if f.open else 1.0) + 0.3 * named + 0.3 * check
            if self.area_m2(f) < SMALL_ROOM_M2:
                conf *= 0.8
                rs.append("small_area")

            rid = new_id("r")
            self.id_map[f.id] = rid
            docs[rid] = RoomMeta(
                id=rid,
                anchor=Point(x=self.mm(f.anchor_px[0]), y=self.mm(f.anchor_px[1])),
                name=name,
                type=type_,
                floor_finish="tile",
                floor_color_hex=None,
                label_offset=None,
                show_area=True,
            )
            self.room_area[rid] = f.area_px
            confs[rid] = _score(conf_over.get(f.id, conf))
            reasons[rid] = list(reason_over[f.id]) if f.id in reason_over else _uniq(rs)
            if "no_name" in rs or "name_guessed" in rs:
                unnamed.append(rid)

            seen = {name.casefold()}
            extra_names: list[str] = []
            for text, at in [*self.extra_names(f, lab, name, name_roles, tokens), *merged.get(no, [])]:
                if text.casefold() not in seen:
                    seen.add(text.casefold())
                    extra_names.append(text)
                    self.add_label(text, at)
            if extra_names:
                self.warn("room_names_merged", {"names": ", ".join(extra_names)}, [rid])
        if unnamed:
            self.warn("rooms_without_names", {"count": len(unnamed)}, unnamed)
        return docs, confs

    @staticmethod
    def extra_names(
        f: RoomFace,
        lab: RoomLabel | None,
        name: str,
        roles: Mapping[str, TextLabel_],
        tokens: Mapping[str, TextToken],
    ) -> list[tuple[str, Pt]]:
        """The other room-name texts in the face than the one that named it (only when the label says which
        one that was)."""
        if lab is None or lab.name_text_id is None or not name:
            return []
        main = roles.get(lab.name_text_id)
        skip = {name.casefold()}
        if main is not None and main.normalized_text:
            skip.add(main.normalized_text.casefold())
        out: list[tuple[str, Pt]] = []
        for tid in f.contains_text_ids:
            role, token = roles.get(tid), tokens.get(tid)
            if tid == lab.name_text_id or role is None or token is None:
                continue
            text = role.normalized_text or token.text
            if text.casefold() not in skip:
                out.append((text, _centre(token)))
        return out

    def main_entrance(
        self, placed: list[tuple[_Op, Opening]], walls: dict[str, Wall], rooms: dict[str, RoomMeta]
    ) -> dict[str, Opening]:
        """Step 6: the exterior door of width >= 900 nearest the largest living / foyer room becomes the
        ``main_entrance``, unless one exists already. Returns the replaced opening."""
        if any(d.type == "main_entrance" for _, d in placed):
            return {}
        anchors = [(self.room_area[r.id], r.anchor) for r in rooms.values() if r.type in ("living", "foyer")]
        if not anchors:
            return {}
        anchor = max(anchors, key=lambda x: x[0])[1]
        best: tuple[float, Opening] | None = None
        for o, d in placed:
            if d.kind != "door" or d.width < MAIN_ENTRANCE_MIN_MM or walls[d.wall_id].kind != "exterior":
                continue
            length = o.wall.length_mm
            f = d.offset / length if length else 0.0
            at = (
                o.wall.a_mm[0] + (o.wall.b_mm[0] - o.wall.a_mm[0]) * f,
                o.wall.a_mm[1] + (o.wall.b_mm[1] - o.wall.a_mm[1]) * f,
            )
            dist = math.dist(at, (anchor.x, anchor.y))
            if best is None or dist < best[0]:
                best = (dist, d)
        return {} if best is None else {best[1].id: best[1].model_copy(update={"type": "main_entrance"})}


def _overall(
    walls: Mapping[str, float],
    lengths: Mapping[str, float],
    openings: Mapping[str, float],
    rooms: Mapping[str, float],
    scale_confidence: float,
) -> float:
    """``0.4 x length-weighted walls + 0.2 x rooms + 0.1 x openings + 0.3 x scale``; an empty set is 0.5."""
    total = sum(lengths.values())
    wall_mean = sum(walls[i] * lengths[i] for i in walls) / total if total > 0 else 0.5

    def mean(d: Mapping[str, float]) -> float:
        return sum(d.values()) / len(d) if d else 0.5

    return _score(0.4 * wall_mean + 0.2 * mean(rooms) + 0.1 * mean(openings) + 0.3 * scale_confidence)


def assemble_document(
    page: NormalizedPage,
    candidates: CandidateSet,
    labels: LabelingResult,
    scale: ScaleResult,
    options: RecognizeOptions,
    ctx: PipelineContext,
    *,
    confidence_overrides: Mapping[str, float] | None = None,
    reason_overrides: Mapping[str, list[ReasonCode]] | None = None,
    provider_used: ProviderName | None = None,
    face_map: np.ndarray | None = None,
) -> AssembleResult:
    """06 8.7: the ``PlanDocument`` for the labelled candidates, with per-entity confidence, reasons and
    warnings. ``confidence_overrides`` / ``reason_overrides`` (preflight K14, keyed by candidate id) replace
    the computed confidence / reasons of an entity before the overall score is computed.
    ``provider_used`` (default ``options.provider``) says whether the heuristic labeler made ``labels``."""
    ctx.check_deadline()
    a = _Assembly(page, candidates, labels, scale, options, provider_used or options.provider, face_map)
    c, k = candidates, a.k
    conf_over, reason_over = confidence_overrides or {}, reason_overrides or {}

    # step 1 and 8.6: labels and metric filters on rooms, then on walls
    room_labels = {r.id: r for r in labels.rooms}
    excluded = {f.id for f in c.rooms if (r := room_labels.get(f.id)) is not None and not r.include}
    faces = [f for f in c.rooms if f.id not in excluded and MIN_FACE_M2 <= a.area_m2(f) <= MAX_FACE_M2]
    included = {a.face_no[f.id] for f in faces}
    walls, removed = a.select_walls(included, bool(excluded))
    if removed or excluded:
        a.warn("entities_outside_unit_removed", {"walls": len(removed), "rooms": len(excluded)})
    a.classify_walls(walls, included)
    by_cand = {w.cand.id: w for w in walls}

    # nodes and walls (step 5)
    nodes: dict[str, WallNode] = {}
    wall_docs: dict[str, Wall] = {}
    reasons: dict[str, list[ReasonCode]] = {}
    conf_walls: dict[str, float] = {}
    for w in walls:
        w.id = a.id_map[w.cand.id] = new_id("w")
        ends: list[str] = []
        for cand_node, at in ((w.cand.a_node, w.a_mm), (w.cand.b_node, w.b_mm)):
            if cand_node not in a.id_map:
                a.id_map[cand_node] = new_id("n")
                nodes[a.id_map[cand_node]] = WallNode(id=a.id_map[cand_node], x=at[0], y=at[1])
            ends.append(a.id_map[cand_node])
        wall_docs[w.id] = Wall(
            id=w.id,
            a=ends[0],
            b=ends[1],
            thickness=w.thickness,
            height=HALF_WALL_MM if w.kind == "half" else a.wall_height,
            kind=w.kind,
            justification="center",
            material="drywall" if w.thickness <= DRYWALL_MAX_MM else "brick",
            color_hex=None,
        )
        conf_walls[w.id] = _score(conf_over.get(w.cand.id, a.wall_confidence(w)))
        reasons[w.id] = list(reason_over[w.cand.id]) if w.cand.id in reason_over else w.reasons

    room_docs, conf_rooms = a.build_rooms(faces, room_labels, reasons, conf_over, reason_over)

    # openings (steps 3 and 6)
    opening_labels = {o.id: o for o in labels.openings}
    ops: list[_Op] = []
    for cand in c.openings:
        host = by_cand.get(cand.wall_id)
        lab = opening_labels.get(cand.id)
        if host is None or (lab is not None and lab.verdict == "not_opening"):
            continue
        made = a.resolve_opening(cand, host, lab)
        if made is not None:
            ops.append(made)
    ops.extend(a.missed_openings(by_cand))

    opening_docs: dict[str, Opening] = {}
    conf_openings: dict[str, float] = {}
    placed: list[tuple[_Op, Opening]] = []
    for o in ops:
        wall_h = wall_docs[o.wall.id].height
        if o.kind == "window":
            sill, height = fit_vertical(a.defaults.window_sill_mm, a.defaults.window_height_mm, wall_h)
        else:
            sill, height = fit_vertical(0, a.defaults.door_height_mm, wall_h)
        wide = o.kind == "door" and o.width >= DOUBLE_DOOR_MIN_MM and o.type != "sliding"
        oid = new_id("o")
        doc_o = Opening(
            id=oid,
            wall_id=o.wall.id,
            kind=o.kind,
            type="double_swing" if wide else o.type,
            offset=round(o.centre_px * k),
            width=o.width,
            height=height,
            sill_height=sill,
            hinge=o.hinge,
            swing=o.swing,
            label=a.tag_near(o.wall, o.centre_px),
        )
        opening_docs[oid] = doc_o
        placed.append((o, doc_o))
        key = o.cand_id or ""
        if o.cand_id is not None:
            a.id_map[o.cand_id] = oid
        conf_openings[oid] = _score(conf_over.get(key, o.confidence))
        reasons[oid] = list(reason_over[key]) if key in reason_over else _uniq(o.reasons)
    opening_docs.update(a.main_entrance(placed, wall_docs, room_docs))

    unconnected = [w.id for w in walls if w.cand.free_ends > 0]
    if unconnected:
        a.warn("walls_unconnected", {"count": len(unconnected)}, unconnected)

    # step 8: the document
    height_px, width_px = page.image.shape[:2]
    document = PlanDocument(
        schema_version=1,
        meta=PlanMeta(
            default_wall_height=a.wall_height,
            default_wall_thickness=a.defaults.interior_wall_thickness_mm,
            floor_thickness=FLOOR_THICKNESS_MM,
            north_angle=None,
            created_with="import",
        ),
        nodes=nodes,
        walls=wall_docs,
        openings=opening_docs,
        rooms=room_docs,
        placements={},
        fixtures={},
        annotations=Annotations(dimensions={}, labels=a.text_labels),
        background=BackgroundImage(
            import_id="",
            media_uuid="",
            pixel_width=width_px,
            pixel_height=height_px,
            mm_per_pixel=k,
            position=Point(x=0, y=0),
            rotation=0,
            opacity=0.5,
            visible=True,
            locked=True,
        ),
        view=ViewState(mode2d=None, mode3d=None, last_mode="2d"),
    )
    lengths = {w.id: math.dist(w.cand.a, w.cand.b) for w in walls}
    confidence = ConfidenceMap(
        walls=conf_walls,
        openings=conf_openings,
        rooms=conf_rooms,
        overall=_overall(conf_walls, lengths, conf_openings, conf_rooms, a.scale_confidence),
        reasons={i: r for i, r in reasons.items() if r},
    )
    return AssembleResult(document, confidence, a.warnings, a.id_map)
