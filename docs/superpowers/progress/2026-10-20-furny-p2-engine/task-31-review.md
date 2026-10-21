# Task 31 review (2d042b8..88de90f)

### Spec Compliance

- ✅ Spec compliant. The accepted controller rulings were not re-flagged.
- ⚠️ Cannot verify from the diff: `validateFurniture` (Task 37) is not there yet, so 07 §2.1 rule 3 (a valid document for every in-range combination) is only covered structurally. The test "produces valid documents across the declared ranges" runs `FurnitureDocumentSchema.parse` on 30 combinations. That is the schema, not the validator.

Checks run:

1. Golden fixture (07 §12.2).
   - A script extracted the first json block after `### 12.2` and compared it with `database/fixtures/furniture/wardrobe-3door.json`.
   - Parsed values are equal, and the key-ordered serialisation is identical.
   - The test (`wardrobe_hinged.test.ts:33-37`) reads the file with `readFileSync` through a 6-level `new URL` and deep-equals `gen()` with it.
   - The `templateDefaultDocument` test equals the same file.
   - The fixture also parses as a `FurnitureDocument`.
   - Mutants on `HANGING_ZONE_TOP`, `ROD_TOP_CLEARANCE`, `SHELF_FRONT_SETBACK`, `PLINTH_SETBACK`, `SHELF_PITCH`, column weight and the hinge side all die on this test.
2. 07 §2.3 helpers.
   - `columnsFromDoors`: 1 gives `[1]`, 2 gives `[2]`, 3 gives `[1,2]`, 4 gives `[2,2]`, 5 gives `[1,2,2]`, and `(5,'right')` gives `[2,2,1]`. This matches the spec.
   - `shelfCount`: `clamp(round(h/pitch) - 1, 1, 20)`. This matches the spec.
   - `interiorHeight(H, plinth)`: `H - plinth - 36`. The brief fixes this two-argument form; the spec says `interiorHeight(params)`.
   - `effectiveParams`:
     - It merges `{...defaults, ...overrides}`.
     - It ignores keys that are not fields.
     - It validates with `paramsSchema` and falls back to a copy of the defaults.
     - The spec's "server logs a warning" is not in the engine. That is correct for framework-free code.
   - `reidentify`:
     - It uses `structuredClone`.
     - Section ids are drawn pre-order, then front ids.
     - `covers` is rewritten.
     - `overrides.parts` and `overrides.hardware` keys are rewritten through one regex pass over an old-to-new map.
     - I checked the schema for other id-bearing fields (`schema.ts:237-277`). `ExtraPart` and `ExtraHardware` carry only their own `p_`/`h_` ids and no section or front references. Nothing else needs rewriting, and nothing else is rewritten.
   - `resolveDefaultMaterials`, `commonCarcass`, `leaf`, `hingedFront` and `emptyOverrides` match their spec text field by field.
3. 07 §2.4.1 steps 1-5.
   - Step 1: the columns root has `flex` weight equal to the doors in each column.
   - Step 2: `shelfCount(ih, 400)`, `frontSetback 20`, `adjustable true`.
     - The drawer variant is `rows[flex 1: shelves(ih-18-n*180) / fixed n*180: drawers(equal, null, behindDoor)]`.
     - It goes to the first single column, else the first column.
   - Step 3: `long` gives `fixed 350 empty / flex 1 rod(60)`, and `double` adds a second `flex 1 rod`.
   - Step 4: the hinge side is `left` when first, `right` when last, otherwise `auto`. Double columns use `auto`.
   - Step 5: plinth 0 gives `none`; otherwise `plinth/100/20`. `back.type` is taken from `backType`.
   - Doors `'auto'`: 600 gives 1, 900 gives 2, 1500 gives 3, 1800 gives 3, 3600 gives 6.
   - Field order is width, height, depth, doors, singleColumnSide, hangingStyle, internalDrawers, plinthHeight, backType.
   - The three length ranges are 600-3600, 1500-2700 and 450-750, all step 10. `helpKey` is on depth. `plinthHeight` and `backType` are advanced. `paramsSchema` ranges are probed against the field ranges.
4. Task 30 minors. See the mutation table below.

### Mutation check

Done in a scratch copy at `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/mut31`, with the harness at `.../scratchpad/tools/mut31.py`. The worktree is untouched. The scratch engine tree was diffed against the worktree afterwards and is identical. 17 Task 30 mutants and about 70 Task 31 mutants were run against `resources/js/engine/furniture`.

Task 30 minors:

| Minor | Fix | Mutants | Result |
|---|---|---|---|
| 1 | fractional sizes | Math.floor on sa, Math.round on sb, Math.floor on sb, Math.round on sa | all 4 killed |
| 1 | W2 alone / L2 alone | W2->W1, L2->L1 | both killed |
| 1 | role band | `roleBand('carcass')` | killed |
| 1 | spec.materialCode | `ctx.mat(spec.role)` only | killed |
| 2 | `Object.hasOwn` | revert to plain lookup | killed |
| 3 | inner whitespace | re-add `\s+` collapse | killed |
| 4 | explicit undefined ops | revert to `...spec.operations` | killed |
| 5 | geometry not aliased | return `geometry` as is; alias `min`; alias the default path | all 3 killed |
| 5 | `size` array aliasing | alias `size` | SURVIVED |
| 5 | extruded `outline` copy | alias `outline` | SURVIVED |

All five Task 30 minors are fixed in code. Only the `size` and `outline` branches of minor 5 are not killed.

