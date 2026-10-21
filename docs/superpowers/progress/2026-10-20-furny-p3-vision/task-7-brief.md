### Task 7: Sniffing and raster/HEIC decode with pixel guards

**Files:**
- Create: `vision/app/pipeline/decode.py`
- Test: `vision/tests/test_decode.py`

**Spec refs:** `06 §2.1` (magic bytes and rejections), `06 §2.2` (pixels), `06 §7.2`

**Interfaces:**
- Produces:
  - `SniffedKind = Literal["raster", "heic", "pdf", "dxf"]` and `sniff_kind(data: bytes, filename: str) -> SniffedKind`, which raises `dwg_not_supported` or `unsupported_type`.
  - `canonical_mime(kind) -> str`.
  - `decode_raster(data: bytes) -> DecodedImage(image: np.ndarray BGR uint8, exif_make_or_model: bool)`.
  - `apply_pixel_guards(img: np.ndarray, ctx) -> np.ndarray`.
  - Module constants `MAX_DECODE_PIXELS = 120_000_000`, `MAX_WORK_PIXELS = 40_000_000` and `MIN_SHORT_EDGE = 300`; tests monkeypatch these.

- [ ] **Step 1: Write the failing test.** All byte fixtures are built in-test.
  - `test_sniff_raster`: JPEG, PNG and WebP produced with Pillow → `"raster"`.
  - `test_sniff_heic_variants`: for each brand in `heic, heix, hevc, heim, heis, mif1, msf1`, the bytes `b"\x00\x00\x00\x18ftyp" + brand.encode() + b"\x00" * 20` → `"heic"`.
  - `test_sniff_pdf_offset`: `b" " * 500 + b"%PDF-1.7"` → `"pdf"`; `%PDF-` at offset 1100 → `unsupported_type`.
  - `test_sniff_dxf`: `"  0\nSECTION\n  2\nHEADER\n"` and `b"AutoCAD Binary DXF\r\n\x1a\x00"` → `"dxf"`.
  - `test_dwg_magic`: `b"AC1032" + …` with filename `plan.dxf` → `dwg_not_supported` (HTTP 415). A filename `x.dwg` with PNG bytes also → `dwg_not_supported`.
  - `test_unsupported`: TIFF `II*\x00`, GIF89a, `BM`, `ftypavif` and `<svg` → `unsupported_type`.
  - `test_exif_orientation_applied`: a 200×100 JPEG with EXIF orientation 6 decodes to `image.shape == (200, 100, 3)`, and `exif_make_or_model` is false. A JPEG with EXIF `Make="Apple"` → true.
  - `test_alpha_composited_white`: a fully transparent RGBA PNG decodes to all 255.
  - `test_decompression_bomb_rejected`: with `MAX_DECODE_PIXELS` monkeypatched to 10_000, a 200×100 PNG → `image_too_large` (413), raised before full decode (from `im.size`).
  - `test_downscale_warning`: with `MAX_WORK_PIXELS=5000`, a 200×100 image → product ≤ 5000 and warning `image_downscaled` with `{"megapixels": 0.0}`. The param is the source megapixels rounded to 1 decimal place.
  - `test_too_small`: 299×800 → `image_too_small`.
  - `test_corrupt`: `b"\x89PNG\r\n\x1a\n" + b"junk"` → `corrupt_file`.
  - `test_heic_opener_registered`: `".heic" in PIL.Image.registered_extensions()`. HEIC pixel decoding is not testable offline because pi-heif cannot encode a fixture; this is recorded in the gap list.
- [ ] **Step 2: Run it, expect FAIL.** Command: `uv run pytest tests/test_decode.py -q`.
- [ ] **Step 3: Implement** per 06 §7.2.
  - Call `pi_heif.register_heif_opener()` at import time.
  - Set `PIL.Image.MAX_IMAGE_PIXELS = MAX_DECODE_PIXELS` and also check `w*h` explicitly after `Image.open`.
  - Downscale to `MAX_WORK_PIXELS` with `cv2.INTER_AREA`, using factor `sqrt(MAX/(w*h))`.
- [ ] **Step 4: Run tests, expect PASS.** Same command as Step 2.
- [ ] **Step 5: Quality gates.** `uv run ruff check . && uv run ruff format --check . && uv run mypy app`
- [ ] **Step 6: Commit.** `git add vision/app/pipeline/decode.py vision/tests/test_decode.py` then `git commit -m "feat(vision): magic-byte sniffing, raster/HEIC decode, pixel guards" -m "$FURNY_TRAILER"`.

---

