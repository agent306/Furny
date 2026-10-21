# Task 36 report: `generateFurniture`, carcass hardware, overrides, code checks

**Status:** DONE_WITH_CONCERNS (minor; see Concerns)
**Commit:** `ed982fa` feat(engine): orchestrate furniture generation with carcass hardware and overrides (pushed to `origin/build/p2-engine`)

## What I implemented

- **`furniture/generate.ts`**: `generateFurniture(doc, catalog)` follows the 07 §3.1 steps in order.
  1. It indexes the catalog and creates the context.
  2. It pushes `codeIssues`. An unknown material falls back to `defaultMaterialFor(role)` through the existing `ctx.mat` and `makePart`.
  3. For the carcass family it runs:
     - envelope (stops there when it is null), panels, `layoutFromEnvelope` (which fills `ctx.sections`; sections are not pushed again) and `dividerParts`;
     - `frontParts`, then leaf contents in pre-order (shelves, rod, baskets, drawers);
     - back, plinth, countertop;
     - `cabinetLegs`, `mountingHardware`, `connectorsForJoints('carcass')` and `screwPacks('carcass')`.
  4. The table family is a comment placeholder for Task 38.
  5. It applies `applyOverrides`.
  6. It adds `weight_estimate` (`roundKg(Σ weight × qty)`, after the overrides), then calls `modelRules(ctx)`, a no-op hook for Task 37.
  7. It sorts parts and hardware by key with `cmpId`, and fronts by `x`, then `-y`, then id. Sections keep pre-order. `bbox` is `[0,0,0] / [W,H,D]`.
  - A family whose spec is null (family mismatch) generates nothing and does not throw.
- **`furniture/codes.ts`**:
  - `referencedCodes(doc)` returns `{ code, kind }` deduplicated by kind and code, in document order:
    - materials by role, with material, edge band and finish per role;
    - carcass legCode, handles, each front's handle, hinge and track codes, then section contents in pre-order;
    - table legCode, drawer slide and end-cabinet content;
    - overrides: part overrides by sorted key (material, edges), extra parts, hardware overrides by sorted key, extra hardware.
    - `'inherit'`, `'auto'` and null are skipped.
  - `codeIssues(doc, idx)` is pure. It gives error `unknown_code { code, kind }` and warning `archived_code { code }`, both with `entityIds []`.
- **`rules/connectors.ts`**: `connectorsForJoints(ctx, family)`.
  - Each joint gets `max(2, ceil(length / 320))` cams and the same number of dowels.
  - `camLocks` and `dowels` are added on the member part.
  - Lines are `{family}.connectors.cam` and `.dowel`, with reasons `cam_locks` / `dowels` `{ joints }`. There are no lines when there are no joints.
- **`rules/carcassHardware.ts`**:
  - **`cabinetLegs(ctx, env)`** applies to floor units with `plinth.type 'legs'`.
    - It adds `plinth.legs`, quantity `2 × max(2, ceil(Wc / 800) + 1)`.
    - The code is `legCode`, else `leg.plinth` when setback > 0, else `leg.cabinet`.
    - The reason is `plinth_legs` or `cabinet_legs`.
    - It warns `leg_height_mismatch { code }` (entity `plinth.legs`). With a min/max range in the specs it checks the range; otherwise it checks `heightMm ± adjustableMm`.
  - **`mountingHardware(ctx, env)`**:
    - Wall and loft units get `carcass.wall_brackets` × `2 × max(1, ceil(Wc / 1000))`.
    - Floor units with `H ≥ 1500` get `carcass.anti_tip` × 1 plus info `anti_tip_added`. The info is raised only when the line was actually added.
  - **`screwPacks(ctx, prefix)`** gives `max(1, ceil(Σ qty / 30))`, counted before the overrides.
