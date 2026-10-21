# Task 38 report: table family generator

Commit: 78c331b feat(engine): generate table-family furniture (pushed to origin/build/p2-engine; base d227d13)

## Implemented

- `furniture/table/outlines.ts`
  - Exports `roundedRectOutline(W, D, r, segmentsPerCorner = 8)`, `circleOutline(d, segments = 64)` and `ellipseOutline(W, D, segments = 64)`.
  - Rings are `[x, z]` pairs in table plan coordinates, with `x ∈ [0, W]` and `z ∈ [0, D]`.
  - Rings are clockwise in the top view (z down the screen), so the shoelace sum over `[x, z]` is positive. They start at angle 0 (the +x end) and do not repeat the first point.
  - A rounded rectangle has `4 × (seg + 1)` points (36 by default). With `r <= 0` it gives the 4 rectangle corners.
  - Coordinates are rounded to 1e-6 mm to absorb trigonometric noise.
- `furniture/table/generateTable.ts`: `tableParts(ctx): boolean` implements 07 §3.13. It returns false when nothing was generated (see deviations). It builds:
  - **Top:** k layers (`table.top`, `table.top.layer.{m}`). Info `table_top_thickness_rounded` when the thickness is rounded.
    - Geometry: rectangle is a box. `rounded_rectangle`, `round` and `oval` are extruded outlines (`plane 'xz'`, `y` = layer bottom, `thickness` = t_top) on every layer.
    - `round_top_not_square` and `corner_radius_too_large` are errors. The radius check applies only to `rounded_rectangle`.
    - Footprint: inscribed square or rectangle for round and oval tops, except on pedestals.
  - **`four_legs`:**
    - Solid legs, or `table.legs × 4` (`leg.table`) with `legFitsHeight` against Hb, giving `leg_height_mismatch`.
    - Info `leg_section_mismatch`.
    - Aprons, skipped on the drawer side, with `table.connectors.corner × 4`.
    - Stretchers and the lower shelf.
    - `table.connectors.dowel`: 4 per generated apron, 4 per stretcher, 8 for the shelf.
    - `table_span_long`.
  - **`panel_ends`:** ends, modesty panel and lower shelf, with the joints of the spec.
  - **`trestle`:** upright, foot and cleat per side, plus the centre stretcher. Cams 4, dowels 8.
  - **`pedestal`:** sides 1 to 4, base plate and top plate. `pedestal_unstable` when `max(W, D) > 1200`.
  - **`cabinet_ends`:**
    - End on the left, cabinet on the right: sides, bottom and inset back.
    - Joints: cabinet sides to the bottom and to the top, end to the top.
    - Content: drawers through `drawersFor` with key prefix `table.cabinet.drawer` and an explicit opening whose top edge has cover −2. Shelves through `shelvesFor` with keys `table.cabinet.shelf.{i}` and `table.cabinet.shelf_supports`, plus the door `table.cabinet.door`. Empty is allowed. Any other content is error `cabinet_content_unsupported`.
    - `knee_space_narrow { width }` and the modesty panel `[bx0 + t_c, cx0]`.
  - **Under-top drawers:**
    - Allowed on four_legs (any side), and on panel_ends and cabinet_ends (front only). Any other case is error `table_drawer_side_unsupported`.
    - Spans, `fh`, `ws`, centring and `depthAvail` follow §3.13.
    - Each drawer has a front (flush with the face plane), runners `depthAvail × (fh + 20)`, and a box per §3.12 (`selectSlide`, `boxSizes`, `drawerBox` with the runners as slide-screw verticals).
    - Handles use `defaultHardware('handle.default')`. A missing handle default gives `no_default_hardware`.
    - Left and right drawers are built facing +z, then turned about y (box and `edgeMap` remapped; length, width, edges and grain are unchanged).
  - **Last:** `connectorsForJoints(ctx, 'table')` and `screwPacks(ctx, 'table')`. No §6.8 hardware.
