# Task 25 re-review, fix round 1 (baa9c3f..8cf3f08)

### Finding Verdicts

- **Ruling 1: reduction for windows only (add and setOpeningProps)** — ADDRESSED. openings.ts `planAdd` rule selection (`reduce` only for `window`, else `refuse` for a default height and `explicit` for a given one). `planProps` rule selection (`reduce` only for `kind === 'window' && kindChanged`). Door/opening defaults on a low wall are `opening_too_tall`, and an explicit height over the top is `out_of_range` with `{field:'height', min:300, max:room}`. Tests: "does not shorten a door or opening" and "a kind change to door or opening ... is opening_too_tall".
- **Minor 1: redundant `if (x !== y)` guards and wrong header** — ADDRESSED. Guards removed in `moveOpening`, `resizeOpening` and `setOpeningProps` (`Object.assign(opening, plan)`). Header lines 3-8 now say mutative records no patch for a same-value write. The no-op tests still pass.
- **Minor 2: no resize test for an already-too-tall opening** — ADDRESSED. Test "can still be resized in width, with or without moving its edge" covers width-only and keep start. An unconditional height check in `planResize` would now fail it, because the opening is 2100 on a 2000 wall.
- **Minor 3: `SLACK` duplicates `BOUNDS_TOL`** — ADDRESSED. `BOUNDS_TOL` is exported from validate.ts and used in openings.ts. No import cycle, since validate.ts imports nothing from commands.
- **Minor 4: `doc as Draft<PlanDocument>` cast** — ADDRESSED. `nextOpeningLabel` takes `Pick<PlanDocument,'openings'>` (helpers.ts) and the cast and `Draft` import are gone.
- **Minor 5: label length counted in UTF-16 units** — ADDRESSED. `checkLabel` uses `[...label].length`, with an emoji 16 accepted / 17 refused test.
- **Minor 6: `planResize` silently skips checks when the wall is missing** — ADDRESSED. It returns `not_found` with `{id: wallId}` and has a test.
- **Minor 7: untested kind-change refusals** — ADDRESSED. Tests added for a kind change to door/opening on a low wall and for a kind change leaving under 300 mm above the sill.
- **Header said "logged in spec 19"** — ADDRESSED. It now reads "ledgered for the spec 19 reconciliation".

Checks run: the focused `openings.test.ts` gives 67/67 pass, matching the report. The report names the covering tests and full-engine counts (1887).

### New Breakage in the Fix Diff

None. One Minor note, not blocking: a window's explicit height over the wall top is shortened in `addOpening` (the test title "reduces an explicit window height" says so), but is `out_of_range` in `resizeOpening` and `setOpeningProps`. That follows 04 §6.6, which has the reduction in the `addOpening` bullet only. If the controller's "explicit height gets out_of_range in add" was meant to include windows, `planAdd` needs a one-line change.

### Out-of-Scope Observations

- `planProps` (openings.ts, `wall !== undefined &&` around the height check) still silently skips the height check when the opening's wall is missing. The same fix as `planResize` would apply. It only happens in an invalid document, and it is untouched by this diff.

### Verdict

**Fix round:** All findings addressed, no new Critical/Important breakage.
