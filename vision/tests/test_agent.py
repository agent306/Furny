"""LLM labeling outcomes: refusal fallback and sanitising of model answers (Task 26; Task 27 extends this file
with the agent loop)."""

from app.pipeline.labeling.llm import LlmLabeler
from app.providers.errors import ProviderRefusal
from app.providers.testing import FakeProvider
from app.schemas.api import RecognizeHints
from app.schemas.labeling import OpeningLabel, RoomLabel, TextLabel_, WallLabel
from tests.support.llm_labeling import failed_call, full_result, make_ctx, options, reply, scene, with_


def label(provider: FakeProvider):  # type: ignore[no-untyped-def]
    page, cs = scene()
    ctx = make_ctx()
    return LlmLabeler(provider, options()).label(page, cs, RecognizeHints(), ctx), ctx


def test_refusal_falls_back() -> None:
    call = failed_call()
    outcome, ctx = label(FakeProvider([ProviderRefusal("no", category="policy", usage=[call])]))

    assert outcome.provider_used == "none"
    assert outcome.model is None
    assert outcome.fallback_reason == "llm_refused"
    assert outcome.calls == [call]  # the failed call stays on the bill
    assert outcome.partial is False
    assert outcome.result.walls  # heuristic labels
    warnings = [w for w in ctx.warnings if w.code == "llm_failed_fallback_none"]
    assert [w.params for w in warnings] == [{"reason": "llm_refused"}]


def test_unknown_ids_sanitised() -> None:
    _, cs = scene()
    answer = with_(
        full_result(cs),
        walls=[
            WallLabel(id="W1", verdict="not_wall", kind=None),
            WallLabel(id="W1", verdict="wall", kind="exterior"),  # duplicate: the first wins
            WallLabel(id="W999", verdict="wall", kind="interior"),  # unknown: dropped
            *(WallLabel(id=f"W{n}", verdict="wall", kind="interior") for n in (2, 3, 4)),  # W5, W6 omitted
        ],
        rooms=[
            RoomLabel(
                id="R1",
                include=True,
                name="Master Bedroom " * 5,  # 75 chars
                type="master_bedroom",
                name_text_id=None,
                size_text=None,
                width_mm=None,
                depth_mm=None,
            )
        ],
    )
    answer = with_(
        answer,
        dimensions=[answer.dimensions[0].model_copy(update={"value_mm": 70000})],
    )
    outcome, _ = label(FakeProvider([reply(answer)]))

    assert outcome.provider_used == "anthropic"
    assert outcome.fallback_reason is None
    result = outcome.result
    assert [(w.id, w.verdict) for w in result.walls][:1] == [("W1", "not_wall")]
    assert [w.id for w in result.walls] == ["W1", "W2", "W3", "W4", "W5", "W6"]  # W5-W6 heuristic, W999 gone
    assert result.dimensions[0].value_mm is None
    assert len(result.rooms[0].name or "") == 60
    assert [r.id for r in result.rooms] == ["R1", "R2"]  # R2 not mentioned: heuristic label

    # more than 20 % of the entries dropped: the answer is not trusted
    many = with_(
        full_result(cs),
        walls=[WallLabel(id=f"W9{i}", verdict="wall", kind=None) for i in range(5)],
        openings=[OpeningLabel(id="O1", verdict="door", door_type=None, window_type=None)],
        texts=[TextLabel_(id="T1", role="other", normalized_text=None)],
    )
    outcome, ctx = label(FakeProvider([reply(many)]))
    assert outcome.provider_used == "none"
    assert outcome.fallback_reason == "llm_invalid_output"
    assert len(outcome.calls) == 1
    assert [w.params for w in ctx.warnings if w.code == "llm_failed_fallback_none"] == [
        {"reason": "llm_invalid_output"}
    ]
