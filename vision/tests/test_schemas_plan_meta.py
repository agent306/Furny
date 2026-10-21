"""PlanDocument / ImportResultMeta pydantic mirrors (03 section 1, 06 section 6)."""

import copy
import re
from typing import Any, get_args

import pytest
from pydantic import ValidationError

from app.schemas.meta import (
    FallbackReason,
    ImportResultMeta,
    ProviderName,
    ReasonCode,
    StageKey,
    WarningCode,
)
from app.schemas.plan import PlanDocument, RoomType
from app.utils.ids import new_id


def test_new_id_format() -> None:
    assert re.fullmatch(r"w_[0-9a-z]{10}", new_id("w"))
    assert re.fullmatch(r"fr_[0-9a-z]{10}", new_id("fr"))
    assert len({new_id("w") for _ in range(1000)}) == 1000


def plan_js() -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "meta": {
            "defaultWallHeight": 2700,
            "defaultWallThickness": 115,
            "floorThickness": 150,
            "northAngle": None,
            "createdWith": "import",
        },
        "nodes": {
            "n_aaaaaaaaaa": {"id": "n_aaaaaaaaaa", "x": 0, "y": 0},
            "n_bbbbbbbbbb": {"id": "n_bbbbbbbbbb", "x": 4000, "y": 0},
        },
        "walls": {
            "w_aaaaaaaaaa": {
                "id": "w_aaaaaaaaaa",
                "a": "n_aaaaaaaaaa",
                "b": "n_bbbbbbbbbb",
                "thickness": 115,
                "height": 2700,
                "kind": "interior",
                "justification": "center",
                "material": "brick",
                "colorHex": None,
            }
        },
        "openings": {
            "o_aaaaaaaaaa": {
                "id": "o_aaaaaaaaaa",
                "wallId": "w_aaaaaaaaaa",
                "kind": "door",
                "type": "single_swing",
                "offset": 1000,
                "width": 900,
                "height": 2100,
                "sillHeight": 0,
                "hinge": "start",
                "swing": "left",
                "label": "D1",
            }
        },
        "rooms": {
            "r_aaaaaaaaaa": {
                "id": "r_aaaaaaaaaa",
                "anchor": {"x": 2000, "y": 1500},
                "name": "Living",
                "type": "living",
                "floorFinish": "tile",
                "floorColorHex": None,
                "labelOffset": None,
                "showArea": True,
            }
        },
        "placements": {},
        "fixtures": {},
        "annotations": {"dimensions": {}, "labels": {}},
        "background": {
            "importId": "imp1",
            "mediaUuid": "0b6f1c1e-0000-4000-8000-000000000000",
            "pixelWidth": 1000,
            "pixelHeight": 800,
            "mmPerPixel": 10.5,
            "position": {"x": -100, "y": -50},
            "rotation": 0,
            "opacity": 0.5,
            "visible": True,
            "locked": True,
        },
        "view": {"mode2d": None, "mode3d": None, "lastMode": "2d"},
    }


def test_plan_roundtrip_camel() -> None:
    js = plan_js()
    assert PlanDocument.model_validate(js).wire() == js


def test_plan_roundtrip_with_view_and_annotations() -> None:
    js = plan_js()
    js["view"] = {
        "mode2d": {"centerX": 10, "centerY": -20, "zoom": 0.25},
        "mode3d": {"camera": "orbit", "position": [1.0, 2.0, 3.5], "target": [0.0, 0.0, 0.0]},
        "lastMode": "3d",
    }
    js["annotations"] = {
        "dimensions": {
            "d_aaaaaaaaaa": {
                "id": "d_aaaaaaaaaa",
                "a": {"x": 0, "y": 0},
                "b": {"x": 10, "y": 0},
                "offset": -300,
                "attachedTo": {"kind": "wall", "wallId": "w_aaaaaaaaaa", "face": "left"},
            }
        },
        "labels": {
            "t_aaaaaaaaaa": {
                "id": "t_aaaaaaaaaa",
                "position": {"x": 5, "y": 5},
                "text": "hi",
                "fontSize": 250,
                "rotation": 0,
            }
        },
    }
    assert PlanDocument.model_validate(js).wire() == js


