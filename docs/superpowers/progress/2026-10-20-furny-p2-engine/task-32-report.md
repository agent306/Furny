# Task 32 report: carcass envelope, panels, plinth, countertop

Status: DONE_WITH_CONCERNS (concerns are minor, see below)
Commit: df47c69 `feat(engine): generate carcass envelope, panels, plinth and countertop` (pushed to origin/build/p2-engine)

## Implemented (resources/js/engine/furniture/)
- `carcass/envelope.ts`: `Envelope`, `computeEnvelope(ctx)`, `hasExternalDrawers(doc)`, `coveringFront(doc, sectionId)` per 07 §3.2. On too-small it pushes error `furniture.envelope_too_small` via `ctx.issue` and returns null. Wall/loft with a plinth pushes info `furniture.plinth_ignored` (before the size check). Throws `EngineInputError` if the document has no carcass.
- `carcass/panels.ts`: `carcassPanels(ctx, env)` pushes side left/right, top, bottom (07 §3.3) and 4 joints `{ member, other, length: Dc - zp }`. It pushes no issues.
- `carcass/plinth.ts`: `plinthParts(ctx, env)` (07 §3.5): front, back, returns; `plinth_too_shallow` warning; legs type gets the kickboard front only when setback > 0.
- `carcass/countertop.ts`: `countertopPart(ctx, env)` (07 §3.6) plus `countertop_overhang_large` warning when any overhang > 300.
- `testing/docs.ts`: shared test documents `boxDocument(opts)`, `drawerTestBox()` (07 §12.3), `countertopBox(overhang?)`, `defaultMaterials()`, `BOX_ROOT_ID`. Validated against `FurnitureDocumentSchema` in envelope.test.ts.
- Tests: `carcass/__tests__/envelope.test.ts` (22), `panels.test.ts` (30; panels, plinth, countertop).

## Verification
- `yarn vitest run resources/js/engine/furniture/carcass`: 52/52 pass.
- Gates: `yarn eslint resources/js/engine && yarn prettier --check resources/js/engine && yarn vue-tsc --noEmit`: clean.
- Full `yarn vitest run resources/js/engine`: 66 files, 2346 tests, all pass.
- All brief values asserted: wardrobe envelope and interior; side/top/bottom sizes, edges, faces; 4 joints of length 582; plinth front/back/returns at x = 0, 891, 1782; return counts 2/3/4 for Wc 1000/1001/2001; plinth_too_shallow; drawer box (fz 18, Dc 542, interior x [18,582] y [18,702] depth 529); countertop box (fz 0, ctT 25, Hc 725, Dc 540, part 600 x 560 banded front/left/right, faces 1); overhang 301 warning (each of the 3 overhangs; 300 does not warn); over_sides; wall plinth ignored; W 150 / plinth 100 / H 100 envelope_too_small with no parts.

## TDD evidence
Not strictly red-first: I wrote the implementation files before the tests, then ran the tests once. The first run had 4 failures, all caused by wrong test expectations, plus one real bug the tests caught: the legs plinth emitted a kickboard front with setback 0, against the brief's "only when sb > 0". Fixed in plinth.ts. Final run is green.

## Self-review
- Reviewed my own diff; no leftover debug code. Names follow the 07 tables.
- Joint order: top/left, top/right, bottom/left, bottom/right.

## Concerns / spec notes
1. 07 §3.1 and §3.2 write `computeEnvelope(doc)`, `carcassPanels(env)`, `plinthParts(env)`; the brief and your resolution use `(ctx)` / `(ctx, env)`. I followed the brief.
2. The §12.3 text "interior depth 529" is `Dc - zBackFront = 542 - 13`. This is consistent, but it holds only because the drawers get fz = 18 through `hasExternalDrawers`. The countertop box has no fronts and no drawers, so fz = 0 and Dc = 540.
3. 07 §3.2 lists `plinth_ignored` in the plinthH row but 07 §7.3 cites "§3.2" for it too; I emit it in `computeEnvelope`, so it also appears when the envelope is then rejected as too small. Harmless, but it is an issue emitted alongside the error.
4. 07 §3.5 says the legs kickboard is "exactly as above" (front z = `[Dc - sb - t_p, Dc - sb]`). With legs, sb > 0 only is required. A zero-height plinth (`type` plinth/legs with `height 0`) is silently skipped by `plinthParts`.
5. `hasExternalDrawers` treats a "leaf" as a section with no children (not `split === 'none'`), so inconsistent documents do not crash. A front's `covers` is matched against the leaf id and every ancestor id; `coveringFront` returns the first match in `fronts` order (overlapping fronts are a validation matter).
6. The test-doc helper lives in `furniture/testing/docs.ts` (not the engine-level `engine/testing/`), as you suggested.
7. `plinth_ignored`, `plinth_too_shallow`, `countertop_overhang_large` are pushed with empty params and entityIds.
