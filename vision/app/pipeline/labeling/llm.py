"""The LLM labeler (06 section 9.1, 9.4; 18 section 7.3, 7.5).

Single pass: one structured call, at most one repair round for providers without a native JSON schema, then
``sanitize``. Any provider failure, an answer that stays invalid, or one that sanitize mostly drops degrades
to the heuristic labeler (06 section 9.6: labeling degrades instead of failing) unless the options forbid it.
The agent loop (Task 27) plugs in at ``LlmLabeler._agent``.

Never logged or returned: prompts, model responses, image bytes.
"""

import contextvars
import json
import re
import threading
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass, replace
from typing import Any

from pydantic import BaseModel, ValidationError

from app.api.errors import VisionError
from app.pipeline.annotate import Overview, build_overview, from_overview, to_image_part
from app.pipeline.context import PipelineContext
from app.pipeline.debug import DebugSink
from app.pipeline.labeling.base import LabelingOutcome
from app.pipeline.labeling.heuristic import HeuristicLabeler
from app.pipeline.labeling.prompts import (
    JSON_SCHEMA_INSTRUCTION_TEMPLATE,
    REPAIR_PROMPT_TEMPLATE,
    SYSTEM_PROMPT_LABELING,
    build_user_prompt,
)
from app.pipeline.normalize import NormalizedPage
from app.providers.base import (
    Effort,
    JsonSchemaSpec,
    LLMProvider,
    Message,
    Part,
    TextPart,
    TurnResult,
    UsageCall,
    UserMessage,
)
from app.providers.errors import (
    ProviderError,
    ProviderInvalidOutput,
    ProviderRefusal,
    ProviderTimeout,
    fallback_reason_for,
)
from app.providers.usage import build_usage
from app.schemas.api import RecognizeHints
from app.schemas.candidates import CandidateSet
from app.schemas.labeling import (
    DimensionLabel,
    KnownDimensionMatch,
    LabelingResult,
    OpeningLabel,
    RoomLabel,
    TextLabel_,
    WallLabel,
)
from app.schemas.meta import FallbackReason
from app.utils.json_schema import parse_json_object, to_strict_schema

LLM_STAGE_RESERVE_S = 60.0  # the LLM stage ends this long before the request deadline (06 section 9.6)
DEADLINE_GRACE_S = 2.0  # a provider honouring ``timeout_s`` reports its own timeout first; this cuts the rest
MIN_VALUE_MM = 50
MAX_VALUE_MM = 60_000
MAX_NAME_CHARS = 60
MAX_NOTES_CHARS = 500
MAX_DROPPED_RATIO = 0.2
MAX_REPAIR_ERRORS = 20
DEFAULT_MAX_OUTPUT_TOKENS = 32_000


@dataclass(frozen=True)
class LabelerOptions:
    """The ``ai`` settings one labeling run uses (06 section 5.5; 18 section 8.4)."""

    agentic_crops: bool
    effort: Effort
    fallback_to_none: bool
    max_turns: int
    max_crops: int
    call_timeout_s: float
    stage_budget_s: float
    max_output_tokens: int


# --- one provider call, one JSON answer ------------------------------------------------------------------


def _complete(
    provider: LLMProvider,
    conversation: list[Message],
    *,
    system: str,
    schema: JsonSchemaSpec | None,
    effort: Effort,
    max_output_tokens: int,
    timeout_s: float,
    purpose: str,
) -> TurnResult:
    """``provider.complete`` under the caller's own deadline.

    Some adapters ignore a shorter ``timeout_s`` (the compatible adapter always uses its configured one), so
    the call runs in a daemon thread and is abandoned after ``timeout_s`` plus a grace period; the SDK's own
    timeout ends the abandoned thread later. The usage of an abandoned call is lost.
    """
    box: dict[str, Any] = {}

    def target() -> None:
        try:
            box["turn"] = provider.complete(
                conversation,
                system=system,
                tools=[],
                tool_choice="none",
                output_schema=schema,
                effort=effort,
                max_output_tokens=max_output_tokens,
                timeout_s=timeout_s,
                purpose=purpose,
            )
        except BaseException as exc:  # handed to the caller's thread
            box["error"] = exc

    worker = threading.Thread(target=contextvars.copy_context().run, args=(target,), daemon=True)
    worker.start()
    worker.join(timeout_s + DEADLINE_GRACE_S)
    if worker.is_alive():
        raise ProviderTimeout("The model did not answer in time.")
    if "error" in box:
        raise box["error"]
    turn: TurnResult = box["turn"]
    return turn


