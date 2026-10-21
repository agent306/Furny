"""RapidOCR wrapper (06 §7.7): one instance per worker, created in the FastAPI lifespan."""

from dataclasses import dataclass
from typing import Any, Protocol

import numpy as np

DET_LIMIT_SIDE_LEN = 1280
MAX_SIDE_LEN = 2000
ORT_THREADS = 2  # 06 §5.2


@dataclass(frozen=True, eq=False)
class RawOcrBox:
    """One recognised text line: `quad` is 4x2 float (text start-top first, clockwise), in the read image."""

    quad: np.ndarray
    text: str
    score: float


class OcrLike(Protocol):
    def read(self, img_bgr: np.ndarray) -> list[RawOcrBox]: ...


class OcrEngine:
    """Detector + recogniser + direction classifier from the models bundled in the `rapidocr` wheel.

    Never set `lang_type` or `ocr_version`: that would download models (17 §5.9 builds offline).
    """

    def __init__(self, det_limit_side_len: int = DET_LIMIT_SIDE_LEN, use_cls: bool = True) -> None:
        from rapidocr import RapidOCR  # heavy import (onnxruntime): only when an engine is built

        self._engine: Any = RapidOCR(
            params={
                "Det.limit_type": "max",  # never downscale inside a tile
                "Det.limit_side_len": det_limit_side_len,
                "Det.box_thresh": 0.5,
                "Det.unclip_ratio": 1.6,
                "Global.text_score": 0.5,
                "Global.use_cls": use_cls,
                "Global.max_side_len": MAX_SIDE_LEN,
                "EngineConfig.onnxruntime.intra_op_num_threads": ORT_THREADS,
                "Global.log_level": "warning",
            }
        )

    def read(self, img_bgr: np.ndarray) -> list[RawOcrBox]:
        """Text lines of a BGR image. This is the only method tied to the library's call convention."""
        out = self._engine(np.ascontiguousarray(img_bgr))
        boxes, texts, scores = out.boxes, out.txts, out.scores
        if boxes is None or texts is None or scores is None:
            return []
        return [
            RawOcrBox(quad=np.asarray(box, np.float64).reshape(4, 2), text=str(text), score=float(score))
            for box, text, score in zip(boxes, texts, scores, strict=True)
        ]
