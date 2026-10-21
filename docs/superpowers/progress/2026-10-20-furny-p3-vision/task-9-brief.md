### Task 9: Photo rectification, deskew, resample (`NormalizedPage`)

**Files:**
- Create: `vision/app/pipeline/rectify.py`, `vision/app/pipeline/normalize.py`, `vision/app/utils/geometry.py`, `vision/app/utils/images.py`
- Test: `vision/tests/test_rectify.py`, `vision/tests/test_normalize.py`

**Spec refs:** `06 §5.4` (`isLikelyPhoto`), `06 §7.3`, `06 §7.4`, `06 §7.5`, `06 §6` (`PageImage`)

**Interfaces:**
- Produces, in `utils/geometry.py`:
  - `Pt = tuple[float, float]` and `Rect(x: int, y: int, w: int, h: int)` (frozen dataclass with `long_side`, `contains(pt)`, `expand(px)`, `clip(w, h)`).
  - `detect_line_segments(gray: np.ndarray) -> np.ndarray` returning an `(N, 4)` float32 array of `x0 y0 x1 y1`: LSD (`cv2.createLineSegmentDetector(cv2.LSD_REFINE_STD)`), falling back to `HoughLinesP(rho=1, theta=π/360, threshold=50, minLineLength=0.02·long, maxLineGap=3)` when LSD raises.
  - `seg_angle_deg(x0, y0, x1, y1) -> float` in [0, 180), y-down, clockwise positive.
  - `point_seg_distance`, `project_param`, `odd(n: int) -> int`.
- Produces, in `utils/images.py`: `encode_png(img) -> bytes` (compression 6), `encode_jpeg(img, quality) -> bytes`, `encode_webp(img, quality) -> bytes`, `resize_long_edge(img, long_edge, interp)`.
- Produces, in `rectify.py`: `detect_page_quad(img) -> np.ndarray | None`, `warp_quad(img, quad) -> np.ndarray`, `quad_is_axis_aligned(quad, shape) -> bool`, `flatten_illumination(gray) -> np.ndarray`.
- Produces, in `normalize.py`:
  - `NormalizedPage(image: np.ndarray, page_image: PageImage, transform: np.ndarray (3×3), source_kind: SourceKind, is_photo: bool, vector: VectorPage | None, dpi: float | None, page_size_pt: tuple[float, float] | None)`.
  - `estimate_skew_deg(gray) -> float`.
  - `normalize(img, *, source_kind, is_photo: bool, corners: list[tuple[float, float]] | None, source_page: int, dpi: float | None, ctx) -> NormalizedPage`.

- [ ] **Step 1: Write the failing test.**
  - `test_photo_quad_detected_and_rectified`:
    - Draw a 1200×900 white "drawing" with a black 4 px grid of rectangles.
    - Warp it onto a 1600×1300 grey (128) canvas so the page corners land at TL (180, 150), TR (1450, 210), BR (1400, 1180), BL (140, 1100), using `cv2.getPerspectiveTransform` + `warpPerspective`.
    - `detect_page_quad` returns corners each within `0.015 × hypot(1600, 1300)` of the truth.
    - After `warp_quad`, every segment from `detect_line_segments` longer than 100 px has an angle within ±1° of 0° or 90°.
  - `test_axis_aligned_quad_is_not_photo`: a white page on a black canvas exactly at the image border → `quad_is_axis_aligned(...) is True`.
  - `test_user_corners_win`: `normalize(..., corners=[(0.1, 0.1), (0.9, 0.1), (0.9, 0.9), (0.1, 0.9)])` → `page_image.rectified is True` and output size ≈ 0.8 × input (before resample).
  - `test_photo_without_quad_warns`: plain noise with `is_photo=True` → warning `page_corners_not_found`, `rectified is False`.
  - `test_deskew`:
    - Rotate a line drawing with `cv2.getRotationMatrix2D(c, -3, 1)` (OpenCV positive = counter-clockwise, so this is content rotated 3° clockwise).
    - `estimate_skew_deg ≈ +3.0 ± 0.2`.
    - `normalize` → `page_image.deskew_deg ≈ -3.0 ± 0.2` and warning `deskewed` with `params["degrees"] == round(page_image.deskew_deg, 1)`.
    - A 0.1° rotation → `deskew_deg == 0`, no warning.
    - Source kind `pdf_vector` → deskew skipped.
  - `test_low_resolution_upscaled`: 800×600 → normalized long edge 2000, `resample_factor == 2.5`, warning `low_resolution` with `{"longEdge": 800}`. 1200 px → 2000 with no warning. 6500 → 6000 (factor ≈ 0.923). 3000 → unchanged, factor 1.0.
  - `test_transform_maps_points`: `transform @ [w-1, h-1, 1]` (dehomogenised) ≈ `(W_norm-1, H_norm-1)` ±1.5 for a plain resample.
- [ ] **Step 2: Run it, expect FAIL.** Command: `uv run pytest tests/test_rectify.py tests/test_normalize.py -q`.
- [ ] **Step 3: Implement** per 06 §7.3–§7.5.
  - Order inside `normalize`: rectify (when user corners are given, or `is_photo`, or the quad is non-axis-aligned) → deskew (`0.2 ≤ |a| ≤ 10`, canvas expanded, white border, `INTER_CUBIC`) → resample.
  - `transform` is the composition of the three 3×3 matrices.
  - `PageImage.width/height` are the final pixel size. `rectified` reflects whether a warp was applied.
  - Skew estimation: LSD segments ≥ 3 % of the long edge, angles folded into (−45°, 45°], length-weighted histogram in 0.1° bins over [−10°, 10°], 5-bin box smoothing, then the peak.
- [ ] **Step 4: Run tests, expect PASS.** Same command as Step 2.
- [ ] **Step 5: Quality gates.** `uv run ruff check . && uv run ruff format --check . && uv run mypy app`
- [ ] **Step 6: Commit.** `git add vision/app/pipeline/rectify.py vision/app/pipeline/normalize.py vision/app/utils/geometry.py vision/app/utils/images.py vision/tests/test_rectify.py vision/tests/test_normalize.py` then `git commit -m "feat(vision): photo rectification, deskew and resample to NormalizedPage" -m "$FURNY_TRAILER"`.

---

