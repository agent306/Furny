# Task 34 report: fronts with hinge, flap and handle rules

**Status:** DONE_WITH_CONCERNS (the concerns are minor interpretation choices, listed below)
**Commit:** `e47dee7` feat(engine): generate hinged, flap, glass and sliding fronts with hardware (base `b89824c`, pushed to `origin/build/p2-engine`)

## What I implemented

### `fronts/openings.ts` (07 §4.1)
- Types: `OpeningRect`, `OpeningEdge`, `EdgeClass`, `EdgeName`, `Rect`, `Overlay`.
- `computeOpenings(ctx, env, layout): Map<string, OpeningRect>`.
  - It returns an opening for every front, keyed `fr_…`, in document order. It skips fronts whose `covers` name no laid-out section.
  - Per I4, it also returns an opening for every external drawer leaf, keyed `s_…`, in pre-order. A leaf counts when it has `drawers` content, `behindDoor = false`, and no covering front.
  - Edge classification follows rules 1–3:
    - interior bound → `outer` with `t_c`;
    - a divider face at `c` (partitions for left/right edges, fixed shelves for top/bottom; the largest overlap wins) → `tp` = the divider's thickness;
    - the edge is `shared` if another non-sliding opening has its opposite edge on the divider's other face and overlaps this edge's stretch of the divider, otherwise `divider_open`.
  - Faces match within 0.5 mm, the same tolerance the joints use.
- `coverFor(overlay, cls, tp)` implements the cover table. `frontRect(opening, overlay)` gives `X0/X1/Y0/Y1`.
- `frontCoverageIssues(doc, layout): Issue[]` is pure and pushes nothing to a context, as ruled. It is exported for Task 37.
  - `front_not_rectangle`: the bounding-rect area is compared with Σ covered leaves (each counted once) plus the dividers lying entirely inside the rect.
  - `front_overlap`: raised for each pair of fronts whose leaf sets intersect.

### Leaf generators
- **`fronts/glass.ts`** holds the leaf bodies.
  - `glassFeasible` is called once per front. It raises `glass_door_too_small` (`lw` or `lh` < 220) or `no_glass_material`.
  - `solidLeaf` makes a solid leaf.
  - `glassLeaf` makes two stiles `60 × lh` (grain y), two rails `(lw − 120) × 60` (grain x), and a glass panel `(lw − 106) × (lh − 106)`. The glass uses `idx.glassMaterial()`, has no banding, 0 visible faces, and is centred in the leaf depth.
  - `leafBody` picks between the two.
  - Each `LeafBody` exposes `edgePart(edge)`. Hinge cups go into the hinge-side stile or rail and handle holes into the opposite one.
- **`fronts/hinged.ts`** has `hingedLeaves`, renamed from the brief's `hingedFront` per preflight I3 so the template helper keeps that name.
  - It covers `n` (auto/explicit/>2 → error and 2 leaves), `lw`, the positions, the z range (full/half `[Dc, Dc+t_f]`, inset `[Dc−t_f, Dc]`) and the hinge side.
  - It raises `door_wide { width: fl(share) }`, `door_tall { height }`, `front_too_small` and `door_heavy { kg }` (once per front, heaviest leaf).
  - It writes a model front per leaf: `id` = leaf key, `partKey` = the leaf, or `.stile.left` for glass.
  - It also exports `leafZ` and `checkLeafSize`.
- **`fronts/flap.ts`** has `flapFront`.
  - It makes one leaf with `nameKey parts.flap`, grain x, and raises `flap_leaves_ignored`.
  - Hinges sit on the top or bottom edge class and are counted along the width. It adds `flapMechanism` and raises `flap_heavy`.
  - Handles: `w ≤ 600 ? 1 : 2`, horizontal.
  - Its model front has kind `flap` and no `hingeSide`.
- **`fronts/sliding.ts`** has `slidingFront`.
  - It raises `sliding_front_partial` and then builds nothing. `sliding_leaves_unsupported` raises an error and clamps the count to 2..4.
  - Leaf geometry: `lw`, `lh`, x step `lw − 30`, `y0 = iy0 + 15`, odd leaves on the front track and even leaves on the rear track.
  - Hardware: track sets `ceil(Wo/lengthMm)` with `reasonParams { length }`, rollers × n, handles × n, and none of these when the track code is `null`.
  - It raises `sliding_leaf_narrow`, `door_tall` and `sliding_leaf_heavy`.
