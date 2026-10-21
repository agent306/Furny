# Task 14b review (92b8bc2..c495a09)

Reviewer for P3 Task 14b. I reviewed read-only from `review-92b8bc2..c495a09.diff`. I read `dimensions.py` whole from `git archive c495a09`, because its hunk is a near-total rewrite. Every run happened in a scratch copy, `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/rv14b/`, never in the worktree. My tools and crops are in the same scratchpad, under `rv14b-tools/` and `rv14b-crops/`.

Rulings B1, B2/C5b, C5a and C5c are not re-flagged.

## Verdicts

- **Spec compliance:** ✅ against the brief as amended by the rulings.
  - Exception: one ⚠️ generality gap against 06 §8.4 step 1. Label ownership is decided by which side of the label a line lies on, so some label placements that 06 §8.4 accepts lose a line. See I1.
- **Quality:** Needs fixes. I1 is Important; everything else is Minor.
- **Truth verification:** the truth is sound, with minor non-material errors.
  - Positions, labels and the splits are right, and no visible dimension line is missing.
  - Three lines have ends or ticks more than 2 px off (T1–T3). None of these errors changes any metric.

## Commands run in the scratch copy

- `uv run pytest -q -m reference` gave **19 passed, 3 xfailed in 8.3 s**. The xfails are 16b's three.
- `uv run pytest -q` gave **749 passed, 1 skipped, 3 xfailed in 106 s**. That matches the Final section exactly. The test output is clean: no warnings apart from uv's own `UV_NATIVE_TLS` environment notice.
- The Final metrics were recomputed with `run_chain` and `chain_dim_metrics` (`rv14b-tools/metrics.py`), and all match:

| Metric | Measured |
|---|---|
| HDB dimension recall | 0.8333 (unmatched: left, left-overall, i600, i400) |
| HDB dimension precision | 0.9565 (false: L2) |
| Intervals | 0.9375 |
| Labels | 0.8718 |
| HDB walls R / P / free ends | 0.8700 / 0.8937 / 34 |
| Brochure walls R / P / free ends | 0.9236 / 0.8754 / 18 |
| Brochure detected lines | 0 |
| Dimensions stage | 0.23 s / 0.00 s |
| Non-OCR chain | ≈1.5 s / 0.57 s |

## Spec compliance

Checked against the brief, the fix2 design, 06 §8.4 and 06 §7.6–7.7.

### Acceptance targets

- **#1, HDB detection.** Met.
  - Recall 0.833 ≥ 0.80; precision 0.957 ≥ 0.90.
  - Outer overall lines 11000, 11100, 7600 and 8900 are matched. 7000 was dropped by ruling C5b.
  - The match rule uses 4 *normalized* px. That is stricter than the brief's 4 source px (`reference.py:414-422`), which is acceptable.
- **#2, spans and labels.** Met: 0.938 and 0.872.
- **#3, brochure.** Met: 0 lines.
- **#4, walls.** Met; the floors are encoded in `test_reference_dims.py` `WALL_FLOOR`.
- **#5, timing.** Dimensions < 2 s is met. The chain timing follows ruling C5c.

### Other brief requirements

- **Root cause.** It was written up before the code change (report §1), and the fix is in `dimensions.py` plus the split modules.
- **Wall-face logic.** It moved into `dimension_candidates.wall_faces`. The walls guard was simplified (`walls.py` `_wall_face_dims` no longer pairs two dimension lines), and is kept with a measured justification.
- **Spec-19 deviations.** Logged in report §4, C1 and Final.
- **fix2 acceptance tests.** All still pass, including phase robustness, stacked chains, blobs, the vector digest and the perf guard.

### Files outside the brief's list

The diff touches `ocr_stage.py`, `region.py`, `segments.py`, both OCR fixtures, `test_ocr.py`, `test_segments.py` and the new `dimension_ticks.py` / `dimension_candidates.py`. Each change traces to a controller ruling: B1, C5a, or the split ordered in the continuation. They are accepted.

### ⚠️ Cannot verify from this diff

- **Task 31 wiring.** The pipeline must:
  - pass `[*segments, *annotation_segments]` and `gray`/`t_thin` to `find_dimension_lines`;
  - give walls only `detect_segments`;
  - filter tokens with `ocr_stage.in_region` for rooms and labeling.

  No consumer exists yet (a grep of `app/` finds no rooms or labeling token users), so the controller should carry this into the Task 31 brief.
- **06 §8.4 step 1 label rule.** It is narrowed by baseline-side ownership. See I1 for the conventions it breaks.

## Strengths

- **Clear diagnosis.** It separates the miss causes (fragmentation, slash merged into a wall, faint lines, region) from the false-accept causes (the symmetric perpendicular rule, unoriented labels, faces). The metric history (report §5) shows what each rule bought.
- **Vector path untouched.** `_vector_lines` keeps Task 14 as it was, guarded by `test_vector_path_output_is_unchanged`.
- **Chaining needs evidence.** `Evidence.covered` (`dimension_candidates.py:66-86`) joins pieces only on ink, gray or a text box, and the wide-stroke run check stops it from bridging a solid wall. The test `test_chain_is_not_bridged_across_a_solid_wall` covers that.
- **`styled_ticks` is a sensible narrowing of fix2.** Unmarked through-strokes are no ticks only on a line that has marks; bare-extension-line lines keep the fix2 behaviour. Both directions are tested.
- **The reference harness is honest.**
  - The truth carries `profile_check`, `method` and `residual` entries.
  - The scorer self-check covers 0, 1, 3 and 8 px shifts.
  - The residuals are still counted in recall, not excluded.
