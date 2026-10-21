"""Neutral provider errors (18 §6.2). Each carries the usage of calls already made, so tokens are billed."""

from app.providers.base import UsageCall
from app.schemas.meta import FallbackReason


class ProviderError(Exception):
    code: str = "provider_error"
    retryable: bool = False

    def __init__(
        self,
        message: str = "",
        *,
        code: str | None = None,
        retryable: bool | None = None,
        usage: list[UsageCall] | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        if code is not None:
            self.code = code
        if retryable is not None:
            self.retryable = retryable
        self.usage: list[UsageCall] = list(usage) if usage else []


class ProviderAuthError(ProviderError):
    code = "provider_auth_failed"


class ProviderBadRequest(ProviderError):  # noqa: N818 - names fixed by 18 §6.2
    """`provider_bad_request` or `model_not_found`."""

    code = "provider_bad_request"


class ProviderUnavailable(ProviderError):  # noqa: N818 - names fixed by 18 §6.2
    """`provider_unreachable`, `provider_rate_limited` or `provider_overloaded`."""

    code = "provider_unreachable"
    retryable = True


class ProviderTimeout(ProviderError):  # noqa: N818 - names fixed by 18 §6.2
    code = "llm_timeout"
    retryable = True


class ProviderRefusal(ProviderError):  # noqa: N818 - names fixed by 18 §6.2
    code = "llm_refused"

    def __init__(
        self,
        message: str = "",
        *,
        category: str | None = None,
        code: str | None = None,
        retryable: bool | None = None,
        usage: list[UsageCall] | None = None,
    ) -> None:
        super().__init__(message, code=code, retryable=retryable, usage=usage)
        self.category = category


class ProviderInvalidOutput(ProviderError):  # noqa: N818 - names fixed by 18 §6.2
    """Unparseable or invalid JSON, or output truncated by the max-token limit."""

    code = "llm_invalid_output"


def fallback_reason_for(err: ProviderError) -> FallbackReason:
    """Map an error to `ImportResultMeta.fallbackReason` (18 §6.2)."""
    if isinstance(err, ProviderAuthError):
        return "provider_auth_failed"
    if isinstance(err, ProviderTimeout):
        return "llm_timeout"
    if isinstance(err, ProviderRefusal):
        return "llm_refused"
    if isinstance(err, ProviderInvalidOutput):
        return "llm_invalid_output"
    return "llm_error"
