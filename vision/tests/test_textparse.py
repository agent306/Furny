from typing import get_args

import pytest

from app.pipeline.textparse import normalize_text, parse_token
from app.schemas.candidates import ParsedText
from app.schemas.plan import RoomType
from app.utils.roomnames import (
    ROOM_DEFAULT_NAMES,
    ROOM_NAMES,
    levenshtein_ratio,
    match_room_name,
    title_case_name,
)

# Every key listed in 06 section 7.8 (BATH/BATHROOM map to bathroom, the rest of the toilet row to toilet).
SPEC_KEYS: dict[str, tuple[str, ...]] = {
    "master_bedroom": ("MASTER BEDROOM", "MASTER BED", "M.BED", "MBR"),
    "bedroom": ("BEDROOM", "BED ROOM", "BED", "BR", "GUEST ROOM", "KIDS ROOM", "CHILDREN ROOM"),
    "living": (
        "LIVING",
        "LIVING ROOM",
        "LIVING/DINING",
        "HALL",
        "DRAWING",
        "DRAWING ROOM",
        "LOUNGE",
        "FAMILY",
    ),
    "dining": ("DINING", "DINING ROOM"),
    "kitchen": ("KITCHEN", "KIT", "PANTRY"),
    "toilet": ("TOILET", "WC", "W.C", "WASH", "POWDER"),
    "bathroom": ("BATH", "BATHROOM"),
    "balcony": ("BALCONY", "BALC", "SIT OUT", "SITOUT", "VERANDAH", "VERANDA"),
    "utility": ("UTILITY", "WASH AREA", "W/M", "LAUNDRY", "SERVICE YARD", "YARD"),
    "store": ("STORE", "STORE ROOM", "STORAGE", "BOMB SHELTER", "SHELTER", "HOUSEHOLD SHELTER"),
    "study": ("STUDY", "OFFICE", "LIBRARY"),
    "pooja": ("POOJA", "PUJA", "PRAYER"),
    "foyer": ("FOYER", "ENTRANCE", "ENTRY", "LOBBY"),
    "corridor": ("CORRIDOR", "PASSAGE", "LOBBY PASSAGE"),
    "dress": ("DRESS", "DRESSING", "WALK-IN", "WIC"),
    "deck": ("DECK", "TERRACE", "AC LEDGE", "PLANTER"),
    "ots": ("OTS", "OPEN TO SKY", "SHAFT", "DUCT"),
    "garage": ("GARAGE", "PARKING", "CAR PORCH"),
}


def test_numbers() -> None:
    assert parse_token("3300") == ParsedText("mm_number", mm=3300)
    assert parse_token("45").kind == "other"
    assert parse_token("60001").kind == "other"
    assert parse_token("50") == ParsedText("mm_number", mm=50)
    assert parse_token("60000") == ParsedText("mm_number", mm=60000)
    assert parse_token("3.6M") == ParsedText("metric_length", mm=3600)
    assert parse_token("1200MM") == ParsedText("metric_length", mm=1200)
    assert parse_token("360CM") == ParsedText("metric_length", mm=3600)
    assert parse_token("3.6 m") == ParsedText("metric_length", mm=3600)


def test_feet_inch() -> None:
    assert parse_token("10'0\"") == ParsedText("feet_inch", mm=3048)
    assert parse_token("10'-6\"") == ParsedText("feet_inch", mm=3200)
    assert parse_token("8'") == ParsedText("feet_inch", mm=2438)
    assert parse_token("12' 3\"") == ParsedText("feet_inch", mm=3734)
    assert parse_token("10'6.5\"") == ParsedText("feet_inch", mm=3213)


def test_ocr_confusions() -> None:
    assert parse_token("10'0\"X11'0\"") == ParsedText("size_pair", pair_mm=(3048, 3353), pair_imperial=True)
    assert parse_token("12\u20193\u201dx7\u201911\u201d") == ParsedText(
        "size_pair", pair_mm=(3734, 2413), pair_imperial=True
    )
    assert parse_token("12\u20323\u2033 \u00d7 7\u203211\u2033").pair_mm == (3734, 2413)
    assert parse_token("33OO") == ParsedText("mm_number", mm=3300)
    assert parse_token("l200") == ParsedText("mm_number", mm=1200)
    assert parse_token("I200") == ParsedText("mm_number", mm=1200)
    assert parse_token("1O'0\"") == ParsedText("feet_inch", mm=3048)
    assert parse_token("SCALE 1:1OO").scale_n == 100
    toilet = parse_token("T0ILET")
    assert toilet.kind == "room_name"
    assert toilet.room_type == "toilet"
    assert levenshtein_ratio("T0ILET", "TOILET") == pytest.approx(0.8333, abs=1e-3)
    area = parse_token("912 SQ.FT")
    assert area.kind == "area"
    assert area.area_mm2 == 84_727_572
    assert parse_token("12 SQ.M").area_mm2 == 12_000_000
    assert parse_token("12M2").area_mm2 == 12_000_000
    assert parse_token("SCALE 1:100") == ParsedText("scale_note", scale_n=100)
    assert parse_token("1:50") == ParsedText("scale_note", scale_n=50)


