# Task 34 review: fronts, hinge/flap/handle rules, leaf weights (b89824c..e47dee7)

### Spec Compliance

- ✅ **Spec compliant.** I checked against 07 §4.1–§4.3, §4.5–§4.6, §6.1–§6.4, §6.10, §7.3, §12.2 and §12.4, and against the brief's file list.
  - Every listed file has its hunk:
    - `openings.ts`, `hinged.ts`, `flap.ts`, `glass.ts`, `sliding.ts`;
    - `rules/hardware.ts`, `rules/weight.ts`;
    - the 5 test files.
  - `fronts/fronts.ts` and the `furnitureIssue` helper are extra, but the controller ruled both acceptable.
- ⚠️ **Cannot verify from the diff (later tasks):**
  - `frontParts` is not yet called from `generateFurniture` (Task 36).
  - `frontCoverageIssues` is not yet called from `validateFurniture` (Task 37).
  - Hinge positions and cup offsets (§6.2 "Positions") and handle placement (§6.4, 3D only) are not produced here. They belong to the 3D and production-sheet tasks.
- ⚠️ **Spec-literal behaviours the controller may want to confirm.** The code is correct to the spec in each case; I built every case in scratch.
  1. **Grid layout.** Root `rows`, each row split into `columns`, and a door covering the left column of both rows. This raises `front_not_rectangle`.
     - Cause: the full-width fixed shelf is not "entirely inside" the bounding rect (§4.1). It is the literal rule, but it rejects a door shape a user could reasonably expect to be allowed.
  2. **A 2-leaf front with both hinge edges shared** (the middle column between two doored columns). It gets only `front.F.hinges.shared HNG-HO-SC 10` and no `front.F.hinges` line.
     - §6.2 defines `.hinges` as the leaves on the primary (outer/divider_open) type, so this is correct, but downstream consumers must not assume `.hinges` exists.
  3. **Mixed overlays across one partition** (full next to inset). The full door's edge is `shared`, so it gets `cv 8` and a cranked `HNG-HO-SC`, even though the inset neighbour never uses the other half of the partition face.
     - §4.1 classifies by "another opening", not by the neighbour's overlay.

### Strengths

- **The §4.1 cover table is exact** (`openings.ts:141-147`). The test covers all 9 overlay × class cells plus 2 non-18 tp values (`openings.test.ts`, `coverFor` table).
- **Edge classification follows rules 1–3 faithfully** (`openings.ts:168-226`):
  - the divider's opposite face is matched;
  - the largest overlap wins;
  - shared requires a non-sliding opening on the other face, overlapping the divider stretch this edge actually lies on.
- **Scratch scenarios all came out right.** Each hand computation matched:

  | Scenario | Result |
  |---|---|
  | 3-column 1800 wardrobe, overlays full / half / inset | gaps of 2 mm at 602/604; the inset door starts at 1208 |
  | fixed shelf with a front on the top row only | `divider_open`, cv 16.5, Y0 865.5 |
  | `flap_up` over a door across a fixed shelf | both `shared`, flap Y0 874 / door Y1 872 |
  | nested covers `[s3, s4]` | rect = s3, no coverage issue |
  | `[s3]` vs `[s5]` (s5 is a descendant of s3) | `front_overlap` |
  | non-adjacent covers | `front_not_rectangle` |
  | door of 22.007 kg | `door_heavy` with kg 22 |
  | `flap_up` 1200 × 300 | hinges 3 (by the width 1197, not the height or weight) |

- **The §12.2 golden values are pinned exactly** (`hinged.test.ts:58-180`):
  - rect `1.5/608/101.5/2098.5`;
  - parts 606 / 593 × 1997, banded on all four edges;
  - model rects, hardware lines `FO 4 / HO 4 / plates 8`;
  - 4 cups and 2 holes per leaf;
  - 14.16 / 13.86 kg.
- **The primary/shared hinge split** (`rules/hardware.ts:131-200`):
  - uses the code comparison from the spec;
  - counts plates per hinge item's `integratedPlate`;
  - `hingeCode: null` skips hinges, plates and cups;
  - a missing role default gives one warning per role per front, and those leaves get no cups.
  - On the fixture, only `fr_2.leaf.1` (hinged on the shared partition) gets `HNG-HO-SC`. `fr_1` hinges left on the outer side and gets `HNG-FO-SC`.
