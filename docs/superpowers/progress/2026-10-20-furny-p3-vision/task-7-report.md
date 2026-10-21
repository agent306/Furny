# Task 7 report: sniffing, raster/HEIC decode, pixel guards

Status: DONE (one noted gap: HEIC pixel decode not testable offline)
Commit: see `git log` ("feat(vision): magic-byte sniffing, raster/HEIC decode, pixel guards")

## Implemented (vision/app/pipeline/decode.py)
- `SniffedKind`, `sniff_kind(data, filename)`: DWG (`AC10` prefix or `.dwg` ext, case-insensitive) checked first -> `dwg_not_supported`; JPEG/PNG/WebP(`RIFF????WEBP`) -> raster; `ftyp`+7 brands -> heic; `%PDF-` within first 1024 bytes -> pdf; ASCII DXF (optional whitespace, `0`, `SECTION`, CRLF ok) or binary DXF magic -> dxf; else `unsupported_type`.
- `canonical_mime(kind)`: raster -> `image/png` (decoded rasters are re-encoded as PNG downstream; spec gives no mapping, so this is a judgement call), heic -> `image/heic`, pdf -> `application/pdf`, dxf -> `image/vnd.dxf`.
- `decode_raster(data) -> DecodedImage(image, exif_make_or_model)`: `Image.open`, size check on `im.size` against `MAX_DECODE_PIXELS` before `load()`; Pillow `DecompressionBombError` also -> `image_too_large`; `exif_transpose`; alpha (RGBA/LA/P-transparency) composited on white; 16-bit grey scaled (not clipped); RGB -> BGR. Truncated/junk -> `corrupt_file`. `pi_heif.register_heif_opener()` and `Image.MAX_IMAGE_PIXELS = MAX_DECODE_PIXELS` at import. EXIF flag read before transpose (Make/Model non-blank string).
- `apply_pixel_guards(img, ctx, max_work_pixels=None)`: >MAX_DECODE_PIXELS -> `image_too_large`; short edge < `MIN_SHORT_EDGE` -> `image_too_small` (checked on the source, before downscale); > work budget -> `cv2.resize(INTER_AREA)` with factor sqrt(max/(w*h)), floored so the product never exceeds the budget, warning `image_downscaled {"megapixels": round(src_MP, 1)}`.
- Constants `MAX_DECODE_PIXELS=120_000_000`, `MAX_WORK_PIXELS=40_000_000`, `MIN_SHORT_EDGE=300`, read at call time (monkeypatchable).

## Rulings applied
- K4: `test_downscale_warning` monkeypatches `MIN_SHORT_EDGE=10`, uses 400x300 with `MAX_WORK_PIXELS=5000`, asserts `{"megapixels": 0.1}`.
- K5: `max_work_pixels` parameter (callers pass `settings.vision_max_pixels`); module constant is only the default. `vision_max_source_bytes` is a fetch-cap concern with no use in decode.py (T29/T31 must pass it to `io.fetch`); tested via `test_explicit_max_work_pixels_overrides_default`.
- K18: tests in `tests/test_decode.py` (T8 will add DPI and encrypted-PDF tests there).
- K21: `exif_make_or_model` exposed; T29 `load_page` must set `is_photo = hints.is_photo or decoded.exif_make_or_model`.

## Tests
`uv run pytest tests/test_decode.py -q -rs` -> 38 passed, 1 skipped. Full suite: 168 passed, 1 skipped. `ruff check`, `ruff format --check`, `mypy app` clean.
- TDD RED: before decode.py existed, collection failed with `ImportError: cannot import name 'decode' from 'app.pipeline'`. GREEN: as above (one test-authoring bug fixed along the way: fixture was encoded after patching `Image.load`).
- Beyond the brief: HEIC brands parametrised, PDF boundary at offset 1019, CRLF ASCII DXF, RIFF-not-WebP, empty bytes, uppercase `.DWG`, BGR channel order, palette transparency, 16-bit grey, Pillow-native bomb error, truncated PNG, INTER_AREA spy, guard no-op identity, `image_too_large` from guards.
- HEIC: pi-heif is decode-only (`save(format="HEIF")` raises KeyError), so `test_heic_decode_roundtrip` self-skips with that reason (it runs wherever an encoder exists). `test_heic_opener_registered` passes. Gap-list entry: HEIC pixel decode untested offline.

## Concerns / notes for later tasks
- `canonical_mime("raster")` returning `image/png` is arbitrary; revisit if T29/T31 need the true sub-type.
- `apply_pixel_guards` also enforces the 120 MP limit so PDF-rendered pages (T8) are covered.
- DWG prefix rule is `AC10` (covers AC1012..AC1032); older `AC1.x` variants fall through to `unsupported_type`.

## Fix round 1
1. Decode memory (06 §5.2). `decode_raster` no longer calls `ImageOps.exif_transpose` (it copies even when no rotation is needed) or full-image `convert`/`alpha_composite`/`cvtColor`. It reads the EXIF orientation itself and transposes only when needed, then fills one preallocated BGR array strip by strip (`_STRIP_PIXELS = 1<<20`; each strip is converted to RGB, alpha composited on white via `paste(mask=A)`, written as `[:, :, ::-1]`). Live memory is now the loaded image plus the BGR output. 16-bit grey scaling uses a fixed 65535 divisor so it is consistent across strips.
   Measured with the new test's 20 MP RGBA PNG (peak RSS above pre-decode RSS, final BGR = 60 MB): old code 480 MB (8x), new code 151 MB (2.5x). The test would fail on the old code. Extrapolated 120 MP RGBA: about 0.9 GB.
   New test `test_decode_peak_memory_is_bounded` runs `decode_raster` in a subprocess and compares `VmHWM - VmRSS(before)` (from /proc) with 3x the output size. tracemalloc was not used because it does not see Pillow's C allocations. Skipped where /proc is absent.
2. Sniffed MIME (06 §4.5). New `sniff_mime(data, filename)` returns image/jpeg, image/png, image/webp, image/heic, application/pdf or image/vnd.dxf. `sniff_kind` contract is unchanged (both share `_sniff`). `canonical_mime(kind, data=b"")` now needs the bytes for `raster` (raises `unsupported_type` without recognisable bytes). Tests: `test_sniff_mime_per_subtype` (6 cases, also via `canonical_mime`), `test_canonical_mime_raster_needs_bytes`, `test_sniff_mime_rejections`.
Commands: `uv run pytest tests/test_decode.py -q` -> 46 passed, 1 skipped (HEIC encoder); full suite run after; `ruff check`, `ruff format --check`, `mypy app` clean.
