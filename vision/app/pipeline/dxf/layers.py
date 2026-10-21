"""DXF layer roles (06 section 10.2, 10.4): regex first, the layer-mapping LLM call when the walls stay
unclear, then a geometric guess. Prompts and model answers are never logged."""

import re
from collections.abc import Sequence
from dataclasses import dataclass
from math import hypot, isfinite, radians, sin
from typing import TYPE_CHECKING, Literal

from app.pipeline.context import PipelineContext
from app.pipeline.labeling.llm import complete_json
from app.pipeline.labeling.prompts import SYSTEM_PROMPT_DXF_LAYERS, USER_PROMPT_DXF_LAYERS_TEMPLATE
from app.providers.base import LLMProvider, TextPart, UsageCall, UserMessage
from app.providers.errors import ProviderError
from app.schemas.labeling import LayerMapping
from app.utils.geometry import Pt

if TYPE_CHECKING:
    from app.pipeline.dxf.reader import DxfDrawing

LayerRole = Literal["wall", "door", "window", "room_label", "dimension", "furniture", "other"]
Segment = tuple[Pt, Pt]

MIN_WALL_LENGTH_SHARE = 0.3  # wall layers must hold this share of all line length (06 section 10.2)
MIN_PARALLEL_SHARE = 0.2  # heuristic wall layer: at least this share of its lines in parallel pairs
PAIR_MIN_MM, PAIR_MAX_MM = 50.0, 400.0  # perpendicular distance of a wall's two faces (06 section 10.3)
PAIR_MAX_ANGLE_DEG = 1.0
PAIR_MIN_OVERLAP = 0.5  # of the shorter segment
MAX_PAIR_SEGMENTS = 20_000
MAX_CANDIDATES = 256  # neighbours examined per segment
MAX_PAIR_CHECKS = 1_000_000  # pair tests per layer
MAX_CELL_STEPS = 2_000  # grid cells sampled along one segment (800 m at 400 mm cells)
MAX_TABLE_LAYERS = 200  # layers shown to the model, the longest first
LLM_TIMEOUT_S = 60.0
LLM_MIN_BUDGET_S = 20.0  # no layer-mapping call with less request time than this left
_MIN_SEGMENT_MM = 1.0

# First match wins, in this order (06 section 10.2).
_ROLE_PATTERNS: list[tuple[LayerRole, re.Pattern[str]]] = [
    ("dimension", re.compile(r"dim|anno|text-dim|cota|bemass")),
    ("wall", re.compile(r"wall|^a-wall|mur|wand|muro|partition|^a-.*-wall|brick|block|masonry|conc")),
    ("door", re.compile(r"door|^a-door|tuer|porte|puerta|^dr$|^d-")),
    ("window", re.compile(r"window|^a-glaz|glaz|win|fenster|fenetre|ventana|^w-")),
    ("room_label", re.compile(r"room|area|space|^a-area|name|iden")),
    ("furniture", re.compile(r"furn|fixt|equip|sanit|plumb|kitchen|^a-flor-fixt|^i-")),
    ("other", re.compile(r"hatch|grid|axis|title|border|defpoints|viewport|xref|^0$")),
]


@dataclass(frozen=True)
class LayerStats:
    """Per-layer numbers; also the row source of the layer-mapping table (06 section 10.4)."""

    entity_counts: dict[str, int]  # by record kind
    line_length_mm: float
    parallel_share: float
    sample_texts: list[str]


def classify_layers_regex(names: Sequence[str]) -> dict[str, LayerRole]:
    """Role per layer name; names no pattern matches are absent."""
    roles: dict[str, LayerRole] = {}
    for name in names:
        low = name.lower()
        for role, pattern in _ROLE_PATTERNS:
            if pattern.search(low):
                roles[name] = role
                break
    return roles


# --- parallel pairs ----------------------------------------------------------------------------------------


_SIN_MAX_ANGLE = sin(radians(PAIR_MAX_ANGLE_DEG))
_Prep = tuple[float, float, float, float, float]  # x0, y0, unit x, unit y, length


