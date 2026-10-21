"""Dimension / room-name text parsing with OCR-confusion handling (06 section 7.8)."""

import re
from decimal import ROUND_HALF_UP, Decimal
from typing import Final

from app.schemas.candidates import ParsedText
from app.utils.roomnames import match_room_name

MM_NUMBER_MIN: Final = 50
MM_NUMBER_MAX: Final = 60000
_MM_PER_INCH: Final = Decimal("25.4")
_MM2_PER_SQFT: Final = Decimal("92903.04")
_MM2_PER_M2: Final = Decimal(1_000_000)
# A unitless value below this in a metric size pair is read as metres ("3.0 x 3.6"); gap-list convention.
_UNITLESS_METRES_BELOW: Final = 100

_QUOTE_SINGLE = str.maketrans({c: "'" for c in "\u2019\u2032\u2018\u00b4`"})
_QUOTE_DOUBLE = str.maketrans({c: '"' for c in "\u201d\u2033\u201c"})
# OCR confusions, applied only when the substituted token is then fully numeric.
_DIGIT_CONFUSIONS = str.maketrans({"O": "0", "o": "0", "l": "1", "I": "1"})

_SPACES = re.compile(r"\s+")
# X, * or the multiplication sign between dimensions: after a digit / unit / foot-inch mark, before a digit.
_TIMES = re.compile(r"(\d(?:\.\d+)?\s*(?:MM|M)?|[\"'])\s*[X\u00d7*]\s*(?=\.?\d)")

_FT_IN = r"(\d{1,3})'\s*-?\s*(\d{1,2}(?:\.\d+)?)?\s*\"?"
_NUM = r"(\d+(?:\.\d+)?)"
_SCALE_WORD = re.compile(r"SCALE\s*1\s*:\s*(\d{2,4})")
_SCALE_BARE = re.compile(r"1\s*:\s*(\d{2,4})")
_AREA = re.compile(_NUM + r"\s*(SQ\.?\s*FT|SFT|SQFT|M2|M²|SQ\.?\s*M)")
_FEET_INCH = re.compile(_FT_IN)
_PAIR_IMPERIAL = re.compile(_FT_IN + r"\s*x\s*" + _FT_IN)
_PAIR_METRIC = re.compile(_NUM + r"\s*(M|MM)?\s*x\s*" + _NUM + r"\s*(M|MM)?")
_METRIC_LENGTH = re.compile(_NUM + r"\s*(MM|CM|M)")
_MM_NUMBER = re.compile(r"\d{2,5}")
_OPENING_TAG = re.compile(r"(?:D|W|V|SD|FD)\d{1,2}")
_METRIC_UNIT_MM: Final = {"MM": Decimal(1), "CM": Decimal(10), "M": Decimal(1000)}


def _round(value: Decimal) -> int:
    return int(value.quantize(Decimal(1), rounding=ROUND_HALF_UP))


def _feet_inch_mm(feet: str, inches: str | None) -> int:
    total_in = Decimal(feet) * 12 + Decimal(inches or 0)
    return _round(total_in * _MM_PER_INCH)


def _finish(s: str) -> str:
    """Uppercase and mark dimension separators as a lowercase ``x`` (lowercase never occurs elsewhere)."""
    return _TIMES.sub(lambda m: m.group(1).rstrip() + "x", s.upper())


def normalize_text(s: str) -> str:
    """Normalise one OCR token: typographic quotes, ``x`` separators, O/l/I confusions, case, spaces.

    ``O``->``0`` and ``l``/``I``->``1`` are applied (before upper-casing, so ``l200`` is not read as ``L200``)
    only when the token contains a digit and the substituted token then fully matches a numeric kind.
    """
    base = _SPACES.sub(" ", s.translate(_QUOTE_SINGLE).replace("''", '"').translate(_QUOTE_DOUBLE)).strip()
    if any(c.isdigit() for c in base):
        fixed = _finish(base.translate(_DIGIT_CONFUSIONS))
        if _parse_numeric(fixed) is not None:
            return fixed
    return _finish(base)


def _parse_numeric(t: str) -> ParsedText | None:
    """Numeric kinds of the 06 section 7.8 table, on a normalised token."""
    if m := _SCALE_WORD.search(t) or _SCALE_BARE.fullmatch(t):
        return ParsedText("scale_note", scale_n=int(m.group(1)))
    if m := _AREA.search(t):
        factor = _MM2_PER_SQFT if "F" in m.group(2) else _MM2_PER_M2  # SQ.FT / SFT / SQFT vs M2 / M² / SQ.M
        return ParsedText("area", area_mm2=_round(Decimal(m.group(1)) * factor))
    if m := _PAIR_IMPERIAL.fullmatch(t):
        a, b = _feet_inch_mm(m.group(1), m.group(2)), _feet_inch_mm(m.group(3), m.group(4))
        if a > 0 and b > 0:
            return ParsedText("size_pair", pair_mm=(a, b), pair_imperial=True)
        return None
    if m := _PAIR_METRIC.fullmatch(t):
        a, b = _metric_value(m.group(1), m.group(2)), _metric_value(m.group(3), m.group(4))
        if all(MM_NUMBER_MIN <= v <= MM_NUMBER_MAX for v in (a, b)):
            return ParsedText("size_pair", pair_mm=(a, b))
        return None
    if m := _FEET_INCH.fullmatch(t):
        mm = _feet_inch_mm(m.group(1), m.group(2))
        return ParsedText("feet_inch", mm=mm) if mm > 0 else None
    if m := _METRIC_LENGTH.fullmatch(t):
        mm = _round(Decimal(m.group(1)) * _METRIC_UNIT_MM[m.group(2)])
        return ParsedText("metric_length", mm=mm) if mm > 0 else None
    if _MM_NUMBER.fullmatch(t) and MM_NUMBER_MIN <= (n := int(t)) <= MM_NUMBER_MAX:
        return ParsedText("mm_number", mm=n)
    return None


def _metric_value(number: str, unit: str | None) -> int:
    if unit is not None:
        return _round(Decimal(number) * _METRIC_UNIT_MM[unit])
    value = Decimal(number)
    return _round(value * 1000) if value < _UNITLESS_METRES_BELOW else _round(value)


def parse_token(text: str) -> ParsedText:
    """Classify one text token (06 section 7.8): numeric kinds, opening tag, room name, else ``other``."""
    t = normalize_text(text)
    if (parsed := _parse_numeric(t)) is not None:
        return parsed
    if _OPENING_TAG.fullmatch(t):
        return ParsedText("opening_tag", tag=t)
    if (room := match_room_name(t)) is not None:
        return ParsedText("room_name", room_name=room[0], room_type=room[1])
    return ParsedText("other")
