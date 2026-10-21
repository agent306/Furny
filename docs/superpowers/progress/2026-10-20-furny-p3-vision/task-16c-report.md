# Task 16c report: HDB outline closure, truth correction and the Task 16/16b review fixes

**Status: NEEDS_CONTEXT.** Parts A, B and C are implemented, tested and pushed. Two results:

- **The HDB outer outline closes.** There are 0 free ends on the outer cycle, and the extracted faces enclose 99.7 % of the dwelling the truth outlines. Walls score **R 0.889 / P 0.943** against the corrected truth.
- **The faces target is not met: 3 bounded faces, against ≥ 7.** The interior partitions break on causes that ruling B2 does not cover (§6). Each fix is a design change beyond B2 and the brief, so I stopped as the brief's stop rule asks. Proposed rulings are in §6.

The faces target stays a strict xfail: `test_hdb_rooms_are_faces`.

Commits (pushed to `origin/build/p3-vision`):

| SHA | Subject |
|---|---|
| `6ac7db8` | refactor(vision): move wall candidates and double-line pairing into wall_candidates.py |
| `de0139b` | test(vision): correct the HDB traced wall truth (Task 16c part A) |
| `88bde9a` | fix(vision): plan-region grouping by a sweep over sorted boxes, with deadline polls |
| `9ebdfeb` | fix(vision): HDB outline closure (ruling B2) and the Task 16/16b review fixes |

---

## 1. Final metrics

| Metric | HDB | Brochure | Target | Met? |
|---|---|---|---|---|
| Recall (traced truth) | **0.889** | **0.924** | HDB ≥ 0.85; brochure ≥ 0.75 and not below 0.90 | Yes |
| Precision (traced truth) | **0.943** | **0.865** | HDB ≥ 0.85; brochure ≥ 0.75 and not below 0.85 | Yes |
| Outer-cycle free ends, outer-outline definition (§4.3) | **0** | **2** | HDB = 0; brochure ≤ 7, aim 0 | Yes / Yes |
| Outer-cycle free ends, Task 16b definition | 4 | 7 | (reported) | – |
| Share of the truth's dwelling enclosed by faces | **0.997** | 0.748 | (new check: HDB ≥ 0.95) | Yes |
| Bounded faces, area ≥ (0.03 L)² | **3** | 3 | HDB ≥ 7 | **No** |
| All graph free ends | 18 | 18 | – | – |
| Full chain (OCR replayed) | 1.12 s | 0.57 s | < 10 s | Yes |
| Dimension metrics (Task 14b) | 0.833 / 0.957 / 0.938 / 0.872 | 0 lines | unchanged | Yes |

The dimension metrics are recall, precision, intervals and labels. All four are identical to Task 14b's final values: the segment change in §3.B3 does not move them.

## 2. Face list

### HDB (final)

Faces are listed in source px.

| # | Face | Bounding box | Labels inside |
|---|---|---|---|
| 1 | Bedroom 1 | (368, 181)–(648, 480) | BEDROOM |
| 2 | Everything else merged | (145, 116)–(1123, 924) | living with the kitchen, store, toilets 1–3, bedrooms 2 and 3, the bay and the balcony |
| 3 | The 600 recess | (833, 803)–(891, 923) | – |

Face 2 is one face because the outline is closed but the interior is not separated. The breaks that merge the spaces are listed in §6.

### Brochure (final)

| # | Face | Bounding box | Notes |
|---|---|---|---|
| 1 | Flat, merged | (77, 62)–(341, 311) | not the left bedroom |
| 2 | Sliver | (236, 101)–(247, 117) | |
| 3 | Sliver | (223, 287)–(246, 311) | |

The left bedroom stays open because of the toilet window (§6, item 1).

### Corrected HDB truth

The truth itself bounds 11 faces:

- the 10 room-like spaces: bedrooms 1–3, toilets 1–3, the store, living with the kitchen, the balcony and the 600 recess;
- the bay above toilet 3.

`test_hdb_truth_closes_into_the_rooms` checks this.

## 3. What was implemented

### Part A: the HDB truth (`hdb-3room.drawing-walls.json`)

The controller's convention is written into the file's `method.convention`.

| Correction | Value |
|---|---|
| Toilet 3's top wall (new I16) | y 178, x 980 → 1115 (new node T3r; X4 split there) |
| Store/kitchen wall Q→U (new I17) | x 299, y 364 → 480 (Q and U moved to x 299) |
| I14 (H4l / H4r) | y 360 |
| V6t | y 178 |
| B | y 174 |
| P | y 927 |
| X6 | y 804, the centre of the 799 / 808 face pair (new node O2) |
| L1 | split at O into L1a (O2–O) and L1, so X5's end is a node |
| K, Xb | y 804, y 803 |

**Black blocks.** Walls through the black blocks at x 427–575 follow the block centres (y 796 top, y 912 bottom):

- X8b and X7a run through the top block, with I at (505, 796);
- B2a and B2b run through the bottom block, with M at (505, 912).

**Jogs** (connectors of kind `jog`):

- X8: bold stroke 805.25 plus thin inner face 795.75, midpoint 800.5, jogs to the block (X8j);
- X7: slider frame centre 803 (X7j);
- B2: bold stroke, line (575, 921.5)–(832, 925) (B2j);
- X9, the left wall, in four pieces:
  - corner column, centre 146, y 182–228;
  - bold stroke 155, y 228–548;
  - block, centre 147, y 548–592;
  - bold outer 145.5 plus thin inner face 154.5, midpoint 150, y 592–800.5;
  - joined by X9j1–X9j3, with A at (146, 182) and F at (150, 800.5).

**Balcony stub.** The black stub at x 427–505 (78 px, ≥ 0.03 L ≈ 33 src px) is a wall (B2a). The pier at x 558–576, y 922–950 protrudes 28 px from the block's face, under 0.03 L, so it is not a wall.

**Not re-traced.** I did not re-trace walls outside the brief's list. Two places read differently under the bold-plus-inner-face convention:

- the bay's right wall, upper part: bold 1121.75 with a thin line at 1115, midpoint 1118.4, against the truth's 1115;
- X5: bold 811.5 with a thin line at 803.5.

Both are within the 9.9 px exterior tolerance. The review measured them within its own reading.

**Profile check.** Every changed wall was profiled at 20/50/80 % of its length (§5).

**Metric effect.** On the same 14b code, the corrected truth scores R 0.856 / P 0.915. The reviewer's estimate was 0.844 with the corrections alone; applying the block convention raises it.

### Part B: outline closure (ruling B2)

**B1. `t_wall` for bold strokes** (`walls._wall_thickness`, `_runs`).

- `t_wall` is the length-weighted median thickness of the block and double-line pieces. Bold pieces carry a new internal source label (`SRC_BOLD`, reported as `filled`).
- In step 8, a bold stroke's `t` is `t_wall`: the 1.5 t merge, the 2.5–18 t openings and the similarity test.
- Test: `test_bold_stroke_gaps_are_measured_against_t_wall`. A 200 px gap in an 8 px outline is an opening; with the stroke width instead, there are 2 free ends.

**B2. Mixed-style bridging** (`walls._link_runs`, `_opening_line`, `_door_arc`). Runs of different styles (block, bold, double) are bridged when:

- they are in one direction group (parallel ≤ 2°);
- they are ≤ 1 t_wall apart across and the gap is ≤ 18 t_wall;
- at least one facing end is free;
- there is opening evidence in the gap's strip: either
  - ≥ 2 distinct thin lines, each within ±3° and each covering ≥ 80 % of the gap, or
  - a door swing arc: a quarter circle of radius 0.8–1.1 g about a jamb, on either run's line, with ≥ 60 % of it inked.

The bridge is:

- a raw wall with the thicker run's thickness and the whole gap as its opening;
- placed along the evidence lines' centre, or along the thicker run's line for an arc;
- plus a connector at each end where a run's line jogs from it.

Tests:

- `test_frame_lines_are_opening_evidence`: 6 cases, including one line, 70 % coverage, a duplicate line, outside the strip, off-angle, and same style;
- `test_block_and_bold_stroke_are_bridged_across_a_door`: door against no door.

**B3. The two missing bold corner pieces.** The diagnosed causes were neither the length threshold, the region nor the text mask.

- *Bottom-left* (x 146–240) and the left wall below the block. `_bold_mask` skipped a bold segment as a whole when more than half of it lay in `thick`. The HDB outline stroke's width wavers about the thick kernel, so most of the stroke was in `thick` and the rest was lost.
  - Fix: draw every stretch outside `thick` that is at least as long as the stroke is wide.
  - Test: `test_bold_stroke_partly_in_thick_keeps_its_stretch_outside`.
- *Top-right* (x 1122, y 115–182). LSD's right edge runs along both the bold stroke and the black block below it, flush on that face. Snapped to the block's centre, the segment ran 60 px past the block. The collinear merge then absorbed the bold segment as an "edge remnant" before `_trim_to_stroke` ran.
  - Fix (`segments._raster_segments`): wide snapped segments are trimmed to their stroke before the merge.
  - Test: `test_wide_segment_does_not_swallow_the_bold_stroke_beside_it`.

