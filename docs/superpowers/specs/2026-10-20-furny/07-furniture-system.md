# 07 — Furniture System (templates, construction, hardware, builder)

Read the master document, `01`, `02`, `03` and `09` first. Those documents are binding; this file never overrides them. Where this file needs something that is not in `02`/`03` (a column, a setting, a key pattern, a route, a permission), it is listed in the **Appendix** at the end and must be merged into the owning document during review.

This file is normative for:

- the template catalogue and generators (§2),
- every construction formula that turns a `FurnitureDocument` into `Part`s (§3 carcass, §4 fronts, §3.13 tables),
- edge-banding and grain rules (§5),
- hardware rules and `is_default_for` role keys (§6),
- validation rules beyond `03 §2.4` (§7),
- the furniture builder UX (§8), its commands (§9), the furniture diff (§10), thumbnails and client exports (§11),
- required unit tests with expected numbers (§12).

BOM merging, cut sizes, nesting, pricing, quotes and the catalog seed are in `08-bom-and-costing.md`.

Notation used in formulas:

- `t_c` carcass material thickness, `t_s` shelf material thickness, `t_f` front material thickness, `t_b` back material thickness, `t_p` plinth material thickness, `t_top` top material thickness, `t_db` drawer box thickness, `t_bt` drawer bottom thickness. Every `t_*` is `Math.round(material.thicknessMm)` (integer mm) of the material assigned to that role.
- `W, H, D` = `doc.dims.width/height/depth`.
- `fl(v)` = `Math.floor(v + 1e-6)` (floor that is robust to binary floating point). Used whenever an exact rational value must become integer mm. **Never** use `Math.round` for part sizes.
- All intermediate geometry may be fractional (e.g. `1.5`); only **final** part sizes and front rect coordinates are integer via `fl`.

---

## 0. File map

### 0.1 Engine (`resources/js/engine/furniture/`, framework-free, see `01 §5.1`)

| File | Exports | Purpose |
|---|---|---|
| `constants.ts` | all constants of §1.3 | single source for gaps/clearances |
| `schema.ts` | `FurnitureDocumentSchema` etc. | zod schemas of `03 §2` (already specified there) |
| `catalogIndex.ts` | `CatalogIndex`, `indexCatalog(snapshot)` | O(1) lookups by code, role defaults, materials by role (§1.5) |
| `parts.ts` | `makePart()`, `mapEdges()`, `mapGrain()` | part construction helper (§1.2) |
| `templates/types.ts` | `TemplateDefinition`, `ParamField`, `TemplateContext` | §2.1 |
| `templates/index.ts` | `TEMPLATES: Record<TemplateKey, TemplateDefinition>`, `getTemplate(key)` | registry |
| `templates/common.ts` | `resolveDefaultMaterials()`, `columnsFromDoors()`, `leaf()`, `split()`, `hingedFront()` | shared generator helpers (§2.3) |
| `templates/{templateKey}.ts` | one `TemplateDefinition` per key (19 files) | §2.4 |
| `generate.ts` | `generateFurniture(doc, catalog): FurnitureModel` | pipeline orchestrator (§3.1) |
| `carcass/envelope.ts` | `computeEnvelope()` | §3.2 |
| `carcass/panels.ts` | `carcassPanels()` | sides/top/bottom §3.3 |
| `carcass/back.ts` | `backPanels()` | back incl. auto-split §3.4 |
| `carcass/plinth.ts` | `plinthParts()` | §3.5 |
| `carcass/countertop.ts` | `countertopPart()` | §3.6 |
| `carcass/layout.ts` | `layoutSections(doc, catalog): SectionLayout` | section boxes, dividers §3.7 |
| `carcass/contents.ts` | `shelvesFor()`, `rodFor()`, `basketsFor()` | §3.9–3.11 |
| `carcass/drawers.ts` | `drawersFor()`, `selectSlide()` | §3.12 |
| `fronts/openings.ts` | `computeOpenings()` | front openings + edge classification §4.1 |
| `fronts/hinged.ts`, `fronts/flap.ts`, `fronts/sliding.ts`, `fronts/glass.ts` | leaf generators | §4.2–4.6 |
| `table/generateTable.ts` | `tableParts()` | §3.13 |
| `rules/hardware.ts` | `hingeCount()`, `hingeRoleKey()`, `handlesFor()`, … | §6 |
| `rules/connectors.ts` | `connectorsForJoints()` | §6.9 |
| `rules/sag.ts` | `SAG_TABLE`, `sagLimits()` | §7.2 |
| `rules/weight.ts` | `DEFAULT_DENSITY`, `partWeightKg()` | §6.1 |
| `overrides.ts` | `applyOverrides(model, doc, catalog)` | §3.14 |
| `validate.ts` | `validateFurniture(doc, catalog): Issue[]`, `SAVE_BLOCKING_CODES` | §7 |
| `diff.ts` | `diffFurniture(before, after, catalog): ChangeItem[]` | §10 |
| `diffHighlight.ts` | `highlightMap(beforeModel, afterModel)` | §10.4 |
| `partNames.ts` | `PART_NAMES_EN: Record<string, string>` | English names for exports (§1.6) |
| `commands/*.ts` | furniture commands | §9 |
| `migrate.ts` | `migrateFurniture()` | `03 §4` |

### 0.2 Editor (`resources/js/editor/furniture/`, Vue)

| File | Purpose |
|---|---|
| `FurnitureBuilder.vue` | Editor shell: toolbar, panels, viewports (§8.3) |
| `stores/useFurnitureEditorStore.ts` | Pinia store per design (document `shallowRef`, command bus, selection, mode, autosave state) |
| `composables/useFurnitureModel.ts` | runs `generateFurniture` on the main thread (needed synchronously by views) |
| `composables/useFurnitureEstimate.ts` | runs `computeBom`+`priceBom` in the engine worker (§8.10) |
| `composables/useThumbnailCapture.ts` | §11.1 |
| `views/Preview3D.vue` | TresJS 3D view (§8.4) |
| `views/ElevationView.vue` | SVG front elevation with editing (§8.5) |
| `views/SideView.vue`, `views/TopView.vue` | SVG side section / top view (§8.6) |
| `three/buildFurnitureObject.ts` | imperative three.js scene graph from `FurnitureModel` |
| `three/materialCache.ts` | `MeshStandardMaterial` cache per material/finish code |
| `three/highlight.ts` | diff highlighting (§10.4) |
| `panels/DimensionsPanel.vue`, `LayoutTreePanel.vue`, `FrontsPanel.vue`, `MaterialsPanel.vue`, `HardwarePanel.vue`, `PartsPanel.vue`, `IssuesPanel.vue`, `EstimatePanel.vue`, `NotesPanel.vue` | §8.7 |
| `pickers/MaterialPicker.vue`, `EdgeBandPicker.vue`, `FinishPicker.vue`, `HardwarePicker.vue`, `EdgeDiagramPicker.vue` | catalog pickers |
| `diff/ChangeReviewViewer.vue`, `diff/ChangeList.vue` | customer/staff change review (§10.5) |
| `export/exportGlb.ts` | GLB export (§11.3) |

Pages (Inertia): `resources/js/pages/Customer/Furniture/Create.vue`, `pages/Customer/Furniture/Edit.vue`, `pages/Admin/Furniture/Edit.vue`, `pages/Admin/Orders/ProposalItemEdit.vue` — all mount `FurnitureBuilder.vue` with a `mode` prop (§8.2).

---

## 1. Conventions, constants, catalog lookups

### 1.1 Furniture local space (recap of master §6.2)

Origin = back-left-bottom corner of the overall bounding box. `x` → right (width), `y` → up (height), `z` → toward the viewer (depth). The **front face** of the furniture is at `z = D`. `Box3 = { min: [x,y,z], size: [sx,sy,sz] }`.

The **front elevation** (2D view and `FurnitureModel.fronts[].rect`) uses `(x, y)` of local space with `y` up (the SVG renderer flips y).

### 1.2 Parts: axes, edges, grain (`parts.ts`)

Every generated panel is created through one helper:

```ts
type Axis = 'x' | 'y' | 'z';
type PhysEdge = 'front' | 'back' | 'top' | 'bottom' | 'left' | 'right';

interface PanelSpec {
  key: PartKey;
  nameKey: string;                              // i18n key (see §1.6)
  nameParams?: Record<string, string | number>;
  role: MaterialRole;
  materialCode: string;                         // resolved from doc.materials[role] unless stated
  box: Box3;                                    // exact placement in local space (fractional allowed, rounded with fl when stored)
  thicknessAxis: Axis;                          // the axis along which the panel is thin
  grainAxis: Axis | null;                       // intended grain direction in local space (null = no preference)
  banded: PhysEdge[];                           // physical edges that receive the role edge band (§5)
  bandCode?: string | null;                     // overrides the role band (used for drawer boxes)
  visibleFaces: 0 | 1 | 2;                      // §5.4
  operations?: Partial<Part['operations']>;
  geometry?: Part['geometry'];                  // default: { kind: 'box', box }
}

function makePart(spec: PanelSpec, ctx: GenContext): Part;
```

Rules implemented by `makePart`:

1. The two non-thickness axes are `a` and `b` in the fixed order `x, y, z` (skip the thickness axis). Their sizes are `sa = fl(box.size[a])`, `sb = fl(box.size[b])`.
2. `length = max(sa, sb)`, `width = min(sa, sb)`. If `sa === sb`, the length axis is `grainAxis` when it is `a` or `b`, otherwise `a`.
3. The physical edge names of an axis: `x → (left, right)`, `y → (bottom, top)`, `z → (back, front)` (min end, max end).
4. **Long edges** are the two edges at the ends of the **width axis**; **short edges** are the two edges at the ends of the **length axis**.
5. Priority rule for edge numbering: within each pair, edge `1` is the one named `front`, `top` or `left`; edge `2` is its opposite. So `L1/L2` = long edges (front-or-top-or-left first), `W1/W2` = short edges (same priority).
   - Example: a side panel (thin in `x`, length along `y`, width along `z`) → `L1 = front`, `L2 = back`, `W1 = top`, `W2 = bottom`.
   - Example: a top panel 1764 × 582 (thin in `y`, length along `x`) → `L1 = front`, `L2 = back`, `W1 = left`, `W2 = right`.
   - Example: a door leaf (thin in `z`, length along `y`) → `L1 = left`, `L2 = right`, `W1 = top`, `W2 = bottom`.
6. `edges[e] = banded.includes(physicalEdgeOf(e)) ? (spec.bandCode !== undefined ? spec.bandCode : roleBand(role)) : null` where `roleBand(role) = doc.materials[role].edgeBandCode ?? material(role).defaultEdgeBandCode ?? null` (§5.1).
7. Grain: if the material has `hasGrain = false` or `grainAxis = null` → `grain = 'none'`. Else `grain = (grainAxis === lengthAxis) ? 'length' : (grainAxis === widthAxis ? 'width' : 'none')`.
8. `thickness = Math.round(material.thicknessMm)`; `qty = 1`; `source = 'generated'`; `overridden = false`; missing operation counters = 0.

`makePart` also records, in a side table `ctx.edgeMap: Map<PartKey, Record<EdgeId, PhysEdge>>`, the physical meaning of each `EdgeId` (used by the edge picker diagram in §8.7.6).

### 1.3 Constants (`constants.ts`) — all integers are mm unless stated

| Constant | Value | Meaning |
|---|---|---|
| `FULL_OVERLAY_EDGE_GAP` | `1.5` | full overlay: leaf edge stops 1.5 mm short of the carcass outer face (3 mm total per pair of outer edges) |
| `DOOR_GAP` | `2` | gap between two adjacent leaves / fronts (also between leaves of one front) |
| `INSET_GAP` | `2` | inset fronts: gap to the opening on every edge |
| `DRAWER_FRONT_GAP` | `2` | vertical gap between stacked drawer fronts in one section |
| `MAX_DOOR_WIDTH` | `600` | per-leaf share of the **opening** width (`openingW / n`): `leaves: 'auto'` → `min(2, ceil(openingW / 600))`; share > 600 → warning `furniture.door_wide` (the leaf itself is up to ~17 mm wider because of the overlay) |
| `MAX_DOOR_HEIGHT` | `2400` | above → warning `furniture.door_tall` (needs straightener) |
| `HINGE_END_OFFSET` | `100` | first/last hinge centre from leaf ends |
| `HINGE_BORING_DISTANCE` | `4` | cup edge distance from leaf edge (allowed 3–6; spec `boringDistanceMm` overrides) |
| `HINGE_CUP_DIAMETER` | `35` | |
| `SYSTEM32_FRONT_OFFSET` | `37` | shelf-pin & hinge-plate rows from front edge |
| `SYSTEM32_PITCH` | `32` | |
| `SHELF_PIN_MARGIN` | `64` | first/last shelf-pin hole above section bottom / below section top |
| `SHELF_SIDE_CLEARANCE` | `1` | adjustable shelf: clearance per side (shelf = section width − 2) |
| `DEFAULT_SHELF_FRONT_SETBACK` | `20` | |
| `BACK_GROOVE_OFFSET` | `10` | grooved back: distance from rear edge of panels to rear face of back |
| `BACK_GROOVE_DEPTH` | `8` | groove depth in sides/top/bottom |
| `BACK_GROOVE_CLEARANCE` | `1` | back panel stops 1 mm short of groove bottom (so back = interior + 2 × 7) |
| `PLINTH_RETURN_SPACING` | `1000` | one extra plinth return per started 1000 mm beyond the first |
| `LEG_EDGE_INSET` | `30` | exposed cabinet legs: centre inset from carcass edges |
| `LEG_COLUMN_SPACING` | `800` | cabinet leg columns: `max(2, ceil(W_c / 800) + 1)` — see §6.6 |
| `SLIDING_TRACK_PITCH_EXTRA` | `12` | track pitch = `t_f + 12` |
| `SLIDING_OVERLAP` | `30` | overlap between adjacent sliding leaves |
| `SLIDING_HEIGHT_DEDUCTION` | `40` | leaf height = opening height − 40 (top 25 + bottom 15) |
| `MAX_SLIDING_LEAF_WIDTH` | `1000` | sliding `leaves: 'auto'` → `max(2, ceil(W_open / 1000))` |
| `MIN_SLIDING_LEAF_WIDTH` | `450` | below → warning |
| `GLASS_FRAME_WIDTH` | `60` | stile/rail width of glass frame doors |
| `GLASS_REBATE_DEPTH` | `8` | glass sits 8 mm into the frame on each side |
| `GLASS_CLEARANCE` | `1` | per side |
| `DRAWER_REAR_CLEARANCE` | `10` | slide nominal length ≤ available depth − 10 |
| `DRAWER_UNUSED_DEPTH_WARN` | `100` | available depth − 10 − slide length > 100 → warning |
| `DRAWER_BOX_VERTICAL_CLEARANCE` | `40` | box height = slot height − 40, floored to `DRAWER_BOX_HEIGHT_STEP` |
| `DRAWER_BOX_HEIGHT_STEP` | `10` | |
| `DRAWER_MIN_BOX_HEIGHT` | `60` | below → error `furniture.drawer_too_low` |
| `DRAWER_BOTTOM_GROOVE_DEPTH` | `6` | |
| `DRAWER_BOTTOM_OFFSET_SIDE_MOUNT` | `10` | groove from bottom edge of box sides (undermount uses spec `bottomRecessMm`, default 13) |
| `BEHIND_DOOR_DEPTH_CLEARANCE` | `20` | drawers behind doors: available depth reduced by 20 (door bumpers/hinge arms) |
| `BEHIND_DOOR_SIDE_PACKER` | `20` | drawers behind hinged doors: opening width reduced by 2 × 20 (slide packers clear hinge plates; packers cut from offcuts, not in BOM) |
| `HANGING_MIN_DEPTH` | `530` | hanging rod section interior depth below → warning |
| `HANGING_MIN_HEIGHT` | `900` | hanging rod section height below → warning |
| `ROD_MAX_SPAN` | `1200` | rod section width above → warning `furniture.rod_span_long` |
| `DEFAULT_ROD_TOP_CLEARANCE` | `60` | |
| `CAM_SPACING` | `320` | cams per joint = `max(2, ceil(jointLength / 320))` |
| `ANTI_TIP_MIN_HEIGHT` | `1500` | floor units with `H ≥ 1500` get one anti-tip kit |
| `SCREW_PACK_PARTS` | `30` | screw packs = `max(1, ceil(partCount / 30))` |
| `HANDLE_EDGE_OFFSET` | `40` | handle position offset from leaf opening edge (3D only) |
| `TALL_HANDLE_HEIGHT` | `1050` | tall floor units: handle centre height (3D only) |
| `TABLE_STRETCHER_HEIGHT` | `60` | |
| `TABLE_STRETCHER_ELEVATION` | `150` | stretcher bottom above floor |
| `TABLE_DRAWER_FRONT_HEIGHT` | `120` | under-top drawer front height when no apron |
| `TABLE_DRAWER_SPACING` | `50` | between under-top drawers |
| `TABLE_DRAWER_MAX_WIDTH` | `600` | |
| `TRESTLE_BEAM_HEIGHT` | `80` | trestle foot/cleat height |
| `MODESTY_MAX_HEIGHT` | `400` | |
| `LOWER_SHELF_ELEVATION` | `100` | table lower shelf bottom above floor |
| `MAX_PARTS` | `400` | `03 §2.4` |

### 1.4 Standard thicknesses (guidance for templates and validation)

| Use | Standard | Validation |
|---|---|---|
| Carcass, fronts | 18 mm (16–19 accepted) | carcass `< 15` → warning `furniture.thin_carcass` |
| Tops, long shelves | 25 mm | used by template `preferredMaterials` for tables/countertops |
| Back panels | 3–6 mm HDF/ply (inset backs of wall cabinets may be 18 mm) | grooved back with `t_b > 8` → warning `furniture.back_too_thick_for_groove` |
| Drawer box sides/back | 12–16 mm | outside 12–16 → info `furniture.drawer_box_thickness`; undermount requires ≤ spec `maxSideThicknessMm` (default 16) else warning |
| Drawer bottom | 3–6 mm | `> 8` → warning `furniture.drawer_bottom_thick` |

### 1.5 Catalog index & role defaults (`catalogIndex.ts`)

```ts
interface CatalogIndex {
  snapshot: CatalogSnapshot;
  material(code: string): CatalogMaterial | undefined;          // includes inactive (archived) rows
  edgeBand(code: string): CatalogEdgeBand | undefined;
  hardware(code: string): CatalogHardware | undefined;
  finish(code: string): CatalogFinish | undefined;
  labour(key: string): CatalogLabourRate | undefined;
  defaultHardware(roleKey: HardwareRoleKey): CatalogHardware | undefined; // HardwareRoleKey = union of the keys in §6.11; first ACTIVE item (sortOrder asc, code asc) whose isDefaultFor contains roleKey
  hardwareFamily(category: string, family: string): CatalogHardware[]; // ACTIVE items with specs.family = family, sorted by specs.lengthMm asc then code
  defaultMaterialFor(role: MaterialRole): CatalogMaterial | undefined;  // §2.3 rule
  glassMaterial(): CatalogMaterial | undefined;                 // first ACTIVE material with boardType 'glass' (sortOrder, code)
  densityOf(m: CatalogMaterial): number;                        // m.densityKgM3 ?? DEFAULT_DENSITY[m.boardType] (§6.1)
}
```

`CatalogSnapshot` is defined in `08 §2`. The index is memoised per `snapshot.version` (a `WeakMap<CatalogSnapshot, CatalogIndex>`).

When a role default is missing from the catalog (`defaultHardware` returns `undefined`), the generator **omits** that hardware line and emits warning `furniture.no_default_hardware` with params `{ roleKey }`. It never throws.

### 1.6 Part names

`nameKey` values are `parts.{name}` with the English strings in `resources/lang/en/parts.php` and mirrored in `partNames.ts` (`PART_NAMES_EN`) for exports. Exhaustive list (params in braces):

| nameKey | English |
|---|---|
| `parts.side_left` / `parts.side_right` | Left side / Right side |
| `parts.top` / `parts.bottom` | Top / Bottom |
| `parts.back` | Back panel {n?} ("Back panel 2" when split) |
| `parts.partition` | Partition {n} |
| `parts.fixed_shelf` | Fixed shelf {n} |
| `parts.shelf` | Shelf {n} |
| `parts.plinth_front` / `parts.plinth_back` / `parts.plinth_return` | Plinth front / Plinth back / Plinth return {n} |
| `parts.countertop` | Countertop |
| `parts.door` | Door {leaf} |
| `parts.flap` | Flap |
| `parts.sliding_door` | Sliding door {leaf} |
| `parts.glass_stile` / `parts.glass_rail` / `parts.glass_panel` | Door stile / Door rail / Glass panel |
| `parts.drawer_front` | Drawer front {n} |
| `parts.drawer_inner_front` | Drawer inner front {n} |
| `parts.drawer_side` / `parts.drawer_back` / `parts.drawer_bottom` | Drawer side / Drawer back / Drawer bottom |
| `parts.table_top` / `parts.table_top_layer` | Table top / Table top layer {n} |
| `parts.table_leg` | Leg |
| `parts.apron` | Apron |
| `parts.stretcher` | Stretcher |
| `parts.end_panel` | End panel |
| `parts.modesty_panel` | Modesty panel |
| `parts.lower_shelf` | Lower shelf |
| `parts.trestle_upright` / `parts.trestle_foot` / `parts.trestle_cleat` | Trestle upright / foot / cleat |
| `parts.pedestal_side` / `parts.pedestal_plate` | Pedestal side / Pedestal plate |
| `parts.drawer_runner` | Drawer runner |
| `parts.extra` | {name} (extra parts use their own name) |

