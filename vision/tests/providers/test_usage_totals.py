"""Usage totals and status (06 §6.4; 18 §17.1 test_usage_totals), plus the error and fake helpers."""

import json

import pytest

from app.providers.base import (
    AssistantMessage,
    ImagePart,
    LLMProvider,
    ToolCall,
    ToolResult,
    ToolResultsMessage,
    UsageCall,
    UserMessage,
)
from app.providers.errors import (
    ProviderAuthError,
    ProviderBadRequest,
    ProviderError,
    ProviderInvalidOutput,
    ProviderRefusal,
    ProviderTimeout,
    ProviderUnavailable,
    fallback_reason_for,
)
from app.providers.none_provider import NoneProvider
from app.providers.testing import FakeProvider, ReplayProvider, make_turn
from app.providers.usage import build_usage, usage_call_out


def call(purpose: str = "agent_turn", status: str = "succeeded", n: int = 1, images: int = 1) -> UsageCall:
    return UsageCall(
        purpose=purpose,  # type: ignore[arg-type]
        model="claude-opus-5-5",
        input_tokens=1000 * n,
        output_tokens=100 * n,
        cache_read_input_tokens=10 * n,
        cache_creation_input_tokens=5 * n,
        images=images,
        duration_ms=2000 * n,
        stop_reason="end_turn" if status == "succeeded" else "error",
        status=status,  # type: ignore[arg-type]
    )


def test_usage_call_out_maps_every_field() -> None:
    out = usage_call_out(call("labeling", n=2))
    assert out.wire() == {
        "purpose": "labeling",
        "model": "claude-opus-5-5",
        "inputTokens": 2000,
        "outputTokens": 200,
        "cacheReadInputTokens": 20,
        "cacheCreationInputTokens": 10,
        "images": 1,
        "durationMs": 4000,
        "stopReason": "end_turn",
        "status": "succeeded",
    }


def test_totals_and_failed_final_call() -> None:
    calls = [
        call("labeling", n=1),
        call("agent_turn", n=2),
        call("finalize", n=3),
        call("repair", "failed", 4),
    ]
    usage = build_usage("anthropic", "claude-opus-5-5", calls, fell_back=False)
    assert usage.provider == "anthropic"
    assert usage.model == "claude-opus-5-5"
    assert [c.purpose for c in usage.calls] == ["labeling", "agent_turn", "finalize", "repair"]
    assert usage.totals.requests == 4
    assert usage.totals.input_tokens == 1000 + 2000 + 3000 + 4000
    assert usage.totals.output_tokens == 100 + 200 + 300 + 400
    assert usage.totals.images == 4
    assert usage.totals.duration_ms == 2000 + 4000 + 6000 + 8000
    assert usage.status == "failed"


def test_all_succeeded_is_succeeded() -> None:
    usage = build_usage("anthropic", "m", [call(), call()], fell_back=False)
    assert usage.status == "succeeded"
    assert usage.totals.requests == 2


def test_fell_back_marks_failed_even_when_every_call_succeeded() -> None:
    assert build_usage("anthropic", "m", [call()], fell_back=True).status == "failed"


def test_provider_none_usage() -> None:
    usage = build_usage("none", None, [], fell_back=False)
    assert usage.wire() == {
        "provider": "none",
        "model": None,
        "calls": [],
        "totals": {"requests": 0, "inputTokens": 0, "outputTokens": 0, "images": 0, "durationMs": 0},
        "status": "succeeded",
    }


# --- errors (18 §6.2) ------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("err", "code", "retryable", "reason"),
    [
        (ProviderAuthError("x"), "provider_auth_failed", False, "provider_auth_failed"),
        (ProviderBadRequest("x"), "provider_bad_request", False, "llm_error"),
        (ProviderBadRequest("x", code="model_not_found"), "model_not_found", False, "llm_error"),
        (ProviderUnavailable("x"), "provider_unreachable", True, "llm_error"),
        (ProviderUnavailable("x", code="provider_rate_limited"), "provider_rate_limited", True, "llm_error"),
        (ProviderUnavailable("x", code="provider_overloaded"), "provider_overloaded", True, "llm_error"),
        (ProviderTimeout("x"), "llm_timeout", True, "llm_timeout"),
        (ProviderRefusal("x"), "llm_refused", False, "llm_refused"),
        (ProviderInvalidOutput("x"), "llm_invalid_output", False, "llm_invalid_output"),
    ],
)
def test_error_codes_and_fallback_reason(err: ProviderError, code: str, retryable: bool, reason: str) -> None:
    assert err.code == code
    assert err.retryable is retryable
    assert err.usage == []
    assert fallback_reason_for(err) == reason


