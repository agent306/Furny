# Task 19 report: labeler interface, heuristic labeler, vendor protocol

## Implemented
- `vision/app/pipeline/labeling/base.py`: `Labeler` protocol, `LabelingOutcome` dataclass (`calls: list[Any]` until Task 22).
- `vision/app/pipeline/labeling/heuristic.py`: `HeuristicLabeler` (06 §9.7).
- `vision/app/pipeline/labeling/vendor.py`: `RecognitionVendor` protocol only.
- `vision/tests/test_labeling_heuristic.py` (27 tests), `vision/tests/test_reference_labeling.py` (8 reference tests, both images),
  `chain_candidates(ChainResult) -> CandidateSet` helper added to `vision/tests/support/reference.py`.

## TDD
RED: `uv run pytest tests/test_labeling_heuristic.py -q` before any implementation:
`ModuleNotFoundError: No module named 'app.pipeline.labeling.base'` (collection error; expected, the modules did not exist).
GREEN: same command, `27 passed` (after the second round of tests for the garbled foot marks and the imperial size guard).
Gates: `ruff check`, `ruff format --check`, `mypy app` clean. Full suite: `979 passed, 1 skipped, 3 xfailed in 196s`.

## Controller additions
A. Reference smoke (full chain + replayed OCR + `HeuristicLabeler`):
- HDB: `unitSystem` metric (39 `mm_number` tokens listed by spans), no warning. Brochure: `imperial` (`912 SQ.FT`, feet-inch room sizes whose
  foot marks survive on several unparseable OCR tokens: `8'1x50`, `6'6'x7`, `51X76"`, `101"x21'6"`, `8'1x101`), no warning.
