# Pre-flight conflict scan: P3 vision plan

- Plan: `docs/superpowers/plans/2026-10-20-furny-p3-vision.md` (34 tasks).
- Spec authority: master `2026-10-20-furny-design.md` plus `06`, `18`, `03 §1/§1.1/§6`, `17 §4.1/§4.2/§5.9/§6.2/§10.2`, `19` (D4, D5, D27, 06-B1, 13-D), `01 §1.3`.
- Scan date: 2026-10-20. The plan and spec are unchanged by this scan.

**Result: 21 conflicts (K1–K21) and 16 lesser issues (I1–I16).** Section 4 has the proposed rulings. The spec is binding.

---

## 0. Environment check (verified in this container)

| Item | Finding |
|---|---|
| Python | `/usr/bin/python3.12` is 3.12.3. Default `python3` is 3.13.16, so the plan is right to pin 3.12. |
| uv | `/root/.local/bin/uv` 0.11.32. `UV_PYTHON_DOWNLOADS=never` is required because releases.astral.sh is blocked. `uv venv -p /usr/bin/python3.12` works. |
| PyPI | Reachable. Latest versions all satisfy the plan's bounds: anthropic 1.17.0 (= lower bound), openai 3.35.1, httpx2 2.15.1, rapidocr 3.10.0, onnxruntime 1.31.0, numpy 2.5.4, scikit-image 0.26.0, pydantic 2.14.1, fastapi 0.156.4, ezdxf 1.4.5, pypdfium2 5.14.0, pdfplumber 0.11.10, pi-heif 1.4.0, pypdf 6.21.1, sentry-sdk 2.72.0. opencv-python-headless latest is **5.0.0.93**; the plan's `<5` pin resolves to 4.14.0, so `test_native_imports` (`startswith("4.")`) holds. |
| SDKs on httpx2 | Confirmed. `anthropic` and `openai` both require `httpx2`, and `anthropic.DefaultHttpxClient` subclasses `httpx2.Client`. 18 §17.1's `httpx.MockTransport` injection therefore has to use `httpx2` (plan gap 3 is correct). `httpx2` is a runtime transitive dependency; listing it in the dev group for tests is fine. |
| RapidOCR offline | Confirmed. The rapidocr 3.10.0 wheel bundles `PP-OCRv6_det_small.onnx`, `PP-OCRv6_rec_small.onnx` and `ch_ppocr_mobile_v2.0_cls_mobile.onnx`. In a scratch venv with `socket.connect` disabled, `RapidOCR(params={... "Det.limit_type": "max", "Det.limit_side_len": 1280 ...})` read "BEDROOM 3300" at score 0.978. Task 1 `test_rapidocr_models_bundled` will pass. Never set `lang_type` or `ocr_version` (that would trigger a download). |
| Anthropic SDK params | `client.beta.messages.stream` accepts `betas`, `fallbacks`, `output_config`, `cache_control` and `thinking` (adaptive). The non-beta `messages.stream` accepts all of these except `fallbacks`/`betas`. The `BetaFallbackBlock` type and `usage.iterations` exist (relevant to K9). |
| GitHub | codeload/api.github.com are blocked; the plan needs neither (no git dependencies). Release downloads are not needed. |
| Docker / S3 / keys | None are available. The plan fakes presigned URLs with `httpx.MockTransport`, fakes SDKs with `httpx2.MockTransport`, and excludes `-m live`. No task needs Docker. |
| CI vs local | 17 §10.2 CI runs `uv python install 3.12`, which works on GitHub but **not locally**. Locally, always use the system 3.12 (plan gap 9). |
| Worktree | Work happens in git worktree **`/home/user/furny-p3`** on branch `build/p3-vision`. The plan says "Run all commands from `/home/user/furny/vision`", which is the other checkout on branch `spec/prd`. See K1. |

---

## 1. Table (a): task pairs sharing a file or an interface

"P" is the producer and "C" the consumer. Each finding is OK, or "conflict" (Kn) / "issue" (In), with the ruling in section 4.

### 1.1 Shared files (edited by more than one task)

