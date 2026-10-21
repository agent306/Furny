# Task 32 review: upload intents (100058b..d179c39)

Reviewed in passes from the review package diff (4468 lines): actions, enum, job, support classes, controller/routes, then the tests and fixtures. Focused checks outside the diff are named with each finding. Mutation/probe work was done in a scratch directory (now deleted); the worktree was not touched.

### Spec Compliance

- ❌ Issues found:
  - **13 §11.3 step 3 (decompression-bomb guard) is not met for animated WebP.** The guard reads the outer VP8X canvas size, then `firstWebpFrame` cuts out the first ANMF frame and GD decodes that frame's own bitstream, whose dimensions are never checked (`app/Support/Uploads/ImageSanitizer.php:44-46`, `:201-223`). Probe: a 218 KB animated WebP with a 64×64 canvas and an 11000×11000 first frame passed `getimagesize` (64×64), `MagicBytes` (`webp`) and `finfo` (`image/webp`), then `ImageSanitizer::sanitize(..., 'webp', 4096)` died with `Allowed memory size of 536870912 bytes exhausted` at `ImageSanitizer.php:181`. With an 8000×6000 (48 MP) frame and a larger memory limit, it returned `4096x3072`, so the upload would be `ready` and not `upload_image_too_large`. See Critical 1.
- ✅ Everything else checked against 13 §11.1–§11.7, §20.12, 02 §1.6/§10, 06 §2.1/§5.8:
  - The purpose table matches: types, bytes, re-encode, max edge, target and authorisation (`UploadPurpose.php`, pinned row by row in `UploadPurposeTest`).
  - Presign follows steps 1–4: the target is authorised before validation, the blueprint extension and generic-MIME rules apply, the key is `tmp/{purpose}/{Y}/{m}/{ulid}`, expiry is +15 min, and the type and length are signed.
  - Confirm: owner-only, the row is locked, and HeadObject's size is compared with the declared size. A mismatch deletes the object and rejects the intent with 422. On success the job goes to `default` with timeout 60 and tries 2, and the response is 202.
  - Show returns `{status, reasonCode, previewUrl}`.
  - Sniffing matches the spec, including the finfo agreement for jpeg/png/webp/pdf. Orientation is applied for all 8 values and GD drops the metadata.
  - HEIC goes through vision with the exact body.
  - Processed keys use the sniffed extension. Consume follows step 7 with `uploadId` in the 422, and cleanup follows §11.5.
  - The §20.12 cases are all present: wrong magic, SVG, size mismatch, 50 MP, EXIF GPS plus orientation, and the four filename cases.
- ⚠️ Cannot verify from the diff:
  - 13 §11.3 step 4 / §11.6 say PDFs (and other non-images) are "only ever served … with `Content-Disposition: attachment`". Nothing in this task sets it. `ProcessUpload.php:113` `writeStream` gets a Content-Type from the extension and no disposition, and Spatie copies the PDF to the collection disk unchanged. This is fine if the serving tasks add `ResponseContentDisposition=attachment` to every signed URL, and add it as object metadata wherever a non-image collection lives on `s3-public`. The controller should carry this to the serving and messages tasks.
  - The signed `Content-Length` has not been checked against real Cloudflare R2 (implementer concern 1). This is accepted, but it still needs one live PUT with the wrong length (expect 403) before production.

### Strengths

- Security posture is sound in most places:
  - Object keys never contain user input.
  - The target's morph class comes from the purpose, never from the body, so there is no arbitrary class lookup (`CreateUploadIntent.php` `target()`).
  - A nonexistent target and a hidden target both give 404.
  - `UploadIntentPolicy` answers `denyAsNotFound` for show and confirm, and the action re-checks the owner.
  - Confirm and consume both take a row lock (`lockForUpdate`), so a double confirm queues one job and a double consume fails with `upload_invalid`.
  - ProcessUpload is idempotent on retry and returns early unless the status is `uploaded`. `failed()` turns exhausted retries into `upload_processing_failed`.
