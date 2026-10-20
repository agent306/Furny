# P3 — Vision Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Python FastAPI vision service in `vision/` that turns blueprint files (JPG/PNG/WebP, HEIC, PDF, DXF) into a validated `PlanDocument` plus `ImportResultMeta`. Classical CV and OCR produce the geometry, a pluggable LLM provider (or heuristics) labels it, and the service ships with offline tests and an evaluation harness that meets the 06 §16.3 accuracy targets.

**Architecture:** A stateless FastAPI app (2 uvicorn workers, each with one `heavy` and two `light` asyncio slots) exposes `/healthz`, `/v1/capabilities`, `/v1/inspect`, `/v1/normalize`, `/v1/recognize`, `/v1/images/normalize` and `/v1/providers/test`. It reads and writes files only through presigned URLs, behind a `SourceIO` seam so tests and the evaluator use local files. Recognition is a staged, deadline-aware pipeline: fetch → decode → normalize → preprocess → OCR → segments → dimension lines → walls/graph → dimension spans → openings → rooms → labeling → scale → assemble → validate → upload. Every coordinate comes from OpenCV. The labeling stage only labels and associates numbered candidates, either through a provider-neutral `LLMProvider` (Anthropic, OpenAI, OpenAI-compatible) or through the `HeuristicLabeler`.

**Tech Stack:**
- Runtime: Python 3.12, `uv`, FastAPI, uvicorn, pydantic v2, pydantic-settings
- Imaging and geometry: opencv-python-headless 4.x, NumPy, SciPy, Shapely, scikit-image, Pillow
- OCR: RapidOCR 3.x on onnxruntime
- Documents: pdfplumber, pypdfium2, pi-heif (decode only), ezdxf
- HTTP and providers: httpx, anthropic 1.x, openai 3.x (both SDKs run on `httpx2`)
- Quality: pytest, ruff, mypy `--strict`

**Spec:** `docs/superpowers/specs/2026-10-20-furny-design.md` plus these section files:
- `2026-10-20-furny/01-architecture.md` §1.3, §9
- `03-design-documents.md` §1, §1.1, §4, §6
- `04-geometry-engine.md` §2.1 (normal convention)
- `06-blueprint-import.md` §0, §2, §5, §6, §7, §8, §9, §10, §13, §14, §16, §17 (service parts)
- `17-deployment-ops.md` §4.1, §4.2, §5.9, §6.2, §10.2 (vision job)
- `18-ai-providers-and-quotas.md` §0–§7, §14, §17.1, §18
- `19-reconciliation-log.md` D4, D5, D27, 06-B1, 13-D

**Environment:** see `docs/superpowers/plans/2026-10-20-furny-roadmap.md` § "Local environment notes". For P3 specifically:
- **Python and uv.** Use the system Python 3.12.3 at `/usr/bin/python3.12`, which uv finds automatically. Python downloads from `releases.astral.sh` are blocked, so always export `UV_PYTHON_DOWNLOADS=never`. `uv` is at `/root/.local/bin/uv`; put that directory on `PATH`. The default `python3` is 3.13 and must not be used for the service.
- **Network.** PyPI is reachable. GitHub release assets work. `huggingface.co`, `modelscope.cn`, `codeload.github.com` and `api.github.com` are blocked. RapidOCR 3.x bundles its default ONNX models inside the wheel (`rapidocr/models/PP-OCRv6_det_small.onnx`, `PP-OCRv6_rec_small.onnx`, `ch_ppocr_mobile_v2.0_cls_mobile.onnx`), so never call `rapidocr.download_models` or point at a model URL.
- **No Docker**, no S3 and no provider API keys. Presigned URLs are faked with `httpx.MockTransport`. Provider SDKs are faked with `httpx2.MockTransport` passed through the SDK's `DefaultHttpxClient`.
- **Engine CLI** (`engine-cli/dist/cli.mjs`) comes from P2 and may not exist yet. Tests that need it skip when the `ENGINE_CLI` environment variable is unset.
- **Working directory.** Run all commands from `/home/user/furny/vision`.

## Global Constraints

**Runtime, packaging and quality gates**
- `pyproject.toml` declares project `furny-vision`, version `1.0.0`, `requires-python = ">=3.12,<3.13"`. The `.python-version` file contains `3.12`. Use no 3.13-only APIs.
- `uv.lock` is committed.
- `requirements.txt` is generated, never hand-edited, with `uv export --frozen --no-dev --no-hashes --no-emit-project -o requirements.txt`. Re-run it in the same commit whenever dependencies change.
- Every task's quality gate: `uv run ruff check .`, `uv run ruff format --check .`, `uv run mypy app` (strict, pydantic plugin) and `uv run pytest -q`. The pytest `addopts` exclude `-m live`.
- Library bans (01 §1.3, 06 I8): never use PyMuPDF, Ultralytics, CubiCasa5k weights, Raster-to-Graph, LibreDWG or the ODA converter. pi-heif is used for decoding only.
- Service versions: `serviceVersion = "1.0.0"` (`app.__version__`) and `pipelineVersion = "1.0.0"` (`app.PIPELINE_VERSION`). Bump `PIPELINE_VERSION` only on an output-affecting change made after Task 34.

**Document and wire contracts**
- **Units:** every length in `PlanDocument` is an integer in millimetres. Document coordinates are `x_mm = round(x_px × mmPerPixel)` with the normalized page image's top-left pixel at `(0, 0)` (06 I3). `background.position = {x: 0, y: 0}` and `rotation = 0`.
- **Plan space:** x → right, y → down, angles in degrees. A wall's normal is `n = (d.y, −d.x)`, and `+n` is the **left** side when walking a→b (04 §2.1). `swing = 'left'` means the leaf opens toward `+n`.
- **Entity ids:** `{prefix}_{10 chars from 0123456789abcdefghijklmnopqrstuvwxyz}`, generated with `secrets.choice` (master §6.3). Prefixes: `n`, `w`, `o`, `r`, `t`.
- **Candidate ids** (`T…`, `S…`, `L…`, `D…`, `W…`, `N…`, `O…`, `R…`) are deterministic: numbered after a stable geometric sort. ReplayProvider fixtures depend on this.
- **Wire format:** all JSON is camelCase. Pydantic models inherit `app.schemas.base.CamelModel` (`alias_generator=to_camel`, `populate_by_name=True`, `extra="forbid"`) with snake_case attributes, and are serialized with `model_dump(mode="json", by_alias=True)`.
- **Error body:** `{"error": {"code", "message", "retryable", "details", "usage"}}`, using the HTTP status from 06 §14.2.
- **Authentication:** every endpoint except `GET /healthz` requires `Authorization: Bearer <VISION_SERVICE_TOKEN>`, compared with `hmac.compare_digest`.

**LLM rules**
- Calls go only through `LLMProvider.complete(...)` (18 §6.1).
- `tool_choice` is only ever `"auto"` or `"none"`; forced tool choice is rejected by `claude-opus-5-5`.
- Never send `thinking: {type: "disabled"}`, `budget_tokens` or an assistant prefill.
- Conversation history is append-only: provider-native assistant content is replayed unchanged.
- The Anthropic default model is `claude-opus-5-5`, with `thinking: {"type": "adaptive"}` and `output_config.effort` always sent explicitly.
- The OpenAI model is never hard-coded.
- Coordinates exchanged with any model are absolute integer overview pixels.

**Secrets and logging**
- Never log or return secret values (`*_API_KEY`, `*_TOKEN`), presigned query strings (`X-Amz-*`), or prompts and model responses.
- `/v1/capabilities` lists missing variable **names** only.

**Deadlines and resources**
- Deadlines: `/v1/recognize` 570 s (`VISION_RECOGNIZE_DEADLINE_S`), `/v1/normalize` 100 s, `/v1/inspect` 25 s, `/v1/images/normalize` 60 s. Labeling degrades instead of failing (06 §9.6).
- Resources: working image ≤ 40 MP, decode limit 120 MP, OCR in 1280 px tiles, `cv2.setNumThreads(2)`, onnxruntime `intra_op_num_threads = 2`, and `gc.collect()` after every heavy request. Heavy CPU work runs in `anyio.to_thread.run_sync`.

**Tests**
- Tests never touch the real network or real provider APIs. Live provider tests are marked `@pytest.mark.live` and excluded by default.
- Synthetic images are generated inside tests through `tests/support/synth.py` (Task 10).
- The only binary fixtures are the two committed reference images plus JSON fixtures under `tests/fixtures/`.

**Architecture boundaries**
- Stage boundaries must stay replaceable (06 I12): `walls.py`, `graph.py`, `openings.py` and `rooms.py` communicate only through `app/schemas/candidates.py` types.
- The `RecognitionVendor` protocol exists in `labeling/vendor.py` with no implementation (06 §9.8).

**Commits**
- Conventional commits. Every commit gets the trailer below; export it once per shell before committing:

  ```bash
  export FURNY_TRAILER='Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01X1MLnD93h3fkmdHrLPbw3u'
  ```

  Then commit with `git commit -m "<subject>" -m "$FURNY_TRAILER"`.

## Review Focus

These are the five input classes most likely to bite real users. Each has a named test in its owning task.

1. **Tiny, colourful real-estate brochures** (`brochure-2bhk.png` is only 381×540 px) that include a key-plan inset. Risk points: the upscale path, colour-brochure wall isolation, and plan-region detection excluding the inset. Tests: `test_region_excludes_far_inset` (Task 10), `test_low_resolution_upscaled` (Task 9) and the brochure inset assertion in Task 34.
2. **Phone photos of paper drawings** with perspective, EXIF rotation and uneven lighting. Tests: `test_photo_quad_detected_and_rectified` (Task 9), `test_exif_orientation_applied` (Task 7) and `test_illumination_flattening` (Task 10).
3. **OCR-confused imperial and room text**: `10'0"X11'0"`, curly quotes `12’3”x7’11”`, `T0ILET`, `33OO`, `912 SQ.FT`. Test: `test_ocr_confusions` (Task 12).
4. **LLM misbehaviour**: refusal, max-tokens truncation, invalid JSON, unknown ids, a 9th crop request, or a timeout near the deadline. Each must fall back to provider `none` while still reporting usage with `status: failed`. Tests: `test_refusal_falls_back`, `test_crop_budget`, `test_timeout_finalize_then_fallback` (Task 27) and `test_unknown_ids_sanitised` (Task 26).
5. **Hostile or oversized files**: decompression bombs above 120 MP, streams over the byte cap, 21-page PDFs, a DWG renamed to `.dxf`, encrypted PDFs, DXF files above 200 000 entities. Each must map to its exact error code and HTTP status without exhausting memory. Tests: `test_stream_cap` (Task 6), `test_decompression_bomb_rejected` and `test_dwg_magic` (Task 7), `test_encrypted_pdf` (Task 8), `test_inspect_pdf_too_many_pages` (Task 29) and `test_dxf_too_complex` (Task 30).

## Task order

1. Scaffold
2. Config and logging
3. API core
4. Plan and meta schemas
5. API, labeling and strict schemas
6. Context, I/O and fetch
7. Decode
8. PDF
9. Rectify and normalize
10. Preprocess and synthetic drawings
11. Text parsing
12. OCR
13. Segments
14. Dimensions
15. Wall graph
16. Walls
17. Openings
18. Rooms
19. Heuristic labeler
20. Scale
21. Assemble and validate
22. Provider core
23. Annotate and tools
24. Anthropic adapter
25. OpenAI and compatible adapters
26. LLM labeler
27. Agent loop
28. DXF reader and layers
29. Inspect and normalize endpoints
30. DXF geometry
31. Recognize endpoint
32. Expected reference documents
33. Evaluation harness
34. Reference integration

Each task depends only on lower-numbered tasks.

---

### Task 1: Project scaffold, dependencies, deployment files

**Files:**
- Create: `vision/pyproject.toml`, `vision/.python-version`, `vision/uv.lock`, `vision/requirements.txt`, `vision/nixpacks.toml`, `vision/.dockerignore`, `vision/.gitignore`
- Create: `vision/app/__init__.py`, plus empty `__init__.py` in `vision/app/{api,schemas,pipeline,pipeline/labeling,pipeline/dxf,providers,ocr,utils}/`
- Create: `vision/scripts/.gitkeep`, `vision/tests/conftest.py`, `vision/tests/support/__init__.py`
- Test: `vision/tests/test_smoke.py`

**Spec refs:** `01 §1.3`, `06 §5.1`, `17 §5.9`, `17 §10.2` (vision CI job), `19` 06-B1

**Interfaces:**
- Produces: `app.__version__ = "1.0.0"`, `app.PIPELINE_VERSION = "1.0.0"`. Pytest markers `live` and `slow`. Pytest `pythonpath = ["."]` so `import app` works from `vision/`.

- [ ] **Step 1: Write the failing test.** `tests/test_smoke.py` contains:
  - `test_python_is_312`: `assert sys.version_info[:2] == (3, 12)`.
  - `test_versions`: `assert app.__version__ == "1.0.0" and app.PIPELINE_VERSION == "1.0.0"`.
  - `test_native_imports`: imports `cv2, numpy, scipy, shapely, skimage, onnxruntime, rapidocr, pdfplumber, pypdfium2, ezdxf, pi_heif, PIL, fastapi, anthropic, openai, httpx`, then asserts `cv2.__version__.startswith("4.")`.
  - `test_rapidocr_models_bundled`: monkeypatch `socket.socket.connect` to raise `OSError("network disabled")`, then construct `RapidOCR(params={"Global.log_level": "error"})` without error. This proves the models come from the wheel.
- [ ] **Step 2: Run it, expect FAIL.** Command: `UV_PYTHON_DOWNLOADS=never uv run pytest tests/test_smoke.py -q`. Expected: no `pyproject.toml` yet, or `ModuleNotFoundError: No module named 'app'`.
- [ ] **Step 3: Implement.**
  - **`pyproject.toml`.** `[project]` dependencies, each with a lower bound:
    - `fastapi>=0.115`, `uvicorn[standard]>=0.32`, `pydantic>=2.9`, `pydantic-settings>=2.6`
    - `opencv-python-headless>=4.10,<5`, `numpy>=2.0`, `scipy>=1.14`, `shapely>=2.0`, `scikit-image>=0.24`
    - `rapidocr>=3.4,<4`, `onnxruntime>=1.20`, `pdfplumber>=0.11`, `pypdfium2>=4.30`, `pi-heif>=0.20`, `pillow>=11`, `ezdxf>=1.3`
    - `httpx>=0.28`, `anthropic>=1.17,<2`, `openai>=3.35,<4`, `anyio>=4.6`, `sentry-sdk[fastapi]>=2,<3`

    Sentry is a regular dependency, imported lazily only when `SENTRY_DSN` is set. `[dependency-groups] dev = ["pytest>=8.3", "ruff>=0.8", "mypy>=1.13", "pypdf>=5", "httpx2>=2.0"]`. `[tool.uv] package = false`.
  - **`[tool.pytest.ini_options]`:** `pythonpath = ["."]`, `testpaths = ["tests"]`, `addopts = ["-m", "not live"]`, markers `live: real provider calls (manual/nightly)` and `slow: >5 s`.
  - **`[tool.ruff]`:** `target-version = "py312"`, `line-length = 110`. `lint.select = ["E","F","W","I","B","UP","N","SIM","RUF"]`, `lint.ignore = ["N803","N806"]` (math names such as `L`, `W`, `H`).
  - **`[tool.mypy]`:** `python_version = "3.12"`, `strict = true`, `plugins = ["pydantic.mypy"]`, `warn_unreachable = true`. Add an override with `ignore_missing_imports = true` for `skimage.*, scipy.*, pdfplumber.*, rapidocr.*, pi_heif.*, shapely.*, pypdfium2.*`.
  - **`nixpacks.toml`:** exactly the content of 17 §5.9 (start command `uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 2 --timeout-graceful-shutdown 30`).
  - **`.dockerignore`:** exactly 17 §5.9. **`.gitignore`:** `.venv/`, `__pycache__/`, `tests/out/`, `eval-out/`, `.mypy_cache/`, `.ruff_cache/`, `.pytest_cache/`.
  - **Lock and export:** `export UV_PYTHON_DOWNLOADS=never; uv lock && uv sync && uv export --frozen --no-dev --no-hashes --no-emit-project -o requirements.txt`.
- [ ] **Step 4: Run tests, expect PASS.** Command: `uv run pytest tests/test_smoke.py -q`.
- [ ] **Step 5: Quality gates.**
  ```bash
  uv run ruff check . && uv run ruff format --check . && uv run mypy app
  uv export --frozen --no-dev --no-hashes --no-emit-project -o /tmp/req.txt && diff -u requirements.txt /tmp/req.txt
  ```
- [ ] **Step 6: Commit.** `git add vision/` then `git commit -m "chore(vision): scaffold furny-vision service with uv, ruff, mypy, nixpacks" -m "$FURNY_TRAILER"`.

---

### Task 2: Settings and JSON logging with redaction

**Files:**
- Create: `vision/app/config.py`, `vision/app/logging.py`
- Test: `vision/tests/test_config.py`, `vision/tests/test_logging.py`

**Spec refs:** `18 §4` (every variable), `06 §5.3`, `17 §6.2`

**Interfaces:**
- Produces:
  - `class Settings(BaseSettings)` with one snake_case field per 18 §4 variable, for example `vision_service_token: SecretStr`, `anthropic_api_key: SecretStr | None`, `openai_compat_supports_tools: bool`. Configured with `case_sensitive=False` and `env_file=None`.
  - `get_settings() -> Settings` (cached with `functools.lru_cache`; tests call `get_settings.cache_clear()`).
  - `configure_logging(level: str) -> None`.
  - `request_id_var: ContextVar[str | None]`.
  - `class JsonFormatter(logging.Formatter)` and `class RedactionFilter(logging.Filter)`.
  - Logger name `furny.vision`.

- [ ] **Step 1: Write the failing test.**
  - `test_token_required_and_min_length`: with no `VISION_SERVICE_TOKEN`, `Settings()` raises `ValidationError`; 31 characters also raises; 32 characters passes.
  - `test_defaults` pins every 18 §4 default:

    ```python
    s = Settings(vision_service_token="x" * 32)
    assert (s.vision_recognize_deadline_s, s.vision_llm_stage_budget_s, s.vision_llm_call_timeout_s) == (570, 420, 180)
    assert (s.vision_agent_max_turns, s.vision_agent_max_crops) == (10, 8)
    assert (s.vision_max_source_bytes, s.vision_max_pixels, s.vision_heavy_slot_wait_s) == (26214400, 40000000, 2)
    assert (s.anthropic_model, s.anthropic_max_image_px, s.anthropic_max_output_tokens, s.anthropic_server_fallback) == ("claude-opus-5-5", 2576, 32000, True)
    assert (s.openai_max_image_px, s.openai_max_output_tokens, s.openai_send_reasoning_effort) == (2048, 32000, True)
    assert s.openai_compat_api_key.get_secret_value() == "not-needed"
    assert (s.openai_compat_supports_vision, s.openai_compat_supports_tools, s.openai_compat_supports_json_schema) == (True, False, False)
    assert (s.openai_compat_max_image_px, s.openai_compat_max_images_per_request, s.openai_compat_max_output_tokens) == (1280, 1, 8192)
    assert (s.openai_compat_send_reasoning_effort, s.openai_compat_timeout_s, s.vision_log_level) == (False, 300, "info")
    ```
  - `test_blank_optional_env_is_none`: `monkeypatch.setenv("OPENAI_API_KEY", "")` results in `Settings(...).openai_api_key is None`.
  - `test_json_log_shape`: with `request_id_var` set to `"01JB"`, `logger.info("hello", extra={"stage": "ocr", "durationMs": 12})` outputs one JSON line with keys `ts, level, msg, requestId, stage, durationMs`.
  - `test_redacts_secrets_and_presigned`: with env `ANTHROPIC_API_KEY=sk-ant-secret-123456` and `VISION_SERVICE_TOKEN=t`×32, logging `"key sk-ant-secret-123456 url https://s3/x.png?X-Amz-Signature=abc&X-Amz-Credential=def"` produces output that contains neither `sk-ant-secret-123456` nor `X-Amz-Signature=abc`, but does contain `[REDACTED]`.
- [ ] **Step 2: Run it, expect FAIL.** Command: `uv run pytest tests/test_config.py tests/test_logging.py -q`. Expected: `ImportError`.
- [ ] **Step 3: Implement.**
  - **Settings.** One field per 18 §4 row with the stated defaults. Secrets use `SecretStr`. A `field_validator(mode="before")` maps `""` to `None` for optional fields. The token has `min_length=32`.
  - **RedactionFilter.** At construction it collects the non-empty values (length ≥ 8) of environment variables whose names end in `_API_KEY` or `_TOKEN`. In `record.getMessage()` and in string `extra` values it replaces each with `[REDACTED]`. It also rewrites any URL query string containing `X-Amz-` with the regex `(\?[^\s"']*X-Amz-[^\s"']*)` → `?[REDACTED]`.
  - **JsonFormatter.** Emits `ts` (ISO-8601 UTC with milliseconds), `level` (lowercase), `msg`, `requestId` (from the context variable) and every extra key that is not a standard `LogRecord` attribute.
- [ ] **Step 4: Run tests, expect PASS.** Same command as Step 2.
- [ ] **Step 5: Quality gates.** `uv run ruff check . && uv run ruff format --check . && uv run mypy app`
- [ ] **Step 6: Commit.** `git add vision/app/config.py vision/app/logging.py vision/tests/test_config.py vision/tests/test_logging.py` then `git commit -m "feat(vision): settings from env and redacting JSON logging" -m "$FURNY_TRAILER"`.

---

### Task 3: API core: errors, auth, concurrency slots, app factory, `/healthz`

**Files:**
- Create: `vision/app/api/errors.py`, `vision/app/api/deps.py`, `vision/app/api/health.py`, `vision/app/main.py`
- Test: `vision/tests/test_api.py`

**Spec refs:** `06 §5.2`, `06 §5.3`, `06 §5.7` (`/healthz`), `06 §14.2`, `17 §4.1`

