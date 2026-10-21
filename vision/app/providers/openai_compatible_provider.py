"""OpenAI-compatible local adapter (18 §7.3): the OpenAI adapter on another base URL with env-driven flags.

Capability flags (tools, json schema, vision) are already part of `capabilities`; the shared `complete()`
omits `tools`/`tool_choice`/`response_format` when they are off.
"""

from typing import Any

from app.providers.openai_provider import OpenAIProvider


class OpenAICompatibleProvider(OpenAIProvider):
    name = "openai_compatible"
    max_tokens_param = "max_tokens"  # many local servers do not know `max_completion_tokens`
    image_detail = False

    def _effort_enabled(self) -> bool:
        return self.settings.openai_compat_send_reasoning_effort

    def _credentials(self) -> tuple[str | None, str | None]:
        s = self.settings
        return s.openai_compat_api_key.get_secret_value(), s.openai_compat_base_url or None

    def _output_cap(self) -> int:
        return self.settings.openai_compat_max_output_tokens

    def _call_timeout_s(self, requested: float) -> float:
        return self.settings.openai_compat_timeout_s  # local models are slow: the caller's budget is not used

    def _usage_model(self, resp: Any) -> str:
        return self.model