- SigV4 signer:
  - The subclass changes only the two deny lists, and the signed-header list is asserted exactly: `content-length;content-type;host`, and `content-type;host` when there is no size.
  - The recomputation in `S3UploadPresignerTest` is independent. It builds its own canonical request, string to sign and HMAC key chain from the hard-coded secret and scope. It takes only the path and query from the URL under test, and the query is itself inside the signature.
  - Path-style endpoint, disk prefix (`$disk->path`) and region `auto` are handled through the SDK's own serialisation.
- Type confusion is handled well:
  - The declared family, the sniffed type and finfo must all agree. Generic MIME types follow the extension.
  - SVG and HTML sniff as `null` and are rejected.
  - Processed objects get their Content-Type from the canonical extension. Checked: Flysystem's S3 adapter gives a stream body to `detectMimeTypeFromPath`, so a DXF/HTML polyglot is stored as `image/vnd.dxf`, never `text/html`.
- `ImageSanitizer`'s orientation handling is pinned by corner colours for all 8 EXIF values. Alpha, the progressive JPEG output and the 12 000 px edge are also tested.
- `FileName` handles bidi controls, zero-width characters, NFC, both separator styles, emoji variation selectors and trimming by characters rather than bytes. All are tested.
- Tests are behavioural, with real fixtures, a faked disk, a faked presigner and `Http::fake` assertions on the vision request. The rate-limit test checks per-user isolation and the reset after the window.

### Issues

#### Critical (Must Fix)

1. **Animated WebP bypasses the decompression-bomb guard.** `app/Support/Uploads/ImageSanitizer.php:44-46` and `:201-223`.
   - **Cause:** `guardSize()` runs on the container: `getimagesize` returns the VP8X canvas. `firstWebpFrame()` then reads the frame size from the ANMF header (which is also attacker-controlled, and is used only for the ALPH VP8X) and hands the raw VP8/VP8L chunk to `imagecreatefromwebp`. That decode uses the bitstream's own dimensions, up to 16383×16383. Without an ALPH chunk no VP8X is written, so libwebp has nothing to compare the frame against.
   - **Failure scenario:** any signed-in customer can do this with `avatar`, which needs no target, or with any photo purpose.
     1. Presign `image/webp` with a size of about 200 KB, PUT the crafted file and confirm.
     2. `ProcessUpload` decodes a frame of 121 MP or more.
     3. The PHP fatal error kills the `default` worker, twice per upload (tries 2).
     4. At 30 presigns a minute, one user can keep the `default` queue down.
   - **Probe result:** reproduced with a 218 KB file. The worker hit `Allowed memory size of 536870912 bytes exhausted` at `ImageSanitizer.php:181`. That limit is the minimum the implementer recommends for the worker.
   - **Second effect:** a 48 MP frame under a larger limit is accepted and downscaled, so the 40 MP rule is simply not enforced on this path.
   - **Still WebP is not affected:** the probe gave `upload_corrupt`, because libwebp rejects a canvas/bitstream mismatch.
   - **Fix:** after cutting the frame, run `guardSize($frame, 'webp')` on the still file. `getimagesize` reads the VP8/VP8L bitstream size there. Also reject a frame whose bitstream size exceeds the canvas.
   - **Test:** add a fixture to `generate.py`: a VP8X canvas of 64×64 with one ANMF frame whose VP8L is about 8000×6000. Expect `upload_image_too_large`.

#### Important (Should Fix)

1. **Sixteen test leftovers are committed as fixtures, and every Unit run adds four more.** The files are `tests/fixtures/uploads/sanitized-*` (16 files, mode 0600).
   - **Cause:** `ImageSanitizer::sanitize` writes its output with `tempnam(dirname($path), 'sanitized-')` (`ImageSanitizer.php:69`). `ImageSanitizerTest` calls it directly on fixture paths and never deletes the result: `tests/Unit/Uploads/ImageSanitizerTest.php:119` (exif-gps-rotated.jpg, 3137 B outputs), `:131` (plain.png, 250 B), `:141` (plain.webp, 104 B), `:148` (animated.webp, 260 B).
   - **Evidence:** 4 runs × 4 tests = the 16 files in the commit, with timestamps 16:49, 16:51, 16:52 and 16:53.
   - **Consequences:**
     - Every suite run leaves untracked binaries in a fixtures directory that `.gitattributes` marks as compared byte for byte.
     - The brief's `git add … tests` commit step sweeps them in.
     - The report's "No scratch files in the tree" is false.
   - **Fix:** delete the 16 files. Copy each fixture to a temp directory before sanitising (as `sanitizerTemp` already does for the other cases), and unlink `$result['path']`.

