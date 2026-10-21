### Task 2: Settings and JSON logging with redaction

**Files:**
- Create: `vision/app/config.py`, `vision/app/logging.py`
- Test: `vision/tests/test_config.py`, `vision/tests/test_logging.py`

**Spec refs:** `18 §4` (every variable), `06 §5.3`, `17 §6.2`

**Interfaces:**
- Produces:
  - `class Settings(BaseSettings)` with one snake_case field per 18 §4 variable, for example `vision_service_token: SecretStr`, `anthropic_api_key: SecretStr | None`, `openai_compat_supports_tools: bool`. Configured with `case_sensitive=False` and `env_file=None`.
  - `get_settings() -> Settings` (cached with `functools.lru_cache`; tests call `get_settings.cache_clear()`).
  - `configure_logging(level: str) -> None`.
  - `request_id_var: ContextVar[str | None]`.
  - `class JsonFormatter(logging.Formatter)` and `class RedactionFilter(logging.Filter)`.
  - Logger name `furny.vision`.

- [ ] **Step 1: Write the failing test.**
  - `test_token_required_and_min_length`: with no `VISION_SERVICE_TOKEN`, `Settings()` raises `ValidationError`; 31 characters also raises; 32 characters passes.
  - `test_defaults` pins every 18 §4 default:

    ```python
    s = Settings(vision_service_token="x" * 32)
    assert (s.vision_recognize_deadline_s, s.vision_llm_stage_budget_s, s.vision_llm_call_timeout_s) == (570, 420, 180)
    assert (s.vision_agent_max_turns, s.vision_agent_max_crops) == (10, 8)
    assert (s.vision_max_source_bytes, s.vision_max_pixels, s.vision_heavy_slot_wait_s) == (26214400, 40000000, 2)
    assert (s.anthropic_model, s.anthropic_max_image_px, s.anthropic_max_output_tokens, s.anthropic_server_fallback) == ("claude-opus-5-5", 2576, 32000, True)
    assert (s.openai_max_image_px, s.openai_max_output_tokens, s.openai_send_reasoning_effort) == (2048, 32000, True)
    assert s.openai_compat_api_key.get_secret_value() == "not-needed"
    assert (s.openai_compat_supports_vision, s.openai_compat_supports_tools, s.openai_compat_supports_json_schema) == (True, False, False)
    assert (s.openai_compat_max_image_px, s.openai_compat_max_images_per_request, s.openai_compat_max_output_tokens) == (1280, 1, 8192)
    assert (s.openai_compat_send_reasoning_effort, s.openai_compat_timeout_s, s.vision_log_level) == (False, 300, "info")
    ```
  - `test_blank_optional_env_is_none`: `monkeypatch.setenv("OPENAI_API_KEY", "")` results in `Settings(...).openai_api_key is None`.
  - `test_json_log_shape`: with `request_id_var` set to `"01JB"`, `logger.info("hello", extra={"stage": "ocr", "durationMs": 12})` outputs one JSON line with keys `ts, level, msg, requestId, stage, durationMs`.
  - `test_redacts_secrets_and_presigned`: with env `ANTHROPIC_API_KEY=sk-ant-secret-123456` and `VISION_SERVICE_TOKEN=t`×32, logging `"key sk-ant-secret-123456 url https://s3/x.png?X-Amz-Signature=abc&X-Amz-Credential=def"` produces output that contains neither `sk-ant-secret-123456` nor `X-Amz-Signature=abc`, but does contain `[REDACTED]`.
- [ ] **Step 2: Run it, expect FAIL.** Command: `uv run pytest tests/test_config.py tests/test_logging.py -q`. Expected: `ImportError`.
- [ ] **Step 3: Implement.**
  - **Settings.** One field per 18 §4 row with the stated defaults. Secrets use `SecretStr`. A `field_validator(mode="before")` maps `""` to `None` for optional fields. The token has `min_length=32`.
  - **RedactionFilter.** At construction it collects the non-empty values (length ≥ 8) of environment variables whose names end in `_API_KEY` or `_TOKEN`. In `record.getMessage()` and in string `extra` values it replaces each with `[REDACTED]`. It also rewrites any URL query string containing `X-Amz-` with the regex `(\?[^\s"']*X-Amz-[^\s"']*)` → `?[REDACTED]`.
  - **JsonFormatter.** Emits `ts` (ISO-8601 UTC with milliseconds), `level` (lowercase), `msg`, `requestId` (from the context variable) and every extra key that is not a standard `LogRecord` attribute.
- [ ] **Step 4: Run tests, expect PASS.** Same command as Step 2.
- [ ] **Step 5: Quality gates.** `uv run ruff check . && uv run ruff format --check . && uv run mypy app`
- [ ] **Step 6: Commit.** `git add vision/app/config.py vision/app/logging.py vision/tests/test_config.py vision/tests/test_logging.py` then `git commit -m "feat(vision): settings from env and redacting JSON logging" -m "$FURNY_TRAILER"`.

---

