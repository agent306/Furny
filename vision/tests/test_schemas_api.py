"""API request/response models (06 sections 5.4-5.8, 18 sections 5.1/5.3, 06 section 9.4/10.4)."""

import copy
import json
from typing import Any

import pytest
from pydantic import ValidationError
from test_schemas_plan_meta import meta_js, plan_js

from app.schemas.api import (
    CapabilitiesResponse,
    ImageNormalizeRequest,
    InspectResponse,
    NormalizeRequest,
    NormalizeResponse,
    ProviderTestResponse,
    RecognizeRequest,
    RecognizeResponse,
    Usage,
)
from app.schemas.labeling import LabelingResult, LayerMapping
from app.schemas.meta import ProviderName, ScaleSample


def recognize_js() -> dict[str, Any]:
    return {
        "requestId": "01JB0000000000000000000000",
        "source": {
            "url": "https://example.test/plan.pdf",
            "filename": "plan.pdf",
            "mimeType": "application/pdf",
            "sourceKind": "pdf_vector",
        },
        "output": {
            "normalizedPutUrl": "https://example.test/put/normalized",
            "debugPutUrls": ["https://example.test/put/d1", "https://example.test/put/d2"],
        },
        "options": {
            "provider": "anthropic",
            "model": "claude-opus-5-5",
            "effort": "high",
            "agenticCrops": True,
            "fallbackToNoneOnError": True,
            "selectedPage": 1,
            "hints": {
                "unitSystem": None,
                "knownDimension": None,
                "wallHeightMm": None,
                "isPhoto": False,
                "corners": None,
            },
            "defaults": {
                "wallHeightMm": 2700,
                "exteriorWallThicknessMm": 230,
                "interiorWallThicknessMm": 115,
                "doorWidthMm": 900,
                "doorHeightMm": 2100,
                "windowWidthMm": 1200,
                "windowHeightMm": 1200,
                "windowSillMm": 900,
            },
            "locale": "en",
            "debug": True,
        },
    }


def _mutated(js: dict[str, Any], path: list[str | int], value: Any) -> dict[str, Any]:
    out = copy.deepcopy(js)
    node: Any = out
    for key in path[:-1]:
        node = node[key]
    node[path[-1]] = value
    return out


def test_recognize_request_example() -> None:
    req = RecognizeRequest.model_validate(recognize_js())
    assert req.options.effort == "high"
    assert req.options.defaults.wall_height_mm == 2700
    assert req.options.defaults.interior_wall_thickness_mm == 115
    assert req.source.source_kind == "pdf_vector"
    assert req.options.hints.is_photo is False
    assert req.wire() == recognize_js()


def test_recognize_request_rejects_invalid() -> None:
    with pytest.raises(ValidationError):
        RecognizeRequest.model_validate(_mutated(recognize_js(), ["options", "provider"], "gemini"))
    nine = [f"https://example.test/put/{i}" for i in range(9)]
    with pytest.raises(ValidationError):
        RecognizeRequest.model_validate(_mutated(recognize_js(), ["output", "debugPutUrls"], nine))
    eight = nine[:8]
    assert (
        len(
            RecognizeRequest.model_validate(
                _mutated(recognize_js(), ["output", "debugPutUrls"], eight)
            ).output.debug_put_urls
        )
        == 8
    )
    with pytest.raises(ValidationError):
        RecognizeRequest.model_validate(_mutated(recognize_js(), ["options", "effort"], "max"))


def test_recognize_request_hints() -> None:
    hints = {
        "unitSystem": "imperial",
        "knownDimension": {"label": "Living width", "mm": 4200},
        "wallHeightMm": 3000,
        "isPhoto": True,
        "corners": [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]],
    }
    req = RecognizeRequest.model_validate(_mutated(recognize_js(), ["options", "hints"], hints))
    assert req.options.hints.known_dimension is not None
    assert req.options.hints.known_dimension.mm == 4200
    assert req.wire()["options"]["hints"]["corners"] == hints["corners"]
    for path, value in [
        (["unitSystem"], "unknown"),
        (["knownDimension"], {"label": "x" * 81, "mm": 4200}),
        (["knownDimension"], {"label": "x", "mm": 99}),
        (["wallHeightMm"], 1999),
        (["wallHeightMm"], 6001),
        (["corners"], [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9]]),
        (["corners"], [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [1.1, 0.9]]),
    ]:
        with pytest.raises(ValidationError):
            RecognizeRequest.model_validate(_mutated(recognize_js(), ["options", "hints", *path], value))