#### Minor (Nice to Have)

1. **Implementer concern 4 is wrong, and the real behaviour has a rollback hazard.** `app/Domain/Shared/Actions/ConsumeUploadIntent.php:30-39`.
   - **What actually happens:** `addMediaFromDisk` without `preservingOriginal()` makes Spatie delete the source object after the copy. Checked in `vendor/spatie/laravel-medialibrary/src/MediaCollections/FileAdder.php:621-623`, where `preserveOriginal` defaults to false. So `uploads/{…}` is deleted on consume. There is no leak to carry.
   - **The hazard:** that S3 delete happens inside the DB transaction, and the consuming action's own outer transaction too. If the outer transaction rolls back after `handle()`, the intent goes back to `ready` with a `processed_key` whose object is gone, so every retry fails. The `s3-public` copy is also orphaned.
   - **Fix:** pass `preservingOriginal()` and delete `processed_key` in an `afterCommit` callback, or document that the caller must not fail after consume.
   - **Related test:** `CleanupOrphanMediaTest.php:53` asserts that a consumed intent's processed object still exists, which is a state the real flow never produces.
2. **The vision HTTP timeout (120 s) is longer than the job timeout (60 s).** `app/Support/Uploads/VisionHeicConverter.php:34` against `ProcessUpload.php:35`. The values come from `config/imports.php` (`normalize_timeout_s` 120) and the brief.
   - **Failure scenario:** a slow HEIC normalisation is killed by the queue's timeout, not by the HTTP client. On that kill the `finally` at `ProcessUpload.php:66` does not run, so `storage/app/tmp/{ulid}/` stays on disk.
   - **Fix:** this is a spec conflict, so log it in 19. Keep the HTTP timeout below the job timeout (for example `min(normalize_timeout_s, timeout - 10)`), or sweep `storage/app/tmp` in the cleanup command.
3. **Wrong reason code for unknown blueprint types.** For `blueprint_source`, a sniffed unknown type (TIFF/AVIF/GIF/BMP/SVG) is rejected with `upload_type_not_allowed` (`ProcessUpload.php:144`). 06 §2.1's table gives `unsupported_type` for these, and the customer message differs. This is a spec conflict between 13 §11.3 and 06 §2.1; note it in 19 or use `unsupported_type` for that purpose.
4. **The generic-MIME list is duplicated.** `ProcessUpload.php:163` repeats `CreateUploadIntent::GENERIC_MIMES` (`CreateUploadIntent.php:32`) as a literal. If one changes, presign and processing disagree on the declared family. Move it to `MagicBytes`, next to the type table.
5. **Temp files leak in the test suite.**
   - `MagicBytesTest.php:8-12` `magicBytesFile()` never unlinks its temp file.
   - `ImageSanitizerTest` outputs for the `sanitizerTemp` sources (sys temp) are not unlinked either, because only the source has a shutdown hook.
6. **The negative SigV4 test is weak.** `S3UploadPresignerTest.php:71` only shows that HMAC changes when its input changes, which the positive test already implies. A stronger guard would assert that `Storage::temporaryUploadUrl` does not sign the headers, so the subclass stays justified if the SDK changes. Even better would be one test against MinIO in CI.
7. **The presigned PUT URL can be reused.** The URL stays valid until `expires_at` after confirm and processing. The owner can PUT the same `tmp/` key again after `ProcessUpload` deleted it, which leaves an orphan for the 2-day lifecycle rule. The type and length are still enforced, and the impact is low.

### Assessment

