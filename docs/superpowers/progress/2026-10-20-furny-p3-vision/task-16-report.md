# Task 16 report: wall extraction (filled, double-line, single-line, vector)

**Status:** DONE_WITH_CONCERNS. The stage is complete and tested. The reference fixtures fail almost entirely because of upstream preprocess problems, plus one spec gap (medium-width wall strokes). Details are in "Reference images" below.

**Commit:** `45c2096 feat(vision): wall extraction from filled, double-line and single-line drawings`, pushed to `origin/build/p3-vision`.

## What was implemented

`vision/app/pipeline/walls.py` (new, 1227 lines; graph.py is 1162 for comparison):

- `WallExtraction(mask, source_mask, raw, theta0, t_median)`. Both masks are page-sized uint8. `t_median` is the length-weighted median raw thickness.
- `extract_walls(page, pre, segments, dimension_lines, ctx)` implements 06 §8.1 steps 1–8 on the plan-region crop:
  1. **W_fill** is `pre.thick` with Sauvola holes closed (binding carry). The rule is `close(thick, Sauvola window)` intersected with pixels whose grey is at most the midpoint of the median wall grey and the median paper grey. It is skipped for `colored_brochure`, whose `thick` comes from the colour mask and is never hollowed, and when that contrast is below 30. On `pdf_vector` pages, the vector mask adds stroked vector segments with `width_px ≥ 2.5 t_thin` and dark `VPolygon`s mapped through `page.transform`. Fill-only shapes are handled as solid walls, per the Task 9 ruling.
  2. **Dimension exclusion**: segments whose id is in `find_dimension_lines`' `segment_id`s are dropped. So are thin segments lying on a dimension line (within 2 px and inside its extent).
  3. **Double-line**: thin segments ≥ 0.02 L; pairs within 2°, `d ∈ [0.004 L, 0.03 L]`, overlap ≥ 60 % of the shorter, strip ink < 15 % or > 85 % (measured on `pre.ink`, excluding the lines' own widths). Greedy by d ascending, then overlap descending. Candidates come from 2° buckets and sorted offset windows, not all pairs. Each pair fills the quad between the two centre lines (thickness = d), extended by d/2 at an end where one of the lines runs on (a corner or T), but not where both stop (a jamb), so openings keep their width.
  4. **Single-line**: only when fill ∪ double ∪ vector covers < 0.2 % of the region. Thin segments ≥ 0.05 L are drawn as 3·t_thin butt-ended quads.
  5. The union is closed with a 3×3 kernel. Holes smaller than (0.01 L)² are filled so the skeleton has no pixel loops.
  6. **Skeleton tracing**: `skeletonize`, then an 8-neighbourhood pixel graph (nodes are clusters of pixels with neighbour count ≠ 2, labelled with `cv2.connectedComponents`). Edges are walked in pure Python over sorted flat indices, with no full-image index arrays. Spurs from a junction to a free end shorter than 1.5 × local thickness (2·dt at the junction) are pruned, and degree-2 nodes are contracted (two rounds). `cv2.approxPolyDP(ε = max(1.5, 0.25 × median skeleton thickness))` gives the straight pieces. Each piece gets thickness 2·median(dt_W) and the majority source label.
  7. **Snap**: pieces within 3° of θ0 + k·90 are rotated about their midpoint. Off-axis pieces ≥ 0.03 L are kept as diagonals and shorter ones are dropped. If a path's dropped head or tail ended free (a skeleton curling into a wall end's corner), the kept piece inherits the free end; otherwise it is extended along its line to the projection of the end node (a diagonal curling into a junction). Free ends are then marched along the piece to the end of the mask, because the skeleton stops about t/2 short and gaps would otherwise widen by t.
  8. **Runs**: pieces are grouped by direction (two axes, diagonals within 1°) and clustered by offset (≤ 0.5·min t, at least 1.5 px), then swept along the line. Breaks ≤ 1.5 t merge. An **empty** gap (≤ 10 % wall along the gap's centre line) of 2.5 t–18 t between pieces of similar thickness (ratio ≤ 1.5) becomes an `openings_px` interval on the **one** RawWall of the run (binding carry). Any other break ends the run.
  - **Door leaves** (binding carry): a run whose near end lies within `max(t_host, t_run) + 2` of a gap's jamb point is a leaf if its far end is free, it leaves the host at ≥ 30°, and |far end − jamb| ∈ [0.8 g, 1.1 g]. Leaves are dropped. The near-end tolerance covers a leaf merged with the jamb's end cap.
  - **Duplicates** (binding carry): `dedupe_raw_walls` drops near-identical collinear copies (within 1°, both ends within max(1, 0.25 t)) and merges their openings into the kept wall. It runs at the end of `extract_walls` and again in `walls_to_graph` before `build_wall_graph`. Results are order-independent: the kept wall is the first in a canonical order.
  - `ctx.check_deadline` is wrapped in a 20 ms throttle and polled per block (400k-sample candidate blocks) and every 4096 tracer steps.
- `walls_to_graph(ext, region, *, check_deadline=None)` calls `build_wall_graph(dedupe(raw), r=max(t_median, 0.006 L), t_median, L=region.long_side, theta0_deg=ext.theta0)` and returns the graph as built. **`graph.gaps` are the GapCandidates** (binding carry); nothing is re-derived from `openings_px`, so gap ids match the graph's wall ids. The brief's wording ("turns openings_px intervals into GapCandidates") is met through `build_wall_graph`, which re-bases the raw openings onto the final walls.
- `debug_walls_png(page, ext, graph)` draws a faded page with the mask coloured by source (filled red, double blue, single green, vector dark red), the graph's centre lines in black, node circles, and gaps as thick yellow lines.
- I12: the only imports are binarize, context, graph, normalize, segments, `schemas.candidates` and `utils.geometry` (no labeling, no scale). A test checks this.

## Deviations and additions (for 19 / the reviewer)

1. `source_mask` value **4 = vector**, added to the brief's 1/2/3 so vector-page wall pixels can be told apart from the raster thick mask. On vector pages, vector pixels override filled ones, so walls report `source="vector"` as the brief's test expects.
2. Double-line "each segment used at most once per side" is applied **per stretch of the side**. A face line broken by a T junction pairs with both pieces of the opposite face. The strict reading loses half of every T-junction wall, and `test_double_line_walls` fails under it. Claims may touch by 1 px.
3. Quads are extended by d/2 where one line runs on, not where both stop. This closes corners without narrowing door gaps.
4. Free-end refinement (march to the mask end) and head/tail closure after dropped pieces are additions inside step 6/7. Without the march, measured gaps are about g + t.
5. Step 8: a gap candidate also requires the gap to be empty in W (no wall crossing it). Tiny-gap merges (≤ 1.5 t) have no thickness condition, as in the spec; gap candidates need ratio ≤ 1.5, as in the spec.
6. Hollow-wall fill uses a grey-level test (it covers grey fills as well as black) rather than `dark`.
7. Single-line and vector strokes are drawn as butt-ended quads, so free ends and gaps are exact.
8. θ0 is `dominant_orientation` over the non-dimension segments.

## Tests

`vision/tests/test_segments_walls.py` has 43 tests (parametrized cases counted). All the brief's tests are included, with the brief's values: filled rectangle + partition (7 walls, 6 nodes, filled, 14 ± 2, no free ends); double-line (7, `double_line`); single-line sketch (evidence 0.5); gap candidate (90 ± 4 on the partition, hinge at start and at end, one raw wall carrying the opening); 20 px break closed; dimension chain not a wall (plus a discriminating run without the exclusion); off-axis diagonal kept and stub dropped (diagonal standing on the bottom wall and hanging from the top wall); vector 5 px strokes (t_thin = 1) → `vector`.

Binding carries and extras:
- 80 px filled wall on a 3000×2000 page → one filled wall of 80 ± 4 (the test first checks that `thick` really is hollow).
- 70 px rectangle keeps its topology, with corners exact on the raw walls.
- Leaf touching the jamb is not a wall (discriminating: with `LEAF_MAX = 0`, the leaf appears). A long wall starting at a jamb is kept.
- θ0 passed through (spy on `build_wall_graph` kwargs `theta0_deg`, `r`, `t_median`, `L`); rotated plan (10°) snaps to θ0.
- Duplicates: the spy shows `build_wall_graph` receives only 2 walls out of 81 stacked copies; thick copies 16 px off are matched and their openings merged; 30 stacked vector strokes become one wall.
- Gap limits (32 → split, 38 / 240 → gap, 260 → split); similar-thickness rule; gap crossed by a wall gives no opening.
- Double-line pair limits (overlap 86 % vs 57 %, d below 0.004 L / at most 0.03 L / above 0.03 L); hatched strip (≈ 40 % ink) not paired vs a plain pair paired; once-per-side greedy case; single-line rule needs an empty wall mask; pilaster spurs pruned.
- Vector filled polygons → `vector` walls; deadline raises `deadline_exceeded`; empty page; debug PNG colours and centre lines; I12 import check.
- **Perf:** on a 6000×4000 page with 13×15 filled walls, `extract_walls` takes about 1.2 s (profile: skeletonize 0.25 s, trace 0.3 s, components 0.2 s). The guard is set at 8 s.

Mutation checks (each mutant run against the whole file; every one fails at least one test): hollow fill off; dedupe in `walls_to_graph` off; gap-emptiness off; similar-thickness off; free-end inheritance off; head/tail extension off; spur pruning off; leaf test off; single mask off; hollow/filled strip test off; side claims off; free-end march off; dedupe cell back to 8 px; θ0 not passed. Two pieces of code that no test could reach were removed rather than kept untested: a `_join` of kept pieces across dropped interior stretches (never triggered: square and acute corners both trace to nodes) and an incident-edge spur radius.

### TDD evidence
- **RED:** `uv run pytest tests/test_segments_walls.py -q` → `ImportError: cannot import name 'walls' from 'app.pipeline'`, `1 error during collection`. This is expected: the module did not exist yet. While iterating, tests then went red for real behavioural reasons: the gap measured 96.5 instead of 90 (fixed by free-end inheritance and the march), and the vector polygons hit an IndexError on a skeleton with no node pixels (fixed).
- **GREEN:** `uv run pytest tests/test_segments_walls.py -q` → `43 passed in 19.47s`, no warnings (`-rw`).
- **Full suite:** `uv run pytest -q` → `687 passed, 1 skipped in 77.31s`.
- **Gates:** `uv run ruff check .` → All checks passed; `uv run ruff format --check .` → 70 files already formatted; `uv run mypy app` → no issues found in 45 source files.

## Reference images (observed, not asserted; for Task 34)

The scratch script `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/t16/ref.py` runs decode → normalize → preprocess → `run_ocr` (real RapidOCR) → segments → `find_dimension_lines(ink=ocr.ink_notext)` → `extract_walls` → `walls_to_graph`. Passing `--full` overrides the plan region to the whole page. Wall extraction takes about 0.2 s on each image.

| Run | Raw walls | Graph walls / nodes / gaps / free ends | Notes |
|---|---|---|---|
| HDB, real region | 3 (filled) | 2 / 3 / 0 / 2 | Region is `Rect(913,244,129,530)`: one black wall column |
| HDB, full-page region | 30 (15 filled, 15 double) | 29 / 46 / 1 / 36 | t_median 30 |
| Brochure | 54 (all double_line) | 53 / 80 / 5 / 59 | `thick` empty; region is the whole page |

Debug PNGs:
- HDB, real region: `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/t16/ref/hdb-3room-02-walls.png`
- HDB, full-page region: `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/t16/ref/hdb-3room-fullregion-02-walls.png` (thick mask: `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/t16/ref/hdb-3room-thick.png`)
- Brochure: `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/t16/ref/brochure-2bhk-02-walls.png`
- Experiment (medium strokes added, see item 2): `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/t16/ref/hdb-3room-experiment-medium-strokes-02-walls.png` and `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/t16/ref/brochure-2bhk-experiment-medium-strokes-02-walls.png`
- HDB toilet segment close-up: `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/t16/ref/hdb-toilet-segs.png`

### Failures, mostly upstream (listed for Task 34; not fixed here)

1. **HDB plan region is one black wall column (Task 10 `detect_plan_region`). This is the blocker.** With t_thin 3.75 the thick kernel is 9, so the bold outer lines are opened away and only the black wall segments survive. They are more than 0.05 × long edge apart, so siblings are excluded and the region is 129×530 px. Every later stage sees almost nothing.
2. **Medium-width wall strokes fall between the masks (spec gap).** HDB's bold outer walls are about 7 px: not thin (> 1.8 t_thin = 6.75) and not thick (< k = 9). No step of §8.1 picks them up on raster pages; the spec only does so on vector pages (≥ 2.5 t_thin). An experiment that adds non-thin raster segments ≥ 0.02 L to W_fill as quads of their width closes the whole HDB envelope (36 graph walls, 3 gaps, including both outer-wall windows as gap candidates; see the experiment PNG). **This needs a controller ruling** (e.g., "raster segments with `not is_thin` and length ≥ 0.02 L join W_fill"). I did not adopt it on my own because it changes spec step 1.
3. **Brochure walls are grey, not "dark".** They read V ≈ 150, while the spec's dark mask needs V < 90, so `dark` and `thick` are empty. t_thin is inflated to 5.75 by the 3.7× blurry upscale, so the ~10 px grey walls count as *thin* lines and double-line pairing runs on them and on furniture (bed and pillow outlines, fixtures). With `thick` empty, the region is the whole page and the key-plan inset is included. The medium-stroke experiment does not help here (only 6 non-thin segments).
4. **HDB double-line partitions pair badly**, giving thicknesses of 25–58 px instead of about 15:
   - A wall face line pairs with an internal dimension line that `find_dimension_lines` did not detect (toilet "1900": S190/S191, d = 37; see the close-up).
   - The second, fainter face line of some partitions is missed by LSD.
   - Stacked outer dimension chains that were not detected pair into wall blocks in the left margin.
   - Only dimension lines are excluded, not their extension lines.
5. **HDB thick black walls/columns** trace as filled walls 25–58 px thick. They dominate `t_median` (28–30), so the graph's r ≈ 30 px may over-merge thin partitions.
6. **Balcony half-wall** (HDB bottom): the black half-wall traces as a filled wall with a T to its stub. Below it, a double-line stub comes from the parallel extension lines of the 4100 | 3600 chain.
7. **Hatched walls**: a strip with 15–85 % ink is not paired, per the spec; the ladder test pins this. Hatched double-line walls would therefore be lost. The brochure's walls are solid grey, not hatched, so the fixture does not exercise this.
8. The leaf filter works on raw walls. A leaf that pairs with a parallel wall face into a double-line quad (a door next to a perpendicular wall) is merged into that wall's mask before tracing and is not prevented. The synthetic tests do not cover this case.

## Files
- `vision/app/pipeline/walls.py` (new)
- `vision/tests/test_segments_walls.py` (new)

## Self-review
- Removed code no test could reach (`_join`, incident-edge spur radius); simplified head/tail handling into one helper so a single mutation covers both.
- Fixed `dedupe_raw_walls`: the grid cell is now at least the end tolerance (8 px cells missed thick copies), and dropped copies' openings are merged, not lost.
- `walls.py` is large (1227 lines), comparable to `graph.py`. It stays one file per the plan; its sections (masks / tracing / snap / runs / API) are separated.
