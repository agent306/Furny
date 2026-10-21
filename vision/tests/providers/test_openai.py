"""OpenAI adapter (18 §7.2, §7.5, §17.1 openai rows), through the real SDK over a mock transport."""

import json
from typing import Any

import httpx2
import pytest
from pydantic import SecretStr

from app.providers import registry
from app.providers.base import (
    AssistantMessage,
    ImagePart,
    TextPart,
    ToolResult,
    ToolResultsMessage,
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
)
from app.providers.openai_provider import OpenAIProvider, to_openai_messages
from tests.providers.openai_support import (
    PNG,
    PNG_URL,
    SCHEMA,
    SPEC,
    TOOL,
    Harness,
    Item,
    base_settings,
    complete,
    completion,
    error_body,
    tool_call,
)

MODEL = "model-from-env"


def provider_for(h: Harness, max_retries: int = 0, **settings: Any) -> OpenAIProvider:
    s = base_settings(openai_api_key=SecretStr("sk-test-key"), openai_model=MODEL, **settings)
    return OpenAIProvider(s, MODEL, http_client=h.client(), max_retries=max_retries)


def test_openai_request_shape() -> None:
    h = Harness([completion(), completion(), completion()])
    provider = provider_for(h)
    conversation = [UserMessage([TextPart("look"), ImagePart(PNG, "image/png")])]

    complete(provider, conversation, tools=[TOOL], output_schema=SPEC)
    request, body = h.requests[0]

    assert request.url.path.endswith("/chat/completions")
    assert request.headers["authorization"] == "Bearer sk-test-key"
    assert body["model"] == MODEL
    assert body["max_completion_tokens"] == 32000
    assert "max_tokens" not in body
    assert "stream" not in body
    assert body["reasoning_effort"] == "high"
    assert body["response_format"] == {
        "type": "json_schema",
        "json_schema": {"name": "floor_plan_labels", "schema": SCHEMA, "strict": True},
    }
    assert body["tools"] == [
        {
            "type": "function",
            "function": {
                "name": "crop_image",
                "description": "Crop.",
                "parameters": TOOL.input_schema,
                "strict": True,
            },
        }
    ]
    assert body["tool_choice"] == "auto"
    assert body["messages"][0] == {"role": "system", "content": "SYS"}
    assert body["messages"][1] == {
        "role": "user",
        "content": [
            {"type": "image_url", "image_url": {"url": PNG_URL, "detail": "high"}},
            {"type": "text", "text": "look"},
        ],
    }
    assert len(body["messages"]) == 2

    complete(provider, conversation, tools=[TOOL], tool_choice="none")
    assert h.bodies[1]["tool_choice"] == "none"

    complete(provider, conversation)  # no tools, no schema: neither key is sent
    for key in ("tools", "tool_choice", "response_format"):
        assert key not in h.bodies[2]


def test_openai_caps_output_tokens_at_the_setting() -> None:
    h = Harness([completion()])

    complete(provider_for(h, openai_max_output_tokens=4000), max_output_tokens=32000)

    assert h.bodies[0]["max_completion_tokens"] == 4000


def test_openai_effort_flag_off() -> None:
    h = Harness([completion()])

    complete(provider_for(h, openai_send_reasoning_effort=False))

    assert "reasoning_effort" not in h.bodies[0]


def test_openai_reasoning_effort_dropped() -> None:
    rejected = (400, error_body("Unsupported parameter: 'reasoning_effort' is not supported", "unsupported"))
    h = Harness([rejected, completion(), completion()])
    provider = provider_for(h)

    first = complete(provider)
    second = complete(provider)

    assert first.assistant.text == "ok"
    assert second.assistant.text == "ok"
    assert [("reasoning_effort" in b) for b in h.bodies] == [True, False, False]
    assert provider.send_effort is False


def test_openai_other_bad_request_is_not_retried() -> None:
    h = Harness([(400, error_body("messages: bad"))])

    with pytest.raises(ProviderBadRequest) as info:
        complete(provider_for(h))

    assert info.value.code == "provider_bad_request"
    assert len(h.requests) == 1
    assert registry.last_error("openai") is None


def test_openai_reasoning_effort_rejected_twice_is_an_error() -> None:
    rejected = (400, error_body("reasoning_effort is not supported"))
    h = Harness([rejected, rejected])

    with pytest.raises(ProviderBadRequest):
        complete(provider_for(h))

    assert len(h.requests) == 2


