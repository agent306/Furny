### Task 43: Guillotine nesting

**Files:**
- Create: `resources/js/engine/bom/nesting/guillotine.ts`, `resources/js/engine/bom/nesting/index.ts`
- Modify: `resources/js/engine/bom/bom.ts` (nesting branch, `sheetsNested`, `utilization`, `bom.part_exceeds_sheet`)
- Test: `resources/js/engine/bom/__tests__/guillotine.test.ts`, `nestSheets.test.ts`, `bom.nesting.test.ts`

**Spec refs:** `08 §5.1–§5.4` (§5.3 reference implementation is **normative code** — copy it), `08 §3.5`, `§3.9`, `§10.2` (nesting), `§10.4`

**Interfaces:**
- Consumes: Task 42.
- Produces: `NestRotation, NestItem, NestSheetSpec, NestOptions, NestPlacement, NestCut, NestedSheet, NestMaterialResult, NEST_PASSES, nestMaterial(items, spec, opts)`; `nestSheets(rows, partQty: Map<PartKey, number>, catalog, options: { kerf; trim; allowRotation }): NestingResult`; `BOM_ISSUE_CODES = ['bom.part_exceeds_sheet']`.

- [ ] **Step 1: Write the failing tests** — 08 §10.4 table: **A** 1000 × 500 / kerf 4 / trim 0, items a 600 × 300, b 396 × 300, c 1000 × 196 (free) → 1 sheet, util 0.9896, c (0,0), a (0,200), b (604,200), cuts `[{x1:0,y1:196,x2:1000,y2:196},{x1:600,y1:200,x2:600,y2:500}]`; **B** 1000 × 800 / 4 / 10, a 700 × 400 `length_along_sheet`, b 700 × 400 `width_along_sheet` → 2 sheets util 0.35, a (10,10) unrotated, b (10,10) rotated; **C** 2440 × 1220 / 4 / 10, big 2500 × 500 → 0 sheets, `unplaced ['big']`; **D** four 1208 × 598 → 1 sheet util 0.9707 at (10,10), (10,612), (1222,10), (1222,612); **D′** three 1208 × 598 + one 1209 × 598 → 2 sheets. Property tests (`mulberry32(99)`, 50 random sets of 1–300 parts): placements inside the usable area; overlapping-in-projection placements ≥ kerf apart; every instance placed exactly once or listed in `unplaced`; grain-locked items never in the forbidden orientation; identical input → deep-equal output across 3 runs. Wardrobe with nesting (kerf 4, trim 10, rotation allowed) — exact placements (`x, y, rotated`) of 08 §10.2: PB sheet 1 (util 0.7803) side.left (10,10), side.right (10,595); sheet 2 (0.8009) `front.fr_0000000001.leaf.1` (10,10), `front.fr_0000000002.leaf.1` (10,618); sheet 3 (0.7708) `front.fr_0000000002.leaf.2` (10,10), partition (10,605); sheet 4 (0.6073) plinth.back (10,10), plinth.front (10,114), carcass.bottom (10,218), shelf.1 (1778,218), plinth.return.1 (1814,10), plinth.return.2 (1812,114); sheet 5 (0.9044) carcass.top (10,10), fixed_shelf.1 (1778,10, rotated), shelf.2 (10,595, rotated), shelf.3 (562,595, rotated), shelf.4 (1114,595, rotated), plinth.return.3 (1666,595, rotated); HDF sheet 1 (0.7841) back.2 (10,10); HDF sheet 2 (0.3974) back.1 (10,10); materials HDF3 `sheetsNested 2, utilization 0.5907`, PB18 `sheetsNested 5, utilization 0.7727`; a 2500-long extra part → issue `bom.part_exceeds_sheet { partKey, materialCode }` (error); glass rows are skipped by nesting and keep `sheetsNested null`; instance keys `key#2`, `key#3` for qty > 1.
- [ ] **Step 2: Run it, expect FAIL** — `yarn vitest run resources/js/engine/bom`
- [ ] **Step 3: Implement** — paste the 08 §5.3 code into `guillotine.ts` unchanged (types exported); `nestSheets` per §5.4 steps 1–4; wire into `computeBom` (§3.5 `utilization = round4(Σ placed cut areas / (sheets × sheetArea))`, §3.9 kerf `Math.ceil(pricing.kerfMm)`).
- [ ] **Step 4: Run tests, expect PASS** — same command.
- [ ] **Step 5: Quality gates** — `yarn eslint resources/js/engine && yarn prettier --check resources/js/engine && yarn vue-tsc --noEmit`
- [ ] **Step 6: Commit** — `git add resources/js/engine/bom resources/js/engine/index.ts` → `feat(engine): add deterministic guillotine sheet nesting`

