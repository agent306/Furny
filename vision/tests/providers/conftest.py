"""Provider tests: reset the per-process registry state (provider cache, lastError) around each test."""

from collections.abc import Iterator

import pytest

from app.providers import registry


@pytest.fixture(autouse=True)
def _reset_registry() -> Iterator[None]:
    registry.reset_state()
    yield
    registry.reset_state()
