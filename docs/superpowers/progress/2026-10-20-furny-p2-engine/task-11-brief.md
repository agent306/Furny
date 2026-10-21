### Task 11: Room detection, net polygons, faceKey, labels, association

**Files:**
- Create: `resources/js/engine/plan/rooms.ts`
- Modify: `resources/js/engine/plan/derive.ts`
- Test: `resources/js/engine/plan/__tests__/rooms.test.ts`

**Spec refs:** `04 §3.5`, `04 §4.4(a)`, `§4.5–§4.7`, `§4.9`, `03 §1.2`

**Interfaces:**
- Consumes: Tasks 6 (`buildPlanarGraph`, `walkFaces`, `nestFaces`, `polylabel`), 5 (`difference`, `cyrb53`), 10.
- Produces: `detectRooms(doc, graph, wallsUnion, derivedWalls): DerivedRoom[]` (sorted by `faceKey`); `associateRoomMetas(rooms, doc): { rooms: DerivedRoom[]; issues: DeriveIssue[] }`; `faceKeyFor(wallIds: string[]): string` (`'fk_' + cyrb53(sorted unique ids joined '|').toString(36)`, collision suffix `_2`, `_3` by `(centroid.y, centroid.x)`); `derivePlanGeometry` now fills `rooms`, `roomIndexByMetaId`, `roomIndexByFaceKey`, each wall's `leftRoomKey`/`rightRoomKey`/`exteriorSide`.

- [ ] **Step 1: Write the failing tests** (04 §4.9 + extras):
  - `makeRectPlan(5000,4000,230)` → exactly 1 room, `areaMm2 = 17_982_900` (±1), `netRect = { width: 4770, depth: 3770 }`, `perimeterMm = 2·(4770+3770)`.
  - `makeLPlan()` → 2 rooms; areas `27_717_538` (±1; 4827.5 × 5770 − 57.5 × 2385) and `9_245_925` (±1; 2827.5 × 3270); the larger has `netRect === null` (step at the 230/115 junction).
  - `makeGridPlan(7,6)` → 42 rooms; Σ net areas + `area(wallsUnion)` = `area(exteriorOutline)` (±0.1 %).
  - Free-standing closed 2000 × 2000 box (115) inside a 10 000 × 8000 rect plan → outer room has exactly 1 hole (CCW) and the box interior is its own room (2 rooms).
  - Dangling wall `(0,2000)→(1500,2000)` attached to the left wall of a rect plan → still 1 room, net polygon has > 4 vertices (notch).
  - Rect 4000 × 4000 plus walls `(2000,0)→(2000,4000)` and `(0,2000)→(4000,2000)` without a centre node → 4 rooms.
  - `faceKey` identical before/after moving a node 100 mm and after changing a thickness; changes when a wall is split.
  - Association: one meta anchor inside → `metaId` set; two metas in one face → smaller id wins, other gets none, `room_meta_duplicate` warning; meta outside every face → orphaned (not in `roomIndexByMetaId`); `labelPoint` = `centroid + labelOffset` when `labelOffset` is set, else polylabel point; `labelRadius > 0`.
  - Wall sides: on the rect plan every wall's `exteriorSide` is the side without a room; interior grid walls have both room keys set and `exteriorSide === null`.
- [ ] **Step 2: Run it, expect FAIL** — `yarn vitest run resources/js/engine/plan/__tests__/rooms.test.ts`
- [ ] **Step 3: Implement** — 04 §4.5 net polygon (largest difference piece, drop `< MIN_ROOM_NET_AREA`), metrics rounding (`Math.round`), `isAxisRectangle` → `netRect` with width along x; face of half-edge `u→v` on its right → room keys per wall via its longest sub-edge (§3.5).
- [ ] **Step 4: Run tests, expect PASS** — `yarn vitest run resources/js/engine/plan`
- [ ] **Step 5: Quality gates** — `yarn eslint resources/js/engine && yarn prettier --check resources/js/engine && yarn vue-tsc --noEmit`
- [ ] **Step 6: Commit** — `git add resources/js/engine/plan resources/js/engine/index.ts` → `feat(engine): detect rooms with net polygons, face keys and labels`

