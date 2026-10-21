# Review: Tasks 16 + 16b (walls.py, reference hardening), e77e696..92b8bc2

Reviewed from `review-e77e696..92b8bc2.diff` (read in passes: preprocess/region/segments, walls.py, fixtures, harness, tests). Line numbers are file lines at 92b8bc2. Controller rulings B1, B2 and the accepted deviations (R3 Otsu over non-paper pixels, chroma < 60) are applied and not flagged.

## Verdicts

- **Spec:** ❌ Issues found. The code meets the Task 16 interface and tests and rulings R2–R6. Two problems remain: the HDB recall target holds only against a traced truth that has errors, and several design changes go beyond R2–R6 without a ruling.
- **Quality:** Needs fixes. The fix is to the HDB traced-truth fixture; the code itself has only Minor findings.
- **Truth verification:**
  - **Brochure: verified.** All 27 walls are within ±1.5 px. No walls are missing and none of the walls is a non-wall.
  - **HDB: errors found.** 2 walls are missing, I14 is 5 px off, and there are 4 small node errors. With the corrections, HDB recall is **0.844 < 0.85**.

### Spec compliance

- ✅ **Task 16 interface.**
  - `WallExtraction`, `extract_walls(page, pre, segments, dimension_lines, ctx)` (plus keyword-only `ink`/`tokens`), `walls_to_graph(ext, region)` (r = max(t_median, 0.006 L), θ0 passed through, gaps = `graph.gaps`) and `debug_walls_png` (walls.py:1325, 1439, 1465).
  - All 7 brief tests are present with the brief's values (test_segments_walls.py: filled/double/single/gap/dimension/off-axis/vector).
  - I12 is enforced by the import test.
- ✅ **R2.** `_bold_mask` (walls.py:347): non-thin, ≥ 0.04 L, ≤ 50 % in `thick`, butt quads of the stroke width, `filled`, raster only. The test discriminates (`BOLD_MIN_LEN_FRAC` patched gives no walls).
- ✅ **R3.** `dark_threshold` / `dark_mask` (binarize.py:83, 96; wired at :178). The coloured-hatch test is present (accepted deviations not flagged).
- ✅ **R4.**
  - `detect_plan_region` takes thick ∪ bold (region.py; preprocess wiring binarize.py:192).
  - HDB region: `Rect(118,81,1709,1473)`, the whole plan.
  - Brochure: the site strip and key plan are excluded. The key plan is at the bottom of the sheet, not top-right as the brief says. No wall midpoint lies in the bottom 25 %.
- ✅ **R5.** Search cap = 6 × max(1, resample_factor) (binarize.py:181), documented and tested (`test_t_thin_survives_upscaling`, with the downscale case).
- ✅ **R6.**
  - `ink_notext` is used for pairing, the strip test, the extension probe and the face check.
  - Text components are dropped from `thick` (`_drop_text`, walls.py:273).
  - Pair limits are ≥ 0.03 L, ≤ 2° and [1.5 t_thin, 0.02 L].
  - Extension lines are handled by `_is_extension` (walls.py:216), with 7 parametrized cases plus a discriminating pair test.
- ✅ **Acceptance 3/4.** Synthetic suite green (implementer-reported). The chain takes 0.92 s (HDB) and 0.43 s (brochure) in my run.
- ❌ **Acceptance 1 (HDB recall ≥ 0.85, on the B1 traced truth).** Met only because of truth errors (see Truth verification). With the HDB truth corrected, the same 92b8bc2 graph scores **R 0.844 / P 0.897**.
- ❌ **Brief rule "if a target is unreachable without a design change beyond R2–R6, stop".** The following design changes go beyond R2–R6. They are reported for spec 19, but the controller has not ratified them (B1/B2 list only R3/chroma):
  - the ink-link grouping in `detect_plan_region` (region.py:40, changes 06 §7.6 step 7);
  - `_solid_envelope` gating of double-line pairs (walls.py:556);
  - `_wall_face_dims` re-admitting "dimension lines" that pair as faces (walls.py:164; progress line 119 acknowledges it, pending 14b);
  - "one pair per stretch on either side" instead of 06 §8.1 step 3 "once per side" (walls.py:373/571);
  - the interior `_join` (walls.py:979);
  - `segments._trim_to_stroke` (segments.py:411).
- ⚠️ **Cannot verify from diff.**
  - "Commit … and push": the commits exist, but I did not check the remote.
  - Task 31 must pass `ink=ocr.ink_notext, tokens=ocr.tokens` (carry).

### Strengths

