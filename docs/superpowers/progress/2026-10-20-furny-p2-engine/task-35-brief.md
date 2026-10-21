### Task 35: Drawers and slide selection

**Files:**
- Create: `resources/js/engine/furniture/carcass/drawers.ts`, `resources/js/engine/furniture/fronts/drawerFronts.ts`
- Test: `resources/js/engine/furniture/carcass/__tests__/drawers.test.ts`

**Spec refs:** `07 §3.12`, `§4.4`, `§6.5`, `§12.3`, `§12.4` (slide selection)

**Interfaces:**
- Consumes: Tasks 30–34.
- Produces: `drawerFrontRects(ctx, opening, content): Array<{ x0; x1; y0; y1 }>`; `selectSlide(ctx, { slideCode, maxLen, family? }): { slide: CatalogHardware | null; boxLength: number; issues }`; `drawersFor(ctx, env, layout, leaf, content, keyPrefix = 'section.{S}.drawer'): void` (also used by the table family with prefixes `table.drawer` / `table.cabinet.drawer`).

- [ ] **Step 1: Write the failing tests** — 07 §12.3 verbatim: `custom_box` 600 × 720 × 560, root leaf `drawers { count: 3, frontHeights: 'equal', slideCode: null, behindDoor: false }`: `maxLen 519` → `SLD-BB-500`, no depth warning; `Wb 538`, `Win 514`, `Lb 500`; fronts block `x [1.5,598.5] y [1.5,718.5]`, fronts 597 × 237 with rect y = 480, 241, 1; box heights 180 / 190 / 180; drawer 1 parts `…drawer.1.side.left/right` 500 × 180 in `PLY12-BWR` (banded edge `top` = `L1`, which receives the `drawer_box` role band — `null` with the seed catalog because PLY12-BWR has no default band), `.back` 514 × 167, `.bottom` 524 × 500 (`HDF3-WHITE`, unbanded), `.front` 597 × 237 banded all four faces 2; hardware `.slides SLD-BB-500 × 1`, `.handle HDL-BAR-160 × 1` per drawer; `slideScrewSets` +1 on each side panel per drawer; model fronts of kind `drawer` with `frontId null`. Undermount (`slideCode 'SLD-UM-500'`): kept, `Win 522`, `Wb 546`, `Lb 490`, bottom 532 × 490, back 522 × 164. Slide selection (07 §12.4): explicit `SLD-BB-350` with `maxLen 519` → kept + warning `drawer_depth_unused { unused: 169 }`; `maxLen 240` → error `drawer_no_slide` and no box parts; explicit `SLD-UM-500` with `maxLen 480` → `SLD-UM-450` + info `slide_resized { from: 'SLD-UM-500', to: 'SLD-UM-450' }`. Behind door (wardrobe with `internalDrawers: 2`): inner fronts `…drawer.{j}.front` in `PLY12-BWR` with nameKey `parts.drawer_inner_front`, `Wo` reduced by 40 (packers), available depth −20, no `.handle`; drawers under a Front with `behindDoor: false` → warning `drawers_forced_behind_door`. Slot of 95 mm → `drawer_too_low`; the §12.3 box with `frontHeights [320, 320, 1]` → last front `717 − 640 − 4 = 73 < 80` → error `drawer_heights_invalid`; a 2-element list for count 3 → treated as `'equal'` + warning `drawer_heights_invalid`.
- [ ] **Step 2: Run it, expect FAIL** — `yarn vitest run resources/js/engine/furniture/carcass/__tests__/drawers.test.ts`
- [ ] **Step 3: Implement** — 07 §3.12 (slots, box height, opening width, available depth, slide selection steps 1–5, box table by slide type, placement) and §4.4 front division.
- [ ] **Step 4: Run tests, expect PASS** — same command.
- [ ] **Step 5: Quality gates** — `yarn eslint resources/js/engine && yarn prettier --check resources/js/engine && yarn vue-tsc --noEmit`
- [ ] **Step 6: Commit** — `git add resources/js/engine/furniture` → `feat(engine): generate drawer boxes, fronts and slide selection`

