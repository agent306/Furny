# Task 17 report: openings (door arcs, windows, passages)

**Status: NEEDS_CONTEXT.** The openings stage, the brief's additions B (R-b, the toilet-3 pairing cause, bi-fold recognition) and C, the traced openings truth for both plans and the reference tests are implemented, tested and pushed. Every floor in D holds, and walls improved. **The opening targets in A are not met** (HDB R 0.417 / P 0.625 against 0.75 / 0.85; brochure R 0.375 / P 1.000 against 0.70 / 0.80). The missing openings need design changes beyond 06 §8.5 and the additions (§6), so I stopped as the brief's stop rule asks. Proposed rulings with prototype measurements are in §6.

The targets are a strict xfail (`test_openings_reach_the_targets[*]`); the reached values are a regression floor (`test_openings_do_not_regress`).

Commits (pushed to `origin/build/p3-vision`):

| SHA | Subject |
|---|---|
| `bf8e009` | refactor(vision): move door-arc and frame-line evidence into opening_evidence.py |
| `53780c9` | feat(vision): door/window/opening classification of wall gaps |
| `f90b0f3` | test(vision): traced openings truth and acceptance for the reference blueprints |
| `6a19a4b` | test(vision): drop the dead title-block-frame branch of the uneven-table region test |
| `7385426` | fix(vision): openings stay clear of crossing walls and inside their wall |

---

## 1. Final metrics

| Metric | HDB | Brochure | Target / floor | Met? |
|---|---|---|---|---|
| Openings recall | **0.417** (5 / 12) | **0.375** (6 / 16) | ≥ 0.75 / ≥ 0.70 | **No** |
| Openings precision | **0.625** (5 / 8) | **1.000** (6 / 6) | ≥ 0.85 / ≥ 0.80 | HDB **no**, brochure yes |
| Matched doors with hinge and swing right | 1.00 (5 / 5) | 1.00 (2 / 2) | ≥ 0.80 | Yes |
| Walls recall / precision | **0.927 / 0.973** (was 0.889 / 0.963) | **0.920 / 0.864** (was 0.912 / 0.865) | HDB ≥ 0.889 / 0.963; brochure ≥ 0.90 / 0.85 | Yes |
| Outer-cycle free ends | 0 | 0 | 0 / 0 | Yes |
| All free ends | 8 (was 9) | 15 (was 17) | – | – |
| Bounded faces | **6** (was 5) | 4 (was 3) | report; ≥ 7 is Task 18's | – |
| Enclosed share | 0.997 | 0.990 | – | – |
| Dims R / P / intervals / labels / ticks R / P | 0.833 / 1.000 / 0.979 / 0.923 / 0.985 / 0.932 | 0 lines | unchanged | Yes |
| Non-OCR chain (openings stage) | 1.4–1.7 s (0.04–0.10 s) | 1.0–1.1 s (0.05–0.12 s) | < 10 s | Yes |

By kind: HDB doors 5 / 8, windows 0 / 4; brochure doors 2 / 6, windows 4 / 10.

**HDB.** Found: toilets 1 and 2 (D1, D2), bedrooms 1–3 (D4, D5, D6; D6 through R-b). Missed: D3 toilet 3, D7 entrance, D8 store bi-fold, G1 slider, G2 and G3 frame-line windows beside bold walls, G4 toilet-3 window. The 3 false detections are all on X6/X7 at the balcony (§6, R17-e).

**Brochure.** Found: the right bedroom door (D3, through R-b), the entrance (D5), the two top windows (G1, G2), the kitchen and right-toilet windows (G4, G5). Missed: D1, D2 and D4 (bedroom and toilet doors), D6 (the deck's folding doors), G3 (its frame lines lie under two labels), and the five grey-panel windows G6–G10.

## 2. What was implemented

### 2.1 `openings.py` (06 §8.5): `find_openings(graph, pre, segments, ink_notext)`

The interface is the brief's. Ids are `O{n}` in wall-id order, then `u0`.

- **Candidates.**
  - The graph's gaps.
  - Plus **breaks in the solid ink of straight wall lines** (deviation 1). A window's frame lines or a door's threshold drawn across a black wall join its pieces into one wall run, so the opening exists only as a break in `pre.thick`.
    - Lines are graph walls chained through nodes within 3°.
    - A break is 1.5–18 t long, between solid stretches reaching 0.5 t past the end junctions.
  - A gap inside a break takes the break's extent.
  - Candidates are trimmed clear of crossing walls at their nodes and dropped below 1.5 t.
- **Door.**
  - The spec's four hypotheses, 24 samples, a 5×5 window and the +0.15 leaf bonus.
  - Double swing: two g/2 arcs on one side, each ≥ 0.45.
  - Single swing: best ≥ 0.55.
  - Read on real drawings:
    - samples on the walls' strips and within 2 px of ink the text mask removed are not judged (at least 8 must be);
    - the door's span may move: the hinge up to g beyond a gap end, behind a nib up to 0.2 g, or closing short down to 0.5 g;
    - no door is narrower than 1.5 t;
    - a clear arc (≥ 0.75) outranks frame lines, which outrank a weak arc.
- **Bi-fold** (brief B): two leaves of 0.25–0.75 g at 15–75° to the wall, folded into a V at least 0.15 g off the wall line, at a jamb.
- **Window**:
  - ≥ 2 thin parallel lines (±3°) within 0.75 t of the centre line, each covering ≥ 80 % of g, make a `casement`;
  - ≥ 3 lines with an offset sash pair make a `sliding_window`: sashes cover ≥ 40 % of g each, overlap ≤ 60 % of the shorter, and together cover ≥ 80 % of g.
- **Passage**:
  - only from graph gaps;
  - not when label-removed ink runs along ≥ 50 % of the gap (the text mask made that gap).

### 2.2 Walls stage (additions B)

- **R-b, `walls._partition_doors`.**
  - A free run end looks along its line for the nearest run crossing at ≥ 60°, within 18 t.
  - With a `door_arc` (the Task 16c code, reused) about either jamb, it adds a raw wall to that run's centre line with `(0, g)` as an opening.
  - Hinge and radius variants:
    - the leaf closes on the crossing wall's face or on its centre line;
    - the hinge may sit behind a 0.15 g nib (HDB bedroom 3).
- **Toilet-3 cause, `opening_evidence.door_leaves` and `wall_candidates.double_mask`.**
  - A door leaf is a thin line with a `door_arc` about one end, from the line to the perpendicular.
  - A leaf's pair with a line ≥ 1.5× longer (a wall's face) is sorted after all other pairs. The face's own partner wins, and I13 is now traced whole.
  - Two narrower variants were measured and rejected (§4, steps 9a and 9b).
