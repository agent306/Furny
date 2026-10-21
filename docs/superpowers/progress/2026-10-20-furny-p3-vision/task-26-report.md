# Task 26 report: prompts and LLM labeler (single pass, prompt-JSON, repair, sanitize, fallback)

Status: DONE_WITH_CONCERNS (see Concerns). Commits: `77ea983` refactor, then feat + this report.

## Implemented
- `vision/app/pipeline/labeling/prompts.py`: `SYSTEM_PROMPT_LABELING`, `USER_PROMPT_LABELING_TEMPLATE`, `TOOLS_BLOCK_TEMPLATE`, `FINALIZE_PROMPT`, `REPAIR_PROMPT_TEMPLATE`, `JSON_SCHEMA_INSTRUCTION_TEMPLATE`, `SYSTEM_PROMPT_DXF_LAYERS`, `USER_PROMPT_DXF_LAYERS_TEMPLATE`, `build_user_prompt(...)`. The block texts were generated from the spec file by script and compared back with it (`verbatim ok`, run once outside the test suite).
- `vision/app/pipeline/labeling/llm.py`: `LabelerOptions`, `LlmLabeler`, `sanitize`, `complete_json`.
  - `complete_json` runs one structured call (`tools=[]`, `tool_choice="none"`). The schema goes in `output_schema` (name `floor_plan_labels`, else the snake-cased model name) when the provider supports it; otherwise `JSON_SCHEMA_INSTRUCTION_TEMPLATE` is appended to the system prompt. Parse errors get one repair round (`REPAIR_PROMPT_TEMPLATE`, up to 20 `loc: msg` lines) only for providers without a native schema; a native-schema provider gets `ProviderInvalidOutput` straight away (06 §9.6 step 2e). `stop_reason` refusal / max_tokens raise `ProviderRefusal` / `ProviderInvalidOutput`. Errors carry `.usage` = earlier calls + the failing call.
  - `LlmLabeler.label`: `supports_vision=False` goes to the heuristic labeler (`vision_unsupported`, no call). Agentic mode (`agentic_crops and supports_tools`) raises `NotImplementedError` until Task 27. Otherwise it builds the overview, sends `[clean, marked, text]` (only `marked` when `max_images_per_request < 2`), sanitizes, converts the missed rooms and openings from overview px to normalized px, and returns the outcome. Any `ProviderError`, or a dropped ratio above 20 %, takes the fallback: with `fallback_to_none` the heuristic labels, `provider_used="none"`, `fallback_reason`, warning `llm_failed_fallback_none {"reason"}` and the calls kept; otherwise `VisionError("provider_error")` (502, retryable, `details={"reason"}`, `usage` = wire `Usage` with `status="failed"`).
- `labeling/base.py`: `LabelingOutcome.calls: list[UsageCall]`, new `transcript` field (default `[]`), and `debug_summary()` (body of `07-labeling.json`).
- `api/providers.py`: local template copy deleted, imported from the prompts module.
- Refactor commit `77ea983`: `_new_images` became `new_images` in `providers/base.py`; both adapters use it.

## Files
Changed: `vision/app/pipeline/labeling/{prompts,llm,base}.py`, `vision/app/api/providers.py`, `vision/app/providers/{base,anthropic_provider,openai_provider}.py`.
Tests: `vision/tests/test_llm_labeler.py`, `vision/tests/test_agent.py` (new), `vision/tests/providers/test_compat_single_pass.py`, `vision/tests/support/llm_labeling.py`.

## TDD evidence
RED (before `llm.py` / `prompts.py` existed):
```
ERROR tests/test_llm_labeler.py   - ImportError: cannot import name 'llm' from 'app.pipeline.labeling'
ERROR tests/test_agent.py         - ModuleNotFoundError: No module named 'app.pipeline.labeling.llm'
ERROR tests/providers/test_compat_single_pass.py - ModuleNotFoundError: No module named 'app.pipeline.labeling.llm'
3 errors in 10.50s
```
GREEN, the three new files: `34 passed in 1.76s`. During implementation, tests were corrected once for my own wrong expectations (heuristic unit system is `unknown` for one mm token; the unknown-id test had to stay under the 20 % drop limit).

