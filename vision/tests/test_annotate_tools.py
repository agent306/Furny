"""Overview images, set-of-marks, candidate JSON and the agentic tools (Task 23, 06 §9.2, §9.5)."""

import json
from dataclasses import replace

import cv2
import numpy as np
import pytest

from app.pipeline import annotate
from app.pipeline.annotate import (
    TRUNCATION,
    Overview,
    build_overview,
    draw_marks,
    from_overview,
    to_image_part,
    to_overview,
)
from app.pipeline.context import PipelineContext
from app.pipeline.labeling.tools import (
    CROP_IMAGE_SPEC,
    LIST_CANDIDATES_SPEC,
    ToolExecutor,
)
from app.pipeline.normalize import NormalizedPage
from app.providers.base import ImagePart, TextPart, ToolCall
from app.schemas.candidates import (
    CandidateSet,
    DimensionSpan,
    OpeningCandidate,
    ParsedText,
    RoomFace,
    TextToken,
    WallCandidate,
)
from app.schemas.meta import PageImage
from app.utils.geometry import Rect

RED_BGR = (0x35, 0x39, 0xE5)  # #E53935


class _NoIO:
    def fetch(self, url: str, max_bytes: int, timeout_s: float = 30) -> bytes:
        raise AssertionError("not used")

    def put(self, url: str, data: bytes, content_type: str) -> None:
        raise AssertionError("not used")


def make_ctx() -> PipelineContext:
    return PipelineContext.for_request(60, _NoIO(), debug=False)


def make_page(w: int, h: int, value: int = 255) -> NormalizedPage:
    info = PageImage(
        width=w, height=h, source_page=1, dpi=None, rectified=False, deskew_deg=0.0, resample_factor=1.0
    )
    return NormalizedPage(np.full((h, w, 3), value, np.uint8), info, np.eye(3), "raster", False)


def make_text(
    n: int, text: str = "ROOM", score: float = 0.9, x: float = 100.0, parsed: ParsedText | None = None
) -> TextToken:
    box = (x, 50.0, x + 90.0, 70.0)
    quad = ((box[0], box[1]), (box[2], box[1]), (box[2], box[3]), (box[0], box[3]))
    return TextToken(
        id=f"T{n}",
        text=text,
        quad=quad,
        box=box,
        angle=0,
        score=score,
        height_px=20.0,
        parsed=parsed or ParsedText(kind="other"),
    )


def make_wall(n: int, a: tuple[float, float], b: tuple[float, float], t: float = 6.0) -> WallCandidate:
    return WallCandidate(
        id=f"W{n}",
        a=a,
        b=b,
        a_node=f"N{2 * n - 1}",
        b_node=f"N{2 * n}",
        thickness_px=t,
        source="filled",
        evidence=0.9,
        free_ends=0,
        openings_px=(),
    )


def make_set(**kw: object) -> CandidateSet:
    base = CandidateSet(
        texts=[],
        segments=[],
        dimension_lines=[],
        spans=[],
        nodes={},
        walls=[],
        gaps=[],
        openings=[],
        rooms=[],
        theta0=0.0,
        t_thin=2.0,
        t_median=6.0,
        region=Rect(0, 0, 5000, 4000),
        drawing_kind_cv="architectural_line_drawing",
    )
    return replace(base, **kw)  # type: ignore[arg-type]


def small_scene() -> tuple[NormalizedPage, CandidateSet]:
    """A 400x300 page, scale 1, with a few candidates of every kind."""
    page = make_page(400, 300)
    walls = [make_wall(1, (20.0, 100.0), (220.0, 100.0)), make_wall(2, (220.0, 100.0), (220.0, 280.0))]
    cs = make_set(
        region=Rect(0, 0, 400, 300),
        texts=[make_text(1, "BEDROOM", x=40.0)],
        walls=walls,
        openings=[
            OpeningCandidate(
                id="O1",
                wall_id="W1",
                u0=60.0,
                u1=100.0,
                kind="door",
                type="single_swing",
                hinge="start",
                swing="left",
                support=0.71,
            )
        ],
        rooms=[
            RoomFace(
                id="R1",
                polygon_px=((30.0, 110.0), (210.0, 110.0), (210.0, 270.0), (30.0, 270.0)),
                anchor_px=(120.0, 190.0),
                area_px=28800.0,
                bbox=(30.0, 110.0, 210.0, 270.0),
                contains_text_ids=("T1",),
                open=False,
            )
        ],
        spans=[
            DimensionSpan(
                id="D1",
                p0=(20.0, 40.0),
                p1=(120.0, 40.0),
                axis="x",
                kind="chain_segment",
                near_text_ids=["T1"],
                line_id="L1",
            )
        ],
    )
    return page, cs


