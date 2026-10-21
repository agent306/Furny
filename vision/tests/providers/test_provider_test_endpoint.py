"""POST /v1/providers/test (18 §5.3; 18 §17.1 test_provider_test_endpoint)."""

import io
import json
import threading
import time
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.api.providers import _scrub
from app.config import Settings
from app.main import create_app
from app.providers import registry
from app.providers.base import ImagePart, ProviderCapabilities, TextPart, UserMessage
from app.providers.errors import ProviderAuthError, ProviderUnavailable
from app.providers.testing import FakeProvider, make_turn

TOKEN = "t" * 32
AUTH = {"Authorization": f"Bearer {TOKEN}"}
ANSWER = json.dumps({"ok": True, "quadrant": "top_left"})
NO_VISION = ProviderCapabilities(False, True, True, True, 0, 0)
NO_SCHEMA = ProviderCapabilities(True, False, False, False, 1280, 1)


@pytest.fixture
def client() -> Iterator[TestClient]:
    app = create_app(Settings(vision_service_token=TOKEN), ocr_factory=lambda: object())
    with TestClient(app) as test_client:
        yield test_client


def use(client: TestClient, provider: FakeProvider | None) -> list[tuple[str, str | None]]:
    seen: list[tuple[str, str | None]] = []

    def factory(name: str, model: str | None) -> FakeProvider | None:
        seen.append((name, model))
        return provider

    client.app.state.provider_factory = factory  # type: ignore[attr-defined]
    return seen


def post(client: TestClient, provider: str = "anthropic", model: str | None = None) -> Any:
    return client.post("/v1/providers/test", headers=AUTH, json={"provider": provider, "model": model})


def test_success_with_vision_and_schema(client: TestClient) -> None:
    fake = FakeProvider([make_turn(text=ANSWER, purpose="provider_test")])
    seen = use(client, fake)

    response = post(client, "anthropic", "claude-opus-5-5")

    assert response.status_code == 200
    body = response.json()
    assert seen == [("anthropic", "claude-opus-5-5")]
    assert body["ok"] is True
    assert body["provider"] == "anthropic"
    assert body["model"] == "fake-model"
    assert isinstance(body["latencyMs"], int)
    assert body["visionVerified"] is True
    assert body["jsonSchemaVerified"] is True
    assert body["error"] is None
    assert body["usage"]["purpose"] == "provider_test"
    assert body["usage"]["status"] == "succeeded"
    assert set(body["usage"]) == {
        "purpose",
        "model",
        "inputTokens",
        "outputTokens",
        "cacheReadInputTokens",
        "cacheCreationInputTokens",
        "images",
        "durationMs",
        "stopReason",
        "status",
    }

    (call,) = fake.calls
    (message,) = call["conversation"]
    assert isinstance(message, UserMessage)
    image, text = message.parts
    assert isinstance(image, ImagePart)
    assert image.media_type == "image/png"
    assert text == TextPart("Is the black square in the top-left quadrant? Answer with the JSON object.")
    png = Image.open(io.BytesIO(image.data)).convert("RGB")
    assert png.size == (64, 64)
    assert png.getpixel((10, 10)) == (0, 0, 0)
    assert png.getpixel((50, 50)) == (255, 255, 255)
    assert call["system"] == "You are a connectivity check."
    assert call["effort"] == "low"
    assert call["timeout_s"] == 60
    assert call["tools"] == []
    assert call["tool_choice"] == "none"
    schema = call["output_schema"]
    assert schema.name == "connectivity_check"
    assert schema.schema["required"] == ["ok", "quadrant"]
    assert schema.schema["additionalProperties"] is False
    assert schema.schema["properties"]["quadrant"]["enum"] == [
        "top_left",
        "top_right",
        "bottom_left",
        "bottom_right",
    ]
    assert call["purpose"] == "provider_test"


def test_usage_purpose_is_forced_to_provider_test(client: TestClient) -> None:
    use(client, FakeProvider([make_turn(text=ANSWER, purpose="labeling")]))
    assert post(client).json()["usage"]["purpose"] == "provider_test"


def test_provider_without_vision_sends_no_image(client: TestClient) -> None:
    fake = FakeProvider([make_turn(text=ANSWER)], capabilities=NO_VISION)
    use(client, fake)

    body = post(client).json()

    (call,) = fake.calls
    (message,) = call["conversation"]
    assert message.parts == [TextPart('Reply with ok = true and quadrant = "top_left".')]
    assert body["ok"] is True
    assert body["visionVerified"] is False
    assert body["jsonSchemaVerified"] is True


def test_provider_without_json_schema_gets_the_instruction(client: TestClient) -> None:
    fake = FakeProvider([make_turn(text="```json\n" + ANSWER + "\n```")], capabilities=NO_SCHEMA)
    use(client, fake)

    body = post(client).json()

    (call,) = fake.calls
    assert call["output_schema"] is None
    system = call["system"]
    assert system.startswith("You are a connectivity check.")
    assert "a single JSON object, no markdown fences" in system
    assert '"quadrant"' in system  # the schema is inlined
    assert body["ok"] is True
    assert body["visionVerified"] is True
    assert body["jsonSchemaVerified"] is False


