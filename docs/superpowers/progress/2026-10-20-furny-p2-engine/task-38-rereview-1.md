# Task 38 re-review 1: fix rounds 1 and 2 (78c331b..85921ce)

## Scope and checks

**Diff read:** `review-78c331b..85921ce.diff` (3517 lines), in two passes:

- the source: `table/*`, `carcass/drawers.ts`, `validate.ts`, `testing/overlaps.ts`;
- the tests.

**Split commit `5402a1f`.** I checked that it only moves code, using read-only `git show` (nothing in the worktree changed):

- I compared every line of `78c331b:generateTable.ts` with the split modules (`bases`, `cabinet`, `drawers`, `frame`, `generateTable`, `hardware`, `top`) at `5402a1f`, after normalising indentation and dropping `export`.
- The only differences are import lines, new module doc comments, and prettier re-wrapping of `span3` and `underTopDrawers`.
- `outlines.ts` is byte-identical.
- After the split, `bases.ts` changes in exactly one line, `inset = f.apronInset` (`bases.ts:102`). `cabinet.ts` and `generateTable.ts` do not change.

**Scratch probe at HEAD.** I re-ran my original overlap checker on 15 cases. It ignores only side, back and bottom pairs within one drawer box, at a stricter 0.01 mm tolerance than the test helper. The scratch copy is deleted, and `git status` is clean.

**Mutation spot-check in the scratch copy.** I made seven mutants, and `vitest run …/furniture/table` (139 tests) killed all seven:

- identity left edge map;
- `available = A` (the `t_f` deduction removed);
- no runner allowance (`from = bay0`);
- inset clamp disabled;
- `ws < wsMin` changed to `ws <= 0`;
- bay ignoring the aprons (`reach = s`);
- outline dedupe removed.

