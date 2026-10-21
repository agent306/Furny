# Task 15 report: wall graph building

Status: DONE_WITH_CONCERNS (see Concerns).

## Implemented
- `vision/app/schemas/candidates.py`: `WallSource`, `RawWall`, `WallCandidate`, `GapCandidate`, `WallGraph`
  (frozen slotted dataclasses like the other candidate types; the brief names `Pt`-based fields, not pydantic).
- `vision/app/pipeline/graph.py`: `build_wall_graph(raw, *, r, t_median, L, check_deadline=None)` and `EVIDENCE`.
- `vision/tests/test_graph.py`: 41 tests.

Pipeline (all deterministic; raw walls are canonically sorted first, float sums use `math.fsum`):
1. Validate (non-finite coordinates/thickness/openings/params -> `ValueError`), drop zero-length walls, orient
   each wall canonically, convert `openings_px` to world segments (so every later geometry change re-bases for free).
2. Fuse collinear overlapping detections (direction within 3 deg, both ends of the shorter within
   `max(1, 0.5 * max(t_a, t_b))` of the longer's line, overlap >= `min(r, 0.5 * shorter)`). Candidate pairs come
   from 3-degree direction buckets + sorted offset windows (chunked, bounded memory), not all pairs. Strongest
   source wins, thickness is length-weighted, openings are unioned.
3. Cluster endpoints within `r` (KD tree + union-find). Walls whose ends fall into one node are dropped.
4. Extend free ends (degree-1 nodes) along the wall direction up to `r + t_median` onto the nearest other centre
   line (hit parameter allowed `r` beyond the target's ends; targets within 15 deg of parallel are ignored), then
   re-cluster, so hits near an existing node join it (L closure) and others become T nodes.
5. T split: a wall is split at each node within `r` of its centre line, interior and farther than `r` from its own ends.
6. Dedupe on node pair (strongest source, openings unioned), prune walls shorter than `max(2 t, 0.01 L)` that do not
   bridge two components (dangling ones cascade; non-bridges shortest first; verified bridges are never rechecked),
   and undo a T split whose stem was pruned.
7. Node placement (06 8.1): x = mean x of incident vertical walls (wall x = mean of its endpoints' x), y = mean y of
   horizontal ones. Diagonal walls (more than 3 deg off an axis; this is the step-7 tolerance, graph.py has no theta0)
   fix a coordinate that no axis wall fixes by least squares: the other coordinate is solved given the fixed one; with
   no axis wall, the 2x2 least-squares intersection of the diagonal centre lines. Fallback to the centroid of the
   clustered endpoints when lines are within 10 deg of parallel or the solution lies more than `2 r` from the centroid.
8. Ids: nodes sorted by `(y, x)` -> `N1..`; walls by `(min y, min x, a rank, b rank)` -> `W1..`; `a` is the node
   that sorts first. `openings_px` are projected onto the final `a -> b` line, clipped, merged, slivers < 1 px dropped;
   `gaps` repeat them as `GapCandidate(wall_id, u0, u1)`. `evidence` from `EVIDENCE`; `free_ends` counts ends on degree-1 nodes.

## TDD evidence
RED (tests written first, module absent):
`uv run pytest tests/test_graph.py -q` -> `ModuleNotFoundError: No module named 'app.pipeline.graph'`, 1 collection error.
GREEN: `uv run pytest tests/test_graph.py -q` -> `41 passed`.
Mutation check (module copy mutated one rule at a time, tests must fail): removing T split, extension, overlap merge,
dedupe, pruning, split rejoin, axis placement, least squares, opening clipping, canonical sort, parallel guard, bridge
test each fail at least one test. (Only `fsum -> sum` is not caught: small sums are equal in practice.)

## Quality gates (from /home/user/furny-p3/vision)
- `uv run ruff check .` clean; `uv run ruff format --check .` clean; `uv run mypy app` clean.
- `uv run pytest -q` -> 578 passed, 1 skipped (40 s).

## Performance
- 32x32 jittered lattice (1984 walls) + 16 extras = 2000 raw walls: ~0.05 s (test limit 2 s).
- Stress runs (not committed): 2000 stacked overlapping 900 px walls 0.8 s; 2000 random 3000 px walls (15.5k walls
  after splits) 1.7 s; 2000 random short walls 0.06 s; stub comb 0.01 s.
- No O(n^2) over all pairs: KD trees over sampled segment points (T split, extension), sorted offset windows (merge).

## Files changed
- vision/app/schemas/candidates.py, vision/app/pipeline/graph.py (new), vision/tests/test_graph.py (new)

## Concerns
1. Pruning follows the spec literally: a short wall (< `max(2t, 0.01 L)`) lying on a cycle is removed, even when it is
   a real narrow pier or the small piece a T split creates next to a corner. That can open a closed room by one wall.
   Task 16 should therefore keep real short walls out of the graph or the threshold may need revisiting at Task 34.
2. Near-axis means within 3 deg of the image axes (`graph.py` has no `theta0`); a rotated plan whose walls were not
   rectified would be treated as diagonal everywhere (nodes then use centroid/least squares, still valid).
3. Extension reach is `r + t_median` (not per-wall thickness); the brief signature has only `t_median`.
4. `openings_px` slivers shorter than 1 px (after clipping to a final wall) are dropped; an opening cut by a split is
   kept on both halves when each part is >= 1 px.
5. Pathological stacks of thousands of identical endpoints still make `cKDTree.query_pairs` quadratic in memory; not a
   realistic input.
6. Task 30 (DXF) can express gaps between runs as `openings_px` on one `RawWall`; runs that are merely collinear but not
   overlapping are not merged by the graph (gaps beyond `r` stay separate walls).

## Fix round 1

Commit: see `git log` (fix(vision): bound graph cost, add theta0, crossings and gap merging).

### Changes
1. **Cost and deadline (Important 1).**
   - `_cluster`: points sharing an `r/2` grid cell are united directly (`_UnionFind`, roots = smallest index); at most 8 extreme points per cell (min/max of x, y, x+y, x-y) enter the KD-tree pair search. Exact for cells of up to 8 points, sub-pixel approximate beyond. 20 000 stacked points: well under 1 s, a few MB.
   - `_merge_overlaps` no longer stores pairs: sorted offset windows per 3-degree bucket are evaluated in bounded chunks and united as found; windows whose partners all share the member's component are skipped (10 000 identical walls 0.16 s; without the skip 0.9 s, and the 20 000-wall test fails the 3 s bound).
   - `check_deadline` is polled in the cluster group/pair loops, the merge window loop, the group loop, the crossing sample blocks, pruning and assembly.
   - `MAX_RAW_WALLS = 20 000`; more raises `TooComplexError(ValueError)` with `.code == "too_complex"` (06 14.2 / 8.7 name it `too_complex`, HTTP 422); the orchestrator (Task 31) maps it. The crossing stage also raises it when more than 50 M sample pairs are candidates.
   - Tests: 20 000 stacked points, 10 000 stacked-end walls and 20 000 identical walls each under 3 s and under 300 MB (tracemalloc); stage-level deadline tests for clustering and merging; deadline polled repeatedly.
2. **Core rules pinned (Important 2).** Mean placement for u and v; shallow-angle guards each in its own test: axis wall + 6 degree diagonal with a near intersection (conditioning guard `den < sin^2 10 deg`), axis wall + 12 degree diagonal meeting 25 px away (2r guard), diagonal pair 5 degrees apart with a near intersection (determinant guard), diagonal pair 12 degrees apart meeting far away (2r guard). The conditioning guard of `_solve_free` was tightened from `sin^2(3 deg) * 0.1` (unreachable) to the same 10 degree limit as the pair case so it is testable. Each guard was removed in scratch (`scratchpad/mutw`) and a test fails.

### Rulings applied (log each in spec 19)
3. **Pruning:** only dangling short walls (a free end, cascading via a stack) are removed; short walls on cycles or bridging parts are kept; bridge-verification code deleted; `test_short_wall_inside_a_cycle_is_removed` replaced by `test_short_wall_on_a_cycle_is_kept`. The unsplit-after-prune rejoin stays. (Spec 06 8.1 step 9 last bullet is amended: "that do not connect two otherwise-unconnected parts" is not applied to cycles.)
4. **theta0:** `theta0_deg: float = 0.0` keyword; taken modulo 90 (89 == -1 == 179). `_Frame` rotates; `_make_line`, `_direction`, `_place_nodes` work in the rotated frame ("h" along theta0, "v" along theta0 + 90). Ids keep the image-frame (y, x) order, so on a rotated plan node ids match the unrotated graph but wall ids can be permuted (the test matches walls by node pair).
5. **X crossings:** `_split_crossings` after the T split: proper crossings inside both walls and more than `r` from the four ends split both walls at one shared node; crossing points within `r` share a node; walls sharing a node are not candidates; ends of walls at nodes of degree > 16 are trimmed by `r * degree / 16` (capped at 45 % of the length) so fans do not enumerate all pairs.
6. **Gaps within r:** collinear walls (angle within 3 degrees, perpendicular offset at most `0.5 * t_median`) whose facing ends are within `r` fuse into one wall and the gap (if at least 1 px) becomes an `openings_px` interval; overlapping facing ends fuse without an opening. Extra guard (not in the ruling): a gap is not bridged when a wall that is not collinear with the pair has an end near it (a junction, e.g. a T between two collinear halves), otherwise a T junction would become a door. Pairs with a gap in (0, r] and walls overlapping by less than `min(r, 0.5 * shorter)` now fuse instead of sharing a degree-2 node.

### Minors
7. Axis snap (`u`, `v`) is trusted only within `2 r` of the endpoint centroid. Note: the guard is 2r as ruled; "never moved by more than r" cannot hold with a 2r guard, so the maximum shift is 2r.
8. Mutants pinned by tests: nearest-hit extension, hit-parameter window (both sides), 15 degree parallel guard, T-split distance bound, dedupe unions openings, length-weighted thickness and offset, collinear 3 degree limit (both directions), sliver rule (0.9 dropped, 1.0 kept), 0.01 L and 2t prune thresholds, near-axis 3 degrees (2.8 vs 3.3), `theta0` modulo, axis guard for u and v, gap offset limit uses `t_median` (also for thicker walls), extension never trims an overshooting end (r = 20 case). Equivalent or unreachable mutants (documented, not pinned): T-split own-end guard (killed only indirectly by the fan test; with cluster radius = guard radius it matters only when placement shifts nodes), the "backward ray" case when the overshoot stub is shorter than 2t (crossing split + dangling prune yields the same T), crossing end-distance check (a T split already made the node), `shares` check (removed: dead code), skip of re-checking dangling status on pop in pruning.
9. **No chain drift:** each union-find component fuses only members collinear with its longest wall (angle and perpendicular offset); the rest stay unchanged. The 2000-spoke fan stays above 1000 walls at stage level; a ten-piece 15 degree drift chain does not become one wall.
10. Docstring determinism claim corrected (ids/nodes/topology exact, opening values ulp-level under endpoint flips); helpers in tests are type-annotated, no `type: ignore` comments remain.

### Notes / concerns
- Single-linkage clustering turns a dense fan's far ends into one arc node, so a full 2000-spoke fan collapses into one node pair after clustering (the overlap merge itself does not collapse it); this is inherent to the spec's union-find rule.
- Pathological density: 2000 random 3000 px walls (27 k walls after crossings) take about 4.5 s; the deadline check applies.
- Reviewer fuzz (`rv15/fuzz.py`, 400 plans): no exceptions, no permutation differences, no invariant violations; "tiny_wall" count is 6 because short walls on cycles are now kept by ruling 3.

### Evidence
- `uv run pytest tests/test_graph.py -q` -> 85 passed; full suite `uv run pytest -q` -> 622 passed, 1 skipped; ruff check, ruff format --check, mypy clean.
- Mutation run (scratch copy, 46 mutants): all killed except the equivalent/defensive ones listed above (and tick-removal mutants, which the stage-level deadline tests cannot tell apart from the other tick sites).

## Fix round 2

### Changes
1. **Deadline polling (Important 1).**
   - `build_wall_graph` wraps `check_deadline` in `_throttled` (the first call always runs, then at most every 20 ms) and block-structured loops now call `_poll` on every block instead of `_tick` on a modulus: merge window blocks, per-group fusing, extension and T-split candidate loops, `_SegIndex.near` (chunks of 1024 points), crossing sample blocks, estimate chunks, gap-blocking chunks. Per-item loops with cheap iterations keep `_tick`.
   - `junction_between` is replaced by a vectorised `blocked`: for every chunk of 1024 gap pairs it takes the 32 nearest wall samples around the gap centre (one KD query) and tests, with arrays, whether a non-collinear wall has an end within `gap/2 + r` or properly crosses the gap segment. It polls per chunk. Cost is bounded per pair; in dense stacks only the 32 nearest samples are examined (documented limit).
   - `_SegIndex` caps its sample count (`_MAX_SAMPLES` = 400 000) by widening the spacing, so no single uninterruptible KD build exceeds ~0.2 s (the T-split index of 10 000 long walls had 1.7 M samples, 0.7 s). Callers use `index.step`.
   - Probes (budget 1 s): star 10k aborts at 1.01 s (was 39 s), 20k near-parallel 1.01 s (was 6.4 s), 5000+5000 grid raises `TooComplexError` at 0.9 s, 10k fan raises `TooComplexError` at 0.8 s. `test_every_stage_aborts_within_a_second_of_the_deadline` asserts < 2.0 s for these four inputs (budget 1 s).
2. **Crossing pre-check and output bound (Important 2).**
   - `count_neighbors` is gone. `_estimate_pairs` histograms the sample points on a grid of side `index.step` (chunked, polled) and sums `count x neighbourhood count`; above `_MAX_CANDIDATE_PAIRS` (150 M, about 3x the true pair count) it raises.
   - `_check_crossing_load` runs right after the first clustering, before any index is built: `_estimate_split_walls` counts crossings exactly for a deterministic sample of at most 128 walls against all walls (same rules as the real stage: walls over 2r, no shared node, crossing inside both trimmed intervals and more than r from the ends) and scales to `n + 2 x crossings`. More than `MAX_RAW_WALLS` raises `TooComplexError`.
   - The real stage also counts the distinct crossing pairs found block by block and raises as soon as `edges + 2 x pairs > MAX_RAW_WALLS`.
   - Crossings must now lie inside both walls' trimmed intervals (hub trim) in the exact test as well as in candidate generation, so the hub rule is consistent.
   - 250x250 crossing grid: `TooComplexError` in 0.01 s; 5000 random 1500 px walls: 0.13 s; peak traced memory under 300 MB for both (test). A 40x40 grid (3 200 walls) is still split completely.

### Rulings applied (log each in spec 19)
3. **Minimum bridged gap:** a gap between facing collinear ends below `1.5 * t_median` merges silently (no opening); at least `1.5 * t_median` becomes an `openings_px` interval (06 8.1 step 8). Tests: t = 12, r = 24: 3 px and 17.5 px close silently, 20 px gives an opening (400 to 420). Existing 15 px gap with t = 6 still opens.
4. **No bridging across a crossing wall:** `blocked` refuses a gap when any non-collinear wall properly crosses the gap segment (or has an end near it). Test: a through wall across a 15 px gap gives two horizontal walls and a split through wall, no opening.

### Pins (item 5)
- merge loop poll: the deadline test covers it, but the poll is redundant with the polls in the pair-union loop and the group loop, so a mutant removing it still passes (equivalent in effect, kept because the old modulus was the reported bug).
- crossing cap: three tests via monkeypatch (estimate rejects before any `_SegIndex` exists; with both estimates disabled the actual-count exit raises; a low `_MAX_CANDIDATE_PAIRS` makes the pair estimate raise) plus the 40-grid pass and 110-grid raise tests and a pair-estimate upper-bound test.
- hub trim: 16 spokes (crossing at 18 px counted) vs 64 spokes (ignored), for the hub at either end of the crossed spoke (mirrored plan).
- 3 degree crossing threshold: 2 degrees not split, 4 degrees split (long walls so the crossing is interior).
- crossing points within r share one node: three walls crossing within 1.5 px of each other give 7 nodes and 6 walls.
- rotated free-end extension: theta0 = 17 plan equals the unrotated graph rotated (nodes, free ends); `_direction` has a direct unit test per kind (the integration case is insensitive because node placement erases the exact hit point).
- also: `_SegIndex` sample bound, `_throttled`, and the number of real checks in a build is bounded by elapsed / 20 ms.

### Evidence
- `uv run pytest tests/test_graph.py -q` -> 107 passed; `uv run pytest -q` -> 644 passed, 1 skipped; ruff check, ruff format --check, mypy clean. Reviewer fuzz `rv15/fuzz.py`: only the expected "tiny_wall" (6/400, ruling 3).
- Mutation run (scratch copy `scratchpad/mutw`, 22 new mutants): all killed after the added tests except the equivalent ones: removing the window-loop poll, the gap-blocking poll, the extension poll and the T-split `near` check (each redundant with another poll on the same path).

### Notes
- Completing (not aborting) 20 000 near-parallel walls still takes about 7 s (the merge stage; interruptible). Star 10k completes in about 2 s.
- Raw walls that cross each other many times inside a hub (jittered stars) are no longer counted by the estimate, so a 2000-spoke star builds (0.15 s).
