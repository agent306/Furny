# Task 26 — carries (binding; preflight.md + progress.md)

1. I1: also modify `vision/app/pipeline/labeling/base.py` — tighten `LabelingOutcome.calls: list[Any]` → `list[UsageCall]`; git add it.
2. c6 / T22: replace the local `JSON_SCHEMA_INSTRUCTION_TEMPLATE` copy in `app/api/providers.py` with the import from the prompts module this task creates (delete the duplicate).
3. K12: use `turn.assistant.text` / `turn.assistant.tool_calls` (TurnResult(assistant, stop_reason, usage)); `make_turn(text, tool_calls, …)` builds the AssistantMessage.
4. K17: the runner writes `07-labeling.json` after ANY labeler from the `LabelingOutcome` (result, notes, calls, empty transcript for heuristic). `LlmLabeler` supplies only the transcript summary — do not make LlmLabeler write the artifact itself in a way that breaks the provider-`none` path (Task 31 asserts all 8 artifacts with provider `none`).
5. K18: `test_refusal_falls_back` and `test_unknown_ids_sanitised` go into a NEW `tests/test_agent.py` (Task 27 extends it). Move, don't copy.
6. I2: expose `complete_json(..., schema_model=…, effort=…, purpose=…)`, `SYSTEM_PROMPT_DXF_LAYERS`, `USER_PROMPT_DXF_LAYERS_TEMPLATE` for Task 28 (only if the brief defines them here).
7. Task 21 carry: MissedRoom/MissedOpening (x, y) from the LLM are overview px — convert to normalized-page px with Task 23's `from_overview` (÷ s + offset) before they reach assembly (06 §8.7 step 2). Test with a non-zero offset.
8. Task 25 carry: enforce the labeler's own outer deadline (06 §9.6 "labeling degrades instead of failing") — compat calls ignore a shorter caller `timeout_s`. Move `_new_images` from `anthropic_provider.py` to a shared module (e.g. providers/base.py or providers/images.py) and update both adapters. Add a test asserting `openai_provider.INVALID_JSON == INVALID_JSON_SENTINEL`.
9. Never log prompts or model responses; coordinates exchanged with models are absolute integer overview px.