def test_letters_are_not_digit_confused_in_words() -> None:
    # O / l / I become digits only when the whole token is then numeric.
    assert parse_token("scale 1:100").scale_n == 100
    assert parse_token("LOBBY").room_type == "foyer"
    assert parse_token("OTS") == ParsedText("room_name", room_name="OTS", room_type="ots")
    assert normalize_text("Kitchen") == "KITCHEN"
    assert normalize_text("l200") == "1200"
    assert normalize_text("  a   b ") == "A B"


def test_metric_pair() -> None:
    assert parse_token("3.0 X 3.6") == ParsedText("size_pair", pair_mm=(3000, 3600))
    assert parse_token("3000x3600") == ParsedText("size_pair", pair_mm=(3000, 3600))
    assert parse_token("3.0M x 3600MM").pair_mm == (3000, 3600)
    assert parse_token("3000 \u00d7 3600").pair_imperial is False


def test_room_names() -> None:
    expected = {
        "MASTER BEDROOM": "master_bedroom",
        "M.BED": "master_bedroom",
        "LIVING/DINING": "living",
        "BATH": "bathroom",
        "WC": "toilet",
        "BALC": "balcony",
        "KIT": "kitchen",
        "HOUSEHOLD SHELTER": "store",
        "OTS": "ots",
        "5 FEET WIDE CORRIDOR": "corridor",
        "DECK": "deck",
        "Bedroom 2": "bedroom",
        "BED/TOILET": "bedroom",
    }
    for text, room_type in expected.items():
        parsed = parse_token(text)
        assert (parsed.kind, parsed.room_type) == ("room_name", room_type), text
    assert match_room_name("MASTER BEDROOM") == ("MASTER BEDROOM", "master_bedroom")
    assert match_room_name("LOBBY PASSAGE") == ("LOBBY PASSAGE", "corridor")
    assert match_room_name("WASH AREA") == ("WASH AREA", "utility")
    assert match_room_name("RANDOM TEXT") is None
    assert parse_token("RANDOM TEXT").kind == "other"
    assert title_case_name("LIVING/DINING") == "Living/Dining"
    assert title_case_name("MASTER BEDROOM") == "Master Bedroom"


def test_hyphens_read_as_spaces() -> None:
    # The TypeScript mirror splits on hyphens too: "WALK IN" must find the "WALK-IN" key and vice versa.
    for text in ("WALK IN", "WALK-IN", "Walk-in", "WALK-IN CLOSET"):
        assert match_room_name(text) == ("WALK-IN", "dress"), text
    assert parse_token("WALK IN").room_type == "dress"
    assert match_room_name("MASTER-BEDROOM") == ("MASTER BEDROOM", "master_bedroom")


def test_opening_tags() -> None:
    for tag in ("D1", "SD2", "W12", "FD3", "V1"):
        assert parse_token(tag) == ParsedText("opening_tag", tag=tag)
    assert parse_token("W123").kind == "other"


def test_levenshtein_ratio() -> None:
    assert levenshtein_ratio("", "") == 1.0
    assert levenshtein_ratio("ABC", "ABC") == 1.0
    assert levenshtein_ratio("ABC", "") == 0.0
    assert levenshtein_ratio("KITTEN", "SITTING") == pytest.approx(1 - 3 / 7)


def test_room_dictionary_complete() -> None:
    for room_type, keys in SPEC_KEYS.items():
        for key in keys:
            assert ROOM_NAMES[key] == room_type, key
    assert set(ROOM_NAMES) == {k for keys in SPEC_KEYS.values() for k in keys}
    assert set(ROOM_DEFAULT_NAMES) == set(get_args(RoomType))
    assert ROOM_DEFAULT_NAMES["other"] == "Room"
    assert ROOM_DEFAULT_NAMES["master_bedroom"] == "Master Bedroom"