**Interfaces:**
- Consumes: `Settings`, `get_settings`, `configure_logging`, `request_id_var` (Task 2).
- Produces:
  - `class VisionError(Exception)`, constructed as `__init__(code: str, message: str = "", *, http_status: int | None = None, retryable: bool | None = None, details: dict[str, Any] | None = None, usage: Any = None, headers: dict[str, str] | None = None)`. Status and retryability default from `ERROR_TABLE: dict[str, tuple[int, bool]]`.
  - `error_response(err: VisionError) -> JSONResponse`.
  - `require_token` (FastAPI dependency).
  - `heavy_slot` and `light_slot` (async generator dependencies).
  - `create_app(settings: Settings | None = None, *, ocr_factory: Callable[[], Any] | None = None) -> FastAPI`, plus module-level `app = create_app()` created lazily via `def __getattr__`. `app.main:app` must work under uvicorn without constructing settings at import time in tests.
  - `app.state` attributes: `settings`, `heavy_sem`, `light_sem`, `ocr`, `ocr_loaded: bool`, `provider_factory`, `io_factory`. The last two are set to `None` here and filled in Tasks 22 and 6.

- [ ] **Step 1: Write the failing test** `tests/test_api.py`. Use a fixture `make_client(**settings_overrides)` that builds `create_app(Settings(vision_service_token=TOKEN, **ov), ocr_factory=lambda: object())`, adds dummy routes with `app.add_api_route` (one per dependency: `require_token`, `heavy_slot`, `light_slot`, a pydantic-body POST, and a route that raises `RuntimeError("boom")`), and enters `with TestClient(app)`.
  - `test_healthz_no_auth`: returns 200 `{"status": "ok", "version": "1.0.0", "ocrLoaded": True}` once loaded.
  - `test_healthz_503_until_ocr_loaded`: `ocr_factory` blocks on a `threading.Event` → 503 with `ocrLoaded: False`; after `event.set()` and polling ≤ 2 s → 200.
  - `test_auth`: missing header, `Bearer wrong` and `Basic x` each give 401 with body `{"error": {"code": "unauthorized", "message": ..., "retryable": False, "details": {}, "usage": None}}`; the correct token gives 200.
  - `test_busy`: with `vision_heavy_slot_wait_s=0.1` and `app.state.heavy_sem` acquired in the test, the heavy route returns 503, header `Retry-After == "20"`, body `code == "busy"` and `retryable is True`.
  - `test_validation_error_is_400`: body code `invalid_request`, with `details.errors` a list of `{loc, msg}`.
  - `test_unexpected_exception_is_500`: code `internal_error`, `retryable` true, and `"boom"` not in the response text.
  - `test_request_id_echoed`: the `X-Request-Id: abc` request header is echoed in the response header.
  - `test_error_table`: pins every 06 §14.2 row, for example `ERROR_TABLE["file_too_large"] == (413, False)`, `["dwg_not_supported"] == (415, False)`, `["no_walls_detected"] == (422, False)`, `["source_unavailable"] == (502, True)`, `["provider_error"] == (502, True)`, `["upload_failed"] == (502, True)`, `["busy"] == (503, True)`, `["deadline_exceeded"] == (504, False)`, `["internal_error"] == (500, True)`, `["invalid_page"] == (400, False)`, `["provider_not_configured"] == (400, False)`. It also pins the 06 §5.8 codes `decode_failed` (422), `too_large` (413) and `unsupported` (415).
- [ ] **Step 2: Run it, expect FAIL.** Command: `uv run pytest tests/test_api.py -q`. Expected: `ImportError`.
- [ ] **Step 3: Implement.**
  - **`deps.py`.**
    - `require_token` parses the `Authorization` header (case-insensitive scheme `Bearer`) and compares the token with `hmac.compare_digest`.
    - `heavy_slot` does `await asyncio.wait_for(sem.acquire(), settings.vision_heavy_slot_wait_s)` and raises `VisionError("busy", headers={"Retry-After": "20"})` on timeout; it releases in `finally`.
    - `light_slot` uses the same waiting rule on the `Semaphore(2)`. The spec does not state the light-slot rule; it is recorded in the gap list.
  - **Semaphores** are created in the lifespan, so each uvicorn worker process gets its own.
  - **Lifespan.**
    - `cv2.setNumThreads(2)` and `configure_logging(settings.vision_log_level)`.
    - Initialise Sentry only when `SENTRY_DSN` is set.
    - Start background OCR loading with `asyncio.create_task(anyio.to_thread.run_sync(factory))`, setting `ocr_loaded = True` when done. The default factory is wired in Task 12.
  - **Request-id middleware.** Reads `X-Request-Id` (otherwise `uuid4().hex`), sets the context variable, echoes the header, and logs one access line `{msg: "request", path, status, durationMs}`.
  - **Exception handlers** for `VisionError`, `RequestValidationError` (→ `invalid_request`) and `Exception` (→ `internal_error` with message `"Internal error"`; the stack goes to the logs).
- [ ] **Step 4: Run tests, expect PASS.** Same command as Step 2.
- [ ] **Step 5: Quality gates.** `uv run ruff check . && uv run ruff format --check . && uv run mypy app`
- [ ] **Step 6: Commit.** `git add vision/app/api vision/app/main.py vision/tests/test_api.py` then `git commit -m "feat(vision): app factory, bearer auth, busy slots, error mapping, healthz" -m "$FURNY_TRAILER"`.

---

### Task 4: `PlanDocument` and `ImportResultMeta` schemas, id generator

**Files:**
- Create: `vision/app/schemas/base.py`, `vision/app/schemas/plan.py`, `vision/app/schemas/meta.py`, `vision/app/utils/ids.py`
- Test: `vision/tests/test_schemas_plan_meta.py`

**Spec refs:** `03 §1`, `03 §1.1` (numeric ranges), `06 §6` (whole section, including the warning-code table), master §6.3

**Interfaces:**
- Produces:
  - `CamelModel`, with `CamelModel.wire() -> dict[str, Any]`.
  - Plan models in `plan.py`: `PlanDocument`, `PlanMeta`, `WallNode`, `Wall`, `Opening`, `RoomMeta`, `FurniturePlacement`, `Fixture`, `DimensionAnnotation`, `TextLabel`, `Annotations`, `BackgroundImage`, `ViewState`, `Point`.
  - Literal types: `RoomType`, `DoorType`, `WindowType`.
  - Meta types in `meta.py`:
    - Literals `ProviderName`, `ScaleMethod`, `StageKey`, `SourceKind`, `DrawingKind`, `FallbackReason`, `WarningCode`, `ReasonCode`.
    - Models `MetaWarning(code, params: dict[str, str | int | float], entity_ids: list[str])`, `PageImage`, `PlanRegion`, `ScaleSample`, `RoomLabelCheck`, `ScaleMeta`, `ConfidenceMeta`, `OcrTokenStats`, `MetaCounts`, `ImportResultMeta`.
  - `new_id(prefix: str) -> str` in `ids.py`.

- [ ] **Step 1: Write the failing test.**
  - `test_new_id_format`: `re.fullmatch(r"w_[0-9a-z]{10}", new_id("w"))`, the same for `"fr"`, and 1000 generated ids are unique.
  - `test_plan_roundtrip_camel`: a minimal document with 2 nodes, 1 wall (`thickness=115, height=2700, kind="interior", justification="center", material="brick", colorHex=None`), 1 door, 1 RoomMeta, a background (`mmPerPixel=10.5`) and `view={"mode2d": None, "mode3d": None, "lastMode": "2d"}`, built from camelCase JSON. `PlanDocument.model_validate(js).wire() == js`.
  - `test_plan_ranges`: each of these raises `ValidationError`: wall thickness 40 or 1001, height 299, opening width 299 or 6001, sill 3001, node `x = 1_000_001`, `schemaVersion = 2`, an extra unknown key.
  - `test_room_types`: `set(get_args(RoomType))` equals the 19 values of 03 §1 (`living … other`).
  - `test_warning_codes_exact`: `set(get_args(WarningCode))` equals the 26 codes of 06 §6, from `low_resolution` to `plan_validation_warning`.
  - `test_reason_codes_exact`: the 13 reason codes.
  - `test_meta_roundtrip`: a full `ImportResultMeta` example serializes with keys `metaVersion`, `pageImage.resampleFactor`, `scale.roomLabelCheck.medianDiscrepancyPct`, `timings.totalMs` and `ocrTokens.metricDimensionTokens`; `metaVersion` must be literally `1`.
- [ ] **Step 2: Run it, expect FAIL.** Command: `uv run pytest tests/test_schemas_plan_meta.py -q`.
- [ ] **Step 3: Implement.**
  - Field names are snake_case; aliases come from `to_camel` (`mode2d` stays `mode2d`).
  - `Mm` is `int`. `mmPerPixel` is `float > 0` and `opacity` is `0..1`. Ranges follow 03 §1.1 via `Field(ge=…, le=…)`. Coordinates use `ge=-1_000_000, le=1_000_000`.
  - `placements` and `fixtures` are included as dicts of their models; P3 always emits them empty.
  - `timings: dict[str, int]` must contain `totalMs`, and every other key must be a `StageKey`.
  - `inspect` and `review` are optional (Laravel adds them).
- [ ] **Step 4: Run tests, expect PASS.** Same command as Step 2.
- [ ] **Step 5: Quality gates.** `uv run ruff check . && uv run ruff format --check . && uv run mypy app`
- [ ] **Step 6: Commit.** `git add vision/app/schemas vision/app/utils/ids.py vision/tests/test_schemas_plan_meta.py` then `git commit -m "feat(vision): PlanDocument and ImportResultMeta pydantic mirrors" -m "$FURNY_TRAILER"`.

---

### Task 5: API request/response models, `LabelingResult`, strict JSON schema, JSON parsing

**Files:**
- Create: `vision/app/schemas/api.py`, `vision/app/schemas/labeling.py`, `vision/app/utils/json_schema.py`
- Test: `vision/tests/test_schemas_api.py`, `vision/tests/test_json_schema.py`

**Spec refs:** `06 §5.4`–`§5.8`, `06 §9.4`, `06 §10.4` (`LayerMapping`), `18 §5.1`, `18 §5.3`, `18 §6.4`

**Interfaces:**
- Produces, in `api.py`:
  - Source and output: `SourceRef(url, filename, mime_type, source_kind: SourceKind | None = None)`, `RecognizeOutput(normalized_put_url, debug_put_urls: list[str] = [] (max 8))`.
  - Hints and options: `RecognizeHints(unit_system, known_dimension: KnownDimension | None, wall_height_mm, is_photo: bool = False, corners)`, `RecognizeDefaults`, `RecognizeOptions(provider, model, effort, agentic_crops, fallback_to_none_on_error, selected_page=1, hints, defaults, locale="en", debug=True)`.
  - Endpoint models: `RecognizeRequest`, `RecognizeResponse`, `InspectRequest`, `InspectResponse` (with `InspectPage`, `EncodedImage`, `PhotoInfo`, `DxfInfo`), `NormalizeRequest`, `NormalizeResponse` (with `ScaleNoteOut`), `ImageNormalizeRequest`, `ImageNormalizeResponse`.
  - Usage: `UsageCallOut`, `UsageTotals`, `Usage(provider, model, calls, totals, status)`.
  - Misc: `DebugArtifact(index, name, content_type)`, `ProviderInfo`, `CapabilitiesResponse`, `ProviderTestRequest`, `ProviderTestResponse`.
- Produces, in `labeling.py`: exactly the models of 06 §9.4 (`TextLabel_`, `DimensionLabel`, `RoomLabel`, `MissedRoom`, `WallLabel`, `OpeningLabel`, `MissedOpening`, `KnownDimensionMatch`, `LabelingResult`, plus `RoomTypeLit`, `DoorTypeLit`, `WindowTypeLit`) and `LayerMapping(layers: list[LayerRoleItem])`. All inherit `CamelModel`, so JSON names equal the spec names.
- Produces, in `json_schema.py`: `to_strict_schema(model: type[BaseModel]) -> dict[str, Any]` and `parse_json_object(text: str) -> dict[str, Any]` (raises `ValueError`).

- [ ] **Step 1: Write the failing test.**
  - `test_recognize_request_example`: the JSON of 06 §5.5 validates. `options.effort == "high"`, `options.defaults.wall_height_mm == 2700`, `options.defaults.interior_wall_thickness_mm == 115`. Setting `provider: "gemini"` fails, and 9 debug URLs fail.
  - `test_inspect_response_example` and `test_capabilities_example`: the JSON examples of 06 §5.4 and 18 §5.1 validate and round-trip with `wire()`.
  - `test_images_normalize_ranges`: `quality` 0 and 101 fail, `maxEdge` 63 and 8193 fail, format `gif` fails.
  - `test_strict_schema` (on `to_strict_schema(LabelingResult)`):
    - `"$ref" not in json.dumps(s)` and `"$defs" not in s`.
    - For every nested object node, `node["additionalProperties"] is False` and `set(node["required"]) == set(node["properties"])`.
    - No keys `title`, `description`, `default`, `minimum` or `maximum` anywhere.
    - `s["properties"]["knownDimensionMatch"]` is an `anyOf` containing `{"type": "null"}`.
    - `s["properties"]["drawingKind"]["enum"]` has the 6 values.
  - `test_parse_json_object`: `parse_json_object('```json\n{"a":1}\n```') == {"a": 1}`; `'Sure! {"a": {"b": 2}} thanks'` gives `{"a": {"b": 2}}`; `"no json"` raises `ValueError`.
- [ ] **Step 2: Run it, expect FAIL.** Command: `uv run pytest tests/test_schemas_api.py tests/test_json_schema.py -q`.
- [ ] **Step 3: Implement.**
  - **Strict schema:** `model.model_json_schema(mode="serialization", by_alias=True)`, recursively inline `$ref` from `$defs`, add `additionalProperties: false` and full `required` to every `type: object`, and strip `title`, `description`, `default`, `minimum`, `maximum`, `exclusiveMinimum` and `exclusiveMaximum`.
  - **`parse_json_object`:** strip whitespace and ```` ``` ```` / ```` ```json ```` fences, take the substring from the first `{` to the last `}`, `json.loads` it, and require a dict.
- [ ] **Step 4: Run tests, expect PASS.** Same command as Step 2.
- [ ] **Step 5: Quality gates.** `uv run ruff check . && uv run ruff format --check . && uv run mypy app`
- [ ] **Step 6: Commit.** `git add vision/app/schemas/api.py vision/app/schemas/labeling.py vision/app/utils/json_schema.py vision/tests/test_schemas_api.py vision/tests/test_json_schema.py` then `git commit -m "feat(vision): API models, LabelingResult and strict JSON schema" -m "$FURNY_TRAILER"`.

---

### Task 6: Pipeline context, debug sink, source I/O, fetch and upload

**Files:**
- Create: `vision/app/pipeline/context.py`, `vision/app/pipeline/debug.py`, `vision/app/pipeline/fetch.py`, `vision/app/utils/http.py`, `vision/app/utils/timing.py`
- Modify: `vision/app/main.py` (default `app.state.io_factory = lambda: HttpIO()`)
- Test: `vision/tests/test_fetch.py`, `vision/tests/test_context.py`

**Spec refs:** `06 §7` intro, `06 §7.1`, `06 §5.2` (deadlines), `06 §13`, `06 §14.2` (`upload_failed`)

**Interfaces:**
- Produces, in `utils/http.py`:
  - `class SourceIO(Protocol)` with `fetch(url: str, max_bytes: int, timeout_s: float = 30) -> bytes` and `put(url: str, data: bytes, content_type: str) -> None`.
  - `HttpIO(client: httpx.Client | None = None, sleep: Callable[[float], None] = time.sleep)`.
  - `LocalIO()` for `file://` URLs on both fetch and put.
- Produces, in `fetch.py`: `fetch_source(url, max_bytes, ctx, timeout_s=30) -> bytes` and `upload_bytes(url, data, content_type, ctx) -> None`.
- Produces, in `context.py`: `PipelineContext(deadline: float, io: SourceIO, debug: DebugSink, request_id: str | None)` with:
  - `timings: dict[str, int]` and `warnings: list[MetaWarning]`
  - `@classmethod for_request(seconds: float, io: SourceIO, *, debug: bool, request_id: str | None = None)`
  - `remaining() -> float`, `check_deadline() -> None`
  - `stage(name: StageKey) -> ContextManager[None]`
  - `warn(code: WarningCode, params: dict[str, str | int | float] | None = None, entity_ids: Sequence[str] = ()) -> None`
- Produces, in `debug.py`: `DebugSink(enabled: bool)` with `add_png(index: int, name: str, img: np.ndarray)`, `add_json(index: int, name: str, obj: Any)` and `flush(put_urls: list[str], io: SourceIO) -> list[DebugArtifact]`.

- [ ] **Step 1: Write the failing test.** Uses `httpx.MockTransport`.
  - `test_fetch_ok`: a 200 response of 1000 bytes is returned exactly.
  - `test_stream_cap`: a 2 MB streamed body with `max_bytes=1_000_000` raises `VisionError` `file_too_large`. Assert the handler streamed through a generator and fetching stopped after at most 1 extra chunk.
  - `test_fetch_non_200` and `test_fetch_connect_error`: both give `source_unavailable` with `retryable=True`.
  - `test_put_retries`: the handler returns 500, 500, then 200. `HttpIO(sleep=fake)` records sleeps `[1, 2]`, and the request header `Content-Type == "image/png"`.
  - `test_put_gives_up`: 500 three times gives `upload_failed`, after 3 attempts total.
  - `test_local_io_roundtrip(tmp_path)`.
  - `test_deadline`: `ctx = PipelineContext.for_request(0.01, ...)`, sleep 0.02 s, then `ctx.check_deadline()` raises `deadline_exceeded` with status 504 and `retryable=False`.
  - `test_stage_timings_accumulate`: `ctx.timings["ocr"] >= 0`.
  - `test_warn_dedupes`: the same code with the same params is recorded once.
  - `test_debug_sink`: when disabled, `flush` performs no PUTs and returns `[]`. When enabled with 2 artifacts, it PUTs `image/png` and `application/json` bodies to `put_urls[index]` and returns `[DebugArtifact(0, "01-ink.png", "image/png"), …]`. An index ≥ 8 or beyond `len(put_urls)` is ignored. A PUT failure is logged and that artifact omitted (debug output is non-essential).
- [ ] **Step 2: Run it, expect FAIL.** Command: `uv run pytest tests/test_fetch.py tests/test_context.py -q`.
- [ ] **Step 3: Implement.**
  - **`HttpIO.fetch`** uses `client.stream("GET", url, timeout=timeout_s)` and accumulates chunks against the cap.
  - **`HttpIO.put`**: 3 attempts total, sleeping 1 s before attempt 2 and 2 s before attempt 3. 06 §14.2 says "3 attempts, 1/2/4 s", so the 4 s wait is never reached; this is recorded in the gap list.
  - **`fetch_source` and `upload_bytes`** wrap the io calls in `ctx.check_deadline()`.
  - **`timing.py`** provides `monotonic_ms()`.
- [ ] **Step 4: Run tests, expect PASS.** Same command as Step 2.
- [ ] **Step 5: Quality gates.** `uv run ruff check . && uv run ruff format --check . && uv run mypy app`
- [ ] **Step 6: Commit.** `git add vision/app/pipeline/context.py vision/app/pipeline/debug.py vision/app/pipeline/fetch.py vision/app/utils/http.py vision/app/utils/timing.py vision/app/main.py vision/tests/test_fetch.py vision/tests/test_context.py` then `git commit -m "feat(vision): pipeline context, debug sink, presigned-URL I/O" -m "$FURNY_TRAILER"`.

---

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

### Task 8: PDF rendering and vector extraction

**Files:**
- Create: `vision/app/pipeline/pdf.py`, `vision/tests/support/pdfgen.py`
- Test: `vision/tests/test_pdf.py`

**Spec refs:** `06 §5.4` (vector rule ≥ 200 objects), `06 §7.2` (PDF raster DPI rule and vector extraction), `06 §2.2` (≤ 20 pages)

**Interfaces:**
- Produces:
  - `pdf_page_count(data: bytes) -> int`, which raises `pdf_encrypted` or `corrupt_file`.
  - `page_size_pt(data, page_number: int) -> tuple[float, float]`.
  - `render_dpi(w_pt: float, h_pt: float) -> float`.
  - `render_pdf_page(data, page_number: int, dpi: float | None = None) -> RenderedPage(image, dpi, width_pt, height_pt)`, which raises `invalid_page`.
  - `classify_pdf_page(data, page_number) -> Literal["pdf_vector", "pdf_raster"]`.
  - `extract_vector_page(data, page_number, dpi) -> VectorPage`, with these dataclasses:
    - `VectorPage(segments: list[VSeg], filled: list[VPolygon], words: list[VWord], object_count: int)`
    - `VSeg(p0, p1, width_px)`, `VPolygon(points)`, `VWord(text, box: tuple[float, float, float, float], angle: Literal[0, 90])`
  - `is_standard_paper(w_pt, h_pt) -> bool` (ISO A0–A4 or ANSI A–E, ±2 %, either orientation).
- Produces, in tests: `pdfgen.make_pdf(pages: list[PageSpec]) -> bytes`, with `PageSpec(width_pt, height_pt, lines: list[tuple[float, float, float, float, float]], words: list[tuple[float, float, str, float]], filled_rects: list[tuple[float, float, float, float]])`. It writes raw PDF syntax: an xref table, the Helvetica standard font, and `m l S` / `re f` / `BT Tf Td Tj ET` content in top-left coordinates converted to PDF bottom-left.

- [ ] **Step 1: Write the failing test.**
  - `test_render_dpi_rule`: `render_dpi(595.3, 841.9) == 300`; `render_dpi(2384, 3370) ≈ 6000 / (3370 / 72) ≈ 128.2` (±0.1); `render_dpi(14400, 14400) == 72`.
  - `test_render_shape`: an A4 page rendered gives an image of shape `(round(841.9 * 300 / 72), round(595.3 * 300 / 72), 3)` ±1.
  - `test_classify`: a page with 250 lines → `"pdf_vector"`; 10 lines → `"pdf_raster"`.
  - `test_vector_coords`: a line from (72, 72) to (144, 72) pt with width 1 at dpi 150 → `VSeg` p0 ≈ (150, 150), p1 ≈ (300, 150), `width_px ≈ 2.08`. A word `"SCALE 1:100"` at (100, 100) is present with `angle == 0`. A filled rect with black fill → one `VPolygon` with 4 points.
  - `test_page_count_and_invalid_page`: 21 pages → `pdf_page_count == 21`; `render_pdf_page(data, 22)` → `invalid_page`.
  - `test_encrypted_pdf`: encrypt with `pypdf.PdfWriter.encrypt("pw", algorithm="RC4-128")` → `pdf_page_count` raises `pdf_encrypted` (422).
  - `test_corrupt_pdf`: `b"%PDF-1.7 garbage"` → `corrupt_file`.
  - `test_standard_paper`: A3 (841.9 × 1190.6) true, A3 rotated true, (700, 700) false.