def executor(
    s_page: NormalizedPage, cs: CandidateSet, *, max_px: int = 2576, max_crops: int = 8
) -> tuple[ToolExecutor, Overview]:
    ov = build_overview(s_page, cs, max_image_px=max_px, ctx=make_ctx())
    return ToolExecutor(s_page, ov, cs, max_image_px=max_px, max_crops=max_crops), ov


def crop_call(call_id: str = "c1", **args: object) -> ToolCall:
    base: dict[str, object] = {"x": 10, "y": 10, "w": 100, "h": 80, "scale": 4, "annotated": False}
    base.update(args)
    return ToolCall(id=call_id, name="crop_image", arguments=base)


def decode_png(part: ImagePart) -> np.ndarray:
    img = cv2.imdecode(np.frombuffer(part.data, np.uint8), cv2.IMREAD_COLOR)
    assert img is not None
    return img


def red_mask(img: np.ndarray, tol: int = 30) -> np.ndarray:
    diff = np.abs(img.astype(int) - np.array(RED_BGR)).max(axis=2)
    return diff <= tol


# --- overview scale and coordinates ---------------------------------------------------------------------


def test_overview_scale() -> None:
    page = make_page(5000, 4000)
    cs = make_set()
    ov = build_overview(page, cs, max_image_px=2576, ctx=make_ctx())
    assert ov.s == pytest.approx(0.5152)
    assert (ov.width, ov.height) == (2576, 2061)
    assert ov.clean.shape == (2061, 2576, 3)
    assert ov.marked.shape == ov.clean.shape
    ov1 = build_overview(page, cs, max_image_px=8000, ctx=make_ctx())
    assert ov1.s == 1
    assert (ov1.width, ov1.height) == (5000, 4000)


def test_overview_crops_to_region_and_offsets() -> None:
    page = make_page(1000, 800)
    cs = make_set(region=Rect(100, 50, 400, 300))
    ov = build_overview(page, cs, max_image_px=500, ctx=make_ctx())
    assert ov.s == pytest.approx(0.5)
    assert ov.offset == (100, 50)
    assert (ov.width, ov.height) == (200, 150)
    assert to_overview((100.0, 50.0), ov) == (0, 0)
    assert to_overview((300.0, 150.0), ov) == (100, 50)


def test_coordinate_roundtrip() -> None:
    page = make_page(5000, 4000)
    cs = make_set(region=Rect(300, 200, 4000, 3000))
    ov = build_overview(page, cs, max_image_px=2576, ctx=make_ctx())
    for p in [(300.0, 200.0), (1234.0, 2345.0), (4299.0, 3199.0), (777.5, 1999.25)]:
        x, y = from_overview(to_overview(p, ov), ov)
        assert abs(x - p[0]) <= 1 / ov.s
        assert abs(y - p[1]) <= 1 / ov.s
    u, v = to_overview((1234.0, 2345.0), ov)
    assert isinstance(u, int)
    assert isinstance(v, int)


# --- candidate JSON -------------------------------------------------------------------------------------


