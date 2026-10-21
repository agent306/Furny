# Task 38 review: table family generator (d227d13..78c331b)

Reviewed from `review-d227d13..78c331b.diff` (190 KB, 5233 lines, non-empty) in two passes: first the generator, outlines and carries, then the tests. Outside the diff I read only `overrides.ts:99-121` (whether the `edgeMap` remap of side drawers is observable), `rules/carcassHardware.ts:28-38` (`legFitsHeight`), `constants.ts` (table constants) and `schema.ts:188-221` (table spec).

Probes and mutants ran in a scratch copy (`resources/js` plus fixtures, `node_modules` symlinked). The copy is deleted, and the worktree is unchanged (`git status` is clean).

## Spec Compliance

✅ **Spec compliant, apart from one geometry defect.**

07 §3.13 is implemented formula by formula:

- **Top:**
  - Layer count `k` uses `max(1, round(T/t_top))`, with info `table_top_thickness_rounded` when the count is not exact (`generateTable.ts:236-245`).
  - The inscribed footprint applies to round and oval tops except on a pedestal (`:248-253`).
  - Layers: faces are 1 for `table.top` and 0 for the other layers, and all four edges are banded (`:327-353`).
- **four_legs:**
  - Legs `t_leg × s`.
  - Aprons `[bx0+s, bx0+Wb−s]`, with inset `t_c` and only the bottom edge banded.
  - Stretchers centred on the legs, at y `[150, 210]`.
  - Lower shelf with front and back banded.
  - Dowels: 2 per end and 8 for the shelf. Corner brackets: 4.
  - `leg_height_mismatch` via `legFitsHeight` against Hb. `table_span_long` when `Wb > 2400`.
- **panel_ends:**
  - Ends banded front and back.
  - Modesty panel: `mh = min(400, fl(Hb/2))`, z `[bz0+20, +t_c]`.
  - Shelf: z `[bz0, bz0+Db−20]`, front edge banded.
  - Joints and lengths: end ↔ top `Db`, modesty ↔ end `mh`, shelf ↔ end `Db−20`.
- **trestle:** upright `[80, Hb−80]`, foot and cleat over `Db`, centre beam `[Hb/2 ± 40]`. Cams 4, dowels 8.
- **pedestal:**
  - Column `c = max(150, fl(0.25·min(Wb, Db)))`.
  - Sides 1 and 3 are `c + 2t_c` with thin z; sides 2 and 4 are `c` with thin x.
  - Base plate `max(400, fl(0.6·min(W, D)))`, all four edges banded. Top plate `c + 2t_c + 100`.
  - `pedestal_unstable` when `max(W, D) > 1200`.
- **cabinet_ends:**
  - `Dk = Db − t_f`. Sides and bottom banded front. Inset back at y `[t_c, Hb]`.
  - Joints of the spec.
  - Knee width `Wb − cw − t_c`, then `knee_space_narrow { width }`.
  - Modesty panel over `[bx0+t_c, cx0]`.
  - Content:
    - drawers via `drawersFor` with top cover −2;
    - shelves via `shelvesFor` plus a right-hinged door;
    - empty;
    - anything else gives `cabinet_content_unsupported`.
- **Under-top drawers:**
  - Spans, `fh`, `ws = min(600, fl((span−(k−1)·50)/k))`, centring, and `depthAvail` per base.
  - Box per §3.12 with `Wo = ws`, slot `fh + 20` and `A = depthAvail`.
  - Handles use `handle.default` (§6.4). No apron on the drawer side.
- **Hardware:** `screw_pack.default` is present, and nothing from §6.8.

Every brief value checks out: dining, hardware legs (boundaries 695..725 tested), stretcher/shelf, round 1000 (Wb 636, bx0 182), the 2-layer and rounded tops, and the desk (end 725 × 600, cabinet side 725 × 582, fronts 397 at X [801.5, 1198.5], SLD-BB-550 × 3, modesty 782 × 362, knee 782 and 482).

§7.3 codes and severities match:

| Code | Severity | Params |
|---|---|---|
| `round_top_not_square` | error | — |
| `corner_radius_too_large` | error | — |
| `cabinet_content_unsupported` | error | — |
| `table_drawer_side_unsupported` | error | — |
| `knee_space_narrow` | warning | `{width}` |
| `pedestal_unstable` | warning | — |
| `leg_height_mismatch` | warning | `{code}` |
| `table_span_long` | warning | — |
| `leg_section_mismatch` | info | — |
| `table_top_thickness_rounded` | info | — |

