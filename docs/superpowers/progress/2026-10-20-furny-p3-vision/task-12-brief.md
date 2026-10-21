### Task 12: OCR engine, tiling, two-pass reading, text tokens

**Files:**
- Create: `vision/app/ocr/engine.py`, `vision/app/ocr/tiling.py`, `vision/app/pipeline/ocr_stage.py`
- Modify: `vision/app/schemas/candidates.py` (add `TextToken`), `vision/app/main.py` (default `ocr_factory = OcrEngine`)
- Test: `vision/tests/test_ocr.py`

**Spec refs:** `06 §7.7`, `06 §5.2` (threads), `17 §5.9` (build-time model check)

**Interfaces:**
- Consumes: `parse_token` (Task 11), `Preprocessed` (Task 10), `VectorPage` (Task 8).
- Produces:
  - `RawOcrBox(quad: np.ndarray (4×2), text: str, score: float)`.
  - `class OcrEngine` with `__init__(det_limit_side_len: int = 1280, use_cls: bool = True)` and `read(img_bgr) -> list[RawOcrBox]`.
  - `tile_origins(length: int, tile: int = 1280, overlap: int = 160) -> list[int]`.
  - `map_rotated_cw(pt, tile_h: int) -> Pt`.
  - `dedupe(boxes, iou: float) -> list[...]`.
  - `@dataclass(frozen=True, slots=True) TextToken(id: str, text: str, quad: tuple[Pt, Pt, Pt, Pt], box: tuple[float, float, float, float], angle: Literal[0, 90], score: float, height_px: float, parsed: ParsedText)`.
  - `run_ocr(page: NormalizedPage, pre: Preprocessed, ocr: OcrLike, ctx) -> OcrResult(tokens: list[TextToken], text_mask: np.ndarray, ink_notext: np.ndarray)`.
  - `OcrLike` is a Protocol with `read`, so tests use a fake.

- [ ] **Step 1: Write the failing test.**
  - `test_tile_origins`: `tile_origins(1000) == [0]`; `tile_origins(3000) == [0, 1120, 1720]` (the last tile ends exactly at 3000).
  - `test_rotated_mapping`: for a tile of height 500, a point (x=10, y=20) in the original, rotated with `cv2.ROTATE_90_CLOCKWISE`, sits at (u=479, v=10), and `map_rotated_cw((479, 10), 500) == (10, 20)`.
  - `test_tiling_dedupe_with_fake_engine`: a fake engine returns the same box from two overlapping tiles → one token kept, with the higher score.
  - `test_pass_merge`: pass A and pass B boxes with IoU 0.4 → one token kept by higher score; on a tie, pass A wins.
  - `test_sorted_ids`: tokens get ids `T1…Tn` sorted by `(round(y0), round(x0))`.
  - `test_vector_words_bypass`: `page.source_kind == "pdf_vector"` with 12 vector words → the OCR fake is never called, tokens have `score == 1.0`, and angle comes from the word.
  - `test_text_mask`: `text_mask` covers each token box dilated by 2 px, and `ink_notext` is 0 there.
  - `test_real_rapidocr_reads_plan_text` (marked `slow`): a 1600×700 white image with `cv2.putText("BEDROOM", FONT_HERSHEY_SIMPLEX, 2.0, thickness 4)` and a vertical "3300" rendered through `SText(vertical=True)` → tokens include text `BEDROOM` (angle 0, parsed `room_name`) and `3300` with `angle == 90`.
- [ ] **Step 2: Run it, expect FAIL.** Command: `uv run pytest tests/test_ocr.py -q`.
- [ ] **Step 3: Implement.**
  - **`OcrEngine`** wraps `rapidocr.RapidOCR(params={"Det.limit_type": "max", "Det.limit_side_len": det_limit_side_len, "Det.box_thresh": 0.5, "Det.unclip_ratio": 1.6, "Global.text_score": 0.5, "Global.use_cls": use_cls, "Global.max_side_len": 2000, "EngineConfig.onnxruntime.intra_op_num_threads": 2, "Global.log_level": "warning"})`.
  - **`read`** calls `out = engine(img)` and zips `out.boxes`, `out.txts`, `out.scores`, all of which may be `None` (treated as empty). If the installed API differs, adapt only this method (06 §7.7).
  - **`height_px`** is the box height for angle 0 and the box width for angle 90.
  - **Tiling** runs over the plan region only. Dedupe uses IoU > 0.5 within a pass and > 0.3 across passes.
- [ ] **Step 4: Run tests, expect PASS.** Same command as Step 2.
- [ ] **Step 5: Quality gates.** `uv run ruff check . && uv run ruff format --check . && uv run mypy app`
- [ ] **Step 6: Commit.** `git add vision/app/ocr vision/app/pipeline/ocr_stage.py vision/app/schemas/candidates.py vision/app/main.py vision/tests/test_ocr.py` then `git commit -m "feat(vision): RapidOCR wrapper with tiling and two-pass vertical text" -m "$FURNY_TRAILER"`.

---

