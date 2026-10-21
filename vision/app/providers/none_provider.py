"""`none` (18 §7.4): keeps the registry uniform. Recognition with `none` uses the heuristic labeler."""

from typing import Literal

from app.providers.base import (
    Effort,
    JsonSchemaSpec,
    LLMProvider,
    Message,
    ProviderCapabilities,
    ToolSpec,
    TurnResult,
)


class NoneProvider(LLMProvider):
    name = "none"
    model = ""
    capabilities = ProviderCapabilities(False, False, False, False, 0, 0)

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
        raise NotImplementedError("the 'none' provider makes no model calls")
