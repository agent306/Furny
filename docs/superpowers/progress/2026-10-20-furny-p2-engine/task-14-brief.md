### Task 14: Reference plan fixtures (HDB 3-room, brochure 2BHK)

**Files:**
- Create: `resources/js/engine/plan/testing/referencePlans.ts`, `database/fixtures/plans/hdb-3room.json`, `database/fixtures/plans/brochure-2bhk.json`
- Test: `resources/js/engine/plan/__tests__/referencePlans.test.ts`

**Spec refs:** `03 §6`, `04 §9` ("HDB fixture produces ≥ 9 rooms with the named metas attached"); reference images `vision/tests/fixtures/reference/hdb-3room.webp`, `brochure-2bhk.png` (look at them; the layouts below are simplified recreations)

**Interfaces:**
- Consumes: Tasks 8–13.
- Produces: `buildHdb3Room(): PlanDocument`, `buildBrochure2Bhk(): PlanDocument` (fixed ids, test-only); the two committed JSON files (P3 derives its `*.expected.json` from them; P4/P10 demo seeders load them).

Fixture geometry (centre lines, mm; exterior walls `kind 'exterior'` 230, interior `'interior'` 115; ids `n_hdb0000001…`, `w_hdb0000001…`, `o_hdb…`, `r_hdb…` (brochure: `n_bhk0000001…` etc.) numbered in table order; doors height 2100; `meta.defaultWallHeight 2600`, `createdWith 'editor'`, all walls height 2600 except noted):

**hdb-3room** — nodes N1 (0,0), N2 (1600,0), N3 (2900,0), N4 (4700,0), N5 (5900,0), N6 (8300,0), N7 (9700,0), N8 (9700,−600), N9 (11000,−600), N10 (11000,1900), N11 (11000,3300), N12 (11000,7400), N13 (7900,7400), N14 (7700,7400), N15 (4100,7400), N16 (0,7400), N17 (0,3300), N18 (1600,3300), N19 (4700,3300), N20 (7900,3300), N21 (8300,3300), N22 (1600,1900), N23 (2900,1900), N24 (4700,1900), N25 (5900,1900), N26 (9700,1900), N27 (4100,8300), N28 (7700,8300).
Walls W1–W37: exterior 230: N1–N2, N2–N3, N3–N4, N4–N5, N5–N6, N6–N7, N7–N8, N8–N9, N9–N10, N10–N11, N11–N12, N12–N13, N13–N14, N14–N15, N15–N16, N16–N17, N17–N1, N15–N27, N27–N28 (**`kind 'half'`, 115, height 1000**), N28–N14; interior 115: N17–N18, N18–N19, N19–N20, N20–N21, N21–N11, N2–N22, N22–N18, N4–N24, N24–N19, N6–N21, N20–N13, N22–N23, N3–N23, N24–N25, N5–N25, N7–N26 (**thickness 230**, kind interior), N26–N10.
Openings (offset from node a): main_entrance on W16 offset 800 w 1000; single_swing on W22 2300/900, W23 2400/900, W31 700/900, W25 600/800, W32 650/700, W34 600/700, W37 650/700; `opening` on W21 800/900 (h 2100); sliding door on W14 1800/2400; casement windows (h 1200, sill 900 unless stated) on W2 650/600 (h 600, sill 1500), W3 900/1200, W5 1200/1500, W11 2050/1500, W1 800/900, W15 2050/1800.
RoomMetas (name, type, anchor): Kitchen/kitchen (800,1650); Toilet 1/toilet (2250,950); Bedroom 1/bedroom (3800,2600); Toilet 2/toilet (5300,950); Bedroom 2/bedroom (7000,1650); Toilet 3/toilet (10350,650); Dress/dress (9000,2600); Living Room/living (4000,5350); Bedroom 3/bedroom (9450,5350); Balcony/balcony (5900,7850).

