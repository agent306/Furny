# Review: Task 16c (HDB truth, outline closure, outline/opening rules, 16/16b review fixes), c495a09..36b0753

Reviewed from `review-c495a09..36b0753.diff`, read in passes:
1. binarize, graph, region and segments;
2. `wall_candidates.py`;
3. `walls.py`;
4. the fixture and the harness;
5. the tests.

All line numbers are file lines at 36b0753. Everything I ran used an export of 36b0753 at `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/rv16c/src/vision`, with `uv sync --frozen --offline`. The worktree was not touched. My scripts and evidence crops are in `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/rv16c/work/` (crops under `out/`).

I did not re-flag the controller rulings: the outer-cycle metric, R-a, R-c′, R-b moved to Task 17, the ≥ 5 / ≥ 7 face targets, the 7 + 4 deviations, and the deferred `walls.py` split.

## Verdicts

- **Spec:** ❌ Issues found. One ruling is violated: B2's evidence gate is bypassed by step 8 for bold-stroke pieces (Important 1). Every other brief and continuation item is met.
- **Quality:** Needs fixes. Important 1–4 below.
- **Truth verification:** Verified, with minor convention issues.
  - Every correction the brief lists is correct to within 1.5 px of the drawn centre.
  - No wall is missing and no truth wall is a non-wall.
  - Three minor inconsistencies remain (I12 slant, the pier measurement, X4). All are within tolerance, and none changes an acceptance result.

### Spec compliance

- ✅ **Part A: the truth corrections are present and verified.** See *Truth verification*.
  - The `method.convention` and `judgement_calls` notes are written in (fixture lines 1–27).
- ✅ **B1, `t_wall` for bold strokes.**
  - `_wall_thickness` (walls.py:803);
  - the bold `t_gap` (walls.py:832).
- ❌ **B2, mixed-style bridging needs evidence.** `_link_runs` (walls.py:890) applies the evidence rule correctly, but step 8 (`_runs`, walls.py:848–861) bridges bold + double, block + bold and block + double over a plain gap without any evidence. See Important 1.
- ✅ **B3, the two corner pieces.** They are recovered by general rules, with tests:
  - per-stretch `_bold_mask`;
  - trim before the merge (segments.py `_raster_segments`).
- ✅ **B4, the false positives.** Removed by a general rule, `_drop_dangling_extensions` (walls.py:1284).
  - I also checked a real fin wall outside the outline with an extension line on its centre line: it is kept.
- ✅ **Part C.**
  - Region sweep with polls: region.py:20, poll at :46.
  - Envelope test and `wall_face_dims` test are present.
  - The `_trim_to_stroke` docstring now matches its behaviour.
  - `ink` is a required keyword and `tokens` is removed. I grepped every caller of `extract_walls`, `double_mask` and `candidate_segments` in the export: all are updated (reference.py:189 and the tests).
  - Plan-region segments only: reference.py:189 passes `segs`, not `outer`.
  - `test_metrics_score_a_perfect_extraction` loads the page.
  - The strict P2 xfails are removed.
- ✅ **Continuation, R-a and the dimension rules.**
  - R-a: `GAP_MIN = MERGE_GAP` (walls.py:99).
  - Dimension lines are never candidates: wall_candidates.py:65.
  - Rejoin: wall_candidates.py:298.
  - Double-line strips: binarize.py:123, wired at :222.
  - The ≥ 5 faces test (test_reference_walls.py:123) and the brochure closure test (:144) are present.
  - `dimension*.py` is untouched.
- ⚠️ **Cannot verify from the diff.**
  - The claim that the split commit `6ac7db8` left raw walls, masks and graphs byte-identical. I did not re-derive it.
  - ruff, ruff format and mypy were not re-run (implementer-reported as clean).
  - The push to the remote.

### Metrics, independently reproduced (36b0753, OCR replayed)

| | HDB | Brochure | Continuation table |
|---|---|---|---|
| Walls R / P | 0.8920 / 0.9628 | 0.9117 / 0.8650 | 0.892 / 0.963; 0.912 / 0.865 ✓ |
| Graph | 62 walls, 59 nodes, 9 gaps | 47 walls, 48 nodes, 1 gap | – |
| All free ends | 9 | 17 | 9 / 17 ✓ |
| Outer-cycle free ends (truth outline) | 0 | 0 | 0 / 0 ✓ |
| Enclosed share | 0.997 | 0.990 | ✓ |
| Bounded faces ≥ (0.03 L)² | 5 | 3 (one flat face plus two slivers of 2079 and 7348 px²) | 5 / 3 ✓ |
| Dims R / P / spans / labels | 0.833 / 0.957 / 0.938 / 0.872 | 0 lines | unchanged ✓ |
| Full chain | 1.28–1.45 s | 0.59–0.67 s | 1.2 / 0.6 s; < 10 s ✓ |