def test_candidate_json_compact_sorted() -> None:
    page, cs = small_scene()
    cs = replace(
        cs,
        texts=[
            make_text(10, "T10TEXT", x=200.0),
            make_text(
                2,
                "BEDROOM",
                x=40.0,
                parsed=ParsedText(kind="room_name", room_name="BEDROOM", room_type="bedroom"),
            ),
            make_text(3, "3300", x=300.0, parsed=ParsedText(kind="mm_number", mm=3300)),
        ],
    )
    ov = build_overview(page, cs, max_image_px=2576, ctx=make_ctx())
    assert " " not in ov.candidates_json
    assert "\n" not in ov.candidates_json
    data = json.loads(ov.candidates_json)
    assert list(data) == ["image", "texts", "dimensionSpans", "walls", "openings", "rooms"]
    assert data["image"] == {"width": 400, "height": 300}
    assert [t["id"] for t in data["texts"]] == ["T2", "T3", "T10"]
    assert [t["parsed"] for t in data["texts"]] == ["room_name:bedroom", "mm_number:3300", "other"]
    assert data["texts"][0] == {
        "id": "T2",
        "text": "BEDROOM",
        "box": [40, 50, 130, 70],
        "angle": 0,
        "score": 0.9,
        "parsed": "room_name:bedroom",
    }
    assert data["walls"][0] == {
        "id": "W1",
        "p0": [20, 100],
        "p1": [220, 100],
        "thicknessPx": 6,
        "source": "filled",
        "freeEnds": 0,
    }
    assert data["openings"] == [
        {"id": "O1", "wallId": "W1", "p0": [80, 100], "p1": [120, 100], "kind": "door", "support": 0.71}
    ]
    assert data["rooms"] == [
        {
            "id": "R1",
            "anchor": [120, 190],
            "bbox": [30, 110, 210, 270],
            "areaPx": 28800,
            "containsTextIds": ["T1"],
            "open": False,
        }
    ]
    assert data["dimensionSpans"] == [
        {
            "id": "D1",
            "p0": [20, 40],
            "p1": [120, 40],
            "axis": "x",
            "kind": "chain_segment",
            "nearTextIds": ["T1"],
        }
    ]
    assert data == ov.payload

    def ints(v: object) -> None:
        if isinstance(v, list):
            for e in v:
                ints(e)
        elif isinstance(v, dict):
            for e in v.values():
                ints(e)
        elif isinstance(v, float):
            assert v in (0.9, 0.71)  # only scores / support are non-integer

    ints(data)


def test_candidate_json_is_deterministic() -> None:
    page, cs = small_scene()
    a = build_overview(page, cs, max_image_px=2576, ctx=make_ctx())
    b = build_overview(page, replace(cs, walls=list(reversed(cs.walls))), max_image_px=2576, ctx=make_ctx())
    assert a.candidates_json == b.candidates_json


def test_truncation() -> None:
    assert TRUNCATION == {"texts": 300, "walls": 400, "openings": 150, "rooms": 80, "dimensionSpans": 200}
    page = make_page(1000, 800)
    texts = [make_text(i + 1, score=(i % 100) / 100.0, x=float(i % 800)) for i in range(500)]
    cs = make_set(region=Rect(0, 0, 1000, 800), texts=texts)
    ctx = make_ctx()
    ov = build_overview(page, cs, max_image_px=2576, ctx=ctx)
    kept = ov.payload["texts"]
    assert len(kept) == 300
    ids = [t["id"] for t in kept]
    assert ids == sorted(ids, key=lambda i: int(i[1:]))
    by_id = {t.id: t for t in texts}
    dropped = [t for t in texts if t.id not in set(ids)]
    assert max(t.score for t in dropped) <= min(by_id[i].score for i in ids)
    [w] = ctx.warnings
    assert w.code == "too_many_candidates_truncated"
    assert w.params == {"kind": "texts", "kept": 300, "total": 500}


def test_no_warning_below_limits() -> None:
    page, cs = small_scene()
    ctx = make_ctx()
    build_overview(page, cs, max_image_px=2576, ctx=ctx)
    assert ctx.warnings == []


# --- marks and encoding ---------------------------------------------------------------------------------


