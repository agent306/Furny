"""Monotonic millisecond clock for stage timings."""

import time


def monotonic_ms() -> int:
    """Whole milliseconds of the monotonic clock (floor, so a span of d ms never measures below floor(d))."""
    return time.monotonic_ns() // 1_000_000
