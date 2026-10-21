### Task 8: PDF rendering and vector extraction

**Files:**
- Create: `vision/app/pipeline/pdf.py`, `vision/tests/support/pdfgen.py`
- Test: `vision/tests/test_pdf.py`

**Spec refs:** `06 §5.4` (vector rule ≥ 200 objects), `06 §7.2` (PDF raster DPI rule and vector extraction), `06 §2.2` (≤ 20 pages)

**Interfaces:**
- Produces:
  - `pdf_page_count(data: bytes) -> int`, which raises `pdf_encrypted` or `corrupt_file`.
  - `page_size_pt(data, page_number: int) -> tuple[float, float]`.
  - `render_dpi(w_pt: float, h_pt: float) -> float`.
  - `render_pdf_page(data, page_number: int, dpi: float | None = None) -> RenderedPage(image, dpi, width_pt, height_pt)`, which raises `invalid_page`.
  - `classify_pdf_page(data, page_number) -> Literal["pdf_vector", "pdf_raster"]`.
  - `extract_vector_page(data, page_number, dpi) -> VectorPage`, with these dataclasses:
    - `VectorPage(segments: list[VSeg], filled: list[VPolygon], words: list[VWord], object_count: int)`
    - `VSeg(p0, p1, width_px)`, `VPolygon(points)`, `VWord(text, box: tuple[float, float, float, float], angle: Literal[0, 90])`
  - `is_standard_paper(w_pt, h_pt) -> bool` (ISO A0–A4 or ANSI A–E, ±2 %, either orientation).
- Produces, in tests: `pdfgen.make_pdf(pages: list[PageSpec]) -> bytes`, with `PageSpec(width_pt, height_pt, lines: list[tuple[float, float, float, float, float]], words: list[tuple[float, float, str, float]], filled_rects: list[tuple[float, float, float, float]])`. It writes raw PDF syntax: an xref table, the Helvetica standard font, and `m l S` / `re f` / `BT Tf Td Tj ET` content in top-left coordinates converted to PDF bottom-left.

- [ ] **Step 1: Write the failing test.**
  - `test_render_dpi_rule`: `render_dpi(595.3, 841.9) == 300`; `render_dpi(2384, 3370) ≈ 6000 / (3370 / 72) ≈ 128.2` (±0.1); `render_dpi(14400, 14400) == 72`.
  - `test_render_shape`: an A4 page rendered gives an image of shape `(round(841.9 * 300 / 72), round(595.3 * 300 / 72), 3)` ±1.
  - `test_classify`: a page with 250 lines → `"pdf_vector"`; 10 lines → `"pdf_raster"`.
  - `test_vector_coords`: a line from (72, 72) to (144, 72) pt with width 1 at dpi 150 → `VSeg` p0 ≈ (150, 150), p1 ≈ (300, 150), `width_px ≈ 2.08`. A word `"SCALE 1:100"` at (100, 100) is present with `angle == 0`. A filled rect with black fill → one `VPolygon` with 4 points.
  - `test_page_count_and_invalid_page`: 21 pages → `pdf_page_count == 21`; `render_pdf_page(data, 22)` → `invalid_page`.
  - `test_encrypted_pdf`: encrypt with `pypdf.PdfWriter.encrypt("pw", algorithm="RC4-128")` → `pdf_page_count` raises `pdf_encrypted` (422).
  - `test_corrupt_pdf`: `b"%PDF-1.7 garbage"` → `corrupt_file`.
  - `test_standard_paper`: A3 (841.9 × 1190.6) true, A3 rotated true, (700, 700) false.
- [ ] **Step 2: Run it, expect FAIL.** Command: `uv run pytest tests/test_pdf.py -q`.
- [ ] **Step 3: Implement** with `pypdfium2` (`PdfDocument`, `page.render(scale=dpi/72).to_numpy()`, converted RGB(A) → BGR) and `pdfplumber` per 06 §7.2.
  - A `PdfiumError` whose message contains `password` → `pdf_encrypted`.
  - In pdfplumber `rects`, a fill colour with luminance < 0.35 → filled polygon.
- [ ] **Step 4: Run tests, expect PASS.** Same command as Step 2.
- [ ] **Step 5: Quality gates.** `uv run ruff check . && uv run ruff format --check . && uv run mypy app`
- [ ] **Step 6: Commit.** `git add vision/app/pipeline/pdf.py vision/tests/support/pdfgen.py vision/tests/test_pdf.py` then `git commit -m "feat(vision): PDF render DPI rule, vector extraction, encryption handling" -m "$FURNY_TRAILER"`.

---