def _schema_name(model: type[BaseModel]) -> str:
    if model is LabelingResult:
        return "floor_plan_labels"
    return re.sub(r"(?<!^)(?=[A-Z])", "_", model.__name__).lower()


def _error_lines(exc: ValueError) -> list[str]:
    """Up to ``MAX_REPAIR_ERRORS`` lines ``loc: msg`` (never the offending values)."""
    if isinstance(exc, ValidationError):
        lines = [f"{'.'.join(str(p) for p in e['loc']) or '$'}: {e['msg']}" for e in exc.errors()]
    else:
        lines = [f"$: {exc}"]
    return lines[:MAX_REPAIR_ERRORS]


def complete_json[M: BaseModel](
    provider: LLMProvider,
    conversation: list[Message],
    *,
    system: str,
    schema_model: type[M],
    effort: Effort,
    timeout_s: float,
    purpose: str,
    ctx: PipelineContext,
    max_output_tokens: int = DEFAULT_MAX_OUTPUT_TOKENS,
    deadline: float | None = None,
) -> tuple[M, list[UsageCall], bool]:
    """One structured call without tools, parsed into ``schema_model``, plus at most one repair round.

    A provider with a native JSON schema gets it as ``output_schema``; an invalid answer is then a provider
    fault (06 section 9.6 step 2e) and raises ``ProviderInvalidOutput``. Any other provider gets the schema
    appended to the system prompt, and one invalid answer is repaired once (18 section 7.3). Returns the
    parsed model, the ``UsageCall`` of every call made and whether a repair round was needed. Provider errors
    propagate with ``.usage`` extended by the calls already made. ``deadline`` is an absolute
    ``time.monotonic()`` value (default: the request deadline).
    """
    until = ctx.deadline if deadline is None else deadline
    schema = to_strict_schema(schema_model)
    native = provider.capabilities.supports_json_schema
    spec = JsonSchemaSpec(_schema_name(schema_model), schema) if native else None
    if not native:
        schema_json = json.dumps(schema, separators=(",", ":"))
        system = system + "\n\n" + JSON_SCHEMA_INSTRUCTION_TEMPLATE.format(schema_json=schema_json)

    history = list(conversation)
    calls: list[UsageCall] = []
    for attempt in (0, 1):
        remaining = until - time.monotonic()
        if remaining <= 0:
            raise ProviderTimeout("No time left for the model call.", usage=calls)
        try:
            turn = _complete(
                provider,
                history,
                system=system,
                schema=spec,
                effort=effort,
                max_output_tokens=max_output_tokens,
                timeout_s=min(timeout_s, remaining),
                purpose=purpose if attempt == 0 else "repair",
            )
        except ProviderError as err:
            err.usage = [*calls, *err.usage]
            raise
        calls.append(turn.usage)
        if turn.stop_reason == "refusal":
            raise ProviderRefusal(
                "The model refused the request.", usage=[*calls[:-1], replace(turn.usage, status="failed")]
            )
        if turn.stop_reason == "max_tokens":
            raise ProviderInvalidOutput("The model output was truncated.", usage=calls)
        try:
            return (
                schema_model.model_validate(parse_json_object(turn.assistant.text or "")),
                calls,
                attempt == 1,
            )
        except ValueError as exc:
            errors = _error_lines(exc)
        if native or attempt == 1:
            raise ProviderInvalidOutput("The model answer does not match the schema.", usage=calls)
        history = [
            *history,
            turn.assistant,
            UserMessage([TextPart(REPAIR_PROMPT_TEMPLATE.format(errors="\n".join(errors)))]),
        ]
    raise AssertionError("unreachable")  # pragma: no cover


# --- sanitize ---------------------------------------------------------------------------------------------


def _first_known[T](items: Sequence[T], key: Callable[[T], str], known: set[str]) -> dict[str, T]:
    """Entries with a known id, the first of each id winning."""
    kept: dict[str, T] = {}
    for item in items:
        k = key(item)
        if k in known and k not in kept:
            kept[k] = item
    return kept


def _clamp_mm(value: int | None) -> int | None:
    return value if value is not None and MIN_VALUE_MM <= value <= MAX_VALUE_MM else None


def _known(value: str | None, known: set[str]) -> str | None:
    return value if value in known else None


