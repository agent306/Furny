# Task 17 re-review 2 (fix round 2: e33d0a4..0c33449)

**Scope.** This round is the single commit `0c33449` (`openings.py` and `test_openings.py`). I read the diff `review-e33d0a4..0c33449.diff` (22,754 bytes) in full.

**How it was checked.**
- **Export.** `git archive 0c33449` was exported to scratch, with imports resolving to the copy. The export is deleted.
- **Report.** The fix report ("Fix round 2" in `task-17-report.md`) names the covering tests and their output: `test_openings` 44 passed and 2 xfailed; full suite 910 / 1 / 3; gates clean.
- **Focused tests on the export.** `test_openings.py` and `test_reference_openings.py`: 58 passed, 2 xfailed.

## Finding verdicts

### N1 (Important): solid-wall window guard lost the brief's casement — ADDRESSED per ruling

**The code follows the ruling.**
- The I1 evidence now applies only to solid-ink breaks: `_window(..., solid=None if is_gap else ink)` (`openings.py:420`). A graph gap takes 06 §8.5 step 2 unchanged.
- `_jamb_line` (`:655`) no longer requires a 2 px clearance, so a jamb that meets the wall end counts.
- `_outlined`, `_solid_flanked`, `_flank_points` and `_Ink.solid` are removed cleanly. The passage branch is back to the original rule.

**Window cases on the export** (`rv17/cc/win2.py`):

| Case | At 0c33449 | At 0ea3dca (re-review 1) |
|---|---|---|
| `SWindow(lines=2)`, t 14 (the brief's casement) | casement, 121 px | same |
| `SWindow(lines=3)`, t 14 | casement, 121 px | same |
| Frame rectangle, jambs 3 px inside the ends, t 14 | casement | same |
| Inset lines (±0.25 t), t 14 and t 24 | casement | same |
| `SWindow(lines=3)`, t 24 | casement | same |
| 2 lines, t 24 | not found | not found |
| Frame rectangle, t 24 | not found | not found |

All window behaviour is back to the pre-fix-round baseline. The two t 24 misses are pre-existing (a walls-stage issue), not caused by this round.

`test_window_casement` is restored verbatim from the brief (t 14, 2 lines, `test_openings.py:82`). There are new tests for the 3-line casement and for the frame rectangle.

**I verified the pixel-equivalence claim on the export** (`rv17/cc/pixeq.py`, `pixeq2.py`).
- I rendered the brief's 2-line casement (x 400–520) and the t 14 hollow stretch (x 350–550) and aligned each on the start of its interior.
- **The interior is identical:** 0 of 1,240 px differ.
- **Each end window differs in 96 of 744 px.** All of the difference is in the 1-px outer rows (y 492 and y 507), where the face lines sit 1 px proud of the solid band.
  - In the casement they overhang the solid end by 1 px.
  - In the hollow stretch they run 14 px over it: the double wall's square cap overlaps the solid piece.
- The end edges, faces and interior are otherwise the same.
- **Both read as `casement`.** The hollow stretch's span is 187 px because of that cap overlap.
- **Conclusion.** The two are near-identical. The only difference is how far a 1-px face line runs along the solid's outline, and that is not a usable discriminator: in real drawings the face lines coincide with the solid's edge. I agree with the implementer's call.
- As instructed, the hollow-stretch cases (strict xfail, `test_openings.py:378-395`) are not re-flagged.

**Colour-shift counter-cases still pass** (`r17b2.py`).
- 110 on a colour plan: none. 110 on a line drawing: none. 125 on a line drawing: none.
- 125 on a colour plan is an R17-b `fixed` window (support 0.15). This is the accepted Task 34 residual.

**`_inner_ink` reads `ink_notext` only for the glass line.**
- Its only use is `openings.py:601`, inside the solid-break branch of `_window`.
- It scans lines at |offset| ≤ floor(0.35 t) px, so at t 14 it reads offsets ±4 and the face lines at ±7 are excluded. It needs ink on at least 40 % of a single line.
- `_Ink.notext` is read nowhere else (grep: `:148`, `:187`, `:601`, `:628`).
- **A spy on the export confirms the role.** For the 2-line t 14 casement `_inner_ink` returned False, and the window stands on its jambs. For the 3-line t 14 casement it returned True. With `_inner_ink` forced False, the 3-line case gives no window, matching the report.

### N2 (Minor): R17-a corner door with its leaf hugging the side wall is dropped — ACCEPTED

Accepted by ruling; no code change. It is noted under deviation 18 (report FR2-2).

## Other counter-cases re-run on the export

- **R17-a** (`r17a.py`): no doors from the shower trays or the corner shelf, nor from the table, sofa or console. The quarter-circle desk off a wall gives 1 door, which is inherent.
- **R-b** (`rb.py`): the horizontal partition passes 4/4. The crossing-wall door leaves the partition free with one door. The table in the passage leaves the end free.
- **R17-b** (`r17b.py`): counters, wardrobe, floors and partition give no window.
- **Pairing** (`fp.py`): all 5 variants pass, with 798–799 px of 800.
- **`win.py`:** unchanged from re-review 1, except that the hollow stretches are now casements (the accepted residual).

## Metrics on the 0c33449 export

The metrics are unchanged from e33d0a4.

| Metric | HDB | Brochure |
|---|---|---|
| Openings R / P | 0.462 / 0.667 (6/13, 6/9) | 0.625 / 1.000 (10/16, 10/10) |
| Hinge/swing | 1.00 | 1.00 |
| Walls R / P | 0.927 / 0.973 | 0.920 / 0.864 |
| Free ends | 8 | 15 |
| Faces | 6 | 4 |
| Dims | 0.833 / 1.000 / 0.979 / 0.923 / 0.985 / 0.932 | 0 lines |
| Chain (openings) | 1.37 s (0.07) | 1.23 s (0.14) |

The missed and false lists are identical to e33d0a4. No walls-stage code changed in this round, so the outer free ends cannot have moved.

## New breakage in the fix diff

None.

## Out-of-scope observations

- With end edges now counting as jambs, the I1 guard on solid-ink breaks reduces in practice to `_light_inside` whenever LSD returns the end edges. This is by ruling and noted for the deviation 17 log. It is not a finding.

## Verdict

**Fix round:** all findings are addressed (N1 per the ruling, N2 accepted), with no new Critical or Important breakage.

**APPROVED.**
