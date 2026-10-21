# Task 17 review: openings (f2ea8ef..0ea3dca)

Reviewer seat: task reviewer, with independent truth verification. Diff file read in one pass (`review-f2ea8ef..0ea3dca.diff`, 153,754 bytes, non-empty). Controller rulings respected and not re-flagged: opening targets re-scoped to floors; R17-a and R17-b adopted, R17-c not; R17-d carried to Task 34; `pre.ink & ~ink_notext` used as a label locator only; the 13 deviations logged in spec 19.

Code outside the diff was opened only for named purposes:
- `tests/support/synth.py` and `tests/test_segments_walls.py::run`, to build counter-cases;
- `schemas/candidates.py` `WallCandidate`/`GapCandidate`, to reverse graph walls;
- the `walls.py` def list, for the split recommendation;
- `reference.py::outer_cycle_free_ends`, for the metrics check.

## Spec Compliance

- ✅ **Spec compliant**, with the logged deviations, for 06 §8.5 and the brief's interface and additions B–D.
  - **06 §8.5 hypothesis rules.** Each of the 4 hypotheses samples 24 points in a 5×5 window, with the +0.15 leaf bonus: `openings.py:427-436`, `:479-508`. Double swing (two g/2 arcs ≥ 0.45, `:468-476`). Single swing ≥ 0.55. Window: ≥ 2 lines ±3° ≥ 80 %, and sliding with offset sashes (`:554-576`). Passage support 0.0 (`:405-407`).
  - **Swing mapping.** `swing = left` ⇔ +n with n = (d.y, −d.x) (`:503-504`, `:621`), as 04 §2.1 requires.
  - **Interface and ids.** `find_openings(graph, pre, segments, ink_notext)` with ids `O{n}` in wall order, then `u0` (`:144-194`).
  - **B: R-b.** `_partition_doors` reuses `door_arc` (`walls.py:1026-1108`), and the synthetic and HDB I15 tests are present.
  - **B: toilet-3 cause.** Fixed in pairing, `wall_candidates.double_mask` leaf deferral (I13 whole, `test_reference_openings.py`).
  - **B: bi-fold.** Recognised (`openings.py:511-551`).
  - **C.** Dead branch removed (`test_preprocess.py`).
  - **K18.** `test_gap_candidate_door_hinge_and_swing` (`test_segments_walls.py`).
  - **D floors.** All hold (confirmed independently below).
- ⚠️ **Cannot verify from the diff.**
  - Whether `pre.drawing_kind == "colored_brochure"` is reliable on other colour plans. R17-b is gated on it (`openings.py:184`). That is Task 10/16b classification code.
  - The brief's D8 (store bi-fold) is recognised in `openings.py` but is unreachable on HDB, because I17 is not a wall. This is accepted as R17-d.

## Strengths

- **Orientation is right everywhere I could test it** (scratch harness, `rv17/cc/orient.py`, `orient2.py`, `rb.py`).
  - Single swing on all 4 walls × hinge start/end × side ±1, with every graph wall also reversed (a↔b, gaps re-based): **32/32**.
  - Double swing on 4 walls × 2 sides × 2 directions: **16/16**.
  - R17-a leaf doors on 4 walls × 2 jambs × 2 directions: **16/16**.
  - Bi-fold on 4 walls × 2 jambs × 2 fold sides × 2 directions: **32/32**.
  - R-b on a horizontal partition, 4 combos: **4/4**.
  - The 04 §2.1 convention is applied consistently and is independent of the graph's wall direction.
- **The toilet-3 pairing fix generalises.** I tested the case as drawn, transposed and mirrored, and with a t=20 off=4 and a t=10 off=3 variant. Each one gave a partition of 798–799 px of 800, with one door. Deferring rather than excluding leaves (step 9 vs 8/9a/9b) was measured, not guessed.
- **R17-b counter-cases pass.** Grey kitchen counters with a lighter sink, a grey wardrobe against a wall, a darker counter that becomes wall pieces, a coloured floor showing through a passage and a door, and a partition stopping short over a coloured floor produced no false window (`rv17/cc/r17b.py`).
- **Clean evidence refactor.** `door_arc`, `frame_lines` and `door_leaves` live in `opening_evidence.py` and are shared by both stages, so there is no duplication of the 16c arc code (`walls.py:1093`, `:1135`). The report states byte-identical reference output across the move.
- **The truth files are careful.** Every entry has a `method` reading, and the `judgement_calls` lists make the subjective calls auditable. `test_metrics_score_the_truth` proves that the metric sees a dropped opening, a wrong kind and a flipped swing.
- **Rules added on real-image evidence carry ablations** (report §4), and each new synthetic test was checked by switching its rule off.

## Truth verification (duty 1)