- **Bi-fold.** Recognised in `openings.py` (§2.1). The HDB store's I17 is still not a wall, so D8 is not reached (§6, R17-d).

### 2.3 Refactor

`opening_evidence.py` now holds `door_arc` and its helpers (moved unchanged from `walls.py`), `frame_lines` (factored out of `walls._opening_line`) and `door_leaves`.

Both reference images gave byte-identical walls, gaps and metrics before and after the move.

### 2.4 Harness and truth

- **`tests/support/reference.py`:**
  - `run_chain` runs `find_openings` and times it;
  - `load_openings_truth`, `opening_metrics` (one-to-one, best cover first, kinds must agree, ignored entries neutral) and `openings_png`.
- **`tests/test_reference_openings.py`:**
  - truth consistency;
  - a metric self-test (the truth scores 1/1/1; a dropped opening, a wrong kind and a flipped swing are each seen);
  - regression floors and the strict-xfail targets;
  - hinge and swing ≥ 0.8;
  - R-b on HDB (I15 whole, D6 matched) and I13 whole;
  - timing.
- **`WALL_FLOOR`** moved to the new values:
  - HDB (0.927, 0.973, 8);
  - brochure (0.920, 0.864, 15). Its precision is 0.001 below 16c's 0.865 (§4, step 9).

### 2.5 Other items

- **C:** the dead `if case == "title-block frame"` branch is removed.
- **K18:** `test_gap_candidate_door_hinge_and_swing[4]` in `test_segments_walls.py`.

## 3. Truth files and profile checks

Files: `vision/tests/fixtures/reference/hdb-3room.drawing-openings.json` and `brochure-2bhk.drawing-openings.json`.

**Conventions.** Coordinates are source px. Each opening gives its host truth wall, `[u0, u1]` along it from node a, `hinge` (start = u0) and `swing` (left = +n). A door's interval spans its leaf; a window's spans its frame. Each opening has a `method` note with its readings. They were read on 5–10× crops with a 10 px source grid and, for windows, on perpendicular profiles (median of 3, gray < 225, or < 240 for faint lines). The brochure's grey panels were read on RGB samples.

### HDB: 8 doors, 5 windows (one ignored), 0 passages

