"""Test doubles (not registered): a scripted `FakeProvider` and a `ReplayProvider` (18 §6.1)."""

import json
import threading
from collections.abc import Callable, Sequence
from typing import Any, Literal, cast

from app.providers.base import (
    AssistantMessage,
    Effort,
    JsonSchemaSpec,
    LLMProvider,
    Message,
    ProviderCapabilities,
    ProviderName,
    ToolCall,
    ToolSpec,
    TurnResult,
    UsageCall,
    UsagePurpose,
)

FULL_CAPABILITIES = ProviderCapabilities(
    supports_vision=True,
    supports_tools=True,
    supports_json_schema=True,
    supports_effort=True,
    max_image_px=2576,
    max_images_per_request=20,
)

ScriptItem = TurnResult | Exception | Callable[[list[Message]], TurnResult]


def make_turn(
    text: str | None = None,
    tool_calls: Sequence[ToolCall] = (),
    stop_reason: Literal["end_turn", "tool_use", "max_tokens", "refusal", "other"] = "end_turn",
    purpose: UsagePurpose = "labeling",
) -> TurnResult:
    """A successful turn with canned usage; `assistant.native` is a stub of the text and tool calls."""
    calls = list(tool_calls)
    return TurnResult(
        assistant=AssistantMessage(native={"text": text, "tool_calls": calls}, text=text, tool_calls=calls),
        stop_reason=stop_reason,
        usage=UsageCall(
            purpose=purpose,
            model="fake-model",
            input_tokens=100,
            output_tokens=20,
            cache_read_input_tokens=0,
            cache_creation_input_tokens=0,
            images=0,
            duration_ms=5,
            stop_reason=stop_reason,
            status="succeeded",
        ),
    )


class FakeProvider(LLMProvider):
    """Plays `script` in order: a `TurnResult` is returned, an `Exception` raised, a callable is called with
    the conversation. `calls` records the arguments of every `complete`."""

    def __init__(
        self,
        script: Sequence[ScriptItem],
        capabilities: ProviderCapabilities = FULL_CAPABILITIES,
        name: ProviderName = "anthropic",
        model: str = "fake-model",
    ) -> None:
        self.script = list(script)
        self.capabilities = capabilities
        self.name = name
        self.model = model
        self.calls: list[dict[str, Any]] = []
        self._lock = threading.Lock()

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
        with self._lock:
            self.calls.append(
                {
                    "conversation": list(conversation),
                    "system": system,
                    "tools": tools,
                    "tool_choice": tool_choice,
                    "output_schema": output_schema,
                    "effort": effort,
                    "max_output_tokens": max_output_tokens,
                    "timeout_s": timeout_s,
                    "purpose": purpose,
                }
            )
            if not self.script:
                raise AssertionError("FakeProvider script exhausted")
            item = self.script.pop(0)
        if isinstance(item, Exception):
            raise item
        if isinstance(item, TurnResult):
            return item
        return item(conversation)


class ReplayProvider(LLMProvider):
    """Answers every call with `result_json` as the reply text (recorded-fixture replays)."""

    def __init__(
        self,
        result_json: dict[str, Any],
        capabilities: ProviderCapabilities = FULL_CAPABILITIES,
    ) -> None:
        self.result_json = result_json
        self.capabilities = capabilities
        self.name = "anthropic"
        self.model = "replay-model"

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
        return make_turn(text=json.dumps(self.result_json), purpose=cast(UsagePurpose, purpose))