- [ ] **Step 2: Run it, expect FAIL.** Command: `uv run pytest tests/test_pdf.py -q`.
- [ ] **Step 3: Implement** with `pypdfium2` (`PdfDocument`, `page.render(scale=dpi/72).to_numpy()`, converted RGB(A) → BGR) and `pdfplumber` per 06 §7.2.
  - A `PdfiumError` whose message contains `password` → `pdf_encrypted`.
  - In pdfplumber `rects`, a fill colour with luminance < 0.35 → filled polygon.
- [ ] **Step 4: Run tests, expect PASS.** Same command as Step 2.
- [ ] **Step 5: Quality gates.** `uv run ruff check . && uv run ruff format --check . && uv run mypy app`
- [ ] **Step 6: Commit.** `git add vision/app/pipeline/pdf.py vision/tests/support/pdfgen.py vision/tests/test_pdf.py` then `git commit -m "feat(vision): PDF render DPI rule, vector extraction, encryption handling" -m "$FURNY_TRAILER"`.

---

### Task 9: Photo rectification, deskew, resample (`NormalizedPage`)

**Files:**
- Create: `vision/app/pipeline/rectify.py`, `vision/app/pipeline/normalize.py`, `vision/app/utils/geometry.py`, `vision/app/utils/images.py`
- Test: `vision/tests/test_rectify.py`, `vision/tests/test_normalize.py`

**Spec refs:** `06 §5.4` (`isLikelyPhoto`), `06 §7.3`, `06 §7.4`, `06 §7.5`, `06 §6` (`PageImage`)

**Interfaces:**
- Produces, in `utils/geometry.py`:
  - `Pt = tuple[float, float]` and `Rect(x: int, y: int, w: int, h: int)` (frozen dataclass with `long_side`, `contains(pt)`, `expand(px)`, `clip(w, h)`).
  - `detect_line_segments(gray: np.ndarray) -> np.ndarray` returning an `(N, 4)` float32 array of `x0 y0 x1 y1`: LSD (`cv2.createLineSegmentDetector(cv2.LSD_REFINE_STD)`), falling back to `HoughLinesP(rho=1, theta=π/360, threshold=50, minLineLength=0.02·long, maxLineGap=3)` when LSD raises.
  - `seg_angle_deg(x0, y0, x1, y1) -> float` in [0, 180), y-down, clockwise positive.
  - `point_seg_distance`, `project_param`, `odd(n: int) -> int`.
- Produces, in `utils/images.py`: `encode_png(img) -> bytes` (compression 6), `encode_jpeg(img, quality) -> bytes`, `encode_webp(img, quality) -> bytes`, `resize_long_edge(img, long_edge, interp)`.
- Produces, in `rectify.py`: `detect_page_quad(img) -> np.ndarray | None`, `warp_quad(img, quad) -> np.ndarray`, `quad_is_axis_aligned(quad, shape) -> bool`, `flatten_illumination(gray) -> np.ndarray`.
- Produces, in `normalize.py`:
  - `NormalizedPage(image: np.ndarray, page_image: PageImage, transform: np.ndarray (3×3), source_kind: SourceKind, is_photo: bool, vector: VectorPage | None, dpi: float | None, page_size_pt: tuple[float, float] | None)`.
  - `estimate_skew_deg(gray) -> float`.
  - `normalize(img, *, source_kind, is_photo: bool, corners: list[tuple[float, float]] | None, source_page: int, dpi: float | None, ctx) -> NormalizedPage`.

- [ ] **Step 1: Write the failing test.**
  - `test_photo_quad_detected_and_rectified`:
    - Draw a 1200×900 white "drawing" with a black 4 px grid of rectangles.
    - Warp it onto a 1600×1300 grey (128) canvas so the page corners land at TL (180, 150), TR (1450, 210), BR (1400, 1180), BL (140, 1100), using `cv2.getPerspectiveTransform` + `warpPerspective`.
    - `detect_page_quad` returns corners each within `0.015 × hypot(1600, 1300)` of the truth.
    - After `warp_quad`, every segment from `detect_line_segments` longer than 100 px has an angle within ±1° of 0° or 90°.
  - `test_axis_aligned_quad_is_not_photo`: a white page on a black canvas exactly at the image border → `quad_is_axis_aligned(...) is True`.
  - `test_user_corners_win`: `normalize(..., corners=[(0.1, 0.1), (0.9, 0.1), (0.9, 0.9), (0.1, 0.9)])` → `page_image.rectified is True` and output size ≈ 0.8 × input (before resample).
  - `test_photo_without_quad_warns`: plain noise with `is_photo=True` → warning `page_corners_not_found`, `rectified is False`.
  - `test_deskew`:
    - Rotate a line drawing with `cv2.getRotationMatrix2D(c, -3, 1)` (OpenCV positive = counter-clockwise, so this is content rotated 3° clockwise).
    - `estimate_skew_deg ≈ +3.0 ± 0.2`.
    - `normalize` → `page_image.deskew_deg ≈ -3.0 ± 0.2` and warning `deskewed` with `params["degrees"] == round(page_image.deskew_deg, 1)`.
    - A 0.1° rotation → `deskew_deg == 0`, no warning.
    - Source kind `pdf_vector` → deskew skipped.
  - `test_low_resolution_upscaled`: 800×600 → normalized long edge 2000, `resample_factor == 2.5`, warning `low_resolution` with `{"longEdge": 800}`. 1200 px → 2000 with no warning. 6500 → 6000 (factor ≈ 0.923). 3000 → unchanged, factor 1.0.
  - `test_transform_maps_points`: `transform @ [w-1, h-1, 1]` (dehomogenised) ≈ `(W_norm-1, H_norm-1)` ±1.5 for a plain resample.
- [ ] **Step 2: Run it, expect FAIL.** Command: `uv run pytest tests/test_rectify.py tests/test_normalize.py -q`.
- [ ] **Step 3: Implement** per 06 §7.3–§7.5.
  - Order inside `normalize`: rectify (when user corners are given, or `is_photo`, or the quad is non-axis-aligned) → deskew (`0.2 ≤ |a| ≤ 10`, canvas expanded, white border, `INTER_CUBIC`) → resample.
  - `transform` is the composition of the three 3×3 matrices.
  - `PageImage.width/height` are the final pixel size. `rectified` reflects whether a warp was applied.
  - Skew estimation: LSD segments ≥ 3 % of the long edge, angles folded into (−45°, 45°], length-weighted histogram in 0.1° bins over [−10°, 10°], 5-bin box smoothing, then the peak.
- [ ] **Step 4: Run tests, expect PASS.** Same command as Step 2.
- [ ] **Step 5: Quality gates.** `uv run ruff check . && uv run ruff format --check . && uv run mypy app`
- [ ] **Step 6: Commit.** `git add vision/app/pipeline/rectify.py vision/app/pipeline/normalize.py vision/app/utils/geometry.py vision/app/utils/images.py vision/tests/test_rectify.py vision/tests/test_normalize.py` then `git commit -m "feat(vision): photo rectification, deskew and resample to NormalizedPage" -m "$FURNY_TRAILER"`.

---

### Task 10: Preprocess (binarize, colour analysis, stroke width, style, thick mask, plan region) and synthetic drawing generator

**Files:**
- Create: `vision/app/pipeline/binarize.py`, `vision/app/pipeline/region.py`, `vision/tests/support/synth.py`
- Test: `vision/tests/test_preprocess.py`

**Spec refs:** `06 §7.6`, `06 §7.3` (illumination flattening for photos)

**Interfaces:**
- Consumes: `NormalizedPage`, `flatten_illumination`, `Rect`, `odd` (Task 9).
- Produces, in `binarize.py`:
  - `Preprocessed(gray, ink, dark, thick, dt, t_thin: float, colorfulness: float, drawing_kind: DrawingKind, region: Rect)`. `dt` is `cv2.distanceTransform(ink, DIST_L2, 3)`.
  - `preprocess(page: NormalizedPage, ctx) -> Preprocessed`.
  - Helpers `sauvola_window(long_edge: int) -> int`, `thick_kernel(t_thin: float) -> int`, `stroke_width_mode(ink) -> float`.
- Produces, in `region.py`: `detect_plan_region(thick, ink, ctx) -> Rect`.
- Produces, in `tests/support/synth.py` (reused by Tasks 13–21, 31):

  ```python
  @dataclass
  class SWall:
      a: tuple[int, int]; b: tuple[int, int]; thickness: int = 12
      style: Literal["filled", "double", "single"] = "filled"; color: tuple[int, int, int] = (0, 0, 0)

  @dataclass
  class SDoor:
      wall: int; u0: int; width: int; hinge: Literal["start", "end"] = "start"; side: Literal[1, -1] = 1; double: bool = False

  @dataclass
  class SWindow:
      wall: int; u0: int; width: int; lines: int = 2; offset_sashes: bool = False

  @dataclass
  class SText:
      text: str; org: tuple[int, int]; scale: float = 1.2; thickness: int = 2; vertical: bool = False

  @dataclass
  class SDimChain:
      start: tuple[int, int]; axis: Literal["x", "y"]; ticks: list[int]; labels: list[str]; tick_style: Literal["slash", "bar"] = "slash"

  def render_plan(size: tuple[int, int], walls=(), doors=(), windows=(), texts=(), dims=(),
                  fills: Sequence[tuple[list[tuple[int, int]], tuple[int, int, int]]] = (),
                  background=(255, 255, 255), line_px: int = 2) -> np.ndarray  # BGR uint8
  ```

  Door and window cutouts are erased from the wall (`u0` along a→b), arcs are drawn on side `side·n` with `n = (d.y, −d.x)`, and the leaf line is drawn perpendicular from the hinge. `DimChain` ticks are positions along the axis, labels are drawn centred between consecutive ticks (`cv2.putText`, rotated 90° when the axis is `y`), and each tick gets a 45° slash of 16 px.

- [ ] **Step 1: Write the failing test.**
  - `test_sauvola_window`: `sauvola_window(2000) == 33`, `(600) == 15`, `(6000) == 81`.
  - `test_thick_kernel`: `thick_kernel(2.0) == 5`, `(0.5) == 3`, `(10) == 15`.
  - `test_line_drawing_style`: a synthetic 2000×1500 plan with filled walls of 14 px, plus 2 px lines (`line_px=2` dimension chains) → `drawing_kind == "architectural_line_drawing"`, `abs(t_thin - 2.0) <= 0.5`, `thick` covers ≥ 90 % of wall pixels, and fewer than 5 % of the thin-line pixels survive in `thick`.
  - `test_colored_brochure_style`: the same walls in dark grey (60, 60, 60) with pastel room fills (e.g. (180, 200, 240)) → `drawing_kind == "colored_brochure"` and `colorfulness > 25`.
  - `test_illumination_flattening`: a line drawing multiplied by a horizontal brightness ramp 0.55…1.0, with `is_photo=True` → `ink` has no blobs larger than (3k)² in the dark half (the ramp is not binarized as ink).
  - `test_region_excludes_far_inset`: main plan (1200×900 px walls at (200, 100)) plus an inset of thick walls 400×200 at (300, 1300) with thick-pixel count ≥ 30 % of the main → region excludes the inset (`region.y + region.h < 1300`) and warning `plan_region_ambiguous` with `{"components": 2}`.
  - `test_region_expanded_and_clipped`: region = union bbox expanded by 6 % of its long side and clipped to the image.
- [ ] **Step 2: Run it, expect FAIL.** Command: `uv run pytest tests/test_preprocess.py -q`.
- [ ] **Step 3: Implement** per 06 §7.6 steps 1–7.
  - Use `skimage.filters.threshold_sauvola(gray, window_size=w, k=0.2)` and `skimage.morphology.skeletonize`.
  - For photos, run `flatten_illumination(gray)` before Sauvola.
  - `photo_of_drawing` when `page.is_photo`; `cad_vector` when `source_kind == "pdf_vector"`.
- [ ] **Step 4: Run tests, expect PASS.** Same command as Step 2.
- [ ] **Step 5: Quality gates.** `uv run ruff check . && uv run ruff format --check . && uv run mypy app`
- [ ] **Step 6: Commit.** `git add vision/app/pipeline/binarize.py vision/app/pipeline/region.py vision/tests/support/synth.py vision/tests/test_preprocess.py` then `git commit -m "feat(vision): Sauvola preprocessing, style classification, plan region" -m "$FURNY_TRAILER"`.

---

### Task 11: Text parsing and room-name dictionary

**Files:**
- Create: `vision/app/pipeline/textparse.py`, `vision/app/utils/roomnames.py`, `vision/app/schemas/candidates.py` (with `ParsedText` only; extended in Tasks 12–18)
- Test: `vision/tests/test_textparse.py`

**Spec refs:** `06 §7.8` (full table and dictionary), `06 §8.7` step 7 (English default names)

**Interfaces:**
- Produces, in `candidates.py`:
  - `TextKind = Literal["mm_number", "metric_length", "feet_inch", "size_pair", "area", "scale_note", "room_name", "opening_tag", "other"]`.
  - `@dataclass(frozen=True, slots=True) ParsedText(kind: TextKind, mm: int | None = None, pair_mm: tuple[int, int] | None = None, pair_imperial: bool = False, area_mm2: int | None = None, scale_n: int | None = None, room_name: str | None = None, room_type: str | None = None, tag: str | None = None)`.
- Produces, in `textparse.py`: `normalize_text(s) -> str` and `parse_token(text: str) -> ParsedText`.
- Produces, in `roomnames.py`:
  - `ROOM_NAMES: dict[str, RoomType]` (every key of 06 §7.8).
  - `ROOM_DEFAULT_NAMES: dict[RoomType, str]`.
  - `levenshtein_ratio(a, b) -> float`, defined as `1 − dist / max(len)`.
  - `match_room_name(text) -> tuple[str, RoomType] | None`.
  - `title_case_name(raw) -> str`.

- [ ] **Step 1: Write the failing test.**
  - `test_numbers`: `parse_token("3300") == ParsedText("mm_number", mm=3300)`. `"45"` → `other`. `"60001"` → `other`. `"3.6M"` → `metric_length` 3600. `"1200MM"` → 1200. `"360CM"` → 3600.
  - `test_feet_inch`: `"10'0\""` → 3048. `"10'-6\""` → 3200. `"8'"` → 2438. `"12' 3\""` → 3734.
  - `test_ocr_confusions`:
    - `"10'0\"X11'0\""` → `size_pair` (3048, 3353) with `pair_imperial=True`.
    - `"12’3”x7’11”"` → (3734, 2413).
    - `"33OO"` → `mm_number` 3300. `"l200"` → 1200.
    - `"T0ILET"` → `room_name` with `room_type == "toilet"` (ratio 0.833).
    - `"912 SQ.FT"` → `area` with `area_mm2 == 84_727_572`.
    - `"SCALE 1:100"` → `scale_note` 100. `"1:50"` → 50.
  - `test_metric_pair`: `"3.0 X 3.6"` → (3000, 3600), because unitless values < 100 are read as metres; this convention is recorded in the gap list. `"3000x3600"` → (3000, 3600).
  - `test_room_names`:
    - `"MASTER BEDROOM"` → `master_bedroom` (multiword first). `"M.BED"` → `master_bedroom`.
    - `"LIVING/DINING"` → `living`. `"BATH"` → `bathroom`. `"WC"` → `toilet`. `"BALC"` → `balcony`. `"KIT"` → `kitchen`.
    - `"HOUSEHOLD SHELTER"` → `store`. `"OTS"` → `ots`. `"5 FEET WIDE CORRIDOR"` → `corridor`. `"DECK"` → `deck`.
    - `title_case_name("LIVING/DINING") == "Living/Dining"`.
  - `test_opening_tags`: `"D1"`, `"SD2"`, `"W12"` → `opening_tag`; `"W123"` → `other`.
  - `test_room_dictionary_complete`: `ROOM_NAMES` contains every key listed in 06 §7.8, and `set(ROOM_DEFAULT_NAMES) == set(get_args(RoomType))` with `ROOM_DEFAULT_NAMES["other"] == "Room"`.
- [ ] **Step 2: Run it, expect FAIL.** Command: `uv run pytest tests/test_textparse.py -q`.
- [ ] **Step 3: Implement** the normalization and kind table exactly as 06 §7.8.
  - The O→0 and l/I→1 substitutions apply only when the substituted token then fully matches a numeric kind.
  - Room matching: uppercase, strip punctuation except `/`, split words, and test phrases longest-first. A phrase matches a contiguous word window when every word has ratio ≥ 0.8.
  - Area unit factors: sq ft = 92 903.04 mm², m² = 1 000 000.
- [ ] **Step 4: Run tests, expect PASS.** Same command as Step 2.
- [ ] **Step 5: Quality gates.** `uv run ruff check . && uv run ruff format --check . && uv run mypy app`
- [ ] **Step 6: Commit.** `git add vision/app/pipeline/textparse.py vision/app/utils/roomnames.py vision/app/schemas/candidates.py vision/tests/test_textparse.py` then `git commit -m "feat(vision): dimension/room text parsing with OCR confusion handling" -m "$FURNY_TRAILER"`.

---

### Task 12: OCR engine, tiling, two-pass reading, text tokens

**Files:**
- Create: `vision/app/ocr/engine.py`, `vision/app/ocr/tiling.py`, `vision/app/pipeline/ocr_stage.py`
- Modify: `vision/app/schemas/candidates.py` (add `TextToken`), `vision/app/main.py` (default `ocr_factory = OcrEngine`)
- Test: `vision/tests/test_ocr.py`

**Spec refs:** `06 §7.7`, `06 §5.2` (threads), `17 §5.9` (build-time model check)

**Interfaces:**
- Consumes: `parse_token` (Task 11), `Preprocessed` (Task 10), `VectorPage` (Task 8).
- Produces:
  - `RawOcrBox(quad: np.ndarray (4×2), text: str, score: float)`.
  - `class OcrEngine` with `__init__(det_limit_side_len: int = 1280, use_cls: bool = True)` and `read(img_bgr) -> list[RawOcrBox]`.
  - `tile_origins(length: int, tile: int = 1280, overlap: int = 160) -> list[int]`.
  - `map_rotated_cw(pt, tile_h: int) -> Pt`.
  - `dedupe(boxes, iou: float) -> list[...]`.
  - `@dataclass(frozen=True, slots=True) TextToken(id: str, text: str, quad: tuple[Pt, Pt, Pt, Pt], box: tuple[float, float, float, float], angle: Literal[0, 90], score: float, height_px: float, parsed: ParsedText)`.
  - `run_ocr(page: NormalizedPage, pre: Preprocessed, ocr: OcrLike, ctx) -> OcrResult(tokens: list[TextToken], text_mask: np.ndarray, ink_notext: np.ndarray)`.
  - `OcrLike` is a Protocol with `read`, so tests use a fake.

- [ ] **Step 1: Write the failing test.**
  - `test_tile_origins`: `tile_origins(1000) == [0]`; `tile_origins(3000) == [0, 1120, 1720]` (the last tile ends exactly at 3000).
  - `test_rotated_mapping`: for a tile of height 500, a point (x=10, y=20) in the original, rotated with `cv2.ROTATE_90_CLOCKWISE`, sits at (u=479, v=10), and `map_rotated_cw((479, 10), 500) == (10, 20)`.
  - `test_tiling_dedupe_with_fake_engine`: a fake engine returns the same box from two overlapping tiles → one token kept, with the higher score.
  - `test_pass_merge`: pass A and pass B boxes with IoU 0.4 → one token kept by higher score; on a tie, pass A wins.
  - `test_sorted_ids`: tokens get ids `T1…Tn` sorted by `(round(y0), round(x0))`.
  - `test_vector_words_bypass`: `page.source_kind == "pdf_vector"` with 12 vector words → the OCR fake is never called, tokens have `score == 1.0`, and angle comes from the word.
  - `test_text_mask`: `text_mask` covers each token box dilated by 2 px, and `ink_notext` is 0 there.
  - `test_real_rapidocr_reads_plan_text` (marked `slow`): a 1600×700 white image with `cv2.putText("BEDROOM", FONT_HERSHEY_SIMPLEX, 2.0, thickness 4)` and a vertical "3300" rendered through `SText(vertical=True)` → tokens include text `BEDROOM` (angle 0, parsed `room_name`) and `3300` with `angle == 90`.
- [ ] **Step 2: Run it, expect FAIL.** Command: `uv run pytest tests/test_ocr.py -q`.
- [ ] **Step 3: Implement.**
  - **`OcrEngine`** wraps `rapidocr.RapidOCR(params={"Det.limit_type": "max", "Det.limit_side_len": det_limit_side_len, "Det.box_thresh": 0.5, "Det.unclip_ratio": 1.6, "Global.text_score": 0.5, "Global.use_cls": use_cls, "Global.max_side_len": 2000, "EngineConfig.onnxruntime.intra_op_num_threads": 2, "Global.log_level": "warning"})`.
  - **`read`** calls `out = engine(img)` and zips `out.boxes`, `out.txts`, `out.scores`, all of which may be `None` (treated as empty). If the installed API differs, adapt only this method (06 §7.7).
  - **`height_px`** is the box height for angle 0 and the box width for angle 90.
  - **Tiling** runs over the plan region only. Dedupe uses IoU > 0.5 within a pass and > 0.3 across passes.
- [ ] **Step 4: Run tests, expect PASS.** Same command as Step 2.
- [ ] **Step 5: Quality gates.** `uv run ruff check . && uv run ruff format --check . && uv run mypy app`
- [ ] **Step 6: Commit.** `git add vision/app/ocr vision/app/pipeline/ocr_stage.py vision/app/schemas/candidates.py vision/app/main.py vision/tests/test_ocr.py` then `git commit -m "feat(vision): RapidOCR wrapper with tiling and two-pass vertical text" -m "$FURNY_TRAILER"`.

---

### Task 13: Line segments, collinear merge, dominant orientation

**Files:**
- Create: `vision/app/pipeline/segments.py`
- Modify: `vision/app/schemas/candidates.py` (add `Segment`)
- Test: `vision/tests/test_segments.py`

**Spec refs:** `06 §7.9` (all steps, including dominant orientation)

