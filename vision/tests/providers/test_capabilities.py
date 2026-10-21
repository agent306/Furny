"""GET /v1/capabilities and the registry (18 §5.1, §6.3, §7.5; 18 §17.1 test_capabilities)."""

import sys
import types
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.api.errors import VisionError
from app.config import Settings
from app.main import create_app
from app.providers import registry
from app.providers.base import LLMProvider, ProviderCapabilities
from app.providers.testing import FakeProvider

TOKEN = "t" * 32
AUTH = {"Authorization": f"Bearer {TOKEN}"}
SECRET = "sk-ant-xyz-secret"


def make_settings(**env: Any) -> Settings:
    return Settings(vision_service_token=TOKEN, **env)


def fetch(settings: Settings) -> dict[str, Any]:
    app = create_app(settings, ocr_factory=lambda: object())
    with TestClient(app) as client:
        response = client.get("/v1/capabilities", headers=AUTH)
        assert response.status_code == 200
        assert SECRET not in response.text
        body: dict[str, Any] = response.json()
        return body


def by_name(body: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {p["name"]: p for p in body["providers"]}


def test_only_anthropic_key() -> None:
    body = fetch(make_settings(anthropic_api_key=SECRET))
    assert body["serviceVersion"] == "1.0.0"
    assert body["pipelineVersion"] == "1.0.0"
    assert [p["name"] for p in body["providers"]] == ["anthropic", "openai", "openai_compatible", "none"]
    providers = by_name(body)

    anthropic = providers["anthropic"]
    assert anthropic["configured"] is True
    assert anthropic["defaultModel"] == "claude-opus-5-5"
    assert anthropic["supportsVision"] and anthropic["supportsTools"]
    assert anthropic["supportsJsonSchema"] and anthropic["supportsEffort"]
    assert anthropic["maxImagePx"] == 2576
    assert anthropic["maxImagesPerRequest"] == 20
    assert anthropic["lastError"] is None
    assert "missing" not in anthropic

    openai = providers["openai"]
    assert openai["configured"] is False
    assert openai["defaultModel"] is None
    assert openai["missing"] == ["OPENAI_API_KEY", "OPENAI_MODEL"]
    assert (openai["maxImagePx"], openai["maxImagesPerRequest"]) == (2048, 10)
    assert openai["lastError"] is None

    compat = providers["openai_compatible"]
    assert compat["configured"] is False
    assert compat["missing"] == ["OPENAI_COMPAT_BASE_URL", "OPENAI_COMPAT_MODEL"]

    none = providers["none"]
    assert none["configured"] is True
    assert none["defaultModel"] is None
    flags = ("supportsVision", "supportsTools", "supportsJsonSchema", "supportsEffort")
    assert not any(none[k] for k in flags)
    assert (none["maxImagePx"], none["maxImagesPerRequest"]) == (0, 0)
    assert none["lastError"] is None
    assert "missing" not in none


def test_ocr_and_limits() -> None:
    body = fetch(make_settings())
    assert body["ocr"] == {"engine": "rapidocr", "loaded": True}
    assert body["limits"] == {
        "maxSourceBytes": 26214400,
        "maxDxfBytes": 15728640,
        "maxPdfPages": 20,
        "maxPixels": 40000000,
        "recognizeDeadlineS": 570,
    }


def test_nothing_configured_lists_anthropic_missing() -> None:
    providers = by_name(fetch(make_settings()))
    assert providers["anthropic"]["configured"] is False
    assert providers["anthropic"]["missing"] == ["ANTHROPIC_API_KEY"]
    assert providers["none"]["configured"] is True


def test_blank_anthropic_key_is_unconfigured() -> None:
    assert by_name(fetch(make_settings(anthropic_api_key="  ")))["anthropic"]["configured"] is False


def test_openai_key_without_model_is_not_configured() -> None:
    openai = by_name(fetch(make_settings(openai_api_key="sk-openai-secret-1")))["openai"]
    assert openai["configured"] is False
    assert openai["missing"] == ["OPENAI_MODEL"]
    assert openai["defaultModel"] is None


def test_openai_configured() -> None:
    settings = make_settings(openai_api_key="sk-openai-secret-1", openai_model="gpt-x")
    openai = by_name(fetch(settings))["openai"]
    assert openai["configured"] is True
    assert openai["defaultModel"] == "gpt-x"
    assert "missing" not in openai
    assert openai["supportsEffort"] is True


def test_compat_flags_are_reflected() -> None:
    settings = make_settings(
        openai_compat_base_url="http://ollama:11434/v1", openai_compat_model="qwen2.5vl:32b"
    )
    compat = by_name(fetch(settings))["openai_compatible"]
    assert compat["configured"] is True
    assert compat["defaultModel"] == "qwen2.5vl:32b"
    assert compat["supportsVision"] is True
    assert compat["supportsTools"] is False
    assert compat["supportsJsonSchema"] is False
    assert compat["supportsEffort"] is False
    assert compat["maxImagePx"] == 1280
    assert compat["maxImagesPerRequest"] == 1
    assert "missing" not in compat


def test_compat_only_base_url_is_missing_model() -> None:
    compat = by_name(fetch(make_settings(openai_compat_base_url="http://x/v1")))["openai_compatible"]
    assert compat["configured"] is False
    assert compat["missing"] == ["OPENAI_COMPAT_MODEL"]


def test_capabilities_requires_bearer() -> None:
    with TestClient(create_app(make_settings(), ocr_factory=lambda: object())) as client:
        assert client.get("/v1/capabilities").status_code == 401
        assert client.get("/v1/capabilities", headers={"Authorization": "Bearer nope"}).status_code == 401


def test_last_error_window() -> None:
    t0 = datetime.now(UTC)
    registry.record_provider_error("anthropic", "provider_auth_failed", now=t0)
    settings = make_settings(anthropic_api_key=SECRET)

    shown = registry.provider_capabilities(settings, now=t0 + timedelta(minutes=59))
    anthropic = next(p for p in shown if p.name == "anthropic")
    assert anthropic.last_error is not None
    assert anthropic.last_error.code == "provider_auth_failed"
    assert anthropic.last_error.at == t0
    assert anthropic.wire()["lastError"] == {
        "code": "provider_auth_failed",
        "at": t0.isoformat().replace("+00:00", "Z"),
    }

    gone = registry.provider_capabilities(settings, now=t0 + timedelta(minutes=61))
    assert next(p for p in gone if p.name == "anthropic").last_error is None
    assert registry.last_error("anthropic", now=t0 + timedelta(minutes=61)) is None


def test_last_error_reaches_the_endpoint() -> None:
    registry.record_provider_error("openai_compatible", "provider_unreachable")
    compat = by_name(fetch(make_settings()))["openai_compatible"]
    assert compat["lastError"]["code"] == "provider_unreachable"


@pytest.mark.parametrize("code", ["provider_auth_failed", "model_not_found", "provider_unreachable"])
def test_last_error_records_the_three_codes(code: str) -> None:
    registry.record_provider_error("openai", code)
    err = registry.last_error("openai")
    assert err is not None
    assert err.code == code


@pytest.mark.parametrize(
    "code", ["llm_timeout", "provider_rate_limited", "llm_refused", "provider_bad_request"]
)
def test_last_error_ignores_other_codes(code: str) -> None:
    registry.record_provider_error("openai", code)
    assert registry.last_error("openai") is None


def test_last_error_keeps_the_most_recent() -> None:
    t0 = datetime.now(UTC)
    registry.record_provider_error("openai", "provider_auth_failed", now=t0)
    registry.record_provider_error("openai", "model_not_found", now=t0 + timedelta(minutes=5))
    err = registry.last_error("openai", now=t0 + timedelta(minutes=6))
    assert err is not None
    assert err.code == "model_not_found"


def test_get_provider_errors() -> None:
    settings = make_settings()
    for name in ("anthropic", "openai", "openai_compatible"):
        with pytest.raises(VisionError) as exc:
            registry.get_provider(name, None, settings)  # type: ignore[arg-type]
        assert exc.value.code == "provider_not_configured"
        assert exc.value.http_status == 400
    assert registry.get_provider("none", None, settings) is None
    assert registry.get_provider("none", "any-model", settings) is None


def test_get_provider_imports_lazily_and_caches(monkeypatch: pytest.MonkeyPatch) -> None:
    built: list[str] = []

    class StubAnthropic(FakeProvider):
        def __init__(self, settings: Settings, model: str) -> None:
            super().__init__([], name="anthropic", model=model)
            built.append(model)

    module = types.ModuleType("app.providers.anthropic_provider")
    module.AnthropicProvider = StubAnthropic  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "app.providers.anthropic_provider", module)

    settings = make_settings(anthropic_api_key=SECRET, anthropic_model="claude-test")
    first = registry.get_provider("anthropic", None, settings)
    assert isinstance(first, LLMProvider)
    assert first.model == "claude-test"  # model=None -> the env default
    assert registry.get_provider("anthropic", None, settings) is first
    assert registry.get_provider("anthropic", "claude-test", settings) is first  # same resolved model
    other = registry.get_provider("anthropic", "claude-other", settings)
    assert other is not first
    assert other is not None
    assert other.model == "claude-other"
    assert built == ["claude-test", "claude-other"]


def test_capabilities_for_matches_the_listing() -> None:
    settings = make_settings(anthropic_api_key=SECRET)
    assert registry.capabilities_for("anthropic", settings) == ProviderCapabilities(
        True, True, True, True, 2576, 20
    )
