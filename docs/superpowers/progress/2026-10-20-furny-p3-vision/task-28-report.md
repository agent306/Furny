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
