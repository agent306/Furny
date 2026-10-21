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

