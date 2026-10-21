# Task 3 report: vec2 / segment / polygon primitives

Status: DONE_WITH_CONCERNS (one spec interpretation, below). Commit: 8b94f12 `feat(engine): add 2D vector, segment and polygon primitives`.

## Implemented
- `geometry/vec2.ts`: Vec2, v, add, sub, scale, dot, cross, len, dist, dist2, normalize, perpLeft, rot, lerp, angleOf, nearlyEqual, roundPoint, normDeg, isParallel, plus orient, sideOf, frontVector, rotationFromFront (04 §2.1/§2.2).
- `geometry/segment.ts`: Seg, segLength, projectParam, closestPointOnSeg, distPointLine, SegIntersection, intersectSegments (04 §2.4 algorithm), lineIntersection (null on parallel, never divides).
- `geometry/polygon.ts`: Ring, PolygonWithHoles, signedArea, area, perimeter, polygonCentroid, pointInRing (boundary check then +x even-odd), pointInPolygon, ensureCW/CCW (return copies), simplifyCollinear, ringBBox, distToRing, signedDistToPolygon, isAxisRectangle.
- All re-exported from `engine/index.ts`. No new dependencies. Rulings: none in preflight/progress change Task 3 (a9/a10/row 3 are "OK"); comment-token rule respected (purity test passes).

## Decisions / concerns
1. `isAxisRectangle`: 04 §2.5 text ("all corners 90 deg") would accept a 45 deg square, but the brief and 04 §9 require `null` for it, and the name/§4.5 ("width = edge closest to x axis") imply axis alignment. Implemented: 4 vertices after simplifyCollinear, all corners 90 deg +/- tol, AND the edge nearest the x axis within `angleTol`. `angle` = that edge's direction in radians folded to (-pi/2, pi/2] (always 0 for exact axis rectangles). Tell P3/rooms (Task 17) if they expected arbitrary-rotation rectangles.
2. `intersectSegments` additions beyond the spec: zero-length segments are handled as point-on-segment tests (no division by zero). Collinear end-to-end touching (gap <= eps) returns `point` with t clamped to the midpoint of the touch interval.
3. `perpLeft(v(0,1))` yields `y = -0` (spec formula `-d.x`); kept verbatim, tests use toBeCloseTo for that case.
4. `isParallel` with a zero vector returns true (normalize gives (0,0)); callers must not rely on it for degenerate input. `ringBBox` of an empty ring returns +/-Infinity.
5. `signedDistToPolygon` on the boundary returns the (<= eps) non-negative distance.

## TDD evidence
- RED: `yarn vitest run --project engine resources/js/engine/geometry` before implementation: `Test Files 3 failed (3) ... Failed to load url ../vec2 ... Does the file exist?` (expected: modules missing).
- GREEN: same command after implementation: `Test Files 3 passed (3), Tests 61 passed (61)`. One intermediate failure (a -0 vs +0 toEqual in my own perpLeft test) fixed in the test.
- Full engine project: `yarn vitest run --project engine resources/js/engine` -> 8 files, 129 tests passing.

## Tests (geometry/__tests__/vec2.test.ts, segment.test.ts, polygon.test.ts)
All brief/04 §2.8 values: sideOf +/-1, signedArea 100, frontVector(0)/(90), rotationFromFront((1,0))=270, overlap for (0,0)-(100,0) vs (50,0.3)-(150,0.3), perpendicular crossing point (50,0), parallel 1 mm apart none, perpLeft, normalize zero, normDeg(-90)=270 / (720)=0, pointInRing boundary at 0.3 mm, simplifyCollinear (0.3 mm vertex, duplicates, wrap-around), isAxisRectangle {4000,3000,0} and null for 45 deg, centroid (5,5) with hole, signedDistToPolygon signs, ensureCW reversal. Extras: opposite-direction overlap params, T-junction within EPS, disjoint collinear, degenerate segments, concave rings, holes, rotation-from-front round trip 0..359.

## Gates
`yarn eslint resources/js/engine` exit 0; `yarn prettier --check resources/js/engine` clean; `yarn vue-tsc --noEmit` exit 0 (after wayfinder:generate).

## Files
resources/js/engine/geometry/{vec2,segment,polygon}.ts, resources/js/engine/geometry/__tests__/{vec2,segment,polygon}.test.ts, resources/js/engine/index.ts (exports added).