- `generate.ts`: step 4 calls `tableParts`. For the table family, `generated` is the result, so `table: null` (or nothing generated) suppresses `override_orphaned`, the same as `carcass: null`.
- `index.ts`: exports `tableParts`, the three outline functions, `DrawerLeafOptions` and `CodeIssueOptions`.

## Carries

1. **Connectors.** `connectorsForJoints` adds to an existing `{family}.connectors.cam` or `.dowel` line (qty and the `joints` reason param) instead of pushing a second line.
   - A unit test merges into pre-existing table lines, and each key appears once.
   - In the table tests, every variant (dining with all extras, trestle, desk, desk with shelves and drawer, panel ends with shelf and drawers) has unique part and hardware keys.
2. **Table drawer openings.**
   - `drawersFor(ctx, env, layout | null, leaf, content, options)`. `options` carries `{ keyPrefix, opening, handleCode, inSection }`. The 6th positional `keyPrefix` became an option, and its one test was updated.
   - External drawers use `options.opening`, else `openingsOf(...)`. With neither, it still throws (no silent fallback; the existing throw test is unchanged).
   - `OpeningEdge.cover?` is a fixed cover that wins over the overlay rule in `frontRect`. It is used for the desk cabinet top edge (−2) and has its own unit test.
   - `shelvesFor` takes `{ keyPrefix, inSection }`. `boundingVerticals` also accepts `table.cabinet.side.*`.
   - `hingesFor` takes `{ base, frontId }` for the `table.cabinet.door.*` lines.
   - The drawer internals `drawerBox`, `boxSizes`, `LeafBoxes` and `drawerIssueRef` are exported for the under-top drawers.
3. **`table: null`.** New tests in `overrides.test.ts` cover the carcass family with `carcass: null` and the table family with `table: null` (no orphans, extras still added). They also check that the same table document with its spec reports a missing key.
4. **Task 37 keys.**
   - Confirmed: the lower shelf is `table.shelf`. With four legs it is clamped: span 1600 gives `shelf_sag_critical` (limit 1500), and span 1200 gives nothing.
   - Confirmed: cabinet shelves are `table.cabinet.shelf.N`, and the content's `adjustable` is honoured. Adjustable 962 gives `shelf_sag`; fixed 964 gives nothing.
   - `thin_carcass` with a 12 mm carcass board: a four-legs table (aprons have the carcass role) warns, and a trestle table (no carcass parts) does not.
   - No side needed adjusting.
5. **Task 37 minors.**
   - **M2:** `drawer_too_low` entityIds are `[sectionId, 'section.S.drawer.j']` for the carcass and `['table.drawer.j']` or `['table.cabinet.drawer.j']` for tables. `selectSlide` takes `drawerKey`, so per-drawer slide issues of under-top drawers stay distinct.
     - Test: 4 behind-door drawers in a 300 mm section give 4 issues through `validateFurniture`.
     - Table test: 3 short under-top drawers give 3 issues.
     - The existing drawer test now expects the drawer keys.
   - **M3:** `codeIssues(doc, idx, { bandRoles })` restricts derived default bands. `generateFurniture` now runs the code check after the parts are generated, with the roles of the generated parts, and `unshift`s the issues so they stay first.
     - Test: an archived EB20-WHITE on the top role is not reported for a box without a countertop, and is reported with one.
     - Direct `codeIssues` without options still checks every role.
   - **M4:** tests added for each survivor:
     - trim (a 2430 side is flagged);
     - extra back part flagged;
     - unknown `materialCode` on a part uses the role material (crafted `modelRules` context);
     - direct `codeIssues` cases: misused slide once per code, derived band not repeated when explicit, derived dedupe, unknown-material fallback;
     - endCabinets slide code (explicit SLD-BB-350 kept);
     - `thin_carcass` table branch;
     - shelf guard at exactly zero width (2 mm leaf: error, no part; 3 mm: a 1 mm shelf);
     - sag span floor vs round (800.6: none; 801.2: `shelf_sag`).
   - **M5:** `furnitureIssue(code: FurnitureIssueCode, …)` and `GenContext.issue(code: FurnitureIssueCode, …)` (type import from `validate.ts`). The `warn` helpers in hinged, sliding and contents are typed. A test uses `@ts-expect-error` for bad codes, so vue-tsc enforces it.

