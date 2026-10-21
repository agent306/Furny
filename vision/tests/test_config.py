"""Settings: every 18 §4 variable, defaults, validation."""

import pytest
from pydantic import ValidationError

from app.config import Settings, get_settings


@pytest.fixture(autouse=True)
def clean_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in Settings.model_fields:
        monkeypatch.delenv(name.upper(), raising=False)
    get_settings.cache_clear()


def test_token_required_and_min_length(monkeypatch: pytest.MonkeyPatch) -> None:
    with pytest.raises(ValidationError):
        Settings()
    monkeypatch.setenv("VISION_SERVICE_TOKEN", "x" * 31)
    with pytest.raises(ValidationError):
        Settings()
    monkeypatch.setenv("VISION_SERVICE_TOKEN", "x" * 32)
    assert Settings().vision_service_token.get_secret_value() == "x" * 32


def test_defaults() -> None:
    s = Settings(vision_service_token="x" * 32)  # type: ignore[arg-type]
    assert (s.vision_recognize_deadline_s, s.vision_llm_stage_budget_s, s.vision_llm_call_timeout_s) == (
        570,
        420,
        180,
    )
    assert (s.vision_agent_max_turns, s.vision_agent_max_crops) == (10, 8)
    assert (s.vision_max_source_bytes, s.vision_max_pixels, s.vision_heavy_slot_wait_s) == (
        26214400,
        40000000,
        2,
    )
    assert (
        s.anthropic_model,
        s.anthropic_max_image_px,
        s.anthropic_max_output_tokens,
        s.anthropic_server_fallback,
    ) == ("claude-opus-5-5", 2576, 32000, True)
    assert (s.openai_max_image_px, s.openai_max_output_tokens, s.openai_send_reasoning_effort) == (
        2048,
        32000,
        True,
    )
    assert s.openai_compat_api_key.get_secret_value() == "not-needed"
    assert (
        s.openai_compat_supports_vision,
        s.openai_compat_supports_tools,
        s.openai_compat_supports_json_schema,
    ) == (True, False, False)
    assert (
        s.openai_compat_max_image_px,
        s.openai_compat_max_images_per_request,
        s.openai_compat_max_output_tokens,
    ) == (1280, 1, 8192)
    assert (s.openai_compat_send_reasoning_effort, s.openai_compat_timeout_s, s.vision_log_level) == (
        False,
        300,
        "info",
    )
    # Optional variables are unset by default.
    assert s.sentry_dsn is None
    assert s.anthropic_api_key is None
    assert s.anthropic_base_url is None
    assert s.openai_api_key is None
    assert s.openai_model is None
    assert s.openai_base_url is None
    assert s.openai_compat_base_url is None
    assert s.openai_compat_model is None


def test_seconds_settings_are_floats(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("VISION_HEAVY_SLOT_WAIT_S", "0.1")
    monkeypatch.setenv("VISION_RECOGNIZE_DEADLINE_S", "0.001")
    s = Settings(vision_service_token="x" * 32)  # type: ignore[arg-type]
    assert s.vision_heavy_slot_wait_s == 0.1
    assert s.vision_recognize_deadline_s == 0.001
    for name in (
        "vision_recognize_deadline_s",
        "vision_llm_stage_budget_s",
        "vision_llm_call_timeout_s",
        "vision_heavy_slot_wait_s",
        "openai_compat_timeout_s",
    ):
        assert isinstance(getattr(s, name), float), name


def test_env_names_are_case_insensitive(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("vision_service_token", "y" * 40)
    monkeypatch.setenv("Anthropic_Model", "other-model")
    s = Settings()
    assert s.vision_service_token.get_secret_value() == "y" * 40
    assert s.anthropic_model == "other-model"


def test_blank_optional_env_is_none(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in ("OPENAI_API_KEY", "OPENAI_MODEL", "ANTHROPIC_BASE_URL", "SENTRY_DSN"):
        monkeypatch.setenv(name, "")
    s = Settings(vision_service_token="x" * 32)  # type: ignore[arg-type]
    assert s.openai_api_key is None
    assert s.openai_model is None
    assert s.anthropic_base_url is None
    assert s.sentry_dsn is None


def test_secrets_are_masked(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-secret-123456")
    s = Settings(vision_service_token="t" * 32)  # type: ignore[arg-type]
    assert "sk-ant-secret-123456" not in repr(s)
    assert "t" * 32 not in repr(s)


def test_get_settings_is_cached(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("VISION_SERVICE_TOKEN", "x" * 32)
    assert get_settings() is get_settings()
    get_settings.cache_clear()
    assert get_settings() is not None
