# 06 — Blueprint Import (upload, vision service, recognition pipeline, review, trace)

Read the master document, `01-architecture.md`, `02-data-model.md`, `03-design-documents.md` first. This file is normative for: accepted upload formats, the `blueprint_imports` state machine, every Laravel class/route/job involved in importing, the Python vision service (layout, HTTP API, pipeline algorithms, prompts, schemas), the customer review/correction UX, trace mode, error codes, tests and acceptance criteria. AI provider plumbing (adapters, credentials, credits, budgets, usage metering) is in `18-ai-providers-and-quotas.md`; this file references it as **18**.

Everything here is decided. Tables and columns are defined in `02` (§4.1 `blueprint_imports`, §1.6 `upload_intents`), document types and engine commands in `03`/`04`, permissions and upload security in `13`, notifications in `12`, AI credits/providers in `18`; route names are registered in `14`.

---

## 0. Summary of decisions

| # | Decision | Rationale |
|---|---|---|
| I1 | Hybrid pipeline: classical CV (OpenCV) + OCR (RapidOCR) produce **all geometry**; the LLM only **labels and associates** numbered candidates. | LLM pixel coordinates are approximate; CV geometry is exact. No permissively licensed raster→vector model exists (CubiCasa5k CC BY-NC, Raster-to-Graph GPL, DeepFloorplan GPL/TF1, RoomFormer/PolyRoom are point-cloud). |
| I2 | LLM input = clean overview image + the same image with numbered candidate marks ("set-of-marks") + compact candidate JSON. Agentic `crop_image` tool loop when the provider supports tools. | Vendors recommend giving vision models crop/zoom tools for dense technical drawings; marks make associations unambiguous. |
| I3 | Coordinates in the result document: mm, with the **normalized page image's top-left pixel at (0,0)** and `x_mm = round(x_px × mmPerPixel)`. | The background image then aligns with `position (0,0)`, `rotation 0`, and the "Check a dimension" rescale is a pure scaling about the origin. |
| I4 | The vision service is **synchronous** per request (one HTTP call per run, ≤ 570 s). Laravel reports coarse stages around the call. | Simpler than callbacks; no inbound connection from vision to Laravel needed. |
| I5 | Scale is solved by robust weighted least squares over (dimension text ↔ pixel span) pairs; room-size labels are a cross-check and second method. | Works for mm dimension chains (HDB-style) and `10'0"x11'0"` labels (Indian brochures). |
| I6 | PDFs are rasterised by us (pypdfium2) and, when vector content exists, line geometry is taken from pdfplumber. Images sent to LLMs are pre-resized by us. | Avoids uncontrolled server-side rasterisation; exact geometry from vector PDFs. |
| I7 | DXF via ezdxf; walls from parallel line pairs; LLM used only to map unrecognised layer names (text-only). DWG rejected. | LibreDWG (GPL) and ODA (non-commercial) licences excluded. |
| I8 | Not used: PyMuPDF (AGPL), LibreDWG, ODA File Converter, CubiCasa5k, Raster-to-Graph, Ultralytics. pi-heif is used **for decoding only**. | Licensing. |
| I9 | Review happens **before** a plan exists: the draft lives in `blueprint_imports.result_document`, autosaved with optimistic locking; Accept creates/replaces the plan. | Customers can abandon a bad import without polluting plans; the `import_accepted` revision is the clean starting point. |
| I10 | Trace mode = normalization + scale calibration only, then the regular plan editor. v1 has **no snapping to image edges**. | Client-side edge maps add payload and complexity for little gain; a 4× loupe gives precise point placement. |
| I11 | `RecognitionVendor` adapter interface exists (phase 2) for a future commercial image→vector API; v1 ships no implementation. | No self-serve commercial vendor exists today. |
| I12 | Phase 2 note: train an own detector on **ResPlan** (CC BY 4.0) to replace parts of the CV wall/opening stage. v1 must keep stage boundaries (`walls.py`, `openings.py`) replaceable. | Licence-compatible dataset exists; not needed for v1 targets. |

---

## 1. User journeys

### 1.1 Auto import (recognition)

