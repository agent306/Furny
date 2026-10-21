# Task 4 report: PlanDocument / ImportResultMeta schemas, id generator

Status: DONE_WITH_CONCERNS (minor decisions listed below). Commit b0fced9 "feat(vision): PlanDocument and ImportResultMeta pydantic mirrors".

## Implemented
- vision/app/schemas/base.py: `CamelModel` (alias_generator=to_camel, populate_by_name, extra="forbid"), `wire()` = model_dump(mode="json", by_alias=True).
- vision/app/schemas/plan.py: PlanDocument, PlanMeta, WallNode, Wall, Opening, RoomMeta, FurniturePlacement, Fixture, DimensionAnnotation, TextLabel, Annotations, BackgroundImage, ViewState, Point (+ helper models WallAttachment, DimensionAttachment, View2D, View3D); Literals RoomType (19), DoorType, WindowType. Ranges per 03 1.1 (thickness 50-1000, height 300-10000, opening width 300-6000, sill 0-3000, coords +-1 000 000, opacity 0..1, mmPerPixel > 0, schemaVersion Literal[1], text <= 200). placements/fixtures default to empty dicts.
- vision/app/schemas/meta.py: Literals ProviderName, ScaleMethod, StageKey (16), SourceKind, DrawingKind, FallbackReason (7), WarningCode (26), ReasonCode (13); models MetaWarning, PageImage, PlanRegion, ScaleSample, RoomLabelCheck, ScaleMeta, ConfidenceMeta, OcrTokenStats, MetaCounts, ImportResultMeta (+ InspectMeta, DxfInspect, ReviewState). `metaVersion` Literal[1]; `timings` validator requires `totalMs` and StageKey-only other keys; optional `inspect`/`review` are omitted from `wire()` while None.
- vision/app/utils/ids.py: `new_id(prefix)` = `{prefix}_` + 10 chars of secrets.choice over [0-9a-z].
- vision/tests/test_schemas_plan_meta.py: 32 tests (all brief tests, plus parametrized range cases, view/annotation roundtrip, Laravel-added fields roundtrip, meta rejection cases).

## TDD evidence
- RED (implementation files moved away): `uv run pytest tests/test_schemas_plan_meta.py -q` -> `ModuleNotFoundError: No module named 'app.schemas.meta'`, 1 collection error. (Tests were written alongside the implementation, then RED verified by removing the modules.)
- GREEN: `32 passed in 0.10s`. Full suite: `78 passed`. `ruff check`, `ruff format --check`, `mypy app` (strict) all clean.

## Decisions / concerns
1. pydantic `to_camel("mode2d")` yields `mode2D`; `ViewState.mode2d/mode3d` use explicit `Field(alias="mode2d")` / `"mode3d"` so the wire is `mode2d`/`mode3d` (a test caught this).
2. `Fixture.library_key` is `str`: FixtureKey is a 35-key enum owned by the editor (05 9.4); P3 never emits fixtures. Tighten later if desired.
3. Added constraints beyond the brief taken from the 06 6 comments: confidence values (scale.confidence, confidence.*, overall) constrained to 0..1; `usedSamples` max 60; `ocrTokens.sample` max 20. Producers (later tasks) must clamp/truncate or validation fails.
4. `ScaleSample` (pydantic, meta.py) and `ProviderName` live in meta.py as the brief says; preflight I3 notes later tasks (T5/T20/T22) must avoid redefining/colliding with them.
5. Commit trailer names Sonnet 5.5 per the ledger ruling on implementer attribution.
6. Not pushed (controller's call).

## Files
vision/app/schemas/base.py, plan.py, meta.py; vision/app/utils/ids.py; vision/tests/test_schemas_plan_meta.py
