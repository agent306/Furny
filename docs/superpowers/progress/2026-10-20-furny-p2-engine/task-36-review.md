# Task 36 review: `generateFurniture`, carcass hardware, overrides, code checks (ae4c489..ed982fa)

### Spec Compliance

- ✅ **Spec compliant.** I checked 07 §3.1, §3.14, §6.1, §6.6, §6.8, §6.9, §7.3 (issue rows), §12.2 and §12.4 against the diff, and the brief's file list.
  - **Brief file list:** every listed file is in the diff:
    - `generate.ts`, `rules/connectors.ts`, `rules/carcassHardware.ts`, `overrides.ts`, `codes.ts`;
    - the four test files.
  - **Brief interfaces:** all are present with the stated signatures:
    - `generateFurniture` (exported from `index.ts`), `referencedCodes`, `codeIssues`;
    - `connectorsForJoints(ctx, family)`, `cabinetLegs(ctx, env)`, `mountingHardware(ctx, env)`, `screwPacks(ctx, prefix)`, `applyOverrides(ctx)`.
  - **Controller rulings:** not re-flagged. That covers the spec-text revert, the envelope-null `override_orphaned` noise, and the five accepted interpretations.
- ⚠️ **Cannot verify from the diff (later tasks / outside this spec):**
  - **Task 38: `connectorsForJoints(ctx, 'table')` can duplicate keys** (`rules/connectors.ts:42-59`).
    - It always pushes new `table.connectors.cam` and `table.connectors.dowel` lines.
    - §6.9 says table cabinet and panel-end joints "add to" the `table.connectors.*` lines of §3.13. §3.13 already emits a `table.connectors.dowel` line for aprons and stretchers.
    - Called as is, the table generator would get two lines with one key. `applyHardwareOverride` (`find`) and the diff key on that key.
    - Task 38 should merge into the existing line, or `connectorsForJoints` should add to an existing key.
  - **Edge bands that come only from the catalog are never code-checked.**
    - Bands resolved from `material.defaultEdgeBandCode` (`context.ts:73`) are not referenced by the document, so §3.1 step 2 does not check them. That matches the letter of the spec.
    - In scratch, archiving or deleting `EB08-WHITE` with the wardrobe gives no issue at all. With the row deleted, the parts still carry `EB08-WHITE` edges that the catalog no longer has.
    - Nothing throws. The controller should decide whether 08 pricing or a Task 37 rule should report it.

### Strengths

- **§3.1 order is followed exactly** (`generate.ts:79-152`):
  - code check, then envelope (early return), panels, layout, dividers, fronts, leaf contents in pre-order, back, plinth, countertop;
  - then legs, mounting, connectors, screws, overrides, weight, the `modelRules` hook, sort and bbox.
  - **Sections:** `ctx.sections` has a single writer, `layout.ts:173`, and `layoutFromEnvelope` is called once in the pipeline (`generate.ts:85`; the only other callers are `layoutSections` with its own ctx and the test driver). Sections are not pushed twice.
  - **Determinism:**
    - Parts and hardware are sorted with `cmpId` (plain code-unit `<`, `compare.ts:2`).
    - The override keys are iterated through `sortedKeys` (cmpId).
    - The only Map and Set are lookups, never iterated for output (`connectors.ts` `byKey`, `codes.ts` `seen`).
    - In scratch, two calls on six documents (wardrobe, §12.3 drawer box, inset, half overlay, sliding wardrobe, countertop box) gave deep-equal and JSON-identical models.
- **The §12.2 golden is exact, not a subset** (`generate.wardrobe.test.ts`):
  - **Parts:** all 20 parts × 9 columns, by `toEqual` on the projected rows, in sorted order. Each part is also checked for `qty 1`, `grain 'none'`, `source 'generated'` and `overridden false`.
  - **Fronts:** the three fronts by `toEqual` on the full objects.
  - **Hardware:** the 14 hardware rows by `toEqual` on `[key, code, qty]`.
  - **Issues:** by `toEqual` on the sorted `{code, severity, params}` list, so a stray warning would fail. They are order-insensitive, as the brief says.
  - **Bbox and sections:** by `toEqual`.
  - **Operations:**
    - each leaf is checked, with the sums 12 and 6;
    - `shelfPinHoles` 116 + 116, with the sum 232 pinning every other part to 0;
    - cams and dowels are 4 on each of the four members, with the sum 16;
    - `slideScrewSets` sum 0.
  - I checked every value mechanically against the 07 §12.2 tables; they all match.
