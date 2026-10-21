# Task 35 report: drawers, drawer fronts and slide selection

**Status:** DONE_WITH_CONCERNS (interpretation choices only, listed below)
**Commit:** `ae4c489` feat(engine): generate drawer boxes, fronts and slide selection (base `e47dee7`, pushed to `origin/build/p2-engine`)

## What I implemented

### `carcass/drawers.ts` (new; 07 §3.12, §4.4, §6.5, §12.3, §12.4)
- `selectSlide(ctx, { slideCode, maxLen, family?, sectionId?, availableDepth? }) -> { slide, boxLength, issues }`.
  - Steps 1-5 of §3.12. An explicit code that fits `maxLen` is kept; otherwise the longest active slide of the same family that fits is taken (ties: lowest code); `slide_resized` only when an explicit code was replaced.
  - Returns its issues and records nothing (`drawersFor` pushes them). `sectionId` and `availableDepth` are optional so the function stays usable on its own; they fill the `sectionId` / `availableDepth` params of `drawer_no_slide`, `drawer_depth_unused`.
  - `boxLength` is `Ls`, 0 when no box can be made. With no default slide in the catalog: warning `no_default_hardware`, no slide, `Ls = fl(maxLen / 50) * 50`.
  - `family` overrides the family searched in step 3 (the brief listed the parameter without a definition).
- `drawerFrontRects(ctx, opening, content, sectionId?) -> Rect[]` (§4.4): front block of the opening with the cabinet's drawer overlay (`drawerStyleOf(doc)`), `n` fronts with the 2 mm gap, top first, fractional. Equal, or given heights with the last front taking the remainder; wrong list length = equal + warning `drawer_heights_invalid`; last front < 80 = error. The optional 4th parameter is the section id for the issues (the brief's 3-argument form has no way to name it).
- `drawersFor(ctx, env, layout, leaf, content, keyPrefix = 'section.{S}.drawer')`.
  - `S` is templated from `leaf.id`. It computes the openings itself (`computeOpenings(...).get(leaf.id)`).
  - Slots: external from the front rects clipped to the leaf; behind door by equal / given division without gaps.
  - `Hb` (10 mm step, `< 60` is `drawer_too_low` {sectionId, drawer}), `Wo` (packers only behind hinged / flap covers), `A`, `maxLen`, box table by slide type (`Wb`, `Win`, `Lb`, `bo`), `drawer_side_too_thick` for undermount.
  - Parts per drawer: `side.left`, `side.right`, `back`, `bottom`, then `front` (external: `parts.drawer_front`, 4 bands, 2 faces, grain x, in the front zone or inside for inset style; behind: `parts.drawer_inner_front` in `drawer_box`, 4 bands, 0 faces).
  - Hardware: `P.slides` ({length}), `P.handle` (external only, via `handlesFor`, `hardware.reason.handle_for_drawer`, knob fallback names `P.front` as `frontId`). Operations: `slideScrewSets += 1` on the bounding verticals (side or partition, preflight I8), `handleHoles` on the front. Model front `{ id: P.front, frontId: null, kind: 'drawer', rect: floored }`.
  - `drawers_forced_behind_door` when a covering Front exists and `behindDoor` is false (the drawers are still built behind the door).
- `carcass/envelope.ts`: `drawerStyleOf(doc)` extracted (no behaviour change) so `drawerFrontRects` can use it; `computeEnvelope` calls it.
- `carcass/contents.ts`: `boundingVerticals` is now exported.
- `engine/index.ts`: exports `drawersFor`, `drawerFrontRects`, `selectSlide`, `SlideRequest`, `SlideSelection`.
- Test support: `testing/carcassRun.ts` gets `drawers` option and `runWithDrawers`; `testing/docs.ts` gets `templateWardrobe(over)` (the `wardrobe_hinged` template document, deterministic ids).

### Task 34 review Minors folded in
1. Pinned with tests, mutants killed:
   - flap hinge count along the width (1200 x 300 gives 3, 300 x 1200 gives 2);
   - flap hinge edge class with a full-overlay flap over / under a door across a fixed shelf (`flap_down` bottom edge and `flap_up` top edge both land in `.hinges.shared` as `HNG-HO-SC`; an outer edge stays on `.hinges`);
   - handle fit along the orientation (720 x 300 door gets the knob, 300 x 720 keeps the 320 bar, and the 400 mm boundary).
2. Boundaries:
   - `door_heavy`: exactly 22.000 kg is quiet (1000 x 1000 x 25 mm at 880 kg/m3), 22.025 kg warns. The brief says "§6.10 threshold"; the 22 kg threshold is in §6.2 / §7.3.
   - Largest overlap wins: two partitions on one plane in a short top row and a tall bottom row, both orders.
   - Sliding glass pull stile: left stile for leaves `1..ceil(n/2)`, right stile for the rest, for 2, 3 and 4 leaves.
3. Hinged `leaves < 1` raises `hinged_leaves_unsupported` and builds one leaf. Schema `leaves` is `int().min(1) | 'auto'` (03 gives no range).
4. `solidLeaf` / `leafBody` moved to `fronts/leaf.ts`. I moved `glassLeaf` and the types with them, because `leafBody` dispatches to it and leaving it in `glass.ts` would make an import cycle. `glass.ts` keeps `glassFeasible`. No behaviour change.