### Mutation check (scratch, restored, deleted)

12 mutants were all killed:

- trim → 0;
- skip all backs;
- drop "once per code";
- drop "not repeated when explicit";
- drop the derived dedupe;
- drop the unknown-material fallback;
- `<= 0` → `< 0`;
- floor → round;
- `ctx.mat(part.role)` → `ctx.mat('back')`;
- disable the connector merge;
- drop `bandRoles`;
- force `generated = true` for tables.

## Brief values vs formulas

Every brief value matched the 07 §3.13 formulas; there were no conflicts.

- **Dining:** Tt 25, Hb 725, Wb 1700, Db 800.
- **Dining parts:**
  - `table.leg.fl`: x [50,100], z [800,850], 725 × 50, thickness 50, grain length.
  - Front apron: 1600 × 90, z [817,835]. Left apron: 700 × 90, x [65,83].
- **Dining hardware:** corner × 4, dowels 16, screws 1.
- **Hardware legs:** LEG-TBL-710 × 4, s = 60. Hb 725 gives no warning; Hb 760 gives a warning. The tested boundary is Hb 695..725.
- **Options:** stretchers at y [150,210], dowels +12. Shelf at y [100,118], +8.
- **Round 1000:** Wb = 636, legs at bx0 182.
- **Desk:**
  - `table.end.left`: 725 × 600.
  - Cabinet side: 725 × 582.
  - Fronts: 397 wide, X [801.5, 1198.5], top 723.
  - Slides: SLD-BB-550 × 3.
  - Modesty: 782 × 362.
  - Knee space: 782 with no warning. A 700 cabinet gives 482.

## TDD evidence

**RED** — command: `yarn vitest run resources/js/engine/furniture`. Before any implementation, 7 files and 8 tests failed:

```
 FAIL  generateTable.test.ts  Error: Cannot find module '../generateTable'
 FAIL  carcassHardware.test.ts > merges into existing table connector lines: each key once (Task 38 carry 1)
   AssertionError: expected [ 'table.connectors.dowel', …(3) ] to deeply equal [ 'table.connectors.dowel', …(1) ]
 FAIL  catalogDrift.test.ts > checks derived bands only for the roles in bandRoles (Task 37 M3)
   AssertionError: expected [ { code: 'EB08-WHITE', …(1) } ] to deeply equal []
 FAIL  catalogDrift.test.ts > generation checks the default band of a role no part uses: never (Task 37 M3)
   AssertionError: expected [ { code: 'EB20-WHITE' } ] to deeply equal []
 FAIL  overrides.test.ts > reports no orphaned overrides for a table document without its table spec (carry 3)
   AssertionError: expected [ { …(5) }, { …(5) } ] to deeply equal []
 FAIL  validate.test.ts > keeps four drawer_too_low issues for four short drawers
   AssertionError: expected [ { sectionId: 's_0000000001', …(1) } ] to deeply equal [ { …(2) }, … ]
 FAIL  contents.test.ts > an adjustable shelf in a 2 mm leaf … (Task 37 M4)   (shelvesFor had no options: key 'test.shelf.1' absent)
 FAIL  drawers.test.ts > reports drawer_too_low … ([ROOT] lacks the drawer key)
 FAIL  drawers.test.ts > uses an explicit key prefix … (options object not supported yet)
```

These failures were expected: the table modules did not exist, the merge, bandRoles, drawer-key, options and table-null behaviours were not implemented, and the orphans came from the unimplemented `generated` for tables. The other M4 tests target mutants of correct code, so they passed on RED. The mutation run above shows they kill those mutants.

**GREEN:**

