"""Anthropic adapter (18 §7.1): adaptive thinking, strict tools, structured output, server-side fallback.

Gap list: mid-stream fallback handling (the `fallback` block, `usage.iterations`) goes beyond the
18 §7.1 text. `native` stays the full response content (fallback block in place); only `text`,
`tool_calls` and usage look at the blocks after the last fallback block and at the per-iteration usage.
"""

import base64
import logging
import time
from typing import Any, Literal, cast

import anthropic

from app.config import Settings
from app.providers import registry
from app.providers.base import (
    AssistantMessage,
    Effort,
    ImagePart,
    JsonSchemaSpec,
    LLMProvider,
    Message,
    Part,
    ToolCall,
    ToolSpec,
    TurnResult,
    UsageCall,
    UsagePurpose,
    UserMessage,
    new_images,
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

log = logging.getLogger("furny.vision")

FALLBACK_BETA = "server-side-fallback-2026-07-01"
CONNECT_TIMEOUT_S = 10.0
_STOP_REASONS: dict[str, Literal["end_turn", "tool_use"]] = {
    "end_turn": "end_turn",
    "stop_sequence": "end_turn",
    "tool_use": "tool_use",
}


def _blocks(parts: list[Part]) -> list[dict[str, Any]]:
    """Image blocks first, then text blocks."""
    images = [
        {
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": p.media_type,
                "data": base64.standard_b64encode(p.data).decode(),
            },
        }
        for p in parts
        if isinstance(p, ImagePart)
    ]
    texts = [{"type": "text", "text": p.text} for p in parts if not isinstance(p, ImagePart)]
    return images + texts


def to_anthropic_messages(conversation: list[Message]) -> list[dict[str, Any]]:
    """Neutral conversation -> Messages API `messages`. Consecutive user-role entries merge into one user
    message (tool_result blocks first); assistant content is replayed unchanged (append-only history)."""
    out: list[dict[str, Any]] = []
    for item in conversation:
        if isinstance(item, AssistantMessage):
            out.append({"role": "assistant", "content": item.native})
            continue
        if isinstance(item, UserMessage):
            blocks = _blocks(item.parts)
        else:
            blocks = [
                {
                    "type": "tool_result",
                    "tool_use_id": r.call_id,
                    "is_error": r.is_error,
                    "content": _blocks(r.content),
                }
                for r in item.results
            ]
        if out and out[-1]["role"] == "user":
            out[-1]["content"] = out[-1]["content"] + blocks
            out[-1]["content"].sort(key=lambda b: b["type"] != "tool_result")
        else:
            out.append({"role": "user", "content": blocks})
    return out


def _map_error(exc: anthropic.APIError) -> ProviderError:
    """SDK exception -> neutral error (18 §7.1 table)."""
    message = getattr(exc, "message", None) or str(exc)
    if isinstance(exc, anthropic.APITimeoutError):
        return ProviderTimeout(message)
    if isinstance(exc, anthropic.APIConnectionError):
        return ProviderUnavailable(message, code="provider_unreachable")
    if isinstance(exc, anthropic.AuthenticationError | anthropic.PermissionDeniedError):
        return ProviderAuthError(message)
    if isinstance(exc, anthropic.NotFoundError):
        return ProviderBadRequest(message, code="model_not_found")
    if isinstance(exc, anthropic.RateLimitError):
        return ProviderUnavailable(message, code="provider_rate_limited")
    if isinstance(exc, anthropic.APIStatusError):
        # status < 400: an `error` event inside a 200 stream (e.g. overloaded_error)
        if exc.status_code >= 500 or exc.status_code < 400:
            return ProviderUnavailable(message, code="provider_overloaded")
        return ProviderBadRequest(message)
    return ProviderUnavailable(message, code="provider_unreachable")