- **The B1 design was measured.** Two LSD passes were chosen because a single larger pass moved 759 brochure segments; ids stay distinct (`A…`).

## Issues

### Critical

None.

### Important

**I1. Baseline-side label ownership breaks label placements that 06 §8.4 step 1 accepts.**
- **Where:** `dimensions.py:90-115` (`_Labels.owners`) and `:231-232`.
- **The rule.** A label is owned only by the nearest candidate on its baseline side: below horizontal text, right of text reading upwards. A candidate that owns no label is dropped. 06 §8.4 step 1 instead takes any numeric token within 2.5 text heights, on either side.
- **Counter-cases.** I wrote them in `rv14b/vision/tests/test_rv_counter.py` (scratch copy only).

| Case | Result |
|---|---|
| c1a: single horizontal line, labels **below** | pass (the other-side fallback) |
| c1b: labels **below** a chain, an extension-crossed line 30 px below | **FAIL**: the lower line steals the label; the real chain is dropped, the wrong line kept (`[330] == [300]`) |
| c1c: stacked chains 30/40/50 px apart, labels **below** each line | **FAIL** ×3: the inner chain, which carries all the interval spans, is lost (`[330] == [300, 330]`) |
| c1d: control, the same with labels above | pass ×3 |
| c2a: single vertical line, labels **right** | pass |
| c2b: stacked vertical chains, labels **right** of each line | **FAIL** ×3: the inner chain is lost |
| c2c: control, labels left | pass ×3 |
| c3a–c: chains with unlabelled spans (one segment; LSD pieces with gray; an unlabelled wall-thickness line) | pass |
| c4: filled arrowheads, with no, through and ending extension lines, labels above and below; a door jamb through an arrowhead chain; dots with labels below | pass ×9 |

- **Why it matters.** An outer chain plus an overall line is how every plan's outer dimensions are drawn. On any drawing whose house style writes text under the line (or right of a vertical line), the inner chain, which carries all the room intervals Task 20 needs, disappears. The spec names no text side. The report acknowledges the risk in §9, but with the direction wrong: the theft happens when another line sits on the label's *baseline* side, i.e. **below** a label written under its line, not above it. No test pins the limitation.
- **Fix, any of these:**
  1. Decide the convention per drawing: take the majority side of the labels that are beside exactly one candidate, and use that side in place of the fixed baseline side.
  2. Drop a non-owning line only when it also lacks independent support (no mark ticks of its own, or all its ticks are through-strokes of the owning line).
  3. At a minimum, log the limitation as a spec-19 deviation with the direction stated correctly, and add a test that pins the behaviour.

### Minor

**M1. "Matched" is not "correct", and the metrics are blind to ticks.**
- **Where:** `reference.py:414-434`. The match and precision rules look only at line geometry.
- **On HDB:**
  - **L1, the 11000 line, counts as matched**, but its chain starts at source x ≈ 169, so it misses the true left tick at 153.8. It carries a spurious tick at x ≈ 1074, where the ink shows nothing (`rv14b-crops/d_11000_r.png`). Its only span is (1074 → 1120).
  - **The 11000 label goes to the wrong span.** It is associated with the top chain's overall span (246.5 → 1120.7, `D14`), which is about 10 % shorter than the true 11000 extent (153.8 → 1120.8). The cause is the false 1600-side tick at 246.5. So Task 20's scale solver gets a wrong label/span pair. The metrics do count it as a missed label.
  - **L15** is a fragment of the 7000 line with two "ticks" from photo specks 11 px apart (source y 358 / 369). It counts as a true detection.
  - **L17 and L18 (3600, 3100)** carry door-jamb ticks at x 434 / 509 and 719 / 790. The association happens to pick the right overall spans.
- **Recommendation:** record the wrong 11000 pair as a Task 20 / Task 34 residual. Optionally add a span-precision diagnostic to `DimMetrics`.

**M2. Stale docstring references.**
- `region.py:61` cites `segments.in_region`, which does not exist; the segment side is `detect_annotation_segments`.
- `dimension_candidates.py:147` and `:205` cite `_Evidence`; the class is `Evidence`.

**M3. A dead parameter.** `walls.extract_walls(tokens=…)` is now unused (`walls.py:1340`, `del tokens`). It is kept "for the interface"; drop it when Task 31 wires the stage, or record why it must stay.

**M4. A non-deterministic fixture field.** `record_ocr` writes the wall-clock `seconds` into the committed `<stem>.ocr.json` (`reference.py:105`), so every re-record produces a diff. Keep it in the report instead, or accept it.

**M5. The report states the I1 failure direction wrongly** (§9, "lose them when another line sits above").