**Interfaces:**
- Consumes: `detect_line_segments`, `seg_angle_deg` (Task 9), `Preprocessed` (Task 10), `OcrResult` (Task 12).
- Produces:
  - `@dataclass(frozen=True, slots=True) Segment(id: str, p0: Pt, p1: Pt, width_px: float, is_thin: bool, source: Literal["lsd", "hough", "vector"])`, with properties `length` and `angle_deg`.
  - `detect_segments(page: NormalizedPage, pre: Preprocessed, ocr: OcrResult, ctx) -> list[Segment]`.
  - `merge_collinear(segs: list[Segment], *, angle_tol_deg: float = 1.5, dist_tol: float = 2.0, gap_tol: float = 4.0) -> list[Segment]`.
  - `dominant_orientation(segs) -> float` in [0, 90).

- [ ] **Step 1: Write the failing test.** Synthetic images come from `synth.render_plan`.
  - `test_rectangle_outline`: a single-line 2 px rectangle 800×500 → after merge, exactly 4 segments with length > 400, each within ±1° of 0° or 90°.
  - `test_merge_small_gap`: a horizontal line with a 3 px break → 1 segment; with a 12 px break → 2 segments.
  - `test_width_attached`: a 6 px filled line → `width_px` within 6 ± 1 and `is_thin is False` (t_thin = 2). A 2 px line → `is_thin is True`.
  - `test_min_length`: segments shorter than `max(8, 0.008 L)` are dropped.
  - `test_text_painted_white`: a word drawn over a line region produces no segments from the glyph strokes (all kept segments have length > 0.02 L).
  - `test_theta0`: a drawing rotated 5° → `dominant_orientation ≈ 5.0 ± 0.5`.
  - `test_vector_segments`: a `pdf_vector` page uses `page.vector.segments` mapped through `page.transform`, with `source == "vector"`.
- [ ] **Step 2: Run it, expect FAIL.** Command: `uv run pytest tests/test_segments.py -q`.
- [ ] **Step 3: Implement** per 06 §7.9.
  - Ids are `S{n}` after sorting by `(min y, min x)`.
  - Merging uses union of projections onto the longer segment's direction. For thick strokes the perpendicular tolerance is `0.5 × width`.
- [ ] **Step 4: Run tests, expect PASS.** Same command as Step 2.
- [ ] **Step 5: Quality gates.** `uv run ruff check . && uv run ruff format --check . && uv run mypy app`
- [ ] **Step 6: Commit.** `git add vision/app/pipeline/segments.py vision/app/schemas/candidates.py vision/tests/test_segments.py` then `git commit -m "feat(vision): LSD segments with collinear merge and dominant orientation" -m "$FURNY_TRAILER"`.

---

### Task 14: Dimension lines, dimension spans, heuristic text association

**Files:**
- Create: `vision/app/pipeline/dimensions.py`
- Modify: `vision/app/schemas/candidates.py` (add `DimensionLine`, `DimensionSpan`)
- Test: `vision/tests/test_dimensions.py`

**Spec refs:** `06 §8.4` (steps 1–5), `06 §8.1` step 2

**Interfaces:**
- Consumes: `Segment` (Task 13), `TextToken` (Task 12).
- Produces:
  - `DimensionLine(id: str, p0: Pt, p1: Pt, tick_positions: list[float], segment_id: str)`.
  - `DimensionSpan(id: str, p0: Pt, p1: Pt, axis: Literal["x", "y", "other"], kind: Literal["chain_segment", "overall"], near_text_ids: list[str], line_id: str)`.
  - `find_dimension_lines(segments, tokens, region: Rect) -> list[DimensionLine]` (run before walls).
  - `find_dimension_spans(lines, tokens, region) -> list[DimensionSpan]`.
  - `associate_dimension_texts(spans, tokens) -> dict[str, str]` (text id → span id).

- [ ] **Step 1: Write the failing test.** Tokens are constructed directly, without OCR.
  - `test_chain_detected`: an `SDimChain` along x with ticks [300, 1200, 2100] and slash ticks, plus tokens "9000" and "9000" centred above each interval → 1 line, spans `D1` (chain 300–1200), `D2` (chain 1200–2100) and `D3` (overall 300–2100), axis `"x"`.
  - `test_two_ticks_single_span`: a span with 2 ticks → exactly 1 span, kind `overall`.
  - `test_bar_ticks_and_extension_lines`: perpendicular extension lines touching within 2 px count as ticks.
  - `test_no_text_not_dimension`: a line with ticks but no numeric token within 2.5 × text height → no dimension line.
  - `test_orientation_match`: an angle-90 token next to a horizontal line is not in `near_text_ids`.
  - `test_association_prefers_nearest_midpoint`: `associate_dimension_texts` maps each numeric token to the span whose midpoint is nearest its centre projection; on a tie, the shorter span wins.
- [ ] **Step 2: Run it, expect FAIL.** Command: `uv run pytest tests/test_dimensions.py -q`.
- [ ] **Step 3: Implement** per 06 §8.4.
  - Tick: a thin segment of length `0.005 L … 0.03 L` crossing within its middle 80 % at 45° ± 15° or 90° ± 10°, or a perpendicular extension line touching within 2 px, or a filled blob of area ≤ `(0.006 L)²` on the line.
  - Ids are `L{n}` and `D{n}`, assigned in sort order.
- [ ] **Step 4: Run tests, expect PASS.** Same command as Step 2.
- [ ] **Step 5: Quality gates.** `uv run ruff check . && uv run ruff format --check . && uv run mypy app`
- [ ] **Step 6: Commit.** `git add vision/app/pipeline/dimensions.py vision/app/schemas/candidates.py vision/tests/test_dimensions.py` then `git commit -m "feat(vision): dimension line and span detection with text association" -m "$FURNY_TRAILER"`.

---

### Task 15: Wall graph building

**Files:**
- Create: `vision/app/pipeline/graph.py`
- Modify: `vision/app/schemas/candidates.py` (add `RawWall`, `WallCandidate`, `GapCandidate`, `WallGraph`)
- Test: `vision/tests/test_graph.py`

**Spec refs:** `06 §8.1` steps 9–10

**Interfaces:**
- Produces:
  - `RawWall(p0: Pt, p1: Pt, thickness_px: float, source: WallSource, openings_px: tuple[tuple[float, float], ...] = ())`, where `WallSource = Literal["filled", "double_line", "single_line", "vector"]`.
  - `WallCandidate(id: str, a: Pt, b: Pt, a_node: str, b_node: str, thickness_px: float, source: WallSource, evidence: float, free_ends: int, openings_px: tuple[tuple[float, float], ...])`, where intervals are measured along the centreline from `a`.
  - `GapCandidate(wall_id: str, u0: float, u1: float)`.
  - `WallGraph(nodes: dict[str, Pt], walls: list[WallCandidate], gaps: list[GapCandidate])`.
  - `build_wall_graph(raw: list[RawWall], *, r: float, t_median: float, L: float) -> WallGraph`.
  - `EVIDENCE = {"filled": 1.0, "vector": 1.0, "double_line": 0.85, "single_line": 0.5}`.

- [ ] **Step 1: Write the failing test.** Pure coordinates, no images.
  - `test_rectangle_jitter`: 4 walls of a 1000×600 rectangle with endpoints jittered ±3 px, `r=8` → 4 nodes, 4 walls, `free_ends == 0` everywhere. Node x is exactly the mean of the vertical walls' x, and node y the mean of the horizontal walls' y.
  - `test_t_junction_split`: add a vertical wall from the top wall's midpoint down to the bottom → 7 walls and 6 nodes, with the top and bottom walls split at shared nodes.
  - `test_l_closure_extension`: a free end 10 px short of another wall's centreline, with `r=6, t=12` → extended; the junction is shared and `free_ends == 0`.
  - `test_duplicates_removed`: two walls on the same node pair → 1.
  - `test_short_wall_removed_unless_bridging`: a 15 px stub with `t=12` (< 2t = 24) that dangles is removed; a 15 px wall joining two otherwise separate parts is kept.
  - `test_ids_deterministic`: the same input in shuffled order gives the same `W1…`/`N1…` ids and coordinates.
  - `test_evidence`: source `double_line` → evidence 0.85.
- [ ] **Step 2: Run it, expect FAIL.** Command: `uv run pytest tests/test_graph.py -q`.
- [ ] **Step 3: Implement** per 06 §8.1 step 9.
  - Union-find over endpoints. Axis-aligned node placement. Extend free ends by up to `r + t` to the nearest centreline. T-split. Dedupe. Short-wall pruning with a connectivity check (bridge test via component count).
  - Ids are assigned after sorting nodes by `(y, x)` and walls by `(min y, min x)` of their endpoints.
  - `openings_px` of merged raw walls are carried through and re-based onto the final wall's `a`.
- [ ] **Step 4: Run tests, expect PASS.** Same command as Step 2.
- [ ] **Step 5: Quality gates.** `uv run ruff check . && uv run ruff format --check . && uv run mypy app`
- [ ] **Step 6: Commit.** `git add vision/app/pipeline/graph.py vision/app/schemas/candidates.py vision/tests/test_graph.py` then `git commit -m "feat(vision): wall graph building with junction snapping" -m "$FURNY_TRAILER"`.

---

### Task 16: Wall extraction (filled, double-line, single-line, vector) to raw walls and gap candidates

**Files:**
- Create: `vision/app/pipeline/walls.py`
- Test: `vision/tests/test_segments_walls.py`

**Spec refs:** `06 §8.1` steps 1–8, `06 §13` (`02-walls.png`), `06 §16.1` (`test_segments_walls.py`)

**Interfaces:**
- Consumes: `Segment`, `merge_collinear`, `dominant_orientation` (Task 13), `DimensionLine` (Task 14), `build_wall_graph` (Task 15), `Preprocessed` (Task 10).
- Produces:
  - `WallExtraction(mask: np.ndarray, source_mask: np.ndarray (uint8 1=filled 2=double 3=single), raw: list[RawWall], theta0: float, t_median: float)`.
  - `extract_walls(page: NormalizedPage, pre: Preprocessed, segments: list[Segment], dimension_lines: list[DimensionLine], ctx) -> WallExtraction`.
  - `walls_to_graph(ext: WallExtraction, region: Rect) -> WallGraph`, which calls `build_wall_graph` with `r = max(t_median, 0.006 L)` and turns `openings_px` intervals into `GapCandidate`s.
  - `debug_walls_png(page, ext, graph) -> np.ndarray`.

- [ ] **Step 1: Write the failing test.** Uses `synth`.
  - `test_filled_rectangle_with_partition`: walls (300,300)–(2100,300)–(2100,1500)–(300,1500) at 14 px, plus a partition (1200,300)–(1200,1500) → graph with 7 walls and 6 nodes, all `source == "filled"`, `thickness_px` 14 ± 2, `free_ends == 0`.
  - `test_double_line_walls`: the same topology drawn `style="double"` (two 2 px lines 14 px apart, hollow) → 7 walls with `source == "double_line"`.
  - `test_single_line_sketch`: only single 2 px lines, so the fill and double masks cover < 0.2 % of the region → walls with `source == "single_line"` and evidence 0.5.
  - `test_gap_candidate`: a 90 px door cut in the partition (t = 14, inside [2.5t, 18t]) → exactly one `GapCandidate` on the partition with `u1 - u0 == 90 ± 4`. A 20 px break is closed instead (< 1.5t merge).
  - `test_dimension_lines_not_walls`: a dimension chain drawn above the plan adds no walls.
  - `test_off_axis_short_dropped_long_kept`: in a plan with θ0 = 0, a 30° diagonal wall ≥ 0.03 L is kept as diagonal and a short 30° stub is dropped.
  - `test_vector_pdf_walls`: a `pdf_vector` page whose `vector.segments` include 5 px stroked lines (t_thin = 1) → walls with `source == "vector"`.
- [ ] **Step 2: Run it, expect FAIL.** Command: `uv run pytest tests/test_segments_walls.py -q`.
- [ ] **Step 3: Implement** per 06 §8.1 steps 1–8.
  - Skeleton tracing uses an 8-neighbourhood pixel graph and `cv2.approxPolyDP`. Spur pruning removes branches shorter than 1.5 × local thickness.
  - The pixel-graph tracer may be iterative over skeleton pixels using `scipy.ndimage` labelling of junction and end pixels.
  - Keep the module free of labeling and scale imports (stage boundary rule I12).
- [ ] **Step 4: Run tests, expect PASS.** Same command as Step 2.
- [ ] **Step 5: Quality gates.** `uv run ruff check . && uv run ruff format --check . && uv run mypy app`
- [ ] **Step 6: Commit.** `git add vision/app/pipeline/walls.py vision/tests/test_segments_walls.py` then `git commit -m "feat(vision): wall extraction from filled, double-line and single-line drawings" -m "$FURNY_TRAILER"`.

---

### Task 17: Openings (door arc, window, passage)

**Files:**
- Create: `vision/app/pipeline/openings.py`
- Modify: `vision/app/schemas/candidates.py` (add `OpeningCandidate`)
- Test: `vision/tests/test_openings.py`

**Spec refs:** `06 §8.5`, `04 §2.1` (normal and left side)

**Interfaces:**
- Produces:
  - `OpeningCandidate(id: str, wall_id: str, u0: float, u1: float, kind: Literal["door", "window", "opening"], type: str, hinge: Literal["start", "end"], swing: Literal["left", "right"], support: float)`.
  - `find_openings(graph: WallGraph, pre: Preprocessed, segments: list[Segment], ink_notext: np.ndarray) -> list[OpeningCandidate]` (ids `O{n}` ordered by wall id, then `u0`).

- [ ] **Step 1: Write the failing test.** Uses `synth` with wall a=(100,500) b=(900,500), so d=(1,0) and n=(0,−1), meaning up on screen.
  - `test_door_arc_start_left`: a door with `u0=300, width=90, hinge="start", side=1` → kind `door`, type `single_swing`, `hinge == "start"`, `swing == "left"`, `support >= 0.55`.
  - `test_door_arc_end_right`: `hinge="end", side=-1` → `hinge == "end"`, `swing == "right"`.
  - `test_double_swing`: two arcs of radius g/2 from both ends → type `double_swing`.
  - `test_window_casement`: 2 parallel thin lines spanning the gap → kind `window`, type `casement`.
  - `test_window_sliding`: 3 lines with offset sashes overlapping ≤ 60 % → `sliding_window`.
  - `test_passage`: an empty gap → kind `opening`, type `opening`, `support == 0.0`.
- [ ] **Step 2: Run it, expect FAIL.** Command: `uv run pytest tests/test_openings.py -q`.
- [ ] **Step 3: Implement** per 06 §8.5.
  - Four hypotheses with 24 arc samples each, scored by thin-ink support in a 5×5 window. A leaf-line bonus of +0.15 applies.
  - Double-swing rule: two arcs, each with support ≥ 0.45 and radius ≈ g/2.
  - Window rule: ≥ 2 parallel thin lines (±3°) covering ≥ 80 % of g inside the wall strip.
- [ ] **Step 4: Run tests, expect PASS.** Same command as Step 2.
- [ ] **Step 5: Quality gates.** `uv run ruff check . && uv run ruff format --check . && uv run mypy app`
- [ ] **Step 6: Commit.** `git add vision/app/pipeline/openings.py vision/app/schemas/candidates.py vision/tests/test_openings.py` then `git commit -m "feat(vision): door/window/opening classification of wall gaps" -m "$FURNY_TRAILER"`.

---

### Task 18: Room faces and `CandidateSet`

**Files:**
- Create: `vision/app/pipeline/rooms.py`
- Modify: `vision/app/schemas/candidates.py` (add `RoomFace`, `CandidateSet`)
- Test: `vision/tests/test_rooms.py`

**Spec refs:** `06 §8.6` (steps 1–7; the post-scale filters are applied in Task 21)

**Interfaces:**
- Produces:
  - `RoomFace(id: str, polygon_px: tuple[Pt, ...], anchor_px: Pt, area_px: float, bbox: tuple[float, float, float, float], contains_text_ids: tuple[str, ...], open: bool)`.
  - `find_room_faces(wall_mask: np.ndarray, graph: WallGraph, openings: list[OpeningCandidate], tokens: list[TextToken], region: Rect, t_median: float) -> tuple[list[RoomFace], np.ndarray]`. The second element is the int32 face-id map: 0 for none, k for `R{k}`.
  - `@dataclass(frozen=True) CandidateSet(texts, segments, dimension_lines, spans, nodes, walls, gaps, openings, rooms, theta0: float, t_thin: float, t_median: float, region: Rect, drawing_kind_cv: DrawingKind)`, with `scale_y(factor: float) -> CandidateSet` returning a copy with every y coordinate multiplied (used by anisotropy correction).

- [ ] **Step 1: Write the failing test.**
  - `test_two_rooms_with_door_closure`: the 7-wall plan from Task 16 with a door in the partition → exactly 2 faces, neither touching the border; each `anchor_px` is strictly inside its polygon (`cv2.pointPolygonTest > 0`); `open is False`. Use a 70 px door so the closure stays ≤ 6t = 84 px.
  - `test_open_face_flag`: a 120 px gap closure (> 6t with t = 14) → `open is True`.
  - `test_border_and_sliver_discarded`: the outside region is discarded; a 400×10 px sliver (aspect > 15) is discarded; an area < 0.002 × region area is discarded.
  - `test_contains_text_ids`: tokens centred in the left room are listed only in that face.
  - `test_face_id_map`: the map value at each anchor equals the face index.
  - `test_candidate_set_scale_y`: `scale_y(1.05)` multiplies node, wall, room and span y coordinates and leaves x unchanged.
- [ ] **Step 2: Run it, expect FAIL.** Command: `uv run pytest tests/test_rooms.py -q`.
- [ ] **Step 3: Implement** per 06 §8.6 steps 1–7.
  - Use `cv2.connectedComponentsWithStats(connectivity=4)`, `cv2.findContours(RETR_EXTERNAL)` + `approxPolyDP(0.5 t)`, and the distance-transform maximum as the anchor.
  - Ids are `R{n}` sorted by anchor `(y, x)`.
- [ ] **Step 4: Run tests, expect PASS.** Same command as Step 2.
- [ ] **Step 5: Quality gates.** `uv run ruff check . && uv run ruff format --check . && uv run mypy app`
- [ ] **Step 6: Commit.** `git add vision/app/pipeline/rooms.py vision/app/schemas/candidates.py vision/tests/test_rooms.py` then `git commit -m "feat(vision): room face detection and CandidateSet" -m "$FURNY_TRAILER"`.

---

### Task 19: Heuristic labeler (provider `none`) and labeler interface

**Files:**
- Create: `vision/app/pipeline/labeling/base.py`, `vision/app/pipeline/labeling/heuristic.py`, `vision/app/pipeline/labeling/vendor.py`
- Test: `vision/tests/test_labeling_heuristic.py`

**Spec refs:** `06 §9.1` (interface), `06 §9.7`, `06 §9.8` (vendor protocol only)

**Interfaces:**
- Consumes: `CandidateSet` (Task 18), `associate_dimension_texts` (Task 14), `LabelingResult` (Task 5), `RecognizeHints` (Task 5).
- Produces:
  - `class Labeler(Protocol)` with `label(page, candidates, hints, ctx) -> LabelingOutcome`.
  - `@dataclass LabelingOutcome(result: LabelingResult, provider_used: ProviderName, model: str | None, fallback_reason: FallbackReason | None, calls: list[Any], partial: bool)`. `calls` holds `UsageCall` objects from Task 22 and is typed `list[Any]` until then.
  - `class HeuristicLabeler` with `label(...)`.
  - `class RecognitionVendor(Protocol)` with `name: str` and `recognize(image_png: bytes, hints, timeout_s: float) -> Any`. No implementation.

- [ ] **Step 1: Write the failing test.** Fixture `CandidateSet`s are built in code.
  - `test_imperial_rooms`: face R1 contains `BEDROOM` (height 30) and `10'0"X11'0"`, and three other `feet_inch`/`size_pair` tokens exist elsewhere → `unitSystem == "imperial"`; room R1 is `include=True`, `name="Bedroom"`, `type="bedroom"`, `nameTextId` the BEDROOM token, `sizeText == "10'0\"X11'0\""`, `widthMm=3048`, `depthMm=3353`.
  - `test_metric_from_spans`: ≥ 3 `mm_number` tokens associated with spans → `unitSystem == "metric"`; dimension labels carry `spanId` and `valueMm`. The `mm_number` tokens get role `dimension`.
  - `test_unknown_unit_warns`: no evidence → `"unknown"` and `ctx` warning `unit_system_guessed`.
  - `test_hint_wins`: `hints.unit_system = "metric"` overrides imperial tokens.
  - `test_multiple_names_highest_wins`: two room names in one face → the taller one is the name, and the other stays role `room_name` (assembly creates the merged label).
  - `test_corridor_touching_boundary_excluded`: a face named `CORRIDOR` within 2t of the region border → `include=False`; the same face away from the border → `True`.
  - `test_missed_rooms`: a `room_name` token outside every face but inside the region → one `MissedRoom` at the token centre. Tokens outside the region → role `ignore`.
  - `test_walls_and_openings`: single-line walls → verdict `unsure`, others `wall`. An opening with support 0.3 → `unsure`.
  - `test_known_dimension`: label "Overall width" → `knownDimensionMatch == {"wallId": None, "spanId": None}`; label "Kitchen" → `None` plus warning `known_dimension_unmatched` with `{"label": "Kitchen"}`.
  - `test_outcome_meta`: `provider_used == "none"`, `model is None`, `calls == []`, `partial is False`.
  - `test_drawing_kind_from_cv`: `drawingKind == candidates.drawing_kind_cv`.
- [ ] **Step 2: Run it, expect FAIL.** Command: `uv run pytest tests/test_labeling_heuristic.py -q`.
- [ ] **Step 3: Implement** per 06 §9.7.
  - Wall `kind` stays `None` in heuristic labels; assembly decides by geometry (§8.7 step 5).
  - Room names use `title_case_name` of the token text.
- [ ] **Step 4: Run tests, expect PASS.** Same command as Step 2.
- [ ] **Step 5: Quality gates.** `uv run ruff check . && uv run ruff format --check . && uv run mypy app`
- [ ] **Step 6: Commit.** `git add vision/app/pipeline/labeling vision/tests/test_labeling_heuristic.py` then `git commit -m "feat(vision): heuristic labeler for provider none" -m "$FURNY_TRAILER"`.

---

### Task 20: Scale solver, fallbacks, confidence, scale note

**Files:**
- Create: `vision/app/pipeline/scale.py`
- Test: `vision/tests/test_scale.py`

**Spec refs:** `06 §8.2`, `06 §8.3`, `06 §5.6` (scale note), `06 §6` (`ScaleMeta`, warnings)

