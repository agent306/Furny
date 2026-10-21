"""The prompt-JSON path end to end (18 §7.3, §17.1): the real OpenAI-compatible adapter over a mock transport,
driven by the LLM labeler. No `response_format`, fenced JSON, one repair round, then the fallback."""

import json
from typing import Any

from app.pipeline.labeling.llm import LlmLabeler
from app.pipeline.labeling.prompts import JSON_SCHEMA_INSTRUCTION_TEMPLATE, SYSTEM_PROMPT_LABELING
from app.providers.openai_compatible_provider import OpenAICompatibleProvider
from app.schemas.api import RecognizeHints
from app.schemas.labeling import LabelingResult
from app.utils.json_schema import to_strict_schema
from tests.providers.openai_support import Harness, base_settings, completion
from tests.support.llm_labeling import full_result, make_ctx, options, scene

MODEL = "qwen-vl-local"


def provider_for(h: Harness) -> OpenAICompatibleProvider:
    s = base_settings(openai_compat_base_url="http://llm.local/v1", openai_compat_model=MODEL)
    return OpenAICompatibleProvider(s, MODEL, http_client=h.client(), max_retries=0)


def say(text: str) -> dict[str, Any]:
    return completion({"role": "assistant", "content": text}, model=None, no_usage=True)


def fenced(payload: object) -> str:
    return "```json\n" + json.dumps(payload) + "\n```"


def run(h: Harness, **opt: Any) -> tuple[Any, Any]:
    page, cs = scene()
    ctx = make_ctx()
    outcome = LlmLabeler(provider_for(h), options(**opt)).label(page, cs, RecognizeHints(), ctx)
    return outcome, ctx


def test_compat_single_pass_prompt_json() -> None:
    _, cs = scene()
    bad = {"unitSystem": "metric", "texts": [{}] * 25}  # missing fields: far more than 20 error lines
    good = full_result(cs).model_dump(mode="json", by_alias=True)
    h = Harness([say(fenced(bad)), say(fenced(good))])

    outcome, ctx = run(h)

    first, second = h.bodies
    schema_json = json.dumps(to_strict_schema(LabelingResult), separators=(",", ":"))
    system = first["messages"][0]
    assert system["role"] == "system"
    assert system["content"] == SYSTEM_PROMPT_LABELING + "\n\n" + JSON_SCHEMA_INSTRUCTION_TEMPLATE.format(
        schema_json=schema_json
    )
    for body in (first, second):
        assert "response_format" not in body and "tools" not in body and "tool_choice" not in body

    # only the marked image: max_images_per_request = 1
    user = first["messages"][1]
    assert [p["type"] for p in user["content"]] == ["image_url", "text"]
    assert 'The image is "marked".' in user["content"][1]["text"]

    repair = second["messages"][-1]
    assert repair["role"] == "user"
    text = repair["content"][0]["text"]
    assert text.startswith("Your previous answer was not valid for the required schema. Errors:\n")
    lines = text.split("\n")[1:-1]  # between the header and the closing instruction
    assert 1 <= len(lines) <= 20
    assert len(lines) == 20  # 25 bad texts produce many more
    assert all(": " in line for line in lines)
    assert text.endswith("Return ONLY the corrected JSON object, with no other text.")
    assert second["messages"][-2]["role"] == "assistant"

    assert outcome.provider_used == "openai_compatible"
    assert outcome.fallback_reason is None
    assert [c.purpose for c in outcome.calls] == ["labeling", "repair"]
    assert [w.code for w in ctx.warnings] == ["llm_output_repaired"]
    assert [w.id for w in outcome.result.walls] == ["W1", "W2", "W3", "W4", "W5", "W6"]


def test_compat_fenced_json_without_error_needs_no_repair() -> None:
    _, cs = scene()
    good = full_result(cs).model_dump(mode="json", by_alias=True)
    h = Harness([say("Here you go:\n" + fenced(good) + "\nHope that helps.")])

    outcome, ctx = run(h)

    assert len(h.requests) == 1
    assert outcome.fallback_reason is None
    assert ctx.warnings == []


def test_compat_both_answers_invalid_falls_back() -> None:
    h = Harness([say(fenced({"unitSystem": "metric"})), say("no json at all")])

    outcome, ctx = run(h)

    assert len(h.requests) == 2
    assert outcome.provider_used == "none"
    assert outcome.fallback_reason == "llm_invalid_output"
    assert [c.purpose for c in outcome.calls] == ["labeling", "repair"]
    assert [w.params for w in ctx.warnings if w.code == "llm_failed_fallback_none"] == [
        {"reason": "llm_invalid_output"}
    ]
    assert "llm_output_repaired" not in [w.code for w in ctx.warnings]


def test_compat_repair_prompt_names_json_errors() -> None:
    h = Harness([say("no json at all"), say("still none")])
    run(h)
    text = h.bodies[1]["messages"][-1]["content"][0]["text"]
    assert "no JSON object found" in text


def test_compat_sends_no_tools_even_when_agentic_is_requested() -> None:
    _, cs = scene()
    h = Harness([say(fenced(full_result(cs).model_dump(mode="json", by_alias=True)))])
    outcome, _ = run(h, agentic_crops=True)  # compat has supports_tools = false: single pass
    assert outcome.fallback_reason is None
    assert "tools" not in h.bodies[0]
