# Task 14 fix round 2: component-based raster tick detection (controller ruling)

The ink-probe design (discrete probe angles, busy filter, MIN_CLUSTER, through-stroke guard) failed re-review twice:
- strokes between probe angles become false ticks;
- 1 px slash ticks are lost (MIN_CLUSTER);
- dense chains are never probed (60 % busy filter);
- inner chains of stacked dimension strings are lost (guard + best-angle veto).

Replace `_ink_ticks` / `_passes_through` / the busy prefilter / MIN_CLUSTER with the design below. Keep the segment-tick path, spans, association, deadline hooks and every existing test, except tests that pin removed internals. Those must be rewritten against behaviour.

## Algorithm (per candidate line, raster pages, `ink` given)

Let:
- `w` be the line's stroke width in px, from `Segment.width_px` and at least 1;
- `hi = 0.03 L` be the max tick length;
- `R = ceil(hi / 2) + 6`, the band half-height.

1. **Band image.** Resample the ink into line coordinates (u along the line from p0, v along the normal) for u ∈ [−END_SLACK, len + END_SLACK] and |v| ≤ R. Use one `cv2.warpAffine` with INTER_NEAREST on a rotated crop. Cost is O(len × 2R) per line, which is cheap, so there is no busy prefilter.
2. **Clear the line.** Zero the rows |v| ≤ w/2 + 1 to get `B`. Keep the original band as `B0` for blob detection.
3. **Components.** Find 8-connected components of `B`. Drop components smaller than `max(3, w)` px. Merge the two halves (above and below the line) of a stroke that crosses the line: the components on opposite sides whose pixels nearest the cleared zone are within `w + 2` px of each other in u.
4. **Per merged stroke, compute:**
   - the principal angle relative to the line (PCA on pixel coords; for tiny strokes, use the endpoints);
   - the u-position where its fitted axis meets v = 0;
   - its v-extent on each side, and whether it reaches the band edge (|v| ≥ R − 1) on each side;
   - its mean stroke width (area / axis length).
5. **Classify.**
   - **Too thick:** a stroke wider than `2.5 w + 2` is not a tick. This covers walls.
   - **Perpendicular** (angle 90 ± 10): a tick, whatever its length. This covers bar ticks, extension lines that end at the line, and extension lines that pass through an inner chain of a stacked dimension string. In stacked chains the extension line marks the boundary, so it counts as a tick. Log this in spec 19.
   - **Diagonal** (45 ± 15 or 135 ± 15) that does NOT reach the band edge on either side, with total length in [0.005 L, hi]: a tick. These are slash ticks, any width, including 1 px.
   - **Diagonal or other angle that reaches the band edge** on either side, i.e. it is long: not a tick. This covers crossing walls' thin edges, door arcs, hatching and other dimension lines at an angle.
   - **Any other angle:** not a tick.
6. **Blob ticks.** In `B0`, take the column-wise ink thickness across |v| ≤ R. Runs of u where the thickness is ≥ `w + 3`, with total area ≤ (0.006 L)² and u-length ≤ 0.012 L, are blob ticks: dots, solid arrowheads, filled triangles. There is no aspect rule. Use the run's centre for u, or for an arrowhead its tip side, documented. Exclude runs that belong to a stroke already classified in step 5.
7. **Deduplicate** ticks within `max(4, 2w)` px in u. Ticks with u outside [−END_SLACK, len + END_SLACK] are dropped. Call `check_deadline` once per candidate line and once per band chunk if you chunk long lines.

## Acceptance

These must pass as new pytest cases, using synth-drawn ink (see the reviewer harness `exp_*.py` in `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/rr3/`).

- **Phase robustness.** Run every case at 6 y-phases (y, y+1, …, y+5); a test that passes at only one phase is not acceptable.
- **No false ticks** from a 300 px thin stroke (1–3 px) crossing the line at every angle in 0–180° in 2.5° steps, excluding 80–100°, which are perpendicular strokes and therefore ticks by rule.
- **Slash ticks found:** 1, 2 and 3 px slash and backslash ticks (17 px) on 1, 2 and 3 px lines, at all phases. Bar ticks too.
- **Dense chain:** a chain with ticks every 2 % of L (e.g. 100 px on L = 5000) finds all of its ticks.
- **Stacked chains:** two chains 25 and 40 px apart, with extension lines running through the inner chain to 8 px beyond the outer chain, and slash ticks at the crossings. Both chains find all of their ticks.
- **Blobs:** solid arrowheads 8×8, 10×6 and 16×8, and dots of 7–14 px on 2–3 px lines, are found.
- **Thick wall** (12 px) crossing the line: not a tick.
- **Overshooting extension lines:** extension lines ending 0, 2, 4, 8 and 12 px past the line are found.
- **Text glyphs** 2 px or more from the line: no false ticks. Glyphs on the line are out of scope, since the caller passes text-masked ink.
- **Perf:** 40 lines plus 3000 long segments on 6000×4000 completes in under 5 s.
- **Mutation check.** Each classification rule (perpendicular, diagonal-bounded, band-edge rejection, thickness, blob) must have a test that fails when that rule is disabled. Verify this in a scratch copy, NOT in the worktree.
