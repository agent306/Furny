# Task 11 report: text parsing and room-name dictionary

Status: DONE (commit 876d76a, pushed to build/p3-vision)

## Implemented
- `vision/app/schemas/candidates.py`: `TextKind`, frozen/slots `ParsedText` (only type so far).
- `vision/app/utils/roomnames.py`: `ROOM_NAMES` (every key of 06 §7.8; BATH/BATHROOM -> bathroom, rest of the toilet row -> toilet), `ROOM_DEFAULT_NAMES` (all 19 RoomType values, other -> "Room"), `levenshtein_ratio`, `match_room_name`, `title_case_name`.
- `vision/app/pipeline/textparse.py`: `normalize_text`, `parse_token`.
- `vision/tests/test_textparse.py`: 9 tests (test_numbers, test_feet_inch, test_ocr_confusions, test_letters_are_not_digit_confused_in_words, test_metric_pair, test_room_names, test_opening_tags, test_levenshtein_ratio, test_room_dictionary_complete). The completeness test hardcodes the spec §7.8 key list and also asserts there are no extra keys.

## Rulings applied
- I15/T11 note: O->0 and l/I->1 are applied before upper-casing, and only when the substituted token fully matches a numeric kind (scale_note, area, size_pair, feet_inch, metric_length, mm_number) and the token contains a real digit. `l200` -> 1200, `scale 1:100` is not corrupted to `sca1e`.
- Global rulings K1/K2/K5/K12/K18 do not touch this task.

## TDD evidence
- RED: `uv run pytest tests/test_textparse.py -q` -> `ModuleNotFoundError: No module named 'app.pipeline.textparse'` (collection error), expected as the module did not exist.
- GREEN: same command -> `9 passed`.
- Full suite: `uv run pytest -q` -> 290 passed, 1 skipped. `ruff check .` clean, `ruff format --check .` clean (57 files), `mypy app` clean (38 files).

## Decisions / gap-list items (spec silent)
1. Unitless metric size-pair values < 100 are metres, otherwise mm, per value (as the brief says; to go in the gap list). Metric pair values must be within 50..60000 mm, otherwise the token is not a size_pair (sanity bound reusing the mm_number range).
2. `x` separator normalisation: `X`, `*`, `×` after a digit/unit/foot-inch mark and before a digit become lowercase `x` (needed for `10'0"X11'0"`, where X follows a quote, not a digit; spec text says "between digits").
3. `ParsedText.room_name` is the matched dictionary key (uppercase, e.g. "MBR"); `match_room_name` returns `(key, RoomType)`. Consumers wanting the display text use `title_case_name(token.text)` (as the T19 plan says).
4. Matching normalisation: uppercase, strip punctuation except `/`, split on whitespace; dictionary keys get the same treatment (`M.BED` -> `MBED`, `WALK-IN` -> `WALKIN`). Phrases are tried longest-first; within one length the highest mean ratio wins, ties go to the earliest window. Not in spec: if nothing matches and a word contains `/`, retry with `/` as separator, so `TOILET/BATH` -> toilet (direct keys such as `LIVING/DINING` and `W/M` still win first).
5. Feet-inch and metric_length results must be > 0 mm. Rounding is half-up via Decimal (e.g. 10'6" = 3200.4 -> 3200, 11'0" = 3352.8 -> 3353). Area: Decimal 912 x 92903.04 = 84,727,572.48 -> 84727572.
6. `area` uses an unanchored search (as in the spec regex), so a label like "BEDROOM 120 SQ.FT" parses as area and loses the name; `scale_note` with "SCALE" also uses search. Per spec table order; T12+/T19 may want to split such labels upstream.
7. `ROOM_DEFAULT_NAMES`: "Living", "Dining", "Kitchen", "Bedroom", "Master Bedroom", "Bathroom", "Toilet", "Balcony", "Utility", "Store", "Study", "Pooja", "Foyer", "Corridor", "Dress", "Deck", "OTS", "Garage", "Room". Spec only gives "Bedroom" and "Room" explicitly; the rest follow the 03 example ("Master Bedroom"). The TS mirror `roomNames.ts` (P-engine plan) must keep the same keys.
8. Source uses `\u` escapes for typographic quote/multiplication characters (ruff RUF001 forbids literals); tests likewise.

## Concerns
- Fuzzy ratio 0.8 lets 5+ letter words with one typo match (e.g. STORY -> STORE); inherent to the spec.
- Words like "ill"/"lol" with a digit elsewhere are not affected; a bare "IIO" would parse as 110 mm_number (needs at least one real digit in the token to trigger confusion, so this particular case is rejected; "1IO" -> 110 would be accepted). Negligible.
