"""API core: error mapping, bearer auth, concurrency slots, request id, /healthz (06 §5.2-§5.7, §14.2)."""

import json
import threading
import time
from collections.abc import Callable, Iterator
from contextlib import ExitStack
from typing import Any

import pytest
from fastapi import Depends
from fastapi.testclient import TestClient
from pydantic import BaseModel

from app.api.deps import heavy_slot, light_slot, require_token
from app.api.errors import ERROR_TABLE, VisionError, error_response
from app.config import Settings
from app.main import create_app

TOKEN = "t" * 32
AUTH = {"Authorization": f"Bearer {TOKEN}"}


class Body(BaseModel):
    name: str
    count: int


def _boom() -> None:
    raise RuntimeError("boom")


def _add_dummy_routes(client_app: Any) -> None:
    client_app.add_api_route(
        "/auth", lambda: {"ok": True}, methods=["GET"], dependencies=[Depends(require_token)]
    )
    client_app.add_api_route(
        "/heavy", lambda: {"ok": True}, methods=["GET"], dependencies=[Depends(heavy_slot)]
    )
    client_app.add_api_route(
        "/light", lambda: {"ok": True}, methods=["GET"], dependencies=[Depends(light_slot)]
    )
    client_app.add_api_route("/boom", _boom, methods=["GET"])

    async def body_route(body: Body) -> dict[str, str]:
        return {"name": body.name}

    client_app.add_api_route("/body", body_route, methods=["POST"])

    async def err_route() -> None:
        raise VisionError("source_unavailable", "fetch failed", details={"status": 404}, usage={"calls": 0})

    client_app.add_api_route("/err", err_route, methods=["GET"])

    async def heavy_fail() -> None:
        raise VisionError("no_walls_detected")

    client_app.add_api_route("/heavy-fail", heavy_fail, methods=["GET"], dependencies=[Depends(heavy_slot)])


@pytest.fixture
def make_client() -> Iterator[Callable[..., TestClient]]:
    stack = ExitStack()

    def _make(ocr_factory: Callable[[], Any] | None = None, **settings_overrides: Any) -> TestClient:
        app = create_app(
            Settings(vision_service_token=TOKEN, **settings_overrides),
            ocr_factory=ocr_factory or (lambda: object()),
        )
        _add_dummy_routes(app)
        return stack.enter_context(TestClient(app, raise_server_exceptions=False))

    with stack:
        yield _make