def _mutate(path: list[str | int], value: Any) -> dict[str, Any]:
    js = copy.deepcopy(plan_js())
    node: Any = js
    for key in path[:-1]:
        node = node[key]
    node[path[-1]] = value
    return js


@pytest.mark.parametrize(
    ("path", "value"),
    [
        (["walls", "w_aaaaaaaaaa", "thickness"], 40),
        (["walls", "w_aaaaaaaaaa", "thickness"], 1001),
        (["walls", "w_aaaaaaaaaa", "height"], 299),
        (["walls", "w_aaaaaaaaaa", "height"], 10001),
        (["openings", "o_aaaaaaaaaa", "width"], 299),
        (["openings", "o_aaaaaaaaaa", "width"], 6001),
        (["openings", "o_aaaaaaaaaa", "sillHeight"], 3001),
        (["nodes", "n_aaaaaaaaaa", "x"], 1_000_001),
        (["nodes", "n_aaaaaaaaaa", "y"], -1_000_001),
        (["schemaVersion"], 2),
        (["background", "opacity"], 1.5),
        (["background", "mmPerPixel"], 0),
        (["nodes", "n_aaaaaaaaaa", "x"], 1.5),
        (["extra"], 1),
        (["walls", "w_aaaaaaaaaa", "unknown"], 1),
    ],
)
def test_plan_ranges(path: list[str | int], value: Any) -> None:
    with pytest.raises(ValidationError):
        PlanDocument.model_validate(_mutate(path, value))


def test_room_types() -> None:
    assert set(get_args(RoomType)) == {
        "living",
        "dining",
        "kitchen",
        "bedroom",
        "master_bedroom",
        "bathroom",
        "toilet",
        "balcony",
        "utility",
        "store",
        "study",
        "pooja",
        "foyer",
        "corridor",
        "dress",
        "deck",
        "ots",
        "garage",
        "other",
    }
    assert len(get_args(RoomType)) == 19


def test_warning_codes_exact() -> None:
    expected = {
        "low_resolution",
        "image_downscaled",
        "photo_rectified",
        "page_corners_not_found",
        "deskewed",
        "scale_guessed",
        "scale_from_room_labels",
        "scale_room_label_mismatch",
        "scale_anisotropy_corrected",
        "scale_high_residual",
        "unit_system_guessed",
        "known_dimension_unmatched",
        "room_names_merged",
        "rooms_without_names",
        "walls_unconnected",
        "openings_dropped_overlap",
        "entities_outside_unit_removed",
        "llm_failed_fallback_none",
        "llm_partial",
        "llm_output_repaired",
        "too_many_candidates_truncated",
        "plan_region_ambiguous",
        "not_a_floor_plan_suspected",
        "dxf_units_guessed",
        "dxf_layers_guessed",
        "plan_validation_warning",
    }
    assert set(get_args(WarningCode)) == expected
    assert len(expected) == 26


def test_reason_codes_exact() -> None:
    expected = {
        "thin_evidence",
        "single_line_wall",
        "unconnected",
        "off_axis",
        "llm_unsure",
        "llm_disagrees",
        "no_name",
        "name_guessed",
        "size_mismatch",
        "gap_only",
        "type_guessed",
        "small_area",
        "open_face",
    }
    assert set(get_args(ReasonCode)) == expected
    assert len(expected) == 13


def test_small_literals_exact() -> None:
    assert set(get_args(ProviderName)) == {"anthropic", "openai", "openai_compatible", "none"}
    assert len(get_args(StageKey)) == 16
    assert len(get_args(FallbackReason)) == 7


