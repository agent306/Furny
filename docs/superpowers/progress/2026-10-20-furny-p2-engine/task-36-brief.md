### Task 36: `generateFurniture` orchestration, carcass hardware, overrides

**Files:**
- Create: `resources/js/engine/furniture/generate.ts`, `resources/js/engine/furniture/rules/connectors.ts`, `resources/js/engine/furniture/rules/carcassHardware.ts` (legs, mounting, screws), `resources/js/engine/furniture/overrides.ts`, `resources/js/engine/furniture/codes.ts`
- Test: `resources/js/engine/furniture/__tests__/generate.wardrobe.test.ts`, `overrides.test.ts`, `catalogDrift.test.ts`, `carcassHardware.test.ts`

**Spec refs:** `07 §3.1`, `§3.14`, `§6.1` (weight estimate), `§6.6`, `§6.8–§6.9`, `§12.2` (complete expected tables), `§12.4` (cabinet legs)

**Interfaces:**
- Consumes: Tasks 29–35.
- Produces: `generateFurniture(doc: FurnitureDocument, catalog: CatalogSnapshot): FurnitureModel` (public); `referencedCodes(doc): Array<{ code; kind: 'material'|'edge_band'|'finish'|'hardware' }>`, `codeIssues(doc, idx): Issue[]`; `connectorsForJoints(ctx, family: 'carcass'|'table')`; `cabinetLegs(ctx, env)`, `mountingHardware(ctx, env)`, `screwPacks(ctx, prefix)`; `applyOverrides(ctx): void`.

- [ ] **Step 1: Write the failing tests**
  - `generate.wardrobe.test.ts` — wardrobe fixture + seed catalog → exactly the 20 parts of the 07 §12.2 table (key, material, T, L, W, L1/L2/W1/W2 per row; all `qty 1`, all grain `'none'`), sorted by key; `fronts` exactly the three rects; hardware lines exactly the 14-row table (key, code, qty); operations: `hingeCups` 4 per leaf, `shelfPinHoles` 116 on `carcass.side.left` and on the partition, `handleHoles` 2 per leaf, `camLocks` 16 / `dowels` 16 summed over members, `slideScrewSets` 0; issues **exactly** `[info furniture.back_split {count:2}, info furniture.anti_tip_added, info furniture.weight_estimate {kg:144.4}]` (order-insensitive); `bbox = { min: [0,0,0], size: [1800,2100,600] }`; `sections` = leaf boxes in pre-order; calling twice yields deep-equal output (determinism).
  - `carcassHardware.test.ts` — cabinet legs (07 §12.4): `Wc 600 → 4`, `900 → 6`, `1800 → 8` legs; code `LEG-PLINTH-100` when setback > 0, `LEG-CAB-ADJ` when 0; plinth height 90 with `LEG-PLINTH-100` (95–150) → `leg_height_mismatch`; wall mounting 1800 wide → `BRK-WALL-HANG × 4`; floor `H 1499` → no anti-tip; screw packs `max(1, ceil(31/30)) = 2` for 31 generated parts.
  - `overrides.test.ts` — `removed` drops the part and its model front; `materialCode 'PB18-OAK'` changes material and thickness, marks `overridden`; `edges { W2: 'EB20-WHITE' }`; `lengthDelta −10` shrinks length and the box; result ≤ 0 → error `override_invalid` and size kept; override on a missing key → dropped + info `override_orphaned { key }`; hardware `qtyDelta −4` on a 4-qty line drops it, `code` replaces; extra part `p_…` → `extra.p_…`, nameKey `parts.extra`, `visibleFaces 2` for role front, zero-size box when `placement null`; extra hardware → `extra.h_…`, reason `hardware.reason.extra`.
  - `catalogDrift.test.ts` (**review focus 3**) — catalog with `PB18-WHITE.isActive = false` → warning `furniture.archived_code { code: 'PB18-WHITE' }`, parts unchanged; catalog with the `HNG-FO-SC` row deleted (the wardrobe references hinges only through `hingeCode: 'auto'`) → warning `no_default_hardware { roleKey: 'hinge.full_overlay' }` and the full-overlay hinge lines omitted; document with `materials.front.materialCode = 'GONE-01'` → error `furniture.unknown_code { code: 'GONE-01', kind: 'material' }` and leaves still generated with `PB18-WHITE`; none of these throw.
- [ ] **Step 2: Run it, expect FAIL** — `yarn vitest run resources/js/engine/furniture/__tests__`
- [ ] **Step 3: Implement** — pipeline order of 07 §3.1 steps 1–8 (step 6 model-level validation is added in Task 37; leave a hook `modelRules(ctx)` that is a no-op here); joints → cams/dowels `max(2, ceil(length / 320))` on the member part; screw packs from the generated `Σ qty` before overrides; weight estimate `Math.round(kg × 10) / 10`; overrides order of §3.14.
- [ ] **Step 4: Run tests, expect PASS** — `yarn vitest run resources/js/engine/furniture`
- [ ] **Step 5: Quality gates** — `yarn eslint resources/js/engine && yarn prettier --check resources/js/engine && yarn vue-tsc --noEmit`
- [ ] **Step 6: Commit** — `git add resources/js/engine/furniture resources/js/engine/index.ts` → `feat(engine): orchestrate furniture generation with carcass hardware and overrides`