❌ **The one defect is Important finding I1:** under-top drawer runners occupy the same space as legs, aprons, end panels and the cabinet. 07 §3.13 does not place the runners, but the chosen placement produces overlapping solids for template defaults.

⚠️ **Cannot verify from the diff:** the template wiring of §2.4.14 to §2.4.17 (topDrawer, console drawers, coffee lowerShelf) is a later task. I probed those configurations directly with `tableDocument`.

## Checks run

### 1. §3.13 boundary cases (scratch probe through `generateFurniture`)

For each case I checked part sizes > 0, length ≥ width, boxes inside the bbox, unique hardware keys, and box-to-box overlaps (excluding parts within one drawer box). Results:

- **Clean** (no overlaps, sizes and bbox fine):
  - dining default;
  - dining at the minimum round size 900 (inscribed Wb 601, aprons 465);
  - dining at the maximum 3000 × 780 × 1200, four legs with stretcher and shelf. It gives `table_span_long`, `shelf_sag_critical` and `part_exceeds_sheet` for parts longer than a sheet. That is expected catalog behaviour.
  - trestle at the maximum (stretcher 2750 × 80, `part_exceeds_sheet`);
  - pedestal on round 1200 (c 275, base 720, no `pedestal_unstable`) and on oval 1200 × 800;
  - coffee table, round 500 at the minimum size, with shelf (Wb 311, every part positive);
  - coffee table, rounded 500 × 400;
  - overhang 0 with apron inset 0, front drawer and left drawer: clean, A 882 / 850;
  - desk default; desk at the maximum 2400 × 780 × 800 with cw 300; desk four_legs with hardware legs.
- **Overlaps found:**
  - dining with 3 front drawers;
  - dining with 2 left drawers;
  - console table: default 1200 × 800 × 400 with 2 drawers, 600 × 350 with 3 drawers, and 1800 × 450 with 3;
  - desk with panel_ends and 2 drawers;
  - desk at the minimum 800 × 450 with panel_ends and 1 drawer;
  - desk with cabinet and top drawer;
  - desk at the minimum with cw 600, shelves and drawer.

  These overlaps are reported as I1 and in the note on the queued fix.
- cabinet_ends with shelves: keys `table.cabinet.shelf.{1,2}` and `table.cabinet.shelf_supports` (SHF-PIN-5 × 8). The door hinges and plates are on `table.cabinet.door.*`.
- Hardware-leg height boundary: tested at Hb 695, 725 (fit) and 694, 726 (mismatch) in `generateTable.test.ts:288-300`.

### 2. Outlines

- The rings are clockwise. The shoelace sum over `[x, z]` is positive for the rectangle, rounded rectangle, circle and ellipse, and the r = 0 rectangle `[W,D] → [0,D] → [0,0] → [W,0]` also gives a positive sum.
- Point counts:
  - the rounded rectangle has `4 × (seg+1)` points, so 36 by default and 20 with seg 4;
  - circle and ellipse have 64 points.
- Every point lies within `[0, W] × [0, D]`. With 64 segments, the 0°, 90°, 180° and 270° points exist, so the ring's bbox equals W × D.
- The part keeps `length` / `width` = W × D for nesting (`generateTable.test.ts:461-486`).
- Round 1000: legs sit in the inscribed square, `min [182, 0, 768]`. The leg corners lie at radius `(W−2o)/2`, which is inside the top.
- Duplicate points at `r = min(W, D)/2`: see Minor finding m3.

### 3. Multi-layer top

- k = 2 for thickness 50 and for 40 (40 also gives the info).
- k = 1 for thickness 10 (gives the info) and for 25 (no info).
- Each layer gets its own `y` in the extruded geometry. Hb = H − k·t_top.

### 4. Connectors

- `connectorsForJoints` merges into an existing `table.connectors.cam` or `.dowel` line (qty and `joints`), `connectors.ts:20-41`.
- Hardware keys are unique in every probe variant and in the test variants (`generateTable.test.ts:1481-1490`).
- Corner brackets: 4 only when the apron is enabled.
- Joints drill the member, which is A in "A ↔ B" (accepted deviation).

### 5. Issues

All table codes and severities match §7.3 (table above). `leg_height_mismatch` carries `entityIds ['table.legs']`.

### 6. Carries

