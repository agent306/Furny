# Task 6 report: planar graph, face walk, polylabel

Status: DONE_WITH_CONCERNS (interpretation notes below). Commit: b19fe75 `feat(engine): add planar face detection and polylabel`.

## Implemented
- `geometry/planarFaces.ts`: `buildPlanarGraph` (Flatbush candidates with EPS-expanded boxes, split points, 1 mm spatial-hash clustering with all segment endpoints inserted before any split point, sub-edges deduped by unordered vertex pair with a sorted `wallIds` set, iterative degree-1 filament pruning, `out[v]` sorted by ascending angle with half-edge id as tie-break), `walkFaces` (next rule of 04 §4.2, cycles < 1 mm2 discarded), `nestFaces` (04 §4.3). Types `PlanarGraph`, `PlanarEdge`, `FaceCycle`, `RawFace` exported.
- `geometry/polylabel.ts`: Mapbox polylabel per 04 §4.7 with an inline binary max-heap (ties broken by insertion order, so deterministic); centroid vs bbox-centre initial best; degenerate bbox returns `{bbox.min, 0}`.
- `engine/index.ts` re-exports all of the above.
- Rulings applied: -0 normalised in vertices and polylabel output (C-ruling in progress.md); comment-token purity rule respected (purity test passes); C15 sub-EPS case covered at segment level (0.3 mm cluster test). No other preflight row changes Task 6 (row 6 is "OK").

## Decisions / things the reviewer should know
1. Near-parallel weakness (Task 3 deferred item) handled in `splitPair`, not by changing `segment.ts`: endpoint-within-EPS-of-interior splits come from `closestPointOnSeg` (geometric ground truth, covers T joints and overlap ends); `intersectSegments` `point` results are used as is; for `none` or `overlap` results, the exact line crossing is computed and used if within both parameter ranges (with EPS tolerance). The `overlap` result itself is not trusted for splits. Two regression tests: crossing at 0.46 deg with s2.a 40 mm off line s1 (intersectSegments says none) and a shallow crossing at x = 25 where s2.a is 0.2 mm off line s1 (intersectSegments reports a full-length overlap).
2. 04 §4.3 says the negative cycle is "reversed to CCW". A negative-area cycle is already CCW (signedArea < 0 is CCW per 04 §2.1-6, and holes must be CCW), so it is used unreversed (copied). Tests assert `signedArea(hole) < 0`.
3. `RawFace.halfEdges` = outer-cycle half-edges followed by every hole cycle's half-edges, and `wallIds` is the union over all of them. This keeps the invariant "each listed half-edge has this face on its right" (island walls border the room). Task 11 should know this when deriving room sides.
4. `PlanarGraph.vertices` keeps every clustered point (vertices of fully pruned filaments stay, with empty `out`) so indices are stable; `edges` excludes filaments, so half-edge ids refer to the kept edges only.
5. `walkFaces` returns `FaceCycle { ring, halfEdges, area }` (positive = face, negative = component boundary); `nestFaces(graph, cycles)` takes that array.
6. Host search in `nestFaces` skips faces of the same component and faces whose area is not larger than the boundary's; smallest enclosing wins. A component whose first vertex is within EPS of a foreign face edge is treated as outer (boundary result), per `pointInRing`.
7. Dumbbell faces (two cycles joined by a bridge) traverse the bridge twice, as the spec's walk does; not special-cased.

## TDD evidence
- RED: `yarn vitest run --project engine resources/js/engine/geometry/__tests__/planarFaces.test.ts resources/js/engine/geometry/__tests__/polylabel.test.ts` before implementation: `Test Files 2 failed (2) ... Failed to load url ../polylabel ... Does the file exist?` (modules missing, expected).
- GREEN: `yarn vitest run --project engine resources/js/engine/geometry` -> `Test Files 8 passed (8), Tests 125 passed (125)` (planarFaces 26, polylabel 7). One of my own tests was wrong (square-with-hole upper bound: the widest point is the ring corner, about 175.7 mm, not 150 mm); corrected the test, not the code.
- Full engine project: `yarn vitest run --project engine` -> 17 files, 437 tests passing.

## Tests covered (brief list)
Unit square A->B->C->D: one positive face (area 100, ring order A,B,C,D), one negative cycle; two adjacent squares -> 2 faces + 1 outer (shared edge carries a face each side); dangling edge pruned to `filaments` (and chained danglings), square still 1 face; nested separate square -> CCW hole on the bigger face and its own face (plus doubly nested -> smallest host); X inside a square -> vertex (50,50) and 4 faces; half-edge u->v has its face on the right (cycle containing half-edge 0 has area +100, its twin -100); collinear overlap and opposite-direction duplicates dedupe with `wallIds` ['a','b']; 0.3 mm cluster keeps first exact point, 0.8 mm does not cluster; near-parallel crossings (two cases); 3x3 grid of long un-noded walls -> 9 faces of 10 000; -0 and determinism checks; empty/zero-length input. polylabel: 1000 square -> (500,500) +-10, distance ~500; L-shape inside, distance >= 450 (about 586); square with centred hole -> point inside polygon, distance ~175; orientation independence; degenerate; -0.

## Gates
`yarn eslint resources/js/engine` exit 0; `yarn prettier --check resources/js/engine` clean; `yarn vue-tsc --noEmit` exit 0.

## Files
resources/js/engine/geometry/planarFaces.ts, polylabel.ts, __tests__/planarFaces.test.ts, __tests__/polylabel.test.ts, resources/js/engine/index.ts (exports).

## Concerns
- No perf measurement on the 1012-wall HDB case yet (Flatbush + hash is near-linear; Task 11/50 benches will show it).
- Items 2 and 3 above are interpretations of spec/brief wording; flag to Task 11 owner.