def inspect_js() -> dict[str, Any]:
    return {
        "sourceKind": "pdf_vector",
        "pageCount": 3,
        "pages": [
            {
                "index": 1,
                "widthPt": 841.9,
                "heightPt": 595.3,
                "isVector": True,
                "thumbnail": {"contentType": "image/webp", "base64": "AAAA", "width": 320, "height": 226},
            }
        ],
        "preview": {"contentType": "image/jpeg", "base64": "BBBB", "width": 1600, "height": 1131, "page": 1},
        "photo": {"isLikelyPhoto": False, "suggestedCorners": None},
        "dxf": None,
        "warnings": [{"code": "low_resolution", "params": {"longEdge": 540}}],
    }


def test_inspect_response_example() -> None:
    res = InspectResponse.model_validate(inspect_js())
    assert res.pages[0].width_pt == 841.9
    assert res.preview.page == 1
    assert res.warnings[0].code == "low_resolution"
    assert res.wire() == inspect_js()


def test_inspect_response_raster_and_dxf_variants() -> None:
    js = inspect_js()
    js.update(
        sourceKind="dxf",
        pageCount=1,
        photo=None,
        dxf={"insunits": 4, "layerCount": 23, "entityCount": 4120},
        warnings=[],
    )
    js["pages"][0].update(widthPt=None, heightPt=None, isVector=False)
    assert InspectResponse.model_validate(js).wire() == js
    js["photo"] = {
        "isLikelyPhoto": True,
        "suggestedCorners": [[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]],
    }
    assert InspectResponse.model_validate(js).wire() == js


def test_inspect_warning_has_no_entity_ids() -> None:
    # K3: inspect/normalize warnings are {code, params} only (06 section 5.4 example).
    with pytest.raises(ValidationError):
        InspectResponse.model_validate(_mutated(inspect_js(), ["warnings", 0, "entityIds"], ["w_1"]))


def capabilities_js() -> dict[str, Any]:
    full = {
        "supportsVision": True,
        "supportsTools": True,
        "supportsJsonSchema": True,
        "supportsEffort": True,
    }
    return {
        "serviceVersion": "1.0.0",
        "pipelineVersion": "1.0.0",
        "providers": [
            {
                "name": "anthropic",
                "configured": True,
                "defaultModel": "claude-opus-5-5",
                **full,
                "maxImagePx": 2576,
                "maxImagesPerRequest": 20,
                "lastError": None,
            },
            {
                "name": "openai",
                "configured": False,
                "defaultModel": None,
                **full,
                "maxImagePx": 2048,
                "maxImagesPerRequest": 10,
                "lastError": None,
                "missing": ["OPENAI_API_KEY", "OPENAI_MODEL"],
            },
            {
                "name": "openai_compatible",
                "configured": True,
                "defaultModel": "qwen2.5vl:32b",
                "supportsVision": True,
                "supportsTools": False,
                "supportsJsonSchema": False,
                "supportsEffort": False,
                "maxImagePx": 1280,
                "maxImagesPerRequest": 1,
                "lastError": {"code": "provider_unreachable", "at": "2026-10-20T10:12:00Z"},
            },
            {
                "name": "none",
                "configured": True,
                "defaultModel": None,
                "supportsVision": False,
                "supportsTools": False,
                "supportsJsonSchema": False,
                "supportsEffort": False,
                "maxImagePx": 0,
                "maxImagesPerRequest": 0,
                "lastError": None,
            },
        ],
        "ocr": {"engine": "rapidocr", "loaded": True},
        "limits": {
            "maxSourceBytes": 26214400,
            "maxDxfBytes": 15728640,
            "maxPdfPages": 20,
            "maxPixels": 40000000,
            "recognizeDeadlineS": 570,
        },
    }


