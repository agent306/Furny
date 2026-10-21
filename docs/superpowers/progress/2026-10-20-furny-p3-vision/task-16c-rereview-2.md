# Re-review 2: Task 16c fix round 2 (bdef4a0..29436f2)

**Inputs**
- Diff: `review-bdef4a0..29436f2.diff` (one commit).
- Report: `task-16c-report.md` § "Fix round 2".
- The controller's accepted deviations F2-1, F2-4 and the page-wide arc reading. For these I checked soundness, not compliance.

**How it was run**
- All runs used an export of 29436f2 with its own venv, in `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/rv16c/src`. That export is deleted.
- Scripts are in `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/rv16c/work/`.

## Metrics, reproduced at 29436f2

| | HDB | Brochure |
|---|---|---|
| Recall / precision | 0.8892 / 0.9628 | 0.9117 / 0.8650 |
| Free ends | 9 | 17 |
| Faces | 5 | 3 |
| Outer-cycle free ends | 0 | 0 |
| Enclosed share | 0.997 | 0.99 |
| Dims R / P / spans / labels | 0.833 / 1.000 / 0.979 / 0.923 | – |
| Walls stage | 0.17 s | 0.16 s |
| Chain | 1.5 s | 0.8 s |
| Region | (118, 81, 1709, 1473) | (131, 150, 1212, 1082) |

All of these match F2-2.

## Finding verdicts

**I2: tables become the plan region. ADDRESSED for the requested cases.**
- Uneven-row title-block table (`cc_region2.py`): region stays on the plan for both the filled plan (138, 238, 1024, 824) and the double-line plan (139, 239, 1025, 825).
- Uneven-row 2-column schedule (`cc_region2.py`): same, plan region for filled and double.
- Pure double-line plan next to a table, tiles or hatch (`cc_region.py`): 40 px table, 30 px terrace and 45° hatch all keep the plan region. Without strips the region is the whole page.
- Regular n × n double-line plans, with or without a column (`cc_region3.py`): still hold the whole plan.
- New tests:
  - `test_tables_with_uneven_rows_do_not_become_the_plan_region`;
  - `test_a_double_line_plan_wins_over_a_table_with_text` (it discriminates: the empty table wins).
- See New Important R2-1 and R2-2 on the soundness of the F2-1 and F2-4 deviations.

**N1: real doors missed. ADDRESSED.**
- My 24-door sweep (`cc_doors.py`) bridges **24 of 24**, each with the right opening width.
- The original `side=-1` test door bridges with opening 149 (`cc_origtest.py`). `test_block_and_bold_stroke_are_bridged_across_a_door` is now parametrized over both sides.
- All negatives stay unbridged (`cc_bridge.py`, `cc_bridge2.py`):
  - plain gap, block | double (2 free ends);
  - bold | double at offsets 0 and 4;
  - block 16 | bold;
  - block 16 | double;
  - 9 px hatch, 12 px tiles and 24 px tiles;
  - sofa;
  - two ground lines outside.
- The same-style control (bold | bold) still bridges (opening 158).

**N2: arc-check cost and polls. ADDRESSED.**
- Per candidate (8 arc reads) on a 6000² page with 2 % noise (`arc_time.py`):

  | Gap | Time |
  |---|---|
  | 150 px | 0.01 s |
  | 340 px | 0.01 s |
  | 540 px | 0.02 s |
  | 1000 px | 0.03 s (was 2.86 s) |

- Worst textures at a 1000 px gap (`arc_time2.py`):

  | Texture | t = 30 | t = 55 |
  |---|---|---|
  | 45° hatch at 9 px | 0.089 s | 0.086 s |
  | 20 % noise | 0.135 s | 0.139 s |
  | 6 px grid | 0.109 s | 0.118 s |

  None of them is found as an arc.
- `_link_runs` calls `poll()` before every bridge candidate (walls.py, the `else:` branch of the candidate loop). Results are cached per jamb, side and gap.
- The brochure walls stage is back to 0.16 s.
- Tests: `test_door_arc_check_costs_little_per_candidate_at_a_1000_px_gap` (≤ 0.15 s) and `test_bridge_candidates_poll_the_deadline_each`.

**N3: rejoin within 0.5 s. ADDRESSED.**
- The assert is `<= 0.5`.
- Measured (`cc_rejoin.py`): 0.28 s at 11.5k segments, 0.12 s at 6k, 0.03 s at 2.4k. HDB takes 0.007 s.