**Spec:** ❌. The 40 MP / 12 000 px guard of 13 §11.3 is bypassable through the animated-WebP path. Everything else is compliant, with the accepted deviations implemented as ruled.

**Task quality:** Needs fixes

**Reasoning:** The design is sound in most places: the signer, authorisation, state-machine locking and type sniffing are all solid and well tested. But a 218 KB animated WebP from any customer reaches a full GD decode of an unbounded frame and kills the worker, and the commit ships 16 junk binaries that the tests regenerate on every run.

Counts: Critical 1, Important 1, Minor 7.

---

## Re-review 1 (d179c39..d8c8b6b)

Scope: the findings above plus the fix diff (1408 lines, read in two passes). The attack was re-run in a scratch directory, which is now deleted. It loaded the worktree's autoloader read-only and wrote output only to scratch.

### Finding Verdicts

- **C1: animated WebP bypasses the bomb guard.** ADDRESSED.
  - **The fix:** `app/Support/Uploads/ImageSanitizer.php:52` runs `guardSize` on the cut-out frame file before `decode`, and `fitsCanvas` refuses a frame larger than the canvas.
  - **Re-run of the real attack:** decodable bitstreams, not the 90-byte header fixtures. Each file is an animated container with a 64×64 canvas and ANMF header, run through `sanitize(..., 'webp', 4096, false, $dir)` under `memory_limit=512M`:

    | First frame | Bitstream | File size | Result | Peak memory |
    |---|---|---|---|---|
    | 11000×11000 | lossy VP8 | 218 KB | `upload_image_too_large` | 17 MB |
    | 8000×6000 | lossy VP8 | 87 KB | `upload_image_too_large` | 17 MB |
    | 11000×11000 | lossless VP8L | 4.7 KB | `upload_image_too_large` | 17 MB |
    | 8000×6000 | lossless VP8L | 2 KB | `upload_image_too_large` | 17 MB |

    Before the fix, the 11000² file was a fatal out-of-memory error at 512 MB.
  - **Alpha variant:** an ALPH chunk plus a large VP8/VP8L frame makes `stillWebp` write a VP8X with the attacker's ANMF size (64×64), so `getimagesize` sees 64×64. libwebp still rejects the canvas/bitstream mismatch before it allocates anything: `upload_corrupt`, peak 17 MB, for 11000², 8000×6000 and the lossless 8000×6000.
  - No `frame-`/`sanitized-` files were left in the output directory.
  - Tests: `ImageSanitizerTest` (both bomb fixtures and the over-canvas fixture) and `ProcessUploadTest` (both bombs through the job, with memory under 50 MB).
- **I1: committed `sanitized-*` files, and outputs written next to the input.** ADDRESSED.
  - All 16 files are deleted in the diff, and `tests/fixtures/uploads/` now holds only fixtures and `generate.py` (checked).
  - Output goes to `$directory ?? sys_get_temp_dir()` (`ImageSanitizer.php:76`, frame at `:276`). `ProcessUpload` passes its work directory.
  - Tests unlink their outputs through `sanitizerRun`. A new test asserts the fixtures directory is unchanged after sanitising.
  - `storage/app/tmp` is empty and `/tmp` has no `sanitized-*`/`frame-*` files (checked).
- **M1: consume rollback (processed file deleted inside the transaction).** ADDRESSED.
  - `preservingOriginal()` plus `DB::afterCommit` delete (`ConsumeUploadIntent.php:52`).
  - Tests cover deletion after the outer commit, and a rollback that leaves the intent `ready`, keeps the file, and lets the upload be consumed again.
  - The artificial assertion in `CleanupOrphanMediaTest` is removed.
- **M2: vision timeout longer than the job timeout.** ADDRESSED.
  - The call timeout is now `min(normalize_timeout_s, 60 - 10)` (`VisionHeicConverter.php`), tested with 30→30, 120→50 and 60→50.
  - `media:cleanup-orphans` now sweeps work directories older than an hour.
