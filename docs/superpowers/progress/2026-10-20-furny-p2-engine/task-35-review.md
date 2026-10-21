# Task 35 review: drawers, drawer fronts, slide selection (e47dee7..ae4c489)

### Spec Compliance

- ✅ **Spec compliant.** I checked 07 §3.12, §4.4, §6.4/§6.5, §7.3, §12.3 and §12.4 against the diff, and the brief's file list.
  - Every listed file has its hunk: `carcass/drawers.ts`, `fronts/drawerFronts.ts` (see the first ⚠️), `carcass/__tests__/drawers.test.ts`.
  - The Task 34 minors are folded in; see "Task 34 minors".
  - Controller rulings were not re-flagged: errors keep valid parts, behind-door wrong-length heights, the optional extra params, the `fronts/leaf.ts` move, `door_heavy` 22 kg, `leaves` int ≥ 1.
  - Unknown slide codes (Task 37) and table external drawer fronts (Task 38) were not flagged either.
- ⚠️ **The brief lists `fronts/drawerFronts.ts`; the diff has no such file.** `drawerFrontRects` lives in `carcass/drawers.ts:240-270`. The brief's Interfaces section says only that `drawers.ts` produces `drawerFrontRects`, so the behaviour is as specified. The controller should confirm the file layout (the controller may have folded it in).
- ⚠️ **Cannot verify from the diff (later tasks):**
  - `drawersFor` is called only from the test driver `runCarcass` (`testing/carcassRun.ts`), not from `generateFurniture` (Task 36).
  - The §12.3 "cams 8, dowels 8 (4 joints, length 542); no anti-tip" line belongs to the connector rules (§6.9).
  - `unknown_code` for a bad `slideCode` and `drawer_box_thickness` / `drawer_bottom_thick` belong to Task 37.

### Strengths

- **The §12.3 golden numbers are pinned exactly:** `fz 18`, `Dc 542`, interior depth 529, `maxLen 519` giving SLD-BB-500, `Wb 538 / Win 514 / Lb 500`, front block `[1.5, 598.5] x [1.5, 718.5]`, fronts 597 x 237 at y = 480 / 241 / 1, boxes 180 / 190 / 180, parts 500 x 180 / 514 x 167 / 524 x 500, the undermount variant (`522 / 546 / 490`, 532 x 490, 522 x 164), and `slideScrewSets` 3 on each side.
- **`selectSlide` is a pure function that returns its issues,** so it is testable on its own. Steps 1-5 map one-to-one onto the code (`drawers.ts:103-197`).
- **Box table and placement follow the spec formula by formula:**
  - `Wb`, `Win`, `Lb`, `bo` by slide type (`drawers.ts:365-397`);
  - `bx0` uses `w`, not `Wo`;
  - `by0 = slotY0 + fl((slotH - Hb) / 2)`;
  - `zf` includes the inset reduction, the 20 mm clearance and `t_db`.
- **`drawerStyleOf` was extracted from `computeEnvelope` with no behaviour change,** so the envelope and the fronts cannot disagree about inset vs full.
- **Scratch checks all matched hand computation:**
  - The `bb45` family at every boundary: explicit `SLD-BB-{250..600}` at `len-1 / len / len+1` gives `no_slide` / kept / kept for 250, and `slide_resized` to the next-lower length / kept / kept for the rest.
  - The `um` family: explicit `SLD-UM-{350..500}` at `len-1` resizes down (350 gives `drawer_no_slide`).
  - `SLD-UM-350` at `maxLen 519` is kept with `drawer_depth_unused {169}`; `SLD-UM-500` at `maxLen 1000` is kept with `{500}`. There is no upward resize, which is what step 2 says.
  - `behindDoor: true` + `SLD-UM-500`:
    - No cover: `maxLen 505`, `UM-500` kept, `Lb 490`, `Win 522`, `Wb 546`, back 522 x 164, inner front 546 x 180 at `z [528, 540]`.
    - Hinged cover: `maxLen 487`, `slide_resized` to `UM-450`, `Lb 440`, `Win 482`, `Wb 506` (packers 40), inner front at `z [510, 522]`.
  - A drawer stack under a fixed shelf (600 x 1000 x 560, leaf `y [18, 518]`):
    - Shelf top row with no front: edge `divider_open`, block `[1.5, 534.5]`, `hf = 176.33`, fronts y = 358 / 179 / 1; slots clipped to the leaf give `Hb 110`, `by0 = 382.17`.
    - Shelf top row with a door: edge `shared`, block `[1.5, 526]`, `hf = 173.5`, `Hb 120`.
    - `slideScrewSets` is 3 on each side panel and 0 on the shelf in both cases.