- **`table: null`:** `generate.ts` sets `generated = tableParts(ctx)`, and `tableParts` returns false without a spec. The `overrides.test.ts:358-375` test covers it, including a missing key on the same document with its spec.
- **Shelf keys for the sag rule:** `table.shelf` is clamped, and the 1600 span gives critical (seen in the probe). `table.cabinet.shelf.N` honours the `adjustable` flag (`sag.test.ts`, `generateTable.test.ts:1339`).
- **`thin_carcass` table branch:** `rules/model.ts:88` uses `hasRole('carcass')`. Tests show the trestle gives no warning and four_legs warns.
- **Drawer `entityIds`:** `drawerIssueRef(sectionId, ...keys)` is used for `drawer_too_low` (carcass `[S, section.S.drawer.j]`, table `[table.drawer.j]`) and by `selectSlide` through `drawerKey`. The probe shows distinct `drawer_depth_unused` issues for each under-top drawer.
- **Derived bands per used role:**
  - `codeIssues(…, { bandRoles })` runs after generation and `unshift`s its issues, so the order is kept.
  - Extra parts carry explicit band codes (`overrides.ts:198-203`), so leaving their roles out of `bandRoles` loses nothing.
- **`FurnitureIssueCode`:** `furnitureIssue`, `GenContext.issue` and the `warn` helpers are typed. A `@ts-expect-error` test guards them.

### 7. Determinism

Generating the same document twice (right-hand drawers, stretcher) gave identical `JSON.stringify` output. The outlines round to 1e-6, and the code uses no random or time sources.

### Mutation check (scratch copy, `vitest run resources/js/engine/furniture`, 885 tests)

**Killed (16):**

- side drawer `depthAvail`;
- trestle beam z;
- pedestal side 2 x;
- stretcher dowels;
- modesty z0;
- cabinet bottom z;
- layer faces;
- drawer centring;
- cabinet drawer span;
- top cover −2;
- end joint length;
- runner x;
- knee formula;
- the rounded-thickness info;
- door hinge side;
- side-drawer ModelFront.

**Survived (6):**

- M1: left-frame edge map set to identity;
- M2: `turnParts` skips the `edgeMap` remap;
- M21: radius clamp removed;
- M22: round W ≠ D draws a circle instead of an ellipse;
- M24: cabinet side faces 1 → 2;
- M25: pedestal top plate banded.

The survivors are covered by m1 and m2.

## Strengths

- `Frame` and `tableFrame` compute every §3.13 symbol once, and each base is a small function that follows its spec table row by row. The `panel` and `joint` helpers keep the part specs declarative.
- The side-drawer frame rotation is a proper rotation (determinant +1 for both frames). Building the drawer facing +z and turning it reuses the whole §3.12 box path unchanged, so no second drawer implementation was written.
- The carries are minimal and well-scoped:
  - the `drawersFor` / `shelvesFor` options;
  - `OpeningEdge.cover`, which wins over the overlay rule;
  - `HingeLines`;
  - connector merging instead of a second line;
  - the code check moved after generation and unshifted.
- The tests are strong. Every brief value is pinned, the boundaries are tested (span 2500 / 2501, radius 450 / 451, pedestal 1200 / 1300, knee 550 and 482, leg height ±15), and each variant checks key uniqueness and that parts stay inside the bbox. 16 of the 22 mutants I tried were killed.

## Issues

### Critical (Must Fix)

None.

### Important (Should Fix)

**I1. Under-top drawer runners pass through legs, aprons, end panels and the desk cabinet** (`generateTable.ts:1018-1028`)

The runners are placed outside the slot, at `[x0 − t_c, x0]` and `[x1, x1 + t_c]`, along the full `z [plane − A, plane]`. When the drawers fill their span, which happens whenever `ws < TABLE_DRAWER_MAX_WIDTH`, the outer runners land inside the parts that bound the span. Measured overlaps (x × y × z, mm):

- **Console table template default** (1200 × 800 × 400, 2 drawers, 07 §2.4.17): `drawer.1.runner.left` passes through `table.leg.fl` (18 × 120 × 40) and `table.leg.bl` (18 × 120 × 22). It is mirrored on the right. The 600 × 3 and 1800 × 3 consoles behave the same.
- **Dining table with 3 front drawers:** the runners pass through all four legs (18 × 110 × 35 at the front, × 17 at the back). They also pass 1 mm into `table.apron.left` and `table.apron.right` (1 × 90 × 700).
- **Dining table with 2 left drawers:** the runners pass through `leg.bl` and `leg.fl`, and 1 mm into the front and back aprons.
- **Desk with panel_ends and 2 drawers:** `drawer.1.runner.left` lies entirely inside `table.end.left` (18 × 140 × 560). Likewise on the right.
- **Desk at the minimum width (800) with cabinet 600 and a top drawer:** `runner.right` lies inside `table.cabinet.side.left` (18 × 140 × 392) and passes 16.5 mm into `table.cabinet.door`. `runner.left` lies inside `table.end.left`.

