"""Strict JSON schemas for provider structured output, and tolerant parsing of model replies."""

import copy
import json
import re
from typing import Any

from pydantic import BaseModel

# Keywords removed from every schema node (ranges are validated by pydantic after parsing).
_STRIP_KEYS = frozenset(
    {"title", "description", "default", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum"}
)
# Keywords whose values are literal data, not sub-schemas.
_LITERAL_KEYS = frozenset({"enum", "const", "required", "examples"})
_REF_PREFIX = "#/$defs/"
_FENCE_START = re.compile(r"^```[A-Za-z0-9_-]*\s*")
_FENCE_END = re.compile(r"\s*```$")


def to_strict_schema(model: type[BaseModel]) -> dict[str, Any]:
    """JSON Schema accepted by strict structured-output modes (06 section 9.4).

    ``$defs`` are inlined (no ``$ref``), every object gets ``additionalProperties: false`` and ``required``
    listing all its properties, and ``title``/``description``/``default``/numeric bounds are removed.
    Recursive models cannot be inlined and raise ``ValueError``.
    """
    raw = model.model_json_schema(mode="serialization", by_alias=True)
    defs: dict[str, Any] = raw.pop("$defs", {})
    strict: dict[str, Any] = _convert(raw, defs, ())
    return strict


def _convert(node: Any, defs: dict[str, Any], stack: tuple[str, ...]) -> Any:
    if isinstance(node, list):
        return [_convert(item, defs, stack) for item in node]
    if not isinstance(node, dict):
        return node
    ref = node.get("$ref")
    if isinstance(ref, str):
        name = ref.removeprefix(_REF_PREFIX)
        if not ref.startswith(_REF_PREFIX) or name not in defs:
            raise ValueError(f"unresolvable schema reference: {ref}")
        if name in stack:
            raise ValueError(f"recursive schema is not supported: {' -> '.join((*stack, name))}")
        merged = {**copy.deepcopy(defs[name]), **{k: v for k, v in node.items() if k != "$ref"}}
        return _convert(merged, defs, (*stack, name))
    out: dict[str, Any] = {}
    for key, value in node.items():
        if key in _STRIP_KEYS:
            continue
        if key == "properties":
            out[key] = {prop: _convert(sub, defs, stack) for prop, sub in value.items()}
        elif key in _LITERAL_KEYS:
            out[key] = copy.deepcopy(value)
        else:
            out[key] = _convert(value, defs, stack)
    if out.get("type") == "object":
        properties = out.setdefault("properties", {})
        out["additionalProperties"] = False
        out["required"] = list(properties)
    return out


def parse_json_object(text: str) -> dict[str, Any]:
    """Extract the JSON object from a model reply (code fences and surrounding prose tolerated)."""
    body = _FENCE_END.sub("", _FENCE_START.sub("", text.strip()))
    start, end = body.find("{"), body.rfind("}")
    if start < 0 or end < start:
        raise ValueError("no JSON object found in model output")
    try:
        value = json.loads(body[start : end + 1])
    except json.JSONDecodeError as exc:
        raise ValueError(f"invalid JSON in model output: {exc.msg}") from exc
    if not isinstance(value, dict):
        raise ValueError("model output JSON is not an object")
    return value