**B4. False positives** (`walls._drop_dangling_extensions`).

- Rule: build the graph and take the union of its bounded faces as the outline. A graph wall with a free end, its midpoint outside the outline, that runs along an extension line is cut out of its raw walls.
  - An extension line is a thin segment touching a dimension tick; this is R6's own definition, `wall_candidates.touches_tick`, whatever it overshoots.
  - "Runs along" means within 3° and the wall's thickness across, over at least half of its length.
  - The rule repeats once, for chains.
- Effect on the two cases:
  - x ≈ 1175 (normalized): a pair of top-chain extension lines 9 px apart that overshoot 20 px past the chain. `is_extension` caps the overshoot at 3 t_thin. They pair, and the bay keeps them in the envelope.
  - The stub below the balcony, x ≈ 780 (normalized): the bottom chain's extension lines continuing B1.
- Test: `test_extension_lines_outside_the_outline_are_no_walls` (dimension against no rule).

**B5. Fixes the rules above exposed.** These are deviations for spec 19, §4.

- *Gap strip* (`_gap_is_empty`, `GAP_BAND` 0.45 t). Once B3 separated the column and block segments, step 8 recorded an opening between the collinear column and block, across the bold wall drawn 7 src px beside their line. The emptiness test only read the centre line; it now reads lines ±0.45 t (thinner wall) across.
  - Test: `test_jogged_wall_between_two_collinear_blocks_is_no_opening`. With the band set to 0 the phantom opening is back.
- *End connector* (`_close_end`). A path whose dropped tail curls into a junction is extended to the projection of the end node. When the node lies more than 0.5 t beside the piece's line, as at the HDB black wall's L-shaped cap, a connector to the node keeps the junction. Before, the junction held only while `t_median` (and so the snap radius) was large enough.
  - Test: `test_wall_ending_beside_a_black_blocks_centre_line_keeps_its_junction` (with and without).
- *Jog link* (`_link_runs`, kind `jog`). Two free ends ≤ 1.5 t apart along their line, with lines ≤ 0.5 t of the thicker wall apart across (but more than step 8's 0.5 t of the thinner), are joined by a connector, as `_join` does. This is the HDB bedroom-1 wall entering the black wall's foot.
  - Test: `test_partition_ending_in_an_offset_block_joins_it`.
- *Coincident nodes* (`graph._merge_coincident`). Node placement put the two nodes of a short jog connector on one point: x came from the vertical wall and y from the connector. `_assemble` dropped the zero-length wall but kept both nodes, so the walls on either side each kept a free end at the same point. That was the last HDB outer-cycle break. Nodes joined by a zero-length wall now become one node.
  - Test: `test_nodes_placed_on_one_point_are_one_node`. It gives 4 free ends on the old `graph.py`.

### Part C: review fixes

- **`region._groups`** is a sweep over boxes sorted by x0, with no n × n arrays, and polls `check_deadline` every 64 boxes. Tests:
  - equality with the all-pairs rule on 300 random boxes;
  - 2500 components grouped in < 3 s;
  - an expired deadline raises.
- **`_solid_envelope`** test: `test_double_line_plan_with_one_solid_column_keeps_its_exterior_walls`, which discriminates via `ENVELOPE_MIN_COVER` = 0.
  - **Finding:** `detect_plan_region` collapses such a plan's region onto the column. Its only thick or bold stroke is the column (06 §7.6 step 7, R4). The test therefore gives the region as the whole page. See concern 2.
- **`_wall_face_dims`** (as Task 14b left it) does re-admit real dimension lines: on HDB, the 3200 (bedroom 2), 3100, 3500 and 7600 | 3100 lines.
  - Test `test_dimension_line_beside_a_partition_is_readmitted_but_makes_no_wall` shows the common case is harmless: one pair per stretch keeps the face with its own partner.
  - The harmful case remains on HDB: I13 pairs with the 3200 line because its own partner face is cut by the door frame (§6).
- **`_trim_to_stroke`** docstring now says it trims the ends only.
- **`extract_walls`:** `ink` is a required keyword (R6) and `tokens` is removed, because no rule reads it. Callers and tests are updated: the harness and `test_segments_walls`.
  - The harness passes walls only `detect_segments`' plan-region segments. The docstring says so.
  - There are no tokens left to filter with `in_region`.
- **`test_metrics_score_a_perfect_extraction`** loads the page instead of running the chain.
- **Strict xfails `test_p2_truth_recall_and_precision[*]` removed** (ruling B1).
  - `*.walls.json` is kept: the region tests still read its registered outer-corner landmarks.
- **`walls.py` split** into `wall_candidates.py` in its own commit, `6ac7db8`. The raw walls, masks and graphs of both images were byte-identical before and after.
  - `walls.py` has since grown back to 1,466 lines; see concern 1.

## 4. Deviations for spec 19

### 4.1 Rulings applied

**B2 (06 §8.1 step 8):**
- the bold-stroke gap thickness is `t_wall`;
- mixed-style bridging with opening evidence, a bridge along the evidence centre, and jog connectors;
- the thresholds: 2 lines, ±3°, 80 % coverage, an arc of radius 0.8–1.1 g covered 60 %, and an evidence strip of 0.75 max(t, t_wall) beyond the runs' lines.

**Ratified Task 16b design changes:**
1. `region` ink-link grouping (now a sweep);
2. `_solid_envelope`;
3. `_wall_face_dims` (defence in depth);
4. one pair per stretch on either side;
5. `_join`;
6. `_trim_to_stroke`.

**Truth convention:** the controller's centre-line convention (Part A).

### 4.2 Deviations introduced here (my additions; please ratify or reverse)

1. **06 §8.1 step 1 (R2), per stretch.** A bold stroke is drawn where it is not in `thick`: every stretch outside `thick` at least the stroke's width long. R2 judged the stroke as a whole (at most half in `thick`).
2. **06 §7.9 step 3.** Wide snapped segments are trimmed to their stroke before the collinear merge, not only after it.
3. **06 §8.1 step 8, emptiness.** A gap is empty only if the lines up to ±0.45 t across its centre are ≤ 10 % wall each, not just its centre line.
4. **06 §8.1 step 7, end connector.** A path end whose node lies more than 0.5 t beside the kept piece's line gets a connector to the node. This generalizes ratified `_join` to path ends.
5. **06 §8.1 step 8, jog link.** Free ends ≤ 1.5 t apart along their line, and ≤ 0.5 t (of the thicker wall) apart across, are joined by a connector. This reads 06's "offset ≤ 0.5 t" with t = the thicker wall, keeping each piece on its own line.
6. **Extension lines outside the outline.** A dangling graph wall outside the bounded faces' union, along a thin line touching a dimension tick (R6's definition, no overshoot limit), is cut out of the raw walls.
7. **06 §8.1 step 9, graph.** Nodes placed on one point are merged (`_merge_coincident`).

### 4.3 Metric definition (harness, `tests/support/reference.py`)

**`outer_cycle_free_ends(graph, truth)`** counts the extracted graph's free ends lying within 0.5 t of an outer-outline truth wall. An outer-outline truth wall is one that lies along the boundary of the union of the truth's faces.

Task 16b's definition counted the free ends of every wall *touching* the boundary of the extracted faces. That count includes:

- legitimate stubs drawn outward, such as the HDB balcony's black stub, a truth wall under the convention;
- partitions dangling into rooms.

**Both truths fail the old definition:** the HDB truth scores 2 and the brochure truth 1. The new definition scores both truths 0, and 2 when one outer wall is removed: `test_outer_cycle_metrics_score_the_truth`.

I added `enclosed_share`: the share of the truth's dwelling area that the extracted faces cover. It makes "the outline closes" a positive check, alongside the free-end check. I report both definitions' values in §1.

This is a change to an acceptance metric. I believe it corrects a defect and does not loosen anything: the old metric could not reach 0 even for a perfect extraction. Please confirm.

### 4.4 Tests

`test_hdb_outline_is_closed_and_rooms_are_faces` is split:

- `test_hdb_outline_is_closed` passes: 0 outer free ends and ≥ 95 % enclosed;
- `test_hdb_rooms_are_faces` (≥ 7 faces) stays a strict xfail with the blocker as its reason.

`test_reference_dims.WALL_FLOOR` moves to the Task 16c values:

- HDB: 0.888 / 0.943 / 18;
- brochure: 0.923 / 0.865 / 18.

## 5. Profile check of the changed truth walls

**Method.** For each wall, a perpendicular profile at 20 / 50 / 80 % of its length. Each profile is the median of five profiles 1 px apart, in 0.5 px steps, ±14 px. Ink runs are gray < 200 (< 235 for the faint toilet-3 faces). Offsets are along the left normal of a→b; a run centred near 0 is on the truth line.