def test_openai_history_append_only_and_tool_images_resent() -> None:
    native = {
        "role": "assistant",
        "content": "cropping",
        "tool_calls": [
            tool_call("call_1", "crop_image", '{"x": 1,   "y": [2, 3]}'),
            tool_call("call_2", "crop_image", '{"x": 4}'),
        ],
    }
    h = Harness([completion(native, "tool_calls"), completion()])
    provider = provider_for(h)
    first = [UserMessage([TextPart("go")])]

    turn1 = complete(provider, first, tools=[TOOL])
    assert turn1.stop_reason == "tool_use"
    assert turn1.assistant.native == native  # byte-identical: the raw argument string is kept

    conversation = [
        *first,
        turn1.assistant,
        ToolResultsMessage(
            [
                ToolResult("call_1", [ImagePart(PNG, "image/png"), TextPart("crop 1")]),
                ToolResult("call_2", [TextPart("bad box")], is_error=True),
            ]
        ),
    ]
    complete(provider, conversation, tools=[TOOL])
    messages = h.bodies[1]["messages"]

    assert messages[2] == native
    assert messages[3:] == [
        {"role": "tool", "tool_call_id": "call_1", "content": "crop 1"},
        {"role": "tool", "tool_call_id": "call_2", "content": "ERROR: bad box"},
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "Images returned by tool call call_1:"},
                {"type": "image_url", "image_url": {"url": PNG_URL, "detail": "high"}},
            ],
        },
    ]


def test_to_openai_messages_resends_images_per_result_in_call_order() -> None:
    out = to_openai_messages(
        [
            ToolResultsMessage(
                [
                    ToolResult("a", [ImagePart(PNG, "image/png")]),
                    ToolResult("b", [TextPart("plain")]),
                    ToolResult("c", [TextPart("x"), ImagePart(PNG, "image/jpeg")]),
                ]
            )
        ],
        image_detail=False,
        max_images=10,
    )

    assert [m["role"] for m in out] == ["tool", "tool", "tool", "user", "user"]
    assert out[0] == {"role": "tool", "tool_call_id": "a", "content": ""}
    assert out[3]["content"][0]["text"] == "Images returned by tool call a:"
    assert out[4]["content"][0]["text"] == "Images returned by tool call c:"
    assert out[4]["content"][1] == {
        "type": "image_url",
        "image_url": {"url": "data:image/jpeg;base64,iVBORy1ieXRlcw=="},
    }


def test_openai_refusal_and_length() -> None:
    refusal = {"role": "assistant", "content": None, "refusal": "I cannot help with that."}
    h = Harness(
        [
            completion(refusal),
            completion({"role": "assistant", "content": "{"}, "length"),
            completion({"role": "assistant", "content": "x"}, "content_filter"),
        ]
    )
    provider = provider_for(h)

    with pytest.raises(ProviderRefusal) as info:
        complete(provider)
    assert info.value.code == "llm_refused"
    assert info.value.category is None
    (usage,) = info.value.usage
    assert (usage.status, usage.stop_reason) == ("failed", "stop")
    assert (usage.input_tokens, usage.output_tokens) == (11, 7)

    with pytest.raises(ProviderInvalidOutput) as length:
        complete(provider)
    assert length.value.code == "llm_invalid_output"
    assert length.value.usage[0].status == "failed"
    assert length.value.usage[0].stop_reason == "length"

    with pytest.raises(ProviderRefusal) as filtered:
        complete(provider)
    assert filtered.value.category == "content_filter"


def test_openai_invalid_tool_argument_json() -> None:
    message = {
        "role": "assistant",
        "content": None,
        "tool_calls": [
            tool_call("c1", "crop_image", '{"box": [1, 2'),
            tool_call("c2", "crop_image", "[1, 2]"),
            tool_call("c3", "crop_image", '{"box": [1, 2, 3, 4]}'),
            tool_call("c4", "crop_image", ""),
        ],
    }
    h = Harness([completion(message, "tool_calls")])

    turn = complete(provider_for(h), tools=[TOOL])

    assert turn.stop_reason == "tool_use"
    assert turn.assistant.text is None
    args = {c.id: c.arguments for c in turn.assistant.tool_calls}
    assert args == {
        "c1": {"__invalid_json__": '{"box": [1, 2'},
        "c2": {"__invalid_json__": "[1, 2]"},
        "c3": {"box": [1, 2, 3, 4]},
        "c4": {},
    }
    assert [c.name for c in turn.assistant.tool_calls] == ["crop_image"] * 4


def test_openai_tool_calls_with_finish_reason_stop_still_count_as_tool_use() -> None:
    message = {"role": "assistant", "content": "", "tool_calls": [tool_call("c1", "crop_image", "{}")]}
    h = Harness([completion(message, "stop")])

    turn = complete(provider_for(h), tools=[TOOL])

    assert turn.stop_reason == "tool_use"
    assert turn.assistant.tool_calls[0].id == "c1"