def test_marks_drawn() -> None:
    page, cs = small_scene()
    ov = build_overview(page, cs, max_image_px=2576, ctx=make_ctx())
    assert not red_mask(ov.clean).any()
    assert np.array_equal(ov.clean, page.image)
    mx, my = 120, 100  # midpoint of W1
    window = ov.marked[my - 4 : my + 5, mx - 4 : mx + 5]
    assert red_mask(window).any()
    # Every colour of the legend shows up somewhere.
    for bgr in [(0x32, 0x7D, 0x2E), (0x9A, 0x1B, 0x6A), (0xC0, 0x65, 0x15), (0x00, 0x6C, 0xEF)]:
        diff = np.abs(ov.marked.astype(int) - np.array(bgr)).max(axis=2)
        assert (diff <= 30).any(), bgr


def test_draw_marks_label_collisions_are_omitted_not_stacked() -> None:
    page = make_page(400, 300)
    walls = [make_wall(i + 1, (50.0, 100.0), (150.0, 100.0)) for i in range(8)]  # identical midpoints
    cs = make_set(region=Rect(0, 0, 400, 300), walls=walls)
    ov = build_overview(page, cs, max_image_px=2576, ctx=make_ctx())
    img = ov.clean.copy()
    draw_marks(img, cs, ov, 1.0)
    assert (img != ov.clean).any()
    assert len(ov.payload["walls"]) == 8  # the JSON still has them all


def test_large_png_switches_to_jpeg(monkeypatch: pytest.MonkeyPatch) -> None:
    rng = np.random.default_rng(1)
    img = rng.integers(0, 255, (200, 200, 3), dtype=np.uint8)
    part = to_image_part(img)
    assert part.media_type == "image/png"
    assert part.data.startswith(b"\x89PNG")
    monkeypatch.setattr(annotate, "MAX_PNG_BYTES", 1024)
    jpg = to_image_part(img)
    assert jpg.media_type == "image/jpeg"
    assert jpg.data.startswith(b"\xff\xd8")


# --- crop tool ------------------------------------------------------------------------------------------


def half_scale_scene() -> tuple[NormalizedPage, CandidateSet]:
    page = make_page(2000, 1600)
    walls = [make_wall(1, (100.0, 200.0), (900.0, 200.0), 12.0)]
    return page, make_set(region=Rect(0, 0, 2000, 1600), walls=walls)


def test_crop_tool() -> None:
    page, cs = half_scale_scene()
    ex, ov = executor(page, cs, max_px=1000)  # s = 0.5
    assert ov.s == pytest.approx(0.5)
    res = ex.execute(crop_call())
    assert not res.is_error
    assert res.call_id == "c1"
    img_part, text_part = res.content
    assert isinstance(img_part, ImagePart)
    assert isinstance(text_part, TextPart)
    assert decode_png(img_part).shape[:2] == (320, 400)
    assert text_part.text == (
        "Crop of overview region x=10, y=10, w=100, h=80. This image is 400x320 px; a point (u, v) in it "
        "corresponds to overview point (x + u*100/400, y + v*80/320)."
    )
    assert ex.crops_used == 1


def test_crop_native_cap_and_clamps() -> None:
    page, cs = half_scale_scene()
    ex, ov = executor(page, cs, max_px=2576)  # s = 1
    assert ov.s == 1
    res = ex.execute(crop_call())
    img_part = res.content[0]
    assert isinstance(img_part, ImagePart)
    assert decode_png(img_part).shape[:2] == (160, 200)  # capped at 2x native
    # scale 9 is clamped to 4 (then capped by 2x native here: a bigger window shows the 4x)
    res = ex.execute(crop_call("c2", x=0, y=0, w=300, h=200, scale=9))
    img_part = res.content[0]
    assert isinstance(img_part, ImagePart)
    assert decode_png(img_part).shape[:2] == (400, 600)  # 2x native beats 4x
    # the image never exceeds max_image_px on the long edge
    ex2, _ = executor(page, cs, max_px=300)
    res = ex2.execute(crop_call("c3", x=0, y=0, w=250, h=100, scale=4))
    p = res.content[0]
    assert isinstance(p, ImagePart)
    assert max(decode_png(p).shape[:2]) <= 300


