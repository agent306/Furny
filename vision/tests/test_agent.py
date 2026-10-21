"""LLM labeling outcomes: refusal fallback, sanitising of model answers (Task 26) and the agentic crop loop
(Task 27)."""

import logging
import threading
import time
from dataclasses import replace
from typing import Any

import pytest

from app.pipeline.annotate import build_overview
from app.pipeline.context import PipelineContext
from app.pipeline.labeling import llm
from app.pipeline.labeling.agent import run_agent
from app.pipeline.labeling.llm import LlmLabeler
from app.pipeline.labeling.prompts import FINALIZE_PROMPT, REPAIR_PROMPT_TEMPLATE
from app.pipeline.labeling.tools import CROP_IMAGE_SPEC, LIST_CANDIDATES_SPEC, ToolExecutor
from app.providers.base import (
    AssistantMessage,
    ImagePart,
    TextPart,
    ToolCall,
    ToolResultsMessage,
    TurnResult,
    UsageCall,
    UserMessage,
)
from app.providers.errors import (
    ProviderError,
    ProviderInvalidOutput,
    ProviderRefusal,
    ProviderTimeout,
)
from app.providers.testing import FULL_CAPABILITIES, FakeProvider, make_turn
from app.schemas.api import RecognizeHints
from app.schemas.labeling import LabelingResult, OpeningLabel, RoomLabel, TextLabel_, WallLabel
from tests.support.llm_labeling import failed_call, full_result, make_ctx, options, reply, scene, with_
from tests.test_annotate_tools import crop_call


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


# --- the agentic crop loop (Task 27, 06 section 9.6) ----------------------------------------------------


def crop(call_id: str = "c1", **args: object) -> ToolCall:
    return crop_call(call_id, **args)


def tool_turn(*calls: ToolCall) -> TurnResult:
    return make_turn(tool_calls=calls, stop_reason="tool_use", purpose="agent_turn")


def final(purpose: Any = "agent_turn") -> TurnResult:
    _, cs = scene()
    return make_turn(text=full_result(cs).model_dump_json(by_alias=True), purpose=purpose)


def harness(
    ctx: PipelineContext | None = None, *, max_crops: int = 8
) -> tuple[ToolExecutor, PipelineContext]:
    page, cs = scene()
    ctx = ctx or make_ctx()
    ov = build_overview(page, cs, max_image_px=2576, ctx=ctx)
    return ToolExecutor(page, ov, cs, max_image_px=2576, max_crops=max_crops), ctx


def drive(
    provider: FakeProvider, ex: ToolExecutor, ctx: PipelineContext, **kw: Any
) -> tuple[LabelingResult, list[UsageCall], bool]:
    args: dict[str, Any] = {
        "max_turns": 10,
        "max_crops": 8,
        "call_timeout_s": 180.0,
        "stage_budget_s": 420.0,
        "max_output_tokens": 32000,
    }
    args.update(kw)
    return run_agent(provider, "system", [TextPart("look")], ex, LabelingResult, "high", ctx, **args)


def test_crop_calls_executed() -> None:
    ex, ctx = harness()
    first = tool_turn(crop())
    provider = FakeProvider([first, final()])

    result, calls, repaired = drive(provider, ex, ctx)

    assert repaired is False
    assert result == full_result(scene()[1])
    one, two = provider.calls
    assert one["tool_choice"] == "auto"
    assert one["tools"] == [CROP_IMAGE_SPEC, LIST_CANDIDATES_SPEC]
    assert len(one["conversation"]) == 1  # the first call saw only the user message
    assert two["tool_choice"] == "auto"
    user, assistant, results = two["conversation"]
    assert isinstance(user, UserMessage)
    assert isinstance(assistant, AssistantMessage)
    assert assistant.native is first.assistant.native  # replayed unchanged
    assert isinstance(results, ToolResultsMessage)
    assert len(results.results) == 1
    assert results.results[0].call_id == "c1"
    assert [type(p) for p in results.results[0].content] == [ImagePart, TextPart]
    assert [c.purpose for c in calls] == ["agent_turn", "agent_turn"]
    assert [c["purpose"] for c in provider.calls] == ["agent_turn", "agent_turn"]


