# Task 5 report

Status: DONE

## Implemented
- `vision/app/schemas/api.py`: all models of the brief (source/output/hints/options, recognize/inspect/normalize/images-normalize, usage, DebugArtifact, capabilities, provider test).
- `vision/app/schemas/labeling.py`: 06 §9.4 models + `LayerRoleItem`/`LayerMapping` (06 §10.4), all `CamelModel` (snake_case Python, spec camelCase on the wire). No range constraints (sanitize in T26 clamps).
- `vision/app/utils/json_schema.py`: `to_strict_schema` (inlines `$ref`/`$defs`, `additionalProperties: false`, full `required`, strips title/description/default/minimum/maximum/exclusiveMin/Max; property names such as `title` are preserved; recursive models raise `ValueError`), `parse_json_object` (fences/prose tolerant, `ValueError`).

## Rulings applied
- K3: `ProviderInfo.missing` omitted when None via a wrap `model_serializer` (works regardless of pydantic minor; pyproject allows >=2.9). Other nulls (`lastError`, `defaultModel`) still emitted. Inspect/normalize use `ApiWarning(code, params)` with no `entityIds` (extra forbidden).
- Progress ruling / I3: `ProviderName`, `ScaleSample` imported from `app.schemas.meta`; `Effort` defined once in `api.py` (T22 `providers/base.py` should re-export it).
- K1 paths, K2 (`recognizeDeadlineS` is float), commit trailer per attribution reminder.

## Design notes / decisions
- `DxfInfo = DxfInspect` (same shape already in meta.py) rather than a duplicate class.
- `PreviewImage(EncodedImage)` adds `page`; thumbnails are plain `EncodedImage` so wire round-trips exactly.
- `RecognizeResponse.wire()` also drops unset `meta.inspect`/`meta.review` (as `ImportResultMeta.wire()`).
- `RecognizeOptions`: `model` defaults None; `hints`/`defaults` default-construct (defaults = 06 §5.5 values); `provider`, `effort`, `agentic_crops`, `fallback_to_none_on_error` required.
- `ProviderLastError.at` is a `datetime` (round-trips `...Z`). `UsageCallOut.purpose` includes `provider_test` (18 §5.3).
- Corners: 4 x (x, y) floats in 0..1; `knownDimension` label <=80, mm 100..100000; wallHeightMm 2000..6000 (02 hints spec).
- `DebugArtifact` must be built with keywords (pydantic), as noted in preflight.
- Strict schema limitation: `dict[str, X]` fields would have `additionalProperties` overwritten with false (none exist in LabelingResult/LayerMapping).
- `maxLength` etc. are not stripped (brief lists only the keys above); none are used in labeling models.

## TDD
- RED: `uv run pytest tests/test_schemas_api.py tests/test_json_schema.py -q` -> 2 collection errors, `ModuleNotFoundError: No module named 'app.schemas.labeling'` (expected, modules absent).
- GREEN: same command -> 28 passed. Full suite: 106 passed.
- Gates: `ruff check .` clean, `ruff format --check .` clean, `mypy app` no issues.

## Files
vision/app/schemas/api.py, vision/app/schemas/labeling.py, vision/app/utils/json_schema.py, vision/tests/test_schemas_api.py, vision/tests/test_json_schema.py

## Concerns
- test_schemas_api.py imports `meta_js`/`plan_js` from `test_schemas_plan_meta` (works via pytest rootdir sys.path; would be cleaner as shared fixtures in tests/support later).