1. Customer opens a project → **Import blueprint** (`customer.projects.imports.create`). Chooses **Analyze automatically** (default) or **Trace it myself (free)**. Optionally chooses "Replace plan: …" (dropdown of the project's plans) — default "Create a new plan".
2. Drops/selects a file. Client validates extension, MIME and size (§2) and uploads it with the shared upload-intent flow (13 §11, `FileDropzone` 15): `POST /api/uploads/presign` (`api.uploads.presign`, purpose `blueprint_source`, target = the project) → direct PUT to S3 with a progress bar → `POST /api/uploads/{upload}/confirm` → poll `GET /api/uploads/{upload}` until `ready` (a `rejected` intent shows the matching §2.1/§14 message, e.g. `dwg_not_supported`). Then the client calls `POST /api/projects/{project}/imports` (A1) with `{uploadId, mode, planId?}`, which creates the import directly in status `uploaded`.
3. Page `customer.imports.show` shows "Checking your file…" while `PrepareImportPreview` runs (≤ 30 s, usually < 5 s).
4. Options step (same page, state `uploaded` + `source_kind` set):
   - PDF with > 1 page: page picker grid of thumbnails (required choice; default page 1).
   - Photo detected (or user ticks "This is a photo of a paper drawing"): corner editor on the preview with the 4 suggested corners (draggable handles, 4× loupe while dragging), "Reset corners" and "Use whole image".
   - Optional hints (collapsed "Help us read your drawing"): unit system radio (Auto / Metric (mm) / Feet & inches), "A measurement I know" (label text + length input parsed by `parseLength`), wall height (length input, default business `units.default_wall_height_mm`).
   - Cost line: "This analysis uses **{n}** AI credit(s). You have **{balance}**." (from 18 §15.1; staff: "Unlimited (staff)"). If `n` = 0: "Free".
   - Button **Analyze drawing** → `POST /api/imports/{import}/start`.
5. Progress (`queued` → `preprocessing` → `recognizing`): indeterminate progress bar, stage text, elapsed timer, note "You can leave this page — we'll notify you when it's ready." Live via Reverb `imports.{importId}`; polling `GET /api/imports/{import}` every 5 s when the socket is not connected.
6. `ready_for_review` → page redirects (or the notification links) to **Review** (`customer.imports.review`), the plan editor in `import-review` mode (§11).
7. **Accept** → plan created or replaced (§11.7) → redirect to the plan editor. **Discard** → back to the project.

### 1.2 Trace mode

Steps 1–4 as above with mode `trace` (no hints except corners/page, no credits). **Start tracing** → `POST /start` → normalization only (§5.6 `/v1/normalize`, usually < 10 s) → Review page in trace variant: calibrate scale (§12) → **Continue to editor** (= accept) → new/replaced plan with `source = traced`, empty geometry, background image locked → plan editor opens with the wall tool active and the background panel open.

### 1.3 DXF

Same as auto import; no page/corner step. Charged as provider `none` (18 §8.3). Result reviewed the same way (background = rendered DXF preview).

### 1.4 Failure paths

- Failed import page: translated error message (§14), buttons as allowed by the error: **Try again** (retryable errors; re-reserves credits), **Trace it myself instead** (free; `POST /convert-to-trace`, reuses the upload), **Upload a different file**.
- Poor result: in Review, **Improve with AI** (only when `meta.providerUsed = none` and an AI provider is available, 18 §8) and **Start over in trace mode** (free) are offered in the review panel's "…" menu.

---

## 2. Supported inputs and limits

### 2.1 Formats

| Kind (`source_kind`) | Extensions | Declared MIME accepted at presign | Magic bytes (sniffed by `ProcessUpload` (13 §11.3) and again by `PrepareImportPreview`) | Max size |
|---|---|---|---|---|
| `raster` | `.jpg .jpeg .png .webp` | `image/jpeg`, `image/png`, `image/webp` | JPEG `FF D8 FF`; PNG `89 50 4E 47 0D 0A 1A 0A`; WebP `RIFF????WEBP` | 25 MB |
| `heic` | `.heic .heif` | `image/heic`, `image/heif`, `application/octet-stream` | bytes 4–11 = `ftypheic`, `ftypheix`, `ftyphevc`, `ftypheim`, `ftypheis`, `ftypmif1`, `ftypmsf1` | 25 MB |
| `pdf_vector` / `pdf_raster` | `.pdf` | `application/pdf` | `%PDF-` within the first 1024 bytes | 25 MB |
| `dxf` | `.dxf` | `image/vnd.dxf`, `application/dxf`, `application/x-dxf`, `image/x-dxf`, `application/octet-stream`, `text/plain` | ASCII: after optional whitespace, `0` line then `SECTION`; binary: `AutoCAD Binary DXF\r\n\x1a\x00` | 15 MB |

Rejected with specific messages:

| Detected | Error code | Customer message (en) |
|---|---|---|
| DWG (magic `AC10`, `AC1012`…`AC1032`, or `.dwg` extension) | `dwg_not_supported` | "DWG files can't be opened. In your CAD program use *Save as → DXF* or *Print → PDF*, then upload that file." |
| TIFF, AVIF, GIF, BMP, SVG, other | `unsupported_type` | "This file type isn't supported. Please upload a JPG, PNG, WebP, HEIC, PDF or DXF." |
| Encrypted PDF (pypdfium2 raises password error) | `pdf_encrypted` | "This PDF is password-protected. Please upload an unprotected copy." |

`.dxf` and `.heic` often arrive with an empty or generic browser MIME type; the presign endpoint accepts `application/octet-stream`/`text/plain` **only** together with the matching extension. The authoritative type is always the sniffed one.

### 2.2 Limits (abuse protection)

| Limit | Value | Enforced where |
|---|---|---|
| File size | 25 MB (raster/PDF/HEIC), 15 MB (DXF) | upload presign (13 §11.2, signed `Content-Length`), upload confirm (`HeadObject`, 13 §11.3), vision fetch (streaming cap) |
| PDF pages | ≤ 20 | `/v1/inspect` → `pdf_too_many_pages` |
| Decoded pixels | > 120 MP → reject `image_too_large`; 40–120 MP → downscale to 40 MP (INTER_AREA) with warning `image_downscaled` | vision decode (`PIL.Image.MAX_IMAGE_PIXELS = 120_000_000`) |
| Min image size | short edge ≥ 300 px, else `image_too_small` | vision decode |
| DXF entities | ≤ 200 000 after block explosion, else `dxf_too_complex` | vision DXF reader |
| Result size | ≤ 2000 walls, 1000 openings (03 `plan.too_large`), else `too_complex` | vision validate |
| Active imports per user | ≤ 2 in `queued`/`preprocessing`/`recognizing` | `StartBlueprintRecognition` → 429 `too_many_active_imports` |
| Presign rate | limiter `uploads-presign` (13 §10; shared by all upload purposes) | `api.uploads.presign` |
| Start rate | 10 per hour per user (plus daily limit in 18 §11) | limiter `imports-start` (13 §10) on A5 and A11 |

---

## 3. Import state machine

`blueprint_imports.status` (enum `App\Domain\Imports\Enums\ImportStatus`, values exactly as 02 §4.1). Transitions happen only in the Actions listed; any other transition throws `InvalidImportTransition` → HTTP 409 `{code: 'invalid_import_state', status}`.

| From | To | Action / job | Notes |
|---|---|---|---|
| — | `uploaded` | `CreateBlueprintImport` | consumes a `ready` `blueprint_source` upload intent (13 §11.3 step 7); attaches media `source`; dispatches `PrepareImportPreview` |
| `uploaded`, `queued` | `cancelled` | `CancelImport` | User; or `imports:cleanup-stale` (`uploaded` > 7 days). `queued` → releases reservation (18 §9.4) |
| `uploaded` | `failed` | `PrepareImportPreview` | sniff/inspect errors (§14) |
| `uploaded` | `queued` | `StartBlueprintRecognition` | requires `source_kind` not null; auto mode reserves credits; dispatches `RunBlueprintRecognition` |
| `queued` | `preprocessing` | `RunBlueprintRecognition` (start) | sets `started_at`, `attempts + 1` |
| `preprocessing` | `recognizing` | `RunBlueprintRecognition` | immediately before `POST /v1/recognize` (auto mode only) |
| `preprocessing` | `ready_for_review` | `RunBlueprintRecognition` | trace mode after `/v1/normalize` |
| `recognizing` | `ready_for_review` | `CompleteImportRecognition` | stores result, commits credits |
| `queued`, `preprocessing`, `recognizing` | `failed` | `MarkImportFailed` | releases reservation (refund) |
| `failed` | `queued` | `StartBlueprintRecognition` | only if `error_code` is retryable (§14); new reservation |
| `ready_for_review` | `accepted` | `AcceptImportIntoPlan` | sets `plan_id` |
| `ready_for_review` | `discarded` | `DiscardImport` / `RerunBlueprintImport` (source import) / cleanup after 60 days | credits not refunded |
| `ready_for_review`, `failed` | (new import row) | `RerunBlueprintImport`, `ConvertImportToTrace` | the new row copies `source` media; the old row → `discarded` if it was `ready_for_review` |

Cancel is **not** allowed once `preprocessing` has started (UI hides the button; API 409). Rationale: the vision call cannot be interrupted and spends provider money.

Stage keys (broadcast only, not persisted; enum `ImportStage`): `checking_file`, `awaiting_options`, `queued`, `preparing`, `analyzing`, `finalizing`, `ready`, `failed`, `cancelled`. On page reload the UI derives the stage from status: `uploaded`+`source_kind null` → `checking_file`; `uploaded` → `awaiting_options`; `queued` → `queued`; `preprocessing` → `preparing`; `recognizing` → `analyzing`; others map 1:1.

Stage texts (translation keys `imports.stage.*`): `checking_file` "Checking your file…", `queued` "Waiting for a free analyzer…", `preparing` "Preparing your drawing…", `analyzing` "Analyzing drawing… usually 30–120 s", `finalizing` "Almost done — building your plan…".

---

## 4. Laravel side

### 4.1 Files

```
app/Domain/Imports/
├─ Models/BlueprintImport.php
├─ Enums/ImportStatus.php  ImportMode.php  ImportSourceKind.php  ImportStage.php  ImportErrorCode.php
├─ Data/CreateImportData.php  ImportHintsData.php  ImportOptionsData.php  ImportTargetData.php
│      ImportStatusData.php  ImportReviewSaveData.php  VisionRecognizeResultData.php
├─ Actions/CreateBlueprintImport.php  UpdateImportOptions.php
│         StartBlueprintRecognition.php  CancelImport.php  CompleteImportRecognition.php
│         MarkImportFailed.php  SaveImportReviewDocument.php  AcceptImportIntoPlan.php
│         DiscardImport.php  RerunBlueprintImport.php  ConvertImportToTrace.php
├─ Jobs/PrepareImportPreview.php  RunBlueprintRecognition.php
├─ Events/ImportStatusChanged.php (ShouldBroadcast)  ImportReadyForReview.php  ImportFailed.php  ImportAccepted.php
├─ Console/CleanupStaleImports.php           (signature imports:cleanup-stale)
└─ Queries/ImportListQuery.php               (admin list)
app/Support/Vision/VisionClient.php  VisionException.php  VisionBusyException.php  VisionErrorResponse.php
app/Http/Controllers/Api/ImportController.php
app/Http/Controllers/Customer/ImportPageController.php
app/Http/Controllers/Admin/ImportController.php
app/Http/Requests/Api/Imports/*.php
app/Policies/BlueprintImportPolicy.php
config/imports.php
resources/js/pages/Customer/Imports/Create.vue  Show.vue  Review.vue
resources/js/pages/Admin/Imports/Index.vue  Show.vue
resources/js/editor/plan/import/   (review mode components, §11)
```

`config/imports.php`:

```php
return [
    'max_bytes' => ['raster' => 25 * 1024 * 1024, 'pdf' => 25 * 1024 * 1024, 'heic' => 25 * 1024 * 1024, 'dxf' => 15 * 1024 * 1024],
    'max_pdf_pages' => 20,
    'max_active_per_user' => 2,
    'vision_presign_ttl_minutes' => 15,   // server-side presigns for the vision service only (§4.7); browser uploads use 13 §11
    'vision' => [
        'url' => env('VISION_SERVICE_URL', 'http://furny-vision:8000'),
        'token' => env('VISION_SERVICE_TOKEN'),
        'recognize_timeout_s' => 600,
        'inspect_timeout_s' => 30,
        'normalize_timeout_s' => 120,
        'connect_timeout_s' => 5,
        'debug_outputs' => 8,
    ],
    'retention' => ['discard_ready_after_days' => 60, 'purge_media_after_days' => 30],
];
```

### 4.2 Model `BlueprintImport`

`final class BlueprintImport extends Model implements HasMedia` with `HasUlids`, `InteractsWithMedia`. Casts: `status` → `ImportStatus`, `mode` → `ImportMode`, `source_kind` → `ImportSourceKind`, `hints` → `array`, `result_document` → `AsJsonDocument`, `result_meta` → `array`, `started_at`/`finished_at` → `immutable_datetime`. Relations: `project()`, `plan()`, `user()`, `ledgerEntries()` (morphMany `AiCreditLedgerEntry` as `reference`), `usageEvents()` (morphMany `AiUsageEvent`).

Media collections (`registerMediaCollections`): `source` (singleFile, disk `s3`), `normalized` (singleFile, `s3`, conversion `preview`: 1600 px wide WebP, `nonQueued()` false → queued on `default`), `debug` (`s3`, multiple), `pages` (`s3`, multiple; webp/jpeg ≤ 2 MB each; custom properties `page`, `kind` = `thumb|preview`, `width`, `height`; 02 §10).

Helper methods: `isTerminal(): bool` (accepted, discarded, failed, cancelled), `isActiveRun(): bool` (queued, preprocessing, recognizing), `stage(): ImportStage`.

### 4.3 HTTP API (JSON; API route group `['web', 'auth', 'active', 'throttle:api']` of 13 §1; names prefixed `api.imports.`; contact verification for auto mode is enforced by `BlueprintImportPolicy` at A5/A11, 13 §8.4)

All responses use `ImportStatusData`:

```ts
interface ImportStatusData {
  id: string; projectId: string; planId: string | null;
  status: ImportStatus; stage: ImportStage; mode: 'auto' | 'trace';
  sourceKind: 'raster' | 'pdf_vector' | 'pdf_raster' | 'dxf' | 'heic' | null;
  originalFilename: string; fileSizeBytes: number | null;
  pageCount: number | null; selectedPage: number;
  pages: Array<{ index: number; thumbnailUrl: string; widthPt: number | null; heightPt: number | null }>; // signed URLs, 15 min
  preview: { url: string; width: number; height: number } | null;       // inspect preview (corner editor)
  photo: { isLikelyPhoto: boolean; suggestedCorners: [number, number][] | null } | null;   // normalized 0..1, TL,TR,BR,BL
  hints: ImportHints;
  aiProvider: string | null; aiModel: string | null;
  creditsReserved: number; creditsCharged: number;
  cost: { credits: number; free: boolean; providerWillBe: 'anthropic' | 'openai' | 'openai_compatible' | 'none'; reason: null | 'budget_fallback' | 'provider_unavailable' } | null; // only while uploaded/failed
  error: { code: string; messageKey: string; retryable: boolean } | null;
  startedAt: string | null; finishedAt: string | null; createdAt: string;
  reviewUrl: string | null;   // when ready_for_review
}
interface ImportHints {
  unitSystem?: 'metric' | 'imperial';
  knownDimension?: { label: string; mm: number };
  wallHeightMm?: number;
  isPhoto?: boolean;
  corners?: [[number, number], [number, number], [number, number], [number, number]]; // normalized 0..1 in preview frame
}
```

| # | Method & path | Request | Success | Errors |
|---|---|---|---|---|
| A1 | `POST /api/projects/{project}/imports` (`api.imports.store`) | `{ uploadId: ulid, mode: 'auto'|'trace', planId?: ulid }` | 201 `ImportStatusData` (`uploaded`) | 422 `upload_invalid` (intent not owned, not `ready`, wrong purpose/target or already consumed); 403 |
| A2 | — (number kept free: upload confirmation is `api.uploads.confirm`, 13 §11.3) | | | |
| A3 | `GET /api/imports/{import}` (`api.imports.show`) | — | 200 `ImportStatusData` | 403/404 |
| A4 | `PATCH /api/imports/{import}` (`api.imports.update`) | `{ selectedPage?: int 1..pageCount, hints?: ImportHints }` | 200 `ImportStatusData` | 409 unless `uploaded` or `failed`; 422 validation |
| A5 | `POST /api/imports/{import}/start` (`api.imports.start`) | `{ basic?: boolean }` — `true` forces provider `none` ("basic recognition", charged `credits_per_recognition_none`, 18 §8) | 202 `ImportStatusData` (`queued`) | 402 `insufficient_credits`; 409 `ai_budget_exhausted` (block mode), `invalid_import_state`, `source_not_ready`; 429 `daily_limit_reached`, `too_many_active_imports`, `rate_limited` |
| A6 | `POST /api/imports/{import}/cancel` (`api.imports.cancel`) | `{}` | 200 | 409 |
| A7 | `GET /api/imports/{import}/review` (`api.imports.review`) | — | 200 `{ document: PlanDocument, reviewVersion: int, meta: ImportResultMeta, backgroundUrl: string, backgroundPreviewUrl: string }` | 409 unless `ready_for_review` |
| A8 | `PUT /api/imports/{import}/review-document` (`api.imports.review-document`) | `{ document: PlanDocument, baseVersion: int, review: ReviewState }` | 200 `{ version, savedAt }` | 409 `version_conflict` (03 §5 shape), 422 `invalid_document`, 409 state |
| A9 | `POST /api/imports/{import}/accept` (`api.imports.accept`) | `{ target: { kind: 'new', name: string ≤80, levelIndex: int -5..50 } \| { kind: 'replace', planId: ulid }, keepBackground: bool, document: PlanDocument, baseVersion: int }` | 200 `{ planId, redirectUrl }` | 422 `invalid_document` (+ `issues`), `scale_not_confirmed`; 409 `version_conflict`/state; 403 (replace target not in project) |
| A10 | `POST /api/imports/{import}/discard` (`api.imports.discard`) | `{}` | 200 | 409 |
| A11 | `POST /api/imports/{import}/rerun` (`api.imports.rerun`) | `{ useAi: bool }` | 201 `ImportStatusData` of the **new** import (status `queued`) | same as A5 |
| A12 | `POST /api/imports/{import}/convert-to-trace` (`api.imports.convert-to-trace`) | `{}` | 201 `ImportStatusData` of the new trace import (status `uploaded`) | 409 |

Inertia pages: `GET /projects/{project}/imports/new` (`customer.projects.imports.create`, props `{ project, plans: [{id,name}], credits: CreditSummaryData, limits, features }`), `GET /imports/{import}` (`customer.imports.show`, props `{ import: ImportStatusData, credits }`), `GET /imports/{import}/review` (`customer.imports.review`, props A7 + `{ project, plans, user units }`; redirects to show page unless `ready_for_review`).

Policy `BlueprintImportPolicy` (13 §8.4, normative): `view`/`viewDebug` — uploader or project owner, or staff with `customers.view`; `update`/`cancel`/`retry`/`accept`/`convertToTrace` — uploader or project owner, or `plans.edit_any`; `discard` — uploader/owner or `ai.manage`; `rerun` — uploader/owner (charged) or `ai.manage` (free when `ai.staff_unlimited`); `refund` — `ai.manage`; `create` — own project and (trace mode or verified contact), or `plans.edit_any`. Staff acting on a customer's import: `user_id` remains the uploader.

### 4.4 Creating an import from an upload

The file itself is uploaded with the shared upload-intent mechanism (13 §11; purpose `blueprint_source`, target = the project; limits and extension rules from §2.1 enforced at presign; magic bytes incl. DWG detection checked by `ProcessUpload`; the processed object keeps the original bytes). There is no import-specific presign or confirm endpoint.

`CreateBlueprintImport::handle(Project $project, User $user, CreateImportData $data): BlueprintImport` (A1, inside `DB::transaction`):
1. Authorise `BlueprintImportPolicy::create` (mode-dependent, 13 §8.4).
2. Load the upload intent `$data->uploadId` with `lockForUpdate`; it must belong to `$user`, have purpose `blueprint_source`, target = `$project`, status `ready`, `consumed_at` null — else 422 `upload_invalid`.
3. Insert the row: `status uploaded`, `mode`, `original_filename` = intent `original_filename` (already sanitised, 13 §11.4), `file_size_bytes` = intent `declared_size`, `mime_type` = intent `sniffed_mime`, `plan_id` = `planId` if given and belongs to the project (else 422 validation error), `hints = {}`, `selected_page = 1`.
4. `$import->addMediaFromDisk($intent->processed_key, 's3')->usingFileName('source.'.$ext)->toMediaCollection('source')` (moves the object); intent → `consumed`, `consumed_at = now()`.
5. After commit: dispatch `PrepareImportPreview` on queue `imports`; broadcast stage `checking_file`.

### 4.5 Job `PrepareImportPreview` (queue `imports`, timeout 60 s, tries 2, backoff 15 s)

1. Read the first 1024 bytes of the source media (`Storage::disk('s3')->readStream($path)` then `fread(…, 1024)`), sniff per §2.1. DWG → `MarkImportFailed(dwg_not_supported)`. Unknown → `unsupported_type`. Set `mime_type` (sniffed canonical: `image/jpeg`, `image/png`, `image/webp`, `image/heic`, `application/pdf`, `image/vnd.dxf`).
2. Call `VisionClient::inspect(sourceUrl, filename, mimeType)` (§5.4; temporary GET URL 15 min). Map vision errors to import errors (§14).
3. Store `source_kind`, `page_count` (PDF only; else null). Store each returned thumbnail and the preview as media in collection `pages` (file names `page-{n}.webp`, `preview.jpg`; custom property `page` = n, `kind` = `thumb|preview`, `width`, `height`). Store `photo` suggestions in `result_meta = {inspect: {isLikelyPhoto, suggestedCorners, dxf?}}` (overwritten later by recognition meta; the `inspect` key is preserved by `CompleteImportRecognition`).
4. If `hints.isPhoto` unset and `isLikelyPhoto` → set `hints.isPhoto = true`.
5. Broadcast `ImportStatusChanged(stage: awaiting_options)`.

### 4.6 Action `StartBlueprintRecognition`

`handle(BlueprintImport $import, User $actor): BlueprintImport` inside `DB::transaction`:
1. Guard status `uploaded` or (`failed` with retryable code); `source_kind` not null else 409 `source_not_ready`.
2. Count actor's active imports (`whereIn status [queued, preprocessing, recognizing]`) ≥ `max_active_per_user` → 429.
3. Mode `trace`: status `queued`, `ai_provider = null`, no credits. Go to 6.
4. Mode `auto`: `$plan = ResolveRecognitionPlan::handle($actor, $import, preview: false, forceBasic: $data->basic)` where `$data` is the validated A5 body (18 §8) → returns `RecognitionPlanData {provider, model, effort, agenticCrops, credits, chargeable, budgetFallback, reason}` or throws `AiQuotaException` (402/409/429 per 18 §14).
5. `ReserveCredits::handle($import->user, $plan->credits, $import)` when `$plan->chargeable && credits > 0` (18 §9.2). Set `credits_reserved`, `ai_provider`, `ai_model` (snapshot), `error_code = null`, `error_message = null`, `result_document = null`, status `queued`. Increment the daily counter (18 §11.1).
6. After commit: dispatch `RunBlueprintRecognition($import->id, $plan)` on queue `imports`; broadcast stage `queued`.

### 4.7 Job `RunBlueprintRecognition`

```php
final class RunBlueprintRecognition implements ShouldQueue, ShouldBeUnique
{
    public string $queue = 'imports';
    public int $timeout = 660;
    public int $maxExceptions = 2;
    public bool $failOnTimeout = true;
    public function __construct(public string $importId, public ?RecognitionPlanData $plan) {}
    public function uniqueId(): string { return $this->importId; }
    public function retryUntil(): \DateTimeInterface { return now()->addMinutes(25); }
    public function backoff(): array { return [30]; }
    public function handle(VisionClient $vision): void;
    public function failed(\Throwable $e): void; // MarkImportFailed(vision_unavailable|vision_timeout|internal_error) unless already terminal
}
```

`retryUntil` (25 min < 30 min stale threshold) replaces `tries` so that busy releases do not count as failures; `maxExceptions = 2` caps real failures (01 §7 "tries 2").

`handle` steps:
1. Load import `lockForUpdate`; if status is not `queued`/`preprocessing`/`recognizing` → return (idempotent: cancelled or already done).
2. Status `preprocessing`, `started_at` (first attempt only), `attempts + 1`; broadcast `preparing`.
3. Build presigned URLs: source GET (15 min); normalized PUT key `tmp/imports/{id}/normalized.png` (`ContentType image/png`, 15 min); for auto mode and `config('imports.vision.debug_outputs')` = 8 debug PUT keys `tmp/imports/{id}/debug/{0..7}` (content type `application/octet-stream`; vision sends `image/png` or `application/json` bodies; the stored content type is set when attaching from the artifact list).
4. Trace mode: `VisionClient::normalize(...)` (§5.6) → attach normalized media → build the empty trace document (§12.1) → `result_document`, `result_meta` (with `pageImage`, `scale.method = default_guess` unless vector-PDF scale note found) → status `ready_for_review`, `finished_at` → broadcast `ready`, dispatch `ImportReadyForReview`. Return.
5. Auto mode: status `recognizing`, broadcast `analyzing`. `VisionClient::recognize($payload)` (§5.5) with HTTP timeout 600 s.
6. On `VisionBusyException` (HTTP 503 `busy`): status back to `queued`, `$this->release($retryAfter ?? 20)`. Return.
7. On vision error response: if `retryable` and `$this->attempts() < 2` → rethrow (job retry after 30 s); else `MarkImportFailed($code)` (refund per 18 §9.4) and return. Usage contained in the error body (`usage`, if any LLM calls happened) is recorded via `RecordUsage` with `status failed`.
8. On success: broadcast `finalizing`; `CompleteImportRecognition::handle($import, $result, $plan)`.

### 4.8 Action `CompleteImportRecognition`

1. Attach `tmp/imports/{id}/normalized.png` to media `normalized` (moves object). Attach each debug artifact listed in `result.debugArtifacts` (by `index`) to media `debug` with its `name` and `contentType`; delete unused debug keys.
2. Set `document.background.mediaUuid` = normalized media `uuid`, `document.background.importId` = import id.
3. Run `EngineCli::run('validate-plan', ['document' => $doc])`. Error issues → treat as `vision_bad_response` (MarkImportFailed with refund) and log the issues in `error_message`. Warnings: append to `meta.warnings` as `{code: 'plan_validation_warning', params: {issue: code}, entityIds}`.
4. In one transaction: `result_document` = `migratedDocument`, `result_meta` = response meta + preserved `inspect` key + `review: {reviewedIds: [], scaleConfirmed: false, unitConfirmed: false, rescaleFactor: 1}`, `review_version = 1`, `ai_provider` = `meta.providerUsed`, `ai_model` = `meta.model`, status `ready_for_review`, `finished_at = now()`; `RecordUsage` (18 §13); `CommitCredits::handle($import, $creditsUsed)` with `$creditsUsed = CreditPricing::creditsFor(meta.providerUsed, $import->user)` (18 §9.3: when the provider actually used is cheaper than reserved — fallback to `none` — only the lower amount is consumed).
5. After commit: broadcast `ready`; dispatch `ImportReadyForReview` (notification `import.ready_for_review`, 12 §3.3).

### 4.9 `MarkImportFailed::handle(BlueprintImport $import, ImportErrorCode $code, ?string $internalMessage = null)`

Sets status `failed`, `error_code`, `error_message` (internal text ≤ 2000 chars; never shown to customers), `finished_at`; calls `RefundCredits::releaseReservation($import)` (18 §9.4; no-op if nothing is reserved) and, when the import had been started in auto mode (previous status `queued`/`preprocessing`/`recognizing`) and the code's "counts toward daily limit" column (§14) is "no", gives the run back to the daily counter (18 §11.1); broadcasts `failed` with `{code, messageKey, retryable}`; dispatches `ImportFailed` (notification `import.failed`).

### 4.10 `imports:cleanup-stale` (hourly; extends 01 §7)

1. `queued`/`preprocessing`/`recognizing` with `updated_at < now − 30 min` → `MarkImportFailed(stale_timeout)`.
2. `uploaded` older than 7 days → `cancelled`.
3. `ready_for_review` older than 60 days → `discarded` (no refund).
4. Delete leftover vision exchange objects `tmp/imports/{id}/*` of imports in a terminal status.
5. `discarded`/`cancelled`/`failed` with `updated_at` older than 30 days → delete media `source`, `normalized`, `debug`, `pages` **unless** any plan's `working_document.background.importId` or any plan revision references this import id (query `plans.working_document->'background'->>'importId'` and `plan_revisions.document->'background'->>'importId'`).

### 4.11 `VisionClient` (`App\Support\Vision\VisionClient`)

```php
final class VisionClient
{
    public function capabilities(bool $fresh = false): VisionCapabilitiesData; // GET /v1/capabilities, cached 300 s in Redis key vision:capabilities
    public function health(): bool;                                            // GET /healthz, 3 s timeout
    public function inspect(string $sourceUrl, string $filename, string $mimeType): array;
    public function normalize(array $payload): array;
    public function recognize(array $payload): array;
    public function testProvider(string $provider, ?string $model): array;   // 18 §5.3
}
```

All calls: `Http::baseUrl(config('imports.vision.url'))->withToken(config('imports.vision.token'))->withHeaders(['X-Request-Id' => $importIdOrUlid])->acceptJson()->connectTimeout(5)->timeout($t)`. Non-2xx responses are parsed as `VisionErrorResponse {code, message, retryable, details, usage?}` and thrown as `VisionException`; 503 with `code = busy` → `VisionBusyException(retryAfter: (int) header Retry-After)`. Connection errors → `VisionException(code: vision_unavailable, retryable: true)`; timeouts → `vision_timeout`, retryable `false` (a 600 s timeout means the service deadline was broken; do not double-spend).

---

## 5. Vision service: layout, configuration, HTTP API

### 5.1 Repository layout (`vision/`)

```
vision/
├─ pyproject.toml            project "furny-vision", python ">=3.12,<3.13", deps per 01 §1.3, uv-managed, uv.lock committed
├─ nixpacks.toml             start: uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 2 --timeout-keep-alive 650
├─ app/
│  ├─ main.py                create_app(): FastAPI, routers, middleware (request id, auth, JSON logging), lifespan (warm OCR model)
│  ├─ config.py              Settings(BaseSettings) — all env vars (table in 18 §4)
│  ├─ logging.py             JSON formatter, redaction filter
│  ├─ api/
│  │  ├─ deps.py             require_token(), heavy_slot(), light_slot()
│  │  ├─ errors.py           VisionError(code, http_status, retryable, details), exception handlers
│  │  ├─ health.py  capabilities.py  inspect.py  normalize.py  recognize.py  providers.py
│  ├─ schemas/
│  │  ├─ plan.py             pydantic mirror of 03 PlanDocument (field names camelCase via alias_generator=to_camel, populate_by_name)
│  │  ├─ meta.py             ImportResultMeta (§6)
│  │  ├─ api.py              request/response models for every endpoint (§5.4–5.7)
│  │  ├─ candidates.py       TextToken, Segment, WallCandidate, OpeningCandidate, RoomFace, DimensionSpan, CandidateSet
│  │  └─ labeling.py         LabelingResult and DXF LayerMapping (§9.4, §10.4)
│  ├─ pipeline/
│  │  ├─ context.py          PipelineContext (deadline, timings, warnings, debug sink)
│  │  ├─ runner.py           run_recognition(), run_normalize(), run_inspect()
│  │  ├─ fetch.py  decode.py  pdf.py  rectify.py  normalize.py  binarize.py  region.py
│  │  ├─ ocr_stage.py  textparse.py  segments.py  walls.py  graph.py  dimensions.py
│  │  ├─ rooms.py  openings.py  scale.py  assemble.py  validate.py  debug.py  annotate.py
│  │  ├─ labeling/ base.py  heuristic.py  llm.py  agent.py  prompts.py  tools.py  vendor.py
│  │  └─ dxf/ reader.py  layers.py  walls.py  render.py
│  ├─ providers/             (18 §6) base.py  registry.py  anthropic_provider.py  openai_provider.py
│  │                          openai_compatible_provider.py  none_provider.py  errors.py
│  ├─ ocr/ engine.py  tiling.py
│  └─ utils/ images.py  geometry.py  ids.py  http.py  json_schema.py  timing.py  roomnames.py
├─ scripts/evaluate.py
└─ tests/ (§16)
```

### 5.2 Process model, concurrency, memory

- `uvicorn --workers 2`. Each worker process holds one `heavy` slot (`asyncio.Semaphore(1)`) used by `/v1/recognize` and `/v1/normalize`, and a `light` slot (`asyncio.Semaphore(2)`) for `/v1/inspect`.
- Acquiring the heavy slot waits at most 2 s; otherwise respond **503** `{error: {code: 'busy', retryable: true}}` with header `Retry-After: 20`. Rationale: Horizon has 2 `imports` workers; a third concurrent call should queue in Laravel, not in uvicorn.
- Heavy work runs in a worker thread (`await anyio.to_thread.run_sync(fn)`), so `/healthz` stays responsive.
- `cv2.setNumThreads(2)`; onnxruntime `intra_op_num_threads = 2`; `OMP_NUM_THREADS=2` env.
- Memory budget: container limit 3.5 GB (17 §4.2); each run ≤ 1.5 GB by construction (≤ 40 MP working image, OCR in 1280 px tiles). After each heavy request call `gc.collect()`.
- Every request carries a deadline: `/v1/recognize` 570 s from receipt (`VISION_RECOGNIZE_DEADLINE_S`), `/v1/normalize` 100 s, `/v1/inspect` 25 s. Stages check `ctx.remaining()`; exceeding a stage budget raises `VisionError('deadline_exceeded', 504, retryable=False)` except in labeling, which degrades (§9.6).

### 5.3 Authentication, logging

- Every endpoint except `/healthz` requires `Authorization: Bearer {VISION_SERVICE_TOKEN}` (constant-time compare, `hmac.compare_digest`); missing/invalid → 401 `unauthorized`.
- JSON logs to stdout: `{ts, level, msg, requestId, stage?, durationMs?, provider?, model?, ...}`. `requestId` = `X-Request-Id` header (Laravel sends the import id). A logging filter redacts query strings of URLs (`X-Amz-*`) and any value of env keys ending in `_API_KEY`/`_TOKEN`. LLM prompts/responses are not logged (debug artifacts carry them for staff).

### 5.4 `POST /v1/inspect`

Request:
```json
{ "source": { "url": "https://…", "filename": "plan.pdf", "mimeType": "application/pdf" } }
```
Response 200:
```json
{
  "sourceKind": "pdf_vector",
  "pageCount": 3,
  "pages": [ { "index": 1, "widthPt": 841.9, "heightPt": 595.3, "isVector": true, "thumbnail": { "contentType": "image/webp", "base64": "…", "width": 320, "height": 226 } } ],
  "preview": { "contentType": "image/jpeg", "base64": "…", "width": 1600, "height": 1131, "page": 1 },
  "photo": { "isLikelyPhoto": false, "suggestedCorners": null },
  "dxf": null,
  "warnings": [ { "code": "low_resolution", "params": { "longEdge": 540 } } ]
}
```
Rules:
- `pages` present for PDFs (all pages, ≤ 20 — 21+ → error `pdf_too_many_pages`); for raster/HEIC/DXF one entry with `widthPt/heightPt = null`.
- Thumbnails 320 px long edge WebP quality 70; preview 1600 px long edge JPEG quality 82 (PDF: page 1 at the same render path as §7.2; DXF: §10.5 render).
- `photo` only for raster/HEIC: `isLikelyPhoto` = EXIF `Make` or `Model` present **or** `detect_page_quad` (§7.3) finds a quad that is not axis-aligned (any corner > 1.5 % of the image diagonal away from the image corner). `suggestedCorners` = that quad normalized to 0..1 of the preview frame (TL, TR, BR, BL), else null.
- `dxf`: `{ "insunits": 4, "layerCount": 23, "entityCount": 4120 }`.
- `sourceKind` for PDF: `pdf_vector` if page 1 has ≥ 200 vector objects (`len(page.lines) + len(page.rects) + len(page.curves)` in pdfplumber), else `pdf_raster`. (Recomputed per selected page during recognition.)

### 5.5 `POST /v1/recognize`

Request (`RecognizeRequest`):
```json
{
  "requestId": "01JB…",
  "source": { "url": "https://…", "filename": "plan.pdf", "mimeType": "application/pdf", "sourceKind": "pdf_vector" },
  "output": { "normalizedPutUrl": "https://…", "debugPutUrls": ["https://…", "…"] },
  "options": {
    "provider": "anthropic", "model": "claude-opus-5-5", "effort": "high", "agenticCrops": true,
    "fallbackToNoneOnError": true,
    "selectedPage": 1,
    "hints": { "unitSystem": null, "knownDimension": null, "wallHeightMm": null, "isPhoto": false, "corners": null },
    "defaults": { "wallHeightMm": 2700, "exteriorWallThicknessMm": 230, "interiorWallThicknessMm": 115,
                  "doorWidthMm": 900, "doorHeightMm": 2100, "windowWidthMm": 1200, "windowHeightMm": 1200, "windowSillMm": 900 },
    "locale": "en",
    "debug": true
  }
}
```
- `provider` ∈ `anthropic|openai|openai_compatible|none`; `model` may be `null` (provider default from env, 18 §4); `effort` ∈ `low|medium|high`.
- `defaults` come from the `units` settings group (02 §13).
- `debug: false` → no debug artifacts written (used by tests).

Response 200 (`RecognizeResponse`):
```json
{
  "document": { "…": "PlanDocument (03 §1) with background.mediaUuid = \"\"" },
  "meta": { "…": "ImportResultMeta (§6)" },
  "usage": {
    "provider": "anthropic", "model": "claude-opus-5-5",
    "calls": [ { "purpose": "labeling", "model": "claude-opus-5-5", "inputTokens": 21034, "outputTokens": 3120,
                 "cacheReadInputTokens": 0, "cacheCreationInputTokens": 0, "images": 2, "durationMs": 38122,
                 "stopReason": "end_turn", "status": "succeeded" } ],
    "totals": { "requests": 4, "inputTokens": 61200, "outputTokens": 8200, "images": 7, "durationMs": 97012 },
    "status": "succeeded"
  },
  "debugArtifacts": [ { "index": 0, "name": "01-normalized-ink.png", "contentType": "image/png" } ]
}
```
`usage.status` = `failed` when an LLM call failed and the run fell back to `none` (18 §13). `usage.calls[].purpose` ∈ `labeling|agent_turn|finalize|repair|dxf_layers`.

Errors: JSON `{"error": {"code": string, "message": string, "retryable": bool, "details": object, "usage": Usage | null}}` with HTTP status per §14.2.

### 5.6 `POST /v1/normalize` (trace mode)

Request: `{ requestId, source, output: { normalizedPutUrl }, options: { selectedPage, hints: { isPhoto, corners } } }`.
Response 200: `{ "pageImage": PageImage (§6), "scaleNote": { "mmPerPixel": 10.58, "text": "SCALE 1:100" } | null, "warnings": [...] }`. Runs stages §7.1–§7.5 only, plus for `pdf_vector` the scale-note search (§8.4 method `scale_note`).

### 5.7 `GET /healthz`, `GET /v1/capabilities`, `POST /v1/providers/test`

- `/healthz` (no auth): `200 {"status":"ok","version":"<service version>","ocrLoaded":true}`; `503` until the OCR model is loaded at startup.
- `/v1/capabilities` and `/v1/providers/test`: defined in 18 §5.

### 5.8 `POST /v1/images/normalize` (photo normalisation for uploads)

Used by Laravel's `ProcessUpload` for HEIC photos (13 §11.3); bearer auth; runs in the `light` slot; deadline 60 s.

Request: `{ sourceUrl: string (presigned GET), targetUrl: string (presigned PUT), format: 'jpeg' | 'png' | 'webp', quality: int 1..100, maxEdge: int 64..8192, applyOrientation: bool }`.

Behaviour: fetch (cap 25 MB) → decode with Pillow (+ `pi-heif` opener) → apply EXIF orientation when `applyOrientation` → drop all metadata (EXIF, XMP, ICC, comments) → downscale so the longer edge ≤ `maxEdge` (LANCZOS) → encode → PUT to `targetUrl` (`Content-Type` matching `format`; 3 attempts, 1/2/4 s backoff).

Response 200: `{ width: int, height: int, bytes: int }`. Errors (`{error: {code, message, retryable}}`): 422 `decode_failed`, 413 `too_large` (> 25 MB or > 120 MP), 415 `unsupported`, 502 `upload_failed` (retryable).

---

## 6. `ImportResultMeta` (stored in `blueprint_imports.result_meta`)

Normative TypeScript (Laravel stores it verbatim; frontend type in `resources/js/types/imports.ts`; pydantic mirror `vision/app/schemas/meta.py`):

```ts
type ProviderName = 'anthropic' | 'openai' | 'openai_compatible' | 'none';
type ScaleMethod = 'dimension_chain' | 'room_label' | 'scale_note' | 'dxf_units' | 'user_hint' | 'default_guess';
type StageKey = 'fetch' | 'decode' | 'normalize' | 'preprocess' | 'ocr' | 'segments' | 'walls' | 'dimensions'
  | 'rooms' | 'openings' | 'labeling' | 'scale' | 'assemble' | 'validate' | 'upload' | 'dxf';

interface ImportResultMeta {
  metaVersion: 1;
  serviceVersion: string;               // vision package version, e.g. "1.0.0"
  pipelineVersion: string;              // bump on any output-affecting change, e.g. "1.0.0"
  sourceKind: 'raster' | 'pdf_vector' | 'pdf_raster' | 'dxf' | 'heic';
  providerRequested: ProviderName;
  providerUsed: ProviderName;           // 'none' after a fallback
  model: string | null;                 // model actually used (null for none)
  fallbackReason: null | 'llm_error' | 'llm_refused' | 'llm_timeout' | 'llm_invalid_output'
    | 'provider_not_configured' | 'vision_unsupported' | 'provider_auth_failed';
  drawingKind: 'architectural_line_drawing' | 'colored_brochure' | 'hand_sketch' | 'photo_of_drawing' | 'cad_vector' | 'not_a_floor_plan' | 'unknown';
  pageImage: {
    width: number; height: number;     // normalized PNG pixel size (the background image)
    sourcePage: number;                // 1-based
    dpi: number | null;                // PDFs: render DPI
    rectified: boolean;                // perspective-warped from a photo
    deskewDeg: number;                 // rotation applied (deg, clockwise positive), 0 if none
    resampleFactor: number;            // normalized px / source px (after rectification)
  };
  planRegion: { x: number; y: number; w: number; h: number };   // px in pageImage frame
  scale: {
    mmPerPixel: number;
    method: ScaleMethod;
    residualPct: number | null;        // weighted RMS relative residual in %, null for default_guess/dxf_units
    samples: number;                   // inlier sample count
    rejected: number;                  // outlier count
    confidence: number;                // 0..1 (§8.3)
    anisotropyCorrected: boolean;      // image was resampled along y (§8.2 step 7)
    roomLabelCheck: { rooms: number; medianDiscrepancyPct: number | null };
    usedSamples: Array<{ text: string; valueMm: number; a: Point; b: Point; inlier: boolean; kind: 'chain_segment' | 'overall' | 'room_width' | 'room_depth' }>; // ≤ 60, a/b in mm (document frame)
  };
  detectedUnitSystem: 'metric' | 'imperial' | 'unknown';
  confidence: {
    walls: Record<string, number>;     // wall id → 0..1
    openings: Record<string, number>;
    rooms: Record<string, number>;     // RoomMeta id → 0..1
    overall: number;
  };
  reasons: Record<string, ReasonCode[]>;   // entity id → why confidence is reduced (shown in the attention list)
  warnings: Array<{ code: WarningCode; params: Record<string, string | number>; entityIds: string[] }>;
  timings: Partial<Record<StageKey, number>> & { totalMs: number };  // ms
  ocrTokens: {
    count: number; meanConfidence: number;
    metricDimensionTokens: number; imperialTokens: number; roomNameTokens: number; areaTokens: number;
    sample: string[];                  // ≤ 20 recognised strings, longest first
  };
  counts: { walls: number; openings: number; rooms: number; texts: number; candidatesWalls: number };
  // Added by Laravel:
  inspect?: { isLikelyPhoto: boolean; suggestedCorners: [number, number][] | null; dxf?: { insunits: number; layerCount: number; entityCount: number } | null };
  review?: ReviewState;
}

interface ReviewState { reviewedIds: string[]; scaleConfirmed: boolean; unitConfirmed: boolean; rescaleFactor: number }

type ReasonCode = 'thin_evidence' | 'single_line_wall' | 'unconnected' | 'off_axis' | 'llm_unsure' | 'llm_disagrees'
  | 'no_name' | 'name_guessed' | 'size_mismatch' | 'gap_only' | 'type_guessed' | 'small_area' | 'open_face';
```

Warning codes (each has translation key `imports.warning.{code}`; `params` listed):

| Code | Params | Meaning |
|---|---|---|
| `low_resolution` | longEdge | Source long edge < 1000 px; upscaled |
| `image_downscaled` | megapixels | Source > 40 MP; downscaled |
| `photo_rectified` | — | Perspective correction applied |
| `page_corners_not_found` | — | Photo without a detectable sheet; used as-is |
| `deskewed` | degrees | Rotation applied |
| `scale_guessed` | assumedLongEdgeMm | No usable scale evidence (§8.2) |
| `scale_from_room_labels` | rooms | Scale from room-size labels only |
| `scale_room_label_mismatch` | discrepancyPct | Room labels disagree with chosen scale by > 10 % |
| `scale_anisotropy_corrected` | ratioPct | Different x/y scale corrected |
| `scale_high_residual` | residualPct | Residual > 3 % |
| `unit_system_guessed` | — | Unit system not evident |
| `known_dimension_unmatched` | label | User's known measurement couldn't be located |
| `room_names_merged` | names | Several names in one closed area; extras kept as text labels |
| `rooms_without_names` | count | Closed areas without a name |
| `walls_unconnected` | count | Walls with a free end |
| `openings_dropped_overlap` | count | Overlapping openings removed |
| `entities_outside_unit_removed` | walls, rooms | Neighbouring units/corridors removed |
| `llm_failed_fallback_none` | reason | AI step failed; basic recognition used |
| `llm_partial` | — | AI step hit its time budget; partial labels used |
| `llm_output_repaired` | — | AI output needed a repair round |
| `too_many_candidates_truncated` | kind, kept, total | Candidate list truncated for the AI |
| `plan_region_ambiguous` | components | Several drawing clusters; largest used |
| `not_a_floor_plan_suspected` | — | AI or heuristics doubt this is a floor plan |
| `dxf_units_guessed` | assumed | `$INSUNITS` missing |
| `dxf_layers_guessed` | — | Wall layers chosen heuristically with low certainty |
| `plan_validation_warning` | issue | Engine warning (Laravel-added) |

---

## 7. Pipeline stages 1–5: fetch, decode, normalize

Stage functions take and return typed objects; `PipelineContext` carries `deadline`, `timings: dict[str, int]`, `warnings: list[MetaWarning]`, `debug: DebugSink` (collects named PNG/JSON artifacts, max 8 written: §13).

`pipeline/runner.py`:
```python
def run_recognition(req: RecognizeRequest, ctx: PipelineContext, provider: LLMProvider | None) -> RecognizeResponse
def run_normalize(req: NormalizeRequest, ctx: PipelineContext) -> NormalizeResponse
def run_inspect(req: InspectRequest, ctx: PipelineContext) -> InspectResponse
```
`run_recognition` order: fetch → decode → (DXF branch §10 | raster branch) normalize → preprocess → OCR → segments → dimension lines (§8.4 step 1) → walls → dimension spans → openings → rooms → labeling → scale → assemble → validate → upload. Each stage is wrapped in `with ctx.stage("name"):` recording elapsed ms.

### 7.1 Fetch (`fetch.py`)

`fetch_source(url: str, max_bytes: int, timeout_s: float = 30) -> bytes` — `httpx.stream("GET", url, timeout=timeout_s)`; abort with `file_too_large` once `max_bytes` (26 214 400; DXF 15 728 640) is exceeded; non-200 → `source_unavailable` (retryable).

### 7.2 Decode (`decode.py`, `pdf.py`)

- `sniff_kind(data: bytes, filename: str) -> SourceKind` — same rules as §2.1.
- Raster: `PIL.Image.open(BytesIO)`, `ImageOps.exif_transpose`, convert to RGB (alpha composited on white), → numpy BGR uint8.
- HEIC: `pi_heif.register_heif_opener()` at import time, then as raster (decode only).
- PDF raster: `pdfium.PdfDocument(data)`; page = `doc[selected_page-1]`; `dpi = min(300, 6000 / max(w_in, h_in))`, `dpi = max(dpi, 72)`; `page.render(scale=dpi/72).to_numpy()`. Password error → `pdf_encrypted`. Page index out of range → `invalid_page`.
- PDF vector extraction (`extract_vector_page(data, page_index, dpi) -> VectorPage`) with pdfplumber: `page.lines`, `page.rects`, `page.curves` (each converted to segments; rect → 4 edges, and if `fill` true with non-stroking colour luminance < 0.35 → a filled polygon), `page.extract_words(keep_blank_chars=False, use_text_flow=False, extra_attrs=["size"])` and characters' `upright` flag for rotation. Coordinates: `x_px = x_pt × dpi/72`, `y_px = top_pt × dpi/72` (pdfplumber `top` is already from the top edge). Line width → `widthPx = linewidth × dpi/72`.
- Decoded pixel guard: > 120 MP → `image_too_large`; > 40 MP → `cv2.resize(INTER_AREA)` to 40 MP + warning; short edge < 300 → `image_too_small`.

### 7.3 Photo rectification (`rectify.py`)

Applied when `hints.corners` given (always wins), or `hints.isPhoto` true, or inspect's `isLikelyPhoto` criteria hold.

`detect_page_quad(img) -> np.ndarray | None` (4×2 float32 TL, TR, BR, BL in `img` px):
1. Downscale to long edge 1000 px (factor `f`).
2. Gray → `cv2.GaussianBlur(5×5, 0)`.
3. `v = median(gray)`; `cv2.Canny(gray, max(0, 0.66v), min(255, 1.33v))`.
4. `cv2.dilate` 3×3, 1 iteration.
5. `cv2.findContours(RETR_LIST, CHAIN_APPROX_SIMPLE)`; sort by area desc; take top 5.
6. For each: `approx = cv2.approxPolyDP(c, 0.02 × cv2.arcLength(c, True), True)`; accept the first with 4 vertices, convex (`cv2.isContourConvex`), area ≥ 25 % of the downscaled image.
7. Order corners (TL = min x+y, BR = max x+y, TR = min y−x, BL = max y−x); divide by `f`.

`warp_quad(img, quad) -> np.ndarray`: `W = max(|TR−TL|, |BR−BL|)`, `H = max(|BL−TL|, |BR−TR|)` (rounded); `M = cv2.getPerspectiveTransform(quad, [[0,0],[W−1,0],[W−1,H−1],[0,H−1]])`; `cv2.warpPerspective(img, M, (W, H), flags=INTER_CUBIC, borderValue=(255,255,255))`. User corners are normalized to the preview frame; multiply by the decoded image size (the preview is a uniform downscale of the same EXIF-transposed image/page).

Photo with no quad and no user corners → proceed unrectified, warning `page_corners_not_found`.

Photos additionally get illumination flattening before binarization: `bg = cv2.morphologyEx(gray, MORPH_CLOSE, ellipse k)` with `k = odd(round(long_edge / 40))`; `gray = cv2.divide(gray, bg, scale=255)`.

### 7.4 Deskew

`estimate_skew_deg(gray) -> float`: LSD segments (§7.7) of length ≥ 3 % of the long edge; angles folded into (−45°, 45°]; length-weighted histogram with 0.1° bins in [−10°, 10°]; smooth with a 5-bin box filter; peak angle `a`. If `0.2° ≤ |a| ≤ 10°`, rotate by `−a` (`cv2.getRotationMatrix2D` about the centre, canvas expanded to fit, white border, INTER_CUBIC), warning `deskewed`. Skipped for `pdf_vector`.

### 7.5 Resample (`normalize.py`)

`normalize(img, *, is_photo, corners, ctx) -> NormalizedPage(image: np.ndarray, page_image: PageImage, transform: np.ndarray)`:
- Target long edge: if source long edge < 2000 → upscale to 2000 (INTER_CUBIC) + warning `low_resolution` when < 1000; if > 6000 → downscale to 6000 (INTER_AREA). Otherwise unchanged. Rationale: OCR and morphology parameters are stable at ≥ 2000 px; > 6000 px is wasteful.
- The final image is written as PNG (`cv2.imencode('.png', img, [IMWRITE_PNG_COMPRESSION, 6])`) and PUT to `normalizedPutUrl` (`Content-Type: image/png`) at the end of the run (§7 stage `upload`), **after** any anisotropy correction (§8.2 step 7). `transform` (3×3) maps source px → normalized px (kept for vector-PDF geometry and debugging).

### 7.6 Preprocess (`binarize.py`, `region.py`)

1. `gray` = `cv2.cvtColor(BGR2GRAY)`.
2. **Sauvola** binarization (implemented with `skimage.filters.threshold_sauvola`, window `w = odd(clamp(round(long_edge / 60), 15, 81))`, `k = 0.2`); `ink = (gray < T) ? 255 : 0` (uint8).
3. Colour analysis on `hsv = cv2.cvtColor(BGR2HSV)`: `colorfulness = mean(S)` over pixels with `V < 245`. `dark = (V < 90) & (S < 60)` (0–255 scale) → candidate solid-wall mask for brochures.
4. **Stroke width**: distance transform `dt = cv2.distanceTransform(ink, DIST_L2, 3)`; on the skeleton of `ink` (`skimage.morphology.skeletonize`), stroke width = `2 × dt`; `t_thin` = mode of the width histogram (bins of 0.5 px) over widths ≤ 6 px; default 2.0 if empty.
5. **Style classification** (`drawingKind` before LLM): `colored_brochure` if `colorfulness > 25` and `dark` covers ≥ 0.5 % of the image; `photo_of_drawing` if rectified/photo; `cad_vector` for `pdf_vector`; else `architectural_line_drawing`.
6. **Thick-ink mask** `thick`: `k = clamp(round(2.2 × t_thin) + 1, 3, 15)` (odd); `thick = cv2.morphologyEx(base, MORPH_OPEN, rect k×k)` where `base = ink` for line drawings, `base = dark ∪ (ink & thick-candidate)` for brochures (`dark` opened by the same kernel). Remove connected components with area < `(3k)²`.
7. **Plan region** `detect_plan_region(thick, ink) -> Rect`: close `thick` with a square kernel of `0.02 × long_edge` px; connected components; choose the component with the largest count of `thick` pixels; also include other components whose `thick`-pixel count ≥ 30 % of the largest and whose bbox is within `0.05 × long_edge` of the chosen bbox (warning `plan_region_ambiguous` if any other component ≥ 30 % was excluded). Region = union bbox expanded by 6 % of its long side (dimension chains live outside the walls), clipped to the image. Everything outside the region is ignored by all later stages (the brochure's key-plan inset is excluded here).

### 7.7 OCR (`ocr/engine.py`, `ocr/tiling.py`, `pipeline/ocr_stage.py`)

- Engine: `rapidocr` (ONNX runtime, PP-OCR mobile det/rec + direction classifier, Apache-2.0), one global instance per worker created in the FastAPI lifespan. Wrapper:
```python
class OcrEngine:
    def __init__(self, det_limit_side_len: int = 1280, use_cls: bool = True) -> None
    def read(self, img_bgr: np.ndarray) -> list[RawOcrBox]   # RawOcrBox(quad: 4×2 float, text: str, score: float)
```
  Implement `read` with the library's documented call (`engine(img)` returning boxes, texts, scores); if the installed version's API differs, adapt only this method. Detection parameters: no downscaling inside tiles (`limit_type = "max"`, `limit_side_len = 1280`), `box_thresh = 0.5`, `unclip_ratio = 1.6`, `text_score = 0.5`.
- Tiling: tiles 1280 × 1280 px with 160 px overlap over the plan region; boxes mapped back by tile offset; deduplicate boxes with IoU > 0.5 (keep higher score).
- **Two passes**: pass A on the image; pass B on the image rotated 90° clockwise (`cv2.ROTATE_90_CLOCKWISE`), boxes mapped back, `angle = 90`. Vertical dimension text (e.g. "3300" on HDB side chains) is read in pass B. Merge passes: IoU > 0.3 duplicates → keep the higher score; tie → pass A.
- `pdf_vector` with ≥ 10 words from pdfplumber: use pdfplumber words (score 1.0, `angle` 0/90 from `upright`) and skip OCR.
- Output `TextToken(id="T{n}", text, quad, box[x0,y0,x1,y1], angle: 0|90, score, height_px)` sorted top-to-bottom, left-to-right; ids assigned after sorting.
- Text mask: every token box dilated by 2 px is painted into `text_mask`; `ink_notext = ink & ~text_mask`.

### 7.8 Text parsing (`textparse.py`)

`parse_token(text: str) -> ParsedText(kind, value)` after normalization: uppercase; `’ ′ ‘ ´ \`` → `'`; `” ″ “` and `''` → `"`; `× X *` between digits → `x`; `O`→`0` and `l`/`I`→`1` only inside tokens that are otherwise numeric; collapse spaces.

| Kind | Regex (after normalization) | Value |
|---|---|---|
| `mm_number` | `^\d{2,5}$` and 50 ≤ n ≤ 60000 | int mm (only meaningful if metric) |
| `metric_length` | `^(\d+(?:\.\d+)?)\s*(MM|CM|M)$` | int mm |
| `feet_inch` | `^(\d{1,3})'\s*-?\s*(\d{1,2}(?:\.\d+)?)?\s*"?$` | int mm = round((ft×12 + in) × 25.4) |
| `size_pair` | `^(<feet_inch>)\s*x\s*(<feet_inch>)$` or metric equivalent `^(\d+(?:\.\d+)?)\s*(M|MM)?\s*x\s*(\d+(?:\.\d+)?)\s*(M|MM)?$` | `(aMm, bMm)` |
| `area` | `(\d+(?:\.\d+)?)\s*(SQ\.?\s*FT|SFT|SQFT|M2|M²|SQ\.?\s*M)` | mm² |
| `scale_note` | `SCALE\s*1\s*:\s*(\d{2,4})` or `^1\s*:\s*(\d{2,4})$` | N |
| `room_name` | fuzzy match against `utils/roomnames.py` (below) | `(name, RoomType)` |
| `opening_tag` | `^(D|W|V|SD|FD)\d{1,2}$` | tag |
| `other` | — | — |

Room-name dictionary (`ROOM_NAMES: dict[str, RoomType]`, matching on uppercase, punctuation stripped, Levenshtein ratio ≥ 0.8 per word, multiword phrases first). Keys (en, incl. Indian/Singapore usage):
`MASTER BEDROOM, MASTER BED, M.BED, MBR → master_bedroom`; `BEDROOM, BED ROOM, BED, BR, GUEST ROOM, KIDS ROOM, CHILDREN ROOM → bedroom`; `LIVING, LIVING ROOM, LIVING/DINING, HALL, DRAWING, DRAWING ROOM, LOUNGE, FAMILY → living`; `DINING, DINING ROOM → dining`; `KITCHEN, KIT, PANTRY → kitchen`; `TOILET, WC, W.C, BATH, BATHROOM, WASH, POWDER → toilet` (`BATH`/`BATHROOM` → `bathroom`); `BALCONY, BALC, SIT OUT, SITOUT, VERANDAH, VERANDA → balcony`; `UTILITY, WASH AREA, W/M, LAUNDRY, SERVICE YARD, YARD → utility`; `STORE, STORE ROOM, STORAGE, BOMB SHELTER, SHELTER, HOUSEHOLD SHELTER → store`; `STUDY, OFFICE, LIBRARY → study`; `POOJA, PUJA, PRAYER → pooja`; `FOYER, ENTRANCE, ENTRY, LOBBY → foyer`; `CORRIDOR, PASSAGE, LOBBY PASSAGE → corridor`; `DRESS, DRESSING, WALK-IN, WIC → dress`; `DECK, TERRACE, AC LEDGE, PLANTER → deck`; `OTS, OPEN TO SKY, SHAFT, DUCT → ots`; `GARAGE, PARKING, CAR PORCH → garage`. The TypeScript mirror for the review UI's type suggestion is `resources/js/engine/plan/roomNames.ts` (`suggestRoomType(name: string): RoomType`), generated from the same list (unit test asserts identical keys).

### 7.9 Line segments (`segments.py`)

`detect_segments(gray, ink_notext, region) -> list[Segment]`:
1. `lsd = cv2.createLineSegmentDetector(cv2.LSD_REFINE_STD)`; run on `gray` with text boxes painted white, cropped to the region. If LSD is unavailable in the installed OpenCV build, fall back to `cv2.HoughLinesP(ink_notext, rho=1, theta=π/360, threshold=50, minLineLength=0.02·L, maxLineGap=3)` where `L` = region long side.
2. Keep segments with length ≥ `max(8 px, 0.008 L)`.
3. **Merge collinear**: sort by angle; segments with angle difference ≤ 1.5°, perpendicular distance ≤ 2 px (≤ `0.5 × width` for thick strokes) and end gap ≤ 4 px are merged (union of projections onto the longer one's direction).
4. Attach `widthPx` = `2 × median(dt)` sampled at 9 evenly spaced points along the segment; `isThin = widthPx ≤ 1.8 × t_thin`.
5. `pdf_vector`: replace steps 1–2 with pdfplumber segments mapped to normalized px (`transform`), then step 3–4 (width from PDF linewidth).

Dominant orientation `θ0` (deg in [0, 90)): length-weighted histogram of segment angles mod 90° in 0.5° bins; peak. Used by walls (snap) and openings.

---

## 8. Pipeline stages 6–12: geometry, dimensions, scale

Pixel parameters below use `L` = plan-region long side in px and `t` = local wall thickness in px. Before the scale is known, all thresholds are relative; after §8.2 they are re-checked in mm (§8.6).

### 8.1 Walls (`walls.py`, `graph.py`)

`extract_walls(page, segments, thick, ink, style) -> WallCandidateSet`:

1. **Filled walls** `W_fill = thick` (§7.6). For `pdf_vector`, also rasterise dark filled polygons and stroked segments with `widthPx ≥ 2.5 × t_thin`.
2. **Dimension-line exclusion**: segments classified as dimension lines by §8.4 step 1 are removed from wall consideration.
3. **Double-line walls**: among thin segments of length ≥ `0.02 L`, find pairs with angle difference ≤ 2°, perpendicular distance `d ∈ [0.004 L, 0.03 L]`, overlap of projections ≥ 60 % of the shorter, and the strip between them is hollow (ink ratio < 15 %) or filled (> 85 %). Greedy matching: sort candidate pairs by `d` ascending then overlap descending; each segment used at most once per side. Each pair contributes the quadrilateral over the overlap interval, filled into `W_double`.
4. **Single-line walls** (sketches only, `drawingKind = hand_sketch` from labeling is not known yet, so: if `W_fill ∪ W_double` covers < 0.2 % of the region): long thin segments (≥ `0.05 L`) are drawn with thickness `3 × t_thin` into `W_single`, `source = single_line`.
5. `W = W_fill ∪ W_double ∪ W_single`; close with 3×3 rect (1 iteration).
6. **Skeleton & polylines**: `S = skeletonize(W > 0)`; build a pixel graph (8-neighbourhood); nodes = pixels of degree ≠ 2; trace edges; drop spurs shorter than `1.5 × local thickness`; simplify each edge polyline with `cv2.approxPolyDP(ε = max(1.5, 0.25 × median thickness))` → straight segments. Thickness per segment = `2 × median(dt_W)` along it (`dt_W` = distance transform of `W`).
7. **Orientation snap**: segments within 3° of `θ0 + k·90°` are rotated about their midpoint onto that direction; other segments ≥ `0.03 L` are kept as diagonal walls; shorter off-axis segments dropped.
8. **Collinear merge across tiny gaps**: same snapped direction, perpendicular offset ≤ `0.5 t`, gap ≤ `1.5 t` → merge. Larger gaps `g ∈ [2.5 t, 18 t]` between collinear segments of similar thickness (ratio ≤ 1.5) are recorded as **gap candidates** for openings (§8.5).
9. **Graph building** (`graph.py`): `build_wall_graph(segments, r) -> WallGraph` with snap radius `r = max(1.0 × t_median, 0.006 L)`:
   - cluster endpoints within `r` (union-find); node position: for axis-aligned walls, x from the mean of vertical walls' x and y from horizontal walls' y (keeps right angles), else centroid;
   - extend a free endpoint along its direction up to `r + t` to hit another wall's centreline (L/T closure);
   - split a wall where another wall's endpoint lies on its centreline within `r` (T-junction), creating a shared node;
   - remove duplicate walls (same node pair) and walls shorter than `max(2 t, 0.01 L)` that do not connect two otherwise-unconnected parts.
10. Output `WallCandidate(id="W{n}", a, b (px), thickness_px, source: 'filled'|'double_line'|'single_line'|'vector', evidence: float 0..1, free_ends: int)`. `evidence` = 1.0 filled/vector, 0.85 double-line, 0.5 single-line.

### 8.2 Scale solve (`scale.py`)

`solve_scale(spans, labels, rooms, hints, page, ctx) -> ScaleResult` (runs **after** labeling so that LLM associations are available; with provider `none` the heuristic labeler supplies them):

1. Collect samples `(valueMm_i, spanPx_i, w_i, axis_i, kind_i)`:
   - every labeled dimension text associated with a dimension span (§8.4) → `kind chain_segment` (w = 1) or `overall` (w = 2);
   - every room with parsed width/depth (from `size_pair` or LLM `widthMm/depthMm`) and a closed face → two samples using the face's interior bbox along the snapped axes; orientation assignment: try (width ↔ x, depth ↔ y) and the swap, choose the one with smaller `|log((a/px_x)/(b/px_y))|`; kind `room_width`/`room_depth`, w = 0.5;
   - user `knownDimension` matched by the labeler to a wall or span → kind `overall`, w = 3.
2. Per-sample estimate `s_i = valueMm_i / spanPx_i` (mm per px).
3. Primary set = chain/overall/known samples if ≥ 2 exist (or 1 `overall` with LLM confidence ≥ 0.8); else room samples (method `room_label`).
4. Weighted median `m`; reject samples with `|s_i/m − 1| > 0.08`; recompute `m`; repeat once.
5. Weighted least squares through the origin over inliers: `k = Σ w v p / Σ w p²`. Residual `residualPct = 100 × sqrt(Σ w (v − k p)² / Σ w v²)`.
6. Chain consistency bonus: for each group of chain segments lying on one dimension line whose values sum to an `overall` value on a parallel line covering the same extent (±1 % in value and ±1 % in pixel span), count `consistentChains`. Real drawings often omit small segments (columns, wall thicknesses), so missing consistency is not penalised.
7. **Anisotropy**: if ≥ 3 inliers on each axis and `|k_x/k_y − 1| > 0.02` (fit separately), resample the normalized image along y by `k_y/k_x` (INTER_CUBIC) and multiply all candidate y coordinates by the same factor; `mmPerPixel = k_x`; warning `scale_anisotropy_corrected`. Only done for rectified photos and `pdf_raster`/`raster` (never `pdf_vector`).
8. Method fallbacks in order: `dimension_chain` (step 3 primary) → `room_label` → `scale_note` (vector/raster PDF with a `scale_note` token N and known render DPI: `mmPerPixel = N × 25.4 / dpi`; requires the PDF page size to be a standard paper size ±2 %, ISO A0–A4 or ANSI A–E) → `user_hint` (known dimension matched but < 2 other samples) → `default_guess`: `mmPerPixel = 12000 / max(planRegion.w, planRegion.h)` (assume a 12 m long plan), warning `scale_guessed`.
9. **Room-label cross-check** (when method ≠ `room_label` and room samples exist): `medianDiscrepancyPct` = median over rooms of `|room_sample_value / (k × spanPx) − 1| × 100`; > 10 → warning `scale_room_label_mismatch` and confidence × 0.7.

### 8.3 Scale confidence

| Method | Confidence |
|---|---|
| `dxf_units` | 1.0 |
| `dimension_chain` | `(1 − min(residualPct, 10)/10) × min(1, 0.5 + 0.125 × inliers) × (1 + 0.05 × min(consistentChains, 2))`, clamped to [0, 1] |
| `room_label` | same formula × 0.85 |
| `scale_note` | 0.6 |
| `user_hint` | 0.7 |
| `default_guess` | 0.1 |

`residualPct > 3` → warning `scale_high_residual`.

### 8.4 Dimension spans (`dimensions.py`)

`find_dimension_spans(segments, tokens, region) -> list[DimensionSpan]`:
1. **Dimension lines**: thin segments of length ≥ `0.04 L` that have ≥ 2 **ticks**: a tick is a thin segment of length `0.005 L … 0.03 L` crossing the line (intersection within the tick's middle 80 %) at 45° ± 15° or 90° ± 10°, **or** a perpendicular extension line touching the dimension line within 2 px, **or** a filled dot/arrowhead blob (area `≤ (0.006 L)²`) on the line. Lines with ≥ 2 ticks and ≥ 1 numeric token (`mm_number`, `metric_length`, `feet_inch`) within `2.5 × text height` perpendicular distance are dimension lines.
2. Ticks sorted along the line: consecutive tick pairs → `chain_segment` spans; first-to-last → `overall` span (only if ≥ 3 ticks; with 2 ticks the single span is both).
3. Each span gets `nearTextIds`: numeric tokens whose centre projects inside the span (between the ticks) and lies within `2.5 × text height` of the line, with matching orientation (token `angle 0` ↔ horizontal line, `90` ↔ vertical line within 10°).
4. Output `DimensionSpan(id="D{n}", p0, p1 (px), axis: 'x'|'y'|'other', kind, nearTextIds, lineId)`.
5. Heuristic association (used by provider `none`, and as the default the LLM may override): each numeric token is assigned to the span with the smallest `|centre projection − span midpoint|` among spans listing it, ties → shorter span.

### 8.5 Openings (`openings.py`)

`find_openings(graph, gaps, ink_thin, region) -> list[OpeningCandidate]` — candidates from the gap list of §8.1 step 8 plus wall-mask breaks where a wall run is interrupted by `[2.5 t, 18 t]` along a straight line between two collinear wall segments that were merged into one wall during graph building (the merged wall keeps an `openings_px` interval list).

For each gap (interval `[u0, u1]` along wall W with direction `d`, normal `n`, gap width `g = u1 − u0` px):
1. **Door arc test**: four hypotheses `(hinge ∈ {u0, u1}) × (side ∈ {+n, −n})`. For each, sample 24 points on the quarter circle centred at the hinge point with radius `g` spanning from the wall direction to the side normal; support = fraction of points with `ink_thin` within 2 px (search in a 5×5 window). Add 0.15 if a straight leaf line (thin segment of length `0.8 g … 1.1 g` from the hinge, perpendicular to the wall ± 10°) exists. Best support ≥ 0.55 → door with that hinge/side; `type = double_swing` if two arcs from both ends each with support ≥ 0.45 and radius ≈ `g/2`, else `single_swing`.
2. **Window test**: inside the strip of the gap (length `g`, width = wall thickness `t`), count thin segments parallel to the wall (± 3°) covering ≥ 80 % of `g`: ≥ 2 → window (`casement`; `sliding_window` if ≥ 3 lines with two of them overlapping by ≤ 60 % — i.e. offset sashes).
3. Otherwise → `opening` (passage) with `evidence gap_only`.
4. Output `OpeningCandidate(id="O{n}", wallId, u0, u1 (px along centreline from node a), kind: door|window|opening, type, hinge: 'start'|'end', swing: 'left'|'right', support: float)`. Swing side mapping: `side = +n` where `n` is the left normal of a→b (04 §2.1: left = +normal) → `swing = 'left'`.

### 8.6 Rooms (`rooms.py`)

`find_room_faces(W, openings, region) -> list[RoomFace]`:
1. `closed = W.copy()`; draw each opening gap as a line of the wall's thickness across the gap (door "closures") and any remaining wall end-to-end gap ≤ `18 t` between collinear walls.
2. `free = ~closed` within the plan region; connected components with 4-connectivity (`cv2.connectedComponentsWithStats`).
3. Discard components touching the region border (outside), components with area < `0.002 × region area`, and components whose bounding box aspect > 15 (slivers).
4. Polygon: `cv2.findContours` (outer contour) → `approxPolyDP(ε = 0.5 t_median)`.
5. Anchor: maximum of the distance transform inside the face (pole of inaccessibility) → strictly inside (03 `RoomMeta.anchor`).
6. `containsTextIds`: tokens whose centre is inside the face.
7. Output `RoomFace(id="R{n}", polygon_px, anchor_px, area_px, bbox, containsTextIds, open: bool)` (`open = true` when the face only closed thanks to step 1 gap closures longer than `6 t`; reason `open_face`).

After scale (§8.2): faces with area < 1.0 m² are dropped (closets/ducts remain if ≥ 1 m²), faces > 200 m² dropped (outside area misdetected); walls thinner than 50 mm or thicker than 600 mm are flagged `thin_evidence` and, if their evidence < 0.6, dropped; opening widths outside 300–6000 mm (03 range) dropped.

### 8.7 Assembly (`assemble.py`) and validation (`validate.py`)

Runs after labeling (§9) and scale (§8.2); consumes the candidates, `LabelingResult` and `ScaleResult`.

`assemble_document(page, candidates, labels, scale, options) -> tuple[PlanDocument, ConfidenceMap, list[MetaWarning]]`:

1. **Apply labels**: drop walls with verdict `not_wall`; drop openings `not_opening`; drop rooms `include=false` and then walls whose both sides face only excluded rooms or the outside **and** that are not adjacent to any included room (side test: sample a point `0.75 t` off each side at the midpoint and look up the face id map) → warning `entities_outside_unit_removed`.
2. `missedRooms` → if the point (÷ `s` + offset) lies in an existing included face without a name, name it; if it lies in a face that already has a name, add a merged-name label; otherwise ignore.
3. `missedOpenings` → search the named wall within ±`1.5 m / mmPerPixel` of the projected point for a gap candidate not yet used; if found, adopt it with the given kind (confidence 0.5); if none, insert an opening of default width (door `doorWidthMm`, window `windowWidthMm`) centred at the projection with confidence 0.35 and reason `type_guessed` (only if it fits within the wall per 03 bounds).
4. **Coordinates**: every px point `(x, y)` (normalized frame) → `(round(x × k), round(y × k))` mm with `k = mmPerPixel`. Nodes created from wall graph nodes (`n_` ids), walls (`w_`), openings (`o_`), rooms (`r_`), labels (`t_`). IDs: `utils/ids.py::new_id(prefix)` = prefix + `_` + 10 chars from `0123456789abcdefghijklmnopqrstuvwxyz` via `secrets.choice` (master §6.3).
5. **Walls**: thickness mm = `round5(thicknessPx × k)` clamped to 50..1000, then snapped to the nearest of `[75, 100, 110, 115, 150, 200, 230, 250, 300]` when within 12 mm; `height` = `hints.wallHeightMm ?? defaults.wallHeightMm`, kind `half` → 1000; `kind`: label kind, else exterior if on the outer boundary of the union of included faces, else `partition` if thickness ≤ 0.6 × median exterior thickness, else `interior`; `justification 'center'`; `material` = `'drywall'` if thickness ≤ 100 else `'brick'`; `colorHex null`.
6. **Openings**: `offset` = centre of `[u0, u1]` × k (along the centreline from node a), `width` = `round(g × k / 10) × 10`; doors: `height = defaults.doorHeightMm`, `sillHeight 0`, `type` label type or CV type, `width ≥ 1200 → double_swing` unless sliding; the opening on an exterior wall nearest to the largest `living`/`foyer` room → `main_entrance` if it is a door of width ≥ 900 and no other `main_entrance` exists; windows: `height = defaults.windowHeightMm`, `sillHeight = defaults.windowSillMm`, clamped so `sill + height ≤ wall.height`; `opening`: height = `defaults.doorHeightMm`, sill 0, type `'opening'`; `label` = associated `opening_tag` text within 2 text heights, else null.
7. **Rooms**: one `RoomMeta` per included face: `anchor` (mm), `name` (label name; else from room type's English default, e.g. "Bedroom", reason `name_guessed`; else `"Room"` reason `no_name`), `type` (label type; else `suggestRoomType(name)`; else `'other'`), `floorFinish 'tile'`, `floorColorHex null`, `labelOffset null`, `showArea true`. Extra names in the same face → `TextLabel` at the token centre (`fontSize 250`, rotation 0) + warning `room_names_merged`.
8. **Meta**: `schemaVersion 1`, `meta = {defaultWallHeight: wallHeight, defaultWallThickness: defaults.interiorWallThicknessMm, floorThickness: 150, northAngle: null, createdWith: 'import'}`; `placements {}`, `fixtures {}`, `annotations {dimensions: {}, labels: {…merged names}}`; `background = {importId: "", mediaUuid: "", pixelWidth: W, pixelHeight: H, mmPerPixel: k, position: {x: 0, y: 0}, rotation: 0, opacity: 0.5, visible: true, locked: true}`; `view = {mode2d: null, mode3d: null, lastMode: '2d'}`. Laravel fills `importId`/`mediaUuid` (§4.8).
9. **Confidence** (all clamped to [0, 1], rounded to 2 dp):
   - wall: `0.35 × evidence + 0.25 × align + 0.20 × conn + 0.20 × llm` where `align` = 1 if snapped to `θ0+k·90°` else 0.6 (diagonal ≥ 0.03 L), `conn` = 1 (both ends connected), 0.6 (one), 0.2 (none), `llm` = 1 (`wall`), 0.5 (`unsure`), 0.6 (heuristic). Reasons: `single_line_wall` (source single_line), `unconnected` (conn < 1), `off_axis`, `llm_unsure`, `thin_evidence`.
   - opening: door `0.3 + 0.6 × support`, window `0.35 + 0.5 × support`, opening `0.45` (reason `gap_only`); LLM confirms same kind +0.15, LLM different kind → use LLM kind, confidence 0.6, reason `llm_disagrees`; `unsure` −0.1; type defaulted → reason `type_guessed`.
   - room: `0.4 × closed + 0.3 × named + 0.3 × check` where `closed` = 1 (not open) / 0.5 (open, reason `open_face`), `named` = 1 / 0.5 (`name_guessed`) / 0 (`no_name`), `check` = 1 if the room's size label matches the face within 10 %, 0.4 if it mismatches (reason `size_mismatch`), 0.7 with no label (0.6 heuristic); area < 2 m² adds reason `small_area` and × 0.8.
   - overall: `0.4 × lengthWeightedMean(walls) + 0.2 × mean(rooms) + 0.1 × mean(openings) + 0.3 × scale.confidence` (empty sets count as 0.5).

`validate_and_repair(doc) -> tuple[PlanDocument, list[MetaWarning]]` enforces 03 §1.1 errors before returning: remove walls < 10 mm and duplicate node pairs; remove orphan nodes; clamp opening offsets into `[width/2, len − width/2]` (drop if the wall is shorter than the width + 100 mm); resolve overlapping openings on the same wall by dropping the lower-confidence one (warning `openings_dropped_overlap`); clamp numeric ranges; > 2000 walls or > 1000 openings → `VisionError('too_complex', 422)`; zero walls after assembly → `VisionError('no_walls_detected', 422)`; `labels.drawingKind = not_a_floor_plan` **and** < 4 walls → `VisionError('not_a_floor_plan', 422)` (with ≥ 4 walls only warning `not_a_floor_plan_suspected`). A pydantic model validation of the whole document runs last.

---

## 9. Labeling (LLM or heuristic)

### 9.1 Interface (`pipeline/labeling/base.py`)

```python
class Labeler(Protocol):
    def label(self, page: NormalizedPage, candidates: CandidateSet, hints: Hints, ctx: PipelineContext) -> LabelingOutcome

@dataclass
class LabelingOutcome:
    result: LabelingResult            # §9.4 (heuristic labeler fills the same structure)
    provider_used: ProviderName
    model: str | None
    fallback_reason: str | None
    calls: list[UsageCall]            # 18 §6.4
    partial: bool
```

`labeling/llm.py::LlmLabeler(provider: LLMProvider, options)` chooses **agentic** mode (`labeling/agent.py`) when `options.agenticCrops and provider.capabilities.supports_tools`, else **single-pass**. On any `ProviderError`, `ProviderRefusal`, timeout or invalid output after repair: if `fallbackToNoneOnError` → run `HeuristicLabeler` and set `fallback_reason` (warning `llm_failed_fallback_none`); else raise `VisionError('provider_error', 502, retryable=True)`. Provider `none` or `supports_vision = false` → `HeuristicLabeler` directly (`vision_unsupported` fallback reason in the latter case).

### 9.2 What the LLM sees (`annotate.py`)

- **Overview scale** `s = min(1, provider.max_image_px / max(W_norm, H_norm))` (Anthropic default 2576, 18 §3). All coordinates sent to/received from the model are in **overview px** (integers); conversion back = divide by `s`.
- Image 1 "clean": normalized image cropped to the plan region, resized by `s` (INTER_AREA). Overview coordinates are relative to this crop's top-left; the crop offset is added back on conversion.
- Image 2 "marked": the same, with overlays (drawn at overview resolution, anti-aliased, 2 px strokes, labels in 14 px bold sans with white halo): walls red (`#E53935`) centrelines + `W{n}` at midpoints; openings green (`#2E7D32`) gap bars + `O{n}`; room anchors purple (`#6A1B9A`) dots + `R{n}`; text boxes blue (`#1565C0`) rectangles + `T{n}` at the top-left; dimension spans orange (`#EF6C00`) lines with end ticks + `D{n}`. If label boxes collide, offset by up to 3 attempts of 12 px; still colliding → label omitted on the image (the JSON still has it).
- Providers with `max_images_per_request = 1` (18 §3) get only image 2.
- Candidate JSON (compact, no whitespace), **sorted by id**; truncation limits: texts 300, walls 400, openings 150, rooms 80, dimension spans 200 (keep longest/highest-score; warning `too_many_candidates_truncated`):

```json
{"image":{"width":2576,"height":1840},
 "texts":[{"id":"T1","text":"BEDROOM","box":[812,402,905,421],"angle":0,"score":0.97,"parsed":"room_name:bedroom"}],
 "dimensionSpans":[{"id":"D1","p0":[152,48],"p1":[296,48],"axis":"x","kind":"chain_segment","nearTextIds":["T2"]}],
 "walls":[{"id":"W1","p0":[150,182],"p1":[1121,182],"thicknessPx":6,"source":"filled","freeEnds":0}],
 "openings":[{"id":"O1","wallId":"W7","p0":[430,455],"p1":[512,455],"kind":"door","support":0.71}],
 "rooms":[{"id":"R1","anchor":[490,640],"bbox":[150,470,810,800],"areaPx":198000,"containsTextIds":["T14","T15"],"open":false}]}
```

### 9.3 Prompts (`labeling/prompts.py`; constants, provider-agnostic plain text)

**`SYSTEM_PROMPT_LABELING`** (verbatim):

```
You are an expert architectural draftsperson helping convert a floor-plan drawing into an editable plan.

A computer-vision pipeline has already measured the drawing and produced numbered CANDIDATES:
- walls (W…), openings in walls (O…), closed room regions (R…), text found by OCR (T…), and dimension spans (D…: the measured distance between two tick marks on a dimension line).
Your job is to LABEL and ASSOCIATE these candidates. You do not draw geometry. The pipeline's geometry is more precise than anything you can estimate, so never try to correct it with your own coordinates.

You receive:
1. The drawing (image "clean").
2. The same drawing with every candidate marked and labelled with its ID (image "marked"), when available.
3. A JSON list of all candidates with pixel coordinates. Coordinates are integers in the pixel space of these images: origin at the top-left corner, x to the right, y downwards.

Decide, using everything visible in the drawing:
- unitSystem: "metric" when dimensions are plain millimetre numbers (e.g. 3300, 11000) or metres; "imperial" when lengths are written in feet and inches (e.g. 10'0", 12'3"x7'11"); "unknown" if there are no dimensions.
- drawingKind: what this image is. Use "not_a_floor_plan" only if the image clearly is not a building floor plan.
- For every text candidate: its role.
  room_name = the name of a room or space; room_size = a room size label such as 10'0"x11'0" or 3.0 x 3.6; dimension = a number that measures a distance on a dimension line; area = a floor area (e.g. 912 SQ.FT); opening_tag = a door/window tag like D1 or W2; title = drawing titles, unit numbers, notes; other = anything else; ignore = OCR noise or text that belongs to a different drawing (e.g. a small key plan or location plan).
  Correct obvious OCR mistakes in normalizedText (e.g. "T0ILET" → "TOILET", "10'0\"X11'0\"" stays as written but uppercase).
- For every dimension text: which dimension span (D…) it measures, its value in millimetres (convert feet/inches: 1 ft = 304.8 mm, 1 in = 25.4 mm), and whether it is a chain segment or an overall dimension. If a number is not attached to any listed span, set spanId to null.
- For every room region (R…): whether it is a room of THIS dwelling (include=true) or outside it (corridors shared with other units, neighbouring flats, open-to-sky shafts that are not part of the unit, car parks, areas cut off at the drawing edge: include=false). Give its name exactly as written on the drawing (title case), its type, and its size label if one is written inside it.
- Rooms you can see but that have no R… candidate (e.g. a kitchen open to the living room): list them in missedRooms with an approximate point inside them.
- For every wall candidate (W…): "wall" if it is a real wall, "not_wall" if it is something else (furniture, a dimension or leader line, hatching, a counter, a bed, a text underline, a door leaf), "unsure" otherwise; and its kind: exterior (on the outer boundary of the dwelling), interior, partition (thin internal wall), or half (low wall, parapet, balcony railing).
- For every opening candidate (O…): door, window, opening (an empty passage), or not_opening, and its type.
- Doors or windows clearly drawn but not listed: missedOpenings, with the wall ID they sit in and an approximate centre point.
- If a "known measurement" hint is given, say which wall or dimension span it refers to.

Conventions you can rely on:
- Singapore/HDB and many metric drawings use chains of millimetre dimensions outside the walls; the overall dimension is on the outermost line and equals the sum of the chain below it.
- Indian brochure plans write each room's interior size inside the room as WIDTH x LENGTH in feet and inches (e.g. BEDROOM 10'0"x11'0"); the first number is usually the horizontal extent as drawn, but not always.
- Furniture symbols (beds, sofas, dining tables, WC pans, basins, kitchen counters, wardrobes) are not walls.
- A small inset drawing (key plan, location plan, north arrow, building block diagram) is not part of the floor plan: mark its texts "ignore".

Be precise and conservative: when in doubt use "unsure" or null rather than guessing.
Answer ONLY with the JSON object required by the output schema.
```

**`USER_PROMPT_LABELING_TEMPLATE`** (Python `str.format` placeholders):

```
Drawing size in this image: {width} x {height} pixels.
{images_line}
Hints from the customer:
- Unit system: {hint_unit_system}
- Known measurement: {hint_known_dimension}
- This is a photo of a paper drawing: {hint_is_photo}

Candidates (JSON):
{candidates_json}
{tools_block}
Return the labels as one JSON object that matches the output schema. Use only IDs that appear in the candidate list.
```

- `images_line` = `Image 1 is "clean", image 2 is "marked".` or `The image is "marked".`
- Hint values: `"metric (millimetres)"`, `"imperial (feet and inches)"`, `"not given"`; known measurement `"\"{label}\" = {mm} mm"` or `"not given"`; photo `"yes"`/`"no"`.
- `tools_block` (agentic mode only):

```
You can inspect details before answering:
- crop_image returns a zoomed crop of the drawing. Use it to read small or blurry text, to check whether a line is a wall or furniture, and to see door swings. Coordinates are in the pixel space of the full images above.
- list_candidates returns candidates of one kind, optionally only those inside a rectangle.
You may call at most {max_crops} crops. Prioritise: unreadable dimension numbers, rooms without a name, walls marked unsure, openings. When you are done, answer with the final JSON object only.
```

**`FINALIZE_PROMPT`** (sent as a user message when the agent's turn/time budget is exhausted, with `tool_choice = none`): `Stop using tools now. Using what you have seen so far, return the final JSON object that matches the output schema.`

**`REPAIR_PROMPT_TEMPLATE`** (providers without native JSON schema, 18 §7.3): `Your previous answer was not valid for the required schema. Errors:\n{errors}\nReturn ONLY the corrected JSON object, with no other text.`

**`JSON_SCHEMA_INSTRUCTION_TEMPLATE`** (appended to the system prompt only for providers with `supports_json_schema = false`): `Output format: a single JSON object, no markdown fences, no commentary, that validates against this JSON Schema:\n{schema_json}`

### 9.4 Output schema (`schemas/labeling.py`)

All fields are required; optionality is expressed with `| None` (keeps the schema valid for strict modes of every provider). The JSON Schema sent to providers is `to_strict_schema(LabelingResult)` (`utils/json_schema.py`): `model_json_schema(mode="serialization")`, `$defs` inlined (no `$ref`), every object gets `additionalProperties: false` and `required` = all properties, `title`/`description`/`default` keys removed, numeric `minimum`/`maximum` removed (ranges validated in pydantic after parsing).

```python
RoomTypeLit = Literal['living','dining','kitchen','bedroom','master_bedroom','bathroom','toilet','balcony',
  'utility','store','study','pooja','foyer','corridor','dress','deck','ots','garage','other']
DoorTypeLit = Literal['single_swing','double_swing','sliding','pocket','bifold','main_entrance']
WindowTypeLit = Literal['casement','sliding_window','fixed','french_window','bay','ventilator']

class TextLabel_(BaseModel):
    id: str
    role: Literal['room_name','room_size','dimension','area','opening_tag','title','other','ignore']
    normalizedText: str | None

class DimensionLabel(BaseModel):
    textId: str
    spanId: str | None
    valueMm: int | None
    kind: Literal['chain_segment','overall','room_interior','unknown']

class RoomLabel(BaseModel):
    id: str                       # R…
    include: bool
    name: str | None
    type: RoomTypeLit | None
    nameTextId: str | None
    sizeText: str | None          # as written, e.g. 10'0"x11'0"
    widthMm: int | None           # parsed size, first number
    depthMm: int | None           # second number

class MissedRoom(BaseModel):
    name: str
    type: RoomTypeLit
    x: int
    y: int

class WallLabel(BaseModel):
    id: str
    verdict: Literal['wall','not_wall','unsure']
    kind: Literal['exterior','interior','partition','half'] | None

class OpeningLabel(BaseModel):
    id: str
    verdict: Literal['door','window','opening','not_opening','unsure']
    doorType: DoorTypeLit | None
    windowType: WindowTypeLit | None

class MissedOpening(BaseModel):
    kind: Literal['door','window','opening']
    wallId: str
    x: int
    y: int

class KnownDimensionMatch(BaseModel):
    wallId: str | None
    spanId: str | None

class LabelingResult(BaseModel):
    unitSystem: Literal['metric','imperial','unknown']
    drawingKind: Literal['architectural_line_drawing','colored_brochure','hand_sketch','photo_of_drawing','cad_vector','not_a_floor_plan']
    texts: list[TextLabel_]
    dimensions: list[DimensionLabel]
    rooms: list[RoomLabel]
    missedRooms: list[MissedRoom]
    walls: list[WallLabel]
    openings: list[OpeningLabel]
    missedOpenings: list[MissedOpening]
    knownDimensionMatch: KnownDimensionMatch | None
    notes: str | None             # ≤ 500 chars, stored in debug only
```

Post-validation (`labeling/llm.py::sanitize(result, candidates)`): drop entries with unknown ids; clamp `valueMm` to 50..60000 else null; truncate `name` to 60 chars; dedupe by id (first wins); candidates the model did not mention get the heuristic label (so partial answers are usable). Count of dropped entries > 20 % of total → treat as `llm_invalid_output`.

### 9.5 Agentic tools (`labeling/tools.py`)

Tool definitions (provider-neutral `ToolSpec(name, description, input_schema)`, strict schemas):

```json
{"name":"crop_image",
 "description":"Return a zoomed crop of the floor-plan drawing. x, y, w, h are in the pixel space of the full overview images. scale is the magnification relative to the overview (1 to 4). Set annotated=true to draw the candidate IDs on the crop.",
 "input_schema":{"type":"object","properties":{
   "x":{"type":"integer"},"y":{"type":"integer"},"w":{"type":"integer"},"h":{"type":"integer"},
   "scale":{"type":"number"},"annotated":{"type":"boolean"}},
  "required":["x","y","w","h","scale","annotated"],"additionalProperties":false}}
```
```json
{"name":"list_candidates",
 "description":"List candidates of one kind as JSON, optionally only those whose position lies inside a rectangle given in overview pixels.",
 "input_schema":{"type":"object","properties":{
   "kind":{"type":"string","enum":["texts","walls","openings","rooms","dimensionSpans"]},
   "region":{"anyOf":[{"type":"null"},{"type":"object","properties":{"x":{"type":"integer"},"y":{"type":"integer"},"w":{"type":"integer"},"h":{"type":"integer"}},"required":["x","y","w","h"],"additionalProperties":false}]}},
  "required":["kind","region"],"additionalProperties":false}}
```

`crop_image` execution: clamp `scale` to [1, 4] and the rectangle to the overview; require `w, h ≥ 16`. Source rectangle in **normalized** px = overview rect / `s` + region offset. Output size = `(w × scale, h × scale)` but at most `min(provider.max_image_px, 2 × native crop size)` on the long edge (never more than 2× native upsampling; INTER_CUBIC up, INTER_AREA down). When `annotated`, draw marks as in §9.2 scaled to the crop. Return `ToolResult(content=[ImagePart(png), TextPart("Crop of overview region x={x}, y={y}, w={w}, h={h}. This image is {cw}x{ch} px; a point (u, v) in it corresponds to overview point (x + u*{w}/{cw}, y + v*{h}/{ch}).")])`. Invalid input → `ToolResult(is_error=True, text="…reason…")`.

`list_candidates`: same compact JSON as §9.2 filtered by kind and (when given) region containment of the candidate's reference point (text box centre, wall midpoint, opening midpoint, room anchor, span midpoint); max 200 items + `"truncated": true`.

### 9.6 Agent loop (`labeling/agent.py`, provider-agnostic)

```python
def run_agent(provider: LLMProvider, system: str, user_parts: list[Part], tools: list[ToolSpec],
              schema: type[BaseModel], effort: Effort, ctx: PipelineContext,
              max_turns: int, max_crops: int, call_timeout_s: float) -> tuple[LabelingResult, list[UsageCall], bool]
```
1. `conversation = [UserMessage(user_parts)]`. Budget: `llm_deadline = min(ctx.deadline − 60 s, now + VISION_LLM_STAGE_BUDGET_S (420))`.
2. Loop `turn = 1..max_turns (VISION_AGENT_MAX_TURNS = 10)`:
   a. If `now + 30 s > llm_deadline` or `turn == max_turns` → final turn: append `UserMessage([TextPart(FINALIZE_PROMPT)])` and call with `tool_choice="none"`.
   b. `turn_result = provider.complete(conversation, system=system, tools=tools, tool_choice="auto" | "none", output_schema=schema, effort=effort, timeout_s=min(call_timeout_s (180), llm_deadline − now))`.
   c. Append the assistant message **exactly as returned** (`turn_result.raw_assistant`, preserving provider-specific blocks such as thinking; append-only history).
   d. If `turn_result.tool_calls` is non-empty: execute each (crops beyond `max_crops` (8) return `is_error` "crop budget exhausted, answer now"); append **one** user message with all tool results (18 §7.1/7.2 adapter rules). Continue.
   e. Else parse `turn_result.text` as JSON → `schema.model_validate`. Success → return. Failure → if the provider supports JSON schema this is a provider fault (`llm_invalid_output`); otherwise one repair round (`REPAIR_PROMPT_TEMPLATE`), then fail.
3. If the deadline passes during a call (timeout) and at least one earlier assistant turn exists, run one finalize call with a 60 s timeout; failure → raise `ProviderTimeout`; caller falls back to heuristic labels with `partial = true`, warning `llm_partial` (if any partial labels exist they are not reused; the heuristic labeler runs).

Single-pass mode = one `provider.complete` with no tools (plus one repair round when needed).

### 9.7 Heuristic labeler (`labeling/heuristic.py`, provider `none`)

Fills `LabelingResult` deterministically:
- `unitSystem`: hint if given; else ≥ 3 `feet_inch`/`size_pair` tokens → imperial; ≥ 3 `mm_number` tokens associated with spans → metric; else unknown (warning `unit_system_guessed`; treated as metric).
- Texts: role from `parse_token` kind (`room_name`, `size_pair` → `room_size`, `mm_number`/`metric_length`/`feet_inch` with a span → `dimension`, `area`, `opening_tag`, `scale_note` → `title`, else `other`). Tokens outside the plan region → `ignore`.
- Dimensions: §8.4 step 5 association; `valueMm` from parsing (mm numbers only if metric).
- Rooms: name = highest-`height_px` `room_name` token inside the face (others → merged-name labels); size from a `size_pair` token inside the face or within 2 text heights below the name token; `include = true` for all faces except those whose only name maps to `corridor`/`ots` **and** that touch the plan-region boundary within `2 t`.
- `missedRooms`: `room_name` tokens not inside any face and not outside the region → entry at the token centre (assembly attaches them to the face containing that point if any, else ignored).
- Walls: all `wall`; kind from geometry (§8.7); thin single-line walls `unsure`.
- Openings: CV kind; `support < 0.4` → `unsure`.
- `knownDimensionMatch`: only when the label contains (case-insensitive) `overall`/`total` and `width`/`length`/`depth` → null ids (assembly uses the plan-region wall bbox width (x) for width / height (y) for length/depth); otherwise null and warning `known_dimension_unmatched`.

### 9.8 `RecognitionVendor` (phase 2, interface only)

`labeling/vendor.py`:
```python
class RecognitionVendor(Protocol):
    name: str
    def recognize(self, image_png: bytes, hints: Hints, timeout_s: float) -> VendorResult  # walls/openings/rooms in px + vendor confidence
```
No implementation, no configuration, no registry entry in v1. A future vendor result would replace §8.1/§8.5/§8.6 outputs (`CandidateSet`) and keep labeling/scale/assembly unchanged.

---

## 10. DXF pipeline (`pipeline/dxf/*`)

### 10.1 Reading (`reader.py`)

- `ezdxf.read(io.StringIO(text))` for ASCII (decode with the `$DWGCODEPAGE` fallback `cp1252`, errors `replace`), `ezdxf.readfile` via a temp file for binary DXF; on `DXFStructureError` retry with `ezdxf.recover.read(BytesIO)`; still failing → `corrupt_file`.
- Units: `$INSUNITS` → factor to mm: 1 in 25.4, 2 ft 304.8, 4 mm 1, 5 cm 10, 6 m 1000, 14 dm 100; 0/missing → guess from model-space extents `E` (max of width/height of wall-candidate entities): `E ≥ 2500` → mm; `250 ≤ E < 2500` → cm (or inches when `hints.unitSystem = imperial`); `E < 250` → m (or ft when imperial); warning `dxf_units_guessed`.
- Entities from model space: `LINE`, `LWPOLYLINE`, `POLYLINE` (2D; bulges approximated by arcs → kept as ARC records), `ARC`, `CIRCLE` (ignored except for door-swing heuristics), `INSERT` (exploded with `insert.virtual_entities()` recursively up to depth 4, keeping the INSERT's layer when the child is on layer `0`), `HATCH` (solid fill on wall layers → boundary polygons), `TEXT`/`MTEXT` (plain text via `plain_text()`), `DIMENSION` (ignored). Total > 200 000 → `dxf_too_complex`. Paper space ignored.

### 10.2 Layer roles (`layers.py`)

`classify_layers(stats) -> dict[layer, LayerRole]` with roles `wall|door|window|room_label|dimension|furniture|other`. Regex on lower-cased layer names (first match wins):

| Role | Pattern |
|---|---|
| dimension | `dim|anno|text-dim|cota|bemass` |
| wall | `wall|^a-wall|mur|wand|muro|partition|^a-.*-wall|brick|block|masonry|conc` |
| door | `door|^a-door|tuer|porte|puerta|^dr$|^d-` |
| window | `window|^a-glaz|glaz|win|fenster|fenetre|ventana|^w-` |
| room_label | `room|area|space|^a-area|name|iden` |
| furniture | `furn|fixt|equip|sanit|plumb|kitchen|^a-flor-fixt|^i-` |
| other | `hatch|grid|axis|title|border|defpoints|viewport|xref|^0$` |

Fallback when no layer is classified `wall` or the wall layers hold < 30 % of total LINE/LWPOLYLINE length: if the provider is available (`supports_json_schema` or prompt-JSON) and the global budget allows (Laravel passes `provider` as normal), call the **layer-mapping prompt** (text-only, single pass, effort `low`); else classify the layer with the largest total line length among layers with ≥ 20 % parallel-pair coverage as `wall` (warning `dxf_layers_guessed`).

### 10.3 Walls and openings from DXF (`walls.py`)

1. Wall-layer segments (LINE, polyline edges, HATCH boundary edges) in mm (after unit factor; y flipped: `y_mm = (maxY − y) × f + 500`, `x_mm = (x − minX) × f + 500`).
2. Parallel pairing: angle difference ≤ 1°, perpendicular distance 50–400 mm, projection overlap ≥ 50 % of the shorter → centreline over the overlap interval, thickness = distance rounded to 5 mm, snapped per §8.7 step 5.
3. Unpaired single lines ≥ 300 mm on wall layers → walls with `defaults.interiorWallThicknessMm` (reason `single_line_wall`).
4. Graph building with §8.1 step 9 using `r = max(thickness, 50 mm)`.
5. Gaps between collinear wall runs of 500–2500 mm → openings: door if an ARC on a door layer (or any layer) has its centre within 100 mm of a gap end and radius within ±15 % of the gap width (hinge = that end; swing side from the arc's midpoint side); window if a window-layer entity lies inside the gap strip; else door if an INSERT on a door layer covers the gap, window likewise; else `opening`.
6. Rooms: rasterise walls at 20 mm/px → §8.6 → polygons back to mm; names from TEXT/MTEXT on `room_label` layers or any text matching the room dictionary inside a face.
7. Confidence: walls 0.95 (paired) / 0.6 (single line); openings 0.9 (arc/insert) / 0.5 (gap only); rooms per §8.7 step 9.
8. Scale: `method = 'dxf_units'`, `mmPerPixel` = render scale (§10.5).

### 10.4 Layer-mapping prompt and schema

**`SYSTEM_PROMPT_DXF_LAYERS`** (verbatim):
```
You map CAD layer names of an architectural floor-plan DXF file to roles. Roles: wall, door, window, room_label (room names or areas), dimension, furniture (furniture, fixtures, sanitary, kitchen), other (grid, hatch, title block, anything else). Layer names may be in any language or use national CAD standards (e.g. AIA "A-WALL", "A-DOOR", "A-GLAZ"). Use the statistics: walls are usually long parallel line pairs 75–400 mm apart; doors usually contain arcs; room labels contain text. Answer only with the JSON object required by the output schema.
```
**User template**: `Units: {units}. Layers (name | entity counts by type | total line length in mm | share of lines in parallel pairs | up to 3 sample texts):\n{layer_table}`
**Schema** (`LayerMapping`): `{ "layers": [ { "name": str, "role": "wall"|"door"|"window"|"room_label"|"dimension"|"furniture"|"other" } ] }` (strict as §9.4). Unknown names ignored; missing layers keep the regex result.

### 10.5 DXF background render (`render.py`)

Render all entities of roles wall/door/window/room_label/furniture (black, 1 px lines; walls 2 px; texts skipped) onto white with `mmPerPixel = max(5, extentMm / 4000)` (long edge ≤ 4000 px + 1000 mm margin total): pixel = mm / mmPerPixel. PNG uploaded as the normalized image; `pageImage.dpi = null`. The document coordinates already include the 500 mm margin, so `background.position = (0, 0)`.

---

## 11. Review & correction UX (`customer.imports.review`)

### 11.1 Page and editor mode

`resources/js/pages/Customer/Imports/Review.vue` lazy-loads the plan editor (05) with `mode: 'import-review'` and a document store keyed `import:{importId}` (`usePlanEditorStore('import:' + id)`), autosave target A8 (protocol 03 §5 with `review_version` as the version; localStorage key `fs:draft:import:{id}`). All normal plan-editor tools are available (walls, openings, rooms naming, delete, move, undo/redo). Differences from normal editing:

- Top banner: "Review your imported plan" + 3-step indicator **1 Check scale · 2 Fix highlighted items · 3 Name rooms** and the primary **Accept plan** button (right) and **Discard** (secondary, in "…" menu with **Improve with AI** / **Start over in trace mode** when available).
- The background image (normalized PNG via signed URL; preview WebP while loading) is shown under the geometry at opacity 0.5; controls in the review panel: opacity slider 0–100 % (step 5), "Show blueprint" toggle, "Show draft" toggle (hides geometry to compare).
- 3D view available as usual (05); confidence colours apply in 2D only.

### 11.2 Confidence colouring

| Confidence | Wall stroke/fill | Opening symbol | Room label chip |
|---|---|---|---|
| ≥ 0.8 | normal plan tokens | normal | normal |
| 0.5 – < 0.8 | amber `--color-warning` fill at 60 % + amber outline | amber | amber dot |
| < 0.5 | red `--color-destructive` fill at 60 %, dashed outline | red | red dot |

- Entity confidence comes from `meta.confidence`; ids in `review.reviewedIds` and entities created/edited during review render normal (editing = any command touching the entity id marks it reviewed via a command-bus listener).
- Toggle "Highlight uncertain items" (default on) in the review panel. Colour is never the only signal: amber/red items also show a small warning glyph at the entity midpoint (WCAG 1.4.1).

### 11.3 Review panel (right side, 320 px; bottom sheet on tablets < 1024 px)

Tabs: **Scale**, **Attention (n)**, **Rooms**.

**Attention (n)** — "Needs your attention (n)": items = entities with confidence < 0.8 not yet reviewed, plus synthetic items: "Check the scale" (when `scale.confidence < 0.8` and not `scaleConfirmed`), "Unit system" (when `detectedUnitSystem` ≠ user `unit_system` and not `unitConfirmed`), engine validation warnings (`plan.walls_intersect` etc., recomputed live by the editor). Sorted: synthetic first, then red, then amber, then by entity type (walls, openings, rooms). Each row: icon, title (e.g. "Wall · 3.20 m", "Door · 0.90 m", "Room · Bedroom"), reason text from `imports.reason.{code}` (first reason), buttons **Show** (pans/zooms to fit the entity with 30 % padding and selects it), **Looks right** (adds id to `reviewedIds`), **Delete** (walls/openings). Count `n` in the tab label and in the step indicator; when `n = 0`: "All clear — nothing needs your attention."

**Scale** — shows:
- Method sentence (`imports.scale.method.{method}` with params), e.g. "Scale read from 14 dimension labels (accuracy ±0.8 %)", "Scale estimated from room sizes (6 rooms)", "Scale taken from the CAD file", "We couldn't find any measurements — please check the scale".
- Current scale "1 px = {mmPerPixel:.2f} mm" and overall plan size (bbox) formatted in user units.
- "Measurements we used" collapsible list (from `scale.usedSamples`, ≤ 60; outliers struck through); hovering a row highlights its two points.
- **Check a dimension** tool (button; also shortcut `K` in review mode): (1) prompt "Click a wall, or click two points" — clicking a wall selects its centreline length (or the face length when the user holds `Alt`); clicking empty space starts a two-point measure with a 4× loupe; (2) popover shows "Currently {len}" and input "Actual length" (`parseLength`, any unit, master §6.1); (3) live text "This will scale the whole plan by +3.2 %"; (4) **Apply** runs engine command `rescalePlan` (04 §6.6) with `factor = actual / current` (allowed range 0.2–5; outside → inline error "That's a very large change — please check the value"), sets `scaleConfirmed = true`, `rescaleFactor *= factor`. Undoable.
- Button **The scale looks right** → `scaleConfirmed = true`.
- When `scale.method = default_guess` or `scale.confidence < 0.5`: the panel opens by default, shows an amber callout, and **Accept** is disabled with tooltip "Check the scale first" until `scaleConfirmed`. The client flushes a pending autosave (A8) before calling A9; the server enforces the rule from the stored `result_meta.review.scaleConfirmed` (A9 → 422 `scale_not_confirmed`).

**Rooms** — list of derived rooms (from `derivePlanGeometry`): name input (inline, 60 chars), type select (auto-suggested from name via `suggestRoomType` until the user picks a type manually), area (formatted), "Show". Rooms without `RoomMeta` (faces created by edits) appear as "Unnamed area" with an **Add name** button (creates `RoomMeta` at the face's pole of inaccessibility via the standard editor command). Rooms named "Room" (`no_name`) are listed first.

**Unit confirmation** — a dismissible banner above the canvas when `detectedUnitSystem` ∈ {metric, imperial} differs from the user's `unit_system`: "This drawing uses feet & inches. Show lengths in feet & inches?" → **Switch to feet & inches** (calls the existing user-preferences endpoint, 10/14) / **Keep metric**; either sets `unitConfirmed = true`. Not blocking.

### 11.4 Autosave of review state

`PUT /api/imports/{import}/review-document` body `{document, baseVersion, review: ReviewState}`; server (`SaveImportReviewDocument`): status must be `ready_for_review`; size ≤ 2 MB; engine `validate-plan` (errors → 422); `UPDATE blueprint_imports SET result_document = ?, result_meta = jsonb_set(result_meta, '{review}', ?), review_version = review_version + 1 WHERE id = ? AND review_version = ?` → 0 rows → 409 `version_conflict` (03 §5 shape with `savedBy` = import user). Client behaviour identical to 03 §5.

### 11.5 Accept (`AcceptImportIntoPlan`)

Dialog "Save as plan":
- Target radio: **Create a new plan** (name input, default `"{floor name}"`: "Ground floor" for the first plan, else "Floor {n}"; level select default = max level + 1) or **Replace an existing plan** (select of the project's plans; default = `blueprint_imports.plan_id` when set at upload; warning text "The plan's current version is saved in its history, so you can restore it."). Mode trace: same dialog titled "Start tracing".
- Checkbox **Keep the blueprint as a background** (default checked).
- Button **Accept plan**.

Server (A9), `DB::transaction`:
1. Guard status `ready_for_review`, policy, `baseVersion == review_version` (else 409), scale rule (§11.3).
2. Engine `validate-plan` on the submitted document (errors → 422 `invalid_document` with `issues`; the editor lists them in the Attention tab).
3. If `keepBackground = false` → `document.background = null`. Else ensure `background.importId/mediaUuid` are this import's; set `background.locked = true`, `opacity = 0.5`.
4. New plan: `CreatePlan` action with `source = imported` (`traced` for trace mode), `working_document = document`, `name`, `level_index`. Replace: lock plan row; create `before_restore` revision of its current working document; set `working_document = document`, `working_version + 1`, `working_saved_by = actor`, `working_saved_at = now`, `source = imported|traced`, update `summary` from the engine result.
5. Create plan revision `reason = import_accepted`, label `"Imported from {original_filename}"` (truncated to 120), `author_id = actor`; set `plans.current_revision_id`.
6. Import: `status accepted`, `plan_id`, `result_document` = submitted document.
7. Activity log `imports.accepted` with `{importId, planId, target, providerUsed}`; after commit: event `ImportAccepted`, response `{planId, redirectUrl: route('customer.plans.edit', plan)}` (staff: admin route).
8. Thumbnail: the editor generates it on first open (05).

### 11.6 Discard (`DiscardImport`)

Confirm dialog: "Discard this import? You can't undo this. Credits used for this analysis are not refunded." → status `discarded`; redirect to the project page. Staff may refund separately (18 §9.5).

### 11.7 Improve with AI / Re-run (`RerunBlueprintImport`)

Shown when `meta.providerUsed = none` and the `cost` preview (A3 for a hypothetical run via `ResolveRecognitionPlan` in "preview" mode) resolves to an AI provider. Confirm dialog: "Run AI recognition on the same drawing? This uses {n} credit(s). Your current corrections will be discarded." → A11 `{useAi: true}`: creates a new import (same project, `plan_id`, mode `auto`, hints, selected page), **copies** the `source` media (`$media->copy($new, 'source')`) and `pages` media, sets `source_kind`, `page_count`, status `uploaded`, then runs `StartBlueprintRecognition` (credits charged again unless staff, 18 §9); old import → `discarded`. Staff "Re-run" from admin uses the same action (free for staff with `ai.staff_unlimited`).

---

## 12. Trace mode

### 12.1 Trace document

After `/v1/normalize`, Laravel builds the draft: empty `nodes/walls/openings/rooms/placements/fixtures`, `annotations {dimensions: {}, labels: {}}`, `meta.createdWith = 'trace'`, `meta.defaultWallHeight = hints.wallHeightMm ?? units.default_wall_height_mm`, `meta.defaultWallThickness = units.default_interior_wall_thickness_mm`, `floorThickness 150`, `background = {importId, mediaUuid, pixelWidth, pixelHeight, mmPerPixel: scaleNote?.mmPerPixel ?? 12000 / max(pixelWidth, pixelHeight), position {0,0}, rotation 0, opacity 0.5, visible true, locked false}`. `result_meta` = `{metaVersion: 1, sourceKind, pageImage, scale: {method: scaleNote ? 'scale_note' : 'default_guess', …}, warnings}` (other ImportResultMeta fields with empty values).

### 12.2 Calibration UI (review page, trace variant)

Full-canvas background, panel steps:
1. **Set the scale** (required): "Click two points whose distance you know (for example both ends of a dimension line)". Placing a point shows a 4× loupe (160 px circle) following the pointer; points are draggable after placement; on touch, points are placed with a long-press and adjusted with drag. Input "Distance between the points" (`parseLength`). Live readout "1 px = {x} mm". **Apply** → engine command `calibrateBackground { space: 'image', a, b, distanceMm }` (04 §6.6): `mmPerPixel = distanceMm / |AB|px` (A, B in image px); `background.position` stays (0,0). Sets `scaleConfirmed`.
2. **Straighten (optional)**: rotation slider −10°…+10° step 0.1°, or "Draw along a wall" (two points → rotation = −angle mod 90 to the nearest axis). Updates `background.rotation` (about the image centre — 05 renders it; plan coordinates are unaffected because the plan is empty).
3. Opacity slider (0–100 %, default 50).
4. **Continue to editor** → accept dialog (§11.5, trace wording) → plan editor opens with `background.locked = true`, wall tool active, background panel open.

No snapping to image edges in v1 (decision I10); standard editor snapping (grid, angle, existing geometry) applies while tracing. "Calibrate scale" and opacity remain available later from the editor's background panel (05) using the same command.

---

## 13. Debug artifacts (staff only)

Written when `options.debug = true`, in this order, max 8 (PUT to `debugPutUrls[i]` with the given content type; names are returned in `debugArtifacts`):

| i | Name | Content |
|---|---|---|
| 0 | `01-ink.png` | binarized ink mask with the plan region rectangle |
| 1 | `02-walls.png` | wall mask (filled red, double-line blue, single-line green) + skeleton |
| 2 | `03-candidates.png` | the "marked" overview image sent to the LLM (§9.2) |
| 3 | `04-result.png` | final document rendered over the normalized image (walls coloured by confidence) |
| 4 | `05-ocr.json` | OCR tokens with parsed kinds |
| 5 | `06-candidates.json` | candidate JSON (§9.2) |
| 6 | `07-labeling.json` | `LabelingResult`, `notes`, per-call usage, agent transcript summary (tool calls with args; no images) |
| 7 | `08-scale.json` | all scale samples, inliers, method, residual |

Admin import detail page (`admin.imports.show`, 11) shows source, normalized image, these artifacts (images in a lightbox, JSON in a collapsible viewer), meta, usage events, ledger entries, and actions **Re-run (free)**, **Refund credits** (18 §9.5).

---

## 14. Error codes

### 14.1 Import `error_code` values (enum `ImportErrorCode`)

| Code | Raised by | Retryable ("Try again") | Credits | Counts toward daily limit | Customer message key `imports.error.{code}` (en) |
|---|---|---|---|---|---|
| `file_too_large` | upload presign/confirm (as upload rejection) / vision | no | none | no | "This file is too large (max {max} MB)." |
| `unsupported_type` | upload presign/processing (as upload rejection) / prepare | no | none | no | §2.1 text |
| `dwg_not_supported` | upload presign/processing (as upload rejection) / prepare | no | none | no | §2.1 text |
| `corrupt_file` | prepare/vision | no | refund | no | "We couldn't open this file. It may be damaged — try exporting it again." |
| `pdf_encrypted` | prepare | no | none | no | §2.1 text |
| `pdf_too_many_pages` | prepare | no | none | no | "This PDF has more than 20 pages. Please upload only the floor-plan page(s)." |
| `invalid_page` | vision | no | refund | no | "That page doesn't exist in this PDF." |
| `image_too_small` | vision | no | refund | no | "This image is too small to read. Please upload a larger or clearer image (at least 300 px)." |
| `image_too_large` | vision | no | refund | no | "This image is too large (over 120 megapixels)." |
| `dxf_too_complex` | vision | no | refund | no | "This DXF file is too complex. Please export only the floor plan." |
| `not_a_floor_plan` | vision | no | refund | no | "This doesn't look like a floor plan. You can still trace it yourself." |
| `no_walls_detected` | vision | no | refund | no | "We couldn't find any walls in this drawing. Try a clearer image or trace it yourself." |
| `too_complex` | vision | no | refund | no | "This drawing has too many elements for one plan. Please upload one floor at a time." |
| `source_unavailable` | vision fetch | yes | refund | no | "Something went wrong on our side. Please try again." |
| `vision_unavailable` | Laravel (connect error / 5xx after retries) | yes | refund | no | same as above |
| `vision_busy` | Laravel (busy past `retryUntil`) | yes | refund | no | "Our analyzer is very busy right now. Please try again in a few minutes." |
| `vision_timeout` | Laravel (HTTP 600 s) | yes | refund | no | "The analysis took too long. Please try again, or trace the drawing yourself." |
| `deadline_exceeded` | vision | yes | refund | no | same as `vision_timeout` |
| `vision_bad_response` | Laravel (schema/engine validation) | yes | refund | no | "Something went wrong on our side. Please try again." |
| `provider_error` | vision (LLM failed, fallback disabled) | yes | refund | no | "The AI service is temporarily unavailable. Please try again later." |
| `stale_timeout` | `imports:cleanup-stale` | yes | refund | no | "The analysis was interrupted. Please try again." |
| `internal_error` | anywhere (unexpected exception) | yes | refund | no | "Something went wrong on our side. Please try again." |

"Refund" = release of the outstanding reservation (18 §9.4). Errors that occur before `start` never involve credits.

Errors **not** stored on the import (returned by A5/A11 only): `insufficient_credits` (402), `daily_limit_reached` (429), `too_many_active_imports` (429), `ai_budget_exhausted` (409, block mode), `rate_limited` (429), `source_not_ready` (409), `invalid_import_state` (409) — messages in 18 §14.

### 14.2 Vision HTTP status mapping

| HTTP | Codes |
|---|---|
| 400 | `invalid_request` (pydantic validation), `invalid_page`, `provider_not_configured` |
| 401 | `unauthorized` |
| 413 | `file_too_large`, `image_too_large` |
| 415 | `unsupported_type`, `dwg_not_supported` |
| 422 | `corrupt_file`, `pdf_encrypted`, `pdf_too_many_pages`, `image_too_small`, `dxf_too_complex`, `not_a_floor_plan`, `no_walls_detected`, `too_complex` |
| 502 | `source_unavailable` (retryable), `provider_error` (retryable), `upload_failed` (PUT to S3 failed after 3 attempts with 1/2/4 s backoff; retryable; Laravel maps to `vision_unavailable`) |
| 503 | `busy` (retryable, `Retry-After`) |
| 504 | `deadline_exceeded` |
| 500 | `internal_error` (retryable) |

Laravel maps `provider_not_configured` (should not happen because Laravel checks capabilities first, 18 §8) to `provider_error`.

---

## 15. Real-time and notifications

- `ImportStatusChanged` (broadcast on private `imports.{importId}`, `broadcastAs` `ImportStatusChanged`): `{importId, status, stage, progress: null, error: {code, messageKey, retryable} | null, at}`. Dispatched by every Action that changes status and by the job at stage changes (`preparing`, `analyzing`, `finalizing`).
- Client composable `useImportChannel(importId, onChange)` in `resources/js/composables/useImportChannel.ts`; falls back to polling A3 every 5 s while `echo.connector.pusher.connection.state !== 'connected'` and status is non-terminal.
- Notifications (12 §3.3, normative for channels and defaults): `import.ready_for_review` (in-app locked, email default off, web push default on; params `fileName`) and `import.failed` (in-app locked, email default on, web push default on; params `fileName`, `errorReason`). Domain events `ImportReadyForReview` / `ImportFailed` implement `UserNotifiableEvent` with payload `{importId, errorCode?}` (12 §3.4).

---

## 16. Testing

### 16.1 Python (`vision/tests`, pytest; CI runs `uv run pytest -m "not live"`)

| File | Covers |
|---|---|
| `test_api.py` | auth (401), busy (503 + Retry-After when the heavy slot is held), healthz, request validation, error JSON shape |
| `test_decode.py` | sniffing table §2.1 (byte fixtures incl. DWG header, HEIC ftyp variants), EXIF transpose, PDF render DPI rule, encrypted PDF → `pdf_encrypted` |
| `test_rectify.py` | synthetic photo: a drawing warped by a known homography on a grey background → corners within 1.5 % of the diagonal; warp restores right angles ±1° |
| `test_textparse.py` | every regex row in §7.8 incl. OCR confusions (`10'0"X11'0"`, `12’3”x7’11”`, `T0ILET`, `3300`, `912 SQ.FT`, `SCALE 1:100`) |
| `test_segments_walls.py` | synthetic renders: rectangles of filled walls, double-line walls, T/L junctions, a door gap with arc → exact wall count, node merging, gap detection, door hinge/swing |
| `test_scale.py` | samples with 2 outliers → `k` within 0.5 %; anisotropy correction; room-label orientation assignment; fallbacks order; confidence formula |
| `test_labeling_heuristic.py` | heuristic labeler on fixture candidate sets |
| `test_agent.py` | `FakeProvider` replaying scripted turns: crop tool calls executed, crop budget, finalize on deadline, repair round, refusal → fallback, invalid ids sanitised |
| `test_dxf.py` | generated DXF (ezdxf in-test): two-line walls, door arcs on `A-DOOR`, windows on `A-GLAZ`, `$INSUNITS` 4/1/0 → correct mm, layer regex, LLM layer-mapping path with `FakeProvider` |
| `test_assemble_validate.py` | id format, mm conversion, opening bounds clamp, overlap removal, invariants of 03 §1.1 |
| `test_reference_fixtures.py` | the two reference blueprints end-to-end with provider `none` and with `ReplayProvider` (recorded LLM outputs `tests/fixtures/llm/{fixture}.labeling.json`), asserting §16.3 targets |
| `test_schema_contract.py` | writes recognition outputs to `tests/out/*.json`; the Laravel CI job validates them with `node engine-cli/dist/cli.mjs validate-plan` (16) |
| `test_live_providers.py` (`@pytest.mark.live`) | real Anthropic/OpenAI/compat calls on the reference fixtures when keys are present; manual/nightly only |

`ReplayProvider` (tests only) implements `LLMProvider` and returns a stored `LabelingResult` regardless of input, so the LLM path is tested offline. Recorded fixtures are refreshed with `uv run python scripts/evaluate.py --provider anthropic --record`.

### 16.2 Evaluation harness `vision/scripts/evaluate.py`

```
uv run python scripts/evaluate.py --fixtures tests/fixtures/reference [--provider none|anthropic|openai|openai_compatible|replay]
       [--model M] [--effort low|medium|high] [--record] [--out eval-out/] [--fail-under]
```
For each `X.{png,webp,jpg,pdf,dxf}` with `X.expected.json` (PlanDocument, 03 §6): run the pipeline in-process (no S3: `file://` sources and a local output dir), then compute:
- **Scale error** `|k_pred / k_true − 1|` where `k_true` = expected `background.mmPerPixel` (expected files are positioned in the source image frame; predicted k is converted to the source frame by `resampleFactor`).
- **Alignment**: predicted geometry is first scaled by `k_true / k_pred` (so wall metrics are not double-penalised for scale), then aligned by a similarity search: rotation −3…+3° step 0.25°, translation by bbox-centre alignment then ±200 mm in 20 mm steps, maximising wall IoU.
- **Wall IoU**: rasterise wall outlines (centreline buffered by thickness/2, flat caps, `shapely`) at 20 mm/px; IoU of the two masks.
- **Wall count ratio** `pred / expected`.
- **Room F1**: expected rooms = faces from the expected document (rasterised walls + §8.6 at 20 mm/px with expected `RoomMeta` anchors); a predicted named room (RoomMeta or merged-name TextLabel) matches an expected room when types are equal (`toilet`≡`bathroom`, `master_bedroom`≡`bedroom`, `living`≡`dining`≡`foyer` treated as one class) and the predicted anchor/label point lies inside the expected room polygon; one-to-one greedy matching; F1 over counts.
- **Opening F1**: match by same wall side (centre within 300 mm) and same kind.
- Output `eval-out/report.json` + `report.md` (table per fixture and provider) + overlays PNG per fixture. `--fail-under` exits 1 if any target in §16.3 is missed.

### 16.3 Accuracy targets (reference fixtures)

| Fixture | Metric | Provider `none` | LLM provider (`anthropic`, `claude-opus-5-5`, effort high, agentic) |
|---|---|---|---|
| `hdb-3room.webp` | scale error | ≤ 5 % | ≤ 2 % |
| | scale method | `dimension_chain` | `dimension_chain` |
| | detected unit system | metric | metric |
| | wall count ratio | 0.75 – 1.35 | 0.8 – 1.25 |
| | wall IoU | ≥ 0.65 | ≥ 0.75 |
| | room F1 | ≥ 0.60 | ≥ 0.85 |
| | opening F1 | ≥ 0.40 | ≥ 0.60 |
| | room names found (case-insensitive substring) | BEDROOM ×3, TOILET ×3, KITCHEN, LIVING, BALCONY | same |
| `brochure-2bhk.png` | scale error | ≤ 8 % | ≤ 5 % |
| | scale method | `room_label` | `room_label` |
| | detected unit system | imperial | imperial |
| | wall count ratio | 0.6 – 1.6 | 0.75 – 1.35 |
| | wall IoU | ≥ 0.50 | ≥ 0.60 |
| | room F1 | ≥ 0.60 | ≥ 0.85 |
| | key-plan inset excluded | no wall with midpoint in the bottom 25 % of the image | same |
| | room names found | BEDROOM ×2, TOILET ×2, KITCHEN, LIVING/DINING, DECK | same (OTS and CORRIDOR excluded from rooms) |

Both fixtures must also: finish in ≤ 60 s with provider `none` and ≤ 240 s with the LLM provider on the 2-vCPU production profile; produce documents that pass engine `validate-plan` with no errors.

### 16.4 Laravel (Pest)

Feature tests with `Http::fake()` for the vision service and `Storage::fake('s3')`: A1 consumes only a `ready` `blueprint_source` intent of the same user/project (422 `upload_invalid` otherwise) and attaches `source`; `PrepareImportPreview` sniffing (DWG → failed), page thumbnails attached; start (credits reserved, 402/409/429 paths — detailed in 18 §17); job: busy release keeps status `queued`, retryable vs non-retryable errors, success stores media/document/meta and commits credits, fallback-to-none charges `none` credits; cancel rules; review autosave conflict 409; accept new vs replace (before_restore + import_accepted revisions, current_revision_id, source); scale-not-confirmed 422; discard; rerun copies media and charges again; convert-to-trace free; cleanup command all five rules (incl. media kept when referenced by a plan background); broadcasting payloads. Browser test (Pest browser plugin): upload a fixture PNG with a faked vision response → review page shows amber/red items and the attention count → "Looks right" decrements → Check a dimension rescales → accept → plan editor opens with walls.

---

## 17. Acceptance criteria

1. Uploading each supported type (§2.1) of the reference blueprints (PNG, WebP, a PDF made from the PNG, a phone photo of a printout, an HEIC photo, a DXF exported from the hand-made fixture) reaches `ready_for_review` with provider `none` and with provider `anthropic`.
2. A `.dwg` upload is rejected at presign with the §2.1 message; a renamed DWG (`.dxf` extension) is rejected by upload processing (13 §11.3, reason `dwg_not_supported`) with the same message, and no import row is created.
3. A 21-page PDF fails with `pdf_too_many_pages`; a 3-page PDF shows a page picker with 3 thumbnails, and recognition uses the selected page.
4. A perspective phone photo is rectified automatically (walls in the result within ±1° of axis-aligned) or, when corners are not found, the corner editor allows manual correction and the result is rectified.
5. §16.3 targets are met on both fixtures (`evaluate.py --fail-under` passes in CI with `none` and `replay`).
6. The review page shows background at 50 % opacity, entities coloured per §11.2, an accurate "Needs your attention (n)" count, and the scale panel with method and used measurements.
7. "Check a dimension" on a wall of known length rescales the entire document (walls, thicknesses, openings, rooms, background `mmPerPixel`) by the right factor in one undoable step.
8. Accept into a new plan creates the plan (`source imported`) with an `import_accepted` revision; accept into an existing plan additionally creates a `before_restore` revision of the old content.
9. Discard leaves credits charged; a system failure leaves the customer's balance unchanged (reservation released) — see 18 §18.
10. Trace mode never reserves credits, calibrates `mmPerPixel` from two points within 0.5 % of the true value on the HDB fixture (points placed on the 11000 dimension ticks), and opens the plan editor with an empty plan and the locked background.
11. No vision request exceeds 570 s; no Laravel job exceeds 660 s; a stuck import is failed and refunded by `imports:cleanup-stale` within 90 min.
12. With the vision service stopped, starting an import ends in `failed` with `vision_unavailable` after ≤ 2 attempts, and the reservation is released.
13. Provider API keys never appear in Laravel config, logs, database rows or HTTP responses (grep test in CI on Laravel logs from the browser test run).

---

_Appendix merged into the target documents during reconciliation (see 19-reconciliation-log.md)._
