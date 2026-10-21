# Task 28 report: DXF reader, units, layer classification, LLM layer mapping

Status: DONE_WITH_CONCERNS (concerns are minor, listed at the end).

## Implemented
- `vision/app/pipeline/dxf/reader.py`
  - `DxfEntityRecord`, `DxfDrawing`, `read_dxf(data, hints, ctx)`, `dxf_info(data)` (returns `app.schemas.api.DxfInfo`), `MAX_DXF_ENTITIES = 200_000`.
  - Loading per 06 §10.1:
    - R2007+ ASCII is decoded as UTF-8; older ASCII uses the `$DWGCODEPAGE` (`ANSI_nnnn`) code page, falling back to cp1252 (`errors="replace"`), then `ezdxf.read(StringIO)`.
    - Binary DXF goes through a temp dir and `readfile`.
    - Any failure is retried with `ezdxf.recover.read(BytesIO)`. A second failure, or a recovered drawing with no model-space entities, gives `corrupt_file` (422).
  - Entities from model space only: LINE, LWPOLYLINE and 2D/3D POLYLINE (bulge edges become ARC records, other edges LINE records, closed flag honoured), ARC, CIRCLE, solid HATCH (polyline and edge paths become one polygon record each), TEXT, MTEXT (`plain_text()`).
  - INSERT is exploded through `virtual_entities()` up to depth 4, with children on layer `0` taking the INSERT's layer. Each expanded INSERT also gets one `insert_bbox` record (4 corners).
  - The entity budget counts model-space entities plus every exploded child, lazily. Above 200 000 it raises `dxf_too_complex` (422).
  - Mirrored arcs (OCS extrusion z < 0, which mirrored block references produce) are converted to the right WCS centre and sweep.
  - Units: `$INSUNITS` 1, 2, 4, 5, 6, 14 map to mm. Anything else, including 0 or missing, is guessed from the extents `E` of the wall-candidate line, arc and hatch records (06 §10.1 thresholds, imperial hint gives in/ft), with warning `dxf_units_guessed {"assumed": ...}`.
  - `extents` is in drawing units. `layer_stats` is per layer: entity counts by kind, line length in mm, parallel share, up to 3 sample texts.
- `vision/app/pipeline/dxf/layers.py`
  - `LayerRole`, `LayerStats` (I16), `classify_layers_regex(names)` (06 §10.2 table, first match wins, unclassified names are absent), `parallel_pair_share(segments)`, `classify_layers(drawing, provider, ctx)`.
  - `parallel_pair_share`: 1° angle, 50–400 mm face distance, ≥ 50 % overlap of the shorter segment. It uses a 400 mm spatial grid, so it is not O(n²) on axis-aligned drawings.
  - `classify_layers` runs the regex first. If no layer is a wall, or wall layers hold < 30 % of the line length, it calls `complete_json(..., schema_model=LayerMapping, effort="low", purpose="dxf_layers")` with `SYSTEM_PROMPT_DXF_LAYERS` and `USER_PROMPT_DXF_LAYERS_TEMPLATE`. The call is text-only. LLM answers override the regex for the named layers; unknown names are ignored.
  - With no provider, a `ProviderError`, an answer with no wall layer, or less than 20 s of request budget left, it falls back to the geometric guess: the longest layer with ≥ 20 % parallel share becomes wall, with warning `dxf_layers_guessed`. Returns `(roles, usage_calls)`; a failed call's usage is still returned.
- `vision/tests/support/dxfgen.py`
  - `make_room_dxf(...)` with the brief's signature, plus `make_room_doc(...)` (returns the ezdxf `Drawing` so tests can extend it) and `dxf_bytes(doc, fmt)` (asc or bin).
- `vision/tests/test_dxf.py`: 24 tests (see carry 3).

Files changed (all new): `vision/app/pipeline/dxf/reader.py`, `vision/app/pipeline/dxf/layers.py`, `vision/tests/support/dxfgen.py`, `vision/tests/test_dxf.py`, this report. No dependency changes (`ezdxf>=1.3` already in pyproject, 1.4.5 locked), so `requirements.txt` is untouched.

