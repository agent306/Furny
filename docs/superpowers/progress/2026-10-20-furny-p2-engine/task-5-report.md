# Task 5 report: clipper2 + earcut wrappers, cyrb53

Status: DONE. Commit 189287a `feat(engine): wrap clipper2 and earcut, add cyrb53 hash`.

## Implemented
- `geometry/clip.ts`: `union`, `difference`, `intersection`, `offset(polys, delta, 'miter'|'square'|'round', miterLimit = MITER_LIMIT)`, `intersectionArea`; exports type `OffsetJoin`.
  - Scale by `CLIPPER_SCALE` + `Math.round` -> `Path64`; `Clipper64` with `FillRule.NonZero`; results via `PolyTree64` (also for `ClipperOffset.execute(delta, PolyTree64)`), so hole nesting is Clipper's own, no `pointInRing` fallback needed. Island-in-hole handled (hole children become new outers).
  - Inputs normalised (outer CW, holes CCW) so NonZero treats holes as holes; rings < 3 vertices skipped.
  - Output: outer CW (`signedArea > 0`), holes CCW, rings < 1 mm2 dropped, `-0` normalised to `0` (`x / scale + 0`).
- `geometry/triangulate.ts`: `triangulate(p) -> { positions: Float64Array; indices: Uint32Array }` (type `TriangleMesh`). Flattens outer then holes, `earcut(flat, holeIndices, 2)`, swaps b/c for any CCW triangle; empty buffers for degenerate outer; `-0` normalised.
- `geometry/hash.ts`: `cyrb53` verbatim from 04 §4.6.
- `index.ts`: re-exports all of the above (+ `OffsetJoin`, `TriangleMesh` types).

## clipper2-ts 2.0.1-18 API actually used (all inside clip.ts)
Named exports `Clipper64, ClipperOffset, ClipType, EndType, FillRule, JoinType, PathType, PolyTree64` and types `Path64, Paths64, PolyPath64`. Names match C# (`JoinType.Miter/Square/Round`, `EndType.Polygon`). Tree: `node.count`, `node.child(i)`, `node.polygon`. earcut 3.2.4 ships its own `.d.ts` (default export), no `@types/earcut` needed. No dependency changes.

## Tests (TDD)
- RED: impl files moved away, `yarn vitest run --project engine resources/js/engine/geometry` -> 3 test files failed "Failed to load url ../hash / Cannot find module '../triangulate'" (modules absent, expected).
- GREEN: same command after restoring: 6 files, 91 tests pass; full `yarn vitest run --project engine resources/js/engine` -> 13 files, 399 tests pass (incl. purity + lintRules).
- Covered: union of 100-squares shifted 50 in x -> 1 ring, area 15 000; difference 1000-square minus centred 200-square -> 1 polygon, 1 CCW hole, 960 000; intersection area 40 000; `offset(1000-square, 100, 'miter')` -> 1200 square (1 440 000, bounds -100..1100); winding of every outer/hole; far coordinates (x ~ 999 000, y ~ 998 000): axis-aligned union exact (15 000, exact bounds) and diagonal-edge diamonds (union 35 000, intersection 5 000); island inside a hole; hole shrink/close on offset; negative offset and collapse -> []; sliver and degenerate drops; -0 normalisation; triangulate square-with-hole (sum = 960 000, all CW, either hole winding), CCW outer reorder, concave L, degenerate, -0; cyrb53 equals pasted reference (several strings + seed), pinned golden `cyrb53('w_a|w_b') = 1468347857554891` (computed by running the reference code in node), `'' !== 'a'`, safe-integer range.
- Gates: `yarn eslint resources/js/engine` clean, `yarn prettier --check resources/js/engine` clean, `yarn vue-tsc --noEmit` clean, `yarn build:engine-cli` builds.

## Notes / concerns
- Brief wording "two squares offset by 50 -> area 15 000" only holds for a shift along one axis (diagonal shift gives 17 500); tests use an x-only shift.
- `offset` passes `miterLimit` straight to `ClipperOffset` (Clipper2 interprets it as a multiple of delta; spec calls MITER_LIMIT = 4 "miter length / half thickness" - equivalent for a polygon offset by half thickness). Arc tolerance left at Clipper's default for round joins.
- `offset` mixes all input polygons in one Clipper group; a polygon lying inside another polygon's hole would be treated per Clipper's union semantics (not exercised by the engine).
- Triangles that earcut emits as zero-area (collinear) are kept unchanged (not CCW, so not swapped).