| Wall | Reading at 20 / 50 / 80 % | Centre vs truth |
|---|---|---|
| X1 | bold [-2.5, +3.5] at all three | +0.5 |
| X1e (to B 174) | bold [-3, +2.5] at 50 / 80 % | ≈ -0.3 |
| X2 | bold [-1.5, +4.5]; thin at +8 | bold +1.5 |
| X4 (D–T3r, x 1115) | bold [-9.5, -4]; thin at 0 | unchanged; bold-plus-thin reading +3.4 |
| X4a | block [-9.5, +11.5] | +1.0 |
| X6 (804) | faces [-4.5, -3.5] and [+4.5, +5.5] | +0.4 |
| X6b | faces around ±4.5 | ≈ 0 |
| X7a, X8b (block 796) | [-10.5, +8.5 to +11.5] | -1.0 to +0.5 |
| X7 (803) | frame lines -2 to -5 and +1.5 to +3.5 | ±1.0 |
| X8 (800.5) | bold [+1.5, +7.5]; inner face [-6, -4] | ≈ 0 |
| X9 (150) | bold [+1.5, +6.5]; inner face [-6, -4.5] | ≈ 0 |
| X9c (147) | block [-11, +10.5] | -0.3 |
| X9b (155) | bold [-2.5, +3.5] | ±0.5 |
| X9a (146) | column [-10, +10.5] | +0.3 |
| B1 | bold [-2.5, +2.5]; lines at -6.5 and -9.25 | 0 |
| B2a, B2b (912) | block [-9.5, +10] | +0.25 |
| B2 | bold [-3, +2.5]; window frame [-10.5, -7] | -0.25 |
| B3 | three-line stack | ≈ 0 |
| L1, L2 (P 927) | L1: bold [-5.5, +0.5] with inner face [+3.5, +5.5]; L2: bold [-2.5, +3] | ≈ 0 |
| I1 (to Q 299) | faces -3.25 / +5 to -3.5 / +5.25 | +0.9 to +1.3 |
| I2, I5 | faces ±4.5 | 0 |
| I12 (B–V6t) | at 80 %: faces -4 / +5.25 | +0.6 |
| I13, I13b | faces -4.75 / +4.25 | -0.25 |
| I14 (360) | top face [-4.5, -2.5]; bottom face at +5 near the ends only (door) | centre 360.5 |
| I15 | faces -5 / +4 | -0.5 |
| I16 (178), at 20 % | faces -5.75 / +3.75 | -1.0 |
| I16, at 50 % | window, no ink | – |
| I16, at 80 % | pier [-7.5, +12.5], centre +2.5 | +2.5 |
| I17 (x 299) | at 20 / 80 %: the bi-fold door's jamb lines | – |
| I17, at 5 / 95 % | faces 302.75 / 294 and 304 / 295.25 | 298.4 and 299.6 |

Raw output: `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/t16c/profcheck.txt`. Script: `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/t16c/profcheck.py`.

## 6. Blocker: rooms as faces (≥ 7)

### Why each space stays open

The outer outline is closed. The interior stays one face for these reasons:

1. **1.5 t – 2.5 t gaps.** Two collinear pieces of one style 1.5–2.5 t apart are neither merged (≤ 1.5 t) nor recorded as an opening (≥ 2.5 t), so the run ends. 06 §8.1 step 8 does not define this range.
   - HDB balcony against living: the slider's two double-line pieces at x 639 / 651 are 18.5 px apart with t = 8.
   - Brochure: the toilet window on the left outline is a 59 px gap, about 2.36 t. That is the brochure's 2 outer free ends and why the left bedroom is open.