def test_crop_budget() -> None:
    ex, ctx = harness(max_crops=8)
    provider = FakeProvider([tool_turn(*(crop(f"c{i}") for i in range(9))), final()])

    drive(provider, ex, ctx, max_crops=8)

    results = provider.calls[1]["conversation"][2].results
    assert len(results) == 9  # one message holds every result of the turn
    assert [r.is_error for r in results] == [False] * 8 + [True]
    assert results[8].content == [TextPart("crop budget exhausted, answer now")]
    assert all(isinstance(r.content[0], ImagePart) for r in results[:8])


def test_run_agent_max_crops_caps_the_executor() -> None:
    ex, ctx = harness(max_crops=8)
    provider = FakeProvider([tool_turn(crop("a"), crop("b"), crop("c")), final()])

    drive(provider, ex, ctx, max_crops=2)

    assert [r.is_error for r in provider.calls[1]["conversation"][2].results] == [False, False, True]


def test_finalize_on_max_turns() -> None:
    ex, ctx = harness()
    provider = FakeProvider([tool_turn(crop("c1")), tool_turn(crop("c2")), final("finalize")])

    _, calls, _ = drive(provider, ex, ctx, max_turns=3)

    assert [c["tool_choice"] for c in provider.calls] == ["auto", "auto", "none"]
    assert [c["purpose"] for c in provider.calls] == ["agent_turn", "agent_turn", "finalize"]
    conversation = provider.calls[2]["conversation"]
    assert conversation[-1] == UserMessage([TextPart(FINALIZE_PROMPT)])
    assert [type(m) for m in conversation] == [
        UserMessage,
        AssistantMessage,
        ToolResultsMessage,
        AssistantMessage,
        ToolResultsMessage,
        UserMessage,
    ]
    assert len(calls) == 3


def test_finalize_on_deadline() -> None:
    ctx = make_ctx(seconds=85)  # the stage ends at deadline - 60 s: 25 s left, under the 30 s turn minimum
    ex, _ = harness(ctx)
    provider = FakeProvider([final("finalize")])

    drive(provider, ex, ctx)

    (only,) = provider.calls
    assert only["tool_choice"] == "none"
    assert only["purpose"] == "finalize"
    assert only["conversation"][-1] == UserMessage([TextPart(FINALIZE_PROMPT)])
    assert only["timeout_s"] <= 25.0


def test_timeout_finalize_then_fallback() -> None:
    ex, ctx = harness()
    provider = FakeProvider(
        [
            tool_turn(crop()),
            ProviderTimeout("slow", usage=[failed_call("agent_turn")]),
            ProviderTimeout("slow", usage=[failed_call("finalize")]),
        ]
    )

    with pytest.raises(ProviderTimeout) as caught:
        drive(provider, ex, ctx)

    assert [c.status for c in caught.value.usage] == ["succeeded", "failed", "failed"]
    assert [c["purpose"] for c in provider.calls] == ["agent_turn", "agent_turn", "finalize"]
    assert provider.calls[2]["timeout_s"] == 60
    assert provider.calls[2]["tool_choice"] == "none"


def test_timeout_then_successful_finalize() -> None:
    ex, ctx = harness()
    provider = FakeProvider(
        [tool_turn(crop()), ProviderTimeout("slow", usage=[failed_call("agent_turn")]), final("finalize")]
    )

    result, calls, _ = drive(provider, ex, ctx)

    assert result.unit_system == "metric"
    assert [c.status for c in calls] == [
        "succeeded",
        "failed",
        "succeeded",
    ]  # the timed-out call stays billed


