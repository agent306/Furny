"""Synthetic DXF drawings for the DXF tests (built with ezdxf; no binary fixtures)."""

import io
import os
import tempfile
from typing import Literal

import ezdxf
from ezdxf.document import Drawing

ROOM_W, ROOM_H, WALL_T = 6000.0, 4000.0, 230.0  # outer faces, mm
DOOR_X0, DOOR_W = 1000.0, 900.0  # door gap in the bottom wall
WINDOW_X0, WINDOW_W = 3000.0, 1200.0  # window gap in the top wall


def make_room_doc(
    insunits: int = 4,
    scale: float = 1.0,
    wall_layer: str = "A-WALL",
    door_layer: str = "A-DOOR",
    window_layer: str = "A-GLAZ",
    label_layer: str = "A-AREA-IDEN",
) -> Drawing:
    """A 6000x4000 mm room (outer faces), 230 mm double-line walls, a 900 mm door gap with its swing ARC, a
    1200 mm window gap with two lines and a TEXT BEDROOM; every coordinate is multiplied by ``scale``."""
    doc = ezdxf.new("R2010")
    doc.header["$INSUNITS"] = insunits  # ezdxf's own default is 6
    for name in (wall_layer, door_layer, window_layer, label_layer):
        doc.layers.add(name)
    msp = doc.modelspace()
    s, t = scale, WALL_T

    def line(x0: float, y0: float, x1: float, y1: float, layer: str) -> None:
        msp.add_line((x0 * s, y0 * s), (x1 * s, y1 * s), dxfattribs={"layer": layer})

    w, h = ROOM_W, ROOM_H
    for off, (x0, x1) in ((0.0, (0.0, w)), (t, (t, w - t))):  # outer face, then inner face
        line(x0, off, DOOR_X0, off, wall_layer)  # bottom wall with the door gap
        line(DOOR_X0 + DOOR_W, off, x1, off, wall_layer)
        top = h - off
        line(x0, top, WINDOW_X0, top, wall_layer)  # top wall with the window gap
        line(WINDOW_X0 + WINDOW_W, top, x1, top, wall_layer)
        line(off, off, off, h - off, wall_layer)  # left
        line(w - off, off, w - off, h - off, wall_layer)  # right
    msp.add_arc((DOOR_X0 * s, t * s), DOOR_W * s, 0, 90, dxfattribs={"layer": door_layer})
    line(WINDOW_X0, h, WINDOW_X0 + WINDOW_W, h, window_layer)
    line(WINDOW_X0, h - t, WINDOW_X0 + WINDOW_W, h - t, window_layer)
    msp.add_text(
        "BEDROOM", dxfattribs={"layer": label_layer, "height": 150 * s, "insert": (3000 * s, 2000 * s)}
    )
    return doc


def dxf_bytes(doc: Drawing, fmt: Literal["asc", "bin"] = "asc") -> bytes:
    if fmt == "asc":
        buf = io.StringIO()
        doc.write(buf)
        return buf.getvalue().encode("utf-8")
    fd, path = tempfile.mkstemp(suffix=".dxf")
    os.close(fd)
    try:
        doc.saveas(path, fmt="bin")
        with open(path, "rb") as fh:
            return fh.read()
    finally:
        os.unlink(path)


def make_room_dxf(
    insunits: int = 4,
    scale: float = 1.0,
    wall_layer: str = "A-WALL",
    door_layer: str = "A-DOOR",
    window_layer: str = "A-GLAZ",
    label_layer: str = "A-AREA-IDEN",
) -> bytes:
    return dxf_bytes(make_room_doc(insunits, scale, wall_layer, door_layer, window_layer, label_layer))