def test_capabilities_example() -> None:
    res = CapabilitiesResponse.model_validate(capabilities_js())
    assert res.wire() == capabilities_js()
    wire = res.wire()["providers"]
    # K3: `missing` is omitted when None; every other null is still emitted.
    assert "missing" not in wire[0]
    assert wire[0]["lastError"] is None
    assert wire[1]["defaultModel"] is None
    assert wire[1]["missing"] == ["OPENAI_API_KEY", "OPENAI_MODEL"]


def test_capabilities_missing_omitted_in_json_output() -> None:
    res = CapabilitiesResponse.model_validate(capabilities_js())
    parsed = json.loads(res.model_dump_json(by_alias=True))
    assert "missing" not in parsed["providers"][0]
    assert parsed["providers"][1]["missing"] == ["OPENAI_API_KEY", "OPENAI_MODEL"]


def test_provider_test_response() -> None:
    js = {
        "ok": True,
        "provider": "anthropic",
        "model": "claude-opus-5-5",
        "latencyMs": 2310,
        "visionVerified": True,
        "jsonSchemaVerified": True,
        "usage": {
            "purpose": "provider_test",
            "model": "claude-opus-5-5",
            "inputTokens": 140,
            "outputTokens": 30,
            "cacheReadInputTokens": 0,
            "cacheCreationInputTokens": 0,
            "images": 1,
            "durationMs": 2310,
            "stopReason": "end_turn",
            "status": "succeeded",
        },
        "error": None,
    }
    assert ProviderTestResponse.model_validate(js).wire() == js
    failed = {
        **js,
        "ok": False,
        "usage": None,
        "error": {"code": "provider_auth_failed", "message": "bad key"},
    }
    assert ProviderTestResponse.model_validate(failed).wire() == failed


def usage_js() -> dict[str, Any]:
    return {
        "provider": "anthropic",
        "model": "claude-opus-5-5",
        "calls": [
            {
                "purpose": "labeling",
                "model": "claude-opus-5-5",
                "inputTokens": 21034,
                "outputTokens": 3120,
                "cacheReadInputTokens": 0,
                "cacheCreationInputTokens": 0,
                "images": 2,
                "durationMs": 38122,
                "stopReason": "end_turn",
                "status": "succeeded",
            }
        ],
        "totals": {
            "requests": 4,
            "inputTokens": 61200,
            "outputTokens": 8200,
            "images": 7,
            "durationMs": 97012,
        },
        "status": "succeeded",
    }


def test_usage_roundtrip_and_none_provider() -> None:
    assert Usage.model_validate(usage_js()).wire() == usage_js()
    none_usage = {
        "provider": "none",
        "model": None,
        "calls": [],
        "totals": {"requests": 0, "inputTokens": 0, "outputTokens": 0, "images": 0, "durationMs": 0},
        "status": "succeeded",
    }
    assert Usage.model_validate(none_usage).wire() == none_usage
    with pytest.raises(ValidationError):
        Usage.model_validate(_mutated(usage_js(), ["calls", 0, "purpose"], "other"))
    with pytest.raises(ValidationError):
        Usage.model_validate(_mutated(usage_js(), ["status"], "partial"))


def test_recognize_response_roundtrip() -> None:
    js = {
        "document": plan_js(),
        "meta": meta_js(),
        "usage": usage_js(),
        "debugArtifacts": [{"index": 0, "name": "01-normalized-ink.png", "contentType": "image/png"}],
    }
    res = RecognizeResponse.model_validate(js)
    assert res.debug_artifacts[0].content_type == "image/png"
    wire = res.wire()
    assert wire["document"] == plan_js()
    # inspect/review are added by Laravel later and stay absent while unset (as ImportResultMeta.wire).
    assert "inspect" not in wire["meta"]
    assert "review" not in wire["meta"]
    assert wire["usage"] == usage_js()
    assert wire["debugArtifacts"] == js["debugArtifacts"]