## Gate (WSL, venv furny-vision-p3)
`ruff check .` clean, `ruff format --check .` 128 files formatted, `mypy app` strict: no issues in 74 files, `pytest -q`: 1346 passed, 1 skipped, 3 xfailed (pre-existing), 0 failed. No walls_closure flake. No dependency change.

## Carries
1. I1: `calls: list[UsageCall]` in `base.py` (staged).
2. c6/T22: duplicate template deleted from `api/providers.py`, imports `prompts.JSON_SCHEMA_INSTRUCTION_TEMPLATE`.
3. K12: code uses `turn.assistant.text` / `.tool_calls`, `turn.usage`, `turn.stop_reason`; tests use `make_turn`.
4. K17: `LlmLabeler` writes no artifact. The outcome has `transcript` (summary per call, tool calls empty until Task 27) and `debug_summary()`, so the runner can write `07-labeling.json` for any labeler (heuristic: empty transcript, no calls). Test covers both.
5. K18: `test_refusal_falls_back` and `test_unknown_ids_sanitised` live only in new `tests/test_agent.py`.
6. I2: `complete_json(schema_model=, effort=, purpose=)`, `SYSTEM_PROMPT_DXF_LAYERS`, `USER_PROMPT_DXF_LAYERS_TEMPLATE` exist; test with `LayerMapping` (schema name `layer_mapping`).
7. Overview px to normalized: `from_overview`, rounded to int. Test: scale 0.5, offset (40, 30): (100, 60) becomes (240, 150) and (50, 20) becomes (140, 70).
8. Task 25 carry: each call runs in a daemon thread and is abandoned after `min(call_timeout_s, stage/request budget) + 2 s` grace (`DEADLINE_GRACE_S`); the LLM stage deadline is `min(ctx.deadline - 60, now + stage_budget_s)`; no budget left means no call. Tests: hanging provider, exhausted budget, timeout capped by the stage budget. `_new_images` moved (refactor commit). `openai_provider.INVALID_JSON == INVALID_JSON_SENTINEL` asserted.
9. No prompts, responses or image bytes are logged or placed in error messages (fixed strings only; repair prompts list `loc: msg`, never values).

## Deviations / decisions
- `VisionError.usage` is the wire `Usage` (06 §14.2 `usage: Usage | null`), not a raw list of `UsageCall`; `err.usage.calls` holds the calls. A raw dataclass list would be emitted snake_case by the error handler.
- `complete_json` takes two extra keywords: `max_output_tokens` (default 32000) and `deadline` (absolute monotonic; default `ctx.deadline`). The labeler passes its stage deadline.
- Sanitize: unknown `spanId` / `nameTextId` / `knownDimensionMatch` ids are nulled and not counted as drops (the entry is still usable); unknown own ids, repeated ids and `missedOpenings` with an unknown wall are dropped and counted. The ratio is dropped / all id-bearing entries the model returned. Also clamped like `valueMm` (50..60000, else null): room `widthMm` / `depthMm` (spec silent). Heuristic dimension labels are added only for texts the model did not list and whose final role is `dimension`. Missed rooms/openings are never merged with heuristic ones (different coordinate space).
- Output order follows the candidate lists (model label if present, else heuristic).
- Heuristic helper pass for sanitize runs on a scratch `PipelineContext`; a successful LLM run gets none of its warnings (`unit_system_guessed`, `known_dimension_unmatched`). On fallback the heuristic runs again on the real context.
- Prompt text kept literally, including the `\"` in the OCR example line (backslash plus quote), as the spec's block shows it.
- `vision_unsupported` adds no `llm_failed_fallback_none` warning (not an error; spec 06 §9.1 asks for the reason only).
- Prompt-JSON schema in the system prompt is compact JSON (`separators=(",", ":")`).
- Outcome `model` is the model of the last call (the served model), not `provider.model`.

## Concerns
- An abandoned (timed-out) call keeps running in its daemon thread until the SDK timeout, and its usage is not recorded (not billed in our ledger). Bounded by one thread per timed-out call.
- Agentic mode raises `NotImplementedError` (by design until Task 27); Task 31 must not enable `agentic_crops` before then.
- `07-labeling.json` is not written here; Task 31 must call `outcome.debug_summary()`.
