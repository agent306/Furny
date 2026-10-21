"""Shared pydantic base for wire-facing models (camelCase JSON, snake_case Python)."""

from typing import Any

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    """Strict model whose wire field names are camelCase (``mode2d`` stays ``mode2d``)."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")

    def wire(self) -> dict[str, Any]:
        """JSON-compatible dict with camelCase keys, exactly as sent to Laravel."""
        return self.model_dump(mode="json", by_alias=True)
