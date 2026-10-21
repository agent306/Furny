# Task 13 report: line segments, collinear merge, dominant orientation

Status: DONE_WITH_CONCERNS (design deviation to confirm: LSD edges are snapped to stroke centres, see below)
Commit: 5047763 feat(vision): LSD segments with collinear merge and dominant orientation (pushed to build/p3-vision)

## Implemented
- `vision/app/schemas/candidates.py`: `Segment` (frozen, slots; `id, p0, p1, width_px, is_thin, source`; properties `length`, `angle_deg`).
- `vision/app/pipeline/segments.py`: `detect_segments(page, pre, ocr, ctx)`, `merge_collinear(segs, *, angle_tol_deg=1.5, dist_tol=2.0, gap_tol=4.0)`, `dominant_orientation(segs)`.
- `vision/tests/test_segments.py` (27 tests; file name per brief, no K18 reallocation applies to T13).

## How it follows 06 §7.9
1. LSD (`detect_line_segments`, Task 9; Hough fallback is inside it) on `pre.gray` with `ocr.text_mask` painted white, cropped to `pre.region`, tile by tile (2048 px, 64 px overlap; seam duplicates are merged afterwards) so LSD's float64 buffers stay bounded (06 §5.2). Peak RSS on a 6000x4500 page did not rise above the preprocess peak (about 680 MB); 0.8 s.
2. Keep length >= `max(8, 0.008 L)`, L = region long side.
3. Merge: longest first; angle <= 1.5 deg (circular mod 180), both endpoints within `max(2, 0.5 x width)` of the longer segment's line, gap along it <= 4 px; result is the union of projections on the longer segment's line, length-weighted width. Ids `S1..Sn` sorted by (min y, min x); p0->p1 follows the angle (left to right, or top to bottom for steep segments).
4. Width = 2 x median of dt at 9 interior points (max over the pixel and its two normal neighbours); `is_thin = width <= 1.8 t_thin`.
5. `pdf_vector` (with at least one vector segment): `page.vector.segments` through `page.transform`, width = PDF line width x sqrt(|det A|) (hairline 0 -> `t_thin`), `source="vector"`, then merge. Segments whose midpoint is outside the plan region are dropped (consistent with vector text tokens). Min-length is not applied (spec: steps 1-2 replaced). Empty vector segment list falls back to the raster path.
6. `dominant_orientation`: length-weighted histogram of angle mod 90 in 0.5 deg bins, circular 3-bin smoothing for the peak, refined by the weighted mean over +-1.5 deg around the peak. Empty -> 0.0. Rotated 5 deg gives 4.999; 12.3 deg gives 77.70 (= 90 - 12.3, clockwise convention).

## Deviation / design decision to confirm
LSD returns the two *edges* of a stroke (a 6 px line gives two segments 6 px apart on the ink boundary), so a literal "2 x median(dt) at the segment" would give about 1-2 px for thick walls and `test_width_attached` (6 +- 1) could not pass; the edges also never merge under the 2 px distance tolerance. Fix inside the spec's steps: before the merge each raw segment is moved onto its stroke centre (distance-transform ridge, found on 9 normals; an ink run counts only if its length is at most 2 x dt-max + 1.5 so end-cap edges and junction normals are ignored) and extended up to 3 px along the ink (LSD ends stop about 1 px short; without this the 3 px break in the gap test measures 5 px > 4 px). The two edges of one stroke then coincide and merge into one centre-line segment. Segments that find no ink within 3 px stay unmoved with width `t_thin`. Consequences for T14/T16/T17: filled walls come out as one centre line with `width_px` about the wall thickness; the short end-cap edges of filled walls remain as short segments (width about 2, is_thin True); double-line walls yield two thin lines.
Other notes: the Hough fallback in `detect_line_segments` (Task 9) uses Canny on gray, not `ink_notext` as 06 §7.9 says; `source` is "hough" when `cv2.createLineSegmentDetector` raises, else "lsd". Merge tolerance on the perpendicular distance uses both endpoints, so two long segments 1.5 deg apart will not merge; short ones do.

## Tests
`uv run pytest tests/test_segments.py -q` -> 27 passed; full suite `uv run pytest -q` -> 347 passed, 1 skipped (pre-existing skip). `ruff check`, `ruff format --check`, `mypy app` clean. Output pristine.
Covered: brief cases (rectangle -> exactly 4 segments, gap 3 -> 1 / gap 12 -> 2, width 6 not thin / width 2 thin, min length (both the 8 px floor and 0.008 L, via a stubbed detector), text painted white (with an unmasked control that does produce short glyph segments), theta0 = 5 +- 0.5, vector mapping and width scaling), plus junction wall, double-line wall, tiled seams (TILE_PX patched to 400), hough source label, merge tolerances/thick tolerance/projection union/id ordering/wrap at 180/empty, dominant_orientation unit cases.

## TDD evidence
Tests were written before the implementation but the RED run (ImportError) was not executed separately; the TDD-order lapse ruling applies. Discrimination was checked by mutation: no text painting -> `test_text_painted_white` fails; no end extension -> `test_merge_small_gap[3-1]` fails; no centre snapping -> 7 tests fail; `gap_tol` 8 -> boundary and tolerance tests fail. Source restored afterwards (diffed).

## Files changed
- /home/user/furny-p3/vision/app/pipeline/segments.py (new)
- /home/user/furny-p3/vision/app/schemas/candidates.py (adds `Segment`, `SegmentSource`)
- /home/user/furny-p3/vision/tests/test_segments.py (new)