## Golden numbers (07 §12.3, §12.4)
All matched the §3.12 formulas exactly; no disagreement to report.
- 600 x 720 x 560: `fz 18`, `Dc 542`, interior depth 529, `maxLen 519` gives `SLD-BB-500`, no depth warning; `Wb 538`, `Win 514`, `Lb 500`; front block `x [1.5, 598.5]`, `y [1.5, 718.5]`; fronts 597 x 237 at y = 480, 241, 1; boxes 180 / 190 / 180; sides 500 x 180, back 514 x 167, bottom 524 x 500 (HDF3-WHITE, unbanded), front 597 x 237 banded on all four.
- Undermount: `Win 522`, `Wb 546`, `Lb 490`, bottom 532 x 490, back 522 x 164.
- §12.4: `SLD-BB-350` with `maxLen 519` gives `drawer_depth_unused {unused: 169}`; `maxLen 240` gives `drawer_no_slide`; `SLD-UM-500` with `maxLen 480` gives `SLD-UM-450` + `slide_resized`.
- Last front `717 - 640 - 4 = 73 < 80` gives `drawer_heights_invalid` (error); a 2-element list for 3 drawers gives equal + warning; a 95 mm slot gives `drawer_too_low`.
- Behind a door: minus 40 for packers, A minus 20, wardrobe `internalDrawers: 2` checked by hand (Wo 542, Wb 516, Hb 140, `SLD-BB-500`).
- Not mine: the brief's "cams 8, dowels 8 (4 joints, length 542); no anti-tip" line of §12.3 belongs to the connector rules, which are not in this task.

## TDD evidence
- RED: `yarn vitest run --project engine resources/js/engine/furniture` before any implementation:
  `Tests  4 failed | 454 passed (458)`; `Test Files  4 failed | 16 passed (20)`.
  - `drawers.test.ts`: `Cannot find module '../drawers'`.
  - `leaf.test.ts`: `Cannot find module '../leaf'`.
  - `hinged.test.ts`: `reports hinged_leaves_unsupported for leaves 0` and `-1`: `expected [] to match object [ { severity: 'error', ... } ]`.
  - `schema.test.ts`: `rejects leaves: 0` and `-1`: `expected true to be false`.
  - The other new Minor tests passed already (the behaviours were right, just unpinned); they were then checked by mutation (below).
- GREEN: `yarn vitest run resources/js/engine`: `Test Files 77 passed (77)`, `Tests 2702 passed (2702)` (base was 2594).
- Gates: `yarn eslint resources/js/engine --max-warnings=0` clean, `yarn prettier --check resources/js/engine` clean, `yarn vue-tsc --noEmit` clean.

## Mutation checks (in place, restored; scratch files deleted)
Killed: `Hb` rounding instead of floor, packers x1, no behind-door depth clearance, no slot clipping, screws on one side only, `unused >=`, `last front <= 80`, `Hb <= 60`, no inset reduction (external and behind), box z offset, UM length deduction, UM bottom recess, side-thickness `>=`, list `>=` count, banding, grain of sides / back / front / inner front, groove depth, box centring, slot centring, handle count, `Wb` from `t_db`, packer by cover kind, slide `reasonParams`, model `frontId`; and the Task 34 mutants (flap `fl(lh)`, flap edge `left`, handle fit always `l.w` or `l.h`, `door_heavy >=` and `> 22.05`, first-match divider, sliding stile side and half split, `leaves < 1` guard, schema `min(1)`).
Three survivors (tie-break `>=`, explicit slide with `length == maxLen`, longer-than-count list, `Wb` constant 12) were pinned by new tests and then killed.

## Files changed
- New: `carcass/drawers.ts`, `carcass/__tests__/drawers.test.ts` (82 tests), `fronts/leaf.ts`, `fronts/__tests__/leaf.test.ts`.
- Edited: `carcass/contents.ts`, `carcass/envelope.ts`, `fronts/glass.ts`, `fronts/hinged.ts`, `fronts/flap.ts`, `fronts/sliding.ts`, `schema.ts`, `index.ts`, `testing/carcassRun.ts`, `testing/docs.ts`, and tests `hinged`, `openings`, `sliding`, `schema`.

## Self-review and decisions to confirm
1. **Errors keep what is still valid.**
   - `drawer_no_slide`: no box parts, slides or screws for any drawer. External fronts, model fronts and handles are still built.
   - `drawer_too_low`: that drawer has no box parts; its external front stays.
   - `drawer_heights_invalid` (error, last front < 80): fronts are still built with the given heights, so the 73 mm front also reports `drawer_too_low` for its slot.
   - The spec says only "no box parts" for the first two and says nothing for the third.
2. **Unknown or non-slide explicit `slideCode`** falls back to the default slide silently (no `slide_resized`). `validateFurniture` (Task 37) reports `unknown_code`. The spec's "Missing" in step 1 does not distinguish the cases.
3. **Behind-door `frontHeights` list of the wrong length** also gives equal + `drawer_heights_invalid` warning (the spec words it for external drawers only). A behind-door remainder below 80 is left to `drawer_too_low`.
4. **Table reuse (Task 38).** `drawersFor` takes the handle code from `carcass.handles.code` and finds external openings through `computeOpenings`, so with a table document (no carcass) it builds the behind-door form only. Task 38 will need its own front rects (via `drawerFrontRects`) or a small extension. I did not add the `handle.default` fallback of §6.4 because nothing could exercise it.
5. `drawerFrontRects` and `drawersFor` re-run `computeOpenings` per drawer leaf (cheap; no cache).
6. Commit trailer: your instruction (`Claude Opus 5.5`) was used rather than the harness reminder's `Sonnet 5.5` line.
