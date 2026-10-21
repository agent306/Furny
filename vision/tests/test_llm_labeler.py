"""Task 26: prompts, the LLM labeler (single pass), sanitize, fallback and the labeler's own deadline.

The refusal and unknown-id tests live in ``test_agent.py`` (Task 27 extends that file). Providers are
``FakeProvider`` doubles; nothing here touches the network.
"""

import json
import threading
import time
from dataclasses import replace
from typing import Any

import pytest

from app.api.errors import VisionError
from app.pipeline.annotate import build_overview, compact_json
from app.pipeline.labeling import llm
from app.pipeline.labeling.base import LabelingOutcome
from app.pipeline.labeling.llm import LlmLabeler, complete_json, sanitize
from app.pipeline.labeling.prompts import (
    FINALIZE_PROMPT,
    JSON_SCHEMA_INSTRUCTION_TEMPLATE,
    REPAIR_PROMPT_TEMPLATE,
    SYSTEM_PROMPT_DXF_LAYERS,
    SYSTEM_PROMPT_LABELING,
    USER_PROMPT_DXF_LAYERS_TEMPLATE,
    build_user_prompt,
)
from app.pipeline.labeling.tools import INVALID_JSON_SENTINEL
from app.providers import openai_provider
from app.providers.base import ImagePart, TextPart, UsageCall, UserMessage
from app.providers.errors import ProviderAuthError, ProviderTimeout, ProviderUnavailable
from app.providers.testing import FULL_CAPABILITIES, FakeProvider
from app.schemas.api import KnownDimension, RecognizeHints
from app.schemas.labeling import (
    LabelingResult,
    LayerMapping,
    MissedOpening,
    MissedRoom,
    RoomLabel,
    TextLabel_,
    WallLabel,
)
from app.utils.json_schema import to_strict_schema
from tests.support.labeling import checked
from tests.support.llm_labeling import (
    failed_call,
    full_result,
    make_ctx,
    options,
    reply,
    scene,
    with_,
)


def run(
    provider: FakeProvider, *, hints: RecognizeHints | None = None, **opt: Any
) -> tuple[LabelingOutcome, Any]:
    page, cs = scene()
    ctx = make_ctx()
    outcome = LlmLabeler(provider, options(**opt)).label(page, cs, hints or RecognizeHints(), ctx)
    return outcome, ctx


def warning_codes(ctx: Any) -> list[str]:
    return [w.code for w in ctx.warnings]


# --- prompts --------------------------------------------------------------------------------------------


def test_prompts_verbatim() -> None:
    assert SYSTEM_PROMPT_LABELING.startswith("You are an expert architectural draftsperson")
    assert SYSTEM_PROMPT_LABELING.endswith("Answer ONLY with the JSON object required by the output schema.")
    assert (
        "\n- Furniture symbols (beds, sofas, dining tables, WC pans, basins, kitchen counters, wardrobes) "
        "are not walls.\n" in SYSTEM_PROMPT_LABELING
    )
    assert FINALIZE_PROMPT == (
        "Stop using tools now. Using what you have seen so far, return the final JSON object that matches "
        "the output schema."
    )
    assert REPAIR_PROMPT_TEMPLATE == (
        "Your previous answer was not valid for the required schema. Errors:\n{errors}\n"
        "Return ONLY the corrected JSON object, with no other text."
    )
    assert JSON_SCHEMA_INSTRUCTION_TEMPLATE == (
        "Output format: a single JSON object, no markdown fences, no commentary, that validates against "
        "this JSON Schema:\n{schema_json}"
    )
    assert SYSTEM_PROMPT_DXF_LAYERS.startswith("You map CAD layer names of an architectural floor-plan DXF")
    assert SYSTEM_PROMPT_DXF_LAYERS.endswith(
        "Answer only with the JSON object required by the output schema."
    )
    assert USER_PROMPT_DXF_LAYERS_TEMPLATE.endswith("sample texts):\n{layer_table}")