| Tasks | File | Produces (P) / consumes (C) | Finding |
|---|---|---|---|
| T3→T6 | `app/main.py` | T3 leaves `app.state.io_factory = None`. T6 sets `lambda: HttpIO()`. | OK |
| T3→T12 | `app/main.py` | T3 `create_app(ocr_factory=None)`, with the default wired later. T12 sets the default `OcrEngine`. | OK |
| T3→T22 | `app/main.py` | T3 `provider_factory = None`. T22 includes routers and sets the factory to `registry.get_provider`. | OK |
| T3→T29, T3→T31 | `app/main.py` | Additive router includes. | OK |
| T6/T12/T22/T29/T31 (mutual) | `app/main.py` | All edits are additive and non-overlapping. | OK |
| T11→T12→T13→T14→T15→T17→T18 | `schemas/candidates.py` | Types are added one after another (ParsedText, TextToken, Segment, DimensionLine/Span, RawWall/WallCandidate/GapCandidate/WallGraph, OpeningCandidate, RoomFace/CandidateSet). Each task's git add lists the file. | OK |
| T29→T31 | `pipeline/runner.py` | T29 adds `run_inspect`, `run_normalize`, `run_image_normalize` and `load_page`. T31 adds `run_recognition`. | OK |
| T29→T30 | `pipeline/dxf/render.py` | T29 creates a minimal `render_dxf_preview`. T30 adds `render_dxf` and `render_mm_per_px`. | **conflict K13**: T29's preview renders every entity instead of the 06 §10.5 roles, two renderers exist, and T29's Files header omits `render.py`. |
| T22→T26 | `api/providers.py` | T22 uses a local copy of `JSON_SCHEMA_INSTRUCTION_TEMPLATE`. T26 replaces it with the import. | OK (the temporary duplicate is removed in T26) |
| T26→T27 | `pipeline/labeling/llm.py` | T26 raises `NotImplementedError` for agentic mode. T27 wires `run_agent`. | OK |
| T19→T26 | `pipeline/labeling/base.py` | T19 types `LabelingOutcome.calls: list[Any]`. The self-review says to tighten it in T26. | **issue I1**: T26 neither lists nor git-adds `base.py`. |
| T10→T12,13,14,16,17,18,31,33 | `tests/support/synth.py` | Provides `render_plan`, `SWall`, `SDoor`, `SWindow`, `SText`, `SDimChain`. | OK, except **I5**: T17 `test_passage` needs an empty-gap primitive that synth does not have. |
| T9→T29 | warped-page test image | T29 `test_inspect_raster_photo` reuses "Task 9 synthetic", but T9 builds it inline in `test_rectify.py`. | **issue I12**: duplicated test code, and it sits awkwardly with the Global rule that synthetic images come through `synth.py`. |
| T8→T29, T8→T31 | `tests/support/pdfgen.py` | `make_pdf(PageSpec…)` supports 3-page, 21-page and A3 vector pages with words. | OK |
| T28→T29, T28→T30, T28→T31 | `tests/support/dxfgen.py` | `make_room_dxf(...)`. | **conflict K15**: T30's tests assume "6000×4000" means outer faces. dxfgen must state this. |
| T22→T26,27,28,31,33,34 | `app/providers/testing.py` | `FakeProvider`, `ReplayProvider`, `make_turn`. | **conflict K12**: `make_turn(text=…)` and "TurnResult with text" do not match the verbatim 18 §6.1 `TurnResult(assistant, stop_reason, usage)`. |
| T24 only | `tests/providers/sse.py` | SSE serializer. | OK |
| T32→T33, T32→T34 | `tests/fixtures/reference/*.expected.json` | `build_expected` output in the source frame. | OK |
| T33→T34 | `tests/fixtures/llm/*.labeling.json`, `eval-out/` | The `--record` format matches T34's fixture format. T34 reads `eval-out/*/06-candidates.json`. | **issue I8**: T33 never defines the `eval-out` per-run directory layout. |
| T1→all | `pyproject.toml`, `uv.lock`, `requirements.txt` | No later task adds a dependency (pypdf and httpx2 are already dev). | OK |
| T1→all | commit commands `git add vision/...` | Paths are relative to the repo root, but the plan's cwd is `vision/`. | **conflict K1** |

### 1.2 Shared interfaces