def sanitize(
    result: LabelingResult, candidates: CandidateSet, heuristic: LabelingResult
) -> tuple[LabelingResult, float]:
    """Make a model answer safe for assembly (06 section 9.4); the second value is the dropped ratio.

    Drops entries with unknown ids and repeats of an id (the first wins), nulls unknown references and
    millimetre values outside 50..60000, truncates names and notes, and gives candidates the model did not
    mention their heuristic label (so partial answers are usable). Missed rooms and openings are passed
    through untouched in the model's own (overview pixel) coordinates.
    """
    c = candidates
    text_ids = {t.id for t in c.texts}
    span_ids = {s.id for s in c.spans}
    room_ids = {r.id for r in c.rooms}
    wall_ids = {w.id for w in c.walls}
    opening_ids = {o.id for o in c.openings}

    texts = _first_known(result.texts, lambda x: x.id, text_ids)
    dims = _first_known(result.dimensions, lambda x: x.text_id, text_ids)
    rooms = _first_known(result.rooms, lambda x: x.id, room_ids)
    walls = _first_known(result.walls, lambda x: x.id, wall_ids)
    openings = _first_known(result.openings, lambda x: x.id, opening_ids)
    missed_openings = [m for m in result.missed_openings if m.wall_id in wall_ids]

    total = (
        len(result.texts)
        + len(result.dimensions)
        + len(result.rooms)
        + len(result.walls)
        + len(result.openings)
        + len(result.missed_openings)
    )
    kept = len(texts) + len(dims) + len(rooms) + len(walls) + len(openings) + len(missed_openings)
    ratio = (total - kept) / total if total else 0.0

    h_texts = {x.id: x for x in heuristic.texts}
    h_rooms = {x.id: x for x in heuristic.rooms}
    h_walls = {x.id: x for x in heuristic.walls}
    h_openings = {x.id: x for x in heuristic.openings}

    final_texts: list[TextLabel_] = [
        x for x in (texts.get(t.id) or h_texts.get(t.id) for t in c.texts) if x is not None
    ]
    dimension_ids = {t.id for t in final_texts if t.role == "dimension"}
    final_dims: list[DimensionLabel] = [
        d.model_copy(update={"span_id": _known(d.span_id, span_ids), "value_mm": _clamp_mm(d.value_mm)})
        for d in dims.values()
    ]
    final_dims += [d for d in heuristic.dimensions if d.text_id not in dims and d.text_id in dimension_ids]

    def room(r: RoomLabel) -> RoomLabel:
        return r.model_copy(
            update={
                "name": r.name[:MAX_NAME_CHARS] if r.name is not None else None,
                "name_text_id": _known(r.name_text_id, text_ids),
                "width_mm": _clamp_mm(r.width_mm),
                "depth_mm": _clamp_mm(r.depth_mm),
            }
        )

    match = result.known_dimension_match
    if match is not None:
        match = KnownDimensionMatch(
            wall_id=_known(match.wall_id, wall_ids), span_id=_known(match.span_id, span_ids)
        )

    walls_out: list[WallLabel] = [x for x in (walls.get(w.id) or h_walls.get(w.id) for w in c.walls) if x]
    openings_out: list[OpeningLabel] = [
        x for x in (openings.get(o.id) or h_openings.get(o.id) for o in c.openings) if x
    ]
    rooms_out: list[RoomLabel] = [
        x for x in (room(rooms[r.id]) if r.id in rooms else h_rooms.get(r.id) for r in c.rooms) if x
    ]
    clean = LabelingResult(
        unit_system=result.unit_system,
        drawing_kind=result.drawing_kind,
        texts=final_texts,
        dimensions=final_dims,
        rooms=rooms_out,
        missed_rooms=[m.model_copy(update={"name": m.name[:MAX_NAME_CHARS]}) for m in result.missed_rooms],
        walls=walls_out,
        openings=openings_out,
        missed_openings=missed_openings,
        known_dimension_match=match,
        notes=result.notes[:MAX_NOTES_CHARS] if result.notes is not None else None,
    )
    return clean, ratio


def _to_normalized(result: LabelingResult, ov: Overview) -> LabelingResult:
    """Missed rooms and openings arrive in overview px; downstream sees normalized px (06 section 8.7)."""

    def pt(x: int, y: int) -> dict[str, Any]:
        nx, ny = from_overview((x, y), ov)
        return {"x": round(nx), "y": round(ny)}

    return result.model_copy(
        update={
            "missed_rooms": [m.model_copy(update=pt(m.x, m.y)) for m in result.missed_rooms],
            "missed_openings": [m.model_copy(update=pt(m.x, m.y)) for m in result.missed_openings],
        }
    )


