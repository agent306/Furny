# Task 33 report: media serving and media components

Status: DONE_WITH_CONCERNS (concerns at the end).

## What was built

Backend
- `GET /media/{media:uuid}?conversion=` (`media.show`, `auth` + `active`, `whereUuid`) in `routes/web.php`; `MediaController@show`: `MediaAccess::authorize`, then 302 to `$media->getTemporaryUrl(now()+15 min, $conversion, $headers)` with `Cache-Control: private, no-store`. Non-images get `ResponseContentDisposition: attachment; filename="<FileName::sanitize(name, ext)>"` and `ResponseContentType`; images get no override (inline). A conversion that is not generated (unknown, or not made yet) is answered with the file itself.
- `App\Support\Media\MediaAccess` (13 §8.9 matrix, by owner model + collection): Plan/FurnitureDesign `thumbnail` -> `view`; BlueprintImport `source|normalized|pages` -> `view`, `debug` -> `viewDebug`; FurnitureRevision `cutlist_pdf` -> staff with `orders.view`; Quote `pdf` -> `downloadPdf`; ProductionUpdate `photos` -> order `view` and, if `internal`, `viewInternal`; OrderIssue/Delivery `photos` -> order `view`; Message `attachments` -> `viewThread` and, for an `internal_note`, staff only. Any other pair (all public-disk collections, no owner) -> 404. A refusal is 404 for a customer and 403 for staff (never 403 for a customer, so existence does not leak; this also gives the brief's 404 for the owner-customer on `debug`). The order of a record is loaded `withTrashed` (the customer keeps access, as in the policies).
- `App\Domain\Shared\Data\MediaData` (`#[TypeScript]`, `fromMedia`): `{id, name, mimeType, size, url, thumbUrl, largeUrl, width, height}`; every URL is `media.show`; `thumbUrl`/`largeUrl` only for images; width/height from the media custom properties.
- `ConsumeUploadIntent` now stores the intent's `width`/`height` as media custom properties (they were known and dropped), so `MediaData` has real dimensions.
- `route-access.php`: `media.show` => `any`. `uploads.php` lang: `errors.type|size|count|network|timeout|failed`, `drop_here`, `take_photo`, `remove`, `status.*`, `gallery.more`, `lightbox.*`, `attachment.download`. Wayfinder, `typescript:transform` and `i18n:export` regenerated and committed.

Frontend
- `lib/upload.ts`: `uploadWithIntent` (presign -> XHR PUT with exactly the returned headers -> confirm -> poll `api.uploads.show` every 1 s up to 60 s), `UploadError {code, message}`, `mimeOf` (extension fallback for files the browser gives no type), `UploadedFileRef`. CSRF through the `XSRF-TOKEN` cookie as `X-XSRF-TOKEN` (the `/api` group is `web` with CSRF); URLs come only from Wayfinder.
- `composables/useImageCompression.ts` (`compressImage`, 15 §9.12) and `composables/useUpload.ts` (per-file queue for the dropzone: serial processing, progress, retry, remove, abort on unmount).
- `components/media/`: `FileDropzone`, `ImageUploader` (fixed accept list, always compressed, grid), `PhotoGallery`, `Lightbox` (reka Dialog; arrows/Home/End/Esc, swipe 50 px, double-click zoom 2x with pan, preloads neighbours, `aria-roledescription`, live region, focus returns to the opener), `AttachmentList`.
- Icons added to the registry: `chevron-left`, `chevron-right`, `upload-cloud`, `x`. Aliases `MediaData`, `UploadPurpose` in `types/domain.ts`.

## Files changed

Created: `app/Http/Controllers/MediaController.php`, `app/Support/Media/MediaAccess.php`, `app/Domain/Shared/Data/MediaData.php`, `resources/js/lib/upload.ts`, `resources/js/composables/{useUpload,useImageCompression}.ts`, `resources/js/components/media/{FileDropzone,ImageUploader,PhotoGallery,Lightbox,AttachmentList}.vue`; tests `tests/Feature/Media/{MediaAccessTest,MediaDataTest}.php`, `resources/js/lib/__tests__/upload.test.ts`, `resources/js/composables/__tests__/useImageCompression.test.ts`, `resources/js/components/media/__tests__/{FileDropzone,PhotoGallery,Lightbox,AttachmentList}.test.ts`.
Modified: `routes/web.php`, `resources/lang/en/uploads.php`, `tests/Feature/Security/route-access.php`, `app/Domain/Shared/Actions/ConsumeUploadIntent.php` (+ its test, one assertion), `resources/js/lib/icons.ts`, `resources/js/types/domain.ts`, generated: `resources/js/types/generated.d.ts`, `resources/js/lang/generated/{en,manifest}.json`.

## TDD evidence

RED (tests first, nothing implemented):
- `vendor/bin/pest tests/Feature/Media` -> `Tests: 15 failed, 1 passed (1 assertions)`; causes `Route [media.show] not defined` and `Class "App\Domain\Shared\Data\MediaData" not found` (the one pass is "not-a-uuid -> 404", which the fallback route already gave).
- `yarn vitest run resources/js/lib resources/js/composables resources/js/components/media` -> the new test files failed to import (`@/lib/upload`, `@/composables/useImageCompression`, the media components did not exist): `Test Files 7 failed | 20 passed`, of which 3 failing tests are the known baseline (`format.test.ts` de-CH x2 and an icons-scan timeout).

GREEN:
- `vendor/bin/pest tests/Feature/Media` -> `Tests: 17 passed (41 assertions)`.
- `yarn vitest run resources/js/lib/__tests__/upload.test.ts resources/js/composables/__tests__/useImageCompression.test.ts resources/js/components/media` -> all pass: upload 7, compression 6, FileDropzone 9, PhotoGallery 5, Lightbox 7, AttachmentList 1.
- `tests/Feature/Uploads/ConsumeUploadIntentTest.php` -> 18 passed (width/height custom properties).

## Gates (on the final tree)

- `vendor/bin/pint --test` -> passed. `vendor/bin/phpstan analyse` -> `[OK] No errors`.
- `vendor/bin/pest tests/Unit tests/Feature` -> `Tests: 5 failed, 3855 passed (16338 assertions)`. The 5 failures are exactly the known baseline of ENV.md: `ImageSanitizerTest > it writes its output where it is told to`, `GoogleOAuthTest > staff with a second factor and an address nobody verified…`, `BootWithoutServicesTest` x2, `ErrorPageTest > it has no closure route actions…`.
- `yarn lint` (0 warnings), `yarn format:check`, `yarn typecheck` -> clean.
- `yarn vitest run` (with the full pest suite running at the same time) -> `5032 passed, 5 failed`: the 3 baseline (`validate.test.ts` furniture codes, `format.test.ts` de-CH x2) plus `icons.test.ts` and `variants.test.ts`, which timed out (10 s / 8 s) on the file scans under that load; re-run alone they pass (`2 files, 73 tests passed`).
- Gates-Gen: `php artisan typescript:transform && php artisan i18n:export && git diff --exit-code -- resources/js/types/generated.d.ts resources/js/lang/generated` clean after the commit (see the end of the file).
- Browser suite not run (no page uses these components yet; Task 34+ do).

## Deviations / decisions

1. **`MediaData` namespace**: `App\Domain\Shared\Data\MediaData`, not `App\Support\Media\MediaData` of the brief, per preflight C10 (14 §19 normative for wire types).
2. **Upload API shapes as built in Task 32, not C10's**: presign is a plain 200 `{uploadId, url, headers}` and `api.uploads.show` is `{status, reasonCode, previewUrl}` (no `uploadId`, no `processing` status; the DB `uploaded` is returned as is). `uploadWithIntent` accepts any 2xx, treats every status except `ready`/`rejected`/`expired` as "keep polling", and takes `uploadId` from the presign. If a later task moves the backend to the C10 shapes (201 + `expiresAt`, `processing`), the client needs no change.
3. **Denials**: 404 for customers and 403 for staff for every refusal (the policies would give an owner-customer 403 on `debug`/`internal`; the brief and 13 §20.2 want 404). `MediaAccess::authorize` aborts; it returns void.
4. **Conversions**: a `?conversion=` that is unknown or not generated yet falls back to the original file instead of a 404/500, so a photo shown right after upload never has a broken thumbnail (`MediaData` always offers `thumb`/`large` for images, and not every collection has both: Plan has `small`, messages only `thumb`). The access check runs before this, so it reveals nothing.
5. **Content-Length/Host not set on the XHR** (a browser refuses them; Task 32 concern 1). "Exactly the returned headers" therefore means all of them but those two.
6. **Compression**: `OffscreenCanvas` only (no `<canvas>` fallback of 15 §9.12; marked with a `shortcut:` comment). Any failure while shrinking returns the original. Step 6 of 15 §9.12 ("only if the original is an accepted type within max size") is simplified to "result no smaller -> original".
7. **Client size check uses the original size** (before compression), so a photo over the purpose limit is refused even if it would compress below it. Cameras rarely exceed 15 MB; the server limit decides the final answer.
8. **`PhotoGallery` `max`**: shows `max` thumbnails plus a `+N` tile (N = hidden count, 6 for 4 of 10) that opens the lightbox at the first hidden photo.
9. **`FileDropzone` extras beyond the brief**: `layout: 'list'|'grid'` (used by `ImageUploader`), paste of images, "Take photo" only when `capture` is set and the pointer is coarse; `multiple` defaults to `maxFiles > 1`; the count limit counts failed items too (they stay until removed or retried). Lightbox zoom is double-click (covers double-tap).
10. **`ImageUploader`/`AttachmentList`/`useUpload`** have no brief tests of their own except a small AttachmentList test; `useUpload` and `ImageUploader` are exercised through `FileDropzone`'s tests (`ImageUploader` is a thin wrapper and has no test).
11. The new lang keys live in `uploads.*` (no new namespace). `uploads.errors.count` is an ICU plural.

## Concerns

- No page uses the components yet, so nothing exercised them in a real browser (drag and drop, camera input, the Lightbox swipe and zoom, the XHR upload against real storage were only tested with stubs). A visual/Playwright pass belongs with the first page that mounts them (Task 34/37).
- `Lightbox` leaves focus handling to a manual `activeElement` capture on `open`; if a page opens it from something that is not focused (programmatic open), focus goes to `body` on close.
- `MediaAccess` loads the record's order with a query per request (one extra query); fine for a redirect endpoint.
- The Task 32 concern still stands: the `S3UploadPresigner` signed `Content-Length` has not been tried against real R2.
- The full vitest run is sensitive to machine load (two scanning tests time out when pest runs at the same time); not changed.

## Fix round 1

Review finding 1 and controller rulings 2 to 7. One commit on top of 85e3734.

### Changes
1. **Touch targets (15 §9, rule 6).** Every control of the media components is 44 px: remove buttons `size="icon-lg"` (`size-11`) in both layouts, Retry `size="lg"` (`h-11`) in the list and an `icon-lg` rotate icon (with an sr-only label) in the grid, "Take photo" `size="lg"`, `AttachmentList` chips `min-h-11`. Fixed sizes, not `useControlSize`, because that gives `h-9` in compact admin density. Tests: "keeps every control at least 44 px (list / grid layout)" and the chip class in `AttachmentList.test.ts`.
2. **Presign is 201 `UploadPresignData {uploadId, url, headers, expiresAt}`** (new `#[TypeScript]` Data, `expiresAt` ISO 8601 from `CreateUploadIntent`, which now returns the Data; controller answers 201). `PresignTest` moved to `assertCreated` and the exact body with `expiresAt`.
3. **`UploadIntentStatusData {uploadId, status, reasonCode, previewUrl, width, height}`**, DB `uploaded` reported as `processing`; `status` is the string union of 14 §18.1 (`LiteralTypeScriptType`, so the TS type is `'pending' | 'processing' | ...`). `ConfirmTest`: exact shapes, plus "reports an uploaded file as processing". `upload.test.ts` uses the C10 shapes (201 presign with `expiresAt`, `processing` polls with `uploadId/width/height`); `upload.ts` types the answers with the generated types. Types regenerated and committed.
4. **Size after compression.** `FileDropzone` no longer refuses an image over the limit when `compressImages` is on; `useUpload.run` checks the compressed file and fails the item with `file_too_large` (shown with the limit). Non-image files are still refused up front. Tests: a 5 MB JPEG that compresses to 500 KB uploads the compressed file; one that stays too large is refused without a request; a large PDF is still refused before anything happens.
5. **Abort everywhere.** `put()` and `wait()` reject at once when the signal is already aborted; `api()` passes `signal` to `fetch` and reports `aborted` (not `network`) when it was aborted. Tests: abort during presign (answer arrives anyway) creates no XHR; every request carries the signal.
6. **Inline only for `image/jpeg|png|webp`**; any other type (DXF as `image/vnd.dxf`, SVG, HEIC, PDF) is an attachment with its type. Tests: DXF source downloads; dataset of six MIME types.
7. **`conversion` validated** as `nullable|string|in:thumb,small,large,preview`; anything else is 422 (`abort(422)` after a `Validator`, so it is a 422 for browsers and JSON alike). An allowed name that is not generated still falls back to the original. Tests: `nope`, `../thumb`, `THUMB` -> 422; `large`/`small` not generated -> original.

### TDD evidence
- RED PHP (tests changed first): `vendor/bin/pest tests/Feature/Media tests/Feature/Uploads/PresignTest.php tests/Feature/Uploads/ConfirmTest.php` -> `Tests: 34 failed, 80 passed`.
- RED JS (new tests against the old sources, via `git stash` of the four source files): `yarn vitest run resources/js/lib/__tests__/upload.test.ts resources/js/components/media` -> `7 failed | 29 passed` (AttachmentList 44 px, FileDropzone size x2 and 44 px x2, abort during presign, signal passed).
- GREEN: same PHP command -> `Tests: 114 passed`; JS command -> all pass.

### Gates (final tree)
- `vendor/bin/pint --test` passed; `vendor/bin/phpstan analyse` `[OK] No errors`.
- `vendor/bin/pest tests/Unit tests/Feature` -> `Tests: 6 failed, 3865 passed (16350 assertions)`: the 5 baseline failures of ENV.md plus `OtpConcurrencyTest > sends > it never goes past the ten sends an hour of one IP`, a race test that failed under the full run; `vendor/bin/pest tests/Feature/Auth/Otp/OtpConcurrencyTest.php tests/Feature/Security` alone -> `338 passed`. Unrelated to this change.
- `yarn lint`, `yarn format:check`, `yarn typecheck` clean; `yarn vitest run` -> `5041 passed, 3 failed` (the 3 baseline: furniture `validate.test.ts`, `format.test.ts` de-CH x2).
- Gates-Gen (`typescript:transform`, `i18n:export`, `git diff --exit-code` on the generated files) clean after the commit.
- No background process of mine is left running.
