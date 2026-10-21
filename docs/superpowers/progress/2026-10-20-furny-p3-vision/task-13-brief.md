### Task 13: Line segments, collinear merge, dominant orientation

**Files:**
- Create: `vision/app/pipeline/segments.py`
- Modify: `vision/app/schemas/candidates.py` (add `Segment`)
- Test: `vision/tests/test_segments.py`

**Spec refs:** `06 §7.9` (all steps, including dominant orientation)

**Interfaces:**
- Consumes: `detect_line_segments`, `seg_angle_deg` (Task 9), `Preprocessed` (Task 10), `OcrResult` (Task 12).
- Produces:
  - `@dataclass(frozen=True, slots=True) Segment(id: str, p0: Pt, p1: Pt, width_px: float, is_thin: bool, source: Literal["lsd", "hough", "vector"])`, with properties `length` and `angle_deg`.
  - `detect_segments(page: NormalizedPage, pre: Preprocessed, ocr: OcrResult, ctx) -> list[Segment]`.
  - `merge_collinear(segs: list[Segment], *, angle_tol_deg: float = 1.5, dist_tol: float = 2.0, gap_tol: float = 4.0) -> list[Segment]`.
  - `dominant_orientation(segs) -> float` in [0, 90).

- [ ] **Step 1: Write the failing test.** Synthetic images come from `synth.render_plan`.
  - `test_rectangle_outline`: a single-line 2 px rectangle 800×500 → after merge, exactly 4 segments with length > 400, each within ±1° of 0° or 90°.
  - `test_merge_small_gap`: a horizontal line with a 3 px break → 1 segment; with a 12 px break → 2 segments.
  - `test_width_attached`: a 6 px filled line → `width_px` within 6 ± 1 and `is_thin is False` (t_thin = 2). A 2 px line → `is_thin is True`.
  - `test_min_length`: segments shorter than `max(8, 0.008 L)` are dropped.
  - `test_text_painted_white`: a word drawn over a line region produces no segments from the glyph strokes (all kept segments have length > 0.02 L).
  - `test_theta0`: a drawing rotated 5° → `dominant_orientation ≈ 5.0 ± 0.5`.
  - `test_vector_segments`: a `pdf_vector` page uses `page.vector.segments` mapped through `page.transform`, with `source == "vector"`.
- [ ] **Step 2: Run it, expect FAIL.** Command: `uv run pytest tests/test_segments.py -q`.
- [ ] **Step 3: Implement** per 06 §7.9.
  - Ids are `S{n}` after sorting by `(min y, min x)`.
  - Merging uses union of projections onto the longer segment's direction. For thick strokes the perpendicular tolerance is `0.5 × width`.
- [ ] **Step 4: Run tests, expect PASS.** Same command as Step 2.
- [ ] **Step 5: Quality gates.** `uv run ruff check . && uv run ruff format --check . && uv run mypy app`
- [ ] **Step 6: Commit.** `git add vision/app/pipeline/segments.py vision/app/schemas/candidates.py vision/tests/test_segments.py` then `git commit -m "feat(vision): LSD segments with collinear merge and dominant orientation" -m "$FURNY_TRAILER"`.

---

