# Task 14 report: dimension lines, spans, text association

## Implemented
- `vision/app/schemas/candidates.py`: `DimensionLine` (tick_positions = px from p0 along the line) and `DimensionSpan`.
- `vision/app/pipeline/dimensions.py`:
  - `find_dimension_lines(segments, tokens, region, *, ink=None)`: candidates are thin segments >= 0.04 L with a numeric token (centre projecting inside the line, within 2.5 x token height) and >= 2 ticks.
    - Segment ticks (always): thin segments of 0.005 L..0.03 L crossing the line in their middle 80 % at 90 +- 10 or 45 +- 15 degrees; perpendicular thin segments (any length) with an endpoint within 2 px of the line (extension lines).
    - Ink ticks (when `ink` is given, per controller ruling): at every 1 px position along the line, 15 probes (90 +- 10, 45 +- 15, 135 +- 15, 5 / 7.5 degree steps), each `max(0.005 L, 3 x line width + 2 px)` long and centred on the line. A probe hits when >= 80 % of its samples are inked (threshold chosen: tolerates ~1 missing sample in 5 and a 1 px offset of the centre line). For each hit the full ink run through the centre is measured (1-sample gaps bridged): it must be 0.005 L..0.03 L long, centred (shorter side >= 30 %), and the stroke must be <= 2 x line width + 2 px thick near both probe ends. The last rule rejects a thick wall cut at a slant, which otherwise looks like a short diagonal run; found while testing. Hits are clustered within 3 px.
    - Dot/arrowhead blobs on the ink: stretches where the ink across the line is 2.5 line widths..equal-area diameter of (0.006 L)^2 wide.
    - All ticks within 4 px are deduped. Collinear duplicate segments of one line are dropped, keeping the best-supported one. Ids L1..Ln by (min y, min x, max y, max x).
  - `find_dimension_spans`: chain spans left to right, then overall (3+ ticks); 2 ticks give one `overall` span. Ids D{n} run in line-id order, chain spans first then overall (the brief's expected D3 = overall rules out a pure geometric sort across a line's spans). axis x/y within 10 degrees, else other; `near_text_ids` ordered along the line; orientation 0 <-> x, 90 <-> y, none on `other`. `region` is unused (deleted, as `detect_plan_region` does with `ink`).
  - `associate_dimension_texts`: nearest midpoint, ties to the shorter span (then id, for determinism).

## Tests (vision/tests/test_dimensions.py, 18)
Brief tests (chain, two ticks, bar/extension lines, no text, orientation, association nearest and tie) plus tick geometry limits, thick-segment exclusion, vertical/diagonal axes, id order, duplicate segments, and raster tests:
- `render_plan` + `SDimChain` + `preprocess` + `detect_segments`, tokens built directly, slash and bar ticks: `find_dimension_lines(..., ink=None)` returns `[]` (LSD drops all 16 px ticks), with `ink=pre.ink` finds the 3 ticks within 3 px and the 3 spans. This is the "segment-only detection misses" proof.
- Vertical raster chain; ticks found by both LSD and ink are counted once (DIM_TICK_PX patched to 50); crossing thick wall is not a tick; dot blob ticks.

Mutants checked: dedupe off (5 failures); removing the stroke-width rule fails the crossing-wall test.

### TDD evidence
- RED: `uv run pytest tests/test_dimensions.py -q` -> `ImportError: cannot import name 'dimensions' from 'app.pipeline'` (collection error), before dimensions.py existed.
- GREEN: `18 passed in 1.35s`. Full suite: `385 passed, 1 skipped`. `ruff check`, `ruff format --check`, `mypy app` clean.
- Perf: one 3800 px line on a 4000x3000 mask with a thick wall crossing: ~34 ms.

