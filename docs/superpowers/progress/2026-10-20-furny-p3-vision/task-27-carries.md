# Task 27 — carries (binding; preflight.md + progress.md)

1. K16: pin in tests that `ToolExecutor.execute` returns `ToolResult(is_error=True, "invalid JSON arguments")` for `{"__invalid_json__": raw}` before any validation (already implemented in Task 23 — add the crop-loop test).
2. K18: extend `tests/test_agent.py` (created in Task 26); don't create a parallel file.
3. Task 23 review carries (tools.py):
   a. the crop `w,h ≥ 16` check must run AFTER clamping to the overview (06 §9.5) — sliver crops at the edge currently succeed (tools.py ~646);
   b. confirm `max_turns` bounds invalid-crop retries (invalid crops don't consume the crop budget, tools.py ~640) — add a test;
   c. `list_candidates` rejects a zero/negative region with an is_error result (tools.py ~686).
4. Task 26 ruling (llm.py `_complete`):
   a. when an abandoned (timed-out) provider call completes late, log token counts only — request_id, purpose, input/output tokens; never prompt/response text;
   b. bound leaked threads: a module-level counter/semaphore of abandoned calls still in flight; when it exceeds a small N (pick N=4, record it), skip the LLM and degrade to the heuristic with the appropriate fallback reason;
   c. map unexpected non-ProviderError exceptions raised inside `_complete` to `ProviderError` (code `llm_error`, retryable per 18 §7.5) so labeling degrades instead of returning 500 (06 §9.6).
5. Task 26: agentic mode currently raises NotImplementedError — this task replaces it. Keep the deadline arithmetic (85 s → finalize first; preflight T27 row) and the provider timeout capping `min(call_timeout, remaining)`.
6. Task 21/23: model coordinates are absolute integer overview px; convert with `from_overview` before assembly. Tool calls only from post-fallback blocks (Task 24 ruling) — the loop consumes `turn.assistant.tool_calls` as provided.
