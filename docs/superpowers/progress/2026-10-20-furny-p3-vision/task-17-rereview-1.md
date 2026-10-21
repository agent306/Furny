# Task 17 re-review 1 (fix round 1: 0ea3dca..e33d0a4)

**Inputs.** Diff `review-0ea3dca..e33d0a4.diff` (171,459 bytes) was read in one pass. The fix report is the "Fix round 1" section of `task-17-report.md`. It names the covering tests and their output: `test_openings` 44 passed, `test_reference_openings` 14 passed, full suite 910 / 1 / 1, gates clean.

**How the round was checked.**
- **Exports.** `git archive e33d0a4` was exported to scratch (imports confirmed to resolve to the copy). For behaviour comparisons only, `0ea3dca` was exported the same way. Both exports and the AST-comparison sources are deleted.
- **Counter-cases.** Every counter-case script from the first review was re-run on the e33d0a4 export (`rv17/cc/*.py`). Three new scripts were added: `win2.py` (window regressions), `jdbg.py` (jamb debug) and `corner.py` (corner-hinged leaf door).
- **Focused tests on the export.** `test_openings`, `test_reference_openings`, `test_walls_closure` and `test_segments_walls`: 158 passed.

## Split commit 75f6f3f: move only

- **Every definition was AST-compared.** I parsed the 102 top-level definitions of `walls.py@0ea3dca` (functions, classes and constants) with `ast.dump` against the union of `walls.py`, `wall_runs.py` and `wall_skeleton.py@75f6f3f`. None is missing, changed or new: the split moved code only.
- **The tests that patch moved names target the right module.** They now patch `runsmod` for `LEAF_MAX`, `_join` and `_close_end` (`test_segments_walls.py:494`, `:828`; `test_walls_closure.py:98-104`). These are the modules where the names are called.
- **At e33d0a4 the AST changes are exactly the fix.** `wall_runs.py` gains `_leaf_along` plus 3 constants and a changed `_partition_doors`; `walls.py` changes `_trace_raw_walls` to pass `thin`; `wall_skeleton.py` is unchanged.

## Finding verdicts

1. **I1: the hollow stretch and the colour shift in solid walls read as casements** — **ADDRESSED.**
   - **Code.** `openings.py:419` (`in_solid`) and the guard in `_window` (`:612-617`); `_light_inside` (`:644`), `_jamb_line` (`:666`) and `_outlined` (`:431`).
   - **Counter-cases (export).** The hollow stretch at t 14 and at t 20 gives none. The 110 colour shift gives none on both kinds. The 125 shift gives none on line drawings.
   - **Residual.** The 125 shift on a colour plan gives an R17-b `fixed` window (support 0.15). This is accepted as a Task 34 residual.
   - **Regression introduced.** See new breakage N1.
2. **I2: R17-a quadrant fixtures became doors, with support 1.0** — **ADDRESSED.**
   - **Code.** `_shares_its_arc` (`openings.py:799`), `_against_a_face` (`:813`) and measured support (`:777`).
   - **Export.** The shower tray at inset 3 and inset 6 gives 0 doors, and the corner shelf gives 0. The table, sofa and console still give 0.
   - **Orientation re-run.** Single 32/32, double 16/16, R17-a 16/16, bi-fold 32/32.
   - **Side effect.** See N2.
3. **I3 / T1: the HDB kitchen window is missing** — **ADDRESSED.**
   - G6 is on X9b, u 233–320 (`hdb-3room.drawing-openings.json:44`). That is y 461–548 on A3 (155, 228) to A4.
   - Re-profiled: y 510–545 shows lines at x 145–147 (gray 81–113) and 149–150 (73–102) beside the bold 153–157. This matches the method note; my first review put the second line at 151, about 1 px off.
   - The judgement call is updated, and `OPENING_FLOOR` HDB is (0.461, 0.666) (`test_reference_openings.py`).
4. **R-b phantom extension from a crossing-wall door (Minor 4)** — **ADDRESSED.**
   - **Code.** `wall_runs._leaf_along` (`wall_runs.py:591`, applied at `:574`).
   - **Export.** For the hinge at x 1207 and at x 1193, the partition stays at y 1407 with 1 free end, and one door. The horizontal R-b case is 4/4, and the table in the passage stays free.
   - **Tolerance.** 0.5 t + 2 px is kept, per the ruling.
5. **T2: B1 and B3 are neither listed nor ignored** — **ADDRESSED.**
   - G7 on B1 (u 12–106) and G8 on B3 (u 7–119) are now `ignore` (`:46`, `:48`).
   - Re-profiled. B1: bold 503–507, thin at 511–512 and 514. B3: thin pairs at 827–831 and 834–838.
6. **T3: the HDB G1 slider was scored as a window** — **ADDRESSED.**
   - It is now `door/sliding` with hinge and swing null (`:36`).
   - The truth test allows null hinge and swing for sliding and pocket doors. The metric skips both when they are None (`reference.py` `opening_metrics`).
