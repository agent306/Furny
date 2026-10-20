# 08 — BOM, Cut List, Nesting, Pricing, Quotes & Catalog

Read the master document, `01`, `02`, `03`, `07` and `09` first. `02`/`03` are binding (types `Bom`, `CutListRow`, `NestingResult`, `PriceBreakdown` are defined in `03 §3` and are not repeated except where this file fixes their semantics). Anything this file needs that is not in `02`/`03` is listed in the final appendix.

This file is normative for:

- the `CatalogSnapshot` the engine consumes (§2),
- `computeBom` (§3) and the guillotine nesting algorithm (§5),
- every pricing formula (§4) — identical in browser, worker and engine CLI,
- quote draft generation and quote totals in PHP + TS (§6),
- the seeded starter catalog (§7),
- cut list exports (§8), server execution (§9) and required tests (§10).

**Pipeline** (same code everywhere, `01 §5`):

```
FurnitureDocument ──generateFurniture (07)──► FurnitureModel ──computeBom (§3)──► Bom ──priceBom (§4)──► PriceBreakdown
                                                                   └─ nestSheets (§5) when options.nesting
```

Estimate vs. quote consistency (master §2.1 "≤ 5%"): the default billing mode (`used_area`, §4.2) prices material from net part area, independent of nesting, so a customer estimate and the server quote of an unmodified design are **identical** when computed against the same catalog version. In `whole_sheets` mode the worker also nests (07 §8.10), so they are identical as well.

---

## 0. Files

| File | Exports |
|---|---|
| `resources/js/engine/money.ts` | `roundHalfUpDiv`, `ceilDiv`, `applyBps`, `grossUp`, `netFromGross`, `roundUpToStep`, `costFromHundredths`, `costFromMilli` (§1) |
| `resources/js/engine/catalog/snapshot.ts` | `CatalogSnapshot` + zod `CatalogSnapshotSchema` and sub-types (§2) |
| `resources/js/engine/catalog/specs.ts` | hardware spec zod schemas per category (§2.3) |
| `resources/js/engine/bom/constants.ts` | `EDGE_ALLOWANCE_MM = 50`, `EDGE_WASTE_PERMILLE = 50`, `FINISH_AREA_STEP_MM2 = 10_000` |
| `resources/js/engine/bom/bom.ts` | `computeBom(model, catalog, options)`, `bomOptionsFor(doc, nesting)` (§3) |
| `resources/js/engine/bom/cutSizes.ts` | `cutSize(part, catalog, premillMm)` (§3.2) |
| `resources/js/engine/bom/edgeBanding.ts` | `edgeBandLengths(parts, catalog)` (§3.3) |
| `resources/js/engine/bom/rowKey.ts` | `fnv1a32(str)`, `rowKeyFor(part)` (§3.4) |
| `resources/js/engine/bom/nesting/guillotine.ts` | `nestMaterial()` (§5.3) |
| `resources/js/engine/bom/nesting/index.ts` | `nestSheets()` (§5.4) |
| `resources/js/engine/bom/pricing.ts` | `priceBom(bom, catalog, pricing, options)`, `displayUnitPrice()` (§4) |
| `resources/js/engine/bom/exportCsv.ts` | `cutListCsv(bom, catalog, doc)` (§8.1) |
| `resources/js/lib/quoteTotals.ts` | TS port of `QuoteCalculator` (§6.3) |
| `app/Support/Money/MinorMath.php` | PHP mirror of `money.ts` (§1) |
| `app/Domain/Catalog/Actions/BuildCatalogSnapshot.php` | snapshot builder (§2.4) |
| `app/Domain/Orders/Actions/BuildQuoteDraft.php` | §6.1 |
| `app/Domain/Orders/Support/QuoteCalculator.php` | §6.3 |
| `app/Domain/Furniture/Jobs/ComputeRevisionBom.php` | §9.1 |
| `app/Domain/Furniture/Jobs/RenderCutListPdf.php`, `app/Domain/Furniture/Support/SheetSvgRenderer.php`, `resources/views/pdf/cut-list.blade.php` | §8.2 |
| `database/seeders/CatalogSeeder.php` | §7 |

---

## 1. Integer money & quantity helpers

All money is integer minor units (master §6.4). Quantities that may be fractional are carried as integers in **hundredths** (sheets, metres, m²) or **thousandths** (quote line quantity, `decimal(12,3)`). Every multiplication is done with `BigInt` (TS) / `brick/math` `BigInteger` (PHP) to avoid overflow; results are converted back to `number`/`int` and asserted ≤ `Number.MAX_SAFE_INTEGER`.

```ts
// resources/js/engine/money.ts
/** n / d rounded half away from zero ("HALF_UP" in brick/money). d > 0. Integers only. */
export function roundHalfUpDiv(n: number, d: number): number;
/** ceil(n / d) for n ≥ 0, d > 0. */
export function ceilDiv(n: number, d: number): number;
/** roundHalfUpDiv(amount × bps, 10000) */
export function applyBps(amountMinor: number, bps: number): number;
/** amount incl. tax: roundHalfUpDiv(amount × (10000 + rateBps), 10000) */
export function grossUp(amountMinor: number, rateBps: number): number;
/** net from a tax-inclusive amount: roundHalfUpDiv(gross × 10000, 10000 + rateBps) */
export function netFromGross(grossMinor: number, rateBps: number): number;
/** step ≤ 1 → amount; else ceilDiv(amount, step) × step (amount ≥ 0) */
export function roundUpToStep(amountMinor: number, step: number): number;
/** roundHalfUpDiv(qtyHundredths × unitMinor, 100) */
export function costFromHundredths(qtyHundredths: number, unitMinor: number): number;
/** roundHalfUpDiv(qtyMilli × unitMinor, 1000) */
export function costFromMilli(qtyMilli: number, unitMinor: number): number;
```

`multiplyMinor(amountMinor, factor)` from master §6.4 is implemented as `roundHalfUpDiv(amountMinor × round(factor × 1e6), 1e6)` and is used only for display helpers; pricing uses the functions above exclusively.

PHP `App\Support\Money\MinorMath` exposes the same static methods with identical semantics (`RoundingMode::HALF_UP`, `CEILING`). Shared fixtures `tests/fixtures/money/*.json` (`[{ fn, args, expected }]`) are executed by both Pest and Vitest.

---

## 2. Catalog snapshot (`engine/catalog/snapshot.ts`)

### 2.1 Types

```ts
type BoardType = 'particle_board' | 'mdf' | 'hdf' | 'plywood' | 'blockboard' | 'solid_wood' | 'glass' | 'acrylic' | 'metal_sheet';
type Surface = 'raw' | 'melamine' | 'laminate' | 'veneer' | 'painted' | 'lacquered' | 'pre_laminated';
type HardwareCategory = 'hinge' | 'hinge_plate' | 'drawer_slide' | 'handle' | 'knob' | 'leg' | 'plinth_leg' | 'hanging_rod'
  | 'rod_support' | 'shelf_support' | 'connector' | 'lock' | 'lift_mechanism' | 'sliding_track' | 'sliding_roller'
  | 'gas_strut' | 'damper' | 'screw_pack' | 'wall_bracket' | 'led_strip' | 'other';
type FinishType = 'none' | 'laminate' | 'veneer' | 'paint' | 'pu' | 'lacquer' | 'duco' | 'membrane';
type LabourUnit = 'sheet' | 'meter' | 'part' | 'piece' | 'item' | 'sqm' | 'hour';

interface CatalogMaterial {            // ← materials (02 §6.1)
  id: string; code: string; name: string;
  boardType: BoardType;
  thicknessMm: number;                 // decimal(5,1) as number, e.g. 18, 3, 5
  sheetLengthMm: number; sheetWidthMm: number;
  hasGrain: boolean;
  decorName: string | null; colorHex: string | null;
  textureUrl: string | null;           // public URL of media `texture` (original)
  textureThumbUrl: string | null;      // conversion `small`
  surface: Surface;
  pricePerSheetMinor: number;
  wasteFactor: number;                 // decimal(4,3) as number, e.g. 0.1
  densityKgM3: number | null;
  usage: string[];                     // MaterialRole values + 'glass'
  defaultEdgeBandCode: string | null;
  isActive: boolean;                   // false for archived or soft-deleted rows
  sortOrder: number;
}

interface CatalogEdgeBand {            // ← edge_bands (02 §6.2)
  id: string; code: string; name: string;
  thicknessMm: number;                 // decimal(4,2) as number, e.g. 0.8
  widthMm: number; colorHex: string | null;
  pricePerMeterMinor: number; isActive: boolean;
}

interface CatalogHardware {            // ← hardware_items (02 §6.3)
  id: string; code: string; name: string;
  category: HardwareCategory;
  specs: HardwareSpecs;                // parsed by the category schema (§2.3)
  unit: 'piece' | 'pair' | 'set' | 'meter' | 'pack';
  priceMinor: number;
  isDefaultFor: string[];              // role keys (07 §6.11)
  imageUrl: string | null;             // conversion `thumb`
  isActive: boolean; sortOrder: number;
}

interface CatalogFinish {              // ← finishes (02 §6.4)
  id: string; code: string; name: string; finishType: FinishType;
  pricePerSqmMinor: number; appliesTo: BoardType[];
  colorHex: string | null; textureUrl: string | null; isActive: boolean;
}

interface CatalogLabourRate {          // ← labour_rates (02 §6.5)
  id: string; key: LabourKey; name: string; unit: LabourUnit; rateMinor: number; isActive: boolean;
}

interface CatalogTaxRate {             // ← tax_rates (02 §6.6)
  id: string; name: string; rateBps: number; isDefault: boolean; isActive: boolean;
}

interface PricingSettings {            // ← app_settings 'pricing' (02 §13) + Appendix additions
  pricesIncludeTax: boolean;
  defaultTaxRateId: string | null;
  marginBps: number;
  overheadBps: number;
  minimumOrderMinor: number;
  roundingMinor: number;
  estimateDisclaimerKey: string;
  installationBps: number;
  deliveryFlatMinor: number;
  kerfMm: number;                      // decimal, e.g. 4.0
  sheetTrimMm: number;
  nestingAllowRotationDefault: boolean;
  sheetBillingMode: 'used_area' | 'whole_sheets';   // Appendix (new setting), default 'used_area'
  edgePremillMm: number;                            // Appendix (new setting), integer, default 0
}

interface CatalogSnapshot {
  version: number;                     // app_settings['catalog.version']
  currency: string;                    // business.currency
  generatedAt: string;                 // ISO-8601 UTC
  materials: CatalogMaterial[];        // sorted sortOrder asc, code asc
  edgeBands: CatalogEdgeBand[];        // code asc
  hardware: CatalogHardware[];         // category asc, sortOrder asc, code asc
  finishes: CatalogFinish[];           // code asc
  labourRates: CatalogLabourRate[];    // key asc
  taxRates: CatalogTaxRate[];          // rateBps desc, name asc
  pricing: PricingSettings;
}
```

