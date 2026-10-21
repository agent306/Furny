### Task 32: Carcass envelope, panels, plinth, countertop

**Files:**
- Create: `resources/js/engine/furniture/carcass/envelope.ts`, `panels.ts`, `plinth.ts`, `countertop.ts`
- Test: `resources/js/engine/furniture/carcass/__tests__/envelope.test.ts`, `panels.test.ts`

**Spec refs:** `07 §3.2`, `§3.3`, `§3.5`, `§3.6`, `§5.2–§5.4`, `07 §12.2` (derived values), `§12.3` (envelope), `§12.4` (plinth returns)

**Interfaces:**
- Consumes: Task 30 (`GenContext`, `makePart`), Task 29.
- Produces: `Envelope` (07 §3.2), `computeEnvelope(ctx): Envelope | null` (null + error `furniture.envelope_too_small`), `hasExternalDrawers(doc)`, `coveringFront(doc, sectionId): Front | undefined`; `carcassPanels(ctx, env): void` (pushes parts + 4 joints); `plinthParts(ctx, env): void`; `countertopPart(ctx, env): void`.

- [ ] **Step 1: Write the failing tests** — wardrobe fixture (`t_c = t_s = t_f = t_p = 18`, `t_b = 3`): `fz 18, Wc 1800, Hc 2000, Dc 582, x0 0, y0 100, zp 0, zBackFront 13, slidingZone 0, drawerStyle 'full'`, interior `x [18,1782] y [118,2082] z [13,582]`. Panels: `carcass.side.left` 2000 × 582 edges `{L1:'EB08-WHITE', L2:null, W1:'EB08-WHITE', W2:null}`, `visibleFaces 1`; `carcass.top` / `carcass.bottom` 1764 × 582 with only `L1` banded, faces 0; 4 joints of length 582. Plinth: `plinth.front` 1800 × 100 banded `W1`,`W2` (setback 20 > 0), `plinth.back` 1800 × 100 unbanded, returns `526 × 100` at x = 0, 891, 1782. Returns count: `Wc 1000 → 2`, `1001 → 3`, `2001 → 4` (07 §12.4); `Dc − sb − 2·t_p < 50` → no returns + `furniture.plinth_too_shallow`. Drawer-test box (`custom_box` 600 × 720 × 560, external drawers, no plinth): `fz 18, Dc 542`, interior `x [18,582] y [18,702]`, depth 529. Countertop (custom_box 600 × 850 × 560, legs plinth 100 setback 50, countertop overhangFront 20, top material `PB25-WHITE`): `fz 0` (no fronts), `ctT 25`, `Hc 725`, `Dc 540`, part `countertop` 600 × 560 banded front/left/right, faces 1; overhang 301 → `furniture.countertop_overhang_large`. `over_sides` top bands left/right and has `visibleFaces 1` without countertop. Wall mounting with a plinth → plinth ignored + info `furniture.plinth_ignored`. `W 150, plinth 100, H 100` → `envelope_too_small`, no parts.
- [ ] **Step 2: Run it, expect FAIL** — `yarn vitest run resources/js/engine/furniture/carcass`
- [ ] **Step 3: Implement** — formula table of 07 §3.2; panel table §3.3; plinth table §3.5 (legs-type kickboard only when `sb > 0`); countertop §3.6.
- [ ] **Step 4: Run tests, expect PASS** — same command.
- [ ] **Step 5: Quality gates** — `yarn eslint resources/js/engine && yarn prettier --check resources/js/engine && yarn vue-tsc --noEmit`
- [ ] **Step 6: Commit** — `git add resources/js/engine/furniture/carcass` → `feat(engine): generate carcass envelope, panels, plinth and countertop`

