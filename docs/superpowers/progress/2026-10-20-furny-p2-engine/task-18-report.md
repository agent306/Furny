# Task 18 report: plan drawing model

Status: DONE_WITH_CONCERNS (design decisions below that the spec leaves open or that extend it).
Base b0c2422. Commits:
- ddcadf2 `test(engine): pin the face-target tie order on a 1300 mm face`
- d35c895 `feat(engine): build the plan drawing model shared by screen and exports`

## What was implemented

New `resources/js/engine/plan/drawing/`:
- `types.ts`: `LAYER_ORDER`, `LayerName`, `STYLE_KEYS` (const array, so Task 19 / P4 can build `Record<StyleKey,…>` and check coverage), `StyleKey`, `DrawItem`, `DrawGroup`, `PlanDrawing`, `DrawingOptions`.
- `shared.ts`: output rounding (`r2` = 0.01 mm, never -0) and item builders.
- `walls.ts`: `drawWall`, `drawWallOutline`.
- `openings.ts`: `drawOpening` (doors, windows, gaps).
- `rooms.ts`: `drawRoom`, `ROOM_FILL`.
- `items.ts`: `drawPlacement`, `drawFixture`, `drawLabel`.
- `dimensions.ts`: `drawDimension`, `autoDimensions` (one shared row builder).
- `buildPlanDrawing.ts`, `index.ts`.
- `plan/testing/drawingOptions.ts` (`testDrawingOptions`), `plan/testing/drawingHelpers.ts` (test helpers; extra file, not in the brief list).
- All brief names re-exported from `engine/index.ts`, plus `STYLE_KEYS`, `ROOM_FILL`, `drawWallOutline`.
- Every source file is under 260 lines, so no further split was needed.

`plan/conflicts.ts`: the private `leafSectors` geometry is now `doorLeafFrames(o, d, wall)` (exported from the module, not from the index) and `leafSectors` is built from it. `drawOpening` uses the same frames (hinge, closedDir, openDir, radius), so the drawn leaf and arc are the sector's. The 67 conflicts tests still pass unchanged.

Also done (Task 17 leftover): `snapFootprint.test.ts` pins the tie order on the 1300 mm face with a 1200 mm footprint: cursor 625 gives 600 (start corner marker), cursor 675 gives 700 (end corner marker). The behaviour already held, so the test passed on first run (a pin, not a fix).

## Decisions and spec gaps (please confirm)

1. `dashed?: boolean` added to the `poly` and `line` DrawItem variants (set only when true). 05 §9.1 / the water_heater ruling needs dashed ellipses and the wardrobe rod is a dashed line, and StyleKey has no dashed variants. This is additive to 04 §8.1; Task 19 `svgFromDrawing` must honour it (`stroke-dasharray`) and the 04 §8.1 type should be amended (log in 19). Pocket-door panels use it too (see 4).
2. Arc angles: `startDeg` in [0, 360), `endDeg = startDeg + 90` (so `endDeg - startDeg` is the clockwise sweep). Angles keep 4 decimals (not 0.01) so an arc endpoint stays within 0.01 mm of the sector endpoint for radii up to a few metres. All other numbers are on the 0.01 mm grid. On the axis-aligned reference plans the match is exact; on a diagonal wall test it is within 0.02 mm (coordinate rounding on centre and radius).
3. Layers: every `text` item goes to TEXT, except `dim_text`, which stays on DIMS with its dimension. A draw function returns one `DrawGroup`; `buildPlanDrawing` splits it, so a room appears on ROOMS (fill) and TEXT (label) with the same entityId. Within a layer groups are stable-sorted by entityId (null last, so the `wall_outline` group is the last WALLS group and paints over the fills); groups with no items are dropped. `bbox` covers all layers except BACKGROUND (null when nothing is drawn). Text contributes only its anchor point.
4. Pocket door: spec says "dashed portion inside the wall"; drawn as one `sliding_panel` rect of length width x 30 deep, `dashed: true`, extending from the hinge jamb into the wall (nothing is drawn in the gap itself).
5. LOD rules from 05 §4.7 applied where the engine can express them: lod>=1 drops arcs, auto dimensions, furniture names, fixture detail items, the room size line; lod 2 also drops room areas, window glass lines and user dimension texts. Brief-pinned ones: arcs at lod 1 and `doorSwings:false`.
6. Room label stack: 3 lines use -0.6 / +0.6 / +1.8; 2 lines use -0.6 / +0.6 (compact, not fixed slots); 1 line uses 0. Name is always shown when `include.rooms`; a room without meta is "unnamed, type other, area shown".
7. Room fill colours: sRGB hex converted from the light oklch tokens of 15 §3.1 with the 15 §3.4 grouping (`ROOM_FILL`), not the indicative hex of 05 §4.6. Because it is a fixed light hex in `fill`, the dark-theme renderer cannot recolour from the fill alone (P4 would need to map hex to tokens, or a future `fillKey`).
8. Bay window: inset = min(400, width/2), depth = inset (45 degree sides stay valid for windows narrower than 800); frame is an open `window_frame` polyline on top of the two face frame lines, glass on the outer edge.
9. Zero-width (clamped) openings: `drawOpening` returns an empty group (ruling carried), dropped by the builder.
10. Auto dimension chain: overlapping openings are merged and zero-length segments skipped so segments always sum to the wall length. Chain-row extension lines at the two wall ends continue the first row's lines instead of overlapping them.
11. Labels: anchor `start`, baseline `middle`, at `position`, rotation `label.rotation`. Fixtures' `label` string is not drawn (spec says nothing; say if wanted).
12. Door/window of a mismatched kind/type falls back to a plain gap (door) or casement (window), since validatePlan does not guard it.

