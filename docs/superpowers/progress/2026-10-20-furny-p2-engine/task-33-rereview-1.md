# Task 33 re-review, fix round 1 (3463fa9..b89824c)

Diff file `review-3463fa9..b89824c.diff` is non-empty (25537 bytes). Five files changed, +338/-14, in one commit, b89824c.

## Finding Verdicts

- **I1: y-seam cover test ignores fixed shelves in partition-bounded strips.** ADDRESSED.
  - Where: `back.ts:136-163`, the `partitionAt` lookup and the `from` / `to` faces.
  - What it does now: at a supported seam, the strip is clamped to the inner faces of the partition (left strip: `P.min`; right strip: `P.max`). At the sides it is clamped to `ix0` / `ix1` as before. This matches the controller ruling.
  - Neighbouring columns (the ruling's concern), checked on the scratch copy:
    - The original 1800 × 2700 case gives 4 pieces split at y 1373, plus `back_split { count: 4 }` and nothing else. It is also a committed test now (`back.test.ts`, "fix round 1").
    - 3 columns, 3000 wide, with a fixed shelf only in the middle column: only the middle strip uses 1373. The outer strips get unsupported seams at 1350 (2 warnings).
    - 3 columns with shelves at 1673 / 1373 / 1073: each strip is cut at the centre of its own column's shelf, with no warnings.
    - 2400 wide, `[fixed 1500 | flex]`, with an unsupported x-seam at 1200 inside the left column. The strip [1200, 2389] spans the partition, so the right column's shelf does not cover it (unsupported y 1350). With a shelf in each column, the left strip uses its own shelf (1673) and the spanning strip stays unsupported.
  - Mutants:
    - Killed: old left edge; old right edge; left edge set to the partition's near face (`P.min`, which would admit the neighbour's shelf); right edge set to `P.max` (same problem).
    - Equivalent: `seam?.supported` changed to `seam`. An unsupported seam never sits on the centre of a full-height partition, because that centre would have been the greedy candidate.
- **M1: corner/edge-only contact untested** (`layout.ts:864`). ADDRESSED. The `layout.test.ts` block "recordEndJoints contact rules" kills `o <= OVERLAP_EPSILON` → `o < 0`.
- **M2: 0.5 mm face tolerance untested** (`layout.ts:614`). ADDRESSED. The same block uses a 0.4 / 0.6 mm pair. Tolerance 0.01 and tolerance 1 are both killed.
- **M3: the bounding-vertical y/z overlap filters are untested** (`contents.ts:373-374`). ADDRESSED. The new `contents.test.ts` cases are two rows of equal columns plus a decoy part. Removing the y check is killed, and so is removing the z check.
- **M4: rod `maxLengthMm` fallback and `ctx.sections` flooring untested.** ADDRESSED. The `contents.test.ts` rod test via `mutateCatalog` kills fallback 1000. The `layout.test.ts` fractional interior test kills dropping `fl`.
- **M5: content depth computed three times** (`contents.ts`). ADDRESSED. `contentDepth` (`contents.ts:42-48`) now takes `Pick<Envelope, 'interior'>`, and `shelvesFor`, `rodFor` and `basketsFor` all go through `leafDepth` (`contents.ts:51-52`). Behaviour is unchanged: a leaf's z-size is the interior depth.
- **M6: all-flex negative space.** CARRIED to Task 37 by the controller. No action needed in this round.
- **M7: wrong task named in the report.** ADDRESSED. The report correction is in the "Fix round 1" section.

## New Breakage in the Fix Diff

None.

## Out-of-Scope Observations

None.

## Checks run

- Scratch copy of b89824c: the baseline carcass suite passes, 5 files and 167 tests.
- The neighbouring-column cases listed under I1.
- 12 mutants: 11 killed, 1 equivalent (noted under I1).
- Scratch copies deleted afterwards. The worktree was not touched (HEAD b89824c, `git status` clean).

## Verdict

**Fix round:** All findings addressed, no new Critical/Important breakage. APPROVED.
