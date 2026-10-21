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

