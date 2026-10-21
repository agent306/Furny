"""The agentic labeling loop (06 section 9.6): the model asks for crops, then answers with the labels.

Provider-agnostic. The conversation is append-only; the assistant message of every turn is kept exactly as the
provider returned it, and all tool results of one turn travel in one ``ToolResultsMessage``. The last turn
(turn limit or stage deadline) tells the model to stop using tools; a timeout in a middle turn gets one
finalize call of its own. Provider errors propagate with ``.usage`` holding every call made so far.

Never logged or returned: prompts, model responses, image bytes, exception texts of failing tools.
"""

import json
import logging
import time
from dataclasses import replace
from typing import Any, Literal

from app.pipeline.context import PipelineContext
from app.pipeline.labeling.llm import (
    LLM_STAGE_RESERVE_S,
    _complete,
    _error_lines,
    _schema_name,
    transcript_entry,
)
from app.pipeline.labeling.prompts import (
    FINALIZE_PROMPT,
    JSON_SCHEMA_INSTRUCTION_TEMPLATE,
    REPAIR_PROMPT_TEMPLATE,
)
from app.pipeline.labeling.tools import ToolExecutor
from app.providers.base import (
    AssistantMessage,
    Effort,
    JsonSchemaSpec,
    LLMProvider,
    Message,
    Part,
    TextPart,
    ToolCall,
    ToolResult,
    ToolResultsMessage,
    TurnResult,
    UsageCall,
    UserMessage,
)
from app.providers.errors import ProviderError, ProviderInvalidOutput, ProviderRefusal, ProviderTimeout
from app.schemas.labeling import LabelingResult
from app.utils.json_schema import parse_json_object, to_strict_schema

log = logging.getLogger("furny.vision.agent")

MIN_TURN_S = 30.0  # less stage time than this left: the next call is the finalize call
FINALIZE_TIMEOUT_S = 60.0  # the finalize call after a timed-out turn


def run_agent(
    provider: LLMProvider,
    system: str,
    user_parts: list[Part],
    executor: ToolExecutor,
    schema: type[LabelingResult],
    effort: Effort,
    ctx: PipelineContext,
    *,
    max_turns: int,
    max_crops: int,
    call_timeout_s: float,
    stage_budget_s: float,
    max_output_tokens: int,
    transcript: list[dict[str, Any]] | None = None,
) -> tuple[LabelingResult, list[UsageCall], bool]:
    """Run the loop; returns the parsed answer, the ``UsageCall`` of every call made and whether a repair
    round was needed. ``transcript`` (when given) receives one ``transcript_entry`` per call."""
    native = provider.capabilities.supports_json_schema
    spec = JsonSchemaSpec(_schema_name(schema), to_strict_schema(schema)) if native else None
    if not native:
        schema_json = json.dumps(to_strict_schema(schema), separators=(",", ":"))
        system = system + "\n\n" + JSON_SCHEMA_INSTRUCTION_TEMPLATE.format(schema_json=schema_json)
    executor.max_crops = min(executor.max_crops, max_crops)
    tools = executor.specs()
    llm_deadline = min(ctx.deadline - LLM_STAGE_RESERVE_S, time.monotonic() + stage_budget_s)
    conversation: list[Message] = [UserMessage(list(user_parts))]
    calls: list[UsageCall] = []
    log_to: list[dict[str, Any]] = transcript if transcript is not None else []

    def call(purpose: str, tool_choice: Literal["auto", "none"], timeout_s: float) -> TurnResult:
        try:
            if timeout_s <= 0:
                raise ProviderTimeout("No time left for the model call.")
            turn = _complete(
                provider,
                list(conversation),  # a copy: an abandoned call may still be reading its own
                system=system,
                schema=spec,
                effort=effort,
                max_output_tokens=max_output_tokens,
                timeout_s=timeout_s,
                purpose=purpose,
                tools=tools,
                tool_choice=tool_choice,
            )
        except ProviderError as err:
            log_to.extend(transcript_entry(u) for u in err.usage)
            calls.extend(err.usage)
            err.usage = list(calls)
            raise
        calls.append(turn.usage)
        log_to.append(transcript_entry(turn.usage, turn.assistant.tool_calls))
        if turn.stop_reason == "refusal":
            raise ProviderRefusal(
                "The model refused the request.", usage=[*calls[:-1], replace(turn.usage, status="failed")]
            )
        if turn.stop_reason == "max_tokens":
            raise ProviderInvalidOutput("The model output was truncated.", usage=calls)
        return turn

    def run_tool(tool_call: ToolCall) -> ToolResult:
        try:
            return executor.execute(tool_call)
        except Exception as exc:  # a tool bug must not end the labeling run
            log.warning("tool failed", extra={"tool": tool_call.name, "error": type(exc).__name__})
            return ToolResult(tool_call.id, [TextPart("tool failed")], is_error=True)

    def answer(turn: TurnResult) -> tuple[LabelingResult, bool]:
        try:
            return schema.model_validate(parse_json_object(turn.assistant.text or "")), False
        except ValueError as exc:
            errors = _error_lines(exc)
        if native:  # the provider enforces the schema: an invalid answer is its fault (06 section 9.6 2e)
            raise ProviderInvalidOutput("The model answer does not match the schema.", usage=calls)
        conversation.append(UserMessage([TextPart(REPAIR_PROMPT_TEMPLATE.format(errors="\n".join(errors)))]))
        retry = call("repair", "none", min(call_timeout_s, llm_deadline - time.monotonic()))
        try:
            return schema.model_validate(parse_json_object(retry.assistant.text or "")), True
        except ValueError:
            raise ProviderInvalidOutput("The model answer does not match the schema.", usage=calls) from None

    last_turn = max(1, max_turns)
    for number in range(1, last_turn + 1):
        remaining = llm_deadline - time.monotonic()
        finalizing = number == last_turn or remaining < MIN_TURN_S
        if finalizing:
            conversation.append(UserMessage([TextPart(FINALIZE_PROMPT)]))
        try:
            turn = call(
                "finalize" if finalizing else "agent_turn",
                "none" if finalizing else "auto",
                min(call_timeout_s, remaining),
            )
        except ProviderTimeout:
            if finalizing or not any(isinstance(m, AssistantMessage) for m in conversation):
                raise
            conversation.append(UserMessage([TextPart(FINALIZE_PROMPT)]))
            finalizing = True
            turn = call("finalize", "none", min(FINALIZE_TIMEOUT_S, ctx.remaining()))
        conversation.append(turn.assistant)
        if turn.assistant.tool_calls and not finalizing:
            conversation.append(ToolResultsMessage([run_tool(c) for c in turn.assistant.tool_calls]))
            continue
        result, repaired = answer(turn)
        return result, calls, repaired
    raise AssertionError("unreachable")  # pragma: no cover
