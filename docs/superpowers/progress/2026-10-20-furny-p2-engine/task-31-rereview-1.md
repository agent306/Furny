# Task 31 re-review, fix round 1 (88de90f..011bfe0)

## Finding Verdicts

- **Important: `partNames` string replacer expanded `$&` / `$$` in a user-supplied name** - ADDRESSED. `partNames.ts` now uses `() => String(value)`. Reverting it to `String(value)` in a scratch copy fails `partNames.test.ts` "keeps $ replacement patterns of a user-supplied name literal".
- **Minor 1: reidentify single pass with shifted ids** - ADDRESSED. `common.test.ts` "maps in a single pass when new ids overlap old ones" shifts the ids by one. The sequential-replace mutant fails it, and the post-order and reversed-children mutants also fail.
- **Minor 2: regex lookbehind/lookahead** - ADDRESSED. "only rewrites whole ids, not tokens that merely contain one" kills six mutants: no lookbehind, no `_` in the lookbehind, no digit in the lookbehind, `(?<![0-9a-z])`, no lookahead, and no digit in the lookahead.
- **Minor 3: rounding boundaries** - ADDRESSED. `Math.ceil` in `shelfCount` is killed (`shelfCount(920,400)`). `Math.ceil` on auto doors is killed (width 1400). `Math.floor` is also killed.
- **Minor 4: the `-18` terms** - ADDRESSED. The "subtracts the two board thicknesses" test kills both `shelves(ih - 18)` for the single-door column and the drawer shelf count without `- BOARD_THICKNESS`.
- **Minor 5: Task 30 minor 5 copies** - ADDRESSED. The `size` alias, `outline` alias, per-point outline alias, `min` alias, default-box alias and whole-geometry alias mutants are all killed.
- **Minor 6: test hygiene** - ADDRESSED.
  - The `typeof newId` assertion is gone.
  - The `__proto__` case uses `JSON.parse` and asserts an own key and no pollution.
  - `visibleIf` is asserted in full; dropping `11` is killed.
  - The `effectiveParams` fallback not aliasing the defaults is asserted; the alias mutant is killed.
  - `getTemplate('toString' | 'constructor' | '__proto__')` is tested; the plain-lookup mutant is killed.

## Mutation check

Scratch copy: `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/mut31b`, harness `.../scratchpad/tools/mut31b.py`. The scratch engine tree was diffed against the worktree afterwards and is identical; the worktree was not touched.

Survivors are all equivalent:
- `clamp` argument swap.
- The `effectiveParams` known-key filter (zod strips unknown keys).
- Auto-door clamp lower bound (the width range is 600 or more).
- fronts-before-sections order in `reidentify` (per-prefix counters).
- `hasOwn(nameParams)` in `partNames` (an extra hardening in the fix; no template placeholder can collide with an inherited key).

## New Breakage in the Fix Diff

None. The `partNames` change is behaviour-preserving apart from the fix. The test edits are test-only. The report names the covering suite and shows its output.

## Out-of-Scope Observations

None.

## Verdict

**Fix round:** All findings addressed, no new Critical/Important breakage.

APPROVED