def test_openai_usage() -> None:
    usage = {
        "prompt_tokens": 100,
        "completion_tokens": 40,
        "total_tokens": 140,
        "prompt_tokens_details": {"cached_tokens": 60},
        "completion_tokens_details": {"reasoning_tokens": 25},
    }
    h = Harness([completion(usage=usage), completion(), completion({"role": "assistant"}, "function_call")])
    provider = provider_for(h)
    conversation = [
        UserMessage([ImagePart(PNG, "image/png")]),
        AssistantMessage(native={"role": "assistant", "content": "earlier"}, text="earlier", tool_calls=[]),
        ToolResultsMessage([ToolResult("t", [ImagePart(PNG, "image/png"), ImagePart(PNG, "image/png")])]),
    ]

    turn = complete(provider, conversation)

    u = turn.usage
    assert (u.purpose, u.model, u.status, u.stop_reason) == ("agent_turn", "gpt-served", "succeeded", "stop")
    assert (u.input_tokens, u.output_tokens) == (100, 40)
    assert (u.cache_read_input_tokens, u.cache_creation_input_tokens) == (60, 0)
    assert u.images == 2  # only the newest message counts
    assert turn.stop_reason == "end_turn"
    assert turn.assistant.text == "ok"

    second = complete(provider)
    assert (second.usage.cache_read_input_tokens, second.usage.images) == (0, 0)
    assert complete(provider).stop_reason == "other"


def test_openai_missing_model_in_response_falls_back_to_configured() -> None:
    h = Harness([completion(model=None, no_usage=True)])

    turn = complete(provider_for(h))

    assert turn.usage.model == MODEL
    assert (turn.usage.input_tokens, turn.usage.output_tokens) == (0, 0)


def test_openai_empty_choices_is_invalid_output() -> None:
    body = completion()
    body["choices"] = []
    h = Harness([body])

    with pytest.raises(ProviderInvalidOutput):
        complete(provider_for(h))


@pytest.mark.parametrize(
    ("item", "exc_type", "code", "recorded"),
    [
        ((401, error_body("Incorrect API key provided")), ProviderAuthError, "provider_auth_failed", True),
        ((403, error_body("forbidden")), ProviderAuthError, "provider_auth_failed", True),
        ((404, error_body("model not found")), ProviderBadRequest, "model_not_found", True),
        ((400, error_body("bad")), ProviderBadRequest, "provider_bad_request", False),
        ((422, error_body("bad")), ProviderBadRequest, "provider_bad_request", False),
        ((429, error_body("slow down")), ProviderUnavailable, "provider_rate_limited", False),
        ((500, error_body("oops")), ProviderUnavailable, "provider_overloaded", False),
        ((503, error_body("busy")), ProviderUnavailable, "provider_overloaded", False),
        (httpx2.ReadTimeout("slow"), ProviderTimeout, "llm_timeout", False),
        (httpx2.ConnectError("down"), ProviderUnavailable, "provider_unreachable", True),
    ],
)
def test_openai_error_mapping(item: Item, exc_type: type[ProviderError], code: str, recorded: bool) -> None:
    h = Harness([item])

    with pytest.raises(exc_type) as info:
        complete(provider_for(h))

    assert info.value.code == code
    assert info.value.retryable is (exc_type in (ProviderUnavailable, ProviderTimeout))
    last = registry.last_error("openai")
    assert (last.code if last else None) == (code if recorded else None)


def test_openai_sdk_retries_are_used() -> None:
    h = Harness([(500, error_body("oops")), completion()])

    turn = complete(provider_for(h, max_retries=1))

    assert turn.assistant.text == "ok"
    assert len(h.requests) == 2


def test_openai_model_is_never_hard_coded() -> None:
    h = Harness([completion()])
    s = base_settings(openai_api_key=SecretStr("k"), openai_model="whatever-the-admin-set")

    OpenAIProvider(s, "explicit-model", http_client=h.client(), max_retries=0).complete(
        [UserMessage([TextPart("hi")])],
        system="S",
        tools=[],
        tool_choice="auto",
        output_schema=None,
        effort="low",
        max_output_tokens=10,
        timeout_s=5,
        purpose="agent_turn",
    )

    body = json.loads(h.requests[0][0].content)
    assert body["model"] == "explicit-model"
    assert body["reasoning_effort"] == "low"


def test_openai_registry_contract() -> None:
    s = base_settings(openai_api_key=SecretStr("sk-test-key"), openai_model=MODEL)

    provider = registry.get_provider("openai", None, s)

    assert isinstance(provider, OpenAIProvider)
    assert (provider.name, provider.model) == ("openai", MODEL)
    caps = provider.capabilities
    assert (caps.supports_vision, caps.supports_tools, caps.supports_json_schema) == (True, True, True)
    assert (caps.max_image_px, caps.max_images_per_request) == (2048, 10)