def _prep(seg: Segment) -> _Prep:
    (x0, y0), (x1, y1) = seg
    length = hypot(x1 - x0, y1 - y0)
    return (x0, y0, (x1 - x0) / length, (y1 - y0) / length, length)


def _is_pair(a: _Prep, b: _Prep) -> bool:
    ax, ay, ux, uy, la = a
    cx, cy, vx, vy, lb = b
    if abs(ux * vy - uy * vx) > _SIN_MAX_ANGLE:  # directions within 1 degree (either way round)
        return False
    ex, ey = cx + vx * lb, cy + vy * lb
    dist = abs(ux * ((cy + ey) / 2 - ay) - uy * ((cx + ex) / 2 - ax))
    if not PAIR_MIN_MM <= dist <= PAIR_MAX_MM:
        return False
    t0, t1 = sorted(((cx - ax) * ux + (cy - ay) * uy, (ex - ax) * ux + (ey - ay) * uy))
    return min(t1, la) - max(t0, 0.0) >= PAIR_MIN_OVERLAP * min(la, lb)


def _candidates(i: int, cells: set[tuple[int, int]], grid: dict[tuple[int, int], list[int]]) -> list[int]:
    """Up to ``MAX_CANDIDATES`` other segments in or next to the cells of segment ``i``, in a fixed order."""
    seen = {i}
    out: list[int] = []
    for cx, cy in sorted(cells):
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for j in grid.get((cx + dx, cy + dy), ()):
                    if j not in seen:
                        seen.add(j)
                        out.append(j)
                        if len(out) >= MAX_CANDIDATES:
                            return out
    return out


