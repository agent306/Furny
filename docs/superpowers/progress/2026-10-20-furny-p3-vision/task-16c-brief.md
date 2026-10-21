# Task 16c (inserted by the controller): HDB outline closure, truth correction and the Task 16/16b review fixes

## Why

Task 16b reached the wall recall and precision targets. Two things were left open:
- **The HDB outer outline does not close.** The graph has 0 bounded faces and 36 free ends.
- **The HDB truth is wrong in places.** The independent review of 16 and 16b found real errors in the HDB traced truth. Once corrected, recall drops to about 0.844, below 0.85.

This task fixes both, together with the review's code findings. Task 17 (openings) and Task 18 (rooms as faces) depend on a closed wall graph.

Read these first, all in `.superpowers/sdd/2026-10-20-furny-p3-vision/`:
- `task-16b-brief.md`: rulings R2–R6 still bind.
- `task-16b-report.md`: §1 B2 lists the outline breaks.
- `task-16-review.md`: the findings, with pixel coordinates.
- `task-14b-report.md`: Task 14b fixed dimension-line detection just before this task, and it may have simplified `_wall_face_dims`.

The reviewer's profile scripts and evidence crops are in `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/rv16/`.

## Part A: correct the HDB truth (`vision/tests/fixtures/reference/hdb-3room.drawing-walls.json`)

**Convention.** This is a controller ruling; write it into the file's `method` note.

- **Wall centre line.** A truth wall is the centre line of the drawn wall:
  - a double line: the midpoint of the face pair;
  - a bold or filled stroke: its centre;
  - a bold outer stroke plus a thin inner face: their midpoint.
- **Solid black blocks.** Walls drawn as solid black blocks follow the block centre.
- **Jogs.** Where the drawing jogs, the truth jogs too: two pieces plus a short connector.
- **Doors, windows and passages.** Walls span them, as before.
- **Columns and piers.** Isolated ones are not walls. Wall stubs ≥ 0.03 L are walls.

**Corrections.** All are from `task-16-review.md`:
- Add toilet 3's top wall: y ≈ 178, x 980 → 1115.
- Add the store/kitchen wall Q→U: x ≈ 299, y 364 → 480.
- Move I14 (H4l/H4r) to y 360.
- Move V6t to y 178.
- Fix node B (≈ 3 px), node P (≈ 2.75 px) and X6, which should sit at the centre of the 800/808 face pair.
- Apply the convention to X7, X8 and B2 at the black blocks (block centres 796 and 912) and to X9's jog.
- Decide on the balcony black stub per the convention.

Profile-check every changed wall at 20/50/80 % of its length and record the check in your report.

## Part B: outline closure

This is ruling B2, a deviation from 06 §8.1 step 8, to be logged for spec 19.

- **Gap thickness.** For R2 bold-stroke walls, the step-8 gap rule measures gaps against the drawing's wall thickness, `t_wall` (the median thickness of filled and double-line walls), not the stroke width. The limits 1.5·t and 18·t therefore use `t_wall`.
- **Mixed-style bridging.** Collinear pieces whose styles differ (a black block next to a bold line, or a bold line next to a double line) may bridge a gap only when all of the following hold:
  - the pieces are parallel within 2°;
  - their lateral offset is ≤ 1·t_wall;
  - the gap is ≤ 18·t_wall;
  - there is opening evidence inside the gap strip: either ≥ 2 thin parallel lines (±3°) covering ≥ 80 % of the gap (window frames or a slider), or a door-swing arc.

  The bridged wall takes the thicker piece's thickness. A lateral jog becomes a short connector piece, as `_join` does.
- **Missing bold corner pieces.** Recover them: the bottom-left corner (x 146–240 src) and the top-right corner (x 1122, y 115–182). Diagnose why they are lost (length threshold, region, or text mask) and fix that cause. Do not special-case them.
- **False positives** visible in `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/t16b/final/hdb-3room-final-drawing-walls-02-walls.png`:
  - the bold vertical at x ≈ 1175 that runs up through the top dimension zone;
  - the stub below the balcony at x ≈ 780.

  Diagnose and remove both by a general rule. One example rule: dangling pieces outside the outer outline that are collinear with an extension line.

