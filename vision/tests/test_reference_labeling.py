"""Task 19: the heuristic labeler (provider ``none``) on the two reference blueprints, through the full raster
chain (walls -> openings -> room faces) with replayed OCR.

**Unit systems.** The HDB flat is dimensioned in plain millimetre numbers (39 ``mm_number`` tokens listed by
dimension spans, no foot marks), so ``metric``. The brochure is drawn in feet: its area reads ``912 SQ.FT``
and its room sizes are feet-inch pairs (``10'0"x11'0"`` ...), but the OCR garbles them (``8'1x50``,
``6'6'x7``, ``51X76"``, ``101"x21'6"``): the foot marks survive on several tokens the parser cannot read,
which the labeler counts as imperial evidence, so ``imperial`` (and no ``unit_system_guessed`` warning).
"""

import pytest

from app.pipeline.labeling.base import LabelingOutcome
from app.pipeline.labeling.heuristic import HeuristicLabeler
from app.pipeline.ocr_stage import in_region
from app.pipeline.textparse import parse_token
from app.schemas.api import RecognizeHints
from app.schemas.candidates import TextToken
from app.schemas.meta import MetaWarning
from app.utils.roomnames import room_display_name
from tests.support.labeling import checked
from tests.support.reference import (
    IMAGES,
    ChainResult,
    chain_candidates,
    label_token,
    load_rooms_truth,
    room_metrics,
    run_chain,
)
from tests.test_normalize import make_ctx

pytestmark = pytest.mark.reference

STEMS = sorted(IMAGES)
UNIT_SYSTEM = {"hdb-3room": "metric", "brochure-2bhk": "imperial"}
# Floors: what the labeler reached on the current chain (Task 19 report).
NAMED_FACES_FLOOR = {"hdb-3room": 5, "brochure-2bhk": 5}  # faces with a room name
MATCHED_NAMED_FLOOR = {"hdb-3room": 3, "brochure-2bhk": 3}  # matched truth rooms with the right name and type
DIMENSIONS_FLOOR = {"hdb-3room": 39, "brochure-2bhk": 0}  # dimension labels (tokens a span lists)
SIZES_FLOOR = {"hdb-3room": 0, "brochure-2bhk": 3}  # rooms with a size text
MISSED_FLOOR = {"hdb-3room": 0, "brochure-2bhk": 2}  # OTS and the corridor note, in no face


@pytest.fixture(scope="module")
def runs() -> dict[str, tuple[ChainResult, LabelingOutcome, list[MetaWarning]]]:
    out = {}
    for stem in STEMS:
        r = run_chain(stem)
        ctx = make_ctx()
        outcome = HeuristicLabeler().label(r.page, chain_candidates(r), RecognizeHints(), ctx)
        checked(outcome.result)
        out[stem] = (r, outcome, ctx.warnings)
    return out


@pytest.mark.parametrize("stem", STEMS)
def test_unit_system(stem: str, runs: dict) -> None:
    _, outcome, warnings = runs[stem]
    assert outcome.result.unit_system == UNIT_SYSTEM[stem]
    assert not [w for w in warnings if w.code == "unit_system_guessed"]
    assert (outcome.provider_used, outcome.model, outcome.calls, outcome.partial) == ("none", None, [], False)


@pytest.mark.parametrize("stem", STEMS)
def test_matched_rooms_get_their_names(stem: str, runs: dict) -> None:
    """Every matched truth room (ledges excluded) whose label was OCR'd gets that name and type."""
    r, outcome, _ = runs[stem]
    plan_tokens = in_region(r.ocr.tokens, r.pre.region)
    truth = load_rooms_truth(stem, r.page)
    matched = room_metrics(truth, r.rooms, plan_tokens).matched
    rooms = {room.id: room for room in outcome.result.rooms}
    right = 0
    for t in truth:
        token = label_token(t, plan_tokens)
        if t.id not in matched or token is None:
            continue
        room = rooms[matched[t.id]]
        parsed = parse_token(t.label or "")
        assert room.name_text_id == token.id, (t.id, room)
        assert room.name == room_display_name(token.text, token.parsed.room_name or ""), (t.id, room)
        assert room.type == parsed.room_type, (t.id, room)
        assert room.include is True
        right += 1
    assert right >= MATCHED_NAMED_FLOOR[stem]


@pytest.mark.parametrize("stem", STEMS)
def test_missed_rooms_sit_at_the_name_tokens_in_no_face(stem: str, runs: dict) -> None:
    """Each truth room whose label token lies outside every face gets a ``MissedRoom`` at the token (none
    when the token is outside the plan region); and every ``MissedRoom`` is such a token."""
    r, outcome, _ = runs[stem]
    plan_tokens = in_region(r.ocr.tokens, r.pre.region)

    def centre(t: TextToken) -> tuple[int, int]:
        return round((t.box[0] + t.box[2]) / 2), round((t.box[1] + t.box[3]) / 2)

    missed = {(m.x, m.y) for m in outcome.result.missed_rooms}
    named = {room.name_text_id for room in outcome.result.rooms}
    listed = {tid for f in r.rooms for tid in f.contains_text_ids}
    for t in load_rooms_truth(stem, r.page):
        token = label_token(t, plan_tokens)
        if (
            token is not None
        ):  # a face names or merges it (listed, or on its wall: Task 18 carry M4), else missed
            assert token.id in named | listed or centre(token) in missed, t.id
    free = {centre(t) for t in plan_tokens if t.parsed.kind == "room_name" and t.id not in named | listed}
    assert missed <= free
    outside = [t for t in r.ocr.tokens if t not in plan_tokens]
    roles = {t.id: t.role for t in outcome.result.texts}
    assert all(roles[t.id] in ("ignore", "dimension") for t in outside)
    assert len(outcome.result.missed_rooms) >= MISSED_FLOOR[stem]


@pytest.mark.parametrize("stem", STEMS)
def test_label_counts_do_not_drop(stem: str, runs: dict) -> None:
    result = runs[stem][1].result
    assert sum(room.name is not None for room in result.rooms) >= NAMED_FACES_FLOOR[stem]
    assert len(result.dimensions) >= DIMENSIONS_FLOOR[stem]
    assert sum(room.size_text is not None for room in result.rooms) >= SIZES_FLOOR[stem]
    assert len(result.walls) and all(w.kind is None for w in result.walls)
    assert {room.id for room in result.rooms} == {f.id for f in runs[stem][0].rooms}