---

## 2. Templates

### 2.1 Template definition

```ts
type TemplateKey =
  | 'wardrobe_hinged' | 'wardrobe_sliding' | 'loft_cabinet' | 'base_cabinet' | 'wall_cabinet' | 'tall_cabinet'
  | 'bookshelf' | 'open_shelf_wall' | 'tv_unit' | 'shoe_rack' | 'chest_of_drawers' | 'sideboard' | 'bedside_table'
  | 'study_desk' | 'dining_table' | 'coffee_table' | 'console_table' | 'dressing_unit' | 'custom_box';

type TemplateCategory = 'wardrobe' | 'kitchen' | 'storage' | 'shelving' | 'tv_unit' | 'table' | 'desk' | 'bed' | 'other'; // = furniture_presets.category

type Condition = { key: string; equals: string | number | boolean | Array<string | number> };

type ParamField =
  | { key: string; kind: 'length'; labelKey: string; min: Mm; max: Mm; step: Mm; advanced?: boolean; visibleIf?: Condition; helpKey?: string }
  | { key: string; kind: 'int'; labelKey: string; min: number; max: number; allowAuto?: boolean; advanced?: boolean; visibleIf?: Condition; helpKey?: string }
  | { key: string; kind: 'select'; labelKey: string; options: Array<{ value: string; labelKey: string }>; advanced?: boolean; visibleIf?: Condition; helpKey?: string }
  | { key: string; kind: 'boolean'; labelKey: string; advanced?: boolean; visibleIf?: Condition; helpKey?: string };

interface TemplateContext {
  catalog: CatalogIndex;
  newId: (prefix: 's' | 'fr') => string;   // production: engine/ids.ts newId; tests: deterministic (§12.1)
}

interface TemplateDefinition<P extends Record<string, unknown> = Record<string, unknown>> {
  key: TemplateKey;
  family: 'carcass' | 'table';
  category: TemplateCategory;
  nameKey: string;                          // `templates.{key}.name`
  descriptionKey: string;                   // `templates.{key}.description`
  thumbnail: string;                        // static asset path `/images/templates/{key}.svg` (line drawing, committed)
  fields: ParamField[];                     // UI order
  defaults: P;                              // values may be 'auto' where allowAuto
  paramsSchema: z.ZodType<P>;               // ranges identical to fields
  preferredMaterials?: Partial<Record<MaterialRole, string[]>>; // catalog codes tried in order before the usage rule
  generate(params: P, ctx: TemplateContext): FurnitureDocument;
}
```

Rules:

1. Effective defaults = `{ ...definition.defaults, ...furniture_template_settings.default_overrides }`; override keys not in `fields` are ignored; the merged object is validated with `paramsSchema`, and on failure the code defaults are used (server logs a warning).
2. Every template has the three `length` fields `width`, `height`, `depth` first, with the ranges listed in §2.4 (always inside the `03 §2.4` hard ranges).
3. `generate()` must return a document that passes `validateFurniture` with **no error issues** for every combination of parameter values inside the declared ranges at catalog = seed catalog (`08 §7`). A property test enforces this (§12.5).
4. Template parameters are **not stored** in the document. After creation, users edit the document directly (§9). `furniture_designs.template_key` keeps the origin.
5. A template file contains no hard-coded catalog codes except in `preferredMaterials`; hardware codes are resolved via `ctx.catalog.defaultHardware(roleKey)`.

### 2.2 UI rendering of `fields`

The create page (§8.1) and nothing else renders `fields` (the editor works on the document). Renderer: `resources/js/editor/furniture/TemplateParamsForm.vue`.