def parallel_pair_share(segments: Sequence[Segment]) -> float:
    """Share (by length) of the segments, in mm, that have a parallel partner: angle within 1 degree, faces
    50-400 mm apart, projections overlapping by at least half of the shorter one.

    The work is bounded: at most ``MAX_CANDIDATES`` neighbours are examined per segment and
    ``MAX_PAIR_CHECKS`` pairs overall (shortcut: a very dense drawing may under-report; raise them if so),
    and only the ``MAX_PAIR_SEGMENTS`` longest segments take part. The result is deterministic."""
    segs = [
        _prep(s)
        for s in segments
        if isfinite(n := hypot(s[1][0] - s[0][0], s[1][1] - s[0][1])) and n >= _MIN_SEGMENT_MM
    ]
    if len(segs) > MAX_PAIR_SEGMENTS:
        segs = sorted(segs, key=lambda p: -p[4])[:MAX_PAIR_SEGMENTS]
    if len(segs) < 2:
        return 0.0
    cell = PAIR_MAX_MM
    grid: dict[tuple[int, int], list[int]] = {}
    cells_of: list[set[tuple[int, int]]] = []
    for i, (x0, y0, ux, uy, length) in enumerate(segs):
        steps = min(int(length / (cell / 2)) + 1, MAX_CELL_STEPS)
        cells = {
            (int((x0 + ux * length * k / steps) // cell), int((y0 + uy * length * k / steps) // cell))
            for k in range(steps + 1)
        }
        cells_of.append(cells)
        for c in cells:
            grid.setdefault(c, []).append(i)
    paired = [False] * len(segs)
    checks = 0
    for i, cells in enumerate(cells_of):
        if paired[i]:
            continue
        for j in _candidates(i, cells, grid):
            if checks >= MAX_PAIR_CHECKS:
                break
            checks += 1
            if _is_pair(segs[i], segs[j]):
                paired[i] = paired[j] = True
                break
        if checks >= MAX_PAIR_CHECKS:
            break
    return sum(p[4] for p, ok in zip(segs, paired, strict=True) if ok) / sum(p[4] for p in segs)


# --- classification ----------------------------------------------------------------------------------------


def _guess_wall_layer(stats: dict[str, LayerStats], taken: set[str]) -> str | None:
    """The layer with the most line length among those with enough parallel pairs (06 section 10.2); layers
    the model already gave a role are left alone."""
    eligible = [
        n
        for n, s in stats.items()
        if n not in taken and s.parallel_share >= MIN_PARALLEL_SHARE and s.line_length_mm > 0
    ]
    return max(eligible, key=lambda n: stats[n].line_length_mm, default=None)


def _clean(text: str, limit: int) -> str:
    """One line, no table separators: layer names and texts come from the (untrusted) file."""
    return " ".join(text.replace("|", "/").split())[:limit]


def _layer_table(stats: dict[str, LayerStats]) -> tuple[str, dict[str, str]]:
    """The prompt table and a map from the name shown to the real layer name."""
    shown: dict[str, str] = {}
    rows: list[str] = []
    ordered = sorted(stats, key=lambda n: (-stats[n].line_length_mm, n))[:MAX_TABLE_LAYERS]
    for name in ordered:
        s = stats[name]
        label = _clean(name, 100)
        shown.setdefault(label, name)
        counts = ", ".join(f"{k}:{v}" for k, v in sorted(s.entity_counts.items()))
        texts = "; ".join(f'"{_clean(t, 40)}"' for t in s.sample_texts[:3])
        rows.append(f"{label} | {counts} | {s.line_length_mm:.0f} | {s.parallel_share:.2f} | {texts}")
    return "\n".join(rows), shown


def _map_with_llm(
    drawing: "DxfDrawing", provider: LLMProvider, ctx: PipelineContext
) -> tuple[dict[str, LayerRole], list[UsageCall]]:
    table, shown = _layer_table(drawing.layer_stats)
    prompt = USER_PROMPT_DXF_LAYERS_TEMPLATE.format(
        units=f"1 drawing unit = {drawing.unit_factor_mm:g} mm; lengths below are in mm", layer_table=table
    )
    try:
        mapping, calls, _repaired = complete_json(
            provider,
            [UserMessage([TextPart(prompt)])],
            system=SYSTEM_PROMPT_DXF_LAYERS,
            schema_model=LayerMapping,
            effort="low",
            timeout_s=min(LLM_TIMEOUT_S, ctx.remaining()),
            purpose="dxf_layers",
            ctx=ctx,
            max_output_tokens=4_000,
        )
    except ProviderError as err:  # degrade to the geometric guess (06 section 9.6)
        return {}, list(err.usage)
    return {shown[i.name]: i.role for i in mapping.layers if i.name in shown}, calls


def classify_layers(
    drawing: "DxfDrawing", provider: LLMProvider | None, ctx: PipelineContext
) -> tuple[dict[str, LayerRole], list[UsageCall]]:
    """Role per layer, plus the usage of the layer-mapping call if one was made.

    The regex result stands when it finds wall layers holding at least 30 % of the line length. Otherwise the
    model maps the layers (its answers override the regex, unknown names are ignored); with no model, a failed
    call or still no wall layer, the longest layer with enough parallel pairs becomes the wall layer and
    ``dxf_layers_guessed`` is raised."""
    stats = drawing.layer_stats
    roles = classify_layers_regex(list(stats))
    total = sum(s.line_length_mm for s in stats.values())
    walls = sum(s.line_length_mm for n, s in stats.items() if roles.get(n) == "wall")
    usage: list[UsageCall] = []
    mapped: dict[str, LayerRole] = {}
    if total <= 0 or (walls > 0 and walls >= MIN_WALL_LENGTH_SHARE * total):
        return roles, usage
    if provider is not None and ctx.remaining() > LLM_MIN_BUDGET_S:
        mapped, usage = _map_with_llm(drawing, provider, ctx)
        roles.update(mapped)
        if any(r == "wall" for r in mapped.values()):
            return roles, usage
    guess = _guess_wall_layer(stats, set(mapped))
    if guess is not None:
        roles[guess] = "wall"
        ctx.warn("dxf_layers_guessed")
    return roles, usage


__all__ = ["LayerRole", "LayerStats", "classify_layers", "classify_layers_regex", "parallel_pair_share"]