Task 31 survivors, excluding equivalent mutants:

- `shelfCount` with `Math.ceil` instead of `round`.
- Auto doors with `Math.ceil` instead of `round`.
- `ih - 18` for the single-door column.
- Dropping the `- 18` term from the drawer-column shelf count.
- `reidentify`: the sequential-replace variant (a multi-pass instead of single-pass mapping), without the lookbehind, without the lookahead, and the lookbehind variant `(?<![0-9a-z])`.
- `effectiveParams` fallback returning `def.defaults` itself.
- `getTemplate` with a plain lookup instead of `hasOwn`.
- `visibleIf.equals` with 11 removed.

Equivalent mutants, not findings:

- `clamp` argument swap.
- The `known` key filter, because zod strips unknown keys anyway.
- Auto-door clamp lower and upper bounds, because width 600-3600 gives 1-6.
- Hinge `right` for a middle single column (unreachable).
- Sections-before-fronts ordering inside `reidentify`, because per-prefix counters make the interleaving unobservable.
- `resolveDefaultMaterials({}, ctx)`, because the wardrobe has no `preferredMaterials`.

### Strengths

- The golden fixture is byte-faithful to 07 §12.2, and the test reads the file.
- Thunks in `split` make pre-order ids correct by construction. A test pins it, and the "split id after" mutant dies in two places.
- The `reidentify` single-pass regex has a lookbehind and lookahead that protect embedded tokens. Deep-copy and non-mutation of the input are tested, and the true post-order and right-to-left mutants die.
- The probe test compares every `paramsSchema` min/max (and min-1, max+1) with the field ranges, so the "ranges identical to fields" rule is enforced mechanically.
- The Task 30 test additions are well targeted. Each of the four fractional-size mutants dies on the new test.

### Issues

#### Critical (Must Fix)
None.

#### Important (Should Fix)

1. `resources/js/engine/furniture/partNames.ts` (the `.replace(/\s*\{(\w+)\}/g, ...)` block): the Task 30 minor 3 fix introduces a bug in the case it was written for.
   - The inner `match.replace(/\{\w+\}/, String(value))` passes the user-supplied value as a replacement string.
   - JavaScript interprets `$&`, `$$`, `` $` `` and `$'` in it.
   - Verified with node on the exact code: `partNameEn('parts.extra', { name: 'Kick $& plate $$' })` returns `"Kick {name} plate $"`.
   - The comment above the block says the values are never rewritten.
   - No test covers it. The function-replacer variant `() => String(value)` survives the whole suite.
   - Fix: use a function replacer, or build the result as `match.slice(0, match.indexOf('{')) + String(value)`. Add a test with `$&` and `$$` in the name.

#### Minor (Nice to Have)

1. `common.test.ts` ("does not remap when new ids overlap old ones (single pass)"):
   - The test uses `testIds()`, so the old-to-new map is the identity and a sequential multi-pass replace gives the same result.
   - The sequential-replace mutant survives, so the property the implementation is built for is not verified.
   - Fix: generate new ids that shift the old ones (new `s_2` equal to the old id of the next section), then assert the exact keys.
2. `reidentify` lookbehind and lookahead (`common.ts` `idPattern`) are untested. Three mutants survived. Add a key such as `xs_0000000002.shelf` or an 11-char token and assert it is untouched.
3. Auto-door rounding is only tested at x.5 and integer ratios (900, 1500, 600, 1800, 3600).
   - `Math.ceil` instead of `Math.round` survives.
   - Add a width below the half step, e.g. 1400 (ratio 2.33, expect 2) or 1499.
   - The same holds for `shelfCount`: `ceil` survives. `shelfCount(920, 400)` is 1 (ceil would give 2).
4. The `- 18` terms are unobserved.
   - `shelves(ih - 18)` for the single-door column, and a drawer-column count without `- 18`, both survive because the counts coincide at the heights tested.
   - Flipping heights with plinth 100: `height 2340, doors 1` gives 5 shelves, and 4 with the extra `- 18`.
   - `height 2300, internalDrawers 2` gives 3 shelves, and 4 without the `- 18`.
5. Task 30 minor 5 test covers only the box path.
   - Aliasing of `box.size` and the extruded `outline` copy are not killed.
   - Add `size` identity and an extruded geometry case.
6. Test hygiene.
   - `wardrobe_hinged.test.ts`, "draws real ids by default": `expect(typeof newId('s')).toBe('string')` asserts nothing about the code under test.
   - `common.test.ts`, "ignores keys that are not template fields": the `__proto__: {...}` literal sets the prototype and creates no own key. The case adds nothing. Use `JSON.parse('{"__proto__": {...}}')` if it is meant to be tested.
   - `visibleIf.equals` content is not asserted (only `.key`), so dropping `11` goes unnoticed.
   - The `effectiveParams` fallback returns a copy, but only the parse-success path is asserted as not aliasing the defaults.
   - `getTemplate` is not tested against inherited keys such as `'toString'`, although the code guards it with `hasOwn`.

### Assessment

**Task quality:** Needs fixes

**Reasoning:** The spec is met in full. The fixture matches 07 §12.2 exactly, the helpers and generation steps match 07 §2.3 and §2.4.1, and all five Task 30 minors are fixed. One real bug came in with the minor 3 fix: `$` sequences in a user-supplied part name are interpreted by `String.replace`, and no test catches it. A small patch fixes it. The remaining survivors are test gaps with no code defect behind them.