- **`fronts/fronts.ts`** has `frontParts(ctx, env, layout)`. This file is a deviation from the brief's file list (see Concerns). It is the pipeline step 3.4 dispatcher: it computes the openings, generates each front by kind, builds only the first sliding front and raises `sliding_front_multiple` naming the extra fronts. It returns the openings, which Task 35's drawer fronts need.

### `rules/hardware.ts` (07 §6.2–§6.4)
- `hingeCount` and `hingeRoleKey` follow the spec.
- `addHardwareLine` uses a code or the role default. When neither exists it raises `no_default_hardware` and omits the line.
- `hingesFor(ctx, front, leaves)` does the primary/shared split.
  - The primary type is the hinge type for an outer edge.
  - A leaf on a shared edge whose code differs from the primary code goes to `.hinges.shared`.
  - Plates are counted for every hinge whose item has no `integratedPlate`.
  - `hingeCode: null` means no hinges, plates or cups.
  - When a role default is missing, it raises one `no_default_hardware` per role per front, and those leaves get no hinges and no cups.
- `flapMechanism(ctx, front, leafWidth)` follows §6.3.
- Handle helpers: `handleCodeFor`, `handleOrientation`, `handleCount`, `frontHandleTarget`, and `handlesFor(ctx, target, code, leaves, orientation)`.
  - `handlesFor` applies the knob fallback (`length + 80 > room` → `knob.default` plus info `handle_replaced_by_knob`).
  - Holes per handle are `specs.holeCount`, or 1 for a knob and 2 otherwise.
  - The signature generalises the brief's `(ctx, frontId, leafRects, orientation)` so that Task 35 can reuse it for `section.{S}.drawer.{j}.handle` lines.

### `rules/weight.ts`
- `partWeightKg(part, idx)` returns the weight of one piece. An unknown material weighs 0.
- `leafWeightKg(parts, idx)` returns Σ weight × qty, so Task 36 can reuse it for the total.
- `roundKg` rounds to 1 decimal.

### Other changes
- `context.ts`: I extracted a pure `furnitureIssue()`, which `ctx.issue` now uses, so `frontCoverageIssues` can build issues without a context.
- `index.ts`: exports `partWeightKg`, `leafWeightKg`, `hingeCount` and `hingeRoleKey`. Per I3, the generators are not exported.
- `testing/docs.ts`: added `frontOn`, `insetBox`, `halfOverlayBox` and `slidingWardrobe` (07 §2.4.2 defaults: 3 columns, plinth 100 with setback 0, HDL-FLUSH handles).
- `testing/carcassRun.ts`: added `runCarcass(…, { fronts })`, `runWithFronts` and `hardwareOf`. Fronts run after the dividers, as in pipeline step 3.4.

## Golden numbers (formula = example; no mismatch)
All of the brief's worked numbers equal the 07 formula outputs:
- **Wardrobe column 1:** opening `x [18,600] y [118,2082]`. The left edge is outer (cv 16.5), the right edge is shared (cv 8). The rect is `1.5 / 608 / 101.5 / 2098.5` and the leaf part is `1997 × 606`.
- **Column 2:** two leaves of 593 × 1997 (`lw = 593.25`).
- **Model rects:** `{1,101,606,1997}` left, `{610,101,593,1997}` left, `{1205,101,593,1997}` right.
- **Hardware lines:** `fr_1`: hinges FO 4, plates 4, handles 1. `fr_2`: hinges FO 4, hinges.shared HO 4, plates 8, handles 2.
- **Operations:** 4 cups and 2 handle holes per leaf.
- **Weights:** 14.159 kg and 13.855 kg, i.e. 14.16 and 13.86.
- **Inset:** leaf 560 × 680 (= 684 − 4), `fz 0`, z `[542, 560]`, HNG-IN-SC.
- **Half overlay:** leaves `[10,599]` and `[601,1190]` (589 each), both HNG-HO-SC.
- **Sliding:** n = 3, `Wo` 2364, `lw` 808, `lh` 1924, x 18/796/1574, z `[626,644]` / `[596,614]` / `[626,644]`, content depth 577. Hardware: TRK × 1, ROL × 3, HDL-FLUSH × 3.
- **Glass on `fr_2`:** stiles 1997 × 60, rails 473 × 60, glass 487 × 1891 GLASS5-CLEAR.