def test_error_carries_usage_and_refusal_category() -> None:
    calls = [call()]
    err = ProviderRefusal("refused", category="cyber", usage=calls)
    assert err.usage == calls
    assert err.category == "cyber"
    assert ProviderRefusal("refused").category is None
    assert str(err) == "refused"


def test_base_provider_error_fallback_is_llm_error() -> None:
    assert fallback_reason_for(ProviderError("x", code="whatever")) == "llm_error"


# --- fakes -----------------------------------------------------------------------------------------


def test_make_turn_builds_the_assistant_message() -> None:
    tool = ToolCall("t1", "crop_image", {"x": 1})
    turn = make_turn(text="hi", tool_calls=[tool], stop_reason="tool_use", purpose="agent_turn")
    assert turn.assistant.text == "hi"
    assert turn.assistant.tool_calls == [tool]
    assert turn.assistant.native is not None
    assert turn.stop_reason == "tool_use"
    assert turn.usage.purpose == "agent_turn"
    assert turn.usage.status == "succeeded"
    assert turn.usage.stop_reason == "tool_use"
    assert make_turn().assistant.text is None


def test_fake_provider_script_order_and_recording() -> None:
    boom = ProviderTimeout("slow")
    seen: list[int] = []

    def dynamic(conversation: list[object]) -> object:
        seen.append(len(conversation))
        return make_turn(text="dyn")

    fake = FakeProvider([make_turn(text="one"), boom, dynamic])  # type: ignore[list-item]
    assert isinstance(fake, LLMProvider)
    kwargs = {
        "system": "s",
        "tools": [],
        "tool_choice": "auto",
        "output_schema": None,
        "effort": "high",
        "max_output_tokens": 10,
        "timeout_s": 5.0,
        "purpose": "labeling",
    }
    first = fake.complete([UserMessage([ImagePart(b"x", "image/png")])], **kwargs)  # type: ignore[arg-type]
    assert first.assistant.text == "one"
    with pytest.raises(ProviderTimeout):
        fake.complete([], **kwargs)  # type: ignore[arg-type]
    third = fake.complete(
        [UserMessage([]), AssistantMessage("n", None, []), ToolResultsMessage([ToolResult("t1", [])])],
        **kwargs,  # type: ignore[arg-type]
    )
    assert third.assistant.text == "dyn"
    assert seen == [3]
    assert len(fake.calls) == 3
    assert fake.calls[0]["effort"] == "high"
    assert fake.calls[0]["purpose"] == "labeling"
    with pytest.raises(AssertionError, match="script exhausted"):
        fake.complete([], **kwargs)  # type: ignore[arg-type]


def test_replay_provider_returns_the_json_as_text() -> None:
    replay = ReplayProvider({"a": 1, "b": [2]})
    turn = replay.complete(
        [],
        system="",
        tools=[],
        tool_choice="none",
        output_schema=None,
        effort="low",
        max_output_tokens=1,
        timeout_s=1,
        purpose="labeling",
    )
    assert turn.assistant.text == json.dumps({"a": 1, "b": [2]})
    assert turn.usage.purpose == "labeling"
    assert replay.name == "anthropic"


def test_none_provider_has_no_capabilities_and_never_completes() -> None:
    provider = NoneProvider()
    assert provider.name == "none"
    caps = provider.capabilities
    assert not (
        caps.supports_vision or caps.supports_tools or caps.supports_json_schema or caps.supports_effort
    )
    assert (caps.max_image_px, caps.max_images_per_request) == (0, 0)
    with pytest.raises(NotImplementedError):
        provider.complete(
            [],
            system="",
            tools=[],
            tool_choice="none",
            output_schema=None,
            effort="low",
            max_output_tokens=1,
            timeout_s=1,
            purpose="labeling",
        )