**Test evidence in the report.** Round 1 and round 2 each have a RED run (round 2's output is quoted) and a GREEN run (3096, then 3098 tests, plus the eslint, prettier and vue-tsc gates). The report names the covering tests.

## Finding verdicts

**I1. Under-top drawer runners overlapped legs, aprons, end panels and the cabinet: ADDRESSED.**

- The drawers now share `[bay0 + t_c, bay1 − t_c]`. `reach = max(s, apron.enabled ? inset + t_c : 0)` (`table/drawers.ts:134`), and the runners sit beside each slot (`:217`). Spacing is `max(50, 2·t_c)` (`:320`).
- The probe at HEAD finds no overlaps in my four original cases, at 0.01 mm:
  - **console default 1200 × 800 × 400, 2 drawers:** runners at x 70 and 575; the legs end at 70;
  - **console 600 × 350, 3 drawers;**
  - **dining, 3 front drawers with stretcher and shelf:** runners at 100 and 1682 against legs at 100 and 1700;
  - **dining, 2 left drawers;**
  - **desk with panel_ends and 2 drawers:** runner at 18, against the end panel at [0, 18];
  - **800 × 450 desk with a 600 shelves cabinet and a top drawer:** the right runner ends at 200 = cx0.
- The no-overlap assertion `partOverlaps(run(doc).parts)).toEqual([])` (`generateTable.test.ts:1926-1931`) runs over 20 variants, and five more single tests use it (`:794`, `:828`, `:940`, `:1236`). There is no ignore list.
- The only exemption is the helper's default `sameDrawerBox` (`testing/overlaps.ts:11-19`). It covers side, back and bottom of one box, which interlock through the bottom grooves. Fronts and runners are still checked against everything.

**Queued fix: the box must fit inside the opposite apron, including the modesty-panel case: ADDRESSED.**

- `available = A − t_f` on every base (`table/drawers.ts:219`, and in the row-level slide pick at `:327-330`).
- Probe results:
  - desk with cabinet and top drawer: the box back is at z 82, the modesty panel at [20, 38];
  - 800 × 450 desk with panel_ends: box back at 82;
  - dining 1800 × 758 with 1 front drawer: box back at 125, behind the back apron at 83.

  None overlap.

**m1. The side-drawer `edgeMap` remap had no test: ADDRESSED.**

- Tests at `generateTable.test.ts:997-1050` read `ctx.edgeMap` and resize turned parts with `lengthDelta` and `widthDelta`.
- My identity-edge-map mutant is killed (2 tests fail).

**m2. The spec-silent choices had no tests: ADDRESSED.** Tests now cover:

- the radius clamp (r 5000, `:524`, `:579`);
- the ellipse for round W ≠ D;
- the unbanded pedestal top plate with faces 0 (`:1395-1415`);
- the cabinet face values.

The implementer's mutants for each are killed. I spot-checked the outline dedupe and it is killed.

**m3. Duplicate points at `r = min(W, D)/2`: ADDRESSED.**

- `outlines.ts:74-78` drops a point that equals the next one, including across the wrap.
- 900 × 900 at r 450 gives 32 points and 1800 × 900 at r 450 gives 34 (`generateTable.test.ts:135-139`).
- The ring stays clockwise and the BOM perimeter is unchanged.

**m4. `table_drawer_side_unsupported` named a key that does not exist: ADDRESSED for that code** (`table/drawers.ts:316`, `entityIds []`). The new code reintroduces the same pattern (N1 below).

**m5. Under-top drawers were skipped silently: ADDRESSED.**

- A bay that is too narrow, or a box with no inner width, now gives warning `table_drawers_dont_fit` (`table/drawers.ts:334-343`).
- The minimum opening is `minDrawerOpening` (`carcass/drawers.ts:370-388`): side mount 51, undermount 43.
- A slide too short for its box gives `drawer_no_slide` (`:224-233` region).
- The exact boundary tests (W 286/287, 488/489, 278/279) are correct by my arithmetic: `ws ≥ wsMin ⇔ bay ≥ 2t_c + k·wsMin + (k−1)·spacing`, because `wsMin` is an integer and `ws` is floored.

**Spec-19 ruling: apron inset clamped to `max(0, s − t_c)` with info `apron_inset_clamped`: implemented as ruled.**

- The clamp is applied in `frame.ts:180-190` and used by the aprons (`bases.ts:102`) and by the drawer row (plane, `depthAvail`, bay).
- Probe with LEG-CAB-ADJ (s 40), inset 30 and 2 left drawers: `{requested 30, applied 22}`, and no apron or drawer overlaps.

**Spec-19 ruling: `table_drawers_dont_fit {available, required}` warning: implemented as ruled.** It is appended to `FURNITURE_ISSUE_CODES` (`validate.ts:89-93`), which makes 71 codes.

## New breakage in the fix diff

**N1 (Minor): the new code names a key that does not exist.** `table_drawers_dont_fit` uses `entityIds ['table.drawer']` (`table/drawers.ts:342`; asserted at `generateTable.test.ts` in the dont_fit test). This is the pattern m4 just removed from `table_drawer_side_unsupported`: no part or hardware is keyed `table.drawer`, so the Issues panel focus (07 §7.1) has nothing to select. The report calls it "the drawer group key", but your ruling as relayed to me fixes only the params. Use `[]` for consistency, or log the group key as part of the ruling.

**N2 (Minor): `available` can be negative.** When the legs or panels meet or cross, the bay width goes below zero. A 150-wide dining table with a drawer gives `table_drawers_dont_fit {available: −50, required: 87}`; this is my probe "N". The message would then read "there are −50 mm". Use `max(0, fl(bay))`. Only a non-template width reaches this (dining starts at 900, coffee at 500).

## Out-of-scope observations (non-blocking; for the final review)

**O1. With `s ≠ t_leg`, the §3.13 formulas themselves make parts intersect.** This is pre-existing and independent of the fix.

- Solid legs are `s` (x) × `t_leg` (z). Side aprons and side stretchers start at `bz0 + s`, and the centre stretcher at `bx0 + s`.
- `s = 10`, `t_leg = 50`, inset 5 (the implementer's thin-leg test): the left and right aprons pass through all four legs (10 × 90 × 40), and the aprons cross each other (8 × 90 × 8). That test (`generateTable.test.ts:842-857`) does not assert `partOverlaps`. The report says the aprons cross by `(t_c − s)²` under the ruled formula.
- Hardware legs LEG-CAB-ADJ (s 40, `t_leg` 50) with a stretcher: `stretcher.center` crosses `stretcher.left` and `stretcher.right` by 5 × 60 × 50 (my probe "S").
- The same happens with any leg material thicker than `legSection` (`t_leg > s`).
- Template defaults never reach this (legSection 50 = SW50; LEG-TBL-710 has s 60). It needs a spec-19 decision on legs with `s ≠ t_leg`.

**O2. Console tables 350–355 mm deep cannot take drawers.** This is a consequence of the queued `t_f` deduction, and correct by §3.12. The console_table template range starts at 350 (07 §2.4.17), and at that depth the template's drawers give `drawer_no_slide` (`availableDepth 254`, maxLen 244, shortest slide 250). Drawers need `D ≥ 356` with inset 10 and overhang 20. The template task should either raise the minimum depth or accept the error.

## Verdict

**Fix round:** All findings are addressed, and there is no new Critical or Important breakage. Two Minor items are open in the new code: N1 (`['table.drawer']` entity on `table_drawers_dont_fit`) and N2 (negative `available`).
