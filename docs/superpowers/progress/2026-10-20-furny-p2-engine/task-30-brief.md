### Task 30: Furniture schema, migrate, constants, model types, makePart, part names

**Files:**
- Create: `resources/js/engine/furniture/schema.ts`, `migrate.ts`, `constants.ts`, `types.ts`, `context.ts`, `parts.ts`, `partNames.ts`
- Test: `resources/js/engine/furniture/__tests__/schema.test.ts`, `parts.test.ts`, `partNames.test.ts`

**Spec refs:** `03 §2`, `03 §3.1`, `03 §4`, `07 §1.1–§1.3`, `07 §1.6`, `07 §5.1`

**Interfaces:**
- Consumes: Tasks 8 (`Issue`, `EngineInputError`), 29.
- Produces: zod schemas + types `FurnitureDocument, MaterialRole (MATERIAL_ROLES), MaterialAssignments, CarcassSpec, Section, SectionChild, Content, Front, TableSpec, Overrides, PartOverride, ExtraPart, HardwareOverride, ExtraHardware, EdgeId`, `TemplateKey` + `TEMPLATE_KEYS` (19); `FURNITURE_SCHEMA_VERSION = 1`, `FURNITURE_MIGRATIONS`, `migrateFurniture(doc: unknown): FurnitureDocument`; every constant of 07 §1.3 by name; `fl(v)`; `types.ts`: `Box3, Part, HardwareLine, ModelFront, FurnitureModel, Axis, PhysEdge, PanelSpec, Joint { member: PartKey; other: PartKey; length: number }, GenContext`; `context.ts`: `createGenContext(doc, catalog): GenContext` with helpers `ctx.mat(role)` (effective material; unknown code → `defaultMaterialFor(role)`), `ctx.t(role)` (`Math.round(thicknessMm)`), `ctx.roleBand(role)`, `ctx.issue(code, severity, params?, entityIds?)`, `ctx.addHardware(line)`; `parts.ts`: `makePart(spec: PanelSpec, ctx): Part`, `mapEdges`, `mapGrain`; `partNames.ts`: `PART_NAMES_EN`, `partNameEn(nameKey, nameParams): string`.

- [ ] **Step 1: Write the failing tests** — schema accepts the 07 §12.2 wardrobe JSON (inline in the test) and rejects `content.count: 0` for shelves, `leaves: 'many'`, `EdgeId 'L3'`; `migrateFurniture` no-op for v1 and throws `EngineInputError('unsupported_schema_version')` for v2. `makePart` examples of 07 §1.2: side panel (thin x, box size [18, 2000, 582]) → `length 2000, width 582`, `L1 = front, L2 = back, W1 = top, W2 = bottom` recorded in `ctx.edgeMap`; top panel 1764 × 582 (thin y) → `L1 front, W1 left`; door leaf (thin z, 606.5 × 1997) → `length 1997, width 606` (`fl`), `L1 left, W1 top`; square panel uses `grainAxis` as length axis; banded `['front']` on the side → `edges { L1: 'EB08-WHITE', L2: null, W1: null, W2: null }` (role band = material default band); `spec.bandCode: null` gives no band; grain `'none'` for `PB18-WHITE` (no grain), `'length'` for `PB18-OAK` with grainAxis = length axis, `'width'` when grainAxis = width axis; `thickness 18`, `qty 1`, `source 'generated'`, zero operations; `fl(1.9999999) === 2`, `fl(605.9999995) === 606`. `partNameEn('parts.back', { n: 2 }) === 'Back panel 2'`, `('parts.back', {}) === 'Back panel'`, `('parts.shelf', { n: 3 }) === 'Shelf 3'`, `('parts.door', { leaf: 1 }) === 'Door 1'`, `('parts.extra', { name: 'Filler' }) === 'Filler'`; `PART_NAMES_EN` has one entry per nameKey of 07 §1.6.
- [ ] **Step 2: Run it, expect FAIL** — `yarn vitest run resources/js/engine/furniture`
- [ ] **Step 3: Implement** — schemas per 03 §2 (ranges belong to `validateFurniture`, schema only enforces types/enums/ints and the count ranges written in the 03 comments); `makePart` rules 1–8 of 07 §1.2.
- [ ] **Step 4: Run tests, expect PASS** — same command.
- [ ] **Step 5: Quality gates** — `yarn eslint resources/js/engine && yarn prettier --check resources/js/engine && yarn vue-tsc --noEmit`
- [ ] **Step 6: Commit** — `git add resources/js/engine/furniture resources/js/engine/index.ts` → `feat(engine): add furniture document schema, constants and part builder`

