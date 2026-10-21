### Task 16: Snap index, `snapPoint`, grid

**Files:**
- Create: `resources/js/engine/plan/snapping.ts`
- Test: `resources/js/engine/plan/__tests__/snapping.test.ts`

**Spec refs:** `04 §5.1–§5.6`, `04 §5.10–§5.11`

**Interfaces:**
- Consumes: Tasks 3, 6, 10–11, 15 (`Footprint`), `flatbush`.
- Produces: `SnapKind`, `SNAP_KINDS`, `SnapSettings`, `defaultSnapSettings(system)`, `SnapModifiers`, `SnapInput`, `SnapGuide`, `SnapMarker`, `SnapResult`, `SnapIndex`, `buildSnapIndex(doc, geom, footprints: FootprintProvider): SnapIndex`, `snapPoint(input, index): SnapResult`, `gridStepFor(zoom, system): { step: number; major: number }`, `rawStepFor(zoom): number`.

- [ ] **Step 1: Write the failing tests** — 04 §5.11 list verbatim: zoom 0.1 mouse → cursor 70 mm from a node snaps `kind 'endpoint'` with its `nodeId`, 90 mm does not; touch at 0.1 → 150 mm snaps; endpoint beats midpoint, midpoint beats on_wall; empty plan, origin (0,0), cursor (3000,40), zoom 0.1 → point (3000,0), `kind 'angle'`, `displayAngleDeg 0`, `lengthFromOrigin 3000`; shift from (0,0) with cursor (1000,900) → point (950,950), `displayAngleDeg 315`; alt → `kind 'none'` with raw rounding; grid at zoom 0.1 metric → `{ step: 500, major: 2500 }`. Grid table: metric zoom 0.01 → 5000/25000, 1 → 50/250; imperial zoom 0.01 → 3048/6096, 0.1 → 304.8/1524, 1 → 25.4/304.8 (majors per §5.6; 10000 mm → ×10, 50′ → ×2, pinned here). `perpendicular` from origin onto a wall, `extension` along a wall line, `alignment` with a node's vertical line, `guide_intersection` of extension × alignment, `intersection` of two crossing walls without a node, `exclude` skips the dragged node; result point always integer; `rawStepFor(0.1) === 10`.
- [ ] **Step 2: Run it, expect FAIL** — `yarn vitest run resources/js/engine/plan/__tests__/snapping.test.ts`
- [ ] **Step 3: Implement** — index classes of §5.2 (`null` when empty); algorithm §5.5 steps 1–9 with the priority table §5.4; tolerances §5.3.
- [ ] **Step 4: Run tests, expect PASS** — same command.
- [ ] **Step 5: Quality gates** — `yarn eslint resources/js/engine && yarn prettier --check resources/js/engine && yarn vue-tsc --noEmit`
- [ ] **Step 6: Commit** — `git add resources/js/engine/plan resources/js/engine/index.ts` → `feat(engine): add point snapping with guides and grid`

