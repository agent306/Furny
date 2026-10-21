"""Dimension lines on the reference blueprints (Task 14b), end to end (`tests/support/reference.py`).

Truth: ``hdb-3room.drawing-dims.json``, every dimension line of the HDB drawing traced in source pixels
(outer chains, overall lines and interior dimensions; see its ``source`` note for the method and the
profile checks). A traced and a detected line match when they are parallel within 2 degrees and at least
80 % of the traced centre line lies within 4 normalized px of the detected segment.

Five traced lines (the overall 11000, 7000, 7600 and 8900 lines and the left chain) lie outside the plan
region (06 §7.6 step 7: wall bounding box + 6 %), where the segment and OCR stages see nothing, so the
brief's recall and overall-line targets are strict xfails until a ruling on the region. The same targets
are checked on the traced lines inside the region.
"""

import numpy as np
import pytest

from app.schemas.candidates import DimensionLine
from tests.support.reference import (
    IMAGES,
    ChainResult,
    _polyline_samples,
    chain_dim_metrics,
    dim_metrics,
    load_dim_truth,
    load_truth,
    run_chain,
    wall_metrics,
)

pytestmark = pytest.mark.reference

OUTER_OVERALL = {"top-overall": 11000, "bottom-overall": 11100, "left-overall": 7000, "right-overall": 8900}
WALL_FLOOR = {"hdb-3room": (0.868, 0.893, 36), "brochure-2bhk": (0.908, 0.856, 18)}  # recall, precision, ends


@pytest.fixture(scope="module")
def chains() -> dict[str, ChainResult]:
    return {stem: run_chain(stem) for stem in IMAGES}


def _in_region(result: ChainResult, ids: set[str] | None = None) -> set[str]:
    """Traced lines with at least 80 % of their length inside the plan region."""
    out = set()
    for t in load_dim_truth(result.stem, result.page):
        inside = np.mean([result.pre.region.contains((x, y)) for x, y in _polyline_samples(t.points)])
        if inside >= 0.8 and (ids is None or t.id in ids):
            out.add(t.id)
    return out


def test_dimension_truth_is_traced_and_profile_checked(chains: dict[str, ChainResult]) -> None:
    """Every traced line has a label per interval and three profile checks within 0.5 px of its centre."""
    import json

    from tests.support.reference import REFERENCE_DIR

    raw = json.loads((REFERENCE_DIR / "hdb-3room.drawing-dims.json").read_text())
    assert len(raw["lines"]) == 24
    for line in raw["lines"]:
        assert len(line["labels"]) == len(line["ticks"]) - 1, line["id"]
        assert line["ticks"] == sorted(line["ticks"]), line["id"]
        assert [c["at"] for c in line["profile_check"]] == pytest.approx([0.2, 0.5, 0.8], abs=0.031)
        assert all(abs(c["offset_px"]) <= 0.5 for c in line["profile_check"]), line["id"]
    traced = {t.id for t in load_dim_truth("hdb-3room", chains["hdb-3room"].page)}
    assert set(OUTER_OVERALL) | {"right-mid"} <= traced


def test_dimension_scorer_self_check(chains: dict[str, ChainResult]) -> None:
    """The truth scored as a detection (each line straightened) matches itself; moved 3 px across it a
    straight line still matches, 8 px does not."""
    r = chains["hdb-3room"]
    truths = load_dim_truth("hdb-3room", r.page)

    def as_lines(shift: float) -> list[DimensionLine]:
        """Each traced line as a straight detection: the least-squares line through its centre polyline."""
        out = []
        for t in truths:
            pts = _polyline_samples(t.points)
            centre = pts.mean(axis=0)
            u = np.linalg.svd(pts - centre)[2][0]
            u = u if u @ (t.points[-1] - t.points[0]) > 0 else -u
            along = (pts - centre) @ u
            n = np.array((-u[1], u[0])) * shift
            a, b = centre + u * along.min() + n, centre + u * along.max() + n
            ticks = [float((p - a) @ u) for p in t.ticks]
            out.append(DimensionLine(t.id, tuple(a), tuple(b), ticks, t.id))  # type: ignore[arg-type]
        return out

    for shift, expected in ((0.0, 1.0), (1.0, 1.0), (8.0, 0.0)):
        m = dim_metrics(truths, as_lines(shift), [], {}, r.ocr.tokens, float(r.pre.region.long_side))
        assert m.recall == pytest.approx(expected), (shift, m.unmatched)
        assert m.precision == pytest.approx(expected), (shift, m.false_lines)
    near = dim_metrics(truths, as_lines(3.0), [], {}, r.ocr.tokens, float(r.pre.region.long_side))
    straight = {t.id for t in truths if len(t.points) == 2}
    assert straight.isdisjoint(near.unmatched)


def test_hdb_dimension_precision(chains: dict[str, ChainResult]) -> None:
    m = chain_dim_metrics(chains["hdb-3room"])
    assert m.precision >= 0.90, m.false_lines


def test_hdb_dimension_recall_inside_the_plan_region(chains: dict[str, ChainResult]) -> None:
    """The recall target on the traced lines the segment and OCR stages can see (inside the region)."""
    r = chains["hdb-3room"]
    m = chain_dim_metrics(r)
    inside = _in_region(r)
    missed = inside & set(m.unmatched)
    assert 1.0 - len(missed) / len(inside) >= 0.80, sorted(missed)
    assert "bottom-overall" not in m.unmatched  # the one outer overall line inside the region (11100)


@pytest.mark.xfail(
    strict=True,
    reason="Task 14b blocker: 11000, 7000, 7600, 8900 and the left chain lie outside the plan region "
    "(06 §7.6 step 7 grows the walls' box by 6 %; HDB's outer chains reach ~0.13 L out), so no segment or "
    "token exists there; needs a ruling on the region",
)
def test_hdb_dimension_recall_and_outer_overall_lines(chains: dict[str, ChainResult]) -> None:
    m = chain_dim_metrics(chains["hdb-3room"])
    assert m.recall >= 0.80 and not set(OUTER_OVERALL) & set(m.unmatched), m.unmatched


def test_hdb_spans_and_labels(chains: dict[str, ChainResult]) -> None:
    """On matched lines: >= 80 % of the traced intervals have a span within 0.5 % L at both ticks, and
    `associate_dimension_texts` maps >= 80 % of their labels to that span."""
    m = chain_dim_metrics(chains["hdb-3room"])
    assert m.interval_recall >= 0.80, m.missed_intervals
    assert m.label_recall >= 0.80, m.missed_labels


def test_brochure_has_no_dimension_lines(chains: dict[str, ChainResult]) -> None:
    """The brochure carries room sizes only (no dimension lines): none is detected (one is tolerated)."""
    assert chains["brochure-2bhk"].dims == []


@pytest.mark.parametrize("stem", list(IMAGES))
def test_walls_do_not_regress(chains: dict[str, ChainResult], stem: str) -> None:
    r = chains[stem]
    m = wall_metrics(load_truth(stem, r.page, "drawing-walls"), r.graph)
    recall, precision, free_ends = WALL_FLOOR[stem]
    # The floors are the Task 16b values as reported (3 decimals).
    assert round(m.recall, 3) >= recall and round(m.precision, 3) >= precision, m
    assert sum(w.free_ends for w in r.graph.walls) <= free_ends


@pytest.mark.parametrize("stem", list(IMAGES))
def test_dimension_stage_is_fast(chains: dict[str, ChainResult], stem: str) -> None:
    seconds = chains[stem].seconds
    assert seconds["dimensions"] < 2.0, seconds
    assert seconds["total"] < 10.0, seconds