- Tests are discriminating throughout. Nearly every new rule has a "with the rule off it fails" twin, for example `test_bold_outline_strokes_are_filled_walls`, `test_wall_face_taken_for_a_dimension_line_stays_a_wall`, `test_jog_between_column_and_wall_stays_connected` and `test_text_blob_is_not_a_filled_wall`. The implementer also documents a mutation pass.
- The pixel-graph tracer (`_trace`) is careful: sorted flat indices, no full-image index arrays, throttled deadline polling and a large-page perf guard.
- The `dedupe_raw_walls` design is canonical, order-independent and merges openings.
- The reference harness is clean: OCR replay rebuilds `ink_notext` exactly as `run_ocr` does, and a scorer self-test checks identity, near shift and far shift.
- The report is candid: blockers, the P2-truth ceiling (0.364/0.369) and residual misses are listed with ids.
- **Metrics reproduced exactly** on an exported copy of 92b8bc2 (the working tree was not touched): `pytest -q -m reference` gives 7 passed, 3 xfailed, 714 deselected in 3.7 s.

  | Image | Traced truth R / P | P2 truth R / P | Graph |
  |---|---|---|---|
  | HDB | 0.868 / 0.893 | 0.331 / 0.347 | 55 walls, 67 nodes, 6 gaps, 36 free ends, 0 faces |
  | Brochure | 0.908 / 0.856 | 0.459 / 0.476 | 47 walls, 49 nodes, 0 gaps, 18 free ends, 2 faces |

  All of these match task-16b-report.md §5.

## Issues

### Critical

None.

### Important

1. **The HDB traced truth omits two walls and misplaces I14. Corrected, HDB recall drops to 0.844, below the 0.85 target.** `vision/tests/fixtures/reference/hdb-3room.drawing-walls.json`:
   - **Missing: toilet 3's top wall.** It runs at y ≈ 177 from V6t (x 980) to the right exterior wall (x 1115), with faint faces at y 172/182, a window over x ≈ 995–1076 and a black pier at x 1077–1105, y 171–190.
     - Without it, toilet 3 and the bay inside X2/X3/X4 form one room, which also matters for Task 16c faces.
     - Evidence: `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/rv16/out/hdb-tr.png`.
   - **Missing: the store/kitchen wall Q→U.** It runs at x ≈ 299, y 364–480. It is a double line with faces at 294/303 at y 368–380 and 295.5/304 at y 462–476, and a bi-fold door at about y 384–458. The truth spans doors everywhere else.
     - Evidence: `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/rv16/out/hdb-store.png`.
   - **Misplaced: I14** (H4l–H4r, fixture lines 33–34, 74) is traced at y 355, on the top face. The faces are at 355.5 and 365, so the centre is ≈ 360. The 5 px error exceeds the interior tolerance (0.5 t ≈ 4.96 source px), so a correct extraction cannot score.
   - **Fix:** add the two walls, set H4l/H4r to y 360 and V6t to y 178 (see Minor 7). Then re-baseline the HDB recall test.
     - Measured with exactly these corrections against the 92b8bc2 graph: **R 0.844 / P 0.897**.
     - The new walls are mostly unextracted: T3top 68 % missed, QU 92 % missed, I14 still 89 % missed at 360.
     - So HDB recall misses the brief target on a faithful truth. The controller should either accept ≈ 0.84 or fold it into 16c.
2. **Design changes beyond R2–R6 were adopted without a ruling, against the brief's stop rule.** This covers the six items in the Spec Compliance ❌ above.
   - Each changes 06 behaviour: §7.6 step 7 region grouping, and §8.1 step 3 pairing semantics and envelope gate.
   - Each carries a named risk:
     - the envelope drops double-line walls outside the solid hull, such as a bay or projection drawn without solid pieces (walls.py:556, `ENVELOPE_GROW_FRAC` 0.01 L);
     - the ink link merges a bold title block or frame that touches the plan's ink (region.py:40).
   - All are logged in the report; they need explicit ratification and spec-19 entries, or reversal.

### Minor