**Interfaces:**
- Consumes: `CandidateSet`, `LabelingResult`, `RecognizeHints`, `NormalizedPage`, `is_standard_paper` (Task 8).
- Produces:
  - `ScaleSample(value_mm: int, span_px: float, weight: float, axis: Literal["x", "y", "other"], kind: Literal["chain_segment", "overall", "room_width", "room_depth"], text: str, a_px: Pt, b_px: Pt)`.
  - `FitResult(k: float, inliers: list[ScaleSample], rejected: list[ScaleSample], residual_pct: float)`.
  - `fit_scale(samples) -> FitResult` (weighted median, two 8 % rejection rounds, WLS through the origin).
  - `scale_confidence(method, residual_pct, inliers: int, consistent_chains: int) -> float`.
  - `ScaleNote(n: int, mm_per_px: float, text: str)` and `find_scale_note(tokens, page) -> ScaleNote | None`.
  - `ScaleResult(mm_per_px: float, method: ScaleMethod, residual_pct: float | None, samples: int, rejected: int, confidence: float, anisotropy_corrected: bool, y_factor: float, room_label_check: RoomLabelCheck, used_samples: list[ScaleSample], inlier_flags: list[bool], consistent_chains: int)`.
  - `collect_samples(candidates, labels, hints) -> tuple[list[ScaleSample], list[ScaleSample]]` (primary, room).
  - `solve_scale(candidates, labels, hints, page, ctx, *, scale_note: ScaleNote | None) -> ScaleResult`.
  - `to_scale_meta(result) -> ScaleMeta` (a/b converted to mm, ≤ 60 samples).

- [ ] **Step 1: Write the failing test.**
  - `test_outliers_rejected`: 8 samples with true k = 10 and ±0.3 % noise, plus 2 outliers at ×1.2 and ×0.85 → `abs(k / 10 - 1) <= 0.005`, 2 rejected.
  - `test_wls_residual`: exact samples → `residual_pct < 1e-6`.
  - `test_confidence_formula`:
    - `scale_confidence("dimension_chain", 1.0, 8, 1) == pytest.approx(0.945)`.
    - `scale_confidence("room_label", 2.0, 4, 0) == pytest.approx(0.68)`.
    - `("scale_note", …) == 0.6`, `("user_hint", …) == 0.7`, `("default_guess", …) == 0.1`, `("dxf_units", …) == 1.0`.
  - `test_room_orientation_assignment`: a face interior bbox of 300×400 px with label (3000, 4000) → samples width↔x and depth↔y. Label (4000, 3000) → swapped. Weight 0.5.
  - `test_anisotropy_raster`: 4 x-samples at k = 10 and 4 y-samples at k = 10.5, `source_kind="raster"` → `anisotropy_corrected is True`, `y_factor == pytest.approx(1.05, rel=1e-3)`, `mm_per_px ≈ 10`, warning `scale_anisotropy_corrected` with `{"ratioPct": 5.0}`. The same with `pdf_vector` → not corrected.
  - `test_fallback_order`:
    - Only room samples → method `room_label` with warning `scale_from_room_labels` `{"rooms": n}`.
    - None, with a scale note N = 100 on an A3 page at dpi 150 → `scale_note`, `mm_per_px == pytest.approx(100 * 25.4 / 150)`.
    - A non-standard paper size → note ignored.
    - A known-dimension match plus < 2 other samples → `user_hint`.
    - Nothing → `default_guess` with `mm_per_px == 12000 / max(region.w, region.h)` and warning `scale_guessed` `{"assumedLongEdgeMm": 12000}`.
  - `test_single_overall_high_confidence`: one `overall` sample; this is the LLM path with confidence ≥ 0.8, approximated by a known-dimension weight-3 sample → treated as primary.
  - `test_room_label_cross_check`: primary chain k = 10 and room labels implying k = 11.5 → `median_discrepancy_pct ≈ 13` (> 10), warning `scale_room_label_mismatch`, confidence × 0.7.
  - `test_high_residual_warning`: residual > 3 → warning `scale_high_residual`.
  - `test_chain_consistency`: chain values 3000 + 4000 equal an overall 7000 on a parallel line covering the same extent ±1 % → `consistent_chains == 1`.
- [ ] **Step 2: Run it, expect FAIL.** Command: `uv run pytest tests/test_scale.py -q`.
- [ ] **Step 3: Implement** per 06 §8.2 and §8.3.
  - Sample sources: the labeling's `dimensions` (span and value), `rooms` (`widthMm`/`depthMm` with the face's interior bbox), and `knownDimensionMatch` (span length, or wall centreline length).
  - The labeler's `kind` overrides the span kind.
- [ ] **Step 4: Run tests, expect PASS.** Same command as Step 2.
- [ ] **Step 5: Quality gates.** `uv run ruff check . && uv run ruff format --check . && uv run mypy app`
- [ ] **Step 6: Commit.** `git add vision/app/pipeline/scale.py vision/tests/test_scale.py` then `git commit -m "feat(vision): robust scale solver with fallbacks and confidence" -m "$FURNY_TRAILER"`.

---

### Task 21: Assembly, confidence, metric filters, validate-and-repair

**Files:**
- Create: `vision/app/pipeline/assemble.py`, `vision/app/pipeline/validate.py`
- Test: `vision/tests/test_assemble_validate.py`

**Spec refs:** `06 §8.6` (post-scale filters), `06 §8.7` (steps 1–9 and validate), `03 §1.1`, `06 §6` (reasons, warnings)

**Interfaces:**
- Consumes: `CandidateSet`, `LabelingResult`, `ScaleResult`, `RecognizeOptions`, `NormalizedPage`, `new_id`, `ROOM_DEFAULT_NAMES`, `match_room_name`.
- Produces:
  - `ConfidenceMap(walls: dict[str, float], openings: dict[str, float], rooms: dict[str, float], overall: float, reasons: dict[str, list[ReasonCode]])`.
  - `AssembleResult(document: PlanDocument, confidence: ConfidenceMap, warnings: list[MetaWarning], id_map: dict[str, str])` (candidate id → document id).
  - `assemble_document(page, candidates, labels, scale, options, ctx) -> AssembleResult`.
  - `snap_thickness(mm: float) -> int`.
  - `validate_and_repair(doc: PlanDocument, *, confidence: ConfidenceMap, drawing_kind: str) -> tuple[PlanDocument, list[MetaWarning]]`. This extends the spec signature with the inputs its rules need; the extension is recorded in the gap list.

- [ ] **Step 1: Write the failing test.**
  - `test_coordinates_and_ids`: k = 10.5 and node px (100, 200) → node `x == 1050, y == 2100`. Every id matches `^(n|w|o|r|t)_[0-9a-z]{10}$`.
  - `test_snap_thickness`: `snap_thickness(11 * 10.5) == 115`, `snap_thickness(223) == 230`, `snap_thickness(130) == 130`, `snap_thickness(40) == 50`, `snap_thickness(1200) == 1000`.
  - `test_wall_fields`: `height == hints.wall_height_mm or defaults.wall_height_mm` (2700); kind `half` → `height == 1000`; outer-boundary walls → `exterior`; interior walls with thickness ≤ 0.6 × median exterior → `partition`, otherwise `interior`; `material` is `drywall` at ≤ 100 mm, else `brick`; `justification == "center"`.
  - `test_openings`:
    - Gap 87 px at k 10.5 → width 910, offset = centre × k.
    - Door width ≥ 1200 → `double_swing` (unless sliding).
    - Window `sillHeight == 900`, `height == 1200`, clamped so `sill + height <= wall.height`.
    - The exterior door ≥ 900 nearest the largest living/foyer room → `main_entrance`, once.
    - `label` = an `opening_tag` token within 2 text heights.
  - `test_missed_opening_inserted`: `MissedOpening` on a wall with no gap within 1.5 m → a door of `doorWidthMm` centred at the projection, confidence 0.35, reason `type_guessed`.
  - `test_rooms`:
    - An unnamed included face → name `"Room"` with reason `no_name`.
    - Type from name via `match_room_name` when the label type is null.
    - `floorFinish == "tile"`, `showArea is True`, `labelOffset is None`.
    - Extra names → `TextLabel(fontSize=250, rotation=0)` plus warning `room_names_merged`.
    - A `MissedRoom` inside an unnamed face names it.
  - `test_exclusions`: a room `include=False` plus walls only adjacent to excluded or outside faces → removed, with warning `entities_outside_unit_removed` `{"walls": n, "rooms": m}`.
  - `test_metric_filters`: faces < 1.0 m² or > 200 m² dropped; walls < 50 mm or > 600 mm get reason `thin_evidence` and are dropped when evidence < 0.6; openings outside 300–6000 mm dropped.
  - `test_confidence_pins`:
    - Wall (evidence 0.85, snapped, one end connected, LLM `wall`) → 0.87.
    - Door with support 0.7 → 0.72; with the LLM agreeing → 0.87; with the LLM saying `window` → 0.6 and reason `llm_disagrees`.
    - Closed, named, heuristic room → 0.88; with area < 2 m² → 0.7 and reason `small_area`.
    - `overall` follows the 0.4/0.2/0.1/0.3 weighting, with empty sets counting 0.5.
  - `test_meta_and_background`: `schemaVersion == 1`, `meta.createdWith == "import"`, `meta.defaultWallThickness == 115`, `floorThickness == 150`. `background == {"importId": "", "mediaUuid": "", "pixelWidth": W, "pixelHeight": H, "mmPerPixel": k, "position": {"x": 0, "y": 0}, "rotation": 0, "opacity": 0.5, "visible": True, "locked": True}`. `view.lastMode == "2d"`.
  - `test_validate_clamp_and_drop`:
    - Wall 3000 mm with a door of width 900 at offset 200 → offset 450.
    - Wall 900 mm with width 900 → opening dropped.
    - Overlapping openings → the lower-confidence one dropped, warning `openings_dropped_overlap` `{"count": 1}`.
    - Walls < 10 mm and duplicate node pairs removed; orphan nodes removed.
  - `test_validate_errors`:
    - 2001 walls → `VisionError("too_complex")` with status 422.
    - 0 walls → `no_walls_detected`.
    - `drawing_kind="not_a_floor_plan"` with 3 walls → `not_a_floor_plan`; with 5 walls → warning `not_a_floor_plan_suspected` only.
  - `test_output_validates`: `PlanDocument.model_validate(doc.wire())` passes.
- [ ] **Step 2: Run it, expect FAIL.** Command: `uv run pytest tests/test_assemble_validate.py -q`.
- [ ] **Step 3: Implement** per 06 §8.7.
  - Use the face-id map from `find_room_faces` (rebuilt here from room polygons by `cv2.fillPoly` when absent) for the 0.75t side tests.
  - `overall` uses length-weighted wall confidences.
  - Round confidences to 2 dp.
- [ ] **Step 4: Run tests, expect PASS.** Same command as Step 2.
- [ ] **Step 5: Quality gates.** `uv run ruff check . && uv run ruff format --check . && uv run mypy app`
- [ ] **Step 6: Commit.** `git add vision/app/pipeline/assemble.py vision/app/pipeline/validate.py vision/tests/test_assemble_validate.py` then `git commit -m "feat(vision): PlanDocument assembly, confidence and validation" -m "$FURNY_TRAILER"`.

---

### Task 22: Provider core: neutral types, errors, registry, capabilities, usage, fakes, `/v1/capabilities`, `/v1/providers/test`

**Files:**
- Create: `vision/app/providers/base.py`, `vision/app/providers/errors.py`, `vision/app/providers/registry.py`, `vision/app/providers/none_provider.py`, `vision/app/providers/usage.py`, `vision/app/providers/testing.py`
- Create: `vision/app/api/capabilities.py`, `vision/app/api/providers.py`
- Modify: `vision/app/main.py` (include routers; `app.state.provider_factory = lambda name, model: registry.get_provider(name, model, settings)`)
- Test: `vision/tests/providers/test_capabilities.py`, `vision/tests/providers/test_provider_test_endpoint.py`, `vision/tests/providers/test_usage_totals.py`

**Spec refs:** `18 §2`, `18 §5.1`, `18 §5.3`, `18 §6` (all), `18 §7.4`, `18 §7.5` (lastError), `18 §14`

**Interfaces:**
- Produces, verbatim from 18 §6.1 in `base.py`:
  - `ProviderName`, `Effort`, `ProviderCapabilities`
  - `TextPart`, `ImagePart`, `Part`, `ToolSpec`, `JsonSchemaSpec`, `ToolCall`, `ToolResult`
  - `UserMessage`, `ToolResultsMessage`, `AssistantMessage`, `Message`
  - `UsageCall`, `TurnResult`, `LLMProvider` (ABC)
- Produces, in `errors.py`: the 18 §6.2 classes plus `fallback_reason_for(err: ProviderError) -> FallbackReason`.
- Produces, in `registry.py`:
  - `provider_capabilities(settings) -> list[ProviderInfo]`.
  - `get_provider(name, model, settings) -> LLMProvider | None`. It instantiates lazily by importing the adapter module by name (Tasks 24 and 25 add them) and caches per `(name, model)`.
  - `record_provider_error(name, code, now=None)` and `last_error(name, now=None)` (60 min window).
- Produces, in `usage.py`: `usage_call_out(c: UsageCall) -> UsageCallOut` and `build_usage(provider: ProviderName, model: str | None, calls: list[UsageCall], fell_back: bool) -> Usage`.
- Produces, in `testing.py` (not registered):
  - `FakeProvider(script: list[TurnResult | Exception | Callable[[list[Message]], TurnResult]], capabilities=..., name="anthropic", model="fake-model")`, which records `self.calls` (the kwargs of each `complete`).
  - `ReplayProvider(result_json: dict[str, Any], capabilities=...)`, which returns a `TurnResult` with `text = json.dumps(result_json)`.
  - `make_turn(text=None, tool_calls=(), stop_reason="end_turn", purpose="labeling") -> TurnResult`.

- [ ] **Step 1: Write the failing test.**
  - `test_capabilities` (18 §17.1). Use `TestClient` with Settings built per case:
    - Only `ANTHROPIC_API_KEY` → `anthropic` and `none` have `configured: true`; `openai` has `configured: false` with `missing == ["OPENAI_API_KEY", "OPENAI_MODEL"]`; `openai_compatible` has `missing == ["OPENAI_COMPAT_BASE_URL", "OPENAI_COMPAT_MODEL"]`.
    - `OPENAI_API_KEY` without `OPENAI_MODEL` → not configured, `missing == ["OPENAI_MODEL"]`.
    - Compat flags reflected: `supportsTools` false, `maxImagePx` 1280, `maxImagesPerRequest` 1.
    - `anthropic` entry: `defaultModel == "claude-opus-5-5"`, `maxImagePx == 2576`, `maxImagesPerRequest == 20`, `supportsEffort` true.
    - `none` entry: everything false, image values 0.
    - `ocr == {"engine": "rapidocr", "loaded": True}`.
    - `limits == {"maxSourceBytes": 26214400, "maxDxfBytes": 15728640, "maxPdfPages": 20, "maxPixels": 40000000, "recognizeDeadlineS": 570}`.
    - The key value `sk-ant-xyz-secret` is not in `response.text`.
    - Missing bearer → 401.
  - `test_last_error_window`: `record_provider_error("anthropic", "provider_auth_failed", now=t0)` → shown as `{code, at}` in capabilities at t0 + 59 min, and gone at t0 + 61 min.
  - `test_get_provider_errors`: an unconfigured name → `VisionError("provider_not_configured")` with status 400; `get_provider("none", None, s) is None`.
  - `test_provider_test_endpoint`, with `app.state.provider_factory` overridden to return a `FakeProvider`:
    - The answer `{"ok": true, "quadrant": "top_left"}` → 200 `{ok: True, provider, model, latencyMs: int, visionVerified: True, jsonSchemaVerified: True, usage: {purpose: "provider_test", …}, error: None}`.
    - The first call's parts are one `ImagePart` (a 64×64 PNG whose pixel (10, 10) is black and pixel (50, 50) white) plus `TextPart("Is the black square in the top-left quadrant? Answer with the JSON object.")`, with `system == "You are a connectivity check."` and `effort == "low"`.
    - A provider without vision → no image and text `Reply with ok = true and quadrant = "top_left".`
    - `ProviderAuthError` raised → 200 `ok: False`, `error.code == "provider_auth_failed"`, `last_error` recorded.
    - Provider `none` → `ok: True` with no call.
  - `test_usage_totals`: three succeeded calls plus one failed final call → `totals.requests == 4`, token sums correct, `status == "failed"`. All succeeded with `fell_back=False` → `"succeeded"`. Provider `none` → `{provider: "none", model: None, calls: [], totals: zeros, status: "succeeded"}`.
- [ ] **Step 2: Run it, expect FAIL.** Command: `uv run pytest tests/providers -q`.
- [ ] **Step 3: Implement** per 18 §5 and §6.
  - `/v1/providers/test` runs `provider.complete` in a worker thread with `timeout_s=60` and `JsonSchemaSpec("connectivity_check", schema)` when `supports_json_schema`. Otherwise it appends `JSON_SCHEMA_INSTRUCTION_TEMPLATE`; prompts land in Task 26, so a local copy of that constant is acceptable here until Task 26 replaces it with the import.
  - The answer is parsed with `parse_json_object`.
  - No slot: the spec defines none for this endpoint; this is recorded in the gap list.
  - The adapter import table in the registry is `{"anthropic": "app.providers.anthropic_provider:AnthropicProvider", "openai": "app.providers.openai_provider:OpenAIProvider", "openai_compatible": "app.providers.openai_compatible_provider:OpenAICompatibleProvider"}`.
- [ ] **Step 4: Run tests, expect PASS.** Same command as Step 2.
- [ ] **Step 5: Quality gates.** `uv run ruff check . && uv run ruff format --check . && uv run mypy app`
- [ ] **Step 6: Commit.** `git add vision/app/providers vision/app/api/capabilities.py vision/app/api/providers.py vision/app/main.py vision/tests/providers` then `git commit -m "feat(vision): provider abstraction, registry, capabilities and provider test" -m "$FURNY_TRAILER"`.

---

### Task 23: Overview images, set-of-marks, candidate JSON, agentic tools

**Files:**
- Create: `vision/app/pipeline/annotate.py`, `vision/app/pipeline/labeling/tools.py`
- Test: `vision/tests/test_annotate_tools.py`

**Spec refs:** `06 §9.2`, `06 §9.5`, `18 §3` (image encoding rules)

**Interfaces:**
- Consumes: `CandidateSet`, `NormalizedPage`, `ImagePart`, `TextPart`, `ToolSpec`, `ToolCall`, `ToolResult` (Task 22).
- Produces, in `annotate.py`:
  - `Overview(s: float, offset: tuple[int, int], width: int, height: int, clean: np.ndarray, marked: np.ndarray, candidates_json: str, payload: dict[str, Any])`.
  - `build_overview(page, candidates, *, max_image_px: int, ctx) -> Overview`, which emits the `too_many_candidates_truncated` warnings.
  - `to_image_part(img: np.ndarray) -> ImagePart` (PNG; JPEG q90 if > 4.5 MB).
  - `to_overview(pt_norm, ov) -> tuple[int, int]` and `from_overview(pt_ov, ov) -> Pt`.
  - `draw_marks(img, candidates_subset, ov, scale)`.
  - `TRUNCATION = {"texts": 300, "walls": 400, "openings": 150, "rooms": 80, "dimensionSpans": 200}`.
- Produces, in `tools.py`: `CROP_IMAGE_SPEC`, `LIST_CANDIDATES_SPEC` (`ToolSpec`s with the exact 06 §9.5 schemas), and `ToolExecutor(page, overview, candidates, *, max_image_px: int, max_crops: int)` with `specs() -> list[ToolSpec]`, `execute(call: ToolCall) -> ToolResult` and `crops_used: int`.

- [ ] **Step 1: Write the failing test.**
  - `test_overview_scale`: a normalized 5000×4000 image with `max_image_px=2576` → `s == pytest.approx(0.5152)`; with `max_image_px=8000` → `s == 1`.
  - `test_coordinate_roundtrip`: `from_overview(to_overview(p))` is within `1/s` px.
  - `test_candidate_json_compact_sorted`: no whitespace (`" " not in json except inside text values`), ids sorted naturally (`T2` before `T10`), integer coordinates, and keys exactly as the 06 §9.2 example (`image`, `texts`, `dimensionSpans`, `walls`, `openings`, `rooms`). Text items carry `parsed` as `"room_name:bedroom"` / `"mm_number:3300"` / `"other"`.
  - `test_truncation`: 500 texts → 300 kept by highest score, warning `too_many_candidates_truncated` `{"kind": "texts", "kept": 300, "total": 500}`.
  - `test_marks_drawn`: the marked image has pure-ish red (`#E53935`) pixels near a wall midpoint and none in the clean image.
  - `test_large_png_switches_to_jpeg`: with the size threshold monkeypatched to 1 KB → `media_type == "image/jpeg"`.
  - `test_crop_tool`:
    - `{"x": 10, "y": 10, "w": 100, "h": 80, "scale": 4, "annotated": False}` with s = 0.5 → image 400×320, and text exactly `"Crop of overview region x=10, y=10, w=100, h=80. This image is 400x320 px; a point (u, v) in it corresponds to overview point (x + u*100/400, y + v*80/320)."`.
    - With s = 1 the output is capped at 2× native → 200×160.
    - `scale=9` is clamped to 4. `w=8` → `is_error`. A rectangle beyond the overview is clamped.
  - `test_crop_budget_counter`: after `max_crops` crops, the next returns `is_error` with text `"crop budget exhausted, answer now"`.
  - `test_list_candidates`: `{"kind": "walls", "region": {"x": 0, "y": 0, "w": 50, "h": 50}}` filters by wall midpoint. More than 200 items → `"truncated": true`. An invalid `kind` → `is_error`.
  - `test_tool_schemas_exact`: `CROP_IMAGE_SPEC.input_schema` equals the 06 §9.5 JSON.
- [ ] **Step 2: Run it, expect FAIL.** Command: `uv run pytest tests/test_annotate_tools.py -q`.
- [ ] **Step 3: Implement** per 06 §9.2 and §9.5.
  - Labels in 14 px bold sans: use `cv2.FONT_HERSHEY_DUPLEX` at a scale giving 14 px cap height, with a 3 px white outline drawn first.
  - Up to 3 collision offsets of 12 px; otherwise omit the label from the image.
  - Colours: walls `#E53935`, openings `#2E7D32`, rooms `#6A1B9A`, texts `#1565C0`, spans `#EF6C00` (converted to BGR).
