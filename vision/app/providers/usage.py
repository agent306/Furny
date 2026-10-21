"""Usage reporting (18 §6.4, 06 §6.4): neutral `UsageCall`s into the wire `Usage`."""

from app.providers.base import ProviderName, UsageCall
from app.schemas.api import Usage, UsageCallOut, UsageTotals


def usage_call_out(c: UsageCall) -> UsageCallOut:
    return UsageCallOut(
        purpose=c.purpose,
        model=c.model,
        input_tokens=c.input_tokens,
        output_tokens=c.output_tokens,
        cache_read_input_tokens=c.cache_read_input_tokens,
        cache_creation_input_tokens=c.cache_creation_input_tokens,
        images=c.images,
        duration_ms=c.duration_ms,
        stop_reason=c.stop_reason,
        status=c.status,
    )


def build_usage(provider: ProviderName, model: str | None, calls: list[UsageCall], fell_back: bool) -> Usage:
    """`status` is `failed` if any call failed or the run fell back to `none` after an LLM error."""
    failed = fell_back or any(c.status == "failed" for c in calls)
    return Usage(
        provider=provider,
        model=model,
        calls=[usage_call_out(c) for c in calls],
        totals=UsageTotals(
            requests=len(calls),
            input_tokens=sum(c.input_tokens for c in calls),
            output_tokens=sum(c.output_tokens for c in calls),
            images=sum(c.images for c in calls),
            duration_ms=sum(c.duration_ms for c in calls),
        ),
        status="failed" if failed else "succeeded",
    )
