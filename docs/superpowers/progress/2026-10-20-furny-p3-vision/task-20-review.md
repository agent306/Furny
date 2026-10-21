# Task 20 review (2b59ab8..95a88b7): scale solver + Task 14b re-review carries N1–N3

**Spec verdict: ✅ Spec compliant** (one ⚠️ item that spans tasks).
**Quality verdict: NEEDS FIXES.** 1 Critical, 1 Important, 6 Minor.

**Scope.** I read `review-2b59ab8..95a88b7.diff` once, plus spec 06 §5.6, §6, §8.2 and §8.3.

Focused checks outside the diff, one per named risk:
- `dimension_ticks.py:200-221, 520-549`: where `found` and `slack` come from (risk: the N2 contact check indexes the wrong columns).
- `schemas/candidates.py::scale_y` and a grep for `scale_y(` in `app/` (risk: the anisotropy correction applied twice).
- `schemas/labeling.py::RoomLabel` and `heuristic.py::_rooms` (risk: room labels pointing at faces the wrong way).
- Spec 06 ruling I3 (risk: the `to_scale_meta` document frame).

All runs used a `git archive` export of 95a88b7 in `scratchpad/rv20/`, which is now deleted. The worktree was not touched.

## What I ran

| Run | Result |
|---|---|
| Degenerate-input probes on `fit_scale` / `solve_scale` | IndexError (C1) |
| Start-side mirror of the N2 wall-face test, at HEAD and at base 2b59ab8 | Start side fails at HEAD where base passed (I1) |
| I1's one-line fix in the export, then `test_reference_dims.py -k "floors or tick"` | 2 passed: the floors hold with the fix |
| HDB and brochure reference solve | Matches the report exactly (below) |
| 21 mutants of `scale.py` against `tests/test_scale.py` | 10 survive (M1) |

**Reference solve:**

| | HDB | Brochure |
|---|---|---|
| Method | `dimension_chain` | `default_guess` |
| mm/px | 7.3712 (traced 11000 line: 7.3940, −0.31 %) | 9.901 |
| Residual | 0.80 % | n/a |
| Inliers / rejected | 39 / 0 (21 x, 18 y) | n/a |
| Consistent chains | 1 | n/a |
| Confidence | 0.966 | 0.1 |
| Anisotropy | `y_factor` 0.9607 (traced 7.0658 / 7.3940 = 0.9556) | none |
| Room-label check | rooms 0 | rooms 0 |
| Scale warnings | `scale_anisotropy_corrected` only | `scale_guessed` only |
| Time (chain + labeling + scale) | 1.65 s | 1.13 s |

## Spec compliance

- ✅ **Fit maths match §8.2 steps 2–5.**
  - Weighted median, with the mean at an exact half-weight tie: `scale.py:128-140`.
  - Two 8 % rounds, the second around the first round's inliers: `:163-165`.
  - WLS through the origin, `k = Σwvp / Σwp²`, and `residualPct = 100·sqrt(Σw(v−kp)² / Σwv²)`: `_wls`, `_residual_pct`.
- ✅ **Confidence matches the §8.3 table exactly** (`scale_confidence`). 0.945 and 0.68 are pinned, plus both clamps. The ×0.7 room-mismatch factor is applied once, in `solve_scale`.
- ✅ **The fallback order matches step 8** (`scale.py:413-424`): chain → room_label → scale_note → user_hint → default_guess. The known sample counts toward the primary ≥ 2, as the controller accepted. `default_guess` is `12000 / max(region.w, region.h)` with `scale_guessed {assumedLongEdgeMm: 12000}`.
- ✅ **Anisotropy (step 7) is correct.**
  - It runs only on raster, pdf_raster, heic and rectified pages, never on pdf_vector (`ANISO_KINDS`, `_anisotropy`).
  - It needs ≥ 3 inliers per axis and a difference above 2 %.
  - `y_factor = k_y/k_x`. Multiplying y by it brings the y samples to `k_x`, which is the direction `CandidateSet.scale_y` expects. `mm/px = k_x`.
  - The residual is recomputed in the corrected frame.
  - It does not double-apply: `solve_scale` never calls `scale_y`, and a grep finds no `scale_y(` call in `app/`. It only returns `y_factor`, and `used_samples` are already in the corrected frame (see ⚠️).