def meta_js() -> dict[str, Any]:
    return {
        "metaVersion": 1,
        "serviceVersion": "1.0.0",
        "pipelineVersion": "1.0.0",
        "sourceKind": "raster",
        "providerRequested": "anthropic",
        "providerUsed": "none",
        "model": None,
        "fallbackReason": "llm_timeout",
        "drawingKind": "architectural_line_drawing",
        "pageImage": {
            "width": 2000,
            "height": 1500,
            "sourcePage": 1,
            "dpi": None,
            "rectified": False,
            "deskewDeg": 0.0,
            "resampleFactor": 1.25,
        },
        "planRegion": {"x": 10, "y": 20, "w": 1800, "h": 1300},
        "scale": {
            "mmPerPixel": 10.5,
            "method": "dimension_chain",
            "residualPct": 1.2,
            "samples": 5,
            "rejected": 1,
            "confidence": 0.9,
            "anisotropyCorrected": False,
            "roomLabelCheck": {"rooms": 3, "medianDiscrepancyPct": None},
            "usedSamples": [
                {
                    "text": "3500",
                    "valueMm": 3500,
                    "a": {"x": 0, "y": 0},
                    "b": {"x": 3500, "y": 0},
                    "inlier": True,
                    "kind": "chain_segment",
                }
            ],
        },
        "detectedUnitSystem": "metric",
        "confidence": {
            "walls": {"w_aaaaaaaaaa": 0.87},
            "openings": {"o_aaaaaaaaaa": 0.72},
            "rooms": {"r_aaaaaaaaaa": 0.88},
            "overall": 0.8,
        },
        "reasons": {"w_aaaaaaaaaa": ["thin_evidence", "unconnected"]},
        "warnings": [
            {"code": "deskewed", "params": {"degrees": 1.5}, "entityIds": []},
            {"code": "walls_unconnected", "params": {"count": 2}, "entityIds": ["w_aaaaaaaaaa"]},
        ],
        "timings": {"ocr": 1200, "walls": 300, "totalMs": 2500},
        "ocrTokens": {
            "count": 40,
            "meanConfidence": 0.9,
            "metricDimensionTokens": 12,
            "imperialTokens": 0,
            "roomNameTokens": 4,
            "areaTokens": 1,
            "sample": ["3500", "LIVING"],
        },
        "counts": {"walls": 10, "openings": 4, "rooms": 3, "texts": 6, "candidatesWalls": 14},
    }


def test_meta_roundtrip() -> None:
    js = meta_js()
    meta = ImportResultMeta.model_validate(js)
    out = meta.wire()
    assert out == js
    assert out["metaVersion"] == 1
    assert out["pageImage"]["resampleFactor"] == 1.25
    assert out["scale"]["roomLabelCheck"]["medianDiscrepancyPct"] is None
    assert out["timings"]["totalMs"] == 2500
    assert out["ocrTokens"]["metricDimensionTokens"] == 12
    assert "inspect" not in out
    assert "review" not in out


def test_meta_laravel_added_fields_roundtrip() -> None:
    js = meta_js()
    js["inspect"] = {
        "isLikelyPhoto": False,
        "suggestedCorners": [[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]],
        "dxf": None,
    }
    js["review"] = {
        "reviewedIds": ["w_aaaaaaaaaa"],
        "scaleConfirmed": True,
        "unitConfirmed": False,
        "rescaleFactor": 1.0,
    }
    assert ImportResultMeta.model_validate(js).wire() == js


@pytest.mark.parametrize(
    ("path", "value"),
    [
        (["metaVersion"], 2),
        (["timings"], {"ocr": 5}),
        (["timings"], {"bogus": 5, "totalMs": 5}),
        (["warnings"], [{"code": "nope", "params": {}, "entityIds": []}]),
        (["reasons"], {"w_aaaaaaaaaa": ["nope"]}),
        (["confidence", "overall"], 1.2),
        (["providerUsed"], "gemini"),
        (["extra"], 1),
    ],
)
def test_meta_rejects_invalid(path: list[str], value: Any) -> None:
    js = meta_js()
    node: Any = js
    for key in path[:-1]:
        node = node[key]
    node[path[-1]] = value
    with pytest.raises(ValidationError):
        ImportResultMeta.model_validate(js)
