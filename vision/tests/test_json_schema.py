"""Strict JSON schema generation and tolerant JSON-object parsing (06 sections 9.4, 10.4)."""

import json
from typing import Any, Literal

import pytest
from pydantic import BaseModel, Field

from app.schemas.labeling import LabelingResult, LayerMapping
from app.utils.json_schema import parse_json_object, to_strict_schema

FORBIDDEN_KEYS = {"title", "description", "default", "minimum", "maximum"}


def _nodes(node: Any) -> list[dict[str, Any]]:
    """Every schema node (dict reachable through schema keywords, not through property names)."""
    out: list[dict[str, Any]] = []
    if isinstance(node, dict):
        out.append(node)
        for key, value in node.items():
            if key == "properties":
                for sub in value.values():
                    out.extend(_nodes(sub))
            elif key not in ("enum", "const", "required"):
                out.extend(_nodes(value))
    elif isinstance(node, list):
        for item in node:
            out.extend(_nodes(item))
    return out


def test_strict_schema() -> None:
    s = to_strict_schema(LabelingResult)
    assert "$ref" not in json.dumps(s)
    assert "$defs" not in s
    objects = [n for n in _nodes(s) if n.get("type") == "object"]
    assert len(objects) >= 9  # root + 8 nested model types
    for node in objects:
        assert node["additionalProperties"] is False
        assert set(node["required"]) == set(node["properties"])
    for node in _nodes(s):
        assert not FORBIDDEN_KEYS & node.keys()
        assert "exclusiveMinimum" not in node
        assert "exclusiveMaximum" not in node
    known = s["properties"]["knownDimensionMatch"]
    assert {"type": "null"} in known["anyOf"]
    assert s["properties"]["drawingKind"]["enum"] == [
        "architectural_line_drawing",
        "colored_brochure",
        "hand_sketch",
        "photo_of_drawing",
        "cad_vector",
        "not_a_floor_plan",
    ]
    assert set(s["properties"]) == {
        "unitSystem",
        "drawingKind",
        "texts",
        "dimensions",
        "rooms",
        "missedRooms",
        "walls",
        "openings",
        "missedOpenings",
        "knownDimensionMatch",
        "notes",
    }
    room = s["properties"]["rooms"]["items"]
    assert set(room["required"]) == {
        "id",
        "include",
        "name",
        "type",
        "nameTextId",
        "sizeText",
        "widthMm",
        "depthMm",
    }


def test_strict_schema_layer_mapping() -> None:
    s = to_strict_schema(LayerMapping)
    item = s["properties"]["layers"]["items"]
    assert item["additionalProperties"] is False
    assert item["properties"]["role"]["enum"] == [
        "wall",
        "door",
        "window",
        "room_label",
        "dimension",
        "furniture",
        "other",
    ]


def test_strict_schema_strips_keywords_but_keeps_property_names() -> None:
    class Inner(BaseModel):
        title: str = Field(description="a property that is literally called title")
        default: int | None = Field(None, ge=0, le=9)

    class Outer(BaseModel):
        kind: Literal["a", "b"] = Field("a", description="d")
        inner: Inner
        many: list[Inner] = Field(min_length=1)
        pos: float = Field(gt=0, lt=1)

    s = to_strict_schema(Outer)
    assert "$defs" not in s
    assert set(s["properties"]) == {"kind", "inner", "many", "pos"}
    assert set(s["properties"]["inner"]["properties"]) == {"title", "default"}
    assert set(s["properties"]["inner"]["required"]) == {"title", "default"}
    assert s["properties"]["pos"] == {"type": "number"}
    assert s["properties"]["inner"]["additionalProperties"] is False


def test_strict_schema_rejects_recursive_models() -> None:
    class Node(BaseModel):
        children: list["Node"]

    with pytest.raises(ValueError, match="recursive"):
        to_strict_schema(Node)


def test_strict_schema_does_not_mutate_between_calls() -> None:
    assert to_strict_schema(LabelingResult) == to_strict_schema(LabelingResult)


def test_parse_json_object() -> None:
    assert parse_json_object('```json\n{"a":1}\n```') == {"a": 1}
    assert parse_json_object('```\n{"a":1}\n```') == {"a": 1}
    assert parse_json_object('  {"a": [1, 2]}  ') == {"a": [1, 2]}
    assert parse_json_object('Sure! {"a": {"b": 2}} thanks') == {"a": {"b": 2}}
    with pytest.raises(ValueError):
        parse_json_object("no json")


@pytest.mark.parametrize("text", ["", "{", "{not json}", "[1, 2]", '{"a": 1', "} {"])
def test_parse_json_object_rejects(text: str) -> None:
    with pytest.raises(ValueError):
        parse_json_object(text)