The snapshot contains **active and inactive (archived) rows, including soft-deleted ones** (flagged `isActive = false`), so that old documents keep resolving codes (`03 §2.4`: archived codes are a warning, not an error). Pickers offer only active rows; pricing uses archived rows' prices as they are (staff see the `archived_code` warning and decide).

### 2.2 Defaults and validation

`CatalogSnapshotSchema` validates all of the above; unknown extra keys are stripped. Numbers that are decimals in the database are serialised as JSON numbers (PHP `(float)` cast of the decimal string); money and lengths as integers.

### 2.3 Hardware specs (`engine/catalog/specs.ts`)

All schemas use `.passthrough()` (extra keys allowed, ignored by the engine). Admin forms (`11`) render these fields per category.

| Category | Spec fields (all optional unless marked *) |
|---|---|
| `hinge` | `overlay`* `'full'\|'half'\|'inset'`, `crankMm` number, `openingAngle` int, `softClose` bool, `cupDiameterMm` (35), `boringDistanceMm` (3–6, default 4), `integratedPlate` bool (default false), `maxDoorWeightKg` number |
| `hinge_plate` | `heightMm` number |
| `drawer_slide` | `type`* `'side_mount'\|'undermount'`, `family`* string, `lengthMm`* int, `loadKg` int, `softClose` bool, `extension` `'full'\|'partial'`, `clearancePerSideMm` (side_mount, 12.7), `innerWidthDeductionMm` (undermount, 42), `lengthDeductionMm` (undermount, 10), `bottomRecessMm` (undermount, 13), `maxSideThicknessMm` (undermount, 16) |
| `handle` | `lengthMm` int, `holeSpacingMm` int, `holeCount` int (default 2), `flush` bool |
| `knob` | `diameterMm` int, `holeCount` int (default 1) |
| `leg` | `heightMm` int, `minHeightMm`/`maxHeightMm` int, `adjustableMm` int, `sectionMm` int |
| `plinth_leg` | `minHeightMm`*, `maxHeightMm`* int |
| `hanging_rod` | `maxLengthMm` int (default 1200), `profile` `'oval'\|'round'` |
| `rod_support`, `lock`, `damper`, `led_strip` | — |
| `shelf_support` | `pinDiameterMm` int |
| `connector` | `kind`* `'cam'\|'dowel'\|'table_corner'\|'confirmat'\|'other'` |
| `lift_mechanism` | `maxFlapWeightKg` number |
| `sliding_track` | `lengthMm`* int, `tracks` 2\|3, `system` `'top_hung'\|'bottom_rolling'` |
| `sliding_roller` | `maxLeafWeightKg` number |
| `gas_strut` | `forceN` int |
| `screw_pack` | `pieces` int |
| `wall_bracket` | `kind` `'hanging'\|'anti_tip'`, `loadKg` int |
| `other` | `kind` string (e.g. `'basket'`), `minInnerWidthMm`, `maxInnerWidthMm`, `minDepthMm` int |

Leg height check (07 §6.6): if `minHeightMm`/`maxHeightMm` present → range check; else `|heightMm − h| ≤ (adjustableMm ?? 0)`.

### 2.4 Server builder and endpoint

`BuildCatalogSnapshot` (Catalog domain) assembles the snapshot from the six tables (`withTrashed()`), the `pricing` and `business` settings, and media URLs; result cached in Redis `catalog:snapshot:{version}` (no TTL; old versions evicted on bump). `GET /api/catalog/snapshot` (`01 §5.3`) returns it with `ETag: "catalog-{version}"` and `Cache-Control: private, max-age=0, must-revalidate`; `304` on match. `PublishCatalogSnapshot` (01) = bump + warm cache. The engine CLI receives the same JSON in its requests.

---

## 3. `computeBom(model, catalog, options): Bom`

```ts
interface ComputeBomOptions {
  nesting: boolean;
  allowRotation?: boolean;                               // default catalog.pricing.nestingAllowRotationDefault
  finishByRole: Record<MaterialRole, string | null>;     // from doc.materials[role].finishCode
}
export function bomOptionsFor(doc: FurnitureDocument, nesting: boolean): ComputeBomOptions;
export function computeBom(model: FurnitureModel, catalog: CatalogSnapshot, options: ComputeBomOptions): Bom;
```

`computeBom` is pure and deterministic. Steps:

### 3.1 Inputs

Overrides are **already applied** by `generateFurniture` (07 §3.14): removed parts are absent, overridden fields are in place, extra parts/hardware are present. `computeBom` never reads `doc.overrides`. Parts with `qty > 1` are expanded into instance keys `key`, `key#2`, `key#3`, … wherever individual instances are needed (nesting).

### 3.2 Cut sizes (`cutSizes.ts`)