- [ ] **Step 4: Run tests, expect PASS.** Same command as Step 2.
- [ ] **Step 5: Quality gates.** `uv run ruff check . && uv run ruff format --check . && uv run mypy app`
- [ ] **Step 6: Commit.** `git add vision/app/pipeline/annotate.py vision/app/pipeline/labeling/tools.py vision/tests/test_annotate_tools.py` then `git commit -m "feat(vision): set-of-marks overview, candidate JSON and crop tools" -m "$FURNY_TRAILER"`.

---

### Task 24: Anthropic adapter (`claude-opus-5-5`)

**Files:**
- Create: `vision/app/providers/anthropic_provider.py`, `vision/tests/providers/sse.py`
- Test: `vision/tests/providers/test_anthropic.py`

**Spec refs:** `18 §3`, `18 §7.1`, `18 §7.5`, `18 §17.1` (anthropic rows)

**Interfaces:**
- Consumes: everything in `providers/base.py` and `errors.py`, `record_provider_error`.
- Produces:
  - `AnthropicProvider(settings: Settings, model: str, *, http_client: Any | None = None, max_retries: int = 2)`. When `http_client` is given it is passed to `anthropic.Anthropic(http_client=...)`; tests pass `anthropic.DefaultHttpxClient(transport=httpx2.MockTransport(handler))`, because SDK 1.x uses `httpx2`.
  - `to_anthropic_messages(conversation) -> list[dict[str, Any]]`.
- Produces, in tests: `sse.anthropic_sse(message: dict[str, Any]) -> bytes`, which serialises a complete Messages API message dict into SSE events:
  - `message_start` (content `[]`, usage)
  - per block: `content_block_start` (empty text / `input: {}` / empty thinking), then `text_delta`, `input_json_delta` (full JSON string), `thinking_delta` and `signature_delta`, then `content_block_stop`
  - `message_delta` (`stop_reason`, `stop_details`, `usage.output_tokens`)
  - `message_stop`

  The response header is `content-type: text/event-stream`.

- [ ] **Step 1: Write the failing test.** Each test builds a handler that records `request.headers` and `json.loads(request.content)`.
  - `test_anthropic_request_shape`. Body assertions:
    - `model == "claude-opus-5-5"`, `max_tokens == 32000`, `stream is True`
    - `thinking == {"type": "adaptive"}`
    - `output_config == {"effort": "high", "format": {"type": "json_schema", "schema": SCHEMA}}`
    - `cache_control == {"type": "ephemeral"}`
    - `system == [{"type": "text", "text": "SYS"}]`
    - tools each have `strict is True` and `eager_input_streaming is True`
    - `tool_choice == {"type": "auto"}`
    - the last message's role is `user`; in the first user message, image blocks come before text, with base64 `source`
    - `"budget_tokens" not in json.dumps(body)`
    - `fallbacks == "default"`

    Header assertion: `"server-side-fallback-2026-07-01" in headers["anthropic-beta"]`. With `tool_choice="none"`, the body has `{"type": "none"}`. With `anthropic_server_fallback=False`, there is no beta header and no `fallbacks` key.
  - `test_anthropic_history_append_only`:
    - Turn 1 returns `[thinking(signature="sig1"), tool_use(id="tu1", name="crop_image", input={…})]`.
    - Turn 2 is sent with `[UserMessage, AssistantMessage(native=…), ToolResultsMessage([r1, r2])]`.
    - The request's `messages[1]["content"]` equals the turn-1 content dicts, including `signature`.
    - `messages[2]` is one user message holding two `tool_result` blocks, with `is_error` set and image blocks inside `content`.
    - Consecutive user-role entries (tool results followed by a finalize `UserMessage`) are merged into one user message with the `tool_result` blocks first.
  - `test_anthropic_refusal`: `stop_reason: "refusal"` with `stop_details: {"type": "refusal", "category": "cyber"}` → raises `ProviderRefusal` with `.category == "cyber"`, and `.usage` holds one failed `UsageCall`.
  - `test_anthropic_max_tokens`: `stop_reason: "max_tokens"` → `ProviderInvalidOutput`.
  - `test_anthropic_fallback_param_rejected`: the first response is 400 `{"type": "error", "error": {"type": "invalid_request_error", "message": "fallbacks: unsupported"}}`. The adapter retries once without the beta header or `fallbacks` and succeeds. A second `complete()` call also omits them (`_fallback_disabled` is remembered).
  - `test_anthropic_error_mapping`, with `max_retries=0`:
    - 401 → `ProviderAuthError` (and `last_error` recorded)
    - 403 → `ProviderAuthError`
    - 404 → `ProviderBadRequest` with `code == "model_not_found"` (recorded)
    - 429 → `ProviderUnavailable` `provider_rate_limited`
    - 500 and 529 → `provider_overloaded`
    - handler raising `httpx2.ReadTimeout` → `ProviderTimeout`
    - `httpx2.ConnectError` → `ProviderUnavailable` `provider_unreachable`
  - `test_anthropic_usage_and_parsing`: `text` is the concatenated text blocks; `tool_calls` hold parsed `arguments`; the `stop_reason` mapping `end_turn`/`stop_sequence` → `end_turn`; usage fields copied (`cache_read_input_tokens` defaults to 0); `model` is the response's served model; `images` counts only image blocks in the newest message.
  - `test_anthropic_fallback_block`: content `[thinking, text("partial"), {"type": "fallback", "from": {"model": "claude-opus-5-5"}, "to": {"model": "claude-opus-4-8"}}, thinking, text("final")]` with `usage.iterations` of two entries →
    - `native` omits thinking and tool_use blocks before the last fallback block
    - `text == "final"` (only text after the last fallback block counts as the answer)
    - usage input and output tokens are summed over `iterations`
    - `model == "claude-opus-4-8"`
- [ ] **Step 2: Run it, expect FAIL.** Command: `uv run pytest tests/providers/test_anthropic.py -q`.
- [ ] **Step 3: Implement** per 18 §7.1.
  - Use `client.beta.messages.stream(**params, betas=["server-side-fallback-2026-07-01"], fallbacks="default")` when enabled, otherwise `client.messages.stream(**params)`, and call `get_final_message()`.
  - If the installed SDK rejects a keyword (`fallbacks`, `cache_control` or `output_config`) at type-check or run time, pass that key through `extra_body={...}` instead; the request-shape test is the arbiter.
  - Native assistant content is the list of response blocks dumped with `model_dump(mode="json", exclude_none=True)`, so it replays byte-identically.
  - Mid-stream fallback handling (the `fallback` block and `usage.iterations`) goes beyond the 18 §7.1 text; it follows the current API rules and is recorded in the gap list.
- [ ] **Step 4: Run tests, expect PASS.** Same command as Step 2.
- [ ] **Step 5: Quality gates.** `uv run ruff check . && uv run ruff format --check . && uv run mypy app`
- [ ] **Step 6: Commit.** `git add vision/app/providers/anthropic_provider.py vision/tests/providers/sse.py vision/tests/providers/test_anthropic.py` then `git commit -m "feat(vision): Anthropic provider with adaptive thinking, strict tools, structured output" -m "$FURNY_TRAILER"`.

---

### Task 25: OpenAI and OpenAI-compatible adapters

**Files:**
- Create: `vision/app/providers/openai_provider.py`, `vision/app/providers/openai_compatible_provider.py`
- Test: `vision/tests/providers/test_openai.py`, `vision/tests/providers/test_compat_adapter.py`

**Spec refs:** `18 §3`, `18 §7.2`, `18 §7.3`, `18 §17.1` (openai/compat rows)

**Interfaces:**
- Produces:
  - `OpenAIProvider(settings, model, *, http_client=None, max_retries=2)`, with tests passing `openai.DefaultHttpxClient(transport=httpx2.MockTransport(h))`.
  - `OpenAICompatibleProvider(settings, model, *, http_client=None, max_retries=2)`, a subclass.
  - `to_openai_messages(conversation, *, image_detail: bool, max_images: int) -> list[dict[str, Any]]`.

- [ ] **Step 1: Write the failing test.**
  - `test_openai_request_shape`:
    - `max_completion_tokens == 32000`
    - `response_format == {"type": "json_schema", "json_schema": {"name": "floor_plan_labels", "schema": S, "strict": True}}`
    - tools `[{"type": "function", "function": {…, "strict": True}}]` with `tool_choice == "auto"`
    - `reasoning_effort == "high"`
    - image parts as `{"type": "image_url", "image_url": {"url": "data:image/png;base64,…", "detail": "high"}}`
    - the system message first
  - `test_openai_reasoning_effort_dropped`: a 400 whose message contains `reasoning_effort` → retried once without it, and later calls omit it.
  - `test_openai_tool_images_resent`: `ToolResultsMessage` with an image → one `{"role": "tool", "tool_call_id": id, "content": "…"}` (error text prefixed `"ERROR: "`), followed by a user message `[{"type": "text", "text": "Images returned by tool call {id}:"}, image…]`.
  - `test_openai_refusal_and_length`: `message.refusal` set → `ProviderRefusal`; `finish_reason "length"` → `ProviderInvalidOutput`; tool-call arguments that are not JSON → a `ToolCall` with `arguments == {"__invalid_json__": raw}`, which the agent answers with an `is_error` result.
  - `test_openai_usage`: `prompt_tokens`, `completion_tokens` and `prompt_tokens_details.cached_tokens` mapped; `model` comes from `resp.model`.
  - `test_openai_error_mapping`: same table as Task 24, using `openai` exception classes.
  - `test_compat_shape_flags_off`: no `tools`, `tool_choice` or `response_format`; uses `max_tokens: 8192` (not `max_completion_tokens`); no `detail` key on images; no `reasoning_effort`; base URL and key from settings.
  - `test_compat_flags_on`: `OPENAI_COMPAT_SUPPORTS_JSON_SCHEMA=true` → `response_format` with strict.
  - `test_compat_max_images`: `max_images_per_request = 1` with 3 accumulated images → only the newest image is kept, and older ones are replaced by `{"type": "text", "text": "[image omitted]"}`.
  - `test_compat_usage_missing`: no `usage` in the response → token counts 0 and `model` = the configured model.
- [ ] **Step 2: Run it, expect FAIL.** Command: `uv run pytest tests/providers/test_openai.py tests/providers/test_compat_adapter.py -q`.
- [ ] **Step 3: Implement** per 18 §7.2 and §7.3.
  - Non-streaming `client.chat.completions.create(**kwargs)`.
  - `native = choice.message.model_dump(exclude_none=True)`.
  - Capabilities come from settings flags; for OpenAI they are all true, with `max_image_px` 2048 and 10 images.
- [ ] **Step 4: Run tests, expect PASS.** Same command as Step 2.
- [ ] **Step 5: Quality gates.** `uv run ruff check . && uv run ruff format --check . && uv run mypy app`
- [ ] **Step 6: Commit.** `git add vision/app/providers/openai_provider.py vision/app/providers/openai_compatible_provider.py vision/tests/providers/test_openai.py vision/tests/providers/test_compat_adapter.py` then `git commit -m "feat(vision): OpenAI and OpenAI-compatible Chat Completions providers" -m "$FURNY_TRAILER"`.

---

### Task 26: Prompts and LLM labeler (single-pass, prompt-JSON, repair, sanitize, fallback)

**Files:**
- Create: `vision/app/pipeline/labeling/prompts.py`, `vision/app/pipeline/labeling/llm.py`
- Modify: `vision/app/api/providers.py` (import `JSON_SCHEMA_INSTRUCTION_TEMPLATE` from prompts)
- Test: `vision/tests/test_llm_labeler.py`, `vision/tests/providers/test_compat_single_pass.py`

**Spec refs:** `06 §9.1`, `06 §9.3` (prompts verbatim), `06 §9.4` (sanitize), `18 §7.3` (prompt-JSON and repair), `18 §7.5`

**Interfaces:**
- Consumes: `HeuristicLabeler`, `LabelingOutcome` (Task 19), `build_overview`, `to_image_part` (Task 23), `LLMProvider` and the error classes (Task 22), `to_strict_schema`, `parse_json_object`.
- Produces:
  - In `prompts.py`: constants `SYSTEM_PROMPT_LABELING`, `USER_PROMPT_LABELING_TEMPLATE`, `TOOLS_BLOCK_TEMPLATE`, `FINALIZE_PROMPT`, `REPAIR_PROMPT_TEMPLATE`, `JSON_SCHEMA_INSTRUCTION_TEMPLATE`, `SYSTEM_PROMPT_DXF_LAYERS`, `USER_PROMPT_DXF_LAYERS_TEMPLATE` (verbatim from 06 §9.3 and §10.4), plus `build_user_prompt(overview, hints, *, two_images: bool, tools: bool, max_crops: int) -> str`.
  - In `llm.py`:
    - `LabelerOptions(agentic_crops: bool, effort: Effort, fallback_to_none: bool, max_turns: int, max_crops: int, call_timeout_s: float, stage_budget_s: float, max_output_tokens: int)`.
    - `LlmLabeler(provider: LLMProvider, options: LabelerOptions)` with `label(page, candidates, hints, ctx) -> LabelingOutcome`.
    - `sanitize(result: LabelingResult, candidates: CandidateSet, heuristic: LabelingResult) -> tuple[LabelingResult, float]` (the second value is the dropped ratio).
    - `complete_json(provider, conversation, *, system, schema_model, effort, timeout_s, purpose, ctx) -> tuple[BaseModel, list[UsageCall], bool]` (single pass plus at most one repair; the bool means "repaired").

- [ ] **Step 1: Write the failing test.**
  - `test_prompts_verbatim`:
    - `SYSTEM_PROMPT_LABELING.startswith("You are an expert architectural draftsperson")` and `.endswith("Answer ONLY with the JSON object required by the output schema.")`.
    - It contains the line `"- Furniture symbols (beds, sofas, dining tables, WC pans, basins, kitchen counters, wardrobes) are not walls."`.
    - `FINALIZE_PROMPT` and `REPAIR_PROMPT_TEMPLATE` exactly equal the 06 §9.3 strings.
  - `test_user_prompt_hints`: an imperial hint gives `"- Unit system: imperial (feet and inches)"`; known dimension `"- Known measurement: \"Overall\" = 11000 mm"`; photo `"yes"`; with one image the line is `The image is "marked".`.
  - `test_single_pass_success`: `FakeProvider` (json schema supported) returns a valid `LabelingResult` → outcome `provider_used == "anthropic"`, model = the served model, one `UsageCall` with purpose `labeling`. The call had `output_schema.name == "floor_plan_labels"`, `tools == []`, `tool_choice == "none"`, and parts `[ImagePart clean, ImagePart marked, TextPart]`.
  - `test_unknown_ids_sanitised`:
    - Unknown `W999` entries are dropped.
    - `valueMm 70000` → `None`.
    - A 75-char name is truncated to 60.
    - A duplicate id keeps the first.
    - Candidates not mentioned get heuristic labels.
    - If more than 20 % of entries are dropped → treated as `llm_invalid_output` → heuristic fallback with `fallback_reason == "llm_invalid_output"`.
  - `test_refusal_falls_back`: `ProviderRefusal` → heuristic labels, `provider_used == "none"`, `fallback_reason == "llm_refused"`, warning `llm_failed_fallback_none` `{"reason": "llm_refused"}`, and `calls` keeps the failed call.
  - `test_fallback_disabled_raises`: with `fallback_to_none=False`, a `ProviderUnavailable` → `VisionError("provider_error")` with status 502, `retryable=True`, and `.usage` holding the calls.
  - `test_vision_unsupported`: a provider with `supports_vision=False` → heuristic directly, `fallback_reason == "vision_unsupported"`, no call made.
  - `test_auth_error_reason`: `ProviderAuthError` → `fallback_reason == "provider_auth_failed"`.
  - `test_compat_single_pass_prompt_json` (in `tests/providers/test_compat_single_pass.py`, real `OpenAICompatibleProvider` over `httpx2.MockTransport`):
    - Response 1 is fenced invalid JSON (missing required fields); response 2 is fenced valid JSON.
    - The system prompt of call 1 ends with `JSON_SCHEMA_INSTRUCTION_TEMPLATE` filled with the strict schema.
    - Call 2's last user message starts with `"Your previous answer was not valid for the required schema. Errors:\n"` and lists ≤ 20 `loc: msg` lines.
    - The outcome succeeds with warning `llm_output_repaired` and usage purposes `["labeling", "repair"]`.
    - If both responses are invalid → fallback with `llm_invalid_output`.
    - Only the marked image is sent (`max_images_per_request = 1`).
- [ ] **Step 2: Run it, expect FAIL.** Command: `uv run pytest tests/test_llm_labeler.py tests/providers/test_compat_single_pass.py -q`.
- [ ] **Step 3: Implement** per 06 §9.1 and §9.3.
  - Agentic mode, `options.agentic_crops and provider.capabilities.supports_tools`, delegates to `run_agent` (Task 27). Until Task 27 lands it raises `NotImplementedError`, and this task's tests use single-pass providers.
  - The labeler converts overview-pixel coordinates in `MissedRoom`/`MissedOpening` back to normalized px with `from_overview` before returning. Downstream code always sees normalized px.
  - Writes debug artifact `07-labeling.json` with the result, notes, usage and transcript summary (tool names and args, no images).
- [ ] **Step 4: Run tests, expect PASS.** Same command as Step 2.
- [ ] **Step 5: Quality gates.** `uv run ruff check . && uv run ruff format --check . && uv run mypy app`
- [ ] **Step 6: Commit.** `git add vision/app/pipeline/labeling/prompts.py vision/app/pipeline/labeling/llm.py vision/app/api/providers.py vision/tests/test_llm_labeler.py vision/tests/providers/test_compat_single_pass.py` then `git commit -m "feat(vision): LLM labeler with prompt-JSON repair, sanitize and fallback" -m "$FURNY_TRAILER"`.

---

### Task 27: Agentic crop loop

**Files:**
- Create: `vision/app/pipeline/labeling/agent.py`
- Modify: `vision/app/pipeline/labeling/llm.py` (wire agentic mode)
- Test: `vision/tests/test_agent.py`

**Spec refs:** `06 §9.6`, `06 §9.5` (budget), `18 §3` (per-run caps), `18 §6.4`

**Interfaces:**
- Consumes: `ToolExecutor` (Task 23), `complete_json` and prompts (Task 26), `FakeProvider` and `make_turn` (Task 22).
- Produces: `run_agent(provider, system: str, user_parts: list[Part], executor: ToolExecutor, schema: type[LabelingResult], effort: Effort, ctx: PipelineContext, *, max_turns: int, max_crops: int, call_timeout_s: float, stage_budget_s: float, max_output_tokens: int) -> tuple[LabelingResult, list[UsageCall], bool]`. The bool means "repaired". It raises `ProviderError` subclasses, each carrying `.usage`.

- [ ] **Step 1: Write the failing test** `tests/test_agent.py` (FakeProvider scripts, no network):
  - `test_crop_calls_executed`:
    - Turn 1 has a `crop_image` tool call; turn 2 has the final JSON.
    - Call 1 has `tool_choice == "auto"` and `tools` = both specs.
    - Call 2's conversation is `[User, Assistant(native from turn 1), ToolResults([image + text])]`; the assistant `native` object is the identical object.
    - Usage purposes `["agent_turn", "agent_turn"]`.
    - Returns the parsed result.
  - `test_crop_budget`: the scripted model requests 9 crops in one turn with `max_crops=8` → 8 image results and a 9th `ToolResult(is_error=True)` with text `"crop budget exhausted, answer now"`.
  - `test_finalize_on_max_turns`: the model calls tools on every turn with `max_turns=3` → the 3rd call has `tool_choice == "none"`, the last message is `UserMessage([TextPart(FINALIZE_PROMPT)])`, and purpose `finalize`.
  - `test_finalize_on_deadline`: `ctx` with 25 s remaining (the stage-budget deadline is `min(ctx.deadline − 60, now + stage_budget)`; set `ctx.deadline = now + 85`) → the first call is already the finalize call.
  - `test_timeout_finalize_then_fallback`: turn 1 → tool call; turn 2 raises `ProviderTimeout`; then the finalize call (with `timeout_s == 60`) raises again → `run_agent` raises `ProviderTimeout` with `.usage` holding all 3 calls (the timed-out ones `status="failed"`). Through `LlmLabeler`: outcome heuristic, `partial is True`, warning `llm_partial`, `fallback_reason == "llm_timeout"`.
  - `test_invalid_tool_args`: a `crop_image` call missing `h` → `is_error` tool result with a pydantic message, and the loop continues.
  - `test_invalid_final_json_with_schema_support`: unparseable final text with `supports_json_schema=True` → `ProviderInvalidOutput` (no repair).
  - `test_repair_round_without_schema`: `supports_json_schema=False` and invalid final text → one repair call, then success with `repaired=True`.
  - `test_timeouts_passed`: each call's `timeout_s <= min(180, remaining_llm_budget)`.
  - `test_unknown_tool`: a tool name `"zoom"` → `is_error` result `"unknown tool"`.
- [ ] **Step 2: Run it, expect FAIL.** Command: `uv run pytest tests/test_agent.py -q`.
- [ ] **Step 3: Implement** per 06 §9.6.
  - The history list is append-only; never mutate earlier messages.
  - Tool results of one assistant turn go into one `ToolResultsMessage`.
  - The finalize prompt is a separate `UserMessage` appended after the results; the adapters merge consecutive user turns.
- [ ] **Step 4: Run tests, expect PASS.** Same command as Step 2.
- [ ] **Step 5: Quality gates.** `uv run ruff check . && uv run ruff format --check . && uv run mypy app`
- [ ] **Step 6: Commit.** `git add vision/app/pipeline/labeling/agent.py vision/app/pipeline/labeling/llm.py vision/tests/test_agent.py` then `git commit -m "feat(vision): agentic crop_image tool loop with budgets and finalize" -m "$FURNY_TRAILER"`.

---

### Task 28: DXF reader, units, layer classification, LLM layer mapping

**Files:**
- Create: `vision/app/pipeline/dxf/reader.py`, `vision/app/pipeline/dxf/layers.py`, `vision/tests/support/dxfgen.py`
- Test: `vision/tests/test_dxf_reader.py`

**Spec refs:** `06 §10.1`, `06 §10.2`, `06 §10.4`, `06 §5.4` (`dxf` inspect info), `18 §8.3`