def test_crop_scale_clamped_to_4() -> None:
    page, cs = half_scale_scene()
    ex, _ = executor(page, cs, max_px=1000)  # s = 0.5: 2x native of 100x80 overview = 400x320
    res = ex.execute(crop_call(scale=9))
    p = res.content[0]
    assert isinstance(p, ImagePart)
    assert decode_png(p).shape[:2] == (320, 400)
    t = res.content[1]
    assert isinstance(t, TextPart)
    assert "400x320" in t.text


def test_crop_rejects_small_and_clamps_to_overview() -> None:
    page, cs = half_scale_scene()
    ex, ov = executor(page, cs, max_px=1000)
    res = ex.execute(crop_call(w=8))
    assert res.is_error
    assert ex.crops_used == 0
    res = ex.execute(crop_call(h=15))
    assert res.is_error
    # beyond the overview: clamped to the overview's right/bottom edge
    res = ex.execute(crop_call("c9", x=ov.width - 50, y=ov.height - 40, w=200, h=200))
    assert not res.is_error
    t = res.content[1]
    assert isinstance(t, TextPart)
    assert t.text.startswith(f"Crop of overview region x={ov.width - 50}, y={ov.height - 40}, w=50, h=40.")
    # completely outside
    assert ex.execute(crop_call("c10", x=ov.width + 10, y=0)).is_error


def test_crop_annotated_draws_marks() -> None:
    page, cs = half_scale_scene()
    ex, _ = executor(page, cs, max_px=1000)
    plain = ex.execute(crop_call(x=0, y=60, w=300, h=80, scale=2, annotated=False))
    marked = ex.execute(crop_call("c2", x=0, y=60, w=300, h=80, scale=2, annotated=True))
    a, b = plain.content[0], marked.content[0]
    assert isinstance(a, ImagePart)
    assert isinstance(b, ImagePart)
    assert not red_mask(decode_png(a)).any()
    assert red_mask(decode_png(b)).any()


def test_crop_budget_counter() -> None:
    page, cs = half_scale_scene()
    ex, _ = executor(page, cs, max_px=1000, max_crops=2)
    assert not ex.execute(crop_call("a")).is_error
    assert not ex.execute(crop_call("b")).is_error
    assert ex.crops_used == 2
    res = ex.execute(crop_call("c"))
    assert res.is_error
    assert res.call_id == "c"
    assert res.content == [TextPart("crop budget exhausted, answer now")]
    assert ex.crops_used == 2


def test_invalid_json_sentinel_and_bad_arguments() -> None:
    page, cs = half_scale_scene()
    ex, _ = executor(page, cs)
    res = ex.execute(ToolCall(id="x", name="crop_image", arguments={"__invalid_json__": '{"x": 1'}))
    assert res.is_error
    assert res.content == [TextPart("invalid JSON arguments")]
    assert ex.execute(ToolCall(id="x", name="list_candidates", arguments={"__invalid_json__": "{"})).is_error
    assert ex.execute(ToolCall(id="x", name="nope", arguments={})).is_error
    assert ex.execute(ToolCall(id="x", name="crop_image", arguments={"x": 1})).is_error
    assert ex.execute(crop_call(x="1")).is_error
    assert ex.execute(crop_call(annotated=1)).is_error
    assert ex.execute(crop_call(extra=1)).is_error
    assert ex.crops_used == 0


# --- list_candidates ------------------------------------------------------------------------------------


def list_call(**args: object) -> ToolCall:
    return ToolCall(id="l1", name="list_candidates", arguments=args)


def test_list_candidates() -> None:
    page = make_page(1000, 800)
    walls = [
        make_wall(1, (0.0, 0.0), (40.0, 40.0)),  # midpoint (20, 20) inside
        make_wall(2, (100.0, 100.0), (300.0, 100.0)),  # midpoint (200, 100) outside
    ]
    cs = make_set(region=Rect(0, 0, 1000, 800), walls=walls)
    ex, _ = executor(page, cs)
    res = ex.execute(list_call(kind="walls", region={"x": 0, "y": 0, "w": 50, "h": 50}))
    assert not res.is_error
    [part] = res.content
    assert isinstance(part, TextPart)
    assert " " not in part.text
    data = json.loads(part.text)
    assert [w["id"] for w in data["walls"]] == ["W1"]
    assert data["truncated"] is False
    res = ex.execute(list_call(kind="walls", region=None))
    [part] = res.content
    assert isinstance(part, TextPart)
    assert [w["id"] for w in json.loads(part.text)["walls"]] == ["W1", "W2"]


