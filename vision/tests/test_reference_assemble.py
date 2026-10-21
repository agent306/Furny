"""Task 21: assembly and validation on the two reference blueprints, after the raster chain (replayed OCR),
the heuristic labeler (provider ``none``) and the scale solve.

The checks are structural and loose on purpose (the geometry itself is pinned by the Task 16-20 reference
tests): the document validates against the plan schema, its ids and references are consistent, the
confidences are in range, and validation repairs little on real data.
"""

import pytest

from app.pipeline.assemble import AssembleResult, assemble_document
from app.pipeline.labeling.heuristic import HeuristicLabeler
from app.pipeline.scale import find_scale_note, solve_scale
from app.pipeline.validate import validate_and_repair
from app.schemas.api import RecognizeHints, RecognizeOptions
from app.schemas.meta import MetaWarning
from app.schemas.plan import PlanDocument
from tests.support.reference import IMAGES, chain_candidates, run_chain
from tests.test_normalize import make_ctx

pytestmark = pytest.mark.reference

OPTIONS = RecognizeOptions(
    provider="none", effort="medium", agentic_crops=False, fallback_to_none_on_error=True
)


@pytest.fixture(scope="module")
def assembled() -> dict[str, tuple[AssembleResult, PlanDocument, list[MetaWarning], int]]:
    out = {}
    for stem in IMAGES:
        r = run_chain(stem)
        candidates = chain_candidates(r)
        ctx = make_ctx()
        labels = HeuristicLabeler().label(r.page, candidates, RecognizeHints(), ctx).result
        note = find_scale_note(candidates.texts, r.page)
        scale = solve_scale(candidates, labels, RecognizeHints(), r.page, ctx, scale_note=note)
        face_map = r.face_map
        if scale.anisotropy_corrected:
            # the caller's job (Task 31): the candidates follow the resampled image
            candidates, face_map = candidates.scale_y(scale.y_factor), None
        result = assemble_document(r.page, candidates, labels, scale, OPTIONS, ctx, face_map=face_map)
        walls_before = len(result.document.walls)
        document, warnings = validate_and_repair(
            result.document, confidence=result.confidence, drawing_kind=labels.drawing_kind
        )
        out[stem] = (result, document, warnings, walls_before)
    return out


@pytest.mark.parametrize("stem", IMAGES)
def test_document_is_valid_and_consistent(stem: str, assembled: dict) -> None:
    result, document, _, _ = assembled[stem]
    assert PlanDocument.model_validate(document.wire()) == document
    assert document.walls and document.rooms
    assert all(w.a in document.nodes and w.b in document.nodes for w in document.walls.values())
    assert all(o.wall_id in document.walls for o in document.openings.values())
    assert set(result.confidence.walls) == set(document.walls)
    assert set(result.confidence.openings) == set(document.openings)
    assert set(result.confidence.rooms) == set(document.rooms)
    scores = [*result.confidence.walls.values(), *result.confidence.openings.values()]
    assert all(
        0.0 <= v <= 1.0 for v in [*scores, *result.confidence.rooms.values(), result.confidence.overall]
    )
    assert set(result.confidence.reasons) <= {*document.walls, *document.openings, *document.rooms}


@pytest.mark.parametrize("stem", IMAGES)
def test_validation_repairs_little(stem: str, assembled: dict) -> None:
    _, document, warnings, walls_before = assembled[stem]
    assert len(document.walls) >= 0.9 * walls_before, (len(document.walls), walls_before)
    assert "not_a_floor_plan_suspected" not in {w.code for w in warnings}