**T1–T3. Truth errors**, below in its own section. All are Minor.

## Truth verification: `hdb-3room.drawing-dims.json`

### Methods

All of it is in `rv14b-tools/`.

- **Line position.** `prof.py` builds a perpendicular profile every 2 px along each line (median of 3 rows, ±5 px across), with a darkness-weighted centroid against the traced centre (the polyline where given).
- **Ends.** `ends.py` measures line contrast from −25 px to L + 25 px along each line.
- **Ticks.** `ticks.py` locates the darkest crossing stroke on each side within ±8 px. Every flagged tick was then read off raw gray values or 5–8× gridded crops.

### Line positions

All 24 lines are within ±2 px.

- The median offset is ≤ 0.11 px on every line.
- The 90th-percentile |offset| is ≤ 0.46 px, except where labels or crossings sit:
  - bottom 0.98;
  - bottom-overall 0.75;
  - i600 1.07;
  - i400 1.31.

### Labels

All are correct against the drawing (top, right, right-mid, bottom, left and the interior lines), including the `null` wall-thickness intervals.

### Ticks

Within ±2 px everywhere, except:

- **T1, i3100-bed1, tick[1] and p1 (644.0).**
  - The black bedroom wall spans source x 641–658; its left face is at ≈ 640.5.
  - The slash crosses the line at x ≈ 640.
  - The traced tick and end are **≈ 3.5 px inside the wall**. The detector's 641.0 is closer.
  - At the other side of the wall, i3600 p0/tick 661.0 against the face at 658.5 / slash at ≈ 659.5–660 is within about 1.5 px. That is acceptable.
- **T2, bottom tick[0] = 145.6 and bottom-overall tick[0] = 145.0.** The extension line is at x ≈ 143.2 and ≈ 142.6, from the darkest column in rows 945–985 and 1015–1020. The ticks are **+2.4 and +2.2 px** off.

### Ends

The "ends of the stroke itself" rule holds within ±2 px everywhere, except:

- **T3, bottom and bottom-overall.**
  - Both strokes start at x ≈ 136–137 (rows 963 and 1004), but p0 is traced at 145: **≈ 8–9 px short**.
  - Both run on to x ≈ 1132–1133 past the right extension line (row 973 cols 1128–1132; row 1013 similar), but p1 is traced at 1126: **≈ 6–7 px short**.
  - The top and right lines, by contrast, are traced to their true stroke ends.
- **T1 (above)** also puts i3100's p1 inside the wall.

None of T1–T3 affects any metric. The cross-line tolerance is 4 normalized px. The along-line tolerances are 0.005 L ≈ 8.5 normalized px (≈ 5.5 source px) and 80 % coverage.

### The splits

- **3100 | 3600: correct.** The 17 px black wall (x 641–658) carries no dimension ink. Each stroke ends at a wall face with its own slash.
  - In drafting terms it is one chain, interrupted by the wall.
  - Tracing it as two lines follows the file's stated rule, "one line per drawn stroke".
  - `dim_line_is_true` accepts a detected line running through the gap, so the split does not bias precision.
- **300 | 600: correct.**
  - The dark 300 stroke runs from x 657 to 721, with slashes at ≈ 657.5 (wall face) and 681. It runs on past its end tick so it can carry the "300" text, which is written outside the 24 px interval.
  - The 600 stroke runs from 765 to 826, with slashes at 769 and 822.
  - Between 721 and 765 the row holds only light, doubled face lines and no dimension ink or tick (crop `a_300_600_raw.png`).
  - They are separate dimension strokes, not one chain.
- **The added 400: correct.** A vertical, slash-ticked dimension stroke at source x ≈ 799 runs from y ≈ 134 to 179, with slashes at y ≈ 139 and ≈ 176.5 and the label "400" (AC ledge depth).

### Completeness

I scanned the full page and three 1–2× quadrant crops with the truth overlaid. No visible dimension line is missing.

- Every labelled numeric dimension on the sheet maps to a traced interval.
- The remaining long thin strokes are extension lines, face lines, or the dashed ledge lines at y ≈ 140 and ≈ 845.

## Generality summary (06 §8.4 conventions)

The conventions 06 §8.4 names are: slash ticks, perpendicular bars, extension lines touching the line, filled dot or arrowhead blobs, and a numeric label within 2.5 text heights.

**What holds:**
- arrowhead ticks, in every variant tested;
- dots;
- chains with unlabelled spans;
- single lines with labels below or right.

**What breaks:** a line (typically the inner chain of a stacked pair) whose labels stand on the side opposite the code's assumed baseline side, whenever another surviving candidate lies on the baseline side within reach (I1).

## Assessment

**Task quality:** Needs fixes. I1 needs either a convention-agnostic ownership rule, or an explicit, correctly-stated logged limitation with a pinning test, before Task 20 builds on this.

**Reasoning:** The fix meets every amended acceptance target, and I reproduced the numbers exactly; the code is well decomposed and well tested. But the new ownership rule silently drops whole dimension chains under a common label placement that the spec permits, and the reference metrics cannot see tick or span errors on "matched" lines.
