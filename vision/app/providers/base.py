"""Neutral provider types and the `LLMProvider` interface (18 §6.1).

`ProviderName` and `Effort` are defined once (`app.schemas.meta`, `app.schemas.api`) and re-exported here.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any, Literal

from app.schemas.api import Effort
from app.schemas.meta import ProviderName

__all__ = [
    "AssistantMessage",
    "Effort",
    "ImagePart",
    "JsonSchemaSpec",
    "LLMProvider",
    "Message",
    "Part",
    "ProviderCapabilities",
    "ProviderName",
    "TextPart",
    "ToolCall",
    "ToolResult",
    "ToolResultsMessage",
    "ToolSpec",
    "TurnResult",
    "UsageCall",
    "UsagePurpose",
    "UserMessage",
]

UsagePurpose = Literal["labeling", "agent_turn", "finalize", "repair", "dxf_layers", "provider_test"]


@dataclass(frozen=True)
class ProviderCapabilities:
    supports_vision: bool
    supports_tools: bool
    supports_json_schema: bool
    supports_effort: bool
    max_image_px: int
    max_images_per_request: int


@dataclass(frozen=True)
class TextPart:
    text: str


@dataclass(frozen=True)
class ImagePart:
    data: bytes
    media_type: Literal["image/png", "image/jpeg"]


Part = TextPart | ImagePart


@dataclass(frozen=True)
class ToolSpec:
    name: str
    description: str
    input_schema: dict[str, Any]  # strict JSON schema (06 §9.5)


@dataclass(frozen=True)
class JsonSchemaSpec:
    name: str
    schema: dict[str, Any]  # e.g. ("floor_plan_labels", to_strict_schema(LabelingResult))


@dataclass(frozen=True)
class ToolCall:
    id: str
    name: str
    arguments: dict[str, Any]


@dataclass(frozen=True)
class ToolResult:
    call_id: str
    content: list[Part]
    is_error: bool = False


@dataclass(frozen=True)
class UserMessage:
    parts: list[Part]


@dataclass(frozen=True)
class ToolResultsMessage:
    results: list[ToolResult]


@dataclass(frozen=True)
class AssistantMessage:
    native: object  # provider-native assistant content, replayed unchanged (append-only history)
    text: str | None
    tool_calls: list[ToolCall]


Message = UserMessage | ToolResultsMessage | AssistantMessage


@dataclass(frozen=True)
class UsageCall:
    purpose: UsagePurpose
    model: str
    input_tokens: int
    output_tokens: int
    cache_read_input_tokens: int
    cache_creation_input_tokens: int
    images: int
    duration_ms: int
    stop_reason: str
    status: Literal["succeeded", "failed"]


@dataclass(frozen=True)
class TurnResult:
    assistant: AssistantMessage
    stop_reason: Literal["end_turn", "tool_use", "max_tokens", "refusal", "other"]
    usage: UsageCall


class LLMProvider(ABC):
    name: ProviderName
    model: str
    capabilities: ProviderCapabilities

    @abstractmethod
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
    ) -> TurnResult: ...
