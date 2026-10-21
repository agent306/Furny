# Task 15 report: footprints + placement conflicts

Status: DONE_WITH_CONCERNS (interpretation choices below, none blocking)

## Implemented
- `resources/js/engine/plan/footprint.ts`: `FootprintSize`, `FootprintProvider`, `Footprint`, `placementFootprint`, `fixtureFootprint`; re-exports `frontVector` / `rotationFromFront` from `geometry/vec2.ts` (existing implementations reused, no duplicate; not re-exported a second time from `index.ts`).
- `resources/js/engine/plan/conflicts.ts`: `CONFLICT_KINDS`, `ConflictKind`, `PlacementConflict`, `computePlacementConflicts`, `doorSwingSectors`.
- `index.ts` exports the new public names.
- Convention check: `signedArea` in `geometry/polygon.ts` is `1/2 sum(x_i y_i+1 - x_i+1 y_i)`; y-down CW has positive area (04 2.1-6). Footprint corners in the spec order are CW for every rotation (tested at 0/30/90/135/180/225/270/359).

## Decisions / interpretations
1. `Footprint.front` = midpoint of the front edge (`backCenter + f*depth`); 05 rotate handle is "beyond the front-edge midpoint". Spec only says `front: Vec2`.
2. Door sectors: types single_swing, main_entrance (one leaf, radius = derived u1-u0, hinge per `hinge`), double_swing and french_window (two leaves of half width hinged at both jambs). The task message said windows have no sector, but 04 5.9-3 (binding) lists `french_window`, so it gets 2 sectors. Casement/ventilator/etc. get none; sliding/pocket/bifold/opening get none. Zero-width (clamped) openings skipped (ruling). Hinge point = jamb of the hinge end on the swing face (left face if swingSign=+1); closed leaf along +-wall.dir, open leaf along swingSign*normal; 16 segments, 18 points (hinge + 17 arc), CW (hinge first).
3. `noConflict` fixtures (rug, sink, hob) are excluded entirely: they neither raise nor receive any conflict kind (not just item overlap).
4. Rules 1, 3, 4 apply to fixtures as well as placements (`entityId` is "placement or fixture id").
5. Item overlap pair reported once, `entityId` = lexicographically smaller id (placements `f_` sort before fixtures `x_`).
6. Window rule: area threshold > 2500 mm2 like the others (flush contact ignored); vertical overlap strictly > 0 with [sill, sill+opening.height] (spec gives no tolerance). Zone = window u0..u1 x (thickness/2 + 300) each side. Applies to `kind === 'window'` (including french_window, which therefore can raise both blocks_door and blocks_window).
7. Wall rule uses `pocheParts` (doorways/windows are cut out); `half` walls ignored when item `elevation >= wall.height`, other walls ignore elevation.
8. Blocks_door: elevation < opening.height; one conflict per (item, opening) using the largest leaf area.
9. Output sorted by (kind, entityId, otherId) with plain string comparison (alphabetical kind: blocks_door, blocks_window, overlaps_item, overlaps_wall). `params = { areaMm2 }` (rounded) for every kind.
10. HDB integration: all 8 swing doors (7 single_swing + 1 main_entrance) yield exactly one sector each, all points on the swing half-plane. 7 sectors have a room on the swing side and their probe lies inside that room's net polygon. Note: the reference main_entrance has swing 'left' / hinge 'start' (fixture builder default) and opens to the OUTSIDE (no room on that side); the room-containment check is therefore 7, not 8.

## TDD evidence
- RED: `yarn vitest run resources/js/engine/plan/__tests__/footprint.test.ts` with footprint.ts removed: "Failed to load url ../footprint ... Does the file exist?", 0 tests. conflicts.test.ts likewise failed to load before conflicts.ts existed (no tests collected).
- GREEN: `yarn vitest run resources/js/engine/plan/__tests__/conflicts.test.ts resources/js/engine/plan/__tests__/footprint.test.ts` -> 2 files, 59 tests passed.
- Full engine suite `yarn vitest run --project engine`: 31 files, 875 tests passed. (First run caught the purity test on the literal `window.` in a comment of conflicts.ts; comment reworded.)
- Gates: `yarn eslint resources/js/engine && yarn prettier --check resources/js/engine && yarn vue-tsc --noEmit` all clean.

## Files
- A resources/js/engine/plan/footprint.ts, conflicts.ts
- A resources/js/engine/plan/__tests__/footprint.test.ts, conflicts.test.ts
- M resources/js/engine/index.ts

