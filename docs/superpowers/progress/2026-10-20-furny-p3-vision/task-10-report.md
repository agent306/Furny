# Task 10 report: Preprocess + synthetic drawing generator

Commit: 521bc16 feat(vision): Sauvola preprocessing, style classification, plan region
Status: DONE_WITH_CONCERNS (minor, below)

## Implemented
- `app/pipeline/binarize.py`: `Preprocessed`, `preprocess`, `sauvola_window`, `thick_kernel`, `stroke_width_mode` (06 §7.6 steps 1-6). Photos run `flatten_illumination` before Sauvola (`gray` returned is the flattened one). Style order per spec: brochure -> photo_of_drawing -> cad_vector -> line drawing. Brochure `thick` = opened `dark` (the spec's `dark ∪ (ink & candidate)` collapses to `dark`); line drawings use `ink`; blobs < (3k)^2 removed.
- `app/pipeline/region.py`: `detect_plan_region(thick, ink, ctx)`; `ink` is accepted for the spec signature but unused. K6: no thick pixels -> full image rect, no warning. Warning `plan_region_ambiguous {"components": n}` counts all components >= 30 % (included or not).
- `tests/support/synth.py`: SWall/SDoor/SWindow/SText/SDimChain/render_plan per brief, plus SGap (I5; passed through a `gaps=` kwarg of `render_plan`) and `warp_onto_canvas` (I12). Moved `CANVAS`, `CORNERS`, `grid_drawing`, `photo_of` here from `test_rectify.py`; `test_rectify.py` and `test_normalize.py` now import from synth (I12 lesser item).
- Synth semantics: pixel-exact widths, no anti-aliasing (own strip rasteriser, since `cv2.line` thickness 2 draws 3 px). Filled/double walls get square caps of t/2 so corners close; double = two `line_px` lines whose centres are `thickness` apart, hollow, junctions cleaned; single = unextended line. DimChain ticks are absolute axis coordinates, line sits at the other coordinate of `start`, labels fixed font 1.0/thickness 2, y-axis labels rotated 90 deg CCW (read bottom-to-top). Door/window symbols use the host wall colour.

## Tests (tests/test_preprocess.py, 12 tests) 
All brief tests plus: stroke default, kind-by-source, flatten called only for photos (spy), near-sibling region included without warning, K6 `test_region_empty_is_full_image`.
Run from /home/user/furny-p3/vision: `uv run pytest -q` -> 279 passed, 1 skipped; `ruff check`, `ruff format --check`, `mypy app` all clean.
TDD: code written before tests (tolerated lapse per progress ruling); tests are discriminating for the thresholds (kernel/width/region values asserted exactly).

## Concerns
- The spec's `2 x dt` stroke width over-reads by ~1 px for cv2-drawn lines (cv2 thickness 2 = 3 px -> 3.8); real scans are not affected the same way, but `t_thin` for a true w-px line is about w-0.1. Synth avoids the issue with exact widths. Brief test `abs(t_thin-2)<=0.5` passes (bin centre returned).
- `test_illumination_flattening`: Sauvola is local, so the ink assertion passes even without flattening; only the `gray` evenness check and the spy test discriminate. The brief's "no blobs larger than (3k)^2" is applied to ink *not explained by the drawing* (the walls are themselves larger blobs).
- Performance: `threshold_sauvola` (skimage, float64 integral images) dominates: ~7-8 s on a 6000x4000 image, ~1 s at 2000 px. Matters only if the deadline is tight for max-size inputs; a cv2.integral-based Sauvola would be ~5x faster if needed.
- Two `# type: ignore[no-untyped-call]` for skimage calls (skimage is untyped under mypy strict).

## Fix round 1
- `binarize.sauvola_ink(gray, window, k)`: float32 Sauvola via two `cv2.boxFilter` calls (mean, mean of squares; BORDER_REFLECT_101), `T = m(1 + k(s/R - 1))`, `R = 127.5` (skimage's default for uint8: `0.5 * (255 - 0)`). `skimage.filters.threshold_sauvola` is gone from app code (skimage stays for `skeletonize` and as a test-only comparison); the `# type: ignore` for it is gone.
- Int64 temporaries removed: `keep[labels].astype(np.uint8) * 255` and `(cond).astype(np.uint8) * 255` for `ink` and `dark`.
- Tests added: `test_sauvola_ink_matches_skimage` (noisy block + brightness ramp + noise, windows 15/33/81: arrays exactly equal to skimage); `test_preprocess_peak_memory_is_bounded` (subprocess, 6000x4000 plan, peak RSS growth < 1 GB; measured 432 MB, wall time of the whole subprocess ~3.4 s).
- Verification (from /home/user/furny-p3/vision): `uv run pytest -q` -> 281 passed, 1 skipped; `ruff check`, `ruff format --check`, `mypy app` clean.
- Commit: "fix(vision): float32 box-filter Sauvola to bound preprocess memory". The earlier ~8 s runtime concern is resolved (Sauvola is now sub-second at 24 MP).
