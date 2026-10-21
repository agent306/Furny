# Task 27 report: agentic crop loop

Status: DONE_WITH_CONCERNS (concerns at the end).

## Implemented
- `vision/app/pipeline/labeling/agent.py` (new): `run_agent(provider, system, user_parts, executor, schema, effort, ctx, *, max_turns, max_crops, call_timeout_s, stage_budget_s, max_output_tokens, transcript=None) -> (LabelingResult, list[UsageCall], repaired)`.
  - Stage deadline `min(ctx.deadline - 60, now + stage_budget_s)`. Turn `k` is the finalize turn when `k == max_turns` or less than 30 s of stage time is left (so `ctx.deadline = now + 85` finalizes on the first call).
  - Normal turns: purpose `agent_turn`, `tool_choice="auto"`, tools = both specs, `timeout_s = min(call_timeout_s, stage remaining)`. Finalize turn: a separate `UserMessage([TextPart(FINALIZE_PROMPT)])` appended after the results, `tool_choice="none"`, purpose `finalize`.
  - The assistant message is appended exactly as returned; all tool results of one turn go in one `ToolResultsMessage`. The history is only appended to; each provider call gets a list copy (an abandoned call may still be reading its own).
  - Tool calls go through `ToolExecutor.execute` (crop budget, unknown tool, invalid args and `__invalid_json__` handled there). A tool that raises becomes `ToolResult(is_error, "tool failed")`; the exception text is not echoed.
  - Timeout in a non-final turn with an earlier assistant turn: one finalize call with a 60 s timeout (`min(60, ctx.remaining())`). A timeout in the finalize call, or with no earlier assistant turn, raises `ProviderTimeout`. `.usage` always holds every call made, in order, the timed-out ones included.
  - Final answer: parsed with `parse_json_object` and `model_validate`. Invalid with `supports_json_schema` raises `ProviderInvalidOutput`. Without it: one repair round (purpose `repair`, `REPAIR_PROMPT_TEMPLATE`, `tool_choice="none"`), then `ProviderInvalidOutput`. Refusal raises `ProviderRefusal`; `max_tokens` raises `ProviderInvalidOutput`.
  - A non-native provider gets the JSON-schema instruction appended to the system prompt, as in `complete_json`.
- `llm.py`:
  - `LlmLabeler.label` runs `run_agent` for `agentic_crops and supports_tools` (the `NotImplementedError` is gone). `_user_parts` is shared between single pass and agent (agent adds the tools block). Fallback takes `partial` and the transcript.
  - Partial: an agentic run that ended in `ProviderTimeout` with at least one succeeded call in `err.usage` falls back to the heuristic with `partial=True`, `fallback_reason="llm_timeout"`, warnings `llm_failed_fallback_none` and `llm_partial`. The model's partial labels are not reused.
  - `transcript_entry` (shared by both modes): the agent fills `toolCalls` with `{name, arguments}`. The `__invalid_json__` raw string is replaced by `{}`.
  - `_complete` (Task 26 ruling, carry 4): accepts `tools`/`tool_choice`; abandoned-call accounting (below); unexpected exceptions mapped.
- `tools.py` (Task 23 carries): the crop `w,h >= 16` check now runs after clamping; `list_candidates` rejects `w <= 0` or `h <= 0` regions with an is_error result.
- `tests/test_llm_labeler.py`: the obsolete `NotImplementedError` test was replaced by one asserting that agentic mode reaches the loop.

## Files changed
- `vision/app/pipeline/labeling/agent.py` (new)
- `vision/app/pipeline/labeling/llm.py`
- `vision/app/pipeline/labeling/tools.py`
- `vision/tests/test_agent.py` (extended; 28 tests now, 2 of them the Task 26 ones)
- `vision/tests/test_annotate_tools.py` (2 tests for carries 3a and 3c)
- `vision/tests/test_llm_labeler.py` (1 test replaced)
- this report

