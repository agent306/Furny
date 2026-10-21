# Task 9 report: wall node joins and mitered outlines

Status: DONE_WITH_CONCERNS (three small interpretation calls, listed below)
Commit: 07b6a47 feat(engine): compute wall node joins and mitered outlines (base 18c0fff)

## Implemented
- resources/js/engine/plan/walls.ts: `WallEnd`, `WallInfo`, `WallGraph`, `DERIVE_ISSUE_CODES` (+ `DeriveIssueCode`), `buildWallGraph`, `computeNodeJoins`, `buildWallOutline`, `computeAllWallEnds`. Exported from engine/index.ts.
- 04 §3.2: skips missing-node / a===b / length < EPS walls with `DeriveIssue` code `wall_skipped`, messageKey `engine.plan.derive.wall_skipped`, params {wallId, reason}, severity warning. Walls iterate in sorted-id order, so `incident` and results are deterministic.
- 04 §3.3 steps 1-7: sort by outgoing angle with ties (incl. across the +-pi seam) broken by wall id; wedge corner via `lineIntersection`; miter valid iff MITER_LIMIT and half-length rule hold; the shared corner is the same Vec2 object for both walls; parallel case (step 4); cw/ccw to left/right mapping; via ordering; N omitted for clean 2-wall equal-thickness miters; joint free/miter/bevel/junction.
- 04 §3.4: assembly, `simplifyCollinear`, `ensureCW`, rectangle fallback with `fallback: true`.
- Rulings applied: -0 normalised in every output coordinate (incl. `d`, `n`); inputs never mutated (test compares structuredClone); engine purity tokens avoided.
- No task-9-specific rulings exist in preflight.md/progress.md (only the global ones above).

## Via ordering (derived from geometry)
Both ends use `via = [midCw?, N?, midCcw?]` in terms of the cw/ccw corners (at end B the left corner is cw, at end A the right corner is cw). This is the spec's "mirrored" ordering expressed once; the spec's M_ccw / M_cw labels in step 6 read ambiguously, so I derived the order from the bevel triangle split (N, B_i, M) / (N, M, B_j) and checked that the Z-shaped 30 mm wall and the 20 degree wedge give simple outlines.

## Tests (TDD)
- RED: `yarn vitest run --project engine resources/js/engine/plan/__tests__/walls.test.ts` -> "Failed to load url ../walls ... Does the file exist?" (no tests ran), expected: module missing.
- GREEN: same command -> `Test Files 1 passed (1) / Tests 25 passed (25)`.
- Full engine project: 23 files, 631 tests passing. `yarn eslint resources/js/engine` clean, `yarn prettier --check resources/js/engine` clean, `yarn vue-tsc --noEmit` clean.
- Tests: one `it` per 04 §3.9 row (L 115, L 230/115, T, X, collinear equal and 230/115, acute 20 degrees, 30 mm wall, dangling, overlap, 4 quadrants + 15 degree arm) plus graph skip issues, no-mutation, unknown node, insertion-order independence, tessellation (union area = sum within 0.1 %, CW, >= 4 finite vertices, no self-intersection, no fallback, no -0) for makeRectPlan(5000,4000,230), makeLPlan(), makeGridPlan(7,6), left-face-above-centre-line, and the corners-crossed fallback.

## Concerns / interpretation calls
1. Self-intersection fallback (deviation, extension of 04 §3.4): `buildWallOutline` also falls back to the rectangle (`fallback: true`) when the mitered ring properly self-crosses. Reason: a 30 mm wall in a U shape (both inner wedges bevelled) produces a bow-tie with the spec's via rule, which would break union/triangulation downstream. The spec's "Z" case (and all fixtures) stay non-fallback. Task 10 should emit `outline_fallback` whenever `fallback` is true.
2. Brief says the L-corner 230 vs 115 "outlines include the node as a via". The node is in `WallEnd.via` (spec step 6: N omitted only for equal thickness) but it lies on the diagonal between the two miter corners, so §3.4's `simplifyCollinear` removes it from the final outline ring (outlines are 4-vertex quads). The test asserts the via and the 4-vertex outline, not N in the ring.
3. DeriveIssue `code` is the short code ('wall_skipped'), matching `DERIVE_ISSUE_CODES`; messageKey is `engine.plan.derive.<code>`. Acute V (equal thickness, 1000 mm arms) bevels both wedges (|P-N| = 331 > 230); overlapping outlines there are expected, only simplicity is asserted.

## Files
- /home/user/furny-p2/resources/js/engine/plan/walls.ts
- /home/user/furny-p2/resources/js/engine/plan/__tests__/walls.test.ts
- /home/user/furny-p2/resources/js/engine/index.ts