def test_user_prompt_hints() -> None:
    page, cs = scene()
    ov = build_overview(page, cs, max_image_px=2576, ctx=make_ctx())
    hints = RecognizeHints(
        unit_system="imperial", known_dimension=KnownDimension(label="Overall", mm=11000), is_photo=True
    )
    text = build_user_prompt(ov, hints, two_images=True, tools=False, max_crops=8)
    assert f"Drawing size in this image: {ov.width} x {ov.height} pixels." in text
    assert 'Image 1 is "clean", image 2 is "marked".' in text
    assert "- Unit system: imperial (feet and inches)" in text
    assert '- Known measurement: "Overall" = 11000 mm' in text
    assert "- This is a photo of a paper drawing: yes" in text
    assert f"Candidates (JSON):\n{ov.candidates_json}\n" in text
    assert "You can inspect details" not in text
    assert text.endswith("Use only IDs that appear in the candidate list.")

    one = build_user_prompt(ov, RecognizeHints(), two_images=False, tools=True, max_crops=3)
    assert 'The image is "marked".' in one
    assert "Image 1 is" not in one
    assert "- Unit system: not given" in one
    assert "- Known measurement: not given" in one
    assert "- This is a photo of a paper drawing: no" in one
    assert "You may call at most 3 crops." in one
    assert "metric (millimetres)" in build_user_prompt(
        ov, RecognizeHints(unit_system="metric"), two_images=True, tools=False, max_crops=8
    )


# --- single pass ----------------------------------------------------------------------------------------


def test_single_pass_success() -> None:
    _, cs = scene()
    provider = FakeProvider([reply(full_result(cs))])
    outcome, ctx = run(provider, max_output_tokens=12345, effort="low")

    assert outcome.provider_used == "anthropic"
    assert outcome.model == "fake-model"  # the model that served the call
    assert outcome.fallback_reason is None
    assert outcome.partial is False
    assert [c.purpose for c in outcome.calls] == ["labeling"]
    assert warning_codes(ctx) == []
    checked(outcome.result)

    (call,) = provider.calls
    assert call["output_schema"].name == "floor_plan_labels"
    assert call["output_schema"].schema == to_strict_schema(LabelingResult)
    assert call["tools"] == []
    assert call["tool_choice"] == "none"
    assert call["system"] == SYSTEM_PROMPT_LABELING
    assert (call["purpose"], call["effort"], call["max_output_tokens"]) == ("labeling", "low", 12345)
    (message,) = call["conversation"]
    assert isinstance(message, UserMessage)
    clean, marked, prompt = message.parts
    assert isinstance(clean, ImagePart) and isinstance(marked, ImagePart)
    assert clean.data != marked.data
    assert isinstance(prompt, TextPart)
    assert 'Image 1 is "clean", image 2 is "marked".' in prompt.text
    assert "You can inspect details" not in prompt.text


def test_one_image_provider_gets_only_the_marked_image() -> None:
    _, cs = scene()
    caps = replace(FULL_CAPABILITIES, max_images_per_request=1, max_image_px=200)
    provider = FakeProvider([reply(full_result(cs))], capabilities=caps)
    run(provider)

    parts = provider.calls[0]["conversation"][0].parts
    assert [type(p) for p in parts] == [ImagePart, TextPart]
    assert 'The image is "marked".' in parts[1].text
    # max_image_px 200 on a 400x300 page: s = 0.5 and the 320x240 plan region becomes 160x120.
    assert '"image":{"width":160,"height":120}' in parts[1].text


def test_overview_coordinates_are_converted_back_to_normalized_px() -> None:
    _, cs = scene()
    result = with_(
        full_result(cs),
        missed_rooms=[MissedRoom(name="Kitchen", type="kitchen", x=100, y=60)],
        missed_openings=[MissedOpening(kind="window", wall_id="W1", x=50, y=20)],
    )
    caps = replace(FULL_CAPABILITIES, max_image_px=200)  # s = 0.5, region offset (40, 30)
    outcome, _ = run(FakeProvider([reply(result)], capabilities=caps))

    assert [(m.x, m.y) for m in outcome.result.missed_rooms] == [(240, 150)]  # 100/0.5+40, 60/0.5+30
    assert [(m.x, m.y) for m in outcome.result.missed_openings] == [(140, 70)]
    assert outcome.fallback_reason is None


def test_native_schema_provider_gets_no_repair_round() -> None:
    provider = FakeProvider([reply('{"unitSystem": "metric"}')])
    outcome, ctx = run(provider)

    assert (
        len(provider.calls) == 1
    )  # 06 section 9.6 step 2e: invalid output under a schema is a provider fault
    assert outcome.provider_used == "none"
    assert outcome.fallback_reason == "llm_invalid_output"
    assert [c.purpose for c in outcome.calls] == ["labeling"]
    assert "llm_output_repaired" not in warning_codes(ctx)


