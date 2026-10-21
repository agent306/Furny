### Task 15: Wall graph building

**Files:**
- Create: `vision/app/pipeline/graph.py`
- Modify: `vision/app/schemas/candidates.py` (add `RawWall`, `WallCandidate`, `GapCandidate`, `WallGraph`)
- Test: `vision/tests/test_graph.py`

**Spec refs:** `06 §8.1` steps 9–10

**Interfaces:**
- Produces:
  - `RawWall(p0: Pt, p1: Pt, thickness_px: float, source: WallSource, openings_px: tuple[tuple[float, float], ...] = ())`, where `WallSource = Literal["filled", "double_line", "single_line", "vector"]`.
  - `WallCandidate(id: str, a: Pt, b: Pt, a_node: str, b_node: str, thickness_px: float, source: WallSource, evidence: float, free_ends: int, openings_px: tuple[tuple[float, float], ...])`, where intervals are measured along the centreline from `a`.
  - `GapCandidate(wall_id: str, u0: float, u1: float)`.
  - `WallGraph(nodes: dict[str, Pt], walls: list[WallCandidate], gaps: list[GapCandidate])`.
  - `build_wall_graph(raw: list[RawWall], *, r: float, t_median: float, L: float) -> WallGraph`.
  - `EVIDENCE = {"filled": 1.0, "vector": 1.0, "double_line": 0.85, "single_line": 0.5}`.

- [ ] **Step 1: Write the failing test.** Pure coordinates, no images.
  - `test_rectangle_jitter`: 4 walls of a 1000×600 rectangle with endpoints jittered ±3 px, `r=8` → 4 nodes, 4 walls, `free_ends == 0` everywhere. Node x is exactly the mean of the vertical walls' x, and node y the mean of the horizontal walls' y.
  - `test_t_junction_split`: add a vertical wall from the top wall's midpoint down to the bottom → 7 walls and 6 nodes, with the top and bottom walls split at shared nodes.
  - `test_l_closure_extension`: a free end 10 px short of another wall's centreline, with `r=6, t=12` → extended; the junction is shared and `free_ends == 0`.
  - `test_duplicates_removed`: two walls on the same node pair → 1.
  - `test_short_wall_removed_unless_bridging`: a 15 px stub with `t=12` (< 2t = 24) that dangles is removed; a 15 px wall joining two otherwise separate parts is kept.
  - `test_ids_deterministic`: the same input in shuffled order gives the same `W1…`/`N1…` ids and coordinates.
  - `test_evidence`: source `double_line` → evidence 0.85.
- [ ] **Step 2: Run it, expect FAIL.** Command: `uv run pytest tests/test_graph.py -q`.
- [ ] **Step 3: Implement** per 06 §8.1 step 9.
  - Union-find over endpoints. Axis-aligned node placement. Extend free ends by up to `r + t` to the nearest centreline. T-split. Dedupe. Short-wall pruning with a connectivity check (bridge test via component count).
  - Ids are assigned after sorting nodes by `(y, x)` and walls by `(min y, min x)` of their endpoints.
  - `openings_px` of merged raw walls are carried through and re-based onto the final wall's `a`.
- [ ] **Step 4: Run tests, expect PASS.** Same command as Step 2.
- [ ] **Step 5: Quality gates.** `uv run ruff check . && uv run ruff format --check . && uv run mypy app`
- [ ] **Step 6: Commit.** `git add vision/app/pipeline/graph.py vision/app/schemas/candidates.py vision/tests/test_graph.py` then `git commit -m "feat(vision): wall graph building with junction snapping" -m "$FURNY_TRAILER"`.

---

