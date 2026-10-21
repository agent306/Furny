### Task 27: Background, calibration, rescale, plan meta commands

**Files:**
- Create: `resources/js/engine/plan/commands/background.ts`, `resources/js/engine/plan/commands/plan.ts`
- Modify: `resources/js/engine/plan/commands/registry.ts`
- Test: `resources/js/engine/plan/commands/__tests__/background.test.ts`, `plan.test.ts`

**Spec refs:** `04 §6.6` (`setBackground`, `setBackgroundProps`, `calibrateBackground`, `rescalePlan`, `removeBackground`, `setPlanMeta`), `04 §6.8`, `06 §11.3` (rescale use), `06 §12.2` / `19 §4` (calibrate `space: 'image'`)

**Interfaces:**
- Consumes: Tasks 21–22.
- Produces: registry entries `setBackground`, `setBackgroundProps` (`bgProps`), `calibrateBackground` → `{ factor }`, `removeBackground`, `rescalePlan`, `setPlanMeta`.

- [ ] **Step 1: Write the failing tests** — (04 §6.8) `calibrateBackground { space:'plan', p1:(0,0), p2:(1000,0), realDistance:3000, scaleGeometry:false }` triples `mmPerPixel`, keeps `p1` fixed (`position` scaled about p1), result `factor 3`; with `scaleGeometry: true` every node coordinate triples (placements, fixtures, label positions, unattached dimension points and meta anchors scaled; thicknesses/sizes not; opening offsets ×3 then clamped); `space:'image', a:(0,0), b:(100,0), distanceMm:1500` sets `mmPerPixel = 15`, position unchanged; errors: no background → `background_missing`, locked → `background_locked`, `pxDist < 10` → `calibration_too_short`, `realDistance 99` → `out_of_range`; `rescalePlan {factor: 2}` doubles node coordinates and wall thicknesses clamped at 1000 (a 600 wall → 1000), widths clamped 300–6000, heights/sills/elevations unchanged, `background.mmPerPixel` and `position` doubled, one undo restores the doc; `factor 0.009` → `out_of_range`; a rescale that would make a wall < 10 mm aborts `wall_too_short`; `setBackground` with `pixelWidth 0` → `out_of_range`; `setPlanMeta {northAngle: 360}` → `out_of_range`; `removeBackground` then undo restores it.
- [ ] **Step 2: Run it, expect FAIL** — `yarn vitest run resources/js/engine/plan/commands/__tests__/background.test.ts resources/js/engine/plan/commands/__tests__/plan.test.ts`
- [ ] **Step 3: Implement** — formulas of the `calibrateBackground` and `rescalePlan` bullets (scale about the origin for rescale, about `p1` for calibrate; `reclampOpenings` rules after rounding).
- [ ] **Step 4: Run tests, expect PASS** — `yarn vitest run resources/js/engine/plan`
- [ ] **Step 5: Quality gates** — `yarn eslint resources/js/engine && yarn prettier --check resources/js/engine && yarn vue-tsc --noEmit`
- [ ] **Step 6: Commit** — `git add resources/js/engine/plan/commands` → `feat(engine): add background calibration and plan rescale commands`

