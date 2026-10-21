# Task 16b (controller-inserted): reference-image hardening of preprocess, region and wall extraction

**Why.** Task 16 (`walls.py`, 45c2096) is correct on synthetic plans but extracts almost no correct walls from the two reference blueprints:
- `vision/tests/fixtures/reference/hdb-3room.webp`;
- `brochure-2bhk.png`.

Wall extraction feeds openings (17), rooms and the AI path, so this is fixed now and is not deferred to Task 34.

**Debug evidence.** Under `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/t16/ref/`:
- `hdb-3room-fullregion-02-walls.png`;
- `hdb-3room-experiment-medium-strokes-02-walls.png`, in which the outline closes when bold strokes are added;
- `brochure-2bhk-02-walls.png`.

Task 16's report, the "reference-image observations" section of `task-16-report.md`, explains each failure.

## Controller rulings (binding)

Log each ruling in the report for spec 19.

**R2. Bold strokes are solid walls.** A segment counts as a solid wall candidate (source `filled`, `thickness_px` = stroke width) when it is:
- not thin, with width ≥ 1.8·t_thin;
- not already in the thick mask;
- long, ≥ 0.04 L.

This deviates from 06 §8.1 step 1.

**R3. Adaptive dark mask.** The dark threshold is adaptive: Otsu over the V channel of ink pixels, clamped to [90, 170]. This applies to `preprocess`/`binarize.py`.
- The brochure's grey walls have V≈150.
- Photos and colour plans must still behave. Test that a coloured hatch does not become "dark".

**R4. Plan region.** The plan region is the MAIN plan, found by the extent of thick ∪ bold strokes (06 §7.7's union rule, applied over that stroke set rather than thick alone).
- On HDB the region must not collapse onto a single black column.
- On the brochure, the key-plan inset (small, separate, top-right) must be excluded.
- Fix this in `detect_plan_region` (Task 10).

**R5. t_thin under upscaling.** t_thin must survive upscaling. Use the mode of skeleton-sampled stroke widths, or normalise by the normalisation resample factor, so a 3.7× upscaled brochure does not report t_thin ≈ 5.75 for its 1–2 px source lines. Choose the approach, and document and test it.

**R6. Text and junk are never walls.**
- Double-line pairing and every wall mask use `ocr.ink_notext`, the text-masked ink, never raw ink.
- Dimension lines and their extension lines are excluded. Extension lines are perpendicular thin lines that touch dimension ticks.
- Pairing requires both lines of a double-line wall to be ≥ 0.03 L long and parallel within 2°. Their spacing must be in [1.5·t_thin, 0.02 L].
- The blue boxes in the HDB debug image come from text and dimension strokes pairing. They must disappear.

## Acceptance

All of these are pytest cases on the real reference images, marked `@pytest.mark.reference` but run in the normal suite. Make them fast enough.

### 1. HDB ground truth by registration

- Load `hdb-3room.webp` through normalize → preprocess → OCR (use cached OCR output if OCR is slow; record a fixture) → segments → dimensions → walls → graph.
- Build the expected wall set from the P2 engine fixture geometry. The P3 branch has no copy, so transcribe the HDB centre-line wall list from P2 plan Task 14's brief into `vision/tests/fixtures/reference/hdb-3room.walls.json`. Use mm node coordinates, with N13/N20 at x=7773 per controller ruling C8. The P2 brief is at `/home/user/furny-p2/.superpowers/sdd/2026-10-20-furny-p2-engine/task-14-brief.md`.
- Register mm to px with a similarity transform fitted on the four outer corners. Those are visible as the 11000 × 8900 envelope dimension lines' extension points, or as the extracted outline's corners. Document how.
- Metrics:
  - recall: the share of truth wall length within 0.5·t (px) of an extracted wall centre line;
  - precision: the share of extracted wall length within that distance of truth.
- Targets: recall ≥ 0.85, precision ≥ 0.85, the outer outline closed with `free_ends == 0` on the outer cycle, and at least 8 of the 10 rooms closed as faces. The rooms are not detected until a later task, so check closure by counting bounded faces in the wall graph with shapely `polygonize` on the graph edges.

### 2. Brochure

- Make an analogous truth JSON from P2 Task 14's brochure table. Use the C8 ruling: the y=3530 row moved to 3525, and A7–A6 is 230 thick.
- Targets: recall ≥ 0.75, precision ≥ 0.75, and the key-plan inset excluded from the region (no walls in it).

### 3. Synthetic tests

All Task 16 synthetic tests and the full vision suite still pass.

### 4. Performance

The full chain on each reference image takes under 10 s.

If a target is unreachable without a design change beyond R2–R6, stop. Report the metric values reached, the blocker, and a proposed ruling (NEEDS_CONTEXT). Do not loosen the metrics.

## Files

You may modify:
- `binarize.py` / preprocess;
- `segments.py`, minimally;
- `walls.py`;
- the region code;
- the tests.

Add a `vision/tests/support/reference.py` harness for running the chain and registering it, and write the debug PNGs there. Commit them with the trailer and push.