**Page-wide arc reading (extra case from the controller): sound, with one residual** (`cc_outside.py`).
- Setup: a block | double exterior bottom wall, with a plain 150 px gap at the plan edge.
- A north arrow (r 60 circle plus arrow) placed 140–200 px below the gap, beside or under either jamb: **not bridged**, in all 3 positions.
- A key-plan circle with radius ≈ the gap (140 / 150 / 165), centred 20, 40 or 120 px below the jamb: **not bridged**.
- Residual: a circle or outside half-circle with radius ≈ gap, centred within about 0.5 t + 2 px (≤ 10–15 px here) of the jamb, **bridges**. Geometrically that is a door swing about that jamb.
  - It needs an outside drawing centred on the plan's own wall end. Such a circle would also cross the wall.
  - The crop-only reader would have seen most of it as well, because the region margin is 0.06 L.
  - I do not count this as a defect.

## New breakage in the fix diff

### R2-1. Important: the F2-1 deviation is not sound

F2-1 defines "solid wall drawing present" as any thick or bold component ≥ 0.1 L (binarize.py `_has_solid_drawing`, `double_line_strips`). One long bold stroke anywhere on the sheet therefore turns a double-line plan's strips off.

The plan's strips do not touch that stroke, so `_touching_walls` keeps none of them. The region then collapses onto the stroke (`cc_region4.py`, double-line plan):

| Page | Region |
|---|---|
| plan alone | (139, 239, 1025, 825) |
| + one 6 px bold rule, 800 px long, at the right | **(1450, 1149, 901, 103)**, the rule |
| + bold 6 px title-block frame at the right | **(1607, 7, 787, 1687)**, the frame |
| + bold 6 px sheet border | (0, 0, 2400, 1700) |

- Title-block frames and bold rules are ordinary sheet furniture, so the double-line rescue (Continuation concern 4) fails on typical sheets.
- At bdef4a0, round 1 kept such plans: their strips span 0.1 L both ways. So this is a regression against round 1. It is not a regression against the pre-16c base, which was R4 only.
- A filled plan beside the same rule or frame is unaffected.
- **Suggested fix.**
  - Decide "solid walls present" per strip structure, not per page. Use the solid path when a solid component touches the structure, and the double path otherwise.
  - Or keep both candidates and let `detect_plan_region`'s grouping weigh them.
  - The lone-column counter-case stays solved either way, because a column inside the plan touches its strips.

### R2-2. Important: the F2-4 glyph rule reads stippled (concrete) walls as table text

`_is_table` counts glyph-sized ink components that are clear of the lines inside the strips (binarize.py `_is_table`, its second rule). Concrete stipple drawn inside double-line walls is exactly that, so the plan's structures are rejected as tables (`cc_region5.py`, `cc_region6.py`).

**Case:** pure double-line plan, about 4 % of the wall interior stippled with 2 px dots that do not touch the faces.

| Wall thickness | Region alone | Region with stipple |
|---|---|---|
| t 14 | (139, 239, 1025, 825) | (210, 244, 950, 816): left wall and part of the plan cut off |
| t 24 | (133, 233, 1037, 837) | **(557, 484, 589, 562)**: most of the plan lost |

- An instrumented run shows plan structures with strip fill 0.04–0.11 returned as `table True`.
- This is worse than the pre-16c base, whose region for a pure double-line plan was the whole page and so contained the plan.
- 45° poché hatch that touches the faces is not affected.
- Stipple and AR-CONC dot fills are common in CAD double-line drawings.
- **Suggested fix.** Count only cells that look like table rows: strips bounded by lines on all four sides, with an aspect and width typical of rows. Or require the glyph components to cluster into text lines (several components in a row at text height) rather than be scattered dots. Alternatively, drop the text rule and keep the fill and periodicity rules. The empty-sparse-table residual is already carried to Task 34.

### Other checks: clean

- `arc_ink[ys, xs][mask] = 0` writes through the slice view, so the jamb blocks are removed from the copy as intended.
- The cost of copying the whole page's ink is negligible.
- `_fit_circle` and `_arc_votes` are vectorized, and the work per arc read is bounded as O(gap) × 81 offsets.
- The HDB region lost 25 px at the bottom (h 1498 → 1473). Walls, dimensions and faces are unchanged.

## Out-of-scope observations

**A bold sheet border makes the region the whole page, even for a filled plan:** (0, 0, 2400, 1700).
- The cause is in R4 / `detect_plan_region`: the frame is a thick ∪ bold component. It predates 16c.
- Record it for the region work (Task 33/34) together with R2-1.

## Verdict

**Fix round:** findings remain open.
- **I2, N1, N2 and N3 are addressed.** My original counter-cases and the requested ones all pass. The page-wide arc reading is sound apart from the geometric residual above.
- **R2-1 (Important):** the F2-1 deviation is unsound. Any bold stroke ≥ 0.1 L on the sheet (a rule line, a title-block frame) disables the double-line strips, and the region collapses onto that stroke.
- **R2-2 (Important):** the F2-4 deviation is unsound. Concrete stipple inside double-line walls passes as table text, and the region loses most of the plan (t 24: a 589 × 562 region instead of 1037 × 837).