- **Weights.**
  - `partWeightKg` = density × length × width × thickness / 1e9, using `idx.densityOf` (`rules/weight.ts:29-39`).
  - The `DEFAULT_DENSITY` table matches §6.1.
  - The glass leaf weight includes frame + glass, and that weight drives the hinge count (`glass.test.ts`, "counts hinges from the frame + glass weight").
- **Sliding geometry is pinned.** The test asserts box coordinates for all 3 leaves (x 18/796/1574, z 626/596/626) (`sliding.test.ts:62-75`), so the odd/even track assignment and the 30 mm overlap step are verified.
- **Issue severities and params match §7.3 for every code emitted.** Errors:
  - `front_not_rectangle`, `front_overlap`, `front_too_small`, `hinged_leaves_unsupported`;
  - `sliding_front_partial`, `sliding_front_multiple`, `sliding_leaves_unsupported`;
  - `glass_door_too_small`, `no_glass_material`.

  Warnings: `door_wide {width}`, `door_tall {height}`, `door_heavy {kg}`, `flap_heavy {kg}`, `flap_leaves_ignored`, `sliding_leaf_narrow`, `sliding_leaf_heavy {kg}`, `no_default_hardware {roleKey}`.

  Info: `handle_replaced_by_knob {frontId}`.

- **Mutation check** (scratch copy, deleted afterwards). These mutants were killed:
  - divider_open treated as shared;
  - sharing a divider with a sliding opening;
  - shared split ignoring the code;
  - dividers dropped from the area sum;
  - the `flap_heavy` threshold;
  - swapped sliding tracks;
  - knob room always measured along the height.

### Issues

#### Critical (Must Fix)

None.

#### Important (Should Fix)

None.

#### Minor (Nice to Have)

1. **Untested spec rules: flap hinge edge and handle-fit orientation.** Three spec rules have correct code but no test that pins them; each mutant survived the full front and rules suites (124 tests).
   - **§4.3/§6.2: flap hinges are counted along the width** (`flap.ts:73`). Mutating it to `fl(lh)` survives. The only flap hinge assertion (`hinged.test.ts:441`, 897 × 717) gets 3 hinges from the weight either way.
     - Fix: add a 1200 × 300 `flap_up` test (expects 3 hinges by width; by height it would be 2).
   - **§4.3: the flap hinge edge class comes from the top or bottom edge** (`flap.ts:75`). Mutating it to `opening.edges.left.cls` survives.
     - Cause: the test meant to cover it (`hinged.test.ts:541`) uses `overlay: 'inset'`, where `hingeRoleKey` ignores the edge class.
     - Fix: put a full-overlay `flap_up` over a door across a fixed shelf and hinge the flap on its bottom edge with `flap_down`. That edge is `shared`, so the test should expect `HNG-HO-SC` in `.hinges.shared`.
   - **§6.4: the handle fit is measured along the orientation** (`rules/hardware.ts:308`). Mutating it to always use `l.w` survives, because there is no narrow vertical-handle case.
     - Fix: add a door 720 wide × 300 high with `HDL-BAR-320`, which should get a knob vertically.
2. **Untested boundaries.**
   - `door_heavy` is only tested at 25.6 kg (`hinged.test.ts:376`). A mutant that warns only above 23 kg survives.
   - The §4.1 "largest overlap wins" rule (`openings.ts:184`) survives a first-match mutant.
   - The sliding glass handle-stile choice (`sliding.ts:120`) is untested. It is an interpretation choice and only affects which part carries the counter.
3. **Non-positive `leaves` is silently coerced** (`hinged.ts:85`). `n = Math.max(1, n)` turns `leaves: 0` or a negative value into 1 leaf with no issue. The schema allows any integer (`schema.ts:141`: `z.number().int()`).
   - The spec does not define this case, so it is not a spec breach. Either reject it in the schema (`.min(1)`) or emit `hinged_leaves_unsupported` as the sliding front does for `n < 2`.
4. **`solidLeaf`/`leafBody` live in `glass.ts`** (`glass.ts:84`, `:212`). The generic leaf-body factory that hinged, flap and sliding all use is in a file named for glass doors. A `leaf.ts` (or putting `solidLeaf` and `leafBody` in `hinged.ts`) would match the responsibility.

### Assessment

**Task quality:** Approved

**Reasoning:**
- The geometry, classification, cover, hinge split, plates, handles, flap mechanisms, sliding and weights all match 07, and the §12.2/§12.4 golden values are exact.
- Hand-built mixed-overlay, divider_open and nested-cover cases all behave to the spec.
- The remaining items are test gaps for 3 spec rules (flap hinge axis and edge class, handle-fit orientation) plus minor polish.
