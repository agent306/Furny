"""Validate-and-repair (06 section 8.7, 03 section 1.1): make an assembled ``PlanDocument`` satisfy the plan
invariants and the strictness of the TypeScript schema, or fail with a ``VisionError``.

Repairs (each silent unless it has a warning code): walls that reference a missing node, are shorter than
10 mm or repeat a node pair are removed, then orphan nodes; openings of removed walls go, the rest are held
to the numeric ranges and to ``width/2 <= offset <= length - width/2`` (dropped when the wall is shorter than
width + 100 mm); overlapping openings on a wall keep the more confident one (``openings_dropped_overlap``).
The ``ConfidenceMap`` is pruned in place of every removed wall and opening. Errors: more than 2000 walls or
1000 openings (``too_complex``), no walls (``no_walls_detected``), a drawing labelled ``not_a_floor_plan``
with fewer than 4 walls (``not_a_floor_plan``; with 4 or more only the ``not_a_floor_plan_suspected``
warning). Schema strictness (progress ruling): angles in [0, 360), colours ``#RRGGBB`` or null, entity ids
``{prefix}_{10 chars}`` equal to their record keys; a bad id is a bug upstream (``internal_error``).
A model validation of the whole document runs last.
"""

import math
import re

from app.api.errors import VisionError
from app.pipeline.assemble import ConfidenceMap, fit_vertical
from app.schemas.meta import MetaWarning
from app.schemas.plan import Opening, PlanDocument, Wall

MAX_WALLS, MAX_OPENINGS = 2000, 1000
MIN_WALL_LENGTH_MM = 10
MIN_PLAN_WALLS = 4
MIN_WALL_FIT_MM = 100  # a wall needs this much more than the opening's width
MIN_WIDTH_MM, MAX_WIDTH_MM = 300, 6000
DEFAULT_OPENING_CONFIDENCE = 0.5
ID_PATTERNS = {p: re.compile(rf"^{p}_[0-9a-z]{{10}}$") for p in "nwort"}
HEX_COLOR = re.compile(r"^#[0-9A-Fa-f]{6}$")


def _check_ids(doc: PlanDocument) -> None:
    records = (
        ("n", doc.nodes),
        ("w", doc.walls),
        ("o", doc.openings),
        ("r", doc.rooms),
        ("t", doc.annotations.labels),
    )
    for prefix, record in records:
        for key, entity in record.items():
            if key != entity.id or not ID_PATTERNS[prefix].match(key):
                raise VisionError("internal_error", f"Malformed entity id {key!r}")


def _angle(deg: float) -> float:
    return deg % 360.0


def _color(value: str | None) -> str | None:
    return value if value is not None and HEX_COLOR.match(value) else None


def validate_and_repair(
    doc: PlanDocument, *, confidence: ConfidenceMap, drawing_kind: str
) -> tuple[PlanDocument, list[MetaWarning]]:
    """Repair ``doc`` per the module doc; returns the validated document and the warnings."""
    if len(doc.walls) > MAX_WALLS or len(doc.openings) > MAX_OPENINGS:
        raise VisionError("too_complex", details={"walls": len(doc.walls), "openings": len(doc.openings)})
    _check_ids(doc)

    # walls: missing nodes, degenerate, duplicate node pairs; then orphan nodes
    walls: dict[str, Wall] = {}
    pairs: set[frozenset[str]] = set()
    for wid, w in doc.walls.items():
        a, b = doc.nodes.get(w.a), doc.nodes.get(w.b)
        pair = frozenset((w.a, w.b))
        if a is None or b is None or math.hypot(a.x - b.x, a.y - b.y) < MIN_WALL_LENGTH_MM or pair in pairs:
            continue
        pairs.add(pair)
        walls[wid] = w.model_copy(
            update={
                "thickness": min(1000, max(50, w.thickness)),
                "height": min(10000, max(300, w.height)),
                "color_hex": _color(w.color_hex),
            }
        )
    used = {n for w in walls.values() for n in (w.a, w.b)}
    nodes = {nid: n for nid, n in doc.nodes.items() if nid in used}

    # openings: onto their walls, then non-overlapping
    fitted: dict[str, list[Opening]] = {}
    for o in doc.openings.values():
        wall = walls.get(o.wall_id)
        if wall is None:
            continue
        a, b = nodes[wall.a], nodes[wall.b]
        length = math.hypot(a.x - b.x, a.y - b.y)
        width = min(MAX_WIDTH_MM, max(MIN_WIDTH_MM, o.width))
        if length < width + MIN_WALL_FIT_MM:
            continue
        sill, height = fit_vertical(o.sill_height, o.height, wall.height)
        offset = min(max(o.offset, math.ceil(width / 2)), math.floor(length - width / 2))
        fitted.setdefault(o.wall_id, []).append(
            o.model_copy(update={"width": width, "offset": offset, "sill_height": sill, "height": height})
        )
    openings: dict[str, Opening] = {}
    dropped: list[str] = []
    for group in fitted.values():
        kept: list[Opening] = []
        order = sorted(
            group, key=lambda o: (-confidence.openings.get(o.id, DEFAULT_OPENING_CONFIDENCE), o.offset)
        )
        for o in order:
            if any(abs(o.offset - k.offset) < (o.width + k.width) / 2 for k in kept):
                dropped.append(o.id)
            else:
                kept.append(o)
        openings.update((o.id, o) for o in kept)
    openings = {oid: openings[oid] for oid in doc.openings if oid in openings}  # input order

    warnings: list[MetaWarning] = []
    if dropped:
        warnings.append(
            MetaWarning(code="openings_dropped_overlap", params={"count": len(dropped)}, entity_ids=dropped)
        )

    if drawing_kind == "not_a_floor_plan" and len(walls) < MIN_PLAN_WALLS:
        raise VisionError("not_a_floor_plan")
    if not walls:
        raise VisionError("no_walls_detected")
    if drawing_kind == "not_a_floor_plan":
        warnings.append(MetaWarning(code="not_a_floor_plan_suspected"))

    for wid in set(doc.walls) - set(walls):
        confidence.walls.pop(wid, None)
        confidence.reasons.pop(wid, None)
    for oid in set(doc.openings) - set(openings):
        confidence.openings.pop(oid, None)
        confidence.reasons.pop(oid, None)

    meta = doc.meta.model_copy(
        update={"north_angle": None if doc.meta.north_angle is None else _angle(doc.meta.north_angle)}
    )
    rooms = {
        rid: r.model_copy(update={"floor_color_hex": _color(r.floor_color_hex)})
        for rid, r in doc.rooms.items()
    }
    labels = {
        tid: t.model_copy(update={"rotation": _angle(t.rotation)})
        for tid, t in doc.annotations.labels.items()
    }
    background = (
        None
        if doc.background is None
        else doc.background.model_copy(update={"rotation": _angle(doc.background.rotation)})
    )
    repaired = doc.model_copy(
        update={
            "meta": meta,
            "nodes": nodes,
            "walls": walls,
            "openings": openings,
            "rooms": rooms,
            "annotations": doc.annotations.model_copy(update={"labels": labels}),
            "background": background,
        }
    )
    return PlanDocument.model_validate(repaired.wire()), warnings