- **M3: `unsupported_type` for unknown blueprint types.** ADDRESSED. `ProcessUpload.php` `sniff()` uses it for `BlueprintSource`, with a test using `vector.svg`.
- **M4: duplicated generic-MIME lists.** ADDRESSED. `MagicBytes::GENERIC_MIMES` and `genericMimeFits()` are now used by all three callers.
- **M5: temp-file leaks in tests.** ADDRESSED. `magicBytesFile` and the `sanitizerTemp` base file now have shutdown unlinks.
- **M6: weak negative signature test.** ADDRESSED. It is replaced by an assertion that the SDK's own `temporaryUploadUrl` signs only `host`, so the test fails if the subclass ever stops being needed.
- **M7: presigned PUT reusable after confirm.** DECLINED. Security judgement:
  - **GD path (jpeg/png/webp, PDF, DXF): the decline is sound.** `ProcessUpload` downloads the object once into its work directory (`ProcessUpload.php:92`). Every check runs on those local bytes: size, magic bytes, finfo, the bomb guard and the GD decode. The upload to `uploads/` is written from that same file. A re-PUT cannot change the size, because the length is signed. A swap between confirm and the download is simply what gets checked, and a swap after the download is ignored. The `uploads/` key is not reachable through the URL, because the key is signed. The only effect is an orphan `tmp/` object, which the 2-day lifecycle rule removes.
  - **HEIC photo path: a real TOCTOU exists.** After sniffing the local copy as HEIC, `toJpeg` hands the vision service a presigned GET of the *bucket* object (`ProcessUpload.php:103`), not of the bytes that were checked.
    - **Scenario:** the owner re-PUTs any bytes of the same length with `Content-Type: image/heic`, between the download and vision's GET.
    - **What it bypasses:** the input to the vision decoder skips the magic-byte and allowlist check. Pillow decodes most formats unless normalize restricts them, and its pixel limit is the only bomb guard there.
    - **What still holds:** the app side is unaffected. The result must sniff as JPEG and passes through the GD bomb guard and re-encode (`:105`). The vision container is isolated.
  - **Rating:** Minor, non-blocking, carried to P3. Either the normalize endpoint accepts only HEIF/HEIC and enforces 40 MP, or `ProcessUpload` writes its verified local copy to a server-only key (for example `{object_key}.src`) and presigns the GET on that key, which closes the gap at once.

### New Breakage in the Fix Diff

- Minor: `ConsumeUploadIntent.php:52` runs the `afterCommit` delete on the `s3` disk with `throw => true`. If S3 fails, the exception surfaces after the caller's transaction has committed. The request returns 500 even though the message or avatar was saved, so the client may retry and post twice. Wrap it in `try { … } catch (Throwable $e) { report($e); }`; a leftover `uploads/` object is harmless.
- Minor: `CleanupOrphanMedia::sweepWorkDirectories` deletes *any* directory under `storage/app/tmp` older than an hour, not only `ProcessUpload` work directories. Today only `ProcessUpload` uses that path (grep checked). A later feature that keeps longer-lived scratch there would lose it; a dedicated `storage/app/tmp/uploads/` root would scope it.
- Minor (test hygiene):
  - `CleanupOrphanMediaTest.php:109` runs at travel time 2030, so every real directory under `storage/app/tmp` counts as "stale". In a parallel run this deletes other workers' live job directories and makes them flaky.
  - `ImageSanitizerTest.php:267` asserts the whole system `/tmp` has no `frame-*` files. That breaks if any other process or a killed earlier run leaves one; compare before and after instead, as `ProcessUploadTest` does.

### Out-of-Scope Observations

- None new. The carries from the first review stand: `Content-Disposition: attachment` belongs to serving, and the signed `Content-Length` still needs a live R2 check.

### Verdict

**Spec:** ✅. The 13 §11.3 bomb guard now holds on the animated-WebP path. It was verified with decodable 121 MP and 48 MP frames, lossy, lossless and alpha.

**Fix round:** All findings addressed, no new Critical/Important breakage. M7 was declined, and the decline is acceptable with the HEIC-path TOCTOU carried to P3 as Minor. The fix diff adds 4 new Minors.

**Task quality:** APPROVED
