### Task 33: Media serving and media components

**Files:**
- Create: `app/Http/Controllers/MediaController.php`; `app/Support/Media/MediaAccess.php`; `app/Support/Media/MediaData.php` (spatie Data, `#[TypeScript]`); `resources/js/lib/upload.ts`; `resources/js/composables/{useUpload,useImageCompression}.ts`; `resources/js/components/media/{FileDropzone,ImageUploader,PhotoGallery,Lightbox,AttachmentList}.vue`
- Modify: `routes/web.php` (`media.show`), `resources/lang/en/uploads.php`, `route-access.php`
- Test: `tests/Feature/Media/MediaAccessTest.php`, `resources/js/lib/__tests__/upload.test.ts`, `resources/js/composables/__tests__/useImageCompression.test.ts`, `resources/js/components/media/__tests__/{FileDropzone,PhotoGallery,Lightbox}.test.ts`

**Spec refs:** `13 §8.9`, `§11.6`, `§20.16`; `15 §9.10–§9.13`, `§9.31` (AttachmentList); `10 §3` (`MediaData`); `02 §10`

**Interfaces:**
- Consumes: Tasks 14–15, 32.
- Produces: `GET /media/{media:uuid}?conversion=` (`media.show`, `['web','auth','active']`) → 302 to a 15-minute temporary URL after `MediaAccess::authorize(User, Media)` (matrix of `13 §8.9`; public-disk collections and unknown combinations → 404); non-images get `ResponseContentDisposition: attachment; filename="<sanitised>"` and `ResponseContentType`; `Cache-Control: private, no-store`; `MediaData::fromMedia(Media $m): MediaData` (`{id, name, mimeType, size, url, thumbUrl, largeUrl, width, height}`); `uploadWithIntent(file, purpose, target, onProgress, signal): Promise<UploadedFileRef>` (presign → XHR PUT with exactly the returned headers → confirm → poll `api.uploads.show` every 1 s up to 60 s; rejects with `UploadError {code}`); `compressImage(file: File): Promise<File>` (`15 §9.12`); components with the props of `15 §9.10–§9.13`.

- [ ] **Step 1: Write the failing tests**
  - `MediaAccessTest` (`13 §20.16`): owner opens `Plan.thumbnail` → 302 to a URL containing the media path, header `Cache-Control: private, no-store`; another customer → 404; staff with `customers.view` → 302; `ProductionUpdate.photos` with `visibility internal` → customer 404, staff 302; `Quote.pdf` → 302 with `ResponseContentDisposition` attachment; `FurnitureRevision.cutlist_pdf` → support (orders.view) 302, customer 404; `BlueprintImport.debug` → estimator 302, owner-customer 404; `User.avatar` (public disk) → 404; guest → redirect `login`. (Temporary URLs via `Storage::disk('s3')->buildTemporaryUrlsUsing(...)`.)
  - `upload.test.ts`: the PUT carries exactly the presign `headers`; polling stops at `ready` and resolves `{uploadId, name, size, mime, previewUrl}`; `rejected` with `reasonCode 'upload_type_not_allowed'` rejects with that code; abort cancels the XHR; a 60-s timeout rejects with code `timeout`.
  - `useImageCompression.test.ts` (mocked `createImageBitmap`/canvas): 4000×3000 JPEG → longest side 2560, `image/jpeg`, name `.jpg`; 1200×900 JPEG of 1 MB → returned unchanged; decode failure (HEIC) → original file; result larger than original → original file.
  - `FileDropzone.test.ts`: wrong type → `t('uploads.errors.type', {name})`; too large → `uploads.errors.size`; more than `maxFiles` → `uploads.errors.count`; emits `uploading` true then false; area is a `button` and Enter opens the picker.
  - `PhotoGallery.test.ts`: `max=4` with 10 photos shows a `+6` tile. `Lightbox.test.ts`: ArrowRight/ArrowLeft change index, Escape emits `update:open false`, counter `3 / 12`, focus returns to the thumbnail.
- [ ] **Step 2: Run, expect FAIL** — `vendor/bin/pest tests/Feature/Media && yarn vitest run resources/js/lib resources/js/composables resources/js/components/media`
- [ ] **Step 3: Implement** — per Interfaces.
- [ ] **Step 4: Run tests, expect PASS** — same as Step 2.
- [ ] **Step 5: Quality gates** — Gates-PHP, Gates-JS, Gates-Gen.
- [ ] **Step 6: Commit** — `git add app routes/web.php resources tests` → `feat(media): policy-checked media serving and upload/gallery components` + trailer.

