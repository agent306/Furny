"""OpenAI adapter (18 §7.2): Chat Completions, strict function tools, `json_schema` response format.

`OpenAICompatibleProvider` subclasses this and overrides only the hooks marked below (18 §7.3).
"""

import base64
import dataclasses
import json
import logging
import time
from typing import Any, Literal, cast

import openai

from app.config import Settings
from app.providers import registry
from app.providers.base import (
    AssistantMessage,
    Effort,
    ImagePart,
    JsonSchemaSpec,
    LLMProvider,
    Message,
    ProviderName,
    TextPart,
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

CONNECT_TIMEOUT_S = 10.0
# Same key as app.pipeline.labeling.tools.INVALID_JSON_SENTINEL; not imported to keep cv2 out of providers.
INVALID_JSON = "__invalid_json__"
IMAGE_OMITTED: dict[str, Any] = {"type": "text", "text": "[image omitted]"}


def _image_part(image: ImagePart, detail: bool) -> dict[str, Any]:
    url: dict[str, Any] = {
        "url": f"data:{image.media_type};base64,{base64.standard_b64encode(image.data).decode()}"
    }
    if detail:
        url["detail"] = "high"
    return {"type": "image_url", "image_url": url}


def to_openai_messages(
    conversation: list[Message], *, image_detail: bool, max_images: int
) -> list[dict[str, Any]]:
    """Neutral conversation -> Chat Completions `messages` (without the system message).

    Assistant `native` is replayed unchanged. Tool messages cannot carry images, so the images of a tool
    result follow in an extra user message. Only the newest `max_images` images are kept; older ones
    become the text `[image omitted]` (18 §3).
    """
    out: list[dict[str, Any]] = []
    for item in conversation:
        if isinstance(item, AssistantMessage):
            out.append(cast(dict[str, Any], item.native))
        elif isinstance(item, UserMessage):
            images = [_image_part(p, image_detail) for p in item.parts if isinstance(p, ImagePart)]
            texts = [{"type": "text", "text": p.text} for p in item.parts if isinstance(p, TextPart)]
            out.append({"role": "user", "content": images + texts})
        else:
            for r in item.results:
                text = "\n".join(p.text for p in r.content if isinstance(p, TextPart))
                out.append(
                    {
                        "role": "tool",
                        "tool_call_id": r.call_id,
                        "content": f"ERROR: {text}" if r.is_error else text,
                    }
                )
            for r in item.results:
                images = [_image_part(p, image_detail) for p in r.content if isinstance(p, ImagePart)]
                if images:
                    header = {"type": "text", "text": f"Images returned by tool call {r.call_id}:"}
                    out.append({"role": "user", "content": [header, *images]})

    seen = 0
    for message in reversed(out):
        if message["role"] != "user" or not isinstance(message["content"], list):
            continue
        parts = message["content"]
        for i in range(len(parts) - 1, -1, -1):
            if parts[i]["type"] == "image_url":
                seen += 1
                if seen > max_images:
                    parts[i] = IMAGE_OMITTED
    return out


def _arguments(raw: str | None) -> dict[str, Any]:
    """Tool-call arguments; anything that is not a JSON object becomes the invalid-JSON sentinel."""
    if not raw:
        return {}
    try:
        value = json.loads(raw)
    except ValueError:
        return {INVALID_JSON: raw}
    return value if isinstance(value, dict) else {INVALID_JSON: raw}


def _map_error(exc: openai.APIError) -> ProviderError:
    """SDK exception -> neutral error (18 §7.2 table)."""
    message = getattr(exc, "message", None) or str(exc)
    if isinstance(exc, openai.APITimeoutError):
        return ProviderTimeout(message)
    if isinstance(exc, openai.APIConnectionError):
        return ProviderUnavailable(message, code="provider_unreachable")
    if isinstance(exc, openai.AuthenticationError | openai.PermissionDeniedError):
        return ProviderAuthError(message)
    if isinstance(exc, openai.NotFoundError):
        return ProviderBadRequest(message, code="model_not_found")
    if isinstance(exc, openai.RateLimitError):
        return ProviderUnavailable(message, code="provider_rate_limited")
    if isinstance(exc, openai.APIStatusError):
        if exc.status_code >= 500:
            return ProviderUnavailable(message, code="provider_overloaded")
        return ProviderBadRequest(message)
    return ProviderUnavailable(message, code="provider_unreachable")


class OpenAIProvider(LLMProvider):
    name: ProviderName = "openai"
    max_tokens_param = "max_completion_tokens"  # compat: `max_tokens`
    image_detail = True  # compat: no `detail` field

    def __init__(
        self,
        settings: Settings,
        model: str,
        *,
        http_client: Any | None = None,
        max_retries: int = 2,
    ) -> None:
        self.settings = settings
        self.model = model
        self.capabilities = registry.capabilities_for(self.name, settings)
        self.send_effort = self._effort_enabled()
        api_key, base_url = self._credentials()
        self._client = openai.OpenAI(
            api_key=api_key,
            base_url=base_url,
            max_retries=max_retries,
            timeout=self._timeout(settings.vision_llm_call_timeout_s),
            http_client=http_client,
        )

    # --- hooks overridden by the OpenAI-compatible adapter ---------------------------------------------

    def _effort_enabled(self) -> bool:
        return self.settings.openai_send_reasoning_effort

    def _credentials(self) -> tuple[str | None, str | None]:
        key = self.settings.openai_api_key
        return (key.get_secret_value() if key is not None else None), self.settings.openai_base_url or None

    def _output_cap(self) -> int:
        return self.settings.openai_max_output_tokens

    def _call_timeout_s(self, requested: float) -> float:
        return requested

    def _usage_model(self, resp: Any) -> str:
        return cast(str, getattr(resp, "model", None) or self.model)

    # ---------------------------------------------------------------------------------------------------

    def _timeout(self, seconds: float) -> openai.Timeout:
        return openai.Timeout(self._call_timeout_s(seconds), connect=CONNECT_TIMEOUT_S)

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
        caps = self.capabilities
        messages = to_openai_messages(
            conversation, image_detail=self.image_detail, max_images=caps.max_images_per_request
        )
        kwargs: dict[str, Any] = {
            "model": self.model,
            "messages": [{"role": "system", "content": system}, *messages],
            self.max_tokens_param: min(max_output_tokens, self._output_cap()),
        }
        if output_schema is not None and caps.supports_json_schema:
            kwargs["response_format"] = {
                "type": "json_schema",
                "json_schema": {"name": output_schema.name, "schema": output_schema.schema, "strict": True},
            }
        if tools and caps.supports_tools:
            kwargs["tools"] = [
                {
                    "type": "function",
                    "function": {
                        "name": t.name,
                        "description": t.description,
                        "parameters": t.input_schema,
                        "strict": True,
                    },
                }
                for t in tools
            ]
            kwargs["tool_choice"] = tool_choice
        if self.send_effort:
            kwargs["reasoning_effort"] = effort
        started = time.perf_counter()
        try:
            resp = self._request(kwargs, self._timeout(timeout_s))
            return self._parse(resp, purpose, new_images(conversation), started)
        except ProviderError as err:
            registry.record_provider_error(self.name, err.code)
            raise

    def _request(self, kwargs: dict[str, Any], timeout: openai.Timeout) -> Any:
        try:
            return self._client.chat.completions.create(**kwargs, timeout=timeout)
        except openai.APIError as exc:
            rejected = (
                isinstance(exc, openai.BadRequestError)
                and "reasoning_effort" in kwargs
                and "reasoning_effort" in (exc.message or "").lower()
            )
            if not rejected:
                raise _map_error(exc) from exc
        self.send_effort = False
        del kwargs["reasoning_effort"]
        log.warning("%s rejected reasoning_effort; it is no longer sent in this process", self.name)
        try:
            return self._client.chat.completions.create(**kwargs, timeout=timeout)
        except openai.APIError as exc:
            raise _map_error(exc) from exc

    def _parse(self, resp: Any, purpose: str, images: int, started: float) -> TurnResult:
        if not resp.choices:
            raise ProviderInvalidOutput("The response contained no choices.")
        choice = resp.choices[0]
        message = choice.message
        finish = cast(str | None, choice.finish_reason)
        usage = self._usage(resp, purpose, images, started, finish or "other")
        failed = dataclasses.replace(usage, status="failed")
        if message.refusal:
            raise ProviderRefusal("The model refused the request.", usage=[failed])
        if finish == "content_filter":
            raise ProviderRefusal(
                "The response was blocked by a content filter.", category=finish, usage=[failed]
            )
        if finish == "length":
            raise ProviderInvalidOutput("The model output was truncated.", usage=[failed])

        calls = [
            ToolCall(tc.id, tc.function.name, _arguments(tc.function.arguments))
            for tc in message.tool_calls or []
            if getattr(tc, "function", None) is not None
        ]
        # Some local servers answer `stop` while calling tools, so the calls decide.
        stop: Literal["end_turn", "tool_use", "other"] = (
            "tool_use" if calls else "end_turn" if finish == "stop" else "other"
        )
        return TurnResult(
            assistant=AssistantMessage(
                native=message.model_dump(exclude_none=True), text=message.content or None, tool_calls=calls
            ),
            stop_reason=stop,
            usage=usage,
        )

    def _usage(self, resp: Any, purpose: str, images: int, started: float, stop_reason: str) -> UsageCall:
        u = getattr(resp, "usage", None)
        details = getattr(u, "prompt_tokens_details", None)
        return UsageCall(
            purpose=cast(UsagePurpose, purpose),
            model=self._usage_model(resp),
            input_tokens=getattr(u, "prompt_tokens", 0) or 0,
            output_tokens=getattr(u, "completion_tokens", 0) or 0,
            cache_read_input_tokens=getattr(details, "cached_tokens", 0) or 0,
            cache_creation_input_tokens=0,
            images=images,
            duration_ms=round((time.perf_counter() - started) * 1000),
            stop_reason=stop_reason,
            status="succeeded",
        )
