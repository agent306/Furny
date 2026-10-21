### Task 23: Overview images, set-of-marks, candidate JSON, agentic tools

**Files:**
- Create: `vision/app/pipeline/annotate.py`, `vision/app/pipeline/labeling/tools.py`
- Test: `vision/tests/test_annotate_tools.py`

**Spec refs:** `06 §9.2`, `06 §9.5`, `18 §3` (image encoding rules)

**Interfaces:**
- Consumes: `CandidateSet`, `NormalizedPage`, `ImagePart`, `TextPart`, `ToolSpec`, `ToolCall`, `ToolResult` (Task 22).
- Produces, in `annotate.py`:
  - `Overview(s: float, offset: tuple[int, int], width: int, height: int, clean: np.ndarray, marked: np.ndarray, candidates_json: str, payload: dict[str, Any])`.
  - `build_overview(page, candidates, *, max_image_px: int, ctx) -> Overview`, which emits the `too_many_candidates_truncated` warnings.
  - `to_image_part(img: np.ndarray) -> ImagePart` (PNG; JPEG q90 if > 4.5 MB).
  - `to_overview(pt_norm, ov) -> tuple[int, int]` and `from_overview(pt_ov, ov) -> Pt`.
  - `draw_marks(img, candidates_subset, ov, scale)`.
  - `TRUNCATION = {"texts": 300, "walls": 400, "openings": 150, "rooms": 80, "dimensionSpans": 200}`.
- Produces, in `tools.py`: `CROP_IMAGE_SPEC`, `LIST_CANDIDATES_SPEC` (`ToolSpec`s with the exact 06 §9.5 schemas), and `ToolExecutor(page, overview, candidates, *, max_image_px: int, max_crops: int)` with `specs() -> list[ToolSpec]`, `execute(call: ToolCall) -> ToolResult` and `crops_used: int`.

- [ ] **Step 1: Write the failing test.**
  - `test_overview_scale`: a normalized 5000×4000 image with `max_image_px=2576` → `s == pytest.approx(0.5152)`; with `max_image_px=8000` → `s == 1`.
  - `test_coordinate_roundtrip`: `from_overview(to_overview(p))` is within `1/s` px.
  - `test_candidate_json_compact_sorted`: no whitespace (`" " not in json except inside text values`), ids sorted naturally (`T2` before `T10`), integer coordinates, and keys exactly as the 06 §9.2 example (`image`, `texts`, `dimensionSpans`, `walls`, `openings`, `rooms`). Text items carry `parsed` as `"room_name:bedroom"` / `"mm_number:3300"` / `"other"`.
  - `test_truncation`: 500 texts → 300 kept by highest score, warning `too_many_candidates_truncated` `{"kind": "texts", "kept": 300, "total": 500}`.
  - `test_marks_drawn`: the marked image has pure-ish red (`#E53935`) pixels near a wall midpoint and none in the clean image.
  - `test_large_png_switches_to_jpeg`: with the size threshold monkeypatched to 1 KB → `media_type == "image/jpeg"`.
  - `test_crop_tool`:
    - `{"x": 10, "y": 10, "w": 100, "h": 80, "scale": 4, "annotated": False}` with s = 0.5 → image 400×320, and text exactly `"Crop of overview region x=10, y=10, w=100, h=80. This image is 400x320 px; a point (u, v) in it corresponds to overview point (x + u*100/400, y + v*80/320)."`.
    - With s = 1 the output is capped at 2× native → 200×160.
    - `scale=9` is clamped to 4. `w=8` → `is_error`. A rectangle beyond the overview is clamped.
  - `test_crop_budget_counter`: after `max_crops` crops, the next returns `is_error` with text `"crop budget exhausted, answer now"`.
  - `test_list_candidates`: `{"kind": "walls", "region": {"x": 0, "y": 0, "w": 50, "h": 50}}` filters by wall midpoint. More than 200 items → `"truncated": true`. An invalid `kind` → `is_error`.
  - `test_tool_schemas_exact`: `CROP_IMAGE_SPEC.input_schema` equals the 06 §9.5 JSON.
- [ ] **Step 2: Run it, expect FAIL.** Command: `uv run pytest tests/test_annotate_tools.py -q`.
- [ ] **Step 3: Implement** per 06 §9.2 and §9.5.
  - Labels in 14 px bold sans: use `cv2.FONT_HERSHEY_DUPLEX` at a scale giving 14 px cap height, with a 3 px white outline drawn first.
  - Up to 3 collision offsets of 12 px; otherwise omit the label from the image.
  - Colours: walls `#E53935`, openings `#2E7D32`, rooms `#6A1B9A`, texts `#1565C0`, spans `#EF6C00` (converted to BGR).
- [ ] **Step 4: Run tests, expect PASS.** Same command as Step 2.
- [ ] **Step 5: Quality gates.** `uv run ruff check . && uv run ruff format --check . && uv run mypy app`
- [ ] **Step 6: Commit.** `git add vision/app/pipeline/annotate.py vision/app/pipeline/labeling/tools.py vision/tests/test_annotate_tools.py` then `git commit -m "feat(vision): set-of-marks overview, candidate JSON and crop tools" -m "$FURNY_TRAILER"`.

---