## TDD evidence
RED (tests written first; modules did not exist):
```
tests/test_dxf.py:11: in <module>
    from app.pipeline.dxf import reader
E   ImportError: cannot import name 'reader' from 'app.pipeline.dxf'
ERROR tests/test_dxf.py
1 error in 0.77s
```
GREEN (first run after `reader.py` existed; one test bug of mine, in an `approx` call on nested tuples, was fixed on the next run):
```
uv run pytest tests/test_dxf.py -q
........................                                                 [100%]
24 passed in 2.07s
```

## Gates (WSL, `furny-vision-p3` venv)
- `ruff check .`: all checks passed.
- `ruff format --check .`: 133 files already formatted.
- `mypy app`: success, no issues in 77 source files.
- `pytest -q` (full): **1398 passed, 1 skipped, 3 xfailed, 0 failed** in 181 s. The walls_closure flake did not occur. A second concurrent pytest run that I had started by accident was killed before this result. No background processes of mine remain.

## Carries
1. **I2.** `classify_layers` calls Task 26's `complete_json` with `schema_model=LayerMapping`, `effort="low"`, `purpose="dxf_layers"` and the shared prompt constants. There is no duplicate parse, repair or sanitize code. Tests use `FakeProvider`. `test_llm_layer_mapping` asserts effort, purpose, the system prompt, `tools == []`, `tool_choice == "none"`, and a single `TextPart`.
2. **I16.** `LayerStats(entity_counts, line_length_mm, parallel_share, sample_texts)` is a frozen dataclass in `layers.py`, re-used by `reader.py`. It is also the row source for the layer table (`_layer_table`).
3. **K18.** The tests are in a NEW `tests/test_dxf.py` (not `test_dxf_reader.py` as the brief says), and `test_dxf_too_complex` is there (I7).
4. **K12.** Nothing in my code touches `turn.assistant`; `complete_json` already uses `.text`.
5. **Library bans.** Only `ezdxf` (already pinned in `uv.lock`) is used. No new dependencies.
6. **Logging and fallback.**
   - Nothing is logged. The layer-name sanitizer (`_clean`) strips newlines and `|` from layer names and texts before they enter the prompt.
   - A `ProviderError` degrades to the heuristic guess (06 §10.2). The failed call's usage is returned.

Brief test coverage:
- `test_units_*`: units from `$INSUNITS` and guessed from extents, including the imperial hint.
- `test_layer_regex`.
- `test_insert_exploded` and `test_insert_nesting_stops_after_four_levels`.
- `test_dxf_too_complex` and `..._counts_exploded_blocks`.
- `test_corrupt`.
- `test_binary_dxf`.
- `test_llm_layer_mapping`, plus a failure fallback and a "no walls in the answer" fallback.
- `test_heuristic_layer_guess` and `test_heuristic_needs_parallel_pairs`.
- `test_dxf_info`.
- Extras: bulge, hatch, MTEXT, edge-path hatch, mirrored arc, legacy cp1252, parallel-pair edge cases and scale.

## Deviations / decisions
- Tests are in `tests/test_dxf.py` per carry K18, not `test_dxf_reader.py`.
- `dxfgen` room dimensions: 6000×4000 mm is the outer face of the walls, so `extents × factor` is exactly 6000 × 4000. The door gap and window gap sit in the bottom and top walls. The door ARC is centred on the inner-face hinge end, with radius equal to the gap width. The window gap carries two lines on the window layer. The drawing has 16 entities (12 wall lines, 1 arc, 2 window lines, 1 text).
- `$INSUNITS` codes outside the 06 list (3, 7–13, 15+) are treated like 0 and guessed. The spec lists only the six codes.
- `dxf_info.entityCount` is the model-space entity count before block explosion (cheap, fits the 25 s inspect deadline). `read_dxf` counts exploded children.
- Hatch: all solid HATCH entities are emitted as `hatch` records regardless of layer, because the reader does not yet know which layers are walls (the spec says "on wall layers"). Pattern hatches are skipped.
- The heuristic runs also when the LLM answers without any wall layer. This is an extension of the 06 §10.2 fallback, which only mentions "provider unavailable".
- Arc angles are normalised to [0, 360). A CCW arc ending at 360° is therefore stored as 0 (for example a bulge arc from 180° to 0°).
- `ProviderError` is the only exception caught around the layer-mapping call. `VisionError("deadline_exceeded")` and similar are not raised by `complete_json`.