- Command `yarn vitest run resources/js/engine`: Test Files 86 passed (86), Tests 3042 passed (3042). The output is clean.
- Gates: `yarn eslint resources/js/engine` exit 0, `yarn prettier --check resources/js/engine` exit 0, `yarn vue-tsc --noEmit` exit 0.

## Files changed

**New:**

- `furniture/table/generateTable.ts`
- `furniture/table/outlines.ts`
- `furniture/table/__tests__/generateTable.test.ts` (outlines, all bases, shapes, thickness, drawers incl. side drawers, cabinet contents, key uniqueness, bbox fit, overrides, envelope guard)

**Modified source:**

- `generate.ts`
- `carcass/drawers.ts`
- `carcass/contents.ts`
- `fronts/openings.ts`
- `rules/hardware.ts`
- `rules/connectors.ts`
- `codes.ts`
- `context.ts`
- `types.ts`
- `fronts/hinged.ts`, `fronts/sliding.ts` (typed `warn`)
- `index.ts`
- `testing/docs.ts`: `diningTableSpec`, `studyDeskSpec`, `tableDocument`, `diningTable`, `studyDesk`

**Modified tests:**

- `carcassHardware.test.ts`
- `catalogDrift.test.ts`
- `context.test.ts`
- `overrides.test.ts`
- `validate.test.ts`
- `contents.test.ts`
- `drawers.test.ts`
- `openings.test.ts`
- `model.test.ts`
- `sag.test.ts`

## Deviations and decisions to log (spec 19)

- **`tableParts` returns `boolean`** (the brief says `void`). It returns false without a table spec or when nothing fits. The pipeline needs this for the orphan rule.
- **Too-small table.** When `Wb <= 0`, `Db <= 0` or `Hb <= 0`, generation emits error `furniture.envelope_too_small` and builds no parts; 07 §3.13 defines no table guard. Inside the generator, a panel whose box floors to a size <= 0 is not built.
- **Joint member and length.** In "A ↔ B", A is the member (drilled) and the length is A's depth or height, following the panel_ends lengths. Cabinet side ↔ bottom and top use Dk.
  - The cabinet_ends modesty panel joins `end.left` and `table.cabinet.side.left`. This extends the panel_ends rule.
- **Under-top drawer geometry.** None of these placements is fixed by the spec:
  - The front is at `y [Hb − fh, Hb]`, with its outer face on the plane. The plane is the apron outer face for four_legs (`bz0+Db−inset`, `bx0+inset`, `bx0+Wb−inset`) and `bz0 + Db` for the ends.
  - Runners sit outside the slot (`[x0 − t_c, x0]`, `[x1, x1 + t_c]`) at `z [plane − A, plane]`.
  - The box front is at `plane − t_f`, and `A = depthAvail` literally, without deducting `t_f`. A box can therefore reach up to `t_f − 10` mm past the opposite apron's inner face when the slide exactly fills `A − 10`.
- **Side drawers** (left and right on four_legs) get no `ModelFront`. The elevation is x/y only, and the 3D animation has no side direction. This needs a UI decision.
- **Trestle and pedestal with `storage.drawers`** give error `table_drawer_side_unsupported`, even for `front` (the spec does not allow them).
  - `lowerShelf` is ignored on trestle, pedestal and cabinet_ends, and `stretcher` is ignored on pedestal; §3.13 defines none of these.
  - `cabinet_ends` without `endCabinets` is built as `panel_ends`.
- **Unspecified roles and faces:**
  - Cabinet sides: faces 1, like carcass sides.
  - Cabinet bottom and back: 0.
  - Pedestal plates: role carcass, grain x, faces 0; the top plate is unbanded.
