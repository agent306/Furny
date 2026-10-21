### Finding Verdicts

- **Important 1: moveWall finalize neighbour splitting untested** — ADDRESSED. Test "splits what a sliding neighbour now crosses, both walls" (moves.test.ts, moveWall/finalize) asserts 3 walls without finalize and 5 with, and the moved wall itself crosses nothing. Mutant `touched.slice(0, 1)` is killed (scratch re-run).
- **Important 2: moved-wall offset under length change untested** — ADDRESSED. Test "the moved wall keeps its offsets when its length changes (45 degree neighbours)" (lengths 4000 and 2000, offset stays 1000). Mutant reclamp `'both'` to `'a'` is killed.
- **Important 3: determinism untested** — ADDRESSED. New describe "finalize: ties and order": forward and reversed insertion give identical documents, ids and results; equidistant nodes and equidistant walls resolve to the smaller id. Mutants killed: unsorted `wallsAt`, no node tie-break, no wall tie-break. Unsorted `touchedWalls` still survives, but it is not an insertion-order hole (the Map is filled from the already-sorted `wallsAt` per end), so that is acceptable.
- **Minor: splitIntersections after node merge untested** — ADDRESSED. Test "walls that reach the merge target are split where they now cross another wall"; mutant without the post-merge split is killed.
- **Minor: boundary mutants (wall tolerance, u at 10 mm)** — ADDRESSED. Tests "exactly 5 mm ... 6 mm is not" and "projecting exactly 10 mm ... 11 mm splits" (both ends); mutants `wall tol >=` and `u <` are killed. The node-tolerance `>=` boundary is still masked, as before; not worth pursuing.
- **Minor: Graph/planBus/ok/refused/oneWall copied across test files** — ADDRESSED. `plan/testing/graph.ts` is shared; no `class Graph`, `planBus` or `refused` copies remain in helpers/walls/moves tests (grep). walls.test.ts keeps a one-line `oneWall` wrapper.
- **Minor: unchecked `as Map` cast in moveWall run** — ADDRESSED. moves.ts (run) now throws `CommandAbort(moves)` on a non-Map.
- **Minor: setWallLength `out_of_range` reported on `to.x`** — ADDRESSED. `lengthTarget` computes the longest length that stays in range and reports `field: 'length'`, `max: longest`; test covers 900 000 + 100 000 allowed, 200 000 refused with max 100 000; mutant without the reach check is killed.
- **Minor: unsealed finalize carry (P4 seal after finalize)** — ADDRESSED as a note. Recorded in the fix report's carry list; the controller should copy it into progress.md.
- **Minor: neighbour reversal accepted** — ADDRESSED. `checkWallMove` refuses `wall_too_short` when `dot(now, was) <= 0` for every neighbour (controller ruling: all neighbours); test with `makeRectPlan(5000,300,230)` at -310 (refused, length 10, wall is not the moved one) and -290 (allowed). Mutant "no flip check" is killed. `dot < 0` would survive, which is fine (exactly 90 degree turn).
- **Minor: integer length drift (0.7 mm)** — ADDRESSED as a note for spec 19, as requested.
- **Ruled item (setWallLength self-merge)** — verified for completeness: `setWallLength` validate resolves the snap target and refuses `wall_too_short` when fixed end to snap point is under 10 mm (snap onto the fixed end, or onto a node under 10 mm from it). Both new tests fail without it (mutant killed).

### New Breakage in the Fix Diff

None Critical or Important.

- Minor (residual, not introduced by the fix): the flip refusal excludes the moved wall itself (moves.ts, `checkWallMove`, `w.id !== wall.id`). With neighbours that converge on the move side and are longer than the apex distance, the moved wall can pass the apex and reverse. Probe: wall (0,0)-(1000,0), neighbours to (-1000,1000) and (2000,1000), moved by 800 with finalize: accepted, a-to-b dx becomes -600, neighbours cross and are split, no validate errors. The wall's +n side and opening offsets are then mirrored. Reasonable to log in spec 19 next to the neighbour-reversal rule; not a blocker.
- Minor (behaviour note): `setWallLength` whose moved end snaps onto the far node of a coincident duplicate wall folds the target wall into the duplicate (smaller id kept), so the wall id from the call can disappear. Probe: f(0,0), x(3000,0), m(5000,0), w1 = f-x, w2 = f-m, setWallLength(w2, 3002, 'a') removes w2. This is the existing moveNode duplicate-fold behaviour and the geometry is unchanged; worth one line in spec 19 with `movedNodeId` possibly gone.

### Out-of-Scope Observations

None.

### Verdict

**Fix round:** All findings addressed, no new Critical/Important breakage.

Checks run: scratch mutation re-run of 13 mutants against `moves.test.ts` (non-random, 82 tests; 11 killed, 2 survive as described above: unsorted `touchedWalls`, `dot < 0`), scratch probes for moved-wall reversal and duplicate fold. Worktree untouched. Report claims checked against the diff: 82 tests in moves.test.ts, shared builders, random-test trim (`simulate(seed, iterations)` 50 / 3 x 30).
