### Task 5: Clipper and earcut wrappers, cyrb53 hash

**Files:**
- Create: `resources/js/engine/geometry/clip.ts`, `resources/js/engine/geometry/triangulate.ts`, `resources/js/engine/geometry/hash.ts`
- Test: `resources/js/engine/geometry/__tests__/clip.test.ts`, `triangulate.test.ts`, `hash.test.ts`

**Spec refs:** `04 §2.6–§2.7`, `04 §4.6` (cyrb53 code), `04 §2.8` (union check)

**Interfaces:**
- Consumes: `PolygonWithHoles`, `signedArea`, `pointInRing`, `ensureCW/CCW` (Task 3); `CLIPPER_SCALE`, `MITER_LIMIT`.
- Produces: `union(polys)`, `difference(subject, clip)`, `intersection(a, b)`, `offset(polys, delta, join, miterLimit?)`, `intersectionArea(a, b)` (all `PolygonWithHoles[]`-based, outer rings CW, holes CCW, rings < 1 mm² dropped); `triangulate(p): { positions: Float64Array; indices: Uint32Array }` (triangles CW in plan space); `cyrb53(str, seed = 0): number`. All re-exported from index.

- [ ] **Step 1: Write the failing tests** — union of two 100×100 squares offset by 50 → one ring, area 15 000 (±1); difference of a 1000-square minus a centred 200-square → one polygon with one CCW hole, area 960 000; intersection area of those squares = 40 000; `offset([1000-square], 100, 'miter')` → 1200×1200 square (area 1 440 000 ±1); every output outer ring `signedArea > 0`, every hole `< 0`; **review focus 2:** union of two squares at x ≈ 999 000 (coordinates up to 1 000 000) has exact area (±1); `triangulate` of a square with a hole: Σ triangle areas = polygon area, every triangle CW; `cyrb53('w_a|w_b')` equals a value computed by the reference code pasted from 04 §4.6 into the test (`toBe(referenceCyrb53('w_a|w_b'))`) and `cyrb53('') !== cyrb53('a')`.
- [ ] **Step 2: Run it, expect FAIL** — `yarn vitest run resources/js/engine/geometry`
- [ ] **Step 3: Implement** — scale by `CLIPPER_SCALE`, `Math.round` to `Path64`, `FillRule.NonZero`, scale back; nest holes via `PolyTree64` when available else `pointInRing` of the hole's first vertex; adapt to the actual export names of `clipper2-ts 2.0.1-18` inside `clip.ts` only (inspect `node_modules/clipper2-ts` type declarations first). `triangulate` flattens outer+holes for `earcut(flat, holeIndices, 2)` and swaps index order when a triangle is CCW.
- [ ] **Step 4: Run tests, expect PASS** — same command.
- [ ] **Step 5: Quality gates** — `yarn eslint resources/js/engine && yarn prettier --check resources/js/engine && yarn vue-tsc --noEmit` and the Task 1 purity/lint tests: `yarn vitest run resources/js/engine/__tests__`
- [ ] **Step 6: Commit** — `git add resources/js/engine/geometry resources/js/engine/index.ts` → `feat(engine): wrap clipper2 and earcut, add cyrb53 hash`

