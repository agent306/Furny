### Task 20: Scale solver, fallbacks, confidence, scale note

**Files:**
- Create: `vision/app/pipeline/scale.py`
- Test: `vision/tests/test_scale.py`

**Spec refs:** `06 §8.2`, `06 §8.3`, `06 §5.6` (scale note), `06 §6` (`ScaleMeta`, warnings)

**Interfaces:**
- Consumes: `CandidateSet`, `LabelingResult`, `RecognizeHints`, `NormalizedPage`, `is_standard_paper` (Task 8).
- Produces:
  - `ScaleSample(value_mm: int, span_px: float, weight: float, axis: Literal["x", "y", "other"], kind: Literal["chain_segment", "overall", "room_width", "room_depth"], text: str, a_px: Pt, b_px: Pt)`.
  - `FitResult(k: float, inliers: list[ScaleSample], rejected: list[ScaleSample], residual_pct: float)`.
  - `fit_scale(samples) -> FitResult` (weighted median, two 8 % rejection rounds, WLS through the origin).
  - `scale_confidence(method, residual_pct, inliers: int, consistent_chains: int) -> float`.
  - `ScaleNote(n: int, mm_per_px: float, text: str)` and `find_scale_note(tokens, page) -> ScaleNote | None`.
  - `ScaleResult(mm_per_px: float, method: ScaleMethod, residual_pct: float | None, samples: int, rejected: int, confidence: float, anisotropy_corrected: bool, y_factor: float, room_label_check: RoomLabelCheck, used_samples: list[ScaleSample], inlier_flags: list[bool], consistent_chains: int)`.
  - `collect_samples(candidates, labels, hints) -> tuple[list[ScaleSample], list[ScaleSample]]` (primary, room).
  - `solve_scale(candidates, labels, hints, page, ctx, *, scale_note: ScaleNote | None) -> ScaleResult`.
  - `to_scale_meta(result) -> ScaleMeta` (a/b converted to mm, ≤ 60 samples).

- [ ] **Step 1: Write the failing test.**
  - `test_outliers_rejected`: 8 samples with true k = 10 and ±0.3 % noise, plus 2 outliers at ×1.2 and ×0.85 → `abs(k / 10 - 1) <= 0.005`, 2 rejected.
  - `test_wls_residual`: exact samples → `residual_pct < 1e-6`.
  - `test_confidence_formula`:
    - `scale_confidence("dimension_chain", 1.0, 8, 1) == pytest.approx(0.945)`.
    - `scale_confidence("room_label", 2.0, 4, 0) == pytest.approx(0.68)`.
    - `("scale_note", …) == 0.6`, `("user_hint", …) == 0.7`, `("default_guess", …) == 0.1`, `("dxf_units", …) == 1.0`.
  - `test_room_orientation_assignment`: a face interior bbox of 300×400 px with label (3000, 4000) → samples width↔x and depth↔y. Label (4000, 3000) → swapped. Weight 0.5.
  - `test_anisotropy_raster`: 4 x-samples at k = 10 and 4 y-samples at k = 10.5, `source_kind="raster"` → `anisotropy_corrected is True`, `y_factor == pytest.approx(1.05, rel=1e-3)`, `mm_per_px ≈ 10`, warning `scale_anisotropy_corrected` with `{"ratioPct": 5.0}`. The same with `pdf_vector` → not corrected.
  - `test_fallback_order`:
    - Only room samples → method `room_label` with warning `scale_from_room_labels` `{"rooms": n}`.
    - None, with a scale note N = 100 on an A3 page at dpi 150 → `scale_note`, `mm_per_px == pytest.approx(100 * 25.4 / 150)`.
    - A non-standard paper size → note ignored.
    - A known-dimension match plus < 2 other samples → `user_hint`.
    - Nothing → `default_guess` with `mm_per_px == 12000 / max(region.w, region.h)` and warning `scale_guessed` `{"assumedLongEdgeMm": 12000}`.
  - `test_single_overall_high_confidence`: one `overall` sample; this is the LLM path with confidence ≥ 0.8, approximated by a known-dimension weight-3 sample → treated as primary.
  - `test_room_label_cross_check`: primary chain k = 10 and room labels implying k = 11.5 → `median_discrepancy_pct ≈ 13` (> 10), warning `scale_room_label_mismatch`, confidence × 0.7.
  - `test_high_residual_warning`: residual > 3 → warning `scale_high_residual`.
  - `test_chain_consistency`: chain values 3000 + 4000 equal an overall 7000 on a parallel line covering the same extent ±1 % → `consistent_chains == 1`.
