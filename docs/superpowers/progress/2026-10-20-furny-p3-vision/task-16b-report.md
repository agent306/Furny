# Task 16b report: reference-image hardening of preprocess, plan region and wall extraction

**Status: NEEDS_CONTEXT.** Rulings R2–R6 are implemented and tested, and the full suite is green. Two acceptance targets cannot be met as specified:

1. **The P2 truth (blocker).** The brief's recall/precision targets are measured against the P2 engine fixture geometry. That geometry is a *simplified recreation* of each drawing, not a transcription.
   - A *perfect* drawing-faithful extraction scores only **0.364 / 0.369** on HDB and **0.555 / 0.593** on the brochure against it.
   - The HDB photo is also ~4 % anisotropic, so the mandated similarity registration leaves residuals of up to 23 px. That is more than the 0.5 t tolerance (15.5 px exterior, 7.7 px interior).
2. **HDB outline closure and faces.** These need opening/gap rules beyond R2–R6 (details below).

Against a truth traced from the images themselves, the brief's recall/precision targets are met on both images: HDB **0.868 / 0.893**, brochure **0.908 / 0.856**. The proposed rulings are in the last section.

Commits (pushed to `origin/build/p3-vision`):
- `5cd2edf fix(vision): trim wide segments back to their stroke`
- `f85eb36 fix(vision): adaptive dark mask, upscale-robust t_thin and plan region by bold strokes`
- `15aad7e fix(vision): bold strokes as walls, text and dimension junk out of wall masks`
- `92b8bc2 test(vision): reference-image wall harness with registered truths`

---

## 1. Blockers and proposed rulings

### B1: the P2 fixture truth cannot be reached (recall/precision targets 1 and 2)

I transcribed `vision/tests/fixtures/reference/{hdb-3room,brochure-2bhk}.walls.json` mechanically from the committed P2 JSON fixtures. The C8 ruling is already applied there: N13/N20 at x = 7773, the brochure's y = 3530 row at 3525, and A7–A6 at 230. I registered them as the brief asks: a least-squares similarity on the four outer corners. The corner landmarks were measured by hand on the source image with ink profiles, then mapped through `page.transform`; the JSON's `registration.method` documents how.

Overlay evidence: `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/t16b/hdb-3room-truth-overlay.png` (P2 truth on the HDB source image). Also see the `*-final-walls-02-walls.png` files listed in §5.

**HDB.** The drawing's own top dimension chain is 1600 / 1300 / 2500 / 1200 / 600 / 1300 / 2000, which puts walls at about 0, 1600, 2900, 5400, 5600, 6800, 7400, 8700 and 10700 mm. The P2 fixture has 0, 1600, 2900, 4700, 5900, 8300, 9700 and 11000. The differences:
- Bedroom 1's right wall (the black wall) is ~800 mm off.
- Toilet 2 sits at 4700–5900 in the fixture; the drawing has it at about 5600–7000.
- The 8300 "Dress" wall does not exist in the drawing.
- The toilet-3 bump starts at about 9000, not 9700.
- The balcony is 1300 deep, not 900.
- The AC ledge is missing from the fixture.

**HDB registration.** The photo's scale is 0.0884 px/mm across and 0.0846 px/mm down. A similarity leaves corner residuals of 22.9 / 11.2 / 7.3 / 20.6 normalized px, against tolerances of 15.5 px (exterior) and 7.7 px (interior).

**Brochure.** In the fixture, the toilet and kitchen are flush with bedroom 1's left wall (the drawing has them ~21 px inside), W/M sits beside the toilet (in the drawing it is inside the kitchen), and the deck top is flush with the bedrooms (the drawing has it ~570 mm lower).

**Ceiling.** I scored the traced drawing walls (§2) as if they were the extraction, against the P2 truth: HDB recall 0.364 / precision 0.369, brochure 0.555 / 0.593. No extractor faithful to the image can reach 0.85 / 0.75.

