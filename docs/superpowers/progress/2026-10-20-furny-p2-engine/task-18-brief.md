### Task 18: Plan drawing model

**Files:**
- Create: `resources/js/engine/plan/drawing/types.ts`, `buildPlanDrawing.ts`, `walls.ts`, `openings.ts`, `rooms.ts`, `items.ts` (placements, fixtures, labels), `dimensions.ts` (user + auto), `index.ts`; `resources/js/engine/plan/testing/drawingOptions.ts`
- Test: `resources/js/engine/plan/drawing/__tests__/drawing.test.ts`

**Spec refs:** `04 §8.1–§8.2`, `05 §9.1` (fixture 2D mapping), `04 §9` (drawing row)

**Interfaces:**
- Consumes: Tasks 4 (`formatLength`, `formatArea`), 7, 10–11, 15.
- Produces: `LayerName`, `LAYER_ORDER`, `StyleKey`, `DrawItem`, `DrawGroup`, `PlanDrawing`, `DrawingOptions`, `buildPlanDrawing(doc, geom, opts)`, `drawWall`, `drawOpening`, `drawRoom`, `drawPlacement`, `drawFixture`, `drawDimension`, `autoDimensions`, `drawLabel` (signatures of 04 §8.1); test-only `testDrawingOptions(overrides?)`.

- [ ] **Step 1: Write the failing tests** — layer keys in paint order `BACKGROUND, ROOMS, FIXTURES, FURNITURE, WALLS, OPENINGS, DIMS, TEXT`; a `single_swing` door: leaf line from the hinge jamb point on the swing face, length = width, arc centre = hinge point and both arc endpoints lie on the swing face line / leaf end (±0.01); arcs omitted at `lod 1` and with `include.doorSwings false` (leaf kept); `double_swing` → two leaves of width/2; `sliding` → two `sliding_panel` polys of length 0.55·width; window `casement` → two `window_glass` lines at ±20 mm; auto-dimensions: one group per wall ≥ 300 mm (entityKind `auto_dimension`), side = `exteriorSide ?? 'left'`, offset `t/2 + 400`; with openings a second chain row whose segment lengths sum to the wall length; dimension text rotation normalised to `(−90°, 90°]`; room label stack dyEm `−0.6 / +0.6 / +1.8` when name+area+dims shown, `0` for a single line; empty name → `strings.unnamedRoom`; unknown design → dashed `furniture_missing` 600 × 600 square with `strings.missingDesign`; fixture ellipses become 24-point polygons and `detail` items use style `fixture_detail`; wall style `wall_exterior` for exterior, `wall_glass` for glass material; one `wall_outline` group built from `wallsUnion`.
- [ ] **Step 2: Run it, expect FAIL** — `yarn vitest run resources/js/engine/plan/drawing`
- [ ] **Step 3: Implement** — symbol rules of 04 §8.2 one function per entity kind; text sizes from `opts.textSizeMm(style)`.
- [ ] **Step 4: Run tests, expect PASS** — same command.
- [ ] **Step 5: Quality gates** — `yarn eslint resources/js/engine && yarn prettier --check resources/js/engine && yarn vue-tsc --noEmit`
- [ ] **Step 6: Commit** — `git add resources/js/engine/plan resources/js/engine/index.ts` → `feat(engine): build the plan drawing model shared by screen and exports`