- `length` → `UnitInput` (parses any unit per `04 §1`, displays in the user's unit), clamps to `[min, max]`, snaps to `step` on blur. Shows the range as helper text (`t('templates.range', {min, max})`).
- `int` → number stepper; when `allowAuto`, a checkbox "Auto" (value `'auto'`) disables the stepper and shows the computed value in grey.
- `select` → segmented control when ≤ 4 options, else a select.
- `boolean` → switch.
- `advanced: true` fields are hidden behind "More options".
- `visibleIf` hides the field when the condition is false; hidden fields keep their default.

### 2.3 Shared generator rules (`templates/common.ts`)

**Default materials** — `resolveDefaultMaterials(def, ctx)` returns `MaterialAssignments` with, for each of the 9 roles: `materialCode` = first code in `def.preferredMaterials[role]` that exists and is active, else `ctx.catalog.defaultMaterialFor(role)`; `edgeBandCode: null`; `finishCode: null`.

`defaultMaterialFor(role)` = first **active** material ordered by (`sortOrder` asc, `code` asc) whose `usage` contains `role`; if none, the first active material whose `usage` contains `'carcass'`; if none, the first active material. With the seed catalog (`08 §7`) this yields: carcass/shelf/front/top/plinth → `PB18-WHITE`, back/drawer_bottom → `HDF3-WHITE`, drawer_box → `PLY12-BWR`, leg → `SW50-RUBBER`.

**Common carcass defaults** (unless a template says otherwise):

```ts
construction: { top: 'between_sides', bottom: 'between_sides' },
mounting: 'floor',
plinth: { type: 'none', height: 0, setback: 0, legCode: null },
back: { type: 'grooved' },
countertop: null,
handles: { code: ctx.catalog.defaultHardware('handle.default')?.code ?? null, orientation: 'auto', placement: 'auto' },
```

**Helpers**

- `leaf(content)` → `{ id: newId('s'), split: 'none', children: [], content }`.
- `split(dir, children: Array<[SectionChild['size'], Section]>)` → section with `split = dir`.
- `hingedFront(covers, leaves, hingeSide, overlay='full')` → `{ id: newId('fr'), kind: 'hinged', covers, leaves, hingeSide, overlay, glass: false, handleCode: 'inherit', hingeCode: 'auto', slidingTrackCode: null }`.
- `columnsFromDoors(doors)` → array of door counts per column: if `doors` is even → `doors/2` columns of 2; if odd → one column of 1 followed by `(doors−1)/2` columns of 2 (or preceded, when `singleColumnSide = 'right'` the single column is last).
- `interiorHeight(params)` (abbreviated `ih`) used by generators for count heuristics = `H − plinthHeight − 2·18` (`plinthHeight` = the template's plinth/leg height, 0 for wall/loft; assumes 18 mm boards; heuristics only).
- `shelfCount(h, pitch)` = `clamp(round(h / pitch) − 1, 1, 20)`.

ID creation order matters for deterministic tests: generators create section ids **depth-first, pre-order, children left→right / top→bottom**, then front ids in the order fronts are listed in §2.4.

### 2.4 Template catalogue

Notation for layouts: `columns[ w1: X | w2: Y ]` = root split into columns with flex weights; `rows[ fixed 350: X / flex 1: Y ]` = rows top→bottom. "door(c, n, side)" = hinged front covering section `c` with `n` leaves. All dims in mm. Ranges are `[min–max, step]`.

#### 2.4.1 `wardrobe_hinged` (category `wardrobe`)

Purpose: floor-standing hinged-door wardrobe with shelf column(s) and hanging column(s).

| Field | Kind | Range | Default | UI |
|---|---|---|---|---|
| width | length | 600–3600, 10 | 1800 | |
| height | length | 1500–2700, 10 | 2100 | |
| depth | length | 450–750, 10 | 600 | helpKey `templates.help.hanging_depth` (≥ 580 recommended for hangers) |
| doors | int | 1–12, allowAuto | `'auto'` → `clamp(round(width / 600), 1, 12)` | |
| singleColumnSide | select `left`/`right` | | `left` | visibleIf doors odd (computed) |
| hangingStyle | select `long` (full height) / `double` (two rods) | | `long` | |
| internalDrawers | int | 0–4 | 0 | number of internal drawers at the bottom of the first shelf column |
| plinthHeight | length | 0–150, 10 | 100 | advanced |
| backType | select `grooved`/`nailed`/`inset`/`none` | | `grooved` | advanced |

Generation:

1. `cols = columnsFromDoors(doors)`; root = `columns[...]` with one child per entry, `size = { mode: 'flex', weight: doorsInColumn }`.
2. Single-door column (1 door): `content = shelves(count = shelfCount(interiorHeight, 400), adjustable: true, frontSetback: 20)`. If `internalDrawers > 0` **and** this is the first single column (or, when none exists, the first column): the column becomes `rows[ flex 1: shelves(count = shelfCount(interiorHeight − 18 − internalDrawers·180, 400)) / fixed internalDrawers·180: drawers(count = internalDrawers, frontHeights: 'equal', slideCode: null, behindDoor: true) ]`.
3. Double-door column: `hangingStyle = long` → `rows[ fixed 350: empty / flex 1: hanging_rod(60) ]`; `double` → `rows[ fixed 350: empty / flex 1: hanging_rod(60) / flex 1: hanging_rod(60) ]`.
4. Fronts: one `hingedFront([column.id], doorsInColumn, side)` per column, left→right; single-door columns hinge on the carcass-outer side (`left` when the column is first, `right` when last, otherwise `'auto'`); double-door columns use `hingeSide: 'auto'`.
5. Construction: common defaults + `plinth = plinthHeight > 0 ? { type: 'plinth', height: plinthHeight, setback: 20, legCode: null } : none`, `back.type = backType`.

Default output (doors = 3): `columns[ w1: shelves×4 | w2: rows[ fixed 350: empty / flex 1: hanging_rod ] ]` + door(col1, 1, left) + door(col2, 2, auto). This is fixture `wardrobe-3door.json` (§12.2).

#### 2.4.2 `wardrobe_sliding` (category `wardrobe`)

| Field | Kind | Range | Default |
|---|---|---|---|
| width | length | 1200–3600, 10 | 2400 |
| height | length | 1800–2700, 10 | 2100 |
| depth | length | 550–750, 10 | 650 |
| leaves | int | 2–4, allowAuto | `'auto'` → `clamp(max(2, ceil((width − 36) / 1000)), 2, 4)` |
| plinthHeight | length | 0–150, 10 | 100 (advanced) |

Generation: root = `columns` with `leaves` equal flex children (weight 1). Contents alternate starting with shelves: odd columns `shelves(shelfCount(ih, 400), adjustable)`, even columns `rows[ fixed 350: empty / flex 1: hanging_rod(60) ]`. One front `{ kind: 'sliding', covers: [root.id], leaves, hingeSide: 'auto', overlay: 'full', glass: false, handleCode: 'inherit', hingeCode: null, slidingTrackCode: 'auto' }`. Plinth `{ type: 'plinth', height: plinthHeight, setback: 0 }` (setback 0: the bottom track sits on the carcass bottom). `handles.code = defaultHardware('handle.flush')?.code ?? defaultHardware('handle.default')?.code ?? null`.

#### 2.4.3 `loft_cabinet` (category `wardrobe`)

Wall-hung storage above a wardrobe or door ("loft"/"overhead").

| Field | Kind | Range | Default |
|---|---|---|---|
| width | length | 400–3600, 10 | 1800 |
| height | length | 300–1000, 10 | 600 |
| depth | length | 300–750, 10 | 600 |
| doors | int | 1–12, allowAuto | `'auto'` → `clamp(round(width / 600), 1, 12)` |
| frontKind | select `hinged`/`flap_up` | | `hinged` |

Generation: `mounting: 'loft'`, plinth none, back `nailed`. Columns from `columnsFromDoors(doors)` with `content: empty`. `frontKind = hinged` → door per column as wardrobe; `flap_up` → one `flap_up` front per column (`leaves: 1`).

#### 2.4.4 `base_cabinet` (category `kitchen`)

| Field | Kind | Range | Default |
|---|---|---|---|
| width | length | 150–1200, 10 | 600 |
| height | length | 700–950, 10 | 850 |
| depth | length | 450–650, 10 | 560 |
| variant | select `door` / `drawers` / `door_drawer` / `basket` | | `door` |
| drawerCount | int | 2–5 | 3 (visibleIf variant = drawers) |
| countertop | boolean | | false |
| plinthHeight | length | 80–150, 10 | 100 (advanced) |

Generation: plinth `{ type: 'legs', height: plinthHeight, setback: 50, legCode: null }` (adjustable legs + kickboard, §3.5); back `grooved`; when `countertop = true`: `countertop = { enabled: true, overhangFront: 20, overhangLeft: 0, overhangRight: 0 }` and `preferredMaterials.top = ['PB25-WHITE']`.

- `door`: root leaf `shelves(1, adjustable)`; door(root, `'auto'`, auto).
- `drawers`: root leaf `drawers(count = drawerCount, 'equal', slideCode: defaultHardware('slide.undermount')?.code ?? null, behindDoor: false)`; no `Front`.
- `door_drawer`: root `rows[ fixed 150: drawers(1, 'equal', undermount, false) / flex 1: shelves(1) ]`; door(row2, `'auto'`, auto).
- `basket`: root leaf `pull_out_basket(count: 2, basketCode: null)`; door(root, 1, auto).

#### 2.4.5 `wall_cabinet` (category `kitchen`)

| Field | Kind | Range | Default |
|---|---|---|---|
| width | length | 300–1200, 10 | 600 |
| height | length | 300–1000, 10 | 700 |
| depth | length | 250–400, 10 | 330 |
| frontKind | select `hinged`/`flap_up`/`open` | | `hinged` |

Generation: `mounting: 'wall'`, plinth none, back `grooved`, bottom `between_sides`. Root leaf `shelves(count = height > 600 ? 2 : 1, adjustable)`. `hinged` → door(root, `'auto'`, auto); `flap_up` → flap_up front over root; `open` → no front.

#### 2.4.6 `tall_cabinet` (category `kitchen`)

| Field | Kind | Range | Default |
|---|---|---|---|
| width | length | 300–900, 10 | 600 |
| height | length | 1800–2400, 10 | 2100 |
| depth | length | 450–650, 10 | 560 |
| applianceNiche | boolean | | false |

Generation: plinth legs 100 setback 50, back grooved. Without niche: root `rows[ flex 1: shelves(2) / flex 1: shelves(3) ]`, door(row1, auto), door(row2, auto). With niche: `rows[ flex 1: shelves(2) / fixed 600: empty / flex 1: shelves(2) ]`, door(row1), door(row3); row 2 is open (oven/microwave niche).

#### 2.4.7 `bookshelf` (category `shelving`)

| Field | Kind | Range | Default |
|---|---|---|---|
| width | length | 300–2400, 10 | 900 |
| height | length | 600–2400, 10 | 1800 |
| depth | length | 200–450, 10 | 300 |
| columns | int | 1–6, allowAuto | `'auto'` → `max(1, ceil(width / 800))` |
| lowerDoors | boolean | | false |

Generation: plinth `{ type: 'plinth', height: 60, setback: 0 }`, back `nailed`. Each column leaf: `shelves(shelfCount(ih, 330), adjustable: true, frontSetback: 0)`. When `lowerDoors`: root `rows[ flex 1: columns[...] / fixed 700: columns[...] (content shelves(1)) ]` and one hinged front per lower column (`'auto'` leaves).

#### 2.4.8 `open_shelf_wall` (category `shelving`)

Floating open shelf unit (no doors) fixed to a wall.

| Field | Kind | Range | Default |
|---|---|---|---|
| width | length | 300–2400, 10 | 1200 |
| height | length | 150–1200, 10 | 400 |
| depth | length | 150–400, 10 | 250 |
| rows | int | 1–6, allowAuto | `'auto'` → `max(1, round(height / 350))` |
| columns | int | 1–6, allowAuto | `'auto'` → `max(1, ceil(width / 900))` |

Generation: `mounting: 'wall'`, back `none`, construction top/bottom `over_sides`. Root = rows (if `rows > 1`) of columns (if `columns > 1`), all leaves `empty`, all flex weight 1. No fronts.

#### 2.4.9 `tv_unit` (category `tv_unit`)

| Field | Kind | Range | Default |
|---|---|---|---|
| width | length | 900–3000, 10 | 1800 |
| height | length | 300–700, 10 | 450 |
| depth | length | 300–550, 10 | 400 |
| mounting | select `floor`/`wall` | | `floor` |
| layout | select `drawers_open_door` / `doors_open_doors` / `flaps` | | `drawers_open_door` |

Generation: floor → plinth `{ type: 'legs', height: 100, setback: 0, legCode: null }` (visible cabinet legs); wall → none. Back `grooved`. Construction top `over_sides`.

- `drawers_open_door`: `columns[ w1: drawers(2, 'equal', side-mount default, false) | w2: empty | w1: shelves(1) ]` + door(col3, 1, right). (Fixture `tv-unit-1800.json`.)
- `doors_open_doors`: `columns[ w1: shelves(1) | w2: empty | w1: shelves(1) ]` + door(col1, 1, left) + door(col3, 1, right).
- `flaps`: `columns[ w1: empty | w1: empty | w1: empty ]` + one `flap_down` front per column.

#### 2.4.10 `shoe_rack` (category `storage`)

| Field | Kind | Range | Default |
|---|---|---|---|
| width | length | 400–1500, 10 | 800 |
| height | length | 600–1800, 10 | 1000 |
| depth | length | 300–420, 10 | 350 |

Generation: plinth `{ type: 'plinth', height: 60, setback: 20 }`, back `nailed`. Root = columns of `max(1, ceil(width / 600))` flex children, each `shelves(shelfCount(ih, 180), adjustable: true, frontSetback: 20)`; one hinged front per column, `leaves: 1`, hinge left for the first column, right for others.

#### 2.4.11 `chest_of_drawers` (category `storage`)

| Field | Kind | Range | Default |
|---|---|---|---|
| width | length | 400–1600, 10 | 800 |
| height | length | 500–1400, 10 | 1000 |
| depth | length | 350–600, 10 | 450 |
| drawerCount | int | 2–8, allowAuto | `'auto'` → `clamp(round((height − 80 − 36) / 200), 2, 8)` |
| columns | select `1`/`2` | | `width > 1000 ? '2' : '1'` |
| slideType | select `side_mount`/`undermount` | | `side_mount` (advanced) |

Generation: plinth `{ type: 'plinth', height: 80, setback: 20 }`, back grooved, top `over_sides`. Each column leaf `drawers(drawerCount, 'equal', defaultHardware('slide.' + slideType)?.code ?? null, false)`. No `Front`s.

#### 2.4.12 `sideboard` (category `storage`)

| Field | Kind | Range | Default |
|---|---|---|---|
| width | length | 900–2700, 10 | 1600 |
| height | length | 600–1000, 10 | 800 |
| depth | length | 350–550, 10 | 450 |
| legHeight | length | 0–250, 10 | 150 |

Generation: `legHeight > 0` → plinth `{ type: 'legs', height: legHeight, setback: 0, legCode: null }`; top `over_sides`, back grooved. `columns[ w1: shelves(1) | w1: drawers(3, 'equal', side-mount default, false) | w1: shelves(1) ]` + door(col1, 1, left) + door(col3, 1, right).

#### 2.4.13 `bedside_table` (category `storage`)

| Field | Kind | Range | Default |
|---|---|---|---|
| width | length | 300–700, 10 | 450 |
| height | length | 400–700, 10 | 550 |
| depth | length | 300–500, 10 | 400 |
| variant | select `drawer_open` / `two_drawers` / `drawer_door` | | `drawer_open` |

Generation: plinth `{ type: 'legs', height: 100, setback: 0 }`, top `over_sides`, back grooved.
`drawer_open` → `rows[ fixed 150: drawers(1) / flex 1: empty ]`; `two_drawers` → leaf `drawers(2)`; `drawer_door` → `rows[ fixed 150: drawers(1) / flex 1: shelves(1) ]` + door(row2, 1, auto). All drawers side-mount default, `behindDoor: false`.

#### 2.4.14 `study_desk` (category `desk`, family `table`)

| Field | Kind | Range | Default |
|---|---|---|---|
| width | length | 800–2400, 10 | 1200 |
| height | length | 700–780, 5 | 750 |
| depth | length | 450–800, 10 | 600 |
| base | select `cabinet_ends` / `panel_ends` / `four_legs` | | `cabinet_ends` |
| cabinetWidth | length | 300–600, 10 | 400 (visibleIf base = cabinet_ends) |
| cabinetContent | select `drawers` / `shelves` | | `drawers` (visibleIf base = cabinet_ends) |
| topDrawer | boolean | | false (one under-top drawer in the knee space) |

Generation (`table` spec):

```ts
top: { shape: 'rectangle', thickness: 'material', cornerRadius: 0, overhang: 0 },
base: { type: base, legSource: 'hardware', legCode: null, legSection: 50,
        apron: { enabled: base === 'four_legs', height: 80, inset: 15 }, stretcher: true },
storage: {
  drawers: topDrawer ? { count: 1, side: 'front', slideCode: null } : null,
  lowerShelf: false,
  endCabinets: base === 'cabinet_ends'
    ? { width: cabinetWidth, content: cabinetContent === 'drawers'
          ? { type: 'drawers', count: 3, frontHeights: 'equal', slideCode: null, behindDoor: false }
          : { type: 'shelves', count: 2, adjustable: true, frontSetback: 20 } }
    : null,
},
```

`preferredMaterials.top = ['PB25-WHITE']`. Default output = fixture `study-desk-cabinet.json`.

#### 2.4.15 `dining_table` (category `table`, family `table`)

| Field | Kind | Range | Default |
|---|---|---|---|
| width | length | 900–3000, 10 | 1800 |
| height | length | 700–780, 5 | 750 |
| depth | length | 700–1200, 10 | 900 |
| shape | select `rectangle`/`rounded_rectangle`/`round`/`oval` | | `rectangle` |
| base | select `four_legs`/`trestle`/`pedestal` | | `four_legs` (pedestal only visibleIf shape ∈ round) |
| legSource | select `solid`/`hardware` | | `solid` |

Generation: `top = { shape, thickness: 'material', cornerRadius: shape === 'rounded_rectangle' ? 100 : 0, overhang: 50 }`, `base = { type: base, legSource, legCode: null, legSection: 50, apron: { enabled: base === 'four_legs', height: 90, inset: 15 }, stretcher: false }`, storage all empty/false/null. `round` forces `depth = width` (the field is hidden and set). `preferredMaterials.top = ['PB25-WHITE']`, `preferredMaterials.leg = ['SW50-RUBBER']`. Fixture `dining-table-6seat.json` = defaults.

#### 2.4.16 `coffee_table` (category `table`, family `table`)

| Field | Kind | Range | Default |
|---|---|---|---|
| width | length | 500–1600, 10 | 1000 |
| height | length | 300–500, 10 | 420 |
| depth | length | 400–900, 10 | 550 |
| shape | select `rectangle`/`rounded_rectangle`/`round`/`oval` | | `rectangle` |
| lowerShelf | boolean | | true |

Generation: top overhang 30, base `four_legs`, `legSource: 'solid'`, `legSection: 50`, apron `{ enabled: true, height: 70, inset: 10 }`, stretcher false, `storage.lowerShelf = lowerShelf`.

#### 2.4.17 `console_table` (category `table`, family `table`)

| Field | Kind | Range | Default |
|---|---|---|---|
| width | length | 600–1800, 10 | 1200 |
| height | length | 700–900, 10 | 800 |
| depth | length | 350–450, 10 | 400 |
| drawers | int | 0–3 | 2 |

Generation: top overhang 20, base `four_legs` solid `legSection 50`, apron `{ enabled: true, height: 100, inset: 10 }`, `storage.drawers = drawers > 0 ? { count: drawers, side: 'front', slideCode: null } : null`.

#### 2.4.18 `dressing_unit` (category `storage`)

Tall dresser: two side cabinets with doors, open mirror niche in the middle, drawers below.

| Field | Kind | Range | Default |
|---|---|---|---|
| width | length | 900–1800, 10 | 1200 |
| height | length | 1500–2200, 10 | 1800 |
| depth | length | 400–600, 10 | 450 |
| drawerRows | int | 2–4 | 3 |

Generation: plinth `{ type: 'plinth', height: 80, setback: 20 }`, back grooved. Root `rows[ flex 1: columns[ w1: shelves(3) | w2: empty | w1: shelves(3) ] / fixed drawerRows·170: columns[ w1: drawers(drawerRows) | w1: drawers(drawerRows) ] ]` + door(top-col1, 1, left) + door(top-col3, 1, right). Drawers side-mount default.

#### 2.4.19 `custom_box` (category `other`)

Blank carcass for staff/advanced users.

| Field | Kind | Range | Default |
|---|---|---|---|
| width | length | 150–6000, 10 | 600 |
| height | length | 100–3000, 10 | 720 |
| depth | length | 100–1200, 10 | 560 |
| mounting | select `floor`/`wall`/`loft` | | `floor` |

Generation: common defaults, root leaf `empty`, no fronts.

### 2.5 Presets

Presets (`furniture_presets`) store a full `FurnitureDocument`; they are created by staff with "Save as preset" in the builder (`SaveAsPreset` action, `01 §4`) and shown in the create gallery. Starting from a preset: the document is **deep-copied**, all section ids and front ids are **re-generated** (`reidentify(doc, newId)` in `templates/common.ts`, which also rewrites `covers` and every override key containing an old id), then migrated and validated against the current catalog; unknown codes are replaced by the role default (`defaultMaterialFor` / `defaultHardware`) and reported in a toast. `furniture_designs.preset_id` and `template_key` (from the preset) are set.

---

## 3. Generation pipeline and construction formulas

### 3.1 `generateFurniture(doc, catalog): FurnitureModel`

Pure, synchronous, deterministic (no `Date`, no randomness, no `Map` iteration over insertion-order-dependent inputs without sorting). Steps, in this exact order:

1. `idx = indexCatalog(catalog)`; create `ctx: GenContext = { doc, idx, parts: [], hardware: [], fronts: [], sections: [], issues: [], edgeMap: new Map(), joints: [] }`.
2. **Code check**: every code referenced by the document (materials, edge bands, finishes, hardware codes in fronts/contents/handles/plinth/table/overrides) is looked up; unknown → error `furniture.unknown_code` `{ code, kind }`; inactive → warning `furniture.archived_code`. An unknown **material** code is replaced *for generation only* by `defaultMaterialFor(role)` so that the model can still be rendered.
3. If `family === 'carcass'`:
   1. `env = computeEnvelope(doc)` (§3.2)
   2. `carcassPanels(env)` (§3.3)
   3. `layout = layoutSections(doc, env)` (§3.7) → leaf boxes, divider parts (§3.8)
   4. `openings = computeOpenings(doc, env, layout)` and front leaves (§4)
   5. contents per leaf, leaves in pre-order: shelves (§3.9), hanging rod (§3.10), baskets (§3.11), drawers (§3.12)
   6. `backPanels(env, layout)` (§3.4)
   7. `plinthParts(env)` (§3.5), `countertopPart(env)` (§3.6)
   8. carcass-level hardware: legs (§6.6), wall brackets / anti-tip (§6.8), connectors from `ctx.joints` (§6.9), screw packs (§6.9)
4. If `family === 'table'`: `tableParts(doc)` (§3.13) incl. its hardware.
5. `applyOverrides(ctx)` (§3.14) — removals, part/hardware overrides, extra parts, extra hardware.
6. Model-level validation rules (§7.3) append issues (sag, weights, sheet fit, …).
7. Sort `parts` and `hardware` by `key` (plain `<` string comparison), `fronts` by `rect.x`, then `-rect.y`; `sections` by pre-order. `bbox = { min: [0,0,0], size: [W, H, D] }`.
8. Return the model. `generateFurniture` never throws on document content; it throws only on schema-invalid input (callers parse with zod first).

Budget: ≤ 15 ms for a 60-part design on a mid-range laptop (main thread), measured by a Vitest benchmark (§12.7).

### 3.2 Envelope (`carcass/envelope.ts`)

```ts
interface Envelope {
  x0: number; y0: number;              // carcass min corner (z min is always 0)
  Wc: number; Hc: number; Dc: number;  // carcass box size
  fz: number;                          // front zone depth (fronts in front of the carcass)
  plinthH: number; ctT: number;        // plinth height, countertop thickness
  zp: number;                          // rear z of sides/top/bottom (t_b for nailed back, else 0)
  zBackFront: number;                  // z of the back panel's front face (interior starts here)
  slidingZone: number;                 // depth reserved at the front of the interior for sliding doors (0 if none)
  drawerStyle: 'full' | 'inset';       // overlay used by drawer fronts (§4.4)
  interior: Box3;                      // root section box
}
```

Formulas (`C = doc.carcass`):

| Quantity | Formula |
|---|---|
| `hasSliding` | `C.fronts.some(f => f.kind === 'sliding')` |
| `drawerStyle` | `C.fronts.length > 0 && C.fronts.every(f => f.overlay === 'inset') ? 'inset' : 'full'` |
| `hasExternalDrawers` | some leaf has `drawers` content with `behindDoor = false` and is not covered (directly or via an ancestor) by any Front |
| `hasOverlayFronts` | `C.fronts.some(f => f.kind !== 'sliding' && f.overlay !== 'inset') \|\| (hasExternalDrawers && drawerStyle === 'full')` |
| `fz` | `hasSliding ? 0 : (hasOverlayFronts ? t_f : 0)` |
| `plinthH` | `C.mounting === 'floor' && C.plinth.type !== 'none' ? C.plinth.height : 0` (wall/loft with a plinth → plinth ignored + info `furniture.plinth_ignored`) |
| `ct` | `C.countertop?.enabled ? C.countertop : null` |
| `ctT` | `ct ? t_top : 0` |
| `oL, oR, oF` | `ct ? ct.overhangLeft / overhangRight / overhangFront : 0` |
| `Wc` | `W − oL − oR` |
| `Hc` | `H − plinthH − ctT` |
| `Dc` | `D − fz − oF` |
| `x0, y0` | `oL`, `plinthH` |
| `zp` | `C.back.type === 'nailed' ? t_b : 0` |
| `zBackFront` | `none → 0`, `nailed → t_b`, `grooved → BACK_GROOVE_OFFSET + t_b`, `inset → t_b` |
| `slidingZone` | `hasSliding ? 2 × (t_f + SLIDING_TRACK_PITCH_EXTRA) : 0` |
| `interior` | `x ∈ [x0 + t_c, x0 + Wc − t_c]`, `y ∈ [y0 + t_c, y0 + Hc − t_c]`, `z ∈ [zBackFront, Dc − slidingZone]` |

`Wc < 150`, `Hc < 100`, `Dc < 100` or any interior size ≤ 0 → error `furniture.envelope_too_small` (generation stops after emitting it; the model contains no parts).

The **carcass front plane** is `z = Dc`. Overlay fronts occupy `z ∈ [Dc, Dc + t_f]`; inset fronts `z ∈ [Dc − t_f, Dc]`.

### 3.3 Sides, top, bottom (`carcass/panels.ts`)

| Key | Role | x | y | z | Thin | Grain | Banded | Faces |
|---|---|---|---|---|---|---|---|---|
| `carcass.side.left` | carcass | `[x0, x0 + t_c]` | `[ys0, ys1]` | `[zp, Dc]` | x | y | `front`; `top` iff `top = between_sides && !ct`; `bottom` iff `bottom = between_sides && mounting ≠ 'floor'` | 1 |
| `carcass.side.right` | carcass | `[x0 + Wc − t_c, x0 + Wc]` | same | same | x | y | same | 1 |
| `carcass.top` | carcass | between: `[x0 + t_c, x0 + Wc − t_c]`; over: `[x0, x0 + Wc]` | `[y0 + Hc − t_c, y0 + Hc]` | `[zp, Dc]` | y | x | `front`; `left`,`right` iff `over_sides` | 1 iff over_sides and !ct, else 0 |
| `carcass.bottom` | carcass | between/over as top | `[y0, y0 + t_c]` | `[zp, Dc]` | y | x | `front`; `left`,`right` iff `over_sides` | 0 |

with `ys0 = y0 + (bottom = over_sides ? t_c : 0)`, `ys1 = y0 + Hc − (top = over_sides ? t_c : 0)`.

Resulting sizes: side = `(ys1 − ys0) × (Dc − zp)`; top/bottom = `(between ? Wc − 2·t_c : Wc) × (Dc − zp)`.

Joints recorded (§6.9): `top↔side.left`, `top↔side.right`, `bottom↔side.left`, `bottom↔side.right`, each with length `Dc − zp`.

### 3.4 Back panel (`carcass/back.ts`)

| `back.type` | x range | y range | z range |
|---|---|---|---|
| `none` | — | — | — |
| `nailed` | `[x0, x0 + Wc]` | `[y0, y0 + Hc]` | `[0, t_b]` |
| `grooved` | `[ix0 − g, ix1 + g]` | `[iy0 − g, iy1 + g]` | `[BACK_GROOVE_OFFSET, BACK_GROOVE_OFFSET + t_b]` |
| `inset` | `[ix0, ix1]` | `[iy0, iy1]` | `[0, t_b]` |

where `ix0, ix1, iy0, iy1` = interior x/y bounds and `g = BACK_GROOVE_DEPTH − BACK_GROOVE_CLEARANCE = 7`. Role `back`, thin `z`, grain `y`, no banding, `visibleFaces 0`, key `carcass.back`, nameKey `parts.back`.

Grooving is not modelled as a separate operation (it is covered by the cutting labour, `08 §4.3`).

#### 3.4.1 Automatic back split

Sheet fit test (shared with §7.3 `furniture.part_exceeds_sheet`):

```ts
// usable sheet area after trim (pricing.sheetTrimMm on every edge)
function fitsSheet(a: Mm, b: Mm, m: CatalogMaterial, grain: 'length' | 'width' | 'none', trim: Mm): boolean {
  const UL = m.sheetLengthMm - 2 * trim, UW = m.sheetWidthMm - 2 * trim;
  const L = Math.max(a, b), Wd = Math.min(a, b);
  if (m.hasGrain && grain === 'length') return L <= UL && Wd <= UW;
  if (m.hasGrain && grain === 'width') return Wd <= UL && L <= UW;
  return (L <= UL && Wd <= UW);   // free rotation: the longer side along the sheet length is always the best orientation
}
```

(Fit uses **finished** sizes; the ≤ 2 mm difference to cut sizes is absorbed by the trim.)

If the back (`bw × bh` = its x-size × y-size) does not fit, it is split into a grid of pieces:

1. `UL`, `UW` as above, `locked = material.hasGrain`.
2. Max strip width `Px = (!locked && bh <= UW) ? UL : UW`; max piece height `Py = UL`.
3. **Vertical seams** over `[bx0, bx1]`: candidates = x-centres of every partition (any depth in the tree) whose y-range covers the full interior height, sorted ascending. Greedy: `s = bx0`; while `bx1 − s > Px`: `c` = the largest candidate with `s + 100 ≤ c ≤ s + Px`; if found → supported seam at `c`; else → unsupported seam at `s + ceil((bx1 − s) / ceil((bx1 − s) / Px))`. `s = seam`.
4. For every resulting strip whose height `bh > Py`: **horizontal seams** over `[by0, by1]` with candidates = y-centres of fixed shelves whose x-range covers the strip completely; same greedy with `Py`.
5. Pieces are numbered `n = 1, 2, …` strip by strip left→right, inside a strip bottom→top. Keys `carcass.back.{n}`, nameParams `{ n }`. Seams have no gap (pieces butt at the seam line).
6. Issues: info `furniture.back_split` `{ count }`; each unsupported seam → warning `furniture.back_seam_unsupported` `{ axis: 'x'|'y', position }` ("add a partition or a batten behind this joint").

### 3.5 Plinth (`carcass/plinth.ts`) — only when `mounting = 'floor'`

**`type = 'plinth'`** (`h = plinth.height`, `sb = plinth.setback`, role `plinth`):

| Key | x | y | z | Thin | Grain | Banded | Faces |
|---|---|---|---|---|---|---|---|
| `plinth.front` | `[x0, x0 + Wc]` | `[0, h]` | `[Dc − sb − t_p, Dc − sb]` | z | x | `left`, `right` iff `sb > 0` | 1 |
| `plinth.back` | `[x0, x0 + Wc]` | `[0, h]` | `[0, t_p]` | z | x | — | 0 |
| `plinth.return.{k}` | `[rx_k, rx_k + t_p]` | `[0, h]` | `[t_p, Dc − sb − t_p]` | x | z | — | 0 |

`returns n = 2 + fl((Wc − 1) / PLINTH_RETURN_SPACING)`; `rx_k = x0 + (k − 1) × (Wc − t_p) / (n − 1)`, `k = 1..n`. If `Dc − sb − 2·t_p < 50` → no returns + warning `furniture.plinth_too_shallow`.

**`type = 'legs'`**: legs hardware per §6.6. If `sb > 0`, additionally `plinth.front` exactly as above (kickboard clipped to the legs); no back, no returns.

### 3.6 Countertop (`carcass/countertop.ts`)

If `ct`: key `countertop`, role `top`, `x ∈ [0, W]`, `y ∈ [H − t_top, H]`, `z ∈ [0, Dc + fz + oF]`, thin y, grain x, banded `front`, `left`, `right`, faces 1. Any overhang > 300 → warning `furniture.countertop_overhang_large` (needs brackets). The carcass keeps its own `carcass.top` panel.

### 3.7 Section layout (`carcass/layout.ts`)

```ts
interface SectionBoxInfo { id: string; box: Box3; leaf: boolean; parentId: string | null; index: number; label: SectionLabel }
interface SectionLabel { key: 'sections.interior' | 'sections.column' | 'sections.row'; params: { n?: number }; parentLabel: SectionLabel | null }
interface Divider { key: PartKey; kind: 'partition' | 'fixed_shelf'; sectionId: string; index: number; box: Box3 }
interface SectionLayout { byId: Map<string, SectionBoxInfo>; preorder: string[]; dividers: Divider[] }

export function layoutSections(doc: FurnitureDocument, catalog: CatalogSnapshot): SectionLayout; // exported from engine index (the editor needs non-leaf boxes)
```

Recursive, starting with root = `env.interior`:

1. Leaf → record, stop.
2. `n = children.length`, divider thickness `td = split === 'columns' ? t_c : t_s`, axis length `A = split === 'columns' ? box.sx : box.sy`, `avail = A − (n − 1) × td`.
3. **Allocation** `sizes = allocate(children, avail)`:
   - If no child is `flex`: the **last** child is treated as flex weight 1; if its stored `mm` differs from the computed value → info `furniture.fixed_sizes_adjusted` `{ sectionId }`.
   - `fixedSum = Σ fixed mm`; `rem = avail − fixedSum`. If `rem < 0` → error `furniture.fixed_sizes_exceed` `{ sectionId, overBy: −rem }`; then every child gets `fl(avail × weightOrMm_i / Σ)` (fixed mm used as weights) so rendering still works.
   - Else `Wt = Σ flex weights`; flex child size `fl(rem × w_i / Wt)`; `leftover = rem − Σ flex sizes` (integer, `0 ≤ leftover < #flex`) is added **+1 mm each** to flex children in order (first flex child first).
4. Columns: cursor `x = box.x`; child `i` (1-based) box `x ∈ [x, x + size_i]`, same y/z as parent; for `i < n` a divider `section.{S}.partition.{i}` at `x ∈ [x + size_i, x + size_i + t_c]`; `x += size_i + t_c`.
5. Rows (top → bottom): cursor `y = box.y + box.sy`; child `i` box `y ∈ [y − size_i, y]`; for `i < n` a divider `section.{S}.fixed_shelf.{i}` at `y ∈ [y − size_i − t_s, y − size_i]`; `y −= size_i + t_s`.
6. Labels: root `Interior`; children `Column {i}` / `Row {i}` (rows counted top→bottom); nested labels render as `Column 2 › Row 1`.

`FurnitureModel.sections` = leaf entries `{ id, box }` (box sizes `fl`-rounded).

### 3.8 Divider parts

| Key | Role | Box | Thin | Grain | Banded | Faces |
|---|---|---|---|---|---|---|
| `section.{S}.partition.{i}` | carcass | divider box (x-size `t_c`, parent y- and z-range) | x | y | `front` | 0 |
| `section.{S}.fixed_shelf.{i}` | shelf | divider box (y-size `t_s`, parent x- and z-range) | y | x | `front` | 0 |

Joints (§6.9): partition ↔ the horizontal panel touching its top end and its bottom end (carcass top/bottom or an ancestor's fixed shelf), length = partition z-size; fixed shelf ↔ the vertical panel touching each end (side or partition), length = shelf z-size. Touching panels are found geometrically (face coordinate equality within 0.5 mm and positive overlap).

### 3.9 Shelves content `{ type: 'shelves', count n, adjustable, frontSetback }`

Leaf box `x ∈ [x0, x1]`, `y ∈ [y0, y1]`, `z ∈ [z0, z1]`, `w = x1 − x0`, `h = y1 − y0`. **Content depth** `cd = (z1 − z0) − insetReduction`, where `insetReduction = t_f` when the leaf is covered (directly or via an ancestor) by an `inset` Front, else 0.

- Gap `g = (h − n·t_s) / (n + 1)`; `g < 0` → error `furniture.shelves_dont_fit` (no shelf parts).
- Shelf `i` (1 = top): top face `yt = y1 − i·g − (i − 1)·t_s`, box `y ∈ [yt − t_s, yt]`.
- x: adjustable `[x0 + 1, x1 − 1]` (length `w − 2·SHELF_SIDE_CLEARANCE`); fixed `[x0, x1]`.
- z: `[z0, z0 + cd − frontSetback]`.
- Part: key `section.{S}.shelf.{i}`, role shelf, thin y, grain x, banded `front`, faces 0, nameParams `{ n: i }`.
- Adjustable: hardware `section.{S}.shelf_supports` = `4 × n` × `shelf_support.default`; shelf-pin holes per row `pr = h ≥ 2·SHELF_PIN_MARGIN ? fl((h − 2·SHELF_PIN_MARGIN) / SYSTEM32_PITCH) + 1 : 0`; two rows (at 37 mm from the front edge of the vertical panel and 37 mm from the back panel face) on each bounding vertical → `operations.shelfPinHoles += 2·pr` on the left bounding vertical part and `+= 2·pr` on the right one (the side or partition whose face touches `x0` / `x1`).
- Not adjustable: joints shelf ↔ left vertical and shelf ↔ right vertical, length = shelf depth.

### 3.10 Hanging rod `{ type: 'hanging_rod', topClearance, rodCode }`

- `code = rodCode ?? defaultHardware('rod.default')`; `pieces = ceil(w / (spec.maxLengthMm ?? 1200))`.
- Hardware `section.{S}.rod` qty `pieces`; `section.{S}.rod_supports` qty `2 × pieces` (`rod_support.default`).
- 3D only: cylinder Ø 25 mm (oval if `spec.profile = 'oval'`), axis x, length `w − 2`, centre `y = y1 − topClearance`, `z = z0 + cd / 2`.
- Warnings: `cd < HANGING_MIN_DEPTH` → `furniture.rod_section_shallow` `{ depth: cd }`; `h < HANGING_MIN_HEIGHT` → `furniture.rod_section_short`; `w > ROD_MAX_SPAN` → `furniture.rod_span_long`.

### 3.11 Pull-out baskets `{ type: 'pull_out_basket', count, basketCode }`

Hardware only: `section.{S}.baskets` qty `count`, code `basketCode ?? defaultHardware('basket.default')`. If the basket spec has `minInnerWidthMm`/`maxInnerWidthMm` and `w` is outside → warning `furniture.basket_size_mismatch`; `cd < (spec.minDepthMm ?? 450)` → same warning. `count × 150 > h` → warning `furniture.baskets_dont_fit`.

### 3.12 Drawers `{ type: 'drawers', count n, frontHeights, slideCode, behindDoor }`

Let `coverFront` = the Front covering the leaf or an ancestor (if any). Effective `behind = behindDoor || coverFront !== undefined`; when `coverFront` exists and `behindDoor = false` → warning `furniture.drawers_forced_behind_door` (the commands of §9 normally keep the flag in sync).

**Slots** (vertical space per drawer, j = 1 top):

- External (`!behind`): drawer front rects `F_j` from §4.4; `slot_j = [max(F_j.y0, y0), min(F_j.y1, y1)]`.
- Behind: `frontHeights = 'equal'` → `slot_j` = equal division of `[y0, y1]`; custom → heights for `j < n` as given, last = remainder (no gaps).

**Box height** `Hb_j = fl((slotH_j − DRAWER_BOX_VERTICAL_CLEARANCE) / DRAWER_BOX_HEIGHT_STEP) × DRAWER_BOX_HEIGHT_STEP`; `< DRAWER_MIN_BOX_HEIGHT` → error `furniture.drawer_too_low` (no box parts for that drawer).

**Opening width** `Wo = w − (behind && coverFront.kind ∈ {hinged, flap_up, flap_down} ? 2 × BEHIND_DOOR_SIDE_PACKER : 0)`.

**Available depth** `A = cd − (behind ? BEHIND_DOOR_DEPTH_CLEARANCE : 0)` (`cd` includes `insetReduction`; for external `inset`-style drawer fronts `insetReduction = t_f` as well).

**Slide selection** (`selectSlide`) — `maxLen = A − DRAWER_REAR_CLEARANCE − (behind ? t_db : 0)`:

1. `requested = slideCode ? idx.hardware(slideCode) : idx.defaultHardware('slide.side_mount')`. Missing → warning `furniture.no_default_hardware`; no slides; box length `Ls = fl(maxLen / 50) × 50`.
2. If `slideCode` is set and `requested.specs.lengthMm ≤ maxLen` → use `requested`.
3. Else candidates = active items of category `drawer_slide` with the same `specs.family` and `lengthMm ≤ maxLen`; take the **longest** (ties → lowest code). If it differs from an explicit `slideCode` → info `furniture.slide_resized` `{ from, to }`.
4. No candidate → error `furniture.drawer_no_slide` `{ sectionId, availableDepth: A }` (no box parts).
5. `maxLen − Ls > DRAWER_UNUSED_DEPTH_WARN` → warning `furniture.drawer_depth_unused` `{ unused }`.

`Ls = chosen.specs.lengthMm`.

**Box dimensions by slide type:**

| | side_mount | undermount |
|---|---|---|
| outer width `Wb` | `fl(Wo − 2 × (spec.clearancePerSideMm ?? 12.7))` | `Win + 2·t_db` |
| inner width `Win` | `Wb − 2·t_db` | `Wo − (spec.innerWidthDeductionMm ?? 42)` |
| box length `Lb` | `Ls` | `Ls − (spec.lengthDeductionMm ?? 10)` |
| bottom offset `bo` | `DRAWER_BOTTOM_OFFSET_SIDE_MOUNT` (10) | `spec.bottomRecessMm ?? 13` |
| side thickness check | — | `t_db > (spec.maxSideThicknessMm ?? 16)` → warning `furniture.drawer_side_too_thick` |

Box placement: `bx0 = x0 + (w − Wb) / 2`; `by0 = slotY0 + fl((slotH − Hb) / 2)`; front end `zf = z1 − insetReduction − (behind ? BEHIND_DOOR_DEPTH_CLEARANCE : 0) − (behind ? t_db : 0)`; box `z ∈ [zf − Lb, zf]`.

**Parts of drawer j** (prefix `P = section.{S}.drawer.{j}`):

| Key | Role | Size (finished) | Thin | Grain | Banded | Faces |
|---|---|---|---|---|---|---|
| `P.side.left`, `P.side.right` | drawer_box | `Lb` (z) × `Hb` (y) | x | z | `top` (role band of `drawer_box`) | 0 |
| `P.back` | drawer_box | `Win` (x) × `Hb − bo − t_bt` (y) | z | x | `top` | 0 |
| `P.bottom` | drawer_bottom | `Win + 2 × (DRAWER_BOTTOM_GROOVE_DEPTH − 1)` (x) × `Lb` (z) | y | none | — | 0 |
| `P.front` (external) | front | drawer front rect `F_j` (§4.4) | z | x | all four | 2 |
| `P.front` (behind) | drawer_box | `Wb` (x) × `Hb` (y), `z ∈ [zf, zf + t_db]`, nameKey `parts.drawer_inner_front` | z | x | all four (`drawer_box` band) | 0 |

Hardware: `P.slides` qty 1 (`drawer_slide` unit `pair`); external fronts `P.handle` qty `F_j.w ≤ 600 ? 1 : 2` (§6.4). Operations: `slideScrewSets += 1` on the left and on the right bounding vertical part; `handleHoles` on the front part (§6.4).

Model fronts: external drawers add `{ id: P + '.front', frontId: null, kind: 'drawer', rect: F_j, partKey: P + '.front' }`.

### 3.13 Table family (`table/generateTable.ts`)

Symbols: `T = doc.table`; `t_top`, `t_c`, `t_s`, `t_leg` (leg material thickness), `t_f`, `t_b`.

| Quantity | Formula |
|---|---|
| layers `k` | `T.top.thickness === 'material' ? 1 : max(1, round(T.top.thickness / t_top))` (rounded → info `furniture.table_top_thickness_rounded` when not exact) |
| top total `Tt` | `k × t_top` |
| `Hb` (height under top) | `H − Tt` |
| base footprint | rectangle/rounded: `Wb = W − 2·o`, `Db = D − 2·o` with `o = T.top.overhang`; round/oval with legs/trestle/ends: `Wb = fl((W − 2o) / √2)`, `Db = fl((D − 2o) / √2)` |
| base origin | `bx0 = (W − Wb) / 2`, `bz0 = (D − Db) / 2` |
| leg section `s` | `legSource = 'solid' ? T.base.legSection : (legSpec.sectionMm ?? 50)` |

`shape = 'round'` requires `W === D` → else error `furniture.round_top_not_square` (the `setDims` command keeps them equal for round tops).

**Top**: `table.top` `y ∈ [H − t_top, H]`, and for `m = 2..k` `table.top.layer.{m}` `y ∈ [H − m·t_top, H − (m − 1)·t_top]`; all `x ∈ [0, W]`, `z ∈ [0, D]`, role top, thin y, grain x, banded all four, faces: `table.top` 1, layers 0. Geometry: rectangle → box; `rounded_rectangle` → extruded outline (rounded rect, radius `cornerRadius`, 8 segments per corner); `round` → circle (64 segments); `oval` → ellipse `W × D` (64 segments). `cornerRadius > min(W, D)/2` → error `furniture.corner_radius_too_large`.

**Base `four_legs`**

| Key | Condition | Box / size | Role | Thin | Grain | Banded | Faces |
|---|---|---|---|---|---|---|---|
| `table.leg.fl/fr/bl/br` | `legSource = 'solid'` | x `[bx0, bx0+s]` (left) / `[bx0+Wb−s, bx0+Wb]` (right); z `[bz0+Db−t_leg, bz0+Db]` (front, f) / `[bz0, bz0+t_leg]` (back, b); y `[0, Hb]` | leg | z | y | — | 2 |
| `table.apron.front` / `.back` | `apron.enabled` and drawers not on that side | x `[bx0+s, bx0+Wb−s]`; y `[Hb−ah, Hb]`; z front `[bz0+Db−inset−t_c, bz0+Db−inset]`, back `[bz0+inset, bz0+inset+t_c]` | carcass | z | x | `bottom` | 1 |
| `table.apron.left` / `.right` | same | z `[bz0+s, bz0+Db−s]`; x left `[bx0+inset, bx0+inset+t_c]`, right mirrored | carcass | x | z | `bottom` | 1 |
| `table.stretcher.left` / `.right` | `stretcher` | z `[bz0+s, bz0+Db−s]`, y `[150, 210]`, x centred on the legs, x-size `t_leg` | leg | x | z | — | 2 |
| `table.stretcher.center` | `stretcher` | x `[bx0+s, bx0+Wb−s]`, y `[150, 210]`, z centred at `bz0 + Db/2`, z-size `t_leg` | leg | z | x | — | 2 |
| `table.shelf` | `lowerShelf` | x `[bx0+s, bx0+Wb−s]`, z `[bz0+s, bz0+Db−s]`, y `[100, 100+t_s]` | shelf | y | x | `front`, `back` | 2 |

`ah = apron.height`. With `legSource = 'solid'` and `t_leg ≠ s` → info `furniture.leg_section_mismatch` (legs are `t_leg × s`). Hardware: `legSource = 'hardware'` → `table.legs` qty 4 (`legCode ?? leg.table`); apron enabled → `table.connectors.corner` qty 4 (`connector.table_corner`); dowels `table.connectors.dowel` qty = 2 per generated apron end (4 aprons → 16) + 2 per stretcher end (3 stretchers → 12) + 8 when `lowerShelf`. Leg height check (hardware legs, rule of `08 §2.3` against `Hb`) → warning `furniture.leg_height_mismatch`. `Wb > 2400` → warning `furniture.table_span_long`.

**Base `panel_ends`**

| Key | Box | Role | Thin | Grain | Banded | Faces |
|---|---|---|---|---|---|---|
| `table.end.left` / `.right` | x `[bx0, bx0+t_c]` / `[bx0+Wb−t_c, bx0+Wb]`, y `[0, Hb]`, z `[bz0, bz0+Db]` | carcass | x | y | `front`, `back` | 2 |
| `table.stretcher.back` (modesty, if `stretcher`) | x `[bx0+t_c, bx0+Wb−t_c]`, y `[Hb−mh, Hb]`, z `[bz0+20, bz0+20+t_c]`, `mh = min(MODESTY_MAX_HEIGHT, fl(Hb/2))` | carcass | z | x | `bottom` | 1 |
| `table.shelf` (if `lowerShelf`) | x `[bx0+t_c, bx0+Wb−t_c]`, y `[100, 100+t_s]`, z `[bz0, bz0+Db−20]` | shelf | y | x | `front` | 2 |

Joints: each end ↔ top (length `Db`), modesty ↔ each end (length `mh`), shelf ↔ each end (length `Db − 20`).

**Base `trestle`** (per side `σ ∈ {left, right}`, `cx = left ? bx0 + s : bx0 + Wb − s`):

| Key | Box | Role | Thin | Grain |
|---|---|---|---|---|
| `table.trestle.{σ}.upright` | x `[cx − t_leg/2, cx + t_leg/2]`, z `[bz0 + Db/2 − s, bz0 + Db/2 + s]`, y `[80, Hb − 80]` | leg | x | y |
| `table.trestle.{σ}.foot` | same x, z `[bz0, bz0 + Db]`, y `[0, 80]` | leg | x | z |
| `table.trestle.{σ}.cleat` | same x, z `[bz0, bz0 + Db]`, y `[Hb − 80, Hb]` | leg | x | z |
| `table.stretcher.center` | x `[bx0 + s + t_leg/2, bx0 + Wb − s − t_leg/2]`, y `[Hb/2 − 40, Hb/2 + 40]`, z centred, z-size `t_leg` | leg | z | x |

No banding, faces 2. Hardware: `table.connectors.cam` qty 4 (beam ends), `table.connectors.dowel` qty 8.

**Base `pedestal`**: column inner size `c = max(150, fl(0.25 × min(Wb, Db)))` centred at `(W/2, D/2)`; `table.pedestal.side.1` (front) and `.3` (back): x-size `c + 2·t_c`, thin z; `.2` (left) and `.4` (right): z-size `c`, thin x; all y `[t_c, Hb − t_c]`, role carcass, grain y, faces 2. `table.pedestal.base`: square `b = max(400, fl(0.6 × min(W, D)))`, y `[0, t_c]`, banded all four; `table.pedestal.top`: square `c + 2·t_c + 100`, y `[Hb − t_c, Hb]`. `max(W, D) > 1200` → warning `furniture.pedestal_unstable`.

**Base `cabinet_ends`**: a panel end on the **left** (`table.end.left` as in `panel_ends`) and a cabinet on the **right** (mirror the placement to get the left-hand variant — `FurniturePlacement.mirrored`). Cabinet `cw = endCabinets.width`, carcass x `[cx0, cx1] = [bx0 + Wb − cw, bx0 + Wb]`, depth `Dk = Db − t_f`, z `[bz0, bz0 + Dk]`:

| Key | Box | Role | Banded |
|---|---|---|---|
| `table.cabinet.side.left` / `.right` | x-size `t_c` at `cx0` / `cx1 − t_c`, y `[0, Hb]`, z `[bz0, bz0 + Dk]` | carcass | `front` |
| `table.cabinet.bottom` | x `[cx0 + t_c, cx1 − t_c]`, y `[0, t_c]`, z `[bz0 + t_b, bz0 + Dk]` | carcass | `front` |
| `table.cabinet.back` | x `[cx0 + t_c, cx1 − t_c]`, y `[t_c, Hb]`, z `[bz0, bz0 + t_b]` (inset back) | back | — |

Cabinet interior: x `[cx0 + t_c, cx1 − t_c]`, y `[t_c, Hb]`, z `[bz0 + t_b, bz0 + Dk]`. The table top is the cabinet top. Content (`endCabinets.content`):

- `drawers` → §3.12 with key prefix `table.cabinet.drawer.{j}`, `drawerStyle = 'full'`, opening edges left/right/bottom `outer` (t_c), **top edge cover = −2** (2 mm under the table top).
- `shelves` → §3.9 with keys `table.cabinet.shelf.{i}`, supports `table.cabinet.shelf_supports`, plus one door `table.cabinet.door` (single leaf, full overlay, hinge `right`, opening edges as for drawers), hardware `table.cabinet.door.hinges`, `.hinge_plates`, `.handle`.
- `empty` → open cabinet. Any other content → error `furniture.cabinet_content_unsupported`.

Joints: cabinet sides ↔ bottom, left end ↔ top, cabinet sides ↔ top (lengths = depth of the joined panel). Knee width `Wb − cw − t_c < 550` → warning `furniture.knee_space_narrow`. Modesty (`stretcher`) spans `[bx0 + t_c, cx0]`.

**Under-top drawers** `storage.drawers = { count k, side, slideCode }` (`k = 0` or `null` → none):

- Allowed: `four_legs` (any side), `panel_ends` and `cabinet_ends` (`side = 'front'` only; other sides → error `furniture.table_drawer_side_unsupported`).
- Span: four_legs front/back `Wb − 2s` (z plane of the front apron), left/right `Db − 2s`; panel_ends `Wb − 2·t_c`; cabinet_ends `cx0 − (bx0 + t_c)`.
- Front height `fh = apron.enabled ? apron.height : TABLE_DRAWER_FRONT_HEIGHT`; slot width `ws = min(TABLE_DRAWER_MAX_WIDTH, fl((span − (k − 1) × TABLE_DRAWER_SPACING) / k))`; drawers centred in the span with `TABLE_DRAWER_SPACING` between them.
- Each drawer `j`: `table.drawer.{j}.front` (role front, `ws × fh`, banded all four, faces 2, front face flush with the apron plane), runners `table.drawer.{j}.runner.left/right` (role carcass, thin x, `depthAvail × (fh + 20)`, hung under the top), box per §3.12 with `Wo = ws`, slot height `fh + 20`, `A = depthAvail` where `depthAvail = four_legs ? (side ∈ {front, back} ? Db − 2·apron.inset − t_c : Wb / 2 − s) : Db − 40` (four_legs front/back: from the front apron plane to the inner face of the opposite apron). Hardware `table.drawer.{j}.slides`, `table.drawer.{j}.handle`.
- The apron on the drawer side is not generated.

Hardware for tables also includes `screw_pack.default` (§6.9) and nothing from §6.8.

### 3.14 Overrides (`overrides.ts`)

Applied after generation, in this order:

1. **Part overrides** (`doc.overrides.parts[key]`): missing key in the model → dropped + info `furniture.override_orphaned` `{ key }`. Otherwise:
   - `removed: true` → remove the part (and its `fronts` entry when the key is a leaf/drawer front).
   - `materialCode` → set `materialCode`, `thickness` from the new material; geometry unchanged.
   - `edges` → per-edge replacement (`null` = no band).
   - `lengthDelta`, `widthDelta` → added to `length` / `width`; geometry box grows/shrinks along the corresponding axes from the min corner. Result `≤ 0` → error `furniture.override_invalid` `{ key }` (part kept at generated size).
   - `grain` → set.
   - `note` → kept in the document only (used by exports, `08 §8`).
   - `overridden = true`.
2. **Hardware overrides** (`doc.overrides.hardware[key]`): orphaned → as above. `removed` → drop the line; `code` → replace code; `qtyDelta` → `qty += qtyDelta` (`qty ≤ 0` → line dropped); `overridden = true`.
3. **Extra parts**: each `ExtraPart` becomes a `Part` with `key = 'extra.' + id`, `nameKey = 'parts.extra'`, `nameParams = { name }`, given role/material/size/edges/grain/qty, thickness from material, `source = 'extra'`, operations all 0, `visibleFaces = role === 'front' ? 2 : (role ∈ {carcass, top, plinth, leg} ? 1 : 0)`, geometry = `placement` box or, when `placement = null`, `{ kind: 'box', box: { min: [0,0,0], size: [0,0,0] } }` (zero-size boxes are not rendered).
4. **Extra hardware**: `HardwareLine` with `key = 'extra.' + id`, `reasonKey = 'hardware.reason.extra'`, `frontId = sectionId = null`, `source = 'extra'`.

---

## 4. Fronts

### 4.1 Openings and edge classification (`fronts/openings.ts`)

An **opening** is the interior rectangle (front elevation, x/y) that a front closes:

- for a `Front`: the bounding rectangle of the boxes of all sections in `covers`;
- for an external drawer leaf: the leaf box (one opening per leaf, later divided into drawer fronts).

`furniture.front_not_rectangle` (03) is evaluated as: `area(bounding rect) === Σ area(covered sections, counting each leaf at most once even when an ancestor is also listed) + Σ area(dividers lying entirely inside the bounding rect)`. `furniture.front_overlap` (03): two fronts whose covered leaf sets intersect.

Each opening edge `e ∈ {left, right, top, bottom}` at coordinate `c` is classified:

1. `c` equals the interior bound on that side (`ix0`, `ix1`, `iy0`, `iy1`) → **outer**, panel thickness `tp = t_c`.
2. Else find the divider whose face is at `c` (left edge: divider with `x1 = c`; right: `x0 = c`; bottom: `y1 = c`; top: `y0 = c`) with positive overlap along the edge (largest overlap wins) → `tp` = divider thickness; then **shared** if another non-sliding opening has its opposite edge on the divider's other face with positive overlap, else **divider_open**.
3. Nothing found (degenerate) → outer with `t_c`.

**Cover** `cv` = how far the front edge extends beyond the opening edge (negative = inside):

| overlay ↓ / edge → | outer | shared | divider_open |
|---|---|---|---|
| `full` | `tp − FULL_OVERLAY_EDGE_GAP` | `tp/2 − DOOR_GAP/2` | `tp − FULL_OVERLAY_EDGE_GAP` |
| `half` | `tp/2 − DOOR_GAP/2` | `tp/2 − DOOR_GAP/2` | `tp/2 − DOOR_GAP/2` |
| `inset` | `−INSET_GAP` | `−INSET_GAP` | `−INSET_GAP` |

Front rectangle: `X0 = ox0 − cv_left`, `X1 = ox1 + cv_right`, `Y0 = oy0 − cv_bottom`, `Y1 = oy1 + cv_top`.

Worked example (wardrobe fixture §12.2, `t_c = 18`): column 1 opening `x ∈ [18, 600]`, `y ∈ [118, 2082]`; left edge outer → `cv = 16.5` → `X0 = 1.5`; right edge on partition `[600, 618]` shared with column 2's front → `cv = 8` → `X1 = 608`; top/bottom outer → `Y1 = 2098.5`, `Y0 = 101.5`. Leaf `606.5 × 1997` → part `606 × 1997`.

### 4.2 Hinged fronts (`fronts/hinged.ts`)

- Leaves `n = leaves === 'auto' ? min(2, ceil((ox1 − ox0) / MAX_DOOR_WIDTH)) : leaves` (opening width, not the front rectangle). `n > 2` → error `furniture.hinged_leaves_unsupported` ("a door needs a side or partition to hang on — split the front per column"); geometry is generated with `n = 2`.
- Leaf width `lw = (X1 − X0 − (n − 1) × DOOR_GAP) / n`; leaf `k` spans `x ∈ [X0 + (k − 1)(lw + DOOR_GAP), … + lw]`, `y ∈ [Y0, Y1]`; `z ∈ [Dc, Dc + t_f]` (full/half) or `[Dc − t_f, Dc]` (inset).
- Part `front.{F}.leaf.{k}`: role front, thin z, grain y, banded all four, faces 2, nameKey `parts.door`, nameParams `{ leaf: k }`. Finished size `fl(lw) × fl(Y1 − Y0)`.
- Hinge side: `n = 1` → `hingeSide === 'auto' ? 'right' : hingeSide`; `n = 2` → leaf 1 `left`, leaf 2 `right`.
- **Hinge edge class** = class of the opening edge on the hinge side (leaf 1 of 2 → left edge, leaf 2 of 2 → right edge). Used by §6.2.
- Model `fronts` entry per leaf: `{ id: partKey, frontId: F, kind: 'door', rect: { x: fl(lx0), y: fl(Y0), w: fl(lw), h: fl(Y1 − Y0) }, hingeSide, partKey }`.
- Warnings: `(ox1 − ox0) / n > MAX_DOOR_WIDTH` → `furniture.door_wide`; `Y1 − Y0 > MAX_DOOR_HEIGHT` → `furniture.door_tall`; `lw < 100` or height `< 100` → error `furniture.front_too_small`.

### 4.3 Flap fronts (`flap_up`, `flap_down`)

Same rectangle as a single hinged leaf (`leaves` ignored; numeric `leaves > 1` → warning `furniture.flap_leaves_ignored`). Part `front.{F}.leaf.1`, nameKey `parts.flap`, grain x. Hinge edge: `flap_up` → top edge, `flap_down` → bottom edge; hinges are counted along the **width** (§6.2). Model kind `'flap'`, no `hingeSide`.

### 4.4 Drawer fronts

For each external drawer leaf: opening → rectangle `[X0, X1] × [Y0, Y1]` using overlay `env.drawerStyle`. Divided vertically into `n` fronts with `DRAWER_FRONT_GAP`:

- `frontHeights = 'equal'` → `hf_j = (Y1 − Y0 − (n − 1) × DRAWER_FRONT_GAP) / n`.
- `frontHeights: Mm[]` (length must equal `n`, else treated as `'equal'` + warning `furniture.drawer_heights_invalid`): `hf_j = frontHeights[j−1]` for `j < n`, `hf_n = (Y1 − Y0) − Σ_{j<n} hf_j − (n − 1) × DRAWER_FRONT_GAP`; `hf_n < 80` → error `furniture.drawer_heights_invalid`.
- Front `j` (1 = top): `y1_j = Y1 − Σ_{i<j}(hf_i + DRAWER_FRONT_GAP)`, `y0_j = y1_j − hf_j`. Rect `{ x: fl(X0), y: fl(y0_j), w: fl(X1 − X0), h: fl(hf_j) }`; part size `fl(X1 − X0) × fl(hf_j)`.

### 4.5 Glass frame doors (`glass: true`, hinged, flap or sliding)

Each leaf rectangle (`lw × lh`) is replaced by a frame + glass:

| Key (prefix `front.{F}.leaf.{k}`) | Size | Role | Grain | Banded | Faces |
|---|---|---|---|---|---|
| `.stile.left`, `.stile.right` | `GLASS_FRAME_WIDTH × lh` | front | along length (y) | all four | 2 |
| `.rail.top`, `.rail.bottom` | `(lw − 2·GLASS_FRAME_WIDTH) × GLASS_FRAME_WIDTH` | front | along length (x) | all four | 2 |
| `.glass` | `(lw − 2·60 + 2·(GLASS_REBATE_DEPTH − GLASS_CLEARANCE)) × (lh − 2·60 + 2·(8 − 1))` = `(lw − 106) × (lh − 106)` | front, material = `idx.glassMaterial()` | none | — | 0 |

- `lw < 2·60 + 100` or `lh < 2·60 + 100` → error `furniture.glass_door_too_small` and a solid leaf is generated instead.
- No active glass material → error `furniture.no_glass_material` (solid leaf generated).
- The solid leaf key `front.{F}.leaf.{k}` is **not** generated; the model `fronts` entry uses `partKey = front.{F}.leaf.{k}.stile.left`. Renderers group all parts whose key starts with `front.{F}.leaf.{k}.` into one pivot.
- Glass panels are excluded from nesting and billed by area (`08 §4.1`).
- Leaf weight (for hinges) = frame parts + glass panel (§6.1).

### 4.6 Sliding fronts (`fronts/sliding.ts`)

- v1 restriction: the sliding front's opening must equal the full interior rectangle (`[ix0, ix1] × [iy0, iy1]`), else error `furniture.sliding_front_partial`. At most one sliding front per carcass (else error `furniture.sliding_front_multiple`).
- Doors run **inside** the carcass between the sides, under the top and on the bottom, in the front zone of depth `env.slidingZone` (dividers and contents are recessed, §3.2).
- `Wo = ix1 − ix0`, `Ho = iy1 − iy0`. Leaves `n = leaves === 'auto' ? clamp(max(2, ceil(Wo / MAX_SLIDING_LEAF_WIDTH)), 2, 4) : leaves`; `n < 2` or `n > 4` → error `furniture.sliding_leaves_unsupported`.
- Leaf width `lw = (Wo + (n − 1) × SLIDING_OVERLAP) / n`; leaf height `lh = Ho − SLIDING_HEIGHT_DEDUCTION`.
- Leaf `k`: `x ∈ [ix0 + (k − 1)(lw − SLIDING_OVERLAP), … + lw]`, `y ∈ [iy0 + 15, iy0 + 15 + lh]`; track: odd `k` → front track `z ∈ [Dc − 6 − t_f, Dc − 6]`, even `k` → rear track `z ∈ [Dc − 6 − t_f − p, Dc − 6 − p]` with `p = t_f + SLIDING_TRACK_PITCH_EXTRA`.
- Part `front.{F}.leaf.{k}`: nameKey `parts.sliding_door`, role front, grain y, banded all four, faces 2. Size `fl(lw) × fl(lh)`.
- Hardware: track code = `slidingTrackCode === 'auto' ? defaultHardware('sliding_track.default') : slidingTrackCode` (`null` → no track/rollers, staff handle it manually); `front.{F}.track` qty `ceil(Wo / track.specs.lengthMm)`; `front.{F}.rollers` qty `n` (`sliding_roller.default`); `front.{F}.handles` qty `n` (§6.4).
- Warnings: `lw < MIN_SLIDING_LEAF_WIDTH` → `furniture.sliding_leaf_narrow`; leaf weight > roller `specs.maxLeafWeightKg` → `furniture.sliding_leaf_heavy`; `lh > MAX_DOOR_HEIGHT` → `furniture.door_tall`.
- Model kind `'sliding'`.

---

## 5. Edge banding, grain and visible faces

### 5.1 Band resolution

`roleBand(role) = doc.materials[role].edgeBandCode ?? material(role).defaultEdgeBandCode ?? null`. Every banded physical edge of a part gets `roleBand(part.role)` (drawer box sides/back/inner fronts use `roleBand('drawer_box')`). Hidden edges get no band (`null`). Overrides (`PartOverride.edges`) win over everything. The band thickness reduces the cut size (`08 §3.2`); band lengths are summed in `08 §3.3`.

### 5.2 Default banding rules (summary of §3–§4; normative)

| Part | Banded physical edges |
|---|---|
| Carcass sides | front; top iff top between sides and no countertop; bottom iff bottom between sides and mounting ≠ floor |
| Carcass top | front; left+right iff over sides |
| Carcass bottom | front; left+right iff over sides |
| Partition, fixed shelf, loose shelf | front |
| Back panels, plinth back, plinth returns | none |
| Plinth front / kickboard | left+right iff setback > 0 |
| Countertop | front, left, right |
| Door / flap / sliding leaf / drawer front / glass frame parts | all four |
| Drawer box sides and back | top |
| Drawer inner front (behind door) | all four |
| Drawer bottom, glass panel | none |
| Table top (+ layers) | all four (non-rectangular: perimeter, `08 §3.3`) |
| Table aprons, modesty panel | bottom |
| Table end panels | front, back |
| Table lower shelf | four_legs: front+back; panel ends: front |
| Table cabinet sides, bottom | front |
| Solid legs, stretchers, trestle parts, pedestal sides | none |
| Pedestal base plate | all four |
| Extra parts | as entered |

### 5.3 Grain intent (applied only when the material has `hasGrain`)

| Part | Grain axis (local) | Typical result |
|---|---|---|
| Sides, partitions, backs, doors, sliding leaves, stiles, table end panels, legs, pedestal sides, trestle uprights | y (vertical) | `length` |
| Top, bottom, fixed/loose shelves, plinth parts (front/back), countertop, drawer fronts, flaps, rails, aprons (front/back), modesty, table top, lower shelf | x (along furniture width) | `length` for wide parts, `width` for parts deeper than wide |
| Plinth returns, drawer box sides, side aprons, side stretchers, trestle feet/cleats | z | `length` |
| Drawer bottoms, glass | none | `none` |

### 5.4 Visible faces (finish area, `08 §3.6`)

`visibleFaces` per part is given in the tables of §3–§4. Summary: fronts (doors, flaps, sliding leaves, drawer fronts, glass frame) **2**; carcass sides **1**; carcass top **1** only when `over_sides` without countertop; countertop, plinth front, table top layer 1, aprons, modesty **1**; table legs, stretchers, ends, lower shelf, pedestal sides **2**; everything else **0**.

---

## 6. Hardware rules (`rules/*.ts`)

### 6.1 Weight

`partWeightKg(part) = density(material) × (length/1000) × (width/1000) × (thickness/1000)` with `density = material.densityKgM3 ?? DEFAULT_DENSITY[boardType]`:

| boardType | particle_board | mdf | hdf | plywood | blockboard | solid_wood | glass | acrylic | metal_sheet |
|---|---|---|---|---|---|---|---|---|---|
| kg/m³ | 650 | 750 | 900 | 600 | 550 | 700 | 2500 | 1190 | 7850 |

Leaf weight = sum of the parts of that leaf (glass doors: frame + glass). Total weight = Σ over all parts × qty (hardware ignored) → info issue `furniture.weight_estimate` `{ kg }` (1 decimal, `Math.round(kg × 10) / 10`), always emitted; shown in the estimate panel.

### 6.2 Hinges (hinged leaves and flaps)

```ts
export function hingeCount(edgeLengthMm: number, leafWeightKg: number): number {
  const byLength = edgeLengthMm <= 900 ? 2 : edgeLengthMm <= 1600 ? 3 : edgeLengthMm <= 2000 ? 4 : 5;
  const byWeight = leafWeightKg <= 6 ? 2 : leafWeightKg <= 12 ? 3 : leafWeightKg <= 17 ? 4 : 5;
  return Math.max(byLength, byWeight);
}
```

- Edge length = leaf height (doors) or leaf width (flaps). Leaf weight > 22 kg → warning `furniture.door_heavy` `{ kg }`.
- **Hinge type** (role key), by the hinge edge class (§4.2) and the front overlay:

| Front overlay | Hinge edge outer / divider_open | Hinge edge shared |
|---|---|---|
| `full` | `hinge.full_overlay` (straight arm) | `hinge.half_overlay` (cranked) |
| `half` | `hinge.half_overlay` | `hinge.half_overlay` |
| `inset` | `hinge.inset` (heavy crank) | `hinge.inset` |

- `Front.hingeCode`: `'auto'` → role default above; a code → that code for all leaves; `null` → no hinges and no plates.
- Hardware lines per front: `front.{F}.hinges` = hinges of leaves whose type is the front's **primary** type (outer/divider_open edges); `front.{F}.hinges.shared` = hinges of leaves hinged on a shared edge (when their code differs); `front.{F}.hinge_plates` = total hinges × `hinge_plate.default`, omitted when the hinge item has `specs.integratedPlate = true`.
- Positions (production sheet and 3D): along the hinge edge of length `L`, hinge `i` of `n` at `HINGE_END_OFFSET + (i − 1) × (L − 2·HINGE_END_OFFSET) / (n − 1)` from the top (doors) or left (flaps); cup centre `boringDistance + 17.5` mm from the leaf edge (`boringDistance = spec.boringDistanceMm ?? 4`, valid 3–6). Mounting plates on the side at `SYSTEM32_FRONT_OFFSET` (37 mm) from the front edge.
- Operations: leaf part `hingeCups += n`.

### 6.3 Flap mechanisms

- `flap_up` → `front.{F}.gas_struts`: `gas_strut.default` × (`leaf width ≤ 600 ? 1 : 2`).
- `flap_down` → `front.{F}.stays`: `lift.default` (category `lift_mechanism`, a soft-down flap stay) × (`leaf width ≤ 600 ? 1 : 2`).
- Flap weight > 8 kg → warning `furniture.flap_heavy`.

### 6.4 Handles and knobs

- Resolution for a `Front`: `handleCode === 'inherit' ? carcass.handles.code : handleCode`; `null` = no handle (handle-less / push-to-open). Drawers use `carcass.handles.code`. Table drawers and table cabinet doors use `defaultHardware('handle.default')`.
- Counts: hinged leaf 1; sliding leaf 1; flap and drawer front `width ≤ 600 ? 1 : 2`. Line keys: `front.{F}.handles` (sum over leaves), `section.{S}.drawer.{j}.handle`, `table.drawer.{j}.handle`, `table.cabinet.drawer.{j}.handle`, `table.cabinet.door.handle`.
- Fit: a bar handle (`specs.lengthMm`) whose length + 2 × `HANDLE_EDGE_OFFSET` exceeds the front dimension along the handle orientation → `knob.default` is used instead for that front + info `furniture.handle_replaced_by_knob`.
- Holes: `handleHoles += specs.holeCount ?? (category === 'knob' ? 1 : 2)` per handle on the front part.
- Orientation `auto`: doors and sliding leaves vertical; drawers and flaps horizontal. Placement `auto` (3D only): hinged doors near the opening edge (`HANDLE_EDGE_OFFSET` from it) at centre height `TALL_HANDLE_HEIGHT` for floor units with `H ≥ 1500` (clamped into the leaf), 80 mm from the leaf top for other floor units, 80 mm from the leaf bottom for wall/loft units; drawers and flaps centred horizontally, 40 mm from the top edge; two handles per front at ¼ and ¾ of the width. `top`/`middle`/`bottom` override the vertical rule.

### 6.5 Drawer slides

See §3.12. Line key `…drawer.{j}.slides`, qty 1, unit `pair`. Side-mount slide length steps available in the catalog: 250–600 in 50 mm steps (seeded, `08 §7`).

### 6.6 Legs

- **Cabinet legs** (`plinth.type = 'legs'`, floor): columns `cols = max(2, ceil(Wc / LEG_COLUMN_SPACING) + 1)`, two rows (front, back) → `plinth.legs` qty `2 × cols`. Code = `plinth.legCode ?? defaultHardware(setback > 0 ? 'leg.plinth' : 'leg.cabinet')`. 3D: x evenly from `x0 + 30` to `x0 + Wc − 30`; z back `30`, front `Dc − setback − 30`. Height check (`08 §2.3`): when the item's specs have `minHeightMm`/`maxHeightMm`, `plinth.height` must lie in that range; otherwise `|specs.heightMm − plinth.height| ≤ (specs.adjustableMm ?? 0)`; failure → warning `furniture.leg_height_mismatch`.
- **Table legs**: §3.13 (`table.legs` qty 4, `leg.table`).

### 6.7 Shelf supports, rods, baskets

Shelf supports: 4 per adjustable shelf (§3.9). Hanging rod + 2 supports per rod piece (§3.10). Baskets (§3.11).

### 6.8 Mounting

- `mounting ∈ {wall, loft}` → `carcass.wall_brackets` = `wall_bracket.default` × `2 × max(1, ceil(Wc / 1000))`.
- `mounting = 'floor'` and `H ≥ ANTI_TIP_MIN_HEIGHT` → `carcass.anti_tip` = `anti_tip.default` × 1 (kit), info `furniture.anti_tip_added`.

### 6.9 Connectors and screws

Every joint recorded in `ctx.joints` (`{ member: PartKey, other: PartKey, length: Mm }`) gets `cams = max(2, ceil(length / CAM_SPACING))` and `dowels = cams`. Operation counters: `camLocks += cams` and `dowels += dowels` on the **member** part. Hardware: `carcass.connectors.cam` (`connector.cam`) qty Σ cams, `carcass.connectors.dowel` (`connector.dowel`) qty Σ dowels (table bases use the `table.connectors.*` lines of §3.13 instead; table cabinets and table panel-end joints add to `table.connectors.cam` / `table.connectors.dowel`).

Joint list (carcass): top↔each side, bottom↔each side, each partition↔its top and bottom horizontal panel, each fixed shelf↔its two verticals, each non-adjustable loose shelf↔its two verticals. Plinths, backs, countertops and drawer boxes are screwed/nailed (covered by screw packs).

Screw packs: `carcass.screws` / `table.screws` = `screw_pack.default` × `max(1, ceil(generatedPartCount / SCREW_PACK_PARTS))` (count before overrides, `Σ qty`).

### 6.10 Sliding hardware

§4.6 (`front.{F}.track`, `front.{F}.rollers`, `front.{F}.handles`).

### 6.11 Hardware role keys (`hardware_items.is_default_for`) — exhaustive

| Role key | Category | Used by |
|---|---|---|
| `hinge.full_overlay` | hinge | §6.2 |
| `hinge.half_overlay` | hinge | §6.2 |
| `hinge.inset` | hinge | §6.2 |
| `hinge_plate.default` | hinge_plate | §6.2 |
| `slide.side_mount` | drawer_slide | §3.12 default family (the flagged item's `specs.family` defines the family; length chosen per drawer) |
| `slide.undermount` | drawer_slide | templates choosing undermount (§2.4.4, §2.4.11) |
| `handle.default` | handle | §2.3 carcass handles, tables |
| `handle.flush` | handle | sliding wardrobes (§2.4.2) |
| `knob.default` | knob | §6.4 fallback |
| `leg.plinth` | plinth_leg | §6.6 (`setback > 0`) |
| `leg.cabinet` | leg | §6.6 (`setback = 0`, visible legs) |
| `leg.table` | leg | §3.13 |
| `rod.default` | hanging_rod | §3.10 |
| `rod_support.default` | rod_support | §3.10 |
| `shelf_support.default` | shelf_support | §3.9 |
| `connector.cam` | connector | §6.9 |
| `connector.dowel` | connector | §6.9 |
| `connector.table_corner` | connector | §3.13 |
| `wall_bracket.default` | wall_bracket | §6.8 |
| `anti_tip.default` | wall_bracket | §6.8 |
| `sliding_track.default` | sliding_track | §4.6 |
| `sliding_roller.default` | sliding_roller | §4.6 |
| `gas_strut.default` | gas_strut | §6.3 |
| `lift.default` | lift_mechanism | §6.3 |
| `basket.default` | other (`specs.kind = 'basket'`) | §3.11 |
| `screw_pack.default` | screw_pack | §6.9 |
| `lock.default` | lock | builder quick-add only (never generated) |
| `led_strip.default` | led_strip | builder quick-add only (never generated) |

The admin catalog UI (11) shows these keys as a multi-select on hardware items, restricted to keys whose category matches the item. Assigning a key to an item **removes** it from any other item in the same transaction (one default per key).

### 6.12 Hardware reason keys

`reasonKey` values (`resources/lang/en/hardware.php` → `reason`): `hinges_for_door` ({leaf count}), `hinge_plates`, `handles_for_front`, `handle_for_drawer`, `slides_for_drawer` ({length}), `shelf_supports` ({shelves}), `hanging_rod`, `rod_supports`, `baskets`, `cam_locks` ({joints}), `dowels` ({joints}), `screw_pack`, `plinth_legs`, `cabinet_legs`, `table_legs`, `wall_brackets`, `anti_tip`, `sliding_track` ({length}), `sliding_rollers`, `gas_struts`, `flap_stays`, `table_corner_brackets`, `extra`. `reasonParams` contain the values in braces.

---

## 7. Validation (`validate.ts`)

### 7.1 Severity semantics

- `validateFurniture(doc, catalog): Issue[]` = structural checks of `03 §2.4` + `generateFurniture(doc, catalog).issues` (deduplicated by `code + entityIds`).
- `SAVE_BLOCKING_CODES` = exactly the codes of `03 §2.4` (`furniture.dims_range`, `furniture.family_mismatch`, `furniture.section_tree_invalid`, `furniture.section_too_small`, `furniture.fixed_sizes_exceed`, `furniture.front_not_rectangle`, `furniture.front_overlap`, `furniture.unknown_code`, `furniture.too_many_parts`). The engine CLI `validate-furniture` returns `valid = !issues.some(i => SAVE_BLOCKING_CODES.has(i.code))`; only those make an autosave fail with 422 (`03 §5`).
- Every other `error` issue (manufacturing errors) **does not block saving** but blocks order submission (T2: "no error issues") and proposal sending (T6 additionally requires no error issues in each `staff_draft_document`, Appendix).
- `warning` never blocks. `CRITICAL_WARNING_CODES = ['furniture.shelf_sag_critical', 'furniture.door_heavy', 'furniture.sliding_leaf_heavy', 'furniture.part_exceeds_sheet_back']` are rendered with the danger colour and listed first.
- `info` issues are shown only in advanced mode (§8.8).

`entityIds` conventions: section ids, front ids, part keys or hardware keys involved; the Issues panel focuses the first one (§8.7.7).

### 7.2 Shelf sag table (`rules/sag.ts`)

Limits are the **span** (shelf length between supports, mm) above which a warning / critical warning is emitted, for an evenly loaded shelf (books ≈ 25 kg/m).

| boardType | thickness | warn | critical |
|---|---|---|---|
| particle_board | 16 | 600 | 800 |
| particle_board | 18 | 800 | 1000 |
| particle_board | 25 | 1000 | 1250 |
| mdf | 16 | 650 | 850 |
| mdf | 18 | 850 | 1050 |
| mdf | 25 | 1050 | 1300 |
| plywood | 12 | 600 | 800 |
| plywood | 15 | 800 | 1000 |
| plywood | 18 | 1000 | 1200 |
| plywood | 25 | 1200 | 1500 |
| blockboard | 18 | 1000 | 1250 |
| blockboard | 25 | 1200 | 1500 |
| solid_wood | 18 | 900 | 1100 |
| solid_wood | 25 | 1200 | 1500 |
| glass | 5 | 500 | 700 |
| glass | 8 | 700 | 900 |
| glass | 10 | 800 | 1000 |
| hdf | 3 | 300 | 400 |
| hdf | 6 | 400 | 500 |
| any other type | t | `44 × t` | `55 × t` |

Lookup: the row of the same board type with the largest thickness ≤ `t`; if `t` is below every row, the smallest row scaled by `t / t_row`. **Fixed shelves and non-adjustable loose shelves** (clamped at both ends with cams/dowels) use **1.5 ×** both limits (clamped-end deflection is ~1/5 of simply supported; `5^(1/4) ≈ 1.5`). Applies to: loose shelves, fixed shelves, table lower shelves, table cabinet shelves. Span = part `length` along x.

### 7.3 Issue catalogue (exhaustive for furniture; English text in `resources/lang/en/issues.php`)

| Code | Sev. | Condition | Params | English message |
|---|---|---|---|---|
| `furniture.dims_range` | error | `03 §2.4` | dimension, min, max | "{dimension} must be between {min} and {max} mm." |
| `furniture.family_mismatch` | error | `03` | — | "The design data is inconsistent (family)." |
| `furniture.section_tree_invalid` | error | `03` | sectionId | "The layout of this section is invalid." |
| `furniture.section_too_small` | error | leaf net width < 100 or height < 80 | sectionId, width, height | "This compartment is too small ({width} × {height} mm)." |
| `furniture.fixed_sizes_exceed` | error | §3.7 | sectionId, overBy | "Fixed sizes are {overBy} mm larger than the available space." |
| `furniture.front_not_rectangle` | error | §4.1 | frontId | "A door must cover a rectangular area." |
| `furniture.front_overlap` | error | §4.1 | frontIds | "Two doors cover the same compartment." |
| `furniture.unknown_code` | error | §3.1 | code, kind | "Unknown catalog item {code}." |
| `furniture.too_many_parts` | error | > 400 parts | count | "Too many parts ({count}); simplify the design." |
| `furniture.envelope_too_small` | error | §3.2 | — | "The cabinet is too small for its plinth, countertop and doors." |
| `furniture.part_exceeds_sheet` | error | non-back, non-glass part fails `fitsSheet` | partKey, length, width, sheetLength, sheetWidth | "{part} ({length} × {width}) is larger than a sheet of {material}." |
| `furniture.drawer_no_slide` | error | §3.12 | sectionId, availableDepth | "The compartment is too shallow ({availableDepth} mm) for drawer slides." |
| `furniture.drawer_too_low` | error | §3.12 | sectionId, drawer | "Drawer {drawer} is too low for a drawer box." |
| `furniture.drawer_heights_invalid` | error | §4.4 | sectionId | "Drawer front heights don't fit the compartment." |
| `furniture.front_too_small` | error | §4.2 | frontId | "This door is too small." |
| `furniture.hinged_leaves_unsupported` | error | §4.2 | frontId | "A hinged door can have at most 2 leaves; split it per column." |
| `furniture.sliding_front_partial` | error | §4.6 | frontId | "Sliding doors must cover the whole front." |
| `furniture.sliding_front_multiple` | error | §4.6 | — | "Only one set of sliding doors per cabinet." |
| `furniture.sliding_leaves_unsupported` | error | §4.6 | frontId | "Sliding doors need 2 to 4 leaves." |
| `furniture.glass_door_too_small` | error | §4.5 | frontId | "This door is too small for a glass panel." |
| `furniture.no_glass_material` | error | §4.5 | — | "No glass is available in the catalog." |
| `furniture.shelves_dont_fit` | error | §3.9 | sectionId | "Too many shelves for this compartment." |
| `furniture.override_invalid` | error | §3.14 | key | "An adjustment makes a part size zero or negative." |
| `furniture.round_top_not_square` | error | §3.13 | — | "A round top needs equal width and depth." |
| `furniture.corner_radius_too_large` | error | §3.13 | — | "Corner radius is too large." |
| `furniture.cabinet_content_unsupported` | error | §3.13 | — | "Desk cabinets can hold drawers or shelves only." |
| `furniture.table_drawer_side_unsupported` | error | §3.13 | — | "Drawers can only be on the front for this base." |
| `furniture.archived_code` | warning | `03` | code | "{code} is no longer sold; we'll suggest an alternative." |
| `furniture.shelf_sag` | warning | §7.2 | partKey, span, limit | "Shelf span {span} mm may sag; consider thicker board or a partition." |
| `furniture.shelf_sag_critical` | warning | §7.2 | partKey, span, limit | "Shelf span {span} mm will sag: use 25 mm board or add a partition." |
| `furniture.door_wide` | warning | opening share per leaf > 600 (§4.2) | frontId, width | "Doors wider than 600 mm may warp and are heavy to open." |
| `furniture.door_tall` | warning | leaf > 2400 | frontId, height | "Doors taller than 2400 mm need a door straightener." |
| `furniture.door_heavy` | warning | > 22 kg | frontId, kg | "This door weighs about {kg} kg; hinges may not hold it." |
| `furniture.flap_heavy` | warning | > 8 kg | frontId, kg | "This flap weighs about {kg} kg." |
| `furniture.flap_leaves_ignored` | warning | §4.3 | frontId | "Flaps always have one leaf." |
| `furniture.sliding_leaf_narrow` | warning | §4.6 | frontId | "Sliding leaves narrower than 450 mm run poorly." |
| `furniture.sliding_leaf_heavy` | warning | §4.6 | frontId, kg | "Sliding leaf too heavy for the rollers." |
| `furniture.drawer_depth_unused` | warning | §3.12 | sectionId, unused | "{unused} mm of depth is unused behind the drawers." |
| `furniture.drawers_forced_behind_door` | warning | §3.12 | sectionId | "Drawers behind a door get an inner front." |
| `furniture.drawer_side_too_thick` | warning | §3.12 | sectionId | "Drawer sides are too thick for these slides." |
| `furniture.rod_section_shallow` | warning | §3.10 | sectionId, depth | "Hanging needs at least 530 mm depth (this is {depth} mm)." |
| `furniture.rod_section_short` | warning | §3.10 | sectionId | "This hanging space is less than 900 mm high." |
| `furniture.rod_span_long` | warning | §3.10 | sectionId | "Rod longer than 1200 mm may bend." |
| `furniture.basket_size_mismatch` | warning | §3.11 | sectionId | "The basket doesn't fit this compartment." |
| `furniture.baskets_dont_fit` | warning | §3.11 | sectionId | "Too many baskets for this height." |
| `furniture.loft_no_access` | warning | mounting loft and no Front covers any section | — | "This loft has no doors or flaps." |
| `furniture.back_seam_unsupported` | warning | §3.4.1 | axis, position | "Back panel joint at {position} mm has no support; add a partition or batten." |
| `furniture.plinth_too_shallow` | warning | §3.5 | — | "The plinth is too shallow for returns." |
| `furniture.countertop_overhang_large` | warning | §3.6 | — | "Countertop overhang over 300 mm needs brackets." |
| `furniture.leg_height_mismatch` | warning | §6.6 | code | "Selected legs don't match the height." |
| `furniture.knee_space_narrow` | warning | §3.13 | width | "Knee space is only {width} mm." |
| `furniture.table_span_long` | warning | §3.13 | — | "Long table: consider a trestle or middle legs." |
| `furniture.pedestal_unstable` | warning | §3.13 | — | "Pedestal bases suit tables up to 1200 mm." |
| `furniture.no_default_hardware` | warning | §1.5 | roleKey | "No default {roleKey} in the catalog." |
| `furniture.thin_carcass`, `furniture.back_too_thick_for_groove`, `furniture.drawer_bottom_thick` | warning | §1.4 | — | (self-explanatory texts) |
| `furniture.weight_estimate` | info | always | kg | "Estimated weight: {kg} kg." |
| `furniture.back_split` | info | §3.4.1 | count | "Back panel is made of {count} pieces." |
| `furniture.slide_resized` | info | §3.12 | from, to | "Slides changed from {from} to {to} to fit." |
| `furniture.fixed_sizes_adjusted` | info | §3.7 | sectionId | "The last compartment absorbs the remaining space." |
| `furniture.plinth_ignored` | info | §3.2 | — | "Wall-mounted units have no plinth." |
| `furniture.anti_tip_added` | info | §6.8 | — | "Anti-tip wall fixing added for safety." |
| `furniture.handle_replaced_by_knob` | info | §6.4 | frontId | "Handle too long for this front; a knob is used." |
| `furniture.leg_section_mismatch`, `furniture.table_top_thickness_rounded`, `furniture.drawer_box_thickness` | info | §3.13 / §1.4 | — | (self-explanatory) |
| `furniture.override_orphaned` | info | `03 §3.6` | key | "An adjustment no longer applies and was removed." |

(`furniture.part_exceeds_sheet_back` is reserved for a back that cannot be split because a single strip still exceeds the sheet in both directions: critical warning.)

---

## 8. Furniture builder UX

### 8.1 Create page (`pages/Customer/Furniture/Create.vue`; staff use the same component under `pages/Admin/Furniture/Create.vue` with a customer/project picker)

Props: `project { id, name }`, `templates: TemplateSummary[]` (enabled templates ordered by `furniture_template_settings.sort_order`, then key: `{ key, family, category, nameKey, descriptionKey, thumbnail, defaults (merged) }`), `presets: PresetSummary[]` (`{ id, name, category, templateKey, thumbnailUrl, dims }`, active, `sort_order`), `catalogVersion`.

Layout:

1. Header "New furniture" + project name.
2. Tabs **Ready-made designs** (presets, default tab when ≥ 1 preset exists) | **Start from a template**.
3. Category chips: All, Wardrobes, Kitchen, Storage, Shelving, TV units, Tables, Desks, Other (from `TemplateCategory`, hidden when empty). Search box (matches translated names).
4. Card grid (responsive: 2 columns ≥ 768 px, 3 ≥ 1024, 4 ≥ 1440): thumbnail (4:3), name, description (2 lines), dims for presets (`1800 × 2100 × 600`).
5. Selecting a card opens a side sheet: name input (default `t(nameKey) + ' ' + (count of designs of that template in the project + 1)`, max 120), for templates the `TemplateParamsForm` (§2.2), a live mini 3D preview (`Preview3D` in `compact` mode, generated client-side with the catalog snapshot), and **Create**.
6. Create: client generates the document (`getTemplate(key).generate(params, ctx)` or `reidentify(preset.document)`), runs `validateFurniture`; POST `{ name, templateKey, presetId?, document }` to `customer.projects.furniture.store` (Appendix); server validates via engine CLI and creates the design (`CreateFurnitureDesign`), then redirects to the editor.

The catalog snapshot is loaded with `useCatalogSnapshot()` (`resources/js/composables/useCatalogSnapshot.ts`): fetches `GET /api/catalog/snapshot` with `If-None-Match`, caches in memory and IndexedDB key `fs:catalog:{version}`.

### 8.2 Editor modes

| Mode | Page | Who | Save endpoint | Behaviour |
|---|---|---|---|---|
| `customer` | `Customer/Furniture/Edit` | owner customer | `PUT /api/furniture-designs/{design}/working-copy` | default **simple** UI |
| `staff` | `Admin/Furniture/Edit` | staff with `plans.edit_any` (13) on an unlocked design | same | default **advanced** UI; staff banner "Editing {customer}'s design" |
| `proposal` | `Admin/Orders/ProposalItemEdit` (route `admin.orders.proposals.items.edit`, 09 §4) | staff `orders.propose_changes` (saving the draft requires `orders.edit_designs`, 13) | `PUT /api/change-proposal-items/{item}/draft` (version field `staff_draft_version`) | advanced UI; persistent amber banner "Proposal mode — the customer will review these changes" (`t('builder.proposal_banner')`) with buttons **Preview changes** (opens the diff dialog: `diffFurniture(fromRevision.document, current, catalog)` rendered with `ChangeList` exactly as the customer will see it) and **Back to order** |
| `readonly` | any | design locked (`locked_by_order_id`) for customers, or no `update` permission | none | all commands disabled, panels read-only; banner "This design is part of order {number} and can't be changed." + **Duplicate to edit** (POST duplicate → redirect to the copy's editor) |

The mode is passed as a prop; a `423` autosave response (`03 §5`) switches a running editor to `readonly`.

### 8.3 Layout (`FurnitureBuilder.vue`)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ← Back  [Design name ✎]   Saved ✓   ↶ ↷   Simple|Advanced   ⤓ Export ▾   ⋯   │  toolbar 56 px
├───────────────┬──────────────────────────────────────────────┬───────────────┤
│ Left panel    │  View tabs: 3D | Front | Side | Top  [⧉ split]│ Estimate      │
│ (320 px)      │                                              │ Issues (n)    │
│ accordion:    │            viewport                          │ (300 px)      │
│ Size & build  │                                              │               │
│ Layout        │  overlay toolbar: Doors open/closed,         │               │
│ Fronts        │  Exploded, Dimensions, Fit view              │               │
│ Materials     │                                              │               │
│ Hardware*     │                                              │               │
│ Parts*        │                                              │               │
│ Notes         │                                              │               │
└───────────────┴──────────────────────────────────────────────┴───────────────┘
 * advanced mode only
```

- ≥ 1280 px: three columns as drawn; "split" shows 3D and Front side by side.
- 768–1279 px: left panel becomes a slide-over drawer (toggle button in toolbar), right panel collapses into a bottom sheet with the estimate price always visible (48 px bar).
- < 768 px: `readonly` presentation (3D + estimate + issues) with notice `t('builder.use_larger_screen')`.
- Toolbar menu `⋯`: Create checkpoint (POST revisions, label prompt), Revision history (list + restore, `03 §5`), Duplicate, Save as preset (staff with `presets.manage`), Delete design (customer; not when locked).
- Selection model (store): `selection: { kind: 'section' | 'front' | 'part' | 'hardware' | null; id: string | null }`. Selecting in any view syncs all views and panels; `Esc` clears.

### 8.4 3D preview (`views/Preview3D.vue`)

- `<TresCanvas>` with `shadows`, `toneMapping: ACESFilmic`, clear colour from theme token `--editor-bg`. Camera: perspective 35° FOV; `OrbitControls` (cientos) with damping, target = bbox centre, min distance `0.5 × diag`, max `5 × diag` (metres). Initial view: azimuth 30°, elevation 20°, fit bbox with 15% padding.
- Scene graph built **imperatively** by `three/buildFurnitureObject(model, catalogIndex, options) → THREE.Group` (`markRaw`), rebuilt incrementally: parts are keyed by `PartKey`; a part mesh is replaced only when its box, material or edges changed (shallow compare of a per-part hash).
- Each part = `BoxGeometry` (mm → m) or `ExtrudeGeometry` for extruded outlines; material from `materialCache` (texture from `textureUrl` with `RepeatWrapping`, repeat = part size / 1 m, rotated 90° when grain is `width`; else `colorHex`; fallback `#d6d3d1`); edges as `LineSegments(EdgesGeometry)` at 25% opacity (toggle "Edges" in the view menu).
- **Doors open/closed** toggle animates over 400 ms: hinged leaves rotate about the hinge edge axis (vertical line at the leaf's hinge edge, `z = leaf back face`) by 100°; flaps rotate about the top (up, −95°) or bottom (down, +90°) edge; drawers translate +z by `0.8 × box length`; sliding leaves translate along x by half a leaf width toward the far side. Leaves are grouped by key prefix (`front.{F}.leaf.{k}`, `section.{S}.drawer.{j}`).
- **Exploded** toggle: each part offset by `0.35 × (partCentre − bboxCentre)` (animated 300 ms).
- **Dimensions** toggle: overall width/height/depth as 3D dimension lines with `Html` (cientos) labels in the user's display unit; column widths along the top front edge.
- Hover highlights the section/part under the cursor (raycast via `three-mesh-bvh` on a merged picking mesh); click selects. Selected part: emissive tint `#3b82f6` at 0.25.
- Hanging rods, handles, legs and hinges are rendered from hardware lines using simple primitives (cylinder, rounded box) with neutral metal material; they are not selectable as parts (clicking selects the hardware line).

### 8.5 Front elevation view (`views/ElevationView.vue`, SVG)

- Draws (scale-to-fit, y flipped): carcass outline and panels (filled `--panel-fill`), plinth, countertop, leaf section boxes (transparent, hover fill), dividers, fronts (stroke, 15% fill) with the standard hinge symbol (two dashed lines from the hinge edge corners to the midpoint of the opposite edge), drawer fronts with a short handle mark, sliding leaves with overlap shading, glass hatched.
- **Dimension chains**: overall width above; per-column **net** widths below the top chain; overall height on the left; row heights on the right of each column; values in the user's unit. Fixed sizes are shown bold with a lock icon; flex sizes in regular weight.
- **Inline size editing**: double-click a size label → `UnitInput` in place; Enter commits `setChildSize` with `{ mode: 'fixed', mm }`; Alt+Enter keeps flex and adjusts the weight so that the resolved size matches.
- **Divider drag**: dragging a partition/fixed shelf moves it, resizing the two adjacent children (both become `fixed` if they were fixed; flex children get new weights so the resolved sizes match); 1 mm resolution, 10 mm snap with Shift; live tooltip with both sizes; dispatches `setChildSize` with merge key `drag:{sectionId}` (one undo step per drag).
- **Context menu** on a section: Split into columns… / rows… (count dialog 2–8, equal flex), Set content ▸ (empty, shelves, drawers, hanging rod, baskets), Merge with siblings (on a child → `mergeSections(parent)`), Insert column/row before/after, Remove, Add door here, Remove door.
- **Add front tool** (toolbar of the view or Fronts panel): click sections to toggle them into the selection (Shift extends); the union outline is shown green when it is a valid rectangle not overlapping other fronts, red otherwise; **Create** opens a popover (kind, leaves, hinge side, overlay, glass, handle) → `addFront`.
- Selecting a front shows handles to change hinge side (click the hinge symbol to flip) and leaves (+/−).

### 8.6 Side and top views (`SideView.vue`, `TopView.vue`, SVG, view-only)

- Side: vertical section at the selected column's centre (default: the middle of the carcass): side outline, back position (groove/nail/inset), plinth with setback, countertop overhang, shelves depth with setback, drawer boxes, hanging rod position, door thickness and sliding tracks; dimensions for depth, interior depth, shelf depth, plinth.
- Top: footprint, countertop overhangs, door swing arcs at 90° (dashed) and drawer pull-out extents (dotted) for clearance planning; dimensions for width/depth and the swing radius.

### 8.7 Panels

#### 8.7.1 Size & construction (`DimensionsPanel.vue`)

- Width / Height / Depth `UnitInput`s (hard ranges `03 §2.4`; the template's recommended ranges shown as hints only). For a `round` table top, editing width also sets depth.
- Carcass family: Mounting (floor / wall / loft); Plinth (none / plinth / legs; height; setback; leg item — advanced); Top and Bottom construction (between / over sides — advanced); Back (none / nailed / grooved / inset — advanced); Countertop toggle + front/left/right overhangs; Default handle (picker filtered to `handle`/`knob` + "No handles"), orientation, placement (advanced).
- Table family: Top shape, thickness (`material` or double), corner radius, overhang; Base type, leg source, leg item / section, apron toggle + height + inset, stretcher toggle; Storage: under-top drawers count + side, lower shelf, end cabinet width + content (cabinet_ends only).

#### 8.7.2 Layout tree (`LayoutTreePanel.vue`)

Tree of sections with labels from §3.7 and the resolved net size in brackets (`Column 1 (582 mm)`). Per node: size control — segmented **Fixed / Flex**; fixed → `UnitInput` (mm); flex → weight stepper (0.5–10, step 0.5). Node actions: Split (columns/rows + count), Merge, Insert before/after, Remove. Leaf: content selector with sub-fields — shelves (count 1–20, adjustable, front setback*), drawers (count 1–10, heights equal/custom list, slide item*, "behind door" shown read-only), hanging rod (top clearance*, rod item*), baskets (count, basket item*). (* advanced.)

#### 8.7.3 Fronts (`FrontsPanel.vue`)

List of fronts (mini elevation thumbnail, label "Door over Column 2", kind). Fields: kind; leaves (`auto`/1/2 hinged, `auto`/2–4 sliding); hinge side (single leaf); overlay (full/half/inset); glass; handle (`inherit`/none/pick); hinge item* (`auto`/none/pick); track item* (`auto`/none/pick). Buttons: **Add front** (enters the elevation add-front tool), Remove.

#### 8.7.4 Materials (`MaterialsPanel.vue`)

Simple mode: three rows — **Body** (applies to `carcass`, `shelf`, `plinth`; and `top` when no countertop/table), **Doors & drawer fronts** (`front`), **Top** (only with countertop or table family). Advanced mode: all nine roles, each with material, edge band and finish pickers. A role row shows swatch, decor name, thickness, board type.

`MaterialPicker` (modal): grid of swatches (texture thumb or colour), name, decor, thickness, board type; filters: "Suitable for {role}" (usage contains role, on by default), board type chips, thickness chips, search. Only active materials are offered; an archived current value is shown with a warning badge. Customers never see prices. `EdgeBandPicker` lists bands with thickness × width and colour chip, plus "Role default". `FinishPicker` lists finishes whose `appliesTo` contains the material's board type, plus "None".

Commands: `setMaterial` with `applyToRoles` for the simple-mode grouped rows.

#### 8.7.5 Hardware (`HardwarePanel.vue`, advanced)

Lines from `model.hardware` grouped by category, each: image, name, qty, reason (`t('hardware.reason.' + reasonKey, reasonParams)`), badges *auto*/*changed*/*extra*. Actions on generated lines: **Change item** (`HardwarePicker` filtered to the same category) → `setHardwareOverride { code }`; **−/+** → `qtyDelta`; **Remove** → `removed: true`; **Note**; **Reset** (clears the override). Extra hardware section: **Add item** (picker over all active hardware; quick-add buttons for `lock.default`, `led_strip.default`, `damper` items), qty (1–999), note, remove.

#### 8.7.6 Parts (`PartsPanel.vue`, advanced)

Table, one row per `Part` (not merged): name, material (swatch), T, L, W, grain icon, edges (4 mini toggles), qty, badges *changed*/*extra*/*removed* (removed parts listed greyed at the end with **Restore**). Row actions: material override (MaterialPicker), **edges** (`EdgeDiagramPicker`: a rectangle diagram showing L1/L2/W1/W2 with their physical meaning from `edgeMap`, e.g. "L1 = front edge", and a band picker per edge incl. "None"), length/width delta (`±` UnitInputs), grain (length/width/none), note, remove. Clicking a row selects and highlights the part in all views. **Add extra part** form: name, role, material, length, width, qty (1–99), edges, grain, note, optional placement (min x/y/z + size in mm). Staff see the part key in a tooltip. Sorting by any column; filter by material.

#### 8.7.7 Issues (`IssuesPanel.vue`)

Grouped Errors → Critical warnings → Warnings → Info (info only in advanced). Each row: icon, translated message, entity label. Click → select the first `entityId` (section/front → elevation + 3D highlight and camera framing via `camera-controls.fitToBox` over 300 ms; part key → part). Toolbar badge shows `errors + warnings`.

#### 8.7.8 Estimate (`EstimatePanel.vue`)

Shows: **Estimated price** (`unitPriceMinor`, or tax-inclusive per `pricing.pricesIncludeTax` with label "incl. tax"/"excl. tax", `08 §4.6`), the disclaimer `t(pricing.estimateDisclaimerKey)`, "+ installation if required", part count (Σ qty), sheet count (Σ `sheetsBilled`), edge banding metres (advanced), estimated weight. Staff with permission `quotes.view_costs` (13) additionally see the cost breakdown (material, edge band, hardware, finishing, labour, direct, overhead, margin) and per-material sheets/utilisation. While a recomputation is pending > 300 ms, the values dim and a spinner shows; stale results are discarded (§8.10).

#### 8.7.9 Notes (`NotesPanel.vue`)

Textarea (≤ 2000 chars, counter) → `setNotes` (merge key `notes`, so a typing burst is one undo step).

### 8.8 Simple vs advanced mode

| Element | Simple (customer default) | Advanced (staff default; customers can switch, remembered in `localStorage['fs:builder:mode']`) |
|---|---|---|
| Size & construction | W/H/D, mounting, plinth type/height, countertop toggle, default handle | + construction, back type, plinth setback & legs, handle orientation/placement, all table options |
| Layout | tree with split/merge, sizes, content basics | + shelf setback, slide/rod/basket items |
| Fronts | kind, leaves, hinge side, glass, handle | + overlay, hinge item, track item |
| Materials | 3 grouped rows, material only | 9 roles × material/edge band/finish |
| Hardware panel | hidden | visible |
| Parts panel | hidden | visible (customers: read-only list without override actions; staff: full) |
| Issues | errors + warnings | + info |
| Estimate | price, disclaimer, parts, sheets, weight | + edge banding metres; cost breakdown for `quotes.view_costs` |

### 8.9 Saving

Autosave, conflict handling, offline handling and revisions follow `03 §5` exactly; the furniture request body additionally carries `estimate: { totalMinor, currency, partCount, sheetCount, catalogVersion, engineVersion, computedAt }` from the latest worker result (`totalMinor = unitPriceMinor`). Status indicator states: `Saved` / `Saving…` / `Unsaved changes` / `Offline — changes kept on this device` / `Conflict` / `Read-only`. The client runs `validateFurniture` before each save; save-blocking issues stop autosave and show a toast with the first message (the document stays in `localStorage`).

### 8.10 Live estimate pipeline

- Main thread (synchronous, every document change): `generateFurniture` → views. Budget ≤ 15 ms.
- Worker (`editor/workers/engine.worker.ts`, method `estimateFurniture(doc, catalog)` added to the RPC): `generateFurniture` → `computeBom(model, catalog, bomOptionsFor(doc, true))` → `priceBom(bom, catalog, catalog.pricing, { quantity: 1, includeInstallation: false })` → returns `{ bom, price }`. Debounce 150 ms after the last change; only the latest request is answered (`01 §5.5`). Budget: ≤ 100 ms p95 for a 60-part design (incl. nesting); measured in the Vitest benchmark (§12.7).
- Catalog changes (snapshot version bump detected on next fetch) trigger a recompute.

### 8.11 Keyboard shortcuts

`Ctrl/Cmd+Z` undo, `Ctrl/Cmd+Shift+Z` / `Ctrl+Y` redo, `Esc` clear selection / cancel tool, `Delete` remove selected front/extra part/extra hardware (with confirm for fronts), `1`–`4` switch view (3D/Front/Side/Top), `O` toggle doors open, `E` toggle exploded, `D` toggle dimensions, `F` fit view, `?` shortcut help. Shortcuts are disabled while an input has focus.

### 8.12 Accessibility & i18n

All controls are reachable by keyboard; the layout tree is an ARIA `tree`; SVG sections have `role="button"` + `aria-label` with their label and size; the 3D canvas has an adjacent text summary (dims, materials, fronts). All strings via translation keys (`builder.*`, `templates.*`, `parts.*`, `hardware.*`, `issues.*`, `changes.*`).

---

## 9. Furniture commands (`engine/furniture/commands/`)

Commands are `CommandDef<FurnitureDocument, P, FurnitureCommandContext>` objects of the generic command bus (`04`, "command system"): `type` (below), `labelKey` = `engine.furniture.command.label.{name}` (e.g. `engine.furniture.command.label.set_dims`), `validate(doc, params, ctx)` (cheap pre-check returning an `EngineMessage` or null), `run(draft, params, ctx, out)` (mutates the mutative draft; throws `CommandAbort` to cancel), optional `mergeKey(params)` (merging and sealing exactly as `04` defines: drags and typing bursts collapse into one undo entry), `mergeMode: 'replace'` for all furniture commands, and `touchesGeometry: false` (the plan-specific post-processing does not apply). `FurnitureCommandContext = { catalog: CatalogIndex, newId }`. After `run`, the document is parsed with `FurnitureDocumentSchema`; a failure aborts the command (no state change, toast `builder.command_failed`). The elevation drag seals on pointer-up; text inputs seal on blur.

| Type | Params | Semantics | mergeKey |
|---|---|---|---|
| `furniture.setDims` | `{ width?, height?, depth? }` | clamp to `03 §2.4`; round tables keep `depth = width` | `dims` |
| `furniture.setConstruction` | `{ top?, bottom? }` | | — |
| `furniture.setMounting` | `{ mounting }` | wall/loft → `plinth = { type: 'none', height: 0, setback: 0, legCode: null }` | — |
| `furniture.setPlinth` | `Partial<CarcassSpec['plinth']>` | `type: 'none'` → height 0 | `plinth` |
| `furniture.setBack` | `{ type }` | | — |
| `furniture.setCountertop` | `CarcassSpec['countertop']` | `null` or `{ enabled, overhang* }` | `countertop` |
| `furniture.setHandles` | `Partial<CarcassSpec['handles']>` | | — |
| `furniture.splitSection` | `{ sectionId, direction: 'columns' \| 'rows', count: 2..8 }` | leaf → `split = direction`, `count` new children (`flex` weight 1); the old content moves to child 1, others get `{ type: 'empty' }`. Non-leaf → error (UI only offers it on leaves). Fronts covering the section keep covering it (now a non-leaf). Drawer contents moved under a Front get `behindDoor = true`. | — |
| `furniture.setChildSize` | `{ parentId, index (0-based), size }` | sets one child's size | `size:{parentId}:{index}` or `drag:{parentId}` from the elevation drag |
| `furniture.insertChild` | `{ parentId, index, size? }` | inserts an empty leaf (default `flex 1`) | — |
| `furniture.removeChild` | `{ parentId, index }` | removes child (and its subtree); if one child remains, the parent becomes a leaf with that child's content (when the remaining child is a leaf) or adopts the child's split/children; fronts: ids of deleted sections are removed from `covers`; a front left with empty `covers` is deleted | — |
| `furniture.mergeSections` | `{ sectionId }` | non-leaf → leaf; content = content of the first leaf in pre-order (or empty); every front whose `covers` contains a removed descendant gets those ids replaced by `sectionId` (deduplicated); if two fronts end up covering `sectionId`, the later one is deleted | — |
| `furniture.setContent` | `{ sectionId, content }` | leaf only; drawers: `behindDoor` forced to `true` iff covered by a Front | `content:{sectionId}` |
| `furniture.addFront` | `Omit<Front, 'id'>` | new id `fr_…`; covered drawer contents get `behindDoor = true` | — |
| `furniture.updateFront` | `{ frontId, patch: Partial<Omit<Front,'id'>> }` | re-sync `behindDoor` when `covers` changes | `front:{frontId}` |
| `furniture.removeFront` | `{ frontId }` | re-sync `behindDoor = false` for previously covered drawers | — |
| `furniture.setMaterial` | `{ role, materialCode?, edgeBandCode?: string \| null, finishCode?: string \| null, applyToRoles?: MaterialRole[] }` | sets the given fields on `role` and every role in `applyToRoles` | — |
| `furniture.setTable` | `{ patch: DeepPartial<TableSpec> }` | deep merge; arrays replaced | `table` |
| `furniture.setPartOverride` | `{ partKey, patch: PartOverride \| null }` | `null` deletes the override; empty object deletes too | `part:{partKey}` |
| `furniture.addExtraPart` | `Omit<ExtraPart, 'id'>` | id `p_…` | — |
| `furniture.updateExtraPart` | `{ id, patch }` | | `extra:{id}` |
| `furniture.removeExtraPart` | `{ id }` | also deletes `overrides.parts['extra.' + id]` | — |
| `furniture.setHardwareOverride` | `{ hardwareKey, patch: HardwareOverride \| null }` | as parts | `hw:{hardwareKey}` |
| `furniture.addExtraHardware` | `Omit<ExtraHardware, 'id'>` | id `h_…` | — |
| `furniture.updateExtraHardware` | `{ id, patch }` | | `xhw:{id}` |
| `furniture.removeExtraHardware` | `{ id }` | | — |
| `furniture.resetOverrides` | `{ scope: 'parts' \| 'hardware' \| 'all' }` | clears maps (extras kept) | — |
| `furniture.setNotes` | `{ notes: string \| null }` | trims; empty → null | `notes` |

Every command is unit-tested for apply + undo (§12.5).

---

## 10. Furniture diff (`diff.ts`, `diffHighlight.ts`)

### 10.1 Signature and inputs

```ts
export function diffFurniture(before: unknown, after: unknown, catalog: CatalogSnapshot): ChangeItem[];
```

1. `a = migrateFurniture(before)`, `b = migrateFurniture(after)`.
2. `mA/mB = generateFurniture(…)`, `bomA/bomB = computeBom(m, catalog, bomOptionsFor(doc, true))` (`08 §3`), `pA/pB = priceBom(bom, catalog, catalog.pricing, { quantity: 1, includeInstallation: false })`. Both sides use the **same** catalog, so price differences reflect design changes only.
3. Param conventions: params whose name ends in `Mm` are lengths (UI formats with `formatLength` in the viewer's unit), ending in `Minor` are money (UI formats with the business currency), `Pct` are percentages with one decimal; all other params are plain strings/numbers already in English (v1 ships `en` only).

### 10.2 Rules (in emission order; final ordering in §10.3)

| Kind | Detection | messageKey → English | Params | entityId | before/after | Significance |
|---|---|---|---|---|---|---|
| `price_changed` | `pA.unitPriceMinor ≠ pB.unitPriceMinor` | `changes.price_changed` → "Estimated price {direction, select, up{increased} other{decreased}} by {deltaMinor} ({deltaPct}%)" | `beforeMinor, afterMinor, deltaMinor (abs), deltaPct, direction` | null | numbers | major iff `abs(delta) / max(1, before) > 0.02` |
| `dims_changed` | each of width/height/depth differing | `changes.dims_changed` → "{dimension} changed from {beforeMm} to {afterMm}" | `dimension` (`width`/`height`/`depth`), `beforeMm`, `afterMm` | null | numbers | major |
| `material_changed` | per role (only roles used by at least one part in `mA` or `mB`): `materialCode` | `changes.material_changed` → "{role}: {before} → {after}" | `role` (English role name), `before`, `after` (material names) | role | codes | major for carcass/front/top/shelf/plinth, minor for others |
| `material_changed` | same, `edgeBandCode` | `changes.edge_band_changed` → "{role} edge banding: {before} → {after}" | as above (`'Default'` for null) | role | codes | minor |
| `material_changed` | same, `finishCode` | `changes.finish_changed` → "{role} finish: {before} → {after}" | as above (`'None'` for null) | role | codes | major |
| `construction_changed` | flattened leaf paths of `carcass` except `interior`/`fronts`, or of `table` except `storage.endCabinets.content`; plus `templateKey`/`family` | `changes.construction_changed` → "{field}: {before} → {after}" | `field` (English label from `changes.fields.{path}`), `before`, `after` (stringified, lengths as numbers with `Mm` suffix param variant `beforeMm/afterMm` when the path is a length) | path | values | major for `mounting`, `back.type`, `plinth.type`, `table.base.type`, `table.top.shape`, `templateKey`; else minor |
| `section_changed` | section ids in both trees: `split` or ordered child-id list differs → `what = 'layout'`; else any child `size` differs → `what = 'size'`. Top-most added ids → `'added'`, top-most removed → `'removed'` | `changes.section_{what}` → "{section}: layout changed" / "{section}: sizes changed" / "Added {section}" / "Removed {section}" | `section` (label §3.7 from the side that has it) | section id | section JSON (without children) | minor |
| `content_changed` | leaf in both, `content` differs (deep) | `changes.content_changed` → "{section}: {before} → {after}" | `section`, `before`, `after` (content summaries: "empty", "{n} shelves", "{n} adjustable shelves", "{n} drawers", "hanging rod", "{n} pull-out baskets") | section id | content objects | minor |
| `front_added` / `front_removed` | front id only in `b` / only in `a` | `changes.front_added` → "Added {kind} over {sections}" / `changes.front_removed` → "Removed {kind} over {sections}" | `kind` (English), `sections` (labels joined with ", ") | front id | front JSON | major |
| `front_changed` | front in both, any of `kind, covers (as set), leaves, hingeSide, overlay, glass, handleCode, hingeCode, slidingTrackCode` differs | `changes.front_changed` → "{front}: {fields} changed" | `front` ("Door over Column 2"), `fields` (English field names joined) | front id | front JSON | major iff `kind`, `covers` or `glass` changed |
| `part_added` / `part_removed` / `part_changed` | by `PartKey` over model parts (after overrides); changed = any of `materialCode, thickness, length, width, edges, grain` differs | `changes.part_added` → "Added {name} ({lengthMm} × {widthMm})" / `changes.part_removed` → "Removed {name}" / `changes.part_changed` → "{name}: {fields} changed" | `name` (English part name), sizes, `fields` | part key | `{ length, width, thickness, materialCode, edges, grain }` | minor |
| collapsed parts | if a list (added / removed / changed) has > 10 items, it is replaced by one item | `changes.parts_added_many` / `parts_removed_many` / `parts_changed_many` → "{count} parts added / removed / changed" | `count` | null | null | minor |
| `hardware_added` / `hardware_removed` / `hardware_qty_changed` | by **code** over `bomA.hardware` vs `bomB.hardware` (merged, after overrides) | `changes.hardware_added` → "Added {qty} × {name}" / `changes.hardware_removed` → "Removed {qty} × {name}" / `changes.hardware_qty_changed` → "{name}: {before} → {after}" | `qty`/`before`/`after`, `name` (catalog name) | code | qty numbers | minor |
| `notes_changed` | `notes` differ | `changes.notes_changed` → "Notes updated" | — | null | strings | minor |

Identical documents → `[]`.

### 10.3 Ordering

Sort by: significance (`major` first) → kind rank (`price_changed`, `dims_changed`, `material_changed`, `construction_changed`, `front_added`, `front_removed`, `front_changed`, `section_changed`, `content_changed`, `part_added`, `part_removed`, `part_changed`, `hardware_added`, `hardware_removed`, `hardware_qty_changed`, `notes_changed`) → `entityId` (null first, then string order) → `messageKey`.

### 10.4 3D/2D highlight mapping

```ts
export type Highlight = 'added' | 'removed' | 'changed';
export function highlightMap(beforeModel: FurnitureModel, afterModel: FurnitureModel): Map<PartKey, Highlight>;
```

Computed from the **models** (not from `ChangeItem`s, which may be collapsed): key only in after → `added`; only in before → `removed`; in both and any of `length, width, thickness, materialCode, edges` differs or any component of the geometry box `min`/`size` differs by > 1 mm → `changed`.

Rendering (`three/highlight.ts`, also used by `ElevationView` fills):

| State | 3D (After view) | 3D (Before view) | Elevation |
|---|---|---|---|
| changed | amber `#f59e0b`: material colour multiplied 50% + emissive `#f59e0b` 0.15 | amber | amber fill 35% |
| added | green `#16a34a` same technique | not shown | green fill 35% |
| removed | red ghost: before-model part rendered at its before position, `#dc2626`, opacity 0.35, `depthWrite: false` | red | red dashed outline |
| unchanged | desaturated (grey tint, opacity 0.6) while "Show differences" is on | same | normal |

### 10.5 Change review viewer (`diff/ChangeReviewViewer.vue`)

Used by the customer proposal page (10) and the staff preview (§8.2). Props: `before: FurnitureDocument`, `after: FurnitureDocument`, `changes: ChangeItem[]`, `catalog`. UI: toggle **Before | After**, checkbox **Show differences** (default on), views 3D / Front (tabs), legend (amber changed, green added, red removed), and `ChangeList` (major first; each item clickable → focuses its entity: part key → that part, front/section id → its box). Price impact row uses server prices when the caller passes `serverPrices` (09 §4.6: "calculating…" until both revision BOMs are ready), else the `price_changed` item.

---

## 11. Thumbnails and exports (client side)

### 11.1 Thumbnails (`composables/useThumbnailCapture.ts`)

- Trigger: 60 s after the last successful working-copy save (timer reset by each save); immediately on editor open when the design has no thumbnail; on unmount when a capture is pending (fire-and-forget). Never in `proposal` or `readonly` mode.
- Render: offscreen `THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: false })`, size **800 × 600**, pixel ratio 1, background `#ffffff`, the same lights as the main view, camera FOV 35°, azimuth 30°, elevation 20°, fit to bbox with 10% padding; doors closed, not exploded, no highlight, edges on. `canvas.toBlob('image/png')` → `POST /api/furniture-designs/{design}/thumbnail` (multipart field `file`); renderer disposed afterwards.
- Server (`StoreFurnitureThumbnail` action): policy `update` (staff on locked designs are refused), validates PNG, ≤ 5 MB, exactly 800 × 600, stores in media collection `thumbnail` (single file, replaces; conversion `small` 320w per `02 §10`), returns 204.
- `SaveAsPreset` uploads the current capture with the preset request.

### 11.2 Cut list exports

CSV and PDF formats, routes and generation are specified in `08 §8`. In the builder, the **Export** menu shows "Cut list (CSV)" and "Cut list (PDF)" only to users with permission `furniture.export_cutlist` (Appendix). CSV is produced client-side from the live estimate BOM with `cutListCsv(bom, catalog, doc)` (engine) and downloaded as `cutlist-{slug}-working.csv`. PDF requires a revision: if the working copy differs from `current_revision` (or there is none), the menu first creates a `manual_checkpoint` revision (label prompt), then calls the PDF endpoint and shows a toast "Preparing PDF…" until the file is ready (`08 §8.2`).

### 11.3 GLB export (`export/exportGlb.ts`)

`GLTFExporter` (`three/examples/jsm/exporters/GLTFExporter.js`) with `{ binary: true, onlyVisible: true }` over a fresh `buildFurnitureObject(model)` (doors closed, metres, y up). Node names = part keys; material names = material codes. File `{slug(design name)}.glb`. Available to every user who can view the design (customer and staff).

---

## 12. Required tests (Vitest, `resources/js/engine/furniture/__tests__/`)

### 12.1 Deterministic ids

`testIds()` returns a `newId` that yields `{prefix}_{counter padded to 10 digits}` per prefix: `s_0000000001`, `s_0000000002`, …, `fr_0000000001`, …. All fixture documents use such ids.

### 12.2 Wardrobe fixture (`database/fixtures/furniture/wardrobe-3door.json`)

Must equal `TEMPLATES.wardrobe_hinged.generate(defaults, { catalog: seedCatalog, newId: testIds() })` (snapshot test) and be exactly:

```json
{
  "schemaVersion": 1, "templateKey": "wardrobe_hinged", "family": "carcass",
  "dims": { "width": 1800, "height": 2100, "depth": 600 },
  "materials": {
    "carcass": { "materialCode": "PB18-WHITE", "edgeBandCode": null, "finishCode": null },
    "back": { "materialCode": "HDF3-WHITE", "edgeBandCode": null, "finishCode": null },
    "shelf": { "materialCode": "PB18-WHITE", "edgeBandCode": null, "finishCode": null },
    "front": { "materialCode": "PB18-WHITE", "edgeBandCode": null, "finishCode": null },
    "top": { "materialCode": "PB18-WHITE", "edgeBandCode": null, "finishCode": null },
    "drawer_box": { "materialCode": "PLY12-BWR", "edgeBandCode": null, "finishCode": null },
    "drawer_bottom": { "materialCode": "HDF3-WHITE", "edgeBandCode": null, "finishCode": null },
    "plinth": { "materialCode": "PB18-WHITE", "edgeBandCode": null, "finishCode": null },
    "leg": { "materialCode": "SW50-RUBBER", "edgeBandCode": null, "finishCode": null }
  },
  "carcass": {
    "construction": { "top": "between_sides", "bottom": "between_sides" },
    "mounting": "floor",
    "plinth": { "type": "plinth", "height": 100, "setback": 20, "legCode": null },
    "back": { "type": "grooved" },
    "countertop": null,
    "interior": { "id": "s_0000000001", "split": "columns", "content": null, "children": [
      { "size": { "mode": "flex", "weight": 1 }, "section": { "id": "s_0000000002", "split": "none", "children": [],
        "content": { "type": "shelves", "count": 4, "adjustable": true, "frontSetback": 20 } } },
      { "size": { "mode": "flex", "weight": 2 }, "section": { "id": "s_0000000003", "split": "rows", "content": null, "children": [
        { "size": { "mode": "fixed", "mm": 350 }, "section": { "id": "s_0000000004", "split": "none", "children": [], "content": { "type": "empty" } } },
        { "size": { "mode": "flex", "weight": 1 }, "section": { "id": "s_0000000005", "split": "none", "children": [],
          "content": { "type": "hanging_rod", "topClearance": 60, "rodCode": null } } } ] } } ] },
    "fronts": [
      { "id": "fr_0000000001", "kind": "hinged", "covers": ["s_0000000002"], "leaves": 1, "hingeSide": "left", "overlay": "full",
        "glass": false, "handleCode": "inherit", "hingeCode": "auto", "slidingTrackCode": null },
      { "id": "fr_0000000002", "kind": "hinged", "covers": ["s_0000000003"], "leaves": 2, "hingeSide": "auto", "overlay": "full",
        "glass": false, "handleCode": "inherit", "hingeCode": "auto", "slidingTrackCode": null } ],
    "handles": { "code": "HDL-BAR-160", "orientation": "auto", "placement": "auto" }
  },
  "table": null,
  "overrides": { "parts": {}, "extraParts": [], "hardware": {}, "extraHardware": [] },
  "notes": null
}
```

(shelf count: `shelfCount(2100 − 100 − 36, 400) = clamp(round(1964/400) − 1, 1, 20) = 5 − 1 = 4`.)

Derived values (seed catalog, `t_c = t_s = t_f = t_p = 18`, `t_b = 3`): `fz = 18`, `Wc = 1800`, `Hc = 2000`, `Dc = 582`, interior `x [18, 1782]`, `y [118, 2082]`, `z [13, 582]`; columns 582 / 1164 (partition `x [600, 618]`); rows of `s_0000000003`: 350 / 1596 (fixed shelf `y [1714, 1732]`).

**Expected parts** (`generateFurniture`; finished sizes; `B` = `EB08-WHITE`, `—` = null; all grains `none` because neither material has grain):

| Key | Material | T | Length | Width | L1 | L2 | W1 | W2 |
|---|---|---|---|---|---|---|---|---|
| `carcass.back.1` | HDF3-WHITE | 3 | 1978 | 598 | — | — | — | — |
| `carcass.back.2` | HDF3-WHITE | 3 | 1978 | 1180 | — | — | — | — |
| `carcass.bottom` | PB18-WHITE | 18 | 1764 | 582 | B | — | — | — |
| `carcass.side.left` | PB18-WHITE | 18 | 2000 | 582 | B | — | B | — |
| `carcass.side.right` | PB18-WHITE | 18 | 2000 | 582 | B | — | B | — |
| `carcass.top` | PB18-WHITE | 18 | 1764 | 582 | B | — | — | — |
| `front.fr_0000000001.leaf.1` | PB18-WHITE | 18 | 1997 | 606 | B | B | B | B |
| `front.fr_0000000002.leaf.1` | PB18-WHITE | 18 | 1997 | 593 | B | B | B | B |
| `front.fr_0000000002.leaf.2` | PB18-WHITE | 18 | 1997 | 593 | B | B | B | B |
| `plinth.back` | PB18-WHITE | 18 | 1800 | 100 | — | — | — | — |
| `plinth.front` | PB18-WHITE | 18 | 1800 | 100 | — | — | B | B |
| `plinth.return.1` / `.2` / `.3` | PB18-WHITE | 18 | 526 | 100 | — | — | — | — |
| `section.s_0000000001.partition.1` | PB18-WHITE | 18 | 1964 | 569 | B | — | — | — |
| `section.s_0000000002.shelf.1` … `.4` | PB18-WHITE | 18 | 580 | 549 | B | — | — | — |
| `section.s_0000000003.fixed_shelf.1` | PB18-WHITE | 18 | 1164 | 569 | B | — | — | — |

20 parts in total (each `qty 1`). Back seam at `x = 609` (partition centre, supported). Plinth returns at `x = 0, 891, 1782`.

**Expected fronts** (`model.fronts`): leaf `fr_…1.leaf.1` rect `{ x: 1, y: 101, w: 606, h: 1997 }` hinge `left`; `fr_…2.leaf.1` `{ x: 610, y: 101, w: 593, h: 1997 }` hinge `left`; `fr_…2.leaf.2` `{ x: 1205, y: 101, w: 593, h: 1997 }` hinge `right`.

**Expected hardware lines**:

| Key | Code | Qty |
|---|---|---|
| `carcass.anti_tip` | BRK-ANTITIP | 1 |
| `carcass.connectors.cam` | CON-CAM-15 | 16 |
| `carcass.connectors.dowel` | CON-DOWEL-8 | 16 |
| `carcass.screws` | SCR-PACK | 1 |
| `front.fr_0000000001.handles` | HDL-BAR-160 | 1 |
| `front.fr_0000000001.hinge_plates` | HNG-PLATE-0 | 4 |
| `front.fr_0000000001.hinges` | HNG-FO-SC | 4 |
| `front.fr_0000000002.handles` | HDL-BAR-160 | 2 |
| `front.fr_0000000002.hinge_plates` | HNG-PLATE-0 | 8 |
| `front.fr_0000000002.hinges` | HNG-FO-SC | 4 |
| `front.fr_0000000002.hinges.shared` | HNG-HO-SC | 4 |
| `section.s_0000000002.shelf_supports` | SHF-PIN-5 | 16 |
| `section.s_0000000005.rod` | ROD-OVAL-1200 | 1 |
| `section.s_0000000005.rod_supports` | ROD-SUP | 2 |

(8 joints × 2 cams; hinge count `hingeCount(1997, 14.16 kg) = 4`; door weights 14.16 kg and 13.86 kg.)

**Expected operations**: `hingeCups` 4 on each leaf (12 total); `shelfPinHoles` 116 on `carcass.side.left` and 116 on `section.s_0000000001.partition.1` (`pr = fl((1964 − 128) / 32) + 1 = 58`); `handleHoles` 2 per leaf (6); `camLocks` 16, `dowels` 16, `slideScrewSets` 0.

**Expected issues** (exactly): info `furniture.back_split` `{ count: 2 }`, info `furniture.anti_tip_added`, info `furniture.weight_estimate` `{ kg: 144.4 }` (PB 207 562 176 mm³ × 650 + HDF 10 550 652 mm³ × 900). No warnings, no errors.

### 12.3 Drawer construction test (inline document)

`custom_box` 600 × 720 × 560, materials as §12.2, construction between/between, back `grooved`, plinth none, root leaf `drawers { count: 3, frontHeights: 'equal', slideCode: null, behindDoor: false }`, no fronts.

Expected: `fz = 18`, `Dc = 542`, interior `x [18, 582]`, `y [18, 702]`, depth `529`; `maxLen = 519` → slide `SLD-BB-500` (side-mount family `bb45`), no depth warning (19 mm unused); `Wb = fl(564 − 25.4) = 538`, `Win = 514`, `Lb = 500`. Drawer fronts (full overlay, outer on all sides): block `x [1.5, 598.5]`, `y [1.5, 718.5]`, `hf = (717 − 4)/3 = 237.67` → fronts `597 × 237`, rects y = 480, 241, 1. Slots 221.17 / 237.67 / 221.17 → box heights **180 / 190 / 180**. Drawer 1 parts: sides `500 × 180` (PLY12-BWR), back `514 × 167` (`180 − 10 − 3`), bottom `524 × 500` (HDF3-WHITE), front `597 × 237`. Hardware: `section.s_0000000001.drawer.{1,2,3}.slides` = SLD-BB-500 × 1 each; `.handle` HDL-BAR-160 × 1 each; cams 8, dowels 8 (4 joints, length 542); no anti-tip.

Undermount variant (`slideCode: 'SLD-UM-500'`): kept (500 ≤ 519); `Win = 564 − 42 = 522`, `Wb = 546`, `Lb = 490`, bottom `532 × 490`, back `522 × 164` (drawer 1, `180 − 13 − 3`).

### 12.4 Other construction tests (expected values)

- Inset: `custom_box` 600 wide, single inset door over root → opening 564 wide → leaf `560 × (oh − 4)`; `fz = 0`; shelves in the leaf lose 18 mm depth.
- Half overlay: `custom_box` 1200 × 720 × 560, two equal columns (573 each), one single-leaf half-overlay door per column → leaf 1 `X ∈ [10, 599]` (width 589), leaf 2 `X ∈ [601, 1190]` (589); both use `HNG-HO-SC`.
- Hinge counts: `hingeCount(900, 5) = 2`, `(901, 5) = 3`, `(1600, 11) = 3`, `(1997, 14.16) = 4`, `(2100, 10) = 5`, `(800, 13) = 4`, `(500, 25) = 5` (+ `door_heavy` when used in a model).
- Slide selection: `maxLen 519` → 500; explicit `SLD-BB-350` with `maxLen 519` → kept + warning `drawer_depth_unused { unused: 169 }`; `maxLen 240` → error `drawer_no_slide`; explicit `SLD-UM-500` with `maxLen 480` → `SLD-UM-450` + info `slide_resized`.
- Back split without partitions: `custom_box` 2400 × 2000 × 600 (plinth none, nailed HDF3 back) → back 2400 × 2000 → 2 pieces 1200 × 2000, warning `back_seam_unsupported { axis: 'x', position: 1200 }`.
- Sag (PB18): adjustable span 801 → `shelf_sag`; 1001 → `shelf_sag_critical`; fixed 1164 → none; fixed 1201 → `shelf_sag`; MDF18 adjustable 900 → `shelf_sag`; PLY18 adjustable 1100 → `shelf_sag` only.
- Plinth returns: `Wc = 1000` → 2 returns, `1001` → 3, `2001` → 4.
- Cabinet legs: `Wc = 600` → 4 legs; `900` → 6; `1800` → 8.
- Sliding wardrobe defaults (2400 × 2100 × 650, plinth 100): `leaves = 3`, `Wo = 2364`, `lw = (2364 + 60)/3 = 808`, `lh = 1964 − 40 = 1924`; interior content depth `650 − 13 − 60 = 577`; track `ceil(2364/3000) = 1` set, rollers 3.

### 12.5 Templates and commands

- Property test (seeded `mulberry32(42)`, 50 parameter sets per template within the declared ranges, plus the defaults): document validates with **no error issues** against the seed catalog; ≤ 400 parts; every part `length ≥ width > 0`; every rendered part box lies inside the bbox (±1 mm).
- Each command: apply → expected document; undo → original (deep equal); merge keys collapse consecutive commands.
- `mergeSections`/`removeChild` front rewiring cases (§9).

### 12.6 Diff tests

- Identical documents → `[]`.
- Wardrobe fixture vs width 2100: first item `price_changed` (major), then `dims_changed { dimension: 'width', beforeMm: 1800, afterMm: 2100 }` (major); part changes collapsed into `parts_changed_many`; no `front_*` items.
- Wardrobe fixture vs `fr_0000000002.overlay = 'half'`: `front_changed { fields: 'overlay' }` (minor); `hardware_qty_changed` HNG-FO-SC 8 → 4 and HNG-HO-SC 4 → 8; part changes for the two leaves.
- Extra hardware `LCK-CAM-20 × 1` added → `hardware_added { qty: 1 }`.
- `highlightMap`: width change marks `carcass.top` as `changed`, a removed extra part as `removed`.

### 12.7 Performance (Vitest bench, CI thresholds)

- `generateFurniture` on a 3600-wide 6-door wardrobe (≈ 60 parts): median ≤ 15 ms.
- `estimateFurniture` (generate + BOM with nesting + price) on the same: p95 ≤ 100 ms in Node (CI threshold 60 ms median to leave headroom for browsers).

---

## Appendix: Proposed additions to other documents

1. **03 §2.4 / §5 (clarification)** — `validate-furniture` `valid` is computed from `SAVE_BLOCKING_CODES` (= the §2.4 codes) only; other `error` issues (07 §7.3) do not block autosave but block order submission (T2) and proposal sending (T6).
2. **09 T6 (precondition)** — add: "every item's `staff_draft_document` validates with no `error` issues (engine CLI)".
3. **03 §3.6 key table (additions; existing patterns unchanged)**:
   - Parts: `front.{F}.leaf.{i}.stile.left|stile.right|rail.top|rail.bottom|glass`; `section.{S}.drawer.{j}.front` is the inner front (role `drawer_box`) for drawers behind doors; `table.top.layer.{m}`; `table.stretcher.left|right|center|back`; `table.end.left|right`; `table.shelf`; `table.trestle.{left|right}.upright|foot|cleat`; `table.pedestal.side.{1..4}`, `table.pedestal.base`, `table.pedestal.top`; `table.cabinet.side.left|side.right|bottom|back|door`; `table.cabinet.shelf.{i}`; `table.cabinet.drawer.{j}.front|side.left|side.right|back|bottom`; `table.drawer.{j}.front|runner.left|runner.right|side.left|side.right|back|bottom`.
   - Hardware: `front.{F}.hinges.shared`, `front.{F}.hinge_plates`, `front.{F}.track`, `front.{F}.rollers`, `front.{F}.gas_struts`, `front.{F}.stays`, `section.{S}.rod_supports`, `section.{S}.baskets`, `carcass.connectors.cam`, `carcass.connectors.dowel` (replacing the single `carcass.connectors` example), `carcass.screws`, `carcass.wall_brackets`, `carcass.anti_tip`, `table.connectors.cam|dowel|corner`, `table.screws`, `table.drawer.{j}.slides|handle`, `table.cabinet.drawer.{j}.slides|handle`, `table.cabinet.door.hinges|hinge_plates|handle`, `table.cabinet.shelf_supports`.
4. **02 §6.1 `materials.usage` (note)** — allowed tokens = `MaterialRole` values plus `glass` (UI filter only; glass panels use the first active material with `board_type = 'glass'`).
5. **02 §6.3 `hardware_items.is_default_for`** — exhaustive role keys are listed in 07 §6.11; the Upsert action enforces one item per key.
6. **13 permissions (new)** — `furniture.export_cutlist` (cut list CSV/PDF exports; default roles owner, admin, estimator, production). (Cost visibility in the builder reuses the existing `quotes.view_costs`; staff editing of unlocked designs reuses `plans.edit_any`; Save as preset reuses `presets.manage`.)
7. **14 routes (new, names)** — `customer.projects.furniture.create` (GET `/projects/{project}/furniture/create`, page `Customer/Furniture/Create`), `customer.projects.furniture.store` (POST `/projects/{project}/furniture`, body `{ name, templateKey, presetId?, document }`), `customer.furniture.edit` (GET `/furniture/{design}/edit`), `admin.furniture.create` / `admin.furniture.store` / `admin.furniture.edit` (same under `/admin`), `api.furniture-designs.duplicate` (POST `/api/furniture-designs/{design}/duplicate` → `{ id, editUrl }`), `api.furniture-designs.thumbnail.store` (POST `/api/furniture-designs/{design}/thumbnail`, multipart `file`, 204).
8. **01 §5.5 worker RPC (addition)** — method `estimateFurniture(doc, catalog) → { bom, price }` (07 §8.10).