def test_timeout_on_the_first_turn_is_not_retried() -> None:
    ex, ctx = harness()
    provider = FakeProvider([ProviderTimeout("slow", usage=[failed_call("agent_turn")])])

    with pytest.raises(ProviderTimeout):
        drive(provider, ex, ctx)

    assert len(provider.calls) == 1  # no earlier assistant turn: nothing to finalize from


def test_timeout_in_the_finalize_call_itself_is_final() -> None:
    ex, ctx = harness()
    provider = FakeProvider([tool_turn(crop()), ProviderTimeout("slow", usage=[failed_call("finalize")])])

    with pytest.raises(ProviderTimeout):
        drive(provider, ex, ctx, max_turns=2)

    assert len(provider.calls) == 2  # turn 2 was the finalize call already


def test_timeout_falls_back_to_the_heuristic_as_partial() -> None:
    page, cs = scene()
    ctx = make_ctx()
    provider = FakeProvider(
        [
            tool_turn(crop()),
            ProviderTimeout("slow", usage=[failed_call("agent_turn")]),
            ProviderTimeout("slow", usage=[failed_call("finalize")]),
        ]
    )

    outcome = LlmLabeler(provider, options(agentic_crops=True)).label(page, cs, RecognizeHints(), ctx)

    assert outcome.provider_used == "none"
    assert outcome.fallback_reason == "llm_timeout"
    assert outcome.partial is True
    assert "llm_partial" in [w.code for w in ctx.warnings]
    assert [c.status for c in outcome.calls] == ["succeeded", "failed", "failed"]  # all three stay billed
    assert outcome.result.walls  # heuristic labels


def test_timeout_without_an_earlier_turn_is_not_partial() -> None:
    page, cs = scene()
    ctx = make_ctx()
    provider = FakeProvider([ProviderTimeout("slow", usage=[failed_call("agent_turn")])])

    outcome = LlmLabeler(provider, options(agentic_crops=True)).label(page, cs, RecognizeHints(), ctx)

    assert outcome.fallback_reason == "llm_timeout"
    assert outcome.partial is False
    assert "llm_partial" not in [w.code for w in ctx.warnings]


def test_invalid_tool_args() -> None:
    ex, ctx = harness()
    args = {k: v for k, v in crop_call().arguments.items() if k != "h"}
    provider = FakeProvider([tool_turn(ToolCall("c1", "crop_image", args)), final()])

    result, _, _ = drive(provider, ex, ctx)

    (res,) = provider.calls[1]["conversation"][2].results
    assert res.is_error
    assert isinstance(res.content[0], TextPart)
    assert "Field required" in res.content[0].text  # the pydantic message
    assert result.unit_system == "metric"  # the loop went on


def test_invalid_json_arguments_are_a_tool_error() -> None:
    ex, ctx = harness()
    bad = ToolCall("c1", "crop_image", {"__invalid_json__": '{"x": 1'})
    provider = FakeProvider([tool_turn(bad), final()])

    drive(provider, ex, ctx)

    (res,) = provider.calls[1]["conversation"][2].results
    assert res.is_error
    assert res.content == [TextPart("invalid JSON arguments")]
    assert ex.crops_used == 0


def test_unknown_tool() -> None:
    ex, ctx = harness()
    provider = FakeProvider([tool_turn(ToolCall("z1", "zoom", {"x": 1})), final()])

    drive(provider, ex, ctx)

    (res,) = provider.calls[1]["conversation"][2].results
    assert res.is_error
    assert res.call_id == "z1"
    assert isinstance(res.content[0], TextPart)
    assert "unknown tool" in res.content[0].text


