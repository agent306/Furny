### Task 11: Text parsing and room-name dictionary

**Files:**
- Create: `vision/app/pipeline/textparse.py`, `vision/app/utils/roomnames.py`, `vision/app/schemas/candidates.py` (with `ParsedText` only; extended in Tasks 12–18)
- Test: `vision/tests/test_textparse.py`

**Spec refs:** `06 §7.8` (full table and dictionary), `06 §8.7` step 7 (English default names)

**Interfaces:**
- Produces, in `candidates.py`:
  - `TextKind = Literal["mm_number", "metric_length", "feet_inch", "size_pair", "area", "scale_note", "room_name", "opening_tag", "other"]`.
  - `@dataclass(frozen=True, slots=True) ParsedText(kind: TextKind, mm: int | None = None, pair_mm: tuple[int, int] | None = None, pair_imperial: bool = False, area_mm2: int | None = None, scale_n: int | None = None, room_name: str | None = None, room_type: str | None = None, tag: str | None = None)`.
- Produces, in `textparse.py`: `normalize_text(s) -> str` and `parse_token(text: str) -> ParsedText`.
- Produces, in `roomnames.py`:
  - `ROOM_NAMES: dict[str, RoomType]` (every key of 06 §7.8).
  - `ROOM_DEFAULT_NAMES: dict[RoomType, str]`.
  - `levenshtein_ratio(a, b) -> float`, defined as `1 − dist / max(len)`.
  - `match_room_name(text) -> tuple[str, RoomType] | None`.
  - `title_case_name(raw) -> str`.

- [ ] **Step 1: Write the failing test.**
  - `test_numbers`: `parse_token("3300") == ParsedText("mm_number", mm=3300)`. `"45"` → `other`. `"60001"` → `other`. `"3.6M"` → `metric_length` 3600. `"1200MM"` → 1200. `"360CM"` → 3600.
  - `test_feet_inch`: `"10'0\""` → 3048. `"10'-6\""` → 3200. `"8'"` → 2438. `"12' 3\""` → 3734.
  - `test_ocr_confusions`:
    - `"10'0\"X11'0\""` → `size_pair` (3048, 3353) with `pair_imperial=True`.
    - `"12’3”x7’11”"` → (3734, 2413).
    - `"33OO"` → `mm_number` 3300. `"l200"` → 1200.
    - `"T0ILET"` → `room_name` with `room_type == "toilet"` (ratio 0.833).
    - `"912 SQ.FT"` → `area` with `area_mm2 == 84_727_572`.
    - `"SCALE 1:100"` → `scale_note` 100. `"1:50"` → 50.
  - `test_metric_pair`: `"3.0 X 3.6"` → (3000, 3600), because unitless values < 100 are read as metres; this convention is recorded in the gap list. `"3000x3600"` → (3000, 3600).
  - `test_room_names`:
    - `"MASTER BEDROOM"` → `master_bedroom` (multiword first). `"M.BED"` → `master_bedroom`.
    - `"LIVING/DINING"` → `living`. `"BATH"` → `bathroom`. `"WC"` → `toilet`. `"BALC"` → `balcony`. `"KIT"` → `kitchen`.
    - `"HOUSEHOLD SHELTER"` → `store`. `"OTS"` → `ots`. `"5 FEET WIDE CORRIDOR"` → `corridor`. `"DECK"` → `deck`.
    - `title_case_name("LIVING/DINING") == "Living/Dining"`.
  - `test_opening_tags`: `"D1"`, `"SD2"`, `"W12"` → `opening_tag`; `"W123"` → `other`.
  - `test_room_dictionary_complete`: `ROOM_NAMES` contains every key listed in 06 §7.8, and `set(ROOM_DEFAULT_NAMES) == set(get_args(RoomType))` with `ROOM_DEFAULT_NAMES["other"] == "Room"`.
- [ ] **Step 2: Run it, expect FAIL.** Command: `uv run pytest tests/test_textparse.py -q`.
- [ ] **Step 3: Implement** the normalization and kind table exactly as 06 §7.8.
  - The O→0 and l/I→1 substitutions apply only when the substituted token then fully matches a numeric kind.
  - Room matching: uppercase, strip punctuation except `/`, split words, and test phrases longest-first. A phrase matches a contiguous word window when every word has ratio ≥ 0.8.
  - Area unit factors: sq ft = 92 903.04 mm², m² = 1 000 000.
- [ ] **Step 4: Run tests, expect PASS.** Same command as Step 2.
- [ ] **Step 5: Quality gates.** `uv run ruff check . && uv run ruff format --check . && uv run mypy app`
- [ ] **Step 6: Commit.** `git add vision/app/pipeline/textparse.py vision/app/utils/roomnames.py vision/app/schemas/candidates.py vision/tests/test_textparse.py` then `git commit -m "feat(vision): dimension/room text parsing with OCR confusion handling" -m "$FURNY_TRAILER"`.

---