Edge band thickness is subtracted from the finished size; an optional pre-mill allowance is added back per banded edge (the edge bander's pre-mill cutter removes it):

```
bandUm(code)  = code ? Math.round(edgeBand(code).thicknessMm × 1000) : 0
pmUm          = pricing.edgePremillMm × 1000           (default 0 ⇒ no pre-mill)
deltaLenUm    = Σ over e ∈ {W1, W2} with edges[e] ≠ null of (bandUm(edges[e]) − pmUm)
deltaWidUm    = Σ over e ∈ {L1, L2} with edges[e] ≠ null of (bandUm(edges[e]) − pmUm)
cutLength     = length − roundHalfUpDiv(deltaLenUm, 1000)
cutWidth      = width  − roundHalfUpDiv(deltaWidUm, 1000)
```

(The short edges W1/W2 sit at the ends of the length axis, so their bands shorten the length.) Decision: `edgePremillMm` defaults to **0** because the target workshops mostly use edge banders without pre-milling; a workshop with pre-milling sets 1. Examples: one 0.8 band → −1 mm; two 0.8 → −2 (1.6 → 2); two 2.0 → −4; two 0.4 → −1; one 0.4 → 0; one 0.8 with pre-mill 1 → 0.

### 3.3 Edge banding (`edgeBanding.ts`)

For every part (× qty) and every edge `e` with a band code `b`:

- edge length = `length` for `L1/L2`, `width` for `W1/W2` (finished sizes);
- raw contribution `= qty × (edgeLength + EDGE_ALLOWANCE_MM)` (50 mm trimming allowance per edge segment).

Parts with `geometry.kind = 'extruded'` (non-rectangular table tops) are treated as one continuous edge: perimeter `P` of the outline (sum of segment lengths), band code = first non-null of `L1, L2, W1, W2`; raw contribution `= qty × (round(P) + EDGE_ALLOWANCE_MM)`.

`Bom.edgeBanding[b].lengthMm = ceilDiv(Σraw × (1000 + EDGE_WASTE_PERMILLE), 1000)` (5% waste), sorted by code. This `lengthMm` therefore **includes** allowance and waste (`03 §3.2`).

### 3.4 Cut list rows (`rowKey.ts`)

1. Row identity string: `${materialCode}|${thickness}|${length}|${width}|${grain}|${[L1,L2].map(x => x ?? '-').sort().join(',')}|${[W1,W2].map(x => x ?? '-').sort().join(',')}` — the two long edges and the two short edges are compared as unordered pairs (a part banded on L2 instead of L1 is the same panel flipped).
2. `rowKey = 'r' + fnv1a32(identity).toString(16).padStart(8, '0')` (32-bit FNV-1a over UTF-16 code units: offset basis `0x811c9dc5`, prime `0x01000193`, `Math.imul`, `>>> 0`). In the (practically impossible) case of two different identities with the same hash, the identity that sorts later gets suffix `-2`, `-3`, ….
3. Parts are grouped by `rowKey`: `partKeys` = sorted keys (each key once; a part with qty 3 contributes its key once and 3 to `qty`), `qty = Σ part.qty`, `nameKey/nameParams/edges/grain/materialCode/thickness/length/width` from the first part (by sorted key), `cutLength/cutWidth` from §3.2.
4. `name` (English): unique English names of the row's parts in key order (`PART_NAMES_EN` with params, 07 §1.6), joined with `" / "`; if more than 3 unique names, the first 3 + `" +{n} more"`. Example: `"Top / Bottom"`, `"Left side / Right side"`, `"Shelf 1 / Shelf 2 / Shelf 3 +1 more"`.
5. Row order: `materialCode` asc, `thickness` desc, `length` desc, `width` desc, `rowKey` asc.

### 3.5 Materials and sheets

Per material code present in the parts (order: code asc):

| Field | Formula |
|---|---|
| `partCount` | `Σ qty` |
| `netAreaMm2` | `Σ length × width × qty` (finished sizes) |
| `sheetsEstimated` | `ceilDiv(netAreaMm2 × (1000 + wasteMilli), sheetArea × 1000)` with `wasteMilli = Math.round(wasteFactor × 1000)`, `sheetArea = sheetLengthMm × sheetWidthMm` |
| `sheetsNested` | `options.nesting && boardType ≠ 'glass' ? number of nested sheets of that material : null` |
| `sheetsBilled` | `sheetsNested ?? sheetsEstimated` (`03`) |
| `utilization` | nesting: `round4(Σ placed cut areas / (sheetsNested × sheetArea))` (0 when no sheet); else `null` |

`round4(x) = Math.round(x × 10000) / 10000`.

### 3.6 Finishing

For each part whose role has a finish (`options.finishByRole[part.role] ≠ null`) and `visibleFaces > 0`: `area = length × width × visibleFaces × qty`. `Bom.finishing` = per finish code, `areaMm2 = Σ area`, code asc, rows with 0 area omitted.

### 3.7 Operations

`Bom.operations[k] = Σ part.operations[k] × part.qty` for `hingeCups, shelfPinHoles, dowels, camLocks, slideScrewSets, handleHoles`.

### 3.8 Hardware

`Bom.hardware` = `model.hardware` merged by `code` (`qty` summed), lines with `qty ≤ 0` dropped, code asc.

### 3.9 Nesting and issues

If `options.nesting`: `Bom.nesting = nestSheets(bom.cutList, partQty, catalog, { kerf: Math.ceil(pricing.kerfMm), trim: pricing.sheetTrimMm, allowRotation: options.allowRotation ?? pricing.nestingAllowRotationDefault })` (§5.4; `partQty` = qty per part key from the model); each unplaced instance → error issue `bom.part_exceeds_sheet` `{ partKey, materialCode }`. Else `Bom.nesting = null`.

`Bom.issues` = `model.issues` followed by BOM issues (deduplicated by `code + entityIds`). `Bom.engineVersion = ENGINE_VERSION`, `Bom.catalogVersion = catalog.version`.

---

## 4. Pricing — `priceBom(bom, catalog, pricing, options): PriceBreakdown`

```ts
interface PriceOptions { quantity: number; includeInstallation: boolean }
export function priceBom(bom: Bom, catalog: CatalogSnapshot, pricing: PricingSettings, options: PriceOptions): PriceBreakdown;
```

Callers: builder estimate `{ quantity: 1, includeInstallation: false }`; server revision BOM (`ComputeRevisionBom`) `{ quantity: 1, includeInstallation: true }` so `installationMinor` is available to quote building; diff (07 §10) `{ quantity: 1, includeInstallation: false }`. `pricing` is normally `catalog.pricing`.

Every `PriceBreakdown.lines[]` entry has `quantity = qtyHundredths / 100` (2 decimals) for fractional units and an integer for count units, `costMinor` computed as below, and `unitCostMinor` = the catalog price. Lines with quantity 0 are omitted. Line order: materials (code asc), edge bands (code asc), hardware (code asc), finishing (code asc), labour (order of the table in §4.3).

### 4.1 Material lines (`kind: 'material'`, unit `sheet`)

Per `bom.materials` row, with material `m`, `sheetArea = m.sheetLengthMm × m.sheetWidthMm`, `wasteMilli = round(m.wasteFactor × 1000)`:

| Case | `qtyH` (hundredths of a sheet) |
|---|---|
| `m.boardType = 'glass'` (always area-billed) or `pricing.sheetBillingMode = 'used_area'` | `ceilDiv(netAreaMm2 × (1000 + wasteMilli) × 100, sheetArea × 1000)` |
| `pricing.sheetBillingMode = 'whole_sheets'` | `sheetsBilled × 100` |

`costMinor = costFromHundredths(qtyH, m.pricePerSheetMinor)`. Description: `"{m.name} ({thickness} mm)"`.

**Decision (billing mode).** Default `used_area`: the customer pays for the area actually used plus the material's waste factor, rounded **up** to 0.01 sheet. Rationale: a workshop reuses off-cuts across jobs, so charging whole sheets per item over-prices small items (a bedside table would pay for a full sheet), and `used_area` makes estimates and quotes identical regardless of whether nesting ran (master §2.1). `whole_sheets` is available for workshops that prefer to bill full sheets; it uses `sheetsBilled` (nested on the server and in the worker). The nesting result is always computed on the server and shown to staff for production planning in both modes.

### 4.2 Edge band, hardware, finishing lines

| Kind | Quantity | Cost |
|---|---|---|
| `edge_band` (unit `m`) | `qtyH = ceilDiv(lengthMm, 10)` (centimetres = hundredths of a metre) | `costFromHundredths(qtyH, pricePerMeterMinor)` |
| `hardware` (unit = item unit) | `qty` (integer) | `qty × priceMinor` |
| `finishing` (unit `sqm`) | `qtyH = ceilDiv(areaMm2, 10_000)` | `costFromHundredths(qtyH, pricePerSqmMinor)` |

Descriptions: edge band `"{name}"`, hardware `"{name}"`, finishing `"{name}"`.

### 4.3 Labour lines (`kind: 'labour'`) — exhaustive key list

`type LabourKey` = the keys below. A key without an active `labour_rates` row is skipped (no line). Quantities are derived only from the `Bom`:

| # | Key | Unit | Quantity (`qtyH` = hundredths) |
|---|---|---|---|
| 1 | `cutting_per_sheet` | sheet | `Σ qtyH` of all **non-glass** material lines (§4.1, same billing mode) |
| 2 | `edge_banding_per_meter` | meter | `Σ qtyH` of all edge band lines |
| 3 | `hinge_cup_boring_each` | piece | `operations.hingeCups` |
| 4 | `drilling_per_hole` | piece | `operations.shelfPinHoles + 2 × operations.dowels + 2 × operations.camLocks + operations.handleHoles` |
| 5 | `assembly_per_part` | part | `Σ row.qty` over cut list rows minus the instances whose key matches `/\.drawer\.\d+\./` or whose material is glass (count each such key × its part qty) |
| 6 | `drawer_assembly_each` | piece | number of part keys matching `/\.drawer\.\d+\.side\.left$/` (one per drawer box; includes slide fitting) |
| 7 | `hinge_install_each` | piece | `Σ qty` of hardware with category `hinge` (plates included) |
| 8 | `hardware_fitting_each` | piece | `Σ qty` of hardware with category ∈ {`handle`, `knob`, `hanging_rod`, `rod_support`, `lock`, `lift_mechanism`, `gas_strut`, `damper`, `leg`, `plinth_leg`, `wall_bracket`, `other`} |
| 9 | `sliding_door_fitting_each` | piece | `Σ qty` of hardware with category `sliding_roller` (one set per leaf) |
| 10 | `glass_fitting_each` | piece | `Σ qty` of cut list rows on glass materials |
| 11 | `finishing_per_sqm` | sqm | `Σ qtyH` of all finishing lines |
| 12 | `packing_per_item` | item | 1 |
| 13 | `installation_per_item` | item | **not a cost line** — minimum installation charge (§4.5) |
| 14 | `general_per_hour` | hour | never generated; available for manual quote lines |

Count units are converted with `qtyH = n × 100`; `costMinor = costFromHundredths(qtyH, rateMinor)`. Description = rate `name`. Drawer slides, shelf supports, connectors and screws have no separate fitting labour (covered by 4, 5, 6).

### 4.4 Totals, overhead, margin, rounding

```
materialCostMinor   = Σ material lines
edgeBandCostMinor   = Σ edge_band lines
hardwareCostMinor   = Σ hardware lines
finishingCostMinor  = Σ finishing lines
labourCostMinor     = Σ labour lines
directCostMinor     = sum of the five
overheadMinor       = applyBps(directCostMinor, pricing.overheadBps)
marginMinor         = applyBps(directCostMinor + overheadMinor, pricing.marginBps)    // markup on full cost
unitPriceMinor      = roundUpToStep(directCostMinor + overheadMinor + marginMinor, pricing.roundingMinor)
```

The rounding difference (`unitPriceMinor − direct − overhead − margin`, `< roundingMinor`) is not reported separately.

### 4.5 Installation and totals

```
installationMinor   = options.includeInstallation
                        ? roundUpToStep(max(applyBps(unitPriceMinor, pricing.installationBps), minInstall), pricing.roundingMinor)
                        : 0
                      where minInstall = active labour rate 'installation_per_item'?.rateMinor ?? 0
quantity            = options.quantity
totalBeforeTaxMinor = (unitPriceMinor + installationMinor) × quantity
currency            = catalog.currency
```

### 4.6 Tax for display and quotes

`PriceBreakdown` amounts are always **excluding tax**. Where a tax-inclusive figure is needed (estimate panel when `pricesIncludeTax`, quote line unit prices):

```ts
export function displayUnitPrice(amountExclMinor: number, pricing: PricingSettings, taxRates: CatalogTaxRate[]): number {
  if (!pricing.pricesIncludeTax) return amountExclMinor;
  const rate = taxRates.find(t => t.id === pricing.defaultTaxRateId)?.rateBps ?? 0;
  return roundUpToStep(grossUp(amountExclMinor, rate), pricing.roundingMinor);
}
```

The estimate panel labels the price "incl. tax" or "excl. tax" accordingly. Amounts entered in settings (`deliveryFlatMinor`, `minimumOrderMinor`) are interpreted in the business's convention (tax-inclusive when `pricesIncludeTax`) and are **not** grossed up.

### 4.7 Worked example (wardrobe fixture, seed catalog, default pricing settings)

Bom (§10.2): PB18-WHITE net area 11 531 232 mm², HDF3-WHITE 3 516 884 mm², EB08-WHITE 32 767 mm, hardware as 07 §12.2, operations hingeCups 12, shelfPinHoles 232, dowels 16, camLocks 16, handleHoles 6.

| Line | Quantity | Unit cost | Cost (minor) |
|---|---|---|---|
| material PB18-WHITE | `ceilDiv(11531232 × 1100 × 100, 2976800 × 1000) = 427` → 4.27 sheet | 215 000 | 918 050 |
| material HDF3-WHITE | 130 → 1.30 sheet | 65 000 | 84 500 |
| edge_band EB08-WHITE | `ceilDiv(32767, 10) = 3277` → 32.77 m | 600 | 19 662 |
| hardware (11 codes) | — | — | 298 400 |
| labour cutting_per_sheet | 5.57 sheet | 15 000 | 83 550 |
| labour edge_banding_per_meter | 32.77 m | 1 200 | 39 324 |
| labour hinge_cup_boring_each | 12 | 1 000 | 12 000 |
| labour drilling_per_hole | 232 + 32 + 32 + 6 = 302 | 100 | 30 200 |
| labour assembly_per_part | 20 | 4 000 | 80 000 |
| labour hinge_install_each | 12 | 2 000 | 24 000 |
| labour hardware_fitting_each | 3 handles + 1 rod + 2 supports + 1 anti-tip = 7 | 2 500 | 17 500 |
| labour packing_per_item | 1 | 30 000 | 30 000 |

Hardware detail: HNG-FO-SC 8 × 12 000 = 96 000; HNG-HO-SC 4 × 12 500 = 50 000; HNG-PLATE-0 12 × 2 500 = 30 000; HDL-BAR-160 3 × 18 000 = 54 000; SHF-PIN-5 16 × 400 = 6 400; ROD-OVAL-1200 22 000; ROD-SUP 2 × 3 000 = 6 000; CON-CAM-15 16 × 900 = 14 400; CON-DOWEL-8 16 × 100 = 1 600; SCR-PACK 12 000; BRK-ANTITIP 6 000.

Totals: material 1 002 550; edge band 19 662; hardware 298 400; finishing 0; labour 316 574; **direct 1 637 186**; overhead (10%) 163 719; margin (35% of 1 800 905) 630 317; raw 2 431 222 → **unitPriceMinor 2 431 300** (₹24,313). Installation (8% = 194 504 ≥ minimum 150 000) → **194 600**. With `pricesIncludeTax = true` and GST 18% the displayed unit price is `roundUpToStep(2 868 934, 100) = 2 869 000`. With `sheetBillingMode = 'whole_sheets'` (5 + 2 nested sheets): material 1 205 000, cutting 105 000, direct 1 861 086, overhead 186 109, margin 716 518, unit price **2 763 800**.

---

## 5. Guillotine nesting (`engine/bom/nesting/`)

### 5.1 Model

- One nesting run per material (glass excluded). Sheet coordinates: `x` along the sheet **length** (= grain direction, `02 §6.1`), `y` along the sheet width, origin at a sheet corner, integer mm.
- Usable area = sheet minus `trim` on every edge: `x ∈ [trim, L − trim]`, `y ∈ [trim, W − trim]`.
- Items are part **instances** with **cut** sizes. Orientation `rotated = false` means the part's length runs along sheet x.
- Grain lock: material `hasGrain` and part `grain = 'length'` → only `rotated = false`; `grain = 'width'` → only `rotated = true`. Otherwise both orientations when `allowRotation`, else only `rotated = false`.
- Kerf (`ceil(pricing.kerfMm)`) is consumed between a part and the leftover on each split axis; parts never get kerf on the usable-area boundary.
- Guillotine property: every free rectangle is produced by splitting a parent free rectangle with one edge-to-edge cut followed by one cut across one of the two pieces; free rectangles are never merged. Every resulting layout can therefore be cut with straight through-cuts (panel saw).
- Placement heuristic: **best area fit** over all free rectangles of all open sheets (lower is better: leftover area, then shorter-side leftover, then lower sheet index, lower y, lower x, unrotated first). A new sheet is opened only when no open sheet fits.
- Split rules: `shorter_leftover_axis` (cut first across the axis with the smaller leftover so the larger leftover stays one big rectangle) and `max_area` (choose the split whose largest resulting free rectangle is larger).
- Four passes (sort ∈ {longest side, area} × split ∈ {SLAS, max area}); the best pass = fewest sheets, then the **smallest used area on the last sheet** (largest reusable off-cut), then pass order.
- Deterministic: stable comparators with explicit tie-breaks, no randomness, no time.
- Performance: 300 parts < 200 ms in the worker (the reference implementation below nests 300 random parts in ≈ 10 ms on Node 22).

### 5.2 Output

`NestingResult` (`03 §3.2`): `sheets[]` in material code order then sheet order; per sheet `placements[]` (`x, y` = min corner of the placed rectangle; `length, width` = the instance's cut length/width **unrotated**; `rotated`), `utilization = round4(Σ placed areas / (L × W))`, `cuts[]` in the order they are made (each split adds its full-width/height first cut, then the second cut). `kerf`, `trim`, `unplaced` (instance keys, sorted).

### 5.3 Reference implementation (`guillotine.ts`) — normative

```ts
type Mm = number; // integer millimetres

export type NestRotation = 'free' | 'length_along_sheet' | 'width_along_sheet';

export interface NestItem {
  rowKey: string;
  partKey: string;       // instance key (key, key#2, …)
  length: Mm;            // cut length
  width: Mm;             // cut width
  rotation: NestRotation;
}
export interface NestSheetSpec { materialCode: string; sheetLength: Mm; sheetWidth: Mm }
export interface NestOptions { kerf: Mm; trim: Mm }
export interface NestPlacement { rowKey: string; partKey: string; x: Mm; y: Mm; length: Mm; width: Mm; rotated: boolean }
export interface NestCut { x1: Mm; y1: Mm; x2: Mm; y2: Mm }
export interface NestedSheet {
  materialCode: string; sheetLength: Mm; sheetWidth: Mm;
  placements: NestPlacement[]; utilization: number; cuts: NestCut[];
}
export interface NestMaterialResult { sheets: NestedSheet[]; unplaced: string[] }

interface FreeRect { x: Mm; y: Mm; w: Mm; h: Mm }          // w along sheet x, h along sheet y
interface Orientation { rotated: boolean; w: Mm; h: Mm }
interface WorkSheet { free: FreeRect[]; placements: NestPlacement[]; cuts: NestCut[]; usedArea: number }
type SortRule = 'longest_side' | 'area';
type SplitRule = 'shorter_leftover_axis' | 'max_area';

export const NEST_PASSES: ReadonlyArray<readonly [SortRule, SplitRule]> = [
  ['longest_side', 'shorter_leftover_axis'],
  ['longest_side', 'max_area'],
  ['area', 'shorter_leftover_axis'],
  ['area', 'max_area'],
];

function compareStr(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }

function sortItems(items: NestItem[], rule: SortRule): NestItem[] {
  return [...items].sort((a, b) => {
    const aMax = Math.max(a.length, a.width), bMax = Math.max(b.length, b.width);
    const aMin = Math.min(a.length, a.width), bMin = Math.min(b.length, b.width);
    if (rule === 'longest_side') {
      if (aMax !== bMax) return bMax - aMax;
      if (aMin !== bMin) return bMin - aMin;
    } else {
      const aArea = a.length * a.width, bArea = b.length * b.width;
      if (aArea !== bArea) return bArea - aArea;
      if (aMax !== bMax) return bMax - aMax;
    }
    return compareStr(a.partKey, b.partKey);
  });
}

function orientations(item: NestItem): Orientation[] {
  const normal: Orientation = { rotated: false, w: item.length, h: item.width };
  const turned: Orientation = { rotated: true, w: item.width, h: item.length };
  if (item.rotation === 'length_along_sheet') return [normal];
  if (item.rotation === 'width_along_sheet') return [turned];
  return item.length === item.width ? [normal] : [normal, turned];
}

interface Choice { sheet: number; rect: number; o: Orientation; areaFit: number; shortFit: number; y: Mm; x: Mm }

function better(a: Choice, b: Choice | null): boolean {
  if (b === null) return true;
  if (a.areaFit !== b.areaFit) return a.areaFit < b.areaFit;
  if (a.shortFit !== b.shortFit) return a.shortFit < b.shortFit;
  if (a.sheet !== b.sheet) return a.sheet < b.sheet;
  if (a.y !== b.y) return a.y < b.y;
  if (a.x !== b.x) return a.x < b.x;
  return !a.o.rotated && b.o.rotated;
}

function findChoice(sheets: WorkSheet[], from: number, os: Orientation[]): Choice | null {
  let best: Choice | null = null;
  for (let s = from; s < sheets.length; s++) {
    const free = sheets[s].free;
    for (let r = 0; r < free.length; r++) {
      const fr = free[r];
      for (const o of os) {
        if (o.w > fr.w || o.h > fr.h) continue;
        const c: Choice = {
          sheet: s, rect: r, o,
          areaFit: fr.w * fr.h - o.w * o.h,
          shortFit: Math.min(fr.w - o.w, fr.h - o.h),
          y: fr.y, x: fr.x,
        };
        if (better(c, best)) best = c;
      }
    }
  }
  return best;
}

function place(sheet: WorkSheet, c: Choice, item: NestItem, kerf: Mm, split: SplitRule, minSide: Mm): void {
  const r = sheet.free[c.rect];
  sheet.free.splice(c.rect, 1);
  const pw = c.o.w, ph = c.o.h;
  sheet.placements.push({
    rowKey: item.rowKey, partKey: item.partKey, x: r.x, y: r.y,
    length: item.length, width: item.width, rotated: c.o.rotated,
  });
  sheet.usedArea += pw * ph;
  const rightW = r.w - pw - kerf;   // leftover along x after the kerf
  const topH = r.h - ph - kerf;     // leftover along y after the kerf
  let horizontalFirst: boolean;     // true: first cut is along x at y = r.y + ph, spanning the full free rect
  if (split === 'shorter_leftover_axis') {
    horizontalFirst = (r.w - pw) < (r.h - ph);
  } else {
    const hBest = Math.max(Math.max(rightW, 0) * ph, r.w * Math.max(topH, 0));
    const vBest = Math.max(Math.max(rightW, 0) * r.h, pw * Math.max(topH, 0));
    horizontalFirst = hBest >= vBest;
  }
  const add = (f: FreeRect): void => { if (f.w >= minSide && f.h >= minSide) sheet.free.push(f); };
  if (horizontalFirst) {
    if (ph < r.h) sheet.cuts.push({ x1: r.x, y1: r.y + ph, x2: r.x + r.w, y2: r.y + ph });
    if (pw < r.w) sheet.cuts.push({ x1: r.x + pw, y1: r.y, x2: r.x + pw, y2: r.y + ph });
    if (topH > 0) add({ x: r.x, y: r.y + ph + kerf, w: r.w, h: topH });
    if (rightW > 0) add({ x: r.x + pw + kerf, y: r.y, w: rightW, h: ph });
  } else {
    if (pw < r.w) sheet.cuts.push({ x1: r.x + pw, y1: r.y, x2: r.x + pw, y2: r.y + r.h });
    if (ph < r.h) sheet.cuts.push({ x1: r.x, y1: r.y + ph, x2: r.x + pw, y2: r.y + ph });
    if (rightW > 0) add({ x: r.x + pw + kerf, y: r.y, w: rightW, h: r.h });
    if (topH > 0) add({ x: r.x, y: r.y + ph + kerf, w: pw, h: topH });
  }
}

interface PassResult { sheets: WorkSheet[]; unplaced: string[] }

function runPass(items: NestItem[], spec: NestSheetSpec, opts: NestOptions, sortRule: SortRule, split: SplitRule): PassResult {
  const usableL = spec.sheetLength - 2 * opts.trim;
  const usableW = spec.sheetWidth - 2 * opts.trim;
  const sorted = sortItems(items, sortRule);
  // free rects smaller than the smallest part side can never be used; dropping them keeps lists short
  const minSide = sorted.reduce((m, i) => Math.min(m, i.length, i.width), Number.POSITIVE_INFINITY);
  const sheets: WorkSheet[] = [];
  const unplaced: string[] = [];
  for (const item of sorted) {
    const os = orientations(item).filter((o) => o.w <= usableL && o.h <= usableW);
    if (os.length === 0) { unplaced.push(item.partKey); continue; }
    let choice = findChoice(sheets, 0, os);
    if (choice === null) {
      sheets.push({ free: [{ x: opts.trim, y: opts.trim, w: usableL, h: usableW }], placements: [], cuts: [], usedArea: 0 });
      choice = findChoice(sheets, sheets.length - 1, os);
      if (choice === null) { unplaced.push(item.partKey); continue; } // unreachable: os fits an empty sheet
    }
    place(sheets[choice.sheet], choice, item, opts.kerf, split, minSide);
  }
  return { sheets, unplaced };
}

export function nestMaterial(items: NestItem[], spec: NestSheetSpec, opts: NestOptions): NestMaterialResult {
  let best: PassResult | null = null;
  for (const [sortRule, split] of NEST_PASSES) {
    const res = runPass(items, spec, opts, sortRule, split);
    if (best === null) { best = res; continue; }
    const a = res.sheets.length, b = best.sheets.length;
    const aLast = a === 0 ? 0 : res.sheets[a - 1].usedArea;
    const bLast = b === 0 ? 0 : best.sheets[b - 1].usedArea;
    if (a < b || (a === b && aLast < bLast)) best = res;
  }
  const out = best as PassResult;
  const sheetArea = spec.sheetLength * spec.sheetWidth;
  return {
    sheets: out.sheets.map((s) => ({
      materialCode: spec.materialCode, sheetLength: spec.sheetLength, sheetWidth: spec.sheetWidth,
      placements: s.placements, cuts: s.cuts,
      utilization: Math.round((s.usedArea / sheetArea) * 10000) / 10000,
    })),
    unplaced: [...out.unplaced].sort(compareStr),
  };
}
```

### 5.4 `nestSheets` wrapper (`nesting/index.ts`)

```ts
export function nestSheets(
  rows: CutListRow[],                       // bom.cutList
  partQty: Map<PartKey, number>,            // qty per part key (from the model)
  catalog: CatalogSnapshot,
  options: { kerf: Mm; trim: Mm; allowRotation: boolean },
): NestingResult;
```

1. Group rows by `materialCode` (code asc); skip materials with `boardType = 'glass'`.
2. For each row and each key in `row.partKeys`, for `k = 1..partQty(key)`: an item `{ rowKey, partKey: k === 1 ? key : key + '#' + k, length: row.cutLength, width: row.cutWidth, rotation }` with `rotation = material.hasGrain && row.grain !== 'none' ? (row.grain === 'length' ? 'length_along_sheet' : 'width_along_sheet') : (allowRotation ? 'free' : 'length_along_sheet')`.
3. `nestMaterial(items, { materialCode, sheetLength: material.sheetLengthMm, sheetWidth: material.sheetWidthMm }, { kerf, trim })`.
4. Concatenate sheets; `unplaced` = all unplaced instance keys sorted; return `{ sheets, kerf, trim, unplaced }`.

---

## 6. Quotes: draft generation and totals

### 6.1 `BuildQuoteDraft` (`app/Domain/Orders/Actions/BuildQuoteDraft.php`)

Invoked by staff with `quotes.create` from the order page ("Create quote") in states `in_review` / `negotiating` (09 §2 "Create/edit quote draft").

1. If the order already has a quote in `draft` → return it unchanged (idempotent; the UI opens it). Staff can call **Rebuild lines from designs** on a draft, which deletes all lines with `kind ∈ {furniture, installation, delivery}` and regenerates them (custom, discount and other manual lines are kept).
2. Every order item must have a pinned revision with `bom_status = 'ready'`; otherwise `409 { code: 'bom_not_ready', items: [...] }` (UI shows "Calculating…" and retries via polling).
3. **Staleness**: for each pinned revision whose `catalog_version ≠ current catalog.version` or `engine_version ≠ current ENGINE_VERSION`, run `RefreshRevisionBom` synchronously (engine CLI `compute-bom`, nesting on, `{ quantity: 1, includeInstallation: true }`) and overwrite the revision's `bom`, `price`, `engine_version`, `catalog_version` (the revision **document** is immutable; its derived BOM may be refreshed; activity `furniture.revision_bom_refreshed`). All quote lines are then built from one catalog version.
4. In one DB transaction create `quotes` row: `version = max + 1`, `number = "{order.number}-Q{version}"`, `status = 'draft'`, `currency = business.currency`, `prices_include_tax = pricing.prices_include_tax`, `valid_until = today(business TZ) + workflow.quote_validity_days`, `terms = business.quote_terms`, `catalog_version`, `engine_version`, `created_by`.
5. Lines (`sort_order` 10, 20, 30, …), with `rate = default tax rate (pricing.default_tax_rate_id)` and `lineUnit(x) = displayUnitPrice(x, pricing, taxRates)` (§4.6):
   1. One `furniture` line per order item (items ordered by `sort_order`, then `created_at`): `order_item_id`; `description = "{design.name} — {W} × {H} × {D} mm"` (dims from the revision document; name truncated so the whole string ≤ 255 chars); `details` (below); `quantity = item.quantity` (as `"n.000"`); `unit = 'item'`; `unit_price_minor = lineUnit(price.unitPriceMinor)`; `tax_rate_id = rate.id`; `is_visible_to_customer = true`.
   2. If `order.needs_installation`: per item with `price.installationMinor > 0`, an `installation` line: `description = "Installation — {design.name}"`, same quantity/unit, `unit_price_minor = lineUnit(price.installationMinor)`, `tax_rate_id = rate.id`.
   3. If `pricing.delivery_flat_minor > 0`: one order-level `delivery` line: `description = "Delivery"` (translation `quotes.lines.delivery` resolved in the business locale), quantity 1, unit `'item'`, `unit_price_minor = delivery_flat_minor` (not grossed up, §4.6), `tax_rate_id = rate.id`.
   4. No discount line.
6. `amount_minor` per line and quote totals via `QuoteCalculator` (§6.3); `cost_snapshot` (§6.5).
7. Activity `quote.draft_created`. No notification (drafts are internal).

`details` JSON of a furniture line (rendered on the PDF and the customer quote page):

```json
{
  "dims": { "width": 1800, "height": 2100, "depth": 600 },
  "templateKey": "wardrobe_hinged",
  "revisionNumber": 3,
  "materials": [
    { "role": "carcass", "label": "Body", "name": "PB 18 mm Frosty White", "edgeBand": "0.8 × 22 Frosty White", "finish": null },
    { "role": "front", "label": "Doors & fronts", "name": "PB 18 mm Frosty White", "edgeBand": "0.8 × 22 Frosty White", "finish": null }
  ],
  "hardware": [ { "name": "Concealed hinge 35 mm, full overlay, soft-close", "qty": 8 } ],
  "fronts": 3, "drawers": 0,
  "thumbnailMediaUuid": "…or null"
}
```

`materials`: roles `carcass`, `front`, `top`, `shelf` that are used by at least one part, deduplicated when identical to `carcass` (shelf) — at most 4 entries; `hardware`: the 5 hardware codes with the highest cost (`qty × price`), ties by code; `fronts` = number of door/flap/sliding leaves; `drawers` = number of drawer boxes.

**Staff edits** after building (09 §5): add/remove/reorder lines, change description, quantity, unit price, tax rate, visibility, a single discount (UI "Discount" field writes/updates one `discount` line with `unit_price_minor = −amount`, `quantity 1`, `tax_rate_id = null`), `valid_until`, `lead_time_days`, notes, terms. Every save re-runs `QuoteCalculator`.

**Revise during negotiation** (09 §6): `DuplicateQuoteAsDraft` copies all lines of the current `sent` quote into a new draft (same `cost_snapshot`); "Rebuild lines from designs" is available there too.

### 6.2 Line validation (FormRequest + `QuoteCalculator::validate`)

- `quantity` > 0, ≤ 9 999 999.999, at most 3 decimals.
- `unit_price_minor` ≥ 0 for every kind except `discount`; `discount` lines: `unit_price_minor ≤ 0` and `tax_rate_id = null`.
- At least one non-discount line.
- Total discount ≤ subtotal (`422 discount_exceeds_subtotal`).
- `tax_rate_id` must reference an active tax rate (or null).

### 6.3 `QuoteCalculator` (PHP) and `quoteTotals.ts` (TS) — identical formulas

Inputs per line: `kind`, `quantity` (decimal string), `unitPriceMinor`, `taxRateId` (nullable) and that rate's `rateBps` (0 for null); `pricesIncludeTax` from the quote.

```
qtyMilli_i   = exact decimal × 1000 (string parse, no floats)
amount_i     = costFromMilli(qtyMilli_i, unitPriceMinor_i)            // HALF_UP; stored in quote_lines.amount_minor
S            = Σ amount_i over kind ≠ discount                         // subtotal_minor
D            = − Σ amount_i over kind = discount  (≥ 0)                 // discount_minor
groups g     = non-discount lines grouped by taxRateId (null = its own group, rate 0); S_g = Σ amounts
allocation   = if S = 0 → all 0; else base_g = floor(D × S_g / S), r_g = (D × S_g) mod S;
               left = D − Σ base_g; give +1 to the `left` groups with the largest r_g
               (ties: taxRateId asc, null group last); alloc_g = base_g (+1)
taxable_g    = S_g − alloc_g
exclusive:   tax_g = applyBps(taxable_g, rate_g);   net_g = taxable_g;              total = S − D + Σ tax_g
inclusive:   net_g = netFromGross(taxable_g, rate_g); tax_g = taxable_g − net_g;      total = S − D
tax_minor    = Σ tax_g;  total_minor = total
tax_breakdown = groups with taxRateId ≠ null, ordered rateBps desc, name asc:
               [{ taxRateId, name, rateBps, taxableMinor: net_g, taxMinor: tax_g }]
```

`quotes.discount_minor` is therefore **derived** from discount lines (Appendix). Rounding happens only at line level (`amount_i`), per tax group (`tax_g`, `net_g`) and in the allocation; totals are sums of rounded values (master §6.4).

Shared fixtures `tests/fixtures/quotes/*.json` (`{ pricesIncludeTax, lines: [...], expected: { subtotal, discount, tax, total, taxBreakdown, amounts } }`) are run by Pest against `QuoteCalculator` and by Vitest against `quoteTotals.ts`. Required fixtures: §10.6.

### 6.4 Hidden lines (`is_visible_to_customer = false`)

Hidden lines count in all totals and in the tax breakdown. Customer-facing renderings (quote page, PDF) bundle them:

- hidden line with `order_item_id` → its amount is added to the displayed amount of the **visible `furniture` line of the same item** (displayed unit price = bundled amount ÷ quantity, rounded half up, shown only when quantity is an integer; otherwise only the amount is shown);
- hidden order-level lines (no item, or no visible furniture line for the item) → summed into one row "Other charges" (`quotes.other_charges`).

Staff views always show every line with an "internal" badge on hidden ones.

### 6.5 `cost_snapshot` (staff-only)

```json
{
  "catalogVersion": 12, "engineVersion": "1.0.0", "builtAt": "2026-10-20T10:15:00Z",
  "items": [{
    "orderItemId": "01J…", "revisionId": "01J…", "quantity": 1,
    "materialCostMinor": 1002550, "edgeBandCostMinor": 19662, "hardwareCostMinor": 298400,
    "finishingCostMinor": 0, "labourCostMinor": 316574, "directCostMinor": 1637186,
    "overheadMinor": 163719, "marginMinor": 630317, "unitPriceMinor": 2431300, "installationMinor": 194600
  }],
  "totals": { "directCostMinor": 1637186, "overheadMinor": 163719, "marginMinor": 630317, "priceExclTaxMinor": 2625900 }
}
```

`totals` multiply per-item values by `quantity`; `priceExclTaxMinor` includes installation only when the order needs installation. The staff quote editor shows "Effective margin" = `subtotal excl. tax − discount − Σ(direct + overhead)` (subtotal converted to excl. tax with `netFromGross` per group when `prices_include_tax`) and its percentage of cost; a warning appears when it is below 10%.

---

## 7. Catalog seed (`CatalogSeeder`, 02 §14)

**All prices are placeholders** (INR, plausible for India in 2026) that the owner must review in Admin → Catalog before going live; the seeder prints a console warning and the admin dashboard shows a dismissible banner "Review the starter catalog prices" until any catalog row is edited. Amounts below are in rupees; store `× 100` in `*_minor`. Materials and finishes have no textures (colour only) until the owner uploads them. `TaxRatesSeeder` (02 §14) seeds tax rates separately.

### 7.1 Materials (`materials`)

| sort | code | name | board_type | thick | sheet L × W | grain | decor | colour | surface | ₹/sheet | waste | density | usage | default band |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 10 | PB18-WHITE | PB 18 mm Frosty White | particle_board | 18.0 | 2440 × 1220 | no | Frosty White | #F4F4F2 | pre_laminated | 2,150 | 0.100 | 650 | carcass, shelf, front, top, plinth | EB08-WHITE |
| 20 | PB18-OAK | PB 18 mm Natural Oak | particle_board | 18.0 | 2440 × 1220 | **yes** | Natural Oak | #C8A27A | pre_laminated | 2,650 | 0.120 | 650 | carcass, shelf, front, top, plinth | EB08-OAK |
| 30 | PB18-ANTH | PB 18 mm Anthracite | particle_board | 18.0 | 2800 × 2070 | no | Anthracite | #3B3E42 | pre_laminated | 4,600 | 0.100 | 650 | carcass, shelf, front, top, plinth | EB08-ANTH |
| 40 | PB25-WHITE | PB 25 mm Frosty White | particle_board | 25.0 | 2800 × 2070 | no | Frosty White | #F4F4F2 | pre_laminated | 5,200 | 0.100 | 630 | shelf, top | EB10-WHITE-28 |
| 50 | MDF18-RAW | MDF 18 mm (for paint / PU) | mdf | 18.0 | 2440 × 1220 | no | — | #C9B79C | raw | 2,400 | 0.100 | 750 | front, carcass, shelf, top | — |
| 60 | MDF18-GLOSS-WHITE | MDF 18 mm High-gloss White | mdf | 18.0 | 2440 × 1220 | no | Gloss White | #FAFAFA | laminate | 4,200 | 0.120 | 750 | front | EB20-WHITE |
| 70 | PLY18-BWR | Plywood 18 mm BWR | plywood | 18.0 | 2440 × 1220 | no | — | #D9B98C | raw | 3,400 | 0.100 | 600 | carcass, shelf, front, top, plinth | — |
| 80 | PLY12-BWR | Plywood 12 mm BWR | plywood | 12.0 | 2440 × 1220 | no | — | #D9B98C | raw | 2,500 | 0.100 | 600 | drawer_box | — |
| 90 | HDF3-WHITE | HDF 3 mm White (one side) | hdf | 3.0 | 2440 × 1220 | no | White | #F2F2F0 | melamine | 650 | 0.100 | 900 | back, drawer_bottom | — |
| 100 | PLY6-BWR | Plywood 6 mm BWR | plywood | 6.0 | 2440 × 1220 | no | — | #D9B98C | raw | 1,250 | 0.100 | 600 | back, drawer_bottom | — |
| 110 | GLASS5-CLEAR | Toughened glass 5 mm, clear | glass | 5.0 | 2440 × 1830 | no | Clear | #DDEFF2 | raw | 5,800 | 0.050 | 2500 | glass | — |
| 120 | SW50-RUBBER | Rubberwood 50 mm (legs, frames) | solid_wood | 50.0 | 2440 × 300 | **yes** | Rubberwood | #D2B48C | raw | 4,500 | 0.150 | 700 | leg | — |

Resulting role defaults (07 §2.3): carcass/shelf/front/top/plinth → PB18-WHITE; back & drawer_bottom → HDF3-WHITE; drawer_box → PLY12-BWR; leg → SW50-RUBBER.

### 7.2 Edge bands (`edge_bands`)

| code | name | thickness | width | colour | ₹/m |
|---|---|---|---|---|---|
| EB04-WHITE | 0.4 × 22 White | 0.40 | 22 | #F4F4F2 | 3.00 |
| EB08-WHITE | 0.8 × 22 Frosty White | 0.80 | 22 | #F4F4F2 | 6.00 |
| EB20-WHITE | 2.0 × 22 White | 2.00 | 22 | #F7F7F5 | 14.00 |
| EB10-WHITE-28 | 1.0 × 28 White (25 mm boards) | 1.00 | 28 | #F4F4F2 | 10.00 |
| EB08-OAK | 0.8 × 22 Natural Oak | 0.80 | 22 | #C8A27A | 8.00 |
| EB20-OAK | 2.0 × 22 Natural Oak | 2.00 | 22 | #C8A27A | 18.00 |
| EB08-ANTH | 0.8 × 22 Anthracite | 0.80 | 22 | #3B3E42 | 7.00 |
| EB20-ANTH | 2.0 × 22 Anthracite | 2.00 | 22 | #3B3E42 | 16.00 |

### 7.3 Hardware (`hardware_items`) — 40 rows, `sort_order` = row number × 10

| code | name | category | unit | ₹ | specs | is_default_for |
|---|---|---|---|---|---|---|
| HNG-FO-SC | Concealed hinge 35 mm, full overlay, soft-close, 110° | hinge | piece | 120 | `{overlay:'full', crankMm:0, openingAngle:110, softClose:true, cupDiameterMm:35, boringDistanceMm:4, integratedPlate:false}` | hinge.full_overlay |
| HNG-HO-SC | Concealed hinge 35 mm, half overlay (cranked), soft-close | hinge | piece | 125 | `{overlay:'half', crankMm:9.5, openingAngle:110, softClose:true, cupDiameterMm:35, boringDistanceMm:4}` | hinge.half_overlay |
| HNG-IN-SC | Concealed hinge 35 mm, inset (heavy crank), soft-close | hinge | piece | 135 | `{overlay:'inset', crankMm:16, openingAngle:110, softClose:true, cupDiameterMm:35, boringDistanceMm:4}` | hinge.inset |
| HNG-PLATE-0 | Clip mounting plate 0 mm | hinge_plate | piece | 25 | `{heightMm:0}` | hinge_plate.default |
| SLD-BB-250 … SLD-BB-600 (8 rows: 250, 300, 350, 400, 450, 500, 550, 600) | Ball-bearing slide 45 mm, full extension, soft-close, {L} mm | drawer_slide | pair | 350, 380, 420, 460, 500, 550, 600, 650 | `{type:'side_mount', family:'bb45', lengthMm:L, loadKg:35, softClose:true, extension:'full', clearancePerSideMm:12.7}` | SLD-BB-450 only: slide.side_mount |
| SLD-UM-350, SLD-UM-400, SLD-UM-450, SLD-UM-500 | Undermount concealed slide, soft-close, {L} mm | drawer_slide | pair | 1,400, 1,500, 1,600, 1,750 | `{type:'undermount', family:'um', lengthMm:L, loadKg:30, softClose:true, extension:'full', innerWidthDeductionMm:42, lengthDeductionMm:10, bottomRecessMm:13, maxSideThicknessMm:16}` | SLD-UM-450 only: slide.undermount |
| HDL-BAR-160 | Bar handle, stainless steel, 160 mm (128 c/c) | handle | piece | 180 | `{lengthMm:160, holeSpacingMm:128, holeCount:2}` | handle.default |
| HDL-BAR-320 | Bar handle, stainless steel, 320 mm (288 c/c) | handle | piece | 320 | `{lengthMm:320, holeSpacingMm:288, holeCount:2}` | — |
| HDL-FLUSH | Flush pull for sliding doors | handle | piece | 150 | `{lengthMm:100, holeSpacingMm:0, holeCount:0, flush:true}` | handle.flush |
| KNB-ROUND-30 | Round knob 30 mm | knob | piece | 90 | `{diameterMm:30, holeCount:1}` | knob.default |
| LEG-PLINTH-100 | Adjustable plinth leg 95–150 mm | plinth_leg | piece | 45 | `{minHeightMm:95, maxHeightMm:150}` | leg.plinth |
| LEG-CAB-ADJ | Cabinet leg, metal, adjustable 100–160 mm | leg | piece | 350 | `{minHeightMm:100, maxHeightMm:160, sectionMm:40}` | leg.cabinet |
| LEG-TBL-710 | Table leg, steel 60 × 60, 710 mm (+15 adjustable) | leg | piece | 1,200 | `{heightMm:710, adjustableMm:15, sectionMm:60}` | leg.table |
| ROD-OVAL-1200 | Wardrobe oval rod 30 × 15 mm, cut to ≤ 1200 mm | hanging_rod | piece | 220 | `{maxLengthMm:1200, profile:'oval'}` | rod.default |
| ROD-SUP | Oval rod end support | rod_support | piece | 30 | `{}` | rod_support.default |
| SHF-PIN-5 | Shelf support pin 5 mm | shelf_support | piece | 4 | `{pinDiameterMm:5}` | shelf_support.default |
| CON-CAM-15 | Cam lock 15 mm with connecting bolt | connector | piece | 9 | `{kind:'cam'}` | connector.cam |
| CON-DOWEL-8 | Wooden dowel 8 × 35 mm | connector | piece | 1 | `{kind:'dowel'}` | connector.dowel |
| CON-TBL-CORNER | Table corner bracket with hanger bolt | connector | piece | 85 | `{kind:'table_corner'}` | connector.table_corner |
| BRK-WALL-HANG | Adjustable cabinet hanging bracket with rail | wall_bracket | piece | 160 | `{kind:'hanging', loadKg:65}` | wall_bracket.default |
| BRK-ANTITIP | Anti-tip wall fixing kit (2 brackets) | wall_bracket | set | 60 | `{kind:'anti_tip'}` | anti_tip.default |
| TRK-SLD-2T-3000 | Sliding wardrobe track set, 2-track top + bottom, 3000 mm | sliding_track | set | 2,800 | `{lengthMm:3000, tracks:2, system:'bottom_rolling'}` | sliding_track.default |
| ROL-SLD-SET | Sliding door roller set (2 rollers + top guides), per leaf | sliding_roller | set | 650 | `{maxLeafWeightKg:60}` | sliding_roller.default |
| GAS-80N | Gas strut 80 N for lift-up flaps | gas_strut | piece | 150 | `{forceN:80}` | gas_strut.default |
| LFT-STAY-SC | Soft-down flap stay | lift_mechanism | piece | 380 | `{maxFlapWeightKg:8}` | lift.default |
| BSK-PULL-600 | Pull-out wire basket with slides (600 mm cabinet) | other | piece | 2,200 | `{kind:'basket', minInnerWidthMm:550, maxInnerWidthMm:570, minDepthMm:450}` | basket.default |
| SCR-PACK | Assembly screw pack (100 pcs, assorted) | screw_pack | pack | 120 | `{pieces:100}` | screw_pack.default |
| LCK-CAM-20 | Cupboard cam lock 20 mm | lock | piece | 110 | `{}` | lock.default |
| DMP-PUSH | Push-in door damper | damper | piece | 40 | `{}` | — |
| LED-STRIP-12V | LED strip 12 V warm white | led_strip | meter | 250 | `{}` | led_strip.default |

Every role key of 07 §6.11 is assigned exactly once.

### 7.4 Finishes (`finishes`)

| code | name | finish_type | ₹/m² | applies_to | colour |
|---|---|---|---|---|---|
| FIN-LAM-MATT | Laminate 1 mm, matt (per face) | laminate | 450 | particle_board, mdf, plywood, blockboard | — |
| FIN-VENEER-TEAK | Teak veneer with PU clear coat | veneer | 1,400 | plywood, mdf, blockboard | #A0703C |
| FIN-PU-MATT | PU paint, matt | pu | 1,100 | mdf | — |
| FIN-PU-GLOSS | PU paint, high gloss | pu | 1,600 | mdf | — |
| FIN-DUCO | Duco paint | duco | 900 | mdf, plywood | — |
| FIN-MEMBRANE | PVC membrane (3D foil) | membrane | 1,000 | mdf | — |

### 7.5 Labour rates (`labour_rates`) — all 14 keys of §4.3

| key | name | unit | ₹ |
|---|---|---|---|
| cutting_per_sheet | Panel cutting | sheet | 150 |
| edge_banding_per_meter | Edge banding | meter | 12 |
| hinge_cup_boring_each | Hinge cup boring | piece | 10 |
| drilling_per_hole | Drilling (shelf pins, dowels, cams, handles) | piece | 1 |
| assembly_per_part | Assembly per panel | part | 40 |
| drawer_assembly_each | Drawer assembly incl. slides | piece | 250 |
| hinge_install_each | Hinge installation & adjustment | piece | 20 |
| hardware_fitting_each | Hardware fitting (handles, rods, legs, brackets…) | piece | 25 |
| sliding_door_fitting_each | Sliding door fitting per leaf | piece | 400 |
| glass_fitting_each | Glass panel fitting | piece | 200 |
| finishing_per_sqm | Finishing labour | sqm | 200 |
| packing_per_item | Packing & handling per item | item | 300 |
| installation_per_item | Minimum installation charge per item | item | 1,500 |
| general_per_hour | General labour (manual quote lines) | hour | 300 |

### 7.6 Seeder behaviour

Idempotent: `updateOrCreate` by `code` / `key`; existing rows are **not** overwritten in production (`--force-catalog` option of `db:seed --class=CatalogSeeder` to reset). Bumps `catalog.version` once at the end.

---

## 8. Cut list exports

### 8.1 CSV (`cutListCsv(bom, catalog, doc): string`, engine)

- Encoding UTF-8 **with BOM**, line endings CRLF, separator `,`, RFC 4180 quoting (fields containing `,`, `"`, CR or LF are quoted; `"` doubled). Decimal separator `.`. One header row then one row per `CutListRow` in cut list order.
- Columns (exact header names):

| Column | Value |
|---|---|
| `row_no` | 1-based |
| `part_name` | `row.name` |
| `qty` | `row.qty` |
| `material_code` | |
| `material_name` | catalog name |
| `thickness_mm` | |
| `length_mm`, `width_mm` | finished |
| `cut_length_mm`, `cut_width_mm` | §3.2 |
| `grain` | `length` / `width` / `none` |
| `edge_l1`, `edge_l2`, `edge_w1`, `edge_w2` | band code or empty |
| `edge_band_mm` | `qty × Σ banded edge lengths` (finished, no allowance/waste) |
| `area_m2` | `length × width × qty / 1e6`, 3 decimals |
| `part_keys` | keys joined with a space |
| `notes` | `doc.overrides.parts[key].note` and extra-part notes of the row's keys, joined with ` \| ` |

- File names: builder (working copy) `cutlist-{slug}-working.csv`; revision `cutlist-{slug}-r{number}.csv`.
- Server route `admin.furniture-revisions.cutlist.csv` (GET, staff `furniture.export_cutlist`; revision `bom_status = ready` else 409) calls engine CLI command `cutlist-csv` (Appendix) with `{ bom, catalog, document }` and streams the result (`text/csv; charset=utf-8`).

### 8.2 PDF (Gotenberg, `RenderCutListPdf`, queue `pdf`)

- Trigger: `POST admin.furniture-revisions.cutlist.pdf.store` (staff `furniture.export_cutlist`, revision BOM ready) → dispatches the job (unique per revision + catalog version) → `202 { status: 'queued' }`. `GET admin.furniture-revisions.cutlist.pdf.show` → `302` to a 15-minute signed URL when ready, `202 { status: 'queued' | 'rendering' }` while pending, `409 { status: 'failed' }` after failure. The builder polls every 3 s (max 2 min).
- The job renders `resources/views/pdf/cut-list.blade.php` with spatie/laravel-pdf (Gotenberg driver, A4 **landscape**, margins 12 mm, `printBackground`), stores it in the revision's media collection `cutlist_pdf` (Appendix; single file, s3 private) named `CutList-{design-slug}-r{number}.pdf`. Fonts: `@font-face` from `public/fonts` (same font as the UI, embedded via absolute file URL).
- Layout (sections in order, each starting on a new page where noted):
  1. **Header** (every page): business logo + name, "Cut list", design name, revision number and date, order number if the revision is pinned by an order item, overall dims, `engine_version`/`catalog_version`, generation time (business TZ); footer "Page x of y".
  2. **Summary**: design thumbnail (left, 80 mm), notes; per material table (code, name, thickness, parts, net area m², sheets nested, sheets billed, utilisation %); edge banding totals (code, name, thickness × width, metres incl. allowance and waste); total parts; estimated weight; operations (hinge cups, shelf-pin holes, dowels, cam locks, handle holes, slide screw sets).
  3. **Cut list table** (new page): `#`, part name, qty, material, T, finished L × W, cut L × W, grain arrow (↔ along length, ↕ along width, — none), edges as four small cells L1 L2 W1 W2 with a legend mapping band codes to short letters (A, B, C… in code order), notes; part keys in small grey text under the name. Rows grouped by material with a material sub-header.
  4. **Sheet diagrams** (new page; two sheets per page): one inline SVG per nested sheet produced by `SheetSvgRenderer::render(array $sheet, array $rowNumbers): string` — width 260 mm (height proportional), sheet outline, trim band hatched light grey, each placement as a rectangle filled with a pastel colour per row number (deterministic palette by row number), label `#{row}` + `L × W` (cut size) centred (omitted if the rectangle is < 60 × 30 mm on paper scale — then only `#{row}`), a small ↻ marker on rotated parts, cut lines dashed red with sequence numbers at their start, caption "Sheet n of m — {material} — utilisation {u}%".
  5. **Hardware list**: code, name, qty, unit, reason summary (from the model's hardware lines merged by code).
- The PDF contains **no prices** (it is a production document).

### 8.3 Who can export

| Export | Customer (own design) | Staff |
|---|---|---|
| GLB (07 §11.3) | yes | yes |
| Cut list CSV / PDF | no | `furniture.export_cutlist` |

---

## 9. Server execution

### 9.1 `ComputeRevisionBom` (queue `engine`, tries 2, timeout 120 s, `ShouldBeUnique` by revision id)

1. Load the revision and `BuildCatalogSnapshot`.
2. Engine CLI `compute-bom` with `{ document, catalog, options: { nesting: true, price: { quantity: 1, includeInstallation: true } } }` (the CLI builds `finishByRole` from the document via `bomOptionsFor`).
3. Store `bom`, `price`, `engine_version`, `catalog_version`, `bom_status = 'ready'`; broadcast `RevisionCreated` refresh on `furniture-designs.{designId}` (01 §8) so open pages update.
4. On final failure: `bom_status = 'failed'`, activity log with the CLI error; staff see "BOM failed — Retry" (re-dispatch).

### 9.2 Engine CLI `compute-bom` contract (refines 01 §5.4)

Request `{ document, catalog, options: { nesting: boolean, allowRotation?: boolean, price?: { quantity: number, includeInstallation: boolean } } }` (`price` default `{ quantity: 1, includeInstallation: true }`); response `{ bom: Bom, price: PriceBreakdown, engineVersion }`. The CLI migrates and parses the document and catalog with zod first (`invalid_input` error on failure).

### 9.3 Performance budgets

| Operation | Budget |
|---|---|
| `computeBom` without nesting, 60 parts | ≤ 10 ms |
| `nestSheets`, 300 parts | < 200 ms (worker), reference ≈ 10 ms |
| Worker `estimateFurniture` (generate + BOM + nesting + price), 60 parts | ≤ 100 ms p95 |
| Engine CLI `compute-bom` incl. Node start, 60 parts | ≤ 1.5 s |

---

## 10. Required tests

Engine tests live in `resources/js/engine/bom/__tests__/`; PHP tests in `tests/Unit/Pricing` and `tests/Feature/Quotes`.

### 10.1 Money helpers (shared fixtures, TS + PHP)

`roundHalfUpDiv(5, 2) = 3`, `(−5, 2) = −3`, `(4, 2) = 2`, `(1, 3) = 0`, `(2, 3) = 1`; `applyBps(1637186, 1000) = 163719`; `applyBps(1800905, 3500) = 630317`; `roundUpToStep(2431222, 100) = 2431300`; `roundUpToStep(2431200, 100) = 2431200`; `roundUpToStep(123, 1) = 123`; `grossUp(2431300, 1800) = 2868934`; `netFromGross(2541895, 1800) = 2154148`; `ceilDiv(32767, 10) = 3277`; `costFromHundredths(427, 215000) = 918050`; `costFromMilli(1500, 999) = 1499` (1498.5 → half up).

### 10.2 Wardrobe fixture BOM (`wardrobe-3door.json`, seed catalog, default settings, nesting on)

- **Cut list**: 12 rows. HDF3-WHITE: `1978 × 1180` (qty 1), `1978 × 598` (qty 1). PB18-WHITE (cut sizes): sides `2000 × 582 → 1999 × 581` qty 2 (name "Left side / Right side"); door `1997 × 606 → 1995 × 604` qty 1; doors `1997 × 593 → 1995 × 591` qty 2; partition `1964 × 569 → 1964 × 568`; plinth front `1800 × 100 → 1798 × 100` and plinth back `1800 × 100 → 1800 × 100` (these two tie on finished size; their relative order follows `rowKey`, so tests compare that pair as a set); top/bottom `1764 × 582 → 1764 × 581` qty 2 ("Top / Bottom"); fixed shelf `1164 × 569 → 1164 × 568`; shelves `580 × 549 → 580 × 548` qty 4; plinth returns `526 × 100` qty 3.
- **Edge banding**: `[{ edgeBandCode: 'EB08-WHITE', lengthMm: 32767 }]` (raw 31 206 = 26 banded edges incl. 26 × 50 mm allowance; × 1.05 ceil).
- **Materials**: HDF3-WHITE `{ partCount: 2, netAreaMm2: 3516884, sheetsEstimated: 2, sheetsNested: 2, sheetsBilled: 2, utilization: 0.5907 }`; PB18-WHITE `{ partCount: 18, netAreaMm2: 11531232, sheetsEstimated: 5, sheetsNested: 5, sheetsBilled: 5, utilization: 0.7727 }` (Σ cut areas 11 501 340).
- **Operations**: `{ hingeCups: 12, shelfPinHoles: 232, dowels: 16, camLocks: 16, slideScrewSets: 0, handleHoles: 6 }`.
- **Hardware**: 11 codes with quantities of 07 §12.2 merged (HNG-FO-SC 8, HNG-HO-SC 4, HNG-PLATE-0 12, HDL-BAR-160 3, …).
- **Nesting** (kerf 4, trim 10, rotation allowed) — exact placements (`x, y, rotated`):
  - PB sheet 1 (util 0.7803): side.left (10, 10), side.right (10, 595).
  - PB sheet 2 (0.8009): `front.fr_0000000001.leaf.1` (10, 10), `front.fr_0000000002.leaf.1` (10, 618).
  - PB sheet 3 (0.7708): `front.fr_0000000002.leaf.2` (10, 10), partition (10, 605).
  - PB sheet 4 (0.6073): plinth.back (10, 10), plinth.front (10, 114), carcass.bottom (10, 218), shelf.1 (1778, 218), plinth.return.1 (1814, 10), plinth.return.2 (1812, 114).
  - PB sheet 5 (0.9044): carcass.top (10, 10), fixed_shelf.1 (1778, 10, rotated), shelf.2 (10, 595, rotated), shelf.3 (562, 595, rotated), shelf.4 (1114, 595, rotated), plinth.return.3 (1666, 595, rotated).
  - HDF sheet 1 (0.7841): back.2 (10, 10); HDF sheet 2 (0.3974): back.1 (10, 10).
- **Price** (`used_area`, `{ quantity: 1, includeInstallation: true }`): exactly the figures of §4.7 — `materialCostMinor 1002550`, `edgeBandCostMinor 19662`, `hardwareCostMinor 298400`, `finishingCostMinor 0`, `labourCostMinor 316574`, `directCostMinor 1637186`, `overheadMinor 163719`, `marginMinor 630317`, `unitPriceMinor 2431300`, `installationMinor 194600`, `totalBeforeTaxMinor 2625900`. `whole_sheets` → `unitPriceMinor 2763800`. `displayUnitPrice` with tax-inclusive pricing → `2869000`.
- **Estimate = quote**: the same document priced with `nesting: false` gives the identical `PriceBreakdown` in `used_area` mode.

### 10.3 Cut size and banding unit tests

Cases of §3.2 (0.8 → −1; 2 × 0.8 → −2; 2 × 2.0 → −4; 2 × 0.4 → −1; 0.4 → 0; pre-mill 1 + 0.8 → 0; pre-mill 1 + 2 × 2.0 → −2). Extruded round top Ø 1000 banded → raw `round(P) + 50` with `P` = perimeter of the 64-gon (`= 64 × 1000 × sin(π/64)` ≈ 3140.3 → 3140), length `ceilDiv(3190 × 1050, 1000) = 3350` (`3349.5` → ceil 3350).

### 10.4 Nesting unit tests (exact)

| Case | Sheet / kerf / trim | Items (length × width, rotation) | Expected |
|---|---|---|---|
| A | 1000 × 500 / 4 / 0 | a 600 × 300, b 396 × 300, c 1000 × 196 (free) | 1 sheet, util 0.9896; c (0, 0), a (0, 200), b (604, 200); cuts `[{0,196,1000,196}, {600,200,600,500}]` |
| B | 1000 × 800 / 4 / 10 | a 700 × 400 `length_along_sheet`, b 700 × 400 `width_along_sheet` | 2 sheets (util 0.35 each); a (10, 10) unrotated; b (10, 10) rotated |
| C | 2440 × 1220 / 4 / 10 | big 2500 × 500 | 0 sheets, `unplaced = ['big']` |
| D | 2440 × 1220 / 4 / 10 | four 1208 × 598 | 1 sheet (util 0.9707): a (10, 10), b (10, 612), c (1222, 10), d (1222, 612) |
| D′ | same | three 1208 × 598 + one 1209 × 598 | 2 sheets (kerf makes 1209 + 4 + 1208 > 2420) |

Plus property tests (seeded random sets of 1–300 parts): every placement inside the usable area; no two placements closer than `kerf` when overlapping in projection; every placed instance appears exactly once; grain-locked items never in the forbidden orientation; identical input → identical output (deep equal) across 3 runs; 300 parts < 200 ms.

### 10.5 Pricing unit tests

Each labour quantity rule of §4.3 with a minimal BOM; inactive rate → no line; glass material priced by area even in `whole_sheets`; installation minimum (`unitPrice 100000`, 8% = 8000 < 150000 → 150000); `roundingMinor = 0` or `1` → no rounding.

### 10.6 Quote calculator fixtures (`tests/fixtures/quotes/`)

1. `exclusive-two-rates.json`: lines furniture 1 × 2 431 300 (GST 18%), installation 1 × 194 600 (GST 18%), custom 1 × 500 000 (GST 12%), discount 1 × −100 000. Expected: subtotal 3 125 900; discount 100 000 allocated 84 005 (18%) / 15 995 (12%); taxable 2 541 895 / 484 005; tax 457 541 / 58 081 = 515 622; total **3 541 522**.
2. `inclusive-two-rates.json`: same lines, `pricesIncludeTax = true`: net 2 154 148 / 432 147; tax 387 747 / 51 858 = 439 605; total **3 025 900**; `taxableMinor` reported = net values.
3. `fractional-qty.json`: 2.5 × 99 999 → amount 249 998 (249 997.5 → half up 249 998), GST 18% exclusive → tax 45 000 (44 999.64 → 45 000), total 294 998.
4. `untaxed-group.json`: one line without tax rate + one GST 18% line + discount → null group gets its proportional share and no tax; ties in the remainder resolved by taxRateId asc with null last.
5. `discount-exceeds.json`: discount > subtotal → validation error `discount_exceeds_subtotal`.

### 10.7 Feature tests (Pest)

- `BuildQuoteDraft`: wardrobe order item qty 2 with installation and `delivery_flat_minor = 50000` → lines furniture (2 × 2 431 300), installation (2 × 194 600), delivery (1 × 50 000), all default tax; `cost_snapshot.items[0].directCostMinor = 1637186`; with `prices_include_tax` → furniture unit price 2 869 000 and installation unit price `roundUpToStep(grossUp(194600, 1800), 100) = 229700`.
- Stale revision (catalog bumped) → BOM refreshed before lines are built (CLI mocked to return a new price).
- Second call while a draft exists → same quote id returned.
- `ComputeRevisionBom` stores `bom_status = ready` and the CLI result; CLI failure twice → `failed`.
- Cut list CSV endpoint: header row exactly as §8.1, 12 data rows for the wardrobe, permission enforced (customer → 403).

---

## Appendix: Proposed additions to other documents

1. **02 §13 `pricing` group (new fields)**:
   | Field | Type | Default |
   |---|---|---|
   | `sheet_billing_mode` | `'used_area'` \| `'whole_sheets'` | `'used_area'` |
   | `edge_premill_mm` | int (0–3) | `0` |
2. **02 §8.5 `quotes.discount_minor` (clarification)** — derived by `QuoteCalculator` as `−Σ amount_minor` of `kind = 'discount'` lines; discount lines must have `tax_rate_id = null` and `unit_price_minor ≤ 0`.
3. **02 §10 media collections (addition)** — `FurnitureRevision` · `cutlist_pdf` · disk `s3` · single · `pdf` · 20 MB · no conversions.
4. **01 §5.3 (clarification)** — the catalog snapshot includes inactive and soft-deleted catalog rows flagged `isActive: false` (required by `03 §2.4` archived-code warnings); its exact shape is 08 §2.
5. **01 §5.4 engine CLI** — `compute-bom` options gain `allowRotation?: boolean` and `price?: { quantity: number, includeInstallation: boolean }` (default `{ quantity: 1, includeInstallation: true }`); new command `cutlist-csv`: request `{ bom, catalog, document }` → result `{ csv: string }`.
6. **03 §3.2 (clarification)** — `computeBom(model, catalog, options)` options are `{ nesting: boolean; allowRotation?: boolean; finishByRole: Record<MaterialRole, string | null> }` (`bomOptionsFor(doc, nesting)` builds them); `Bom.edgeBanding[].lengthMm` includes the 50 mm per-edge allowance **and** 5% waste; `NestingResult.placements[].partKey` uses instance keys `key#k` for `k ≥ 2`.
7. **13 permissions** — new `furniture.export_cutlist` (same entry as in the 07 Appendix); cost visibility uses the existing `quotes.view_costs`.
8. **14 routes (new)** — `admin.furniture-revisions.cutlist.csv` (GET `/admin/furniture-revisions/{revision}/cutlist.csv`), `admin.furniture-revisions.cutlist.pdf.store` (POST `/admin/furniture-revisions/{revision}/cutlist-pdf`), `admin.furniture-revisions.cutlist.pdf.show` (GET same path), `admin.orders.quotes.rebuild` (POST `/admin/orders/{order}/quotes/{quote}/rebuild`, draft only).
9. **11 admin dashboard** — dismissible banner "Review the starter catalog prices" until any catalog row is edited (flag `app_settings['catalog.seed_reviewed']` = bool, default false; set true by any catalog Upsert).
