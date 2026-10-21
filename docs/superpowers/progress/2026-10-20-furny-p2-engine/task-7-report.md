# Task 7 report: fixture library + room names

Status: DONE_WITH_CONCERNS. Commit 7da6c02 "feat(engine): add fixture library and room-name suggestions".

## Implemented
- `resources/js/engine/plan/roomTypes.ts`: `ROOM_TYPES` (19 values, 03 §1 order, as const), `RoomType`.
- `resources/js/engine/plan/roomNames.ts`: `ROOM_NAMES` (all 06 §7.8 keys, upper-case; BATH/BATHROOM -> bathroom, other bath-ish words -> toilet) and `suggestRoomType`.
  Matching: upper-case, hyphen -> space, other punctuation dropped except `/`, words split on space and `/`. Windows of the label are tried longest phrase first (so MASTER BEDROOM beats BEDROOM, WASH AREA beats WASH), phrases are found anywhere in the label ('Bed Room 2'). A word matches at Levenshtein ratio 1 - dist/max(len) >= 0.8; best mean ratio wins, ties go to the earliest window; no match -> 'other'.
- `resources/js/engine/plan/fixtures.ts`: `FIXTURE_KEYS` (35, 05 §9.4 order), `FixtureKey`, `FixtureCategory`, `FixtureMaterialKey`, `Fixture2DItem`, `FixturePrimitive`, `FixtureDef`, `FIXTURE_LIBRARY`. All defaults, elevations, 2D symbols and 3D primitives transcribed from 05 §9.4, using notation helpers R/E/L/P, B/C/S and `legs`. sofa_l and kitchen_counter_l use the absolute-mm formulas (s, b, a). Items after the first are `detail` unless the spec says "outline style" (wc, basin, dining table, office chair, sofa outline).
- `resources/js/engine/index.ts`: exports the new public names.
- Tests: `plan/__tests__/fixtures.test.ts`, `plan/__tests__/roomNames.test.ts`.

## Rulings applied
- I7: no "decals <= 1.05" relaxation; every 2D coordinate at 50/100/200 % is asserted within [-0.5, 0.5] x [0, 1] (tolerance 1e-9). The header comment in fixtures.ts says so.
- Purity: grep for `window.`, `document.`, `fetch(` in engine/plan is clean.

## TDD evidence
RED (before implementation, both files):
`yarn vitest run --project engine resources/js/engine/plan/__tests__/fixtures.test.ts` -> "Failed to load url ../fixtures ... Does the file exist?" (Test Files 1 failed, no tests); same for roomNames.test.ts -> "Failed to load url ../roomNames" (roomNames.ts was written before the first run; I re-ran RED by moving it away, same failure).
GREEN: `yarn vitest run --project engine` -> Test Files 19 passed, Tests 550 passed (plan tests: roomNames 20, fixtures 93). Quality gates: `yarn eslint . --max-warnings=0` clean, `yarn prettier --check resources/js/engine` clean, `yarn vue-tsc --noEmit` clean.

## Concerns / deviations (please rule or log in 19)
1. File naming: the dispatch text said `fixtureLibrary.ts`, brief and 05 §9.1 say `fixtures.ts`; I used `fixtures.ts` (plus `roomTypes.ts` per brief).
2. Spec type gap: the 05 §9.1 `Fixture2DItem` ellipse has no `dashed`, but 05 §9.4 gives `water_heater` as "E(0,.5,.5,.5) dashed". I added optional `dashed?: boolean` to the ellipse variant (commented in code). 05 §9.1 should be amended; the 2D renderer (Task 18) should honour it.
3. Spec test gap: 06 §7.8 says a unit test asserts the TS keys equal `vision/app/utils/roomnames.py`. That file does not exist yet (vision/ holds only tests/fixtures), so no parity test was written; add it when the vision service lands. My test spot-checks keys of every dictionary group instead.
4. 05 §9.1 comment says 3D z in [0,1], but 05 §9.4 itself has sink basin z to 1.02, bathtub water to 1.005 and hob burners 1 to 1.5. Transcribed verbatim.
5. "Mirror image" variants of sofa_l / kitchen_counter_l are described as swap width/depth and rotate 90 degrees; they are a placement-time concern and not implemented as separate defs.
6. Matching choice not fixed by the brief: '-' becomes a word break (WALK-IN -> 'WALK IN', so 'Walk-in Closet' works), '.' is deleted (W.C -> WC, M.BED -> MBED), '/' also separates words (so 'LIVING/DINING' is a two-word phrase and 'Dining/Living' resolves to dining). Short words (<= 4 chars) therefore need an exact match, per the 0.8 threshold.
7. Category counts (asserted in test): bedroom 7, living 8, dining 3, study 2, kitchen 6, bathroom 4, utility 2, structure 2, outdoor 1 = 35.