**The only spec/brief inconsistency is the one already ruled (C14).** The brief says a "300-wide glass leaf → `glass_door_too_small`", but the 07 §4.5 threshold is `lw < 2·60 + 100 = 220`, so a 300 mm leaf is a valid glass door. The test uses a 200 mm leaf (box width 203), which gives the error and a solid leaf, and a 220 mm leaf (box 223), which stays glass.

## Tests
New:
- `fronts/__tests__/openings.test.ts`
- `fronts/__tests__/hinged.test.ts` (it includes the flap cases, because the brief lists no `flap.test.ts`)
- `fronts/__tests__/glass.test.ts`
- `fronts/__tests__/sliding.test.ts`
- `rules/__tests__/hardware.test.ts`

Together these are 124 tests covering every case in the brief, plus:
- the `divider_open` edge, a sliding opening never shared, rows/fixed-shelf classification, and `tp` taken from a 25 mm shelf;
- drawer-leaf openings, the auto leaf boundaries (600 / 601 opening) and an explicit hinge code;
- a missing role default, the leaf weight driving the hinge count (25.6 kg → 5), and `flap_heavy`;
- the sliding auto leaf counts, track count 2 at a width of 3600, a null track, `sliding_leaf_heavy` with a mutated roller and `door_tall`;
- glass frame geometry and the glass weight in the hinge count.

### TDD evidence
- **RED:** `yarn vitest run --project engine resources/js/engine/furniture/fronts resources/js/engine/furniture/rules` failed with 5 failed files and no tests run. The errors were `Cannot find module '../fronts/fronts'`, `'../hardware'` and `'../../rules/hardware'`. This was expected because the modules did not exist yet.
- **GREEN:** `yarn vitest run resources/js/engine/furniture/fronts resources/js/engine/furniture/rules` passed: 5 files, 124 tests.
- **Full suite:** `yarn vitest run resources/js/engine` passed: 75 files, 2594 tests. The output is clean.
- **Gates:** `yarn eslint --max-warnings=0 resources/js/engine` (exit 0), `yarn prettier --check resources/js/engine` (all clean) and `yarn vue-tsc --noEmit` (exit 0).

## Files changed
- **Created:**
  - `resources/js/engine/furniture/fronts/{openings,hinged,flap,glass,sliding,fronts}.ts`
  - `resources/js/engine/furniture/rules/hardware.ts`
  - the 5 test files listed above
- **Modified:**
  - `resources/js/engine/furniture/rules/weight.ts`
  - `resources/js/engine/furniture/context.ts`
  - `resources/js/engine/furniture/testing/{docs,carcassRun}.ts`
  - `resources/js/engine/index.ts`

## Concerns and interpretation choices (for the reviewer)
1. **Extra file `fronts/fronts.ts`.** It holds the `frontParts` dispatcher and the `sliding_front_multiple` check, which needs to see every front. Putting it in `openings.ts` would have created an import cycle. Task 36 can call it directly.
2. **`handlesFor` signature differs from the brief.** It is `(ctx, target: HandleTarget, code, leaves: HandleLeaf[], orientation)`. Drawers (Task 35) need different keys and counts, which this form supports.
3. **`front_overlap` params.** `params.frontIds` is the string `"fr_a,fr_b"` because `Issue.params` values must be strings or numbers. Both ids are also in `entityIds`.
4. **Flaps get no `door_heavy` or `door_wide`.** They get `flap_heavy` (> 8 kg) instead, since anything over 22 kg is already over 8 kg. `door_tall` is not checked on flaps either; the spec ties it to doors and sliding leaves.
5. **Warnings are emitted once per front, not per leaf.** This applies to `door_heavy` and `sliding_leaf_heavy` (heaviest leaf) and to the glass errors. Leaves of one front are equal.
6. **Partial sliding front.** A `sliding_front_partial` front builds nothing, with no leaves and no hardware. The spec does not say whether geometry should still be made; hinged >2 leaves does keep its geometry.
7. **Glass leaves.** Hinge cups go into the hinge-side stile (the rail for flaps) and handle holes into the opposite stile or rail. On sliding glass leaves the handle goes on the left stile for leaves `k ≤ ceil(n/2)`, otherwise the right. The spec says only "leaf part"; this choice only affects which frame part carries the operation counters.
8. **`hingeCups` are 0 when no hinge is generated.** This happens with `hingeCode null` or a missing role default.
9. **Reason params.** `hinges_for_door` uses `{ leaves: <leaves in that line> }`. The spec names only "{leaf count}", not the param key. Task 51 lang strings should use `:leaves`.
