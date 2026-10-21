"""`POST /v1/providers/test` (18 §5.3): one single-pass call that checks key, model, vision and JSON output.

No concurrency slot: the spec defines none for this endpoint (recorded in the gap list).
"""

import functools
import io
import json
import re
import time
from dataclasses import replace
from typing import Any, cast

import anyio
import anyio.to_thread
from fastapi import APIRouter, Depends, Request
from PIL import Image, ImageDraw

from app.api.deps import require_token
from app.api.errors import VisionError
from app.config import Settings
from app.logging import RedactionFilter
from app.pipeline.labeling.prompts import JSON_SCHEMA_INSTRUCTION_TEMPLATE
from app.providers import registry
from app.providers.base import (
    ImagePart,
    JsonSchemaSpec,
    LLMProvider,
    Part,
    TextPart,
    UsageCall,
    UserMessage,
)
from app.providers.errors import ProviderError
from app.providers.usage import usage_call_out
from app.schemas.api import ProviderTestError, ProviderTestRequest, ProviderTestResponse
from app.utils.json_schema import parse_json_object

SYSTEM_PROMPT = "You are a connectivity check."
PROMPT_WITH_IMAGE = "Is the black square in the top-left quadrant? Answer with the JSON object."
PROMPT_WITHOUT_IMAGE = 'Reply with ok = true and quadrant = "top_left".'
QUADRANTS = ["top_left", "top_right", "bottom_left", "bottom_right"]
CHECK_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {"ok": {"type": "boolean"}, "quadrant": {"type": "string", "enum": QUADRANTS}},
    "required": ["ok", "quadrant"],
    "additionalProperties": False,
}
TEST_TIMEOUT_S = 60
# Room for adaptive thinking plus the tiny JSON answer.
TEST_MAX_OUTPUT_TOKENS = 2048
MIN_SECRET_LENGTH = 8
# Providers echo masked keys in 401 text (`sk-proj-****abcd`, `sk-ant-api03-AbCd…wXyZ`).
_MASKED_KEY = re.compile(r"\bsk-[\w*….-]{6,}")

router = APIRouter(dependencies=[Depends(require_token)])


@functools.cache
def _check_image() -> bytes:
    """64x64 PNG: white with a black filled square in the top-left quadrant."""
    image = Image.new("RGB", (64, 64), "white")
    ImageDraw.Draw(image).rectangle((8, 8, 23, 23), fill="black")
    out = io.BytesIO()
    image.save(out, format="PNG")
    return out.getvalue()


def _scrub(text: str, settings: Settings) -> str:
    """Strip secret values and presigned query strings from a provider's error text."""
    text = _MASKED_KEY.sub("[REDACTED]", RedactionFilter().redact(text))
    secrets = (
        settings.vision_service_token,
        settings.anthropic_api_key,
        settings.openai_api_key,
        settings.openai_compat_api_key,
    )
    for secret in secrets:
        value = secret.get_secret_value() if secret is not None else ""
        if len(value) >= MIN_SECRET_LENGTH:
            text = text.replace(value, "[REDACTED]")
    return text


def _usage(call: UsageCall) -> Any:
    return usage_call_out(replace(call, purpose="provider_test"))


def _failure(
    provider: LLMProvider,
    started: float,
    code: str,
    message: str,
    usage: UsageCall | None,
    settings: Settings,
) -> ProviderTestResponse:
    return ProviderTestResponse(
        ok=False,
        provider=provider.name,
        model=provider.model,
        latency_ms=round((time.perf_counter() - started) * 1000),
        vision_verified=False,
        json_schema_verified=False,
        usage=_usage(usage) if usage is not None else None,
        error=ProviderTestError(code=code, message=_scrub(message, settings)),
    )


@router.post("/v1/providers/test")
async def test_provider(body: ProviderTestRequest, request: Request) -> dict[str, Any]:
    settings = cast(Settings, request.app.state.settings)
    if body.provider == "none":
        return ProviderTestResponse(
            ok=True,
            provider="none",
            model=None,
            latency_ms=0,
            vision_verified=False,
            json_schema_verified=False,
            usage=None,
            error=None,
        ).wire()
    provider: LLMProvider | None = request.app.state.provider_factory(body.provider, body.model)
    if provider is None:
        raise VisionError("provider_not_configured", f"Provider '{body.provider}' is not configured")

    caps = provider.capabilities
    system = SYSTEM_PROMPT
    parts: list[Part] = []
    if caps.supports_vision:
        parts.append(ImagePart(_check_image(), "image/png"))
        parts.append(TextPart(PROMPT_WITH_IMAGE))
    else:
        parts.append(TextPart(PROMPT_WITHOUT_IMAGE))
    schema: JsonSchemaSpec | None = None
    if caps.supports_json_schema:
        schema = JsonSchemaSpec("connectivity_check", CHECK_SCHEMA)
    else:
        system += "\n\n" + JSON_SCHEMA_INSTRUCTION_TEMPLATE.format(schema_json=json.dumps(CHECK_SCHEMA))

    started = time.perf_counter()
    try:
        # abandon_on_cancel: a hung adapter must not pin the request; its thread is left to the SDK timeout.
        with anyio.fail_after(TEST_TIMEOUT_S):
            turn = await anyio.to_thread.run_sync(
                functools.partial(
                    provider.complete,
                    [UserMessage(parts)],
                    system=system,
                    tools=[],
                    tool_choice="none",
                    output_schema=schema,
                    effort="low",
                    max_output_tokens=TEST_MAX_OUTPUT_TOKENS,
                    timeout_s=TEST_TIMEOUT_S,
                    purpose="provider_test",
                ),
                abandon_on_cancel=True,
            )
    except TimeoutError:
        return _failure(
            provider, started, "llm_timeout", "The provider did not answer in time.", None, settings
        ).wire()
    except ProviderError as err:
        registry.record_provider_error(provider.name, err.code)
        usage = err.usage[-1] if err.usage else None
        return _failure(provider, started, err.code, err.message or err.code, usage, settings).wire()

    if turn.stop_reason == "refusal":
        return _failure(
            provider, started, "llm_refused", "The model refused the request.", turn.usage, settings
        ).wire()
    if turn.stop_reason == "max_tokens":
        return _failure(
            provider, started, "llm_invalid_output", "The answer was cut off.", turn.usage, settings
        ).wire()
    try:
        answer = parse_json_object(turn.assistant.text or "")
    except ValueError as exc:
        return _failure(provider, started, "llm_invalid_output", str(exc), turn.usage, settings).wire()
    if not isinstance(answer.get("ok"), bool) or answer.get("quadrant") not in QUADRANTS:
        return _failure(
            provider,
            started,
            "llm_invalid_output",
            "The answer does not match the schema.",
            turn.usage,
            settings,
        ).wire()

    return ProviderTestResponse(
        ok=True,
        provider=provider.name,
        model=provider.model,
        latency_ms=round((time.perf_counter() - started) * 1000),
        vision_verified=caps.supports_vision and answer["ok"] is True and answer["quadrant"] == "top_left",
        json_schema_verified=caps.supports_json_schema,
        usage=_usage(turn.usage),
        error=None,
    ).wire()