1. **`ink=None` falls back to raw ink.** In `extract_walls`, `ink=None` silently uses raw ink (walls.py:1332, 1346), and text-blob dropping is skipped. R6 says "never raw ink". Make `ink` and `tokens` required keyword arguments so Task 31 cannot omit them.
2. **`_wall_face_dims` re-admits real dimension lines** (walls.py:164). Any genuine dimension line within 0.02 L of a parallel thin line with a hollow strip comes back as a wall candidate. Either-side claims and the envelope mitigate this, and the root cause is Task 14b. Re-check after 14b and remove the guard if it is unneeded.
3. **`region._groups` is O(n²) with no deadline poll** (region.py:12, 17–38). With `MAX_COMPONENTS` = 2000 it builds several 2000 × 2000 int64 temporaries (~32 MB each), then runs a Python union loop over all close pairs. Lower the cap or use a sweep on sorted boxes.
4. **`_trim_to_stroke` cuts only the ends** (segments.py:411). It keeps everything from the first to the last supported sample, so a wide LSD segment spanning wall–window–wall is not split. The docstring promises more than that.
5. **`test_metrics_score_a_perfect_extraction` re-runs the full chain** (test_reference_walls.py:103–108) where `load_page` (or the module fixture) would do.
6. **`walls.py` is a new 1,489-line file.** It is sectioned, but candidate/pairing (≈ 450 lines) could be its own module before 16c grows it further.
7. **Small HDB truth node errors.** These are beyond ±2 px but within the exterior tolerance:
   - V6t at y 182, while the wall centre is ≈ 178 (I12 / I13, up to 4 px);
   - B at y 177, while the stroke is at ≈ 174 (X1e is 3.1 px off at x 920);
   - P at y 930, while the stroke is at ≈ 927 (L2, 2.75 px);
   - X6 tracks the lower face (3–5 px from the 800/808 face-pair centre).
8. **HDB convention inconsistencies.**
   - Through the black blocks at x 428–575, X7/X8/B2 follow the bold outer stroke (y 805 / 918) while the source note says "black walls: block centre" (796 / 912).
   - X9 (x 150) splits the drawn jog: bold at 155 above and 145.5 below, block centre 147.
   - The black stub at x 428–505, y ≈ 912 (left of M) and the column at x 558–575, y 921–945 are not in the truth.
   - None of these changes the score materially (the exterior tolerance is 9.9 source px).

## Truth verification (method and results)

**Method.** Scripts are under `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/rv16/` (`prof.py`, `crop.py`, `overlay.py`, `metrics.py`).

- Perpendicular grey profiles at 20/35/50/65/80 % of every truth wall, with sub-pixel sampling at 0.5 px steps:
  - HDB: thresholds 170 and 205;
  - brochure: threshold 140, plus raw grey dumps.
- Gridded 3–5× crops with the truth drawn over them (`rv16/out/*.png`), and full overlays (`rv16/out/hdb-3room-truth.png`, `rv16/out/brochure-2bhk-truth.png`).
- Metrics recomputed on an exported 92b8bc2 copy with the existing venv.

**HDB: 37 of 37 walls profiled.**

- **29 are within ±2 px** of the stroke or stroke-pair centre:
  - exterior: X1, X1b, X1c, X1d, X2, X3, X4 (block centre 1114.3), X4b (outer bold + inner face midpoint ≈ 1114), X5, X8, B1, B3 (three-line stack centre ≈ 833), L1 (bold + inner line midpoint ≈ 887);
  - interior: I1, I2, I2b, I3, I4, I5, I6, I7, I8, I9, I9b, I10, I11, I13, I13b, I15 (all double-line partitions, faces ≈ 9 px apart, midpoints within 0.9 px);
  - X7 is borderline at about 1.5–2.5 px from the slider frame centre.
- **Out of ±2:**
  - I14 (5 px, Important);
  - I12/I13 at V6t (≈ 4 px);
  - X1e near B (3.1 px);
  - L2 near P (2.75 px);
  - X6 (3–5 px);
  - X9 and X7/X8/B2 at the black blocks (convention).
- **Missing walls:** toilet 3's top wall, Q→U, and the minor black stub.
- **Non-walls in the truth:** none.
  - The "1900", "1200", "3100", "3600", "3200" and "3500" interior dimension lines, the kitchen counter line (x 205), and the dashed AC-ledge lines are all correctly absent.
  - B3 is a three-line frame between the balcony and the 600 mm recess, plausibly a wall with an opening.

**Brochure: 27 of 27 walls profiled.**

- All are within ±1.5 px of the grey stroke centre.
- W26 (deck/living) was checked at its two stubs: centre 117.5 against the truth's 116.5. Its middle is the deck slider (spanned).
- W24 and W25 are 4–5 px interior walls, the same rendering on both.
- **Missing walls:** none. The light-grey stub at x 248–266, y 311 (right of b16) is a lighter fill than the walls, so it is probably a parapet; ambiguous and not counted.
- **Non-walls in the truth:** none. The OTS dashed outlines, the W/M box, furniture and the corridor railing are correctly absent.

## Assessment

**Task quality:** Needs fixes.

**Reasoning:**
- The R2–R6 implementation is sound and well tested, and the reported metrics reproduce exactly.
- The B1 acceptance truth for HDB is not yet trustworthy: two walls are missing and one is misplaced beyond tolerance. Corrected, HDB recall is 0.844, below the 0.85 target.
- Six design changes beyond R2–R6 still need a controller ruling.