**Method.** I read 4–8× nearest-neighbour crops with a 10 px source grid and perpendicular profiles (median of 3, thresholds 120/200/235). Brochure wall centre lines were read as RGB profiles. Crops are in `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/rv17/`.

**Verified correct** (host wall, interval, kind, and hinge and swing under n = (d.y, −d.x)):

- **HDB.**
  - D1 I3 start/right; D2 I10 start/right; D3 I14 start/left; D4 I6 start/left; D5 I7 start/left.
  - D6 I15 start/left, with the 10 px nib seen.
  - D7 X9 end/left: the leaf runs to +x from (152, 778), with the arc up to (155, 697).
  - D8 I17 bifold start/right: a V to −x from the hinge circle (296, 385).
  - G1 X7 slider: boxes at 578–600 and 758–808, tracks between.
  - G2 X5: thin lines at 800/803 plus bold, x 888–1046, with a box to 1078.
  - G3 X8: lines at 795.5/798.5 plus bold, x 303–418.
  - G4 I16: 4 faint lines 172–181 over x 1024–1072.
  - G5 ignored.
- **Brochure.**
  - D1 W23 end/right (arc about (152, 161), r 24–25); D2 W20 start/right (leaf x 111); D3 W12 end/left; D4 W13 start/left (r ≈ 19.5); D5 W15 end/right (d = (−1, 0), so +n is down and the leaf goes up, which is right).
  - D6 W26 bifold, left: leaves stacked at x 174–181 and 229–235.
  - G1 W1 x 78–131 (grey 165); G2 W5 x 270–318.
  - G3 W17 y 180–198 (grey 190); G4 W16 y 246–281; G5 W9 y 187–205.
  - Panels G6 W19 y 102–123 (grey 129 against slate ~104); G7 W22; G8 W11; G9 W6; G10 W16 y 291–309 (115); G11 W13 y 197–217.

**Errors and inconsistencies:**

- **T1 (Important): HDB is missing a window on X9b at y ≈ 461–548, u ≈ 233–320 from A3 (155, 228).**
  - **Evidence.** Profiles on y 504–546 read bold x 153–158 plus two thin lines at x ≈ 146.5 and ≈ 151. The 8× crop (`rv17/c_kit3.png`) shows a frame box x 145–153 over y 461–548 with a nested sash 501–546.
  - **Why it matters.** This is the same "two thin lines beside the bold" signature as G3 (795.5/798.5 plus bold). By the truth's own `window_rule` (`hdb-3room.drawing-openings.json:7`) it is a window.
  - **Why it was excluded.** `judgement_calls[0]` (`:11`) excludes it on the reading of "a thin outer line at x 145", which the profile does not support.
  - **Effect.** Adding it makes HDB scored openings 13, and recall at the current output 6/13 = 0.46. `OPENING_FLOOR` HDB recall (0.5, `test_reference_openings.py:36`) would then need re-basing.
- **T2 (Minor): B1 (x 505, y 796–912) also meets the window rule but is neither listed nor ignored.**
  - Profiles read bold x 504–508 plus thin lines at 511–512 and 514–515.
  - B3 (x 832) is drawn as two thin pairs (828/830 and 836/838).
  - Both are balcony side boundaries, railing-like like G5. Give them `ignore` entries with G5's reasoning, so a future detection there is neutral and not false.
- **T3 (Minor): G1, the living/balcony slider, is scored as kind `window`** (`hdb-3room.drawing-openings.json:36`). It is the balcony's sliding door (03 DoorType `sliding`). The judgement is documented. Either mark it kind-agnostic in the metric or record it as `door/sliding` once the AI path can label it. As it stands, Task 33/34 would score a correct "sliding door" label as a miss.
- **T4 (Minor): brochure `judgement_calls`** (`brochure-2bhk.drawing-openings.json:16`) says D1/D3's open leaf lies along "W20 / W18". For D3 the wall is **W8** (b17–b8, y 165): the leaf runs from (247, 161) to +x. W18 is the 20 px piece at x 56–76.
- **The implementer's calls.**
  - The HDB window rule is sound in principle but applied inconsistently (T1, T2).
  - G5 ignored: agreed.
  - G11 ignored: defensible. Its symbol is identical to G6–G10, so a detection there is correctly neutral.
  - Brochure grey panels as `fixed` windows: agreed. G6/G9 sit in bedroom outer walls and G7/G8 face the deck, the same symbol each time; the type is unscored anyway.
  - The kitchen passage left unscored: acceptable given the verified wall truth. Note, though, that **neither truth scores any passage**, so kind `opening` has zero real-image coverage (Minor, for Task 33/34).
- **No spurious entries were found.** No other visible door was missed. I checked the HDB top wall (bold plus one faint line), X4b (bold plus one thin face) and the bay, and every brochure wall run.

## Generality counter-cases (duty 2)

