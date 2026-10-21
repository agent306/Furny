# Task 20 report: scale solver, fallbacks, confidence, scale note (+ Task 14b re-review carries)

Base `2b59ab8`. Two commits:
- `69ede71 fix(vision): Task 14b re-review carries` (part A)
- `95a88b7 feat(vision): robust scale solver with fallbacks and confidence` (parts B and C)

## A. Task 14b re-review carries (N1-N3)

| Item | Change |
|---|---|
| N1 | `dimensions.py::_drop_crossings`: a marked tick at a crossing is dropped only when the crossing is at an **end of this line** (at its first or last tick, within the dedupe gap), the other line has its own tick there, and the other line has more ticks. Chains crossing in the interior of both keep the shared slash. |
| N2 | `dimension_ticks.py::styled_ticks`: `WALL` ticks are exempt from the end-extra rule. Then the HDB tick precision dropped to 0.920. The new false tick was L6@210: the line stops at x ≈ 1708, there is a thin face line at 1716, and the solid wall starts at 1723. `_wall_face_at_end` accepted it because the chained candidate reached 1717.7, within `END_SLACK_PX` of the wall. The fix: a wall face is a tick only when the line shows within `WALL_CONTACT_PX = 3` px of the face (`found` columns of `_line_rows`). With that, every floor holds exactly. |
| N3 | `dimension_ticks.py::_draw_pieces`: after subsampling every 4th column, the last centre point is appended. |

Tests (in `tests/test_dimensions.py`):
- `test_crossing_chains_keep_the_slash_they_share`: the unit case on `_drop_crossings`, with an end-crossing control.
- `test_crossing_raster_chains_keep_the_slash_they_share`: a 4-tick horizontal chain crossed by a 3-tick vertical chain.
- `test_short_last_interval_to_a_wall_face_keeps_its_end_tick[20,30,50]`: 6 phases each.
- `test_wall_beyond_a_gap_past_the_end_tick_is_no_tick`: the HDB-L6 geometry, 6 phases. It fails when the contact check is loosened (verified with `WALL_CONTACT_PX = 30`).
- `test_drawn_pieces_reach_the_line_end[100..103]`.
- `test_reference_dims.py::test_hdb_dimension_floors` pins the floors.

**RED** (`uv run pytest tests/test_dimensions.py -q -k "share or wall_face_keeps or reach_the_line_end"`, before the fix):
```
FAILED tests/test_dimensions.py::test_crossing_chains_keep_the_slash_they_share
FAILED tests/test_dimensions.py::test_crossing_raster_chains_keep_the_slash_they_share
FAILED tests/test_dimensions.py::test_short_last_interval_to_a_wall_face_keeps_its_end_tick[20]
FAILED tests/test_dimensions.py::test_short_last_interval_to_a_wall_face_keeps_its_end_tick[30]
FAILED tests/test_dimensions.py::test_drawn_pieces_reach_the_line_end[101] - ...
FAILED tests/test_dimensions.py::test_drawn_pieces_reach_the_line_end[102] - ...
FAILED tests/test_dimensions.py::test_drawn_pieces_reach_the_line_end[103] - ...
7 failed, 2 passed, 203 deselected
```
These failures were expected:
- N1: the vertical chain came back as `[200, 800]` / `[(0, True), (600, True)]`.
- N2: `[300, 750, 1200]` without the wall face.
- N3: the stroke ended at 105 instead of 106/107/108.
- The `[50]` case and `[100]` already passed, as in the review.

**GREEN:** the same selection plus the control gives `10 passed`.

**HDB and brochure dimension metrics** (from the scratch `metrics.py`, `run_chain`):

| | Before (2b59ab8) | N1+N2 only | Final |
|---|---|---|---|
| Recall / precision | 0.833 / 1.000 | 0.833 / 1.000 | 0.833 / 1.000 |
| Intervals / labels | 0.979 / 0.923 | 0.979 / 0.923 | 0.979 / 0.923 |
| Ticks R / P | 0.985 / 0.932 | 0.985 / **0.920** (L6@210) | 0.985 / 0.932 |
| False ticks | L7@0 L10@0 L16@108 L17@-2 L17@457 | + L6@210 | L7@0 L10@0 L16@108 L17@-2 L17@457 |
| Brochure dimension lines | 0 | 0 | 0 |
| Dimensions stage | 0.31 s | | 0.32 s |

