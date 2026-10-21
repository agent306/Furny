### Task 21: Assembly, confidence, metric filters, validate-and-repair

**Files:**
- Create: `vision/app/pipeline/assemble.py`, `vision/app/pipeline/validate.py`
- Test: `vision/tests/test_assemble_validate.py`

**Spec refs:** `06 §8.6` (post-scale filters), `06 §8.7` (steps 1–9 and validate), `03 §1.1`, `06 §6` (reasons, warnings)

**Interfaces:**
- Consumes: `CandidateSet`, `LabelingResult`, `ScaleResult`, `RecognizeOptions`, `NormalizedPage`, `new_id`, `ROOM_DEFAULT_NAMES`, `match_room_name`.
- Produces:
  - `ConfidenceMap(walls: dict[str, float], openings: dict[str, float], rooms: dict[str, float], overall: float, reasons: dict[str, list[ReasonCode]])`.
  - `AssembleResult(document: PlanDocument, confidence: ConfidenceMap, warnings: list[MetaWarning], id_map: dict[str, str])` (candidate id → document id).
  - `assemble_document(page, candidates, labels, scale, options, ctx) -> AssembleResult`.
  - `snap_thickness(mm: float) -> int`.
  - `validate_and_repair(doc: PlanDocument, *, confidence: ConfidenceMap, drawing_kind: str) -> tuple[PlanDocument, list[MetaWarning]]`. This extends the spec signature with the inputs its rules need; the extension is recorded in the gap list.

- [ ] **Step 1: Write the failing test.**
  - `test_coordinates_and_ids`: k = 10.5 and node px (100, 200) → node `x == 1050, y == 2100`. Every id matches `^(n|w|o|r|t)_[0-9a-z]{10}$`.
  - `test_snap_thickness`: `snap_thickness(11 * 10.5) == 115`, `snap_thickness(223) == 230`, `snap_thickness(130) == 130`, `snap_thickness(40) == 50`, `snap_thickness(1200) == 1000`.
  - `test_wall_fields`: `height == hints.wall_height_mm or defaults.wall_height_mm` (2700); kind `half` → `height == 1000`; outer-boundary walls → `exterior`; interior walls with thickness ≤ 0.6 × median exterior → `partition`, otherwise `interior`; `material` is `drywall` at ≤ 100 mm, else `brick`; `justification == "center"`.
  - `test_openings`:
    - Gap 87 px at k 10.5 → width 910, offset = centre × k.
    - Door width ≥ 1200 → `double_swing` (unless sliding).
    - Window `sillHeight == 900`, `height == 1200`, clamped so `sill + height <= wall.height`.
    - The exterior door ≥ 900 nearest the largest living/foyer room → `main_entrance`, once.
    - `label` = an `opening_tag` token within 2 text heights.
  - `test_missed_opening_inserted`: `MissedOpening` on a wall with no gap within 1.5 m → a door of `doorWidthMm` centred at the projection, confidence 0.35, reason `type_guessed`.
  - `test_rooms`:
    - An unnamed included face → name `"Room"` with reason `no_name`.
    - Type from name via `match_room_name` when the label type is null.
    - `floorFinish == "tile"`, `showArea is True`, `labelOffset is None`.
    - Extra names → `TextLabel(fontSize=250, rotation=0)` plus warning `room_names_merged`.
    - A `MissedRoom` inside an unnamed face names it.
  - `test_exclusions`: a room `include=False` plus walls only adjacent to excluded or outside faces → removed, with warning `entities_outside_unit_removed` `{"walls": n, "rooms": m}`.
  - `test_metric_filters`: faces < 1.0 m² or > 200 m² dropped; walls < 50 mm or > 600 mm get reason `thin_evidence` and are dropped when evidence < 0.6; openings outside 300–6000 mm dropped.
  - `test_confidence_pins`:
    - Wall (evidence 0.85, snapped, one end connected, LLM `wall`) → 0.87.
    - Door with support 0.7 → 0.72; with the LLM agreeing → 0.87; with the LLM saying `window` → 0.6 and reason `llm_disagrees`.
    - Closed, named, heuristic room → 0.88; with area < 2 m² → 0.7 and reason `small_area`.
    - `overall` follows the 0.4/0.2/0.1/0.3 weighting, with empty sets counting 0.5.
  - `test_meta_and_background`: `schemaVersion == 1`, `meta.createdWith == "import"`, `meta.defaultWallThickness == 115`, `floorThickness == 150`. `background == {"importId": "", "mediaUuid": "", "pixelWidth": W, "pixelHeight": H, "mmPerPixel": k, "position": {"x": 0, "y": 0}, "rotation": 0, "opacity": 0.5, "visible": True, "locked": True}`. `view.lastMode == "2d"`.
  - `test_validate_clamp_and_drop`:
    - Wall 3000 mm with a door of width 900 at offset 200 → offset 450.
    - Wall 900 mm with width 900 → opening dropped.
    - Overlapping openings → the lower-confidence one dropped, warning `openings_dropped_overlap` `{"count": 1}`.
    - Walls < 10 mm and duplicate node pairs removed; orphan nodes removed.
  - `test_validate_errors`:
    - 2001 walls → `VisionError("too_complex")` with status 422.
    - 0 walls → `no_walls_detected`.
    - `drawing_kind="not_a_floor_plan"` with 3 walls → `not_a_floor_plan`; with 5 walls → warning `not_a_floor_plan_suspected` only.
  - `test_output_validates`: `PlanDocument.model_validate(doc.wire())` passes.
- [ ] **Step 2: Run it, expect FAIL.** Command: `uv run pytest tests/test_assemble_validate.py -q`.
- [ ] **Step 3: Implement** per 06 §8.7.
  - Use the face-id map from `find_room_faces` (rebuilt here from room polygons by `cv2.fillPoly` when absent) for the 0.75t side tests.
  - `overall` uses length-weighted wall confidences.
  - Round confidences to 2 dp.
- [ ] **Step 4: Run tests, expect PASS.** Same command as Step 2.
- [ ] **Step 5: Quality gates.** `uv run ruff check . && uv run ruff format --check . && uv run mypy app`
- [ ] **Step 6: Commit.** `git add vision/app/pipeline/assemble.py vision/app/pipeline/validate.py vision/tests/test_assemble_validate.py` then `git commit -m "feat(vision): PlanDocument assembly, confidence and validation" -m "$FURNY_TRAILER"`.

---