def _wait_loaded(client: TestClient, timeout: float = 2.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if client.get("/healthz").status_code == 200:
            return
        time.sleep(0.01)
    raise AssertionError("ocr never loaded")


def test_healthz_no_auth(make_client: Callable[..., TestClient]) -> None:
    client = make_client()
    _wait_loaded(client)
    res = client.get("/healthz")
    assert res.status_code == 200
    assert res.json() == {"status": "ok", "version": "1.0.0", "ocrLoaded": True}
    assert client.app.state.ocr_loaded is True  # type: ignore[attr-defined]


def test_healthz_503_until_ocr_loaded(make_client: Callable[..., TestClient]) -> None:
    release = threading.Event()
    try:
        client = make_client(ocr_factory=lambda: release.wait(5) or object())
        res = client.get("/healthz")
        assert res.status_code == 503
        assert res.json()["ocrLoaded"] is False
        release.set()
        _wait_loaded(client)
    finally:
        release.set()


def test_healthz_stays_503_when_ocr_load_fails(make_client: Callable[..., TestClient]) -> None:
    def failing() -> object:
        raise RuntimeError("no model")

    client = make_client(ocr_factory=failing)
    time.sleep(0.1)
    res = client.get("/healthz")
    assert res.status_code == 503
    assert res.json()["ocrLoaded"] is False


def test_no_docs_endpoints(make_client: Callable[..., TestClient]) -> None:
    client = make_client()
    for path in ("/docs", "/redoc", "/openapi.json"):
        assert client.get(path).status_code == 404


@pytest.mark.parametrize(
    "headers",
    [
        {},
        {"Authorization": "Bearer wrong"},
        {"Authorization": "Basic x"},
        {"Authorization": "Bearer"},
        {"Authorization": TOKEN},
    ],
)
def test_auth_rejected(make_client: Callable[..., TestClient], headers: dict[str, str]) -> None:
    res = make_client().get("/auth", headers=headers)
    assert res.status_code == 401
    body = res.json()
    assert body["error"].pop("message")
    assert body == {"error": {"code": "unauthorized", "retryable": False, "details": {}, "usage": None}}


def test_auth(make_client: Callable[..., TestClient]) -> None:
    client = make_client()
    assert client.get("/auth", headers=AUTH).status_code == 200
    assert client.get("/auth", headers={"Authorization": f"bearer {TOKEN}"}).status_code == 200
    assert client.get("/auth", headers={"Authorization": f"BEARER   {TOKEN}"}).status_code == 200
    assert client.get("/auth", headers={"Authorization": f"Bearer {TOKEN}x"}).status_code == 401


def test_auth_non_ascii_token_is_401_not_500(make_client: Callable[..., TestClient]) -> None:
    res = make_client().get("/auth", headers={"Authorization": "Bearer caf\xe9".encode("latin-1")})
    assert res.status_code == 401


def test_busy(make_client: Callable[..., TestClient]) -> None:
    client = make_client(vision_heavy_slot_wait_s=0.1)
    sem = client.app.state.heavy_sem  # type: ignore[attr-defined]
    client.portal.call(sem.acquire)  # type: ignore[union-attr]
    try:
        res = client.get("/heavy")
    finally:
        sem.release()
    assert res.status_code == 503
    assert res.headers["Retry-After"] == "20"
    assert res.json()["error"]["code"] == "busy"
    assert res.json()["error"]["retryable"] is True
    assert client.get("/heavy").status_code == 200


def test_light_slot_allows_two_then_busy(make_client: Callable[..., TestClient]) -> None:
    client = make_client(vision_heavy_slot_wait_s=0.1)
    sem = client.app.state.light_sem  # type: ignore[attr-defined]
    client.portal.call(sem.acquire)  # type: ignore[union-attr]
    assert client.get("/light").status_code == 200  # one of two permits still free
    client.portal.call(sem.acquire)  # type: ignore[union-attr]
    try:
        res = client.get("/light")
    finally:
        sem.release()
        sem.release()
    assert res.status_code == 503
    assert res.headers["Retry-After"] == "20"
    assert res.json()["error"]["code"] == "busy"


def test_heavy_slot_released_after_error(make_client: Callable[..., TestClient]) -> None:
    client = make_client(vision_heavy_slot_wait_s=0.1)
    assert client.get("/heavy-fail").status_code == 422
    assert client.get("/heavy-fail").status_code == 422  # a leaked permit would make this 503


def test_vision_error_body(make_client: Callable[..., TestClient]) -> None:
    res = make_client().get("/err")
    assert res.status_code == 502
    assert res.json() == {
        "error": {
            "code": "source_unavailable",
            "message": "fetch failed",
            "retryable": True,
            "details": {"status": 404},
            "usage": {"calls": 0},
        }
    }


def test_validation_error_is_400(make_client: Callable[..., TestClient]) -> None:
    res = make_client().post("/body", json={"name": "x", "count": "many"})
    assert res.status_code == 400
    error = res.json()["error"]
    assert error["code"] == "invalid_request"
    assert error["retryable"] is False
    errors = error["details"]["errors"]
    assert isinstance(errors, list) and errors
    assert all(set(e) == {"loc", "msg"} for e in errors)
    assert ["body", "count"] in [e["loc"] for e in errors]
    assert "many" not in res.text  # the offending input is not echoed back


def test_unexpected_exception_is_500(make_client: Callable[..., TestClient]) -> None:
    res = make_client().get("/boom", headers={"X-Request-Id": "r-500"})
    assert res.status_code == 500
    error = res.json()["error"]
    assert error["code"] == "internal_error"
    assert error["retryable"] is True
    assert error["message"] == "Internal error"
    assert "boom" not in res.text
    assert res.headers["X-Request-Id"] == "r-500"


def test_unexpected_exception_stack_goes_to_logs(
    make_client: Callable[..., TestClient], capsys: pytest.CaptureFixture[str]
) -> None:
    make_client().get("/boom")
    lines = [json.loads(line) for line in capsys.readouterr().out.splitlines() if line.startswith("{")]
    failure = next(line for line in lines if line["msg"] == "unhandled exception")
    assert "RuntimeError: boom" in failure["exc"]
    assert failure["level"] == "error"


def test_request_id_echoed(make_client: Callable[..., TestClient]) -> None:
    res = make_client().get("/healthz", headers={"X-Request-Id": "abc"})
    assert res.headers["X-Request-Id"] == "abc"


def test_request_id_generated(make_client: Callable[..., TestClient]) -> None:
    res = make_client().get("/healthz")
    assert len(res.headers["X-Request-Id"]) == 32
    int(res.headers["X-Request-Id"], 16)


def test_access_log_line(make_client: Callable[..., TestClient], capsys: pytest.CaptureFixture[str]) -> None:
    client = make_client()
    client.get("/auth?secret=1", headers={"X-Request-Id": "log-1"})
    lines = [json.loads(line) for line in capsys.readouterr().out.splitlines() if line.startswith("{")]
    access = [line for line in lines if line["msg"] == "request"]
    assert len(access) == 1
    assert access[0]["path"] == "/auth"  # no query string
    assert access[0]["status"] == 401
    assert access[0]["requestId"] == "log-1"
    assert isinstance(access[0]["durationMs"], int)


def test_error_table() -> None:
    assert ERROR_TABLE == {
        "invalid_request": (400, False),
        "invalid_page": (400, False),
        "provider_not_configured": (400, False),
        "unauthorized": (401, False),
        "file_too_large": (413, False),
        "image_too_large": (413, False),
        "unsupported_type": (415, False),
        "dwg_not_supported": (415, False),
        "corrupt_file": (422, False),
        "pdf_encrypted": (422, False),
        "pdf_too_many_pages": (422, False),
        "image_too_small": (422, False),
        "dxf_too_complex": (422, False),
        "not_a_floor_plan": (422, False),
        "no_walls_detected": (422, False),
        "too_complex": (422, False),
        "source_unavailable": (502, True),
        "provider_error": (502, True),
        "upload_failed": (502, True),
        "busy": (503, True),
        "deadline_exceeded": (504, False),
        "internal_error": (500, True),
        # 06 §5.8
        "decode_failed": (422, False),
        "too_large": (413, False),
        "unsupported": (415, False),
    }


def test_vision_error_defaults_and_overrides() -> None:
    err = VisionError("busy")
    assert (err.http_status, err.retryable, err.details, err.usage, err.headers) == (503, True, {}, None, {})
    over = VisionError("provider_error", "x", http_status=504, retryable=False, headers={"A": "b"})
    assert (over.http_status, over.retryable, over.headers) == (504, False, {"A": "b"})
    assert error_response(over).headers["A"] == "b"
    with pytest.raises(ValueError):
        VisionError("not_in_table")
    assert VisionError("custom", http_status=409).retryable is False


def test_sentry_only_initialised_with_dsn(
    make_client: Callable[..., TestClient], monkeypatch: pytest.MonkeyPatch
) -> None:
    import sentry_sdk

    calls: list[dict[str, Any]] = []
    monkeypatch.setattr(sentry_sdk, "init", lambda **kw: calls.append(kw))
    make_client()
    assert calls == []
    make_client(sentry_dsn="https://key@example.invalid/1")
    assert len(calls) == 1
    assert calls[0]["dsn"] == "https://key@example.invalid/1"
    assert calls[0]["send_default_pii"] is False
    assert calls[0]["max_request_body_size"] == "never"
    assert calls[0]["include_local_variables"] is False


def test_sentry_before_send_scrubs_secrets_and_presigned_urls(
    make_client: Callable[..., TestClient], monkeypatch: pytest.MonkeyPatch
) -> None:
    import sentry_sdk

    secret = "sk-test-0123456789abcdef"
    monkeypatch.setenv("ANTHROPIC_API_KEY", secret)
    calls: list[dict[str, Any]] = []
    monkeypatch.setattr(sentry_sdk, "init", lambda **kw: calls.append(kw))
    make_client(sentry_dsn="https://key@example.invalid/1")
    url = "https://bucket.s3.example/plan.png?X-Amz-Signature=abc123&X-Amz-Credential=cred"
    event = {
        "message": f"fetch failed: {url}",
        "exception": {"values": [{"type": "HTTPStatusError", "value": f"404 for url '{url}' key={secret}"}]},
        "request": {"url": "http://vision/v1/recognize", "data": {"sourceUrl": url}},
        "extra": {"n": 3},
    }
    scrubbed = calls[0]["before_send"](event, {})
    dumped = json.dumps(scrubbed)
    assert "X-Amz" not in dumped and "abc123" not in dumped and secret not in dumped
    assert "[REDACTED]" in scrubbed["exception"]["values"][0]["value"]
    assert scrubbed["extra"] == {"n": 3}
    assert scrubbed["request"]["url"] == "http://vision/v1/recognize"


def test_module_app_is_lazy(monkeypatch: pytest.MonkeyPatch) -> None:
    import importlib

    import app.main as main

    monkeypatch.delenv("VISION_SERVICE_TOKEN", raising=False)
    main = importlib.reload(main)  # a fresh module without a cached `app`; importing needs no settings
    assert "app" not in vars(main)
    monkeypatch.setenv("VISION_SERVICE_TOKEN", TOKEN)
    from app.config import get_settings

    get_settings.cache_clear()
    try:
        built = main.app  # type: ignore[attr-defined]
        assert built.state.settings.vision_service_token.get_secret_value() == TOKEN
        assert main.app is built  # type: ignore[attr-defined]
    finally:
        get_settings.cache_clear()
