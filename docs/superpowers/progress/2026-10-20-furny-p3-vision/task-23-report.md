# Task 23 report: overview images, set-of-marks, candidate JSON, agentic tools

## Implemented
- `vision/app/pipeline/annotate.py`: `Overview`, `build_overview` (s = min(1, max_px / max(W, H)) of the normalized page; plan-region crop, INTER_AREA; clean + marked images; compact candidate JSON in 06 §9.2 key order; truncation with `too_many_candidates_truncated` warnings), `to_image_part` (PNG, JPEG q90 above `MAX_PNG_BYTES` = 4.5 MB), `to_overview` / `from_overview`, `draw_marks`, `TRUNCATION`. Public helpers `entries()` (shared by the overview JSON and `list_candidates`), `compact_json`, `natural_key`.
- `vision/app/pipeline/labeling/tools.py`: `CROP_IMAGE_SPEC`, `LIST_CANDIDATES_SPEC` (exact 06 §9.5 text and schemas), `ToolExecutor(page, overview, candidates, *, max_image_px, max_crops)` with `specs()`, `execute()`, `crops_used`.
- `vision/tests/test_annotate_tools.py`: 23 tests.

## Files
- vision/app/pipeline/annotate.py (new)
- vision/app/pipeline/labeling/tools.py (new)
- vision/tests/test_annotate_tools.py (new)

## TDD
RED (before any implementation):
```
tests/test_annotate_tools.py:10: in <module>
    from app.pipeline import annotate
E   ImportError: cannot import name 'annotate' from 'app.pipeline'
1 error in 0.44s
```
After the first implementation 17/23 passed; the 6 failures were a test-fixture bug (`DimensionSpan` needs `line_id`), fixed in the test. GREEN: `23 passed in 1.06s`.

## Gate (WSL, full vision gate, once)
- ruff check: all checks passed; ruff format --check: 114 files formatted; mypy app (strict): no issues in 69 files.
- pytest -q: 1246 passed, 1 skipped, 3 xfailed (196 s). No failures (the known walls-closure flake did not trigger).

## Carries
1. K16: `ToolExecutor.execute` checks `"__invalid_json__" in call.arguments` first, before routing or pydantic, and returns `is_error=True` with text `invalid JSON arguments` (tested for both tools).
2. Task 22 contract: only neutral types (`ToolSpec`, `ToolCall`, `ToolResult`, `ImagePart`, `TextPart`) are used; every coordinate sent or accepted is an integer overview pixel (crop args are strict ints).
3. Inverse mapping exposed: `from_overview(pt_ov, ov) -> Pt` = `p / s + offset`, the labeler-output conversion for 06 §8.7 step 2 (Task 21 carry). `to_overview` rounds to int.

## Deviations / decisions
- `draw_marks` has two extra keyword-only args beyond the brief's `(img, candidates_subset, ov, scale)`: `origin` (overview px of the image's top-left; used by annotated crops) and `all_walls` (so openings whose wall was truncated out of the subset still draw).
- `s` uses the normalized page's W/H as spec 06 §9.2 says (not the region crop's); the overview is the region crop times `s`.
- Truncation keeps: texts by score, walls and spans by length, openings by support, rooms by area (ties by natural id); output is then sorted by natural id. Spec only says "longest/highest-score".
- `parsed` strings: `room_name:<room_type>`, `mm_number|metric_length|feet_inch:<mm>`, `size_pair:<a>x<b>`, `area:<mm2>`, `scale_note:<n>`, `opening_tag:<tag>`, else `other`. The brief only lists three; the rest follow the same pattern. Scores and support are rounded to 2 dp; `thicknessPx` min 1; `areaPx` scaled by s².
- Openings whose wall id is unknown are left out of JSON and marks (cannot place them).
- `list_candidates` result: `{"<kind>":[...],"truncated":bool}`, built from the FULL candidate set (not the overview's truncated one), region filter by reference point before the 200 cut, same priority rule as truncation.
- `crop_image`: `w, h >= 16` is checked on the request before clamping; after clamping to the overview an empty rectangle is an error, a small non-empty one is allowed. Only successful crops count toward the budget; the budget check comes before argument validation. Annotated crops draw the full candidate set. Source crop uses integer floor/ceil of the normalized rectangle (up to 1 native px mapping error). Label font stays 14 px in crops.
- Arguments are validated with strict pydantic (bool is not an int, "1" is not an int, extra keys rejected); errors name the field and message only.
- Label placement tries the base spot and then 3 upward offsets of 12 px; labels fully off the image are skipped.

## Concerns
- `MAX_PNG_BYTES` is 4_500_000 (decimal MB); spec says "4.5 MB" and an API limit of 5 MB, so either reading is under the limit.