| Tasks | Interface | Produces / consumes | Finding |
|---|---|---|---|
| T2→T3 | `Settings.vision_heavy_slot_wait_s` | T3 `test_busy` builds Settings with `0.1`. | **conflict K2**: an int field rejects 0.1. |
| T2→T31 | `Settings.vision_recognize_deadline_s` | T31 `test_recognize_deadline` uses `0.001`. | **conflict K2** |
| T2→T7, T2→T29, T2→T31 | `vision_max_pixels`, `vision_max_source_bytes` | T7 uses the module constant `MAX_WORK_PIXELS`. T29 hard-codes 26 214 400. | **conflict K5**: the 18 §4 environment variables are ignored. |
| T2→T22, T24, T25 | provider settings, `anthropic_server_fallback`, compat flags | Read by the registry and adapters. | OK |
| T2→T3 | `configure_logging`, `request_id_var` | Request-id middleware. | OK |
| T3→T6,7,8,21,22,26,28,29,31 | `VisionError`, `ERROR_TABLE` | Every code raised (`file_too_large`, `source_unavailable`, `upload_failed`, `deadline_exceeded`, `image_*`, `dwg_not_supported`, `unsupported_type`, `corrupt_file`, `pdf_*`, `invalid_page`, `too_complex`, `no_walls_detected`, `not_a_floor_plan`, `dxf_too_complex`, `provider_not_configured`, `provider_error`, `too_large`, `decode_failed`, `unsupported`) is in the pinned T3 table. | OK |
| T3→T29, T3→T31 | `heavy_slot`, `light_slot` | Inspect and image-normalize use light; normalize and recognize use heavy. | OK (06 §5.2, §5.8) |
| T3→T31 | `VisionError(usage=…)` serialised into the error body | T31 `test_recognize_fallback_disabled`. | OK |
| T4→T6 | `MetaWarning`, `StageKey`, `WarningCode` | `ctx.warn`, `ctx.stage`. | OK |
| T4→T9 | `PageImage` | `NormalizedPage.page_image`. | OK |
| T4→T10, T4→T18 | `DrawingKind` | `Preprocessed.drawing_kind`, `CandidateSet.drawing_kind_cv`. | OK |
| T4→T19, T4→T22 | `FallbackReason`, `ProviderName` | `LabelingOutcome`, `fallback_reason_for`. | **issue I3**: `ProviderName`/`Effort` are defined again in `providers/base.py` ("verbatim 18 §6.1"). |
| T4→T20 | meta `ScaleSample` (pydantic) | T20 defines a different `ScaleSample` dataclass. | **issue I3**: name collision. |
| T4→T21, T4→T32 | `PlanDocument`, `new_id` | Assembly uses `new_id`. T32 uses deterministic ids that still match the regex. | OK |
| T4→T31 | `ImportResultMeta` | `build_meta`. | OK |
| T5→T29 | `InspectResponse.warnings` | T29 asserts that warnings include `{"code","params"}`. T5 round-trips the 06 §5.4 example, which has no `entityIds`. | **conflict K3** |
| T5→T22 | `ProviderInfo`, `CapabilitiesResponse` | T5 round-trips the 18 §5.1 example, where `missing` is absent on configured providers. | **conflict K3** |
| T5→T19, T20, T21, T28, T31 | `RecognizeHints`, `RecognizeOptions`, `RecognizeDefaults` | `hints.unit_system`, `wall_height_mm`, `defaults.*`. | OK |
| T5→T19,20,21,26,27,30,34 | `LabelingResult` and sub-models | | OK |
| T5→T22, T5→T26 | `to_strict_schema`, `parse_json_object` | | OK |
| T5→T28 | `LayerMapping`, `DxfInfo` | | OK |
| T5→T22, T5→T31 | `Usage`, `UsageCallOut`, `DebugArtifact` | `build_usage`, `DebugSink.flush`. | OK. Nit: T6's test writes `DebugArtifact(0, …)` positionally, which pydantic does not allow; use keywords. |
| T6→T7…T31 | `PipelineContext` (deadline, stage, warn, remaining) | T27 mutates `ctx.deadline`. | OK (the context must not be frozen) |
| T6→T29, T31, T33 | `SourceIO`, `HttpIO`, `LocalIO`, `fetch_source`, `upload_bytes` | T29/T31: "cap by kind" before the kind is sniffed. | **issue I10** |
| T6→T26, T6→T31 | `DebugSink.add_png/add_json/flush` | T26 writes `07-labeling.json`. T31 expects all 8 artifacts with provider `none`. | **conflict K17** |
| T7→T29 | `sniff_kind`, `decode_raster` (`exif_make_or_model`), `apply_pixel_guards` | `load_page` must turn EXIF Make/Model into `is_photo`. | **conflict K21** |
| T8→T9 | `VectorPage` in `NormalizedPage.vector` | | OK |
| T8→T12 | `VWord` (`angle`) | pdf_vector bypass. | OK |
| T8→T13, T8→T16 | `VSeg` mapped through `page.transform` | | OK |
| T8→T20 | `is_standard_paper` | Scale-note fallback. | OK |
| T8→T29 | `pdf_page_count`, `render_pdf_page`, `classify_pdf_page`, `render_dpi` | Inspect thumbnails and preview. | OK |
| T9→T10, 12, 13, 16, 20, 23, 29, 30, 31 | `NormalizedPage`, `Rect`, `odd`, `detect_line_segments`, `seg_angle_deg` | | OK |
| T9→T29 | `detect_page_quad`, `quad_is_axis_aligned` | `isLikelyPhoto` / `suggestedCorners`. | OK |
| T10→T12, 13, 16, 17, 31 | `Preprocessed` (ink, thick, dt, t_thin, region) | | OK |
| T10→T31 | `detect_plan_region` on an empty `thick` mask | T31 blank-image test. | **conflict K6**: the region is undefined when there are no components, and the `default_guess` division by `max(region.w, region.h)` then fails. |
| T11→T12, 19, 21, 30 | `parse_token`, `ParsedText`, `match_room_name`, `ROOM_DEFAULT_NAMES`, `title_case_name` | | OK |
| T12→T13 | `OcrResult.ink_notext`, token boxes | | OK |
| T12→T14, 18, 19 | `TextToken` (angle, height_px, parsed) | | OK |
| T12→T20, T12→T29 | `find_scale_note(tokens, page)` needs `TextToken`s. T29's `/v1/normalize` has no `Preprocessed`/`run_ocr`. | | **issue I9** (a vector-word→token helper is needed), plus **conflict K11** (scale note on raster PDFs) |
| T13→T14, 16, 17 | `Segment`, `merge_collinear`, `dominant_orientation` | | OK |
| T14→T16 | `DimensionLine` (excluded from walls) | | OK |
| T14→T19, T14→T20 | `DimensionSpan`, `associate_dimension_texts` | | OK. **I6**: the kind of a 2-tick span is not recorded as a decision. |
| T15→T16 | `build_wall_graph(raw, *, r, t_median, L)`, `openings_px`→`GapCandidate` | | OK |
| T15→T17, T15→T18 | `WallGraph` (nodes, walls, gaps) | | OK |
| T15→T30 | `build_wall_graph` with `r = max(thickness, 50 mm)` in render px | Gaps between DXF runs must become `openings_px` on one merged wall. | **conflict K15** |
| T16→T18, T16→T31 | `WallExtraction.mask` passed as an ndarray (stage boundary I12 kept) | | OK |
| T17→T18, 19, 21 | `OpeningCandidate` (support, hinge, swing) | | OK |
| T18→T19, 20, 21, 23, 26, 30, 31 | `CandidateSet`, `scale_y` | | OK |
| T18→T30, T18→T33 | `find_room_faces(wall_mask, graph, openings, tokens, region, t_median)` at 20 mm/px | Callers must pass an empty graph and empty openings. | OK (document this in T30/T33) |
| T19→T20 | `KnownDimensionMatch(None, None)` for "overall width/length/depth" | T20 handles only span or wall matches. | **conflict K20** |
| T19→T26, T30, T31 | `HeuristicLabeler`, `LabelingOutcome` | | OK |
| T20→T21 | `ScaleResult` (mm_per_px, confidence) | | OK |
| T20→T31 | `ScaleResult.y_factor` and anisotropy resize/`scale_y` | | OK |
| T20→T29 | `find_scale_note` | | See K11 |
| T21→T30 | `snap_thickness` | | OK |
| T21→T30/T31 | `assemble_document(page, candidates, labels, scale, options, ctx)` | T30 produces `confidence_overrides` and the reason `single_line_wall`. | **conflict K14**: there is no input to apply them before `overall` is computed. |
| T21→T31 | `validate_and_repair(doc, *, confidence, drawing_kind)` | | OK (the extension is recorded) |
| T22→T23–T28 | `TextPart`, `ImagePart`, `ToolSpec`, `ToolCall`, `ToolResult`, `UsageCall`, `TurnResult`, `LLMProvider` | Plan prose uses `turn.text`/`turn.tool_calls`. | **conflict K12** |
| T22→T24, T22→T25 | `record_provider_error`, `last_error` | Only auth and `model_not_found` are recorded. | **conflict K10** |
| T22→T31, T22→T33 | `get_provider`, `provider_factory`, `build_usage` | | OK |
| T23→T26, T23→T27 | `build_overview`, `to_image_part`, `from_overview`, `ToolExecutor` | | OK |
| T25→T23/T27 | invalid tool-argument JSON sentinel `{"__invalid_json__": raw}` | `ToolExecutor` would reply with a pydantic error, not "invalid JSON arguments". | **conflict K16** |
| T24/T25→T22 | registry import table (class names) | | OK |
| T25→T26 | `OpenAICompatibleProvider` in `test_compat_single_pass` | | OK |
| T26→T27 | `complete_json`, `FINALIZE_PROMPT`, `REPAIR_PROMPT_TEMPLATE` | | OK |
| T26→T28 | `SYSTEM_PROMPT_DXF_LAYERS`, `USER_PROMPT_DXF_LAYERS_TEMPLATE`, `complete_json` | T28 declares no Consumes. | **issue I2**: risk of duplicating the prompt-JSON parse/repair logic. |
| T27→T26 | `run_agent` wired into `LlmLabeler` | | OK |
| T28→T29 | `dxf_info`, `read_dxf` | | OK |
| T28→T30 | `DxfDrawing`, `classify_layers` | `LayerStats` is never defined. | **issue I16** |
| T29→T31 | `load_page` | | OK, apart from K21 |
| T30→T31 | `run_dxf` → `DxfResult` (page, candidates, labels, scale, overrides, usage) | | Overrides: see K14 |
| T31→T33, T31→T34 | `run_recognition`, `candidates_hash`, `DEBUG_NAMES` | | OK |
| T32→T33 | `build_expected`, expected `background.mmPerPixel` = `k_true` | | OK |
| T33→T34 | `app.evaluation.metrics`, `check_targets`, `TARGETS`, `inset_excluded` | | OK (I8 for the output layout) |

