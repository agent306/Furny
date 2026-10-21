"""The labeler interface (06 section 9.1): every labeler turns the CV candidates into a ``LabelingResult``."""

from dataclasses import dataclass
from typing import Any, Protocol

from app.pipeline.context import PipelineContext
from app.pipeline.normalize import NormalizedPage
from app.schemas.api import RecognizeHints
from app.schemas.candidates import CandidateSet
from app.schemas.labeling import LabelingResult
from app.schemas.meta import FallbackReason, ProviderName


@dataclass
class LabelingOutcome:
    """A labeler's result and how it came about.

    ``calls`` holds the provider's ``UsageCall`` records (18 section 6.4, Task 22); typed ``Any`` until that
    type exists. ``partial`` is set when an agent loop ended early and the result covers only what it had.
    """

    result: LabelingResult
    provider_used: ProviderName
    model: str | None
    fallback_reason: FallbackReason | None
    calls: list[Any]
    partial: bool


class Labeler(Protocol):
    def label(
        self, page: NormalizedPage, candidates: CandidateSet, hints: RecognizeHints, ctx: PipelineContext
    ) -> LabelingOutcome: ...
