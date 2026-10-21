### Task 33: Section layout, dividers, shelves/rod/baskets, back panels

**Files:**
- Create: `resources/js/engine/furniture/carcass/layout.ts`, `contents.ts`, `back.ts`, `resources/js/engine/furniture/sheetFit.ts`
- Test: `resources/js/engine/furniture/carcass/__tests__/layout.test.ts`, `contents.test.ts`, `back.test.ts`

**Spec refs:** `07 §3.4` (incl. §3.4.1 split), `§3.7–§3.11`, `§6.7`, `§12.2`, `§12.4` (back split)

**Interfaces:**
- Consumes: Tasks 30, 32.
- Produces: `SectionBoxInfo`, `SectionLabel`, `Divider`, `SectionLayout`, `layoutSections(doc, catalog): SectionLayout` (public), `layoutFromEnvelope(ctx, env): SectionLayout`, `allocate(children, avail): { sizes: number[]; overBy: number | null; adjusted: boolean }`, `dividerParts(ctx, layout)`, `shelvesFor(ctx, leaf, content)`, `rodFor(ctx, leaf, content)`, `basketsFor(ctx, leaf, content)`, `contentDepth(ctx, env, sectionId)`, `backPanels(ctx, env, layout)`, `fitsSheet(a, b, material, grain, trim): boolean`.

- [ ] **Step 1: Write the failing tests** — wardrobe layout: columns 582 / 1164 with partition `section.s_0000000001.partition.1` at `x [600,618]` (part 1964 × 569, `L1` banded, faces 0); rows of `s_0000000003` = 350 / 1596, fixed shelf `y [1714,1732]` (part 1164 × 569); labels `Interior`, `Column 1`, `Column 2 › Row 1`. `allocate`: avail 1000 with three flex 1 → `[334, 333, 333]`; fixed 600 + fixed 500 in 1000 → error `furniture.fixed_sizes_exceed { overBy: 100 }` and proportional fallback sizes; all-fixed children → last treated as flex + info `furniture.fixed_sizes_adjusted`. Shelves (wardrobe `s_0000000002`): 4 parts `section.s_0000000002.shelf.1..4` each 580 × 549, `L1` banded; hardware `section.s_0000000002.shelf_supports` = `SHF-PIN-5 × 16`; `shelfPinHoles` 116 on `carcass.side.left` and 116 on the partition (`pr = 58`); 18 shelves in a 300 mm-high leaf (18 × 18 > 300) → `shelves_dont_fit`; non-adjustable shelves record 2 joints each. Rod (`s_0000000005`): `ROD-OVAL-1200 × 1`, `ROD-SUP × 2`; 1300-wide rod section → 2 pieces and `rod_span_long`; depth 500 → `rod_section_shallow { depth: 500 }`; height 850 → `rod_section_short`. Baskets: `base_cabinet` `basket` variant (leaf 564 wide, 714 high, 529 deep) → `BSK-PULL-600 × 2`, no warning; a 500-wide leaf → `basket_size_mismatch`; count 5 in a 700-high leaf → `baskets_dont_fit`. Back: wardrobe grooved back 1778 × 1978 split at the partition centre x = 609 → `carcass.back.1` 1978 × 598 and `carcass.back.2` 1978 × 1180, info `furniture.back_split { count: 2 }`, no seam warning; `custom_box` 2400 × 2000 × 600, plinth none, nailed HDF3 back → 2 pieces 1200 × 2000 + warning `furniture.back_seam_unsupported { axis: 'x', position: 1200 }` (07 §12.4); `fitsSheet(1978, 1778, HDF3, 'none', 10) === false`, `(2420, 1200, …) === true`.
- [ ] **Step 2: Run it, expect FAIL** — `yarn vitest run resources/js/engine/furniture/carcass`
- [ ] **Step 3: Implement** — 07 §3.7 allocation rules (leftover +1 mm to flex children in order); divider tables §3.8 with geometric joint discovery (face equality within 0.5 mm, positive overlap); §3.9–§3.11; back table §3.4 + greedy split §3.4.1 using `fitsSheet` (`trim = pricing.sheetTrimMm`).
- [ ] **Step 4: Run tests, expect PASS** — same command.
- [ ] **Step 5: Quality gates** — `yarn eslint resources/js/engine && yarn prettier --check resources/js/engine && yarn vue-tsc --noEmit`
- [ ] **Step 6: Commit** — `git add resources/js/engine/furniture resources/js/engine/index.ts` → `feat(engine): lay out sections and generate dividers, shelves, rods and backs`