- Matched truth rooms with an OCR'd label (ledges excluded) get the right name, type, `name_text_id`: HDB 3/3 (toilet-1, bedroom-1, balcony),
  brochure 3/3 (bedroom-right, kitchen, toilet-right). The other truth rooms are merged or unmatched by Task 18 (not this task's scope).
- Missed rooms: HDB 0 (every truth label token lies in a face), brochure 2 (`OTS` at (1134, 914), `5 FEET WIDE CORRIDOR` at (598, 1231); neither is a
  truth room, both are name tokens in no face). Every truth label token is in a face, named, or a `MissedRoom`.
- Floors set: HDB named faces 5, dimension labels 39, sizes 0, missed 0; brochure named faces 5, sizes 3, dimensions 0, missed 2; matched-named 3 and 3.

B. M4 carry: a `room_name` token not listed by any face belongs to the face whose outline lies within 1 t_median of the token centre; two faces -> nearer
anchor; a token a face lists stays in it. Tested (on the wall, 1 px past 1 t, two faces both ways, listed-wins). Logged for spec 19 below.

## Decisions and deviations (for review)
1. Dimension labels in the annotation margin: §9.7 says tokens outside the plan region are `ignore`, but the outer dimension chains' labels lie there
   (Task 14b ruling B1). A numeric token a span lists keeps role `dimension` (and a `DimensionLabel`) wherever it is; every other out-of-region token is `ignore`.
2. Imperial evidence: §9.7 counts `feet_inch`/`size_pair` tokens. I count `feet_inch`, `size_pair` with `pair_imperial`, and digit tokens of kind `other` carrying a
   `'` or `"` (OCR-garbled feet-inch). Metric pairs (`3.0 x 3.6`) are not imperial evidence. Without the third rule the brochure would be `unknown`.
3. On an imperial plan, a size pair parsed as millimetres (OCR dropped the foot marks: `100x110` for `10'0"x11'0"`) keeps `sizeText` but gets `widthMm/depthMm = None`
   (else a 10 cm room reaches the scale solver). A metric hint still parses it as mm.
4. Room and missed-room names are `title_case_name` of the token text (as the brief says), so the fuzzy `TOILE` token gives `Toile` (type `toilet`).
5. Opening verdict `support < 0.4 -> unsure` applies to passages too (their support is 0.0 by definition), so every passage is `unsure`. Literal §9.7; assembly's
   -0.1 for `unsure` then hits every passage (0.45 -> 0.35). Probably wants an exemption for kind `opening`; left for the controller.
6. `drawing_kind_cv == "unknown"` (not in `LabelingResult`'s literal) maps to `architectural_line_drawing`; the preprocess stage never emits it today.
7. Wall `unsure` = `source == "single_line"` (the brief's "single-line walls"); `kind` None; opening `door_type`/`window_type` None (assembly takes the CV type).

## For spec 19 (reconciliation log)
- M4: names on a wall belong to the face within 1 t; nearer anchor on a tie.
- Deviations 1 to 3 and 5 above touch §9.7 wording.

## Files
vision/app/pipeline/labeling/{base,heuristic,vendor}.py, vision/tests/test_labeling_heuristic.py, vision/tests/test_reference_labeling.py,
vision/tests/support/reference.py (helper). Scratch files in the scratchpad only.

## Amendments (coordinator rulings after review hand-off)
Concerns 1-3 and 6 accepted and logged. Two rulings applied:
- **Concern 4 (fuzzy room names).** A room-name token that matched the dictionary only fuzzily takes the canonical dictionary name
  (`TOILE` -> `Toilet`); a token whose text contains the key's words verbatim (`LIVING ROOM`, `5 FEET WIDE CORRIDOR`) keeps `title_case_name` of its own text.
  New `room_display_name(text, key)` in `vision/app/utils/roomnames.py`; used for `RoomLabel.name`, `MissedRoom.name` and the `room_name` texts'
  `normalizedText`. Test: `test_fuzzy_room_names_use_the_dictionary_name` (fuzzy `TOILE`, exact `LIVING ROOM`, note `5 FEET WIDE CORRIDOR`, fuzzy missed `BATHROM`).
  Spec 19: room names from fuzzy dictionary matches are canonical (§9.7 "Room names").
- **Concern 5 (passages).** Openings of kind `opening` are exempt from `support < 0.4 -> unsure`; doors and windows keep the rule. Test:
  `test_walls_and_openings` (O3 door at 0.3 -> `unsure`, O4 passage at 0.0 -> `opening`). Spec 19: §9.7 "Openings".
- Reference smoke unchanged (names there were exact). Gates and full suite: see the commit's run below.
Full run after the amendments: 980 passed, 1 skipped, 3 xfailed; ruff check, ruff format --check and mypy app clean.

## Fix round 1 (review task-19-review.md; every ruling below is a spec-19 addition)
- **I1 unit system weighed.** `_unit_system`: hint wins; else imperial only when >= 3 imperial tokens **and** their weight exceeds the metric
  weight; metric when >= 3 span-listed `mm_number`/`metric_length` tokens (weight 2 each, also M8); else unknown + `unit_system_guessed`.
  Imperial weights: feet-inch value, imperial size pair, area in sq.ft = 1; digit token with unparseable foot/inch marks = 0.5.
  `valueMm`: a feet-inch or `metric_length` dimension always converts; a plain `mm_number` is `None` only on an imperial plan; each size text converts by its own
  marks (feet-inch pairs convert on a metric plan too); a metric-read pair on an imperial plan still gives no width/depth.
  Tests: `test_mixed_units_are_weighed_not_counted` (12 mm dims + 3 feet-inch sizes -> metric, all values set, sizes converted),
  `test_stray_quote_marks_do_not_make_a_metric_plan_imperial`, `test_metric_lengths_with_spans_make_a_metric_plan` (`3.2 m`), plus precedence, no-span,
  sq.ft/sq.m and quote-without-digit cases.
- **M2 split names.** Adjacent word tokens (kind `room_name`/`other`, letters only, angle 0) on one baseline, similar height (>= 0.7), gap <= 1.5 text heights, and not
  listed by two different faces, are joined when the concatenation matches a longer dictionary key than either word (`MASTER`+`BEDROOM` -> `Master Bedroom`,
  `LIVING`+`ROOM`). The joined name has the id of its left word; every word gets role `room_name` with the whole name as `normalizedText`. Fuzzy matches keep a trailing
  number (`BEDROM 2` -> `Bedroom 2`).
- **M3 abbreviations.** A dictionary key of <= 3 letters or with a dot (`OTS`, `WC`, `MBR`, `W.C`, `M.BED`, `BR`, `KIT`) gives the type's `ROOM_DEFAULT_NAMES` name
  (`OTS`, `Toilet`, `Master Bedroom`); the brochure's missed room is now `OTS`.
- **Also changed.** An unnamed face keeps a size pair it lists (earlier a size needed a name); `_below_name` lost its redundant `sy > cy` guard.
- **M4 mutants.** New tests for size-below reach / column / above / overlap / listed-by-another-face / nearest, left and right corridor borders, 0.5 t vs 1 t name tolerance,
  topmost tie-break, support thresholds 0.39 / 0.4 / 0.45, quote marks without digits. A local mutation run of 15 mutants (the review's survivors) killed all 15.
- **M5-M7.** Dead `spans[...]` reassignments and the vacuous assert removed (`chain()` helper), protocol test now exercises both protocols, `_room_size` extracted, tokens
  compared by id, `tests/support/labeling.py::checked` (camelCase dict and JSON round trip) used by `run()` and the reference fixture.
- **Reference smoke (re-confirmed).** HDB: metric, 5 named faces, 39 dimension labels, 0 sizes, 0 missed, 3/3 matched names right. Brochure: imperial, 5 named faces,
  3 size texts (no widths: marks lost), 2 missed (`OTS`, `5 Feet Wide Corridor`), 3/3 matched names right. Floors unchanged.
- Spec 19 log: I1 weights and thresholds; M2 joining rule; M3 abbreviation names; sizes for unnamed faces; `metric_length` with spans is metric evidence (M8).
Full run after fix round 1: 1012 passed, 1 skipped, 3 xfailed; ruff check, ruff format --check, mypy app clean.
