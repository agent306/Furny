# Task 14b report: dimension-line detection on the reference images

**Status: NEEDS_CONTEXT.** The root cause is fixed in `dimensions.py` and committed (`d377052`, pushed). Every acceptance target is met except two, and both are blocked by stages outside 06 §8.4 and the fix2 design:

- HDB **recall 0.708** (target 0.80);
- **4 of the 5 outer overall lines** (11000, 7000, 7600 and 8900) are not matched.

| Target | Value | Met? |
|---|---|---|
| HDB recall | **0.708** (17 of 24) | No (blocked) |
| HDB precision | **0.944** (17 of 18) | Yes |
| Spans within 0.5 % L at both ends | **0.932** | Yes |
| Labels associated with the right span | **0.886** | Yes |
| Brochure detected lines | **0** | Yes |
| HDB walls R / P / free ends | 0.870 / 0.894 / 34 | Yes |
| Brochure walls R / P / free ends | 0.908 / 0.856 / 18 | Yes |
| Dimensions stage | 0.21 s and 0.00 s | Yes |
| Full chain | 0.94 s and 0.51 s | Yes |

**The blocker.** Seven traced lines cannot be found by any change to `dimensions.py`:

- Five lie outside the plan region (§1): 11000, 7000, 7600 (right), 8900 and the left 3300/2500/1000 chain. The region is the walls' bounding box grown by 6 % (06 §7.6 step 7), and the segment and OCR stages read nothing outside it.
- Two short interior lines (the 400 and the 600 at the top) have no segment at all. Their labels' text boxes cover them, and the text mask erases them before LSD runs.

So with the current region, at most 17 of the 24 traced lines can be found, and **17 are found**. On the 19 traced lines inside the region, recall is **17 / 19 = 0.895**.

The proposed rulings are in §8.

---

## 1. Diagnosis (written before the code change)

I measured `find_dimension_lines` (Task 14) on HDB against the traced truth (§2). It found 32 lines:

- recall: 0 of 24;
- precision: 1 of 32;
- every outer chain was missed.

Diagnostic scripts: `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/t14b/diag.py` and `frag.py`.

### Why the real lines are missed

1. **The lines arrive in pieces, and each piece is judged alone.**
   - LSD breaks a dimension line at every tick and crossing.
   - The text mask cuts it under each label written on or touching it.
   - On the photo the outer chains are faint (gray 175–235), so Sauvola ink and LSD break them further.

   Every traced line reaches `find_dimension_lines` as 2 to 16 pieces. No piece covers more than ~45 % of its line. Each piece holds at most one tick, and its label usually does not project onto it, so `labels.beside` fails. Example: the 3200 line in bedroom 1 is two pieces of 187 and 184 px, split by the gap under its own label "3200". Nothing in Task 14 joins pieces; 06 §7.9's collinear merge allows a 4 px gap.
2. **Ticks next to walls are lost.** A slash tick drawn into a black wall merges with the wall's component and is rejected as too thick. These are the end ticks of the 300, 1200 (toilet 2), 3100 and 3600 lines and of the 7600 | 3100 line.
3. **Faint lines have no line in the ink band.** With the line absent from the ink, the two extension lines at a partition, joined through their slashes, read as one thick blob. That blob is rejected as a wall.
4. **Outside the region** (the blocker above): there is no segment and no token, so nothing can be fixed in this stage.

### Why the false lines are accepted

1. **Perpendicular strokes of any length are ticks** (fix2 rule). That rule is symmetric:
   - an extension line is crossed by the chain it serves, so it gets ticks;
   - a partition face is met by perpendicular partitions;
   - a door jamb or another dimension line crossing a real line adds a false tick to it.
2. **Any numeric token within 2.5 text heights counts as the label.**
   - The orientation is not checked in step 1, so the horizontal top-chain labels sit "beside" the vertical extension lines.
   - The token is not tied to the line it labels, so a face line or extension line next to a real chain borrows that chain's label.
3. **Nothing rejects a wall face.** The walls stage's guard (`_wall_face_dims`) only kept faces out of the wall exclusion, after the fact.

## 2. HDB dimension truth: `vision/tests/fixtures/reference/hdb-3room.drawing-dims.json`

The truth has 24 lines in source px. For each line it records:

- `p0` and `p1`;
- the tick `u` positions, along `p0 → p1`;
- one label per interval, or `null` for an unlabelled wall-thickness interval;
- `points` for bowed lines;
- the profile checks.

### What was traced

**Outer lines:**

| Line | Ticks | Labels |
|---|---|---|
| Top chain | 12 | 1600 / – / 1300 / – / 2500 / – / 1200 / – / 600 / 1300 / 2000 |
| 11000 | 2 | 11000 |
| Left chain | 4 | 3300 / 2500 / 1000 |
| 7000 | 2 | 7000 |
| Right chain | 9 | 600 / 1700 / 400 / 3200 / 1500 / – / 400 / 900 |
| Right middle line | 3 | 7600 / 1300 |
| 8900 | 2 | 8900 |
| Bottom chain | 8 | 4100 / – / 3600 / – / 600 / 1800 / 800 |
| 11100 | 2 | 11100 |