7. **T4: brochure D3's leaf named W18** — **ADDRESSED.** It now reads W8 (`brochure-2bhk.drawing-openings.json:16`).
8. **Inferred openings de-duplicated only by wall id (Minor 8)** — **ADDRESSED.**
   - `_new_on_their_lines` (`openings.py:695`) compares along `_lines`, and also de-duplicates the extras against each other.
   - The unit test is on a hand-built graph with a reversed collinear wall. I read the code and the line-origin and sign arithmetic is correct.
9. **The fixed `PANEL_PAPER = 200` ceiling (Minor 9)** — **ADDRESSED.**
   - The ceiling is now paper minus 40, with paper from `_paper_level` (`:849`), and the panel's support is its contrast.
   - Brochure G3 is still found (export metrics).
10. **Docstrings omitted `fixed` and described support as a constant (Minor 10)** — **ADDRESSED** (`candidates.py:189-197`).
11. **The `del w` leftover (Minor 11)** — **ADDRESSED.**
12. **Neither truth scores a passage (Minor 12)** — carried to Task 33/34 per the report. Not in this round's scope.
13. **The `walls.py` split (Minor 13)** — **ADDRESSED.** walls.py 647 lines, wall_runs.py 711, wall_skeleton.py 314; move only, per the AST check above.

## Metrics on the e33d0a4 export

| Metric | HDB | Brochure | Report |
|---|---|---|---|
| Openings R / P | 0.462 / 0.667 (6/13, 6/9) | 0.625 / 1.000 (10/16, 10/10) | matches |
| Hinge/swing | 1.00 | 1.00 | matches |
| Walls R / P | 0.927 / 0.973 | 0.920 / 0.864 | matches |
| Free ends all / outer | 8 / 0 | 15 / 0 | matches |
| Faces | 6 | 4 | matches |
| Dims | 0.833 / 1.000 / 0.979 / 0.923 / 0.985 / 0.932 | 0 lines | matches |
| Chain (openings) | 1.55 s (0.07) | 1.21 s (0.15) | matches |

HDB missed D3, D8, G1–G4 and G6. Its false detections O7, O8 and O9 are unchanged.

## New breakage in the fix diff

- **N1 (Important): `openings.py:419` and `:612-617` narrow 06 §8.5 step 2 for every window in a gap with solid flanks.** The rule is no longer limited to solid-ink breaks.
  - **What changed.** A casement drawn in a filled wall now needs one of two things: a frame line strictly inside the strip, or jamb lines on paper. The jamb test (`:682`) rejects any jamb within 2 px of solid ink.
  - **Synthetic comparison**, `win2.py` on both exports:
    - `SWindow(lines=2)` in a t 14 filled wall: a casement at 0ea3dca, **nothing** at e33d0a4. This is the brief's literal `test_window_casement` case.
    - `SWindow(lines=3)` (04 §8.2 casement with a glass line) at t 14: a casement before, **nothing** now. LSD merges the glass line, so the inner-line test fails.
    - Two face lines plus jamb lines 3 px inside the gap at t 14: a casement before, **nothing** now. A frame rectangle's jambs abut the wall's end, so `_jamb_line`'s 2 px solid clearance kills them (`jdbg.py`: the jambs are detected, `_light_inside` is True, `_jamb_line` is False at both ends).
    - Only inset lines (±0.25 t) or a t 24 three-line window still pass.
  - **The brief's test was rewritten to fit.** `test_window_casement` now uses t 24 and 3 lines (`test_openings.py:82-89`).
  - **Why it matters.** Real-image metrics are unchanged, but the jamb alternative is effectively dead. Windows in poché walls drawn as 2 face lines or a frame rectangle (a common CAD convention) are no longer recognised, and not even reported as passages (`_outlined`, `:426`).
  - **The trade-off.** It comes from my I1 finding: the t 20 hollow stretch arrives as a graph gap and is geometrically identical to a 2-face-line window. Two fixes are possible:
    - **(a)** Limit the I1 guard to solid-ink breaks (`is_gap=False`), as the review proposed. Then accept the t 20 hollow-gap case as a residual.
    - **(b)** Keep the guard on gaps, but count a jamb that coincides with a solid piece's end, provided a perpendicular frame line spans the wall there.
  - **Either way, a controller ruling is needed.** Deviation 17 currently logs the narrowing, but the brief's own 2-line casement case is no longer found.
- **N2 (Minor): `_against_a_face` (`openings.py:813`, reach 0.5 t + max(3 px, t/4)) also drops real R17-a doors hinged in a room corner.** These are doors whose open leaf rests within about 3 px of the side wall's face. `corner.py` on t 14: leaf 2 px off the face gives no door at e33d0a4 (a door at 0ea3dca); 4 px and 8 px off still give a door. This is the inherent ambiguity with the quarter-round shelf. It is narrow and affects only doors on unbroken walls; note it in deviation 18.

## Out-of-scope observations

None.

## Verdict

**Fix round:** every finding is addressed (Minor 12 is carried by plan), but the fix introduced new Important breakage N1. Open:
- N1, which needs a fix or a controller ruling;
- N2, Minor.

**CHANGES_REQUESTED.**