**Proposed ruling B1:** use the image-traced truths committed as `*.drawing-walls.json` for the Task 16b recall/precision targets. Keep the P2 fixtures for topology and room naming only. Their tests are committed as strict xfails, so they flip if the truth is ever replaced:
- `test_p2_truth_recall_and_precision[hdb-3room]`
- `test_p2_truth_recall_and_precision[brochure-2bhk]`

The traced truth needs no similarity: it is in source pixels and goes through `page.transform`. Thickness comes from wall kind as in P2 (exterior 230, interior 115 mm), using each drawing's mean mm/px (HDB 11.6, brochure 34.3). The tolerance definition (0.5 t) is therefore unchanged. Task 34's `*.expected.json` (P2 ruling "derived from the P2 JSON") has the same problem and should be decided at the same time.

### B2: HDB outer outline closure and rooms as faces (target 1, closure part)

Current HDB graph: 55 walls, 67 nodes, 36 free ends, **0 bounded faces**. The brochure has 2 faces and 7 free ends on the outline (closure is not a brochure target). The outline breaks are:

1. **Windows between pieces drawn in different styles.**
   - The left wall has a window between a black column block (~25 px) and the bold line continuing below. That line also jogs ~13 px, because the photo draws the inner face above and the outer face below.
   - Gap candidates need collinear pieces of similar thickness (ratio ≤ 1.5), so the run ends.
2. **Wide openings.** The living-room window (~180 px), the balcony slider (~390 px) and the bedroom-3 window sit in walls whose extracted thickness is the *stroke* width (R2: ≈ 7.6 px). The 18 t gap limit is therefore ~137 px, and these breaks are not bridged.
3. **Two bold corner pieces are not extracted.**
   - The bottom-left corner's bold line (x 146–240 src).
   - The top-right corner (x 1122, y 115–182).
4. Junctions where a partition stops one thickness short of a face. Partly fixed (see the interior join below).

An experiment with the similar-thickness test off and 40 t instead of 18 t gave 0 faces and 42 free ends. The breaks are not just the step 8 limits.

**Proposed ruling B2:** defer closure to Task 17 (openings) or a 16c. For R2 bold-stroke walls, step 8's gap rule would measure gaps against a thickness from the drawing's double-line / filled walls (t_median), not the stroke width, and bridge a gap of a different-thickness pair when thin parallel line work (window frame lines) runs along the gap's centre line. Alternatively, accept "closure measured on the traced truth's outline only". I did not adopt either: both change 06 §8.1 step 8 beyond R2–R6. The closure test is committed as a strict xfail: `test_hdb_outline_is_closed_and_rooms_are_faces`.

---

## 2. Harness and truths (`vision/tests/support/reference.py`)