- **The test file is behavioural,** with no mock-only assertions (82 tests in `drawers.test.ts`). It covers:
  - archived explicit slides;
  - lowest-code ties;
  - the 100 mm unused boundary (450 quiet, 451 warns);
  - the 16 vs 17 mm side-thickness boundary;
  - packers by cover kind (hinged / flap_up / flap_down pack, sliding does not);
  - a real `wardrobe_hinged` template document with `internalDrawers: 2`.
- Test output is pristine.

### Issue codes and severities against §7.3

| Code | Emitted as | Params | Verdict |
|---|---|---|---|
| `drawer_no_slide` | error | sectionId, availableDepth = A | ✅ (`drawers.ts:112-128`) |
| `drawer_too_low` | error | sectionId, drawer | ✅ (`:421`) |
| `drawer_heights_invalid` | error (last front < 80) / warning (wrong length) | sectionId | ✅ (§4.4 distinguishes the two; the §7.3 row says "error") |
| `drawer_depth_unused` | warning | sectionId, unused | ✅ |
| `drawers_forced_behind_door` | warning | sectionId | ✅ |
| `drawer_side_too_thick` | warning (undermount only) | sectionId | ✅ |
| `no_default_hardware` | warning | roleKey | ✅ |
| `slide_resized` | info | from, to | ✅ |
| `handle_replaced_by_knob` | info | frontId = `P.front` | ✅ (via `handlesFor`) |

### Hardware lines and operations

- **Slides:** `P.slides` qty 1, `reasonParams { length: Ls }`, `frontId null`, `sectionId` set.
- **Handles:** `P.handle` through `handlesFor`; count is `handleCount('drawer', fw)` on the floored front width, so 603 mm box gives 1 handle and 604 gives 2. Holes are drilled on the front part; none behind a door.
- **`slideScrewSets`:** `+1` on the left and right bounding verticals (sides or partitions) per built drawer. A drawer that is not built (too low, or no slide) adds none.

### Task 34 minors

All four are closed. The mutants below were applied in a scratch copy and were all killed:

- **Flap hinge axis:** `edgeLength: fl(lw)` changed to `fl(lh)`.
- **Flap hinge edge class:** `opening.edges[hingeEdge]` changed to `left`, and to `top` always.
- **Handle fit orientation:** always `l.w`, always `l.h`, and `>` changed to `>=`.
- **`door_heavy`:** `>=`, and threshold + 1 kg.
- **Largest overlap:** first-match, and smallest-wins.
- **Sliding glass pull stile:** always left, and `floor` instead of `ceil`.
- **Hinged `leaves < 1`:** guard dropped, and result 2 leaves instead of 1.
- **Schema `.min(1)`:** dropped.
- **`solidLeaf` / `leafBody` move:** done, with `leaf.test.ts`. `glassLeaf` moved with them to avoid an import cycle, which is reasonable.

### Mutation checks (scratch copy; deleted)

Killed:

- `drawerStyleOf` `every` changed to `some`.
- Behind-door slot gap 2.
- Inset `cd` also subtracted for behind-door drawers.
- Explicit-slide keep test using the default instead of the named slide.
- `bx0` from `Wo`.
- Top banding removed.
- Front rect with a fixed `'full'` overlay.
- No-default step 25.
- Family taken from the default.
- Slots not clipped to the leaf.
- `Hb` round instead of floor.
- Undermount `bo` fixed at 10.
- Packers also for sliding.
- Last front `<= 80`.
- Forced-warning without `!behindDoor`.
- `availableDepth` = `maxLen`.
- Gap missing in the front y step.
- `slide_resized` raised on any change.