## Spec inconsistency (for spec 19)
06 §8.4 step 1 tick length range 0.005 L..0.03 L is partly below the §7.9 segment filter `max(8 px, 0.008 L)`. A 16 px tick on a 2000 px region (0.008 L) is dropped by LSD, so segment-only tick detection fails on raster pages. Resolved by ink probing (controller ruling). Other notes:
- Task 13 splits a thin dimension line where a thick wall crosses it, so on raster pages a dimension line may be two collinear segments; the second can be a candidate on its own (only if it holds >= 2 ticks and a label).
- A stroke crossing the dimension line and splitting into two thin segments counts as two touching extension lines (spec: "perpendicular extension line touching within 2 px").
- Region: dimension chains must lie inside `pre.region` (walls + 6 %) to reach `detect_segments`.

## Concerns
- Tick range/threshold constants (80 % inked, 30 % balance, 2 x width stroke limit, 4 px dedupe, 6 px end slack) are my choices; unverified on real scans (Task 34).
- Step 1 does not check label orientation (spec: only a numeric token within 2.5 heights); orientation applies in spans only.

Files: vision/app/pipeline/dimensions.py, vision/app/schemas/candidates.py, vision/tests/test_dimensions.py

## Fix round 1

Changes (vision/app/pipeline/dimensions.py, vision/tests/test_dimensions.py):
1. **D-id order**: `find_dimension_spans` iterates the lines in the given (geometric) order; the association tie-break uses the span's list position, not the id string. Test: 12 lines, D1..D12 with line_ids L1..L12 and ascending y.
2. **Ink upper bound**: each hit position is now measured at all 15 probe angles and decided on the angle with the longest run (the stroke's own direction), so a tilted probe that leaves a thin stroke no longer decides. A cluster-level guard also rejects a stroke through the line (any angle, > 0.03 L total, > 14 px on both sides) within 2 px of the tick. The thin-stroke check is now made half way along each arm (not at the probe end), which also rejects a big dot's edge. Clusters need >= 2 accepted positions (a lone position is a probe fluke at a stroke's edge). Tests: 300 px vertical stroke, 400 px stroke, tilted 300 px stroke crossing the line; 71 px off-centre stroke; big dot (31 px).
3. **Deadline and cost**: `check_deadline` is called per candidate and per probing chunk. Cost bounds: thin-segment arrays and label arrays are built once; a cheap side-ink prefilter (ink at +-(w/2 + 2.5) px beside the line within +-window) restricts probing to relevant positions, and a line with ink beside > 60 % of its length is not probed (wall edge / hatching / dense drawing). Perf test: 3000 random long thin segments (about 20 % ink) + 40 chains + 440 numeric tokens on 4000x3000: 2.2 s (before: > 25 s on the same case; limit in the test 10 s). Tests: callback invoked per candidate, raising aborts both in the candidate loop and inside the ink probing.
4. **Extension-line overshoot**: segment path: perpendicular strokes touch within `2 + w/2 + 1` px, or cross the line and end <= 14 px beyond (LSD adds ~3 px). Ink path: perpendicular probes also hit when one half is inked, and a perpendicular run ending within 14 px on one side is an extension line (thin check on its long arm only). Tests: overshoot 0, 2, 4, 8 on a rendered plan through detect_segments, with and without ink; ink-only 0, 2, 4, 8, 12; a stroke crossing by 20 px is no extension line; a 45-degree stub is none.

Minor items: ~70 degree tick (kills the perpendicular-tolerance mutant), label placed on the stub (kills MIN_LINE_FRAC=0), across-the-line check test, small dot (11 px < 12 px probe) and big dot blob tests (blob needs >= 0.5 aspect, so a 9 px stroke is no dot), text glyph stems 2 px above the line, too-short 9 px run, dotted tick (probe fraction), off-centre stroke (balance), ticks 4 px beyond the segment ends (END_SLACK). Docstring: callers must pass a text-free mask. Task 12 produced `OcrResult.ink_notext` (`ink` with the text mask removed); Task 31 should pass `ocr.ink_notext`. Note the Task 14 raster tests still use `pre.ink` (no text drawn).

Mutants (own runner, restores the file between runs): all killed except two equivalent ones: `total <= hi` in the ink body test (the through-stroke guard rejects the same strokes) and `perpendicular[best]` in the extension rule (stage-1 requires a full-probe hit for slanted strokes). The reviewer's mut.sh does `git checkout -- dimensions.py` after each mutant: it must not be run on an uncommitted tree (it reverted my working copy once; restored from a backup).

### Evidence
- `uv run pytest tests/test_dimensions.py -q` -> 45 passed in ~5 s.
- Full gate: `ruff check`, `ruff format --check`, `mypy app` clean; `uv run pytest -q` -> 412 passed, 1 skipped.
- Constants chosen (unverified on real scans): EXTENSION_OVERSHOOT_PX 14, TICK_WIDTH_FACTOR 2.5 (+2 px), MAX_BUSY_FRAC 0.6, MIN_CLUSTER 2, PREFILTER_OFFSET_PX 2.5, BLOB: width + 6 px.

## Fix round 2

Replaced the ink-probe design (`_ink_ticks` probing, `_passes_through`, busy prefilter, MIN_CLUSTER, BLOB_ASPECT, `_inked`) with the component-based design of `task-14-fix2-design.md`. Segment ticks, spans, association and the deadline hook are unchanged.

### Implementation (vision/app/pipeline/dimensions.py)
- Band: one `cv2.warpAffine` (INTER_NEAREST) into line coordinates, u in [-6, len+6], |v| <= ceil(0.015 L)+6.
- Clearing: every long horizontal run (>= 0.03 L: the line itself, parallel dimension lines, wall edges) is cleared with a pixel of margin (opening with an odd 1xK kernel on the rows that can hold such a run). The line's own rows are the cleared rows around v = 0. Deviation from the design text: the line is cleared by run length rather than by `w/2+1`, because `Segment.width_px` (1.9 for a 3 px line) and the segment centre are off by up to a pixel; stacked chains also need the other lines cleared.
- Components (8-connected) touching the cleared rows (directly adjacent, so glyphs 2 px away do not touch) are strokes; the two halves of a crossing stroke are merged when their near-line u differ by <= line zone + 2.
- Per stroke (moments, PCA axis, farthest pair for < 6 px): wider than 2.5 w + 2 -> not a tick; 90 +- 10 degrees -> tick of any length; 45 +- 15 / 135 +- 15 not reaching the band edge and 0.005 L..0.03 L -> tick; anything else no tick. Added: strokes with elongation < 3 (no clear direction: wedges, dots) are not judged as strokes and are left to the blob rule.
- Blobs: thickness of the ink run through the line per column (so other chains' lines do not add up), runs >= width + 3, excess area <= (0.006 L)^2, length <= 0.012 L. Columns of ticks and of strokes too long to be blobs (band-edge or longer than 0.012 L, widened by the run they leave inside the cleared rows) are skipped; without that a 300 px stroke at 10-77 degrees leaves a "blob" at the line. Position: run centre; an arrowhead (clearly thicker at one end) at its tip, extrapolated from the thickness profile (<= 12 px).
- Dedupe `max(4, 2 w)`, ticks outside [-6, len+6] dropped, `check_deadline` once per candidate (and per stroke).
- Cost: row prefilter for the opening, argmin run lengths. 40 lines + 3000 long segments (400 random labels, about 2100 candidates) on 6000x4000: 2.6 s (limit in the test 5 s).

### Tests (tests/test_dimensions.py: 86; tests/support/inkdraw.py: stroke/polar from the reviewer harness)
Rewritten against behaviour: removed the probe-pinning tests (dotted tick, off-centre stroke, short run, 20 px crossing, long thin crossing); added the acceptance cases below plus: specks on the line, ticks beyond the ends, slash length scaling with L, diagonal length/band-edge cases, 10-span tie (`D2..D12`, "D10" < "D2" as strings; the winner must be D2 by list position). All ink cases run at 6 y-phases with the segment jittered 0-0.8 px off the ink.

| Acceptance case | passes (runs = cases x 6 phases) |
|---|---|
| slash ticks, 17 px, tick 1/2/3 px on line 1/2/3 px | 54/54 |
| backslash ticks, same | 54/54 |
| bar ticks, same | 54/54 |
| no false tick: 300 px stroke 1/2/3 px, 0-180 deg in 2.5 deg steps excluding 80-100 | 1152/1152 |
| dense chain: 46 ticks every 100 px on L = 5000 | 6/6 |
| stacked chains 25 px apart, extension lines through the inner chain + slash ticks | 6/6 |
| stacked chains 40 px apart, same | 6/6 |
| solid arrowhead 8x8 on 2/3 px lines | 12/12 |
| solid arrowhead 10x6 | 12/12 |
| solid arrowhead 16x8 | 12/12 |
| dots 7/9/11/14 px on 2/3 px lines | 48/48 |
| 12 px walls crossing the line (not ticks) | 6/6 |
| extension lines ending 0 / 2 / 4 / 8 / 12 px past the line | 6/6 each |
| text glyphs 2 px from the line (not ticks) | 6/6 |
| perf: 40 lines + 3000 long segments, 6000x4000 | 2.6 s < 5 s |

Arrowhead position tolerance in the tests is 10 px: 16x8 and 10x6 wedges are placed at the tip (extrapolated), 8x8 ones can be read as a bar at the base (up to ~8 px from the tip).

### Mutation check (scratch copy `scratchpad/mutw`, never the worktree)
Killed (>= 1 test fails): perpendicular rule off, diagonal rule off, diagonal lower bound off, diagonal upper bound off, band-edge rejection off, thickness rule off, blob rule off, blob area limit off, blob excess 3 -> 1, blob skip ranges off, arrowhead tip off, halves not merged, opening off, touch tolerance up/down +3, tiny-component filter off, elongation off, deadline off. Survivors (not design rules): blob length limit (redundant with the skipped long strokes), dedupe radius 2w vs 4 (equal for w <= 2), END_SLACK output filter (the band already ends there), the one-pixel clearing margin.

### Spec 19 log
- Perpendicular strokes crossing the dimension line are ticks whatever their length (extension lines, including those running through an inner chain of a stacked string, and long walls at 90 +- 10 degrees that are thin). Walls wider than 2.5 line widths + 2 px are excluded.
- A short compact mark (dot, arrowhead, a stroke at an off angle of 5-20 px) with ink thicker than the line by 3 px is a blob tick; a short stroke between 10 and 80 degrees that is thick enough reads as a blob. Known limitation, to be checked at Task 34.

Gate: `uv run ruff check .`, `ruff format --check .`, `mypy app` clean; `uv run pytest -q` -> 453 passed, 1 skipped.

## Fix round 3

Changes (vision/app/pipeline/dimensions.py, vision/tests/test_dimensions.py):
- **N1 / N2 merge**: the two halves of a stroke across the line are paired nearest-u first within `2 * zone + 6` px (was `zone + 2`), so 32-40 and 140-148 degree strokes are one stroke. Position of a two-sided stroke is the mean of the u where its halves meet the line (a bar plus slash compound has no clear principal axis). Two-sided strokes without a clear direction (elongation < 3: bar + slash compounds of stacked chains) are ticks when tick-sized (0.005 L ... 0.03 L tall), thin and inside the band.
- **N3 arrowheads**: a perpendicular stroke shorter than 0.005 L is not a stroke tick any more (arrowhead wedges, dots); it goes to the blob rule. Small marks (blobs, short strokes) within 0.012 L of a tick of tick size are part of it (arrowhead at an extension line), and the remaining small marks within `max(8, 2 w + 4)` px are one mark (heads meeting tip to tip).
- **N4**: the band has 0.012 L of room beyond the line ends (an arrowhead whose body is off the line); the tip is the vanishing point of a linear fit of the taper (columns thicker than the line next to the run), at most 0.006 L beyond the narrow end.
- **N6**: segment ticks are deduped with 4 px exactly as in 5512b3c; ink ticks with `max(4, 2 w)`; then both are merged within 4 px. Property test `test_vector_path_output_is_unchanged`: 300 seeded random vector scenes, SHA-256 of lines, spans and associations equals the digest of the 5512b3c implementation (the round-2 implementation gives a different digest, checked).
- **N7**: a stroke touches the line only when it is inked in the row next to the line (connected in the original ink); glyphs one empty row away are no longer cut into ticks by the clearing margin.

Rejected on the way: stroke angle from the pixels near the line only (loses elongation on bar + slash compounds), slope-predicted pairing (not needed once the window is wide and the position comes from the edges).

Tests: 139 in tests/test_dimensions.py (86 before). Full vision suite 506 passed, 1 skipped; ruff, ruff format --check, mypy clean. Reviewer harness a1.py on the new code: 6912 runs, 0 false ticks, 0 lost real ticks. All ink cases run at 6 phases.

| New case | passes |
|---|---|
| 80 px stroke at 32/35/38/40/140/145 deg, width 1-3: no tick | 108/108 |
| 100 px stroke at 32/35/38/40/140/145 deg, width 1-3: no tick | 108/108 |
| 140 px stroke at 32/35/38/40/140/145 deg, width 1-3: no tick | 108/108 |
| real 17 px ticks at 35 deg, width 1-3, within 2 px | 18/18 |
| real 17 px ticks at 40 deg, width 1-3, within 2 px | 18/18 |
| real 17 px ticks at 140 deg, width 1-3, within 2 px | 18/18 |
| real 17 px ticks at 145 deg, width 1-3, within 2 px | 18/18 |
| stacked chains gap 25, slash 45 deg, widths 1-3^3 (both chains, once each) | 162/162 |
| stacked chains gap 40, slash 45 deg, widths 1-3^3 (both chains, once each) | 162/162 |
| stacked chains gap 25, slash 135 deg, widths 1-3^3 (both chains, once each) | 162/162 |
| stacked chains gap 40, slash 135 deg, widths 1-3^3 (both chains, once each) | 162/162 |
| arrowhead 8x8 + extension line through the tip, lines 2/3 px: exactly one tick per end | 12/12 |
| arrowhead 10x6 + extension line through the tip, lines 2/3 px: exactly one tick per end | 12/12 |
| arrowhead 12x5 + extension line through the tip, lines 2/3 px: exactly one tick per end | 12/12 |
| arrowhead 16x8 + extension line through the tip, lines 2/3 px: exactly one tick per end | 12/12 |
| chain with 8x8 heads at every boundary, interior tip to tip, with extension lines | 12/12 |
| chain with 10x6 heads at every boundary, interior tip to tip, with extension lines | 12/12 |
| chain with 12x5 heads at every boundary, interior tip to tip, with extension lines | 12/12 |
| chain with 16x8 heads at every boundary, interior tip to tip, with extension lines | 12/12 |
| chain with 8x8 heads at every boundary, interior tip to tip, without extension lines | 12/12 |
| chain with 10x6 heads at every boundary, interior tip to tip, without extension lines | 6/6 |
| chain with 12x5 heads at every boundary, interior tip to tip, without extension lines | 0/0 |
| chain with 16x8 heads at every boundary, interior tip to tip, without extension lines | 12/12 |
| arrowhead 10x6 tip within 6 px, body on the line | 12/12 |
| arrowhead 12x6 tip within 6 px, body on the line | 12/12 |
| arrowhead 16x8 tip within 6 px, body on the line | 12/12 |
| arrowhead 20x10 tip within 6 px, body on the line | 12/12 |
| arrowhead 10x6 tip within 6 px, body beyond the line end | 12/12 |
| arrowhead 12x6 tip within 6 px, body beyond the line end | 12/12 |
| arrowhead 16x8 tip within 6 px, body beyond the line end | 12/12 |
| arrowhead 20x10 tip within 6 px, body beyond the line end | 12/12 |
| glyph stems one empty row from the line: no tick | 6/6 |
| vector path digest equals 5512b3c on 300 seeded scenes (301 lines found) | 1/1 |

(The 12x5 heads without extension lines are 0/0: on a 2 or 3 px line they rise 1 px above the line and are skipped by the test.)

Mutation check (scratch copy only): killed: merge window back to zone + 2, pairing off, contact rule off (one empty row glyph), compound branch off, small-mark/tick merge off, small marks never clustered (tip to tip), taper fit off, band slack back to 6 px, perpendicular minimum length off, perpendicular/diagonal/band-edge/thickness/blob rules. Survivors: ink dedupe radius `2 w` vs 4 (equal for w <= 2), `len(edge_u) == 2` position (equal to the axis intercept within the test tolerance).
Known limits: 10x6 and 16x8 heads without extension lines on a 3 px line are found at 5 of 6 phases of the reviewer harness (tip at +-5 px); 12x5 heads on 2-3 px lines rise too little above the line to be seen.

## Fix round 4

Changes are in `vision/app/pipeline/dimensions.py` (`_ink_ticks`, new helpers `_line_rows`, `_run_through` and `_tip`, and a rewritten `_blob_position`) and in `vision/tests/test_dimensions.py`.

- **N9: local line rows and local contact.** The line's own rows are now found per column (`_line_rows`). In each column the line is the run of opened rows (long horizontal runs, before the 1 px margin) nearest the band centre, searched within `int(w/2)+3` rows of it. Columns with no such run take the rows of the nearest column that has one; these are the line ends and gaps.
  - **Contact.** A component touches the line when it lies within one pixel of the line's own pixels at its columns, or within one pixel of ink that itself lies within one pixel of them (two dilations, the second one through ink only). A glyph with one empty row between it and the line is therefore not in contact.
  - **Side.** The side of the line is the middle of the component's rows against the local line rows ± margin, taken at the centroid's column. The margin is applied only when the line was found anywhere. A component that straddles the line is no half of a stroke, as in round 3.
  - **Line thickness.** `zone` (the line thickness used for the pairing window, the run in the zone and the blob line width) is now the most common local thickness. Before, it was the count of global rows with a row share of at least 50 %.
  - **Blob thickness.** Thickness is now the ink run through the local middle row of the line, followed only in columns where something touches the line.
- **N10.** Marks outside the kept range (−6 … len+6) are dropped before small marks are absorbed or clustered, so they absorb nothing.
- **N4.** The excess-3 threshold was not the cause. The heads were found, but the tip extrapolation put them up to 8 px beyond the end: it fitted the thickness, and with the line 0.8 px off the head's axis only one edge rises above the line. The tip is now where the linear fits of the head's upper and lower edges meet, using the parts that show beside the line. With one edge, the tip is where that edge meets the line's middle. With no edge, the old thickness fit is used. The same clipping as before applies. Line thickness stays as above (the local mode, integer rows); a sub-pixel estimate was not needed.
- **Performance.** The perf test takes 3.98–4.2 s at load average 5 (round 3: about 3.7 s unloaded; side by side under the same load, `find_dimension_lines` takes 4.4 s against 4.0 s for round 3). The limit is 5 s.

Tests: 31 new cases in `tests/test_dimensions.py`, 170 in all. Each runs at 6 phases.

- Slash and backslash ticks on a 2/3 px line with a 1 px step at x = 600 / 750.
- Slash ticks on a 2/3 px line drifting 0.25–1.5 px against its segment, at sub-pixel phases.
- An end dot with an extension line 8/16/28 px past the end (N10).
- 10×6 and 12×6 heads with the line offset 0 / ±0.3 / ±0.5 / 0.8 px (N4).
- Lone glyph stems one empty row from 1/2/3 px lines. This guards local contact.
- Bar ticks at the ends of a 1.5 px line at 3° / 20° with segment noise. This guards the straddle rule.
- A dashed line (40/8) giving no misplaced ticks. This guards the fallback without a margin.

On f8d4983's code these fail: step (slash variants), drift (9 of 10), end dot (3/3), off-axis heads (3 px line), thin tilted line (2/2). The lone-stem and dashed guards pass there, as intended; they are there for the new code paths.

Mutation check, in the scratch copy `scratchpad/mut4` only; every mutation is killed:

| Mutation | Killed by |
|---|---|
| global line rows | step and drift tests |
| contact always true | lone stems, stacked slash chains |
| contact without the ink hop | lone stems |
| kept-range filter off | end dot |
| edge tip off | off-axis heads, thin tilted line |
| side by centroid | thin tilted line, dashed |
| margin always 1 | dashed |

Gate: `uv run pytest -q` gives 537 passed, 1 skipped. `ruff check`, `ruff format --check` and `mypy app` are clean.

### Probe results (reviewer harness, copied to `scratchpad/rr6`; R2 = `dimensions_r2`, R3 = f8d4983)

| Probe | R2 | R3 | R4 |
|---|---|---|---|
| s1: 3 px line, 1 px step at x = 600 / 750, 45° slash | ok / ok | lost / lost | ok / ok |
| s1: 2 px line, same | lost / lost | lost / lost | ok / ok |
| s1: bar ticks, 2 and 3 px, all step positions | all ok | all ok | all ok |
| j2: 3 px drift 0.25 / 0.5 / 0.75 / 1.0 / 1.5 (of 12) | 12 12 12 12 12 | 4 7 4 2 0 | 12 12 12 12 12 |
| j2: 2 px, same | 8 9 9 4 3 | 8 9 9 4 2 | 12 12 12 12 12 |
| j2: 1 px, same | 8 7 0 0 0 | 8 7 0 0 0 | 11 12 11 8 8 |
| k4: 3 px slash, noise 0 / 0.25 / 0.5 / 1.0 (of 40) | 40 40 40 40 | 39 40 40 33 | 40 40 40 40 |
| k4: 3 px bar, same | 39 40 39 38 | 39 40 38 39 | 40 40 40 40 |
| k4: 1.5 px bar, same | 40 40 34 29 | 40 40 33 28 | 40 40 39 31 |
| k4: 1.5 px slash, same | 40 35 20 11 | 40 35 20 11 | 40 35 20 20 |
| N7 f3: stem one empty row, false (lw 1/2/3, of 12) | 12 12 12 | 0 0 0 | 0 0 0 |
| N7 f5: glyph texts, one empty row (3168 runs), false | n/a | 0 | 0 |
| a1: 6912 crossing strokes, false / lost | 0 / 0 | 0 / 0 | 0 / 0 |
| N1 x1: shallow-angle sweep, false of 11340 / lost real | 1788 / 302 | 0 / 0 | 0 / 0 |
| N2 b2: 648 stacked combinations, bad configs (failed chain-phases) | n/a | 18 (36) | 18 (32) |
| N3 m1: arrowhead + extension line, exactly 2 ticks | | all 6/6 | all 6/6 |
| N3 m2: chains with heads at every boundary (10×6 / 16×8, 3 px, no extension lines) | | 5/6, 5/6 | 6/6, 6/6 |
| N6: vector digest test and i1 (3000 vector scenes against 5512b3c) | | equal | equal |
| N4 c2: 10×6 / 12×6 on 3 px at 6 offsets incl. 0.8 (found within 10 px) | 0/6 / 0/6 (tips read 10–12 px inside) | 5/6 / 5/6 | 6/6 / 6/6 (tips within 4 px) |
| N4 c2: tip error on 2 px, 16×8 and 8×8 | up to 7 px | 2–6 px | 0–3 px |
| N10 w3: end dot + extension line 8–28 px past the end (of 6 per gap) | 6 | 0 | 6 |
| w3: gap 5 (extension line inside the kept range) | 0 | 0 | 0 (the line is a mark there) |

Other harness scripts give the same output as round 3: u1, w1, t1, q1, h3, v1, v2 and f5. Changed:

- **k1 and k3 (rotated 1–3 px lines).** k1 is equal or better in every cell. k3 is equal or better except `slash lw 1 at 10°` (1/12 → 0/12).
- **j1 (drift up to 10 px).** Better everywhere except `slash lw 3 drift 10`: the ticks are found 4 px off (296 / 1204), so they count as false at the probe's 3 px tolerance; R3 found nothing there.
- **n1 (dashed lines).** Same as R3, apart from a 2 px better slash position.
- **g1.** `slash gap 6 aligned` (two chains 6 px apart with crossing slashes) is 3/36, against 9/36 in R3 and 7/36 in R2.

Known limits:
- A 1 px line whose drift leaves a run shorter than 0.03 L at an end (j2 lw 1, drift ≥ 1 px) loses that end's tick 4 times in 12: the run is not opened, so it is not cleared.
- Dashed lines with dashes under 0.03 L have no line to clear. As in R3, the rows there are a guess, and dash 20/6 still gives misplaced ticks, as it did in R3.