**HDB faces** (page px; /1.54 gives source px): rest-of-dwelling, bedroom 1, toilet 1, balcony and the 600 recess. These match the Continuation's face list.

**HDB still missed:** I11 0.93, I12 0.83, I13 0.98, I14 0.92, I15 0.27, I16 0.96 and I17 0.91, as the report says.

## Strengths

- **Every new rule has an "off" twin.** The twins are monkeypatched or parametrized and discriminate:
  - `test_frame_lines_are_opening_evidence`: 6 cases, plus a same-style control;
  - `test_bold_stroke_gaps_are_measured_against_t_wall`;
  - `test_partition_ending_in_an_offset_block_joins_it`;
  - `test_face_lines_cut_by_a_dimension_line_are_rejoined`, with a far-dimension control.
- **The corner-piece losses were root-caused, not special-cased.**
  - `_bold_mask` (walls.py, the per-stretch test) judged the whole stroke instead of each stretch.
  - Wide segments swallowed the bold stroke beside them before the merge.
  - `graph._merge_coincident` fixes a real zero-length-wall node bug and has a minimal test (test_graph.py).
- **The region sweep is correct and bounded.**
  - It equals the brute-force rule on 300 random boxes.
  - My adversarial check: 2000 nested boxes with all pairs close take 0.65 s, with 32 polls at most 41 ms apart. 2000 boxes overlapping in x take 0.02 s.
- **The truth rework is careful and documented.** The fixture's `task_16c_changes` and `judgement_calls` make every reading auditable. The new `test_hdb_truth_closes_into_the_rooms` and `test_outer_cycle_metrics_score_the_truth` pin the truth and the metric.
- **The R-c measurement (C3) is thorough and candid:**
  - five variants;
  - the dimension regressions are reported;
  - not committed.

## Issues

### Critical

None.

### Important

**1. Step 8 bridges a bold stroke and a double-line piece across a plain gap, without the opening evidence ruling B2 requires.** (walls.py:832, 848–861)

- **Cause.** A bold piece's gap thickness is replaced by `t_wall` (B1, line 832). Its neighbour's thickness is then "similar" (line 852), and the empty gap becomes an ordinary step-8 opening. `_runs` has no style check, so `_link_runs`' evidence gate never runs.
- **Counter-case** (`work/cc_bridge.py`, `cc_bridge2.py`): the brief's plan with an 8 px bold outline and a 14 px double partition (t_wall 16), and a plain 165 px gap in the bottom wall with no frame lines and no arc.

  | Pieces | Offset | Result |
  |---|---|---|
  | bold + double | 0 px | bridged, opening 154, 0 free ends |
  | bold + double | 4 px | bridged, opening 154, 0 free ends |
  | block 16 px + bold | – | bridged, opening 153 |
  | block 16 px + double | – | bridged, opening 150 |
  | block 30 + double (control) | – | correctly not bridged (2 free ends) |

  - The step-8 spy shows these runs carry styles `['bold', 'double']` and `['block', 'bold']`, and `_link_runs` produced no bridge.
  - Before 16c, the bold (8) and double (16) pieces were not similar, so this path is new with B1.
  - The block + double case of similar thickness is 06's own step-8 rule, which predates B2.
- **Fix.** In `_runs`, when the two neighbours' styles differ and one is bold, judge `similar` and `t_gap` on the drawn thicknesses (`last_t`, `t`). That leaves mixed-style gaps to `_link_runs`.
  - I prototyped exactly this (5 lines; `rv16c/proto`):
    - HDB and brochure metrics are unchanged to 4 decimals: R/P, free ends 9 / 17, 5 faces, outer 0, dims;
    - `test_walls_closure.py` and `test_segments_walls.py` give 80 passed;
    - the bold + double counter-case gives 2 free ends, no bridge.
  - Add the counter-case as a test.

**2. Tables and tiled areas become the plan region through `double_line_strips`. This regresses plans that were correct before.** (binarize.py:123, :222)