def test_prompt_json_provider_gets_the_schema_in_the_system_prompt_and_one_repair() -> None:
    _, cs = scene()
    caps = replace(FULL_CAPABILITIES, supports_json_schema=False, supports_tools=False)
    provider = FakeProvider([reply("```json\n{}\n```"), reply(full_result(cs))], capabilities=caps)
    outcome, ctx = run(provider)

    schema_json = json.dumps(to_strict_schema(LabelingResult), separators=(",", ":"))
    first, second = provider.calls
    assert first["output_schema"] is None
    assert first["system"] == SYSTEM_PROMPT_LABELING + "\n\n" + JSON_SCHEMA_INSTRUCTION_TEMPLATE.format(
        schema_json=schema_json
    )
    assert second["purpose"] == "repair"
    last = second["conversation"][-1]
    assert isinstance(last, UserMessage)
    assert isinstance(last.parts[0], TextPart)
    assert last.parts[0].text.startswith(
        "Your previous answer was not valid for the required schema. Errors:\n"
    )
    assert outcome.provider_used == "anthropic"
    assert "llm_output_repaired" in warning_codes(ctx)


# --- fallback -------------------------------------------------------------------------------------------


def test_fallback_disabled_raises() -> None:
    call = failed_call()
    provider = FakeProvider([ProviderUnavailable("down", usage=[call])])
    page, cs = scene()
    labeler = LlmLabeler(provider, options(fallback_to_none=False))

    with pytest.raises(VisionError) as caught:
        labeler.label(page, cs, RecognizeHints(), make_ctx())

    err = caught.value
    assert err.code == "provider_error"
    assert err.http_status == 502
    assert err.retryable is True
    assert err.usage.status == "failed"
    assert [(c.purpose, c.status) for c in err.usage.calls] == [("labeling", "failed")]
    assert err.details == {"reason": "llm_error"}


def test_vision_unsupported() -> None:
    caps = replace(FULL_CAPABILITIES, supports_vision=False)
    provider = FakeProvider([], capabilities=caps)
    outcome, ctx = run(provider)

    assert provider.calls == []
    assert outcome.provider_used == "none"
    assert outcome.model is None
    assert outcome.fallback_reason == "vision_unsupported"
    assert outcome.calls == []
    assert outcome.partial is False
    assert outcome.result.walls  # the heuristic labels
    assert "llm_failed_fallback_none" not in warning_codes(ctx)


def test_auth_error_reason() -> None:
    outcome, ctx = run(FakeProvider([ProviderAuthError("bad key")]))

    assert outcome.provider_used == "none"
    assert outcome.fallback_reason == "provider_auth_failed"
    assert [(w.code, w.params) for w in ctx.warnings if w.code == "llm_failed_fallback_none"] == [
        ("llm_failed_fallback_none", {"reason": "provider_auth_failed"})
    ]


def test_timeout_error_reason() -> None:
    outcome, _ = run(FakeProvider([ProviderTimeout("slow")]))
    assert outcome.fallback_reason == "llm_timeout"


def test_fallback_keeps_the_failed_and_earlier_calls() -> None:
    caps = replace(FULL_CAPABILITIES, supports_json_schema=False)
    first = reply("not json")
    provider = FakeProvider(
        [first, ProviderTimeout("slow", usage=[failed_call("repair")])], capabilities=caps
    )
    outcome, _ = run(provider)

    assert outcome.fallback_reason == "llm_timeout"
    assert [(c.purpose, c.status) for c in outcome.calls] == [("labeling", "succeeded"), ("repair", "failed")]


def test_heuristic_warnings_do_not_leak_into_a_successful_llm_run() -> None:
    _, cs = scene()
    outcome, ctx = run(FakeProvider([reply(full_result(cs))]))
    assert outcome.fallback_reason is None
    assert warning_codes(ctx) == []  # no unit_system_guessed / known_dimension_unmatched from the helper pass


def test_fallback_runs_the_heuristic_with_its_warnings() -> None:
    outcome, ctx = run(FakeProvider([ProviderTimeout("slow")]))
    assert (
        outcome.result.unit_system == "unknown"
    )  # a single mm token is no evidence (heuristic, 06 section 9.7)
    assert warning_codes(ctx).count("llm_failed_fallback_none") == 1


# --- the labeler's own deadline -------------------------------------------------------------------------


