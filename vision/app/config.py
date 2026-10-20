"""Vision service settings (18 §4). All values come from the environment."""

from functools import lru_cache
from typing import Any

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(case_sensitive=False, env_file=None, extra="ignore")

    # Service
    vision_service_token: SecretStr = Field(min_length=32)
    vision_log_level: str = "info"
    vision_recognize_deadline_s: float = 570
    vision_llm_stage_budget_s: float = 420
    vision_llm_call_timeout_s: float = 180
    vision_agent_max_turns: int = 10
    vision_agent_max_crops: int = 8
    vision_max_source_bytes: int = 26214400
    vision_max_pixels: int = 40000000
    vision_heavy_slot_wait_s: float = 2
    sentry_dsn: str | None = None

    # Anthropic
    anthropic_api_key: SecretStr | None = None
    anthropic_model: str = "claude-opus-5-5"
    anthropic_base_url: str | None = None
    anthropic_max_image_px: int = 2576
    anthropic_max_output_tokens: int = 32000
    anthropic_server_fallback: bool = True

    # OpenAI
    openai_api_key: SecretStr | None = None
    openai_model: str | None = None
    openai_base_url: str | None = None
    openai_max_image_px: int = 2048
    openai_max_output_tokens: int = 32000
    openai_send_reasoning_effort: bool = True

    # OpenAI-compatible (local) server
    openai_compat_base_url: str | None = None
    openai_compat_api_key: SecretStr = SecretStr("not-needed")
    openai_compat_model: str | None = None
    openai_compat_supports_vision: bool = True
    openai_compat_supports_tools: bool = False
    openai_compat_supports_json_schema: bool = False
    openai_compat_max_image_px: int = 1280
    openai_compat_max_images_per_request: int = 1
    openai_compat_max_output_tokens: int = 8192
    openai_compat_send_reasoning_effort: bool = False
    openai_compat_timeout_s: float = 300

    @field_validator(
        "sentry_dsn",
        "anthropic_api_key",
        "anthropic_base_url",
        "openai_api_key",
        "openai_model",
        "openai_base_url",
        "openai_compat_base_url",
        "openai_compat_model",
        mode="before",
    )
    @classmethod
    def _blank_is_none(cls, value: Any) -> Any:
        if isinstance(value, str) and not value.strip():
            return None
        return value


@lru_cache
def get_settings() -> Settings:
    return Settings()
