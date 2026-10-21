"""DXF reading, units and layer classification (Task 28; Task 30 extends this file)."""

import io
import json
import random
import time

import ezdxf
import pytest

from app.api.errors import VisionError
from app.pipeline.dxf import reader
from app.pipeline.dxf.layers import (
    classify_layers,
    classify_layers_regex,
    parallel_pair_share,
)
from app.pipeline.dxf.reader import DxfDrawing, dxf_info, read_dxf
from app.pipeline.labeling.prompts import SYSTEM_PROMPT_DXF_LAYERS
from app.providers.base import TextPart
from app.providers.errors import ProviderError
from app.providers.testing import FakeProvider, make_turn
from app.schemas.api import RecognizeHints
from tests.support.dxfgen import dxf_bytes, make_room_doc, make_room_dxf
from tests.support.llm_labeling import make_ctx

NO_HINTS = RecognizeHints()
IMPERIAL = RecognizeHints(unit_system="imperial")


def read(data: bytes, hints: RecognizeHints = NO_HINTS) -> tuple[DxfDrawing, list[str]]:
    ctx = make_ctx()
    drawing = read_dxf(data, hints, ctx)
    return drawing, [w.code for w in ctx.warnings]


def width_mm(d: DxfDrawing) -> float:
    return (d.extents[2] - d.extents[0]) * d.unit_factor_mm


# --- units ----------------------------------------------------------------------------------------------


def test_units_from_insunits() -> None:
    d, warnings = read(make_room_dxf(insunits=4))
    assert (d.unit_factor_mm, d.units_guessed, warnings) == (1.0, False, [])
    assert width_mm(d) == pytest.approx(6000, abs=1)

    d, _ = read(make_room_dxf(insunits=1, scale=1 / 25.4))
    assert d.unit_factor_mm == 25.4
    assert width_mm(d) == pytest.approx(6000, abs=1)

    d, _ = read(make_room_dxf(insunits=6, scale=0.001))
    assert d.unit_factor_mm == 1000
    assert width_mm(d) == pytest.approx(6000, abs=1)

    for code, factor in ((2, 304.8), (5, 10.0), (14, 100.0)):
        assert read(make_room_dxf(insunits=code))[0].unit_factor_mm == factor


def test_units_guessed_from_extents() -> None:
    ctx = make_ctx()
    d = read_dxf(make_room_dxf(insunits=0), NO_HINTS, ctx)
    assert (d.unit_factor_mm, d.units_guessed) == (1.0, True)
    assert [(w.code, w.params) for w in ctx.warnings] == [("dxf_units_guessed", {"assumed": "mm"})]

    d, warnings = read(make_room_dxf(insunits=0, scale=0.1))  # extents 600
    assert (d.unit_factor_mm, d.units_guessed, warnings) == (10.0, True, ["dxf_units_guessed"])
    d, _ = read(make_room_dxf(insunits=0, scale=0.1), IMPERIAL)
    assert d.unit_factor_mm == 25.4

    assert read(make_room_dxf(insunits=0, scale=0.001))[0].unit_factor_mm == 1000  # extents 6
    assert read(make_room_dxf(insunits=0, scale=0.001), IMPERIAL)[0].unit_factor_mm == 304.8


def test_unlisted_insunits_is_guessed() -> None:
    d, warnings = read(make_room_dxf(insunits=10))  # yards: not in 06 section 10.1
    assert (d.insunits, d.unit_factor_mm, d.units_guessed, warnings) == (10, 1.0, True, ["dxf_units_guessed"])


# --- layer regex ----------------------------------------------------------------------------------------


def test_layer_regex() -> None:
    names = ["A-WALL", "MUR_EXT", "A-DOOR", "A-GLAZ", "DIM", "A-AREA-IDEN", "FURN", "Defpoints", "0", "XYZ"]
    assert classify_layers_regex(names) == {
        "A-WALL": "wall",
        "MUR_EXT": "wall",
        "A-DOOR": "door",
        "A-GLAZ": "window",
        "DIM": "dimension",
        "A-AREA-IDEN": "room_label",
        "FURN": "furniture",
        "Defpoints": "other",
        "0": "other",
    }


# --- records --------------------------------------------------------------------------------------------