class AnthropicProvider(LLMProvider):
    name = "anthropic"

    def __init__(
        self,
        settings: Settings,
        model: str,
        *,
        http_client: Any | None = None,
        max_retries: int = 2,
    ) -> None:
        key = settings.anthropic_api_key
        self.settings = settings
        self.model = model
        self.capabilities = registry.capabilities_for("anthropic", settings)
        self._fallback_disabled = False
        self._client = anthropic.Anthropic(
            api_key=key.get_secret_value() if key is not None else None,
            base_url=settings.anthropic_base_url or None,
            max_retries=max_retries,
            timeout=anthropic.Timeout(settings.vision_llm_call_timeout_s, connect=CONNECT_TIMEOUT_S),
            http_client=http_client,
        )

    def complete(
        self,
        conversation: list[Message],
        *,
        system: str,
        tools: list[ToolSpec],
        tool_choice: Literal["auto", "none"],
        output_schema: JsonSchemaSpec | None,
        effort: Effort,
        max_output_tokens: int,
        timeout_s: float,
        purpose: str,
    ) -> TurnResult:
        output_config: dict[str, Any] = {"effort": effort}
        if output_schema is not None:
            output_config["format"] = {"type": "json_schema", "schema": output_schema.schema}
        params: dict[str, Any] = {
            "model": self.model,
            "max_tokens": max_output_tokens,
            "system": [{"type": "text", "text": system}],
            "messages": to_anthropic_messages(conversation),
            "thinking": {"type": "adaptive"},
            "output_config": output_config,
            "cache_control": {"type": "ephemeral"},
        }
        if tools:
            params["tools"] = [
                {
                    "name": t.name,
                    "description": t.description,
                    "input_schema": t.input_schema,
                    "strict": True,
                    "eager_input_streaming": True,
                }
                for t in tools
            ]
            params["tool_choice"] = {"type": tool_choice}
        timeout = anthropic.Timeout(timeout_s, connect=CONNECT_TIMEOUT_S)
        started = time.perf_counter()
        try:
            msg = self._request(params, timeout)
            return self._parse(msg, purpose, new_images(conversation), started)
        except ProviderError as err:
            registry.record_provider_error(self.name, err.code)
            raise

    def _use_fallback(self) -> bool:
        return self.settings.anthropic_server_fallback and not self._fallback_disabled

    def _stream(self, params: dict[str, Any], timeout: Any) -> Any:
        manager: Any
        if self._use_fallback():
            manager = self._client.beta.messages.stream(
                **params, betas=[FALLBACK_BETA], fallbacks="default", timeout=timeout
            )
        else:
            manager = self._client.messages.stream(**params, timeout=timeout)
        with manager as stream:
            return stream.get_final_message()

    def _request(self, params: dict[str, Any], timeout: Any) -> Any:
        try:
            return self._stream(params, timeout)
        except anthropic.APIError as exc:
            rejected = (
                isinstance(exc, anthropic.BadRequestError)
                and self._use_fallback()
                and "fallbacks" in (exc.message or "").lower()
            )
            if not rejected:
                raise _map_error(exc) from exc
        self._fallback_disabled = True
        log.warning(
            "anthropic rejected the fallbacks parameter; server-side fallback disabled for this process"
        )
        try:
            return self._stream(params, timeout)
        except anthropic.APIError as exc:
            raise _map_error(exc) from exc

    def _parse(self, msg: Any, purpose: str, images: int, started: float) -> TurnResult:
        stop = cast(str | None, msg.stop_reason)
        usage = self._usage(msg, purpose, images, started, stop or "other")
        failed = UsageCall(**{**usage.__dict__, "status": "failed"})
        if stop == "refusal":
            details = msg.stop_details
            raise ProviderRefusal(
                "The model refused the request.",
                category=getattr(details, "category", None),
                usage=[failed],
            )
        if stop == "max_tokens":
            raise ProviderInvalidOutput("The model output was truncated.", usage=[failed])

        native = [b.model_dump(mode="json", by_alias=True, exclude_none=True) for b in msg.content]
        # Only what follows the last fallback block is the answer of the model that served the turn.
        last_fallback = max((i for i, b in enumerate(native) if b["type"] == "fallback"), default=-1)
        answer = native[last_fallback + 1 :]
        text = "".join(b["text"] for b in answer if b["type"] == "text") or None
        calls = [ToolCall(b["id"], b["name"], b["input"]) for b in answer if b["type"] == "tool_use"]
        return TurnResult(
            assistant=AssistantMessage(native=native, text=text, tool_calls=calls),
            stop_reason=_STOP_REASONS.get(stop or "", "other"),
            usage=usage,
        )

    @staticmethod
    def _usage(msg: Any, purpose: str, images: int, started: float, stop_reason: str) -> UsageCall:
        u = msg.usage
        # With a fallback the per-iteration entries carry every model's tokens; otherwise the totals.
        rows = [
            i for i in (getattr(u, "iterations", None) or []) if i.type in ("message", "fallback_message")
        ]
        if not rows:
            rows = [u]
        return UsageCall(
            purpose=cast(UsagePurpose, purpose),
            model=str(msg.model),
            input_tokens=sum(r.input_tokens or 0 for r in rows),
            output_tokens=sum(r.output_tokens or 0 for r in rows),
            cache_read_input_tokens=sum(r.cache_read_input_tokens or 0 for r in rows),
            cache_creation_input_tokens=sum(r.cache_creation_input_tokens or 0 for r in rows),
            images=images,
            duration_ms=round((time.perf_counter() - started) * 1000),
            stop_reason=stop_reason,
            status="succeeded",
        )