## Concerns
- `parallel_pair_share` considers only the longest 30 000 segments of a layer (`MAX_PAIR_SEGMENTS`, marked as a shortcut in the code). A denser layer gets an underestimated share.
- Not read: INSERT attributes (room tags stored as ATTRIB), ELLIPSE and SPLINE entities (for example non-uniformly scaled arcs inside blocks), frozen or off layers. The spec does not list them. Task 30 may want attribute text for room names.
- Hatch polyline paths ignore bulges. Edge-path arcs are sampled at 8 points; ellipse and spline edges are skipped.

---

## Fix report, round 1 (review: 4 Important, 2 Minor)

All fixes were test-first. `tests/test_dxf.py` grew from 24 to 35 tests.

### RED (new tests against the round-0 code)
Run with `ulimit -v` and `timeout` guards, because the unfixed code exhausts memory on the huge-coordinate cases (it took the WSL VM down twice before I added the guard). Seven new tests failed in the normal run:
```
FAILED test_absurd_coordinates_fail_fast[inf]   - OverflowError: cannot convert float infinity to integer
FAILED test_absurd_coordinates_fail_fast[nan]   - Failed: DID NOT RAISE
FAILED test_non_wall_layers_skip_pair_statistics
FAILED test_mirrored_insert_places_every_entity_kind_in_world_coordinates
FAILED test_records_hold_plain_floats
FAILED test_unexpected_errors_become_corrupt_file - ZeroDivisionError
FAILED test_heuristic_does_not_overwrite_a_model_role
7 failed, 24 passed
```
Guarded run of the other three: `1e13` and `5e8_metres` died with `MemoryError` at `layers.py:105` (the `steps` loop), and `dense_cluster` hit the 40 s timeout (exit 124).

### Changes
1. **Huge or non-finite coordinates** (`reader.py`, `layers.py`)
   - Every record is checked at creation (`_check_sane`): non-finite values or `|v| > MAX_COORD = 1e9` (drawing units) raise `corrupt_file`.
   - After the unit factor is known, `max|extent| × factor > 1e9` mm also raises `corrupt_file`.
   - Decision: `corrupt_file` for both. Absurd magnitude is garbage geometry, not complexity, and `dxf_too_complex` would suggest the user could trim entities.
   - `parallel_pair_share` also ignores non-finite segments, and the grid steps per segment are capped at `MAX_CELL_STEPS = 2000`.
   - Tests: inf, NaN, 1e13 and 5e8 m (5e11 mm after conversion) each fail in under 1 s with `corrupt_file`/422.
2. **Quadratic pairing** (`layers.py`)
   - The pair test is cheaper (no `atan2`, precomputed unit vectors).
   - At most `MAX_CANDIDATES = 256` neighbours are examined per segment, in a fixed (sorted-cell, ascending-index) order.
   - There is a per-layer budget of `MAX_PAIR_CHECKS = 1_000_000` pair tests, and `MAX_PAIR_SEGMENTS` is now 20 000.
   - Layers the regex classifies as dimension, door, window, room_label, furniture or other skip pairing in `_layer_stats` (share 0.0).
   - Test: the 15 000 short-line cluster takes 0.41 s (limit 2 s), and a second call returns the identical value.
   - Side effect: those layers now show `0.00` in the LLM layer table, and they cannot be promoted by the heuristic.
