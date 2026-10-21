# Task 32 report: upload intents backend

Status: DONE_WITH_CONCERNS (concerns and deviations below).

Commit (on `build/p1-foundation`, pushed): `d179c39` feat(uploads): upload intents with presigned PUT, magic-byte sniffing and image sanitising

## What was built

- **Presign** `POST /api/uploads/presign` (`api.uploads.presign`, limiter `uploads-presign`): `PresignUploadRequest` (shape only) -> `CreateUploadIntent` (target resolved by morph alias, `UploadPurpose::authorizeTarget`, type/size/extension rules of 13 §11.2 and 06 §2.1, intent row, presigned PUT) -> `{uploadId, url, headers}`. `object_key = tmp/{purpose}/{Y}/{m}/{id}` where `id` is the intent's own ULID, `expires_at = now()+15 min`.
- **Presigner** `UploadPresigner` (`presignPut`, `presignGet`), `S3UploadPresigner`, `PresignedRequest`. See deviation 1: the AWS SDK's `temporaryUploadUrl` does not sign Content-Type or Content-Length, so `S3UploadPresigner` signs the PUT itself with `ContentSigningSignature` (an `S3SignatureV4` that keeps both headers in `X-Amz-SignedHeaders`).
- **Confirm** `POST /api/uploads/{upload}/confirm` (`ConfirmUploadIntent`, row lock): size via `Storage::disk('s3')->size()`; mismatch -> object deleted, `rejected`, 422 `upload_size_mismatch`; match -> `uploaded` + `ProcessUpload` on `default` (timeout 60, tries 2) -> `202 {uploadId, status: 'processing'}`. A second confirm does not queue a second job. **Show** `GET /api/uploads/{upload}` -> `UploadIntentStatusData {status, reasonCode, previewUrl}` (previewUrl: 15-minute signed URL for a ready jpeg/png/webp). `UploadIntentPolicy` (owner or 404) guards both.
- **`ProcessUpload`**: work directory `storage/app/tmp/{ulid}/` removed in `finally`; size re-check; `MagicBytes::detect` (DWG -> `dwg_not_supported`; not in the purpose list -> `upload_type_not_allowed`; declared family differs -> `upload_type_mismatch`; `finfo` must agree for jpeg/png/webp/pdf); HEIC photos via `HeicConverter` (`VisionHeicConverter`: body `{sourceUrl, targetUrl, format: jpeg, quality: 85, maxEdge: 4096, applyOrientation: true}`, bearer token, `normalize_timeout_s`/`connect_timeout_s`; 413/415/422 -> `upload_corrupt`, anything else is retried and, when tries run out, `failed()` rejects with `upload_processing_failed`); `ImageSanitizer` (header size guard before any decode: 40 MP and 12 000 px; EXIF orientation applied with imagerotate/imageflip for all 8 values; GD re-encode, progressive JPEG q85, PNG level 6 with alpha, WebP q85; longer-edge downscale, square crop for textures); upload to `uploads/{purpose}/{Y}/{m}/{id}.{ext}` (extension from the processed type), tmp objects deleted, intent `ready` with `processed_key`, `sniffed_mime`, `width`, `height`. Rejections also delete the tmp objects. PDF, DXF, HEIC blueprints and `blueprint_source` images are kept byte for byte.
- **`ConsumeUploadIntent`** (row lock, one transaction): 422 `upload_invalid` + `uploadId` unless owned, `ready`, same purpose, same target (type and id equal, or both none); `addMediaFromDisk($processed_key, 's3')->usingName(display)->usingFileName(basename)->toMediaCollection`; intent `consumed`. `CodedValidationException` got an optional `context` array (merged into the JSON body by the renderer in `bootstrap/app.php`) to carry `uploadId`.
- **`media:cleanup-orphans`**: deletes non-consumed intents created more than 24 h ago and their `object_key`/`processed_key` objects (chunked; a failed object delete keeps the row and exits non-zero). Not scheduled yet (see concerns).
- **`UploadPurpose`** methods: `allowedSniffedTypes`, `allowedDeclaredMimes`, `maxBytes(?ext)`, `reencodes`, `maxEdge`, `targetType`, `authorizeTarget`, plus `squares()`.
- **`MagicBytes`** (also holds the type table: extension, MIME, declared MIMEs, extensions), **`FileName`**, `UploadRejected`, lang `uploads.errors.*`, route-access entries, route pattern for `{upload}`, container bindings (`UploadPresigner`, `HeicConverter`).
- **Fixtures** `tests/fixtures/uploads/` with `generate.py` (`uv run --with pillow python tests/fixtures/uploads/generate.py`; run twice, identical md5s; no seeds or timestamps needed). The brief's ten outputs plus `animated.webp` and `minimal.heic`. `.gitattributes` marks them `-text` (the repo's `* text=auto eol=lf` would rewrite the CRLF in the DXF fixtures).

