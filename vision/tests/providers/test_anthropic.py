"""Anthropic adapter (18 §7.1, §7.5, §17.1 anthropic rows), through the real SDK over a mock transport."""

import json
from typing import Any

import anthropic
import httpx2
import pytest
from pydantic import SecretStr

from app.config import Settings
from app.providers import registry
from app.providers.anthropic_provider import AnthropicProvider, to_anthropic_messages
from app.providers.base import (
    AssistantMessage,
    ImagePart,
    JsonSchemaSpec,
    TextPart,
    ToolResult,
    ToolResultsMessage,
    ToolSpec,
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
from tests.providers.sse import anthropic_sse

SCHEMA = {
    "type": "object",
    "properties": {"a": {"type": "string"}},
    "required": ["a"],
    "additionalProperties": False,
}
TOOL = ToolSpec("crop_image", "Crop.", {"type": "object", "properties": {}, "additionalProperties": False})
PNG = b"\x89PNG-bytes"
FALLBACK_BETA = "server-side-fallback-2026-07-01"

Item = dict[str, Any] | tuple[int, dict[str, Any]] | Exception


def message(
    content: list[dict[str, Any]],
    stop_reason: str = "end_turn",
    *,
    model: str = "claude-opus-5-5",
    usage: dict[str, Any] | None = None,
    **extra: Any,
) -> dict[str, Any]:
    return {
        "id": "msg_1",
        "type": "message",
        "role": "assistant",
        "model": model,
        "content": content,
        "stop_reason": stop_reason,
        "usage": usage or {"input_tokens": 11, "output_tokens": 7},
        **extra,
    }


def text(value: str) -> dict[str, Any]:
    return {"type": "text", "text": value}


def error_body(kind: str, msg: str = "boom") -> dict[str, Any]:
    return {"type": "error", "error": {"type": kind, "message": msg}}


class Harness:
    def __init__(self, items: list[Item], **settings: Any) -> None:
        self.items = list(items)
        self.requests: list[tuple[httpx2.Headers, dict[str, Any]]] = []
        self.settings = Settings(
            vision_service_token="t" * 32, anthropic_api_key=SecretStr("sk-ant-test-key"), **settings
        )

    def handler(self, request: httpx2.Request) -> httpx2.Response:
        self.requests.append((request.headers, json.loads(request.content)))
        item = self.items.pop(0)
        if isinstance(item, Exception):
            raise item
        if isinstance(item, tuple):
            return httpx2.Response(item[0], json=item[1])
        return httpx2.Response(
            200, headers={"content-type": "text/event-stream"}, content=anthropic_sse(item)
        )

    def provider(self, max_retries: int = 0) -> AnthropicProvider:
        client = anthropic.DefaultHttpxClient(transport=httpx2.MockTransport(self.handler))
        return AnthropicProvider(
            self.settings, "claude-opus-5-5", http_client=client, max_retries=max_retries
        )


def complete(
    provider: AnthropicProvider,
    conversation: list[Any] | None = None,
    *,
    tools: list[ToolSpec] | None = None,
    tool_choice: Any = "auto",
    output_schema: JsonSchemaSpec | None = None,
) -> Any:
    return provider.complete(
        conversation if conversation is not None else [UserMessage([TextPart("hi")])],
        system="SYS",
        tools=tools or [],
        tool_choice=tool_choice,
        output_schema=output_schema,
        effort="high",
        max_output_tokens=32000,
        timeout_s=30,
        purpose="agent_turn",
    )


def test_anthropic_request_shape() -> None:
    h = Harness([message([text("ok")]), message([text("ok")]), message([text("ok")])])
    provider = h.provider()
    conversation = [UserMessage([TextPart("look"), ImagePart(PNG, "image/png")])]

    complete(
        provider,
        conversation,
        tools=[TOOL],
        output_schema=JsonSchemaSpec("labels", SCHEMA),
    )
    headers, body = h.requests[0]

    assert body["model"] == "claude-opus-5-5"
    assert body["max_tokens"] == 32000
    assert body["stream"] is True
    assert body["thinking"] == {"type": "adaptive"}
    assert body["output_config"] == {"effort": "high", "format": {"type": "json_schema", "schema": SCHEMA}}
    assert body["cache_control"] == {"type": "ephemeral"}
    assert body["system"] == [{"type": "text", "text": "SYS"}]
    assert body["tools"] == [
        {
            "name": "crop_image",
            "description": "Crop.",
            "input_schema": TOOL.input_schema,
            "strict": True,
            "eager_input_streaming": True,
        }
    ]
    assert body["tool_choice"] == {"type": "auto"}
    assert body["messages"][-1]["role"] == "user"
    first = body["messages"][0]["content"]
    assert [b["type"] for b in first] == ["image", "text"]
    assert first[0]["source"]["type"] == "base64"
    assert first[0]["source"]["media_type"] == "image/png"
    assert "budget_tokens" not in json.dumps(body)
    assert "prefill" not in json.dumps(body)
    assert body["fallbacks"] == "default"
    assert FALLBACK_BETA in headers["anthropic-beta"]

    complete(provider, conversation, tools=[TOOL], tool_choice="none")
    assert h.requests[1][1]["tool_choice"] == {"type": "none"}

    complete(provider, conversation)  # no tools: no tool_choice, no schema: effort only
    assert "tool_choice" not in h.requests[2][1]
    assert h.requests[2][1]["output_config"] == {"effort": "high"}


def test_anthropic_server_fallback_disabled_by_setting() -> None:
    h = Harness([message([text("ok")])], anthropic_server_fallback=False)

    complete(h.provider())

    headers, body = h.requests[0]
    assert "anthropic-beta" not in headers
    assert "fallbacks" not in body
    assert body["thinking"] == {"type": "adaptive"}


def test_anthropic_history_append_only() -> None:
    turn1_content = [
        {"type": "thinking", "thinking": "hmm", "signature": "sig1"},
        {"type": "text", "text": "cropping"},
        {"type": "tool_use", "id": "tu1", "name": "crop_image", "input": {"x": 1, "y": [2, 3]}},
        {"type": "tool_use", "id": "tu2", "name": "crop_image", "input": {"x": 4}},
    ]
    h = Harness([message(turn1_content, "tool_use"), message([text("done")])])
    provider = h.provider()
    first = [UserMessage([TextPart("go")])]

    turn1 = complete(provider, first, tools=[TOOL])
    assert turn1.stop_reason == "tool_use"
    assert turn1.assistant.native == turn1_content

    conversation = [
        *first,
        turn1.assistant,
        ToolResultsMessage(
            [
                ToolResult("tu1", [ImagePart(PNG, "image/png"), TextPart("crop 1")]),
                ToolResult("tu2", [TextPart("bad box")], is_error=True),
            ]
        ),
        UserMessage([TextPart("finalize")]),
    ]
    complete(provider, conversation, tools=[TOOL])
    messages = h.requests[1][1]["messages"]

    assert len(messages) == 3  # tool results and the finalize user message share one user message
    assert messages[1] == {"role": "assistant", "content": turn1_content}
    user = messages[2]
    assert user["role"] == "user"
    assert [b["type"] for b in user["content"]] == ["tool_result", "tool_result", "text"]
    r1, r2, tail = user["content"]
    assert (r1["tool_use_id"], r1["is_error"]) == ("tu1", False)
    assert [b["type"] for b in r1["content"]] == ["image", "text"]
    assert (r2["tool_use_id"], r2["is_error"]) == ("tu2", True)
    assert tail["text"] == "finalize"


def test_to_anthropic_messages_puts_tool_results_first() -> None:
    out = to_anthropic_messages(
        [
            UserMessage([TextPart("note")]),
            ToolResultsMessage([ToolResult("t", [TextPart("r")])]),
        ]
    )

    assert len(out) == 1
    assert [b["type"] for b in out[0]["content"]] == ["tool_result", "text"]


def test_anthropic_refusal() -> None:
    h = Harness(
        [
            message(
                [text("no")],
                "refusal",
                stop_details={"type": "refusal", "category": "cyber", "explanation": None},
            )
        ]
    )

    with pytest.raises(ProviderRefusal) as info:
        complete(h.provider())

    assert info.value.category == "cyber"
    assert info.value.code == "llm_refused"
    (usage,) = info.value.usage
    assert usage.status == "failed"
    assert usage.stop_reason == "refusal"
    assert (usage.input_tokens, usage.output_tokens) == (11, 7)


def test_anthropic_max_tokens() -> None:
    h = Harness([message([text("{")], "max_tokens")])

    with pytest.raises(ProviderInvalidOutput) as info:
        complete(h.provider())

    assert info.value.usage[0].status == "failed"
    assert info.value.usage[0].stop_reason == "max_tokens"


def test_anthropic_fallback_param_rejected() -> None:
    rejected = (400, error_body("invalid_request_error", "fallbacks: unsupported"))
    h = Harness([rejected, message([text("ok")]), message([text("ok2")])])
    provider = h.provider()

    first = complete(provider)
    second = complete(provider)

    assert first.assistant.text == "ok"
    assert second.assistant.text == "ok2"
    (h1, b1), (h2, b2), (h3, b3) = h.requests
    assert FALLBACK_BETA in h1["anthropic-beta"]
    assert b1["fallbacks"] == "default"
    for headers, body in ((h2, b2), (h3, b3)):
        assert "anthropic-beta" not in headers
        assert "fallbacks" not in body
    assert provider._fallback_disabled is True


def test_anthropic_other_bad_request_is_not_retried() -> None:
    h = Harness([(400, error_body("invalid_request_error", "messages: bad"))])

    with pytest.raises(ProviderBadRequest) as info:
        complete(h.provider())

    assert info.value.code == "provider_bad_request"
    assert len(h.requests) == 1


@pytest.mark.parametrize(
    ("item", "exc_type", "code", "recorded"),
    [
        (
            (401, error_body("authentication_error", "invalid x-api-key")),
            ProviderAuthError,
            "provider_auth_failed",
            True,
        ),
        ((403, error_body("permission_error")), ProviderAuthError, "provider_auth_failed", True),
        ((404, error_body("not_found_error", "model: nope")), ProviderBadRequest, "model_not_found", True),
        ((429, error_body("rate_limit_error")), ProviderUnavailable, "provider_rate_limited", False),
        ((500, error_body("api_error")), ProviderUnavailable, "provider_overloaded", False),
        ((529, error_body("overloaded_error")), ProviderUnavailable, "provider_overloaded", False),
        (httpx2.ReadTimeout("slow"), ProviderTimeout, "llm_timeout", False),
        (httpx2.ConnectError("down"), ProviderUnavailable, "provider_unreachable", True),
    ],
)
def test_anthropic_error_mapping(
    item: Item, exc_type: type[ProviderError], code: str, recorded: bool
) -> None:
    h = Harness([item])

    with pytest.raises(exc_type) as info:
        complete(h.provider(max_retries=0))

    assert info.value.code == code
    last = registry.last_error("anthropic")
    assert (last.code if last else None) == (code if recorded else None)


def test_anthropic_usage_and_parsing() -> None:
    content = [
        text("Hello "),
        {"type": "tool_use", "id": "tu9", "name": "crop_image", "input": {"box": [1, 2, 3, 4]}},
        text("world"),
    ]
    usage = {
        "input_tokens": 100,
        "output_tokens": 40,
        "cache_read_input_tokens": 60,
        "cache_creation_input_tokens": 5,
    }
    h = Harness(
        [
            message(content, "tool_use", usage=usage, model="claude-served"),
            message([text("a"), text("b")], "stop_sequence"),
            message([text("c")], "pause_turn"),
        ]
    )
    provider = h.provider()
    conversation = [
        UserMessage([ImagePart(PNG, "image/png")]),
        AssistantMessage(native=[text("earlier")], text="earlier", tool_calls=[]),
        ToolResultsMessage([ToolResult("t", [ImagePart(PNG, "image/png"), ImagePart(PNG, "image/png")])]),
    ]

    turn = complete(provider, conversation, tools=[TOOL])

    assert turn.assistant.text == "Hello world"
    (call,) = turn.assistant.tool_calls
    assert (call.id, call.name, call.arguments) == ("tu9", "crop_image", {"box": [1, 2, 3, 4]})
    assert turn.stop_reason == "tool_use"
    u = turn.usage
    assert (u.purpose, u.model, u.status, u.stop_reason) == (
        "agent_turn",
        "claude-served",
        "succeeded",
        "tool_use",
    )
    assert (u.input_tokens, u.output_tokens) == (100, 40)
    assert (u.cache_read_input_tokens, u.cache_creation_input_tokens) == (60, 5)
    assert u.images == 2  # only the newest message counts
    assert u.duration_ms >= 0

    second = complete(provider)
    assert second.stop_reason == "end_turn"
    assert second.assistant.text == "ab"
    assert second.usage.cache_read_input_tokens == 0
    assert second.usage.images == 0
    assert complete(provider).stop_reason == "other"


def test_anthropic_fallback_block() -> None:
    fallback = {
        "type": "fallback",
        "from": {"model": "claude-opus-5-5"},
        "to": {"model": "claude-opus-4-8"},
        "trigger": {"category": "cyber"},
    }
    content = [
        {"type": "thinking", "thinking": "first", "signature": "s1"},
        text("partial"),
        fallback,
        {"type": "thinking", "thinking": "second", "signature": "s2"},
        text("final"),
    ]
    usage = {
        "input_tokens": 1,
        "output_tokens": 1,
        "iterations": [
            {
                "type": "message",
                "input_tokens": 100,
                "output_tokens": 10,
                "cache_read_input_tokens": 0,
                "cache_creation_input_tokens": 0,
            },
            {
                "type": "fallback_message",
                "model": "claude-opus-4-8",
                "input_tokens": 200,
                "output_tokens": 30,
                "cache_read_input_tokens": 50,
                "cache_creation_input_tokens": 4,
            },
        ],
    }
    h = Harness([message(content, usage=usage), message([text("next")])])
    provider = h.provider()

    turn = complete(provider)

    # native is the full response, the fallback block in place (key `from`), never stripped
    assert turn.assistant.native == content
    assert turn.assistant.text == "final"
    assert turn.usage.model == "claude-opus-4-8"
    assert (turn.usage.input_tokens, turn.usage.output_tokens) == (300, 40)
    assert (turn.usage.cache_read_input_tokens, turn.usage.cache_creation_input_tokens) == (50, 4)

    complete(provider, [UserMessage([TextPart("hi")]), turn.assistant, UserMessage([TextPart("again")])])
    replayed = h.requests[1][1]["messages"][1]["content"]
    assert replayed == content


def test_anthropic_registry_contract() -> None:
    settings = Settings(vision_service_token="t" * 32, anthropic_api_key=SecretStr("sk-ant-test-key"))

    provider = registry.get_provider("anthropic", None, settings)

    assert isinstance(provider, AnthropicProvider)
    assert provider.name == "anthropic"
    assert provider.model == "claude-opus-5-5"
    assert provider.capabilities.supports_vision is True