- **`overrides.ts`**: `applyOverrides(ctx)` follows the §3.14 order.
  - **Part overrides**, by sorted key:
    - An orphaned key raises info `override_orphaned { key }`.
    - `removed` drops the part, its model front (matched by `partKey`) and its edgeMap entry.
    - `materialCode` sets the material and its thickness. An unknown code falls back to the role default.
    - `edges` are replaced per edge.
    - `lengthDelta` / `widthDelta` change the size, and the box grows from its min corner along the axes recorded in `ctx.edgeMap`: W1 marks the length axis, L1 the width axis.
    - A result ≤ 0 raises error `override_invalid { key }` and keeps the size.
    - `grain` is applied.
    - `overridden = true`.
  - **Hardware overrides**: an orphaned key raises info. `code` and `qtyDelta` are applied, then the line is dropped when it is `removed` or its qty ≤ 0.
  - **Extra parts**: key `extra.{id}`, nameKey `parts.extra` with `{ name }`. Visible faces are 2 for front, 1 for carcass, top, plinth and leg, otherwise 0. A null placement gives a zero-size box.
  - **Extra hardware**: key `extra.{id}`, reason `hardware.reason.extra`.
- **`index.ts`** exports `generateFurniture`, `referencedCodes`, `codeIssues`, `CodeRef` and `CodeKind`.

## Golden tables (07 §12.2)

All values matched on the first GREEN run: 20 parts, 3 fronts, 14 hardware lines, the operations, the 3 issues, the bbox, the sections and determinism. **No earlier-generator bugs were found**, and none of the Task 30–35 generators changed for the golden values.

## Task 35 review minors

1. **`leafOpening` fallback: removed.** `drawersFor` now throws an invariant `Error` when `computeOpenings` has no opening for an external drawer leaf. That cannot happen for a carcass document.
   - A test pins the throw, for a document without a carcass.
   - **Note for Task 38:** table external drawers must supply their own opening. The current `drawersFor` reads it from `computeOpenings`.
2. **`drawersFor` split, no behaviour change.**
   - `boxSizes` covers the box table and the `drawer_side_too_thick` warning.
   - `drawerBox` builds one drawer: box parts, inner front, slides and screws.
   - `externalDrawerFront` builds the front leaf, the model front and the handle.
   - A `LeafBoxes` record carries the shared geometry. The order of issues and parts is unchanged; all 82 earlier drawer tests are green.
3. **`sectionRef(sectionId)` → `{ params, entityIds }`** replaces the three ternaries.
4. **Single overlay source.** `drawerFrontRects(ctx, opening, content, style, sectionId?)` takes the style, and `drawersFor` passes `env.drawerStyle`. This is a public signature change; both test call sites were updated.
5. **Tests and dead guards.**
   - New test: 10 equal fronts of 69.9 mm raise no `drawer_heights_invalid` and 10 × `drawer_too_low`.
   - New assertion: `slideScrewSets` is 3 on both sides with no default slide.
   - Dead guards removed: `Ls > 0 &&` (with a comment explaining why) and `content.count < 1`.
6. **`hinged.ts` `leaves < 1`.** The only text for this issue lives in 07 §7.3, so I changed it there to "A hinged door needs 1 or 2 leaves; split wider doors per column."
   - The path stays, with a defence-in-depth comment, and the docstring is corrected.
   - **This is a spec edit**; the controller should confirm it.
7. **Shared catalog helpers** in `furniture/testing/catalogs.ts`: `withoutDefault(roleKey)`, `archived(codes)` and `withoutHardware(codes)`.
   - Used in `drawers.test.ts` (3 + 2 copies removed), `common.test.ts` (2), `hinged.test.ts` (1) and the new tests.
   - Mutations that are one-of-a-kind (densities, specs) stay inline.

## TDD evidence

- **RED:** `yarn vitest run resources/js/engine/furniture/__tests__` gave `Test Files 4 failed | 6 passed (10)`.
  - Each new file failed with `Cannot find module '../generate'` (or `'../codes'`).
  - This was expected because the modules did not exist yet.
