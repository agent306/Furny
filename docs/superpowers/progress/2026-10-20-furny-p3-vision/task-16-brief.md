### Task 16: Wall extraction (filled, double-line, single-line, vector) to raw walls and gap candidates

**Files:**
- Create: `vision/app/pipeline/walls.py`
- Test: `vision/tests/test_segments_walls.py`

**Spec refs:** `06 §8.1` steps 1–8, `06 §13` (`02-walls.png`), `06 §16.1` (`test_segments_walls.py`)

**Interfaces:**
- Consumes: `Segment`, `merge_collinear`, `dominant_orientation` (Task 13), `DimensionLine` (Task 14), `build_wall_graph` (Task 15), `Preprocessed` (Task 10).
- Produces:
  - `WallExtraction(mask: np.ndarray, source_mask: np.ndarray (uint8 1=filled 2=double 3=single), raw: list[RawWall], theta0: float, t_median: float)`.
  - `extract_walls(page: NormalizedPage, pre: Preprocessed, segments: list[Segment], dimension_lines: list[DimensionLine], ctx) -> WallExtraction`.
  - `walls_to_graph(ext: WallExtraction, region: Rect) -> WallGraph`, which calls `build_wall_graph` with `r = max(t_median, 0.006 L)` and turns `openings_px` intervals into `GapCandidate`s.
  - `debug_walls_png(page, ext, graph) -> np.ndarray`.

- [ ] **Step 1: Write the failing test.** Uses `synth`.
  - `test_filled_rectangle_with_partition`: walls (300,300)–(2100,300)–(2100,1500)–(300,1500) at 14 px, plus a partition (1200,300)–(1200,1500) → graph with 7 walls and 6 nodes, all `source == "filled"`, `thickness_px` 14 ± 2, `free_ends == 0`.
  - `test_double_line_walls`: the same topology drawn `style="double"` (two 2 px lines 14 px apart, hollow) → 7 walls with `source == "double_line"`.
  - `test_single_line_sketch`: only single 2 px lines, so the fill and double masks cover < 0.2 % of the region → walls with `source == "single_line"` and evidence 0.5.
  - `test_gap_candidate`: a 90 px door cut in the partition (t = 14, inside [2.5t, 18t]) → exactly one `GapCandidate` on the partition with `u1 - u0 == 90 ± 4`. A 20 px break is closed instead (< 1.5t merge).
  - `test_dimension_lines_not_walls`: a dimension chain drawn above the plan adds no walls.
  - `test_off_axis_short_dropped_long_kept`: in a plan with θ0 = 0, a 30° diagonal wall ≥ 0.03 L is kept as diagonal and a short 30° stub is dropped.
  - `test_vector_pdf_walls`: a `pdf_vector` page whose `vector.segments` include 5 px stroked lines (t_thin = 1) → walls with `source == "vector"`.
- [ ] **Step 2: Run it, expect FAIL.** Command: `uv run pytest tests/test_segments_walls.py -q`.
- [ ] **Step 3: Implement** per 06 §8.1 steps 1–8.
  - Skeleton tracing uses an 8-neighbourhood pixel graph and `cv2.approxPolyDP`. Spur pruning removes branches shorter than 1.5 × local thickness.
  - The pixel-graph tracer may be iterative over skeleton pixels using `scipy.ndimage` labelling of junction and end pixels.
  - Keep the module free of labeling and scale imports (stage boundary rule I12).
- [ ] **Step 4: Run tests, expect PASS.** Same command as Step 2.
- [ ] **Step 5: Quality gates.** `uv run ruff check . && uv run ruff format --check . && uv run mypy app`
- [ ] **Step 6: Commit.** `git add vision/app/pipeline/walls.py vision/tests/test_segments_walls.py` then `git commit -m "feat(vision): wall extraction from filled, double-line and single-line drawings" -m "$FURNY_TRAILER"`.

---

