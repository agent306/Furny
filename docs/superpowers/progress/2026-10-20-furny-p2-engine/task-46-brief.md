### Task 46: Cut list CSV

**Files:**
- Create: `resources/js/engine/bom/exportCsv.ts`
- Test: `resources/js/engine/bom/__tests__/exportCsv.test.ts`

**Spec refs:** `08 §8.1`, `07 §11.2`

**Interfaces:**
- Consumes: Tasks 42–43, `PART_NAMES_EN`.
- Produces: `CUT_LIST_CSV_COLUMNS` (19 header names), `cutListCsv(bom: Bom, catalog: CatalogSnapshot, doc: FurnitureDocument): string`, `csvField(value: string | number): string`.

- [ ] **Step 1: Write the failing tests** — wardrobe BOM: output starts with `'﻿'`; lines joined by `\r\n` with a trailing `\r\n`; header exactly `row_no,part_name,qty,material_code,material_name,thickness_mm,length_mm,width_mm,cut_length_mm,cut_width_mm,grain,edge_l1,edge_l2,edge_w1,edge_w2,edge_band_mm,area_m2,part_keys,notes`; 12 data rows; row 1 starts `1,Back panel 2,1,HDF3-WHITE,HDF 3 mm White (one side),3,1978,1180,1978,1180,none,,,,,0,2.334,carcass.back.2,`; row 3 = `3,Left side / Right side,2,PB18-WHITE,PB 18 mm Frosty White,18,2000,582,1999,581,none,EB08-WHITE,,EB08-WHITE,,5164,2.328,carcass.side.left carcass.side.right,` (`edge_band_mm` = qty × Σ banded finished edge lengths, `area_m2` 3 decimals); RFC 4180 quoting for an extra part named `Filler, "left"` → `"Filler, ""left"""`; notes column = `overrides.parts[key].note` and extra-part notes of the row's keys joined with ` | `; a name containing a newline is quoted.
- [ ] **Step 2: Run it, expect FAIL** — `yarn vitest run resources/js/engine/bom/__tests__/exportCsv.test.ts`
- [ ] **Step 3: Implement** — column table of 08 §8.1; decimal separator `.`.
- [ ] **Step 4: Run tests, expect PASS** — same command.
- [ ] **Step 5: Quality gates** — `yarn eslint resources/js/engine && yarn prettier --check resources/js/engine && yarn vue-tsc --noEmit`
- [ ] **Step 6: Commit** — `git add resources/js/engine/bom resources/js/engine/index.ts` → `feat(engine): export cut lists as CSV`