---

## 2. Table (b): per-task self-consistency

| Task | Verdict | Notes |
|---|---|---|
| T1 | issue (K1) | Tests, code and files are consistent. The rapidocr bundling is verified. Step 6 `git add vision/` fails from cwd `vision/`. `nixpacks.toml` "exactly 17 §5.9" copies the stale opencv comment (accepted, gap 2). |
| T2 | issue (K2) | Field types are not pinned. Seconds fields must be `float` for T3/T31. |
| T3 | OK | |
| T4 | OK | Counts (26 warnings, 13 reasons, 19 room types) match 06 §6 and 03 §1. |
| T5 | **conflict K3** | The round-trip `wire()` tests cannot pass with naive models: `missing` (null vs absent) and inspect warnings without `entityIds`. |
| T6 | issue (I4) | `test_stage_timings_accumulate` asserts only `>= 0`. The `DebugArtifact` positional ctor is a nit. |
| T7 | **conflict K4** | `test_downscale_warning` (200×100, `MAX_WORK_PIXELS=5000`) yields a short edge of 50, so the `MIN_SHORT_EDGE=300` guard raises `image_too_small`. The `megapixels: 0.0` param is trivial. |
| T8 | OK | DPI, A4 and A3 numbers check out. |
| T9 | issue (I11) | In `test_user_corners_win`, "≈0.8× input (before resample)" is ambiguous because normalize always resamples below 2000 px. Use an input with long edge ≥ 2500. |
| T10 | **conflict K6**, issue I5 | There is no empty-region rule. synth lacks a passage (empty gap) primitive. |
| T11 | OK | Note: apply the `l`→`1` confusion before upper-casing (`"l200"` would otherwise become `"L200"`). |
| T12 | OK | `tile_origins(3000)`, the rotation mapping and the ids all check out. |
| T13 | OK | |
| T14 | issue (I6) | 06 §8.4 says the single span of a 2-tick line is "both". The plan picks `overall` without recording it in the gap list. |
| T15 | OK | |
| T16 | OK | |
| T17 | issue (I5) | `test_passage` has no synth primitive. |
| T18 | OK | |
| T19 | OK | |
| T20 | **conflicts K7, K8, K20** | (K7) The cross-check pin of 13 % contradicts the spec formula, which gives 15 %. (K8) `test_single_overall_high_confidence` (lone known-dimension → primary) contradicts `test_fallback_order` (known dimension + < 2 others → `user_hint`). (K20) The null-id known dimension is not handled. |
| T21 | OK (cross-task K14, K19) | The pins re-computed correctly: wall 0.87, door 0.72/0.87/0.6, room 0.88/0.7, `snap_thickness` 115/230/130/50/1000, opening width 910, clamp 450. |
| T22 | OK (K10, K12 cross) | |
| T23 | OK | Crop numbers (400×320, 200×160, s = 0.5152) check out. |
| T24 | **conflict K9** | `test_anthropic_fallback_block` ("native omits thinking/tool_use before the fallback block") contradicts its own Step 3 ("replays byte-identically") and the Global Constraint. `model_dump(mode="json", exclude_none=True)` without `by_alias=True` emits `from_` for the fallback block. |
| T25 | issue (K16) | |
| T26 | issue (I1) | The Files list misses `labeling/base.py`. |
| T27 | OK | The deadline arithmetic (85 s → finalize first) checks out. |
| T28 | issue (I2, I16) | No Consumes are listed for `complete_json`/prompts/`FakeProvider`. `LayerStats` is undefined. |
| T29 | **conflict K11, K13**; issue K21 | The Files header omits `pipeline/dxf/render.py`, which Interfaces and git add both include. The raster-PDF OCR scale note goes beyond the spec. `is_photo` from EXIF is unstated. |
| T30 | **conflict K15** | `test_coordinates_margin` says the "leftmost wall **face** ≈ 500+115", but the face is at 500 and the centreline at 615. "4 exterior walls" requires merging the runs on either side of the door and window gaps into one wall each with `openings_px`, and wall kinds come from assembly, which the task never calls. |
| T31 | issue (K6, K17, I10, I14) | `test_recognize_not_a_floor_plan` asserts `no_walls_detected`, so it is misnamed. The 8-artifact assertion with provider `none` needs `07-labeling.json` from the heuristic path. |
| T32 | OK | The phrase "main body of 7 000 plus the balcony" is unclear; the numbers (11 000 × 8 900) match 03 §6. |
| T33 | issue (I8) | The `eval-out` layout is unspecified. |
| T34 | OK (depends on I8) | |

