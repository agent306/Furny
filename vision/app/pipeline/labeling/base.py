"""The labeler interface (06 section 9.1): every labeler turns the CV candidates into a ``LabelingResult``."""

from dataclasses import dataclass, field
from typing import Any, Protocol

from app.pipeline.context import PipelineContext
from app.pipeline.normalize import NormalizedPage
from app.providers.base import UsageCall
from app.providers.usage import usage_call_out
from app.schemas.api import RecognizeHints
from app.schemas.candidates import CandidateSet
from app.schemas.labeling import LabelingResult
from app.schemas.meta import FallbackReason, ProviderName


@dataclass
class LabelingOutcome:
    """A labeler's result and how it came about.

    ``calls`` holds the provider's ``UsageCall`` records (18 section 6.4). ``partial`` is set when an agent
    loop ended early and the result covers only what it had. ``transcript`` summarises the model calls for
    the debug artifact (one entry per call: purpose, stop reason, status, images, tool calls with arguments;
    never images or texts); it is empty for the heuristic labeler.
    """

    result: LabelingResult
    provider_used: ProviderName
    model: str | None
    fallback_reason: FallbackReason | None
    calls: list[UsageCall]
    partial: bool
    transcript: list[dict[str, Any]] = field(default_factory=list)

    def debug_summary(self) -> dict[str, Any]:
        """The body of debug artifact ``07-labeling.json`` (06 section 13), for any labeler."""
        return {
            "providerUsed": self.provider_used,
            "model": self.model,
            "fallbackReason": self.fallback_reason,
            "partial": self.partial,
            "result": self.result.model_dump(mode="json", by_alias=True),
            "notes": self.result.notes,
            "calls": [usage_call_out(c).model_dump(mode="json", by_alias=True) for c in self.calls],
            "transcript": self.transcript,
        }


class Labeler(Protocol):
    def label(
        self, page: NormalizedPage, candidates: CandidateSet, hints: RecognizeHints, ctx: PipelineContext
    ) -> LabelingOutcome: ...