- **Cause.** Every cell of an axis-aligned grid of thin lines spaced ≤ 0.02 long edge is a "strip". The grid spans ≥ 0.1 long edge both ways, so it passes the two-way filter, and its strip area outweighs the walls.
- **Counter-cases** (`work/cc_region.py`): a 2400 × 1700 page with a 900 × 700 plan (filled or double).

  | Page content | Plan | With strips | Without strips | Warning |
  |---|---|---|---|---|
  | Schedule / title-block table at the right (40 px cells, < 48 = 0.02 long edge) | filled | `Rect(1424,124,958,1456)`: the table, not the plan | `Rect(138,238,1024,824)` (correct) | none |
  | Same table | double | the table | the whole page | – |
  | Tiled terrace (30 px grid) beside the plan | filled | x 102–1793 (grown over the terrace) | x 138–1162 | – |
  | 45° hatch block | – | ignored (correct) | – | – |

  - On a solid-wall plan, the table case is a regression: the plan was correct before.
  - Tables and title-block rows at 1–2 % of the sheet width are common sheet furniture.
- **Fix.** Possible directions:
  - reject lattices: strip area over the bounding box of the structure, or many parallel strips at a regular pitch;
  - require each strip to be bounded by exactly two lines, with paper beyond;
  - use the strips only as a fallback when thick ∪ bold holds little of the page's line work (the R4-only collapse case the rule was added for).
  - Add the table case as a test.

**3. `_rejoined` is an O(picked × n) Python loop with no deadline poll.** (wall_candidates.py:298–319, called at :260)

- **Cause.** Every thin piece with an end within 3 t_thin of any dimension line is "picked". Every extension line qualifies, so picked grows with the number of ticks. Each picked piece is then compared with every thin candidate through `_continues`, a numpy call of about 5–10 µs, and nothing calls `poll`.
- **Measured** (`work/cc_rejoin.py`):

  | Case | Thin segments | Dimension lines | Extension lines per line | `_rejoined` |
  |---|---|---|---|---|
  | HDB | 326 | 23 | – | 0.09 s (about a third of the 0.25 s walls stage) |
  | Synthetic | 2,400 | 40 | 10 | 5.4 s |
  | Synthetic | 6,000 | 80 | 12 | 38 s |
  | Synthetic | 11,500 | 100 | 15 | 141 s |

  - The synthetic cases are random thin segments, each dimension line with its extension lines ending on it.
  - A dense A1 plan reaches the 2–6k range. The 60 s request deadline cannot interrupt this.
- **Fix.**
  - Only consider pieces collinear with a picked piece through a direction/offset bucket index, as `_pair_candidates` does.
  - Restrict picking to pieces *parallel* to nothing perpendicular. Extension lines are perpendicular to their dimension line and could be skipped up front.
  - Poll `poll()` in the loop.
  - Add a perf guard test.

**4. The door-swing evidence test accepts texture: hatching or a fine tile grid beside a plain gap reads as a door arc.** (walls.py:1038–1049)

- **Cause.** `_door_arc` ORs ink over a 5-px-wide band (dr −2..+2) at each of 7 radii, at 4 hinges × 2 sides. That is 56 chances for any dense ink to cover 60 % of a quarter annulus.
- **Counter-cases** (`work/cc_bridge.py`, `cc_bridge3.py`): block + double, with a plain 150 px gap and no door.

  | Next to the gap | Result |
  |---|---|
  | 45° hatch at a 9 px pitch inside the room | `_opening_line` → arc, bridged (opening 142) |
  | 12 px axis-aligned tile grid | arc, bridged (opening 143) |
  | 24 px tile grid | not bridged (correct) |
  | sofa outline | not bridged (correct) |
  | two ground lines outside | not bridged (correct) |

- This is the only gate on B2's arc branch. Wet areas next to doors are where hatching and mosaic tiling are drawn.
- **Fix.** Require a thin curve:
  - ink within ±1 px of one radius;
  - paper at about ±4 px on both sides;
  - over ≥ 60 % of the angles, with gaps no longer than a few samples.
- Also reject a hit when the ink density of the gap's surroundings is high. Add the hatch case as a test.

### Minor

**1. Ruling-mandated: a partition face misread as a dimension line now loses the whole partition, including the stretches where its partner exists.** (wall_candidates.py:65–92)

- **Counter-case** (`work/cc_dims.py`, `cc_dims_old.py`), through the real `find_dimension_lines` with gray and t_thin: a horizontal double-line partition (900 px) with slash marks on its upper face and a "3200" label standing on it.

  | Partner face | Detected as a dimension line? | Partition kept (ruling) | Partition kept (pre-ruling re-admission) |
  |---|---|---|---|
  | intact | no | yes | – |
  | broken over 300 px | no | yes | – |
  | cut at the ticks | no | yes | – |
  | present only over x 300–420 and 1080–1200 | yes | 0 px | 254 px |
  | present only over 300–360 | yes | 0 px | 0 px |
  | none | yes | 0 px | 0 px |

