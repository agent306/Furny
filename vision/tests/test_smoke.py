import socket
import sys

import pytest

import app


def test_python_is_312() -> None:
    assert sys.version_info[:2] == (3, 12)


def test_versions() -> None:
    assert app.__version__ == "1.0.0"
    assert app.PIPELINE_VERSION == "1.0.0"


def test_native_imports() -> None:
    import anthropic  # noqa: F401
    import cv2
    import ezdxf  # noqa: F401
    import fastapi  # noqa: F401
    import httpx  # noqa: F401
    import numpy  # noqa: F401
    import onnxruntime  # noqa: F401
    import openai  # noqa: F401
    import pdfplumber  # noqa: F401
    import pi_heif  # noqa: F401
    import PIL  # noqa: F401
    import pypdfium2  # noqa: F401
    import rapidocr  # noqa: F401
    import scipy  # noqa: F401
    import shapely  # noqa: F401
    import skimage  # noqa: F401

    assert cv2.__version__.startswith("4.")


def test_rapidocr_models_bundled(monkeypatch: pytest.MonkeyPatch) -> None:
    def no_network(*args: object, **kwargs: object) -> None:
        raise OSError("network disabled")

    monkeypatch.setattr(socket.socket, "connect", no_network)
    from rapidocr import RapidOCR

    RapidOCR(params={"Global.log_level": "error"})
