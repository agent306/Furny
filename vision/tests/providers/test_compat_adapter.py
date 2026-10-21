"""OpenAI-compatible adapter (18 §7.3, §17.1 compat rows), through the real SDK over a mock transport."""

from typing import Any

import httpx2
import pytest
from pydantic import SecretStr

from app.providers import registry
from app.providers.base import ImagePart, TextPart, ToolResult, ToolResultsMessage, UserMessage
from app.providers.errors import ProviderAuthError, ProviderUnavailable
from app.providers.openai_compatible_provider import OpenAICompatibleProvider
from app.providers.openai_provider import OpenAIProvider, to_openai_messages
from tests.providers.openai_support import (
    PNG,
    PNG_URL,
    SCHEMA,
    SPEC,
    TOOL,
    Harness,
    base_settings,
    complete,
    completion,
    error_body,
)

MODEL = "qwen-vl-local"
BASE_URL = "http://llm.local:11434/v1"
OMITTED = {"type": "text", "text": "[image omitted]"}


def provider_for(h: Harness, **settings: Any) -> OpenAICompatibleProvider:
    s = base_settings(openai_compat_base_url=BASE_URL, openai_compat_model=MODEL, **settings)
    return OpenAICompatibleProvider(s, MODEL, http_client=h.client(), max_retries=0)


def test_compat_is_a_subclass() -> None:
    assert issubclass(OpenAICompatibleProvider, OpenAIProvider)
    assert OpenAICompatibleProvider.name == "openai_compatible"


def test_compat_shape_flags_off() -> None:
    h = Harness([completion()])
    provider = provider_for(h)
    conversation = [UserMessage([TextPart("look"), ImagePart(PNG, "image/png")])]

    complete(provider, conversation, tools=[TOOL], output_schema=SPEC, max_output_tokens=32000)
    request, body = h.requests[0]

    assert str(request.url) == f"{BASE_URL}/chat/completions"
    assert request.headers["authorization"] == "Bearer not-needed"
    assert body["model"] == MODEL
    assert body["max_tokens"] == 8192
    for key in ("max_completion_tokens", "tools", "tool_choice", "response_format", "reasoning_effort"):
        assert key not in body
    assert body["messages"] == [
        {"role": "system", "content": "SYS"},
        {
            "role": "user",
            "content": [
                {"type": "image_url", "image_url": {"url": PNG_URL}},
                {"type": "text", "text": "look"},
            ],
        },
    ]


def test_compat_key_and_url_come_from_settings() -> None:
    h = Harness([completion()])
    s = base_settings(
        openai_compat_base_url="http://vllm:8000/v1",
        openai_compat_api_key=SecretStr("local-key"),
        openai_compat_model=MODEL,
        openai_api_key=SecretStr("sk-the-openai-key"),
        openai_base_url="https://gateway.example/v1",
    )

    complete(OpenAICompatibleProvider(s, MODEL, http_client=h.client(), max_retries=0))

    request = h.requests[0][0]
    assert str(request.url) == "http://vllm:8000/v1/chat/completions"
    assert request.headers["authorization"] == "Bearer local-key"


def test_compat_flags_on() -> None:
    h = Harness([completion()])
    provider = provider_for(
        h,
        openai_compat_supports_json_schema=True,
        openai_compat_supports_tools=True,
        openai_compat_send_reasoning_effort=True,
        openai_compat_max_output_tokens=2048,
    )

    complete(provider, tools=[TOOL], output_schema=SPEC)
    body = h.bodies[0]

    assert body["response_format"] == {
        "type": "json_schema",
        "json_schema": {"name": "floor_plan_labels", "schema": SCHEMA, "strict": True},
    }
    assert body["tools"][0]["function"]["name"] == "crop_image"
    assert body["tool_choice"] == "auto"
    assert body["reasoning_effort"] == "high"
    assert body["max_tokens"] == 2048


def test_compat_json_schema_only() -> None:
    h = Harness([completion()])

    complete(provider_for(h, openai_compat_supports_json_schema=True), tools=[TOOL], output_schema=SPEC)

    assert "response_format" in h.bodies[0]
    assert "tools" not in h.bodies[0]
    assert "tool_choice" not in h.bodies[0]