- **Chain.** `run_chain(stem)` runs decode → `normalize` → `preprocess` → OCR → `detect_segments` → `find_dimension_lines(ink=ink_notext)` → `extract_walls(ink=ink_notext, tokens=…)` → `walls_to_graph`, with per-stage seconds.
- **OCR replay.** Real RapidOCR takes ~10 s per image, so `record_ocr(stem)` recorded `<stem>.ocr.json` once, from the real engine over the whole normalized page. `replay_ocr` keeps the tokens centred in the plan region, renumbers them like `_sorted_tokens`, and rebuilds the text mask and `ink_notext` exactly like `run_ocr`.
- **Truths.**
  - `<stem>.walls.json`: P2 geometry (mm) plus the four corner landmarks (source px, with a method note), registered by a similarity on the corners.
  - `<stem>.drawing-walls.json`: traced centre lines in source px. Each HDB wall was checked with perpendicular ink profiles at 20/50/80 % of its length. That check caught six tracing errors of 4–9 px, now fixed (the "3300" wall at y 480, the toilet bottoms at 364, toilet 2's right wall at 765, the tilted top wall).
- **Metrics** (`wall_metrics`), sampled every pixel:
  - recall = the share of truth length within 0.5 t of an extracted centre line, with t that truth wall's thickness;
  - precision = the share of extracted length within 0.5 t of some truth wall.
  - `test_metrics_score_a_perfect_extraction` checks the scorer itself: identity gives 1/1, a shift of 0.45 t_min keeps recall at 1, and a far shift gives 0/0.
- **Closure.** `bounded_faces` uses shapely `polygonize` on the noded graph edges. `outer_cycle_free_ends` counts free wall ends on the boundary of the union of faces.
- **Debug.** `debug_png` draws the walls debug image plus the truth (green bands = tolerance), the region (magenta) and the dimension lines.

## 3. What was implemented, ruling by ruling

### R3: adaptive dark mask (`binarize.py`)

- `dark_threshold(V)` is Otsu over the V channel of the **non-paper pixels (V < 245)**, clamped to [90, 170]. `dark_mask(hsv)` is `V ≤ t` (Otsu's dark class) and achromatic.
- **Deviation 1:** the population is non-paper V, not "ink pixels". Sauvola hollows the brochure's 26 px grey walls, so their cores (V 104–122) are mostly not ink. The ink's V histogram is split between black strokes (text, navy outlines) and grey strokes, and Otsu over it lands at 113, cutting through the wall cores. Non-paper Otsu gives 160 on the brochure and 110 on HDB (HDB's `thick` comes from ink, so only the classification sees its dark mask).
- **Deviation 2:** the achromatic test is chroma (S·V/255 = max − min) < 60 instead of 06 §7.6's S < 60. The two agree at V = 255. HSV saturation blows up for dark pixels: the brochure's navy outlines read S 64–121 at V 40–90, though their chroma is 15–28.
- Tests:
  - grey walls (V 130) are dark, fills are not;
  - the clamp at 90 and 170, and paper only;
  - a red and a dark-blue hatch (chroma ≥ 120) are never dark, while a navy band (S > 60, chroma 19) is.

### R5: t_thin under upscaling

- **Approach:** the mode of skeleton-sampled stroke widths (unchanged), with the 6 px search range in *source* pixels. That is, `6 × max(1, resample_factor)`; the bins stay 0.5 px.
- **Finding for the record:** the brochure's 5.75 is not inflated. The distance-transform widths are quantised (1.91, 3.82, 5.73, 7.64 …), and the brochure's thin line work peaks at 5.73 normalized px, which is 1.55 source px. The T16 symptom ("grey walls count as thin lines") came from Sauvola splitting the grey walls into two border bands, and R3 fixes that. Both reference images keep their t_thin (3.75 / 5.75).
- The actual upscaling fragility: a 2 px source line upscaled 3.7× becomes ~12 px of ink (cubic blur plus Sauvola). The fixed 6 px range cut it off and reported 3.75 (debris). The scaled range reports 11.25.
- Test: `test_t_thin_survives_upscaling`.

### R4: plan region (`region.py`, `binarize.bold_strokes`)

- `bold_strokes(ink, t_thin, min_len)` opens the ink with an `odd(1.8 t_thin)` square and keeps components whose bbox is ≥ 0.04 × the long edge. `preprocess` passes it as `detect_plan_region(…, bold=…)`.
- Wall pixels are thick ∪ bold, closed with a 0.02 L square. Components belong to one drawing (transitively, by union-find) when their bounding boxes are ≤ 0.05 L apart, **or** when one ink component touches both. The ink link uses the ink closed with a 0.005 L square.
  - **Deviation:** the ink link is my addition. The brochure flat is cut into 7 pieces by its windows, the open living room and the deck (gaps 104–219 px > 0.05 L = 100). The site strip across the 5-ft corridor is 157 px away and holds more dark pixels than either half (trees). Proximity alone cannot separate them; window frames, door leaves and railings join the plan's pieces, and the corridor shares no ink with the plan.
- Main plan = the drawing with the most wall pixels. `plan_region_ambiguous` counts the main plan plus every other drawing with ≥ 30 % of its pixels.
- Results:
  - HDB: the region is `Rect(118, 81, 1709, 1473)`, the whole plan (it was one 129 × 530 black column).
  - Brochure: the region is `Rect(131, 150, 1212, 1082)`, the flat. The strip, the key plan (which is at the bottom, not top-right) and the "FLAT-105-505" label are excluded, and no wall has its midpoint in the bottom 25 % (06 §16.3).
- Tests:
  - a bold-outline plan with two columns: the region covers the outline, and the plain 06 rule gives one column;
  - pieces linked by window frame lines with an unlinked bigger drawing below: the drawing below is excluded with the warning, and without the frame lines it wins.

### R2: bold strokes are solid walls (`walls._bold_mask`)

- Segments that are not thin (width > 1.8 t_thin), ≥ 0.04 L long and at most half inside `thick` are drawn as butt-ended quads of their stroke width into the filled layer (source `filled`). Raster pages only; vector pages keep their own rule.
- Tests:
  - the brief's plan drawn with 7 px strokes and t_thin 3.75 gives 7 walls / 6 nodes / no free ends, filled, thickness 7.6 ± 1.5;
  - with the rule off (constant patched) there are no walls;
  - a 60 px bold stroke (< 0.04 L) is not a wall.

### R6: text and junk are never walls

- **Text-free ink.** `extract_walls(…, *, ink=None, tokens=())` takes `ocr.ink_notext` (pairing strip test, extension probe and wall-face check) and the tokens.
- **Text in thick.** `thick` components with > 50 % of their pixels in text boxes (`pre.ink & ~ink_notext`) are dropped (`_drop_text`). A wall a label overlaps is kept. Test: a bold blob under a label is not a wall, and without the label it is.
- **Pair limits.** Double-line pairs need both lines ≥ 0.03 L, angle ≤ 2°, and d ∈ [1.5 t_thin, 0.02 L]. `test_double_line_pair_limits` was updated to the new limits: each new case pairs under the old 0.004 L / 0.03 L / 0.02 L constants and not now, or the reverse.
- **Extension lines** (`_is_extension`) are excluded with their dimension line when they:
  - are perpendicular to it (±10°);
  - meet it within 2 t_thin of a tick;
  - have one end there (within 3 t_thin);
  - overshoot it **in the ink** by t_thin–3 t_thin past its far edge.
  The ink is probed because LSD cuts the overshoot stub off at the crossing. Tests: an 8-case parametrized unit test, including LSD-cut and kept stubs, a T junction stopping at the line, too short or long a stub, a line passing through, off-tick and off-perpendicular; plus an integration test where two extension lines 12 px apart pair without the rule and not with it.
- The blue boxes in the HDB debug image (text, dimension and extension-line pairs) are gone; compare the T16 PNG with the final one.

### Guards found on the reference images (deviations, for spec 19)

1. **Wall faces misdetected as dimension lines** (`_wall_face_dims`). On HDB, `find_dimension_lines` (Task 14) returns 32 lines. Almost all are false: 7 are extension lines above the plan, and about 15 are partition faces whose perpendicular partitions read as ticks, with a size label beside them. Excluding them, and their "extension lines", deleted the toilet and bedroom partitions. `dimensions.py` is outside this task's files, so the walls stage now trusts a dimension line only if its segment does **not** pair as a double-line wall face:
   - with a non-dimension thin line (same pair rules and strip test); or
   - with another dimension line closer than the median numeric text height (stacked chains keep their labels between them, faces do not; on HDB the text height is 38 px > 0.02 L, so this sub-rule never limits there).
   - Test: a double-line partition face passed in as a dimension line stays a wall (topology 7/6); with the guard off, < 7 walls.
2. **One pair per stretch on either side**, not "once per side" (06 §8.1 step 3). Otherwise a face pairs on one side with its partner and on the other with a dimension line or counter edge, and the union becomes a thick block whose centre shifts ~8 src px (HDB "3100"/"3600"/"3200" lines). A face bounds one wall. Test: lines A, B (14 px below) and C (20 px above) give one wall centred on A–B. The old rule centred it at 596.5 instead of 607. The existing once-per-side test still passes.
3. **Solid-outline envelope** (`_solid_envelope`). When the convex hull of filled ∪ bold walls covers ≥ 50 % of the region, a double-line pair needs ≥ 50 % of its centre line inside that hull grown by 0.01 L. This removes pairs of extension lines and stacked chains in the margins, most of which `find_dimension_lines` never detected. Test: a pair outside a filled room is dropped, one inside is kept, and in a pure double-line drawing (no solid walls) both are kept.
4. **Interior join** (`_join`, restoring T16's removed `_join` with a triggering case). A short off-axis kink dropped *between* two kept pieces of a traced path (a column block whose wall continues 10 px off its centre) disconnected the path. Pieces on different axes are now extended to their crossing, and parallel ones are joined by a connector piece. HDB free ends went from 46 to 36. Test: a column and an offset wall give no free ends; with `_join` stubbed out, free ends > 0.
5. **Wide segments trimmed to their stroke** (`segments._trim_to_stroke`, minimal `segments.py` change). This was exposed by R4: the old region excluded half of `test_window_centre_line_is_not_swallowed_by_the_wall`'s wall, so the test only checked the other half. A wall's LSD edge continuing along a window's face line was snapped as one thick segment spanning the window (x 192–907 over a cut at 800–950). Non-thin segments now end where 2·dt < 0.5 × width. Test: `test_wide_segment_is_trimmed_to_its_stroke`, plus the window test now covers both halves.

Also fixed in my own change: `_filled_mask` must copy `pre.thick` before filling Sauvola holes in place. Caught by `test_wide_filled_wall_hollowed_by_sauvola_stays_filled`.

## 4. Metric history

R / P = recall / precision. "Traced" is `*.drawing-walls.json` (the first traced version had 6 tracing errors, corrected in step 8). HDB faces stayed at 0 throughout. Times are for the full chain with OCR replay; walls alone take ≤ 0.16 s.

| # | Change | HDB P2 R / P | HDB traced R / P | HDB free ends | Brochure P2 R / P | Brochure traced R / P |
|---|---|---|---|---|---|---|
| 0 | baseline 45c2096 (region = one column / whole page) | 0.003 / 0.055 | 0.059 / 1.000 | 2 | 0.222 / 0.154 | 0.489 / 0.330 |
| 1 | R3 + R5 + R4 (main by extent) | 0.182 / 0.381 | – | 37 | 0 / 0 (region = site strip) | – |
| 2 | R4 grouping by proximity + ink link | 0.182 / 0.381 | – | 37 | 0.484 / 0.419 | – |
| 3 | R2 bold strokes + R6 (limits, text-free ink, text drop, extension lines v1) | 0.310 / 0.460 | – | 42 | 0.473 / 0.465 | – |
| 4 | wall-face dimension guard | 0.321 / 0.347 | 0.705 / 0.751 (first trace) | 44 | 0.473 / 0.465 | 0.868 / 0.789 |
| 5 | pair once per stretch (either side) + solid envelope + text-height dim pairs | 0.314 / 0.350 | 0.768 / 0.834 (first trace) | 43 | 0.465 / 0.485 | 0.898 / 0.854 |
| 6 | traced truth corrected by profiles | 0.314 / 0.350 | 0.815 / 0.887 | 43 | 0.465 / 0.485 | 0.898 / 0.854 |
| 7 | extension lines need an overshoot | 0.333 / 0.348 | 0.869 / 0.893 | 46 | 0.465 / 0.485 | 0.898 / 0.854 |
| 8 | interior join | 0.331 / 0.347 | 0.870 / 0.893 | 36 | 0.465 / 0.485 | 0.898 / 0.854 |
| 9 | segment trim, `V ≤ t`, ink-probe overshoot (final) | **0.331 / 0.347** | **0.868 / 0.893** | 36 | **0.459 / 0.476** | **0.908 / 0.856** |
| – | ceiling: perfect drawing-faithful extraction vs P2 | 0.364 / 0.369 | 1 / 1 | – | 0.555 / 0.593 | 1 / 1 |

## 5. Final state per image

**HDB:**
- normalize 2000 × 1662 (f = 1.54); t_thin 3.75; kind `architectural_line_drawing`; region `Rect(118, 81, 1709, 1473)`; 45 tokens; 403 segments; 32 "dimension lines".
- Raw walls: 51 (30 filled, 21 double), t_median 14.
- Graph: 55 walls, 67 nodes, 6 gaps, 36 free ends, **0 faces**, no outer cycle.
- Traced truth: **R 0.868, P 0.893** (targets 0.85 / 0.85 met).
- P2 truth: R 0.331, P 0.347; similarity residuals 22.9 / 11.2 / 7.3 / 20.6 px.
- Chain 0.80 s.

**Brochure:**
- normalize 1411 × 2000 (f = 3.70); t_thin 5.75; kind `colored_brochure`; region `Rect(131, 150, 1212, 1082)`; 20 tokens; 1055 segments; 0 dimension lines.
- Raw walls: 45 (29 filled, 16 double), t_median 28.
- Graph: 47 walls, 49 nodes, 0 gaps, 18 free ends, 2 faces.
- Traced truth: **R 0.908, P 0.856** (targets 0.75 / 0.75 met). Key plan and site strip excluded.
- P2 truth: R 0.459, P 0.476; residuals 10.4 / 9.0 / 7.3 / 5.4 px.
- Chain 0.44 s.

**Performance:** the full chain (with OCR replay) takes 0.8 s and 0.44 s. Real OCR would add ~10 s per image, which is why it is replayed.

**Final debug PNGs** (`/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/t16b/final/`):
- `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/t16b/final/hdb-3room-final-drawing-walls-02-walls.png` (walls + traced truth)
- `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/t16b/final/hdb-3room-final-walls-02-walls.png` (walls + registered P2 truth)
- `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/t16b/final/hdb-3room-graph.png` (graph: free ends red, openings yellow)
- `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/t16b/final/brochure-2bhk-final-drawing-walls-02-walls.png`
- `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/t16b/final/brochure-2bhk-final-walls-02-walls.png`
- `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/t16b/final/brochure-2bhk-graph.png`
- metrics dump: `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/t16b/final/metrics.txt`

## 6. Residual failures (traced truth)

HDB walls with ≥ 50 % missed:
- Toilet 3's left wall (I13, I12): a face pairs with the "3200" dimension line at 957 instead of the 985 face. The 985 face is broken by the toilet door frame.
- Toilet 3's bottom (I14): a short wall with a door; the pieces are too short.
- Toilet 2's bottom (I11).
- The bottom bedroom-3 window run (X6).

Brochure:
- The deck/bedroom-2 shared wall (W12, W13) and toilet 2's top (W8) are half-missed; their double lines merge with furniture.
- Precision losses come from furniture pairs (sofa, bed edges) inside rooms; R6 has no rule for furniture.

Bold corner pieces are missing on HDB (§1 B2.3).

## 7. Tests

`tests/test_reference_walls.py` (`@pytest.mark.reference`, registered in `pyproject.toml`, runs in the normal suite):
- chain < 10 s per image;
- the HDB region holds all four outline corners and is > 75 % of the page width;
- the brochure region holds the flat and ends above the strip, and no wall midpoint is in the bottom 25 %;
- traced-truth recall/precision per image;
- the scorer self-test;
- strict xfails: P2 truth per image and HDB closure.

New synthetic tests:

| File | Tests |
|---|---|
| `test_preprocess.py` | 7: grey walls dark; clamp; coloured hatch / navy; t_thin upscale; bold strokes; bold-outline region; ink-linked region |
| `test_segments_walls.py` | 16 cases: bold walls + discriminating; short bold; text blob; extension rule × 7; extension pair; wall-face dim + discriminating; one side; envelope; jog + discriminating. Plus updated pair limits (9 cases) |
| `test_segments.py` | 1: trim |

The `run` helper now passes `ink_notext` and the tokens, as the real chain does.

### TDD evidence

- **RED.** The new tests were run against the Task 16 code (`45c2096`) in a temporary worktree, with `run` reverted to the old `extract_walls` signature: `29 failed, 14 passed, 3 xfailed`. Behavioural failures, as expected because each rule is new:
  - `assert 596.5 == 607 ± 2` (one-side pairing);
  - `assert [609.5, 1549.5] == [610 ± 2]` (envelope);
  - `assert 2 == 0` free ends (join);
  - `assert 8 == 7` (text blob is a wall);
  - `assert 4 == 7` (wall-face dimension);
  - `assert 1 == 7` (bold outline, short bold);
  - extension pair still paired;
  - pair-limit cases 10 px / 48 px / 60 px still paired;
  - `assert 8.25 <= 1.5` (t_thin upscale);
  - region `(0 + 2000) < 1316` (strip / key plan included);
  - HDB traced recall 0.059, brochure 0.489 / 0.330.
  The rest fail with `AttributeError` for functions that did not exist (`dark_threshold`, `dark_mask`, `bold_strokes`, `_is_extension`). Full listing: `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/t16b/red.txt`.
- **GREEN.**
  - `uv run pytest -q tests/test_preprocess.py` → 21 passed
  - `uv run pytest -q tests/test_segments_walls.py` → 61 passed
  - `uv run pytest -q tests/test_reference_walls.py` → 7 passed, 3 xfailed
- **Full suite.** `uv run pytest -q` → **719 passed, 1 skipped, 3 xfailed in 87.7 s**, no warnings.
- **Intermediate commit.** At `f85eb36` (preprocess/region with the Task 16 `walls.py`): `test_segments.py`, `test_preprocess.py`, `test_segments_walls.py`, `test_ocr.py` and `test_dimensions.py` → 310 passed.
- **Gates.**
  - `uv run ruff check .` → All checks passed
  - `uv run ruff format --check .` → 72 files already formatted
  - `uv run mypy app` → no issues found in 45 source files

## 8. Files

- `vision/app/pipeline/binarize.py`: `dark_threshold`, `dark_mask`, scaled `_width_mode` / `stroke_width_mode(upscale)`, `bold_strokes`, `preprocess` wiring.
- `vision/app/pipeline/region.py`: grouping by proximity and ink links, the `bold` keyword.
- `vision/app/pipeline/segments.py`: `_trim_to_stroke` (minimal).
- `vision/app/pipeline/walls.py`: R2/R6 rules, guards, `_join`, and the `extract_walls(…, *, ink, tokens)` keywords.
- `vision/pyproject.toml`: the `reference` marker.
- `vision/tests/support/reference.py`: the harness.
- `vision/tests/test_reference_walls.py`: the reference tests.
- `vision/tests/test_preprocess.py`, `vision/tests/test_segments.py`, `vision/tests/test_segments_walls.py`.
- `vision/tests/fixtures/reference/{hdb-3room,brochure-2bhk}.{ocr,walls,drawing-walls}.json`.

## 9. Self-review and concerns

- **Interface (carry to Task 31).** `extract_walls` gained keyword-only `ink` and `tokens`. Task 31 must pass `ocr.ink_notext` and `ocr.tokens`; without them, text masking and the wall-face text-height rule are off.
- **`walls.py` size.** Now 1489 lines (from 1250). It stays one file per the plan, with sections for candidates / masks / tracing / snap / runs / API. Flagged.
- **Dimension misdetection is the root of several guards.** The wall-face guard and the overshoot extension test mitigate a Task 14 defect. On HDB, `find_dimension_lines` misses the real outer chains and returns partition faces and extension lines. That also hurts scale (Task 20) and should be fixed in `dimensions.py` (out of this task's files).
- **Envelope gate risk.** A double-line plan with solid columns spread across it (hull ≥ 50 % of the region) but exterior walls outside the columns' hull would lose those walls. The 0.01 L growth only partly covers this.
- **Region ink link risk.** A sheet frame or title block drawn bold and touching the plan's ink would join the plan's drawing. Neither reference image has one.
- **R3 side effect.** Non-paper Otsu raises `dark` on grey-paper photos. That only affects `colored_brochure` classification (which also needs colourfulness > 25), but it is not tested on a real photo.
- **Single-truth ceiling.** The traced truth is my own transcription. Each HDB wall was profile-checked, and brochure walls are centred within about ±1 px. It should get an independent look before it becomes the acceptance truth.
