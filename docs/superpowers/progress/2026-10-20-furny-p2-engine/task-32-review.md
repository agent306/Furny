# Task 32 review: carcass envelope, panels, plinth, countertop (011bfe0..df47c69)

## Spec Compliance

- Spec compliant. Every row of 07 §3.2, §3.3, §3.5, §3.6 and §5.2-§5.4, and the §7.3 severities, match the code. Controller rulings (ctx signatures, plinth_ignored in computeEnvelope, zero-height plinth skipped, covers = leaf or ancestor with first front winning, shared docs in furniture/testing/docs.ts) were not re-flagged.
- Cannot verify from this diff: part `grain` values (07 §5.3) depend on `makePart` (Task 30), and no test in this task asserts `grain`. I checked them in a scratch test with PB18-OAK, and they are correct (see "Checks run").

## Strengths

- `envelope.ts` follows the §3.2 table one row at a time. That includes the `fz` derivation (`hasSliding` first, then overlay fronts, with half overlay counting as overlay), `drawerStyle` (needs at least one front and all inset), `slidingZone = 2 * (t_f + 12)`, the per-type `zBackFront`, and the interior depth `Dc - slidingZone - zBackFront`.
- Thicknesses come from the right role (`ctx.t('top' | 'front' | 'back' | 'carcass')`). They are not hard-coded.
- The interior `<= 0` check runs after the minimum-size checks and uses the same error path.
- `panels.ts` shares one `side()` helper and one `horizontal()` helper, so left/right and top/bottom cannot drift apart. The banding conditions are the §5.2 rules exactly.
- `plinth.ts` places the `legs` kickboard front only when sb > 0. Return count and positions match §12.4 at the 1000, 1001, 2000 and 2001 boundaries. The 50 mm boundary is exact.
- Tests assert real values: sizes, positions, edges, faces, joint order and issue payloads. They cover the boundary cases (300 mm overhang does not warn, exactly 50 mm return depth, minimum envelope sizes). They also include a thick-material catalog mutation for the interior `<= 0` check.

## Checks run (scratch copy only, worktree untouched)

Scratch copy: `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/rv32`, with node_modules symlinked and the committed tests passing 52/52.

Extra cases written in `extra.test.ts` (9 cases, all pass against the unmodified implementation):
- Sliding front with a 25 mm front board: `slidingZone` 74, `fz` 0, interior size `[1164, 584, 483]`.
- Sliding mixed with a hinged front: `fz` 0.
- Inset fronts, and an inset front that does not cover the external drawers: `fz` 0, `drawerStyle` 'inset'.
- Half overlay: `fz` = `t_f`.
- A 25 mm front board gives `fz` 25 and `Dc` 535.
- Loft mounting with a legs plinth: `plinthH` 0 plus `plinth_ignored` info.
- Legs with setback together with sliding fronts: only `plinth.front`.
- A `plinth` type with countertop overhangs left 30 / right 20 / front 10:
  - `x0` is 30, `Wc` 2250 and `Dc` 550.
  - There are 4 returns, the first at x = 30 and the last at x = 2262.
  - The countertop box is `[2300, 25, 560]`.
- Oak (`hasGrain`) grain for side, top, bottom, plinth front/back/return and countertop: all 'length'.
- Bottom `over_sides` on a wall unit: side bottoms not banded.
- Exact minimum envelope with a plinth: parts are generated.

Mutation run on the formulas (about 70 mutants):
- Killed: every `Wc` / `Hc` / `Dc` / `x0` / `y0` / `zp` / `zBackFront` / `slidingZone` / min-size / interior / `drawerStyle` / `hasOverlayFronts` / `plinthH` mutant, and every issue-severity mutant. Also killed: side/top/bottom position, size and banding mutants; joint length; plinth front/back/return z, size, banding, return count and spacing mutants; the 50 mm and 300 mm boundaries; countertop role, material, banding, faces, size and position.
- Equivalent: dropping the `kind !== 'sliding'` guard in `hasOverlayFronts` (redundant with `hasSliding ? 0`).
- Survivors are listed as Minor findings M1-M5.

Severity check against §7.3: `envelope_too_small` is error, `plinth_too_shallow` is warning, `countertop_overhang_large` is warning, and `plinth_ignored` is info. All four match.

## Issues

### Critical (Must Fix)
None.

### Important (Should Fix)
None.

### Minor (Nice to Have)

- M1: No test asserts `part.grain`. The survivors when grain was mutated were: `panels.ts` side grain `y` to `x`, `plinth.ts` front grain `x` to `z`, return grain `z` to `x`, and `countertop.ts` grain `x` to `z`. The seed materials the tests use (PB18-WHITE, PB25-WHITE) all have `hasGrain = false`, so grain is always 'none'. Fix: one test using `PB18-OAK` (see my extra case) asserting 'length' for side, top, bottom, plinth front/back/return and countertop.
- M2: No plinth test has `x0 != 0`. `plinth.ts` return `rx = x0 + ...` and `x0` in the front/back boxes survive dropping `x0`. The countertop tests with side overhangs use `legs` (no returns, front only). Fix: add a `type: 'plinth'` document with `overhangLeft > 0` and assert the first return min x = x0 and the last = x0 + Wc - t_p.
- M3: All test materials are 18 mm except top (25) and back (3), so `ctx.t('front')` vs `t('carcass')` vs `t('plinth')` mix-ups survive. For example, `envelope.ts` `const tf = ctx.t('front')` replaced by `t('carcass')` passes. Fix: one document with PB25 for `front` and `plinth` (asserting `fz` 25, `slidingZone` 74, plinth front z).
- M4: `panels.ts:23` `if (!bottomOver && C.mounting !== 'floor')`: dropping `!bottomOver` survives. The case "wall unit with bottom `over_sides`" is untested. §3.3 and §5.2 say bottom is banded only iff `between_sides` and mounting is not floor.
- M5: A sliding front mixed with another non-inset front is untested. Only the redundant guard in `hasOverlayFronts` keeps `fz` at 0 in that case, so `fz = hasOverlayFronts ? tf : 0` (ignoring `hasSliding`) survives. Add one assertion.
- M6: The zero-height plinth guard (`plinth.ts` `if (h <= 0) return;`) has no test. Removing it survives. The behaviour is ruled correct but should be pinned by a test.
- M7: TDD was not red-first (the report admits the implementation was written before the tests). The tests do exercise the implementation (the mutation run kills the large majority of mutants), so I am not escalating. Process note only.