The report lists the runner placement as a deviation, and the controller accepted that list. It does not disclose this consequence. The model's 3D view and cut list then contain parts that cannot physically coexist: a runner glued inside an end panel, or one that would need a notched leg.

The variant test at `generateTable.test.ts:1492-1508` only checks the bbox, so it cannot catch this.

**Fix options**, which may need a spec-19 ruling because 07 §3.13 does not place the runners:

- keep the runners inside the span: shrink the span by `t_c` per side, so `ws` is computed from `span − 2·t_c`;
- or put the runners inside the slot, with `Wo = ws − 2·t_c`;
- or skip a runner where an end, cabinet side or leg already bounds the slot (the slide screws then go to that part).

In every case, add a no-overlap test over the variant list.

**Note on the queued fix ("box depth must fit inside the opposite apron"; not a new finding).** On panel_ends and cabinet_ends, `A = Db − 40` together with `zf = plane − t_f` lets the drawer box pass the modesty panel by 6 mm. The box reaches back to `bz0 + 32`, and the modesty panel occupies z `[bz0 + 20, bz0 + 38]`.

- Measured: `drawer.1.back × table.stretcher.back` 507 × 87 × 6 on the desk with panel_ends; 550 × 87 × 6 on the desk with cabinet and top drawer (study_desk `topDrawer` on cabinet_ends, 07 §2.4.14); 550 × 87 × 6 on the minimum-size desk with panel_ends.
- The queued ruling names only the opposite apron. Please make sure the fix also covers this case: deducting `t_f` from `A` on every base resolves both.

### Minor (Nice to Have)

- **m1. Side-drawer `edgeMap` remap is untested** (`generateTable.ts:907-926`). Mutants M1 (identity edge map) and M2 (no remap) survive. The map is observable: `overrides.ts:114-121` uses it to choose the axis a `lengthDelta` / `widthDelta` override resizes. Add a test that resizes a left-drawer part (for example `table.drawer.1.side.left`, `lengthDelta: −50`) and checks that the box shrinks along x.
- **m2. Some spec-silent choices are untested** (mutants survive):
  - the corner-radius clamp of the outline (`:317`, M21), where an unclamped `r` would put points outside `[0, W]`;
  - the ellipse fallback for round W ≠ D (`:321`, M22);
  - the pedestal top plate being unbanded (`:664-667`, M25, although §5.2 bands only the base plate);
  - cabinet side faces (M24).

  One assertion each would pin them.
- **m3. Duplicate points in `roundedRectOutline` at `r = min(W, D)/2`** (`outlines.ts:57-68`). This is the largest radius that raises no error, and also the value the clamp produces. Corner c's last point then equals corner c+1's first point. For 900 × 900 with r 450, 4 of the 36 points are duplicates, giving zero-length edges in an extruded outline (ExtrudeGeometry and earcut input). Fix: skip a corner's first point when it coincides with the previous corner's last point.
- **m4. `table_drawer_side_unsupported` names `entityIds ['table.drawer']`** (`generateTable.ts:1108-1110`). This is neither a part key nor a hardware key, so the Issues panel focus (§7.1) has nothing to select. Use `[]`, as the other table-level issues do.
- **m5. Silent no-build in the under-top drawers.**
  - `if (ws <= 0) return;` (`:1119`) emits no issue when the drawer count cannot fit the span.
  - A box whose `Win` or `Lb` is ≤ 0 (`canBuild` false) is skipped silently.

  Neither happens with template ranges; it takes non-template dimensions. A warning or error would make it visible.

## Assessment

**Task quality:** Needs fixes

**Reasoning:** The §3.13 formulas, outlines, issues and carries are correct and well tested, and the output is deterministic. However, the under-top drawer runners pass through legs, end panels and the desk cabinet in template-default configurations (console table, desks with drawers), and no test checks parts against each other for overlap. Fix I1, possibly after a spec-19 ruling on runner placement, and extend the queued box-depth fix to the modesty panel.
