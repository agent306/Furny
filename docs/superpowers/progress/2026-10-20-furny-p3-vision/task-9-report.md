# Task 9 report: photo rectification, deskew, resample (NormalizedPage)

Commit: 74523f4 feat(vision): photo rectification, deskew and resample to NormalizedPage
Status: DONE_WITH_CONCERNS (concerns below are design calls the controller should confirm)

## Implemented
- `utils/geometry.py`: `Pt`, `Rect` (frozen; `long_side`, half-open `contains`, `expand`, `clip`), `detect_line_segments` (LSD_REFINE_STD, Hough fallback with the spec params on Canny edges when LSD raises cv2.error/AttributeError), `seg_angle_deg`, `point_seg_distance`, `project_param` (unclamped t), `odd`.
- `utils/images.py`: `encode_png` (compression 6), `encode_jpeg`, `encode_webp`, `resize_long_edge(img, long_edge, interp=INTER_AREA)`.
- `pipeline/rectify.py`: `detect_page_quad` (06 §7.3 steps 1-7 verbatim), `quad_is_axis_aligned` (1.5 % of diagonal), `warp_quad`, plus `warp_quad_with_matrix` (returns the 3x3 for `transform`; output capped to the work budget, read from `decode.MAX_WORK_PIXELS` at call time), `sheet_contrast` (see concerns), `flatten_illumination` (kernel odd(round(long/40)); the closing is computed on a copy with long edge <= 800 and upsampled, because an ellipse closing with k~150 on 36 MP is far too slow; same relative kernel).
- `pipeline/normalize.py`: `NormalizedPage` (vector/dpi/page_size_pt default None; caller sets `vector`/`page_size_pt` via `dataclasses.replace`), `estimate_skew_deg` (spec algorithm; run on a <=2000 px copy inside normalize), `normalize(...)`: PDF guard -> rectify -> deskew -> resample. `transform` = composition of the three 3x3 maps (pixel-centre convention, so `transform @ [w-1,h-1,1]` lands within 1.5 px of the last normalized pixel).
- Rulings applied: K19 `photo_rectified` emitted whenever a warp is applied (user corners too); K21 (quad criterion stays in normalize, `is_photo` returned as `is_photo or rectified`); I11 (corners test uses 3000x2000 -> asserts 2400x1600); `apply_pixel_guards` applied to PDF renders (`pdf_vector`/`pdf_raster`) with the downscale folded into `transform`; memory bounded (strip-free but no extra full copies kept, warp output capped, deskew canvas <= 1.2x).
- Sign convention: `estimate_skew_deg` > 0 = content rotated clockwise (y-down); `deskew_deg = -skew` (rounded to 0.01), `deskewed` warning `degrees = round(deskew_deg, 1)`; a skew outside [0.2, 10] gives `deskew_deg == 0` and no warning.

## Tests
`uv run pytest -q` -> 258 passed, 1 skipped (pre-existing HEIC skip). Task files: 38 passed (14 in test_rectify.py, 24 in test_normalize.py). `ruff check`, `ruff format --check`, `mypy app` (strict) all clean. 6000x4500 PDF-raster with 2 deg skew normalizes in ~0.4 s.
All brief tests present: quad detected within 0.015*diag and warped long segments within +-1 deg of axes; axis-aligned quad; user corners win (2400x1600); photo without quad (noise) -> `page_corners_not_found`, rectified False; deskew +-3 deg / 0.1 deg / pdf_vector skipped; resample rule (800->2000 f=2.5 + `{"longEdge": 800}`, 1200->2000 none, 6500->6000, 3000 unchanged); transform maps corner. Extra: Hough fallback, helper unit tests, desk photo auto-rectified, framed plan on white left alone, degenerate user corners, PDF guard + transform scale, deadline check.

## TDD evidence
Not true red-green: I implemented the modules first, then wrote the tests (all failures seen were test/impl fixes: warp cap rounding, LSD length threshold). No RED run recorded; GREEN as above.

## Concerns / deviations (please confirm)
1. Unhinted auto-rectify guard (beyond brief): the brief says rectify when "the quad is non-axis-aligned". A plan whose outer walls form a big rectangle inset from the image border satisfies that literally and would be cropped/warped to the building outline. For `is_photo=False` and raster/heic sources, normalize therefore also requires `sheet_contrast >= 20` (median grey inside vs outside the quad). Desk photos pass, plans on white paper do not. With `is_photo=True` or user corners no contrast test applies. T29's inspect `isLikelyPhoto` (uses detect_page_quad + quad_is_axis_aligned directly, per spec 5.4) has the same false-positive risk and may want `sheet_contrast` too.
2. Axis-aligned quad with `is_photo=True` (sheet fills the frame, or noise yields a frame-sized contour): nothing is warped and `page_corners_not_found` is warned (the noise test needs this, since the border contour is a valid 4-vertex quad).
3. Degenerate/non-convex/wrong-count user corners are ignored with `page_corners_not_found` instead of raising (should arguably be a 400 at the route; T31).
4. Deskew is also skipped for `dxf` (spec only says pdf_vector), as deskewing a CAD render would break alignment.
5. PDF callers (T29) must pass the raw render to normalize for `pdf_*` kinds, not pre-guarded output; otherwise vector coordinates and `transform` disagree. `normalize` gained an optional kw-only `max_work_pixels` (passed to apply_pixel_guards/warp cap; T29 should pass `settings.vision_max_pixels`).
6. `low_resolution` uses the long edge entering resample (after rectify/deskew); `resample_factor` = target/long edge of that image. `PageImage.dpi` is the source render dpi (not rescaled).

## Files
vision/app/pipeline/rectify.py, vision/app/pipeline/normalize.py, vision/app/utils/geometry.py, vision/app/utils/images.py, vision/tests/test_rectify.py, vision/tests/test_normalize.py

## Fix round 1 (commit cce2019 fix(vision): pin axis-aligned threshold, order user corners, assert white deskew border)
1. `quad_is_axis_aligned`: new parametrized test (4 cases, one per displaced corner) with three corners on the frame and one moved 0.5 px under / over 1.5 % of the diagonal (19.2 px) -> True / False. Verified by mutation: `np.all`->`np.any` and tolerance 1.5 %->9 % each make 4 tests fail; originals restored.
2. User corners: `_order_corners` made public as `rectify.order_corners`; `_user_quad` now orders the points (any order, incl. reversed, rotated start, bow-tie) before the convexity/area checks, so a reversed list can no longer mirror the warp. Test `test_user_corner_order_does_not_mirror_the_warp` (4 orderings) places a marker near the region's top-left and asserts its centroid lands at (200/2400, 200/1600) of the output.
3. `test_deskew_border_is_white`: grey (200) background tilted 3 deg; after normalize the canvas corners (0,0) and (-1,-1) are 255 while the central region median stays 200.
Command: `uv run pytest tests/test_rectify.py tests/test_normalize.py -q` -> 47 passed; full suite `uv run pytest -q` -> 267 passed, 1 skipped; `ruff check`, `ruff format --check`, `mypy app` clean.
