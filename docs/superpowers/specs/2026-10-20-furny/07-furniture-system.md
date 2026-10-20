# 07 — Furniture System (templates, construction, hardware, builder)

Read the master document, `01`, `02`, `03` and `09` first. Those documents are binding; this file never overrides them. Where this file needs something that is not in `02`/`03` (a column, a setting, a key pattern, a route, a permission), it is listed in **Appendix A** at the end and must be merged into the owning document during review.

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
| `MAX_DOOR_WIDTH` | `600` | `leaves: 'auto'` → `min(2, ceil(rectW / 600))`; above → warning `furniture.door_wide` |
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
  defaultHardware(roleKey: HardwareRoleKey): CatalogHardware | undefined; // first ACTIVE item (sortOrder asc, code asc) whose isDefaultFor contains roleKey
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
3. `generate()` must return a document that passes `validateFurniture` with **no error issues** for every combination of parameter values inside the declared ranges at catalog = seed catalog (`08 §7`). A property test enforces this (§12.4).
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
- `interiorHeight(params)` used by generators for count heuristics = `H − plinthHeight − 2·18` (assumes 18 mm; heuristics only).
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
2. Single-door column (1 door): `content = shelves(count = shelfCount(interiorHeight, 350), adjustable: true, frontSetback: 20)`. If `internalDrawers > 0` **and** this is the first single column (or, when none exists, the first column): the column becomes `rows[ flex 1: shelves(count = shelfCount(interiorHeight − 18 − internalDrawers·180, 350)) / fixed internalDrawers·180: drawers(count = internalDrawers, frontHeights: 'equal', slideCode: null, behindDoor: true) ]`.
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

Generation: root = `columns` with `leaves` equal flex children (weight 1). Contents alternate starting with shelves: odd columns `shelves(shelfCount(ih, 350), adjustable)`, even columns `rows[ fixed 350: empty / flex 1: hanging_rod(60) ]`. One front `{ kind: 'sliding', covers: [root.id], leaves, hingeSide: 'auto', overlay: 'full', glass: false, handleCode: 'inherit', hingeCode: null, slidingTrackCode: 'auto' }`. Plinth `{ type: 'plinth', height: plinthHeight, setback: 0 }` (setback 0: the bottom track sits on the carcass bottom). `handles.code = defaultHardware('handle.flush')?.code ?? defaultHardware('handle.default')?.code ?? null`.

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

Generation: `top = { shape, thickness: 'material', cornerRadius: shape === 'rounded_rectangle' ? 100 : 0, overhang: 50 }`, `base = { type: base, legSource, legCode: null, legSection: 60, apron: { enabled: base === 'four_legs', height: 90, inset: 15 }, stretcher: false }`, storage all empty/false/null. `round` forces `depth = width` (the field is hidden and set). `preferredMaterials.top = ['PB25-WHITE']`, `preferredMaterials.leg = ['SW50-RUBBER']`. Fixture `dining-table-6seat.json` = defaults.

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
| depth | length | 250–450, 10 | 350 |
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
