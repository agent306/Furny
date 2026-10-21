"""Shared harness for the OpenAI and OpenAI-compatible adapter tests: real SDK over a mock transport."""

import json
from typing import Any

import httpx2
import openai

from app.config import Settings
from app.providers.base import JsonSchemaSpec, TextPart, ToolSpec, UserMessage

SCHEMA = {
    "type": "object",
    "properties": {"a": {"type": "string"}},
    "required": ["a"],
    "additionalProperties": False,
}
TOOL = ToolSpec("crop_image", "Crop.", {"type": "object", "properties": {}, "additionalProperties": False})
PNG = b"\x89PNG-bytes"
PNG_URL = "data:image/png;base64,iVBORy1ieXRlcw=="
SPEC = JsonSchemaSpec("floor_plan_labels", SCHEMA)

Item = dict[str, Any] | tuple[int, dict[str, Any]] | Exception


def completion(
    message: dict[str, Any] | None = None,
    finish_reason: str = "stop",
    *,
    model: str | None = "gpt-served",
    usage: dict[str, Any] | None = None,
    no_usage: bool = False,
) -> dict[str, Any]:
    body: dict[str, Any] = {
        "id": "chatcmpl-1",
        "object": "chat.completion",
        "created": 1,
        "choices": [
            {
                "index": 0,
                "message": message or {"role": "assistant", "content": "ok"},
                "finish_reason": finish_reason,
            }
        ],
    }
    if model is not None:
        body["model"] = model
    if not no_usage:
        body["usage"] = usage or {"prompt_tokens": 11, "completion_tokens": 7, "total_tokens": 18}
    return body


def tool_call(call_id: str, name: str, arguments: str) -> dict[str, Any]:
    return {"id": call_id, "type": "function", "function": {"name": name, "arguments": arguments}}


def error_body(msg: str = "boom", code: str | None = None) -> dict[str, Any]:
    return {"error": {"message": msg, "type": "invalid_request_error", "param": None, "code": code}}


class Harness:
    """Answers each request from `items` in order and records `(request, json body)`."""

    def __init__(self, items: list[Item]) -> None:
        self.items = list(items)
        self.requests: list[tuple[httpx2.Request, dict[str, Any]]] = []

    def handler(self, request: httpx2.Request) -> httpx2.Response:
        self.requests.append((request, json.loads(request.content)))
        item = self.items.pop(0)
        if isinstance(item, Exception):
            raise item
        if isinstance(item, tuple):
            return httpx2.Response(item[0], json=item[1])
        return httpx2.Response(200, json=item)

    @property
    def bodies(self) -> list[dict[str, Any]]:
        return [body for _, body in self.requests]

    def client(self) -> Any:
        return openai.DefaultHttpxClient(transport=httpx2.MockTransport(self.handler))


def base_settings(**overrides: Any) -> Settings:
    return Settings(vision_service_token="t" * 32, **overrides)


def complete(
    provider: Any,
    conversation: list[Any] | None = None,
    *,
    tools: list[ToolSpec] | None = None,
    tool_choice: Any = "auto",
    output_schema: JsonSchemaSpec | None = None,
    max_output_tokens: int = 32000,
    timeout_s: float = 30,
) -> Any:
    return provider.complete(
        conversation if conversation is not None else [UserMessage([TextPart("hi")])],
        system="SYS",
        tools=tools or [],
        tool_choice=tool_choice,
        output_schema=output_schema,
        effort="high",
        max_output_tokens=max_output_tokens,
        timeout_s=timeout_s,
        purpose="agent_turn",
    )