def test_room_records() -> None:
    d, _ = read(make_room_dxf())
    by_kind: dict[str, int] = {}
    for r in d.records:
        by_kind[r.kind] = by_kind.get(r.kind, 0) + 1
    assert by_kind == {"line": 14, "arc": 1, "text": 1}
    assert d.extents == (0.0, 0.0, 6000.0, 4000.0)
    text = next(r for r in d.records if r.kind == "text")
    assert (text.text, text.layer, text.points) == ("BEDROOM", "A-AREA-IDEN", [(3000.0, 2000.0)])
    arc = next(r for r in d.records if r.kind == "arc")
    assert (arc.layer, arc.center, arc.radius, arc.start_deg, arc.end_deg) == (
        "A-DOOR",
        (1000.0, 230.0),
        900.0,
        0.0,
        90.0,
    )
    stats = d.layer_stats["A-WALL"]
    assert stats.entity_counts == {"line": 12}
    assert stats.line_length_mm == pytest.approx(33_960)
    assert stats.parallel_share > 0.9
    assert d.layer_stats["A-AREA-IDEN"].sample_texts == ["BEDROOM"]


def test_insert_exploded() -> None:
    doc = make_room_doc()
    blk = doc.blocks.new("WALLPART")
    blk.add_line((0, 0), (500, 0), dxfattribs={"layer": "0"})
    blk.add_line((0, 100), (500, 100), dxfattribs={"layer": "A-DOOR"})
    doc.modelspace().add_blockref("WALLPART", (10_000, 0), dxfattribs={"layer": "A-WALL"})
    d, _ = read(dxf_bytes(doc))

    moved = [r for r in d.records if r.kind == "line" and r.points[0][0] >= 10_000]
    assert sorted((r.layer, r.points) for r in moved) == [
        ("A-DOOR", [(10_000.0, 100.0), (10_500.0, 100.0)]),
        ("A-WALL", [(10_000.0, 0.0), (10_500.0, 0.0)]),
    ]
    box = [r for r in d.records if r.kind == "insert_bbox"]
    assert [(r.layer, min(p[0] for p in r.points), max(p[0] for p in r.points)) for r in box] == [
        ("A-WALL", 10_000.0, 10_500.0)
    ]


def test_insert_nesting_stops_after_four_levels() -> None:
    doc = ezdxf.new("R2010")
    doc.header["$INSUNITS"] = 4
    for i in range(1, 7):
        blk = doc.blocks.new(f"B{i}")
        blk.add_line((0, i * 100), (100, i * 100), dxfattribs={"layer": "0"})
        if i < 6:
            blk.add_blockref(f"B{i + 1}", (0, 0))
    doc.layers.add("A-WALL")
    doc.modelspace().add_blockref("B1", (0, 0), dxfattribs={"layer": "A-WALL"})
    d, _ = read(dxf_bytes(doc))
    lines = [r for r in d.records if r.kind == "line"]
    assert sorted(r.points[0][1] for r in lines) == [100.0, 200.0, 300.0, 400.0]
    assert {r.layer for r in lines} == {"A-WALL"}


def test_bulge_hatch_mtext() -> None:
    doc = ezdxf.new("R2010")
    doc.header["$INSUNITS"] = 4
    msp = doc.modelspace()
    msp.add_lwpolyline(
        [(0, 0, 1.0), (1000, 0, 0.0), (1000, 1000, 0.0)], format="xyb", dxfattribs={"layer": "A"}
    )
    msp.add_lwpolyline([(0, 0), (500, 0), (500, 500)], close=True, dxfattribs={"layer": "B"})
    hatch = msp.add_hatch(dxfattribs={"layer": "H"})
    hatch.paths.add_polyline_path([(0, 0), (230, 0), (230, 3000), (0, 3000)], is_closed=True)
    pattern = msp.add_hatch(dxfattribs={"layer": "H"})
    pattern.set_pattern_fill("ANSI31", scale=10)
    pattern.paths.add_polyline_path([(0, 0), (100, 0), (100, 100)], is_closed=True)
    msp.add_mtext("ROOM\\PLIVING", dxfattribs={"layer": "T", "insert": (50, 60)})
    d, _ = read(dxf_bytes(doc))

    a = [r for r in d.records if r.layer == "A"]
    assert [r.kind for r in a] == ["arc", "line"]
    assert a[0].center == pytest.approx((500.0, 0.0))
    assert a[0].radius == pytest.approx(500.0)
    assert (a[0].start_deg, a[0].end_deg) == pytest.approx((180.0, 0.0))  # CCW, below the chord
    assert [r.kind for r in d.records if r.layer == "B"] == ["line", "line", "line"]  # closed: 3 edges
    hatches = [r for r in d.records if r.kind == "hatch"]
    assert [h.points for h in hatches] == [[(0.0, 0.0), (230.0, 0.0), (230.0, 3000.0), (0.0, 3000.0)]]
    assert [r.text for r in d.records if r.kind == "text"] == ["ROOM LIVING"]


