# Task 25 — carries (binding)

1. K10: `lastError` records `provider_auth_failed`, `model_not_found` and `provider_unreachable`; add the ConnectError → recorded assertion (call `record_provider_error` for every ProviderError, as Task 24's Anthropic adapter does).
2. K16: the sentinel for unparseable tool-argument JSON is `{"__invalid_json__": raw}` (ToolExecutor in Task 23 already checks it first).
3. Task 22 contract: `Adapter(settings, resolved_model)`; match the Anthropic adapter's (Task 24, app/providers/anthropic_provider.py) structure, error mapping style, test style (httpx MockTransport, exact request bodies, no network) where the OpenAI API allows.
4. Task 24 review carry: fix `_MASKED_KEY` in app/api/providers.py:117 — add `.` to the character class and a leading `\b`, so `task-manager` is not mangled and `sk-ant-api03-AbCd...wXyZ` is fully scrubbed. Add tests for both.
5. Global constraint: the OpenAI model is never hard-coded.