- This is the controller's accepted trade. I record it because it is the case the ruling costs.

**2. The deadline test for the region sweep never builds more than one component.** (test_preprocess.py:416)

- The 2500 squares, 20 px each with 40 px gaps, merge into **one** component under the 61 px closing kernel (`work/cc_sweep.py`: "components after closing = 1"). The < 3 s timing therefore says nothing about the sweep.
- The equality test and my nested-box check do cover the sweep.
- **Fix.** Space the squares more than 61 px apart (≥ 0.02 L) or call `_groups` directly with 2000 boxes.

**3. The Continuation's explanation of the brochure W23 loss is wrong, and it hides a fragility.**

- **What actually happens** (`work/w23*.py`). The raw walls near W23 are identical under `GAP_MIN` 1.5 and 2.5. R-a turns the left wall's toilet window into an opening, which lowers `t_median` from 27.66 to 26.0. That shortens graph-building's free-end reach and prune length.
- **Effect.** The 49 px double-line piece (page 578, 517–566) no longer reaches the wall below, and is pruned with its connector. W23 goes from matched to 0.60 missed.
- So a single opening elsewhere on the sheet decides whether this partition survives.
- **Fix.** Correct the report. Consider measuring `t_median` without the opening spans, or extending free ends by their own thickness rather than the global median.

**4. Truth: I12 is slanted from B (y 174) to V6t (y 178), but its face pair is centred at about 178 along its whole length.** (fixture line 122)

- Measured at 20 % / 80 %: faces 173.3 / 182.5 → 177.9, and 173.2 / 182.45 → 177.8.
- The line is therefore 3.2 px off at 20 % and about 4 px off at B. That is within the 4.96 px interior tolerance, but it is not what the jog convention says: X1e's bold stroke at 174, then a jog to 178.
- The report's profile table checks I12 only at 80 %, while the brief asks for 20 / 50 / 80 %.

**5. Truth: the pier rule is measured differently from the stub rule.**

- B2a, the 78 px stub, is measured from its centre-line node M (505, 912).
- The pier (x 558–576, y 922–950) is measured from the block's *face* (28 px). From the block's centre line, the way B2a and every truth wall is measured, it is 38 px, which is ≥ 0.03 L (33 px) and so a stub.
- The impact is negligible (about 38 px of truth length), but the convention should state one measurement.

**6. Truth: X4 (upper) is read differently from X8 and X9.**

- X4 has a bold stroke at 1121.75 and a single thin line at 1115. The thin line at 1103 is the 1300 dimension's extension line.
- Under the single-thin-line = inner-face reading applied to X8 and X9, the centre would be 1118.4, against the truth's 1115 (3.4 px).
- The reading is otherwise consistent:
  - X5 and B2 carry a *double* thin line (X5: 803–807; B2: 913 / 916), read as a window or railing frame.
  - X8 has a single line along x 150–303, plus a second line along the 303–418 window.
- Within tolerance.

**7. Code quality in `walls.py`.**

- Step-8 items are 9-field positional tuples (`for s0, s1, off, t, src, fa, fb, style, tg in line`, walls.py:848), and `_Member` is a 6-tuple (walls.py:711). A small dataclass would make the B1/B2 logic, and Important 1, easier to see.
- `_Run.thickness()` (walls.py:746) re-implements the weighted mean already inside `_Run.wall()`, and `_mean_offset` is a third copy of the same pattern.
- `_trace_raw_walls(..., thin=None, ink=None)` (walls.py:1378–1385) silently disables B2 bridging when a caller omits them. There is a single caller, so make them required.
- `_drop_dangling_extensions` builds the full wall graph up to twice more per extraction. It is cheap on the references (walls stage 0.25 s), but it is worth a comment or reusing the final graph.

### Checks run, with no break found

**R-a (1.5–2.5 t gaps are openings)** (`work/cc_ra.py`, `cc_ra2.py`):
- A corner wall and a separate collinear fin 2 t away stay separate. The corner's perpendicular wall lies inside the gap strip, so `_gap_is_empty` rejects it.
- A nib at the jamb of a 2 t gap: no difference between 1.5 t and 2.5 t. The nib is pruned as a spur under both, which predates 16c.
- Double partitions 2 t apart across a single-line glass screen are bridged. The screen is not a wall in a double-line plan, so the topology is unchanged.
- On the brochure, R-a closes the outline as claimed. Its only side effect is Minor 3.

**Rejoin correctness:** the fused reach is 3 t_thin (6–11 px). It cannot span a door or window, and I found no wrong fusion. Its cost is Important 3.

**Region sweep and polls:** see Strengths.