def test_mirrored_block_arc_keeps_its_world_position() -> None:
    doc = ezdxf.new("R2010")
    doc.header["$INSUNITS"] = 4
    doc.blocks.new("SWING").add_arc((0, 0), 10, 0, 90, dxfattribs={"layer": "0"})
    doc.modelspace().add_blockref("SWING", (100, 0), dxfattribs={"xscale": -1})
    d, _ = read(dxf_bytes(doc))
    arc = next(r for r in d.records if r.kind == "arc")
    assert arc.center == pytest.approx((100.0, 0.0))
    assert (arc.start_deg, arc.end_deg) == pytest.approx((90.0, 180.0))


# --- failures and formats -----------------------------------------------------------------------------


def test_dxf_too_complex(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(reader, "MAX_DXF_ENTITIES", 50)
    doc = make_room_doc()
    for i in range(60):
        doc.modelspace().add_line((i, 0), (i, 10))
    with pytest.raises(VisionError) as exc:
        read_dxf(dxf_bytes(doc), NO_HINTS, make_ctx())
    assert (exc.value.code, exc.value.http_status) == ("dxf_too_complex", 422)


def test_dxf_too_complex_counts_exploded_blocks(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(reader, "MAX_DXF_ENTITIES", 50)
    doc = ezdxf.new("R2010")
    blk = doc.blocks.new("MANY")
    for i in range(20):
        blk.add_line((i, 0), (i, 10))
    for i in range(5):
        doc.modelspace().add_blockref("MANY", (i * 100, 0))
    with pytest.raises(VisionError) as exc:
        read_dxf(dxf_bytes(doc), NO_HINTS, make_ctx())
    assert exc.value.code == "dxf_too_complex"


def test_corrupt() -> None:
    data = b"0\nSECTION\n" + random.Random(7).randbytes(400)
    with pytest.raises(VisionError) as exc:
        read_dxf(data, NO_HINTS, make_ctx())
    assert (exc.value.code, exc.value.http_status) == ("corrupt_file", 422)
    with pytest.raises(VisionError) as exc2:
        dxf_info(data)
    assert exc2.value.code == "corrupt_file"


def test_binary_dxf() -> None:
    doc = make_room_doc()
    ascii_d, _ = read(dxf_bytes(doc, "asc"))
    binary = dxf_bytes(doc, "bin")
    assert binary.startswith(b"AutoCAD Binary DXF")
    bin_d, _ = read(binary)
    assert len(bin_d.records) == len(ascii_d.records) == 16
    assert dxf_info(binary).entity_count == 16


def test_legacy_codepage_text() -> None:
    doc = ezdxf.new("R2000")  # before R2007 the file is not UTF-8
    doc.modelspace().add_text("Küche")
    buf = io.StringIO()
    doc.write(buf)
    raw = buf.getvalue().encode("cp1252")
    assert b"K\xfcche" in raw
    d, _ = read(raw)
    assert "Küche" in [r.text for r in d.records if r.kind == "text"]


def test_dxf_info() -> None:
    info = dxf_info(make_room_dxf())
    assert (info.insunits, info.entity_count) == (4, 16)
    assert info.layer_count >= 4
    assert info.model_dump(by_alias=True)["layerCount"] == info.layer_count


# --- parallel pairs -----------------------------------------------------------------------------------------


def test_parallel_pair_share() -> None:
    wall = [((0.0, 0.0), (3000.0, 0.0)), ((0.0, 230.0), (3000.0, 230.0))]
    assert parallel_pair_share(wall) == 1.0
    assert parallel_pair_share(wall[:1]) == 0.0
    assert parallel_pair_share([wall[0], ((0.0, 1000.0), (3000.0, 1000.0))]) == 0.0  # too far apart
    assert parallel_pair_share([wall[0], ((0.0, 20.0), (3000.0, 20.0))]) == 0.0  # too close
    assert parallel_pair_share([wall[0], ((2900.0, 230.0), (6000.0, 230.0))]) == 0.0  # barely overlap
    assert parallel_pair_share([wall[0], ((0.0, 230.0), (3000.0, 330.0))]) == 0.0  # not parallel
    assert parallel_pair_share([wall[0], wall[1], ((0.0, 5000.0), (3000.0, 5000.0))]) == pytest.approx(
        0.667, abs=1e-3
    )
    assert parallel_pair_share([wall[0], wall[0]]) == 0.0  # the same line twice: distance 0
    remote = [((1e6, 1e6), (1e6 + 3000, 1e6)), ((1e6, 1e6 + 230), (1e6 + 3000, 1e6 + 230))]
    assert parallel_pair_share(remote) == 1.0
    diagonal = [((0.0, 0.0), (3000.0, 3000.0)), ((163.0, -163.0), (3163.0, 2837.0))]
    assert parallel_pair_share(diagonal) == 1.0  # 230 mm apart, rotated 45 degrees


# --- layer classification -----------------------------------------------------------------------------


def renamed() -> DxfDrawing:
    return read(make_room_dxf(wall_layer="L1", door_layer="L2"))[0]


def test_regex_result_needs_no_llm() -> None:
    provider = FakeProvider([])
    ctx = make_ctx()
    roles, usage = classify_layers(read(make_room_dxf())[0], provider, ctx)
    assert roles == {"A-WALL": "wall", "A-DOOR": "door", "A-GLAZ": "window", "A-AREA-IDEN": "room_label"}
    assert (provider.calls, usage, ctx.warnings) == ([], [], [])


def test_llm_layer_mapping() -> None:
    answer = json.dumps({"layers": [{"name": "L1", "role": "wall"}, {"name": "NOPE", "role": "door"}]})
    provider = FakeProvider([make_turn(text=answer, purpose="dxf_layers")])
    ctx = make_ctx()
    roles, usage = classify_layers(renamed(), provider, ctx)

    assert roles["L1"] == "wall"
    assert "L2" not in roles and "NOPE" not in roles  # unclassified stays absent, unknown names are ignored
    assert roles["A-GLAZ"] == "window" and roles["A-AREA-IDEN"] == "room_label"  # regex results are kept
    assert [u.purpose for u in usage] == ["dxf_layers"]
    assert ctx.warnings == []
    (call,) = provider.calls
    assert (call["effort"], call["purpose"], call["system"]) == (
        "low",
        "dxf_layers",
        SYSTEM_PROMPT_DXF_LAYERS,
    )
    assert call["tools"] == [] and call["tool_choice"] == "none"
    (message,) = call["conversation"]
    assert [type(p) for p in message.parts] == [TextPart]
    prompt = message.parts[0].text
    assert prompt.startswith("Units: ") and "\nL1 | line:12 |" in prompt and "\nL2 | arc:1 |" in prompt


def test_llm_failure_degrades_to_the_heuristic() -> None:
    provider = FakeProvider([ProviderError("boom", code="llm_error")])
    ctx = make_ctx()
    roles, _ = classify_layers(renamed(), provider, ctx)
    assert roles["L1"] == "wall"
    assert [w.code for w in ctx.warnings] == ["dxf_layers_guessed"]


def test_llm_answer_without_walls_degrades_to_the_heuristic() -> None:
    provider = FakeProvider(
        [make_turn(text='{"layers": [{"name": "L2", "role": "door"}]}', purpose="dxf_layers")]
    )
    ctx = make_ctx()
    roles, _ = classify_layers(renamed(), provider, ctx)
    assert (roles["L1"], roles["L2"]) == ("wall", "door")
    assert [w.code for w in ctx.warnings] == ["dxf_layers_guessed"]


def test_heuristic_layer_guess() -> None:
    ctx = make_ctx()
    roles, usage = classify_layers(renamed(), None, ctx)
    assert roles["L1"] == "wall" and usage == []
    assert [w.code for w in ctx.warnings] == ["dxf_layers_guessed"]


def test_heuristic_needs_parallel_pairs() -> None:
    doc = ezdxf.new("R2010")
    doc.header["$INSUNITS"] = 4
    for i in range(5):  # 5 lines a metre apart: long, but no pairs
        doc.modelspace().add_line((0, i * 1000), (5000, i * 1000), dxfattribs={"layer": "X"})
    ctx = make_ctx()
    roles, _ = classify_layers(read(dxf_bytes(doc))[0], None, ctx)
    assert "X" not in roles and ctx.warnings == []


def test_edge_path_hatch_becomes_a_polygon() -> None:
    doc = ezdxf.new("R2010")
    doc.header["$INSUNITS"] = 4
    hatch = doc.modelspace().add_hatch(dxfattribs={"layer": "H"})
    edges = hatch.paths.add_edge_path()
    edges.add_line((0, 0), (1000, 0))
    edges.add_arc((1000, 500), 500, -90, 90)  # right-hand cap
    edges.add_line((1000, 1000), (0, 1000))
    edges.add_line((0, 1000), (0, 0))
    d, _ = read(dxf_bytes(doc))
    (h,) = [r for r in d.records if r.kind == "hatch"]
    assert len(h.points) == 11  # line start, eight arc samples, two more line starts
    assert h.points[:2] == [(0.0, 0.0), (1000.0, 0.0)] and h.points[-2:] == [(1000.0, 1000.0), (0.0, 1000.0)]


def test_parallel_pair_share_scales() -> None:
    segs = [((float(i * 40), 0.0), (float(i * 40 + 30), 0.0)) for i in range(10_000)]
    segs += [((float(i * 40), 230.0), (float(i * 40 + 30), 230.0)) for i in range(10_000)]
    started = time.monotonic()
    assert parallel_pair_share(segs) == 1.0
    assert time.monotonic() - started < 10