**brochure-2bhk** — nodes A1 (0,0), A2 (3220,0), A3 (6410,0), A4 (9630,0), A5 (9630,3530), A6 (8010,3530), A7 (6410,3530), A8 (8010,5880), A9 (6410,5880), A10 (6410,8120), A11 (3220,8120), A12 (0,8120), A13 (0,5170), A14 (0,3530), A15 (3220,3530), A16 (3220,1390), A17 (6410,1390), A18 (2580,3530), A19 (2580,5170), A20 (3220,5170).
Walls: exterior 230: A1–A2, A3–A4, A4–A5, A5–A6, A6–A8, A8–A9, A9–A10, A10–A11, A11–A12, A12–A13, A13–A14, A14–A1; A2–A3 **`kind 'half'`, 115, height 1000** (deck railing); interior 115: A2–A16, A16–A15, A3–A17, A17–A7, A16–A17, A14–A18, A18–A15, A7–A6, A7–A9, A15–A20, A20–A11, A18–A19, A13–A19, A19–A20.
Openings: main_entrance on A10–A11 offset 1600 w 1000; single_swing A16–A15 1500/800, A17–A7 1500/800, A14–A18 1900/700, A7–A9 1200/700, A16–A17 1595/900, A19–A20 320/500; `opening` A20–A11 1000/900; casement windows A1–A2 1610/1500, A4–A5 1765/1500, A12–A13 1475/1200; ventilators (h 600, sill 1500) A13–A14 820/600, A6–A8 1175/600.
RoomMetas: Bedroom 1/bedroom (1600,1800); Deck/deck (4800,700); Bedroom 2/bedroom (8000,1800); Toilet 1/toilet (1300,4350); W/M/utility (2900,4350); Kitchen/kitchen (1600,6650); Living/Dining/living (4800,4800); Toilet 2/toilet (7200,4700).

- [ ] **Step 1: Write the failing tests** — committed JSON `toEqual` the builders (when `process.env.UPDATE_FIXTURES === '1'` the test writes the files first; run once that way to create them); both pass `PlanDocumentSchema` and `validatePlan` returns no `error` issues; HDB: 37 walls, 16 openings, **10 rooms**, every room has a `metaId`, net areas (±1) Kitchen 4 464 506, Toilet 1 2 047 088, Bedroom 1 6 940 338, Toilet 2 1 874 338, Bedroom 2 8 688 338, Toilet 3 2 490 425, Dress 5 509 506, Living Room 30 349 756, Bedroom 3 11 497 756, Balcony 2 451 675; `netRect` of Living Room = `{ width: 7727.5, depth: 3927.5 }`; `planSummary.totalAreaMm2` = 76 313 726 (±5); bbox `{ min: {x:-115,y:-715}, max: {x:11115,y:8358} }` (parapet outer face 8357.5, `roundMm` → 8358). Brochure: 27 walls, 13 openings, **8 rooms** all with metas; areas (±1) Bedroom 1 10 231 981, Deck 3 920 625, Bedroom 2 10 145 444, Toilet 1 3 671 438, W/M 800 625, Kitchen 8 464 431, Living/Dining 20 042 125, Toilet 2 3 108 381.
- [ ] **Step 2: Run it, expect FAIL** — `yarn vitest run resources/js/engine/plan/__tests__/referencePlans.test.ts`
- [ ] **Step 3: Implement** — the two builders from the tables; then `UPDATE_FIXTURES=1 yarn vitest run resources/js/engine/plan/__tests__/referencePlans.test.ts` to write the JSON (2-space indent, trailing newline). If an area assertion fails, re-derive it by hand from the coordinates (net = face minus half thicknesses) before touching engine code — the numbers above were computed that way.
- [ ] **Step 4: Run tests, expect PASS** — `yarn vitest run resources/js/engine/plan`
- [ ] **Step 5: Quality gates** — `yarn eslint resources/js/engine && yarn prettier --check resources/js/engine database/fixtures/plans && yarn vue-tsc --noEmit`
- [ ] **Step 6: Commit** — `git add resources/js/engine/plan database/fixtures/plans` → `test(engine): add HDB and 2BHK reference plan fixtures`