- **`round` with W ≠ D** reports the error and draws the ellipse W × D, so the top stays inside the bbox. A corner radius above the limit is clamped to `min(W, D)/2` for the outline.
- **Desk cabinet door:** no `front_too_small` or `door_heavy` checks (they take a `Front`). Hinges use `hinge.full_overlay` (edge class outer); the handle uses `handle.default`, vertical.
- **Table-cabinet issues** (`shelves_dont_fit`, slide issues) carry no `sectionId`, and their hardware lines have `sectionId: null`.
- **Trestle connector reason params:** cam `{ joints: 2 }`, dowel `{ joints: 4 }`. Four_legs dowels use `{ joints: qty / 2 }`.
- **The code check runs after generation** and its issues are unshifted, so the issue order is unchanged.

## Self-review

- I read the diff.
- Two problems found and fixed:
  - The purity test flagged a doc comment containing the forbidden pattern; I reworded it.
  - Some test values I first derived by hand were wrong (drawer centring, the centre stretcher's z, the bottom edge id, side-drawer z). I recomputed them from the formulas before the GREEN run; none were tuned to fit the output.
- No spec files were edited. The mutation scratch directory and the RED capture were deleted.

## Concerns

- **File size.** `generateTable.ts` is 1164 lines after prettier (about 830 as written). It holds the top, five bases, the cabinet content and the under-top drawers. I did not split it, as the instructions require; a split would follow the bases (for example `table/bases.ts` and `table/drawers.ts`) if the controller wants one.
- **Spec-silent placements.** The under-top drawer placement and side-drawer handling listed above are my readings where 07 says nothing. They are tested, but they should be logged or confirmed.
- **API change.** The `drawersFor` signature changed: the 6th positional `keyPrefix` became an options object. The only callers were inside the engine and its tests.

## Fix round 1

Commits (pushed to origin/build/p2-engine):

- 5402a1f refactor(engine): split the table generator into focused modules. Moved code only, no behaviour change. The full engine suite passed unchanged (3042/3042) before the commit.
- 1559fb2 fix(engine): keep table drawer runners inside the drawer bay

### File split (queued)

`table/generateTable.ts` is now only the `tableParts` orchestration (58 lines). The rest moved into focused modules:

| File | Lines | Contents |
|---|---|---|
| `table/frame.ts` | 216 | `Frame`, `tableFrame`, `span3`, `panel`, `joint`, `drawerSideOf` |
| `table/top.ts` | 56 | top layers and outlines |
| `table/bases.ts` | 360 | `four_legs`, `panel_ends`, `trestle`, `pedestal`, end and modesty panels |
| `table/cabinet.ts` | 211 | `cabinet_ends` and its content |
| `table/drawers.ts` | about 330 | under-top drawers, side frames |
| `table/hardware.ts` | 35 | `table.connectors.*` lines |
| `table/outlines.ts` | unchanged | |

### I1: runners overlapping other parts (controller ruling)

**What changed:**

- `DrawerRow.span` became `bay`, the clear span between the inner faces that bound the drawers at their height and depth:
  - `four_legs`: `max(s, apron.enabled ? inset + t_c : 0)` in from each end of the bay. The legs count whether solid or hardware.
  - `panel_ends`: the end panels, `[bx0 + t_c, bx0 + Wb − t_c]`.
  - `cabinet_ends`: `[bx0 + t_c, cx0]`.
- The drawers share `[bay0 + t_c, bay1 − t_c]`, which leaves room for one runner per side. Each drawer's runners stand directly beside its slot. When the drawers fill the bay, the outer runners lie against the bay faces.
- The spacing between drawers is `max(TABLE_DRAWER_SPACING, 2·t_c)`, so neighbouring runners never cross. This changes nothing for 18 mm board.
- When `ws` is capped at 600, the runners hang beside the drawer. They are not pushed out to the bay faces, because the slides mount on them.
- Effect on the tests: one drawer on dining, panel ends and desk cabinet is unchanged (x 600, 300, 109). Dining with 3 front drawers is now ws 488 at x 118, 656 and 1194; its runners are at 100 and 1682 (legs at 100 and 1700).

**No-overlap helper:** `furniture/testing/overlaps.ts` provides `partOverlaps(parts, { tolerance = 0.5, ignore = sameDrawerBox })`. It returns `"a x b: dx x dy x dz"` for every pair of box parts that intersect by more than 0.5 mm on all three axes. Parts of one drawer box (sides, back, bottom) interlock by construction (the bottom sits in its grooves) and are skipped.

**Applied to:** every table variant (`it.each`, 20 variants). These include:

- the review's cases: console 1200 × 800 × 400 with 2 drawers, 600 × 350 with 3, and 1800 × 450 with 3; dining with 3 front drawers; a panel_ends desk with 2 drawers; an 800 × 450 panel_ends desk with 1 drawer; an 800 desk with a 600 cabinet and a top drawer; an 800 × 450 desk with a 600 shelves cabinet and a drawer;
- dining with 2 left drawers and a stretcher, and dining with 3 right drawers on hardware legs;
- a round 500 coffee table with a shelf, a round 1300 pedestal, and a 2400 × 780 × 800 desk with a 300 cabinet and 3 drawers.

**Box depth (queued plus the review note):** the box now gets `available = depthAvail − t_f` on every base, so `maxLen = depthAvail − t_f − 10`. The runners still span `depthAvail`.

- Dining, 1 front drawer: `drawer_depth_unused` is now `unused: 124` (was 142); the slide is still 600.
- Panel ends and desk drawer: SLD-BB-500 (was 550).
- The variant "dining 1800 × 758, 1 front drawer" (A 610) and the 800 × 450 panel-ends desk catch the old rule: without the deduction, the drawer back, bottom and side intersect `table.apron.back` by 8 mm, and the box intersects the modesty panel.

### Minors

- **m1:**
  - A test reads `ctx.edgeMap` for left and right drawers. For the left drawer, the front's W1/W2 are back/front and the box side's W1/W2 are left/right.
  - A second test resizes turned parts with overrides. On a left drawer, `side.left` with lengthDelta −50 and widthDelta −10 gives size [550, 60, 12], and the front with lengthDelta −100 gives [18, 90, 500]. The right drawer gives the same.
- **m2:** pinned:
  - the radius clamp: r 5000 gives `roundedRectOutline(1800, 900, 450)`, with every point inside the top;
  - round W ≠ D draws `ellipseOutline(W, D)`;
  - the pedestal top plate is unbanded with faces 0;
  - the cabinet side, side, bottom and back faces are [1, 1, 0, 0].
- **m3:** `roundedRectOutline` drops a point equal to the next one (including across the wrap). 900 × 900 with r 450 gives 32 points, 1800 × 900 with r 450 gives 34, and r 449 gives 36. There are no repeats, and the ring is still clockwise.
- **m4:** `table_drawer_side_unsupported` now has params `{}` and entityIds `[]`, like the other table-level issues.
- **m5:**
  - **Box too short:** `Ls > 0` with `Lb <= 0` (an undermount slide shorter than its length deduction) emits error `furniture.drawer_no_slide { availableDepth }` with entity `table.drawer.j`. It is the closest §7.3 code: the depth does not take a usable slide. The test uses a catalog where SLD-UM-350 has `lengthDeductionMm` 400.
  - **Too narrow:** no §7.3 code fits drawers too narrow for the bay (`ws <= 0`) or a box whose inner width is `<= 0` (`Win <= 0`). `drawer_too_low` is about height, and `section_too_small` is save-blocking and section-only. I did not invent a code, so these cases stay silent. A test pins that `ws <= 0` (an 1800 → 200 wide dining table) builds no drawer parts. This needs a controller decision: a new code via spec 19, or accept.

### Found while testing (needs a ruling)

The 07 §3.13 apron formulas intersect at the back corners when `inset + t_c > s`. Example: hardware leg LEG-CAB-ADJ (s 40) with inset 30 gives `apron.back × apron.left` 8 × 90 × 8 mm. The front aprons do not meet like this, because the front apron's z range lies outside the side aprons' `[bz0+s, bz0+Db−s]`. It is the reverse case of the drawer bay. The drawers are clear, and the test pins these two apron overlaps explicitly instead of ignoring them. A spec-19 ruling is needed, for example ending the front and back aprons at `max(s, inset + t_c)`, or clamping the inset.

### Test evidence

**RED for I1 and box depth:** command `yarn vitest run resources/js/engine/furniture/table`, run with the new tests against the pre-fix `table/drawers.ts` (the split version). 15 tests failed: the 3-drawer positions, unused 124, panel-ends slide 500, `table_drawer_side_unsupported` `entityIds`, and the no-overlap assertion on 11 variants (both consoles' cases, dining 3 front and 2 left, both panel-end desks, both 800 desks with cabinets, the dining 3-drawer variant with stretcher and shelf, and the desk with shelves and a drawer). The two depth variants also failed specifically on `table.apron.back × table.drawer.1.*` (8 mm) and the modesty panel when only the `t_f` deduction was reverted.

**Mutation check** (scratch, restored, deleted). All 15 mutants were killed. The last two survived the first pass, and the tests "side aprons reaching past thin legs" and "keeps neighbouring runners apart" were added for them:

- identity left-frame edge map;
- no edgeMap remap;
- radius clamp removed;
- circle for W ≠ D;
- cabinet side faces 2;
- pedestal top plate banded;
- outline dedupe removed;
- `available = A`;
- no runner allowance in the span;
- `table_drawer_side_unsupported` entity restored;
- `drawer_no_slide` check removed;
- bay ignoring the aprons;
- spacing without `2·t_c`.

**GREEN:**

- `yarn vitest run resources/js/engine`: Test Files 86 passed (86), Tests 3096 passed (3096).
- `yarn eslint resources/js/engine`: exit 0.
- `yarn prettier --check resources/js/engine`: exit 0.
- `yarn vue-tsc --noEmit`: exit 0.

### Files changed in round 1

- `table/*` (split; `drawers.ts` and `outlines.ts` fixed)
- `table/__tests__/generateTable.test.ts`
- new `testing/overlaps.ts`

## Fix round 2

Commit 85921ce fix(engine): clamp table apron insets and report drawers that do not fit (pushed to origin/build/p2-engine).

### Spec 19 additions (controller rulings; log in 19)

1. **`furniture.table_drawers_dont_fit`**: warning, params `{ available, required }` in mm, `entityIds ['table.drawer']` (the drawer group key).
   - **When:** the under-top drawers of the row are skipped when `ws < wsMin`, which covers both cases in the ruling: a bay too narrow, and a box with no inner width.
   - **`wsMin`:** the narrowest whole-mm opening whose box keeps an inner width of at least 1 mm with the row's slide. It is computed by the new `minDrawerOpening(ctx, slide)` in `carcass/drawers.ts`:
     - side mount: `ceil(2 × clearancePerSide + 2·t_db + 1)`, which is 51 for bb45 with 12 mm sides;
     - undermount: `innerWidthDeduction + 1`, which is 43.
   - **The slide:** the one every drawer of the row gets (same depth and code). It is selected once for the check; its issues are still recorded per drawer.
   - **`available`:** `fl(bay width)` between the bounding inner faces.
   - **`required`:** `2·t_c + k·wsMin + (k − 1)·spacing`.
   - **Effect:** a box with no inner width can no longer be skipped silently (the round-1 m5 gap). The `ws <= 0` case is included.
2. **`furniture.apron_inset_clamped`**: info, params `{ requested, applied }`, `entityIds []`.
   - **When:** on `four_legs` with the apron enabled and `inset + t_c > s`.
   - **Clamp:** the inset becomes `max(0, s − t_c)`. It is computed once in `tableFrame` (`Frame.apronInset`) and used by the aprons and by the drawer row (face plane, `depthAvail`, bay).
   - **Result:** the round-1 apron-corner overlap is gone. The test now asserts no overlaps with no exceptions (`partOverlaps` equals `[]`).
   - **Remaining case:** for legs thinner than the apron board (`s < t_c`), the formula gives inset 0. The aprons then still cross by `(t_c − s)²` at the back corners. This follows from the ruling's formula; the test covers only the bay (runners at or beyond the apron face) and the info issue.

Both codes are appended after `part_exceeds_sheet_back` in `FURNITURE_ISSUE_CODES` (71 codes). The list test now checks the last four entries.

**English messages:** the repo has no English issue-message map yet (no `resources/lang`, no engine map; only the `messageKey` derivation exists). Task 51 should add these, matching the style of 07 §7.3:

- `table_drawers_dont_fit`: "The drawers need {required} mm between the legs or panels; there are {available} mm."
- `apron_inset_clamped`: "Apron inset reduced from {requested} to {applied} mm to fit the legs."

### Tests

**New or changed in `generateTable.test.ts`:**

- **Clamp:**
  - LEG-CAB-ADJ (s 40) with inset 30 is clamped to 22; the info issue is checked exactly.
  - The left apron is at x 72 and z 90, the back apron at z 72, and the drawer front plane at z 810.
  - The runners are at or beyond 90, and there are no overlaps at all.
  - Inset 22 (exactly `s − t_c`) is not clamped, and the dining default is not clamped.
  - s 10 with inset 5 gives `{ requested 5, applied 0 }`, and the bay starts at the apron face (68).
- **`table_drawers_dont_fit`**, all exact:
  - W 200 gives `{ available 0, required 87 }`, and no drawer parts are built.
  - W 286 gives `{ 86, 87 }`. W 287 has no issue, and the box back is 1 mm wide.
  - 3 drawers at W 488 give `{ 288, 289 }`; W 489 has no issue.
  - Undermount SLD-UM-450 at W 278 gives `{ 78, 79 }`; W 279 has no issue.
- The round-1 test "drawers that cannot fit the bay at all build nothing" is replaced by the `dont_fit` test.

**`validate.test.ts`:** the code count is 71, and the last four codes are checked in order.

**RED:** command `yarn vitest run resources/js/engine/furniture/table resources/js/engine/furniture/__tests__/validate.test.ts`, run before the implementation:
```
   × FURNITURE_ISSUE_CODES (07 §7.3) > lists the 69 codes of the catalogue in table order, then the 2 spec-19 additions, without duplicates 10ms
   × under-top drawers on four legs > clamps the apron inset to s - t_c when inset + t_c > s, so the aprons never cross 11ms
   × under-top drawers on four legs > legs thinner than the apron board: inset 0, the bay starts at the apron face 2ms
   × under-top drawers on four legs > warns table_drawers_dont_fit when the bay cannot take the drawers, and builds none 1ms
   × under-top drawers on four legs > measures the undermount minimum by its inner width deduction (42 + 1) 1ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 5 ⎯⎯⎯⎯⎯⎯⎯
 Test Files  2 failed (2)
      Tests  5 failed | 220 passed (225)
```
One expectation, the width rather than the length of the 1 mm box back, was corrected before the implementation.

**Mutation check** (scratch, restored, deleted). All 6 mutants were killed:

- no clamp;
- `>` changed to `>=` in the clamp test;
- `ws < wsMin` changed to `ws <= 0`;
- side-mount minimum without the +1;
- undermount minimum without the +1;
- drawer row using the unclamped inset.

**GREEN:**

- `yarn vitest run resources/js/engine`: Test Files 86 passed (86), Tests 3098 passed (3098).
- `yarn eslint resources/js/engine`: exit 0.
- `yarn prettier --check resources/js/engine`: exit 0.
- `yarn vue-tsc --noEmit`: exit 0.

### Files changed in round 2

- `validate.ts` (2 codes)
- `carcass/drawers.ts` (`minDrawerOpening`)
- `table/frame.ts` (`apronInset`, clamp issue)
- `table/bases.ts`, `table/drawers.ts` (clamped inset, `dont_fit`)
- `__tests__/validate.test.ts`
- `table/__tests__/generateTable.test.ts`