- **§6.9 connectors are right.**
  - `max(2, ceil(len/320))` gives the cams, with the dowels equal.
  - The operations go on the member only (`connectors.ts:30-38`).
  - The joint sources match the §6.9 joint list:
    - `panels.ts:84-89`: top and bottom × the sides;
    - `layout.ts` `recordEndJoints`: partitions and fixed shelves, deduplicated on member+other;
    - `contents.ts:181`: non-adjustable loose shelves only.
  - Plinths, backs, countertops and drawer boxes record no joints. The only consumer is a single call in `generateCarcass`, so nothing is counted twice.
  - The wardrobe has 8 joints and gives 16, and the §12.3 box gives 8.
- **§6.6 / §6.8 / §6.9 boundaries are pinned by tests:**
  - **Legs:** Wc 600/800/801/900/1600/1800 give 4/4/6/6/6/8 legs. The code follows the setback (PLINTH vs CAB), and an explicit `legCode` wins.
  - **Leg height:** a range check at 94/95/150/151, and `heightMm ± adjustableMm` at 694/695/725/726.
  - **Wall brackets:** 400/1000/1001/1800 wide, for wall and loft units.
  - **Anti-tip:** 1499 adds none and 1500 adds one. `anti_tip_added` is raised only when the kit line exists.
  - **Screw packs:** 0/1/30/31/60/61 parts. They count Σ qty rather than rows, and are counted before the overrides (an extra part with qty 99 leaves 1 pack).
- **§3.14 overrides** (`overrides.ts`) follow the spec item by item:
  - removed parts drop their model front and their edgeMap entry;
  - the material sets the thickness and leaves the geometry;
  - edges are replaced per edge, and `null` clears a band;
  - deltas move the box along the axes from `edgeMap` (W1 at the ends of the length axis, which is correct per `parts.ts:43-51`);
  - `override_invalid` keeps the size at exactly 0;
  - grain and `overridden` are set;
  - hardware overrides apply code, `qtyDelta`, removal, and drop the line at qty ≤ 0;
  - extra parts and extra hardware have exactly the §3.14 shape, and the tests check the full objects.
- **Catalog drift never throws.** I ran these scratch cases:
  - **Default slide unflagged, and every `drawer_slide` row deleted:** `no_default_hardware {slide.side_mount}`, boxes built, no slide lines.
  - **Explicit `SLD-BB-500` deleted:** `unknown_code` plus a fallback to the family default (`SLD-BB-450`).
  - **`EB08-WHITE` archived or deleted:** silent (see the second ⚠️). An explicit `edgeBandCode` that is archived gives a single `archived_code`.
  - **`GLASS5-CLEAR` deleted or archived with a glass door:** error `no_glass_material`, the leaf is generated, no throw.
  - **Unknown back and shelf materials, legCode, hinge, handle, override material and edge, hardware-override code, and extra-part and extra-hardware codes:** 10 `unknown_code` errors, each once, and a full model.
  - **`PB18-WHITE` row deleted:** `unknown_code`, and every role falls back to `PB18-OAK`.
- **The Task 35 minors are closed, and their mutants are now killed:**
  - the front-height error for `'equal'`;
  - `slideScrewSets` only `if (slide)`;
  - the invariant throw replaced by `return`;
  - `drawerFrontRects` ignoring `style`.
  - The `drawersFor` split into `boxSizes` / `drawerBox` / `externalDrawerFront` keeps the guard order and the issue order. The old `canBuild && Hb < 60` is now an early return followed by the Hb check, which is equivalent.
- The shared catalog helpers in `testing/catalogs.ts` remove five duplicated mutation blocks.

### Mutation checks (scratch copy outside the worktree; deleted)

- **Killed (44):**
  - **Connectors:**
    - min 2 → 1;
    - ops on `other`.
  - **Anti-tip:**
    - `<` → `<=`;
    - the info raised even without a kit.
  - **Legs:**
    - `+1` dropped;
    - roles swapped;
    - range `>=` → `>`;
    - adjustable `<=` → `<`.
  - **Screw packs:**
    - min 1 → 0;
    - rows instead of qty;
    - computed after the overrides.
  - **Wall brackets:** no loft.
  - **Overrides:**
    - `override_invalid` `<=` → `<`;
    - axes swapped;
    - box not resized;
    - fronts not filtered;
    - hardware qty `<= 0` → `< 0`;
    - `removed` ignored;
    - `overridden` not set, for hardware and for parts;
    - `null` edges skipped;
    - leg faces 0;
    - extra-part thickness 0;
    - unrounded thickness.
  - **Weight:**
    - estimated before the overrides;
    - `roundKg` floor.
  - **Codes:**
    - no dedupe;
    - `'auto'` treated as a code;
    - severity swapped;
    - skip each of: override hardware codes, extra-part edges, content codes, tracks;
    - code issues not pushed.
  - **Orphan info:** silenced, for parts and for hardware.
  - **Extra reason key:** changed.
  - **Task 35 regressions:** the 4 mutants listed above.
