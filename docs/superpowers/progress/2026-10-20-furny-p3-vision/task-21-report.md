# Task 21 report: assembly, confidence, metric filters, validate-and-repair

Status: DONE_WITH_CONCERNS (one environment-sensitive perf test fails on HEAD too, see Concerns).

## Implemented

- `vision/app/pipeline/assemble.py`: `ConfidenceMap`, `AssembleResult`, `snap_thickness`, `fit_vertical`, `assemble_document` (06 §8.6 post-scale filters, §8.7 steps 1-9).
  - Signature: `assemble_document(page, candidates, labels, scale, options, ctx, *, confidence_overrides=None, reason_overrides=None, provider_used=None, face_map=None) -> AssembleResult`.
  - K14: `confidence_overrides` / `reason_overrides` (keyed by candidate id) replace the computed confidence / reasons before `overall`.
  - `provider_used` (default `options.provider`) says whether the heuristic labeler made `labels` (it decides the 0.6 wall `llm` term, the 0.6 room size check and the skipped LLM opening bonuses). T31 should pass the real `provider_used`, because a fallback to `none` keeps `options.provider` unchanged.
  - `face_map` is optional (the map from `find_room_faces`, valid for the same frame only). When absent it is rebuilt from the room polygons with `cv2.fillPoly` (carry 5: rebuilt, never reused, after `scale_y`).
  - K19: warnings `rooms_without_names {count}`, `walls_unconnected {count}`, `room_names_merged {names}`, `entities_outside_unit_removed {walls, rooms}`; reasons `name_guessed`, `size_mismatch`, `unconnected`, `llm_unsure` plus the rest of §6.
  - `id_map` maps candidate ids (`N`, `W`, `O`, `R`) to document ids.
- `vision/app/pipeline/validate.py`: `validate_and_repair(doc, *, confidence, drawing_kind)`.
  - Repairs: missing-node, <10 mm and duplicate-pair walls, orphan nodes, offset clamp into `[width/2, len - width/2]`, drop when the wall is shorter than width + 100 mm, numeric ranges, `sill + height <= wall.height`, overlap resolution (`openings_dropped_overlap {count}`).
  - Errors: `too_complex` (>2000 walls or >1000 openings), `no_walls_detected`, `not_a_floor_plan` (<4 walls; with >=4 only `not_a_floor_plan_suspected`). All 422 through the existing `ERROR_TABLE`.
  - Schema strictness (carry 3): angles (`northAngle`, label and background rotation) to [0, 360), `colorHex` / `floorColorHex` kept only if `#RRGGBB` else null, every entity id must match `^(n|w|o|r|t)_[0-9a-z]{10}$` and equal its record key (else `internal_error`, an upstream bug). `mmPerPixel > 0` is the model's own constraint. A final `PlanDocument.model_validate(doc.wire())` runs last.
  - The `ConfidenceMap` is pruned in place of every removed wall / opening (entries and reasons).
