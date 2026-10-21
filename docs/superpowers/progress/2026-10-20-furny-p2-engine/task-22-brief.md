### Task 22: Plan command helpers

**Files:**
- Create: `resources/js/engine/plan/commands/helpers.ts`
- Test: `resources/js/engine/plan/commands/__tests__/helpers.test.ts`

**Spec refs:** `04 §6.5`

**Interfaces:**
- Consumes: Task 21 (`PlanCommandContext`, `CommandOutput`), Tasks 3, 9.
- Produces: `EndpointRef = { nodeId: string } | { point: Vec2 }`; `WallProps`; `resolveEndpoint(d, ref, ctx, out): string`; `splitWallAt(d, wallId, point, ctx, out): string`; `insertWallSegment(d, fromNodeId, toNodeId, props, ctx, out): { wallIds: string[]; lastNodeId: string }`; `splitIntersections(d, wallId, ctx, out): void`; `mergeNodeInto(d, srcNodeId, dstNodeId, ctx, out): void`; `reclampOpenings(d, wallId, movedEnd: 'a'|'b'|'both'|'none', oldLength): void`; `nextOpeningLabel(d, kind: 'door'|'window'): string`; `wallLength(d, wallId): number`.

- [ ] **Step 1: Write the failing tests** (run inside `mutative.create` on test builders with `testIds()`): `resolveEndpoint` reuses a node 3 mm away, splits a wall whose centre line is 3 mm away (T node created, original wall keeps its id and becomes `a → N`, new wall `N → b` copies props), otherwise creates a rounded node; `splitWallAt` through an opening interval aborts `split_through_opening`; openings beyond the split move to the new wall with `offset − dist(A,N)`; attached placements beyond `u` re-attach to the new wall, same side; `insertWallSegment` across an existing wall splits both (4 walls share one new node), joins an existing node within 5 mm of the segment interior, creates only the uncovered part of a collinear overlap, aborts `wall_duplicate` when fully covered and `wall_too_short` under 10 mm, returns wall ids ordered from→to; `splitIntersections` splits both crossing walls; `mergeNodeInto` deletes degenerate walls with their openings, keeps the smaller id of a duplicate pair and transfers fitting openings, appends deleted ids to `out.deletedIds`; `reclampOpenings` with `movedEnd 'a'` keeps the distance to node b (`offset = newLength − (oldLength − offset)`), aborts `opening_no_fit` when width > length and `opening_overlap` when clamped openings collide; `nextOpeningLabel` → `'D3'` after `D1`,`D2`, `'W1'` with none, ignores `'Dx'`.
- [ ] **Step 2: Run it, expect FAIL** — `yarn vitest run resources/js/engine/plan/commands/__tests__/helpers.test.ts`
- [ ] **Step 3: Implement** — 04 §6.5 descriptions verbatim; all writes rounded with `roundPoint`; aborts via `CommandAbort` with `engine.plan.command.*` messages.
- [ ] **Step 4: Run tests, expect PASS** — same command.
- [ ] **Step 5: Quality gates** — `yarn eslint resources/js/engine && yarn prettier --check resources/js/engine && yarn vue-tsc --noEmit`
- [ ] **Step 6: Commit** — `git add resources/js/engine/plan/commands` → `feat(engine): add wall graph editing helpers for plan commands`

