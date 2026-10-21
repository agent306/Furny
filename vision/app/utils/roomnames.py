"""Room-name dictionary and fuzzy matching (06 section 7.8).

``ROOM_NAMES`` mirrors the TypeScript ``resources/js/engine/plan/roomNames.ts`` key for key (04 section 2);
change both together. Matching: uppercase, hyphens read as spaces, other punctuation stripped (``/`` kept),
multiword phrases first.
"""

import re
from typing import Final

from app.schemas.plan import RoomType

MATCH_THRESHOLD: Final = 0.8

_GROUPS: Final[tuple[tuple[RoomType, tuple[str, ...]], ...]] = (
    ("master_bedroom", ("MASTER BEDROOM", "MASTER BED", "M.BED", "MBR")),
    ("bedroom", ("BEDROOM", "BED ROOM", "BED", "BR", "GUEST ROOM", "KIDS ROOM", "CHILDREN ROOM")),
    (
        "living",
        (
            "LIVING",
            "LIVING ROOM",
            "LIVING/DINING",
            "HALL",
            "DRAWING",
            "DRAWING ROOM",
            "LOUNGE",
            "FAMILY",
        ),
    ),
    ("dining", ("DINING", "DINING ROOM")),
    ("kitchen", ("KITCHEN", "KIT", "PANTRY")),
    ("toilet", ("TOILET", "WC", "W.C", "WASH", "POWDER")),
    ("bathroom", ("BATH", "BATHROOM")),  # 06 section 7.8: BATH/BATHROOM override the toilet row
    ("balcony", ("BALCONY", "BALC", "SIT OUT", "SITOUT", "VERANDAH", "VERANDA")),
    ("utility", ("UTILITY", "WASH AREA", "W/M", "LAUNDRY", "SERVICE YARD", "YARD")),
    ("store", ("STORE", "STORE ROOM", "STORAGE", "BOMB SHELTER", "SHELTER", "HOUSEHOLD SHELTER")),
    ("study", ("STUDY", "OFFICE", "LIBRARY")),
    ("pooja", ("POOJA", "PUJA", "PRAYER")),
    ("foyer", ("FOYER", "ENTRANCE", "ENTRY", "LOBBY")),
    ("corridor", ("CORRIDOR", "PASSAGE", "LOBBY PASSAGE")),
    ("dress", ("DRESS", "DRESSING", "WALK-IN", "WIC")),
    ("deck", ("DECK", "TERRACE", "AC LEDGE", "PLANTER")),
    ("ots", ("OTS", "OPEN TO SKY", "SHAFT", "DUCT")),
    ("garage", ("GARAGE", "PARKING", "CAR PORCH")),
)

ROOM_NAMES: Final[dict[str, RoomType]] = {key: kind for kind, keys in _GROUPS for key in keys}

# English default name per type (06 section 8.7 step 7); ``other`` falls back to "Room".
ROOM_DEFAULT_NAMES: Final[dict[RoomType, str]] = {
    "living": "Living",
    "dining": "Dining",
    "kitchen": "Kitchen",
    "bedroom": "Bedroom",
    "master_bedroom": "Master Bedroom",
    "bathroom": "Bathroom",
    "toilet": "Toilet",
    "balcony": "Balcony",
    "utility": "Utility",
    "store": "Store",
    "study": "Study",
    "pooja": "Pooja",
    "foyer": "Foyer",
    "corridor": "Corridor",
    "dress": "Dress",
    "deck": "Deck",
    "ots": "OTS",
    "garage": "Garage",
    "other": "Room",
}

_STRIP = re.compile(r"[^A-Z0-9/\s]")
_SPACES = re.compile(r"\s+")


def _words(text: str) -> list[str]:
    """Uppercase, hyphens to spaces, strip other punctuation except ``/``, split on whitespace."""
    return _SPACES.sub(" ", _STRIP.sub("", text.upper().replace("-", " "))).split()


# Longest phrases first (multiword before single word); each entry keeps the original dictionary key.
_PHRASES: Final[list[tuple[list[str], str]]] = sorted(
    ((_words(key), key) for key in ROOM_NAMES), key=lambda entry: -len(entry[0])
)


def levenshtein_ratio(a: str, b: str) -> float:
    """``1 - edit_distance / max(len(a), len(b))``; two empty strings are identical (1.0)."""
    longest = max(len(a), len(b))
    if longest == 0:
        return 1.0
    previous = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        current = [i]
        for j, cb in enumerate(b, 1):
            current.append(min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (ca != cb)))
        previous = current
    return 1.0 - previous[-1] / longest


def _best_match(words: list[str]) -> tuple[str, RoomType] | None:
    for size in sorted({len(p) for p, _ in _PHRASES}, reverse=True):
        best: tuple[float, int, str] | None = None
        for phrase, key in (e for e in _PHRASES if len(e[0]) == size):
            for start in range(len(words) - size + 1):
                ratios = [
                    levenshtein_ratio(w, p) for w, p in zip(words[start : start + size], phrase, strict=True)
                ]
                if min(ratios) < MATCH_THRESHOLD:
                    continue
                score = sum(ratios) / size
                if best is None or (score, -start) > (best[0], -best[1]):
                    best = (score, start, key)
        if best is not None:
            return best[2], ROOM_NAMES[best[2]]
    return None


def match_room_name(text: str) -> tuple[str, RoomType] | None:
    """Fuzzy-match ``text`` against ``ROOM_NAMES``; returns ``(dictionary key, RoomType)`` or ``None``.

    A phrase matches a contiguous window of the text's words when every word has Levenshtein ratio >= 0.8;
    longer phrases are tried first. If nothing matches, ``/`` is retried as a word separator so that
    ``"BED/TOILET"`` finds ``BED``.
    """
    words = _words(text)
    found = _best_match(words)
    if found is None and any("/" in w for w in words):
        found = _best_match(_words(text.replace("/", " ")))
    return found


def title_case_name(raw: str) -> str:
    """``"LIVING/DINING"`` -> ``"Living/Dining"``; every run of letters is capitalised, the rest kept."""
    return re.sub(r"[A-Za-z]+", lambda m: m.group(0).capitalize(), raw.strip())


def room_display_name(text: str, key: str) -> str:
    """The name to show for a room-name token ``text`` that matched dictionary ``key``: ``title_case_name`` of
    the text when the key's words appear in it verbatim (``"LIVING ROOM"``, ``"5 FEET WIDE CORRIDOR"``), else
    of the key itself, because the match was fuzzy (``"TOILE"`` -> ``"Toilet"``)."""
    words, phrase = _words(text), _words(key)
    exact = any(words[i : i + len(phrase)] == phrase for i in range(len(words) - len(phrase) + 1))
    return title_case_name(text if exact else key)
