"""The recognition-vendor protocol (06 section 9.8, phase 2): interface only.

No implementation, no configuration and no registry entry in v1. A future vendor's result would replace the
wall, opening and room outputs of the ``CandidateSet`` (06 sections 8.1, 8.5, 8.6) and leave labeling, scale
and assembly unchanged.
"""

from typing import Any, Protocol

from app.schemas.api import RecognizeHints


class RecognitionVendor(Protocol):
    name: str

    def recognize(self, image_png: bytes, hints: RecognizeHints, timeout_s: float) -> Any:
        """Walls, openings and rooms in pixels with a vendor confidence (``VendorResult``, defined with the
        first vendor)."""
        ...
