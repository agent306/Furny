### Task 3: Geometry primitives (vec2, segment, polygon)

**Files:**
- Create: `resources/js/engine/geometry/vec2.ts`, `resources/js/engine/geometry/segment.ts`, `resources/js/engine/geometry/polygon.ts`
- Test: `resources/js/engine/geometry/__tests__/vec2.test.ts`, `segment.test.ts`, `polygon.test.ts`

**Spec refs:** `04 §2.1–§2.5`, `04 §2.8`, `04 §9` (geometry rows)

**Interfaces:**
- Consumes: `tolerance.ts` (Task 1).
- Produces (exact signatures of 04 §2.2, §2.4, §2.5): `Vec2`, `v, add, sub, scale, dot, cross, len, dist, dist2, normalize, perpLeft, rot, lerp, angleOf, nearlyEqual, roundPoint, normDeg, isParallel`, plus `orient(a,b,c)`, `sideOf(a,b,c): -1|0|1`, `frontVector(deg)`, `rotationFromFront(f)` (these two live in `vec2.ts` and are re-exported by `plan/footprint.ts` in Task 15); `Seg, segLength, projectParam, closestPointOnSeg, distPointLine, SegIntersection, intersectSegments, lineIntersection`; `Ring, PolygonWithHoles, signedArea, area, perimeter, polygonCentroid, pointInRing, pointInPolygon, ensureCW, ensureCCW, simplifyCollinear, ringBBox, distToRing, signedDistToPolygon, isAxisRectangle`. All re-exported from index.

- [ ] **Step 1: Write the failing tests** (values from 04 §2.8 / §9):
  ```ts
  expect(sideOf(v(0,0), v(1000,0), v(500,-10))).toBe(1)
  expect(sideOf(v(0,0), v(1000,0), v(500,10))).toBe(-1)
  expect(signedArea([v(0,0),v(10,0),v(10,10),v(0,10)])).toBe(100)
  expect(frontVector(0)).toEqual(expect.objectContaining({ x: expect.closeTo(0), y: expect.closeTo(1) }))
  expect(frontVector(90).x).toBeCloseTo(-1); expect(rotationFromFront(v(1,0))).toBe(270)
  expect(intersectSegments({a:v(0,0),b:v(100,0)},{a:v(50,0.3),b:v(150,0.3)}).kind).toBe('overlap')
  // perpendicular crossing at (50,0) → kind 'point', point (50,0); parallel lines 1 mm apart → 'none'
  ```
  plus: `perpLeft(v(1,0))` = `(0,-1)`; `normalize(v(0,0))` = `(0,0)`; `normDeg(-90) === 270`, `normDeg(720) === 0`; `pointInRing` returns `'boundary'` for a point 0.3 mm off an edge, `'inside'`/`'outside'` otherwise; `simplifyCollinear` removes a vertex 0.3 mm off the line and duplicate vertices; `isAxisRectangle` returns `{width:4000, depth:3000, angle:0}` for an axis rectangle and `null` for a rotated-45° square; `polygonCentroid` of a 10×10 square with a centred 2×2 hole = `(5,5)`; `signedDistToPolygon` positive inside, negative outside; `ensureCW` reverses a CCW ring.
- [ ] **Step 2: Run it, expect FAIL** — `yarn vitest run resources/js/engine/geometry`
- [ ] **Step 3: Implement** — follow 04 §2.3 robustness rules (parallel test `|cross(n1,n2)| ≤ sin(tol)`, never divide on parallel); `intersectSegments` algorithm of 04 §2.4 verbatim; `pointInRing` = boundary check then even–odd ray cast toward +x.
- [ ] **Step 4: Run tests, expect PASS** — same command.
- [ ] **Step 5: Quality gates** — `yarn eslint resources/js/engine && yarn prettier --check resources/js/engine && yarn vue-tsc --noEmit`
- [ ] **Step 6: Commit** — `git add resources/js/engine/geometry resources/js/engine/index.ts` → `feat(engine): add 2D vector, segment and polygon primitives`