Survived (all minor, see below): the `leafOpening` fallback replaced by a throw; the front-height error also raised for `'equal'`; `slideScrewSets` added only `if (slide)`; the `Ls > 0 &&` guard on the thick-side check dropped; `content.count < 1` guard dropped; undermount `roleKey` swapped; unfloored handle-count width; `door_heavy` threshold + 0.01.

### Issues

#### Critical (Must Fix)

None.

#### Important (Should Fix)

None.

#### Minor (Nice to Have)

1. **`leafOpening` fallback is unreachable for carcass documents and untested** (`drawers.ts:272-286`, used at `:333-335`). `computeOpenings` keys every external-drawer leaf by section id under the same condition `drawersFor` uses for `behind`, so `.get(sectionId)` never misses.
   - Replacing the fallback with a throw leaves all 545 furniture tests green.
   - It only runs for a document with no carcass, which is the table case carried to Task 38.
   - Either test it with a table-shaped document or move it into Task 38.

2. **`drawersFor` is a single ~280-line function** (`drawers.ts:292-572`) with about 25 locals. The per-drawer body (box parts, then slides and screws, then front, then handle) is a natural helper (`boxParts(...)` and `externalFront(...)`). Its behaviour is correct and well tested; this is maintainability only.

3. **`sectionId === undefined ? {} : { sectionId }` and the matching `entityIds` ternary are repeated three times** (`drawers.ts:109-111`, `:216-217`, `:259-260`). A small `sectionRef(sectionId)` returning `{ params, entityIds }` would remove it.

4. **Two sources for the drawer overlay.** `drawerFrontRects` reads `drawerStyleOf(ctx.doc)` (`:251`), while `drawersFor` uses `env.drawerStyle` for the depth and the z range (`:343`, `:532`). They agree today because the envelope uses `drawerStyleOf`, but a caller that passes a different `env` (Task 38 tables) gets a silent mismatch. Passing the style into `drawerFrontRects` would give one source.

5. **Test gaps (mutants survived the full furniture suite):**
   - `drawers.ts:255` — equal division with a front under 80 mm must not raise `drawer_heights_invalid`, only `drawer_too_low`. Add one test.
   - `drawers.ts:523` — `slideScrewSets` is still added when the catalog has no default slide (the "builds the boxes without slides" test does not assert it). Spec says always.
   - `drawers.ts:377` — the `Ls > 0 &&` guard on the thick-side check is dead, because an undermount type implies a slide and `Ls > 0`. Drop it.
   - `drawers.ts:300` — `content.count < 1` is dead, because the schema has `count: min(1)`. Harmless, but untested.

6. **`hinged_leaves_unsupported` for `leaves < 1`** (`hinged.ts:77-84`) duplicates the new schema guard, and the issue text ("at most 2 leaves") does not describe a count below 1. It is unreachable for schema-valid documents. Either keep it as defence in depth with a comment, or drop it, since the schema now owns the range.

7. **Three copies of the "remove `slide.side_mount` default" catalog mutation** in `drawers.test.ts:562-567`, `:589-594` and `:666-671`, and two copies of the archived-`SLD-BB-500` mutation. Extract helpers (`withoutDefaultSlide`, `archived(code)`).

8. **Process note:** the report says the commit trailer used `Claude Opus 5.5` per the controller's instruction instead of the harness attribution (`Claude Sonnet 5.5` plus the session line). Check the commit message against the intended attribution; the review did not re-run git.

### Assessment

**Task quality:** Approved

**Reasoning:**
- The slide selection, slot and box-height maths, box table (side mount and undermount, with and without a door and packers), placement, §4.4 front division and the hardware lines all match 07, and the §12.3 / §12.4 golden values are exact.
- Scratch cases at every `bb45` / `um` step boundary, `behindDoor` with undermount, and a drawer stack under a fixed shelf (open and shared top edge) all came out as hand-computed.
- The Task 34 minors are closed and their mutants killed. The remaining items are structure and test-gap polish.
