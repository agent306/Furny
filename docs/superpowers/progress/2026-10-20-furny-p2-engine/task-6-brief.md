### Task 6: Planar graph, face walk, polylabel

**Files:**
- Create: `resources/js/engine/geometry/planarFaces.ts`, `resources/js/engine/geometry/polylabel.ts`
- Test: `resources/js/engine/geometry/__tests__/planarFaces.test.ts`, `polylabel.test.ts`

**Spec refs:** `04 §4.1–§4.3`, `04 §4.7`, `04 §2.3` (spatial hash rule), `04 §9` (planarFaces, polylabel rows)

**Interfaces:**
- Consumes: Tasks 3, 5 (`intersectSegments`, `pointInRing`, `signedArea`); `flatbush`.
- Produces: `buildPlanarGraph(segments: Array<{ a: Vec2; b: Vec2; wallId: string }>): PlanarGraph` with `PlanarGraph { vertices: Vec2[]; edges: Array<{ v0: number; v1: number; wallIds: string[] }>; out: number[][]; filaments: Array<{ v0: number; v1: number; wallIds: string[] }> }`; `walkFaces(graph): Array<{ ring: Vec2[]; halfEdges: number[]; area: number }>`; `nestFaces(graph, cycles): RawFace[]` with `RawFace { ring: Vec2[]; holes: Vec2[][]; halfEdges: number[]; wallIds: Set<string> }`; `polylabel(p: PolygonWithHoles, precision = 10): { point: Vec2; distance: number }`.

- [ ] **Step 1: Write the failing tests** — unit square traced A→B→C→D yields exactly one positive (CW) face and one negative outer cycle; two adjacent squares sharing an edge → 2 faces + 1 outer; a dangling edge attached to a square is pruned (in `filaments`) and the square still yields 1 face; a nested square (separate component) inside a bigger one → bigger face gets 1 CCW hole and the small square is its own face; two crossing segments forming an X inside a square → the crossing vertex is created and 4 faces result; half-edge `u→v` has its face on its right (assert via `signedArea` of the face of a known half-edge); collinear overlapping segments dedupe into one edge whose `wallIds` contains both ids; two endpoints 0.3 mm apart cluster into one vertex (review focus 2). polylabel: 1000-square → point (500, 500) ±10, distance ≈ 500; L-shape (arms 3000×1000 and 1000×3000) → point inside the thicker arm with `distance ≥ 0.45 × 1000`; square with a centred hole → returned point not inside the hole.
- [ ] **Step 2: Run it, expect FAIL** — `yarn vitest run resources/js/engine/geometry`
- [ ] **Step 3: Implement** — steps 1–6 of 04 §4.1 (Flatbush candidates, split points, 1 mm-cell spatial-hash clustering with endpoints first, sub-edges, filament pruning, `out` sorted by angle); `next(h)` rule of 04 §4.2; nesting rule of 04 §4.3; polylabel with an inline binary max-heap (04 §4.7).
- [ ] **Step 4: Run tests, expect PASS** — same command.
- [ ] **Step 5: Quality gates** — `yarn eslint resources/js/engine && yarn prettier --check resources/js/engine && yarn vue-tsc --noEmit`
- [ ] **Step 6: Commit** — `git add resources/js/engine/geometry resources/js/engine/index.ts` → `feat(engine): add planar face detection and polylabel`

