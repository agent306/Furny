"""Serialise a complete Messages API message dict into the SSE event stream the SDK streams from."""

import json
from typing import Any


def _event(name: str, data: dict[str, Any]) -> bytes:
    return f"event: {name}\ndata: {json.dumps(data)}\n\n".encode()


def _block_events(index: int, block: dict[str, Any]) -> list[bytes]:
    kind = block["type"]
    deltas: list[dict[str, Any]] = []
    start = dict(block)
    if kind == "text":
        start["text"] = ""
        deltas.append({"type": "text_delta", "text": block["text"]})
    elif kind == "tool_use":
        start["input"] = {}
        deltas.append({"type": "input_json_delta", "partial_json": json.dumps(block["input"])})
    elif kind == "thinking":
        start["thinking"] = ""
        start["signature"] = ""
        deltas.append({"type": "thinking_delta", "thinking": block["thinking"]})
        deltas.append({"type": "signature_delta", "signature": block["signature"]})
    events = [
        _event("content_block_start", {"type": "content_block_start", "index": index, "content_block": start})
    ]
    events += [
        _event("content_block_delta", {"type": "content_block_delta", "index": index, "delta": delta})
        for delta in deltas
    ]
    events.append(_event("content_block_stop", {"type": "content_block_stop", "index": index}))
    return events


def anthropic_sse(message: dict[str, Any]) -> bytes:
    """`message` is a full message: id, model, content, stop_reason, optional stop_details, usage
    (optionally with `iterations`)."""
    usage = dict(message["usage"])
    iterations = usage.pop("iterations", None)
    start = {k: v for k, v in message.items() if k not in ("content", "stop_reason", "stop_details")}
    start.update(content=[], stop_reason=None, stop_sequence=None, usage=usage)
    delta_usage: dict[str, Any] = {"output_tokens": usage["output_tokens"]}
    if iterations is not None:
        delta_usage["iterations"] = iterations
    chunks = [_event("message_start", {"type": "message_start", "message": start})]
    for index, block in enumerate(message["content"]):
        chunks += _block_events(index, block)
    chunks.append(
        _event(
            "message_delta",
            {
                "type": "message_delta",
                "delta": {
                    "stop_reason": message["stop_reason"],
                    "stop_sequence": None,
                    "stop_details": message.get("stop_details"),
                },
                "usage": delta_usage,
            },
        )
    )
    chunks.append(_event("message_stop", {"type": "message_stop"}))
    return b"".join(chunks)