3. **Mirrored INSERTs** (`reader.py`)
   - New `_to_wcs(e, elevation)` uses `ezdxf.math.OCS`. It is applied to LWPOLYLINE, 2D/3D POLYLINE, TEXT and hatch boundary paths.
   - For extrusion z < 0 the bulge sign is flipped, because a mirrored OCS reverses the sweep.
   - MTEXT is deliberately not converted: ezdxf stores the MTEXT insertion point in WCS. Probe: after a mirrored INSERT, TEXT has insert x=-95 (OCS) while MTEXT has x=+95 (already WCS). Applying the OCS conversion to MTEXT would break it. A test covers both.
   - Tests: mirrored LWPOLYLINE, POLYLINE, TEXT, MTEXT and HATCH all land at their world coordinates; a mirrored bulge keeps its side.
   - Found and fixed along the way: `x % 360.0` returns 360.0 for a tiny negative `x`, so arc angles are now normalised twice.
4. **Unmapped exceptions** (`reader.py`)
   - `read_dxf` wraps the walk, unit guess and stats: `VisionError` passes through, anything else becomes `corrupt_file`.
   - Test: a monkeypatched `_convert` that raises `ZeroDivisionError` gives `corrupt_file`/422.
5. **numpy floats**
   - Polyline vertices are coerced to `float` at conversion. Test: every record value has exactly `type float`.
6. **Heuristic overwrite**
   - `_guess_wall_layer` now excludes layers the model already assigned a role (`taken`).
   - Test: the model maps L1 to furniture and L2 to door, no wall; L1 stays furniture and no wall is invented.

### Gates (WSL, `furny-vision-p3`)
Commands (from `vision/`, `UV_PROJECT_ENVIRONMENT=$HOME/.venvs/furny-vision-p3`):
- `uv run ruff check .`: all checks passed. `uv run ruff format --check .`: 133 files already formatted. `uv run mypy app`: no issues in 77 source files.
- `uv run pytest tests/test_dxf.py -q`: **35 passed** in 2.5 s.
- Full suite: **1409 passed, 1 skipped, 3 xfailed, 0 failed.** That is the round-0 total (1398) plus the 11 new tests; the walls_closure flake did not occur.

Caveat on how the full suite was run: in this session the WSL VM died repeatedly (`Wsl/Service/E_UNEXPECTED`) partway through a single-process full `pytest` run, at different points (at 72 % and at 79 %), and unrelated test files that pass on their own (for example `test_preprocess.py`) were in flight each time. Free memory was ample (about 19 GB) and the VM also died while idle, so I attribute it to the WSL host, not to the code. The very first unguarded RED run of the huge-coordinate tests did exhaust memory and take the VM down; that is the bug being fixed, and later runs of those tests used `ulimit -v`. I therefore ran the suite as seven consecutive `pytest` invocations that together cover every test file once, with the results below; the one-shot run succeeded before the fixes (1398 passed).

| Chunk | Files | Result |
|---|---|---|
| 1 | tests/providers | 126 passed |
| 2 | test_agent .. test_labeling_heuristic (includes test_dxf) | 670 passed, 1 skipped |
| 3a | test_llm_labeler, test_logging, test_normalize | 65 passed |
| 3b | test_ocr, test_openings, test_pdf | 115 passed, 2 xfailed |
| 3c | test_preprocess, test_rectify | 76 passed |
| 4a | test_reference_assemble, _dims, _labeling, _openings | 41 passed |
| 4b | test_reference_rooms, _scale, _walls | 30 passed, 1 xfailed |
| 5 | test_rooms .. test_walls_closure | 286 passed |

Before replying I checked with `ps` in WSL that no pytest, mypy or uv process of mine is still running.

### Notes and residual risks
- The pair statistics are now bounded and deterministic, but on a very dense layer they can under-report the parallel share (documented in the `parallel_pair_share` docstring). The only consumer of the number is the heuristic wall guess and the LLM table.
- `MAX_COORD = 1e9` is the same value in drawing units and in mm. A drawing in metres with coordinates between 1e6 and 1e9 passes the first check and is rejected by the second.
- Not changed, as it was not in the review: INSERT attributes, ELLIPSE/SPLINE, and frozen layers.
