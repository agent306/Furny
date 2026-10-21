### Task 19: Heuristic labeler (provider `none`) and labeler interface

**Files:**
- Create: `vision/app/pipeline/labeling/base.py`, `vision/app/pipeline/labeling/heuristic.py`, `vision/app/pipeline/labeling/vendor.py`
- Test: `vision/tests/test_labeling_heuristic.py`

**Spec refs:** `06 §9.1` (interface), `06 §9.7`, `06 §9.8` (vendor protocol only)

**Interfaces:**
- Consumes: `CandidateSet` (Task 18), `associate_dimension_texts` (Task 14), `LabelingResult` (Task 5), `RecognizeHints` (Task 5).
- Produces:
  - `class Labeler(Protocol)` with `label(page, candidates, hints, ctx) -> LabelingOutcome`.
  - `@dataclass LabelingOutcome(result: LabelingResult, provider_used: ProviderName, model: str | None, fallback_reason: FallbackReason | None, calls: list[Any], partial: bool)`. `calls` holds `UsageCall` objects from Task 22 and is typed `list[Any]` until then.
  - `class HeuristicLabeler` with `label(...)`.
  - `class RecognitionVendor(Protocol)` with `name: str` and `recognize(image_png: bytes, hints, timeout_s: float) -> Any`. No implementation.

- [ ] **Step 1: Write the failing test.** Fixture `CandidateSet`s are built in code.
  - `test_imperial_rooms`: face R1 contains `BEDROOM` (height 30) and `10'0"X11'0"`, and three other `feet_inch`/`size_pair` tokens exist elsewhere → `unitSystem == "imperial"`; room R1 is `include=True`, `name="Bedroom"`, `type="bedroom"`, `nameTextId` the BEDROOM token, `sizeText == "10'0\"X11'0\""`, `widthMm=3048`, `depthMm=3353`.
  - `test_metric_from_spans`: ≥ 3 `mm_number` tokens associated with spans → `unitSystem == "metric"`; dimension labels carry `spanId` and `valueMm`. The `mm_number` tokens get role `dimension`.
  - `test_unknown_unit_warns`: no evidence → `"unknown"` and `ctx` warning `unit_system_guessed`.
  - `test_hint_wins`: `hints.unit_system = "metric"` overrides imperial tokens.
  - `test_multiple_names_highest_wins`: two room names in one face → the taller one is the name, and the other stays role `room_name` (assembly creates the merged label).
  - `test_corridor_touching_boundary_excluded`: a face named `CORRIDOR` within 2t of the region border → `include=False`; the same face away from the border → `True`.
  - `test_missed_rooms`: a `room_name` token outside every face but inside the region → one `MissedRoom` at the token centre. Tokens outside the region → role `ignore`.
  - `test_walls_and_openings`: single-line walls → verdict `unsure`, others `wall`. An opening with support 0.3 → `unsure`.
  - `test_known_dimension`: label "Overall width" → `knownDimensionMatch == {"wallId": None, "spanId": None}`; label "Kitchen" → `None` plus warning `known_dimension_unmatched` with `{"label": "Kitchen"}`.
  - `test_outcome_meta`: `provider_used == "none"`, `model is None`, `calls == []`, `partial is False`.
  - `test_drawing_kind_from_cv`: `drawingKind == candidates.drawing_kind_cv`.
- [ ] **Step 2: Run it, expect FAIL.** Command: `uv run pytest tests/test_labeling_heuristic.py -q`.
- [ ] **Step 3: Implement** per 06 §9.7.
  - Wall `kind` stays `None` in heuristic labels; assembly decides by geometry (§8.7 step 5).
  - Room names use `title_case_name` of the token text.
- [ ] **Step 4: Run tests, expect PASS.** Same command as Step 2.
- [ ] **Step 5: Quality gates.** `uv run ruff check . && uv run ruff format --check . && uv run mypy app`
- [ ] **Step 6: Commit.** `git add vision/app/pipeline/labeling vision/tests/test_labeling_heuristic.py` then `git commit -m "feat(vision): heuristic labeler for provider none" -m "$FURNY_TRAILER"`.

---


## Controller additions (binding)

**A. Reference smoke tests** (`@pytest.mark.reference`; full chain on both images, then `HeuristicLabeler`):
- **Unit system.** Check `unitSystem` against what the drawings show:
  - HDB: plain mm dimension numbers, so `metric`.
  - Brochure: check its OCR tokens. Feet-inch room sizes mean `imperial`.
  - Pin whatever is correct for each drawing, and record the evidence in the test docstring.
- **Room names.** Every *matched* truth room (Task 18 rooms truth, ledges excluded) whose label was OCR'd gets the right `name` and `type`.
- **Missed rooms.** Every truth room whose label token lies outside all faces gets a `MissedRoom` at the token, unless the token is outside the plan region.
- **Floors.** Report the counts and set them as floors.

**B. Carry from Task 18 (M4).** A token centred on a wall belongs to no face. Treat a `room_name` token that lies within 1 t of a face's boundary as belonging to that face. If it touches two faces, the nearer anchor wins. Log this for spec 19 and test it.
