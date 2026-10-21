# Task 19 review: labeler interface, heuristic labeler, vendor protocol

Range 793e48c..e544af2 (8996ab7 feat, e544af2 fix). Diff file non-empty (45806 bytes). Read once. Accepted controller rulings were not re-flagged.

## Spec Compliance

- Spec compliant against brief, Controller additions A and B, and 06 sections 9.1, 9.7, 9.8, with the accepted rulings applied. No Missing or Extra items. Every listed file has its hunk (`base.py`, `heuristic.py`, `vendor.py`, `test_labeling_heuristic.py`), plus the declared extras (`room_display_name`, `chain_candidates`, `test_reference_labeling.py`).
- Cannot verify from diff: how scale/assembly (Task 20+) treats `valueMm = None` on every dimension label of an `imperial` plan (see Important 1), and whether `title_case_name` on acronyms (`Ots`, `Wc`) is what assembly wants (Minor 3).

### 9.7 rule-by-rule (checked against heuristic.py)

| Rule | Result |
|---|---|
| Unit hint wins | OK (`:221`), tested (`test_hint_wins`, mutant "hint ignored" killed) |
| imperial >= 3, metric >= 3 (mm_number with span), else unknown + `unit_system_guessed` | OK (`:223-229`); thresholds mutants 2 and 4 killed. Imperial-vs-metric precedence and "metric needs a span" are untested (two mutants survived), see Important 1 |
| Room include/exclude, corridor/ots at border within 2 t | OK (`:303-316`). Top and bottom edges tested; left and right edges untested (mutants survived), Minor 4 |
| Name selection, tallest wins | OK (`:293`); "shortest wins" mutant killed. Tie-break (topmost) untested, Minor 4 |
| `sizeText` parsing to mm | OK, delegated to `parse_token`. Scratch: `3.0 x 3.6 m` -> (3000,3600); `3000X3600` -> (3000,3600); `10' x 12'` -> (3048,3658); `10'-6" x 12'` -> (3200,3658); `10'6"X12'` -> (3200,3658); `3000 x 3600 mm` -> (3000,3600). Feet-inch rounds correctly. On an imperial plan the metric pairs lose their mm values (accepted ruling) |
| Text roles | OK (`:231-251`) incl. scale_note -> title, area, opening_tag, margin dimension labels keep `dimension`, others `ignore` |
| Missed rooms | OK (`:190-199`), at the rounded token centre; tokens outside the region -> `ignore` |
| Walls / openings | OK (`:200-212`): single_line -> unsure, others wall, kind None; door/window `support < 0.4` -> unsure, passage exempt (ruling) |
| `knownDimensionMatch` + warning | OK (`:327-336`) |
| `drawingKind` | OK (`:184-186`), unknown mapped (ruling) |
| M4 carry (Controller B) | OK (`_name_faces`, `:136-152`), listed wins, within 1 t, nearer anchor on a tie |

## LabelingResult validity

`LabelingResult(...)` validates on construction, so every labeler test that runs the labeler has built a schema-valid object. The tests never round-trip through the alias JSON form. I did: `model_validate(model_dump(by_alias=True))` and `model_validate_json(model_dump_json(by_alias=True))` passed for all synthetic cases below and for both reference outputs. No invalid output found.

## LabelingOutcome meta

`provider_used == "none"`, `model None`, `fallback_reason None`, `calls []`, `partial False` (`heuristic.py:217`, `test_outcome_meta`, `test_unit_system` reference). Matches the brief.

## Reference smoke (re-run in a scratch copy, export deleted)

| | HDB | Brochure |
|---|---|---|
| unitSystem | metric, no warning | imperial, no warning (6 imperial-evidence tokens) |
| rooms / named / included | 6 / 5 / 6 | 6 / 5 / 6 |
| sizes (size_text) | 0 | 3 (`100x110`, `100x110`, `101x40`; all width/depth None, per ruling) |
| dimension labels | 39 (0 with value None) | 0 |
| missed rooms | 0 | 2: `Ots` (1134, 914), `5 Feet Wide Corridor` (598, 1231) |
| walls unsure | 0 | 0 |

All counts equal the report and the pinned floors. Matched truth rooms get the right name/type (3/3 each). The scratch copy and export were deleted; the worktree is untouched (`git status` clean).

## Mutation check (scratch copy of vision/, 50 mutants, `tests/test_labeling_heuristic.py` only)

