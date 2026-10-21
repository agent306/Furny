"""Task 20: the scale solver on the two reference blueprints, after the raster chain (replayed OCR) and the
heuristic labeler (provider ``none``).

**HDB truth.** The traced ``top-overall`` line of ``hdb-3room.drawing-dims.json`` (the 11000 overall line, its
end ticks through ``page.transform``, as the Task 14b metrics map them) gives the x scale; the traced
``right-overall`` line (8900) gives the y scale. The photo of the drawing is anisotropic (the y scale is
about 4.4 % below the x scale on those two lines), so the solver corrects it and reports ``mm/px = k_x``.

**Brochure.** It has no dimension lines, its size texts lost their foot marks in the OCR (read as
``100x110``: no size in mm on a plan in feet), and it is a PNG (no scale note): the method is
``default_guess``. Its truth scale is the P2 fixture's registration (``brochure-2bhk.walls.json``: the
overall extents, 9630 x 8120 mm, on four hand-measured corners, through ``page.transform``), as Task 16b
registered it.
"""

import time

import numpy as np
import pytest

from app.pipeline.labeling.heuristic import HeuristicLabeler
from app.pipeline.scale import ScaleResult, find_scale_note, solve_scale
from app.schemas.api import RecognizeHints
from app.schemas.meta import MetaWarning
from tests.support.reference import (
    IMAGES,
    ChainResult,
    chain_candidates,
    load_dim_truth,
    load_truth,
    run_chain,
)
from tests.test_normalize import make_ctx

pytestmark = pytest.mark.reference

HDB_TOLERANCE = 0.02  # the brief's acceptance: within 2 % of the traced 11000 line's scale


def _traced_mm_per_px(r: ChainResult, line_id: str) -> float:
    truth = next(t for t in load_dim_truth(r.stem, r.page) if t.id == line_id)
    value = sum(v for v in truth.labels if v is not None)
    return value / float(np.linalg.norm(truth.ticks[-1] - truth.ticks[0]))


@pytest.fixture(scope="module")
def solved() -> dict[str, tuple[ChainResult, ScaleResult, list[MetaWarning], float]]:
    out = {}
    for stem in IMAGES:
        r = run_chain(stem)
        start = time.perf_counter()
        candidates = chain_candidates(r)
        ctx = make_ctx()
        labels = HeuristicLabeler().label(r.page, candidates, RecognizeHints(), ctx).result
        note = find_scale_note(candidates.texts, r.page)
        result = solve_scale(candidates, labels, RecognizeHints(), r.page, ctx, scale_note=note)
        seconds = r.seconds["total"] - r.seconds["ocr_replay"] + time.perf_counter() - start
        out[stem] = (r, result, ctx.warnings, seconds)
    return out


def test_hdb_scale_from_the_dimension_chains(solved: dict) -> None:
    r, result, warnings, _ = solved["hdb-3room"]
    truth = _traced_mm_per_px(r, "top-overall")
    assert result.method == "dimension_chain"
    assert abs(result.mm_per_px / truth - 1.0) <= HDB_TOLERANCE, (result.mm_per_px, truth)
    # Floors of the Task 20 run: 39 inliers, none rejected, residual 0.80 %, one consistent chain (the right
    # chain's 7600 + 1300 is the 8900 overall line), confidence 0.966, no room sizes (the HDB plan has none).
    assert result.samples >= 35 and result.rejected <= 2, (result.samples, result.rejected)
    assert result.residual_pct is not None and result.residual_pct <= 1.5
    assert result.consistent_chains >= 1
    assert result.confidence >= 0.9
    assert result.room_label_check.rooms == 0
    assert "scale_high_residual" not in {w.code for w in warnings}


def test_hdb_anisotropy_is_corrected(solved: dict) -> None:
    """The photo's y scale differs from its x scale by ~4 %: corrected, by the traced lines' ratio
    (8900 line / 11000 line) within 1 %."""
    r, result, warnings, _ = solved["hdb-3room"]
    traced = _traced_mm_per_px(r, "right-overall") / _traced_mm_per_px(r, "top-overall")
    assert result.anisotropy_corrected is True
    assert result.y_factor == pytest.approx(traced, abs=0.01)
    assert [w.code for w in warnings if w.code.startswith("scale_")] == ["scale_anisotropy_corrected"]


def test_brochure_scale_is_guessed(solved: dict) -> None:
    """Regression pin (not a target): no dimension lines, no size in mm, no scale note, so the 12 m guess
    (10.1 % above the registered truth scale). A labeler that recovers the feet sizes would move it to
    ``room_label``; update this pin then."""
    r, result, warnings, _ = solved["brochure-2bhk"]
    truth = 1.0 / load_truth("brochure-2bhk", r.page, "walls").scale
    assert result.method == "default_guess"
    assert result.mm_per_px == 12000 / r.pre.region.long_side
    assert abs(result.mm_per_px / truth - 1.0) <= 0.15, (result.mm_per_px, truth)
    assert [(w.code, w.params) for w in warnings if w.code.startswith("scale_")] == [
        ("scale_guessed", {"assumedLongEdgeMm": 12000})
    ]


@pytest.mark.parametrize("stem", list(IMAGES))
def test_chain_and_scale_are_fast(solved: dict, stem: str) -> None:
    """The chain (replayed OCR) plus labeling and scale stay under 10 s per image."""
    assert solved[stem][3] < 10.0