## B/C. Scale solver (`vision/app/pipeline/scale.py`)

### What it does

- **`PxScaleSample`** (renamed from the brief's `ScaleSample` by preflight I3) has the brief's fields plus `line_id: str | None = None`. That field is the dimension line of a chain/overall sample, used for chain consistency; it is None for room and known samples. Its `estimate` property is `value_mm / span_px`.
- **`collect_samples`** returns primary and room samples:
  - Each `DimensionLabel` with a `value_mm` and an existing span gives one sample. The labeler's `chain_segment`/`overall` kind overrides the span kind; `room_interior`/`unknown` keep the span's kind. Weights are 1 and 2.
  - The known dimension gives one sample (w = 3, `overall`): from a span (its length), from a wall (its centre line), or, with null ids (K20), from the walls' outer bbox. The bbox takes the centre-line ends ± thickness/2 of every wall the labeler did not mark `not_wall`. It runs across (x) when the label says "width", else down (y).
  - Rooms: each `RoomLabel` whose face exists and whose `width_mm`/`depth_mm` are both set (the labeler leaves them None for unparsed imperial pairs) gives two samples, w = 0.5. The interior extent comes from the face polygon turned by −theta0 (folded to (−45, 45]), with pixel extents + 1. The orientation is width↔x/depth↔y or the swap, whichever has the smaller `|log((a/px_x)/(b/px_y))|`; ties keep width↔x.
- **`fit_scale`**: weighted median (the mean of the two middle estimates when the cumulative weight is exactly half), then two 8 % rejection rounds, each against the full sample set, the second around the median of the first round's inliers. Then WLS through the origin and the weighted RMS residual.
- **`scale_confidence`**: the §8.3 table, clamped to [0, 1]. The room-label factor 0.7 is applied in `solve_scale`.
- **`find_scale_note`**: needs a `pdf_vector` or `pdf_raster` page with a known DPI, `page_size_pt` passing `is_standard_paper` (Task 8), and a `scale_note` token. The result is `mm/px = N × 25.4 / (dpi × s)`, where `s` is the normalized px per render px from `page.transform`. With several notes, the most frequent N wins.
- **`solve_scale`**:
  - Method order: `dimension_chain` (≥ 2 primary samples, known included, §8.2 step 3), then `room_label`, `scale_note`, `user_hint` (the known sample alone), and `default_guess` (12000 / long side of the region).
  - Anisotropy is checked on raster/pdf_raster/heic pages and rectified photos. With ≥ 3 inliers per axis and `|k_y/k_x − 1| > 2 %`, `y_factor = k_y/k_x` and `mm/px = k_x`. All samples are carried into the corrected frame (y × factor), and the residual is recomputed there against `k_x`.
  - Chain consistency (`dimension_chain` only): a line's ≥ 2 inlier chain segments sum to an inlier overall on a different line, on the same axis, within 1 % in value. Both projected ends must lie within 1 % of the overall's px span.
  - The room-label cross-check runs when the method is not `room_label`: the median over rooms of the mean of each room's two discrepancies.
  - Warnings come from the existing codes: `scale_from_room_labels {rooms}`, `scale_guessed {assumedLongEdgeMm: 12000}`, `scale_anisotropy_corrected {ratioPct: |k_y/k_x − 1| × 100, 1 dp}`, `scale_high_residual {residualPct, 1 dp}` and `scale_room_label_mismatch {discrepancyPct, 1 dp}`. None was missing from the enum.
- **`to_scale_meta`**: a/b are given in document mm (`round(px × mm/px)`, corrected frame). It keeps at most 60 samples, inliers first, each group in sample order.

### Tests

`tests/test_scale.py` has 31 tests:
- Fit: outliers rejected; WLS residual; weights.
- Confidence formula, including the clamps.
- Room orientation (both assignments, w = 0.5); unparsed size gives no sample; the theta0 = 2° extent.
- The labeler kind overrides the span kind; labels without a value or span give no sample.
- Known dimension on a span and on a wall; K20 null ids with width/length/depth.
- The `dimension_chain` happy path; anisotropy on raster/pdf_raster/pdf_vector; a rectified heic, 1.5 % (no correction) and too few y inliers.
- Each fallback: room_label, scale_note (+ conditions: non-standard paper, no DPI, raster image, no note, raster PDF, a resampled transform), user_hint, the known sample joining the chain fit, default_guess, and the full order.
- Room-label cross-check at 15 % (K7) and at 5 % (no warning); high residual warning.
- Chain consistency: match, 0.7 % extent, wrong value, 2.8 % extent, and the same line not counting.
- `to_scale_meta` mm and flags; the cap at 60 with inliers first.

`tests/test_reference_scale.py` has 5 reference tests.

**RED** (`uv run pytest tests/test_scale.py -q`, before `scale.py` existed): `E ModuleNotFoundError: No module named 'app.pipeline.scale'` / `1 error`. This was expected: the module did not exist yet.
**GREEN:** `uv run pytest tests/test_scale.py tests/test_reference_scale.py -q` gives `36 passed in 4.16s`.

### Reference smoke numbers (run_chain, replayed OCR, heuristic labeler)

**HDB** (`hdb-3room`):

| Quantity | Value |
|---|---|
| Method | **`dimension_chain`** |
| mm/px | **7.3712** |
| Truth (traced 11000 line: 1487.7 px through `page.transform`) | 7.3940 mm/px |
| Error | **−0.31 %** (target ≤ 2 %) |
| Residual | 0.80 % |
| Inliers / rejected | 39 / 0 |
| Consistent chains | 1 (right chain 7600 + 1300 = the 8900 overall line) |
| Confidence | 0.966 |
| Anisotropy | **corrected**, `y_factor` 0.9607 (ratioPct 3.9); the traced 8900/11000 lines give 0.9556 |
| Room-label check | rooms 0, discrepancy null (the HDB drawing has no size texts) |
| Warnings | `scale_anisotropy_corrected` only |

**Brochure** (`brochure-2bhk`):
- Method **`default_guess`**: mm/px 9.901 (12000 / 1212 px), warning `scale_guessed`, confidence 0.1.
- The error is **+10.1 %** against the P2-registration truth (8.9946 mm/px, from `load_truth(..., "walls").scale`). For reference, it is +6.9 % against `drawing-walls.json`'s `mm_per_unit` (34.3 mm per source px, giving 9.2614).
- Why the guess: there are no dimension lines. The three size texts are OCR'd `100×110`, `100×110` and `101×40`, so the labeler (unit system imperial) gives `width_mm/depth_mm = None`. It is a PNG, so there is no scale note.
- The test pins `default_guess` as the regression floor. Its docstring says the pin moves to `room_label` when the foot sizes are recovered. I did not tune the solver to the brochure.

**Timing:** the chain plus labeling and scale take ~1.6 s (HDB) and ~1.0 s (brochure) per image with replayed OCR; the scale stage itself takes < 1 ms. Each is asserted < 10 s.

### Deviations for spec 19

1. **`PxScaleSample`** (preflight I3) carries an extra optional `line_id` for step 6.
2. **The "1 overall with LLM confidence ≥ 0.8" primary rule** (§8.2 step 3) is never true in v1 (K8; `LabelingResult` has no confidence). The brief's `test_single_overall_high_confidence` is dropped. A lone known-dimension sample is `user_hint`.
3. **Primary count includes the known sample** (step 3 literal). So known + 1 other sample gives `dimension_chain` (step 8's "< 2 other samples" is then reachable only with 0 others). Also by the literal order of step 8, `room_label` and `scale_note` outrank `user_hint` when the known sample is alone.
4. **K20:** the null-id known dimension spans the walls' outer bbox (centre lines ± thickness/2, walls not marked `not_wall`). I chose the outer faces because "overall width" is outside-to-outside.
5. **Scale note DPI** uses the normalized page's px per inch (render DPI × the transform's scale), per the progress ruling on resampled PDFs. The spec formula `N × 25.4 / dpi` holds when the page is not resampled.
6. **Anisotropy also applies to `heic` pages** (a raster photo format), as well as raster, pdf_raster and rectified photos. `ratioPct` is `|k_y/k_x − 1| × 100`. After correction the residual is recomputed in the corrected frame against `k_x`.
7. **Room-label check** "median over rooms": each room's value is the mean of its two samples' discrepancies.
8. **`residualPct` is null for `scale_note`** as well as `default_guess`/`dxf_units`, since nothing is fitted. `user_hint` reports the single sample's residual (0).
9. **`room_interior`/`unknown` dimension labels** keep the span's kind (only `chain_segment`/`overall` override it).
10. **Rejection rounds** re-test every sample against the new median, so a sample rejected in round 1 can come back in round 2.
11. **(Dimension stage, N2)** A wall face is a tick only when the line runs to within 3 px of it (`WALL_CONTACT_PX`). This narrows the Task 14b "wall the line ends at" rule.

### Files changed

- `vision/app/pipeline/dimensions.py`, `vision/app/pipeline/dimension_ticks.py` (N1-N3)
- `vision/tests/test_dimensions.py`, `vision/tests/test_reference_dims.py` (N tests, floors)
- `vision/app/pipeline/scale.py` (new)
- `vision/tests/test_scale.py`, `vision/tests/test_reference_scale.py` (new)

### Quality gates

`uv run ruff check .` reports all checks passed. `uv run ruff format --check .` reports 95 files already formatted. `uv run mypy app` reports no issues in 57 source files.

Full suite after part A: `1023 passed, 1 skipped, 3 xfailed in 192.77s`. Full suite after part B (final, `uv run pytest -q`): `1059 passed, 1 skipped, 3 xfailed in 198.65s`. Pushed to `origin/build/p3-vision`.

### Self-review / concerns

- **Brochure is `default_guess`** (+10.1 %): this is a real limitation, not a solver bug. The fix belongs to OCR or labeling: recovering feet-inch pairs whose marks were lost, which would enable `room_label`.
- **The HDB fit uses every labelled span, including the 2-tick interior lines** (kind `overall`, w = 2, preflight I6). The 39 samples spread 7.09–7.63 mm/px but all sit within 8 % of the median, so nothing is rejected. The residual is 0.8 %.
- **The anisotropy correction fires on HDB** (3.9 %). Downstream (Task 31) must resample the image and call `CandidateSet.scale_y(y_factor)`. `ScaleResult.used_samples` are already in the corrected frame.
- **The `WALL_CONTACT_PX` narrowing** came from investigating the N2 regression. It goes slightly beyond the reviewer's suggested fix ("exempt WALL ticks"), which alone would have broken the 0.932 tick-precision floor.

## Fix round 1 (review `task-20-review.md`)

| Finding | Change |
|---|---|
| **C1** | `fit_scale` (`scale.py`): a rejection round that would leave no inliers keeps its input and ends the rejection, per the ruling. The resulting high residual then drives `scale_high_residual` and the confidence as usual. `rejected` is now computed through an id set. |
| **I1** | `_wall_face_at_end` (`dimension_ticks.py`) gets the whole `found` array plus `slack` and indexes `found[lo + slack : lo + slack + 3]`, so start-side faces up to 6 px before u = 0 are checked against the right columns. HDB floors unchanged: recall 0.833, precision 1.000, intervals 0.979, labels 0.923, ticks 0.985 / 0.932, brochure 0 lines. |
| **M1** | Boundary tests (each listed mutant is now killed; see the mutation check below). |
| **M2** | The anisotropy threshold now uses the spec form `\|k_x/k_y − 1\| > 2 %`. `ratioPct` stays `\|k_y/k_x − 1\| × 100` (the brief's verbatim 5.0 for 1.05). |
| **M3** | Not changed (spec-compliant). Noted for spec 19 / the controller: with K8, a lone labelled dimension (no rooms, no note) loses to `default_guess` in every heuristic run. |
| **M4** | A private `_collect` returns the dimension samples, the known sample and the room samples separately. `solve_scale` uses that, so the known sample is no longer identified by its weight. The `collect_samples` interface is unchanged. |
| **M5** | Id set (see C1). |
| **M6** | Open faces (`RoomFace.open`) give no room sample (§8.2 step 1, "a closed face"). Room sizes ≤ 0 also give none. |

Extra, found by the C1 random test: an absurd scale from bad labels, for example 10000 over 2 px, made `to_scale_meta` raise, because the document `Point` is limited to ±1 000 000 mm. Sample ends are now held to that range (`MAX_COORD_MM`), with an explicit test.

**New tests:**
- In `test_scale.py`:
  - `test_fit_keeps_its_input_when_a_round_would_reject_everything` ([10, 10, 20, 20]);
  - `test_one_room_whose_size_disagrees_with_its_face_does_not_crash` (reviewer repro 1);
  - `test_two_disagreeing_chain_labels_do_not_crash` (repro 2);
  - `test_degenerate_sample_sets_never_raise` (seed 20, 400 cases: 0–3 labels with zero, 1e-6, 0.5, 3 px and wide spans, duplicates, 0–2 rooms down to 1 px, raster or vector pages; asserts a finite positive scale, confidence in [0, 1] and that `to_scale_meta` serializes);
  - `test_rejection_threshold_is_8_percent` (7 % against 9 %);
  - `test_second_round_retests_every_sample_around_the_new_median`;
  - `test_high_residual_threshold_is_3_percent` (3.5 against 2.9);
  - `test_room_mismatch_threshold_is_10_percent` (11 against 9);
  - `test_room_discrepancy_is_the_mean_of_its_two_samples`;
  - `test_room_check_runs_in_the_corrected_frame`;
  - `test_anisotropy_on_an_unrectified_heic_page`;
  - `test_anisotropy_threshold_is_k_x_over_k_y` (4 boundary cases);
  - `test_slanted_chain_is_not_consistent_with_a_horizontal_overall`;
  - `test_known_dimension_bbox_leaves_out_walls_labelled_not_wall`;
  - `test_open_faces_give_no_room_sample`;
  - `test_meta_holds_sample_ends_to_the_document_range`.
- In `test_dimensions.py`: `test_wall_face_at_either_end_is_a_tick_when_the_segment_stops_short[side × gap 20/30/50/120 × off 0–5]`, 48 cases × 6 phases.

**RED, before the fix** (`uv run pytest tests/test_scale.py -q`):
```
FAILED tests/test_scale.py::test_fit_keeps_its_input_when_a_round_would_reject_everything
FAILED tests/test_scale.py::test_one_room_whose_size_disagrees_with_its_face_does_not_crash
FAILED tests/test_scale.py::test_two_disagreeing_chain_labels_do_not_crash - ...
FAILED tests/test_scale.py::test_degenerate_sample_sets_never_raise - IndexEr...
FAILED tests/test_scale.py::test_anisotropy_threshold_is_k_x_over_k_y[9.802-True]
FAILED tests/test_scale.py::test_open_faces_give_no_room_sample - AssertionEr...
6 failed, 45 passed
```
- The C1 tests failed with IndexError, M2 at the boundary, and M6 on the open face.
- The other boundary tests passed. That was expected: they pin behaviour that was already correct but unguarded.

`uv run pytest tests/test_dimensions.py -q -k either_end`: 12 failed (`start-{20,30,50,120}-{3,4,5}`), 36 passed. This is I1 exactly as the review reported.

**GREEN:**
- `uv run pytest tests/test_scale.py tests/test_reference_scale.py tests/test_reference_dims.py -q`: 72 passed.
- `uv run pytest tests/test_dimensions.py -q -k "either_end or gap_past_the_end or wall_face_keeps"`: 52 passed.
- Commit `9dca9d7`, pushed. Mutation check (scratch `mut.py`, `test_scale.py -x`): all 12 mutants killed.
  - `REJECT_ROUNDS = 1`; round 2 on round-1 inliers only; `REJECT_FRAC = 0.10`; `HIGH_RESIDUAL_PCT = 5`; `ROOM_MISMATCH_PCT = 12`;
  - heic dropped from `ANISO_KINDS`; the same-axis check removed;
  - the C1 guard removed; the rooms not carried into the corrected frame; open faces allowed;
  - the old anisotropy ratio form; `not_wall` not excluded.

**Gates:**
- `uv run ruff check .`: all checks passed.
- `uv run ruff format --check .`: 95 files already formatted.
- `uv run mypy app`: no issues in 57 source files.
- `uv run pytest -q`: **1128 passed, 1 skipped, 3 xfailed** (210.6 s).

**Reference smoke: unchanged.**
- HDB: `dimension_chain`, 7.3712 mm/px, −0.31 % against the traced 11000 line; residual 0.80 %; 39 inliers, 0 rejected; 1 consistent chain; confidence 0.966; `y_factor` 0.9607.
- Brochure: `default_guess`, 9.901 mm/px, +10.1 %.