Killed 38. Survived 12:
- imperial and metric order swapped
- metric evidence counting every `mm_number` instead of span-associated ones
- tie-break topmost -> bottommost
- corridor border check on left only / right only (two mutants)
- M4 tolerance 1 t -> 0.5 t
- size-below geometry: reach 2->4, reach 2->1, column test removed, "above the name" allowed, gap lower bound, "listed by another face" exclusion, nearest -> farthest (seven mutants)
- unsure threshold 0.4->0.5 and `<` -> `<=` (support exactly 0.4)
- "garbled" rule without the digit requirement

## Strengths

- Faithful, compact implementation of §9.7; constants named; `LabelingOutcome` and both protocols minimal and correct.
- M4 handled well: listed-face wins, 1 t tolerance via `pointPolygonTest`, nearer-anchor tie with deterministic id tie-break, all tested including both tie directions.
- Margin dimension labels (Task 14b B1) kept as `dimension` with a test; imperial-plan guard prevents a 10 cm room reaching the scale solver.
- Reference tests are real end-to-end checks with floors and evidence in the docstring; fixtures use real `parse_token`.
- Amendment (`room_display_name`) is small and tested for fuzzy, exact and embedded cases.

## Issues

### Critical
None.

### Important

1. `heuristic.py:223-229` (`_unit_system`): imperial beats metric as soon as imperial evidence reaches 3, whatever the metric count, and the evidence set was widened (accepted ruling) to any digit token with a `'` or `"` (`:118`). Scratch results:
   - 12 span-associated `mm_number` dimensions plus 3 feet-inch room sizes (a mixed-unit plan) -> `imperial`, and all 12 `DimensionLabel.valueMm` become `None`. Rooms with feet-inch sizes keep their widths.
   - 12 span-associated `mm_number` dimensions plus 3 OCR-garbled tokens (`2400'`, `'3000`, `900"`, all kind `other`) on an otherwise metric plan -> `imperial`, all 12 dimension values `None`.
   - Effect: the plan's strongest scale evidence is discarded on a handful of stray quote marks. The literal §9.7 order is imperial-first, but the stray-quote path comes from the added rule and has no safeguard. Neither precedence (mutant "metric before imperial" survived) nor "mm_number needs a span" (mutant survived) is tested.
   - Fix: decide on counts (e.g. imperial only when `imperial >= 3` and `imperial >= metric`, or when metric < 3), keep feet-inch values parsing independent of the unit system, and add tests for mixed units and stray quotes against a large metric chain. If spec order is intended, log it for spec 19 so the mixed-unit consequence is a decision, not an accident.

### Minor

