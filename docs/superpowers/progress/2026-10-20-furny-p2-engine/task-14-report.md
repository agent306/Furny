# Task 14 report: reference plan fixtures (HDB 3-room, brochure 2BHK)

Status: DONE (controller ruling C8 applied; see deviations from the brief).

## Implemented
- `resources/js/engine/plan/testing/referencePlans.ts`: `buildHdb3Room()` and `buildBrochure2Bhk()`, table-driven, fixed ids (`n_hdb0000001`, `w_bhk0000001`, ...; table order, 10-char id body), walls 2600 high (`half` 1000), doors 2100, `meta.defaultWallHeight` 2600, `createdWith 'editor'`.
- `database/fixtures/plans/hdb-3room.json`, `brochure-2bhk.json` (2-space JSON, trailing newline), written by `UPDATE_FIXTURES=1`.
- `resources/js/engine/plan/__tests__/referencePlans.test.ts`: JSON `toEqual` builders (writes first when `UPDATE_FIXTURES=1`), schema parse, `validatePlan` no errors, opening-in-wall bounds (offset is the opening CENTRE, 03 §1), counts, every room has a meta, hand-derived areas (derivation in the header comment), netRects, planSummary total and bbox.
- `.prettierrc`: added an override `database/fixtures/**/*.json` -> `tabWidth 2` (the repo default of 4 made `prettier --check database/fixtures/plans` fail for the brief's 2-space JSON).

## Deviations from the brief (controller ruling C8)
HDB: N13 and N20 at x=7773 (was 7900). All other nodes unchanged. Living net width 7600.5 (asserted within +-1 of 7600), Bedroom 3 net width 3054.5. Total unchanged in exact terms.
Brochure: nodes A5, A6, A7, A14, A15, A18 at y=3525 (was 3530); wall A7-A6 is thickness 230 kind interior. Every brochure area re-derived.

Opening fit (offset = centre; need width/2 <= offset <= length - width/2): no opening had to change.
- Walls touching N13/N20 changed length: W12 N12-N13 3100 -> 3227 (no openings), W13 N13-N14 200 -> 73 (no openings), W23 N19-N20 3200 -> 3073 (door 2400/900 needs <= 2623: fits), W24 N20-N21 400 -> 527 (no openings), W31 N20-N13 unchanged length 4100 (door 700/900 fits).
- Brochure: wall lengths on the y=3525 row shrank by 5 (A16-A15 2140 -> 2135, A17-A7 2140 -> 2135, A7-A9 2350 -> 2355, A13-A14 1640 -> 1645, A6-A8 2350 -> 2355, A4-A5 3530 -> 3525); all 13 openings still fit (the tightest: A19-A20 door 320/500 on a 640 wall, untouched). The test asserts bounds for every opening of both plans.

## Final areas, hand-computed vs engine (mm^2)
Hand = exact value from face-minus-half-thickness arithmetic (derivations in the test header). Engine = `DerivedRoom.areaMm2` (whole mm, rounded by the engine). All agree within rounding (0 discrepancy beyond .5).

| Plan | Room | Hand (exact) | Engine | netRect (engine) |
|---|---|---|---|---|
| HDB | Kitchen | 4 464 506.25 | 4 464 506 | 1427.5 x 3127.5 |
| HDB | Toilet 1 | 2 047 087.5 | 2 047 088 | 1185 x 1727.5 |
| HDB | Bedroom 1 | 6 940 337.5 | 6 940 338 | null (L) |
| HDB | Toilet 2 | 1 874 337.5 | 1 874 338 | 1085 x 1727.5 |
| HDB | Bedroom 2 | 8 688 337.5 | 8 688 338 | null (L) |
| HDB | Toilet 3 | 2 490 425 | 2 490 425 | 1070 x 2327.5 |
| HDB | Dress | 5 509 506.25 | 5 509 506 | null (L) |
| HDB | Living Room | 29 850 963.75 (7600.5 x 3927.5) | 29 850 964 | 7600.5 x 3927.5 |
| HDB | Bedroom 3 | 11 996 548.75 (3054.5 x 3927.5) | 11 996 549 | 3054.5 x 3927.5 |
| HDB | Balcony | 2 451 675 | 2 451 675 | 3370 x 727.5 |
| HDB | total | 76 313 725 | 76 313 727 (sum of rounded; brief 76 313 726 +-5) | |
| Brochure | Bedroom 1 | 10 216 743.75 (3047.5 x 3352.5) | 10 216 744 | 3047.5 x 3352.5 |
| Brochure | Deck | 3 920 625 | 3 920 625 | 3075 x 1275 |
| Brochure | Bedroom 2 | 10 041 512.5 (3047.5 x 3295) | 10 041 513 | 3047.5 x 3295 (non-null) |
| Brochure | Toilet 1 | 3 683 475 | 3 683 475 | 2407.5 x 1530 |
| Brochure | W/M | 803 250 | 803 250 | 525 x 1530 |
| Brochure | Kitchen | 8 464 431.25 | 8 464 431 | 3047.5 x 2777.5 |
| Brochure | Living/Dining | 20 042 125 | 20 042 125 | null (stepped right face) |
| Brochure | Toilet 2 | 3 033 437.5 | 3 033 438 | 1427.5 x 2125 |
| Brochure | total | 60 205 600 | 60 205 601 | |

Brief numbers that changed: HDB Living 30 349 756 -> 29 850 964, Bedroom 3 11 497 756 -> 11 996 549, Living netRect width 7727.5 -> 7600.5; brochure Bedroom 1 10 231 981 -> 10 216 744, Bedroom 2 10 145 444 -> 10 041 513, Toilet 1 3 671 438 -> 3 683 475, W/M 800 625 -> 803 250, Toilet 2 3 108 381 -> 3 033 438. Unchanged: all other HDB rooms, Deck, Kitchen, Living/Dining. HDB bbox {-115,-715}..{11115,8358}; brochure bbox {-115,-115}..{9745,8235}.

Both plans: `validatePlan` returns zero issues (not just zero errors) and derivation emits zero derive issues, including the 73 mm wall N13-N14.

## TDD evidence
- RED: `yarn vitest run --project engine resources/js/engine/plan/__tests__/referencePlans.test.ts` -> `Cannot find module '../testing/referencePlans'` (builders not yet written; expected).
- GREEN: `UPDATE_FIXTURES=1 yarn vitest run ...referencePlans.test.ts` -> 28 passed (hand-derived values matched the engine on the first run, so no engine discrepancy and nothing to re-derive). Then `yarn vitest run --project engine resources/js/engine` -> 27 files, 811 tests passed (JSON fixtures compared without UPDATE_FIXTURES).
- Gates: `yarn eslint resources/js/engine` clean; `yarn prettier --check resources/js/engine database/fixtures/plans .prettierrc` clean; `yarn vue-tsc --noEmit` clean.

## Files changed
- resources/js/engine/plan/testing/referencePlans.ts (new)
- resources/js/engine/plan/__tests__/referencePlans.test.ts (new)
- database/fixtures/plans/hdb-3room.json, brochure-2bhk.json (new)
- .prettierrc (fixtures JSON override)

## Concerns / notes
- Engine discrepancies: none.
- Floor finishes, materials (all `brick`) and the Toilet-room casement on W2 (type casement, h 600, sill 1500, as the brief says) are my choices where the brief is silent: bedroom/dress `wood`, everything else `tile`.
- Log in 19: HDB drawing 3100 vs 3054.5 (45 mm) per ruling C8; HDB W13 N13-N14 is 73 mm, shorter than its 230 thickness (engine handles it with no issues).
- Python `vision/tests/fixtures/reference/*.expected.json` (P3) must be derived from these JSON files, not from the brief tables.
