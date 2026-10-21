# Task 22 — carries (binding; from preflight.md and progress.md)

1. I3 / progress ruling: define each Literal once. `ProviderName` lives in `app/schemas/meta.py`, `Effort` in `app/schemas/api.py`; `app/providers/base.py` re-exports them (no redefinition).
2. K3: `ProviderInfo.missing: list[str] | None` is OMITTED when None (`Field(exclude_if=lambda v: v is None)` on pydantic ≥ 2.11, or a wrap `model_serializer`); every other null (`lastError`, `defaultModel`) is still emitted.
3. K10: `lastError` records `provider_auth_failed`, `model_not_found` AND `provider_unreachable` (18 §5.1 is the definition).
4. K12: implement 18 §6.1 exactly — `TurnResult(assistant: AssistantMessage, stop_reason, usage)`. Plan references to `turn.text` / `turn.tool_calls` mean `turn.assistant.text` / `turn.assistant.tool_calls`. `make_turn(text, tool_calls, …)` builds the `AssistantMessage` (with a `native` stub); `ReplayProvider` sets `assistant.text = json.dumps(result)`.
5. Preflight T3→T22: `app/main.py` — include the routers and set `provider_factory = registry.get_provider` (additive edit).
6. Preflight c6: T22 keeps a local copy of `JSON_SCHEMA_INSTRUCTION_TEMPLATE` in `api/providers.py`; T26 replaces it with the import.