| Id | Wall | Interval | Hinge / swing | Reading |
|---|---|---|---|---|
| D1 | I3 | 29.5–90 | start / right | leaf y 208–211 to hinge (413, 209.5); arc to (413, 270) |
| D2 | I10 | 28–90.3 | start / right | leaf y 205.8 to (761.7, 206); arc to 268.3 |
| D3 | I14 | 9–73.3 | start / left | leaf x 989.7–995, y 298–362; arc to (1053.3, 356.7) |
| D4 | I6 | 66.5–144.7 | start / left | leaf x 433.6–439; arc to (512.7, 483.6); jambs 434.5 / 512.7 |
| D5 | I7 | 67.5–145.6 | start / left | leaf x 714.5–719; jambs 715.5 / 793.6 |
| D6 | I15 | 16–94 | start / left | leaf y 494–497 to x 899; arc to (826, 574); 10 px nib under I8 |
| D7 | X9 | 105–186 | end / left | leaf rectangle y 773–788; arc up to (155, 697); inner face stops at 698; bold stroke continuous |
| D8 | I17 | 17–91 (bifold) | start / right | hinge circle (296, 385), fold (271, 409.5), back to (296, 437); stubs end 381 / start 455 |
| G1 | X7 | 0–235 (slider) | – | jamb box 578–594, tracks 602–754, box 762–808 |
| G2 | X5 | 45–227 | – | x 894–1046: bold 806–812 plus thin lines at 800 and 803; box to the block at 1078 |
| G3 | X8 | 148–268 | – | x 310–410: bold 802–807 plus thin lines at 795.5 and 798.5; x 150–300 has bold plus face only |
| G4 | I16 | 41–97 | – | x 1024–1072: four faint lines (172 / 175 / 178 / 181); x 976–1018 faces only |
| G5 | B2 | 0–257, **ignored** | – | bold 919–925 plus a band 912–917: railing or window (the wall truth's own judgement call) |

**HDB window rule** (`method.window_rule`). A window has ≥ 2 thin frame lines along (or in place of) the wall's own line work. A bold stroke with one thin line beside it is a wall with its inner face, as the wall truth reads X8, X9 and X4. So the top wall, the bay and X4b (bold plus thin between the black piers) have no window.

### Brochure: 6 doors, 11 windows (one ignored), 0 scored passages

| Id | Wall | Interval | Hinge / swing | Reading |
|---|---|---|---|---|
| D1 | W23 | 19–45.5 | end / right | arc (128, 160.8) to (151, 135.5) about (152, 161) |
| D2 | W20 | 34.8–56.5 | start / right | leaf x 111, y 165–182.5; arc to (131.7, 162.5) |
| D3 | W12 | 19.5–45.5 | end / left | arc (245.8, 136) to (270.4, 160) about (247, 161) |
| D4 | W13 | 3–24 | start / left | arc (250, 187.5) to (266.7, 171.7) about (250, 168) |
| D5 | W15 | 49.5–79.5 | end / right | leaf x 167.5; threshold band x 167.5–197.5 |
| D6 | W26 | 21–83 (bifold) | not scored / left | folding leaves stacked at both jambs (x 174–181 and 230–235), into the deck |
| G1, G2 | W1, W5 | 22–75, 20–74 | – | white breaks with two frame lines |
| G3, G4, G5 | W17, W16, W9 | 17–35, 30–65, 22.5–40 | – | white breaks with frame lines |
| G6–G10 | W19, W22, W11, W6, W16 | – | – | neutral grey panels (RGB ≈ 127 129 128 against slate 85 102 109) between black end lines |
| G11 | W13 | 31.7–52.5, **ignored** | – | grey panel between the right toilet and the living room: implausible as a window |

**Not scored: the kitchen's open side** (x 152, y 215–245). No truth wall spans it: W24 ends at b13 and W25 starts at b22 (`method.not_listed`). Adding a truth wall there would change the verified wall truth and drop brochure wall recall below its floor.

**Overlay** (traced openings in green/blue/grey, detections in orange):
- `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/t17/hdb-3room-final-openings.png`
- `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/t17/brochure-2bhk-final-openings.png`

## 4. Metrics history

| # | Change | HDB R / P | Brochure R / P | Walls HDB; brochure |
|---|---|---|---|---|
| 0 | §8.5 on the gaps plus per-wall solid breaks, a hinge/radius grid | 0.167 / 0.222 | 0.125 / 0.667 | unchanged |
| 1 | door-span search; breaks along chained wall lines; bi-fold before arcs | 0.333 / 0.444 | 0.250 / 0.667 | – |
| 2 | window before door; middle-third arc rule | 0.250 / 0.333 | 0.250 / 0.667 | – |
| 3 | samples under labels not judged, ≥ 8 judged (bedroom 1's arc runs under "BEDROOM" / "3100") | 0.333 / 0.444 | 0.250 / 0.667 | – |
| 4 | a clear arc (≥ 0.75) outranks frame lines (brochure entrance) | 0.333 / 0.444 | 0.312 / 0.833 | – |
| 5 | R-b, first version (I15's gap found; door test failed on the nib) | 0.333 / 0.400 | 0.375 / 0.857 | 0.901 / 0.963, 6 faces; 0.924 / 0.868 |
| 6 | walls' strips not judged; nib spans | 0.417 / 0.500 | 0.375 / 0.857 | – |
| 7 | label-hidden gaps are no passage; min door 2 t | 0.417 / 0.556 | 0.375 / 1.000 | – |
| 8 | door leaves excluded from pairing (toilet 3) | 0.417 / 0.556 | 0.375 / 1.000 | 0.927 / 0.992; **0.912 / 0.852**, entrance wall lost. Rejected |
| 9a | leaves refuse partners ≥ 1.5× | – | 0.375 / 1.000 | 0.927 / 0.973; **0.899** / 0.862. Rejected |
| 9b | all leaf pairs deferred | – | – | HDB outer free end 1. Rejected |
| 9 | leaf pairs beside a ≥ 1.5× longer line deferred (committed) | 0.417 / 0.556 | 0.375 / 1.000 | 0.927 / 0.973, outer 0; 0.920 / 0.864 |
| 10 | simplified: no hinge/radius grid, no middle-third rule, min door 1.5 t (ablations: identical on both images and synthetic) | 0.417 / 0.556 | 0.375 / 1.000 | same |
| 11 | candidates trimmed at junctions, spans clamped (final) | **0.417 / 0.625** | **0.375 / 1.000** | **0.927 / 0.973; 0.920 / 0.864** |

**Ablations on the final code** (each rule switched off):
- the span search (`SPAN_STEPS = 1`): HDB 0.250 / 0.333;
- the clear-arc order: brochure 0.312 / 0.833;
- the label passage rule: HDB P 0.500, brochure P 0.857;
- with the strips and labels not judged turned off, 6 synthetic tests fail.

## 5. Deviations for spec 19

1. **06 §8.5, candidates.** Breaks in `pre.thick` along straight wall lines (graph walls chained within 3° through nodes) are candidates too: 1.5–18 t between solid stretches ≥ 0.5 t past the end junctions, not passages. A gap inside one takes its extent. Candidates are trimmed clear of crossing walls (half their thickness + 2 px) and dropped below 1.5 t; spans are clamped to the wall.
2. **06 §8.5 step 1, door support.**
   - Samples on any wall's strip, or within 2 px of ink the text mask removed, are not judged; at least 8 must be.
   - Locating the removed ink reads `pre.ink & ~ink_notext`. That is the label area, never evidence. Please confirm this against R6.
3. **06 §8.5 step 1, door span.** The hinge may lie up to g beyond a gap end or 0.2 g inside it, and the leaf may close down to 0.5 g short. The opening is the door's span. The leaf bonus uses that radius. No door is narrower than 1.5 t and 10 px.
4. **06 §8.5, order.** An arc ≥ 0.75 is a door; else frame lines make a window; else an arc ≥ 0.55 is a door. 06 tests the door first.
5. **06 §8.5 step 2, window.**
   - The strip is 0.75 t to either side (ruling B2's evidence strip). 06 says width t.
   - Sliding: ≥ 3 lines of ≥ 40 % coverage, two offset (overlap ≤ 60 % of the shorter, union ≥ 80 %).
6. **06 §8.5 step 3, passage.** Not when label-removed ink runs along ≥ 50 % of the gap.
7. **Bi-fold** (brief B) is a V of two leaves at a jamb (04 §8.2 draws `bifold` that way); folded leaves stacked at the jambs (the brochure deck) are not recognised.
8. **06 §8.1 step 8 / R-b.** A partition's free end with a door arc (Task 16c `door_arc`) facing a run crossing at ≥ 60° within 18 t is carried to it with `(0, g)` as an opening. The arc may close on the face or the centre line, and the hinge may sit behind a 0.15 g nib. The brief said "radius ≈ gap ± 15 %, centred within 0.5 t of the jamb"; the face/centre-line and nib variants extend that.
9. **06 §8.1 step 3, pairing order.** Door leaves (a thin line with a `door_arc` about an end) pair with a ≥ 1.5× longer line only after all other pairs.
10. **Interface.** `find_openings(graph, pre, segments, ink_notext)` (the brief), against 06's `(graph, gaps, ink_thin, region)`.
11. **Acceptance metric.** A match lies on the traced wall (parallel ≤ 10°, middle within 0.5 t), covers ≥ 50 % of the traced width, has the same kind, and is one-to-one. Ignored truth entries are neutral.
12. **Truth judgement calls:**
    - the HDB window rule;
    - G5 (balcony railing) and G11 (toilet–living grey panel) ignored;
    - the HDB slider scored as kind window (its symbol);
    - the brochure kitchen opening unscored;
    - D6 (double bi-fold) hinge not scored.
13. **`WALL_FLOOR`.** The brochure's precision floor moves from 0.865 to 0.864. It is above the brief's 0.85.

## 6. Blocker and proposed rulings

### Why each missing opening is missed

| Opening | Cause | Stage |
|---|---|---|
| HDB D3 (toilet 3) | I14's faces are cut by the "1800" dimension's end tick at x 1083. The pieces are 11–26 px, too short to pair, and too far from the dimension line's end to be rejoined (`_rejoined`) | walls |
| HDB D8 (store) | I17's stubs (20–22 px) are too short to pair (0.03 L), so there is no wall to hold the bi-fold | walls |
| HDB G1 (slider) | the slider's tracks pair into a double-line wall (step 3); only fragments become gaps | walls |
| HDB G4 (toilet 3) | I16's window and faces are faint; I16 is not extracted | walls |
| HDB D7 (entrance) | the bold outer stroke runs across the door, so there is no gap and no solid break | openings source |
| HDB G2, G3 | frame lines beside a bold stroke that runs through | openings source |
| HDB false O6–O8 | X6's double line (798.5 / 807.5) is not paired, leaving a graph gap with nothing in it; the slider's box makes 2 more | walls |
| Brochure D1, D4 | the door's own arc pairs into a short jog piece (D1); the gap is 1.6× the arc radius (D4) | walls / R-b |
| Brochure D2 | the toilet wall's piece W20 is tilted 8.5° by the arc, so it is not collinear | walls |
| Brochure D6 | folding leaves stacked at both jambs; a double-line piece is traced across the deck opening | walls / openings |
| Brochure G3 | the window's frame lines lie under two labels (text mask; R6 forbids raw ink) | – |
| Brochure G6–G10 | grey panels: the panel is in `pre.thick` like the wall, so there is no break and no lines | openings source |

### Proposed rulings, with prototypes

The prototypes were not committed. They post-process the final chain; the script is `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/t17/proto.py`.

- **R17-a: doors from leaves anywhere along a wall.** A `door_leaves` leaf (a line with its arc) whose hinge lies on a graph wall's line, with the leaf perpendicular to the wall (±10°) and the arc closing along it, is a door over `[hinge, hinge ± r]`, even without a gap. The hinge may lie within 0.75 t + 0.012 L of the line.
  - HDB: +D7, giving **R 0.500 / P 0.667**.
  - Brochure: +0, and one false door (on the entrance leaf's own stub wall W38), giving 0.375 / 0.857.
- **R17-b: grey wall panels are windows** (colour drawings). On a filled wall whose centre-line grey has a median of 50–170, a stretch 1.5–18 t long that is ≥ 20 grey levels lighter than that median (and < 200) is a window of type `fixed`.
  - Brochure: +G3, G6, G7, G9, giving **R 0.625 / P 1.000**.
  - HDB: one false window (W60), giving P 0.556.
- **R17-c: frame-line windows beside a solid wall** (HDB G2, G3). A naive prototype counting ≥ 2 thin lines on paper along filled walls found G3 but made 5 false windows. It needs a sharper rule; I do not propose it as is.
- **R17-d: walls-stage residuals for Task 18/34:**
  - rejoin face pieces cut by a dimension line's end tick within its tick length (I14);
  - pair short stubs ending on a perpendicular wall (I17);
  - recognise slider tracks;
  - find why X6's double line is not paired;
  - faint double lines (I16).
- **R17-e:** with R17-a and R17-b together the prototypes give **HDB 0.500 / 0.600 and brochure 0.625 / 0.909**. That is still below the targets. The rest needs R17-d (HDB: 4 openings and the 3 X6/X7 false ones) and brochure door fixes (D1, D2, D4, D6).

**Alternative.** Accept Task 17 as committed: the stage, R-b and the toilet-3 fix, with walls up to HDB 0.927 / 0.973 and 6 faces, and every floor held. Then:
- carry the targets to a follow-up task that takes R17-a, R17-b and R17-d;
- or re-scope Task 17's acceptance to doors. HDB doors are 5 / 8 (6 / 8 with R17-a), precision 5 / 5 on doors.

## 7. Tests and evidence

**RED.**
- `tests/test_openings.py` against a stub `find_openings` returning `[]`: **15 failed**.
  - 10 failed on the missing behaviour: empty unpack, the ids, and the vertical-wall hinge and swing cases.
  - 5 failed at the first helper's orientation precondition. The graph turns the top wall around by a pixel of tilt; that precondition was replaced by `as_drawn`.
  - Before that, without the module: `ModuleNotFoundError` at collection.
  - Output: `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/t17/red-openings.txt`.
- R-b, `test_door_at_a_partitions_free_end_extends_it_to_the_wall[start-1, end--1]`: **2 failed** (`1 == 0` free ends); the no-door control passed. Output: `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/t17/red-rb.txt`.
- Toilet 3, `test_door_leaf_beside_a_wall_face_does_not_take_the_face`: **failed**, partition 299 px traced instead of 800 ± 20. Output: `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/t17/red-leaf.txt`.

**Tests written after the code, from the reference measurements, each checked by switching its rule off:**

| Test | Rule switched off | Result |
|---|---|---|
| label passage | `_under_label` | fails |
| clear arc vs threshold | `DOOR_CLEAR` | fails |
| window across a junction | per-wall lines | fails |
| arc under a label | labels/strips judged | fails, together with 5 others |
| junction trimming | – | direct unit test |
| tangent lines | – | a guard only: the dropped middle-third rule made no difference |

**GREEN.**

| Command | Result |
|---|---|
| `uv run pytest -q tests/test_openings.py` | 25 passed |
| `uv run pytest -q tests/test_reference_openings.py` | 12 passed, 2 xfailed (strict targets) |
| `uv run pytest -q` (full) | **889 passed, 1 skipped, 3 xfailed** in 186 s. The xfails are the 2 opening targets and the Task 18 seven-faces target |
| `uv run ruff check .` / `ruff format --check .` / `mypy app` | clean / 81 files formatted / no issues in 50 files |

## 8. Files

- **New:** `vision/app/pipeline/openings.py`, `vision/app/pipeline/opening_evidence.py`, `vision/tests/test_openings.py`, `vision/tests/test_reference_openings.py`, and the two `*.drawing-openings.json`.
- **Changed:**
  - `vision/app/schemas/candidates.py` (`OpeningCandidate`);
  - `vision/app/pipeline/walls.py` (R-b, leaves, evidence moved out);
  - `vision/app/pipeline/wall_candidates.py` (leaf pair order);
  - `vision/tests/support/reference.py`;
  - `vision/tests/test_segments_walls.py` (K18);
  - `vision/tests/test_reference_dims.py` (`WALL_FLOOR`);
  - `vision/tests/test_preprocess.py` (C);
  - `vision/tests/test_walls_closure.py` (import).
- **Not touched:** `dimension*.py`, `*.drawing-dims.json`, `*.drawing-walls.json`.

## 9. Concerns

1. **Targets not met** (§6). NEEDS_CONTEXT.
2. **`walls.py` is 1,578 lines.** It was 1,647; the evidence move took 170 out and R-b added 100. A split (step 8 and linking into `wall_runs.py`) still needs a plan decision.
3. **R6.** `find_openings` reads `pre.ink & ~ink_notext` to know where labels erased ink. It never uses that ink as evidence (§5.2). Please confirm.
4. **The brochure's wall precision is 0.864**, 0.001 under the 16c value and above the brief's 0.85.
5. **Truth judgement calls** need an independent look (§5.12), especially the HDB window rule and the brochure grey panels as windows.

---

# Continuation: controller rulings on the NEEDS_CONTEXT

**Status: DONE.** Commit `0ea3dca` (pushed): feat(vision): doors from leaf and arc on unbroken walls, grey panels as windows (rulings R17-a, R17-b).

## C1. Rulings implemented

- **R17-a, doors from a leaf and its arc** (`openings._leaf_doors`). `opening_evidence.door_leaves` now returns each leaf's geometry: hinge, leaf direction, the closed leaf's direction and length. The walls stage uses its ids as before. A leaf whose hinge lies on a graph wall's line, with the leaf perpendicular to that wall and the arc closing along it, both within 10°, is a door over `[hinge, hinge ± length]`.
  - The hinge may lie within 0.75 t + 2 px + 0.012 L of the line. With 0.012 L dropped, the HDB entrance is lost: its hinge sits on the face of a wall drawn as a thin bold stroke.
  - The door goes on the wall that holds most of the span (at least half).
  - A wall that runs along a leaf hosts none. Without this guard, the brochure entrance's leaf, paired into a stub wall, hosted a false door.
  - Detections that overlap an opening already found on the same wall by more than half are not added.
- **R17-b, grey panels as windows** (`openings._grey_panels`). This applies only when `pre.drawing_kind == "colored_brochure"` (the preprocess classification).
  - On a wall whose centre-line grey (mean of the centre line and the lines ±0.15 t) has a median of 50–170 (grey poché), a stretch 1.5–18 t long that is ≥ 20 levels lighter than that median and < 200 is a `fixed` window.
  - Sensitivity: with 10 levels the result is the same; with 30 levels the brochure falls to 0.562.
- **R17-c** is not adopted.

**Synthetic tests** (`tests/test_openings.py`), written after the code:
- `test_leaf_and_arc_make_a_door_across_an_unbroken_wall`: the graph has no gap, and the door, hinge and swing are found;
- `test_leaf_without_an_arc_is_no_door`;
- `test_grey_panel_in_a_grey_wall_is_a_window_of_a_colour_plan[colored_brochure, architectural_line_drawing]`: a window on the colour plan, nothing on the line drawing;
- `test_uniform_grey_wall_has_no_panel`.

Each fails with its rule removed. The R17-a case has no gap and no solid break, so nothing else can find it. The R17-b panel is solid ink like its wall.

## C2. New acceptance (`tests/test_reference_openings.py`)

- **Regression floors replace the strict-xfail targets:**
  - `OPENING_FLOOR`: HDB (0.500, 0.666), brochure (0.625, 1.0);
  - `FACES_FLOOR`: HDB 6, brochure 4 (`test_faces_do_not_drop`).
- The brief's targets (HDB 0.75 / 0.85, brochure 0.70 / 0.80) move to the **Task 33/34 evaluation of the AI-assisted path**, as goals there. The heuristic labeler (provider `none`) is the fallback; the AI labeler and the review UX are 06's primary correction path.
- The other floors still hold:
  - hinge/swing ≥ 0.80;
  - `WALL_FLOOR`;
  - outer free ends 0;
  - dims unchanged;
  - the non-OCR chain < 10 s.

## C3. Final metrics

| Metric | HDB | Brochure | Floor | Holds? |
|---|---|---|---|---|
| Openings R / P | **0.500 / 0.667** (6/12, 6/9) | **0.625 / 1.000** (10/16, 10/10) | the reached values | Yes |
| Hinge and swing of matched doors | 1.00 (6/6) | 1.00 (2/2) | ≥ 0.80 | Yes |
| Walls R / P | 0.927 / 0.973 | 0.920 / 0.864 | ≥ 0.927 / 0.973; ≥ 0.920 / 0.864 | Yes |
| Outer-cycle free ends | 0 | 0 | 0 | Yes |
| Bounded faces | 6 | 4 | ≥ 6 / ≥ 4 | Yes |
| Dims R / P / intervals / labels / ticks | 0.833 / 1.000 / 0.979 / 0.923 / 0.985 / 0.932 | 0 lines | unchanged | Yes |
| Non-OCR chain (openings stage) | 1.8 s (0.07 s) | 1.2 s (0.13 s) | < 10 s | Yes |

Openings found:
- **HDB:** D1, D2, D4, D5, D6 (R-b) and **D7, the entrance (R17-a)**.
- **Brochure:** D3, D5, G1, G2, G4, G5 and **G3, G6, G7, G9 (R17-b)**. G3 is lighter than its wall as well as being under the labels. The ignored G11 is also detected, neutrally.

False detections: HDB 3, the X6/X7 balcony artefacts (R17-d); brochure 0.

## C4. Truth documentation

Each JSON's `method` now holds a `judgement_calls` list.

- **HDB:**
  - the window rule and what it excludes (top wall, bay, X4b, the kitchen's X9 stretch);
  - the slider scored as a window;
  - G5 (railing) ignored;
  - X6 as a wall;
  - the door-interval conventions (D1, D2, D6, D7);
  - the D8 bi-fold reading.
- **Brochure:**
  - grey panels as fixed windows, with G7 and G8 overhanging their walls;
  - G11 ignored;
  - the kitchen passage unscored;
  - D6's hinge not scored;
  - D1 and D3 drawn without leaf lines;
  - G3 under labels.

## C5. Residuals (Task 34)

From R17-d:

1. **HDB I14** (toilet-3 door D3): its faces are cut by the "1800" dimension's end tick at x 1083. The pieces are 11–26 px, too short to pair and too far from the dimension line's end for `_rejoined`.
2. **HDB I17** (store bi-fold D8): its stubs (20–22 px) are below the 0.03 L pairing length, so there is no wall to hold the bi-fold.
3. **HDB X7 slider (G1):** its tracks pair into a double-line wall (step 3), leaving only fragments as gaps; with X6, these make the 3 HDB false detections.
4. **HDB X6:** its double line (798.5 / 807.5) is not paired, so the graph bridges it as a gap with nothing in it (a false passage).
5. **HDB I16** (toilet-3 window G4): its faint faces and window are not extracted.
6. **HDB G2, G3:** frame-line windows beside a bold stroke that runs on. R17-c was not adopted.
7. **Brochure doors:**
   - D1: the door's arc pairs into a jog piece;
   - D2: the toilet wall piece W20 is tilted 8.5° by the arc;
   - D4: the gap is 1.6× the arc radius;
   - D6: folding leaves stacked at both jambs, with a double-line piece traced across the deck.
8. **Brochure G8, G10:** two grey panels are not found. One sits at a junction (G8, on W11 past b21) and one at a wall's end (G10). Likely, the junction node cuts the panel stretch or the stretch runs into the end; this is not diagnosed.

## C6. Deviations added for spec 19 (accepted rulings)

14. **R17-a.** Doors are inferred from a leaf and its arc along a wall without a gap. The hinge is within 0.75 t + 2 px + 0.012 L of the wall line, the leaf perpendicular within 10° and the arc closing along the wall; the door goes on the wall holding at least half of its span; walls running along a leaf are excluded.
15. **R17-b.** On colour brochure plans, grey wall panels are `fixed` windows: wall median grey 50–170, panel ≥ 20 levels lighter and < 200, 1.5–18 t long.
16. **Acceptance.** The opening targets move to Task 33/34; regression floors are set at the reached values.

The 13 deviations of §5, the `WALL_FLOOR` update and the R6 reading of `pre.ink & ~ink_notext` (label location only) are accepted per the ruling.

## C7. Evidence

| Command | Result |
|---|---|
| `uv run pytest -q tests/test_openings.py` | 30 passed |
| `uv run pytest -q tests/test_reference_openings.py` | 14 passed |
| `uv run pytest -q` (full) | **896 passed, 1 skipped, 1 xfailed** in 211 s. The xfail is Task 18's ≥ 7 faces |
| `uv run ruff check .` / `ruff format --check .` / `mypy app` | clean / 81 files formatted / no issues in 50 files |

**Cleanup.** The scratch prototypes (`proto*.py`) are deleted. The final overlays were regenerated:
- `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/t17/hdb-3room-final-openings.png`
- `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/t17/brochure-2bhk-final-openings.png`

---

# Fix round 1 (review `task-17-review.md`)

**Status: DONE.** Two commits, both pushed:

| SHA | Subject |
|---|---|
| `75f6f3f` | refactor(vision): split walls.py into wall_skeleton.py and wall_runs.py |
| `e33d0a4` | fix(vision): Task 17 review fixes (solid-wall windows, quadrant fixtures, truth) |

## FR1-0. The `walls.py` split (no behaviour change)

The split follows the reviewer's plan:

| Module | Lines | Contents |
|---|---|---|
| `wall_skeleton.py` | 314 | step 6: `_Edge`, `_trace`, the spur and contract passes, `_Piece` and `_pieces`, with the `source_mask` labels |
| `wall_runs.py` | 680 | steps 7–8 and linking: snap, `_join` / `_close_end`, `_march_free_ends`, `_Item` / `_Run`, `_runs`, `_link_runs`, `_partition_doors`, `_opening_line`, `_drop_leaves` and `_weighted_median` |
| `walls.py` | 647 | the masks, `extract_walls`, `_trace_raw_walls`, dedupe, the extension cut, `walls_to_graph` and debug |

Each constant moved with its only users. Constants used across modules live in the lower module and are imported upward.

**Tests.** Tests that reached the moved names now use `wall_runs` (`runsmod`): `_Run`, `_Item`, `_link_runs`, and the monkeypatches of `_close_end`, `_join` and `LEAF_MAX`. Patches of names still called from `walls.py` (`_link_runs`, `_wall_thickness`) are unchanged.

**Verification.** A dump of both reference images was taken before and after, with `repr` at full float precision, and the two dumps are **byte-identical** (md5 `36181c55…` for both). The dump holds:
- every `RawWall`;
- the `WallGraph` (nodes, walls, gaps);
- every `OpeningCandidate`;
- the wall and source mask sums, `t_median` and `theta0`.

Full suite at the split: 896 passed, 1 skipped, 1 xfailed.

## FR1-1. Fixes, by finding

**I1: false windows in solid walls** (`openings._window`, `_solid_flanked`, `_light_inside`, `_jamb_line`, `_outlined`).

A window *in a solid wall* needs both of these:
- **a light interior:** per position, the lightest of 7 lines across the inner 0.7 t, taken as the median along the stretch, at least 40 grey levels above the flanks read the same way;
- **one of:**
  - a frame or sash line strictly inside the strip (|offset| ≤ 0.35 t, covering 40 %);
  - jamb lines across the wall at both ends, on paper, with no solid ink 2 px to either side. A solid piece's own end edge is no jamb: LSD reads it as a thin line across.

"In a solid wall" means a break in the solid ink, or a gap with solid ink just outside both ends.

A gap of a solid wall whose outline runs on along both faces (two face lines each covering 80 %) is no passage. That is the reviewer's t 20 hollow stretch, which arrives as a graph gap.

Tests (written first, from `rv17/cc/win.py` and `r17b2.py`):
- `test_hollow_stretch_of_a_solid_wall_is_no_window[t14, t20]`;
- `test_lighter_stretch_of_a_grey_wall_without_end_lines_is_no_window[110 colour, 110 line drawing, 125 line drawing]`.

**Synthetic window tests changed.** `test_window_casement` and `test_window_across_a_junction_is_one_window` now draw 04 §8.2's casement: frame lines on both faces plus a glass line, in a 24 px wall. With only two face lines, a casement is exactly the hollow-stretch counter-case. At 14 px, LSD drops one of three lines 7 px apart.

**I2: R17-a false doors** (`openings._shares_its_arc`, `_against_a_face`, `_leaf_arc_support`).
- A leaf is dropped when a second leaf of about the same length (±15 %) hinges at the same point (within max(4 px, 0.1 r)) along its closed direction (±10°). That is a quadrant shower tray.
- A leaf is dropped when it lies against a wall's face: parallel within 10°, its middle within 0.5 t + max(3 px, t/4) of the wall's line, over half its length. Walls made of a leaf (a leaf paired into a wall piece) do not count. That is a quarter-round corner shelf.
- An inferred door reports its measured support: the share of the 24 arc samples about the leaf's own hinge, plus the 0.15 leaf bonus. The HDB entrance reads 0.98.

Tests (written first, from `rv17/cc/r17a.py`):
- `test_quadrant_shower_tray_in_a_corner_is_no_door[inset 3, 6]`;
- `test_quarter_round_corner_shelf_is_no_door`;
- `test_leaf_door_reports_its_measured_support`, with a two-thirds arc: 0.82 ± 0.1.

**I3 and truth T1–T4.** All four were profile-checked; each `method` and the `judgement_calls` are updated.
- **T1:** HDB **G6**, window on X9b, u 233–320 (y 461–548). Profiles (gray < 200, every 5 px) read:
  - y 465–500: a faint frame line at x 145 (gray 160–215) beside the bold 153–158;
  - y 505–545: two thin lines at x 145–147 and 149–150 (gray 75–108) beside the bold;
  - a frame box with a sash. `judgement_calls[0]` no longer excludes it.
- **T2:** HDB **G7 (B1, u 12–106)** and **G8 (B3, u 7–119)** are `ignore`, with G5's reasoning.
  - B1: bold 503–507 plus thin lines at 511.5 and 514.5 over y 810–900.
  - B3: thin lines at 827.5, 830.5 and 835.5–836.5 over y 810–910.
- **T3:** HDB **G1** (the balcony slider) is kind `door`, type `sliding`, with hinge and swing null and not scored. The truth test now allows a sliding or pocket door with no hinge and swing. (The ruling said "brochure G1"; the slider is HDB's G1, as review T3 states.)
- **T4:** the brochure D3 leaf lies along W8 (from (247, 161) to +x), not W18.

**Floors re-based.** HDB now has 13 scored openings, so `OPENING_FLOOR` HDB is (0.461, 0.666), i.e. 6/13 and 6/9. The brochure stays (0.625, 1.0).

**Minor 4: R-b and a door in the crossing wall** (`wall_runs._leaf_along`).
- An arc whose hinge has a straight leaf running along the partition's line is the crossing wall's door, hinged beside that line. The leaf's ends must lie within 0.5 t + 2 px of the line, start within 0.2 r of the hinge and end 0.8–1.2 r out. R-b skips it, and the partition's end stays free.
- The hinge tolerance is `door_arc`'s centre tolerance, 0.5 t + 2 px, the Task 16c arc rule as implemented. The reviewer's hinges at ±7 px (0.5 t) fall inside it, so the leaf guard is what separates the cases.
- Test (written first, from `rv17/cc/rb.py`): `test_door_in_the_crossing_wall_does_not_extend_a_partition[hinge x 1207 end, x 1193 start]`. The partition stays at y 1400, there is 1 free end, and exactly one door.

**Minor 8: dedupe on collinear neighbours** (`openings._new_on_their_lines`). R17-a and R17-b openings are compared with the ones already found along the straight wall line (`_lines`), not by wall id. Test: `test_inferred_openings_are_not_found_again_beyond_a_junction`, on a hand-built graph.

**Minor 9: `PANEL_PAPER`.**
- The ceiling is now the paper level (the plan region's commonest grey; 254 on the brochure, 255 on HDB) minus 40.
- Brochure G3 reads 190, so its margin goes from 10 to 24.
- The panel's support is its contrast: the panel's grey above the wall's, as a share of paper above the wall's.
- Test: `test_grey_panel_ceiling_follows_the_paper[205 is a panel, 240 is paper]`. The 205 case fails under the old fixed 200 ceiling.

**Minor 10: docstrings.** `OpeningCandidate` now lists `fixed` and `bifold` and documents `support` per kind (arc, double, bi-fold, frame lines, panel contrast, passage). The `openings.py` module doc describes the I1/I2 rules and R17-a/b.

**Minor 11.** The `del w` leftover is removed.

**Not taken.**
- **Minor 12** (no passage in either truth) carries to Task 33/34.
- **Minor 13** is done (FR1-0).

**The reviewer's counter-case scripts re-run on the final code** (`rv17/cc`):

| Script | Result |
|---|---|
| `r17a` | shower trays and the corner shelf give **0 doors**. The table, sofa and console give 0. The quarter-circle desk off a wall (the door glyph, accepted as inherent) gives 1 door |
| `win` | the hollow stretches give **none**. Tiles give none. The threshold strip gives a casement (06 step 2, noted). The bi-fold cases are unchanged |
| `rb` | 4/4 horizontal R-b. The crossing-wall door gives **partition free, one door**. The table in the passage leaves the end free |
| `r17b` | all cases unchanged |
| `r17b2` | the 110 stretch gives **none** on both kinds |

**Residual.** A 125-grey stretch **with no end lines** on a *colour* plan is still read as an R17-b `fixed` window (support 0.15–0.25). It is R17-b's symbol without its black end lines, so requiring end lines would tighten R17-b. Every brochure panel has them. This is carried to Task 34.

## FR1-2. Metrics

| Metric | HDB | Brochure | Floor | Holds? |
|---|---|---|---|---|
| Openings R / P | **0.462 / 0.667** (6/13, 6/9) | **0.625 / 1.000** (10/16, 10/10) | re-based (0.461 / 0.666; 0.625 / 1.0) | Yes |
| Hinge and swing of matched doors | 1.00 | 1.00 | ≥ 0.80 | Yes |
| Walls R / P | 0.927 / 0.973 | 0.920 / 0.864 | `WALL_FLOOR` | Yes |
| Outer free ends | 0 | 0 | 0 | Yes |
| Bounded faces | 6 | 4 | ≥ 6 / ≥ 4 | Yes |
| Dims R / P / intervals / labels / ticks | 0.833 / 1.000 / 0.979 / 0.923 / 0.985 / 0.932 | 0 lines | unchanged | Yes |
| Non-OCR chain (openings stage) | 1.6 s (0.09 s) | 1.1 s (0.14 s) | < 10 s | Yes |

HDB missed: D3, D8, G1 (now a sliding door), G2, G3, G4 and G6. The last is the new kitchen window; it is drawn beside a bold stroke that runs on, like G2 and G3, so it is missed by R17-c, which was not adopted.

## FR1-3. Evidence

**RED**, each run before its fix:
- I1: **5 failed**: the hollow stretch at t 14 and t 20, and the lighter stretch at 110 colour, 110 line drawing and 125 line drawing.
- I2: **3 failed**: the shower tray at inset 3 and 6, and the corner shelf.
- Minor 4: **2 failed**: the crossing-wall door at x 1207 and x 1193. The partition was extended to y 1497.

**Rule switched off, after the fix:**

| Rule off | Fails |
|---|---|
| `_shares_its_arc` | the shower trays |
| `_against_a_face` | the shelf |
| `_light_inside` | the 3 lighter stretches |
| `_outlined` | the t 20 hollow stretch |

The minor-9 ceiling test fails under the old fixed ceiling.

**GREEN.**

| Command | Result |
|---|---|
| `uv run pytest -q tests/test_openings.py` | 44 passed |
| `uv run pytest -q tests/test_reference_openings.py` | 14 passed |
| `uv run pytest -q` (full) | **910 passed, 1 skipped, 1 xfailed** in 196 s (the xfail is Task 18's ≥ 7 faces) |
| `uv run ruff check .` / `ruff format --check .` / `mypy app` | clean / 83 files formatted / no issues in 52 files |

## FR1-4. Deviations added for spec 19

17. **Windows in a solid wall's ink break** need a light interior (+40 grey levels) and an inner frame or sash line (≤ 0.35 t, ≥ 40 %) or jamb lines at both ends. *Revised in fix round 2 (ruling N1):* graph gaps take 06 §8.5 step 2 unchanged; a jamb meeting the wall end counts, and so does a solid piece's own end edge; an inner line may be read from the text-free ink. Residual: a hollow (double-line) stretch of a solid wall reads as a casement.
18. **R17-a fixtures.** A leaf closing a quarter sector with a second leaf, or lying against a wall's face, infers no door. Inferred doors report their measured arc support plus the leaf bonus. *Accepted residual (N2, fix round 2):* a real corner-hinged door whose open leaf rests within about 3 px of the side wall's face is dropped with the quarter-round shelf (`_against_a_face`); 4 px and more off the face it is found.
19. **R-b.** An arc whose hinge has a straight leaf along the partition's line is the crossing wall's door, and R-b skips it.
20. **R17-a and R17-b dedupe** runs along straight wall lines.
21. **R17-b ceiling.** Paper level minus 40; the panel's support is its contrast.
22. **Truth.** HDB G6 added; G7 and G8 ignored; HDB G1 is door/sliding with hinge and swing unscored.

Scratch files are deleted. The final overlays are kept:
- `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/t17/hdb-3room-final-openings.png`
- `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/t17/brochure-2bhk-final-openings.png`

# Fix round 2 (re-review `task-17-rereview-1.md`)

## FR2-1. N1: plain casements in solid walls

**What changed** (`vision/app/pipeline/openings.py`):
- `_classify` asks the I1 evidence of solid-ink breaks only (`is_gap=False`). A graph gap takes 06 §8.5 step 2 unchanged: ≥ 2 thin parallel lines within ±3° covering ≥ 80 % of the gap in the wall strip.
- `_jamb_line` no longer needs paper 2 px either side. A jamb line that meets the wall end counts (`JAMB_CLEAR_PX` removed).
- New `_inner_ink`: an inner frame or glass line may also be read from `ink_notext`, on one line within 0.35 t covering ≥ 40 %. At t 14, LSD merges the 3-line window's glass line into the wall's own centre-line (thick) segment, and the glass line also cuts the end edges in half, so neither the segment nor the jambs were seen.
- Dead code removed: `_outlined`, `_solid_flanked`, `_flank_points` and `_Ink.solid`. Module and `_window` docs updated.

**The ruling's premise does not hold for the synthetic cases. This conflict needs a controller decision.**

| Case | Candidate | Pixels | Result now |
|---|---|---|---|
| Brief's 2-line casement, t 14 (`SWindow(lines=2)`) | **solid-ink break** (graph gaps: none) | | casement |
| I1 hollow stretch, t 14 (350–550) | solid-ink break | identical to the casement except for a 1 px face-line overshoot and the length (186 vs 120 px) | casement (counter-case lost) |
| I1 hollow stretch, t 20 (300–600) | graph gap | | casement (counter-case lost) |

- In both cases the only end evidence is the solid pieces' end edges, which LSD returns as perpendicular thin lines. A jamb meeting the wall end counts, so these edges count, and the requirement cannot tell the two apart.
- Read literally, the ruling (frame/jamb requirement on breaks, plain rule on gaps) would lose the brief's casement, which is a break, and would also turn the t 20 hollow stretch, which is a gap, into a window. It fails both.
- I followed the ruling's intent and the spec: plain casements are found.
- The two hollow-stretch counter-cases are now `xfail(strict=True)` and documented as a residual under deviation 17.
- The colour-shift counter-cases still pass, through `_light_inside`.
- If the hollow stretch must win instead, put back the 2 px clearance in `_jamb_line`. That re-loses the brief's 2-line casement; the 3-line one and the frame rectangle keep passing.

**Tests** (`vision/tests/test_openings.py`):
- `test_window_casement` is restored verbatim from the brief (t 14, 2 lines).
- New: `test_window_casement_with_a_glass_line_in_a_solid_wall` (3 lines, t 14).
- New: `test_window_frame_rectangle_whose_jambs_meet_the_wall_ends` (`win2.py`'s geometry: jambs 3 px inside each end, t 14).
- The t 24 frame rectangle and the t 24 2-line window are not found. There the face lines pair into a wall piece of their own; this is a walls-stage issue, and it was the same at e33d0a4.
- **RED, before the fix:** 3 failed (the three tests above: no window).
- **Rules switched off, after the fix:**
  - with the old `_jamb_line` clearance, the 2-line casement and the frame rectangle fail;
  - without `_inner_ink`, the glass-line casement fails.

## FR2-2. N2

Accepted and noted under deviation 18 (FR1-4). No code change.

## FR2-3. Metrics

These are unchanged from e33d0a4.

| Metric | HDB | Brochure | Floor | Holds? |
|---|---|---|---|---|
| Openings R / P | 0.462 / 0.667 | 0.625 / 1.000 | 0.461 / 0.666; 0.625 / 1.0 | Yes |
| Hinge and swing | 1.00 | 1.00 | ≥ 0.80 | Yes |
| Walls R / P | 0.927 / 0.973 | 0.920 / 0.864 | `WALL_FLOOR` | Yes |
| Free ends all / outer | 8 / 0 | 15 / 0 | outer 0 | Yes |
| Bounded faces | 6 | 4 | ≥ 6 / ≥ 4 | Yes |
| Dims R / P / intervals / labels / ticks | 0.833 / 1.000 / 0.979 / 0.923 / 0.985 / 0.932 | 0 lines | unchanged | Yes |
| Non-OCR chain (openings stage) | 1.58 s (0.07 s) | 1.09 s (0.14 s) | < 10 s | Yes |

## FR2-4. Gates

| Command | Result |
|---|---|
| `uv run pytest -q tests/test_openings.py` | 44 passed, 2 xfailed |
| `uv run pytest -q` (full) | 910 passed, 1 skipped, 3 xfailed |
| `ruff check` / `ruff format --check` / `mypy app` | clean |

The xfails are Task 18's ≥ 7 faces and the 2 hollow-stretch residuals.
