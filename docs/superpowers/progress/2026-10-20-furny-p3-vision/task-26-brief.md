### Task 26: Prompts and LLM labeler (single-pass, prompt-JSON, repair, sanitize, fallback)

**Files:**
- Create: `vision/app/pipeline/labeling/prompts.py`, `vision/app/pipeline/labeling/llm.py`
- Modify: `vision/app/api/providers.py` (import `JSON_SCHEMA_INSTRUCTION_TEMPLATE` from prompts)
- Test: `vision/tests/test_llm_labeler.py`, `vision/tests/providers/test_compat_single_pass.py`

**Spec refs:** `06 §9.1`, `06 §9.3` (prompts verbatim), `06 §9.4` (sanitize), `18 §7.3` (prompt-JSON and repair), `18 §7.5`

**Interfaces:**
- Consumes: `HeuristicLabeler`, `LabelingOutcome` (Task 19), `build_overview`, `to_image_part` (Task 23), `LLMProvider` and the error classes (Task 22), `to_strict_schema`, `parse_json_object`.
- Produces:
  - In `prompts.py`: constants `SYSTEM_PROMPT_LABELING`, `USER_PROMPT_LABELING_TEMPLATE`, `TOOLS_BLOCK_TEMPLATE`, `FINALIZE_PROMPT`, `REPAIR_PROMPT_TEMPLATE`, `JSON_SCHEMA_INSTRUCTION_TEMPLATE`, `SYSTEM_PROMPT_DXF_LAYERS`, `USER_PROMPT_DXF_LAYERS_TEMPLATE` (verbatim from 06 §9.3 and §10.4), plus `build_user_prompt(overview, hints, *, two_images: bool, tools: bool, max_crops: int) -> str`.
  - In `llm.py`:
    - `LabelerOptions(agentic_crops: bool, effort: Effort, fallback_to_none: bool, max_turns: int, max_crops: int, call_timeout_s: float, stage_budget_s: float, max_output_tokens: int)`.
    - `LlmLabeler(provider: LLMProvider, options: LabelerOptions)` with `label(page, candidates, hints, ctx) -> LabelingOutcome`.
    - `sanitize(result: LabelingResult, candidates: CandidateSet, heuristic: LabelingResult) -> tuple[LabelingResult, float]` (the second value is the dropped ratio).
    - `complete_json(provider, conversation, *, system, schema_model, effort, timeout_s, purpose, ctx) -> tuple[BaseModel, list[UsageCall], bool]` (single pass plus at most one repair; the bool means "repaired").

- [ ] **Step 1: Write the failing test.**
  - `test_prompts_verbatim`:
    - `SYSTEM_PROMPT_LABELING.startswith("You are an expert architectural draftsperson")` and `.endswith("Answer ONLY with the JSON object required by the output schema.")`.
    - It contains the line `"- Furniture symbols (beds, sofas, dining tables, WC pans, basins, kitchen counters, wardrobes) are not walls."`.
    - `FINALIZE_PROMPT` and `REPAIR_PROMPT_TEMPLATE` exactly equal the 06 §9.3 strings.
  - `test_user_prompt_hints`: an imperial hint gives `"- Unit system: imperial (feet and inches)"`; known dimension `"- Known measurement: \"Overall\" = 11000 mm"`; photo `"yes"`; with one image the line is `The image is "marked".`.
  - `test_single_pass_success`: `FakeProvider` (json schema supported) returns a valid `LabelingResult` → outcome `provider_used == "anthropic"`, model = the served model, one `UsageCall` with purpose `labeling`. The call had `output_schema.name == "floor_plan_labels"`, `tools == []`, `tool_choice == "none"`, and parts `[ImagePart clean, ImagePart marked, TextPart]`.
  - `test_unknown_ids_sanitised`:
    - Unknown `W999` entries are dropped.
    - `valueMm 70000` → `None`.
    - A 75-char name is truncated to 60.
    - A duplicate id keeps the first.
    - Candidates not mentioned get heuristic labels.
    - If more than 20 % of entries are dropped → treated as `llm_invalid_output` → heuristic fallback with `fallback_reason == "llm_invalid_output"`.
  - `test_refusal_falls_back`: `ProviderRefusal` → heuristic labels, `provider_used == "none"`, `fallback_reason == "llm_refused"`, warning `llm_failed_fallback_none` `{"reason": "llm_refused"}`, and `calls` keeps the failed call.
  - `test_fallback_disabled_raises`: with `fallback_to_none=False`, a `ProviderUnavailable` → `VisionError("provider_error")` with status 502, `retryable=True`, and `.usage` holding the calls.
  - `test_vision_unsupported`: a provider with `supports_vision=False` → heuristic directly, `fallback_reason == "vision_unsupported"`, no call made.
  - `test_auth_error_reason`: `ProviderAuthError` → `fallback_reason == "provider_auth_failed"`.
  - `test_compat_single_pass_prompt_json` (in `tests/providers/test_compat_single_pass.py`, real `OpenAICompatibleProvider` over `httpx2.MockTransport`):
    - Response 1 is fenced invalid JSON (missing required fields); response 2 is fenced valid JSON.
    - The system prompt of call 1 ends with `JSON_SCHEMA_INSTRUCTION_TEMPLATE` filled with the strict schema.
    - Call 2's last user message starts with `"Your previous answer was not valid for the required schema. Errors:\n"` and lists ≤ 20 `loc: msg` lines.
    - The outcome succeeds with warning `llm_output_repaired` and usage purposes `["labeling", "repair"]`.
    - If both responses are invalid → fallback with `llm_invalid_output`.
    - Only the marked image is sent (`max_images_per_request = 1`).
- [ ] **Step 2: Run it, expect FAIL.** Command: `uv run pytest tests/test_llm_labeler.py tests/providers/test_compat_single_pass.py -q`.
- [ ] **Step 3: Implement** per 06 §9.1 and §9.3.
  - Agentic mode, `options.agentic_crops and provider.capabilities.supports_tools`, delegates to `run_agent` (Task 27). Until Task 27 lands it raises `NotImplementedError`, and this task's tests use single-pass providers.
  - The labeler converts overview-pixel coordinates in `MissedRoom`/`MissedOpening` back to normalized px with `from_overview` before returning. Downstream code always sees normalized px.
  - Writes debug artifact `07-labeling.json` with the result, notes, usage and transcript summary (tool names and args, no images).
- [ ] **Step 4: Run tests, expect PASS.** Same command as Step 2.
- [ ] **Step 5: Quality gates.** `uv run ruff check . && uv run ruff format --check . && uv run mypy app`
- [ ] **Step 6: Commit.** `git add vision/app/pipeline/labeling/prompts.py vision/app/pipeline/labeling/llm.py vision/app/api/providers.py vision/tests/test_llm_labeler.py vision/tests/providers/test_compat_single_pass.py` then `git commit -m "feat(vision): LLM labeler with prompt-JSON repair, sanitize and fallback" -m "$FURNY_TRAILER"`.

---

