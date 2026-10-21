"""Fixtures for the LLM labeler tests (Task 26): a scene with an offset plan region, options, answers."""

from app.pipeline.context import PipelineContext
from app.pipeline.labeling.llm import LabelerOptions
from app.pipeline.normalize import NormalizedPage
from app.providers.base import TurnResult, UsageCall
from app.providers.testing import make_turn
from app.schemas.candidates import (
    CandidateSet,
    DimensionSpan,
    OpeningCandidate,
    ParsedText,
    RoomFace,
)
from app.schemas.labeling import (
    DimensionLabel,
    LabelingResult,
    OpeningLabel,
    RoomLabel,
    TextLabel_,
    WallLabel,
)
from app.utils.geometry import Rect
from tests.test_annotate_tools import make_page, make_set, make_text, make_wall

REGION = Rect(40, 30, 320, 240)  # a non-zero offset: overview px are not normalized px


class _NoIO:
    def fetch(self, url: str, max_bytes: int, timeout_s: float = 30) -> bytes:
        raise AssertionError("not used")

    def put(self, url: str, data: bytes, content_type: str) -> None:
        raise AssertionError("not used")


def make_ctx(seconds: float = 600) -> PipelineContext:
    return PipelineContext.for_request(seconds, _NoIO(), debug=False)


def scene() -> tuple[NormalizedPage, CandidateSet]:
    """400x300 page; texts T1-T2, walls W1-W6, opening O1, rooms R1-R2, span D1."""
    walls = [
        make_wall(1, (60.0, 60.0), (340.0, 60.0)),
        make_wall(2, (340.0, 60.0), (340.0, 250.0)),
        make_wall(3, (340.0, 250.0), (60.0, 250.0)),
        make_wall(4, (60.0, 250.0), (60.0, 60.0)),
        make_wall(5, (200.0, 60.0), (200.0, 250.0)),
        make_wall(6, (60.0, 150.0), (200.0, 150.0)),
    ]
    rooms = [
        RoomFace(
            id="R1",
            polygon_px=((65.0, 65.0), (195.0, 65.0), (195.0, 245.0), (65.0, 245.0)),
            anchor_px=(130.0, 150.0),
            area_px=23400.0,
            bbox=(65.0, 65.0, 195.0, 245.0),
            contains_text_ids=("T1",),
            open=False,
        ),
        RoomFace(
            id="R2",
            polygon_px=((205.0, 65.0), (335.0, 65.0), (335.0, 245.0), (205.0, 245.0)),
            anchor_px=(270.0, 150.0),
            area_px=23400.0,
            bbox=(205.0, 65.0, 335.0, 245.0),
            contains_text_ids=(),
            open=False,
        ),
    ]
    cs = make_set(
        region=REGION,
        texts=[
            make_text(1, "BEDROOM", x=80.0, parsed=ParsedText(kind="room_name", room_type="bedroom")),
            make_text(2, "3300", x=120.0, parsed=ParsedText(kind="mm_number", mm=3300)),
        ],
        walls=walls,
        openings=[
            OpeningCandidate(
                id="O1",
                wall_id="W1",
                u0=60.0,
                u1=100.0,
                kind="door",
                type="single_swing",
                hinge="start",
                swing="left",
                support=0.71,
            )
        ],
        rooms=rooms,
        spans=[
            DimensionSpan(
                id="D1",
                p0=(60.0, 40.0),
                p1=(200.0, 40.0),
                axis="x",
                kind="chain_segment",
                near_text_ids=["T2"],
                line_id="L1",
            )
        ],
    )
    return make_page(400, 300), cs


def options(**kw: object) -> LabelerOptions:
    base: dict[str, object] = {
        "agentic_crops": False,
        "effort": "high",
        "fallback_to_none": True,
        "max_turns": 10,
        "max_crops": 8,
        "call_timeout_s": 30.0,
        "stage_budget_s": 420.0,
        "max_output_tokens": 32000,
    }
    base.update(kw)
    return LabelerOptions(**base)  # type: ignore[arg-type]


def full_result(cs: CandidateSet) -> LabelingResult:
    """A model answer that mentions every candidate."""
    return LabelingResult(
        unit_system="metric",
        drawing_kind="architectural_line_drawing",
        texts=[TextLabel_(id=t.id, role="other", normalized_text=t.text) for t in cs.texts],
        dimensions=[DimensionLabel(text_id="T2", span_id="D1", value_mm=3300, kind="chain_segment")],
        rooms=[
            RoomLabel(
                id=r.id,
                include=True,
                name="Bedroom",
                type="bedroom",
                name_text_id=None,
                size_text=None,
                width_mm=None,
                depth_mm=None,
            )
            for r in cs.rooms
        ],
        missed_rooms=[],
        walls=[WallLabel(id=w.id, verdict="wall", kind="interior") for w in cs.walls],
        openings=[
            OpeningLabel(id=o.id, verdict="door", door_type="single_swing", window_type=None)
            for o in cs.openings
        ],
        missed_openings=[],
        known_dimension_match=None,
        notes=None,
    )


def reply(result: LabelingResult | str) -> TurnResult:
    text = result if isinstance(result, str) else result.model_dump_json(by_alias=True)
    return make_turn(text=text)


def failed_call(purpose: str = "labeling") -> UsageCall:
    return UsageCall(
        purpose=purpose,  # type: ignore[arg-type]
        model="fake-model",
        input_tokens=10,
        output_tokens=0,
        cache_read_input_tokens=0,
        cache_creation_input_tokens=0,
        images=2,
        duration_ms=3,
        stop_reason="refusal",
        status="failed",
    )


def with_(result: LabelingResult, **changes: object) -> LabelingResult:
    """``result`` with fields replaced (pydantic models are not dataclasses)."""
    return result.model_copy(update=changes)
