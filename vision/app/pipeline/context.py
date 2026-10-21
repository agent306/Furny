"""Per-request pipeline context: deadline, stage timings, deduplicated warnings, debug sink (06 §5.2, §7)."""

import time
from collections.abc import Iterator, Sequence
from contextlib import contextmanager

from app.api.errors import VisionError
from app.pipeline.debug import DebugSink
from app.schemas.meta import MetaWarning, StageKey, WarningCode
from app.utils.http import SourceIO
from app.utils.timing import monotonic_ms

Params = dict[str, str | int | float]


class PipelineContext:
    """Mutable on purpose: later stages shorten `deadline` in place."""

    def __init__(self, deadline: float, io: SourceIO, debug: DebugSink, request_id: str | None) -> None:
        self.deadline = deadline  # absolute `time.monotonic()` value
        self.io = io
        self.debug = debug
        self.request_id = request_id
        self.timings: dict[str, int] = {}
        self.warnings: list[MetaWarning] = []

    @classmethod
    def for_request(
        cls, seconds: float, io: SourceIO, *, debug: bool, request_id: str | None = None
    ) -> "PipelineContext":
        return cls(time.monotonic() + seconds, io, DebugSink(debug), request_id)

    def remaining(self) -> float:
        return self.deadline - time.monotonic()

    def check_deadline(self) -> None:
        if self.remaining() <= 0:
            raise VisionError("deadline_exceeded", "Request deadline exceeded")

    @contextmanager
    def stage(self, name: StageKey) -> Iterator[None]:
        """Add the elapsed ms to `timings[name]` (also when the body raises)."""
        started = monotonic_ms()
        try:
            yield
        finally:
            self.timings[name] = self.timings.get(name, 0) + (monotonic_ms() - started)

    def warn(
        self,
        code: WarningCode,
        params: Params | None = None,
        entity_ids: Sequence[str] = (),
    ) -> None:
        """Record a warning once per (code, params); later entity ids are merged into the first."""
        params = params or {}
        for existing in self.warnings:
            if existing.code == code and existing.params == params:
                existing.entity_ids.extend(e for e in entity_ids if e not in existing.entity_ids)
                return
        self.warnings.append(
            MetaWarning(code=code, params=dict(params), entity_ids=list(dict.fromkeys(entity_ids)))
        )
