### Task 38: Table family generator

**Files:**
- Create: `resources/js/engine/furniture/table/generateTable.ts`, `resources/js/engine/furniture/table/outlines.ts`
- Modify: `resources/js/engine/furniture/generate.ts`
- Test: `resources/js/engine/furniture/table/__tests__/generateTable.test.ts`

**Spec refs:** `07 §3.13`, `§5.2–§5.4` (table rows), `§6.4` (table handles), `§6.9`

**Interfaces:**
- Consumes: Tasks 30–37 (`drawersFor`, `shelvesFor`, `hingedFront` helpers, `connectorsForJoints`).
- Produces: `tableParts(ctx): void`; `roundedRectOutline(W, D, r, segmentsPerCorner = 8)`, `circleOutline(d, segments = 64)`, `ellipseOutline(W, D, segments = 64)` (CW `[x, z]` pairs).

- [ ] **Step 1: Write the failing tests** — dining table defaults (1800 × 750 × 900, overhang 50, solid legs 50, apron 90 inset 15, top `PB25-WHITE`, legs `SW50-RUBBER`): `Tt 25`, `Hb 725`, `Wb 1700`, `Db 800`; `table.top` 1800 × 900 banded all four with `EB10-WHITE-28`, faces 1; `table.leg.fl` box x `[50,100]`, z `[800,850]`, part 725 × 50 thickness 50 grain `'length'`; `table.apron.front` 1600 × 90 (z `[817,835]`), `table.apron.left` 700 × 90 (x `[65,83]`), aprons banded `bottom` only, faces 1; hardware `table.connectors.corner CON-TBL-CORNER × 4`, `table.connectors.dowel × 16`, `table.screws × 1`, no `table.legs`. Hardware legs (`legSource 'hardware'`) → `table.legs LEG-TBL-710 × 4`, leg height check against `Hb 725` (710 + 15 ≥ 725 → no warning; `Hb 760` → `leg_height_mismatch`). `stretcher: true` → left/right/center stretchers at y `[150,210]` and dowels +12. `lowerShelf` → `table.shelf` at y `[100,118]` banded front+back, +8 dowels. `round` with W ≠ D → `round_top_not_square`; `rounded_rectangle` r 100 → extruded outline with 4 × 8 corner segments; r > min(W,D)/2 → `corner_radius_too_large`; `round` 1000 → 64-segment circle outline and legs placed in the inscribed square (`Wb = fl((W − 2o)/√2)`); `thickness: 50` with 25 mm material → 2 layers `table.top` + `table.top.layer.2`; `thickness: 40` → rounded to 2 layers + info `table_top_thickness_rounded`. Study desk defaults (1200 × 750 × 600, cabinet_ends 400 drawers): `table.end.left` 725 × 600 banded front/back; `table.cabinet.side.left` 725 × 582; cabinet drawer fronts 397 wide (`X [801.5, 1198.5]`, top cover −2); slides `SLD-BB-550 × 3`; modesty `table.stretcher.back` 782 × 362; no `knee_space_narrow`; cabinet width 700 on a 1200 desk → `knee_space_narrow { width: 482 }`. Pedestal on 1300 round → `pedestal_unstable`; trestle → `table.trestle.left.upright/foot/cleat` + cams 4 + dowels 8; `storage.drawers { count: 1, side: 'left' }` on `panel_ends` → `table_drawer_side_unsupported`; endCabinets content `hanging_rod` → `cabinet_content_unsupported`.
- [ ] **Step 2: Run it, expect FAIL** — `yarn vitest run resources/js/engine/furniture/table`
- [ ] **Step 3: Implement** — 07 §3.13 tables for `four_legs`, `panel_ends`, `trestle`, `pedestal`, `cabinet_ends`, under-top drawers; table handles use `defaultHardware('handle.default')`; no §6.8 hardware for tables.
- [ ] **Step 4: Run tests, expect PASS** — `yarn vitest run resources/js/engine/furniture`
- [ ] **Step 5: Quality gates** — `yarn eslint resources/js/engine && yarn prettier --check resources/js/engine && yarn vue-tsc --noEmit`
- [ ] **Step 6: Commit** — `git add resources/js/engine/furniture` → `feat(engine): generate table-family furniture`