---

## 3. Table (c): defect-prone mandates, and contradictions with Global Constraints or the spec

| # | Where | Mandate | Why it is a defect or contradiction |
|---|---|---|---|
| c1 | T6 `test_stage_timings_accumulate` | `ctx.timings["ocr"] >= 0` | Asserts nothing about accumulation (I4). |
| c2 | T7 `test_downscale_warning` | `{"megapixels": 0.0}` | A trivial value that cannot catch a wrong computation, and the test conflicts with the size guard (K4). |
| c3 | T20 `test_single_overall_high_confidence` | Approximates the "LLM confidence ≥ 0.8" branch with a known-dimension sample | That branch is unimplementable because `LabelingResult` has no confidence field, and the test contradicts the spec's `user_hint` rule (K8). |
| c4 | T20 `test_room_label_cross_check` | `≈ 13` | 06 §8.2 step 9 gives \|11.5/10 − 1\| × 100 = 15 (K7). |
| c5 | T24 `test_anthropic_fallback_block` | Strip pre-fallback blocks from `native` | Contradicts 18 §7.1 ("never edited, reordered or stripped"), the Global Constraint ("replayed unchanged") and the SDK's own `BetaFallbackBlockParam` doc ("Echo the assistant turn back verbatim, including this block … omitting … the request is rejected") (K9). |
| c6 | T22 vs T26 | Local copy of `JSON_SCHEMA_INSTRUCTION_TEMPLATE` | A temporary duplicate, resolved in T26. OK. |
| c7 | T29 vs T30 | `render_dxf_preview` plus `render_dxf` | Duplicate renderers, and the preview violates the 06 §10.5 role filter (K13). |
| c8 | T28 | LLM layer mapping without `complete_json` | Would duplicate the prompt-JSON, repair and sanitize logic (I2). |
| c9 | T4/T5/T22 | `ProviderName` (and `Effort`) in meta.py and base.py; `ScaleSample` in meta.py and scale.py | Duplicated Literals and a name collision (I3). |
| c10 | T9 and T29 tests | Warped-page generator inline in T9, then reused by T29 | Duplicated test code. Global says synthetic drawings come through `synth.py` (I12). |
| c11 | T31 `test_recognize_not_a_floor_plan` | Asserts `no_walls_detected` | Misleading name (I14). |
| c12 | Global "Run all commands from `/home/user/furny/vision`" plus every Step 6 `git add vision/...` | | Wrong checkout (`furny` is on `spec/prd`; P3 is the `furny-p3` worktree), and the git paths are relative to the repo root, not `vision/` (K1). |
| c13 | Global "Every coordinate comes from OpenCV" / 18 §7.5 / 18 §5.1 | lastError | 18 §5.1 (definition and example) includes `provider_unreachable`. The plan records only auth and `model_not_found` (K10). |
| c14 | Self-review "06 §6 (all fields, warnings)" | Warning codes `photo_rectified`, `rooms_without_names`, `walls_unconnected` | No task emits them. Reasons `name_guessed`, `size_mismatch`, `unconnected` and `llm_unsure` have no pin (K19). |
| c15 | 18 §4 `VISION_MAX_PIXELS` / `VISION_MAX_SOURCE_BYTES` | T7 module constants, T29 literal 26 214 400 | The environment variables are inert (K5). |
| c16 | 06 §5.6 / §4.7 step 4 | T29 OCR scale note on raster PDFs | The spec limits the trace scale note to `pdf_vector` (K11). |
| c17 | 06 §16.1 file table | The plan places decode DPI/encrypted cases in `test_pdf.py`, refusal/sanitise in `test_llm_labeler.py`, `$INSUNITS`/regex/layer mapping in `test_dxf_reader.py`, and door hinge/swing in `test_openings.py` | Deviates from the binding file-to-coverage table (K18). |
| c18 | 18 §6.1 "verbatim" | `make_turn(text=…)`, "TurnResult with text", `turn_result.tool_calls` | §6.1's `TurnResult` has `assistant`, `stop_reason`, `usage` and no `text` (K12). |
| c19 | Review Focus / self-review cross-references | `test_ocr_confusions (Task 12)`, `test_refusal_falls_back (Task 27)`, `test_dxf_too_complex (Task 30)` | These are actually in T11, T26 and T28 (I7). |