def test_list_candidates_truncates_at_200() -> None:
    page = make_page(1000, 800)
    walls = [make_wall(i + 1, (float(i), 10.0), (float(i) + 5.0, 10.0)) for i in range(250)]
    cs = make_set(region=Rect(0, 0, 1000, 800), walls=walls)
    ex, ov = executor(page, cs)
    assert len(ov.payload["walls"]) == 250  # the overview limit for walls is 400
    res = ex.execute(list_call(kind="walls", region=None))
    [part] = res.content
    assert isinstance(part, TextPart)
    data = json.loads(part.text)
    assert len(data["walls"]) == 200
    assert data["truncated"] is True


def test_list_candidates_uses_the_full_set_not_the_overview_truncation() -> None:
    page = make_page(1000, 800)
    texts = [make_text(i + 1, x=float(i)) for i in range(310)]
    cs = make_set(region=Rect(0, 0, 1000, 800), texts=texts)
    ex, ov = executor(page, cs)
    assert len(ov.payload["texts"]) == 300
    res = ex.execute(list_call(kind="texts", region=None))
    [part] = res.content
    assert isinstance(part, TextPart)
    assert len(json.loads(part.text)["texts"]) == 200


def test_list_candidates_invalid_arguments() -> None:
    page, cs = small_scene()
    ex, _ = executor(page, cs)
    assert ex.execute(list_call(kind="bogus", region=None)).is_error
    assert ex.execute(list_call(kind="walls")).is_error
    assert ex.execute(list_call(kind="walls", region={"x": 0, "y": 0, "w": 5})).is_error


def test_specs() -> None:
    page, cs = small_scene()
    ex, _ = executor(page, cs)
    assert ex.specs() == [CROP_IMAGE_SPEC, LIST_CANDIDATES_SPEC]
    assert [s.name for s in ex.specs()] == ["crop_image", "list_candidates"]


def test_tool_schemas_exact() -> None:
    assert CROP_IMAGE_SPEC.name == "crop_image"
    assert CROP_IMAGE_SPEC.description == (
        "Return a zoomed crop of the floor-plan drawing. x, y, w, h are in the pixel space of the full "
        "overview images. scale is the magnification relative to the overview (1 to 4). Set annotated=true "
        "to draw the candidate IDs on the crop."
    )
    assert CROP_IMAGE_SPEC.input_schema == {
        "type": "object",
        "properties": {
            "x": {"type": "integer"},
            "y": {"type": "integer"},
            "w": {"type": "integer"},
            "h": {"type": "integer"},
            "scale": {"type": "number"},
            "annotated": {"type": "boolean"},
        },
        "required": ["x", "y", "w", "h", "scale", "annotated"],
        "additionalProperties": False,
    }
    assert LIST_CANDIDATES_SPEC.name == "list_candidates"
    assert LIST_CANDIDATES_SPEC.description == (
        "List candidates of one kind as JSON, optionally only those whose position lies inside a rectangle "
        "given in overview pixels."
    )
    assert LIST_CANDIDATES_SPEC.input_schema == {
        "type": "object",
        "properties": {
            "kind": {"type": "string", "enum": ["texts", "walls", "openings", "rooms", "dimensionSpans"]},
            "region": {
                "anyOf": [
                    {"type": "null"},
                    {
                        "type": "object",
                        "properties": {
                            "x": {"type": "integer"},
                            "y": {"type": "integer"},
                            "w": {"type": "integer"},
                            "h": {"type": "integer"},
                        },
                        "required": ["x", "y", "w", "h"],
                        "additionalProperties": False,
                    },
                ]
            },
        },
        "required": ["kind", "region"],
        "additionalProperties": False,
    }
