"""Provider registry (18 §6.3): configured/missing logic, capabilities, lazy cached instances, lastError.

Adapter contract (Tasks 24 and 25): each adapter class is constructed as `Adapter(settings, model)` where
`model` is already resolved (the explicit model, else the env default).
"""

import importlib
import threading
from datetime import UTC, datetime, timedelta
from typing import cast

from app.api.errors import VisionError
from app.config import Settings
from app.providers.base import LLMProvider, ProviderCapabilities, ProviderName
from app.schemas.api import ProviderInfo, ProviderLastError

ADAPTERS: dict[str, str] = {
    "anthropic": "app.providers.anthropic_provider:AnthropicProvider",
    "openai": "app.providers.openai_provider:OpenAIProvider",
    "openai_compatible": "app.providers.openai_compatible_provider:OpenAICompatibleProvider",
}
PROVIDER_ORDER: tuple[ProviderName, ...] = ("anthropic", "openai", "openai_compatible", "none")

# 18 §5.1 defines lastError; 18 §7.5 adds auth and model_not_found, K10 adds unreachable.
LAST_ERROR_CODES = frozenset({"provider_auth_failed", "model_not_found", "provider_unreachable"})
LAST_ERROR_WINDOW = timedelta(minutes=60)

_lock = threading.Lock()
_instances: dict[tuple[str, str], LLMProvider] = {}
_last_errors: dict[str, ProviderLastError] = {}


def reset_state() -> None:
    """Forget cached providers and recorded errors (tests)."""
    with _lock:
        _instances.clear()
        _last_errors.clear()


def _text(value: str | None) -> str | None:
    return value.strip() or None if value else None


def _secret(value: object) -> str | None:
    getter = getattr(value, "get_secret_value", None)
    return _text(getter()) if getter else None


def _missing(name: ProviderName, settings: Settings) -> list[str]:
    """Names (never values) of the unset env vars that keep a provider from being configured."""
    required: list[tuple[str, bool]]
    if name == "anthropic":
        required = [("ANTHROPIC_API_KEY", _secret(settings.anthropic_api_key) is not None)]
    elif name == "openai":
        required = [
            ("OPENAI_API_KEY", _secret(settings.openai_api_key) is not None),
            ("OPENAI_MODEL", _text(settings.openai_model) is not None),
        ]
    elif name == "openai_compatible":
        required = [
            ("OPENAI_COMPAT_BASE_URL", _text(settings.openai_compat_base_url) is not None),
            ("OPENAI_COMPAT_MODEL", _text(settings.openai_compat_model) is not None),
        ]
    else:
        required = []
    return [var for var, present in required if not present]


def default_model(name: ProviderName, settings: Settings) -> str | None:
    if name == "anthropic":
        return _text(settings.anthropic_model)
    if name == "openai":
        return _text(settings.openai_model)
    if name == "openai_compatible":
        return _text(settings.openai_compat_model)
    return None


def capabilities_for(name: ProviderName, settings: Settings) -> ProviderCapabilities:
    """The static capabilities of a provider under these settings (18 §2, §3)."""
    if name == "anthropic":
        return ProviderCapabilities(True, True, True, True, settings.anthropic_max_image_px, 20)
    if name == "openai":
        return ProviderCapabilities(
            True, True, True, settings.openai_send_reasoning_effort, settings.openai_max_image_px, 10
        )
    if name == "openai_compatible":
        return ProviderCapabilities(
            settings.openai_compat_supports_vision,
            settings.openai_compat_supports_tools,
            settings.openai_compat_supports_json_schema,
            settings.openai_compat_send_reasoning_effort,
            settings.openai_compat_max_image_px,
            settings.openai_compat_max_images_per_request,
        )
    return ProviderCapabilities(False, False, False, False, 0, 0)


def is_configured(name: ProviderName, settings: Settings) -> bool:
    return not _missing(name, settings)


def record_provider_error(name: str, code: str, now: datetime | None = None) -> None:
    """Remember a provider's latest auth / model_not_found / unreachable error (other codes are ignored)."""
    if code not in LAST_ERROR_CODES:
        return
    with _lock:
        _last_errors[name] = ProviderLastError(code=code, at=now or datetime.now(UTC))


def last_error(name: str, now: datetime | None = None) -> ProviderLastError | None:
    """The recorded error of `name` if it is at most 60 minutes old."""
    with _lock:
        err = _last_errors.get(name)
    if err is None or (now or datetime.now(UTC)) - err.at > LAST_ERROR_WINDOW:
        return None
    return err


def provider_capabilities(settings: Settings, now: datetime | None = None) -> list[ProviderInfo]:
    """Feeds `GET /v1/capabilities`; reads settings only, no network."""
    infos: list[ProviderInfo] = []
    for name in PROVIDER_ORDER:
        missing = _missing(name, settings)
        caps = capabilities_for(name, settings)
        infos.append(
            ProviderInfo(
                name=name,
                configured=not missing,
                default_model=None if missing else default_model(name, settings),
                supports_vision=caps.supports_vision,
                supports_tools=caps.supports_tools,
                supports_json_schema=caps.supports_json_schema,
                supports_effort=caps.supports_effort,
                max_image_px=caps.max_image_px,
                max_images_per_request=caps.max_images_per_request,
                last_error=last_error(name, now),
                missing=missing or None,
            )
        )
    return infos


def get_provider(name: ProviderName, model: str | None, settings: Settings) -> LLMProvider | None:
    """`none` -> None; an unconfigured name -> `provider_not_configured` (400). Cached per (name, model)."""
    if name == "none":
        return None
    missing = _missing(name, settings)
    if name not in ADAPTERS or missing:
        raise VisionError(
            "provider_not_configured",
            f"Provider '{name}' is not configured" + (f" (missing: {', '.join(missing)})" if missing else ""),
        )
    resolved = _text(model) or default_model(name, settings) or ""
    key = (name, resolved)
    with _lock:
        cached = _instances.get(key)
    if cached is not None:
        return cached
    module_name, _, class_name = ADAPTERS[name].partition(":")
    adapter = getattr(importlib.import_module(module_name), class_name)
    instance = cast(LLMProvider, adapter(settings, resolved))
    with _lock:
        return _instances.setdefault(key, instance)