## Self-review
Reviewed diff; no unused imports (eslint clean); inputs never mutated (tested for the document). Perf: bbox pre-filters before every Clipper call.

# Fix round 1

Commits: see `git log` (test(engine): open reference doors into the rooms they serve; fix(engine): count wall under openings as solid and tighten conflict tests).

## Important
1. Door-opening wall test now uses `doorFit` (800 x 600) 200 mm into the wall inside a sliding-door opening: no conflict; deleting the opening gives `overlaps_wall`. Extra tests: part of an item outside the opening span counts (area 250 x 200), item taller than the door head is solid.
2. Double-swing test pins hinge, closed end and open end of both leaves and checks every point stays inside its own half of the opening (x in [2050,2500] / [2500,2950]). New "wall at 30 degrees" tests for hinge start/end x swing left/right, with hand-derived hinge, closed-end and open-end points.

## Ruled changes (log in spec 19)
3. `overlaps_wall` no longer uses `pocheParts`. Item is intersected with the full wall outline; each opening on the wall exempts its cut rectangle only when the item's `[elevation, elevation+height]` lies within the opening's `[sillHeight, sillHeight+height]` (doors span from the floor). Exempt area is computed against the already-clipped item, so the 0.5 mm cut overshoot cannot over-subtract. Tests: floor cabinet (h 900) under a window sill (900) flagged; wall cabinet at 1500 (1500..2200) under a 900..2100 window flagged; item 1000..1800 inside the window range not flagged; item under the door head exempt, taller item flagged. Spec 19 entry: 04 §5.9-1 "poche parts" wording replaced by "outline minus opening cuts whose vertical range contains the item's".
4. Reference fixtures: `referencePlans.ts` door rows take an optional `swing` (default 'left'); HDB main entrance and brochure main entrance now `'right'` (into Living Room / Living/Dining); brochure A16-A15 -> Bedroom 1 and A14-A18 -> Toilet 1 also `'right'`. All other doors already opened into the room they serve (HDB: Bedrooms 1-3, Dress, Toilets 1-3; brochure: Bedroom 2, Toilet 2, Deck, W/M). Both JSON fixtures regenerated with UPDATE_FIXTURES=1 (only `swing` values changed: HDB 1, brochure 3); referencePlans.test.ts passes (28). Sector tests now run for both plans (8 HDB, 7 brochure swing doors): one sector each, all points on the swing half-plane, and every sector point is inside (or on the boundary within 1 mm of) the net polygon of the room on the swing side; no door swings outside.

## Minor
5. Pinned: exact 2500 boundary (wall, item, window clear zone: 2500 passes, 2501 conflicts via 1 mm-deep strips); window vertical boundary (item top == sill passes, +1 mm conflicts); half wall at elevation == wall.height (1000 passes, 999 conflicts); otherId tie-break (corner item vs two walls; item vs two partners met in a different sweep order); french_window raises blocks_window; largest leaf of a double door (both orders, plus left-leaf-dominates / right-leaf-dominates).
6. Removed the dead `ensureCW` and `ring` in `makeItem`.
7. `frontVector` (geometry/vec2.ts) is now exact at 0/90/180/270 (a `normDeg` switch; other angles unchanged); `footprint.ts` derives r = (f.y, -f.x) from it. Footprint tests use `toEqual` for 90/180/270; new exactness test in vec2.test.ts.
8. `itemConflicts` is a sort-and-sweep on `bbox.min.x` (break when `b.min.x >= a.max.x`); the smaller id is still reported as `entityId`. Perf test in the normal suite: 1000 random placements in the HDB plan (seeded), ~83 ms measured, asserted < 2000 ms, result deterministic across two runs and containing all four kinds.

## Mutation check (scratch edits restored after each; script in the scratchpad)
All killed: no opening exemption; exempt regardless of vertical range; full outline only (the reviewer's mutant); end-leaf closedDir flipped (two-leaf and single); open direction sign; open/closed direction assumed axis-aligned (killed only by the 30 degree tests); `>=` in wall, item and window thresholds; window vertical `< 0`; half wall `>`; otherId tie-break dropped; first/last/sum leaf instead of max; vertical item overlap tolerance; door head check; non-exact frontVector.

## Verification
- `yarn vitest run --project engine`: 31 files, 899 tests passed.
- `yarn eslint resources/js/engine && yarn prettier --check resources/js/engine database/fixtures && yarn vue-tsc --noEmit`: clean.
- Note: the environment's primary directory switched to furny-p1 mid-task; all work stayed in /home/user/furny-p2.