2. **Doors at a partition's end against a perpendicular wall.** Bedroom 3 against living: I15 stops at y 573, and its door spans 573 → 480 up to I8. There is no collinear partner, so step 8 and B2 do not apply.
3. **Face lines erased under labels** (the text mask; Task 14b's B2 residual):
   - toilet 1: I1 is cut under "1900";
   - toilet 2: I11's lower face is cut under "1200", so the pair fails.
4. **Dimension lines and ticks cutting faces:**
   - I13 (toilet 3's left wall) pairs with the re-admitted 3200 dimension line, because its own partner face is broken by the toilet door frame;
   - I8 stops at the 3200 line's end tick, 25 px short of I13b;
   - I14 (toilet 3's bottom, door plus short pieces) and I16 (faint double line, window, pier) are not extracted.
5. **Store (I17):** the bi-fold door leaves wall pieces too short to pair.

### Measured with prototypes

These were not committed.

| Prototype | HDB faces | HDB other | Brochure |
|---|---|---|---|
| Committed state | 3 | outer 0 | outer free 2, enclosed 0.748 |
| **P1:** 1.5–2.5 t gaps become openings (`GAP_MIN` 2.5 → 1.5) | **5** (toilet 1, bedroom 1, balcony, recess, rest) | outer 0, R 0.890 / P 0.944 | outline closes: outer free 0, enclosed 0.99, R 0.912 / P 0.865 |
| P1 plus a partition-end door rule (arc at the free end, extend to the perpendicular wall ≤ 18 t_wall) | 5 | quick prototype; I15's arc not yet matched | – |
| Thin double-line pieces measured against `t_wall` | 4 | balcony separates | regressed: P 0.825, enclosed 0.013. Rejected |

### Proposed rulings, in order of value

- **R-a:** close 06 §8.1 step 8's 1.5–2.5 t range. Gaps of 1.5–18 t between similar walls with an empty strip become openings. Measured: HDB +2 faces; the brochure outline closes.
- **R-b:** a door at a partition's end. A free end facing a perpendicular wall within 18 t_wall, with a door swing arc at that end, is extended to the wall as an opening. This is B2's arc evidence, applied perpendicularly.
- **R-c:** text masking keeps thin line work through label boxes. This is Task 14b's B2 proposal: mask glyph ink, not the padded box. It frees toilets 1 and 2.
- **R-d:** `_wall_face_dims` should not re-admit a dimension line beside a face that has its own partner within the stretch, even a broken one. This needs analysis on I13.

**Alternatively:** accept for 16c "outline closed, walls ≥ 0.85 / 0.85". Then carry rooms-as-faces to Tasks 17 and 18:

- Task 17 can close partition-end doors and the 1.5–2.5 t openings as openings;
- 06 §8.6 builds rooms from the wall mask closed across openings, not from graph faces.

## 7. Metric history (HDB against the corrected truth)

**Columns.** Free = all graph free ends. Outer = outer-cycle free ends on the new definition, with the old count in parentheses. Enclosed = share of the truth's dwelling enclosed by faces.

| # | Change | R / P | Free | Faces | Outer | Enclosed | Brochure R / P / free |
|---|---|---|---|---|---|---|---|
| 0 | c495a09 (14b), uncorrected truth | 0.870 / 0.894 | 34 | 1 | – (2) | – | 0.924 / 0.875 / 18 |
| A | corrected truth, same code | 0.856 / 0.915 | 34 | 1 | 8 (2) | 0.113 | 0.924 / 0.875 / 18; outer 2 (7), enclosed 0.748 |
| 1 | bold stretches outside `thick` (≥ 0.04 L) | 0.873 / 0.917 | 35 | 1 | | | unchanged |
| 2 | wide segments trimmed before the merge | 0.872 / 0.917 | 35 | 0 | | | unchanged |
| 3 | gap strip test | 0.872 / 0.917 | 30 | 0 | | | unchanged |
| 4 | end connector | 0.872 / 0.918 | 31 | 0 | | | 0.924 / 0.865 / 18 |
| 5 | `t_wall` for bold, jog links, B2 bridges (strip 0.5 t) | 0.874 / 0.918 | 27 | 1 | | | unchanged |
| 6 | evidence strip 0.75 max(t, t_wall) | 0.886 / 0.920 | 23 | 2 (outline closed, with the balcony) | – (8) | | unchanged |
| 7 | bold stretches ≥ the stroke's width (recess closes) | 0.889 / 0.920 | 22 | 3 | – (8) | | unchanged |
| 8 | extension lines outside the outline cut | 0.889 / **0.943** | 20 | 3 | 2 (6) | 0.997 | unchanged |
| 9 | coincident nodes merged (final) | **0.889 / 0.943** | 18 | **3** | **0** (4) | **0.997** | **0.924 / 0.865 / 18**; outer 2 (7), enclosed 0.748 |

Notes:
- The brochure's precision drop from 0.875 to 0.865 comes from the step-4 connectors, small jogs at furniture pieces. It is above the 0.85 floor.
- No step changed the dimension metrics.

## 8. Tests and evidence

### RED

All RED runs used a temporary worktree at `c495a09`, since removed.

**`tests/test_walls_closure.py` (new, 14 cases): 14 failed.**

| Test | Failure |
|---|---|
| bold stretch | `725.6 == 1200 ± 15` |
| wide segment | `assert []` |
| jogged wall | phantom opening |
| end connector | `1 == 0` free ends |
| jog link | `2 == 0` |
| `t_wall` | `[] == [200 ± 6]` |
| door bridge | `2 == 0` |
| frame-line evidence × 6 | `AttributeError: _link_runs`, rule absent |
| extension lines outside | wall kept |

Output: `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/t16c/red-closure.txt` and `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/t16c/red-closure-detail.txt`.

**Other RED results:**

- region grouping:
  - `TypeError: _groups() takes 3 positional arguments`;
  - `DID NOT RAISE VisionError` (no deadline poll).
- coincident nodes on the old `graph.py`: distinct nodes `False`, free ends 4.

**Discriminating checks inside the GREEN tests:** each new rule's test has an "off" twin.

- `GAP_BAND = 0` brings the phantom opening back;
- `_close_end` without its connector gives free ends > 0;
- `_link_runs` stubbed gives 2 free ends;
- `_wall_thickness` returning None gives 2 free ends;
- no door gives 2 free ends;
- `_drop_dangling_extensions` stubbed keeps the wall;
- `ENVELOPE_MIN_COVER = 0` drops the exterior walls.

### GREEN

| Command | Result |
|---|---|
| `uv run pytest -q tests/test_walls_closure.py` | 14 passed |
| `uv run pytest -q tests/test_reference_walls.py` | 12 passed, 1 xfailed (`test_hdb_rooms_are_faces`, strict) |
| `uv run pytest -q tests/test_reference_dims.py` | 12 passed |
| `uv run pytest -q` (full suite) | **773 passed, 1 skipped, 1 xfailed in 110 s**, no warnings |
| `uv run ruff check .` | All checks passed |
| `uv run ruff format --check .` | 77 files already formatted |
| `uv run mypy app` | no issues in 48 source files |

## 9. Files

**App code:**

- `vision/app/pipeline/wall_candidates.py` (new, split out): `touches_tick`.
- `vision/app/pipeline/walls.py`:
  - bold label and style;
  - per-stretch bold;
  - `t_wall`;
  - gap strip;
  - `_close_end` connector;
  - `_link_runs` (jogs and bridges);
  - `_drop_dangling_extensions`;
  - `ink` required, `tokens` gone.
- `vision/app/pipeline/segments.py`: trim before the merge; `_trim_to_stroke` docstring.
- `vision/app/pipeline/graph.py`: `_merge_coincident`.
- `vision/app/pipeline/region.py`: sweep grouping and deadline polls.

**Tests and fixtures:**

- `vision/tests/fixtures/reference/hdb-3room.drawing-walls.json`: Part A and the `method` note.
- `vision/tests/support/reference.py`: `truth_outline`, `free_end_points`, `outer_cycle_free_ends(graph, truth)`, `enclosed_share`; no tokens.
- `vision/tests/test_walls_closure.py` (new).
- `vision/tests/test_reference_walls.py`, `test_reference_dims.py`, `test_segments_walls.py`, `test_preprocess.py`, `test_graph.py`.

**Not touched:**

- `dimension*.py`;
- `*.drawing-dims.json`.

**Debug PNGs** (`/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/t16c/`):

- `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/t16c/hdb-3room-final-02-walls.png`
- `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/t16c/hdb-3room-final-graph.png`: faces green, free ends red, openings yellow.
- `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/t16c/brochure-2bhk-final-02-walls.png`
- `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/t16c/brochure-2bhk-final-graph.png`
- `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/t16c/truth.png`: the corrected truth over the source.
- the `-p1-` and `-p3-` files: the prototypes.

## 10. Concerns

1. **`walls.py` is 1,466 lines again.** It was 1,075 after the split; step 8, the linking and the outline rule added about 390 lines. A further split needs a plan decision, for example `wall_runs.py` for step 8 plus linking, and `wall_trace.py` for steps 6–7.
2. **Region collapse on double-line plans with few solid walls.** In a double-line plan with one solid column, `detect_plan_region` (thick ∪ bold) returns the column's box, and the exterior walls are lost. This predates Task 16c (06 §7.6 step 7, R4). The envelope test works around it by giving the region. It needs its own ruling or task.
3. **The outer-cycle metric definition changed** (§4.3). Please confirm.
4. **`ext.mask` still holds the dropped extension-line pairs.** Only the raw walls and graph lose them. If Task 18 builds rooms from the mask, the pairs are outside the outline and touch nothing, but they are still there.
5. **Brochure precision fell 0.875 → 0.865** (connectors). It is still ≥ 0.85.
6. **Truth judgement calls for an independent look:**
   - the X8 and X9 inner-face reading (bold + thin = wall faces);
   - the pier rule (a 28 px protrusion is not a wall);
   - X4's upper part and X5 left at the bold stroke, not the bold-plus-inner-face midpoint.

---

# Continuation: controller rulings on the NEEDS_CONTEXT

**Status: NEEDS_CONTEXT, for R-c only.** Everything else from the rulings is implemented and committed in `36b0753` (pushed). The new 16c acceptance is met. R-c is not included: every variant I measured regressed the dimension stage or the brochure walls, and none of them recovered a wall (C3).

## C1. Rulings implemented

**R-a: gaps of 1.5–2.5 t become openings.**
- **Why the run ended there:** `walls._runs` merged gaps ≤ `MERGE_GAP` (1.5 t) and recorded openings only from `GAP_MIN` (2.5 t). Anything in between fell to the `else` branch and ended the run. `graph._merge_overlaps` already records bridged gaps ≥ 1.5 t as openings (`_MIN_GAP_OPENING`).
- **Fix:** `GAP_MIN = MERGE_GAP`, so the two stages agree.
- **Test:** `test_gap_width_limits` now has the 26 and 32 px cases (t = 14) as openings. Both failed on 9ebdfeb.
- **Effect:** HDB toilet 1 and the balcony become faces, and the brochure outline closes (toilet window).
- **Deviation from 06 §8.1 step 8** (2.5 t → 1.5 t), for spec 19.

**Dimension lines cutting faces.** There were two causes, both in the walls stage.
1. *The "3200" line survived as a wall piece.* `wall_face_dims` (ratified as defence in depth) re-admitted the segments of dimension lines that pair with a face beside them as wall candidates. On HDB that is four lines: 3200 (bedroom 2), 3100, 3500 and 7600 | 3100. The upper copy of the 3200 line then paired with toilet 3's face 975.75.
   - **Fix:** `candidate_segments` never admits a dimension line's segment, or a collinear copy of it. For the dimension lines in `faces`, only the extension-line exclusion is skipped, so a face touching their tick is not cut.
   - **Tests:** `test_line_taken_for_a_dimension_line_is_never_a_wall_piece` and `test_extension_lines_of_a_dimension_line_beside_a_face_are_kept`.
   - The old `test_wall_face_taken_for_a_dimension_line_stays_a_wall` is replaced. Under the ruling, a partition face misdetected as a dimension line loses its partition. With Task 14b's precision of 0.957, that trade is the ruling's.
   - **Effect:** HDB precision rose from 0.944 to 0.963.
2. *The line's end tick cut both faces of I8* (bedroom 2's bottom) at x 956. LSD split each face there. The pieces measure 1.9 against 3.8 px wide, so the collinear merge (width ratio ≤ 1.5) kept them apart, and the pair ended 25 px short of I13b.
   - **Fix:** `wall_candidates._rejoined` runs in `double_mask` and receives every dimension line's end points. A thin piece with an end within 3 t_thin of a dimension line, plus its collinear neighbours (overlapping or ≤ 3 t_thin apart), is fused regardless of width.
   - **Test:** `test_face_lines_cut_by_a_dimension_line_are_rejoined`.
   - **Effect:** I8 is now fully matched.
   - **Deviation:** a walls-stage rejoin, for spec 19.

**Concern 4: the plan region on double-line plans.**
- **Fix:** `binarize.double_line_strips` finds the strips between pairs of long (≥ 0.03 long edge) parallel thin lines that are ≤ 0.02 long edge apart (horizontal and vertical, morphological), and adds them to the region's wall pixels.
- **Filter:** only strips joined into structures spanning ≥ 0.1 long edge both across and down count. A lone straight pair (extension lines, stacked chains) does not. Without this filter, the HDB region grew to the whole page and the brochure region to the sheet top, dropping brochure precision to 0.850.
- **Tests:**
  - `test_region_of_a_double_line_plan_with_one_column_holds_the_plan` checks that the R4-only rule gives the column's box;
  - `test_lone_double_line_strip_does_not_grow_the_region`;
  - the envelope test no longer forces the region, and the `run(..., region=)` override is removed.
- **Effect:** the HDB region height went from 1473 to 1498. Walls and dims are unchanged by it.
- **Deviation from 06 §7.6 step 7 and R4**, for spec 19.

**Concern 6.** The judgement calls are in `method.judgement_calls` of the HDB truth: X8/X9 inner face, the pier rule, X4/X5, and B2's window frame.

**Tests.**
- `test_hdb_rooms_are_faces` (≥ 5) passes.
- `test_hdb_seven_rooms_are_faces` (≥ 7) is a strict xfail with the reason "Task 18 acceptance target".
- `test_brochure_outline_is_closed` requires 0 outer free ends and ≥ 95 % enclosed.
- `WALL_FLOOR` is now 0.892 / 0.962 / 9 (HDB) and 0.911 / 0.865 / 17 (brochure).

## C2. Final metrics (`36b0753`)

| Metric | HDB | Brochure | Target | Met? |
|---|---|---|---|---|
| Recall / precision | **0.892 / 0.963** | **0.912 / 0.865** | HDB ≥ 0.85 / 0.85; brochure ≥ 0.90 / 0.85 | Yes |
| Outer-cycle free ends (truth outline) | **0** | **0** | 0 / 0 | Yes |
| Enclosed share | 0.997 | 0.990 | – | – |
| Bounded faces | **5** | 3 | HDB ≥ 5 | Yes |
| All free ends | 9 | 17 | – | – |
| Dims: recall / precision / spans / labels | 0.833 / 0.957 / 0.938 / 0.872 | 0 lines | no regression | Yes (unchanged) |
| Full chain | 1.2 s | 0.6 s | < 10 s | Yes |

The outer-cycle counts on Task 16b's definition are HDB 3 and brochure 7.

**HDB faces:**
1. toilet 1, (297, 181)–(418, 364);
2. bedroom 1, (368, 181)–(648, 480);
3. the rest as one face: living, kitchen, store, toilets 2 and 3, bedrooms 2 and 3, and the bay, (145, 116)–(1123, 810);
4. the balcony, (505, 796)–(833, 924);
5. the 600 recess, (833, 803)–(891, 923).

**Still missed (HDB):**
- I11, toilet 2's bottom: its faces are broken in the ink itself under the "1200" label (C3);
- I12/I13, toilet 3's left wall: a door-frame line 4.5 px from face 985 pairs with it first and claims the stretch;
- I14 and I16 (toilet 3);
- I15's door, which belongs to Task 17;
- I17 (the store's bi-fold door).

**Brochure:** recall fell from 0.924 to 0.912. W23 is now 60 % missed: it becomes an opening under R-a.

## C3. R-c (glyph-only text mask): measured, not committed

**Implementation tried.** `text_mask(shape, tokens, ink)`: inside each token box (grown 2 px), mask the ink minus straight horizontal or vertical strokes ≥ k text heights long, grown 2 px. Line pixels were kept even where glyphs touch them. The same mask went to LSD painting, `ink_notext` and the replay.

| Variant | HDB walls R / P / faces | Brochure walls R / P | HDB dims R / P / spans / labels |
|---|---|---|---|
| box mask (committed) | 0.892 / 0.963 / 5 | 0.912 / 0.865 | 0.833 / 0.957 / 0.938 / 0.872 |
| glyph mask, k = 1.5 (also k = 2.5, 4, 8) | 0.892 / 0.963 / 5 | 0.912 / **0.831** | **0.792** / 0.952 / **0.857** / **0.825** |
| glyph mask for LSD only, box for `ink_notext` | same | 0.912 / **0.831** | **0.792** / 0.909 / 0.857 / 0.825 |
| box for LSD, glyph for `ink_notext` | same | 0.912 / 0.865 | 0.833 / **0.917** / 0.938 / 0.872 |
| box minus long strokes (k = 1.5 / 3) | same | 0.912 / 0.857 | **0.750** / 0.955 / 0.891–0.913 / 0.838–0.865 |

Lost dimension lines: 11000 and 11100 (top and bottom overall), and the top chain's first ticks.

**Why it does not help the walls.**
- Even with k = 8, where almost nothing counts as a line, the dims regress. The cause is masking glyph ink rather than the whole box: glyph fringes outside the Sauvola ink stay in the gray image LSD reads. Task 14b's chaining expects text boxes to be blank. `dimension*.py` is outside my files.
- The target wall gains nothing. Toilet 2's faces under "1200" are faint and already broken in the Sauvola ink between x 686 and 714 (`/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/t16c/tm-t2.png`). No straight-stroke test recovers them, and no HDB face was gained in any variant.

**Proposed ruling R-c′.** Drop R-c from 16c, and carry text-mask refinement to a segments/OCR task. Possible approaches:
- glyph pixels from the gray image (darker than the local paper), not Sauvola ink;
- restore faint face lines under labels by gray-level continuation from both sides of the box.

In either case the work would be measured against the 14b dimension floors and would include a `dimension*.py` review. Alternatively, accept the dimension regression in the table above. I do not recommend that.

## C4. Tests and evidence

**RED.** These are the new tests, run on `9ebdfeb` in a temporary worktree (since removed): **10 failed.**
- both region tests;
- `test_gap_width_limits[26-1]` and `[32-1]`;
- the never-a-wall test and the extension-kept test;
- the envelope test without a forced region;
- the rejoin test;
- `test_hdb_rooms_are_faces`: `assert 3 >= 5`;
- `test_brochure_outline_is_closed`.

Output: `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/t16c/red-cont.txt`.

**GREEN.**

| Command | Result |
|---|---|
| `uv run pytest -q` | **779 passed, 1 skipped, 1 xfailed in 118 s** (the xfail is the strict Task 18 target) |
| `uv run ruff check .` | All checks passed |
| `uv run ruff format --check .` | 77 files already formatted |
| `uv run mypy app` | no issues in 48 source files |

## C5. Deviations added for spec 19

1. 06 §8.1 step 8: gap candidates from 1.5 t (R-a).
2. Walls stage: a dimension line's own segment is never a wall candidate; `wall_face_dims` only keeps its extension lines.
3. Walls stage: thin face lines cut by a dimension line are rejoined before pairing, whatever their widths.
4. 06 §7.6 step 7 / R4: the plan region also counts double-line strips in two-way structures.

---

# Fix round 1 (review `task-16c-review.md`)

Base `12a2298` (the 14b fix round). `dimension*.py` and `*.drawing-dims.json` are untouched.

## F1. Changes, by finding

**I1: no mixed-style bridge without evidence** (the reviewer's prototype, adopted).
- `_runs` judges a gap on the drawn thicknesses when the two neighbours differ in style and one is bold (`_gap_thickness`).
- `_is_opening` returns False for mixed styles, so step 8 never bridges them. Such gaps go to `_link_runs`, which bridges only with frame-line or door-arc evidence.
- Tests:
  - `test_mixed_styles_are_not_bridged_across_a_plain_gap`: bold + double at offsets 0 and 4 px, block + bold, block + double, each across a plain 165 px gap; all give 2 free ends and no bridge;
  - `test_same_style_bold_strokes_are_bridged_across_a_plain_gap` is the control.

**I2: plan region from double-line strips.** In `binarize.double_line_strips`, a strip component now counts only when:
- it touches a thick or bold wall component and lies inside that component's bounding box; or
- it spans ≥ 0.1 L both ways (a structure of strips);

and in both cases it must not be a periodic grid. `_is_grid` reads a grid as lines across ≥ 50 % of the structure, with ≥ 3 consecutive cells of equal pitch (within 15 %) in both directions.

The reviewer's counter-cases (`cc_region.py`, a patched copy for the new signature):

| Page | Filled plan | Double plan |
|---|---|---|
| plan alone | (138, 238, 1024, 824) | (140, 240, 1024, 824) |
| + 40 px table | plan | plan (was the table) |
| + 30 px tiled terrace | plan (was grown to x 1793) | plan |
| + 45° hatch | plan | plan |

The HDB and brochure regions are unchanged: HDB (118, 81, 1709, 1498), 21 dimension lines. Test: `test_grids_and_hatching_do_not_become_the_plan_region` (table, terrace and hatch × filled and double).

**I3: `_rejoined` performance.**
- Seeds are pieces with an end within 3 t_thin of a dimension line.
- Partners come from a direction-bucket (2°, ±1 bucket) and rho-sorted index (`searchsorted`), with vectorized collinearity and overlap checks.
- It polls the deadline every 64 seeds, and `merge_collinear` receives the poll. `_continues` is removed.

| Thin segments | Before (reviewer) | Now |
|---|---|---|
| 2,400 | 5.4 s | 0.04 s |
| 6,000 | 38 s | 0.18 s |
| 11,500 | 141 s | 0.30 s |

Test: `test_rejoining_many_thin_lines_is_fast_and_polls_the_deadline` (11.5k segments, ≤ 0.5 s, poll called).

**I4: door-arc evidence.** `_door_arc` looks in the quadrant between the closed and open leaf about each gap end, within 3° of neither leaf and at radii of 0.80–1.20 g. Each connected component there is fitted with a trimmed algebraic circle. A component is an arc when:
- its RMS residual is ≤ 1 px over ≥ 60 % of its pixels;
- the radius is 0.85–1.15 g;
- the centre is ≤ 0.5 t (+ 2 px) from the gap end;
- its inliers cover ≥ 60° with breaks of ≤ 4°.

Hatching gives separate straight strokes that fit no such circle. A tile grid is one lattice component whose pixels mostly miss any circle.

Test: `test_door_arc_evidence_is_one_thin_curve`, all on block + double with a 150 px plain gap:
- 9 px 45° hatch: not bridged;
- 12 px tile grid: not bridged;
- real door, leaf plus quarter arc: bridged.

**Minor 1** (accepted consequence of the ruling): a partition whose face is misread as a dimension line loses the whole partition. Carried to the **Task 34 residuals**.

**Minor 2.** The sweep test now uses a 6000 × 6000 page with 1,600 squares at a 150 px pitch, more than the 61 px closing apart. A spy on `region._groups` asserts that it really receives 1,600 components, and the deadline assertion is kept.

**Minor 3: the W23 explanation, corrected.** The Continuation's account (C2, "W23 … becomes an opening under R-a") was wrong.
- The raw walls near W23 are identical under `GAP_MIN` 1.5 and 2.5.
- R-a turns the brochure's left toilet *window* into an opening. That lowers `t_median` from 27.66 to 26.0, which shortens graph-building's free-end reach and prune length.
- The 49 px double-line piece at page x 578, y 517–566 then no longer reaches the wall below, and is pruned with its connector.
- So W23 survives or not depending on an opening elsewhere on the sheet. That is a fragility of the global `t_median`.
- Proposed for Task 17/18: measure `t_median` without opening spans, or extend free ends by their own thickness. Not changed here.

**Minors 4–6: truth fixes,** profile-checked on the page at 20 / 50 / 80 % with `profcheck.py`. Truth faces stay at 11.
- **I12** follows its face pair (faces −5 / +4.5 about y 178, at 20 / 50 / 80 %): jog I12j from B (174) to B0 (938, 178), then I12 from B0 to V6t at y 178.
- **Pier,** measured from the block's centre line like B2a and every other truth wall: 38 px, which is ≥ 0.03 L (33 px), so it is a stub. B2 is split at Mp (567, 912), and B2p runs Mp → Mq (567, 950), black, at a pier centre of 566.5. The method note now says stubs and piers are "measured from the centre line".
- **X4** is read like X8/X9: bold stroke 1121.75 plus the thin inner line 1115.25 gives a centre of 1118.4.
  - X4 runs D (1118.5, 115) → D2 (1118.5, 171).
  - X4j is the jog to D3 (1115, 171).
  - X4c (black) continues D3 → T3r.
  - The thin line at 1103 is still read as the 1300 dimension's extension line.
- `judgement_calls[1]` and `[2]` are updated, and `task_16c_fix_round_1` is added to the fixture's method note.

**Minor 7: `walls.py` cleanup.**
- Step-8 items are `_Item`, a frozen dataclass (s0, s1, off, t, t_gap, source, style, free0, free1). `_Run` holds `_Item` members and one length-weighted `_mean`, used by `offset()`, `thickness()` and `wall()`. `_Member` and `_mean_offset` are gone.
- `_trace_raw_walls`' `thin` and `ink` are required.
- `_drop_dangling_extensions` returns its final graph. `WallExtraction.graph` / `graph_region` cache it, and `walls_to_graph` reuses it when the region matches. This was checked equal to a fresh build on both images.

## F2. Metrics (fix round 1)

| Metric | HDB | Brochure | Floor | Holds? |
|---|---|---|---|---|
| Walls recall / precision | **0.889 / 0.963** | **0.912 / 0.865** | HDB ≥ 0.85 / 0.85; brochure ≥ 0.90 / 0.85 | Yes |
| Outer-cycle free ends | **0** | **0** | 0 | Yes |
| Bounded faces | **5** | 3 | HDB ≥ 5 | Yes |
| All free ends | 9 | 17 | – | – |
| Enclosed share | 0.997 | 0.990 | – | – |
| Dims R / P / intervals / labels / ticks | 0.833 / 1.000 / 0.979 / 0.923 / 0.985 / 0.932 | 0 lines | unchanged | Yes |
| Non-OCR chain | 1.5 s (walls 0.18 s) | 1.5 s (walls 0.80 s) | < 10 s | Yes |

**HDB recall, 0.892 → 0.889.** The truth fixes caused this, not the pipeline: the same graph scores 0.8920 / 0.9628 against the pre-fix truth and 0.8893 / 0.9628 against the corrected one. The extra truth length is the pier stub B2p (0.63 missed) and the re-centred I12 (0.85 missed). `WALL_FLOOR["hdb-3room"]` in `test_reference_dims.py` is now (0.889, 0.963, 9).

**Brochure walls stage, 0.11 → 0.80 s.** The circle fits in `_door_arc` add this. It is well inside budget.

## F3. Tests and evidence

**RED.** The new and changed tests, run on `12a2298` in a temporary worktree (since removed): **18 failed, 37 passed.**
- Behavioural failures:
  - the 4 mixed-style cases (2 free ends expected, a bridge found);
  - hatch and tiles (`True is False`, bridged);
  - the 4 region cases (region = the table, `Rect(1424, …)`, or grown to x 102–1793);
  - rejoin (`_rejoined` takes no poll; 141 s at this size per the review).
- The other 7 fail on the new internal API: `_Item`, and `_drop_dangling_extensions` returning a tuple.

**GREEN.**

| Command | Result |
|---|---|
| `uv run pytest -q` | **814 passed, 1 skipped, 1 xfailed** (the strict Task 18 ≥ 7-faces target) in 127 s |
| `uv run ruff check .` | All checks passed |
| `uv run ruff format --check .` | 77 files already formatted |
| `uv run mypy app` | no issues in 48 source files |

## F4. Deviations added for spec 19

1. 06 §8.1 step 8: neighbours of different style, one of them bold, are never a step-8 opening. Their gap is judged on drawn thickness and left to B2's evidence gate (I1).
2. 06 §7.6 step 7 / R4: double-line strips count toward the plan region only when they are inside a wall component, or form a ≥ 0.1 L two-way structure, and are not a periodic grid (≥ 3 consecutive equal-pitch cells within 15 % both ways) (I2).
3. B2 door-arc evidence is a single connected stroke fitting a circle: RMS ≤ 1 px over ≥ 60 % of its pixels, r 0.85–1.15 g, centre ≤ 0.5 t + 2 px from the gap end, ≥ 60° covered with breaks ≤ 4°. The leaves (±3°) are excluded (I4).
4. Truth convention: stub and pier lengths are measured from the centre line (Minor 5).

---

# Fix round 2 (re-review `task-16c-rereview-1.md`)

Base `bdef4a0`. `dimension*.py` and `*.drawing-dims.json` are untouched. Every one of the reviewer's counter-case scripts in `rv16c/work/` is now a test (see F2-3).

## F2-1. Changes

**I2: plan region from double-line strips** (`binarize.double_line_strips`).
- **Solid wall drawing on the page** (thick ∪ bold, a component ≥ 0.1 L long): a strip structure counts only when it touches that drawing, inside its bounding box. The "both-ways structure" exception for unconnected strips is gone.
- **No solid drawing** (a pure double-line plan): the largest strip structure that is wider than one strip both ways and is not a table counts, plus the structures and straight strips meeting its box. `_is_table` rejects a structure when either:
  - its strips fill ≥ 50 % of its box (every row of a table is a strip; walls enclose rooms much wider than themselves); or
  - ≥ 50 % of its cell area holds text.
- Periodic-grid rejection (`_is_grid`) is kept in both cases.
- **Deviations:**
  - "Any solid strokes" means a solid component ≥ 0.1 L long. The re-review's own counter-case, a double-line plan with a single 40 px column, collapsed the region onto the column when read literally (`Rect(313, 313, 54, 134)` for every n × n plan).
  - The text test cannot use OCR tokens: OCR reads the annotation region, which is derived from the plan region, so tokens do not exist yet. Text is read from the ink instead: glyph-sized components (≤ the strip gap) clear of the table lines, counted per cell.
- **Residual:** an *empty* table whose strips fill under half its box, larger than a pure double-line plan, still wins. The test shows this as its discriminating case. With text in it, the plan wins.

**N1: door arcs** (`_door_arc`, `_arc_votes`, `_fit_circle`, `_arc_holds`).
- Arcs are read on the thin ink: `filled` (block and bold), dilated 5 × 5, is removed, so the jamb block cannot merge with the arc.
- **Deviation:** arcs are read on the *page's* thin ink (`origin` threads the crop offset), not the crop. That keeps the whole swing of a door opening out past the region's 0.06 L margin.
  - On the crop alone, the score was 20/24: four 220 px outward swings keep only about 33° inside the region.
  - The old 21/24 needed a region inflated by dimension-chain strips. The old strip rules grow the double-plan case to h 1614 against 1437.
  - The 60 % coverage is taken over the samples inside the image, so a cut arc still counts on its visible samples.
- **Acceptance:**
  - ≥ 60 % of the samples are arc: ink within 2 px of the radius, and paper 5 px inside and outside it (hatching and tiles fail this);
  - ≥ 45 contiguous degrees, with breaks of at most 2 samples;
  - radius 0.85–1.15 g, centre ≤ 0.5 t + 2 px from the jamb.
- **Results:**
  - reviewer's door sweep (`cc_doors.py`): **24/24**, up from 15/24 (the floor is 21);
  - negatives: hatch 9 px, tiles 12 px, grid 24 px, sofa and ground lines all stay unbridged;
  - `test_block_and_bold_stroke_are_bridged_across_a_door` is back to `side=-1`, and both sides pass.

**N2: arc-check performance.**
- **O(gap) scoring.**
  - 85 rays (1° steps, 3° clear of each leaf) are read from the jamb out to 1.15 g + 0.5 t.
  - Each thin ink run (≤ 6 px) votes for radii about a grid of hinge offsets (≤ 9 × 9, window matched to the grid step).
  - The voters of the 3 best offsets are fitted with a circle: a quarter arc leaves the offset along its bisector ambiguous to votes alone.
  - Each fit is scored along its own circle.
- **Caching.** Results are cached per (jamb, side, gap); identical jamb points are read once.
- **Deadline.** `_link_runs` polls the deadline before each bridge candidate.
- **Per candidate (8 arc reads):**

  | Gap | Reviewer `arc_time.py` (2 % noise, t 30) | Dense 9 px hatch, t 30 | Dense 9 px hatch, t 55 |
  |---|---|---|---|
  | 150 px | 0.01 s (was 0.07) | 0.020 s | 0.024 s |
  | 340 px | 0.01 s (was 0.21) | – | – |
  | 540 px | 0.01 s (was 0.51) | 0.054 s | 0.044 s |
  | 1000 px | **0.03 s (was 2.86)** | 0.083 s | 0.084 s |

- The brochure walls stage is back to **0.11 s** (it was 0.63–0.80 s).

**N3.** The rejoin perf assert is now ≤ 0.5 s.

## F2-2. Metrics

| Metric | HDB | Brochure | Floor | Holds? |
|---|---|---|---|---|
| Walls recall / precision | **0.889 / 0.963** (0.8892 / 0.9628) | **0.912 / 0.865** | HDB ≥ 0.889 / 0.963; brochure ≥ 0.90 / 0.85 | Yes |
| Outer-cycle free ends | 0 | 0 | 0 | Yes |
| Bounded faces | 5 | 3 | HDB ≥ 5 | Yes |
| All free ends | 9 | 17 | – | – |
| Dims R / P / intervals / labels / ticks | 0.833 / 1.000 / 0.979 / 0.923 / 0.985 / 0.932 | 0 lines | unchanged | Yes |
| Walls stage / non-OCR chain | 0.17 s / 1.4 s | 0.11 s / 0.6 s | < 10 s | Yes |
| Plan region | (118, 81, 1709, **1473**) | (131, 150, **1212**, 1082) | – | – |
| Door sweep (reviewer's 24) | 24 / 24 | – | ≥ 21 | Yes |

**Plan regions.** The HDB region lost 25 px at the bottom, and the brochure region 2 px at the right. Both came from unconnected strip structures, which no longer count. HDB recall moved from 0.8893 to 0.8892, which still rounds to the 0.889 floor.

## F2-3. Tests and evidence

**New tests.**

`test_walls_closure.py`:
- `test_block_and_bold_stroke_are_bridged_across_a_door[-1, 1]`;
- `test_real_doors_between_a_block_and_another_style_are_bridged`: all 24 must bridge;
- `test_furniture_and_ground_lines_are_no_door_evidence[grid24, sofa, ground]`;
- `test_door_arc_check_costs_little_per_candidate_at_a_1000_px_gap`: ≤ 0.15 s;
- `test_bridge_candidates_poll_the_deadline_each`.

`test_preprocess.py`:
- `test_tables_with_uneven_rows_do_not_become_the_plan_region[title-block, schedule × filled, double]`;
- `test_a_double_line_plan_wins_over_a_table_with_text`;
- `test_regular_double_line_plans_hold_the_region[2, 4, 6 × column]`.

**RED** on `bdef4a0` (temporary worktree, since removed): **9 failed, 64 passed**.
- the `side=-1` door;
- the 24-door sweep;
- arc perf;
- per-candidate poll;
- the 4 uneven-table cases;
- the text-table case.

The regular-plan cases pass there too; they are regression guards.

**GREEN.**

| Command | Result |
|---|---|
| `uv run pytest -q` | **832 passed, 1 skipped, 1 xfailed** in 149 s |
| `uv run ruff check .` | All checks passed |
| `uv run ruff format --check .` | 77 files already formatted |
| `uv run mypy app` | no issues in 48 source files |

## F2-4. Deviations added for spec 19

1. 06 §7.6 / R4: double-line strips count toward the plan region only when they touch a solid wall drawing (≥ 0.1 L), inside its box. Without one, the largest non-table, non-grid structure counts, plus what meets its box. A table is strips filling ≥ 50 % of their box, or cells ≥ 50 % holding glyph-sized ink.
2. B2 arc evidence uses 1° ray samples about voted and circle-fitted hinge offsets (≤ 0.5 t + 2 px), on the page's thin ink with solid strokes removed. It needs ≥ 60 % of in-image samples to be thin ink with paper ±5 px, ≥ 45 contiguous degrees, and r 0.85–1.15 g.

---

# Fix round 3 (re-review `task-16c-rereview-2.md`)

Base `29436f2`. N1–N3 and the page-wide arc reading were approved and are unchanged. `dimension*.py` and `*.drawing-dims.json` are untouched.

## F3-1. Changes

**R2-1: the region is chosen per structure** (`region.detect_plan_region`, `binarize.strip_structures`). This supersedes F2-1.
- **Candidates.** Drawings of solid strokes (thick ∪ bold) and drawings of free double-line strip structures. Each kind is grouped as before: 0.02 L closing, 0.05 L proximity, shared-ink links.
- **Attached strips.** A strip structure touching a solid component (inside its box) merges into that drawing: it adds mass but no extent.
- **Free strips.** Free strip structures are candidates of their own when they are:
  - wider than one strip both ways;
  - not a grid;
  - not a table.

  Straight strips meeting such a structure join it.
- **Main plan.** The main plan is the drawing with the most wall mass. The per-page solid/double switch is gone. Insets are excluded and warned as before (30 % share).
- **Deviation 1: wall mass is wall pixels, not wall-candidate length.**
  - Wall pixels are solid stroke pixels plus strip pixels, i.e. centre-line length weighted by drawn thickness.
  - With length as ruled, the reviewer's title-block frame (perimeter about 4200 px) outweighed the filled synthetic plan (centre lines about 3900 px). The region went to the frame (1607, 7, 787, 1687), a regression from round 2.
  - With pixels, every case holds: a 6 px stroke is narrower than a wall.
- **Deviation 2: a strip drawing around a solid plan is not a candidate.** This applies when its box holds a solid drawing with ≥ 30 % of its mass.
  - On the HDB, the stacked dimension chains and their extension lines form free strip structures around the plan. Grouped, they weighed 93.4k px against the plan's 91.6k px.
  - Without this rule, the HDB region became the whole page: walls 0.877 / 0.887 and dims 0.750 / 0.900. Both floors broke.
  - A lone column inside a double-line plan holds far less mass than the plan's strips, so it does not trigger the rule.

**R2-2: the table glyph test reads cell interiors only** (`_is_table`).
- Cells are the paper outside **all** strips, closed inside the structure's box, at most 2 gap across (table rows; rooms are wider).
- A structure is a table when ≥ 3 such cells hold glyph-sized ink and they are ≥ 50 % of those cells.
- Stipple or hatch inside a double-line wall lies in a strip, so it never counts.
- The strip-fill ≥ 50 % rule is kept.

**Performance.** Mass is a pixel `bincount`. The first version with float weights pushed the 6000 × 4000 preprocess peak to 1.13 GB, over the 1 GB guard; it is back under.

## F3-2. Region boxes (all reviewer cases, page 2400 × 1700; plan walls x 200–1100, y 300–1000)

| Case | Filled plan | Double-line plan |
|---|---|---|
| plan alone | (138, 238, 1024, 824) | (139, 239, 1025, 825) |
| + 40 px table grid / 30 px terrace / 45° hatch | plan | plan |
| + uneven title-block table / uneven schedule | plan | plan |
| + one bold rule, 800 px | plan | plan (round 2: the rule, (1450, 1149, 901, 103)) |
| + bold title-block frame at the right | plan (warned ambiguous) | plan (warned; round 2: the frame, (1607, 7, 787, 1687)) |
| + bold frame tight around the plan | (28, 128, 1295, 1045), holds the plan | plan |
| + bold sheet border | whole page (pre-16c R4 behaviour, out of scope) | whole page |
| stipple in walls, t 14 | – | (139, 239, 1025, 825) = alone (round 2: (210, 244, 950, 816)) |
| stipple in walls, t 24 | – | (133, 233, 1037, 837) = alone (round 2: (557, 484, 589, 562)) |
| poché hatch in walls, t 14 / t 24 | – | = alone |
| n × n regular double plans (n = 2, 3, 4, 6), with or without a 40 px column | – | (203, 203, 1697, 1397), whole plan |
| pure double-line plan + text table | – | plan |

## F3-3. Metrics

| Metric | HDB | Brochure | Floor | Holds? |
|---|---|---|---|---|
| Walls recall / precision | 0.889 / 0.963 (0.8892 / 0.9628) | 0.912 / 0.865 | HDB ≥ 0.889 / 0.963; brochure ≥ 0.90 / 0.85 | Yes |
| Outer-cycle free ends | 0 | 0 | 0 | Yes |
| Faces | 5 | 3 | HDB ≥ 5 | Yes |
| Dims R / P / intervals / labels / ticks | 0.833 / 1.000 / 0.979 / 0.923 / 0.985 / 0.932 | 0 lines | unchanged | Yes |
| Region | (118, 81, 1709, 1473) | (131, 150, 1212, 1082) | – | unchanged from round 2 |
| Walls stage / non-OCR chain | 0.18 s / 1.3 s | 0.12 s / 0.7 s | < 10 s | Yes |
| Doors (reviewer's 24) / negatives | 24 / 24; all 7 negatives unbridged | – | 24 / 24 | Yes |
| Arc check per candidate, 150 / 340 / 540 / 1000 px | 0.01 / 0.01 / 0.02 / 0.03 s | – | ≤ 0.15 s | Yes |

## F3-4. Tests and evidence

**New tests** (`test_preprocess.py`):
- `test_a_bold_rule_or_frame_does_not_take_the_region` (rule and frame × filled and double);
- `test_a_frame_around_the_plan_keeps_the_plan_in_the_region` (filled and double);
- `test_filled_double_line_walls_hold_the_region` (stipple and poché × t 14 and 24).

The rounds 1–2 region tests are all kept: tables, the text table, tiles, hatch, the regular plans with or without a column, and the single column.

**RED** on `29436f2` (temporary worktree, since removed): **4 failed**.
- rule beside the double plan;
- frame beside the double plan;
- stipple at t 14;
- stipple at t 24.

**GREEN.**

| Command | Result |
|---|---|
| `uv run pytest -q` | **842 passed, 1 skipped, 1 xfailed** in 174 s |
| ruff check / format / mypy | clean / 77 formatted / no issues |

## F3-5. Residuals (for Tasks 33/34)

- **Frames around the plan.** A bold sheet border, or a frame around both the plan and a title block, makes the region the whole page, for filled plans too. This is R4 behaviour from before 16c, and the region still holds the plan.
- **Empty sparse tables.** An empty table whose strips fill under half its box, larger than a pure double-line plan, still wins.

## F3-6. Deviations for spec 19 (these replace F2-4 item 1)

1. 06 §7.6 / R4: the plan region is the drawing with the most wall pixels. The candidates are:
   - solid-stroke drawings, with touching strip structures counted inside them;
   - free double-line strip drawings that are not grids or tables.

   A strip drawing whose box holds a solid drawing with ≥ 30 % of its mass is that plan's annotation, not a candidate.
2. Table test: strip fill ≥ 50 %, or ≥ 3 row-sized cells outside the strips, ≥ 50 % of them holding glyph-sized ink.

# Fix round 4 (re-review `task-16c-rereview-3.md`)

Base `0bb2772`. One finding, R3-1, fixed per the controller's ruling. Only `region.py` and `test_preprocess.py` change.

## F4-1. Change

**R3-1: the surround rule needs extent as well as mass** (`region.detect_plan_region`, new constant `SURROUND_MIN_COVER = 0.50`).
- A strip drawing is dropped as a candidate only when its box holds a solid drawing that both:
  - has ≥ 30 % of its mass (unchanged);
  - covers ≥ 50 % of its box area (new).
- The solid box lies inside the strip box, so its area is the covered area.
- On the HDB, the plan covers 0.72 of the dimension ring's box, so the ring stays excluded. A core covers about 0.055 of its plan's box, so the plan's strips stay a candidate and win on mass.

## F4-2. Core-case region boxes (page 2400 × 1700; double-line plan walls x 200–1100, y 300–1000)

| Solid element inside the plan | t 14, round 3 | t 14, round 4 | t 24, round 4 |
|---|---|---|---|
| plan alone | (139, 239, 1025, 825) | (139, 239, 1025, 825) | (133, 233, 1037, 837) |
| core 120 × 300 | (722, 422, 156, 336), the core | **(139, 239, 1025, 825)**, plan | (133, 233, 1037, 837), plan |
| core 180 × 360 | (688, 388, 224, 404), the core | **(139, 239, 1025, 825)**, plan | (133, 233, 1037, 837), plan |
| two lift shafts 90 × 200 | (699, 459, 222, 302), the shafts | **(139, 239, 1025, 825)**, plan | (133, 233, 1037, 837), plan |
| core 100 × 300 | plan | plan | plan |

- The reviewer's `cc_mass.py` (logos, roses, title text, columns, square cores) and `cc_region4.py` (rule, frame, sheet border) give the same regions as round 3.

## F4-3. Metrics

| Metric | HDB | Brochure | Floor | Holds? |
|---|---|---|---|---|
| Walls recall / precision | 0.8892 / 0.9628 | 0.9117 / 0.8650 | HDB ≥ 0.889 / 0.963; brochure ≥ 0.90 / 0.85 | Yes |
| Outer-cycle free ends | 0 | 0 | 0 | Yes |
| Bounded faces | 5 | 3 | HDB ≥ 5 | Yes |
| Dims R / P / intervals / labels / ticks R / P | 0.833 / 1.000 / 0.979 / 0.923 / 0.985 / 0.932 | 0 lines | unchanged | Yes |
| Region | (118, 81, 1709, 1473) | (131, 150, 1212, 1082) | unchanged | Yes |
| Walls stage / non-OCR chain | 0.15 s / 1.34 s | 0.11 s / 0.64 s | < 10 s | Yes |

## F4-4. Tests and evidence

**New test** (`test_preprocess.py`): `test_a_solid_core_inside_a_double_line_plan_keeps_the_plan`.
- It covers the three core cases × t 14 and t 24, so 6 cases.
- Each asserts that the region equals the plan-alone region and holds the whole plan.

**RED** on `0bb2772` with the test added, `uv run pytest -q tests/test_preprocess.py -k solid_core`: **3 failed, 3 passed**.
- The three t 14 cases fail, for example `x: 699 != 139` for the lift shafts.
- The t 24 cases already passed: at t 24 no core reaches 30 % of the strip mass.

**GREEN.**

| Command | Result |
|---|---|
| `uv run pytest -q tests/test_preprocess.py` | 58 passed |
| `uv run pytest -q` | **848 passed, 1 skipped, 1 xfailed** in 157 s |
| `uv run ruff check .` / `ruff format --check .` / `mypy app` | clean / 77 files formatted / no issues in 48 files |

## F4-5. Concern (not changed; for a ruling)

- At t 14 the three core cases now warn `plan_region_ambiguous {components: 2}`.
  - Each core is its own solid candidate with ≥ 30 % of the plan's mass, so it counts as a rival.
  - The core lies inside the plan's region, so nothing is actually excluded, and the warning is spurious.
- The fix would be to count only the rivals outside the main drawing's box. That changes the warning rule, which is outside this ruling, so I left it as it is.

## F4-6. Deviations for spec 19 (these amend F3-6 item 1)

1. A strip drawing is that plan's annotation, and no candidate, when its box holds a solid drawing that both:
   - has ≥ 30 % of its mass;
   - covers ≥ 50 % of its box area.

## F4-7. Controller ruling on F4-5: inside drawings are no rivals

- **Change.** `plan_region_ambiguous` now counts a heavy drawing (≥ 30 % of the main plan's mass) only when less than 80 % of its box area lies inside the chosen region (`INSIDE_MIN_SHARE = 0.80`).
- **Tests.**
  - The core tests now assert no warning; this was RED (3 t 14 failures) before the change.
  - `test_a_bold_rule_or_frame_does_not_take_the_region` now asserts that the title-block frame at the right still warns `{components: 2}`.
  - The existing inset and unlinked-drawing tests still warn.
- **Results.**
  - The full suite gives **848 passed, 1 skipped, 1 xfailed**; ruff, format and mypy are clean.
  - Every floor is unchanged: HDB 0.8892 / 0.9628, outer free ends 0, 5 faces; dims 0.833 / 1.000 / 0.979 / 0.923 / 0.985 / 0.932; brochure 0.9117 / 0.8650, 0 dims; both regions unchanged; chains take 1.43 s and 0.66 s.
  - The reviewer's logo, rose, title-text and frame cases warn as before.
  - One case changed: the double plan with a bold sheet border no longer warns. Its region is the whole page and holds the plan, so nothing is excluded.