## Concern to look at

`wall_outline` is built from `wallsUnion`, which is computed without opening cuts (derive.ts), so the stroke runs across every door and window gap, contrary to 05 §4.4 ("drawn on clean gaps"). I followed the brief exactly (one outline group from `wallsUnion`). Fix options: derive an openings-subtracted union (derive/Task 10 area) or subtract the cuts in the drawing with `geometry/clip`. Your call.

## Tests

- `plan/drawing/__tests__/drawing.test.ts` (51): layers/styles; wall styles and poché; every door type (single both hinge/swing combos, double, main entrance + threshold, sliding, pocket, bifold, zero-width); every window type; room stack/area/dims/unnamed/lod; placement incl. arrow, rotation, missing design; fixtures (footprint mapping, detail/dashed, 24-point ellipse, fill, lod); label; auto dimensions (offset, ticks, extension lines, chain sum, overlap, right side, default left, <300, rotation normalisation for 8 directions, imperial units, lod); user dimensions.
- `plan/drawing/__tests__/drawingBuild.test.ts` (34): smoke on both reference plans, as built and with all 35 fixtures + placements + dimension + label + background (builds, every layer present in paint order, no NaN / Infinity / -0, 0.01 grid except arc angles, only known StyleKeys); layer routing; outline group; include flags; lod; bbox; determinism (3 shuffled record orders of the same doc deep-equal, groups sorted, inputs not mutated); every swing door of buildHdb3Room and buildBrochure2Bhk has an arc whose centre and endpoints match its `doorSwingSectors` polygon within 0.01 mm (plus a diagonal wall with single, double and french doors, 0.02 mm).
- A mutation (flipping the arc sweep test in `quarterArc`) fails 6 tests, including the sector-match ones.

### TDD evidence
- RED: `yarn vitest run --project engine resources/js/engine/plan/drawing` before implementation: `Test Files 2 failed (2), Tests no tests`, `Failed to load url .. ` (the `..` drawing index did not exist).
- GREEN: same command after implementation: `Test Files 2 passed (2), Tests 85 passed (85)`.
- Full engine project: `yarn vitest run --project engine`: `Test Files 36 passed (36), Tests 1196 passed (1196)`. The purity test caught the word "window" followed by a full stop in one comment (fixed).
- Gates: `yarn eslint resources/js/engine`, `yarn prettier --check resources/js/engine`, `yarn vue-tsc --noEmit` all clean.

