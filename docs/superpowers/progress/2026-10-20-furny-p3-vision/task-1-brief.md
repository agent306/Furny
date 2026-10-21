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