def test_compat_timeout_comes_from_settings() -> None:
    h = Harness([completion()])
    provider = provider_for(h, openai_compat_timeout_s=123)

    complete(provider, timeout_s=30)

    assert h.requests[0][0].extensions["timeout"]["read"] == 123


def test_compat_max_images() -> None:
    img = {"type": "image_url", "image_url": {"url": PNG_URL}}
    h = Harness([completion()])
    conversation = [
        UserMessage([TextPart("overview"), ImagePart(PNG, "image/png")]),
        ToolResultsMessage([ToolResult("c1", [ImagePart(PNG, "image/png")])]),
        ToolResultsMessage([ToolResult("c2", [ImagePart(PNG, "image/png")])]),
    ]

    complete(provider_for(h, openai_compat_max_images_per_request=1), conversation)
    messages = h.bodies[0]["messages"]

    assert messages[1]["content"] == [OMITTED, {"type": "text", "text": "overview"}]
    assert messages[2]["content"] == ""
    assert messages[3]["content"] == [{"type": "text", "text": "Images returned by tool call c1:"}, OMITTED]
    assert messages[4]["content"] == ""
    assert messages[5]["content"] == [{"type": "text", "text": "Images returned by tool call c2:"}, img]


def test_to_openai_messages_max_images_keeps_the_newest() -> None:
    conversation = [UserMessage([ImagePart(PNG, "image/png") for _ in range(3)])]

    kept = to_openai_messages(conversation, image_detail=False, max_images=2)[0]["content"]
    assert [p["type"] for p in kept] == ["text", "image_url", "image_url"]
    assert kept[0] == OMITTED

    assert to_openai_messages(conversation, image_detail=False, max_images=0)[0]["content"] == [OMITTED] * 3
    assert to_openai_messages(conversation, image_detail=False, max_images=3)[0]["content"][0]["type"] == (
        "image_url"
    )


def test_compat_usage_missing() -> None:
    h = Harness([completion(no_usage=True, model=None)])

    turn = complete(provider_for(h))

    u = turn.usage
    assert (u.input_tokens, u.output_tokens) == (0, 0)
    assert (u.cache_read_input_tokens, u.cache_creation_input_tokens) == (0, 0)
    assert u.model == MODEL
    assert u.status == "succeeded"


def test_compat_usage_model_is_the_configured_one() -> None:
    h = Harness([completion(model="/models/some-file.gguf")])

    assert complete(provider_for(h)).usage.model == MODEL


def test_compat_effort_rejection_is_remembered() -> None:
    h = Harness([(400, error_body("unknown field reasoning_effort")), completion(), completion()])
    provider = provider_for(h, openai_compat_send_reasoning_effort=True)

    complete(provider)
    complete(provider)

    assert ["reasoning_effort" in b for b in h.bodies] == [True, False, False]


def test_compat_errors_are_recorded_under_its_own_name() -> None:
    h = Harness([httpx2.ConnectError("down"), (401, error_body("nope"))])
    provider = provider_for(h)

    with pytest.raises(ProviderUnavailable):
        complete(provider)
    last = registry.last_error("openai_compatible")
    assert last is not None
    assert last.code == "provider_unreachable"
    assert registry.last_error("openai") is None

    with pytest.raises(ProviderAuthError):
        complete(provider)
    last = registry.last_error("openai_compatible")
    assert last is not None
    assert last.code == "provider_auth_failed"


def test_compat_registry_contract() -> None:
    s = base_settings(
        openai_compat_base_url=BASE_URL,
        openai_compat_model=MODEL,
        openai_compat_supports_tools=True,
        openai_compat_supports_vision=False,
    )

    provider = registry.get_provider("openai_compatible", None, s)

    assert isinstance(provider, OpenAICompatibleProvider)
    assert (provider.name, provider.model) == ("openai_compatible", MODEL)
    caps = provider.capabilities
    assert (caps.supports_vision, caps.supports_tools, caps.supports_json_schema) == (False, True, False)
    assert (caps.max_image_px, caps.max_images_per_request) == (1280, 1)
