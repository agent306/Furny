# Task 22 report: provider core

Status: DONE.

## Implemented
- `app/providers/base.py`: 18 §6.1 types verbatim (dataclasses, `LLMProvider` ABC). `ProviderName` and `Effort` are re-exported from `schemas/meta.py` and `schemas/api.py` (no redefinition). Added a `UsagePurpose` Literal alias (same members as the spec's `UsageCall.purpose`) so `make_turn` and `UsageCall` type-check. `complete(..., purpose: str)` stays as in the spec.
- `app/providers/errors.py`: 18 §6.2 classes (`.code`, `.retryable`, `.usage`, `ProviderRefusal.category`) and `fallback_reason_for`. Constructor: `Cls(message, *, code=None, retryable=None, usage=None)`; the code kwarg selects `model_not_found`, `provider_rate_limited`, `provider_overloaded`.
- `app/providers/registry.py`: `provider_capabilities(settings, now=None)`, `get_provider`, `record_provider_error`, `last_error`, plus helpers `capabilities_for(name, settings)`, `default_model`, `is_configured`, `reset_state()` (tests). Lazy import through the `ADAPTERS` table, cache per `(name, resolved model)`.
- `app/providers/none_provider.py`, `usage.py` (`usage_call_out`, `build_usage`), `testing.py` (`FakeProvider`, `ReplayProvider`, `make_turn`, not registered).
- `app/api/capabilities.py` (`GET /v1/capabilities`) and `app/api/providers.py` (`POST /v1/providers/test`), both bearer-protected; `main.py` includes them and sets `provider_factory = lambda name, model: registry.get_provider(name, model, settings)`.

## Files
Created: `vision/app/providers/{base,errors,registry,none_provider,usage,testing}.py`, `vision/app/api/{capabilities,providers}.py`, `vision/tests/providers/{conftest,test_capabilities,test_provider_test_endpoint,test_usage_totals}.py`.
Modified: `vision/app/main.py` (3 imports/includes, factory line).

## TDD evidence
RED (before any implementation), `uv run pytest tests/providers -q`:
```
ImportError while loading conftest '.../tests/providers/conftest.py'.
tests/providers/conftest.py:7: in <module>
    from app.providers import registry
E   ImportError: cannot import name 'registry' from 'app.providers'
```
GREEN: `55 passed in 1.92s` (tests/providers), then 56 passed with the flake re-run alone.

## Gate (WSL)
- `ruff check .`: All checks passed. `ruff format --check .`: 111 files already formatted. `mypy app`: no issues in 67 source files.
- `pytest -q`: 1222 passed, 1 skipped, 3 xfailed, 1 failed. The one failure is the known load flake `test_walls_closure.py::test_rejoining_many_thin_lines_is_fast_and_polls_the_deadline` (0.54 s vs the 0.5 s bound); it passes when re-run alone.

## Carries
1. Literals defined once: `base.py` imports and re-exports `ProviderName`/`Effort`.
2. K3: `ProviderInfo.missing` is omitted when None (the T5 wrap serializer); asserted for `anthropic`/`none`; `lastError` and `defaultModel` stay as null.
3. K10: `record_provider_error` stores `provider_auth_failed`, `model_not_found`, `provider_unreachable` and ignores all other codes (tests for the three accepted and four ignored codes). The provider-test endpoint records every `ProviderError` code through it.
4. K12: `TurnResult(assistant, stop_reason, usage)`; `make_turn` builds the `AssistantMessage` (native stub = `{"text", "tool_calls"}`); `ReplayProvider` sets `assistant.text = json.dumps(result)`.
5. `main.py` change is additive.
6. `JSON_SCHEMA_INSTRUCTION_TEMPLATE` is a local copy in `api/providers.py` (T26 swaps it for the import).

## Deviations / decisions
- Adapter constructor contract chosen here for T24/T25: `Adapter(settings, resolved_model)`; recorded in the registry docstring.
- `defaultModel` is null for any unconfigured provider (as in the 18 §5.1 example), including `anthropic`; `missing` for anthropic is `["ANTHROPIC_API_KEY"]`.
- `supportsEffort` is static from the settings flags (`OPENAI_SEND_REASONING_EFFORT`, `OPENAI_COMPAT_SEND_REASONING_EFFORT`); anthropic is always true. The runtime "drop after a 400" is adapter state and not reflected.
- Provider test: `tool_choice="none"`, `max_output_tokens=2048` (room for adaptive thinking), usage `purpose` is forced to `provider_test` on the way out, an unconfigured provider is 400 `provider_not_configured` (registry rule) instead of a 200 `ok:false`. `ok` is true only when the call succeeded and the answer parses and matches the schema; otherwise `ok:false` with `llm_invalid_output` (or `llm_refused` for a refusal stop). `visionVerified` = vision capable and the answer is `ok: true, top_left`; `jsonSchemaVerified` = native schema supported and the answer valid. Failure usage = last call of `err.usage`, else null. Error messages are scrubbed of settings secrets and presigned queries.
- No concurrency slot on `/v1/providers/test` (spec defines none; gap-list item).
- `/v1/capabilities` constants `maxDxfBytes` (15728640) and `maxPdfPages` (20) live in `api/capabilities.py` (no existing constants in the code base).
- `# noqa: N818` on the five error classes (names fixed by 18 §6.2).
- The cache is keyed by (name, model) only, per spec; settings changes inside one process need `reset_state()` (tests do this in an autouse fixture).

## Concerns
- `app/pipeline/labeling/base.py` `LabelingOutcome.calls` is still `list[Any]`; left unchanged (out of scope), T26 can tighten it to `list[UsageCall]`.