## TDD evidence
RED, before `agent.py` and the tool fixes existed:
```
tests/test_agent.py:15: in <module>
    from app.pipeline.labeling.agent import run_agent
E   ModuleNotFoundError: No module named 'app.pipeline.labeling.agent'
1 error in 1.50s

FAILED tests/test_annotate_tools.py::test_crop_sliver_after_clamping_is_rejected
FAILED tests/test_annotate_tools.py::test_list_candidates_rejects_empty_or_negative_region
2 failed, 23 passed in 5.60s
```
GREEN after the implementation: `tests/test_agent.py tests/test_annotate_tools.py` = `53 passed in 1.74s`; `tests/test_llm_labeler.py` = `27 passed`. The first run of the agent tests also flagged the obsolete `NotImplementedError` test (replaced, see above).

## Gate (WSL, venv furny-vision-p3)
`ruff check .` clean; `ruff format --check .` 129 files formatted; `mypy app` strict: no issues in 75 files; `pytest -q`: 1374 passed, 1 skipped, 3 xfailed, 0 failed (185 s). No walls_closure flake. No dependency change.

## Carries
1. K16: `test_invalid_json_arguments_are_a_tool_error` runs `{"__invalid_json__": ...}` through the loop: `ToolResult(is_error=True, "invalid JSON arguments")`, no crop spent.
2. K18: only `tests/test_agent.py` was extended; no parallel file.
3. 3a: `test_crop_sliver_after_clamping_is_rejected` (8 px remaining at the right edge, 10 px at the left). 3b: `test_invalid_crops_do_not_spend_the_budget_but_max_turns_ends_the_loop`: `crops_used == 0` after two invalid crops, `max_turns=3` ends with a finalize call. 3c: `test_list_candidates_rejects_empty_or_negative_region`. (The carry's line numbers ~640/686 did not match; the file is shorter, the logic was found by reading.)
4. 4a: late completion of an abandoned call logs `purpose`, `inputTokens`, `outputTokens` on logger `furny.vision.llm` (requestId comes from the copied contextvar through the JSON formatter); test asserts the response text is absent from the captured logs. 4b: `MAX_ABANDONED_CALLS = 4`; a module-level counter under a lock. At 4 or more abandoned calls in flight `_complete` raises `ProviderError(code="llm_error", retryable=True)` without calling the provider, and the labeler degrades with `fallback_reason="llm_error"`. 4c: a non-`ProviderError` `Exception` in the provider call becomes `ProviderError(code="llm_error", retryable=True)` (fixed message, no exception text), so both modes degrade instead of returning 500. `BaseException`s (not `Exception`) are re-raised unchanged.
5. Deadline arithmetic kept (85 s -> finalize first, tested); `timeout_s = min(call_timeout, remaining)` kept (tested).
6. The loop consumes `turn.assistant.tool_calls` as provided. Model coordinates are converted by the existing `_to_normalized`/`from_overview` path, shared with single pass.

## Deviations / decisions
- `run_agent` takes one extra optional keyword `transcript` (list filled with one entry per call, failed calls included) so `LlmLabeler` can fill `toolCalls` in `07-labeling.json`. Brief signature otherwise unchanged. `executor.max_crops` is lowered to `min(executor.max_crops, max_crops)` so the `max_crops` argument is honoured.
- "exceeds N" for abandoned calls: skip when the count is `>= 4` (at most 4 leaked threads).
- Both `llm_failed_fallback_none` and `llm_partial` are emitted for a partial fallback (18 section 7.5 and 06 section 9.6 3 both apply).
- Partial = timeout with at least one succeeded call in the error's usage (an "earlier assistant turn" existed). A timeout on turn 1 is a plain `llm_timeout` fallback, `partial=False`.
- The finalize call after a timeout uses 60 s even if that eats the 60 s reserve before the request deadline (spec says 60 s); it is capped by `ctx.remaining()`.
- `agent.py` imports private helpers from `llm.py`; `llm.py` imports `run_agent` inside `_agent` to avoid the import cycle.
- A message to the model from a failing tool is the fixed text "tool failed".

## Concerns
- Abandoned calls still hold a daemon thread until the SDK timeout; bounded to 4 now, but their usage stays unrecorded (only logged as token counts when they finish).
- In the failure path with `fallback_to_none=False`, the transcript is not used (a `VisionError` is raised, as before).
- Task 31 may now enable `agentic_crops`. It must still write `07-labeling.json` from `outcome.debug_summary()`.