def test_normalize_request_and_response() -> None:
    req = {
        "requestId": "01JB0000000000000000000000",
        "source": {"url": "https://example.test/a.png", "filename": "a.png", "mimeType": "image/png"},
        "output": {"normalizedPutUrl": "https://example.test/put"},
        "options": {"selectedPage": 2, "hints": {"isPhoto": True, "corners": None}},
    }
    parsed = NormalizeRequest.model_validate(req)
    assert parsed.options.selected_page == 2
    assert parsed.source.source_kind is None
    page_image = meta_js()["pageImage"]
    res = {
        "pageImage": page_image,
        "scaleNote": {"mmPerPixel": 10.58, "text": "SCALE 1:100"},
        "warnings": [{"code": "deskewed", "params": {}}],
    }
    assert NormalizeResponse.model_validate(res).wire() == res
    res["scaleNote"] = None
    assert NormalizeResponse.model_validate(res).wire() == res


def images_js() -> dict[str, Any]:
    return {
        "sourceUrl": "https://example.test/get",
        "targetUrl": "https://example.test/put",
        "format": "jpeg",
        "quality": 85,
        "maxEdge": 2048,
        "applyOrientation": True,
    }


def test_images_normalize_ranges() -> None:
    assert ImageNormalizeRequest.model_validate(images_js()).wire() == images_js()
    for key, ok_values, bad_values in [
        ("quality", [1, 100], [0, 101]),
        ("maxEdge", [64, 8192], [63, 8193]),
        ("format", ["jpeg", "png", "webp"], ["gif"]),
    ]:
        for value in ok_values:
            ImageNormalizeRequest.model_validate({**images_js(), key: value})
        for value in bad_values:
            with pytest.raises(ValidationError):
                ImageNormalizeRequest.model_validate({**images_js(), key: value})


def labeling_js() -> dict[str, Any]:
    return {
        "unitSystem": "metric",
        "drawingKind": "architectural_line_drawing",
        "texts": [{"id": "T1", "role": "room_name", "normalizedText": "LIVING"}],
        "dimensions": [{"textId": "T2", "spanId": None, "valueMm": 3600, "kind": "chain_segment"}],
        "rooms": [
            {
                "id": "R1",
                "include": True,
                "name": "Living",
                "type": "living",
                "nameTextId": "T1",
                "sizeText": "10'0\"x11'0\"",
                "widthMm": 3048,
                "depthMm": 3353,
            }
        ],
        "missedRooms": [{"name": "Pooja", "type": "pooja", "x": 100, "y": 200}],
        "walls": [{"id": "W1", "verdict": "wall", "kind": "exterior"}],
        "openings": [{"id": "O1", "verdict": "door", "doorType": "single_swing", "windowType": None}],
        "missedOpenings": [{"kind": "window", "wallId": "W1", "x": 10, "y": 20}],
        "knownDimensionMatch": {"wallId": "W1", "spanId": None},
        "notes": None,
    }


def test_labeling_result_roundtrip() -> None:
    res = LabelingResult.model_validate(labeling_js())
    assert res.known_dimension_match is not None
    assert res.wire() == labeling_js()
    # All fields are required (06 section 9.4): optionality is `| None`, never absence.
    for key in labeling_js():
        js = labeling_js()
        del js[key]
        with pytest.raises(ValidationError):
            LabelingResult.model_validate(js)


def test_layer_mapping() -> None:
    js = {"layers": [{"name": "A-WALL", "role": "wall"}, {"name": "HATCH", "role": "other"}]}
    assert LayerMapping.model_validate(js).wire() == js
    with pytest.raises(ValidationError):
        LayerMapping.model_validate({"layers": [{"name": "X", "role": "stairs"}]})


def test_shared_literals_come_from_meta() -> None:
    # ProviderName and ScaleSample are defined once in app.schemas.meta (progress ruling).
    from app.schemas import api, meta

    assert api.ProviderName is ProviderName is meta.ProviderName
    assert ScaleSample is meta.ScaleSample