- [ ] **Step 2: Run it, expect FAIL.** Command: `uv run pytest tests/test_scale.py -q`.
- [ ] **Step 3: Implement** per 06 §8.2 and §8.3.
  - Sample sources: the labeling's `dimensions` (span and value), `rooms` (`widthMm`/`depthMm` with the face's interior bbox), and `knownDimensionMatch` (span length, or wall centreline length).
  - The labeler's `kind` overrides the span kind.
- [ ] **Step 4: Run tests, expect PASS.** Same command as Step 2.
- [ ] **Step 5: Quality gates.** `uv run ruff check . && uv run ruff format --check . && uv run mypy app`
- [ ] **Step 6: Commit.** `git add vision/app/pipeline/scale.py vision/tests/test_scale.py` then `git commit -m "feat(vision): robust scale solver with fallbacks and confidence" -m "$FURNY_TRAILER"`.

---


## Controller additions (binding)

### A. Carried dimension fixes (from the Task 14b re-review, `task-14b-rereview-1.md` items N1–N3)

Do these first, in their own commit (`fix(vision): Task 14b re-review carries`), TDD, in `dimensions.py` / `dimension_ticks.py` / `dimension_candidates.py` / `tests/support/reference.py`:
- **N1:** narrow the crossing-slash drop to slashes at a crossing that lies at an END of this line (not anywhere along it).
- **N2:** exempt wall-face end ticks from the end-extra rule (the reviewer showed a regression).
- **N3:** `_draw_pieces` must draw the last point.
The HDB dimension floors must hold: recall 0.833, precision 1.000, intervals 0.979, labels 0.923, ticks 0.985/0.932. Brochure: 0 dimension lines.

### B. Reference smoke for the scale solver

Add `@pytest.mark.reference` tests in `vision/tests/test_reference_scale.py` using `tests/support/reference.py` (`run_chain` with OCR replay, then the Task 19 heuristic labeler):
- **HDB:** `solve_scale(...)` gives method `dimension_chain`. Its `mm_per_px` is within 2 % of the scale implied by the traced truth `hdb-3room.drawing-dims.json` (the overall 11000 line's traced px length → mm/px, through `page.transform` as the 14b metrics do). Report `residual_pct`, inliers, rejected, `consistent_chains`, confidence, anisotropy and the room-label check.
- **Brochure:** there are no dimension lines, and the OCR'd size texts have lost their foot marks. Report which method results (`room_label`, `scale_note` or `default_guess`) and the error against the scale implied by the brochure walls truth (`brochure-2bhk.drawing-walls.json` is in px; derive the mm scale from the P2 brochure fixture overall extents in `brochure-2bhk.walls.json` registration, as 16b did). Pin the method that results as a regression floor. Do not tune the solver to the brochure; if the method is `default_guess`, say so honestly.
- The chain plus scale must stay under 10 s per image (replayed OCR).

### C. Interfaces from earlier tasks the brief cannot know

- `CandidateSet` already has `scale_y` (Task 18). Faces and the face-id map are not in `CandidateSet`; Task 18 rebuilds them after `scale_y`. `solve_scale` takes the room face interior bboxes from what the labeler's `rooms` reference, so read how Task 19's `LabelingResult` points at faces (`vision/app/pipeline/labeling/base.py`, `heuristic.py`) and use that, not a re-derivation.
- The unit system is decided by the labeler (Task 19 I1: evidence balance). Room samples come only from rooms with a parsed mm `widthMm`/`depthMm`; an imperial size pair whose text failed to parse yields no sample.
- Warnings use the existing warning model and codes from 06 §6. If a code the brief names is missing from the enum, add it there and say so in the report.
- `is_standard_paper` is in the Task 8 module. Grep for it, don't reimplement.

### D. Process

- Spec 06 is binding. Do not edit `docs/superpowers/specs/**`. List any deviation in the report under "Deviations for spec 19".
- If an acceptance target cannot be reached without a design change, stop and report NEEDS_CONTEXT with the metrics, the blocker and a proposed ruling.