def test_invalid_crops_do_not_spend_the_budget_but_max_turns_ends_the_loop() -> None:
    ex, ctx = harness(max_crops=2)
    tiny = ToolCall("c", "crop_image", {**crop_call().arguments, "w": 4})
    provider = FakeProvider([tool_turn(tiny), tool_turn(tiny), final("finalize")])

    drive(provider, ex, ctx, max_turns=3, max_crops=2)

    assert ex.crops_used == 0  # invalid crops are free ...
    assert [c["tool_choice"] for c in provider.calls] == ["auto", "auto", "none"]  # ... but turns are not


def test_a_tool_that_blows_up_becomes_an_error_result(monkeypatch: pytest.MonkeyPatch) -> None:
    ex, ctx = harness()

    def boom(_call: ToolCall) -> Any:
        raise RuntimeError("secret detail")

    monkeypatch.setattr(ex, "execute", boom)
    provider = FakeProvider([tool_turn(crop()), final()])

    drive(provider, ex, ctx)

    (res,) = provider.calls[1]["conversation"][2].results
    assert res.is_error
    assert res.content == [TextPart("tool failed")]  # the exception text is not echoed to the model


def test_invalid_final_json_with_schema_support() -> None:
    ex, ctx = harness()
    provider = FakeProvider([make_turn(text="not json", purpose="agent_turn")])

    with pytest.raises(ProviderInvalidOutput) as caught:
        drive(provider, ex, ctx)

    assert len(provider.calls) == 1  # no repair when the provider enforces the schema
    assert provider.calls[0]["output_schema"] is not None
    assert len(caught.value.usage) == 1


def test_repair_round_without_schema() -> None:
    ex, ctx = harness()
    caps = replace(FULL_CAPABILITIES, supports_json_schema=False)
    bad = make_turn(text="{oops", purpose="agent_turn")
    provider = FakeProvider([bad, final("repair")], capabilities=caps)

    result, calls, repaired = drive(provider, ex, ctx)

    assert repaired is True
    assert result.unit_system == "metric"
    assert [c["purpose"] for c in provider.calls] == ["agent_turn", "repair"]
    assert provider.calls[0]["output_schema"] is None
    assert "Output format" in provider.calls[0]["system"]  # the schema travels in the system prompt
    conversation = provider.calls[1]["conversation"]
    assert conversation[-2].native is bad.assistant.native
    last = conversation[-1]
    assert isinstance(last, UserMessage)
    assert isinstance(last.parts[0], TextPart)
    assert last.parts[0].text.startswith(REPAIR_PROMPT_TEMPLATE.split("{errors}")[0])
    assert provider.calls[1]["tool_choice"] == "none"
    assert len(calls) == 2


def test_repair_failure_is_invalid_output() -> None:
    ex, ctx = harness()
    caps = replace(FULL_CAPABILITIES, supports_json_schema=False)
    provider = FakeProvider(
        [make_turn(text="x", purpose="agent_turn"), make_turn(text="y", purpose="repair")], capabilities=caps
    )

    with pytest.raises(ProviderInvalidOutput) as caught:
        drive(provider, ex, ctx)

    assert len(caught.value.usage) == 2


def test_refusal_and_truncation_raise() -> None:
    ex, ctx = harness()
    refused = make_turn(text="no", stop_reason="refusal", purpose="agent_turn")
    with pytest.raises(ProviderRefusal):
        drive(FakeProvider([refused]), ex, ctx)
    cut = make_turn(text="{", stop_reason="max_tokens", purpose="agent_turn")
    with pytest.raises(ProviderInvalidOutput):
        drive(FakeProvider([cut]), ex, ctx)


def test_timeouts_passed() -> None:
    ex, ctx = harness()
    provider = FakeProvider([tool_turn(crop()), final()])

    drive(provider, ex, ctx, call_timeout_s=180.0, stage_budget_s=40.0)

    for call in provider.calls:
        assert call["timeout_s"] <= min(180.0, 40.0)
        assert call["max_output_tokens"] == 32000
        assert call["effort"] == "high"