**Interior lines (15):**
- 1000;
- 300;
- 600;
- 1900 / – / 1200 (kitchen–toilet 1, one line);
- 3200 (bedroom 1);
- 3100 (bedroom 1);
- 3600;
- 1900 (toilet 2);
- 1200 (toilet 2);
- 3200 (bedroom 2);
- 1800;
- 400 (the AC-ledge vertical, not in the brief's list but drawn);
- 1300;
- 3500;
- 7600 / – / 3100 (one line).

### How it was traced

- **Located:** on 6–8× gridded crops.
- **Centre lines:** a robust least-squares fit of the darkness-weighted ink centroid (gray < 235). The 600 line was measured by column profiles instead, because the fit is pulled by the faint face lines beside it.
- **Ends:** the ends of the dimension stroke itself.
- **Ticks:** each one verified on zoomed contact sheets. Lines that only cross a dimension line are not ticks.
- **Two chains split into two lines each.** The ink itself is interrupted:
  - 3100 | 3600 by the black wall;
  - 300 | 600 by a stretch that is only a faint face line, with the "300" text placed outside its interval.
- **Bowed lines.** The photograph bows the long lines by up to 2.2 src px. Those lines (top, 11000, left, 7000, bottom, 11100 and 7600 | 3100) carry a 5-point `points` polyline, and matching uses it.

### Profile check (recorded in the JSON)

- **Method:** a perpendicular profile at 20 / 50 / 80 % of each line. Each profile is the median of five profiles 1 px apart, ±3 px across. It was moved by up to 3 % to avoid a tick, crossing or label.
- **Result:** every |offset| from the traced centre (polyline where given) is ≤ **0.45 px**.
- `test_dimension_truth_is_traced_and_profile_checked` asserts this.

### Brochure

There are no dimension lines on it. None of its text parses as a dimension number (only size pairs and other text), so it gets no dimension truth. This matches your ruling.

### Overlays and tools

- **Overlays:**
  - `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/t14b/ov-a.png`
  - `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/t14b/ov-b.png`
  - `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/t14b/truth-overlay.png`
- **Tools:**
  - `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/t14b/tracer.py`
  - `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/t14b/compose.py`
  - `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/t14b/sheets.py`

### Metrics (`tests/support/reference.py`: `load_dim_truth`, `dim_metrics`, `chain_dim_metrics`)

- **Match.** A traced and a detected line match when:
  - they are parallel within 2°;
  - at least 80 % of the traced centre polyline lies within **4 normalized px** of the detected segment.

  This combines the brief's "within 4 px" and "overlap ≥ 80 %" rules. I read the 4 px as normalized px after `page.transform`; that is the stricter reading (4 source px would be 6.2).
- **Precision.** A detected line is true when at least 80 % of its own length lies within 4 px of the parallel traced lines (their union).
- **Intervals.** A traced interval of a matched line is found when a span of a matching detected line has both ends within 0.005 L of its two ticks. Unlabelled intervals count too.
- **Labels.** For each labelled interval, the label is the `mm_number` token with that value nearest the interval. It counts when `associate_dimension_texts` maps it to that span.
- **Scorer self-check.** `test_dimension_scorer_self_check`:
  - the truth, straightened, scores 1 / 1;
  - shifted by 3 px, it still matches;
  - shifted by 8 px, it scores 0 / 0.

## 3. The fix (`vision/app/pipeline/dimensions.py`)

Pages with ink go through `_raster_lines`. Pages without ink (vector pages) go through `_vector_lines`, which is Task 14 unchanged: `test_vector_path_output_is_unchanged` keeps its digest.

### Rules

1. **Chains of pieces** (`_candidate_lines`, `_joins`, `_Evidence`, `_fit_chain`). Two thin pieces join when:
   - they are drawn with the same pen: ink darkness within 1.6× (gray image);
   - they are parallel within 2°;
   - their facing ends lie within max(3 px, the wider stroke) of each other's line;
   - they overlap, or the gap between them is ≤ 0.06 L and ≥ 90 % of it is covered by one of:
     - ink (±2 px across);
     - gray darker than the paper beside it by ≥ 8 levels;
     - a text box (+3 px).

   No gap is crossed by a stroke wider than 2.5 w + 2 (a solid wall). Without ink or gray, gaps are ≤ 6 px.

   The chain is the least-squares line through its pieces. With a gray image, its ends run on (`_extend_ends`) where the line runs alone (paper 5–8 px beside it, same pen), or through a text box.
2. **Pieces drawn into the band** (`_draw_pieces`). For a chained or lengthened line, its pieces are drawn into the ink band before the components are found. A faint line is then whole again, so strokes crossing it split into halves at it.
3. **Tick kinds.** Each tick is one of:
   - `MARK`: a slash, arrowhead or dot, or a perpendicular stroke that widens by ≥ 3 px within max(4 px, 0.01 L) of the line (`_carries_mark`);
   - `BAR`;
   - `THROUGH`: perpendicular, reaching the band edge on both sides;
   - `WALL`: the face of a wall the line ends at (`_wall_face_at_end`, read 0.005–0.01 L away from the line so that a slash merged into the wall does not move it).

   `_styled_ticks`: a line with ≥ 1 mark and ≥ 2 mark-or-wall ticks drops its `THROUGH` ticks that carry no mark.
4. **Oriented labels.** A label must be written along the line (angle 0 for x lines, 90 for y lines) to count in step 1.
5. **Wall faces** (`_wall_faces`, `_pair`, `_strip_is_wall`, `_spoken_for`). This is moved from walls' `_wall_face_dims` and uses its pair rules:
   - both lines ≥ 0.03 L;
   - parallel within 2°;
   - d ∈ [1.5 t_thin, 0.02 L];
   - overlap ≥ 60 % of the shorter line;
   - the strip between them free of text centres and hollow (< 15 % ink) or filled (> 85 %).

   A candidate is a face when ≥ 60 % of its length pairs with lines (chains and bold strokes) that are not spoken for. A partner is spoken for when it pairs more closely with a third line over its facing stretch: this mirrors walls' "one pair per stretch". It is the rule that keeps 3500 (drawn 18 px beside the bedroom-3 partition). A partner that is itself a candidate counts only when the two are closer than the median text height (stacked chains).
6. **Label ownership** (`_Labels.owners`). Each label belongs to the nearest line it is beside on its baseline side: below horizontal text, right of text reading upwards. Only when there is none does it go to the other side. Ties within 3 px are shared (collinear copies). A line that owns no label is dropped.
7. **Crossing dimension lines** (`_drop_crossings`). An unmarked tick where another dimension line crosses or ends across the line is dropped.
8. **Duplicates.** The duplicate with the most marks wins, then the one with the most ticks, then the longest.

### API additions (keyword-only, defaults keep old callers working)

- `find_dimension_lines(..., gray=None, t_thin=None)`.
- The harness passes `gray=pre.gray, t_thin=pre.t_thin`.
- **Task 31 must pass the same two.**

### `walls.py`

`_wall_face_dims` loses its dimension-pair sub-rule (two dimension lines closer than a text height), which `find_dimension_lines` now applies. `_text_height` is removed.

The guard itself stays, because the wall metrics do not hold without it. With it removed:
- HDB recall falls to **0.867** (below 0.868): toilet 3's left wall I12 goes from 0.731 to 0.836 missed;
- HDB precision rises to 0.912.

It now only catches true dimension lines drawn beside a single face line (3200 bed 2, 3500, 7600 | 3100), so their segments stay wall candidates.

`extract_walls` keeps its keyword-only `tokens` for the interface, but no rule reads it now. This is documented in the docstring.

## 4. Deviations for spec 19

All of these apply to raster pages only:

1. **Step 1, candidates are chains of pieces** (rule 1), not single segments. The evidence is ink, the gray image or a text box. This needs the new `gray` input.
2. **Step 1, orientation.** The label must match the line's orientation: step 3's rule, applied in step 1.
3. **Step 1, label ownership** by nearest line on the baseline side. A drafting convention: text stands on its dimension line.
4. **Step 1, wall-face rejection.** These are the walls stage's pair rules, with "one pair per stretch" and the ≥ 60 %-of-length condition.
5. **Ticks.** On a line with terminator marks, a perpendicular stroke running through the line with no mark is no tick. This narrows the fix2 rule "perpendicular = tick, whatever its length", which still holds on bar-only lines (`test_perpendicular_stroke_of_any_length_is_a_tick`).
6. **Ticks: the face of a solid wall the line ends at is a tick.** 06 counts touching extension lines; a wall face plays that role. A wall the line runs through is still no tick.
7. **Ticks: no unmarked tick where another dimension line crosses.**
8. **Band: the line's own pieces are drawn into the ink band** for chained or lengthened lines.

## 5. Metric history (HDB; walls unchanged unless noted)

| # | Change | Lines | R | P | Intervals | Labels |
|---|---|---|---|---|---|---|
| 0 | Baseline `92b8bc2` | 32 | 0.000 | 0.031 | – | – |
| 1 | Chains (ink and text evidence) | 51 | 0.542 | 0.235 | 0.700 | 0.600 |
| 2 | + gray evidence, 3 px offset | 53 | 0.625 | 0.208 | 0.619 | 0.545 |
| 3 | + oriented labels | 36 | 0.625 | 0.333 | 0.619 | 0.545 |
| 4 | + wall faces (≥ 60 % of length) | 23 | 0.625 | 0.522 | 0.619 | 0.576 |
| 5 | + label ownership (nearest), bold partners | 15 | 0.625 | 0.800 | 0.619 | 0.606 |
| 6 | + pieces drawn into the band | 16 | 0.667 | 0.812 | 0.814 | 0.765 |
| 7 | + ends run on (alone, same pen) | 16 | 0.625 | 0.750 | 0.786 | 0.727 |
| 8 | + marks on perpendicular strokes, through rule | 16 | 0.625 | 0.750 | 0.833 | 0.788 |
| 9 | + crossing dimension lines | 14 | 0.583 | 0.857 | 0.902 | 0.844 |
| 10 | + same pen, owner ties | 14 | 0.583 | 0.929 | 0.902 | 0.875 |
| 11 | Vector path split off, baseline-side ownership | 15 | 0.625 | 0.933 | 0.881 | 0.848 |
| 12 | + wall face at the line end | 17 | 0.708 | 0.941 | 0.886 | 0.829 |
| 13 | + no chain across solid walls (final) | 18 | **0.708** | **0.944** | **0.932** | **0.886** |

Wall metrics:
- HDB went from 0.868 / 0.893 / 36 free ends to **0.870 / 0.894 / 34**.
- The brochure is unchanged at **0.908 / 0.856 / 18**.

### Remaining misses (final)

- **Unmatched:**
  - the 5 lines outside the region;
  - 400 and 600 (no segment).
- **The one false line:** the extension line at source x ≈ 821. It runs from the top chain down to the 600 line, and it takes the "400" label, because the 400 line (its rightful owner) has no segment.
- **Intervals missed:**
  - 1600 (a glyph remnant beside "1600" reads as a mark);
  - 11100 (its right tick is just outside the region);
  - 3500 (the 7600 line crosses with a slash nearby).
- **Labels missed:** 1600, 11100, 300 (drawn outside its 22 px interval) and 3500.

## 6. Tests and evidence

### New reference tests: `tests/test_reference_dims.py` (`@pytest.mark.reference`, normal suite)

- truth profile check;
- scorer self-check;
- precision ≥ 0.90;
- recall ≥ 0.80 on the traced lines inside the region, with 11100 matched;
- **strict xfail:** recall ≥ 0.80 on all lines plus the outer overall lines. Reason: the region blocker;
- spans and labels ≥ 0.80;
- brochure: 0 lines;
- walls do not regress, per image. Floors: 0.868 / 0.893 / 36 and 0.908 / 0.856 / 18, compared at 3 decimals, as Task 16b reported them. The brochure's precision is exactly 16b's 0.85589;
- dimensions < 2 s and chain < 10 s, per image.

### New synthetic tests: `tests/test_dimensions.py` (14)

- line cut under its label is one line;
- faint line chained by the gray image (and not without it);
- pieces drawn with another pen are not chained;
- line runs on under a label to its end tick;
- wall face is no dimension line;
- label between two lines keeps the line;
- dimension line beside a partition stays one;
- label must be written along a raster line;
- line below a chain does not borrow its label;
- through strokes are no ticks on a slash-ticked line, but are on a bare one;
- slashes on through-running extension lines mark the line;
- dimension line ending across another is no tick of it;
- wall at the line end is a tick and a crossing wall is not;
- chain not bridged across a solid wall.

### RED

The new tests were run against `92b8bc2` in a temporary worktree (`git worktree add`, since removed), with the harness call reduced to the old signature: **13 failed, 10 passed, 1 xfailed**. Expected failures, because each rule is new:

- precision `0.03125 >= 0.9`;
- in-region recall `1.0 - 19/19 >= 0.8`;
- intervals `0.0 >= 0.8`;
- cut / faint / run-on lines `[] == [[300, 750, 1200]]`, `[[300, 750]]`;
- face `[[300, 1200]] == []`;
- orientation `[[300, 750, 1200]] == []`;
- borrowed label `[300, 330] == [300]`;
- through stroke `[[300, 500, 750, 1200]]`;
- crossing `[[110, 250, 300, 750, 1200]]`;
- wall tick `[[750, 1200]]`;
- wall bridge `[] == …`.

The ten that passed on the old code are:
- the truth, scorer, brochure, walls and speed checks;
- three guards against over-rejection (another pen, label between, beside a partition).

Output: `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/t14b/red.txt` and `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/t14b/red-detail.txt`.

### Mutation checks

Each rule was disabled by monkeypatching in a scratch runner, without editing the worktree (`/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/t14b/mutate.py`). Each mutation makes its guarding tests fail (exit 1):
- chaining (2 tests);
- darkness;
- extension;
- faces;
- spoken-for;
- strip text;
- orientation;
- owners;
- styled (2 tests);
- `_carries_mark`;
- crossings;
- wall tick;
- wall bridge.

Output: `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/t14b/mutations.txt`.

### GREEN

- `uv run pytest -q tests/test_dimensions.py` → 184 passed. That includes every fix2 acceptance test: phase robustness, stacked chains, blobs, the vector digest and the perf guard.
- `uv run pytest -q tests/test_reference_dims.py` → 10 passed, 1 xfailed.
- Full suite: `uv run pytest -q` → **744 passed, 1 skipped, 4 xfailed in 102 s**, no warnings. The xfails are 16b's three plus the new strict xfail.
- Gates:
  - `uv run ruff check .` → All checks passed;
  - `uv run ruff format --check .` → 73 files already formatted;
  - `uv run mypy app` → no issues in 45 files.

### Debug PNGs

- `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/t14b/dbg-final-a.png` and `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/t14b/dbg-final-b.png`: HDB, truth in green, detected lines in blue, false lines in red, ticks drawn.
- `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/t14b/hdb-3room-dims-before.png`: the 32 baseline lines.
- `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/t14b/hdb-3room-final-walls.png` and `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/t14b/brochure-2bhk-final-walls.png`: the walls with their traced truth.

## 7. Files

- `vision/app/pipeline/dimensions.py`: the raster rules and the vector/raster split.
- `vision/app/pipeline/walls.py`: the guard simplified; `_text_height` removed.
- `vision/tests/support/reference.py`: the dimension truth loader and metrics; `run_chain` passes `gray` and `t_thin`.
- `vision/tests/test_dimensions.py`: 14 new tests.
- `vision/tests/test_reference_dims.py`: new.
- `vision/tests/fixtures/reference/hdb-3room.drawing-dims.json`: new.

## 8. Blockers and proposed rulings

**B1: the region excludes the outer dimension chains.** On HDB the outer chains lie 0.10–0.15 L outside the walls' bounding box, beyond the 6 % growth of 06 §7.6 step 7. The 11000 line is at source y 31–52 and the region starts at 52.5; 7000 is at x ≈ 33 and 8900 at x ≈ 1246, with the region spanning x 76–1188.

I ran experiments with the final code, monkeypatching `region.EXPAND_FRAC`:

| Growth | Dimensions R / P / intervals / labels | Unmatched | HDB walls R / P | Brochure walls R / P |
|---|---|---|---|---|
| 0.10 | **0.833 / 0.952 / 0.920 / 0.854** | 7000, 8900, 400, 600 | **0.804 / 0.771** | 0.890 / 0.798 |
| 0.15 | 0.750 / 0.952 / 0.795 / 0.750 | – | 0.798 / 0.797 | 0.853 / 0.723 |

The walls stage's region-sized guards break when the region grows (envelope, region L). So growing the region is not a local fix.

**Proposed ruling B1:** give the dimension stage its own wider *dimension region*, the walls box grown by 0.15 L and clipped to the page, for segments and OCR. The walls stage keeps the plan region and its L. Alternatively, accept for Task 14b the in-region recall (0.895 now) and only the 11100 overall line, and defer the outer chains to that region change (a 7.6 / 7.7 / 7.9 task). The brief's strict targets are kept as a strict xfail (`test_hdb_dimension_recall_and_outer_overall_lines`), so it flips when the region is fixed.

**B2: text masking erases short interior dimension lines** (the 400 and the 600 at the top). The OCR boxes, which carry RapidOCR's unclip padding plus the 2 px mask dilation, cover the line, so LSD never sees it.

**Proposed ruling B2:** accept these as unreachable in 14b (−2 lines; with B1 fixed, recall could reach 22 / 24 = 0.92). Alternatively, in a segments task, shrink the text mask to the glyph ink rather than the padded box.

## 9. Concerns

- **`dimensions.py` grew from 705 to 1421 lines.** It holds one stage, but it has six concerns: chains, ink ticks, faces, labels, crossings and spans. A split would need a plan decision, for example `dimensions/` with `chains.py`, `ticks.py` and `filters.py`.
- **Interface.** `find_dimension_lines` gained `gray` and `t_thin`. Task 31 must pass `pre.gray` and `pre.t_thin`; without `gray`, faint lines are not chained or lengthened. `extract_walls`' `tokens` keyword is now unused but kept for the interface.
- **Heuristics tuned on one real drawing.** The same-pen ratio (1.6×), gap contrast (8 levels), chain gap (0.06 L) and baseline-side ownership come from HDB plus synthetic cases. The ownership convention assumes text stands on its line; a drawing with labels written under their lines would lose them when another line sits above. The fallback covers only labels with no line on the baseline side.
- **The walls guard still matters.** It now protects true dimension lines beside partitions (I12 on HDB), not false ones. A principled fix belongs in walls: a dimension line's exclusion should not cut a wall face it runs along.
- **Single tracer.** The truth is my own transcription, verified by profiles and contact sheets. Two judgement calls should get an independent look: 3100 | 3600 and 300 | 600 split into two lines each, and 400 added.

---

# Continuation (rulings B1 / B2, split)

**Status: NEEDS_CONTEXT.** Your rulings are implemented and pushed: the module split, the annotation region, the `method` note and the walls floors. Two targets are still missed, and closing them needs a further design change: **recall 0.792** (≥ 0.80) and **2 of the 5 outer overall lines** (7000, 8900). The proposed rulings are in C5.

## Commits (pushed to `origin/build/p3-vision`)

- `2aaed14 refactor(vision): split dimension detection into ticks, candidates and the stage API`. No behaviour change: the vector digest test and the HDB metrics are identical.
  - `dimension_ticks.py` (627 lines): segment and ink ticks, tick kinds, `styled_ticks`.
  - `dimension_candidates.py` (455 lines): chains, `Evidence`, wall faces.
  - `dimensions.py` (379 lines): `find_dimension_lines`, labels and ownership, crossings, spans, association.
- `0f380d6 feat(vision): annotation region for the dimension stage (Task 14b ruling B1)`.

## C1. Annotation region: shape and why

- **`region.annotation_region(region, w, h)`.** The plan region grown by `round(0.15 × L)` on every side and clamped to the page.
  - HDB: the whole page (2000 × 1662).
  - Brochure: (0, 0, 1411, 1414).
- **OCR (`run_ocr`) reads the annotation region.**
  - Tokens are numbered `T1..Tn` over all of it.
  - The text mask and `ink_notext` cover all of it.
  - Stages that work on the plan region (rooms, labeling) select their tokens with the new `ocr_stage.in_region(tokens, pre.region)`. Ids are unchanged, so the output is deterministic.
  - The walls stage reads no tokens since 14b, so it needs no change.
- **Segments: two calls rather than one run filtered back.**
  - `detect_segments` is unchanged: the plan region, ids `S…`.
  - The new `detect_annotation_segments` runs the same detector over the annotation region. It returns the segments not wholly inside the plan region, with ids `A1..An`.
  - `find_dimension_lines` gets both lists. Walls and every other stage get only `detect_segments`.

  **Why two calls.** I first tried one segment run over the annotation region, with walls clipping the result back to the plan region. LSD's detection depends on the size of the image it runs on, so the plan region's own line work changed:
  - 759 of 1055 brochure segments moved;
  - brochure walls fell to R / P 0.915 / **0.801** with 20 free ends;
  - HDB recall fell to **0.865**.

  Separating the OCR and segment changes showed the OCR change alone leaves walls exactly unchanged; the regression comes from the segment run. The second LSD pass costs about +0.1 to 0.2 s.

  A line crossing the plan border appears in both lists. The chain step merges the overlapping copies.
- **Fixtures.** `record_ocr` now records `run_ocr` itself, over the annotation region, with `read_region` and `seconds`. `replay_ocr` filters by the annotation region, the same as `run_ocr`.
  - Both OCR fixtures were re-recorded and committed.
  - HDB's tokens are unchanged (55, since the region is the whole page).
  - The brochure's changed: the OCR tiling differs on the larger crop.
- **Deviation for spec 19 (06 §7.6, §7.7, §7.9, §8.4).** OCR covers the annotation region, not the plan region. Segments for the dimension stage also cover the annotation region (a second detection pass). Every other stage stays on the plan region. `L` stays the plan region's long side.

## C2. Tests

- `test_ocr.py`:
  - the region-offset test now reads the annotation crop;
  - new test: a label beyond the plan region is read, and `in_region` selects the plan's own text, ids unchanged.
- `test_segments.py`: new test. `detect_annotation_segments` returns the line outside the plan region and the one crossing its border (`A1`, `A2`), but not the one inside it or the one beyond the annotation region. `detect_segments` stays plan-only.
- `test_reference_dims.py`:
  - the walls floor for HDB free ends is now ≤ 34;
  - `OUTER_OVERALL` now includes 7600 (`right-mid`);
  - the in-region recall test is replaced by `test_hdb_outer_lines_beyond_the_plan_region_are_found`: top, right, right-mid, bottom, 11000 and 11100 matched, recall ≥ 0.79;
  - the brief's target stays a **strict xfail**, with the new reason (C5). I kept it rather than removing it, because the target is not met.
- `hdb-3room.drawing-dims.json`: a `method` object with one entry per split and addition:
  - 3100 | 3600 (the black wall interrupts the stroke);
  - 300 | 600 (only faint face lines between x 721 and 765; the "300" text sits outside its 22 px interval);
  - the kitchen 1900 / 1200 line and 7600 / 3100 (one stroke each);
  - the three right lines;
  - 400 added;
  - the B2 residuals.

**Results.**
- `uv run pytest -q` → **746 passed, 1 skipped, 4 xfailed in 103 s**.
- ruff, `ruff format --check` and mypy are clean (47 source files).

## C3. Metrics (final, `0f380d6`)

| Metric | Value | Target | Met? |
|---|---|---|---|
| HDB recall, all 24 traced lines | **0.792** (19) | ≥ 0.80 | **No** |
| Outer overall lines matched | 11000, 11100, 7600 | all 5 | **No** (7000, 8900 missed) |
| HDB precision | **0.955** (21 of 22) | ≥ 0.90 | Yes |
| Spans within 0.5 % L | **0.936** | ≥ 0.80 | Yes |
| Labels on the right span | **0.868** | ≥ 0.80 | Yes |
| Brochure detected lines | **0** | 0 (≤ 1) | Yes |
| HDB walls R / P / free ends | **0.870 / 0.894 / 34** | ≥ 0.868 / 0.893, ≤ 34 | Yes |
| Brochure walls R / P / free ends | **0.924 / 0.875 / 18** | ≥ 0.908 / 0.856, ≤ 18 | Yes |
| Dimensions stage | 0.25 s and 0.00 s | < 2 s | Yes |
| Chain with OCR replay | ≈ 1.3 s and 0.6 s | – | – |
| Chain with real OCR | ≈ **11.0 s** and ≈ **10.8 s** | < 10 s | **No** (see C4) |

- **Unmatched:** 7000, 8900, the left 3300 / 2500 / 1000 chain, and the B2 residuals 400 and 600.
- **False line:** L2, the extension line at source x ≈ 821 (it takes the 400's label; the 400 line has no segment).

## C4. Real OCR timing on the larger area

The real engine was run once per image, with `record_ocr` and with a warm engine. Times are this sandbox's CPU.

| Image | Plan region (old) | Annotation region (new) | `record_ocr`, cold |
|---|---|---|---|
| HDB | 10.0 s, 45 tokens | **9.7 s**, 55 tokens | 11.2 s |
| Brochure | 2.4 s, 23 tokens | **10.2 s**, 25 tokens | 12.1 s |

Time follows tile count, not area. Both passes tile at 1280 px:
- HDB's plan region (1709 × 1473) already needs 2 × 2 tiles, so its OCR time does not change.
- The brochure grows from 1 tile (1212 × 1082) to 2 × 2 tiles (1411 × 1414).

With the replayed chain added, the real-OCR chain is about 11.0 s (HDB) and 10.8 s (brochure), against the 10 s budget. HDB was already about 10.8 s before this change, so the 10 s budget with real OCR was not met on this machine before B1 either.

**Measured alternative.** OCR the plan region plus the four ring strips around it:
- brochure: 2.4 + 1.7 = **4.1 s**;
- HDB: 10.0 + 2.5 = **12.5 s**, worse;
- text cut by the plan border would be read in two parts.

## C5. Remaining blockers and proposed rulings

**C5a. The 8900 line: its top tick is erased by OCR noise.**
- **What happens.** RapidOCR reads the slash tick at the top of the 8900 line as the text "1": token `T9` "1", box (1906, 163)–(1943, 187), angle 90. The text mask removes the tick from `ink_notext`, so the line keeps one tick.
- **The same at 11100.** The "1" token `T55` at (1723, 1558)–(1742, 1589) erases 11100's right tick. That costs the 11100 span its label, not the line.
- **Measured fix.** Leaving one-character tokens that parse as `other` out of the text mask (tokens kept) gives:
  - recall **0.833**, precision 0.957, intervals 0.938, labels 0.872;
  - 8900 matched;
  - HDB walls unchanged.

  It was measured by replaying without those tokens (scratch: `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/t14b/eval_noise.py`).
- **Proposed ruling C5a.** In `run_ocr`, one-character tokens that parse as `other` (stray glyphs read off line work: "1", "l", "/") are not painted into the text mask. This is a deviation from 06 §7.7, and `replay_ocr` would mirror it. I did not implement it, because it changes 06 §7.7 beyond the B1 ruling.

**C5b. The 7000 line: its upper fifth is not in the image.**
- **The evidence.** The perpendicular profile along the traced line reads gray 228–252 on paper 254 from source y ≈ 210 to ≈ 330. LSD finds pieces only below y ≈ 335 (u ≥ 235 of 957 normalized px), and pieces at the very top (u 16–52), with a 183 px gap and no ink, no gray contrast ≥ 8 and no label in between.
- **Best case.** A chain from u 235 to 956 covers **75 %** of the traced line, short of the match rule's 80 %. Even that chain needs:
  - the same-pen ratio relaxed: piece darkness runs from 13 to 70 along this one line;
  - a wider parallel-copy tolerance.

  Either relaxation would let the i1000 and i300 lines run into their face lines again.
- **The same applies to the left 3300 / 2500 / 1000 chain**: darkness 12–78 and a 112 px gap.
- **Proposed ruling C5b.** Carry the 7000 line (and the left chain) as photo-contrast residuals to Task 34, alongside B2, and drop 7000 from the "all five outer overall lines" requirement. With C5a, the targets would then be met:
  - recall 0.833 (20 of 24);
  - overall lines 11000, 11100, 7600 and 8900.

  Alternatively, rule the matching overlap for overall lines to 75 %. That would still need the chaining relaxations above, which cost precision.

**C5c. The 10 s budget with real OCR** is not met (C4). It was not met on HDB before B1 either.
- **Proposed ruling C5c, either:**
  - set the budget as "replayed chain < 10 s, real OCR measured and reported per image", the current test; or
  - OCR the plan region plus the ring strips, which helps the brochure (about 4 s) but not HDB.

## C6. Concerns

- **Interface.** The pipeline (Task 31) must:
  - call `detect_annotation_segments` and pass `[*segments, *annotation_segments]` to `find_dimension_lines`, with `gray=pre.gray, t_thin=pre.t_thin`;
  - give walls only `detect_segments`;
  - have the rooms and labeling stages select tokens with `in_region(tokens, pre.region)`.
- **Brochure OCR fixture.** It changed with the re-record. The plan-region text now comes from a different tile layout. Brochure walls went up (0.908 / 0.856 → 0.924 / 0.875), and the 16b brochure tests still pass.
- **Single tracer.** Unchanged since the first report: the 3100 | 3600 and 300 | 600 splits and the 400 line are documented in `method`, for your independent check.

---

# Final (rulings C5a / C5b / C5c)

**Status: DONE.** Commit `c495a09` (pushed). The earlier commits are `d377052`, `2aaed14` and `0f380d6`.

## Changes

- **C5a: one-character OCR noise.** In `ocr_stage`:
  - New `masks_text(token)`: one-character tokens that parse as `other` are left out of the text mask. The token itself is kept.
  - `text_mask(shape, tokens)` is now public, and `replay_ocr` builds its mask with this same function.
  - New test `test_single_character_token_on_a_tick_does_not_erase_it`:
    - a "1" token over the end tick: the line keeps the ticks [300, 750, 1200];
    - an "11" token there is masked, and the tick is lost.
- **C5b: residuals.** `hdb-3room.drawing-dims.json` marks the Task 34 residuals; they stay counted in recall:
  - `"residual": "text_mask"` on i400 and i600;
  - `"residual": "faint_in_photo"` on left-overall (7000) and left (3300/2500/1000);
  - `method.residuals` explains both.

  `test_residual_lines_are_marked_for_task_34` checks the marks.
- **Targets test.** `test_hdb_dimension_recall_and_outer_overall_lines` is no longer an xfail. It asserts:
  - recall ≥ 0.80 over all 24 traced lines;
  - 11000, 11100, 7600 and 8900 are matched.
- **C5c: timing.** `test_dimension_stage_is_fast` now asserts dimensions < 2 s and the non-OCR stages < 10 s. The OCR crop stays the annotation region.

## Deviations for spec 19 (added to §4 and C1)

- **06 §7.7, text mask.** A token of one character that parses as `other` is not masked: it is nearly always a tick or arrowhead misread.

## Tests and gates

- `uv run pytest -q` → **749 passed, 1 skipped, 3 xfailed in 109 s**. The xfails are 16b's three.
- `uv run ruff check .` → All checks passed.
- `uv run ruff format --check .` → 75 files already formatted.
- `uv run mypy app` → no issues in 47 source files.

## Final metrics

| Metric | Value | Target | Met? |
|---|---|---|---|
| HDB recall, all 24 traced lines | **0.833** (20) | ≥ 0.80 | Yes |
| Outer overall lines matched | 11000, 11100, 7600, 8900 | all 4 | Yes |
| HDB precision | **0.957** (22 of 23) | ≥ 0.90 | Yes |
| Spans within 0.5 % L | **0.938** | ≥ 0.80 | Yes |
| Labels on the right span | **0.872** | ≥ 0.80 | Yes |
| Brochure detected lines | **0** | 0 | Yes |
| HDB walls R / P / free ends | **0.870 / 0.894 / 34** | ≥ 0.868 / 0.893, ≤ 34 | Yes |
| Brochure walls R / P / free ends | **0.924 / 0.875 / 18** | ≥ 0.908 / 0.856, ≤ 18 | Yes |
| Dimensions stage (HDB / brochure) | 0.24 s / 0.00 s | < 2 s | Yes |
| Non-OCR chain (HDB / brochure) | 1.23 s / 0.53 s | < 10 s | Yes |
| Real OCR on the annotation region (warm / cold) | HDB 9.7 / 11.2 s; brochure 10.2 / 12.1 s | reported; bounded by `recognize_timeout_s` = 600 | – |

**Unmatched:** the four Task 34 residuals (i400, i600, 7000 and the left chain).

**False line:** the extension line at source x ≈ 821. It takes the "400" label, because the 400 line has no segment.

---

# Fix round 1 (review I1, M1–M5, T1–T3; on Task 16c head 36b0753)

**Status: DONE.** Commits `c51fc6a` and `12a2298` are pushed, on top of 16c (`36b0753`). Every floor is met. `walls.py` and `wall_candidates.py` are untouched.

## I1: label ownership (`dimensions.py`, `_Labels.owners`)

The baseline-side rule is gone. 06 §8.4 step 1 lets a label stand on either side of its line, so:

1. **Nearest line.** A label belongs to the nearest line, measured across, among the lines it is beside, on either side.
2. **Collinear copies.** Lines on the same side within `OWNER_TIE_PX` (3 px) of that distance share it.
3. **Stacked lines.** Lines on the other side of the label, within `STACK_REACH` = 2 text heights, contest it. The contest is resolved in this order:
   - (a) **Bracketing ticks:** the lines whose consecutive ticks bracket the label's projection win.
   - (b) **Scale:** with a scale estimate, the line whose bracketing interval matches the label's value best. It must fit within log-ratio 0.15 and beat the next line by at least 0.05. The estimate is the median mm/px over at least 3 uncontested labels in bracketing intervals.
   - (c) **Marks:** the line with the most terminator marks on its two bracketing ticks.
   - (d) **Need:** the line that owns no uncontested label.
   - (e) **Distance:** the nearest line.

**Deviation from your ruling.** Your ruling named (a), (b) and then "nearest". I added (c) and (d) because two cases need them:

- **Rule (c), marks.** In counter-case c1b the label is equidistant from both lines (15 / 15 px). Only the marks tell the slash-ticked chain from the bar-crossed line.
- **Rule (d), need.** In the fix2 stacked-chain control (gap 25, labels above), the label between the lines is 6 px from the outer line and 19 px from the inner one. Both lines bracket it and the scale cannot tell them apart. "Nearest" alone would drop the inner chain and fail the control.
- **On HDB, (c) comes before (d).** The AC-ledge line beside "1800" owns no label of its own, so it would win on need. It carries only bare crossings, so it loses on marks first.

**Tests.** The reviewer's c1b, c1c and c2b, plus the c1d and c2c controls, are now phase-robust tests in `test_dimensions.py` (6 phases × jitter):
- `test_label_below_a_chain_is_not_taken_by_a_crossed_line_below_it`;
- `test_stacked_horizontal_chains_keep_their_labels_on_either_side` (gaps 30/40/50, labels below / above);
- `test_stacked_vertical_chains_keep_their_labels_on_either_side` (right / left).

**RED, on 36b0753, the old rule:**
- 7 failed: c1b and the 6 labels-below / labels-right cases.
- 6 passed: the controls.

**GREEN:** all 13 pass, and the fix2 stacked tests still pass.

## M1: tick accuracy

### Harness changes (`reference.py`)

- **`DimMetrics` gains tick recall and tick precision**, plus the missed and false ticks. A tick matches a traced tick within 0.5 % L:
  - recall: the traced ticks of matched lines, against the detected lines that match them;
  - precision: the ticks of detected lines lying on traced lines, against those lines' traced ticks.
- **`label_span(result, text)`** returns the span a token is associated with.
- **New tests in `test_reference_dims.py`:**
  - `test_hdb_tick_positions`: recall ≥ 0.85, precision ≥ 0.90;
  - `test_hdb_overall_label_goes_to_the_overall_line`: both ends within 0.5 % L of the 11000 ticks.

### First measurement on 16c

Tick recall 0.971 / precision 0.829, with 14 false ticks. The 11000 label went to the top chain's overall span.

### Causes and fixes

1. **Specks (L15).** The 7000 fragment's two "ticks" were not ink. `_draw_pieces` joined the end points of the line's overlapping LSD copies, which sit about 3 px apart, in u order. The polyline zigzagged, and its jogs read as marks.

   Fix: the band now gets one centre stroke, the mean offset of the pieces covering each column, interpolated across gaps. The jogs are gone, so L15 is gone.
2. **The 11000 line.** Its chain stopped 24 px before the left extension line, because the stroke fades there (gray 216–245): no tick at 153.8. Its "ticks" at x ≈ 288 and ≈ 1074 were the same jogs as in (1).

   Fix: new `_run_to_crossing`. From a chain end it may run on, within 0.02 L, over gray at least 8 levels darker than the paper (any pen), to a *thin* crossing stroke: ink across the line on both sides, at most 2.5 w + 2 wide. It ends 2 px past that stroke. A wall is not taken: the i3100 line's end at the black wall stays put.
3. **The 11000 label on the top chain's overall span.** After (2), the top chain's overall span has the same extent as the 11000 line's span. Step 5 then tied, and the tie was broken by id order.

   Fix: in `associate_dimension_texts`, when spans have nearly the same extent (length and midpoint distance within 1 %), the one on a parallel line at least a text height nearer the token wins. This is a deviation from 06 §8.4 step 5, which breaks ties by the shorter span only. The "text height nearer" condition keeps `test_vector_path_output_is_unchanged`: scene 219 has two near-duplicate lines 5 px apart, which must keep the old choice.
4. **Door jambs and end extras.** `styled_ticks` applies new rules on lines drawn with terminator marks:
   - (a) a segment bar counts only where the ink shows a non-through tick: LSD reports jamb lines the ink sees as through-strokes or as nothing;
   - (b) two bare strokes 1.5 t_thin to 0.02 L apart, neither near a mark, are a jamb's or partition's faces;
   - (c) a bare stroke or wall within 0.015 L beyond the outermost mark is the wall the line runs into.

   This removed the L17/L18 jamb ticks at 509 and 790, and at 719. One jamb tick survives: 434, the 3100 line's tick at 108, whose partner is a through-stroke.

**Mutation checks** (`mutate.py` in the scratchpad; output at `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/t14b/mutations-fr1.txt`). Each disabled rule fails its test:
- jamb pair;
- end extra;
- run to crossing;
- association tie;
- stacked ownership (`STACK_REACH` = 0).

### Remaining false ticks (5 of 74)

| Tick | Line | What it is |
|---|---|---|
| L7@0 | 3200 bed 2 | The face line at its top; the ink sees no tick there, the segments do. |
| L10@0 | kitchen 1900/1200 | A slash next to the bold wall reads as a second mark. |
| L16@108 | 3100 | Jamb, above. |
| L17@-2 | 3500 | Its top face line. |
| L17@457 | 3500 | The 7600 line's slash near the crossing. |

(Line ids as numbered after the precision fix below, which removed L2.)

**Remaining missed tick:** i3500@0. Only LSD sees that slash, and rule 4a drops it because the ink shows no tick there.

### Precision fix (second commit)

After `c51fc6a`, precision was 0.955, short of the 0.957 floor. The one false line, the vertical extension line at x ≈ 821, crosses the top chain exactly at one of the chain's slashes and took that slash as its own tick. `_drop_crossings` dropped only *unmarked* ticks at a crossing, so the line kept two ticks and survived.

**Fix** (`dimensions.py`, `_drop_crossings`): a marked tick at a crossing is now dropped too, when the crossing line has a tick of its own there (within the dedupe gap) and has more ticks than this line. The slash then belongs to the other line: an extension line crossing a chain at the chain's tick. Other marked ticks at crossings stay, as before. This is a small deviation from the Task 14b crossing rule, logged here.

**Test:** `test_slash_of_a_chain_is_no_tick_of_an_extension_line_crossing_it` (a direct test of `_drop_crossings`, with two controls: the chain keeps its slash, and a slashed crossing between the chain's ticks stays). Three mutations each fail it: marked ticks always kept, the tick-count condition removed, the "tick at the crossing" condition removed.

**Effect on HDB:** the x ≈ 821 line is gone. Precision is 1.000 (20 of 20 detected lines match), with 21 lines detected. Every other dimension, tick and wall metric is unchanged.

## M2–M5

- **M2.** `region.py`'s annotation docstring now names `detect_segments` / `detect_annotation_segments`. `dimension_candidates.py` cites `Evidence`.
- **M3.** Verified: 16c removed `extract_walls`' `tokens` parameter, and its docstring says why.
- **M4.** `record_ocr` logs the seconds (`logging`) instead of writing them. The `seconds` field is removed from both OCR fixtures; the tokens are unchanged.
- **M5.** §9's direction was wrong: a line is stolen from when another line sits on the label's *baseline* side. That no longer applies, since ownership is side-agnostic (I1).

## T1–T3: truth (`hdb-3room.drawing-dims.json`, `method.fixes`)

Each line was regenerated with the tracing script and profile-checked at 20 / 50 / 80 %:

| Line | Change | Profile check (\|offset\|) |
|---|---|---|
| i3100-bed1 | p1 and tick[1] moved to the wall face at x 640.5 | 0.00 / 0.01 / 0.00 |
| bottom | tick[0] on the extension line at x 143.2; p0 / p1 at the stroke ends, x 136.5 / 1132.6 | 0.23 / 0.12 / 0.31 |
| bottom-overall | tick[0] at x 142.6; ends 136.5 / 1132.6 | 0.09 / 0.03 / 0.47 |

The other 21 lines regenerate identically; I asserted that.

## Tests and gates

- `uv run pytest -q` → **799 passed, 1 skipped, 1 xfailed in 114 s**. The xfail is Task 16c's `test_hdb_seven_rooms_are_faces` (the Task 18 target).
- ruff, `ruff format --check` (77 files) and mypy (48 files) are clean.

## Metrics (after the precision fix)

| Metric | Value | Floor / target | Met? |
|---|---|---|---|
| HDB dimension recall | **0.833** | ≥ 0.833 | Yes |
| HDB dimension precision | **1.000** (0 false lines) | ≥ 0.957 | Yes |
| Intervals | **0.979** | ≥ 0.938 | Yes |
| Labels | **0.923** | ≥ 0.872 | Yes |
| 11000 label span | (235.5, 77.7) → (1725.9, 49.2) against ticks (236.9, 80.1) / (1724.2, 47.7) | within 0.5 % L | Yes |
| Tick recall | **0.985** (1 of 66 missed) | ≥ 0.85 | Yes |
| Tick precision | **0.932** (5 of 74 false) | ≥ 0.90 | Yes |
| Brochure dimension lines | **0** | 0 | Yes |
| HDB walls R / P | **0.892 / 0.963** | ≥ 0.892 / 0.963 | Yes |
| HDB outer free ends | **0** | 0 | Yes |
| HDB faces ≥ 0.03 L² | **5** | ≥ 5 | Yes |
| Brochure walls R / P | **0.912 / 0.865** | ≥ 0.912 / 0.865 | Yes |
| Brochure outer free ends | **0** | 0 | Yes |

**On precision.** At `c51fc6a` precision was 0.955 (21 of 22 lines); the 0.957 floor was 22 of 23. The 7000 fragment (L15) was gone: it counted as a "true" line under the union rule but carried only the drawing-jog ticks. That left the x ≈ 821 extension line as the one false line, which the precision fix removed.

**Unmatched lines:** left, left-overall (C5b residuals), i600, i400 (B2 / Task 34 residuals).
