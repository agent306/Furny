"""JSON logging to stdout with secret and presigned-URL redaction (06 §5.3)."""

import json
import logging
import os
import re
import sys
from contextvars import ContextVar
from datetime import UTC, datetime
from typing import Any

LOGGER_NAME = "furny.vision"
REDACTED = "[REDACTED]"
MIN_SECRET_LENGTH = 8

request_id_var: ContextVar[str | None] = ContextVar("request_id", default=None)

_PRESIGNED_QUERY = re.compile(r"(\?[^\s\"']*X-Amz-[^\s\"']*)")

# Attributes every LogRecord has (plus ones added by the formatter or by newer Pythons).
_STANDARD_ATTRS = frozenset(logging.LogRecord("", 0, "", 0, "", (), None).__dict__) | {
    "message",
    "asctime",
    "taskName",
}


def _secret_values() -> list[str]:
    """Env values of `*_API_KEY` / `*_TOKEN` variables, longest first."""
    values = {
        value
        for name, value in os.environ.items()
        if name.upper().endswith(("_API_KEY", "_TOKEN")) and len(value) >= MIN_SECRET_LENGTH
    }
    return sorted(values, key=len, reverse=True)


class RedactionFilter(logging.Filter):
    """Redacts secret env values and presigned query strings in message, extras (nested too), traceback."""

    def __init__(self) -> None:
        super().__init__()
        self._secrets = _secret_values()

    def redact(self, text: str) -> str:
        text = _PRESIGNED_QUERY.sub(f"?{REDACTED}", text)
        for secret in self._secrets:
            text = text.replace(secret, REDACTED)
        return text

    def redact_value(self, value: Any) -> Any:
        """Redact recursively; values that JSON would stringify are redacted as their string form."""
        if value is None or isinstance(value, bool | int | float):
            return value
        if isinstance(value, str):
            return self.redact(value)
        if isinstance(value, dict):
            return {
                (self.redact(k) if isinstance(k, str) else k): self.redact_value(v) for k, v in value.items()
            }
        if isinstance(value, list | tuple | set | frozenset):
            return [self.redact_value(v) for v in value]
        return self.redact(str(value))

    def filter(self, record: logging.LogRecord) -> bool:
        record.msg = self.redact(record.getMessage())
        record.args = None
        for key, value in list(record.__dict__.items()):
            if key not in _STANDARD_ATTRS:
                record.__dict__[key] = self.redact_value(value)
        if record.exc_info and record.exc_info[0] is not None:
            record.exc_text = self.redact(logging.Formatter().formatException(record.exc_info))
            record.exc_info = None
        elif record.exc_text:
            record.exc_text = self.redact(record.exc_text)
        return True


class JsonFormatter(logging.Formatter):
    """One JSON object per line: ts, level, msg, requestId, then every extra key."""

    def format(self, record: logging.LogRecord) -> str:
        ts = datetime.fromtimestamp(record.created, UTC).isoformat(timespec="milliseconds")
        entry: dict[str, Any] = {
            "ts": ts.replace("+00:00", "Z"),
            "level": record.levelname.lower(),
            "msg": record.getMessage(),
            "requestId": request_id_var.get(),
        }
        for key, value in record.__dict__.items():
            if key not in _STANDARD_ATTRS and key not in entry:
                entry[key] = value
        if record.exc_info and record.exc_info[0] is not None:
            entry["exc"] = self.formatException(record.exc_info)
        elif record.exc_text:
            entry["exc"] = record.exc_text
        return json.dumps(entry, default=str, ensure_ascii=False)


def configure_logging(level: str) -> None:
    """Install the JSON stdout handler on the `furny.vision` logger (idempotent)."""
    logger = logging.getLogger(LOGGER_NAME)
    for handler in list(logger.handlers):
        logger.removeHandler(handler)
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    handler.addFilter(RedactionFilter())
    logger.addHandler(handler)
    logger.setLevel(level.upper())
    logger.propagate = False
