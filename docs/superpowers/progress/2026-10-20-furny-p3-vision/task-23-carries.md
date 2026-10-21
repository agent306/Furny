# Task 23 — carries (binding)

1. Preflight K16: `ToolExecutor.execute` first checks `"__invalid_json__" in call.arguments` (the sentinel adapters use for unparseable tool-argument JSON, `{"__invalid_json__": raw}`) and returns `ToolResult(is_error=True, …)` with the text "invalid JSON arguments" — before any pydantic validation. (Task 27 pins it in the crop-loop tests; implement it here if ToolExecutor is created in this task.)
2. Task 22 contract: providers are obtained via the registry; `TurnResult(assistant, stop_reason, usage)` with `turn.assistant.text` / `turn.assistant.tool_calls` (K12). Coordinates exchanged with models are absolute integer overview pixels.
3. Task 21 carry (for awareness): labeler outputs in overview px must be converted to normalized-page px (÷ s + offset, 06 §8.7 step 2) before assembly — if this task owns the overview transform helpers, expose the inverse mapping.
