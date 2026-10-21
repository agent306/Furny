### Task 9: Wall node joins and mitered outlines

**Files:**
- Create: `resources/js/engine/plan/walls.ts`
- Test: `resources/js/engine/plan/__tests__/walls.test.ts`

**Spec refs:** `04 §3.1–§3.4`, `04 §3.9`, `04 §3.10`

**Interfaces:**
- Consumes: Tasks 3, 5, 8.
- Produces: `WallEnd` (04 §3.1); `buildWallGraph(doc: PlanDocument): WallGraph` with `WallGraph { valid: Map<string, { wall: Wall; A: Vec2; B: Vec2; d: Vec2; n: Vec2; length: number }>; incident: Map<string, string[]>; issues: DeriveIssue[] }` (skips missing-node / `a === b` / length < `EPS` walls with `engine.plan.derive.wall_skipped`); `computeNodeJoins(nodeId: string, g: WallGraph): Map<string, WallEnd>`; `buildWallOutline(info, endA: WallEnd, endB: WallEnd): { outline: Vec2[]; fallback: boolean }`; `computeAllWallEnds(g): Map<string, { endA: WallEnd; endB: WallEnd }>`; `DERIVE_ISSUE_CODES = ['wall_skipped','outline_fallback','opening_skipped','opening_clamped','opening_in_junction','room_meta_duplicate']`.

- [ ] **Step 1: Write the failing tests** — one `it` per row of 04 §3.9 using tiny hand-built documents (115 mm unless stated):
  - L-corner `(0,0)→(1000,0)`, `(1000,0)→(1000,1000)`: both outlines have 4 vertices, share outer corner `(1057.5,-57.5)` and inner corner `(942.5,57.5)` (same coordinates), `joint === 'miter'`.
  - L-corner 230 vs 115: outlines include the node `(1000,0)` as a via; `area(union(outlines))` = Σ outline areas (±0.1 %).
  - T-junction (through `(0,0)→(1000,0)`, `(1000,0)→(2000,0)`, stem `(1000,0)→(1000,1000)`): through pieces share `(1000,-57.5)`; stem corners `(942.5,57.5)` and `(1057.5,57.5)`; the three outlines tessellate (union area = sum); `joint === 'junction'`.
  - X-junction (4 arms of 1000 from `(0,0)`): four inside corners `(±57.5,±57.5)`; every outline contains `(0,0)`.
  - Collinear equal: corners coincide at x = 1000, y = ±57.5. Collinear 230/115: perpendicular step at the node.
  - Acute 20° wedge: `joint === 'bevel'`, via contains the midpoint `M = (B_i + B_j)/2`.
  - 30 mm wall between two L-corners: bevel by the half-length rule; outline simple (O(n²) edge-crossing check).
  - Dangling `(0,0)→(1000,0)` t = 100: outline equals `[(0,-50),(1000,-50),(1000,50),(0,50)]` up to the choice of start vertex (CW), `joint 'free'`.
  - Two walls with identical outgoing direction (overlap): no throw, finite output.
  - Node with walls in all 4 quadrants plus a 15° acute one: every output coordinate `Number.isFinite` (review focus 2).
  - Tessellation for `makeRectPlan(5000,4000,230)`, `makeLPlan()`, `makeGridPlan(7,6)`: union area of all outlines = Σ areas within 0.1 %; every outline CW, ≥ 4 finite vertices, no self-intersection; the left face of a wall drawn left→right on screen has smaller y than its centre line.
- [ ] **Step 2: Run it, expect FAIL** — `yarn vitest run resources/js/engine/plan/__tests__/walls.test.ts`
- [ ] **Step 3: Implement** — 04 §3.3 steps 1–7 exactly (sort by outgoing angle, ties by wall id; wedge corner via `lineIntersection`; miter validity = `MITER_LIMIT` + half-length rule; corners shared as the same value object; via ordering for ends A and B; omit `N` for clean 2-wall equal-thickness miters); 04 §3.4 assembly + `simplifyCollinear` + `ensureCW` + rectangle fallback flagged `fallback: true`.
- [ ] **Step 4: Run tests, expect PASS** — same command.
- [ ] **Step 5: Quality gates** — `yarn eslint resources/js/engine && yarn prettier --check resources/js/engine && yarn vue-tsc --noEmit`
- [ ] **Step 6: Commit** — `git add resources/js/engine/plan/walls.ts resources/js/engine/plan/__tests__/walls.test.ts resources/js/engine/index.ts` → `feat(engine): compute wall node joins and mitered outlines`

