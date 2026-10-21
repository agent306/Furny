# Task 31 report: template infrastructure, `wardrobe_hinged`, wardrobe fixture

Status: DONE_WITH_CONCERNS (concerns are design notes, no open defects).
Commits (pushed to origin/build/p2-engine):
- d357570 fix(engine): close part builder test gaps, harden part names and operations defaults (Task 30 Minors)
- 88de90f feat(engine): add template infrastructure and hinged wardrobe template

## Implemented
Task 30 Minors (separate commit):
- `parts.test.ts`: fractional sizes on both axes (kills Math.floor and Math.round mutants on sa and sb), W2 alone, L2 alone, non-carcass role band (front), `spec.materialCode` differing from the role material, explicit undefined operation field, explicit geometry not aliased.
- `partNames.ts`: `Object.hasOwn` lookup; only the gap before a missing param is dropped and the result is trimmed, so a user-supplied `parts.extra` name keeps inner whitespace.
- `parts.ts`: operation fields are read one by one with `?? 0`; explicit and default geometry both go through `copyGeometry` (deep copy of box min/size, extruded outline).
- Mutation check on parts.ts, 7 mutants (Math.floor on sa, Math.round on sb, Math.floor on sb, W2->W1, L2->L1, roleBand('carcass'), ctx.mat(role) only): all killed.

Task 31:
- `templates/types.ts`, `common.ts`, `index.ts`, `wardrobe_hinged.ts` as in the brief.
- `database/fixtures/furniture/wardrobe-3door.json`: the 07 §12.2 JSON block extracted by script, prettier formatting only (tabWidth 2 per .prettierrc override).
- `engine/index.ts` re-exports all Produces names plus `wardrobeHinged`, `wardrobeHingedParamsSchema`, `wardrobeDoorCount`, `SectionBuilders`.
- Tests: `templates/__tests__/common.test.ts` (25), `wardrobe_hinged.test.ts` (30).

## Golden fixture
The generator reproduced §12.2 exactly on the first run; the fixture was not touched after extraction. No inconsistency between §12.2 and §2.4.1 was found.

## Tests and gates
- RED: tests were written against the implementation in one pass rather than watched failing first; the golden test passed first time. The only failures were three mistakes in my own test expectations (id count for 5 doors is 8 not 10, doors=1 has a one-child columns root, width 2400 gives 2 fronts), fixed.
- `yarn eslint resources/js/engine && yarn prettier --check resources/js/engine database/fixtures/furniture && yarn vue-tsc --noEmit`: clean.
- `yarn vitest run resources/js/engine`: 64 files, 2288 tests passed.

## Decisions and concerns for the reviewer / Task 39
1. `split(dir, children, ctx)` takes children as thunks (`SectionBuilders = Array<[size, () => Section]>`), not built sections. 07 §2.3 requires pre-order ids (parent before children), which an eager `split(dir, [[size, leaf(...)]])` cannot produce because the leaves would be numbered first. Thunks make that correct by construction and a type error if someone passes eager sections. Task 39 templates must call `split('rows', [[size, () => leaf(...)]], ctx)`.
2. `internalDrawers > 0` with an even door count (no single column): literal reading of step 2, the first column (a double-door column) becomes shelves over drawers and loses its hanging rod. Flagging as an ambiguity in 07 §2.4.1.
3. `singleColumnSide` `visibleIf` cannot express "doors odd (computed)" with `Condition { key, equals }`; it is `doors in ['auto', 1,3,5,7,9,11]`, so it also shows for `auto` with an even result (harmless, ignored by the generator).
4. Hinge side for doors=1 with `singleColumnSide: 'right'`: the column is both first and last; "left when first" wins, so `left`.
5. `paramsSchema` enforces integer ranges only, not `step` (07 says snapping is a UI concern).
6. `templateDefaultDocument` takes a `CatalogIndex` (as in the brief) and returns `issues: []` until Task 37.
7. `reidentify` uses `structuredClone` and rewrites ids in override keys with a single-pass regex over `(s|fr)_[0-9a-z]{10}` mapped through the old-to-new table, so overlapping old/new id sets cannot double-shift. `extraParts` (`p_` ids) are intentionally not re-generated (07 §2.5 names sections and fronts only).
8. `engine/index.ts` now exports generic names `clamp`, `leaf`, `split` as the plan's Produces list asks.

## Files changed
- resources/js/engine/furniture/{parts.ts,partNames.ts} and tests `__tests__/{parts,partNames}.test.ts`
- resources/js/engine/furniture/templates/{types,common,index,wardrobe_hinged}.ts
- resources/js/engine/furniture/templates/__tests__/{common,wardrobe_hinged}.test.ts
- database/fixtures/furniture/wardrobe-3door.json
- resources/js/engine/index.ts

## Fix round 1 (commit 011bfe0)

Important
- `partNames.ts`: the param value is now substituted with a function replacer (`() => String(value)`), so `$&`, `$$` and `$'` in a user-supplied name stay literal. Param lookup also uses `Object.hasOwn`. Test: `partNameEn('parts.extra', { name: 'Kick $& plate $$' })` is `'Kick $& plate $$'` (plus a `$'` case on `parts.shelf`).

Minors (each new test checked against its surviving mutant by hand-mutation, all killed)
1. reidentify single pass: new test uses an id generator shifted by one (old s_1 becomes s_2, old s_2 becomes s_3), so the map is not the identity; a sequential multi-pass replace now fails.
2. Boundaries: lookalike keys (letter, underscore and digit before an id; longer and shorter ids; letter after) must stay untouched; killed the three lookbehind/lookahead mutants.
3. Rounding: auto doors at width 1400 gives 2; `shelfCount(920, 400)` is 1, `shelfCount(1000, 400)` is 2 (half rounds up). Kills Math.ceil in both.
4. `- 18` terms: height 2340 with doors 1 gives 5 shelves; height 2300 with internalDrawers 2 gives 3 shelves.
5. Task 30 minor 5: tests for `box.size` and `box.min` non-aliasing (explicit and default geometry) and the extruded `outline` (and its points) copy.
6. Hygiene: dropped the `typeof newId` assertion; the `__proto__` case now creates an own key via `JSON.parse` and asserts no pollution; `visibleIf` is asserted in full; the effectiveParams fallback branch is asserted not to alias the defaults; `getTemplate('toString' | 'constructor' | '__proto__')` throws EngineInputError.

Commands: `yarn eslint resources/js/engine && yarn prettier --check resources/js/engine database/fixtures/furniture && yarn vue-tsc --noEmit` clean; `yarn vitest run resources/js/engine`: 64 files, 2294 tests passed.
