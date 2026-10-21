# Task 30 review (63b4d56..2d042b8)

### Spec Compliance
- ✅ Spec compliant. The controller rulings were not re-flagged.
- ⚠️ Cannot verify from the diff: `database/fixtures/furniture/wardrobe-3door.json` (07 §12.2) is not part of this task. The schema test embeds the §12.2 JSON inline and it parses. Whether the file on disk matches belongs to the template/fixture tasks.

Checks run:
- Schema vs 03 §2.
  - Every field, enum and int-ness matches.
  - Count ranges from the 03 comments are enforced (shelves 1..20, drawers 1..10, table drawers 0..3, extra part qty 1..99, flex weight > 0).
  - `materials` and `ExtraPart.edges` are exhaustive records; `PartOverride.edges` is a partial record.
  - The `Front` code fields are `string | null`, so `'inherit'` and `'auto'` are accepted.
  - No extra fields. `FRONT_KINDS`, `FAMILIES` and `EDGE_IDS` are only exported enum tuples.
  - Unknown keys are stripped (zod default). 03 is silent on this, and it matches the plan schema, which also does not use `.strict()`.
- 07 §1.3 constants, compared by script against the spec table: 55 of 55, names and values identical, none missing, none extra. `fl = Math.floor(v + 1e-6)` agrees with 07 §0. All 55 are re-exported from the index.
- `PART_NAMES_EN`: 38 entries; the key set is identical to the 38 backticked `parts.*` keys of 07 §1.6, with no duplicates. The English strings match. `{n}`, `{leaf}` and `{name}` are filled, and a missing param drops out ("Back panel").
- `TEMPLATE_KEYS`: exactly the 19 keys of 07 §2.1, in spec order.
- `migrateFurniture` (migrate.ts:25-79):
  - v1 is a no-op that still goes through zod parse.
  - v2 and above throw `unsupported_schema_version`.
  - A gap in the registry throws `unsupported_schema_version`.
  - A non-object, or a non-integer, negative or missing version throws `invalid_input`.
  - Registry and no-op test exist, as 03 §4 requires.
- `makePart` rules 1-8 (parts.ts:57-128):
  - Rule 1 uses `fl` on both non-thickness axes, in x,y,z order.
  - Rule 2: max/min, with the square tie-break `grainAxis === b ? b : a`.
  - Rule 3: axis edge names correct.
  - Rules 4-5: priority ends `x:0 (left)`, `y:1 (top)`, `z:1 (front)`.
  - `L1/L2` come from the width axis and `W1/W2` from the length axis.
  - The side (y,z), top (x,z) and door leaf (y,x) examples all yield the spec results.
  - Rule 6: `bandCode !== undefined` distinguishes `null` from absent; the role band comes from `ctx.roleBand`.
  - Rule 7: `hasGrain` is checked first, then `mapGrain`.
  - Rule 8: thickness is `Math.round`, qty is 1, source is 'generated', overridden is false, operation counters default to 0.
  - `ctx.edgeMap.set` is called.

### Mutation check of makePart
Scratch copy at `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/mut`; the worktree is untouched. 23 mutants were run against `parts.test.ts`.

Killed (17):
- x, y and z priority ends flipped
- z and y axis edge order swapped
- `L1` taken from the length axis
- square tie-break flipped
- square tie-break ignoring grain
- `Math.round` instead of `fl` on `sa`
- `bandCode ?? roleBand` (null no longer disables banding)
- `hasGrain` check dropped
- qty
- thickness floor
- `length: sa`
- `edgeMap` not set
- grain length/width swapped
- source

Survived (6, in 5 groups):
1. `Math.floor` instead of `fl` on `sa`, and likewise on `sb`. The epsilon is never exercised through `makePart`; `fl` is only unit-tested on its own.
2. `Math.round` instead of `fl` on `sb`. No test has a fractional value on the second axis; the door leaf only has a fractional `sa`.
3. `W2: edgeCode('W2')` changed to `edgeCode('W1')`. No test bands W2 alone; the only W2 test bands `top` and `bottom` together.
4. `ctx.roleBand(spec.role)` changed to `ctx.roleBand('carcass')`. Every banding test uses role `carcass`; the fixture doc gives only the carcass role a band.
5. `material(spec.materialCode) ?? ctx.mat(role)` changed to `ctx.mat(role)`. Every test assigns the same material to all roles and to the spec, so spec-code versus role-code resolution is indistinguishable.

### Strengths
- `makePart` is a faithful, compact transcription of rules 1-8. The edge mapping is table-driven (`PRIORITY_END`, `AXIS_EDGES`), so there is no per-axis branching to get wrong. `mapEdges` and `mapGrain` are exported pure helpers with their own tests.
- Constants match the spec table mechanically, with doc comments.
- The schema is structural only and defers ranges to `validateFurniture`. Recursion uses getters, and `entityId` reuses `isEntityId`.
- `migrateFurniture` has the same shape as `migratePlan`, with a real step-loop and registry.
- Tests are behavioural: the 07 §1.2 examples, the §12.2 fixture, rejections, v1/v2 migration. The mutation check killed 17 of 23 mutants.

### Issues

#### Critical
None.

#### Important
None.

#### Minor
1. `parts.test.ts` (banding and sizes): the surviving mutants above are test gaps (6 mutants in 5 groups). The code itself is correct.
   - Add a case with fractional `sb` and `box.size` 1.9999999, asserted through `makePart` (kills the `fl` and `Math.round` mutants).
   - Band `['bottom']` alone and `['right']` alone, to cover W2 and L2 in isolation.
   - Add a banded part with role `front` or `back` and a distinct `edgeBandCode`.
   - Add a case where `spec.materialCode` differs from `doc.materials[role]`.
2. `partNames.ts:54-62`: `PART_NAMES_EN[nameKey]` on a plain object. A key such as `'constructor'` or `'toString'` resolves to an inherited function, so `template.replace` throws instead of returning the key unchanged. Not reachable from generated keys. Use `Object.hasOwn(PART_NAMES_EN, nameKey)`.
3. `partNames.ts:61`: `.replace(/\s+/g, ' ').trim()` also normalises whitespace inside a user-supplied `parts.extra` name ("A  B" becomes "A B"). Collapse only around missing params, or skip the collapse for `{name}`.
4. `parts.ts:112-120`: `...spec.operations` spreads after the zero defaults. An explicit `{ hingeCups: undefined }` would overwrite the 0 with `undefined`. This is only possible when `exactOptionalPropertyTypes` is off, and the tsconfig does not enable it. Filter undefined, or accept it.
5. `parts.ts:108`: an explicit `spec.geometry` is stored by reference, while the default geometry is deep-copied. Harmless now; it could alias if a generator mutates it later.

### Assessment
**Task quality:** Approved

**Reasoning:** Schema, 55 constants, 38 part names, 19 template keys, migrate and makePart rules 1-8 all match the spec; the mechanical comparisons and the 23-mutant check found no code defects. Remaining items are test-coverage gaps and edge-case polish.
