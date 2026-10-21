### Task 10: Preprocess (binarize, colour analysis, stroke width, style, thick mask, plan region) and synthetic drawing generator

**Files:**
- Create: `vision/app/pipeline/binarize.py`, `vision/app/pipeline/region.py`, `vision/tests/support/synth.py`
- Test: `vision/tests/test_preprocess.py`

**Spec refs:** `06 §7.6`, `06 §7.3` (illumination flattening for photos)

**Interfaces:**
- Consumes: `NormalizedPage`, `flatten_illumination`, `Rect`, `odd` (Task 9).
- Produces, in `binarize.py`:
  - `Preprocessed(gray, ink, dark, thick, dt, t_thin: float, colorfulness: float, drawing_kind: DrawingKind, region: Rect)`. `dt` is `cv2.distanceTransform(ink, DIST_L2, 3)`.
  - `preprocess(page: NormalizedPage, ctx) -> Preprocessed`.
  - Helpers `sauvola_window(long_edge: int) -> int`, `thick_kernel(t_thin: float) -> int`, `stroke_width_mode(ink) -> float`.
- Produces, in `region.py`: `detect_plan_region(thick, ink, ctx) -> Rect`.
- Produces, in `tests/support/synth.py` (reused by Tasks 13–21, 31):

  ```python
  @dataclass
  class SWall:
      a: tuple[int, int]; b: tuple[int, int]; thickness: int = 12
      style: Literal["filled", "double", "single"] = "filled"; color: tuple[int, int, int] = (0, 0, 0)

  @dataclass
  class SDoor:
      wall: int; u0: int; width: int; hinge: Literal["start", "end"] = "start"; side: Literal[1, -1] = 1; double: bool = False

  @dataclass
  class SWindow:
      wall: int; u0: int; width: int; lines: int = 2; offset_sashes: bool = False

  @dataclass
  class SText:
      text: str; org: tuple[int, int]; scale: float = 1.2; thickness: int = 2; vertical: bool = False

  @dataclass
  class SDimChain:
      start: tuple[int, int]; axis: Literal["x", "y"]; ticks: list[int]; labels: list[str]; tick_style: Literal["slash", "bar"] = "slash"

  def render_plan(size: tuple[int, int], walls=(), doors=(), windows=(), texts=(), dims=(),
                  fills: Sequence[tuple[list[tuple[int, int]], tuple[int, int, int]]] = (),
                  background=(255, 255, 255), line_px: int = 2) -> np.ndarray  # BGR uint8
  ```

  Door and window cutouts are erased from the wall (`u0` along a→b), arcs are drawn on side `side·n` with `n = (d.y, −d.x)`, and the leaf line is drawn perpendicular from the hinge. `DimChain` ticks are positions along the axis, labels are drawn centred between consecutive ticks (`cv2.putText`, rotated 90° when the axis is `y`), and each tick gets a 45° slash of 16 px.

- [ ] **Step 1: Write the failing test.**
  - `test_sauvola_window`: `sauvola_window(2000) == 33`, `(600) == 15`, `(6000) == 81`.
  - `test_thick_kernel`: `thick_kernel(2.0) == 5`, `(0.5) == 3`, `(10) == 15`.
  - `test_line_drawing_style`: a synthetic 2000×1500 plan with filled walls of 14 px, plus 2 px lines (`line_px=2` dimension chains) → `drawing_kind == "architectural_line_drawing"`, `abs(t_thin - 2.0) <= 0.5`, `thick` covers ≥ 90 % of wall pixels, and fewer than 5 % of the thin-line pixels survive in `thick`.
  - `test_colored_brochure_style`: the same walls in dark grey (60, 60, 60) with pastel room fills (e.g. (180, 200, 240)) → `drawing_kind == "colored_brochure"` and `colorfulness > 25`.
  - `test_illumination_flattening`: a line drawing multiplied by a horizontal brightness ramp 0.55…1.0, with `is_photo=True` → `ink` has no blobs larger than (3k)² in the dark half (the ramp is not binarized as ink).
  - `test_region_excludes_far_inset`: main plan (1200×900 px walls at (200, 100)) plus an inset of thick walls 400×200 at (300, 1300) with thick-pixel count ≥ 30 % of the main → region excludes the inset (`region.y + region.h < 1300`) and warning `plan_region_ambiguous` with `{"components": 2}`.
  - `test_region_expanded_and_clipped`: region = union bbox expanded by 6 % of its long side and clipped to the image.
- [ ] **Step 2: Run it, expect FAIL.** Command: `uv run pytest tests/test_preprocess.py -q`.
- [ ] **Step 3: Implement** per 06 §7.6 steps 1–7.
  - Use `skimage.filters.threshold_sauvola(gray, window_size=w, k=0.2)` and `skimage.morphology.skeletonize`.
  - For photos, run `flatten_illumination(gray)` before Sauvola.
  - `photo_of_drawing` when `page.is_photo`; `cad_vector` when `source_kind == "pdf_vector"`.
- [ ] **Step 4: Run tests, expect PASS.** Same command as Step 2.
- [ ] **Step 5: Quality gates.** `uv run ruff check . && uv run ruff format --check . && uv run mypy app`
- [ ] **Step 6: Commit.** `git add vision/app/pipeline/binarize.py vision/app/pipeline/region.py vision/tests/support/synth.py vision/tests/test_preprocess.py` then `git commit -m "feat(vision): Sauvola preprocessing, style classification, plan region" -m "$FURNY_TRAILER"`.

---