## TDD evidence

RED (tests written first, nothing implemented): `vendor/bin/pest tests/Feature/Uploads tests/Unit/Uploads` -> `Tests: 326 failed, 1 passed`. Causes: `Route [api.uploads.presign] not defined` (64), `Class App\Support\Uploads\MagicBytes not found` (43), `App\Domain\Shared\Jobs\ProcessUpload not found` (37), `FileName` (18), `ImageSanitizer` (16), and the same for the other new classes. Expected: none of the classes or routes existed.

GREEN: `vendor/bin/pest tests/Feature/Uploads tests/Unit/Uploads` -> `Tests: 328 passed (932 assertions)`.

## Gates (on d179c39)

- `vendor/bin/pest tests/Unit tests/Feature`: 3821 passed (16166 assertions); 331 new.
- `vendor/bin/pest tests/Browser` (after `yarn vite build`, `PLAYWRIGHT_BROWSERS_PATH` = the scratchpad `pw-browsers`; `/opt/pw-browsers` gives `PlaywrightOutdatedException` with the 1.63.0 package): 95 passed. Nothing in the UI changed; the generated types and catalogue did.
- `yarn lint`, `yarn format:check`, `yarn typecheck` clean; `yarn vitest run` 88 files, 1369 passed.
- `vendor/bin/pint --test` passed; `vendor/bin/phpstan analyse` no errors.
- Gates-Gen: `typescript:transform` + `i18n:export` re-run after the commit, `git diff --exit-code` on the generated files clean.

## Tests added

`tests/Feature/Uploads/{PresignTest,ConfirmTest,ProcessUploadTest,ConsumeUploadIntentTest,CleanupOrphanMediaTest,UploadPurposeTest}.php`, `tests/Unit/Uploads/{MagicBytesTest,FileNameTest,ImageSanitizerTest,S3UploadPresignerTest}.php`, `tests/Support/Uploads/FakeUploadPresigner.php` (bound for the Feature suite in `tests/Pest.php`).

- `S3UploadPresignerTest` builds a real s3 disk config (made-up credentials, no network), asserts `X-Amz-SignedHeaders=content-length;content-type;host`, and recomputes the SigV4 signature independently in the test from the URL and headers (so a PUT with another type or length cannot match it).
- `ImageSanitizerTest` pins all 8 EXIF orientations by corner colours, alpha, animated WebP first frame, square crop, 40 MP / 12 000 px guards (bomb refused with peak memory under 50 MB growth), corrupt files.
- `PresignTest` covers every case of the brief plus per-purpose authorisation, target errors and the 429 with `Retry-After`.

## Deviations for spec 19 (docs not edited)