- `vision/app/pipeline/scale.py` (carry 4, minimal): samples with span < 10 px or an estimate outside 0.25-250 mm/px are dropped in `_collect` (dimension, known and room samples; a room's two samples go together). An absurd label now falls through to `room_label` / `scale_note` / `user_hint` / `default_guess`. The ±1e6 clamp in `to_scale_meta` stays as the backstop.
- Absurd-scale path in assembly: any document coordinate beyond ±1e6 mm raises `VisionError("too_complex", 422)` (clean failure, no pydantic crash).

## Files

- New: `vision/app/pipeline/assemble.py`, `vision/app/pipeline/validate.py`, `vision/tests/test_assemble_validate.py` (35 tests), `vision/tests/test_reference_assemble.py` (4 tests, both reference blueprints through chain, heuristic labeler, scale, assemble, validate).
- Changed: `vision/app/pipeline/scale.py`, `vision/tests/test_scale.py` (the old `test_meta_holds_sample_ends_to_the_document_range` built its absurd scale from a 2 px span, which collection now rejects; it now builds the `ScaleResult` by hand to keep testing the backstop, and `test_implausible_samples_are_rejected_at_collection` is new).

## TDD evidence

RED (modules moved away, then run): `uv run pytest tests/test_assemble_validate.py -q -p no:cacheprovider`
```
E   ModuleNotFoundError: No module named 'app.pipeline.assemble'
ERROR tests/test_assemble_validate.py
1 error in 1.09s
```
GREEN, after fixing several test mistakes of mine (see Notes) and two implementation changes (wall reasons in spec order, tidy opening-type handling):
```
tests/test_assemble_validate.py ...................................   [100%]   35 passed
tests/test_scale.py + tests/test_reference_assemble.py                 53 + 4 passed
```
Real-data run (heuristic labeler, hdb-3room / brochure-2bhk): 61 / 47 walls (none removed by validation), 8 / 11 openings, 5 / 5 rooms, overall 0.87 / 0.62.

## Full gate (WSL, ENV.md command)

- `ruff check .`: All checks passed
- `ruff format --check .`: 99 files already formatted
- `mypy app`: Success, no issues in 59 source files
- `pytest -q -p no:cacheprovider`: `1 failed, 1167 passed, 1 skipped, 3 xfailed in 252.03s`. The failure is `tests/test_walls_closure.py::test_rejoining_many_thin_lines_is_fast_and_polls_the_deadline` (`assert perf_counter() - start <= 0.5`). It also fails on a stashed clean HEAD (`git stash -u`, same test, 1 failed in 7.80s) and does not import any file I touched. Everything else passes.

## Deviations / decisions

1. Outside-unit wall removal (§8.7 step 1) runs only when some labeled room is `include=false` and at least one included face exists. Without that guard a plan with no closed faces would lose every wall (and then fail `no_walls_detected`). The sides use the midpoint at 0.75 t only, as the spec says. Metric-dropped faces count as not included.
2. Heuristic labeler (`provider_used == "none"`): wall `llm` term 0.6 whatever the verdict, no `llm_unsure` reason, no +0.15 / -0.1 opening adjustments (spec gives no heuristic row for openings and a heuristic "unsure" is derived from low support, already in the formula). A verdict that names another kind is still honoured. Room size check without a label is 0.6 (heuristic) / 0.7 (LLM), as the spec says.
3. `reason_overrides` replace the computed reason list of that entity (not merge); `confidence_overrides` replace the number.
4. `ConfidenceMap.reasons` only lists entities that have reasons (an empty list is omitted).
5. `rooms_without_names` counts rooms with reason `no_name` or `name_guessed` (closed area without a name from the drawing).
6. Validation checks `not_a_floor_plan` (<4 walls) before `no_walls_detected`, so a non-plan with no walls reports the more accurate code. A plain empty plan still gives `no_walls_detected`.
7. Door width >= 1200 becomes `double_swing` unless the type is `sliding` (spec literal, so `bifold` / `pocket` also become `double_swing`).
8. Missed rooms / missed openings `x, y` are read as normalized-page px (the heuristic labeler writes them that way).
9. Adopted gap candidates for a missed door / window also carry `type_guessed` (no type is known); an adopted passage carries `gap_only`. Gaps overlapping any opening candidate (kept or labeled `not_opening`) count as used.
10. Out-of-range coordinates raise `too_complex` (no better code exists in 06 §14.2; the message names the cause).
11. `size_mismatch` check reuses `scale._room_samples` (private import) so the face extents match the scale solve exactly.
12. Plausibility band (carry 4): span >= 10 px, 0.25 <= mm/px <= 250. These numbers are mine (the carry gave none).
13. `exterior` = the wall has an included face on exactly one side. `partition` / `interior` use the snapped thickness against the median exterior thickness (none exterior -> `interior`).
14. `ctx` is only used for `check_deadline()`; warnings are returned in `AssembleResult` (not added to `ctx.warnings`), so T31 merges both lists.

## Notes

- Several of my first-draft tests asserted wrong numbers or used wrong geometry (an interior-wall thickness that snapped to 75, door positions in absolute instead of wall-relative px, a diagonal wall that crossed its own face); I fixed the tests, not the code, after re-deriving the spec formulas. The two code changes were the order of wall reasons (spec order) and a cleaner opening-type lookup.

## Concerns

- `test_rejoining_many_thin_lines_is_fast_and_polls_the_deadline` fails on this machine at HEAD (0.5 s bound; unrelated to Task 21).
- T31 must apply `candidates.scale_y(scale.y_factor)` and pass `face_map=None` (or omit it) when `anisotropy_corrected`, pass the real `provider_used`, and merge `AssembleResult.warnings` and the `validate_and_repair` warnings into the meta.
