"""JSON logging with redaction (06 §5.3)."""

import json
import logging
from collections.abc import Iterator

import pytest

from app.logging import JsonFormatter, RedactionFilter, configure_logging, request_id_var

LOGGER_NAME = "furny.vision"


@pytest.fixture(autouse=True)
def reset_logger() -> Iterator[None]:
    yield
    logger = logging.getLogger(LOGGER_NAME)
    for handler in list(logger.handlers):
        logger.removeHandler(handler)
    logger.setLevel(logging.NOTSET)


def _lines(capsys: pytest.CaptureFixture[str]) -> list[str]:
    return [line for line in capsys.readouterr().out.splitlines() if line.strip()]


def test_json_log_shape(capsys: pytest.CaptureFixture[str]) -> None:
    configure_logging("info")
    token = request_id_var.set("01JB")
    try:
        logging.getLogger(LOGGER_NAME).info("hello", extra={"stage": "ocr", "durationMs": 12})
    finally:
        request_id_var.reset(token)
    lines = _lines(capsys)
    assert len(lines) == 1
    entry = json.loads(lines[0])
    assert list(entry) == ["ts", "level", "msg", "requestId", "stage", "durationMs"]
    assert entry["level"] == "info"
    assert entry["msg"] == "hello"
    assert entry["requestId"] == "01JB"
    assert entry["stage"] == "ocr"
    assert entry["durationMs"] == 12
    # ISO-8601 UTC with milliseconds.
    assert len(entry["ts"]) == len("2026-10-20T12:34:56.789Z")
    assert entry["ts"].endswith("Z")


def test_request_id_null_outside_request(capsys: pytest.CaptureFixture[str]) -> None:
    configure_logging("info")
    logging.getLogger(LOGGER_NAME).warning("no request")
    entry = json.loads(_lines(capsys)[0])
    assert entry["requestId"] is None
    assert entry["level"] == "warning"


def test_level_filtering(capsys: pytest.CaptureFixture[str]) -> None:
    configure_logging("warning")
    logger = logging.getLogger(LOGGER_NAME)
    logger.info("hidden")
    logger.error("shown")
    lines = _lines(capsys)
    assert [json.loads(line)["msg"] for line in lines] == ["shown"]


def test_configure_logging_is_idempotent(capsys: pytest.CaptureFixture[str]) -> None:
    configure_logging("info")
    configure_logging("debug")
    logging.getLogger(LOGGER_NAME).debug("once")
    assert len(_lines(capsys)) == 1


def test_redacts_secrets_and_presigned(
    capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-secret-123456")
    monkeypatch.setenv("VISION_SERVICE_TOKEN", "t" * 32)
    configure_logging("info")
    logging.getLogger(LOGGER_NAME).info(
        "key sk-ant-secret-123456 url https://s3/x.png?X-Amz-Signature=abc&X-Amz-Credential=def"
    )
    out = "\n".join(_lines(capsys))
    assert "sk-ant-secret-123456" not in out
    assert "X-Amz-Signature=abc" not in out
    assert "X-Amz-Credential=def" not in out
    assert "[REDACTED]" in out
    assert "https://s3/x.png?[REDACTED]" in out


def test_redacts_args_extras_and_exceptions(
    capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "sk-openai-987654321")
    configure_logging("info")
    logger = logging.getLogger(LOGGER_NAME)
    try:
        raise RuntimeError("boom sk-openai-987654321")
    except RuntimeError:
        logger.exception("failed with %s", "sk-openai-987654321", extra={"detail": "k=sk-openai-987654321"})
    out = "\n".join(_lines(capsys))
    assert "sk-openai-987654321" not in out
    entry = json.loads(out)
    assert entry["detail"] == "k=[REDACTED]"
    assert "RuntimeError" in entry["exc"]


def test_short_env_values_not_redacted(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SOME_TOKEN", "abc")
    record = logging.LogRecord("x", logging.INFO, "f", 1, "value abc stays", (), None)
    RedactionFilter().filter(record)
    assert record.getMessage() == "value abc stays"


def test_formatter_skips_standard_attributes() -> None:
    record = logging.LogRecord("x", logging.INFO, "f", 1, "m", (), None)
    record.provider = "anthropic"
    entry = json.loads(JsonFormatter().format(record))
    assert entry["provider"] == "anthropic"
    assert set(entry) == {"ts", "level", "msg", "requestId", "provider"}


def test_redacts_nested_and_non_string_extras(
    capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    class Holder:
        def __str__(self) -> str:
            return "holder sk-ant-secret-123456"

    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-secret-123456")
    configure_logging("info")
    logging.getLogger(LOGGER_NAME).info(
        "nested",
        extra={
            "d": {"k": "sk-ant-secret-123456", "u": "https://s3/x?X-Amz-Signature=abc", "n": 3},
            "items": ["a", ("sk-ant-secret-123456", {"deep": "https://s3/y?X-Amz-Credential=def"})],
            "obj": Holder(),
            "count": 7,
        },
    )
    out = "\n".join(_lines(capsys))
    assert "sk-ant-secret-123456" not in out
    assert "X-Amz-Signature=abc" not in out
    assert "X-Amz-Credential=def" not in out
    entry = json.loads(out)
    assert entry["d"] == {"k": "[REDACTED]", "u": "https://s3/x?[REDACTED]", "n": 3}
    assert entry["items"][1][1] == {"deep": "https://s3/y?[REDACTED]"}
    assert entry["obj"] == "holder [REDACTED]"
    assert entry["count"] == 7