---

## 4. Proposed rulings (spec binding)

### Conflicts

| # | Conflict | Ruling |
|---|---|---|
| K1 | cwd and git paths (plan vs environment, and internal) | Run uv, pytest and scripts from **`/home/user/furny-p3/vision`** with `export PATH=/root/.local/bin:$PATH UV_PYTHON_DOWNLOADS=never`. Run git from the worktree root: `git -C /home/user/furny-p3 add vision/...` and `git -C /home/user/furny-p3 commit ...`. Never touch `/home/user/furny` (branch `spec/prd`). |
| K2 | Settings seconds int vs float tests (T2↔T3, T31) | Every `*_s` setting (`vision_recognize_deadline_s`, `vision_llm_stage_budget_s`, `vision_llm_call_timeout_s`, `vision_heavy_slot_wait_s`, `openai_compat_timeout_s`) is `float`. 18 §4 gives no type, and the T2 defaults test still passes (`570.0 == 570`). |
| K3 | T5 round-trip vs 06 §5.4 / 18 §5.1 examples (also T29 warnings) | `ProviderInfo.missing: list[str] \| None` is **omitted when None** (`Field(exclude_if=lambda v: v is None)` on pydantic ≥ 2.11, or a wrap `model_serializer`). Every other null (`lastError`, `defaultModel`) is still emitted. Inspect and normalize responses use a separate `ApiWarning(code, params)` model without `entityIds`, as in the 06 §5.4 example. Recognize meta keeps `MetaWarning` with `entityIds` (06 §6). |
| K4 | T7 `test_downscale_warning` vs the short-edge guard | Monkeypatch `MIN_SHORT_EDGE` (e.g. 10) in that test. Use a 400×300 image with `MAX_WORK_PIXELS=5000`, so the asserted param is `{"megapixels": 0.1}` instead of 0.0. |
| K5 | 18 §4 limit env vars ignored (T7, T29, T31) | Pass `settings.vision_max_pixels` and `settings.vision_max_source_bytes` explicitly (`apply_pixel_guards(img, ctx, max_work_pixels=…)`, fetch caps from settings). The module constants remain only as defaults and test monkeypatch points. DXF stays at 15 728 640 (spec constant). |
| K6 | Blank image: T10 region undefined, T31 test | `detect_plan_region` returns the full image rect when `thick` has no component (no warning). The pipeline then reaches validate → `no_walls_detected` 422. Add `test_region_empty_is_full_image` to T10 and rename T31's test to `test_recognize_blank_image_no_walls`. |
| K7 | T20 cross-check 13 % vs spec formula | The pin becomes `median_discrepancy_pct ≈ 15.0` (06 §8.2 step 9: \|value/(k·span) − 1\| × 100). |
| K8 | T20 contradictory tests | Delete `test_single_overall_high_confidence`. The "1 overall with LLM confidence ≥ 0.8" branch is unimplementable (no confidence in 06 §9.4 `LabelingResult`), so add it to the gap list as "never true in v1". A lone known-dimension sample gives `user_hint`, per `test_fallback_order` and §8.2 step 8. |
| K9 | T24 native stripping vs 18 §7.1, the Global Constraint and the SDK | `native` = the **full** response content, unchanged and including the `fallback` block in place, dumped with `model_dump(mode="json", by_alias=True, exclude_none=True)` (so the key is `from`, not `from_`). Keep `text` = text after the last fallback block and usage summed over `usage.iterations` as recorded deviations (gap 4), but rewrite the test so the replay check asserts byte-identical `native`. |
| K10 | lastError codes (18 §5.1 vs §7.5) | Record `provider_auth_failed`, `model_not_found` **and `provider_unreachable`**. §5.1 is the lastError definition and its example shows `provider_unreachable`. Add the ConnectError → recorded assertion to T24 and T25. |
| K11 | T29 raster-PDF OCR scale note vs 06 §5.6 / §4.7 | `/v1/normalize` searches for a scale note **only for `pdf_vector`** (pdfplumber words). There is no OCR in normalize and no dependency on `app.state.ocr`. |
| K12 | TurnResult shape vs verbatim 18 §6.1 | Implement §6.1 exactly: `TurnResult(assistant: AssistantMessage, stop_reason, usage)`. All plan references to `turn.text` and `turn.tool_calls` mean `turn.assistant.text` and `turn.assistant.tool_calls`. `make_turn(text, tool_calls, …)` builds the `AssistantMessage` (with a `native` stub), and `ReplayProvider` sets `assistant.text = json.dumps(result)`. |
| K13 | DXF preview (T29) vs 06 §10.5, and duplicated renderers | T29 adds `pipeline/dxf/render.py` to its Files header. Its minimal preview already filters to roles wall/door/window/room_label/furniture (`classify_layers_regex`). T30 makes `render_dxf_preview` a thin wrapper over `render_dxf(drawing, roles, render_mm_per_px(extent))` plus a downscale to 1600, leaving one renderer. |
| K14 | T30 confidence overrides with no input to assembly (T21) | T21's `assemble_document` gains `confidence_overrides: Mapping[str, float] \| None = None` and `reason_overrides: Mapping[str, list[ReasonCode]] \| None = None`, keyed by candidate id and applied before `overall`. T30 fills them (paired 0.95, single 0.6 + `single_line_wall`, arc/insert 0.9, gap 0.5). T31 passes them through. Record this in the gap list. |
| K15 | T30 internal | `dxfgen` defines 6000×4000 as **outer faces**, with walls 0..230 thick inward. Collinear wall runs either side of a 500–2500 mm gap become **one** `RawWall` with `openings_px`, so the graph gives 4 walls. `test_coordinates_margin` asserts the leftmost **centreline** x ≈ 615 (500 margin + 115). The "exterior" and thickness-230 assertions run on `assemble_document(run_dxf(...))`. |
| K16 | Invalid tool-argument JSON (T25 sentinel vs 18 §7.2 text, T23/T27) | `ToolExecutor.execute` first checks `"__invalid_json__" in call.arguments` and returns `ToolResult(is_error=True, text "invalid JSON arguments")`. Pin this in T27. |
| K17 | 07-labeling.json for provider `none` (T19/T26 vs T31) | The runner writes `07-labeling.json` after **any** labeler, from the `LabelingOutcome` (result, notes, calls, and an empty transcript for the heuristic path). `LlmLabeler` supplies only the transcript summary. That way T31's 8-artifact assertion holds for `none`. |
| K18 | 06 §16.1 test-file allocation | Move tests, don't copy them. In T8, the DPI-rule and encrypted-PDF tests go into `test_decode.py`, so T8 modifies `test_decode.py`. In T26, `test_refusal_falls_back` and `test_unknown_ids_sanitised` go into a `tests/test_agent.py` that T26 creates and T27 extends. In T28, the tests go into `tests/test_dxf.py`, created in T28 and extended in T30. In T17, add a door hinge/swing case to `test_segments_walls.py`. |
| K19 | Warnings and reasons never emitted (06 §6, §8.7) | T9 emits `photo_rectified` whenever a warp is applied. T21 emits `rooms_without_names {count}` and `walls_unconnected {count}`, and pins the reasons `name_guessed`, `size_mismatch`, `unconnected` and `llm_unsure`. |
| K20 | Known dimension with null ids (06 §9.7) not consumed (T19→T20) | T20 `collect_samples`: `KnownDimensionMatch(wall_id=None, span_id=None)` gives one `overall` w=3 sample. The span is the bbox **width** (x) of the plan-region walls when the label says width, or the bbox **height** (y) for length/depth. Add a T20 test. |
| K21 | `is_photo` from EXIF (06 §7.3 "inspect's isLikelyPhoto criteria") | T29 `load_page` sets `is_photo = hints.is_photo or decoded.exif_make_or_model`. The quad criterion stays inside `normalize`. Assert this in T29 or T31. |