## Files changed
- Added: `resources/js/engine/plan/drawing/{types,shared,walls,openings,rooms,items,dimensions,buildPlanDrawing,index}.ts`, `resources/js/engine/plan/drawing/__tests__/{drawing,drawingBuild}.test.ts`, `resources/js/engine/plan/testing/{drawingOptions,drawingHelpers}.ts`
- Modified: `resources/js/engine/plan/conflicts.ts`, `resources/js/engine/index.ts`, `resources/js/engine/plan/__tests__/snapFootprint.test.ts`

## Self-review
Read my diff for unused code and naming; removed a redundant assertion and a vague fixture-fill test (replaced by the `column` fill). The `_opts` parameters of `drawWall` and `drawLabel` are kept for the uniform 04 §8.1 signature, with an eslint disable carrying the reason.

## Fix round 1

Commit: see `git log` (`fix(engine): clean outline gaps, theme-token room fills and drawing edge cases`).

1. Outline gaps (ruling): `drawWallOutline(wallsUnion, cuts)` subtracts the opening cut rectangles with `difference` from `geometry/clip` (same `o.cut` rings and the same area > 1 mm² filter that derive uses for the poché; zero-width cuts are ignored). `buildPlanDrawing` passes the cuts in opening-id order. Test: on the HDB plan, edges of the outline sampled every 5 mm never enter any cut (each shortened 2% along its wall so a stroke on a jamb does not count); a precondition asserts the plain `wallsUnion` does run through the gaps. Mutation (cuts not passed) fails that test.
2. Room fills (ruling): `ROOM_FILL` hex table removed. `poly` items gained `fillKey?: RoomColorKey` (documented in `types.ts`: theme token, resolved by the renderer: CSS var on screen, `EXPORT_PALETTE` in exports); `fill` stays for literal fixture fills. `room_fill` items carry `fillKey` and no `fill`. `roomTypeToColorKey(type)` is implemented in `drawing/rooms.ts` with the exact 15 §3.4 table and exported from the engine index (`ROOM_FILL` export dropped, `RoomColorKey` type exported). `RoomColorKey` is declared in the engine because the P1 `EditorColorKey` lives outside it; its ten `room-*` literals must stay equal to the P1 union. RoomType check: the engine's `ROOM_TYPES` (19) equals the 19 types in the 15 §3.4 table exactly, no difference (test compares the sorted sets). Note 15 §3.4's table has no `room-label`; `room-label` is a text colour and not used here.
3. Missing-design square now `dashed: true`, asserted (mutation killed).
4. Text rotation: angle rounded to 0.01 first, then normalised into (-90, 90]. Tests: directions at 90.004 and 270.004 degrees give 90 (not -90), plus the neighbours -84.29.
5. New pins (`drawingEdges.test.ts`, plus edits): bay window with exteriorSide right; chain-row end extension lines (end stops continue row 1 at -615..-965, interior stops run -215..-965); room fill holes (room around a column); poché holes via a hand-made holed part (derive cannot produce one because cuts overshoot both faces, so the old "holes kept" test never exercised holes; split into two tests); open fixture polyline (`closed:false`, via a spy on `symbol2d`); `r2`/`rAngle` `-0` unit tests and a drawn-item check; bbox arc extreme (a door on a 45 degree wall: the arc's lowest point is 100+ mm below both end points and below every wall point, and sets `bbox.max.y`); pocket and bifold with `hinge: 'end'`.
6. Short user dimensions: extension lines are skipped when the dimension line is closer than 100 mm (`offset < EXT_GAP`); line, ticks and text remain. Tests for offsets 0, 50, -50, 99 (none) and 100 (drawn, 100 to 200).
7. Whitespace-only room names fall back to `strings.unnamedRoom`; names are trimmed when shown. Tests for `'   '`, tab/newline and `'  Den '`.
8. `image` draw item docblock: `at` is the unrotated top-left, `rotationDeg` is about the centre `at + (width, height) / 2` (05 §4.12, 06 §12.2); `width`/`height` are the unrotated size.

Results: `yarn vitest run --project engine`: 37 files, 1231 tests passed (drawing: 120). eslint, prettier --check, vue-tsc clean. Mutation spot-checks of the new behaviour (cuts, rotation rounding, ext-gap guard, dashed, trim, -0) each fail at least one test.
