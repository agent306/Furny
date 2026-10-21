# Re-review 1: Task 16c fix round 1 (12a2298..bdef4a0)

**Inputs**
- The fix diff `review-12a2298..bdef4a0.diff`, one commit.
- The "Fix round 1" section of `task-16c-report.md`.
- The controller's rulings, as relayed.

**How I ran things**
- Everything ran in an export of bdef4a0 under `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/rv16c/src`, reusing the existing venv. The export has since been deleted.
- My counter-case scripts and crops are in `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/rv16c/work/`.
- Line references are to bdef4a0.

## Metrics, reproduced at bdef4a0

| | HDB | Brochure |
|---|---|---|
| Recall / precision | 0.8893 / 0.9628 | 0.9117 / 0.8650 |
| Free ends | 9 | 17 |
| Faces | 5 | 3 |
| Outer-cycle free ends | 0 | 0 |
| Enclosed share | 0.997 | 0.990 |
| Dimensions: recall / precision / spans / labels | 0.833 / 1.000 / 0.979 / 0.923 | – |
| Walls stage | 0.18–0.23 s | 0.63–0.75 s |
| Non-OCR chain | 1.56 s | 1.12 s |

- **HDB faces.** The faces are unchanged.
- **HDB missed walls.** The new missed entries are B2p (0.63) and I12 (0.85). This agrees with the report: the drop from 0.892 to 0.889 comes from the truth fixes. That drop is accepted.

## Finding verdicts

**Important 1: step 8 bridged mixed styles across a plain gap without evidence. ADDRESSED.**
- `_gap_thickness` (walls.py `_gap_thickness`, after `_runs`) judges the gap on the drawn thicknesses.
- `_is_opening` returns False whenever the styles differ.
- I re-ran my counter-cases:
  - bold + double at offset 0 and at offset 4: 2 free ends, no opening;
  - block 16 + bold: 2 free ends, no opening;
  - block 16 + double: 2 free ends, no opening;
  - block 30 + double: 2 free ends, no opening;
  - the same-style control (bold + bold) is still bridged, opening 158.
- The new test `test_mixed_styles_are_not_bridged_across_a_plain_gap` covers all four mixed cases.

**Important 2: tables and tiles became the plan region. NOT ADDRESSED for non-periodic tables.**
- Periodic grids are now rejected (`_is_grid`, binarize.py, after `double_line_strips`). My original cases all keep the plan region, for both filled and double plans:
  - 40 px table;
  - 30 px terrace;
  - 45° hatch.
- Regular double-line plans are not mistaken for grids: 2×2 up to 6×6 equal rooms, with or without a column, all keep the plan region.
- But `double_line_strips` still accepts any strip structure that spans at least 0.1 L both ways **without being connected to a wall** (the `min(w, h) >= span` branch). The ruling was "strips count only when connected to the wall structure".
- A title-block table with irregular row heights (22–47 px) has no 3 equal cells, so it is not a grid. It still captures the region:

  | Plan | Case | Region |
  |---|---|---|
  | filled | title-block table | `Rect(1434,134,938,1271)` (the table) |
  | double | title-block table | `Rect(1434,134,938,1271)` (the table) |
  | filled | 2-column schedule with irregular rows | `Rect(1454,154,898,786)` (the schedule) |
  | double | 2-column schedule with irregular rows | `Rect(1454,154,898,786)` (the schedule) |

  For the filled plan, the region was `Rect(138,238,1024,824)` before 16c and is correct without strips.
  Script: `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/rv16c/work/cc_region2.py`.
- Title blocks rarely have equal rows, so the periodicity test alone does not close the case.
- **Fix:** apply the ruling as written. Count a strip structure only when it touches the thick ∪ bold wall structure, or when it is the R4 fallback case (thick ∪ bold holds almost no wall pixels).

**Important 3: `_rejoined` was an O(picked × n) Python loop with no deadline poll. ADDRESSED.**
- `_rejoined` (wall_candidates.py) now uses a bucketed, rho-sorted index, polls every 64 seeds, and passes the poll to `merge_collinear`.
- I re-ran my scale cases:

  | Thin segments | Time |
  |---|---|
  | 2,400 | 0.03 s |
  | 6,000 | 0.13 s |
  | 11,500 | 0.28 s, within the ruling's ≤ 0.5 s |
  | HDB | 0.007 s, down from 0.09 s |