def test_labeler_runs_the_agent_and_reports_tool_calls() -> None:
    page, cs = scene()
    ctx = make_ctx()
    provider = FakeProvider([tool_turn(crop()), final()])

    outcome = LlmLabeler(provider, options(agentic_crops=True)).label(page, cs, RecognizeHints(), ctx)

    assert outcome.provider_used == "anthropic"
    assert outcome.fallback_reason is None
    assert outcome.partial is False
    assert [c.purpose for c in outcome.calls] == ["agent_turn", "agent_turn"]
    assert [t["toolCalls"] for t in outcome.transcript] == [
        [{"name": "crop_image", "arguments": crop_call().arguments}],
        [],
    ]
    first = provider.calls[0]["conversation"][0]
    assert isinstance(first, UserMessage)
    assert [type(p) for p in first.parts] == [ImagePart, ImagePart, TextPart]
    assert isinstance(first.parts[-1], TextPart)
    assert "crop_image returns" in first.parts[-1].text  # the tools block is in the prompt
    assert provider.calls[0]["system"] == llm.SYSTEM_PROMPT_LABELING


def test_agentic_mode_needs_tool_support() -> None:
    page, cs = scene()
    caps = replace(FULL_CAPABILITIES, supports_tools=False)
    provider = FakeProvider([reply(full_result(cs))], capabilities=caps)

    outcome = LlmLabeler(provider, options(agentic_crops=True)).label(page, cs, RecognizeHints(), make_ctx())

    assert outcome.fallback_reason is None
    assert provider.calls[0]["tools"] == []  # single pass


# --- the provider-call boundary (Task 26 ruling) ---------------------------------------------------------


def slow_call(provider: FakeProvider) -> None:
    llm._complete(
        provider,
        [UserMessage([TextPart("x")])],
        system="s",
        schema=None,
        effort="high",
        max_output_tokens=10,
        timeout_s=0.05,
        purpose="agent_turn",
    )


def test_abandoned_call_logs_token_counts_only(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    monkeypatch.setattr(llm, "DEADLINE_GRACE_S", 0.05)
    monkeypatch.setattr(llm, "_abandoned", 0)
    release = threading.Event()

    def hang(_conversation: Any) -> TurnResult:
        release.wait(10)
        return make_turn(text="CONFIDENTIAL ANSWER", purpose="agent_turn")

    with caplog.at_level(logging.INFO, logger="furny.vision"):
        with pytest.raises(ProviderTimeout):
            slow_call(FakeProvider([hang]))
        assert llm._abandoned == 1
        release.set()
        deadline = time.monotonic() + 3
        while llm._abandoned and time.monotonic() < deadline:
            time.sleep(0.01)

    assert llm._abandoned == 0
    (record,) = [r for r in caplog.records if r.name.startswith("furny.vision")]
    assert (record.purpose, record.inputTokens, record.outputTokens) == ("agent_turn", 100, 20)  # type: ignore[attr-defined]
    assert "CONFIDENTIAL" not in caplog.text


def test_too_many_abandoned_calls_skip_the_llm(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(llm, "_abandoned", llm.MAX_ABANDONED_CALLS)
    provider = FakeProvider([])

    with pytest.raises(ProviderError) as caught:
        slow_call(provider)

    assert caught.value.code == "llm_error"
    assert caught.value.retryable is True
    assert provider.calls == []

    page, cs = scene()
    outcome = LlmLabeler(provider, options()).label(page, cs, RecognizeHints(), make_ctx())
    assert outcome.provider_used == "none"
    assert outcome.fallback_reason == "llm_error"


def test_unexpected_exception_degrades_to_llm_error() -> None:
    page, cs = scene()
    for opts in (options(), options(agentic_crops=True)):
        outcome = LlmLabeler(FakeProvider([RuntimeError("boom")]), opts).label(
            page, cs, RecognizeHints(), make_ctx()
        )
        assert outcome.provider_used == "none"
        assert outcome.fallback_reason == "llm_error"
