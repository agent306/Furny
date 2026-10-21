### Task 15: Footprints + placement conflicts

**Files:**
- Create: `resources/js/engine/plan/footprint.ts`, `resources/js/engine/plan/conflicts.ts`
- Test: `resources/js/engine/plan/__tests__/footprint.test.ts`, `conflicts.test.ts`

**Spec refs:** `04 §5.8` (footprint part), `04 §5.9`, `04 §2.1` (items 7–9)

**Interfaces:**
- Consumes: Tasks 3, 5, 7, 10–11.
- Produces: `FootprintSize`, `FootprintProvider`, `Footprint`, `placementFootprint(p, size)`, `fixtureFootprint(f)`, re-export `frontVector`, `rotationFromFront`; `PlacementConflict`, `CONFLICT_KINDS`, `computePlacementConflicts(doc, geom, footprints): PlacementConflict[]`, `doorSwingSectors(doc, geom): Array<{ openingId: string; polygon: Vec2[] }>`.

- [ ] **Step 1: Write the failing tests** — footprint corners CW (signedArea > 0) and in order back-left, back-right, front-right, front-left for rotations 0/90/180/270 (placement at `(1000,1000)`, 1200 × 600: rotation 0 → corners `(400,1000),(1600,1000),(1600,1600),(400,1600)`); `rotationFromFront(frontVector(d)) === d` for d = 0..359; fixture footprint centred on `(x,y)`; `mirrored` does not change the footprint. Conflicts (04 §9): a 900-wide placement inside a single-swing door's sector → `blocks_door`; wall cabinet at elevation 1400 above a counter fixture → no `overlaps_item` (vertical intervals disjoint); a `rug` under a sofa never conflicts; a placement flush against a wall face (back edge on the face) → no `overlaps_wall` (≤ 2500 mm²); a placement 200 mm into the wall → `overlaps_wall`; an item in front of a window extended 300 mm with overlapping heights → `blocks_window`; unknown design (provider returns `null`) skipped; `doorSwingSectors` returns 1 polygon per swing door (2 for `double_swing`) with 18 points (centre + 17 arc points).
- [ ] **Step 2: Run it, expect FAIL** — `yarn vitest run resources/js/engine/plan/__tests__/footprint.test.ts resources/js/engine/plan/__tests__/conflicts.test.ts`
- [ ] **Step 3: Implement** — footprint construction of 04 §5.8 (`r = rot((1,0), θ)`); conflicts rules 1–4 of §5.9 using `intersectionArea`; `noConflict` from `FIXTURE_LIBRARY`.
- [ ] **Step 4: Run tests, expect PASS** — same command.
- [ ] **Step 5: Quality gates** — `yarn eslint resources/js/engine && yarn prettier --check resources/js/engine && yarn vue-tsc --noEmit`
- [ ] **Step 6: Commit** — `git add resources/js/engine/plan resources/js/engine/index.ts` → `feat(engine): add furniture footprints and placement conflicts`