- The test `test_rejoining_many_thin_lines_is_fast_and_polls_the_deadline` asserts the polls (≥ 20).
- Its time bound is `< 1.0` (test_walls_closure.py, last test), looser than the ruling's 0.5 s. See Minor N3.

**Important 4: texture passed as a door arc. ADDRESSED for texture, but the fix breaks real doors (New Important N1).**
- 9 px hatch: not bridged. 12 px tiles: not bridged.
- My other non-door cases also stay unbridged: the 24 px grid, the sofa and the outside lines.

**Minor 1 (ruling-mandated dimension trade). ACCEPTED: carried to Task 34.**
- I re-ran the cases with the same results. The partner-face case at 27 % still gives a partition length of 0. The intact, broken-300 and cut-at-ticks cases keep the partition.

**Minor 2: the sweep test never had more than one component. ADDRESSED.**
- test_preprocess.py, `test_region_grouping_of_many_components_is_bounded_and_polls_the_deadline`, now uses a 6000 px page with 1,600 squares at a 150 px pitch.
- A spy asserts that `_groups` receives `[1600]`.
- My adversarial check: 2000 nested boxes take 0.58 s, with polls at most 36 ms apart.

**Minor 3: wrong explanation of the W23 loss. ADDRESSED.**
- The report's "Fix round 1 / Minor 3" now states the t_median cause.
- The fragility itself is proposed for Task 17/18.

**Minor 4: truth I12. ADDRESSED.**
- B0 is at (938, 178), with the jog I12j from B.
- Profiles at threshold 235 give faces 173 / 182.5 at 20 / 80 / 95 %, so the centre is 177.75.

**Minor 5: pier measurement. ADDRESSED.**
- B2p runs (567, 912) → (567, 950), and the convention text now says stubs are measured from the centre line.
- Profiles at 50 / 80 / 90 % give the pier at [−8.5, +9.5], so the centre is 566.5.
- B2b and B2c stay on the block centre (912.25).

**Minor 6: truth X4. ADDRESSED.**
- D is now at (1118.5, 115), and X4 runs to D2 (1118.5, 171).
- Profiles at 20–90 % give the bold stroke at 1121.75 and the thin line at 1115, so the midpoint is 1118.4.
- The jog X4j and the block X4c run on the block's centre line (x 1115, block [−9.5, ...]).
- The line at 1103.5 is still the 1300 extension line.

**Minor 7: code quality. ADDRESSED.**
- `_Item` is a frozen dataclass, `_Run._mean` replaces the copies, and `_Member` and `_mean_offset` are gone.
- `_trace_raw_walls`' `thin` and `ink` are now required.
- The graph is cached (`WallExtraction.graph` / `graph_region`). `walls_to_graph` reuses it only when the region matches. The reference metrics are unchanged.

## New breakage in the fix diff

### N1. Important: the new `_door_arc` misses real doors that 36b0753 found, and an existing test was changed to hide it

The function is in walls.py, `_door_arc` / `_fit_circle`. The test change is in test_walls_closure.py, `block_door_bold`.

**The test change.**
- The fix flips the door in the Task 16c test `test_block_and_bold_stroke_are_bridged_across_a_door` from `side=-1` to `side=1`.
- With the original `side=-1` door, bdef4a0 gives **2 free ends and no opening**. With `side=1` it gives 0 free ends and an opening of 147.
- Script: `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/rv16c/work/cc_origtest.py`.

**The sweep of real doors.**
- I swept 24 configurations (`/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/rv16c/work/cc_doors.py`):
  - a 30 px block next to either a double line (offset 4) or a filled 14 px piece (offset 8);
  - doors of 90, 150 and 220 px;
  - hinged at either jamb;
  - swinging to either side.
- The new detector bridges **15 of 24**. The old detector, patched in over the same code (`/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/rv16c/work/cc_doors_old.py`), bridges **21 of 24**.
- These are the real doors that are now lost:
  - 90 px door, hinged at the end, swinging inward (side +1), both styles;
  - 150 px door, hinged at the start, side −1, both styles;
  - 150 px door, hinged at the end, side +1, both styles;
  - 150 px door, hinged at the end, side −1, filled.

**Two causes, both diagnosed** (`/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/rv16c/work/cc_doordbg.py`):