The scripts are in `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/rv17/cc/`. They run the real chain on synthetic renders.

| Rule | Counter-case | Result |
|---|---|---|
| R17-a | Round table plus 4 chairs 28 px off a wall | OK, none |
| R17-a | **Quadrant shower tray in a corner** (edges inset 3 or 6 px from the faces, arc r 90, drain) | **BREAKS: 2 doors**, one on each wall (support 1.00) |
| R17-a | **Quarter-round corner shelf** (one free edge plus arc) | **BREAKS: 1 door** |
| R17-a | Curved corner sofa (arcs 100/130, backs 130) | OK, none |
| R17-a | D-shaped console against a wall | OK, none |
| R17-a | Quarter-circle desk standing off a wall | 1 door. Geometrically identical to a door glyph, so this is inherent and not counted |
| R17-b | Grey counter with lighter sink; grey wardrobe; darker counter; coloured floor through a passage, door or short partition | OK, no window |
| R17-b / solid breaks | A lighter-grey stretch (110 or 125 against slate ~104) in a filled wall with no end lines | casement window, **on both colour and line drawings** (the solid-break route, not R17-b) |
| R-b | Horizontal partition, 4 hinge/swing combos | OK, 4/4 |
| R-b | Round table in the passage at a partition's free end | OK, the end stays free |
| R-b | **Partition stops 93 px short (a passage); a door IN the crossing wall hinged at x 1207 or 1193, next to the partition line** | **BREAKS:** the partition is extended to the wall (free ends 0) and **one arc yields 2 doors** (O1 on the phantom extension, O2 the real door) |
| Pairing | Toilet-3 case as drawn, transposed, mirrored; t 20 / 10 | OK (798–799 of 800 px) |
| Bi-fold | 4 walls × jambs × sides × directions | OK, 32/32 |
| Bi-fold | Double bi-fold (V at each jamb) | bifold over the whole gap, hinge start: acceptable |
| Bi-fold | X across a passage | OK, passage |
| Bi-fold | V-shaped object touching the wall at a jamb | bifold: same glyph as 04 §8.2, inherent |
| Window rule | **A solid wall line with a hollow (double-line) stretch** (brick infill between filled stretches; 200 px at t 14, 300 px at t 20) | **BREAKS: casement window** |
| Window rule | Tile grid (15 px) through a passage in a 24 px wall | OK, no window (the grid became walls, which is not this task) |
| Window rule | Threshold strip (2 lines) across a bare passage | casement. 06 §8.5 step 2 literally says so, so this is noted and not a finding |
| Double swing | 4 walls × 2 sides × 2 directions | OK, 16/16 |
| Hinge/swing | All 4 wall directions for single, double, leaf-door and bi-fold | OK, 100 % |

## Metrics table (duty 3)

Confirmed on `git archive 0ea3dca` exported to scratch, run with `PYTHONPATH` set to the copy (imports resolved to the copy). The copy was deleted afterwards.

| Metric | HDB | Brochure | Report |
|---|---|---|---|
| Openings R / P | 0.500 / 0.667 (6/12, 6/9) | 0.625 / 1.000 (10/16, 10/10; G11 neutral) | matches |
| Hinge/swing | 1.00 | 1.00 | matches |
| Walls R / P | 0.927 / 0.973 | 0.920 / 0.864 | matches |
| Free ends (all / outer) | 8 / 0 | 15 / 0 | matches |
| Bounded faces | 6 | 4 | matches |
| Dims R / P / intervals / labels / ticks R / P | 0.833 / 1.000 / 0.979 / 0.923 / 0.985 / 0.932 | 0 lines | matches |
| Chain total (openings stage) | 1.51 s (0.06 s) | 1.24 s (0.14 s) | matches (1.8 / 1.2 reported, wall-clock) |

`pytest tests/test_openings.py tests/test_reference_openings.py` on the copy gave 44 passed, no warnings.

- HDB matched: D1, D2, D4, D5, D6, D7. Missed: D3, D8, G1–G4. False: O7, O8 (passages), O9 (a 19 px casement), all on X6/X7.
- Brochure missed: D1, D2, D4, D6, G8, G10.

## Issues

### Critical (Must Fix)

None.

### Important (Should Fix)

1. **`openings.py:200-213` with `:308-368` and `:554-576`: solid-break candidates plus the 2-line window rule turn any unfilled stretch of a filled wall that keeps its outline into a `casement` window.**
   - **Cases.** A double-line (hollow) stretch between filled stretches, which is common (columns or RC piers black with brick infill drawn hollow on one wall line). A fill-colour shift across the dark-mask threshold (stretch grey 110 against slate 104) did the same, on line drawings too.
   - **Why it matters.** The module doc (`:31-33`) itself says a break "without a door or window symbol is a change of drawing style, not an opening", but a hollow stretch's two faces satisfy the window test exactly.
   - **Fix.** For `is_gap=False` candidates, require window evidence a hollow wall does not have: a frame line strictly inside the strip (|offset| ≤ 0.35 t, not on the faces), or jamb lines across the wall at both ends. Add a counter-test (solid wall with a hollow stretch, no window).