- **GREEN, new tests:** `yarn vitest run resources/js/engine/furniture/__tests__` gave `Test Files 10 passed (10), Tests 189 passed (189)`.
- **GREEN, final full run:** `yarn vitest run resources/js/engine` gave `Test Files 81 passed (81), Tests 2797 passed (2797)`. That run predates the last added test (the no-opening throw); after it, the furniture run gave `24 files, 641 passed`. Output is pristine: no stderr or warnings.
- **Quality gates:** `yarn eslint resources/js/engine`, `yarn prettier --check resources/js/engine` and `yarn vue-tsc --noEmit` all exit 0.

## Tests added

- **`generate.wardrobe.test.ts` (13 tests):**
  - the full §12.2 tables;
  - reasons on the carcass lines;
  - per-member cams;
  - exact issue set and `messageKey`;
  - bbox and sections;
  - determinism and no mutation.
- **`carcassHardware.test.ts`:**
  - legs at Wc 600/800/801/900/1600/1800;
  - leg code by setback and an explicit legCode;
  - height mismatch at 90 and at the 94/95/150/151 boundaries;
  - fixed-height leg ±15;
  - no legs for plinth, none or wall;
  - no default leg;
  - wall and loft brackets at 400/1000/1001/1800;
  - anti-tip at 1499/1500, and no info without a default;
  - screw packs at 0/1/30/31/60/61 and the Σ qty count;
  - cams at 1/640/641/960/961 with the member-only operations;
  - table prefix;
  - the §12.3 box: 8 cams and dowels, no anti-tip.
- **`overrides.test.ts`:**
  - removal of a front and of a non-front part;
  - material and thickness (PB18-OAK, PB25-WHITE);
  - edges;
  - deltas on the side and the top along the correct axes;
  - `override_invalid` (sorted) with the size kept;
  - grain, and a note alone;
  - orphaned part and orphaned hardware;
  - weight after a removal (130.3);
  - hardware qtyDelta to 0, code + delta, removal;
  - extra part, full object;
  - visible faces per role;
  - placement;
  - sort position;
  - screw packs counted before the overrides;
  - extra hardware.
- **`catalogDrift.test.ts`:**
  - archived PB18-WHITE gives one warning and identical parts and hardware;
  - deleted HNG-FO-SC gives `no_default_hardware { hinge.full_overlay }`, no FO lines, the shared HO-SC lines kept and no `unknown_code`;
  - GONE-01 as the front material gives an `unknown_code` error, leaves in PB18-WHITE, identical parts and weight;
  - unknown edge band, finish and hardware plus an archived finish;
  - a null spec does not throw;
  - `referencedCodes` for the wardrobe, a full carcass document, the placeholders and a table spec;
  - `codeIssues` deduplication and the wrong-kind case.

## Files

- **New:**
  - `resources/js/engine/furniture/{generate,codes,overrides}.ts`
  - `furniture/rules/{connectors,carcassHardware}.ts`
  - `furniture/testing/catalogs.ts`
  - the four test files under `furniture/__tests__/`
- **Changed:**
  - `furniture/carcass/drawers.ts`
  - `furniture/fronts/hinged.ts`
  - `furniture/carcass/__tests__/drawers.test.ts`
  - `furniture/fronts/__tests__/hinged.test.ts`
  - `furniture/templates/__tests__/common.test.ts`
  - `resources/js/engine/index.ts`
  - `docs/superpowers/specs/2026-10-20-furny/07-furniture-system.md` (§7.3 text)

## Concerns / decisions for the controller

1. **Spec text edit** (07 §7.3 `hinged_leaves_unsupported`), as described in minor 6.
2. **`drawersFor` has an invariant throw** for a missing external-drawer opening. It is unreachable for carcass documents and pinned by a test, but Task 38 must not route table drawers through it unchanged.
3. **Overrides run even when the envelope is too small.** Every part override then reports `override_orphaned`. That follows the §3.1 order, but it may be noisy for staff while a design is temporarily invalid.
4. **Small interpretations:**
   - `leg_height_mismatch` and `override_*` use the hardware or part key as the entity.
   - `archived_code` and `unknown_code` have `entityIds []`, and each kind+code pair is reported once.
   - An unknown material in a part override or extra part falls back to `defaultMaterialFor(role)`, following the §3.1 step 2 rule.
   - Length/width overrides do not re-swap length and width if the width ends up longer.