1. **The arc merges with the wall it closes onto.** The arc ends at the opposite jamb. When that jamb is a thick block, the block's end face lies inside the zone: it spans ±atan(t/2g), about ±5.7°, which is wider than the ±3° the zone leaves out. The arc and the block are then one component (n = 953 / 806 px), and `_fit_circle` finds no fit.
2. **A cut arc no longer passes.** An arc cut by the region crop needs ≥ 60° of contiguous coverage now, against 60 % of samples before.
   - An outward swing past the region's 0.06 L margin keeps only about 56°. In the side −1, 150 px case, the fitted circle is good (r = 0.96 g, inliers 1.0) but is cut at the crop edge.

**Fix.**
- Fit on the arc's thin pixels only: subtract `thick` / the wall mask, or open away strokes thicker than about 2 t_thin, before labelling.
- Accept an arc cut by the image or crop edge when its visible part fits.
- Restore the original test orientation, and add the 24-case sweep (or a subset) as a test.

### N2. Important: `_door_arc` costs O(g²) per call, with 8 calls per bridge candidate and no deadline poll between candidates

This is the brochure walls-stage question.

**Why the brochure walls stage grew.** It went from 0.11 s at 36b0753 to 0.63–0.75 s here.
- `_door_arc` takes **0.64 s of it in 40 calls**: 5 mixed-style bridge candidates with gaps of 51 / 187 / 322 / 323 / 340 px, × 4 jambs × 2 sides. cProfile run: `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/rv16c/work/prof_walls.py`.
- Each call computes `mgrid`, `hypot` and `arctan2` over the whole (2·(1.2 g + 0.5 t + 4))² square before testing anything. For g = 340 that is 841² px.
- HDB has a single 201 px candidate that frame lines settle first, so it makes no arc calls (walls 0.18 s).

**Does it scale?** Yes, quadratically in the gap. I timed one bridge candidate (8 calls) on a 6000² page (`/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/rv16c/work/arc_time.py`):

| Gap | Time per candidate |
|---|---|
| 150 px | 0.07 s |
| 340 px | 0.21 s |
| 540 px | 0.51 s |
| 1000 px | 2.86 s |

- Gaps up to 18 t_wall are candidates. On a 300 dpi A1 scan (t_wall 30–55 px), that means gaps of 540–1000 px.
- The number of candidates grows with the number of mixed-style wall ends.
- `_link_runs` polls once per direction group, not per candidate. So 10–20 large candidates (5–50 s) cannot be interrupted by the deadline.

**Fix.**
- Sample only the annulus, either in polar coordinates or by cropping to the quadrant's bounding box rather than the full square.
- Skip the remaining jamb/side combinations once one arc is found. `any()` already does this, but every failing case pays all 8 calls.
- Poll per candidate.
- Add a perf guard: for example, a 1000 px gap must stay under about 0.3 s per candidate.

### N3. Minor: the rejoin perf test's bound is looser than the ruling

`test_rejoining_many_thin_lines_is_fast_and_polls_the_deadline` asserts `< 1.0` s, where the ruling is ≤ 0.5 s at 11.5k segments. The code meets 0.5 s (0.28 s measured), so tighten the assert to 0.5.

### Other checks: no new problems

- `double_line_strips`' `within` path:
  - `wall_of` is a max-dilate of the labels, which is harmless.
  - The periodicity test does not reject regular double-line plans (cases above).
- The `_drop_dangling_extensions` graph cache returns the graph only for the final raw walls. It returns None after a second cut.
- Every `_Item` refactor site is consistent. `_drop_leaves` now uses `m.t`.

## Out-of-scope observations

- **The region margin cuts exterior door swings.** `region.EXPAND_FRAC` is 0.06, and `region.py` is not in the fix diff. A door swinging outward with a radius larger than the region margin (about 108 px on the synthetic, about 102 page px on HDB) is cut by the walls crop. This weakens any arc evidence for exterior doors. Ledger it for Task 17 (openings).

## Verdict

**Fix round:** findings remain open.
- **Important 2** stays open: non-periodic tables and title blocks still become the plan region, because strips do not have to connect to the walls as the ruling requires.
- **New Important N1:** the new arc detector misses real doors, 15 of 24 bridged against 21 before, and an existing test's door orientation was flipped to hide it.
- **New Important N2:** `_door_arc` costs O(g²) with no per-candidate poll. It explains the brochure walls going from 0.11 s to 0.75 s, and it reaches 2.9 s per candidate at a 1000 px gap.
- **New Minor N3:** the rejoin perf assert is looser than the ruling.

The other findings are addressed: Important 1 and 3, Minors 2–7, and Important 4 for texture. Minor 1 is accepted and goes to Task 34.
