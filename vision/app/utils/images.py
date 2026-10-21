"""Image encoding and resizing helpers (06 §5.4, §7.5)."""

import cv2
import numpy as np

_PNG_COMPRESSION = 6


def _encode(ext: str, img: np.ndarray, params: list[int]) -> bytes:
    ok, buf = cv2.imencode(ext, img, params)
    if not ok:
        raise ValueError(f"could not encode image as {ext}")
    return bytes(buf.tobytes())


def encode_png(img: np.ndarray) -> bytes:
    return _encode(".png", img, [cv2.IMWRITE_PNG_COMPRESSION, _PNG_COMPRESSION])


def encode_jpeg(img: np.ndarray, quality: int) -> bytes:
    return _encode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, quality])


def encode_webp(img: np.ndarray, quality: int) -> bytes:
    return _encode(".webp", img, [cv2.IMWRITE_WEBP_QUALITY, quality])


def resize_long_edge(img: np.ndarray, long_edge: int, interp: int = cv2.INTER_AREA) -> np.ndarray:
    """Scale so the long edge is exactly `long_edge` px (aspect kept); returns `img` itself if already so."""
    h, w = img.shape[:2]
    long_side = max(h, w)
    if long_side == long_edge:
        return img
    f = long_edge / long_side
    size = (max(1, round(w * f)), max(1, round(h * f)))
    resized: np.ndarray = cv2.resize(img, size, interpolation=interp)
    return resized