### Lesser issues

| # | Issue | Ruling |
|---|---|---|
| I1 | T26 Files list | Add `vision/app/pipeline/labeling/base.py` (Modify: `calls: list[UsageCall]`) to T26's Files and git add. |
| I2 | T28 duplicated JSON handling | T28 Consumes `complete_json`, `SYSTEM_PROMPT_DXF_LAYERS`, `USER_PROMPT_DXF_LAYERS_TEMPLATE` (T26) and `FakeProvider` (T22). Layer mapping calls `complete_json(..., schema_model=LayerMapping, effort="low", purpose="dxf_layers")`. |
| I3 | Duplicated Literals and name clash | Define each Literal once: `ProviderName` and `Effort` in `schemas/meta.py` and `schemas/api.py` respectively, re-exported by `providers/base.py`. T20's dataclass is renamed `PxScaleSample`, and meta keeps `ScaleSample`. |
| I4 | T6 weak test | Enter `ctx.stage("ocr")` twice with sleeps of 10 ms and 20 ms, and assert `timings["ocr"] >= 30`. |
| I5 | synth lacks a passage | T10 synth adds `SGap(wall, u0, width)` (a cut with no symbol). T17 `test_passage` uses it. |
| I6 | 2-tick span kind | Record the decision in the gap list: a single span from a 2-tick line has kind `overall` (w=2) and also takes part in chain consistency as an overall. |
| I7 | Doc cross-references | Correct the Review Focus and self-review to T11 (`test_ocr_confusions`), T26 (`test_refusal_falls_back`) and T28 (`test_dxf_too_complex`). |
| I8 | eval-out layout | T33 writes `eval-out/{stem}-{provider}/` (normalized PNG plus the 8 debug artifacts) and `eval-out/report.{json,md}` plus `eval-out/{stem}-{provider}-overlay.png`. T34 reads `eval-out/{stem}-none/06-candidates.json`. |
| I9 | Vector words → TextToken | T12 exposes `tokens_from_vector_words(vector, transform) -> list[TextToken]`. `run_ocr` and T29's pdf_vector scale-note search both use it. |
| I10 | Fetch cap before sniffing | Cap = 15 728 640 when `source.source_kind == "dxf"` or the filename ends in `.dxf`. Otherwise use `settings.vision_max_source_bytes`. After sniffing, a DXF over 15 728 640 gives `file_too_large`. |
| I11 | T9 corners test | Use an input with long edge 3000, so 0.8 × 3000 = 2400 needs no resample, and assert that size. |
| I12 | Warped-page generator | T10 `synth.py` adds `warp_onto_canvas(img, corners, canvas_size, fill)`. T29 uses it. T9 may keep its inline version, since it comes before T10. |
| I13 | Anthropic dump | Covered by K9 (`by_alias=True`). |
| I14 | T31 test name | Covered by K6 (rename the test). |
| I15 | OCR confusion order | Apply `O→0` and `l/I→1` before upper-casing (otherwise `"l200"` becomes `"L200"`). Pin it in T11. |
| I16 | `LayerStats` undefined | T28 defines `LayerStats(entity_counts: dict[str, int], line_length_mm: float, parallel_share: float, sample_texts: list[str])`, which is also the row source for the 06 §10.4 layer table. |

### Also confirmed OK (no change)

- Plan gap 1: follow 17 §5.9 for the start command. D27 says 17 deploys the service.
- Gap 2: the stale opencv comment is copied verbatim.
- Gap 3: httpx2.
- Gaps 5–9: as stated.
- The labeler converts overview px to normalized px before returning, which is equivalent to 06 §8.7 step 2's "÷ s + offset".
- 06 §5.5's example artifact name `01-normalized-ink.png` contradicts the §13 table, and the plan correctly follows §13 (`01-ink.png`).
