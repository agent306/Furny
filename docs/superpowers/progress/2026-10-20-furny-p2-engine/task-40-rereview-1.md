# Task 40 re-review 1 (fix c270ff7..012b8e4)

All checks below ran in a scratch copy at 012b8e4. The copy has been deleted, and the worktree is untouched.

### Finding Verdicts

- **Important 1: sliver seam pieces from end supports** — ADDRESSED.
  - **The fix:**
    - `panelSplit.ts:73`: a support is accepted only when `c ≥ s + minPiece`, `c ≤ s + maxSpan` and `to − c ≥ minTail`.
    - Long panels pass `MIN_SEAM_PIECE = 300` for both bounds (`:42`, `:279-280`).
    - The back split keeps the §3.4.1 defaults.
  - **Re-run of my sliver cases:**
    - Every table template, all select combinations, every width on a 5 mm grid, with and without drawers and the lower shelf: 0 pieces under 300 mm and 0 errors. This covers the old 74 mm and 100 mm cases at dining four_legs 2790–2850 and trestle 2790–3000.
    - Eight carcass templates at every mm from 2380 to 3600, and custom_box floor/wall/loft at every mm from 2380 to 6000: 25,528 splits and 0 pieces under 300 mm. This covers the old 9 mm plinth pieces at 2421–2429.
  - **Mutation:**
    - Removing the tail guard is killed by `panelSplit.test.ts` "greedySeams skips a support…" and the dining 2790–2850 test.
    - Setting `minPiece` back to 100 is killed by "trestle 2790-3000".
- **Important 2: overrides on a split part orphaned with only an info issue** — ADDRESSED, per the controller's ruling.
  - **The fix:**
    - `splitLongPanels` applies the base-key override before splitting (`panelSplit.ts:421-433`).
    - It never splits a removed panel (`:427`).
    - `applyPartOverrides` skips keys already applied (`overrides.ts:155`) and orphans piece keys (`:158`).
  - **Re-run with custom_box:**

    | Case | Result |
    |---|---|
    | 3000 + `materialCode PB25-WHITE` | `carcass.top.1` and `.2` are PB25 with `overridden: true`, and no orphan |
    | 2000 + the same override | a single PB25 top |
    | 3000 + `removed: true` | no top parts, only the bottom is split, no orphan |
    | 3000 + an override on `carcass.top.1` | `override_orphaned { key: 'carcass.top.1' }`, as ruled |
    | 3000 + `lengthDelta −800` | the top fits and is not split, while the bottom is split |

  - **Extra case: a `lengthDelta` that pushes a panel over the sheet.**
    - Setup: `carcass.top` and `carcass.bottom` with `lengthDelta` 0 to 700 in 1 mm steps, on custom_box, wardrobe_hinged, tv_unit, sideboard and bookshelf at widths 1800, 2100 and 2400.
    - Result: 5,376 splits, 0 pieces under 300 mm, and 0 `part_exceeds_sheet`.
    - The same for `table.top` with `lengthDelta` 0 to 900 on dining 2400 (four_legs, trestle, pedestal): 1,560 splits, 0 pieces under 300 mm, and 0 errors.
  - **Mutation:** dropping the pre-split override, splitting a removed panel, dropping `overridden`, allowing piece-key overrides, and double-applying are each killed by the "panel overrides apply before the split" tests or by `overrides.test.ts`.
- **Minor 1: hidden `singleColumnSide` matters** — ADDRESSED.
  - `wardrobe_hinged.ts:97-104`: `visibleIf` is removed and the comment corrected.
  - `wardrobe_hinged.test.ts` pins the whole field and checks that doors 2 at 2400 give `[1, 2]` versus `[2, 1]`. Restoring the `visibleIf` mutant is killed.
- **Minor 2: thin-leg clamp and `reachZ` without a killing test** — ADDRESSED.
  - `generateTable.test.ts` adds a case with s 60 × t_leg 50, inset 40, which expects 32. It also adds a case with 3 side drawers whose runners span z [100, 800].
  - Both target the mutants that survived in round 0. The implementer's mutation run is consistent with the assertions: `min(s, ·)` gives 42 against the expected 32.
- **Minor 3: untested `panelSplit` branches** — ADDRESSED. New tests cover:
  - the glass exemption;
  - `supportsOf` at a share of 50% (in) and 45% (out), a part wider than deep, and a part that does not quite touch;
  - operations kept on piece 1;
  - grain kept with PB18-OAK;
  - the `fixed_shelf`, `countertop`, `table.shelf` and `table.top.layer.n` entries.

  I spot-checked the per-edge band-code mutant: it is killed.
- **Minor 4: identical piece names** — ADDRESSED.
  - `partNames.ts:8-46` adds ` {piece}` to the 12 splittable name keys, so pieces read "Top 1" and "Top 2", and an unsplit part still reads "Top".
  - This is covered by `partNames.test.ts`. Note the "Fixed shelf 2 3" form under New Breakage.
- **Minor 5: seam over a partition joins one piece only** — ADDRESSED.
  - `panelSplit.ts:343-365`: a part centred on a seam (within 0.5 mm) joins both pieces. Doubling its cams is the ruled behaviour.
  - A mutant that drops this is killed by "a seam over a partition joins the partition to both pieces".
- **Minor 6: the overlap helper skips extruded parts** — ADDRESSED.
  - `testing/overlaps.ts:21-33` now checks extruded parts by their outline's bounding box, and the property-test header documents it.
  - The mutant that skips extruded parts survives only because the models contain no such overlap. The extruded branch has no unit test, but this is test code, so I am not raising it as a finding.
- **Property test on extra seeds:** seed 42 × 50, plus seeds 7, 2024, 31337 and 4242 × 200 sets × 19 templates, now including the new piece-length check: 115 of 115 passed, with 0 failures.

### New Breakage in the Fix Diff

- **Minor** — `partNames.ts:15`: `'Fixed shelf {n} {piece}'` reads "Fixed shelf 2 3", which is ambiguous in a cut list. The same applies to `'Table top layer {n} {piece}'`. Something like "Fixed shelf 2 (piece 3)" would read clearly. This can be folded into the Task 51 lang work. No template reaches it today.
- No other breakage found.
  - The move of `override_invalid` ahead of the other override issues is documented in `overrides.test.ts:137-138`, and the reordering is harmless.

### Out-of-Scope Observations

None.

### Verdict

**Fix round:** All findings addressed, no new Critical/Important breakage. One new Minor (the piece-name wording) is non-blocking.