5. **`weight_estimate` is emitted in `generate.ts`, just before the Task 37 `modelRules` hook,** because the golden issue list needs it now.

## Fix round 1 (commit `f9e5b77`, pushed)

### Controller items

1. **The spec edit is reverted.** `07-furniture-system.md` is identical to `ae4c489` again; `git diff ae4c489 HEAD -- docs` is empty. The `hinged.ts` docstring now says the English text belongs to Task 51.
2. **Orphan reporting with no envelope: chose to emit nothing.**
   - `applyOverrides(ctx, { reportOrphans })` gets `reportOrphans: false` when no model was generated: envelope too small, or a carcass family with no carcass spec.
   - The overrides still run: extras are added, and nothing else matches.
   - Test: `overrides.test.ts` "reports no orphaned overrides when the envelope is too small, but still adds the extras".

### Review minors

3. **New tests**, each checked against its mutant (14 mutants, all killed):
   - **Extras order:** an override on an `extra.p_*` key and on an `extra.h_*` key is orphaned and not applied.
   - **Unknown override material:** carcass is PB18-OAK and the side override is `GONE`, giving PB18-WHITE. An extra part with `GONE` gives PB18-WHITE, thickness 18.
   - **Stacked fronts:** the §12.3 drawer fronts through `generateFurniture` come out at y = 480, 241, 1.
   - **Dimensions:**
     - legs: W 900 with a 100 mm overhang (Wc 800) gives 4 legs;
     - wall brackets: W 1100 with a 100 mm overhang (Wc 1000) gives 2 brackets;
     - anti-tip: H 1500 on a 100 mm plinth (Hc 1400) still gets the kit.
   - **Connectors before overrides:** a hardware override on `carcass.connectors.cam` (+2) gives 18 and is not orphaned, even with `carcass.top` removed. The original "remove top, still 16" test did not kill this mutant, so I replaced it.
   - **Sections:** columns with ids `s3`, `s2` come out as `[s3, s2]`.
   - **`legFitsHeight`:** a leg with neither a range nor `heightMm` now counts as **not fitting**, which raises `leg_height_mismatch`. This is the conservative reading. It has a unit test and a generate test, using `LEG-CAB-ADJ` with empty specs.
4. **`HNG-FO-SC` drift:** the test now uses `toEqual` on exactly two warnings, `{ roleKey: 'hinge.full_overlay' }`, with entities `front.fr_…1.hinges` and `front.fr_…2.hinges`.
5. **Glass model fronts.** When a front's `partKey` part is removed:
   - the front stays while any of its parts remain, a part belonging to it being the key `front.id` or one starting with `front.id + '.'`;
   - `partKey` moves to the first remaining part by `cmpId`;
   - the front is dropped only when every part is gone.
   - Tests cover: the left stile removed (partKey becomes `….glass`), a rail removed (partKey unchanged), and all 5 parts removed (front dropped).
6. **`openingsOf(ctx, env, layout)`** in `fronts/openings.ts` memoises `computeOpenings` in a `WeakMap` keyed by `GenContext`, and is re-validated when the document, envelope or layout object changes.
   - `frontParts` and `drawersFor` both use it.
   - Tests check that the same instance comes back, and that a new layout, a new envelope or a new document triggers a recompute.

### Test evidence

- `yarn vitest run resources/js/engine`: `Test Files 81 passed (81), Tests 2815 passed (2815)`. Output is pristine.
- `yarn eslint resources/js/engine`, `yarn prettier --check resources/js/engine` and `yarn vue-tsc --noEmit` all exit 0.
- **Mutation check** (scratch script, now deleted): all 14 killed:
  - extras first;
  - no material fallback;
  - fronts sorted by y ascending;
  - legs using W, brackets using W, anti-tip using Hc;
  - connectors after the overrides;
  - sections sorted by id;
  - nothing-to-check leg treated as fitting;
  - orphans always reported;
  - the old glass front filter;
  - glass partKey kept;
  - memo without the doc check, memo without the env check.
