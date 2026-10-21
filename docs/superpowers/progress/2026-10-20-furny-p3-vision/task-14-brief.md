### Task 14: Dimension lines, dimension spans, heuristic text association

**Files:**
- Create: `vision/app/pipeline/dimensions.py`
- Modify: `vision/app/schemas/candidates.py` (add `DimensionLine`, `DimensionSpan`)
- Test: `vision/tests/test_dimensions.py`

**Spec refs:** `06 §8.4` (steps 1–5), `06 §8.1` step 2

**Interfaces:**
- Consumes: `Segment` (Task 13), `TextToken` (Task 12).
- Produces:
  - `DimensionLine(id: str, p0: Pt, p1: Pt, tick_positions: list[float], segment_id: str)`.
  - `DimensionSpan(id: str, p0: Pt, p1: Pt, axis: Literal["x", "y", "other"], kind: Literal["chain_segment", "overall"], near_text_ids: list[str], line_id: str)`.
  - `find_dimension_lines(segments, tokens, region: Rect) -> list[DimensionLine]` (run before walls).
  - `find_dimension_spans(lines, tokens, region) -> list[DimensionSpan]`.
  - `associate_dimension_texts(spans, tokens) -> dict[str, str]` (text id → span id).

- [ ] **Step 1: Write the failing test.** Tokens are constructed directly, without OCR.
  - `test_chain_detected`: an `SDimChain` along x with ticks [300, 1200, 2100] and slash ticks, plus tokens "9000" and "9000" centred above each interval → 1 line, spans `D1` (chain 300–1200), `D2` (chain 1200–2100) and `D3` (overall 300–2100), axis `"x"`.
  - `test_two_ticks_single_span`: a span with 2 ticks → exactly 1 span, kind `overall`.
  - `test_bar_ticks_and_extension_lines`: perpendicular extension lines touching within 2 px count as ticks.
  - `test_no_text_not_dimension`: a line with ticks but no numeric token within 2.5 × text height → no dimension line.
  - `test_orientation_match`: an angle-90 token next to a horizontal line is not in `near_text_ids`.
  - `test_association_prefers_nearest_midpoint`: `associate_dimension_texts` maps each numeric token to the span whose midpoint is nearest its centre projection; on a tie, the shorter span wins.
- [ ] **Step 2: Run it, expect FAIL.** Command: `uv run pytest tests/test_dimensions.py -q`.
- [ ] **Step 3: Implement** per 06 §8.4.
  - Tick: a thin segment of length `0.005 L … 0.03 L` crossing within its middle 80 % at 45° ± 15° or 90° ± 10°, or a perpendicular extension line touching within 2 px, or a filled blob of area ≤ `(0.006 L)²` on the line.
  - Ids are `L{n}` and `D{n}`, assigned in sort order.
- [ ] **Step 4: Run tests, expect PASS.** Same command as Step 2.
- [ ] **Step 5: Quality gates.** `uv run ruff check . && uv run ruff format --check . && uv run mypy app`
- [ ] **Step 6: Commit.** `git add vision/app/pipeline/dimensions.py vision/app/schemas/candidates.py vision/tests/test_dimensions.py` then `git commit -m "feat(vision): dimension line and span detection with text association" -m "$FURNY_TRAILER"`.

---