def test_slow_provider_is_cut_off_by_the_labelers_own_deadline(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(llm, "DEADLINE_GRACE_S", 0.05)
    _, cs = scene()
    release = threading.Event()

    def hang(_conversation: Any) -> Any:
        release.wait(10)
        return reply(full_result(cs))

    started = time.monotonic()
    try:
        outcome, _ = run(FakeProvider([hang]), call_timeout_s=0.1)
    finally:
        release.set()

    assert time.monotonic() - started < 3
    assert outcome.provider_used == "none"
    assert outcome.fallback_reason == "llm_timeout"


def test_exhausted_stage_budget_makes_no_call() -> None:
    page, cs = scene()
    provider = FakeProvider([])
    # 06 section 9.6: the LLM stage ends 60 s before the request deadline.
    outcome = LlmLabeler(provider, options()).label(page, cs, RecognizeHints(), make_ctx(seconds=30))

    assert provider.calls == []
    assert outcome.fallback_reason == "llm_timeout"


def test_call_timeout_is_capped_by_the_stage_budget() -> None:
    _, cs = scene()
    provider = FakeProvider([reply(full_result(cs))])
    run(provider, call_timeout_s=180.0, stage_budget_s=5.0)
    assert provider.calls[0]["timeout_s"] <= 5.0


# --- agentic mode (Task 27) -----------------------------------------------------------------------------


def test_agentic_mode_is_selected_for_tool_providers() -> None:
    page, cs = scene()
    labeler = LlmLabeler(FakeProvider([]), options(agentic_crops=True))
    with pytest.raises(NotImplementedError):
        labeler.label(page, cs, RecognizeHints(), make_ctx())


def test_agentic_flag_without_tool_support_stays_single_pass() -> None:
    _, cs = scene()
    caps = replace(FULL_CAPABILITIES, supports_tools=False)
    provider = FakeProvider([reply(full_result(cs))], capabilities=caps)
    outcome, _ = run(provider, agentic_crops=True)
    assert outcome.fallback_reason is None


# --- sanitize -------------------------------------------------------------------------------------------


def test_sanitize_clamps_truncates_and_fills_from_the_heuristic() -> None:
    page, cs = scene()
    from app.pipeline.labeling.heuristic import HeuristicLabeler

    heuristic = HeuristicLabeler().label(page, cs, RecognizeHints(), make_ctx()).result
    raw = with_(
        full_result(cs),
        notes="n" * 600,
        dimensions=[
            full_result(cs).dimensions[0].model_copy(update={"value_mm": 49}),
            full_result(cs).dimensions[0].model_copy(update={"value_mm": 60001}),
        ],
        rooms=[
            RoomLabel(
                id="R1",
                include=True,
                name="x" * 75,
                type="bedroom",
                name_text_id="T99",
                size_text=None,
                width_mm=None,
                depth_mm=None,
            )
        ],
        missed_rooms=[MissedRoom(name="y" * 75, type="other", x=1, y=2)],
        walls=[WallLabel(id="W1", verdict="not_wall", kind=None)],
    )
    clean, ratio = sanitize(raw, cs, heuristic)

    assert clean.notes == "n" * 500
    assert [d.value_mm for d in clean.dimensions] == [None]  # the second entry repeats text T2: first wins
    assert ratio == pytest.approx(1 / (2 + 2 + 1 + 1 + 1))  # one duplicate in 7 id-bearing entries
    assert [r.id for r in clean.rooms] == ["R1", "R2"]
    assert clean.rooms[0].name == "x" * 60
    assert clean.rooms[0].name_text_id is None  # an unknown text id is cleared, not a reason to drop the room
    assert clean.rooms[1] == next(r for r in heuristic.rooms if r.id == "R2")
    assert clean.missed_rooms[0].name == "y" * 60
    assert clean.walls[0].verdict == "not_wall"  # the model's label wins for what it mentioned
    assert [w for w in clean.walls[1:]] == [w for w in heuristic.walls if w.id != "W1"]
    assert [t.id for t in clean.texts] == ["T1", "T2"]
    assert [o.id for o in clean.openings] == ["O1"]


def test_sanitize_value_mm_bounds_are_inclusive() -> None:
    page, cs = scene()
    from app.pipeline.labeling.heuristic import HeuristicLabeler

    heuristic = HeuristicLabeler().label(page, cs, RecognizeHints(), make_ctx()).result
    base = full_result(cs).dimensions[0]
    for value, expected in ((50, 50), (60000, 60000), (70000, None), (-5, None)):
        raw = with_(full_result(cs), dimensions=[base.model_copy(update={"value_mm": value})])
        clean, _ = sanitize(raw, cs, heuristic)
        assert clean.dimensions[0].value_mm == expected


def test_sanitize_clears_unknown_span_and_known_dimension_ids() -> None:
    page, cs = scene()
    from app.pipeline.labeling.heuristic import HeuristicLabeler
    from app.schemas.labeling import KnownDimensionMatch

    heuristic = HeuristicLabeler().label(page, cs, RecognizeHints(), make_ctx()).result
    raw = with_(
        full_result(cs),
        dimensions=[full_result(cs).dimensions[0].model_copy(update={"span_id": "D77"})],
        known_dimension_match=KnownDimensionMatch(wall_id="W1", span_id="D77"),
    )
    clean, ratio = sanitize(raw, cs, heuristic)

    assert clean.dimensions[0].span_id is None
    assert clean.known_dimension_match == KnownDimensionMatch(wall_id="W1", span_id=None)
    assert ratio == 0


def test_sanitize_adds_heuristic_dimensions_only_for_texts_the_model_calls_dimensions() -> None:
    page, cs = scene()
    from app.pipeline.labeling.heuristic import HeuristicLabeler

    heuristic = HeuristicLabeler().label(page, cs, RecognizeHints(), make_ctx()).result
    assert [d.text_id for d in heuristic.dimensions] == ["T2"]  # the scene's heuristic reading
    omitted = with_(full_result(cs), dimensions=[])

    kept, _ = sanitize(
        with_(omitted, texts=[TextLabel_(id="T2", role="dimension", normalized_text="3300")]), cs, heuristic
    )
    ignored, _ = sanitize(
        with_(omitted, texts=[TextLabel_(id="T2", role="ignore", normalized_text=None)]), cs, heuristic
    )

    assert [d.text_id for d in kept.dimensions] == ["T2"]
    assert ignored.dimensions == []


# --- complete_json (shared with the DXF layer mapping, Task 28) -----------------------------------------


def test_complete_json_returns_the_model_calls_and_repair_flag() -> None:
    provider = FakeProvider([reply('{"layers": [{"name": "A-WALL", "role": "wall"}]}')])
    parsed, calls, repaired = complete_json(
        provider,
        [UserMessage([TextPart("layers")])],
        system="SYS",
        schema_model=LayerMapping,
        effort="low",
        timeout_s=5,
        purpose="dxf_layers",
        ctx=make_ctx(),
    )

    assert isinstance(parsed, LayerMapping)
    assert parsed.layers[0].name == "A-WALL"
    assert repaired is False
    assert len(calls) == 1
    call = provider.calls[0]
    assert call["output_schema"].name == "layer_mapping"
    assert call["purpose"] == "dxf_layers"
    assert call["tool_choice"] == "none"
    assert call["system"] == "SYS"


# --- cross-task contracts -------------------------------------------------------------------------------


def test_invalid_json_sentinel_is_shared_with_the_openai_adapter() -> None:
    assert openai_provider.INVALID_JSON == INVALID_JSON_SENTINEL


def test_outcome_debug_summary_has_no_images_and_an_empty_transcript_for_heuristic() -> None:
    page, cs = scene()
    from app.pipeline.labeling.heuristic import HeuristicLabeler

    heuristic = HeuristicLabeler().label(page, cs, RecognizeHints(), make_ctx())
    summary = heuristic.debug_summary()
    assert summary["providerUsed"] == "none"
    assert summary["transcript"] == []
    assert summary["calls"] == []
    assert summary["result"]["unitSystem"] == "unknown"

    outcome, _ = run(FakeProvider([reply(full_result(cs))]))
    summary = outcome.debug_summary()
    assert summary["transcript"] == [
        {"purpose": "labeling", "stopReason": "end_turn", "status": "succeeded", "images": 0, "toolCalls": []}
    ]
    assert summary["calls"][0]["purpose"] == "labeling"
    json.dumps(summary)  # serialisable as is
    assert compact_json(summary["notes"]) == "null"


def test_calls_are_typed_usage_calls() -> None:
    _, cs = scene()
    outcome, _ = run(FakeProvider([reply(full_result(cs))]))
    assert all(isinstance(c, UsageCall) for c in outcome.calls)