- ✅ **Room samples (step 1)** use the face polygon turned by −theta0, with pixel extents + 1. Orientation takes the smaller `|log((a/px_x)/(b/px_y))|`. w = 0.5. Unparsed (None) sizes give no sample. Faces are found via `RoomLabel.id`, the face id as the Task 19 heuristic labeler sets it.
- ✅ **Cross-check (step 9)** follows the spec formula `|v/(k·p) − 1|`, pinned at 15 % per K7. Room samples are carried into the corrected frame before the check.
- ✅ **Scale note (§8.2 step 8, §5.6).**
  - Accepted only on vector or raster PDFs with a known DPI, on a standard paper size via Task 8's `is_standard_paper` (imported, not reimplemented).
  - The DPI is corrected by `sqrt|det(transform)|`, the accepted deviation.
  - `residualPct` is null for `scale_note`, as accepted.
- ✅ **`to_scale_meta`** gives a/b as `round(px × mm/px)` in the normalized (corrected) frame, matching spec ruling I3. It keeps at most 60 samples, inliers first and stable within each group; `samples` is the inlier count. Pinned by `test_to_scale_meta_keeps_at_most_60_samples_inliers_first`.
- ✅ **Reference smoke (part B)** passes on both images, and both truth derivations are sound.
  - HDB: k_x is compared with an x-axis truth (the 11000 line's ticks through `page.transform`). `y_factor` is compared with the traced ratio of the 8900 line to the 11000 line, with an absolute tolerance of 0.01 (got 0.9607 against 0.9556, a 0.5 % difference).
  - Brochure: `default_guess` is honestly pinned as a floor, at +10.1 % against the P2 registration.
- ✅ **N1–N3 are implemented as ruled, and every HDB floor holds.** `test_hdb_dimension_floors` pins them; the brochure still has 0 dimension lines.
  - N1: an end-only crossing drop (`dimensions.py:234`).
  - N2: WALL ticks are exempt from end-extra, with the accepted 3 px contact narrowing.
  - N3: the last point is appended (`dimension_ticks.py:516-517`).
  - But see I1: the N2 contact check is wrong on the start side.
- ⚠️ **Cannot verify from this diff (the Task 31 caller):**
  - The caller must resample the image and call `CandidateSet.scale_y(y_factor)` exactly once.
  - It must not re-derive scale samples from the uncorrected candidates.
  - It must rebuild the face-id map after `scale_y`.

## Strengths

- `scale.py` reads straight against §8.2. Each helper names its step, and the module has no stray state.
- The mutants that matter most are killed:
  - weights (known w = 3, room w = 0.5);
  - the room +1 px extent, theta0 and the orientation swap;
  - the half-weight tie in the median;
  - the anisotropy inlier minimum and its 2 % threshold;
  - the meta cap of 60;
  - the K20 wall thickness;
  - the unweighted residual.
- The reference truth derivation is careful. It compares k_x against an x-axis line, and it measures anisotropy separately against the traced 8900/11000 ratio.
- The N2 investigation is genuinely diagnostic. It found L6@210 and narrowed the rule, instead of loosening a floor. The new control test (`test_wall_beyond_a_gap_past_the_end_tick_is_no_tick`) holds the L6 geometry across 6 phases.
- The report's numbers reproduce to the fourth decimal.

## Issues

### Critical

**C1. `fit_scale` crashes when the weighted median falls between two samples more than ~16 % apart and no sample lies within 8 % of their mean.**
- **Where:** `scale.py:128-140` (`_weighted_median`) and `scale.py:163-166` (`fit_scale`).
- **What happens:**
  - At an exact half-weight tie, `_weighted_median` returns the mean of the two middle estimates.
  - When that mean is more than 8 % from every sample, round 1 rejects them all.
  - Round 2 then calls `_weighted_median([])`. Its loop does nothing, and `ordered[-1]` raises `IndexError`. Even past that, `_wls([])` would divide by zero.
- **Why it matters:** exact ties are common, because the weights are 1, 2, 0.5 and 3. Reproduced in the export:
  - **One room labelled `3000x3000` on a face whose bbox is 300×400 px** (for example an L-shaped room, or a misread size): `solve_scale` → room_label → **IndexError**. Its two w = 0.5 samples are 10 and 7.5 mm/px; the mean of 8.75 is more than 8 % from both.
  - **Two chain labels, 3000 over 300 px and 3000 over 150 px** (the heuristic labeler mis-associating one): `solve_scale` → **IndexError**.
  - `fit_scale` on the estimates [10, 10, 20, 20] (all w = 1) → **IndexError**.
- **Consequence:** the whole recognition fails, instead of degrading to a warning or a lower method.
- **Tests:** none covers it. Every test set either has an odd weight split or has samples near the tie.
- **Fix:** when a round leaves no inliers, keep the previous set. At minimum, when the tie mean rejects every sample, fall back to the lower or upper weighted median, which is always an actual sample.
  - Add a guard so that `fit_scale` never returns empty inliers.
  - Add regression tests for the single-room and two-label cases. With 2 disagreeing samples and no rooms, the expected outcome probably stays `dimension_chain` with a high residual, not a crash.

### Important

**I1. The N2 wall-contact check never looks before u = 0, so start-side wall faces 3–6 px before the segment start are lost. This is a regression against 2b59ab8.**
- **Where:** `dimension_ticks.py:327` passes `found[slack:]`, and `dimension_ticks.py:431-432` slices `line_at[max(lo, 0) : max(lo + WALL_CONTACT_PX, 0)]`.
- **What happens:**
  - `found` is indexed from u = −slack, but the call hands over only u ≥ 0.
  - At the start, `lo = round(last) + 1`, where `last` is the wall face (which may be as far as −6, from `at_start`).
  - So for `last` ≤ −4 the slice is empty, and for `last` = −3 it holds a single column. The check then rejects the face even though the line ink runs right up to it.
  - The end side has no such cut-off, because `found[slack:]` reaches u = length + slack.
- **Scenario:** I mirrored `test_short_last_interval_to_a_wall_face_keeps_its_end_tick` onto the start side. The wall face sits `last_gap` px before the first slash, the line ink is drawn up to the face, and the LSD segment starts `off` px after the face. Every case runs at 6 phases.

  | | HDB 95a88b7 | Base 2b59ab8 |
  |---|---|---|
  | Start side, `last_gap` 50 or 120, `off` 3–5 | **fails** (`[300, 750, 1200]`, the wall face missing) | passes |
  | Start side, `last_gap` 20 or 30, `off` 0–2 | passes | fails (the N2 issue) |
  | End side, all of `off` 0–5 and `last_gap` 20/30/50/120 | passes | — |

  So the contact narrowing regresses chains dimensioned from a wall whose LSD segment starts a few px inside the drawn line. The start side is untested.
- **Fix:** pass `found` and `slack`, and index `found[lo + slack : lo + slack + WALL_CONTACT_PX]`.
  - With that change, applied in the export, all 40 start/end mirror cases pass.
  - The L6 control and `test_reference_dims.py -k "floors or tick"` pass (HDB floors unchanged).
  - Add the start-side mirror as a test.

### Minor

**M1. The core fitting constants are not pinned by `test_scale.py`.** These mutants all survive the 31 tests:
- `REJECT_ROUNDS = 1`;
- round 2 re-testing only round 1's inliers;
- `REJECT_FRAC = 0.10`. The outliers in `test_outliers_rejected` sit at ×1.2 and ×0.85, far from 8 %; a pair at ±9 % would pin the threshold.
- `HIGH_RESIDUAL_PCT` changed to 5;
- `ROOM_MISMATCH_PCT` changed to 12;
- the room check's mean changed to a max;
- the same-axis condition removed from `_consistent_chains`;
- `heic` removed from `ANISO_KINDS`. The only heic test is also `rectified=True`, so it passes through the rectified branch.
- K20 `not_wall` walls not excluded;
- the room samples not carried into the corrected frame before the cross-check.

The code is right on each of these (read and checked), but nothing would catch a drift. Add boundary tests:
- outliers at 7 % and 9 %;
- a two-round case where round 2 moves the median;
- a residual of 3.0 against 3.1;
- a discrepancy of 10 against 10.1;
- a non-rectified heic page;
- a perpendicular overall that does not count;
- a `not_wall` wall outside the outer bbox.

**M2. The anisotropy threshold measures `|k_y/k_x − 1|` (`scale.py:384`); spec step 7 says `|k_x/k_y − 1|`.**
- They differ only at the boundary: for k_y/k_x = 0.9800 the spec form gives 0.0204, which corrects, while this code does not correct.
- This is negligible in practice, but it is an unlisted deviation from the spec. Either use the spec form or list it under "Deviations for spec 19".

**M3. A lone labelled dimension is discarded in favour of `default_guess` when there are no rooms and no note** (`scale.py:413-424`, spec step 3 literal).
- One correct overall label (confidence ~0.7 at best) loses to the 12 m guess (0.1).
- This is spec-compliant, so not a defect here. I am noting it for spec 19 or the controller: the K8 removal of the "1 overall with LLM confidence ≥ 0.8" rule makes this case reachable for every heuristic run.

**M4. The known sample is identified by `s.weight == WEIGHT["known"] and s.line_id is None`** (`scale.py:411`).
- This couples a float weight to provenance.
- `_known_sample`'s result could simply be kept: return it separately from `collect_samples`, or add a `source` field.

**M5. `fit_scale` computes `rejected` in O(n²) with `any(s is i for i in inliers)`** (`scale.py:167`).
- This is fine for the HDB's 39 samples.
- An id set would be cleaner for the dense drawings that motivated the cap of 60.

**M6. Room samples also come from `RoomFace.open` faces** (`scale.py:306`).
- Spec step 1 says "a closed face". An open face (one that only closes across a passage) has a bbox that may include the adjoining space, which gives a skewed room sample.
- With C1 this can crash; without C1 it is only a bad sample that the rejection rounds usually remove.
- Consider skipping open faces, or giving them a lower weight, and note the choice either way.

## Test evidence

- The report's RED and GREEN output is legible and plausible: a ModuleNotFoundError for RED, 36 passed for GREEN, and the full suite at 1059 passed.
- There are no warnings in the reported output.

## Assessment

**Task quality: Needs fixes.**

**Reasoning:** the solver's maths, confidence, fallback order, anisotropy and reference results all match §8.2/§8.3 and reproduce exactly. However, `fit_scale` raises on a single mismatched room or two disagreeing labels (C1), and the N2 contact check regresses start-side wall ticks (I1). Each needs a small fix plus a regression test.

---

# Re-review 1 (fix round 1: 95a88b7..9dca9d7)

**Spec verdict: ✅ Spec compliant.**
**Quality verdict: APPROVED.** Every Critical and Important finding is addressed. The fix adds 1 new Minor finding (N-M1) and no Critical or Important breakage.

**Scope.** I read `review-95a88b7..9dca9d7.diff` and the "Fix round 1" section of the report.

All runs used a `git archive` export of 9dca9d7 in `scratchpad/rv20/`, which is now deleted:
- My C1 reproductions (`t1.py`).
- My I1 start/end mirror tests (`test_rv20_n2.py`, 40 cases × 6 phases), plus the implementer's `either_end` tests, the L6 control and the N2 wall-face tests: **93 passed**.
- `tests/test_reference_dims.py` and `tests/test_reference_scale.py`: **20 passed**.

## Finding verdicts

**C1 (`fit_scale` IndexError when a tie median rejects every sample) — ADDRESSED.**
- `scale.py:166-171`: a round whose `kept` is empty breaks and keeps its input. So `inliers` is never empty, and `_wls` never sees an empty set.
- Re-run of my reproductions:

  | Reproduction | Before | Now |
  |---|---|---|
  | Two chain labels, 3000 over 300 px and 3000 over 150 px | IndexError | `dimension_chain`, k 12.0, residual 31.6 %, confidence 0.0, `scale_high_residual` |
  | One room 3000×3000 on a 300×400 px face | IndexError | `room_label`, k 8.4, confidence 0.0, `scale_from_room_labels` + `scale_high_residual` |
  | `fit_scale` on [10, 10, 20, 20] | IndexError | 4 inliers, k 12.0 |

- This matches the ruling: the high residual drives the warning and zeroes the confidence.
- Tests:
  - `test_fit_keeps_its_input_when_a_round_would_reject_everything`;
  - the two reproduction tests;
  - the seeded randomised `test_degenerate_sample_sets_never_raise` (seed 20, 400 cases, including `to_scale_meta`).
- The report's RED output shows IndexError before the fix.

**I1 (N2 contact check blind before u = 0) — ADDRESSED.**
- `dimension_ticks.py:327` now passes the whole `found` plus `slack`, and `:431` adds `slack` on both sides.
- `lo` is now ≥ 1 for any start face at −6 or later. The end side still lies within `cols = ceil(L) + 2 slack + 1`.
- My mirror cases: start and end × `last_gap` 20/30/50/120 × `off` 0–5, all 6 phases, all pass.
- The implementer's `test_wall_face_at_either_end_is_a_tick_when_the_segment_stops_short` adds 48 cases (start/end × gap × off 0–5).
- The L6 control (`test_wall_beyond_a_gap_past_the_end_tick_is_no_tick`) and `test_hdb_dimension_floors` pass, so the floors hold exactly.

**M1 (unpinned fitting constants) — ADDRESSED.**
- Each of my surviving mutants now has a targeted test:
  - 7 % against 9 % (rejection threshold);
  - the second round re-testing every sample;
  - a residual of 3.5 against 2.9;
  - a room discrepancy of 11 against 9;
  - the mean of the room's two samples;
  - the room check in the corrected frame;
  - an unrectified heic page;
  - a slanted chain against a horizontal overall;
  - a K20 `not_wall` wall.
- The report lists all 12 mutants as killed. I read each test against the mutant it targets, and each one discriminates.

**M2 (anisotropy threshold form) — ADDRESSED.**
- `scale.py:390-391` now tests `|k_x/k_y − 1| > 0.02`, the spec form.
- `test_anisotropy_threshold_is_k_x_over_k_y` pins the boundary with k_y = 9.802, which is corrected under the spec form but was not under the old form.
- `ratioPct` keeps `|k_y/k_x − 1|`. That is fine: the spec defines no formula for it, and the brief pins 5.0.

**M3 (a lone labelled dimension loses to `default_guess`) — DECLINE ACCEPTED.**
- §8.2 step 3 ("≥ 2 exist, or 1 `overall` with LLM confidence ≥ 0.8") is literal, spec 06 is binding (brief D), and the change would need a ruling, not an implementer choice.
- The report flags it for spec 19 or the controller, which is the right channel.
- **For the controller:** I still recommend a ruling. With K8 in place, any heuristic run whose labeler finds exactly one dimension discards it for a 12 m guess.

**M4 (known sample identified by its weight) — ADDRESSED.** `_collect` (`scale.py:285-311`) returns the dimension samples, the known sample and the room samples separately. `solve_scale` uses it (`:424-436`), and `collect_samples`' interface is unchanged.

**M5 (O(n²) `rejected`) — ADDRESSED.** It now uses an id set (`scale.py:173-174`).

**M6 (open faces used for room samples) — ADDRESSED.**
- `faces = {... if not f.open}` (`scale.py:303`), pinned by `test_open_faces_give_no_room_sample`.
- Room sizes ≤ 0 are now also excluded.

## New breakage in the fix diff

**N-M1 — Minor: the ±1 000 000 mm clamp in `to_scale_meta` (`scale.py:504-508`) is an acceptable guard for serialization, but it is not the fix for absurd samples.**
- The meta must never raise, so a final clamp is reasonable to keep.
- But it only hides the symptom in `usedSamples`. The absurd `mm_per_px` still goes unflagged into `mmPerPixel` and on to assembly.
- Re-run evidence: two 10000 labels on 2 px spans give `dimension_chain`, 5000 mm/px, residual 0.0, **confidence 0.75, no warning**.
- The randomised test also accepts 1e-6 px and 0.5 px spans as samples. No real `DimensionSpan` can be that short: ticks are deduped at ≥ 4 px.
- **Better:** reject implausible samples at collection.
  - A minimum span: for example `TICK_DEDUPE_PX`, or 2 `t_thin`.
  - Optionally, a plausibility band on k against the plan region. One example: an implied long edge outside 2–200 m makes the fit count as no evidence (falling back, with `scale_guessed`).
  - The clamp then stays as a last resort.
- This is non-blocking. Real spans come from tick pairs and cannot be that short, so the case needs a labeler mis-association onto a tiny span.

No other new problems:
- the `_collect` refactor keeps `collect_samples`' output order (dimensions, then known);
- the `fitted: list[...]` annotation is fine;
- the I1 change is index arithmetic only.

## Out-of-scope observations

- ⚠️ Assembly and validation (later tasks) should be checked for the same absurd-scale path: document coordinates beyond `Coord`'s ±1 000 000 range would fail the pydantic validation of the whole document.

## Verdict

**Fix round:** all findings addressed (M3's decline accepted on spec grounds and flagged for a ruling), with no new Critical or Important breakage. One new Minor finding (N-M1, the clamp versus rejecting absurd samples) for the ledger.
