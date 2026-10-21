# Task 14b (inserted by the controller): dimension-line detection on the reference images

## Why

`find_dimension_lines` (Task 14, `vision/app/pipeline/dimensions.py`) is correct on synthetic chains. On the real HDB blueprint (`vision/tests/fixtures/reference/hdb-3room.webp`), Task 16b measured 32 lines, and almost all of them are false:

- about 7 are extension lines above the plan;
- about 15 are partition **wall faces**. The perpendicular partitions that meet them read as ticks, and a room-size label sits beside them.

The real outer dimension chains are mostly missed. The top chain reads 1600/1300/2500/1200/600/1300/2000 with an overall of 11000. The other chains are:

- left: 3300 / 2500 / 1000, and 7000;
- right: 600 / 1700 / 400 / 3200 / 1500, then 400 / 900, then 7600 / 8900 / 1300;
- bottom: 4100 / 3600 / 600 / 1800 / 800, and 11100.

The plan also has interior dimension lines: 1000, 300, 600, 1900, 1200, 3200, 3100, 3600, 3500, 7600, 1800 and 1300.

This breaks two things:

- **Scale (Task 20).** The scale solver depends on spans and their labels.
- **Walls (Task 16).** The walls stage excludes dimension lines and their extension lines from the wall masks. Task 16b had to add a guard, `_wall_face_dims` in `walls.py`, which trusts a dimension line only if it does not pair as a double-line wall face.

Fix the root cause in `dimensions.py`.

Evidence and context:

- `.superpowers/sdd/2026-10-20-furny-p3-vision/task-16b-report.md`, §3 "Guards found on the reference images" item 1, and the concerns at the end.
- `task-14-fix2-design.md`, the component-based tick design that is in force.

## Inputs you can rely on

- **Chain harness.** `vision/tests/support/reference.py` has `run_chain(stem)` with OCR replay from the recorded `<stem>.ocr.json` files. It also has `debug_png`, which draws the dimension lines.
- **Call order.** `find_dimension_lines(..., ink=ocr.ink_notext)` runs before the walls stage.

## Requirements

### 1. Dimension truth for HDB

Trace `vision/tests/fixtures/reference/hdb-3room.drawing-dims.json`, in source pixels like `hdb-3room.drawing-walls.json`. Each traced line needs:

- p0 and p1;
- the tick u positions;
- the label of each chain interval.

Cover every outer chain and overall line listed above, plus the interior dimension lines you can see. Profile-check each traced line against the ink, the way Task 16b checked walls, and record that this was done.

### 2. Root-cause fix in `dimensions.py`

Diagnose why the real chains are missed and why the false lines are accepted. Write the cause into the report before you change code. Then fix it within the rules of 06 §8.4 and the fix2 design. Candidate fixes include, among others:

- A candidate segment that pairs as a double-line wall face is not a dimension line. A pair is a parallel thin line at spacing [1.5·t_thin, 0.02 L] whose strip between the two lines is free of text. Move this logic from walls.py `_wall_face_dims` into dimensions.
- A "perpendicular tick" that is one line of a parallel pair spaced like a wall is a partition, not a tick.
- Extension lines need to be thin, single and unpaired.

When this is done, simplify walls.py's `_wall_face_dims` guard where it becomes redundant. Do not delete it unless the wall metrics hold; see Acceptance.

Every deviation from 06 §8.4 is logged in the report for spec 19.

### 3. Keep everything else working

The synthetic tests and the fix2 acceptance tests in `test_dimensions.py` must keep passing. That includes:

- phase robustness;
- stacked chains;
- blobs;
- the perf guard (15 s, per the controller's earlier relaxation).

## Acceptance

All of these are pytest cases with `@pytest.mark.reference`, and they run in the normal suite.

**1. HDB detection.** A traced line is matched by a detected line when all three hold:
- their centre lines are within 4 px of each other (source px, through `page.transform`);
- they are parallel within 2°;
- they overlap by at least 80 % of the traced length.

The targets are:
- recall ≥ 0.80 of traced lines;
- precision ≥ 0.90 of detected lines;
- every outer overall line is matched: 11000, 11100, 7000, 7600 and 8900.

**2. HDB spans and labels.** On matched lines:
- At least 80 % of traced chain intervals have a detected span within 0.5 % L at both ends.
- `associate_dimension_texts` maps at least 80 % of their labels to the right span.

**3. Brochure.** `brochure-2bhk.png` has no dimension lines, only size text. Expect 0 detected lines; at most 1 is tolerated, and the report must explain it if there is one.

**4. Walls do not regress.**

| Plan | Traced-truth recall | Traced-truth precision |
|---|---|---|
| HDB | ≥ 0.868 | ≥ 0.893 |
| Brochure | ≥ 0.908 | ≥ 0.856 |

Free ends must not increase: HDB 36, brochure 18.

**5. Performance.** The dimensions stage takes under 2 s per reference image, and the full chain stays under 10 s.

If a target can't be reached without a design change beyond 06 §8.4 and the fix2 design, stop. Report status NEEDS_CONTEXT with:
- the metrics you reached;
- the blocker;
- a proposed ruling.

Do not loosen the metrics.

## Files

You may modify:
- `vision/app/pipeline/dimensions.py`;
- `vision/app/pipeline/walls.py`, only to simplify the guard;
- `vision/tests/test_dimensions.py` and new reference tests;
- `vision/tests/support/reference.py`;
- the new fixture JSON.

Put debug PNGs in `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/t14b/`. Commit with the trailer and push.
