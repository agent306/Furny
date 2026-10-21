# Task 11 report: room detection, net polygons, faceKey, labels, association

Status: DONE (one flagged deviation/interpretation list below)
Commit: 67e4ae7 `feat(engine): detect rooms with net polygons, face keys and labels`

## Implemented
- `resources/js/engine/plan/rooms.ts` (new)
  - `faceKeyFor(wallIds)`: `'fk_' + cyrb53(sorted unique ids joined '|').toString(36)`.
  - `computeRoomNet(ring, holes, wallsUnion)`: 04 §4.5 net polygon (largest piece of `face - wallsUnion`; dropped when `< MIN_ROOM_NET_AREA` = 40 000 mm², per controller ruling), `simplifyCollinear` on outer/holes, `Math.round` area/perimeter, `polygonCentroid`, `isAxisRectangle` -> `netRect` (width along x). Separate function so Task 12 can memoise it per face.
  - `analyzeRooms(graph, wallsUnion, derivedWalls)`: builds the planar graph from `WallGraph.valid` centre lines (only walls that have a derived wall), `walkFaces` + `nestFaces`, nets, faceKey (outer cycle only; collision suffix `_2`, `_3` ordered by (centroid.y, centroid.x)), polylabel label, rooms sorted by faceKey, plus per-wall `{left,right}` room keys via the longest sub-edge per side (half-edge `u->v` has its face on its right; walls compared against their own A->B direction so overlapping collinear walls work).
  - `detectRooms(doc, graph, wallsUnion, derivedWalls)`: thin wrapper returning `analyzeRooms(...).rooms` (signature per brief; `doc` unused).
  - `associateRoomMetas(rooms, doc)`: anchors tested with `pointInPolygon` on `facePolygon`; smallest meta id wins, losers -> `room_meta_duplicate` warning (`params {metaId, keptMetaId, faceKey}`, `entityIds [loser, winner]`); `labelOffset` -> `labelPoint = centroid + offset`, `labelRadius = max(0, signedDist to net)`. Unassociated rooms are returned by reference; associated rooms are new objects (inputs never mutated).
- `plan/derive.ts`: fills `rooms`, `roomIndexByMetaId`, `roomIndexByFaceKey`, each wall's `leftRoomKey`/`rightRoomKey`/`exteriorSide` (left if left null and right set, mirrored for right), appends association issues. Header comment and field docs updated.
- `engine/index.ts`: exports `analyzeRooms`, `associateRoomMetas`, `computeRoomNet`, `detectRooms`, `faceKeyFor` and types `RoomAnalysis`, `RoomNet`, `WallRoomSides`.
- `plan/__tests__/rooms.test.ts` (22 tests).

## Rulings applied
- MIN_ROOM_NET_AREA (40 000 mm²) drops thin faces (test: two 115 mm walls 120 mm apart -> 5 mm strip, ~18 850 mm², dropped).
- Face Vec2s never mutated (`facePolygon` shares `face.ring`/`face.holes`; net rings come from Clipper output; test asserts `plan.rooms` unchanged after `associateRoomMetas`).
- RawFace.halfEdges = outer then hole cycles: faceKey uses only `halfEdges.slice(0, ring.length)` (spec 04 §4.6: hole cycles excluded); `DerivedRoom.wallIds` is the union (outer + islands), sorted unique.
- `-0` normalised in centroid, polygon, holes, labelPoint.

## Tests (all verified)
- TDD: RED = tests written against implementation applied then derive.ts reverted: `yarn vitest run --project engine resources/js/engine/plan/__tests__/rooms.test.ts` -> 18 failed | 4 passed (rooms empty without the derive wiring). Honest note: rooms.ts was written before the test file ran, so the RED run is the derive.ts-reverted state, not a "module missing" run.
- GREEN: same command -> 22 passed (22).
- Whole engine: `yarn vitest run --project engine resources/js/engine` -> 23 files, 681 tests passed.
- `yarn eslint resources/js/engine` clean; `yarn prettier --check resources/js/engine` clean; `yarn vue-tsc --noEmit` clean; `yarn build:engine-cli` builds.
- Covered: rect plan (area 17 982 900, netRect 4770 x 3770, perimeter 17 080, label radius > 0), L plan (27 717 538 / 9 245 925 ±1, larger netRect null), grid 7x6 (42 rooms, area conservation < 0.1 %, unique sorted keys), free-standing box (outer room 1 CCW hole, 2 rooms, key from outer cycle), dangling wall (1 room, > 4 vertices, notch), crossing walls without node (4 rooms), thin-face drop, faceKey stability (node move, thickness) and change on wall split, determinism, no mutation, no -0, wall sides (rect exterior sides, grid interior walls both keys and `exteriorSide === null`, crossing-wall longest sub-edge), association (single, duplicate warning, orphan, island interior vs outer room, labelOffset vs polylabel).

## Interpretations / things to know
1. Anchor containment uses `pointInPolygon(anchor, facePolygon)` (holes count as outside). Spec 04 §4.4a says "centre-line ring (holes excluded)"; a literal outer-ring-only test would make an island's interior meta also fall inside the surrounding room and wrongly trigger `room_meta_duplicate`. Boundary hits (within EPS) are not "inside". Task 12/`reconcileRoomMetas` (4.4b) should use the same test.
2. `detectRooms` ignores `doc` (kept for the contracted signature); `graph` is the `WallGraph` from `buildWallGraph`. Wall sides are only available through `analyzeRooms` (derive uses it).
3. A wall side facing a dropped (thin/sub-minimum) face has key `null`; a wall with every sub-edge a pruned filament keeps `null/null/null`.
4. `netRect` width/depth are not rounded (Clipper µm precision gives exact values on the tested fixtures; tests use `toBeCloseTo`).
5. Spec 04 §4.5 `DerivedRoom.wallIds` comment says only "sorted, unique"; chose union incl. island walls (useful for Task 12 invalidation). Flag if the outer-cycle set is wanted instead.

## Files changed
- /home/user/furny-p2/resources/js/engine/plan/rooms.ts (new)
- /home/user/furny-p2/resources/js/engine/plan/derive.ts
- /home/user/furny-p2/resources/js/engine/plan/__tests__/rooms.test.ts (new)
- /home/user/furny-p2/resources/js/engine/index.ts