- **Survived:** listed under Minor 1, plus one equivalent mutant (deduplicating `codes.ts` by code only, ignoring kind).

### Issues

#### Critical (Must Fix)

None.

#### Important (Should Fix)

None.

#### Minor (Nice to Have)

1. **Test gaps: these mutants survive all 641 furniture tests.**
   - **§3.14 override order is not pinned** (`overrides.ts:202-212`).
     - Pushing the extra parts before the part overrides (or the extra hardware before the hardware overrides) passes. In that order an override keyed `extra.p_…` / `extra.h_…` would apply instead of being `override_orphaned`.
     - Fix: add one test per pair.
   - **Unknown override material falls back to the role default** (`overrides.ts:48`). The controller accepted this behaviour, but removing the `?? defaultMaterialFor(role)` passes. Pin it with an override of `materialCode: 'GONE'` on a part and on an extra part.
   - **Front tie-break by `-rect.y`** (`generate.ts:113-114`): `a.y - b.y` passes. No test generates stacked drawer fronts through `generateFurniture` and asserts their order. Assert the §12.3 box fronts at y = 480 / 241 / 1.
   - **The spec's dimension variables are not pinned:**
     - `env.Wc` → `dims.width` passes for legs (`carcassHardware.ts:49`) and for wall brackets (`:86`).
     - `dims.height` → `env.Hc` passes for anti-tip (`:93`).
     - Every fixture has `W = Wc` and the anti-tip boxes have no plinth.
     - Add a legs case with a side countertop overhang, and a 1500 high floor unit with a plinth (H 1500, Hc 1400 → kit).
   - **Connectors and screws before the overrides:** moving `connectorsForJoints` after `applyOverrides` passes. Removing a joint member (e.g. `carcass.top`) should keep 16 cams.
   - **Sections in pre-order** (`generate.ts:146`): sorting by id passes, because the wardrobe's pre-order equals its id order. That is low value, since ids come from `testIds` in pre-order.
   - **`legFitsHeight` with neither a range nor `heightMm` returns `true`** (`carcassHardware.ts:34`).
     - The §6.6 formula `|specs.heightMm − h| ≤ adj` would evaluate to false (a mismatch) with `heightMm` missing.
     - The docstring states the choice, but no test pins it.
     - It is defensible, but it is a reading of the spec: confirm it or test it.
2. **The `HNG-FO-SC` drift test asserts `missing.length > 0`** (`catalogDrift.test.ts:61`) rather than exactly the two `hinge.full_overlay` warnings. `hinged.test.ts` pins two at the front level, but the generate-level test would not catch a duplicate warning. Use `toEqual` on the params list.
3. **Removing one frame part of a glass door drops the whole model front** (`overrides.ts:120` with `fronts/leaf.ts:177`).
   - A glass leaf's `partKey` is its left stile.
   - Removing only `….stile.left` drops the model front while the glass, rails and right stile remain.
   - Removing the glass or any other frame part leaves the front in place.
   - §3.14 says the fronts entry goes "when the key is a leaf/drawer front", which a stile is not. Either match the front by its leaf prefix (`front.{F}.leaf.{k}`), or only drop the front when every one of its parts is removed.
4. **`drawersFor` recomputes `computeOpenings` for every external-drawer leaf** (`drawers.ts:576`, after `frontParts` already computed it). It is pure, so no issues are duplicated (checked: `computeOpenings` pushes nothing to `ctx`). It is only redundant work against the §3.1 15 ms budget, and could be passed in.

### Assessment

**Task quality:** Approved

**Reasoning:**
- **Pipeline and golden:** the pipeline follows §3.1 steps 1-8 with one `ctx.sections` writer and sorted, cmpId-keyed output. The §12.2 golden is asserted exactly on every table.
- **Hardware rules:** connectors, legs, mounting and screw packs match §6.6-§6.9 at every boundary.
- **Overrides and drift:** overrides follow §3.14, and no drift case throws (deleted default slide, archived or deleted edge band, deleted glass, unknown codes everywhere, deleted `PB18-WHITE`).
- **What remains:** the open items are test gaps for orderings and spec variables that the code already gets right, plus one edge case in glass-door removal.
