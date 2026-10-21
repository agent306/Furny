# Task 12 report: OCR engine, tiling, two-pass reading, text tokens

Status: DONE_WITH_CONCERNS. Commit: see `git log` (feat(vision): RapidOCR wrapper with tiling and two-pass vertical text).

## Implemented
- `vision/app/ocr/engine.py`: `RawOcrBox`, `OcrLike` Protocol, `OcrEngine` (RapidOCR with the brief's params, lazy import, `read` tolerates `None` outputs; bundled models only).
- `vision/app/ocr/tiling.py`: `tile_origins`, `map_rotated_cw`, `dedupe` (IoU on quad bboxes, higher score wins, earlier wins ties), `merge_passes` (cross-pass IoU > 0.3 only; same-pass boxes never suppress each other; A wins ties), `read_tiled` (row-major tiles, offset mapping, in-pass dedupe at 0.5, deadline check per tile).
- `vision/app/pipeline/ocr_stage.py`: `run_ocr`, `OcrResult`, `tokens_from_vector_words(vector, transform, region=None)` (I9; also used for the pdf_vector bypass with >= 10 words, score 1.0), `split_combined_label`, `orient`.
- `vision/app/schemas/candidates.py`: `TextToken`.
- `vision/app/main.py`: `create_app` defaults `ocr_factory` to `OcrEngine` (imported at module level, so tests can monkeypatch `app.main.OcrEngine`); the dead "no factory" branch is removed. Verified with the real default: `/healthz` goes 503 -> 200 with `ocrLoaded: True` and `app.state.ocr` an `OcrEngine`.
- `vision/app/utils/roomnames.py`: hyphen -> space before stripping punctuation (`WALK IN` / `WALK-IN` / `MASTER-BEDROOM` match like the TS mirror).
- Tests: `vision/tests/test_ocr.py` (24 tests incl. 2 `slow` real-RapidOCR), plus `test_default_ocr_factory_is_the_engine` in `tests/test_api.py` and `test_hyphens_read_as_spaces` in `tests/test_textparse.py`.

## Decisions / deviations (please review)
1. **Angle is decided from box shape, not only from the pass.** Real RapidOCR reads tall boxes as rotated text in pass A (rec crops with h/w >= 1.5 are rotated) and also reads horizontal text in pass B, both at ~0.9999. With a pass-only angle, vertical `3300` ties and pass A wins, giving `angle == 0`, and the brief's real test fails. `orient()` therefore sets 90 for a box >= 1.5x taller than wide (2+ chars), 0 for >= 1.5x wider, else the pass's angle; quads not starting along the reading direction are replaced by box corners (vertical: bottom-left first, reading bottom-to-top). Consequence: a pass-B winner with a wide box gets angle 0.
2. **Combined labels**: earliest word boundary where the suffix parses as `size_pair` and the prefix has a letter; name and size boxes are cut by character offsets along the reading direction, sharing score/height. Applies to OCR and vector words. Tests cover `BEDROOM 10'0"x11'0"`, `LIVING/DINING 10'1"x21'6"`, `TOILET 8'1"x5'0"`, `OTS 12'3"x7'11"`, `MASTER BEDROOM 12'0" X 14'0"`, `KITCHEN 3.0 x 2.4`, and plain labels that must not split.
3. Pass B rotates the plan-region crop as a whole and then tiles it; `map_rotated_cw(pt, crop_h)` plus the region offset maps back.
4. Vector words are filtered to the plan region (word centre) in `run_ocr` only; `tokens_from_vector_words` without `region` keeps all (T29). Vertical vector words are assumed to read bottom-to-top.
5. Text mask paints the token bbox inclusive from `floor(x0)-2` to `ceil(x1)+2`; `ink_notext` is a copy (input `ink` untouched). `run_ocr` does not open a `ctx.stage("ocr")`; the orchestrator should (timings accumulate, so doing both would double count).

## TDD evidence
- RED: `uv run pytest tests/test_ocr.py -q -x` with `ocr_stage.py` absent -> `ModuleNotFoundError: No module named 'app.pipeline.ocr_stage'` (collection error). (Tests were drafted before the code; the module was moved aside to capture this.)
- Real-engine finding during GREEN: first slow run failed `assert texts["3300"].angle == 90` (got 0), which led to decision 1.
- GREEN: `uv run pytest -q` -> `316 passed, 1 skipped`; `tests/test_ocr.py` 24 passed (3.6 s, includes the slow tests). `uv run ruff check .`, `uv run ruff format --check .`, `uv run mypy app` all clean.

## Concerns
- Boxes cut by an interior tile edge produce fragments; the 160 px overlap only fully contains text up to 160 px in the tile direction, and the spec's IoU-only dedupe does not remove a fragment that overlaps a full box with IoU < 0.5. Not addressed (spec-conformant).
- Pass A/B both read everything on real input (RapidOCR rotates tall crops itself), so the second pass roughly doubles OCR time without adding much on clean plans; kept as specified.
- The commit trailer uses the Sonnet 5.5 attribution from the session reminder, not the Opus 5.5 line in context.md.

## Fix round 1
1. `orient()` (ocr_stage.py): vertical aspect is now 1.25 for tokens of 3+ characters (new `VERTICAL_ASPECT_LONG`), 1.5 kept for 2 characters; the horizontal test uses the same per-length threshold. Tests: `test_aspect_threshold_depends_on_length` (57x85 "111" -> 90, same-shaped "11" stays pass angle 0) and slow `test_real_rapidocr_vertical_narrow_digits_are_angle_90` ("111" and "1100" at scale 1.2 pin angle 90 with the real engine).
2. `read_tiled` (tiling.py): each box is tagged with its tile and whether it touches an interior tile edge (within 3 px, not the image border); before the IoU dedupe, such a box is dropped when >= 80 % of its area lies inside a larger box of another tile, whatever the scores (`_drop_seam_fragments`). Tests: `test_seam_fragment_loses_to_the_full_box` (confident "125" 0.99 loses to full "1250" 0.80; verified it fails with the suppression disabled) and `test_seams_are_interior_tile_edges_only`. Seam concatenation not implemented (deferred to T34).
- Command: `uv run pytest -q` -> 320 passed, 1 skipped (tests/test_ocr.py: 28 passed incl. slow); ruff check, ruff format --check, mypy app clean.
