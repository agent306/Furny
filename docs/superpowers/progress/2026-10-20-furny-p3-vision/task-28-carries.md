# Task 28 — carries (binding; preflight I2, I16, K18, I7, K12)

1. I2: layer mapping consumes Task 26's `complete_json(..., schema_model=LayerMapping, effort="low", purpose="dxf_layers")` with `SYSTEM_PROMPT_DXF_LAYERS` / `USER_PROMPT_DXF_LAYERS_TEMPLATE` (app/pipeline/labeling/prompts.py) — do not duplicate prompt-JSON parse/repair/sanitize. Tests use Task 22's `FakeProvider`.
2. I16: define `LayerStats(entity_counts: dict[str, int], line_length_mm: float, parallel_share: float, sample_texts: list[str])` — also the row source for the 06 §10.4 layer table.
3. K18: tests go into a NEW `tests/test_dxf.py` (Task 30 extends it). `test_dxf_too_complex` lives here (I7).
4. K12: `turn.assistant.text` / `.tool_calls`.
5. Library bans (Global Constraints): never LibreDWG or the ODA converter. DXF parsing uses the library already pinned in uv.lock (check; don't add deps unless the brief says so — if you must, regenerate requirements.txt per the constraints).
6. Never log prompts/model responses; LLM failure in layer mapping degrades to the heuristic classification (06 §9.6 spirit) — check 06 §10 for the exact fallback.
