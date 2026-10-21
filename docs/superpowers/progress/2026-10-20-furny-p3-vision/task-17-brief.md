### Task 17: Openings (door arc, window, passage)

**Files:**
- Create: `vision/app/pipeline/openings.py`
- Modify: `vision/app/schemas/candidates.py` (add `OpeningCandidate`)
- Test: `vision/tests/test_openings.py`

**Spec refs:** `06 §8.5`, `04 §2.1` (normal and left side)

**Interfaces:**
- Produces:
  - `OpeningCandidate(id: str, wall_id: str, u0: float, u1: float, kind: Literal["door", "window", "opening"], type: str, hinge: Literal["start", "end"], swing: Literal["left", "right"], support: float)`.
  - `find_openings(graph: WallGraph, pre: Preprocessed, segments: list[Segment], ink_notext: np.ndarray) -> list[OpeningCandidate]` (ids `O{n}` ordered by wall id, then `u0`).

- [ ] **Step 1: Write the failing test.** Uses `synth` with wall a=(100,500) b=(900,500), so d=(1,0) and n=(0,−1), meaning up on screen.
  - `test_door_arc_start_left`: a door with `u0=300, width=90, hinge="start", side=1` → kind `door`, type `single_swing`, `hinge == "start"`, `swing == "left"`, `support >= 0.55`.
  - `test_door_arc_end_right`: `hinge="end", side=-1` → `hinge == "end"`, `swing == "right"`.
  - `test_double_swing`: two arcs of radius g/2 from both ends → type `double_swing`.
  - `test_window_casement`: 2 parallel thin lines spanning the gap → kind `window`, type `casement`.
  - `test_window_sliding`: 3 lines with offset sashes overlapping ≤ 60 % → `sliding_window`.
  - `test_passage`: an empty gap → kind `opening`, type `opening`, `support == 0.0`.
- [ ] **Step 2: Run it, expect FAIL.** Command: `uv run pytest tests/test_openings.py -q`.
- [ ] **Step 3: Implement** per 06 §8.5.
  - Four hypotheses with 24 arc samples each, scored by thin-ink support in a 5×5 window. A leaf-line bonus of +0.15 applies.
  - Double-swing rule: two arcs, each with support ≥ 0.45 and radius ≈ g/2.
  - Window rule: ≥ 2 parallel thin lines (±3°) covering ≥ 80 % of g inside the wall strip.
- [ ] **Step 4: Run tests, expect PASS.** Same command as Step 2.
- [ ] **Step 5: Quality gates.** `uv run ruff check . && uv run ruff format --check . && uv run mypy app`
- [ ] **Step 6: Commit.** `git add vision/app/pipeline/openings.py vision/app/schemas/candidates.py vision/tests/test_openings.py` then `git commit -m "feat(vision): door/window/opening classification of wall gaps" -m "$FURNY_TRAILER"`.

---


## Controller additions (binding)

The real-image lessons from Tasks 14b and 16b/16c apply here. Synthetic tests alone are not acceptance.

### A. Reference truth and acceptance

Trace `vision/tests/fixtures/reference/hdb-3room.drawing-openings.json` in source px, using the same conventions as `*.drawing-walls.json`. List every door (with hinge side and swing side), every window and every passage on the HDB plan, and give each one its host truth-wall id and its interval along that wall. Profile-check each opening and record a `method` note. Do the same for `brochure-2bhk` (`brochure-2bhk.drawing-openings.json`).

Write `@pytest.mark.reference` tests that run the full chain plus `find_openings`. An opening counts as matched when it overlaps a truth opening on the same wall by ≥ 50 % of the truth width and has the same `kind`. The targets are:

| Plan | Recall | Precision |
|---|---|---|
| HDB | ≥ 0.75 | ≥ 0.85 |
| Brochure | ≥ 0.70 | ≥ 0.80 |

For doors that match, the hinge and swing must be correct on at least 80 %.

### B. Carries from Task 16c

- **R-b.** A door swing arc at a partition's free end, when the door closes against a perpendicular wall, extends the partition to that wall as a door opening. Use the arc-evidence rule from Task 16c: a single curved stroke with radius ≈ gap ± 15 %, centred within 0.5 t of the jamb, covering ≥ 60 % of the in-region arc samples with ≥ 45° contiguous, after the solid masks are subtracted. Reuse that code; do not duplicate it.
  - Synthetic test: a door at the end of a partition.
  - HDB bedroom-3 door.
- **Toilet 3, left wall.** A door-frame line pairs with one face of the wall first, which misbuilds it. Fix this at its cause, either in the pairing step or by recognising door frames.
- **Store bi-fold door.** Recognise it: two short leaves, or a zig-zag in plan.

### C. Fold-in

Remove the dead `if case == "title-block frame"` branch in `test_tables_with_uneven_rows_do_not_become_the_plan_region` in `test_preprocess.py`.

### D. Floors that must not regress

- Walls:
  - HDB ≥ 0.889 / 0.963, with 0 outer free ends.
  - Brochure ≥ 0.90 / 0.85, with 0 outer free ends.
- HDB bounded faces: report the new count. The target is ≥ 7; Task 18 enforces it strictly.
- Dimensions are unchanged.
- The non-OCR chain runs in < 10 s.

If a target cannot be reached without a design change beyond 06 §8.5 and these additions, stop and report NEEDS_CONTEXT with the metrics and a proposed ruling.