**`double_line_strips` cost:** 0.66 s on a 6000 × 4000 page with 3000 random strokes.

## Truth verification (HDB, method and results)

**Method** (`work/prof.py`):
- Perpendicular grey profiles on `hdb-3room.webp`, each the median of 5 profiles 1 px apart, in 0.5 px steps, ±16–18 px.
- Threshold gray < 200, and < 235 for the faint toilet-3 faces.
- Profiled at 20/50/80 % and denser where needed.
- Evidence crops at 3–6× with the corrected truth drawn over them: `work/out/{tr,store,i14,bl,br,left-top,left-mid,left-win}.png`.

In the table, offsets are converted to absolute coordinates.

| Wall | Measured centre | Truth | Verdict |
|---|---|---|---|
| I16 (toilet 3 top), new | faces 172.5 / 182 → 177.25; window at 50 %; pier y 170.5–190.5 at 80–90 % | 178 | ✅ |
| I17 (Q→U), new | faces 303 / 294 → 298.5 (5–10 %); 304 / 295.25 → 299.6 (90 %); bi-fold leaves at 50 % | 299 | ✅ |
| I14 | top face 356, bottom face 365 (65 / 90 % only; door elsewhere) → 360.5 | 360 | ✅ |
| V6t, I13 | I13 faces 984.75 / 975.75 → 980.25; I16 faces → 177.25 | (980, 178) | ✅ |
| B / X1e / X2 | X1e bold 173.75 at 50 / 80 %; X2 bold centre 939.5 | (938, 174) | ✅ |
| P / L2 / L1 | L2 bold 926.75; L1 bold 890.25 with inner face 883.5 → 886.9 | 927; x 888 | ✅ (1.1 px) |
| X6 / O2 | faces 808.25 / 799 → 803.6 | 804 | ✅ |
| X7a / X8b (top block) | 795.25 / 796.5 | 796 | ✅ |
| B2a / B2b (bottom block) | 912.25 | 912 | ✅ |
| X7 (slider) | 799–802.5 and 803.5–805.5 → about 802.5 | 803 | ✅ |
| X8 | bold 804.75, inner line 795.5 (all of it), window line 798.5 (x 303–418) → 800.1 | 800.5 | ✅ under the inner-face reading |
| X9a / X9b / X9c / X9 | 146.25 / 154.75 / 147.5 / 150.6 (149 near F) | 146 / 155 / 147 / 150 | ✅ |
| B2 | bold 922.25; double thin line 913 / 916 above it | line 921.5 → 925 | ✅ under the frame reading |
| X4 / X4a / X4b | bold 1121.75 with thin 1115 / block 1114 / 1113.4–1115.5 | 1115 | ✅ (Minor 6) |
| X5 | bold 810.5–812.75 with a double thin line 803–807 | 811 → 810 | ✅ (consistent with B2) |
| I12 | face pair at about 177.8–177.9 along its length | slanted 174 → 178 | ⚠️ Minor 4 |
| I1 (to Q 299) | 296.1–297.6 per the report; V1t stays at 297, so I1 is slanted 2 px | – | ✅ (≤ 1.4 px) |
| B1, I15, B3 | B1: 505; I15 faces 826 / 817 → 821.5; B3: three-line stack | unchanged | ✅ |

**Judgement calls:**

- **X8 / X9 inner face: agree.**
  - The single thin line runs the whole length 9–10 px inside the bold stroke and meets X9's inner line at the corner. It is a face, not a sill.
  - X9b has a window box *outside* its bold stroke (x 145–152, y 461–548, crop `left-win.png`) and a faint line at x 138. So X9b's bold stroke may itself be an inner face, which would put the centre at about 147.
  - That is within the 9.9 px exterior tolerance and the convention says "bold stroke: its centre", so I did not flag it.
- **Pier rule: disagree on the measurement** (Minor 5).
- **X4 / X5 left at the bold stroke:**
  - X5 is consistent: its inside is a double line, a frame.
  - X4 is the one inconsistent reading (Minor 6).

**Missing or spurious walls:** none found in the corrected truth.

## Assessment

**Task quality:** Needs fixes.

**Reasoning:**
- The truth corrections are right, the outline closes, and every Continuation metric reproduces exactly.
- Three of the new rules break on simple counter-cases:
  - step 8 bridges bold and double pieces across a plain gap, bypassing B2's evidence gate;
  - the double-line-strip region takes tables and tiled areas, regressing solid-wall plans;
  - the door-arc evidence accepts hatching and fine tiling.
- `_rejoined` has unbounded Python cost with no deadline poll.
- Important 1 has a 5-line fix that I verified changes no metric and no test.