2. `heuristic.py:121-123` / name tokens split by OCR: `MASTER` + `BEDROOM` as two tokens -> room named `Bedroom`, type `bedroom`, `MASTER` role `other` (scratch). Likewise `LIVING` + `ROOM` leaves `ROOM` as `other`. Labeler does not merge adjacent name tokens in one face. Also a fuzzy match drops trailing numbers (`BEDROM 2` -> canonical `Bedroom`, so two bedrooms get the same name; exact `BEDROOM 2` -> `Bedroom 2` is fine). Consider merging adjacent same-line tokens or logging as a known limit. Upstream (not this task): `M. BEDROOM` -> type `bedroom` (not master), `3,0 x 3,6` -> kind `other`, and non-English names (`SALON`, `DORMITORIO`, `CHAMBRE`, `KUCHE`) are not room names (dictionary is English by spec).
3. `heuristic.py:121-123` / `roomnames.py:379-385`: exact matches use `title_case_name` of the token, so acronyms come out as `Ots`, `Wc`, `Mbr` (the reference brochure's missed room is `Ots`). `ROOM_DEFAULT_NAMES` has `"OTS"`. Cosmetic; consider keeping dictionary-cased acronyms.
4. Test coverage gaps (survivors listed above): size-below geometry (reach, column, above, listed-elsewhere, nearest) has a single test; left/right corridor-border edges; tie-break topmost; support exactly 0.4; stray-quote token without digits. Add small cases; the `inside`/`below` choice at `:297-302` is the most logic-dense part with the least protection.
5. `test_labeling_heuristic.py:589-590, 602`: `metric_plan` assigns `spans[2]` and `spans[1]` after building the list (dead reassignment), and `assert [(d.text_id, ...) for d in r.dimensions]` asserts only non-emptiness (always true; the next lines cover it). `test_heuristic_labeler_satisfies_the_protocols` asserts only `callable`. Tidy.
6. `heuristic.py:297`: `by_id[i] in sizes` compares dataclass tokens by equality in a list; use ids (`{s.id}`) instead. `_rooms` (`:277-325`, ~50 lines) mixes name pick, size pick, border test and imperial guard; extracting `_room_size` would make the geometry testable alone.
7. `LabelingResult` validity is only implicit (constructor). A shared test helper that round-trips `model_validate(model_dump(by_alias=True))` would make the contract explicit.
8. `metric_length` tokens (`3.2 m`, `3200 mm`) with spans are not metric evidence (spec-literal), so a plan dimensioned that way is `unknown` plus `unit_system_guessed` (treated as metric downstream). Fine per §9.7; worth one line in the spec 19 log.

## Assessment

**Spec verdict:** compliant.

**Task quality:** Needs fixes (one Important).

**Reasoning:** The labeler is correct, compact and well tested for every §9.7 rule, and the reference counts reproduce. The one real weakness is unit-system precedence: an imperial tally (now including stray quote marks) overrides any amount of metric evidence and wipes all dimension values, and no test pins the precedence.

---

# Re-review 1 (fix round 1: e544af2..2b59ab8)

Diff `review-e544af2..2b59ab8.diff` read once. Checked in a scratch copy of HEAD (deleted afterwards): 60 labeler tests pass, 75 mutants re-run, reference smoke re-run. Worktree untouched.

## Finding verdicts

1. **Important 1, unit precedence wipes metric dimensions (`heuristic.py:223-229`)** — ADDRESSED. `_unit_system` (`heuristic.py` diff `:293-309`) now needs `len(imperial) >= 3` and `sum(imperial) > 2 x len(span-listed mm_number/metric_length)`; hint still first; metric needs >= 3 span-listed tokens. Weights 1 / 2 / 0.5 match the ruling. Tests: `test_mixed_units_are_weighed_not_counted` (12 mm + 3 feet-inch -> metric, every `valueMm` kept, sizes converted), `test_stray_quote_marks_do_not_make_a_metric_plan_imperial`, `test_metric_lengths_with_spans_make_a_metric_plan`, `test_imperial_needs_more_weight_than_the_metric_dimensions`, no-span, sq.ft/sq.m, quote-without-digit. Mutants "imperial ignores balance", "metric weight 2->1 / 2->3", "metric ignores assoc", "metric_length not metric", "min evidence 3->2 / 3->4", "hint ignored" all killed. HDB metric and brochure imperial reconfirmed (below).
2. **Minor 2, split names, trailing numbers** — ADDRESSED for two-word keys. `_merge_names` (`:179-216`) joins `MASTER`+`BEDROOM` -> `Master Bedroom` / `master_bedroom`, `LIVING`+`ROOM`; the gap limit 1.5 x height, height ratio, different-lines, two-faces and outside-every-face cases are tested; fuzzy trailing numbers kept (`BEDROM 2` -> `Bedroom 2`). Residual (Minor, see New below): 3-word keys (`OPEN TO SKY`) can never be assembled because each step must improve the match.
3. **Minor 3, acronyms** — ADDRESSED. `room_display_name` abbreviation branch (`roomnames.py` diff `:384-417`) gives `OTS`, `Toilet`, `Master Bedroom`; the brochure missed room is now `OTS`. Test `test_abbreviations_get_the_default_name_of_their_type`.
4. **Minor 4, test gaps** — ADDRESSED. Of my earlier 12 survivors, 11 now die. The twelfth, the size-below "gap lower bound" check, now dies against the old mutant and one boundary variant (`0 <= gap`) survives. Newly written tests cover size-below reach / column / above / overlap / listed-elsewhere / nearest, left and right corridor borders, 0.5 t name tolerance, topmost and leftmost tie-breaks, support 0.39 / 0.4 / 0.45, quote marks without digits.
5. **Minor 5, test tidiness** — ADDRESSED. `chain()` helper replaces the dead `spans[...]` reassignments; the vacuous assert is gone; the protocol test now calls `label` and `recognize`.
6. **Minor 6, ids and `_room_size`** — ADDRESSED (`_room_size`, `s.id in face.contains_text_ids`, no more `by_id`).
7. **Minor 7, round-trip helper** — ADDRESSED. `tests/support/labeling.py::checked` asserts equality after dict and JSON round trips; used by `run()` and the reference fixture.
8. **Minor 8, `metric_length` as metric evidence** — ADDRESSED (`METRIC_KINDS`, M8 test with `3.2 m`, `2400 mm`, `5.4m`).

## The two implementer questions

(a) **Brochure: 3 size texts with no widths, and 2 missed rooms** — an input limit of OCR and face finding, not a defect in this diff. In the replayed OCR the three size tokens read `100x110`, `100x110`, `101x40` with no foot marks (`pair_imperial False`), so any parser sees a metric pair of 100 mm by 110 mm; the labeler is right to keep `sizeText` and give no widths on an imperial plan (accepted ruling). The 6 garbled tokens (`8'1x50`, `6'6'x7`, `101"x21'6"`, `51X76"` ...) are exactly what supplies the imperial evidence. `OTS` (1134, 914) lies 81 px (3.1 t) from the nearest face and `5 FEET WIDE CORRIDOR` (598, 1231) lies 94 px (3.6 t) away, so neither is within the 1 t M4 tolerance of a face; both are name tokens in no face, which `missedRooms` exists for. Recovering `10'0"` from `100` would be a guess beyond §9.7.
(b) **An unnamed face keeps a size pair it lists** — sound. §9.7 says "a `size_pair` token inside the face or within 2 text heights below the name token"; the first alternative does not need a name. The size is taken only from the face's own `contains_text_ids` (centre inside the polygon), the nearest to the face anchor wins, and a below-name search still needs a name. Tests: `test_an_unnamed_face_keeps_the_size_text_it_lists` (including the not-listed counter-case) and the mutant "unnamed uses below" is killed. Assembly's size check only reads `widthMm/depthMm`, so a size on an unnamed face just feeds the 0.7 / 0.4 check, which is the intended use.

## Reference smoke (re-run, scratch deleted)

| | HDB | Brochure |
|---|---|---|
| unitSystem | metric, no warning (imperial weight 0.0) | imperial, no warning (imperial weight 4.0 from 6 garbled tokens plus `912 SQ.FT`; no span-listed metric tokens) |
| named faces | 5 (Toilet, Bedroom, Toilet, Kitchen, Balcony) | 5 (Bedroom, Bedroom, Toilet, Deck, Kitchen) |
| dimension labels | 39 | 0 |
| size texts | 0 | 3 (no widths) |
| missed rooms | 0 | 2 (`OTS`, `5 Feet Wide Corridor`) |

Equals the report and the floors. All 8 reference tests pass.

## Mutation re-run (`test_labeling_heuristic.py`, 75 mutants)

64 killed, 11 survived (one more did not apply), all in the new code and none behaviour-critical:
- `sum(imperial) >=` instead of `>` (tie of weights)
- garbled weight 0.5 -> 1 (the 0.5 weight itself is untested)
- M4 `parts` not used (a merged name whose face is found only through its right word)
- size-below `0 <= gap`
- merge height ratio 0.7 -> 0.95
- merge overlap allowance
- merge angle test (rotated words)
- abbreviation limit 3 -> 4 (`HALL`)
- abbreviation dot test (`M.BED`)
- trailing-number order

## New breakage in the fix diff

None Critical or Important. Minor:
- **M-a** `roomnames.py` abbreviation branch (`:411-412`): the key wins over the rest of the text, so `BED/TOILET` -> `Bedroom` (before the fix `Bed/Toilet`); information after the abbreviation is dropped. Apply the branch only when the text is the abbreviation (plus trailing numbers).
- **M-b** `heuristic.py:179-216` (`_merge_names`): the "match must improve" rule can never build a 3-word key (`OPEN TO SKY`: `OPEN TO` matches nothing, scratch confirms the three words stay `other`). It also restarts the O(n^2) scan after every merge; a worst-case 400-token dense grid of name words took 2.3 s (real plans have under 100 tokens). Fine for now; note for spec 19.
- **M-c** `test_reference_labeling.py:915`: the matched-room test now compares the labeler's name with `room_display_name(...)`, the function the labeler itself uses, so it no longer checks the name text independently; compare against the truth label or a literal instead.
- **M-d** `heuristic.py:97`: `sq.ft` areas count as imperial evidence (weight 1). It is beyond the ruled weights (feet-inch, size pair, garbled); harmless and tested, log it for spec 19.
- **M-e** Theoretical: when a merged token had itself been joined first, its id can stay in `parts` while `gone` also contains it, leaving the pre-merge word in `plan_tokens`; I could not construct it with left-to-right scanning (a is always the leftmost word), so it is unreachable in practice.

## Out-of-scope observations

None.

## Verdict

**Fix round:** All findings addressed, no new Critical/Important breakage.

**Spec verdict:** compliant. **Task quality:** Approved.