# --- the labeler ------------------------------------------------------------------------------------------


def _transcript(calls: list[UsageCall]) -> list[dict[str, Any]]:
    """One summary entry per model call; tool calls are added by the agent loop (Task 27)."""
    return [
        {
            "purpose": c.purpose,
            "stopReason": c.stop_reason,
            "status": c.status,
            "images": c.images,
            "toolCalls": [],
        }
        for c in calls
    ]


class LlmLabeler:
    """Labels the candidates with a vision model; see the module docstring for the degradation rules."""

    def __init__(self, provider: LLMProvider, options: LabelerOptions) -> None:
        self.provider = provider
        self.options = options

    def label(
        self, page: NormalizedPage, candidates: CandidateSet, hints: RecognizeHints, ctx: PipelineContext
    ) -> LabelingOutcome:
        caps = self.provider.capabilities
        if not caps.supports_vision:
            outcome = HeuristicLabeler().label(page, candidates, hints, ctx)
            return replace(outcome, fallback_reason="vision_unsupported")
        agentic = self.options.agentic_crops and caps.supports_tools
        if agentic:
            raise NotImplementedError("agentic labeling arrives with Task 27 (labeling/agent.py)")

        overview = build_overview(page, candidates, max_image_px=caps.max_image_px, ctx=ctx)
        deadline = min(ctx.deadline - LLM_STAGE_RESERVE_S, time.monotonic() + self.options.stage_budget_s)
        try:
            raw, calls, repaired = self._single_pass(overview, hints, ctx, deadline)
            # A scratch context: this pass only fills what the model left out, its warnings are not ours.
            scratch = PipelineContext(ctx.deadline, ctx.io, DebugSink(False), ctx.request_id)
            heuristic = HeuristicLabeler().label(page, candidates, hints, scratch)
            clean, dropped = sanitize(raw, candidates, heuristic.result)
            if dropped > MAX_DROPPED_RATIO:
                raise ProviderInvalidOutput("The model answer mostly refers to unknown ids.", usage=calls)
        except ProviderError as err:
            return self._fallback(page, candidates, hints, ctx, fallback_reason_for(err), err.usage)
        if repaired:
            ctx.warn("llm_output_repaired")
        return LabelingOutcome(
            result=_to_normalized(clean, overview),
            provider_used=self.provider.name,
            model=calls[-1].model,
            fallback_reason=None,
            calls=calls,
            partial=False,
            transcript=_transcript(calls),
        )

    def _single_pass(
        self, overview: Overview, hints: RecognizeHints, ctx: PipelineContext, deadline: float
    ) -> tuple[LabelingResult, list[UsageCall], bool]:
        two_images = self.provider.capabilities.max_images_per_request >= 2
        parts: list[Part] = [to_image_part(overview.clean)] if two_images else []
        parts.append(to_image_part(overview.marked))
        parts.append(
            TextPart(
                build_user_prompt(
                    overview, hints, two_images=two_images, tools=False, max_crops=self.options.max_crops
                )
            )
        )
        return complete_json(
            self.provider,
            [UserMessage(parts)],
            system=SYSTEM_PROMPT_LABELING,
            schema_model=LabelingResult,
            effort=self.options.effort,
            timeout_s=self.options.call_timeout_s,
            purpose="labeling",
            ctx=ctx,
            max_output_tokens=self.options.max_output_tokens,
            deadline=deadline,
        )

    def _fallback(
        self,
        page: NormalizedPage,
        candidates: CandidateSet,
        hints: RecognizeHints,
        ctx: PipelineContext,
        reason: FallbackReason,
        calls: list[UsageCall],
    ) -> LabelingOutcome:
        if not self.options.fallback_to_none:
            model = calls[-1].model if calls else self.provider.model
            raise VisionError(
                "provider_error",
                f"The AI provider could not label the drawing ({reason}).",
                retryable=True,
                details={"reason": reason},
                usage=build_usage(self.provider.name, model, calls, True),
            )
        ctx.warn("llm_failed_fallback_none", {"reason": reason})
        outcome = HeuristicLabeler().label(page, candidates, hints, ctx)
        return replace(
            outcome, fallback_reason=reason, calls=calls, transcript=_transcript(calls), partial=False
        )