**Interfaces:**
- Produces, in `reader.py`:
  - `DxfEntityRecord(kind: Literal["line", "arc", "circle", "hatch", "text", "insert_bbox"], layer: str, points: list[Pt], center: Pt | None, radius: float | None, start_deg: float | None, end_deg: float | None, text: str | None)` in drawing units.
  - `DxfDrawing(records: list[DxfEntityRecord], insunits: int, unit_factor_mm: float, units_guessed: bool, layer_stats: dict[str, LayerStats], extents: tuple[float, float, float, float])`.
  - `read_dxf(data: bytes, hints: RecognizeHints, ctx) -> DxfDrawing`.
  - `dxf_info(data: bytes) -> DxfInfo` (`insunits`, `layerCount`, `entityCount`).
  - Constant `MAX_DXF_ENTITIES = 200_000`.
- Produces, in `layers.py`: `LayerRole`, `classify_layers_regex(names) -> dict[str, LayerRole]`, `parallel_pair_share(segments) -> float`, and `classify_layers(drawing, provider: LLMProvider | None, ctx) -> tuple[dict[str, LayerRole], list[UsageCall]]`.
- Produces, in tests: `dxfgen.make_room_dxf(insunits: int = 4, scale: float = 1.0, wall_layer="A-WALL", door_layer="A-DOOR", window_layer="A-GLAZ", label_layer="A-AREA-IDEN") -> bytes`. It draws a 6000×4000 mm room with 230 mm double-line walls, a 900 mm door gap with an ARC on the door layer, a 1200 mm window gap with two lines on the window layer, and a TEXT `BEDROOM`; coordinates are multiplied by `scale`.

- [ ] **Step 1: Write the failing test.**
  - `test_units`: `insunits=4` → factor 1. `insunits=1` with geometry ÷ 25.4 → factor 25.4, and extents × factor ≈ 6000 ± 1. `insunits=6` (metres) → 1000. `insunits=0` with mm-sized extents → mm, `units_guessed`, warning `dxf_units_guessed` `{"assumed": "mm"}`. `insunits=0` with extents 600 and an imperial hint → inches.
  - `test_layer_regex`: `A-WALL` → wall, `MUR_EXT` → wall, `A-DOOR` → door, `A-GLAZ` → window, `DIM` → dimension, `A-AREA-IDEN` → room_label, `FURN` → furniture, `Defpoints` → other, `0` → other, `XYZ` → unclassified (absent).
  - `test_insert_exploded`: a block with lines on layer `0` inserted on layer `A-WALL` → records with `layer == "A-WALL"`; nesting depth > 4 is ignored.
  - `test_dxf_too_complex`: `MAX_DXF_ENTITIES` monkeypatched to 50 → `VisionError("dxf_too_complex")` with status 422.
  - `test_corrupt`: random bytes after `0\nSECTION` → `corrupt_file`.
  - `test_binary_dxf`: `ezdxf` saved with `fmt="bin"` reads the same record count.
  - `test_llm_layer_mapping`: layers renamed `L1` (walls) and `L2` (doors) → regex finds no wall layer → `FakeProvider` returns `{"layers": [{"name": "L1", "role": "wall"}]}`. The call is text-only with `effort == "low"`, purpose `dxf_layers` and the system prompt `SYSTEM_PROMPT_DXF_LAYERS`. The result maps L1 → wall, and L2 keeps its regex result.
  - `test_heuristic_layer_guess`: provider `None` → the layer with the largest line length among layers with ≥ 20 % parallel-pair coverage becomes wall, with warning `dxf_layers_guessed`.
  - `test_dxf_info`: `{insunits: 4, layerCount: ≥ 4, entityCount: n}`.
- [ ] **Step 2: Run it, expect FAIL.** Command: `uv run pytest tests/test_dxf_reader.py -q`.
- [ ] **Step 3: Implement** per 06 §10.1, §10.2 and §10.4.
  - ASCII is decoded with the `$DWGCODEPAGE` fallback `cp1252` (`errors="replace"`), then `ezdxf.read(io.StringIO)`. Binary goes through a temp file and `ezdxf.readfile`. On `DXFStructureError`, retry with `ezdxf.recover.read`.
  - Bulges become ARC records. Solid HATCH boundary paths become polylines.
  - `MTEXT.plain_text()` is used for text.
- [ ] **Step 4: Run tests, expect PASS.** Same command as Step 2.
- [ ] **Step 5: Quality gates.** `uv run ruff check . && uv run ruff format --check . && uv run mypy app`
- [ ] **Step 6: Commit.** `git add vision/app/pipeline/dxf/reader.py vision/app/pipeline/dxf/layers.py vision/tests/support/dxfgen.py vision/tests/test_dxf_reader.py` then `git commit -m "feat(vision): DXF reading, unit detection and layer classification" -m "$FURNY_TRAILER"`.

---

### Task 29: `/v1/inspect`, `/v1/normalize`, `/v1/images/normalize`

**Files:**
- Create: `vision/app/pipeline/runner.py` (with `run_inspect` and `run_normalize`; `run_recognition` is added in Task 31), `vision/app/api/inspect.py`, `vision/app/api/normalize.py`
- Modify: `vision/app/main.py` (include routers)
- Test: `vision/tests/test_inspect_normalize.py`

**Spec refs:** `06 §5.4`, `06 §5.6`, `06 §5.8`, `06 §7.1`–`§7.5`, `06 §10.5` (DXF preview render), `13-D` in `19`

**Interfaces:**
- Consumes: decode, PDF, normalize, rectify, `find_scale_note` (Task 20), `dxf_info`, `read_dxf` (Task 28), and the render function from Task 30. Inspect must not depend on Task 30, so the DXF preview here uses a minimal `render_dxf_preview(drawing) -> np.ndarray` defined in `vision/app/pipeline/dxf/render.py` in this task; Task 30 extends that file.
- Produces:
  - `run_inspect(req: InspectRequest, ctx) -> InspectResponse`.
  - `run_normalize(req: NormalizeRequest, ctx) -> NormalizeResponse`.
  - `run_image_normalize(req: ImageNormalizeRequest, ctx) -> ImageNormalizeResponse`.
  - `load_page(data, kind, selected_page, hints, ctx) -> NormalizedPage`, shared with Task 31.
  - Routes `POST /v1/inspect` (light slot, 25 s), `POST /v1/normalize` (heavy slot, 100 s) and `POST /v1/images/normalize` (light slot, 60 s). Each is bearer-authenticated, runs in `anyio.to_thread.run_sync`, and calls `gc.collect()` after heavy work.

- [ ] **Step 1: Write the failing test.** Uses `TestClient`, with `app.state.io_factory` returning an `HttpIO` over `httpx.MockTransport` that serves fixture bytes and captures PUTs.
  - `test_inspect_pdf_pages`: a 3-page PDF →
    - `sourceKind` in `{pdf_vector, pdf_raster}` per page 1
    - `pageCount == 3`
    - 3 `pages` with `widthPt/heightPt` and `isVector`
    - thumbnails `image/webp` with long edge 320
    - preview `image/jpeg` long edge 1600 with `page == 1`
    - `photo is None`
  - `test_inspect_pdf_too_many_pages`: 21 pages → 422 `pdf_too_many_pages`.
  - `test_inspect_raster_photo`: a JPEG with EXIF `Make` → `photo.isLikelyPhoto is True`. A rectified warped-page image (Task 9 synthetic) → `suggestedCorners` has 4 pairs in 0..1 (TL, TR, BR, BL). A plain scan → `isLikelyPhoto False` and `suggestedCorners None`.
  - `test_inspect_low_resolution_warning`: a 540 px image → warnings include `{"code": "low_resolution", "params": {"longEdge": 540}}`.
  - `test_inspect_dxf`: `dxf == {"insunits": 4, "layerCount": n, "entityCount": m}`, one page entry with null pt sizes, and a preview present.
  - `test_inspect_dwg_and_unsupported`: DWG → 415 `dwg_not_supported`; GIF → 415 `unsupported_type`; source 404 → 502 `source_unavailable`.
  - `test_normalize_trace`:
    - A PNG plan → exactly one PUT to `normalizedPutUrl` with `Content-Type: image/png`.
    - The PUT body decodes to `pageImage.width × height`.
    - `scaleNote is None`.
    - A `pdf_vector` A3 page with the word `SCALE 1:100` → `scaleNote == {"mmPerPixel": 100 * 25.4 / dpi, "text": "SCALE 1:100"}`.
    - Hints `isPhoto` and `corners` → `pageImage.rectified True`.
  - `test_images_normalize`:
    - JPEG 400×200 with EXIF orientation 6, GPS and ICC, `applyOrientation=True`, `maxEdge=100`, `format="webp"`, `quality=80` → the PUT body has `Content-Type: image/webp`, decodes to 50×100, and has no EXIF, XMP or ICC.
    - The response is `{width: 50, height: 100, bytes: len(body)}`.
    - A body over 25 MB → 413 `too_large`.
    - Garbage → 422 `decode_failed`.
    - PUT 500 ×3 → 502 `upload_failed` with `retryable` true.
  - `test_inspect_light_slot_busy`: both light permits held and wait 0.1 s → 503 `busy`.
- [ ] **Step 2: Run it, expect FAIL.** Command: `uv run pytest tests/test_inspect_normalize.py -q`.
- [ ] **Step 3: Implement** per 06 §5.4, §5.6 and §5.8.
  - Inspect always uses the 26 214 400-byte cap, except DXF, which uses 15 728 640.
  - The PDF preview and thumbnails use the §7.2 render path at the computed DPI, then are downscaled.
  - The `isLikelyPhoto` rule follows 06 §5.4 (EXIF Make/Model, or a non-axis-aligned quad > 1.5 % of the diagonal from the image corners).
  - `/v1/normalize` runs stages §7.1–§7.5, uploads the PNG through `upload_bytes`, and looks for a scale note via pdfplumber words (pdf_vector) or OCR tokens on raster PDFs. On raster PDFs it uses `app.state.ocr` only when loaded.
- [ ] **Step 4: Run tests, expect PASS.** Same command as Step 2.
- [ ] **Step 5: Quality gates.** `uv run ruff check . && uv run ruff format --check . && uv run mypy app`
- [ ] **Step 6: Commit.** `git add vision/app/pipeline/runner.py vision/app/pipeline/dxf/render.py vision/app/api/inspect.py vision/app/api/normalize.py vision/app/main.py vision/tests/test_inspect_normalize.py` then `git commit -m "feat(vision): inspect, trace normalize and image normalize endpoints" -m "$FURNY_TRAILER"`.

---

### Task 30: DXF walls, openings, rooms, background render

**Files:**
- Create: `vision/app/pipeline/dxf/walls.py`
- Modify: `vision/app/pipeline/dxf/render.py`
- Test: `vision/tests/test_dxf.py`

**Spec refs:** `06 §10.3`, `06 §10.5`, `06 §8.7` step 5 (thickness snap)

**Interfaces:**
- Consumes: `DxfDrawing`, `classify_layers` (Task 28), `build_wall_graph` (Task 15), `find_room_faces` (Task 18), `snap_thickness` (Task 21), `HeuristicLabeler` (Task 19).
- Produces:
  - `DxfResult(page: NormalizedPage, candidates: CandidateSet, labels: LabelingResult, scale: ScaleResult, confidence_overrides: dict[str, float], usage_calls: list[UsageCall])`, where override keys are candidate ids.
  - `run_dxf(data: bytes, req: RecognizeRequest, provider: LLMProvider | None, ctx) -> DxfResult`.
  - `render_mm_per_px(extent_mm: float) -> float` and `render_dxf(drawing, roles, mm_per_px) -> np.ndarray`.

- [ ] **Step 1: Write the failing test.** Uses `dxfgen`.
  - `test_dxf_walls_paired`: `make_room_dxf(insunits=4)` → 4 exterior walls of thickness 230, their centreline rectangle ≈ 5770×3770 mm ±5 (inner faces at 0 and 6000 offset by 230/2), and confidence override 0.95.
  - `test_dxf_units_inches`: `make_room_dxf(insunits=1, scale=1/25.4)` → the same mm geometry ±2 mm.
  - `test_dxf_door_and_window`:
    - The door gap 900 has an ARC on `A-DOOR` centred within 100 mm of a gap end with radius 900 ± 15 % → a door at that hinge, with swing on the arc-midpoint side; confidence 0.9.
    - The window gap 1200 with lines on `A-GLAZ` → window with confidence 0.9.
    - A plain 1000 mm gap → `opening` with confidence 0.5.
  - `test_dxf_single_line_walls`: a 2000 mm single line on the wall layer → a wall with `defaults.interiorWallThicknessMm` (115), reason `single_line_wall`, confidence 0.6.
  - `test_dxf_room_named`: one room face named `Bedroom`, type `bedroom`.
  - `test_coordinates_margin`: x_mm of the leftmost wall face ≈ 500 + 115 (the y flip and 500 mm margin, 06 §10.3 step 1).
  - `test_render_scale`: `render_mm_per_px(7230) == 5.0`; `render_mm_per_px(40000) == 10.0`. The render image has long edge ≤ 4000 px, and its size equals the extent including margin divided by mm/px.
  - `test_scale_method`: `scale.method == "dxf_units"`, `confidence == 1.0`, `mm_per_px` = render scale, `residual_pct is None`.
- [ ] **Step 2: Run it, expect FAIL.** Command: `uv run pytest tests/test_dxf.py -q`.
- [ ] **Step 3: Implement** per 06 §10.3 and §10.5.
  - Express DXF geometry in render pixels (`px = mm / mm_per_px`) so it flows through the regular `CandidateSet` → assemble path with `k = mm_per_px`, and document mm equals DXF mm.
  - Rooms are found on a 20 mm/px rasterisation, then scaled to render px.
  - `pageImage`: `dpi=None`, `rectified=False`, `deskewDeg=0`, `resampleFactor=1`, `sourcePage=1`.
- [ ] **Step 4: Run tests, expect PASS.** Same command as Step 2.
- [ ] **Step 5: Quality gates.** `uv run ruff check . && uv run ruff format --check . && uv run mypy app`
- [ ] **Step 6: Commit.** `git add vision/app/pipeline/dxf vision/tests/test_dxf.py` then `git commit -m "feat(vision): DXF wall pairing, openings, rooms and background render" -m "$FURNY_TRAILER"`.

---

### Task 31: `run_recognition` and `/v1/recognize` (meta, usage, debug artifacts, upload)

**Files:**
- Modify: `vision/app/pipeline/runner.py` (add `run_recognition` and stage orchestration), `vision/app/main.py` (router)
- Create: `vision/app/api/recognize.py`
- Test: `vision/tests/test_recognize.py`

**Spec refs:** `06 §5.5`, `06 §6` (every meta field), `06 §7` (stage order), `06 §9.1`, `06 §13` (8 artifacts, names and order), `18 §6.4`, `18 §7.5`

**Interfaces:**
- Consumes: every previous pipeline module, `get_provider` through `app.state.provider_factory`, `LlmLabeler`, `HeuristicLabeler`, `run_dxf`, `build_usage`.
- Produces:
  - `run_recognition(req: RecognizeRequest, ctx: PipelineContext, provider: LLMProvider | None) -> RecognizeResponse`.
  - `build_meta(...) -> ImportResultMeta`.
  - Route `POST /v1/recognize` (heavy slot, deadline `settings.vision_recognize_deadline_s`).
  - `DEBUG_NAMES = ["01-ink.png", "02-walls.png", "03-candidates.png", "04-result.png", "05-ocr.json", "06-candidates.json", "07-labeling.json", "08-scale.json"]`.
  - `candidates_hash(candidates_json: str) -> str` (sha256 hex; used by Task 34 replay fixtures).

- [ ] **Step 1: Write the failing test.** The synthetic plan comes from `synth`:
  - 2400×1800 canvas; filled 14 px outer walls (300,300)–(2100,1500) and a partition at x = 1200 with a 70 px door and arc.
  - Text `BEDROOM` at (600, 900) and `LIVING` at (1550, 900).
  - Dimension chain at y = 200 with ticks [300, 1200, 2100] labelled `9000`, `9000`, and an overall chain at y = 120 with ticks [300, 2100] labelled `18000`. So k ≈ 10 mm/px.

  The tests (`slow`, real OCR):
  - `test_recognize_none`: provider `none` →
    - 200; `document.walls` has 7 walls; rooms named `Bedroom` and `Living`; ≥ 1 door.
    - `meta.scale.method == "dimension_chain"` and `abs(meta.scale.mmPerPixel / 10 - 1) <= 0.03`.
    - `meta.detectedUnitSystem == "metric"`, `meta.providerRequested == meta.providerUsed == "none"`, `meta.model is None`, `meta.fallbackReason is None`.
    - `meta.metaVersion == 1`, `serviceVersion == "1.0.0"`, `pipelineVersion == "1.0.0"`, `sourceKind == "raster"`.
    - `meta.counts.walls == 7`, `meta.timings["totalMs"] > 0` and keys a subset of the `StageKey` values plus `totalMs`.
    - `ocrTokens.metricDimensionTokens >= 3`.
    - `usage == {"provider": "none", "model": None, "calls": [], "totals": {all zero}, "status": "succeeded"}`.
    - A PUT to `normalizedPutUrl` with `image/png`; 8 debug PUTs in index order with `debugArtifacts` names equal to `DEBUG_NAMES`.
    - `background.mediaUuid == ""`.
    - `PlanDocument.model_validate` passes.
  - `test_recognize_debug_false`: `options.debug = False` → no debug PUTs and `debugArtifacts == []`.
  - `test_recognize_replay_provider`: `ReplayProvider` with a `LabelingResult` that renames R1 to `Master Bedroom` → room `Master Bedroom` with type `master_bedroom`, `providerUsed == "anthropic"`, `usage.calls[0].purpose == "labeling"`.
  - `test_recognize_fallback`: `FakeProvider` raising `ProviderUnavailable` with fallback on → 200, `providerUsed == "none"`, `fallbackReason == "llm_error"`, warning `llm_failed_fallback_none`, `usage.status == "failed"`, `usage.provider == "anthropic"`.
  - `test_recognize_fallback_disabled`: the same with `fallbackToNoneOnError: false` → 502 with body `error.code == "provider_error"`, `retryable` true, and `error.usage.calls` length 1.
  - `test_recognize_model_default`: options `model: null` → the provider factory is called with `None`, and `meta.model` equals the served model from the fake.
  - `test_recognize_deadline`: settings `vision_recognize_deadline_s=0.001` → 504 `deadline_exceeded`.
  - `test_recognize_not_a_floor_plan`: a blank white 2000×1500 image → 422 `no_walls_detected`.
  - `test_recognize_pdf_vector`: a vector PDF of the same plan (lines + words) → `sourceKind == "pdf_vector"`, `pageImage.dpi` set, deskew skipped, OCR not called.
  - `test_recognize_dxf`: DXF bytes → `sourceKind == "dxf"` and `scale.method == "dxf_units"`.
  - `test_upload_after_anisotropy`: monkeypatch `solve_scale` to return `y_factor=1.05` → the uploaded PNG height equals `round(H × 1.05)`, `pageImage.height` matches, and `anisotropyCorrected` is true.
- [ ] **Step 2: Run it, expect FAIL.** Command: `uv run pytest tests/test_recognize.py -q`.
- [ ] **Step 3: Implement.**
  - **Stage order** (06 §7), each wrapped in `ctx.stage(...)`:
    - `fetch` (cap by kind) → `decode` (DXF branch → `run_dxf`, then skip to `assemble`) → `normalize` (`load_page`) → `preprocess` → `ocr`.
    - Then `segments` → dimension lines (inside the `dimensions` stage) → `walls` (extract and graph) → spans → `openings` → `rooms` → `labeling` → `scale`.
    - Then anisotropy correction (`cv2.resize` of the page image along y and `candidates.scale_y`, timed inside `scale`) → `assemble` → `validate` → `upload`.
  - **Labeler choice:**
    - `provider is None` → `HeuristicLabeler`.
    - Otherwise `LlmLabeler(provider, LabelerOptions(agentic_crops=opt.agentic_crops, effort=opt.effort, fallback_to_none=opt.fallback_to_none_on_error, max_turns=settings.vision_agent_max_turns, max_crops=settings.vision_agent_max_crops, call_timeout_s=…per provider, stage_budget_s=settings.vision_llm_stage_budget_s, max_output_tokens=…per provider))`.
    - The labeler wraps the heuristic labeler for fallbacks.
  - **Meta:**
    - `drawingKind` = the labels' kind, or the CV kind when heuristic.
    - `ocrTokens.sample` = ≤ 20 strings, longest first.
    - `counts.texts` = the number of text labels in the document.
    - `planRegion` comes from `Preprocessed.region` after the y factor.
    - Warnings = `ctx.warnings` plus assembly and validation warnings, deduplicated.
  - **Debug artifacts** are written at their stages (`03-candidates.png` = the marked overview, generated even for provider `none` when `debug` is on). Flush them after the normalized upload.
  - **Endpoint:**
    - Resolve the provider via `app.state.provider_factory(opt.provider, opt.model)`; `none` → `None`.
    - Run in a thread under the heavy slot.
    - `VisionError` carrying `usage` is serialised into the body `usage`.
    - `gc.collect()` in `finally`.
- [ ] **Step 4: Run tests, expect PASS.** Same command as Step 2.
- [ ] **Step 5: Quality gates.** `uv run ruff check . && uv run ruff format --check . && uv run mypy app`
- [ ] **Step 6: Commit.** `git add vision/app/pipeline/runner.py vision/app/api/recognize.py vision/app/main.py vision/tests/test_recognize.py` then `git commit -m "feat(vision): recognition runner and /v1/recognize endpoint" -m "$FURNY_TRAILER"`.

---

### Task 32: Expected reference documents (`*.expected.json`)

**Files:**
- Create: `vision/tests/fixtures/reference/hdb-3room.expected.src.json`, `vision/tests/fixtures/reference/brochure-2bhk.expected.src.json`
- Create: `vision/scripts/build_expected.py`, `vision/tests/fixtures/reference/hdb-3room.expected.json`, `vision/tests/fixtures/reference/brochure-2bhk.expected.json` (generated, committed)
- Test: `vision/tests/test_expected_fixtures.py`

**Spec refs:** `03 §6` (fixture contents), `06 §16.2` (expected files are in the source-image frame × scale), `06 §16.3`