2. **`openings.py:590-626` (R17-a): a corner quadrant fixture is inferred as door(s), each with `support = 1.0` (`:624`).**
   - **Cases.** A quadrant shower tray in a corner (edges inset 3–6 px) gave 2 doors, one per wall. A quarter-round corner shelf gave 1 door. These are common bathroom and bedroom fixtures, and doors appear on unbroken walls with full confidence.
   - **Fix.** Drop leaves whose arc is shared by a second leaf at the same hinge (a closed quarter sector is a fixture, not a door). Report inferred doors with their measured evidence, not 1.0, so the labeler and review can arbitrate. Add the shower-tray counter-test.
3. **Truth T1:** the missing HDB kitchen-side window on X9b (y 461–548). See Truth verification above. Fix the truth file and re-base `OPENING_FLOOR` HDB recall.

### Minor (Nice to Have)

4. **`walls.py:1085-1101` (R-b): an arc owned by a door in the crossing wall, hinged next to the partition's line, extends the partition through a real passage.** The same arc then yields a second door on the phantom extension, so one arc gives two doors. The geometry is situational: the hinge must lie within 0.5 t + 2 px of the partition's line. Skip R-b when the crossing run has a gap or opening at the hit point, or when a straight leaf lies along `toward` from the hinge (then the arc's closed position is along the crossing wall).
5. **Truth T2:** B1 and B3 match the window rule; add `ignore` entries.
6. **Truth T3:** the G1 slider is scored as kind window; it is the balcony sliding door.
7. **Truth T4:** the D3 leaf is along W8, not W18 (`brochure-2bhk.drawing-openings.json:16`).
8. **`openings.py:186-189`: R17-a and R17-b detections are de-duplicated only against openings on the same wall id.** A door found in a gap on a collinear neighbour (a wall split at a T) can be inferred again by R17-a. Compare by geometry on the chained wall line (`_lines` already exists).
9. **`openings.py:651-673` (R17-b): `PANEL_PAPER = 200` is close to what the brochure's "white" windows read (G3 190, G4 190).** G3 is found only because it reads 190 < 200. This is a fragile coupling; note it in the deviation or measure the paper level per image.
10. **`schemas/candidates.py:188`: the `OpeningCandidate` docstring lists the window types as `casement` and `sliding_window`** but R17-b emits `fixed`. Also, `support` is documented as arc or frame evidence, but R17-a/b emit a constant 1.0.
11. **`tests/test_openings.py:219`: `del w`** on a variable assigned only to be deleted. Drop the assignment.
12. **Neither truth scores a passage, so kind `opening` has no real-image check.** Carry this to Task 33/34 with the kitchen passage (it needs a truth wall W24–W25 span).
13. **`walls.py` is 1,578 lines; a split is warranted.** This task moved out 170 and added about 100. Recommended split, done as its own refactor task gated on byte-identical reference walls, gaps and metrics, as `bf8e009` did:
    - `wall_skeleton.py` (steps 5–6: `_Edge`, `_lookup`, `_trace`, `_path_length`, `_degrees`, `_prune_spurs`, `_contract`, `_Piece`, `_vertex_indices`, `_pieces`; `walls.py:303-584`, about 280 lines);
    - `wall_runs.py` (steps 7–8 and linking: `_snap_one`/`_snap`, `_join`, `_close_end`, `_extend_to`, `_march_free_ends`, `_Item`, `_Run`, `_direction_groups`, `_longest_direction`, `_gap_is_empty`, `_wall_thickness`, `_runs`, `_gap_thickness`, `_is_opening`, `_point`, `_link_runs`, `_partition_doors`, `_opening_line`, `_drop_leaves`; `:585-1200`, about 615 lines);
    - `walls.py` keeps the masks (steps 1–5), `extract_walls`, `_trace_raw_walls`, dedupe, `_drop_dangling_extensions`, `walls_to_graph` and debug (about 680 lines).
    - The new `openings.py` (681 lines) is cohesive: candidates, classification, rulings. It needs no split.

## Assessment

**Task quality:** Needs fixes.

**Reasoning:**
- The stage is spec-correct, orientation-correct on every wall direction, and the reported metrics reproduce exactly.
- Two of the new heuristics misfire on common drawing content:
  - hollow or fill-shifted stretches of filled walls become casements;
  - quadrant fixtures become doors with support 1.0.
- The HDB truth misses a window that its own rule includes. Each of these has a small, testable fix.
