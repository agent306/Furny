### Task 27: Agentic crop loop

**Files:**
- Create: `vision/app/pipeline/labeling/agent.py`
- Modify: `vision/app/pipeline/labeling/llm.py` (wire agentic mode)
- Test: `vision/tests/test_agent.py`

**Spec refs:** `06 §9.6`, `06 §9.5` (budget), `18 §3` (per-run caps), `18 §6.4`

**Interfaces:**
- Consumes: `ToolExecutor` (Task 23), `complete_json` and prompts (Task 26), `FakeProvider` and `make_turn` (Task 22).
- Produces: `run_agent(provider, system: str, user_parts: list[Part], executor: ToolExecutor, schema: type[LabelingResult], effort: Effort, ctx: PipelineContext, *, max_turns: int, max_crops: int, call_timeout_s: float, stage_budget_s: float, max_output_tokens: int) -> tuple[LabelingResult, list[UsageCall], bool]`. The bool means "repaired". It raises `ProviderError` subclasses, each carrying `.usage`.

- [ ] **Step 1: Write the failing test** `tests/test_agent.py` (FakeProvider scripts, no network):
  - `test_crop_calls_executed`:
    - Turn 1 has a `crop_image` tool call; turn 2 has the final JSON.
    - Call 1 has `tool_choice == "auto"` and `tools` = both specs.
    - Call 2's conversation is `[User, Assistant(native from turn 1), ToolResults([image + text])]`; the assistant `native` object is the identical object.
    - Usage purposes `["agent_turn", "agent_turn"]`.
    - Returns the parsed result.
  - `test_crop_budget`: the scripted model requests 9 crops in one turn with `max_crops=8` → 8 image results and a 9th `ToolResult(is_error=True)` with text `"crop budget exhausted, answer now"`.
  - `test_finalize_on_max_turns`: the model calls tools on every turn with `max_turns=3` → the 3rd call has `tool_choice == "none"`, the last message is `UserMessage([TextPart(FINALIZE_PROMPT)])`, and purpose `finalize`.
  - `test_finalize_on_deadline`: `ctx` with 25 s remaining (the stage-budget deadline is `min(ctx.deadline − 60, now + stage_budget)`; set `ctx.deadline = now + 85`) → the first call is already the finalize call.
  - `test_timeout_finalize_then_fallback`: turn 1 → tool call; turn 2 raises `ProviderTimeout`; then the finalize call (with `timeout_s == 60`) raises again → `run_agent` raises `ProviderTimeout` with `.usage` holding all 3 calls (the timed-out ones `status="failed"`). Through `LlmLabeler`: outcome heuristic, `partial is True`, warning `llm_partial`, `fallback_reason == "llm_timeout"`.
  - `test_invalid_tool_args`: a `crop_image` call missing `h` → `is_error` tool result with a pydantic message, and the loop continues.
  - `test_invalid_final_json_with_schema_support`: unparseable final text with `supports_json_schema=True` → `ProviderInvalidOutput` (no repair).
  - `test_repair_round_without_schema`: `supports_json_schema=False` and invalid final text → one repair call, then success with `repaired=True`.
  - `test_timeouts_passed`: each call's `timeout_s <= min(180, remaining_llm_budget)`.
  - `test_unknown_tool`: a tool name `"zoom"` → `is_error` result `"unknown tool"`.
- [ ] **Step 2: Run it, expect FAIL.** Command: `uv run pytest tests/test_agent.py -q`.
- [ ] **Step 3: Implement** per 06 §9.6.
  - The history list is append-only; never mutate earlier messages.
  - Tool results of one assistant turn go into one `ToolResultsMessage`.
  - The finalize prompt is a separate `UserMessage` appended after the results; the adapters merge consecutive user turns.
- [ ] **Step 4: Run tests, expect PASS.** Same command as Step 2.
- [ ] **Step 5: Quality gates.** `uv run ruff check . && uv run ruff format --check . && uv run mypy app`
- [ ] **Step 6: Commit.** `git add vision/app/pipeline/labeling/agent.py vision/app/pipeline/labeling/llm.py vision/tests/test_agent.py` then `git commit -m "feat(vision): agentic crop_image tool loop with budgets and finalize" -m "$FURNY_TRAILER"`.

---