def test_wrong_quadrant_is_ok_but_not_vision_verified(client: TestClient) -> None:
    use(client, FakeProvider([make_turn(text='{"ok": true, "quadrant": "bottom_right"}')]))
    body = post(client).json()
    assert body["ok"] is True
    assert body["visionVerified"] is False


def test_auth_error_is_a_200_with_ok_false_and_is_recorded(client: TestClient) -> None:
    use(client, FakeProvider([ProviderAuthError("401 invalid x-api-key sk-ant-live-secret-value")]))
    client.app.state.settings = Settings(  # type: ignore[attr-defined]
        vision_service_token=TOKEN, anthropic_api_key="sk-ant-live-secret-value"
    )

    response = post(client)

    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is False
    assert body["error"]["code"] == "provider_auth_failed"
    assert "sk-ant-live-secret-value" not in response.text
    assert body["visionVerified"] is False
    assert body["jsonSchemaVerified"] is False
    assert body["usage"] is None
    last = registry.last_error("anthropic")
    assert last is not None
    assert last.code == "provider_auth_failed"


def test_unreachable_is_recorded_and_other_errors_are_not(client: TestClient) -> None:
    use(client, FakeProvider([ProviderUnavailable("connect failed", code="provider_rate_limited")]))
    assert post(client).json()["error"]["code"] == "provider_rate_limited"
    assert registry.last_error("anthropic") is None

    use(client, FakeProvider([ProviderUnavailable("connect failed", code="provider_unreachable")]))
    assert post(client).json()["error"]["code"] == "provider_unreachable"
    last = registry.last_error("anthropic")
    assert last is not None
    assert last.code == "provider_unreachable"


def test_unparseable_answer_is_llm_invalid_output(client: TestClient) -> None:
    use(client, FakeProvider([make_turn(text="I see a square")]))
    body = post(client).json()
    assert body["ok"] is False
    assert body["error"]["code"] == "llm_invalid_output"
    assert body["usage"]["purpose"] == "provider_test"


def test_wrong_shape_is_llm_invalid_output(client: TestClient) -> None:
    use(client, FakeProvider([make_turn(text='{"ok": "yes", "quadrant": "middle"}')]))
    body = post(client).json()
    assert body["ok"] is False
    assert body["error"]["code"] == "llm_invalid_output"


def test_refusal_is_llm_refused(client: TestClient) -> None:
    use(client, FakeProvider([make_turn(text=None, stop_reason="refusal")]))
    body = post(client).json()
    assert body["ok"] is False
    assert body["error"]["code"] == "llm_refused"


def test_provider_none_short_circuits(client: TestClient) -> None:
    seen = use(client, None)

    response = post(client, "none")

    assert response.status_code == 200
    assert response.json() == {
        "ok": True,
        "provider": "none",
        "model": None,
        "latencyMs": 0,
        "visionVerified": False,
        "jsonSchemaVerified": False,
        "usage": None,
        "error": None,
    }
    assert seen == []


def test_unconfigured_provider_is_400() -> None:
    app = create_app(Settings(vision_service_token=TOKEN), ocr_factory=lambda: object())
    with TestClient(app) as client:
        response = post(client, "openai")
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "provider_not_configured"


def test_requires_bearer_and_valid_body(client: TestClient) -> None:
    assert client.post("/v1/providers/test", json={"provider": "none"}).status_code == 401
    bad = client.post("/v1/providers/test", headers=AUTH, json={"provider": "gemini"})
    assert bad.status_code == 400
    assert bad.json()["error"]["code"] == "invalid_request"


@pytest.mark.parametrize(
    "echoed",
    [
        "sk-ant-api03-********wXyZ",
        "sk-proj-********abcd",
        "sk-ant-api03-AbCd…wXyZ",
        "sk-ant-api03-AbCd...wXyZ",
        "sk-********1234",
    ],
)
def test_masked_keys_echoed_by_the_provider_are_scrubbed(client: TestClient, echoed: str) -> None:
    use(client, FakeProvider([ProviderAuthError(f"401 Incorrect API key provided: {echoed}.")]))

    response = post(client)

    assert response.json()["error"]["code"] == "provider_auth_failed"
    assert echoed not in response.text
    assert "sk-" not in response.text.replace("[REDACTED]", "")


def test_hung_provider_is_cut_off_after_the_timeout(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    release = threading.Event()

    def hang(conversation: list[Any]) -> Any:
        release.wait(10)
        return make_turn(text=ANSWER)

    monkeypatch.setattr("app.api.providers.TEST_TIMEOUT_S", 0.2)
    use(client, FakeProvider([hang]))
    started = time.perf_counter()
    try:
        body = post(client).json()
    finally:
        release.set()

    assert time.perf_counter() - started < 5
    assert body["ok"] is False
    assert body["error"]["code"] == "llm_timeout"
    assert body["usage"] is None


def test_scrub_masks_the_whole_three_dot_key_and_spares_words_ending_in_sk() -> None:
    settings = Settings(vision_service_token="t" * 32)

    out = _scrub("key sk-ant-api03-AbCd...wXyZ rejected; ask task-manager or desk-lamp-9", settings)

    assert out == "key [REDACTED] rejected; ask task-manager or desk-lamp-9"