## Self-review
Ruff line limit forced a simpler sort key (tuple of points as tiebreak). No dead code left. The `int64` index arrays are per-segment (not full-image); full-image temporaries are limited to per-tile uint8 copies. K1/K2/K5/K12 do not touch this task.

---
# Fix round 1 (reviewer findings 1-4)

Commit: see `git log` (fix(vision): size ridge search from the data, keep thin symbols out of thick walls, grid-based merge).
Command: `uv run pytest tests/test_segments.py -q` -> 46 passed (9 s). Full suite `uv run pytest -q` -> 366 passed, 1 skipped. ruff check, ruff format --check, mypy app clean.

## Changes
1. **Ridge search radius from the data.** `radius = min(200, ceil(2 x max dt) + 3)` replaces the fixed 32 px; the snapping chunk size shrinks with the radius to bound memory. A run that touches either end of the search window is not a cross-section. The run-length test is `run <= 1.15 x 2 x peak + 1.5` (the 3x3 chamfer distance transform reads about 5 % low: a 56 px wall peaks at 26.7, so the old `2 x peak + 1.5` rejected the wall itself). On a 6000x4000 page walls of t=56 and t=70 now give one centre line each (centres within 2 px, width within 8 %) and exactly one thin end cap at the stub end. Caps and other segments that do not snap are merged separately and keep width `t_thin` (before, the dt re-measure gave caps 3.8 px, "not thin" at t_thin 2).
2. **Merge policy.** Widths with ratio <= 1.5 fuse as before (tolerance `max(2, 0.5 x larger width)`). A clearly thinner segment is only absorbed when its projection lies inside the thick base's extent (+-4 px) and within half its width; it never lengthens the base and does not enter the weighted width. Window sample: wall no longer spans the opening; the centre line is kept.
3. **Merge performance.** Endpoint grid (32 px cells) replaces the all-pairs scan; candidates are pre-filtered in Python by angle and by distance to the base line, numpy only for the survivors; a box over 1500 cells falls back to a scan. `merge_collinear(..., check_deadline=None)` calls the callback every 256 bases; `detect_segments` passes `ctx.check_deadline` (raster and vector). 40k random axis-aligned segments: 19 s -> 1.0-1.5 s (20k: 0.5 s, 5k: 0.1 s).
4. **Vector `is_thin`** is recomputed after the vector merge.

## New tests (tests/test_segments.py, 46 total)
`test_very_thick_walls_keep_their_caps_and_centre_lines[56,70]`, `test_clipped_ink_run_is_not_a_cross_section`, junction test now pins the caps to the wall ends and thin, `test_merge_unequal_widths_gives_length_weighted_width`, `test_merge_perpendicular_tolerance_follows_the_larger_width`, `test_merge_checks_both_endpoints_of_a_segment_within_the_angle_tolerance[False,True]`, `test_merge_thin_segment_never_extends_a_thick_one`, `test_merge_thin_segment_inside_a_thick_one_is_absorbed`, `test_window_centre_line_is_not_swallowed_by_the_wall`, `test_unsupported_segments_stay_put` (covers MIN_SUPPORTED_SAMPLES and RIDGE_REACH_PX), `test_attach_widths_looks_one_pixel_to_each_side`, `test_hough_fallback_when_lsd_raises` (patches `cv2.createLineSegmentDetector`, so Hough really runs), `test_vector_is_thin_follows_merged_width`, `test_merge_scales_to_tens_of_thousands_of_segments` (40k, < 4 s limit for CI noise), `test_merge_checks_the_deadline`, `test_theta0_smoothing_joins_adjacent_bins`, `test_theta0_is_refined_below_the_bin_width[5.2,5.5]` (+-0.15).

## Mutants (each applied alone to segments.py, then reverted and diffed)
Killed: `across` forced True (junction + thick-wall + clipped-run tests); tolerance from the smaller width; no +-1 normal neighbours in `_attach_widths`; `RIDGE_REACH_PX=32`; merged width from the base (not length-weighted); perpendicular check on one endpoint only (merge); `MIN_SUPPORTED_SAMPLES=1`; theta0 refinement removed; theta0 smoothing removed; fixed 32 px radius; touch-window rule removed; thin segments allowed to extend a thick base; snapped/unsnapped not split.
Equivalent (survives, by design): dropping the second endpoint from the cheap `_near_line` prefilter only widens the candidate set, the exact check follows.

---
# Fix round 2

1. `test_vector_is_thin_follows_merged_width` now uses VSeg 50->260 (width 3.0) + VSeg 250->400 (width 4.5), t_thin 2: they fuse to width 3.625 (> 3.6), so `is_thin` must be False. Mutant `return merged` (no is_thin recompute) now FAILS this test; reverted and diffed.
2. `merge_collinear` checks the deadline inside the chain-growth loop too. A single work counter (live bases plus growth rounds, check every 256) replaces the per-index check, which also stops dead segments from counting. New test `test_merge_checks_the_deadline_while_a_chain_grows` (3000 tiny collinear pieces fuse one neighbour per round); with the in-loop check disabled it FAILS (verified), then reverted. An earlier draft of the test passed under that mutant because the outer loop's own check fired; the counter change fixed that.
3. Wall-clock limit of the 40k merge test raised from 4 s to 8 s (measured about 1.0-1.5 s).

Commands: `uv run pytest tests/test_segments.py -q` -> 47 passed; `uv run pytest -q` -> 367 passed, 1 skipped; ruff check, ruff format --check, mypy app clean.