## Part C: review fixes (`task-16-review.md`)

**Rulings on the six unratified design changes.** Log each one for spec 19.
1. **`region.py` ink-link grouping: ratified.** Fix the Minor finding: bound the cost so there are no O(n²) dense arrays on 2000 components (use a sweep or a spatial index), and poll `check_deadline`.
2. **`_solid_envelope`: ratified.** The risk is carried to Task 33/34 evaluation. Add a test: a double-line plan with one solid column keeps its exterior walls.
3. **`_wall_face_dims`: ratified as defence in depth, in whatever state 14b left it.** Re-check the review's Minor finding that it re-admits real dimension lines. Add a test.
4. **"One pair per stretch on either side": ratified.**
5. **`_join`: ratified.**
6. **`_trim_to_stroke`: ratified.** Make the docstring match its behaviour, since it only trims ends.

**Other Minors:**
- `extract_walls`: make `ink` required, per R6. After Task 14b, `tokens` is no longer used. If it is still unused once Part B is done, remove it instead of making it required. Either way, update all callers and tests.
- What Task 14b changed:
  - OCR now runs over the *annotation region*, which is the plan region grown by 0.15 L. Filter tokens back to the plan region with `ocr_stage.in_region`.
  - `detect_annotation_segments` adds `A…` segments for the dimension stage only. Walls must use plan-region segments only.
  - The wall floors after 14b are:
    - HDB: 0.870 / 0.894, with 34 free ends. These are measured against the *uncorrected* truth.
    - Brochure: 0.924 / 0.875, with 18 free ends.
  - The brochure targets in Acceptance mean no regression below these values.
- `test_metrics_score_a_perfect_extraction`: load the page instead of re-running the chain.
- Split `walls.py` (1,489 lines). Move the candidate and double-line pairing code into `vision/app/pipeline/wall_candidates.py`, or similar, with no behaviour change. Do this in its own commit before the Part B changes.

**Strict xfails.** Remove the strict xfails that test against the P2-fixture truth (`test_p2_truth_recall_and_precision[*]`). Ruling B1: the P2 fixtures are kept for topology and names only. Keep `*.walls.json` only if a test still uses it; otherwise delete it.

## Acceptance

All of these are pytest cases with `@pytest.mark.reference`, run in the normal suite.

**HDB, against the corrected truth:**
- recall ≥ 0.85 and precision ≥ 0.85;
- `free_ends == 0` on the outer cycle;
- ≥ 7 bounded faces from shapely `polygonize`.

The plan has 10 room-like spaces: 3 bedrooms, 3 toilets, store/kitchen, living, balcony and the 600 recess. The kitchen is open to the living room. Report the face list.

The xfail `test_hdb_outline_is_closed_and_rooms_are_faces` becomes a passing test.

**Brochure:**
- recall ≥ 0.75 and precision ≥ 0.75, with no regression below 0.90 / 0.85;
- outer-cycle free ends ≤ 7, which is the current number; aim for 0 and report what you reach.

**Other checks:**
- All synthetic tests and the full vision suite pass.
- Gates: ruff, ruff format and mypy.
- The full chain runs in < 10 s per image.

If a target cannot be reached without a design change beyond B2 and this brief, stop. Report NEEDS_CONTEXT with the metrics, the blocker and a proposed ruling. Do not loosen the metrics.

## Files

You may modify:
- `vision/app/pipeline/{walls.py,wall_candidates.py (new),region.py,segments.py,graph.py,binarize.py}`;
- `vision/tests/**`;
- the reference fixture JSONs.

Do not touch `dimensions.py` (owned by 14b) unless a test proves it is necessary, and say so if you do.

Put debug PNGs in `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/t16c/`. Commit with the trailer, then push.
