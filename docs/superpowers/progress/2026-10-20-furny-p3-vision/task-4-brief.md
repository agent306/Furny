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

