# Task 36 re-review 1 (fix ed982fa..f9e5b77)

All mutants below were run in a scratch copy outside the worktree, which has since been deleted. The baseline was 658 furniture tests, all green.

### Finding Verdicts

- **Controller 1: revert the edit to the 07 spec text.** ADDRESSED.
  - The fix diff restores the original `hinged_leaves_unsupported` row in `07-furniture-system.md`.
  - `git diff ae4c489 f9e5b77 -- docs/` is 0 bytes.
- **Controller 2: no `override_orphaned` noise when the envelope is null.** ADDRESSED.
  - `generateCarcass` returns false on a null envelope (`generate.ts:88`).
  - `applyOverrides(ctx, { reportOrphans: generated })` is called at `generate.ts:140`, and `orphanReporter` returns early at `overrides.ts:52-54`.
  - The test is `overrides.test.ts` "reports no orphaned overrides when the envelope is too small". Mutant "orphans always reported": killed.
- **Minor 1: kill the surviving mutants.** ADDRESSED. I re-ran each one and all are killed:
  - extras before the part overrides, and extra hardware before the hardware overrides;
  - fronts sorted by y ascending;
  - no fallback for an unknown override material;
  - anti-tip using `Hc`, and legs and brackets using `W`;
  - connectors after the overrides;
  - sections sorted by id.
  - **`legFitsHeight`** now treats a leg with no specs as not fitting: `return false` at `carcassHardware.ts:34`, which raises `leg_height_mismatch`. A unit test and a generate test pin it, and the mutant back to `true` is killed.
  - **Seed check:** all three seed legs carry height specs, so no real document picks up a new warning.
- **Minor 2: make the drift test exact.** ADDRESSED.
  - `catalogDrift.test.ts` now uses `toEqual` on exactly two `{ warning, hinge.full_overlay, [front.{F}.hinges] }` entries.
  - A mutant that emits `no_default_hardware` twice is killed.
- **Minor 3: a glass model front is dropped when only its stile is removed.** ADDRESSED.
  - `remainingFronts` (`overrides.ts:68-84`) keeps the front while any part with the key `front.id` or `front.id + '.'…` remains. It re-points `partKey` to the first remaining part by `cmpId`.
  - Mutants killed: the old filter, `partKey` kept, rest unsorted, and the last part taken instead of the first.
- **Minor 4: `drawersFor` recomputes `computeOpenings` for every drawer leaf.** ADDRESSED.
  - `openingsOf` (`openings.ts:280-307`) memoises per `GenContext` in a `WeakMap`, and checks the doc, env and layout by identity.
  - `frontParts` and `drawersFor` both use it.
  - Mutants killed: no doc check, no env check, no layout check, never stored.
  - **Sharing the map is safe:** no caller mutates an opening or the map. I grepped for assignments to `opening.*`, `edges[…]` and `openings.set/delete`, and the only hit is `part.edges` in overrides.

### New Breakage in the Fix Diff

- **Minor:** the extra suppression for a carcass-family document with `carcass: null` (`generate.ts:133-136`) is untested.
  - The mutant `doc.carcass === null || generateCarcass(…)` survives.
  - The family-`table` / `table: null` case still reports orphans, so the two "no spec" families behave differently.
  - Task 38 should settle both.
- **Equivalent mutant, not a finding:** `belongsTo` without the `.` boundary (`overrides.ts:59-60`) survives. A collision needs a front with 10 or more leaves (`leaf.1` vs `leaf.10`), and hinged fronts have at most 2 leaves, sliding fronts at most 4.

### Out-of-Scope Observations

None new. The two ⚠️ items from the first review stay with the controller:
- `table.connectors.*` duplicate keys (Task 38);
- edge bands derived from the catalog are not code-checked.

### Verdict

**Fix round:** All findings addressed, no new Critical/Important breakage. **APPROVED.**