**Interfaces:**
- Produces:
  - Source format `ExpectedSource`:

    ```json
    {"image": "hdb-3room.webp", "mmPerPixel": 0.0,
     "nodes": {"N1": [x_px, y_px]},
     "walls": [["N1", "N2", thicknessMm, kind]],
     "openings": [[wallIndex, centerPx_along_from_a, widthMm, "door" | "window" | "opening"]],
     "rooms": [[name, roomType, [anchor_x_px, anchor_y_px]]]}
    ```
  - `build_expected(src_path) -> PlanDocument`. Coordinates are `round(px × mmPerPixel)`. Ids are deterministic (`n_` + `f"{i:010d}"` mapped to base36 digits, matching the id regex). The background is `{importId: null, mediaUuid: "expected", pixelWidth, pixelHeight of the source image, mmPerPixel, position (0,0), …}`. `meta.createdWith = "import"`.
  - CLI: `uv run python scripts/build_expected.py tests/fixtures/reference/*.expected.src.json`.

- [ ] **Step 1: Write the failing test** `tests/test_expected_fixtures.py`:
  - `test_expected_documents_valid`: both `.expected.json` files validate as `PlanDocument`, and `build_expected(src)` equals the committed JSON (no stale generation).
  - `test_hdb_overall_and_rooms`: the wall-centreline bbox is 11 000 ± 400 mm by 8 900 ± 400 mm wide/high (exterior dimensions; the main body of 7 000 plus the balcony). Room names, case-insensitive: BEDROOM ×3, TOILET ×3, KITCHEN, LIVING, BALCONY. Opening count ≥ 6 doors.
  - `test_brochure_rooms`: rooms BEDROOM ×2, TOILET ×2, KITCHEN, LIVING/DINING, DECK; no room of type `ots` or `corridor`. Every wall midpoint `y_px` (= y_mm / mmPerPixel) is < 0.75 × 540 (the key plan is excluded).
- [ ] **Step 2: Run it, expect FAIL.** Command: `uv run pytest tests/test_expected_fixtures.py -q`.
- [ ] **Step 3: Implement** by measuring the two images. To view a magnified crop, save it to a scratch PNG with Pillow (`Image.open(...).crop(box).resize(..., NEAREST)`) and open it with the Read tool. Work in source-image pixels.
  - **`hdb-3room.webp` (1300×1080).**
    - Locate the x-pixels of the two outer ticks of the top `11000` overall dimension; `mmPerPixel = 11000 / Δx`. Cross-check with the right `8900` dimension (must agree within 2 %).
    - Trace wall centrelines of the dwelling: outer walls, bedroom/toilet partitions and the balcony walls.
    - Thickness: filled black walls ≈ 200–300 mm; thin double lines ≈ 100–115 mm.
    - Openings from door arcs and window gaps.
    - Rooms: 3 bedrooms (3100/3600/3100 wide per 03 §6), 3 toilets, kitchen, living room, balcony 3600×900.
  - **`brochure-2bhk.png` (381×540).**
    - `mmPerPixel` = 3048 / (mean interior width in px of the two `BEDROOM 10'0"x11'0"` rooms).
    - Trace only the dwelling: bedrooms, toilets, kitchen (with W/M), living/dining, deck.
    - Exclude the corridor, the OTS shaft, the neighbouring flats and the key-plan strip below `FLAT-105-505 2 BHK`.
- [ ] **Step 4: Run tests, expect PASS.** Same command as Step 2.
- [ ] **Step 5: Quality gates.** `uv run ruff check . && uv run ruff format --check . && uv run mypy app`
- [ ] **Step 6: Commit.** `git add vision/tests/fixtures/reference/*.expected.src.json vision/tests/fixtures/reference/*.expected.json vision/scripts/build_expected.py vision/tests/test_expected_fixtures.py` then `git commit -m "test(vision): hand-traced expected PlanDocuments for reference blueprints" -m "$FURNY_TRAILER"`.

---

### Task 33: Evaluation harness `scripts/evaluate.py`

**Files:**
- Create: `vision/app/evaluation/__init__.py`, `vision/app/evaluation/metrics.py`, `vision/app/evaluation/report.py`, `vision/scripts/evaluate.py`
- Test: `vision/tests/test_evaluate_metrics.py`

**Spec refs:** `06 §16.2` (every metric), `06 §16.3` (targets table), `06 §16.1` (`--record`)

**Interfaces:**
- Consumes: `run_recognition`, `LocalIO`, `PipelineContext`, `find_room_faces`, `get_provider`, `ReplayProvider`, `candidates_hash`.
- Produces, in `metrics.py`:
  - `scale_error(k_pred, k_true, resample_factor) -> float`.
  - `align(pred: PlanDocument, expected: PlanDocument) -> tuple[float, float, float]` (rotation, dx, dy, maximising wall IoU).
  - `wall_iou(pred, expected, transform) -> float`.
  - `wall_count_ratio(pred, expected) -> float`.
  - `room_f1(pred, expected, transform) -> float`.
  - `opening_f1(pred, expected, transform) -> float`.
  - `room_names_found(pred) -> Counter[str]`.
  - `inset_excluded(pred, k_pred, image_h_px) -> bool`.
  - `TARGETS: dict[tuple[str, str], dict[str, Any]]` with every row of 06 §16.3, keyed by `(fixture stem, "none" | "llm")`.
  - `check_targets(fixture, column, metrics) -> list[str]` (the failures).
- Produces, in `report.py`: `write_report(results, out_dir)` (`report.json`, `report.md`, and `{fixture}-{provider}-overlay.png`).
- Produces, CLI: `uv run python scripts/evaluate.py --fixtures tests/fixtures/reference [--provider none|anthropic|openai|openai_compatible|replay] [--model M] [--effort low|medium|high] [--record] [--out eval-out/] [--fail-under]`.
  - The script inserts its parent directory into `sys.path`.
  - `--record` (non-`none` provider) writes `tests/fixtures/llm/{stem}.labeling.json = {"pipelineVersion", "candidatesHash", "provider", "model", "result": LabelingResult}`.
  - `replay` reads that file.

- [ ] **Step 1: Write the failing test.**
  - `test_identity`: an expected document against itself → IoU 1.0, room F1 1.0, opening F1 1.0, count ratio 1.0, `scale_error == 0`.
  - `test_translation_recovered`: prediction shifted by (+100, −60) mm → after `align`, IoU > 0.95.
  - `test_rotation_recovered`: rotated 1.5° about the bbox centre → recovered within 0.25° and IoU > 0.9.
  - `test_scale_error`: prediction scaled by 1.1 with `k_pred = 1.1 k_true` → `scale_error ≈ 0.1`, and IoU after the `k_true / k_pred` rescale > 0.95.
  - `test_room_type_classes`: a predicted `toilet` matches an expected `bathroom`; `master_bedroom` ≡ `bedroom`; `living` ≡ `dining` ≡ `foyer`; `kitchen` does not match `bedroom`.
  - `test_opening_match_300mm`: a centre 250 mm away on the same wall side with the same kind matches; 350 mm does not.
  - `test_targets_table`: `TARGETS[("hdb-3room", "none")]["wall_iou_min"] == 0.65` and `["scale_error_max"] == 0.05`; `TARGETS[("brochure-2bhk", "llm")]["room_f1_min"] == 0.85`; `TARGETS[("brochure-2bhk", "none")]["scale_method"] == "room_label"`.
  - `test_cli_smoke(tmp_path)` (slow): `scripts/evaluate.py --provider none --fixtures <tmp dir holding a synthetic plan PNG + expected.json> --out tmp_path` exits 0 and writes `report.json` and `report.md`.
- [ ] **Step 2: Run it, expect FAIL.** Command: `uv run pytest tests/test_evaluate_metrics.py -q`.
- [ ] **Step 3: Implement** per 06 §16.2.
  - Wall outline = centreline `buffer(thickness / 2, cap_style="flat")` (shapely), rasterised at 20 mm/px with `cv2.fillPoly`.
  - Alignment searches rotation −3…+3° in 0.25° steps, translation to bbox centres, then ±200 mm in 20 mm steps.
  - Expected room polygons come from rasterised expected walls + `find_room_faces` at 20 mm/px + expected `RoomMeta` anchors.
  - Predicted named rooms include merged-name `TextLabel`s.
  - Matching is one-to-one and greedy.
  - Recognition runs in-process with `LocalIO`, `file://` sources, normalized/debug output into `--out`, and `debug=True`.
  - The source frame is converted with `resampleFactor`.
- [ ] **Step 4: Run tests, expect PASS.** Same command as Step 2.
- [ ] **Step 5: Quality gates.** `uv run ruff check . && uv run ruff format --check . && uv run mypy app`
- [ ] **Step 6: Commit.** `git add vision/app/evaluation vision/scripts/evaluate.py vision/tests/test_evaluate_metrics.py` then `git commit -m "feat(vision): evaluation harness with wall IoU, room/opening F1 and targets" -m "$FURNY_TRAILER"`.

---

### Task 34: Reference-fixture integration, replay fixtures, schema contract and live tests

**Files:**
- Create: `vision/tests/test_reference_fixtures.py`, `vision/tests/test_schema_contract.py`, `vision/tests/test_live_providers.py`
- Create: `vision/tests/fixtures/llm/hdb-3room.labeling.json`, `vision/tests/fixtures/llm/brochure-2bhk.labeling.json`
- Modify: any pipeline module, only to meet targets (see Step 3)
- Test: the three files above

**Spec refs:** `06 §16.1` (`test_reference_fixtures`, `test_schema_contract`, `test_live_providers`), `06 §16.3`, `06 §17` items 1 and 5, `18 §18` items 2–3, `17 §10.2` (`ENGINE_CLI`)

**Interfaces:**
- Consumes: `scripts/evaluate.py` internals (`app.evaluation`), `ReplayProvider`, `candidates_hash`.
- Produces: the committed replay fixtures `{"pipelineVersion": "1.0.0", "candidatesHash": "<sha256>", "provider": "anthropic" | "hand-authored", "model": "claude-opus-5-5" | null, "result": LabelingResult}` and the JSON outputs `tests/out/{fixture}-{none|replay}.json` for the engine contract job.

- [ ] **Step 1: Write the failing test.**
  - `test_reference_fixtures.py`, parametrised over `[("hdb-3room.webp", "none"), ("hdb-3room.webp", "replay"), ("brochure-2bhk.png", "none"), ("brochure-2bhk.png", "replay")]`:
    - Run in-process (`LocalIO`) and compute metrics with `app.evaluation.metrics`.
    - `assert check_targets(stem, column, metrics) == []`.
    - Assert `meta.scale.method` and `meta.detectedUnitSystem` per the 06 §16.3 table.
    - Assert room-name multisets (case-insensitive substring) per the table.
    - Brochure: `inset_excluded(...)` holds, and no room of type `ots` or `corridor` exists.
    - Provider `none`: `meta.timings["totalMs"] <= 60000`.
    - For `replay`: first assert `candidates_hash(current) == fixture["candidatesHash"]`, failing with the message `"candidates changed: re-record with scripts/evaluate.py --provider anthropic --record (or regenerate the hand-authored labels)"`. Then assert the LLM column targets.
  - `test_schema_contract.py`: writes each recognition document to `tests/out/{stem}-{provider}.json`. When `ENGINE_CLI` is set, pipe `{"document": doc}` to `node $ENGINE_CLI validate-plan` and assert `ok is True` and `result.valid is True` with no `error` issues. Otherwise `pytest.skip("ENGINE_CLI not set (P2 engine CLI)")`.
  - `test_live_providers.py` (`@pytest.mark.live`): for each provider whose key is in the environment, call `/v1/recognize` on both fixtures with `agenticCrops: true`, effort `high`, and assert the LLM-column targets and ≤ 240 s. Skip when keys are absent.
- [ ] **Step 2: Run it, expect FAIL.** Command: `uv run pytest tests/test_reference_fixtures.py tests/test_schema_contract.py -q`. Expected: missing replay fixtures, and targets possibly missed.
- [ ] **Step 3: Implement.**
  - **(a) Replay fixtures.** Run `uv run python scripts/evaluate.py --provider none --out eval-out/`. Then author the two labeling files by hand from `eval-out/*/06-candidates.json` and `03-candidates.png`. No API key exists in this environment.
    - Label every `T…`, `W…`, `O…` and `R…` the way a careful draftsperson would, using the 06 §9.3 prompt rules: neighbouring units, the corridor and OTS have `include=false`; key-plan texts are `ignore`; dimension texts carry `spanId` and `valueMm`.
    - Set `"provider": "hand-authored"` and the current `candidatesHash`.
  - **(b) Meeting the targets.** If a §16.3 target is missed:
    - Debug with the 8 debug artifacts and `report.md`.
    - Fix the defect inside the responsible stage, using the algorithm as specified.
    - Changing any numeric constant fixed by 06 is a spec deviation: list it in the commit body with the before/after metric values, and keep the per-stage unit tests green.
    - Bump `PIPELINE_VERSION` only if outputs change after this task is merged.
  - **(c)** Run `uv run python scripts/evaluate.py --provider none --fail-under` and `--provider replay --fail-under`; both must exit 0.
- [ ] **Step 4: Run tests, expect PASS.**

  ```bash
  uv run pytest -q
  uv run python scripts/evaluate.py --fixtures tests/fixtures/reference --provider none --fail-under
  uv run python scripts/evaluate.py --fixtures tests/fixtures/reference --provider replay --fail-under
  ```
- [ ] **Step 5: Quality gates.**

  ```bash
  uv run ruff check . && uv run ruff format --check . && uv run mypy app
  uv export --frozen --no-dev --no-hashes --no-emit-project -o /tmp/req.txt && diff -u requirements.txt /tmp/req.txt
  ```
- [ ] **Step 6: Commit.** `git add vision/tests/test_reference_fixtures.py vision/tests/test_schema_contract.py vision/tests/test_live_providers.py vision/tests/fixtures/llm vision/app` then `git commit -m "test(vision): reference blueprint accuracy targets, replay fixtures, contract test" -m "$FURNY_TRAILER"`.

---

## Self-review

### Spec coverage

**Python packages and layout**

| Requirement | Task |
|---|---|
| 01 §1.3 package list, licence bans | 1 |
| 06 §5.1 repository layout | 1, 3–31 (each module in its stage task) |
| 06 §5.1 `evaluation/` addition, `scripts/build_expected.py` | 33, 32 |

**Configuration, auth, logging, process model**

| Requirement | Task |
|---|---|
| 18 §4 environment variables, token ≥ 32 | 2 |
| 06 §5.3 auth, JSON logs, redaction | 2, 3 |
| 06 §5.2 workers, heavy/light slots, 503 busy + Retry-After, threads, gc, deadlines | 3, 6, 29, 31 |

**API endpoints**

| Requirement | Task |
|---|---|
| 06 §5.7 `/healthz` 503 until OCR loaded | 3 |
| `/v1/capabilities`, `/v1/providers/test` (18 §5) | 22 |
| 06 §5.4 `/v1/inspect` | 29 |
| 06 §5.6 `/v1/normalize` | 29 |
| 06 §5.8 `/v1/images/normalize` | 29 |
| 06 §5.5 `/v1/recognize` request/response | 5, 31 |

**Pipeline stages**

| Requirement | Task |
|---|---|
| 06 §7.1 fetch with streaming cap | 6 |
| 06 §7.2 sniff/decode/HEIC/pixel guards | 7 |
| 06 §7.2 PDF raster/vector | 8 |
| 06 §7.3 rectify, §7.4 deskew, §7.5 resample | 9 |
| 06 §7.6 Sauvola, colour, stroke width, style, thick mask, region | 10 |
| 06 §7.7 OCR, tiling, two passes, pdfplumber bypass, text mask | 12 |
| 06 §7.8 text parsing and room dictionary | 11 |
| 06 §7.9 segments, merge, θ0 | 13 |
| 06 §8.1 walls | 16 |
| 06 §8.1 graph | 15 |
| 06 §8.2–§8.3 scale and confidence | 20 |
| 06 §8.4 dimensions | 14 |
| 06 §8.5 openings | 17 |
| 06 §8.6 rooms | 18 (metric filters: 21) |
| 06 §8.7 assembly, confidence, validate | 21 |

**Labeling**

| Requirement | Task |
|---|---|
| 06 §9.1 labeler interface and fallback rules | 19, 26 |
| 06 §9.2 overview, marks, JSON, truncation | 23 |
| 06 §9.3 prompts verbatim | 26 |
| 06 §9.4 schema, strict schema, sanitize | 5, 26 |
| 06 §9.5 tools | 23 |
| 06 §9.6 agent loop | 27 |
| 06 §9.7 heuristic labeler | 19 |
| 06 §9.8 vendor protocol | 19 |

**DXF, meta, debug, errors**

| Requirement | Task |
|---|---|
| 06 §10.1–10.2, §10.4 DXF reading, layers, layer prompt | 28 |
| 06 §10.3, §10.5 DXF geometry and render | 30 (preview: 29) |
| 06 §6 `ImportResultMeta` (all fields, warnings, reasons) | 4, 31 |
| 06 §13 debug artifacts | 6, 31 |
| 06 §14.2 error mapping | 3 (codes raised in 6–31) |

**Providers**

| Requirement | Task |
|---|---|
| 18 §6.1–6.3 neutral types, errors, registry | 22 |
| 18 §6.4 usage reporting | 22, 31 |
| 18 §7.1 Anthropic: adaptive thinking, effort, structured output, strict tools, auto/none `tool_choice`, server fallback, refusal | 24 |
| 18 §7.2 OpenAI | 25 |
| 18 §7.3 compat flags, prompt-JSON, repair | 25, 26 |
| 18 §7.4 none provider | 22 |
| 18 §7.5 degradation, lastError | 22, 24, 26 |
| 18 §3 image and size rules | 23, 24, 25 |
| `FakeProvider` / `ReplayProvider` | 22 |
| No real API calls in CI | Global Constraints, 24, 25, 34 |

**Tests and evaluation**

| Requirement | Task |
|---|---|
| 06 §16.1 test files | 3, 7, 9, 11, 16, 20, 19, 27, 30, 21, 34 |
| 18 §17.1 provider tests | 22, 24, 25, 26 |
| 06 §16.2 evaluation harness | 33 |
| 06 §16.3 accuracy targets, 60 s budget | 34 |
| 03 §6 expected fixtures | 32 |

**Deployment**

| Requirement | Task |
|---|---|
| 17 §5.9 `nixpacks.toml`, `.dockerignore`, requirements export, CI commands | 1, 34 |
| 17 §6.2 environment variables | 2 |

**Not in P3 (Laravel side, P6):** cost computation (18 §13 is Laravel's `CostCalculator`); the vision service reports token usage only. Credits, budget and `ResolveRecognitionPlan` are also P6.

### Step scan

Every step names files, tests, exact assertion values and commands. The places where the spec leaves a choice are made explicit:
- light-slot wait
- PUT backoff count
- debug-PUT failure handling
- unitless metric pairs
- `validate_and_repair` inputs
- token sort key

Each is listed in the gap list below so the reviewer can confirm it. Task 34's "tune to targets" step is bounded: fixes go inside the spec algorithms, and constant changes are recorded with metrics.

### Type consistency

- Candidate types are all introduced in `schemas/candidates.py` by their first producer: `ParsedText` (11), `TextToken` (12), `Segment` (13), `DimensionLine`/`DimensionSpan` (14), `RawWall`/`WallCandidate`/`GapCandidate`/`WallGraph` (15), `OpeningCandidate` (17), `RoomFace`/`CandidateSet` (18).
- `NormalizedPage` (9), `Preprocessed` (10), `OcrResult` (12), `ScaleResult` (20), `AssembleResult`/`ConfidenceMap` (21), `Overview` (23), `LabelingOutcome` (19), `LabelerOptions` (26) and `DxfResult` (30) are each consumed by name downstream.
- Provider types are verbatim from 18 §6.1 (22).
- `UsageCall` is typed `list[Any]` in `LabelingOutcome` until Task 22. That is an acknowledged forward reference: tighten the annotation in Task 26.

### Review Focus

Each of the five focus items has a named test in its owning task (Tasks 6, 7, 8, 9, 10, 12, 26, 27, 28/30, 29, 34).

### Proportion

The plan specifies signatures, test values and the approach. Code appears only for test fixtures (synth API, expected-source format) and the request-shape assertions that pin the external API contract.

### Spec gaps and decisions to record in PR descriptions

1. **`nixpacks.toml` start command conflict.** 06 §5.1 says `--timeout-keep-alive 650`; 17 §5.9 says `--timeout-graceful-shutdown 30`. The plan follows 17 §5.9, the deployment owner. The keep-alive setting has no effect on single long requests.
2. **Stale RapidOCR comment.** 17 §5.9's comment says rapidocr pulls non-headless opencv. rapidocr 3.10 depends on `opencv-python-headless` and bundles its PP-OCRv6 models in the wheel, so the "download at build" step only verifies them. huggingface.co and modelscope.cn are blocked here.
3. **SDKs use `httpx2`.** anthropic 1.x and openai 3.x are built on `httpx2`, so 18 §17.1's `httpx.MockTransport` injection must use `httpx2` through `DefaultHttpxClient`.
4. **Anthropic server-side fallback details.** The top-level `usage` covers only the final attempt; the plan sums `usage.iterations`. Pre-fallback thinking and tool_use blocks are dropped from replayed history. Neither rule is in 18 §7.1.
5. **Missing fixtures.** No `*.expected.json`, no recorded LLM fixtures and no API key exist. 03 §6 says the expected files are copies of P2's `database/fixtures/plans/*` fixtures, but P3 runs in parallel, so Task 32 hand-traces them and Task 34 hand-authors the replay labels (guarded by `candidatesHash`).
6. **Missing spec files.** `14-routes-and-api.md` and `16-testing-quality.md` are referenced by the master and other sections but do not exist.
7. **Unspecified behaviour, decided in the plan:**
   - The light slot waits 2 s, then returns 503 (Task 3).
   - `/v1/providers/test` takes no slot (Task 22).
   - Debug PUT failures are non-fatal (Task 6).
   - "3 attempts, 1/2/4 s" PUT backoff: 3 attempts with waits of 1 s and 2 s (Task 6).
   - Unitless metric size pairs: values < 100 are read as metres (Task 11).
   - OCR token sort key: `(y0, x0)` (Task 12).
   - `validate_and_repair` also takes `confidence` and `drawing_kind` (Task 21).
8. **HEIC decoding cannot be tested offline.** pi-heif is decode-only and no HEIC fixture exists (Task 7).
9. **Python download blocked.** `uv python install 3.12` cannot download (releases.astral.sh is blocked); the system `/usr/bin/python3.12` (3.12.3) is used.