1. **13 §11.2 step 4 cannot be done with `temporaryUploadUrl`.** In aws-sdk-php 3.401 the signer drops `content-type` (`getPresignHeaderDenyList`) and `content-length` (`getHeaderBlacklist`) from presigned URLs, so a URL from `Storage::disk('s3')->temporaryUploadUrl($key, $exp, ['ContentType' => ..., 'ContentLength' => ...])` is signed with `host` only and accepts any body. `S3UploadPresigner` signs the PUT with its own `S3SignatureV4` subclass. Not yet verified against Cloudflare R2 itself (needs a live bucket); R2 documents header-signed presigned PUTs.
2. **`UploadPresigner::presignPut(..., ?int $size, ...)`**: `$size` is nullable (brief: `int`), and there is a second method `presignGet`. The vision service writes an image of unknown length and needs a presigned GET of the source; both go through the same interface so the HEIC test can read the key back from the faked URLs.
3. **`ImageSanitizer::sanitize(..., bool $square = false)`** (brief: three parameters) and `UploadPurpose::squares()`: 13 §11.1 says textures are "square, resized to 1024²", which needs a crop option. Textures are cut to the middle square and resized to exactly 1024 px (small ones are enlarged).
4. **`FileName::sanitize` keeps `\p{M}` (combining marks)** in the allowed class `[\p{L}\p{M}\p{N} ._()-]` (13 §11.4 has `[\p{L}\p{N} ...]`), because vowel signs of Devanagari and other scripts are marks and would be turned into `_`. Variation selectors (U+FE00-FE0F) are removed first so emoji leave no residue. Runs of spaces/underscores that contain an underscore collapse to one `_`.
5. **New 422 codes** beyond 13 §11: `invalid_target` (target missing or of the wrong kind), `upload_missing` (confirm before the object exists; the intent stays `pending` so the client can retry, instead of 13 §11.3's "else delete, rejected"), `upload_expired` (confirm after `expires_at`; intent set to `expired`), `upload_corrupt` (not decodable / vision 413,415,422), `upload_processing_failed` (retries used up). `upload_invalid` on confirm for a rejected/expired/consumed intent. Messages in `uploads.errors.*`.
6. **`preset_thumbnail` has no target** (`targetType()` null, permission `presets.manage` only): 13 §11.1 lists the target as "preset", but `admin.furniture.save-as-preset` uploads before the preset exists. A `target` sent for a purpose that has none is ignored.
7. **`message_attachment` images are downscaled to 4096 px** like the photo purposes (the spec gives no max edge for it; thumbnails, covers and blueprints have none).
8. **`sniffed_mime`** stores the MIME of the processed file (a converted HEIC photo is `image/jpeg`), and `processed_key` takes the intent's id as `{ulid}`.
9. **`CodedValidationException::$context`** (new) so the `upload_invalid` JSON can carry `uploadId` as 13 §11.3 step 7 says; the renderer in `bootstrap/app.php` merges it.
10. **Temp files** live in `storage/app/tmp/{ulid}/` (a directory per job) rather than a single file.
11. `finfo` accepts a PDF whose `%PDF-` sits anywhere in the first KiB (libmagic searches 1024 bytes), so the only `finfo` disagreement that is easy to produce is a bare PNG signature; both cases are tested.

## Self-review

Read the whole diff. No scratch files in the tree (scratch is under the scratchpad `t32/`); `storage/app/tmp` is empty after the suite. Names follow the existing domain layout. Policies are discovered by name (`UploadIntentPolicy`). `final` classes, strict types, Pint and PHPStan level 8 clean.

## Concerns

1. **R2 and signed `Content-Length`**: deviation 1 is proven by an independent signature computation, not against a real R2/S3 endpoint. Worth one manual PUT with a wrong length against the real bucket when infrastructure exists (expect 403 `SignatureDoesNotMatch`). Browsers cannot set `Content-Length` themselves; the returned header lists it for completeness (the client must skip it, as it must `Host` anyway).
2. **Memory**: a 40 MP image is 160 MB as a GD true-colour image, and the worker holds at most two copies at a time (source, then the rotated/resized one). The queue worker's `memory_limit` must be at least ~512 MB for `default`, or a legal 40 MP photo kills the worker. I did not raise the limit in code.
3. **Not scheduled**: `media:cleanup-orphans` (and `otp:prune`) have no `Schedule::command` yet; 01 §7 says daily 03:00. No scheduling exists in `routes/console.php`, so I left it for the task that adds the scheduler.
4. **Processed copies are never deleted after consumption**: `uploads/...` keeps the file after Spatie copied it into the collection (the command only removes unconsumed intents). Cheap to add later (delete `processed_key` of consumed intents after N days) if storage cost matters.
5. **GD limits**: CMYK/progressive oddities and 16-bit PNGs are whatever GD makes of them; a decode failure is `upload_corrupt`. Animated WebP uses a hand-made first-frame extraction (offset/size of the frame inside the canvas is ignored; typical encoders write the first frame at full canvas).
6. `ConfirmUploadIntent` and `ConsumeUploadIntent` do S3 calls / media copies inside a DB transaction holding a row lock (short, single row).
7. No frontend consumer exists yet; the TS types `UploadIntentStatusData`, `PresignUploadData`, `PresignTargetData` are generated for it.

## Fix round 1

Review: `task-32-review.md` (spec ❌, quality NEEDS FIXES). One commit on top of d179c39.

### Changes
- **C1 (animated WebP bypassed the bomb guard).** `ImageSanitizer` now runs `guardSize` on the extracted first frame's own bitstream header (`getimagesize` of the still) before any GD decode, and refuses a frame larger than the canvas (`upload_corrupt`). New deterministic fixtures from `generate.py`: `animated-frame-bomb-121mp.webp` (64x64 canvas, 11000x11000 frame), `animated-frame-bomb-48mp.webp` (8000x6000), `animated-frame-over-canvas.webp` (100x100 frame in 64x64). Both bombs -> `upload_image_too_large` in `ImageSanitizerTest` and through `ProcessUpload` (memory growth asserted under 50 MB, no scratch files left). Existing fixtures regenerate byte for byte.
- **I1 (committed `sanitized-*` files).** Deleted the 16 files. `ImageSanitizer::sanitize` takes an optional `?string $directory` and writes to the system temp directory by default, never next to the input; `ProcessUpload` passes its work directory so the output is removed with it. The tests unlink their outputs and temp inputs (also `MagicBytesTest`, and the base file of `sanitizerTemp`). A full run leaves `git status` and `/tmp` clean (checked).
- **Minor 1 (consume rollback).** `ConsumeUploadIntent` now uses `preservingOriginal()` and deletes `processed_key` in `DB::afterCommit`, so it goes only when the outermost transaction commits. Tests: file still there inside the transaction and gone after; a caller that throws after consuming leaves the intent `ready`, the file in place, and the upload usable again. Dropped the artificial `processed_key` assertion for a consumed intent in `CleanupOrphanMediaTest`.
- **Minor 2 (vision timeout vs job timeout).** `ProcessUpload::TIMEOUT_SECONDS` (60); the vision call timeout is `min(normalize_timeout_s, 60 - 10)`. `media:cleanup-orphans` also sweeps `storage/app/tmp/*` work directories older than an hour (killed jobs). For spec 19: `imports.vision.normalize_timeout_s` (120) is longer than the 13 §11.3 job timeout (60), so the effective limit is 50 s.
- **Minor 3.** A sniffed unknown type for `blueprint_source` is rejected with `unsupported_type` (06 §2.1); other purposes keep `upload_type_not_allowed` (13 §11.3). For spec 19: the two specs differ for blueprints.
- **Minor 4.** `MagicBytes::GENERIC_MIMES` / `genericMimeFits()` replace the duplicated lists in `CreateUploadIntent`, `ProcessUpload` and `UploadPurpose`.
- **Minor 5.** Temp-file leaks in tests fixed (above).
- **Minor 6.** The weak negative signature test is replaced by one that asserts the SDK's own `temporaryUploadUrl` signs only `host` (so the subclass stays justified, and the test says when it no longer is).
- **Declined: Minor 7 (presigned URL reusable after confirm).** The URL's type and length are still enforced and the leftover object is removed by the `tmp/` lifecycle rule (2 days); closing it needs bucket-side policy or a short expiry, which 13 §11.2 sets at 15 minutes. Noted, not changed.
- **Carried (review ⚠️):** `Content-Disposition: attachment` for PDFs and other non-images is for the serving and messages tasks (signed URLs with `ResponseContentDisposition`, object metadata on `s3-public`).

### TDD evidence
- RED: `vendor/bin/pest tests/Feature/Uploads tests/Unit/Uploads` -> `Tests: 15 failed, 334 passed` after writing the new tests (the sanitizer tests for the frame bombs failed first with the memory exhaustion; then output location, consume rollback and after-commit delete, work directory sweep, blueprint `unsupported_type`, scratch files, timeout cap, `MagicBytes` generic helpers). The two frame-bomb sanitizer tests and the output-location tests failed against the unfixed sanitizer.
- GREEN: same command -> `349 passed (975 assertions)`.

### Gates
- `vendor/bin/pest tests/Unit tests/Feature`: 3842 passed (16209 assertions).
- `vendor/bin/pint --test` passed; `vendor/bin/phpstan analyse` no errors.
- Gates-Gen: `typescript:transform` and `i18n:export` re-run, no change to generated files. No frontend file changed, so the browser suite and vitest were not re-run (95 and 1369 passed on d179c39).
