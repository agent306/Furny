# 05 — Plan Editor (2D / 3D)

Read the master document, `01-architecture.md`, `02-data-model.md`, `03-design-documents.md` and `04-geometry-engine.md` first. This file is **normative** for everything under `resources/js/editor/plan/`, the plan-editor parts of `resources/js/editor/shared/`, the two Inertia editor pages, and the content of the fixture library (§9, referenced by `03` §1 `Fixture.libraryKey`).

The editor is a Vue layer **on top of** the engine. It never computes geometry itself: every geometric fact (outlines, rooms, snapping, hit-testing, footprints, conflicts, symbols) comes from `@/engine` (`04`), and every document change goes through the engine command bus (`04` §6). If you need a geometric function that `04` does not provide, add it to the engine (with tests), not to the editor.

Conventions used below:
- "px" = CSS pixels; "mm" = plan millimetres.
- "Desktop" = viewport width ≥ 1024 px; "tablet" = 768–1023 px; "phone" = < 768 px (master §4.1: full editing ≥ 768 px).
- Translation keys live in `resources/lang/en/plan_editor.php` (namespace `plan_editor.`); engine keys in `resources/lang/en/engine.php` (namespace `engine.`, owned by `04`; 15 §15.2). No literal user-visible strings in templates.
- `t(key, params)` is the i18n function from `15`.

---

## 0. Scope

In scope: plan editing in 2D (SVG) and 3D (TresJS + imperative three.js), tools, panels, autosave/revisions UI, exports, read-only/phone viewer, fixture library, accessibility, performance.

Out of scope here: blueprint upload/recognition review UX (`06` — the review screen reuses this editor in "review mode", see §15.4), the furniture builder (`07`), BOM/pricing (`08`).

---

## 1. Files, pages, props, loading

### 1.1 File map

```
resources/js/editor/plan/
├─ index.ts                       Public exports: PlanEditor, usePlanEditorStore, Loupe, types (PlanEditorProps, PlanTool, PlanEditorExtensions)
├─ PlanEditor.vue                 Root component (decides EditorShell vs PhoneViewer, owns store lifetime)
├─ EditorShell.vue                Desktop/tablet layout (§2)
├─ PhoneViewer.vue                Phone view-only layout (§2.3)
├─ store/
│  ├─ usePlanEditorStore.ts       Pinia setup store factory (§3)
│  ├─ selection.ts                Selection helpers (§3.2)
│  ├─ viewSettings.ts             View settings + per-device persistence (§3.8)
│  └─ clipboard.ts                Copy/paste fragment helpers (§7.14)
├─ layout/
│  ├─ TopBarItems.vue (renders into #topbar-* regions)  Toolbar.vue  PropertiesPanel.vue  StatusBar.vue  LeftFlyout.vue
│  ├─ ViewOptionsMenu.vue  ChecksPopover.vue  ReadOnlyBanner.vue
├─ view2d/
│  ├─ PlanCanvas2D.vue            <svg> root, pointer + wheel handling, layers
│  ├─ DrawGroupView.vue           Renders one engine DrawGroup to SVG elements
│  ├─ layers/ BackgroundLayer.vue GridLayer.vue ContentLayer.vue SelectionLayer.vue
│  │          HandlesLayer.vue SnapLayer.vue ToolPreviewLayer.vue ClearanceLayer.vue
│  ├─ viewport2d.ts               Pan/zoom math (§4.2)
│  ├─ styles.ts                   PLAN_STYLES: widths/dashes/fonts + colour token per StyleKey; builds SVG export styles from EXPORT_PALETTE (§4.3)
│  ├─ plan-theme.css              StyleKey classes mapping to the 15 §3 editor tokens (var(--wall) …); no colour literals
│  ├─ handles.ts                  Handle definitions per selection (§4.10)
│  ├─ InlineLengthEditor.vue      Inline dimension editing (§4.8)
│  ├─ Loupe.vue                   Touch magnifier (§7.13)
│  └─ culling.ts                  Viewport culling for large plans (§4.1)
├─ view3d/
│  ├─ PlanScene3D.vue             Lazy chunk entry: <TresCanvas> + SceneRoot
│  ├─ SceneRoot.vue               Accesses Tres context, owns SceneManager
│  ├─ SceneManager.ts             Imperative scene graph (markRaw), build/update/dispose (§5)
│  ├─ builders/ walls.ts floors.ts openings.ts furniture.ts fixtures.ts blobShadows.ts selectionOutline.ts
│  ├─ materials.ts                Shared material registry (§5.7)
│  ├─ cameras.ts                  Orbit/top/walk camera management (camera-controls) (§5.8)
│  ├─ walkControls.ts             PointerLock + touch joystick + collision (§5.8.3)
│  ├─ cutaway.ts                  Wall display modes (§5.9)
│  ├─ picking.ts                  three-mesh-bvh raycasting (§5.10)
│  ├─ gizmos.ts                   TransformControls wrapper (§5.11)
│  └─ dispose.ts                  disposeObject3D helper (§16.2)
├─ tools/
│  ├─ types.ts                    PlanTool interface, ToolId, ToolPointerEvent (§7.1)
│  ├─ SelectTool.ts WallTool.ts RoomTool.ts OpeningTool.ts FurnitureTool.ts FixtureTool.ts
│  ├─ DimensionTool.ts TextTool.ts MeasureTool.ts PanTool.ts BackgroundTool.ts
│  └─ DrawInput.vue               Floating length/direction input while drawing (§7.3)
├─ panels/
│  ├─ props/ RoomProps.vue WallProps.vue OpeningProps.vue PlacementProps.vue FixtureProps.vue
│  │         DimensionProps.vue LabelProps.vue NodeProps.vue MultiProps.vue PlanProps.vue BackgroundProps.vue
│  ├─ DesignPickerPanel.vue  FixtureLibraryPanel.vue  RevisionsPanel.vue  PlanOutlinePanel.vue
│  ├─ RevisionCompareDialog.vue  ConflictDialog.vue  RestoreDraftDialog.vue  ExportDialog.vue
│  ├─ CalibrateDialog.vue  CheckpointPopover.vue  HelpOverlay.vue  OnboardingTour.vue  ContextMenu.vue
├─ inputs/  LengthInput.vue AngleInput.vue ColorSwatchInput.vue  (units-aware inputs, §8.1)
├─ input/   pointer.ts gestures.ts shortcuts.ts (§12)
├─ export/  exportPng.ts exportSvg.ts exportPdf.ts exportDxf.ts exportGlb.ts thumbnail.ts fileName.ts (§14)
└─ __tests__/ …                   (§18)
resources/js/editor/shared/
├─ useDocumentAutosave.ts         03 §5 client protocol (shared with furniture builder)
├─ useCommandBus.ts               binds an engine bus to Vue reactivity (shallowRef + revision map)
└─ useEngineWorker.ts             01 §5.5
```

Host pages (customer plan page of `10` §8.2, admin plan page of `11` §6.4, import review page of `06` §11.1) are owned by those files; they use `EditorLayout` (`15` §7.3) and mount `<PlanEditor>` with `PlanEditorProps` (§1.3).

### 1.2 Host pages and query parameters

The Inertia host pages, their routes, `<Head>`, `title`/`backHref`, floor switcher, page-owned overflow items and page-owned banners belong to `10` §8.2 (customer) and `11` §6.4 (admin); the import review host belongs to `06` §11.1. Each host mounts `<PlanEditor v-bind="editorProps" />` (from `@/editor/plan`) and maps its own props into `PlanEditorProps` (§1.3). This file does not define host routes.

Query parameters honoured by the editor (the host passes them in `initial`): `place` (via `placeDesignId`: start the Furniture tool in `placing` for that design, §10.1; after placing or cancelling the editor removes `place` from the URL with `history.replaceState`), `mode=2d|3d` (overrides `view.lastMode`), `tool=<ToolId>` (activate a tool after load; `06` uses `tool=wall&panel=background` after a trace import), `panel=background|designs|fixtures|revisions|outline` (open that flyout), `select=<entityId>` (select and zoom to an entity).

### 1.3 Component props — `PlanEditorProps`

```ts
interface PlanEditorProps {
  context: 'customer' | 'admin';
  mode: 'plan' | 'import-review';           // 'import-review' = 06 §11 (see §15.4)
  storeKey: string;                         // plan id, or 'import:{importId}' (06)
  planId: string | null;                    // null in import-review mode
  project: { id: string; name: string; status: 'active' | 'archived' };
  plan: { id: string; name: string; levelIndex: number; thumbnailUrl: string | null } | null;
  levels: Array<{ id: string; levelIndex: number }>;   // all floors of the project (project-cover rule, §11.6)
  workingDocument: unknown;                 // migrated client-side with migratePlan() before use
  workingVersion: number;
  designs: EditorDesign[];
  placeDesignId: string | null;
  backgroundUrl: string | null;             // signed URL of doc.background.mediaUuid
  refreshBackgroundUrl: () => Promise<string | null>;  // host: partial reload of its background URL prop (10 §8.2)
  defaults: { wallHeightMm: number; exteriorWallThicknessMm: number; interiorWallThicknessMm: number; doorWidthMm: number; doorHeightMm: number; windowWidthMm: number; windowHeightMm: number; windowSillMm: number };
  readOnly: boolean;
  readOnlyReason: 'archived' | 'no_permission' | 'plan_locked' | null;  // phone is detected client-side (§2.3)
  lock: { lockedAt: string; lockedBy: { id: string; name: string } } | null;   // plans.locked_at / locked_by (02 §3.2)
  canLock: boolean;                         // staff with plans.edit_any (13 §7.1); always false for customers
  canCreateDesign: boolean;                 // customer context and not read-only
  saveAdapter?: PlanSaveAdapter;            // replaces the working-copy endpoint (06 review mode, §15.4)
  extensions?: PlanEditorExtensions;        // 06 review mode hooks (§15.4)
  initial?: { mode?: '2d' | '3d'; tool?: ToolId; panel?: 'background' | 'designs' | 'fixtures' | 'revisions' | 'outline'; select?: string };
}
interface EditorDesign {                    // mapped by the host from FurnitureDesignSummaryData (10 §3)
  id: string; name: string; templateLabel: string; thumbnailUrl: string | null;
  widthMm: number; heightMm: number; depthMm: number;
  mounting: 'floor' | 'wall' | 'loft' | null;   // carcass.mounting of the working document; null for tables (10 §3 `FurnitureDesignSummaryData.mounting`)
  lockedByOrderNumber: string | null; updatedAt: string;
}
```

`PlanDefaults` (`04` §6.4) = `{ wallHeight: doc.meta.defaultWallHeight, interiorThickness: doc.meta.defaultWallThickness, exteriorThickness: defaults.exteriorWallThicknessMm, doorWidth/doorHeight/windowWidth/windowHeight/windowSill: from defaults, openingWidth: defaults.doorWidthMm, openingHeight: defaults.doorHeightMm }`. User unit preferences come from the shared prop `auth.user` (`unit_system`, `length_unit`, `locale`, `timezone`).

### 1.4 JSON endpoints used (Wayfinder helpers; names registered in `14`)

| Purpose | Endpoint |
|---|---|
| Autosave | PUT `/api/plans/{plan}/working-copy` (`03` §5) — or `saveAdapter` |
| Revisions list | `api.plans.revisions.index` GET `/api/plans/{plan}/revisions?before={number}` → `{ data: Array<{ id, number, reason, label, author: {id, name} \| null, createdAt }>, hasMore }` (50 per page, newest first; policy `view`) |
| Revision document | `api.plans.revisions.show` GET `/api/plans/{plan}/revisions/{revision}` → `{ id, number, document, schemaVersion, reason, label, createdAt }` |
| Checkpoint | POST `/api/plans/{plan}/revisions` `{ label? }` (`03` §5) |
| Restore | POST `/api/plans/{plan}/revisions/{revision}/restore` → `{ workingDocument, workingVersion }` (`03` §5) |
| Conflict "save mine as copy" | `api.plans.duplicate-with-document` POST `/api/plans/{plan}/duplicate-with-document` `{ document, name: string(1..80) }` → `{ planId, editUrl }`; document validated with engine CLI `validate-plan`; creates a plan in the same project with `source = 'duplicated'`, same `level_index`; policy `duplicate` |
| Thumbnail | upload intent (13 §11, purpose `plan_thumbnail`, target = the plan: presign → PUT → confirm → poll) → `api.plans.thumbnail.store` POST `/api/plans/{plan}/thumbnail` `{ uploadId }` → replaces media collection `thumbnail`; 204; policy `update`; limiter `thumbnails` (6/min/user, 13 §10) |
| Project cover | upload intent (purpose `project_cover`, target = the project) → `api.projects.cover.store` POST `/api/projects/{project}/cover` `{ uploadId }` → replaces collection `cover`; 204; policy `update` |
| Lock / unlock | `api.plans.lock.store` / `api.plans.lock.destroy` POST / DELETE `/api/plans/{plan}/lock` → `{ lockedAt, lockedBy: {id, name} }` / 204; permission `plans.edit_any`; activity `plan.locked` / `plan.unlocked`; while locked every write to the plan (working copy, checkpoint, restore) returns 423 `plan_locked` (03 §5) |
| Furniture document (3D) | `api.furniture-designs.working-copy.show` GET `/api/furniture-designs/{design}/working-copy` → `{ document, version, updatedAt }`; policy `view` |
| Catalog snapshot (3D colours) | GET `/api/catalog/snapshot` (`01` §5.3) |
| Client errors | POST `/api/client-errors` (`03` §5) |

All requests use `lib/http.ts` (CSRF, JSON, `AbortController`); every request started by the editor is aborted on unmount. Blueprint uploads and trace imports are **not** started inside the editor: the editor navigates to the import page of `10`/`06` for this plan (§1.5, §7.12).

### 1.5 Loading, empty and error states

1. **Loading.** While `migratePlan` + first derive run (budget 150 ms for 100 walls), the editor regions render skeletons (`aria-busy="true"`) and a centred spinner with `plan_editor.loading`.
2. **Invalid document.** If `migratePlan` or `PlanDocumentSchema.parse` throws: full-canvas error state (icon, `plan_editor.load_error.title`, `plan_editor.load_error.body`), buttons **Open revisions** (RevisionsPanel in a dialog; restoring reloads the page) and **Back** (`backHref`). Reported via `POST /api/client-errors` with `{ planId, message, zodIssues }`.
3. **Empty plan** (no walls, no background, editable, mode `plan`): an overlay card centred on the canvas (`plan_editor.empty.title`, `plan_editor.empty.body`) with buttons **Draw walls** (Wall tool), **Draw a room** (Room tool), **Import a blueprint** and **Trace over an image** (both navigate, after flushing autosave, to the import page of `10` §9.1 for this plan — the wizard offers auto and trace modes). The card disappears as soon as the document has a wall or a background, and can be dismissed (×) for the session.
4. **3D chunk failed to load** (network): the 3D area shows `plan_editor.view3d.load_failed` with **Retry**; 2D remains usable.
5. **Background image failed to load** (expired/missing): `refreshBackgroundUrl()` is called once; if it fails again, the image is replaced by a hatched placeholder rectangle of the same size and the Background panel shows `plan_editor.background.load_failed` with **Retry**.

---

## 2. Layout

The editor renders into the regions of `EditorLayout` (`15` §7.3): `#topbar-start`, `#topbar-center`, `#topbar-end`, `#banner`, `#toolrail`, `#canvas`, `#inspector`, `#statusbar`. The host page passes `title`, `backHref`, `readOnly` and the editor's save status (§11.1) to the layout; page-owned items (floor switcher in `#topbar-start`, page overflow items in `#topbar-end`, archived/phone/staff-editing banners) come from `10`/`11`.

### 2.1 Desktop (≥ 1024 px)

```
┌ #topbar (48 px) ─────────────────────────────────────────────────────────────────┐
│ [start: ← back · title · floor switcher (page) · save status] [center: ↶ ↷ · 2D|3D] │
│ [end: View ▾ · Checks ⚠2 · Revisions · Export · Help · Lock (staff) · page overflow] │
├ #banner (05: locked / no-permission; page: archived, staff editing) ─────────────┤
├#toolrail 48px┬──────────────── #canvas (2D SVG or 3D) ─────────┬ #inspector 320 px ┤
│ tools        │   LeftFlyout (300 px, overlays the canvas)       │ PropertiesPanel   │
├──────────────┴──── #statusbar (28 px): X Y · snap · hint · selection · 1:N −+⤢ ──┴──┤
```

- **`#topbar-start`** (after the page's items): save status (layout `SaveStatusIndicator`, §11.1); clicking it opens the CheckpointPopover (§11.5).
- **`#topbar-center`**: Undo / Redo icon buttons (`aria-label` = `t('plan_editor.undo_label', { action: t(labelKey) })`, disabled when not possible); 2D/3D segmented control (`role="radiogroup"`).
- **`#topbar-end`** (before the page's overflow): **View** menu (§2.4); **Checks** button with count badge (§10.4; hidden when 0); **Revisions** (RevisionsPanel in the LeftFlyout); **Export** (§14); **Help** (§12.3); **Lock/Unlock** toggle when `canLock` (§15.3); on tablets the **Properties** toggle (§2.2).
- **`#toolrail`** (`role="toolbar"`, `aria-orientation="vertical"`, 48 px wide): groups separated by dividers — [Select, Pan] [Wall, Room, Door, Window, Opening] [Furniture, Fixture] [Dimension, Text, Measure] [Background]; at the bottom: Plan outline (list view) toggle. Buttons 40 × 40 px (44 × 44 on touch devices), lucide icons, tooltip `t('plan_editor.tools.<id>')` + shortcut, `aria-pressed` for the active tool. Read-only mode shows only Select, Pan and Measure (§15). 2D-only tools activated from 3D switch to 2D (§6.3).
- **LeftFlyout** (300 px) hosts DesignPickerPanel, FixtureLibraryPanel, RevisionsPanel, PlanOutlinePanel and Background controls; it overlays the canvas (no SVG re-layout); close button and Esc close it.
- **`#inspector`**: PropertiesPanel (§8). Width (280–420 px) and collapse state are owned by the layout (`15` §7.3).
- **`#statusbar`**: cursor coordinates (2D, mouse only; `formatLength` in the user's unit), snap kind (icon + `engine.plan.snap.kind.<kind>`), tool hint (`hintKey`, §7), selection count, zoom as `1:N` (§4.2) with zoom-out / zoom-in / fit buttons. In 3D: camera mode + wall display mode instead of coordinates and scale.

### 2.2 Tablet (768–1023 px) and touch devices

- `#inspector` becomes the layout's right Sheet (non-modal, 320 px), **closed by default**; the **Properties** toggle in `#topbar-end` opens it; it opens automatically when a tool creates an entity (so its fields can be filled), and closes on Esc, the close button, or tapping the canvas background (decision for `15` §7.3 "05 decides").
- LeftFlyout overlays the canvas with a 40 % scrim; tapping the scrim closes it.
- `#topbar-end` collapses Revisions, Export and Help into an overflow "⋯" menu below 900 px.
- The status bar hides coordinates when the last pointer was touch.
- Handles and snap tolerances use touch sizes (§4.10, `04` §5.3) whenever the last pointer event had `pointerType === 'touch'`, independent of viewport width.

### 2.3 Phone (< 768 px): `PhoneViewer.vue` — view-only

Determined with `useMediaQuery('(max-width: 767.98px)')` and re-evaluated live (the store and document are kept; edits made on a larger viewport keep autosaving until flushed). Uses the layout's phone behaviour (`15` §7.3): `#topbar` keeps back, title and the 2D/3D toggle; `#toolrail`/`#inspector` are not rendered; details open in the layout's bottom Drawer.

- Canvas full width. 2D: pinch-zoom, one-finger pan, double-tap zoom ×2, tap selects (inspection only). 3D: orbit camera; a small camera button on the canvas cycles Orbit → Top → Walk (walk only when `features.walkthrough_camera`).
- Drawer content: collapsed 64 px shows `t('plan_editor.phone.summary', { rooms, area })`; expanded (60 % height) has two tabs: **Rooms** (name, type, area, size; tap → select + zoom) and **Furniture** (design name, W × H × D, room; tap → select + zoom; **View design** navigates to the design page of `10`).
- Tapping an entity on the canvas selects it and shows an inspector card in the Drawer (room: name, type, area, perimeter, size; placement: name, dims, elevation, room, View design; fixture: type, size; opening: kind, type, width × height, sill).
- No tools, no editing, no autosave, no context menus, no exports; keyboard: Esc deselects.

### 2.4 View options menu (`ViewOptionsMenu.vue`)

Checkbox/radio menu items (state in `view`, persisted per device, §3.8):

| Item | Key | Default |
|---|---|---|
| Grid (G) | `view.grid` | on |
| Snapping (S) | `view.snapping` | on |
| Angle step: 15° / 45° / 90° | `view.angleStep` | 15 |
| Wheel: zoom / pan | `view.wheel` | zoom |
| Layers: Background, Rooms, Room areas, Room sizes, Furniture, Fixtures, Door swings, Auto dimensions, Dimensions, Text | `view.layers.*` | all on |
| Door clearance zones | `view.showClearances` | off |
| 3D: Camera Orbit / Top / Walk | `view.camera3d` | orbit |
| 3D: Walls Full / Cutaway / Low | `view.wallDisplay3d` | cutaway |
| 3D: Show furniture, Show fixtures | `view.layers3d.*` | on |

### 2.5 Acceptance criteria — layout

- [ ] At 1280 × 800 the canvas is ≥ 880 px wide with both panels open; at 1024 × 768 all editor top-bar items are visible.
- [ ] At 800 × 1280 (tablet portrait) all tools are reachable, every interactive element is ≥ 44 × 44 px, and the properties sheet opens/closes as specified.
- [ ] At 390 × 844 PhoneViewer renders, no editing UI is present, 2D/3D toggle works, the rooms list shows every named and unnamed room with area.
- [ ] Resizing across 768 px switches between EditorShell and PhoneViewer without losing unsaved changes (dirty document stays in the store and autosave continues for the editable session).

---

## 3. Store design — `usePlanEditorStore(planId)`

### 3.1 Factory and state

```ts
export function usePlanEditorStore(storeKey: string) {   // storeKey = plan id (01 §6 "usePlanEditorStore(planId)") or 'import:{id}' (06)
  return defineStore(`plan-editor/${storeKey}`, () => { /* setup store */ })();
}
```

Created by `PlanEditor.vue` in `setup` (before children mount) via `store.init(props)`; disposed on unmount (§3.7). Large objects are held in `shallowRef` or are `markRaw` (`01` §6).

```ts
type ToolId = 'select' | 'pan' | 'wall' | 'room' | 'door' | 'window' | 'opening'
            | 'furniture' | 'fixture' | 'dimension' | 'text' | 'measure' | 'background';
type ReadOnlyReason = 'no_permission' | 'small_screen' | 'plan_locked' | 'archived';
type SaveStatus = 'saved' | 'dirty' | 'saving' | 'offline' | 'conflict' | 'error' | 'invalid' | 'readonly';

interface PlanEditorStoreState {
  // identity
  storeKey: string; planId: string | null; projectId: string; context: 'customer' | 'admin'; mode: 'plan' | 'import-review';
  // document + derived (shallow)
  doc: ShallowRef<PlanDocument>;
  geometry: ShallowRef<DerivedPlan>;            // 04 §7.1
  snapIndex: ShallowRef<SnapIndex | null>;      // rebuilt lazily (§3.5)
  hitIndex: ShallowRef<HitIndex | null>;
  issues: ShallowRef<Issue[]>;                  // validatePlan (debounced 200 ms)
  deriveIssues: ComputedRef<DeriveIssue[]>;     // geometry.value.issues
  conflicts: ShallowRef<PlacementConflict[]>;   // 04 §5.9 (debounced 200 ms)
  // reactivity plumbing
  revisions: Map<string, number>;               // markRaw; entity id → revision counter (§3.3)
  revTick: Ref<number>;                         // incremented once per bus event
  // UI state (deep refs; small)
  selection: Ref<{ ids: string[]; primaryId: string | null }>;
  hoverId: Ref<string | null>;
  tool: Ref<{ id: ToolId; phase: string; options: ToolOptions }>;
  mode: Ref<'2d' | '3d'>;
  camera2d: ShallowRef<{ centerX: number; centerY: number; zoom: number }>;   // zoom = px per mm
  camera3d: ShallowRef<{ kind: 'orbit' | 'top' | 'walk'; position: [number, number, number]; target: [number, number, number] }>;
  view: Ref<ViewSettings>;                      // §2.4 (persisted)
  snapState: ShallowRef<SnapResult | null>;     // last snap result (status bar + SnapLayer)
  pointerType: Ref<'mouse' | 'pen' | 'touch'>;
  save: Ref<{ status: SaveStatus; baseVersion: number; lastSavedAt: string | null; lastError: string | null; conflict: ConflictInfo | null }>;
  readOnly: ComputedRef<{ value: boolean; reasons: ReadOnlyReason[] }>;
  history: Ref<{ canUndo: boolean; canRedo: boolean; undoLabelKey: string | null; redoLabelKey: string | null }>;
  designs: ShallowRef<Map<string, EditorDesign>>;
  ui: Ref<{ flyout: 'designs' | 'fixtures' | 'revisions' | 'outline' | 'background' | null; propertiesOpen: boolean;
            dialog: 'export' | 'help' | 'conflict' | 'restore_draft' | 'calibrate' | 'compare' | null; checksOpen: boolean; tourStep: number | null }>;
  // non-reactive
  bus: CommandBus<PlanDocument, PlanCommandContext, typeof PLAN_COMMANDS>;   // markRaw
  deriver: ReturnType<typeof createPlanDeriver>;                              // markRaw
}
```

Actions (all synchronous unless noted): `init(props)`, `exec(type, params, opts?)` (§3.4), `undo()`, `redo()`, `seal()`, `select(ids, mode: 'replace' | 'add' | 'toggle')`, `clearSelection()`, `setHover(id)`, `setTool(id, options?)`, `setMode(m)`, `setCamera2d(c)`, `fitToPlan()`, `zoomToEntity(id)`, `reset(doc, version)` (restore), `dispose()`.

Getters: `selectedEntities` (resolved objects grouped by kind), `primary`, `unitPrefs` (`UnitPrefs` from `auth.user`), `defaults` (`PlanDefaults`, `04` §6.4), `footprints` (`FootprintProvider` from `designs`), `lod` (§4.7), `roomAt(point)`, `designName(id)`.

### 3.2 Selection model

- Selection ids are document entity ids (`n_`, `w_`, `o_`, `r_`, `f_`, `x_`, `d_`, `t_`), `'background'`, or `face:{faceKey}` for rooms **without** a RoomMeta. A room with a meta is selected by its meta id `r_…`.
- `primaryId` = the most recently added id (properties panel shows it when kinds are mixed).
- After every bus event, selection is sanitised: ids that no longer exist are removed; a selected `face:{k}` whose face now has a meta becomes the meta id; a selected `face:{k}` that no longer exists is removed.
- Rooms are excluded from marquee crossing selection and from Ctrl/Cmd+A (`04` §5.12).
- Selection is **not** part of undo history; each history entry stores `meta = { selectionBefore, selectionAfter }` and undo/redo restore `selectionBefore`/`selectionAfter` (filtered by existence).

### 3.3 Entity revision map and reactivity (`editor/shared/useCommandBus.ts`)

1. The document lives in `doc` (`shallowRef`) and is replaced (never mutated) on every bus event.
2. On each event, for every id in `changedIds` (`04` §6.3), `revisions.set(id, (revisions.get(id) ?? 0) + 1)`. Expansions: a changed node bumps all its incident walls (from `geometry.nodes` of both old and new geometry); a changed wall bumps its openings, its auto-dimension group (`auto:{wallId}`) and every placement attached to it; a changed opening bumps its wall's auto-dimension group. `'*'` clears the map and bumps `revTick` (everything re-renders).
3. Rooms have no document id; their rendering is memoised by **object identity** of the `DerivedRoom` (the deriver returns the same object when a room did not change, `04` §7.2).
4. Renderers use `v-memo="[revisions.get(id), lod, selected, hovered, layerFlags]"` on per-entity groups so a drag re-renders only the touched groups.
5. `revTick` is the only reactive trigger for "something changed"; computed values that depend on the whole document read `revTick.value` first.

### 3.4 Command execution wrapper — `exec(type, params, opts)`

```ts
interface ExecOptions { merge?: boolean; silent?: boolean; select?: 'created' | 'keep' | string[]; announce?: boolean }
```

1. If `readOnly.value` → show toast `plan_editor.readonly.toast` (at most once per 10 s) and return `{ ok: false }`.
2. `bus.execute(type, params, { merge, meta: { selectionBefore } })`.
3. On error: unless `silent`, `toast.error(t(error.messageKey, error.params))`. Tools pass `silent: true` during drags and show the invalid state inline instead (red preview).
4. On success: apply `opts.select` (`'created'` selects the ids in the result: `wallIds`, `openingId`, `placementId`, …), update `selectionAfter` in the entry meta, announce via the live region (§13.3) when `announce !== false`.
5. **Nudge sealing:** commands executed with `merge: true` from keyboard nudges start/restart an 800 ms timer that calls `bus.seal()` (`04` §6.2-4). Pointer-driven drags call `seal()` on pointer-up.
6. Dirty marking and autosave scheduling are handled by the bus subscription (§11.1), not here.

### 3.5 Geometry and indices

- On every bus event: `geometry.value = deriver.derive(doc)` **synchronously** on the main thread (budgets `04` §7.3), then mark `snapIndex`/`hitIndex` stale.
- Indices are rebuilt lazily on the next pointer move / hit-test / snap call (not on every event), with `buildSnapIndex` and `buildHitIndex` (`04` §5.2, §5.12).
- `issues` (`validatePlan`) and `conflicts` (`computePlacementConflicts`) recompute 200 ms after the last event (`useDebounceFn`).

### 3.6 Worker usage

- The engine worker (`01` §5.5, `useEngineWorker()`) is used only for **revision comparison renders** (`derivePlanGeometry` of a fetched revision document, §11.4) so that loading an old revision never blocks interaction.
- Furniture models for 3D are generated on the main thread with `generateFurniture(document, catalog)` inside `requestIdleCallback` slices (one design per slice, timeout 200 ms), cached by `designId + updatedAt` (§5.5). Rationale: the worker API in `01` §5.5 does not expose `generateFurniture`, and a 60-part model generates in < 20 ms.

### 3.7 Lifecycle and disposal

- `PlanEditor.vue` `onBeforeUnmount`: flush autosave (`useDocumentAutosave.flush()` with `keepalive`), abort in-flight requests, dispose the 3D scene (§16.2), unsubscribe bus listeners, clear timers, `store.$dispose()`, and `delete pinia.state.value['plan-editor/' + storeKey]`.
- Switching floors with the host's floor switcher is an Inertia visit guarded by `flush()` (§11.7): the old page unmounts (disposing its store) before the new one mounts.

### 3.8 Per-device persisted preferences

`localStorage['fs:plan-editor:prefs']` (JSON, wrapped in try/catch; invalid → defaults): `{ v: 1, view: ViewSettings, propertiesOpen: boolean }`. The onboarding tour flag is `localStorage['fs:tour:plan-editor:v1'] = 'done'`. The autosave draft key is `fs:draft:plan:{planId}` (`03` §5, master §6.8), or the key supplied by `saveAdapter.draftKey` (`06`: `fs:draft:import:{id}`).

### 3.9 Acceptance criteria — store

- [ ] Dragging a node in a 100-wall plan re-renders (Vue patch) only the groups of the incident walls, their openings, auto-dimensions, attached placements and the affected rooms (verified with a render-count spy in a component test).
- [ ] Undo after a drag restores both the document and the selection that existed before the drag.
- [ ] Mounting and unmounting the editor 10 times leaves no `plan-editor/*` entry in `pinia.state` and no leaked event listeners (spy on `addEventListener`/`removeEventListener` counts).

---

## 4. 2D renderer (`view2d/`)

### 4.1 Structure

`PlanCanvas2D.vue` renders one `<svg>` that fills its container (`ResizeObserver` updates `widthPx`, `heightPx`):

```html
<svg :viewBox="vb" class="plan-canvas" :style="{ '--fs-inv-zoom': 1 / zoom }" role="application" …>
  <defs> hatch pattern (§4.4), marker glyph symbols, clip paths </defs>
  <g id="plan-content-root">                     <!-- referenced by the Loupe via <use> -->
    <BackgroundLayer/> <GridLayer/>
    <ContentLayer layer="ROOMS"/> <ClearanceLayer/> <ContentLayer layer="FIXTURES"/> <ContentLayer layer="FURNITURE"/>
    <ContentLayer layer="WALLS"/> <ContentLayer layer="OPENINGS"/> <ContentLayer layer="DIMS"/> <ContentLayer layer="TEXT"/>
  </g>
  <SelectionLayer/> <HandlesLayer/> <SnapLayer/> <ToolPreviewLayer/>
  <rect class="hit-surface" … fill="transparent" />  <!-- receives all pointer events -->
</svg>
<!-- HTML overlays positioned in screen space: InlineLengthEditor, DrawInput, Loupe, ContextMenu -->
```

- `ContentLayer` renders the engine `DrawGroup`s (`04` §8) of its layer through `DrawGroupView`. Groups are produced per entity by the engine `draw*` functions and cached in a non-reactive `Map<groupKey, { rev, lod, flags, group }>` held by the store; a group is regenerated only when its entity revision, `lod`, or relevant layer flags changed. Room groups are keyed by `faceKey` and regenerated when the `DerivedRoom` object identity or its meta revision changes.
- All content elements have `pointer-events: none`. Only `.hit-surface` receives pointer events; hit-testing happens in model space with the engine hit index (§4.10), never with DOM events on shapes.
- **Viewport culling** (`culling.ts`): when the document has > 400 walls + placements + fixtures, groups whose bbox does not intersect the viewport expanded by 25 % are not rendered (`v-if`); the visible set is recomputed on camera change end (debounced 100 ms) and on bus events.

### 4.2 Viewport, pan and zoom (`viewport2d.ts`)

```ts
export interface Camera2D { centerX: number; centerY: number; zoom: number }      // zoom = px per mm
export const ZOOM_MIN = 0.002, ZOOM_MAX = 4;
export function viewBox(c: Camera2D, w: number, h: number): { x: number; y: number; w: number; h: number }; // x = cx − w/(2z)…
export function screenToModel(c: Camera2D, w: number, h: number, sx: number, sy: number): Vec2;  // x = cx + (sx − w/2)/z
export function modelToScreen(c: Camera2D, w: number, h: number, p: Vec2): Vec2;
export function zoomAt(c: Camera2D, w: number, h: number, sx: number, sy: number, factor: number): Camera2D; // keeps the model point under (sx, sy) fixed
export function fit(bbox: { min: Vec2; max: Vec2 }, w: number, h: number, paddingPx = 48): Camera2D;
export function scaleDenominator(zoom: number): number;  // N in "1:N" = round2sig(3.7795 / zoom)  (96 dpi: 1 mm on screen = 3.7795 px)
```

Inputs:

| Input | Behaviour |
|---|---|
| Mouse wheel (`view.wheel = 'zoom'`) | `factor = exp(−deltaY × k)`, `k = 0.0015` (deltaMode 0), `deltaY × 16` for deltaMode 1; zoom about the cursor |
| Mouse wheel (`view.wheel = 'pan'`) | pan by `(deltaX, deltaY)` px |
| Ctrl/Cmd + wheel (incl. trackpad pinch) | zoom about the cursor, `k = 0.01` |
| Shift + wheel | horizontal pan by `deltaY` px |
| Middle button drag | pan |
| Space held + left drag | pan (cursor `grab` / `grabbing`); Space is ignored while a text input is focused |
| Pan tool + left drag / one-finger drag | pan |
| Two-finger touch | simultaneous pan (midpoint movement) + pinch zoom (`zoom = zoom0 × d / d0`, model point under the initial midpoint stays under the current midpoint); any in-progress one-finger tool action is cancelled (`tool.onCancel`) when the second finger lands |
| Double-tap (touch, Select tool, empty area) | zoom ×2 about the tap point (animated 200 ms; instant with `prefers-reduced-motion`) |
| Keyboard `=`/`+`, `-` | zoom ×1.25 / ÷1.25 about the viewport centre |
| Keyboard `0` | fit to plan (`fit(geometry.bbox ∪ background bbox)`; empty plan → centre (0,0), zoom 0.1) |
| Arrow keys with **no selection** | pan 10 % of the viewport (Shift: 50 %) |

Zoom is clamped to `[ZOOM_MIN, ZOOM_MAX]`. Camera changes are applied with `requestAnimationFrame` coalescing (at most one viewBox update per frame). `camera2d` is written to `doc.view.mode2d` only at save time (§11.1).

Initial camera: `doc.view.mode2d` if present and the plan bbox intersects that viewport, else `fit`.

### 4.3 Styles (`styles.ts`, `plan-theme.css`; colours from 15 §3)

Colours come from the editor tokens of `15` §3 (CSS variables such as `--canvas-bg`, `--wall`, `--dimension`; TypeScript access via `readEditorColors()` / `EditorColorKey`, 15 §3.5), so the canvas **follows the UI theme** (light/dark). Every export (PNG/SVG/PDF/print) uses the constant light `EXPORT_PALETTE` (15 §3.5), so exports never depend on the viewer's theme. `PLAN_STYLES` defines, per `StyleKey` (`04` §8.1), the screen stroke width (px, non-scaling), the colour **token**, dash and font; it generates `SvgExportOptions.styles` from `EXPORT_PALETTE` (exports convert px to paper mm with `px × 0.2646 × N`, §14.3). The hex values in the table below are the light-theme values for orientation only; the normative colour values are the tokens in `resources/css/app.css` (15 §3.1).

| Style | Stroke | Width px | Fill | Other |
|---|---|---|---|---|
| canvas background | — | — | `#FBFAF8` | |
| `wall` | none | — | `#3B3B3B` | |
| `wall_exterior` | none | — | `#262626` | hatch 45°, `#5A5A5A`, spacing 6 px (pattern size = 6 / zoom mm, updated on zoom) |
| `wall_half` | none | — | `#8C8C8C` | |
| `wall_glass` | `#5B8DB8` | 1 | `#CFE3F2` | |
| `wall_outline` | `#1A1A1A` | 1.25 | none | stroked from `wallsUnion` |
| `door_leaf` / `door_main_leaf` | `#1A1A1A` | 1.5 / 2.5 | none | |
| `door_swing` | `#1A1A1A` | 0.75 | none | |
| `sliding_panel` | `#1A1A1A` | 1 | `#FFFFFF` | |
| `window_frame` / `window_glass` | `#1A1A1A` / `#3C7CC0` | 1 / 1 | none | |
| `opening_jamb`, `threshold` | `#1A1A1A` | 1 | none | |
| `room_fill` | none | — | per type (§4.6) | |
| `room_name` / `room_area` / `room_dims` | — | — | `#1F2937` / `#4B5563` / `#6B7280` | 13 px 600 / 11 px / 11 px |
| `furniture` | `#8A6A43` | 1.25 | `#F3E9DA` | |
| `furniture_front` | `#8A6A43` | 2.5 | `#8A6A43` (triangle) | |
| `furniture_label` | — | — | `#5C4630` | 11 px |
| `furniture_missing` | `#DC2626` | 1.25 | `#FEE2E2` | dash 6 4 |
| `fixture` / `fixture_detail` | `#6B7280` / `#9CA3AF` | 1 / 0.75 | `#FFFFFF` / none | |
| `dim_line`, `dim_tick`, `dim_ext` | `#6B7280` | 0.75 | none | |
| `dim_text` | — | — | `#374151` | 11 px, white halo (`paint-order: stroke`, stroke `#FBFAF8` 3 px) |
| `label` | — | — | `#111827` | model-size text (`TextLabel.fontSize`) |
| selection | `var(--color-primary)` | 2 | primary at 8 % | |
| hover | `var(--color-primary)` | 1 | none | 60 % opacity |
| conflict | `#F59E0B` | 2 | `#F59E0B` at 10 % | dash 5 3 |
| invalid preview | `#DC2626` | 1.5 | `#DC2626` at 15 % | |
| snap guides / markers | `#EC4899` | 1 | — | guides dash 4 4; markers 10 px |
| grid minor / major | `#EEF0F2` / `#DDE1E5` | 0.5 / 1 | — | |

**Screen-sized text.** Text items whose style is `room_*`, `dim_text` or `furniture_label` are drawn at a fixed px size: `<g :transform="`translate(${x} ${y}) rotate(${r})`"><text class="fs-screen-text" :dy="`${dyEm}em`" font-size="13">…</text></g>` with CSS `.fs-screen-text { transform: scale(var(--fs-inv-zoom)); }` (transform-origin 0 0). Only the root CSS variable changes on zoom, so zooming does not re-render text. `label` style uses `sizeMm` directly (scales with zoom).

All strokes use `vector-effect="non-scaling-stroke"`.

### 4.4 Walls

- Fill: each `pocheParts` polygon (`04` §3.7) as a `<path fill-rule="evenodd">` in its kind style.
- Outline: one `<path>` built from `geometry.wallsUnion` (outer rings and holes) with `wall_outline` — internal joints and fallback overlaps are invisible.
- Opening gaps are part of the poché (holes cut by the engine), so doors and windows are drawn on clean gaps.

### 4.5 Openings

Symbols exactly as `04` §8.2 via `drawOpening`. Door swing arcs follow `view.layers.doorSwings` and LOD. A selected opening shows its cut rectangle in selection style.

### 4.6 Rooms

- Fill colour by `RoomMeta.type` via the room tokens of `15` §3.4 (`roomTypeToColorKey`; rooms without a meta use `--room-other`). Indicative light values (normative: 15 §3.1/§3.4, whose grouping wins where it differs from this table):

| Types | Fill |
|---|---|
| living, dining, foyer, corridor | `#F5EFE4` |
| bedroom, master_bedroom, dress, study | `#E8EEF6` |
| kitchen, utility, store | `#F6ECE3` |
| bathroom, toilet | `#E2F0F0` |
| balcony, deck, ots, garage | `#ECF3E6` |
| pooja | `#F8EDF2` |
| other | `#F2F2F2` |

- `floorColorHex` is used only in 3D (§5.3); 2D fill is by type for readability.
- Label: engine `drawRoom` items at `labelPoint` (name, area, size). Fit rule: estimated text width `= chars × 0.56 × fontPx / zoom` (mm); if the name's half-width > `1.6 × labelRadius`, hide the name; if the area's half-width also exceeds it, hide the whole label (shown in a tooltip on hover). Unnamed rooms show `plan_editor.room.unnamed` ("Room") in italic.
- In the Select tool, dragging the label of a selected room moves it (`setRoomMeta { labelOffset }`, merged); the "Reset label position" action sets `labelOffset: null`.

### 4.7 Level of detail

`lod` = 0 if `zoom ≥ 0.03`, 1 if `0.01 ≤ zoom < 0.03`, 2 if `zoom < 0.01` (with 10 % hysteresis on the thresholds to avoid flicker).

| LOD | Hidden / simplified |
|---|---|
| 1 | auto dimensions, door swing arcs, fixture detail lines, furniture labels, room size line; exterior hatch → solid fill |
| 2 | additionally room areas, window glass lines (openings shown as gaps + jambs only), text labels whose rendered height < 6 px, user dimension texts |

### 4.8 Dimensions and inline editing

- **Auto dimensions** (`view.layers.autoDimensions`): engine `autoDimensions(wall)` per wall (`04` §8.2).
- **User dimensions** (`view.layers.dimensions`): `drawDimension`.
- **Inline editing** (`InlineLengthEditor.vue`): in the Select tool, hovering an auto-dimension text or an attached user-dimension text shows a pointer cursor and an underline; click (or tap) opens an HTML `<input>` (width 104 px, 13 px font) centred on the text's screen position, prefilled with `formatLength(value)` and fully selected. `Enter` → `parseLength(input, { unit: userUnit, min: 10 })`:
  - overall wall length segment or attached dimension → `setWallLength { wallId, length, anchor: 'auto' }`;
  - opening chain segment `k` of wall `w` with openings `o₁…oₙ` sorted by `u0`: segment 0 (wall start → `o₁.u0`) → `moveOpening { o₁, offset: value + o₁.width/2 }`; segment between `oᵢ.u1` and `oᵢ₊₁.u0` → move `oᵢ₊₁` so its `u0 = oᵢ.u1 + value`; last segment (`oₙ.u1` → end) → move `oₙ` so `u1 = length − value`.
  - Parse error → red border + message `t(error.messageKey, params)` under the input (`aria-describedby`); command error → same place. `Esc` cancels; `Tab` commits and opens the next segment of the same chain; blur commits.
- Unattached user dimensions are not editable (they measure free points).

### 4.9 Snap guides, markers and tool previews

- `SnapLayer` draws `snapState.guides` (clipped to the viewport) and `markers` in screen-constant size (glyph `<use>` scaled by `--fs-inv-zoom`): endpoint = filled square, midpoint = triangle, intersection / guide intersection = ×, perpendicular = right-angle glyph, on_face/on_wall = none (the wall gets a hover highlight).
- Near the cursor, a small pill shows `lengthFromOrigin` and `displayAngleDeg` while drawing (formatted with `formatLength` / `formatAngle`).
- `ToolPreviewLayer` renders `tool.preview` (§7.1): ghost walls (translucent poché in `wall` style at 50 % opacity), ghost openings (engine symbol), ghost footprints, marquee rectangle (window: solid blue border `#2563EB` 1 px, fill 6 %; crossing: dashed green `#16A34A`, fill 6 %), measure polylines.

### 4.10 Hit-testing and handles

1. Pointer events on `.hit-surface` are converted to model coordinates (§4.2).
2. **Handles first:** `handles.ts` computes the handles of the current single selection in screen space (positions via `modelToScreen`); a handle is hit within `12 px` (mouse/pen) or `24 px` (touch). Visual sizes: 10 px squares/circles (mouse), 16 px (touch); white fill, primary stroke 1.5 px.
3. Otherwise `hitTest(hitIndex, p, zoom, pointerType, layerMask)` (`04` §5.12); hidden layers are excluded from the mask (hidden furniture cannot be picked).
4. Hover: on pointer move (mouse/pen only), at most once per animation frame, set `hoverId` to the first hit.

| Selection | Handles |
|---|---|
| Wall | node handles at both centre-line ends (move node); a move handle at the centre-line midpoint (drag perpendicular → `moveWall`); thickness handles on both faces at mid-length (drag → `setWallProps { thickness }`, value `= round5(2 × |distance to centre line|)`, clamped 50–1000, merged) |
| Node | one node handle |
| Opening | resize handles at `u0` and `u1` on the centre line (`resizeOpening` with `keep` = opposite end); flip-swing button (circular-arrow icon 20 px) offset 24 px on the non-swing side; flip-hinge button next to it |
| Placement | rotate handle 32 px beyond the front-edge midpoint (drag: angle from footprint centre to pointer, snapped to 15° unless Alt; Shift snaps to 90°) |
| Fixture | rotate handle as placement; 4 corner resize handles (`setFixtureProps` with `keep` = opposite corner; Shift keeps aspect ratio) |
| Text label | rotate handle 24 px above the text box |
| Dimension | offset handle at the text; endpoint handles for unattached dimensions |
| Room | label move handle (only when the label is visible) |
| Background (Background tool only) | rotate handle at the top-centre, 32 px above |

### 4.11 Selection and marquee

Implemented by the Select tool (§7.2). Selection highlight: walls → outline path; openings → cut rectangle; rooms → net polygon with 8 % primary fill; placements/fixtures → footprint; labels/dimensions → bbox; nodes → circle 6 px. Multi-selection draws all highlights plus a dashed bbox around the union.

### 4.12 Background image

`<image href=… preserveAspectRatio="none">` with `width = W = pixelWidth × mmPerPixel`, `height = H = pixelHeight × mmPerPixel`, transform `translate(position.x position.y) rotate(rotation, W/2, H/2)`: `position` is the plan coordinate of the **unrotated** image's top-left pixel (`03` §1) and rotation is about the image **centre** (as `06` §12.2 requires). Opacity per `opacity`; hidden when `!visible` or `!view.layers.background`. Loaded from `backgroundUrl`; `refreshBackgroundUrl()` is called every 12 minutes while the editor is open (URLs live 15 min, `02` §10) and once after an `error` event (a second failure shows the placeholder, §1.5-5). `image-rendering: auto`.

### 4.13 Grid

Drawn in `GridLayer` only when `view.grid`: minor lines at `gridStepFor(zoom).step`, major at `.major` (`04` §5.6), restricted to the viewport (computed lines, not a pattern, to keep major/minor alignment exact). Hidden when the minor spacing < 8 px.

### 4.14 Acceptance criteria — 2D renderer

- [ ] Wheel zoom keeps the model point under the cursor fixed within 1 px; pinch zoom keeps the midpoint fixed within 2 px.
- [ ] Zooming from 0.01 to 1 px/mm does not change on-screen stroke widths or room-name font size (screenshot comparison of a 3-room fixture at two zooms).
- [ ] Wall joints show no internal outline strokes for L, T, X junctions (visual snapshot).
- [ ] Clicking 3 px outside a wall's outline selects it (mouse tol 8 px); a tap 14 px outside selects it on touch.
- [ ] Clicking a wall-length dimension, typing `10'6"` and Enter sets the wall length to 3200 mm; typing `abc` shows the syntax error inline and changes nothing.
- [ ] A 1000-wall plan pans at ≥ 50 fps in Chromium on the CI machine profile (Playwright trace, §16.1) thanks to culling.

---

## 5. 3D renderer (`view3d/`)

### 5.1 Structure, loading and render loop

- `PlanScene3D.vue` is loaded with `defineAsyncComponent(() => import('./view3d/PlanScene3D.vue'))`. The chunk (three, Tres, camera-controls, three-mesh-bvh, exporters) is **prefetched** with `requestIdleCallback(() => import(...), { timeout: 3000 })` after the first 2D render, so the first switch does not wait on the network.
- `<TresCanvas render-mode="on-demand" :clear-color="'#EEF1F4'" :tone-mapping="ACESFilmicToneMapping" :output-color-space="SRGBColorSpace" antialias power-preference="high-performance" :dpr="[1, 2]">` contains only `SceneRoot`. `SceneRoot` obtains `scene`, `renderer`, `camera` and `invalidate` from the Tres context composable exported by `@tresjs/core 5.9.3` (`useTres()`; if the package exposes it as `useTresContext()`, use that — the code must compile against the pinned version) and creates a `SceneManager` (`markRaw`).
- Once mounted, the 3D view stays mounted (`v-show`) for the rest of the session; when hidden, `SceneManager.setActive(false)` stops all rAF loops and ignores invalidations.
- **Render on demand:** `invalidate()` is called on: bus events (after the scene update), selection/hover change, camera-controls `update` events, resize, texture/model load completion, wall-display recomputation. camera-controls needs per-frame `update(delta)` while moving: a rAF loop runs while `controls.update(delta)` returns `true` or walk mode is active, and stops otherwise.
- Units: three.js world is metres, y up; `world.x = plan.x / 1000`, `world.z = plan.y / 1000`, `world.y = elevation / 1000` (master §6.2). All builders convert mm → m at the last step.

`SceneManager` API:

```ts
class SceneManager {
  constructor(opts: { scene: Scene; renderer: WebGLRenderer; invalidate: () => void; store: PlanEditorStore });
  build(doc: PlanDocument, geom: DerivedPlan): void;          // full build
  update(doc: PlanDocument, geom: DerivedPlan, changed: ReadonlySet<string>): void; // incremental
  setWallDisplay(mode: 'full' | 'cutaway' | 'low'): void;
  setActive(active: boolean): void;
  pick(ndc: Vector2): PickHit | null;
  exportRoot(): Group;                                        // content for GLB export (§14.5)
  dispose(): void;
}
```

Scene graph: `root (Group 'plan')` → `walls`, `nodeCaps`, `floors`, `slab`, `openings`, `furniture`, `fixtures`, `shadows`, `helpers` (selection outlines, gizmos, ghosts, ground). Every pickable mesh has `userData = { entityId, entityKind }`.

Incremental update rules: rebuild wall meshes for walls in `changed` (expanded per §3.3) and node caps for their nodes; rebuild floors whose `DerivedRoom` object identity changed; rebuild opening models of changed openings and of openings on changed walls; reposition placements/fixtures whose ids changed (geometry reused); rebuild the slab when `exteriorOutline` changed.

### 5.2 Walls

Per wall (`builders/walls.ts`), using `DerivedWall` (`04` §3.1):

1. **Elevation polygon** in wall-local coordinates `(u, v)` (mm): rectangle `[0, L] × [0, H]` (`H` = displayed height, §5.9) minus the union of opening rectangles `[max(u0, safeU[0]), min(u1, safeU[1])] × [sill, min(sill + height, H)]`, computed with the engine `difference` (`04` §2.6; re-exported from `@/engine`). Openings with sill 0 become notches, windows become holes, a full-height opening splits the wall into several polygons.
2. Convert each result polygon (+ holes) to a `THREE.Shape` (metres) and build `new ExtrudeGeometry(shapes, { depth: t/1000, bevelEnabled: false, curveSegments: 1, steps: 1 })`.
3. **Placement transform** (applied to vertices, not as an object transform, so BVH and picking use world coordinates): for vertex `(su, sv, sz)`: `u = su·1000`, `v = sv·1000`, `z = sz·1000 − t/2` (z runs from the right face `−t/2` to the left face `+t/2`).
4. **Miter adjustment:** if `|u| < 0.001` mm → `u = dot(end.side − A, d)` where `end = endA` and `side = left` when `z > 0`, `right` when `z < 0`; if `|u − L| < 0.001` → same with `endB`. This slants the ends to the mitered corners exactly (`04` §3.3).
5. World position: `p = A + d·u + n·z` (plan mm) → `(p.x/1000, v/1000, p.y/1000)`. Recompute vertex normals (`computeVertexNormals()`) after the transform.
6. Materials: `[faceMaterial, edgeMaterial]` (ExtrudeGeometry group 0 = elevation faces = the two wall faces; group 1 = top, ends and opening reveals). `faceMaterial` colour = `colorHex` or the kind default (exterior `#EDE8DF`, interior/partition `#F4F2EE`, half `#E8E4DC`); `edgeMaterial` = the same colour × 0.85 (cut look). `material === 'glass'` → shared glass material for both groups.
7. **Node caps:** for every `nodeCaps[nodeId]` ring, an `ExtrudeGeometry` of the ring (plan → shape with `(x, −y)`, rotated `−π/2` about X) with height = max incident displayed wall height, `edgeMaterial` of the first incident wall. Closes junction prisms that straight wall ends leave open (`04` §3.8).
8. One `Mesh` per wall (≈ 100 draw calls for 100 walls; acceptable, §16.1).

### 5.3 Floors and slab

- **Room floors:** for each `DerivedRoom`, `triangulate({ outer: polygon, holes })` (`04` §2.7) → `BufferGeometry` with positions `(x/1000, 0.001, y/1000)`, normals `(0, 1, 0)`, and **each triangle's index order reversed** (engine triangles are CW in plan; reversed they are CCW seen from above = front-facing). Colour: `floorColorHex` or by `floorFinish`: tile `#D9D6CF`, wood `#B98A5E`, marble `#EDEBE6`, carpet `#8C8C99`, concrete `#A7A7A2`, other `#CFCFCF`; rooms without meta `#DAD7D0`. `MeshStandardMaterial({ roughness: 0.85, metalness: 0 })`, cached per colour.
- **Slab:** `exteriorOutline` extruded by `meta.floorThickness` (shape from `(x/1000, −y/1000)`, `ExtrudeGeometry depth floorThickness/1000`, rotated `−π/2` about X, translated so its top is at `y = −0.001`), colour `#C9C4BA`. Visible in door thresholds and from the side.
- **Ground:** a 400 × 400 m plane at `y = −floorThickness/1000 − 0.002`, colour `#E6E3DC`, not pickable, not exported.

### 5.4 Openings

Built per opening in wall-local coordinates then transformed like walls (step 3–5 of §5.2, without miter adjustment). Widths: jamb/head frame members 50 mm wide.

| Type | Model |
|---|---|
| door frames (all door types) | two jamb boxes (50 × t × height) and a head box (width × t × 50) inside the opening; colour `#E9E4DA` |
| `single_swing` | leaf box `width − 10` × 40 × `height − 10`, **opened 90°** toward `swingSign·n` about the hinge jamb (matches the 2D symbol); colour `#A47551` |
| `double_swing` | two leaves of `width/2 − 5`, both open 90° |
| `main_entrance` | as single, leaf 55 mm thick, colour `#6B4226` |
| `sliding` | two leaves `0.55·width` × 30 in the closed position at `±t/6` |
| `pocket` | one leaf half inside the wall |
| `bifold` | two leaves of `width/2` folded at 30° |
| windows (all types) | frame: jambs, head and sill members 50 × 60 mm centred in the thickness; glass pane 6 mm at the centre plane (shared glass material); interior sill board 30 mm thick protruding 50 mm on the `+n` side; `fixed` = no mullion; `casement`/`french_window` = one vertical mullion per 900 mm of width; `sliding_window` = two overlapping panes at ±15 mm; `bay` = rendered as casement (the projection exists only in 2D); `ventilator` = casement with a horizontal mullion |
| `opening` | nothing (the hole/notch only) |

### 5.5 Furniture

1. For each placed `designId`, fetch `GET /api/furniture-designs/{id}/working-copy` once (cache by `designId + updatedAt`; concurrency 3) and the catalog snapshot once per session.
2. In idle slices: `model = generateFurniture(document, catalog)`; for every part build geometry in **furniture local space** (mm → m): `box` parts → `BoxGeometry(size)` translated to `min + size/2`; `extruded` parts → `ExtrudeGeometry` of the outline in the xz plane at `y`, depth `thickness`.
3. Merge part geometries **per material code** with `BufferGeometryUtils.mergeGeometries` (`three/examples/jsm/utils/BufferGeometryUtils.js`) → a `DesignModel { meshesByMaterial: Map<code, BufferGeometry>, bbox }` shared by all placements of the design (reference counted).
4. Materials: colour from the snapshot material `colorHex` (fallback by role: carcass `#E8E2D6`, front `#D7CBB7`, back `#CFC7B8`, top `#BFA98A`, others `#D9D3C7`); `board_type === 'glass'` → glass material; textures are **not** used in the plan view (rationale: performance; the builder shows textures).
5. Placement transform: `outer = Group` at `(p.x/1000, p.elevation/1000, p.y/1000)`, `outer.rotation.y = −p.rotation·π/180` (plan clockwise → three.js about +Y, derived from `rot` in `04` §2.1); `inner = Group` with `position.x = (p.mirrored ? +W/2 : −W/2)/1000` and `scale.x = p.mirrored ? −1 : 1` (three.js flips face winding for negative determinants automatically). Local z (toward the viewer) maps to plan `+y` at rotation 0 = the front (master §6.2).
6. Until the model is ready (or if loading fails), render a translucent placeholder box `W × H × D` (`#D7CBB7`, opacity 0.6) with the same transform; on failure the placeholder stays and the Checks popover lists `plan_editor.issues.design_model_failed`.
7. Missing design (not in `designs`): red translucent 600 × 600 × 600 box.

### 5.6 Fixtures

`FIXTURE_LIBRARY[key].primitives3d(w, d, h)` (§9) returns primitives in normalised fixture space. Build per primitive: `box` → `BoxGeometry`; `cylinder` → `CylinderGeometry(r, r, height, 20)` with `r = min(sx, sy)/2` and non-uniform scale for ellipses; `sphere` → `SphereGeometry(0.5, 16, 12)` scaled. Map normalised `(x ∈ [−0.5, 0.5], y ∈ [0, 1] back→front, z ∈ [0, 1])` to local metres `(x·w, z·h, (y − 0.5)·d)` (fixture origin = footprint centre); merge per material key; cache by `key + w + d + h`. Object transform like placements but without the inner offset (origin is the centre): position `(f.x/1000, f.elevation/1000, f.y/1000)`, `rotation.y = −f.rotation·π/180`.

### 5.7 Materials, lighting, shadows

- `materials.ts` registry: `getColorMaterial(hex, { roughness, metalness })`, `glassMaterial` (`MeshStandardMaterial({ color: '#A8C8E0', transparent: true, opacity: 0.25, roughness: 0.1, metalness: 0, depthWrite: false })`), fixture palette (§9.2). Materials are shared and disposed only in `SceneManager.dispose()`.
- Lights: `HemisphereLight('#FFFFFF', '#B5AE9F', 1.1)` + `DirectionalLight('#FFFFFF', 1.6)` at direction `(−0.6, 1, 0.4)`; **no shadow maps**.
- **Contact shadows:** blob shadows only (rationale: deterministic, no extra render passes, works with on-demand rendering). One shared `CanvasTexture` (128 × 128, black rounded rectangle blurred with `ctx.filter = 'blur(12px)'`, used as `alphaMap`) and one `MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.32, depthWrite: false, alphaMap })`. For every placement/fixture with `elevation < 50` a plane of footprint size + 160 mm, at `y = 0.002`, rotated like the item. Rugs get none.

### 5.8 Cameras (`cameras.ts`)

camera-controls is installed once: `CameraControls.install({ THREE: { Vector2, Vector3, Vector4, Quaternion, Matrix4, Spherical, Box3, Sphere, Raycaster } })`.

#### 5.8.1 Orbit (perspective)
`PerspectiveCamera(fov 45, near 0.05, far 500)`; CameraControls with `smoothTime 0.25`, `draggingSmoothTime 0.1`, `minDistance 1`, `maxDistance 200`, `minPolarAngle 0.05`, `maxPolarAngle 85°`, `dollyToCursor true`. Mouse: left = rotate, right = truck, wheel = dolly; touch: one finger = rotate, two fingers = dolly + truck. Default view: target = plan bbox centre at `y = 0`, polar 55°, azimuth 30°, `fitToBox(bbox3d, true, { paddingTop/Left/Bottom/Right: 0.5 })`.

#### 5.8.2 Top (orthographic)
`OrthographicCamera` with `camera.up = (0, 0, −1)` so that plan `+y` (world `+z`) points down the screen like 2D. CameraControls polar fixed at 0 (`minPolarAngle = maxPolarAngle = 0`), azimuth fixed at 0 (`minAzimuthAngle = maxAzimuthAngle = 0`), dolly changes `zoom`. Mouse left/one finger = truck.

#### 5.8.3 Walk (first person) — only when `features.walkthrough_camera`
- Eye height 1600 mm; start position: the selected room's `labelPoint`, else the largest room's `labelPoint`, else bbox centre; looking toward the bbox centre (or +x if equal).
- Desktop: `PointerLockControls` (`three/examples/jsm/controls/PointerLockControls.js`); click on the canvas locks the pointer; WASD / arrow keys move at 1.4 m/s (Shift 3 m/s); mouse look; Esc releases the lock (stays in walk mode, overlay `plan_editor.walk.click_to_look`); `C` or the camera menu leaves walk mode.
- Touch: virtual joystick (`walkControls.ts`): bottom-left circle radius 56 px centred 88 px from the left and bottom edges, dead zone 8 px, speed proportional to deflection up to 1.4 m/s; dragging anywhere on the right half rotates the view (0.25°/px yaw, pitch clamped ±80°).
- **Collision: on** (decision: walking through walls is disorienting and the cost is small). Body = circle radius 250 mm in plan space. Collision segments = all wall outline edges except the face edges spanning `[u0, u1]` of openings with `kind ∈ {door, opening}` or `type === 'french_window'` (passable); indexed with Flatbush. Per frame: apply the desired move, then 3 iterations of: for every segment within 1 m, if distance < 250 mm push the centre out along the segment normal by the penetration. A toggle `plan_editor.walk.ghost` ("Walk through walls") in the camera menu disables collision for the session.
- Walk mode is view-only: no picking/editing; tool shortcuts are disabled while walk mode is active (WASD would conflict).

#### 5.8.4 Transitions
Switching orbit ↔ top: animate the perspective camera to look straight down at the current target (`rotatePolarTo(0, true)`), then swap to the orthographic camera with `zoom` such that the visible height matches (`zoom = viewportHeightPx / (2 · distance · tan(fov/2) · pxPerMetre)`), and back in reverse. Orbit → walk: `setLookAt(eye, lookTarget, true)` then enable walk controls on rest. All transitions are instant when `prefers-reduced-motion: reduce`.

`camera3d` in the store is updated on camera-controls `rest`/`sleep` events and written into `doc.view.mode3d` at save time.

### 5.9 Wall display modes (`cutaway.ts`)

| Mode | Behaviour |
|---|---|
| `full` | all walls at their height |
| `low` | every wall built with displayed height `min(H, 1200)`; openings clipped to it |
| `cutaway` (default) | walls that obstruct the view are built as 200 mm stubs (`min(H, 200)`), the others full |

Obstruction rule (recomputed on camera `rest` and throttled to 150 ms while moving; only walls whose state changes are rebuilt; both geometries are cached per wall): let `c` = camera position projected to plan (mm) and `g` = orbit target projected to plan. A wall obstructs if (a) the segment `c→g` intersects the wall's outline, or (b) `exteriorSide !== null` and the outward normal (`exteriorSide === 'left' ? n : −n`) satisfies `dot(outward, normalize(c − mid)) > 0.25`, where `mid` is the centre-line midpoint. In `top` camera mode every mode behaves as `full` (nothing obstructs a top view); in `walk` mode walls are always `full`.

### 5.10 Picking and hover (`picking.ts`)

- `three-mesh-bvh`: `BufferGeometry.prototype.computeBoundsTree = computeBoundsTree`, `disposeBoundsTree`, `Mesh.prototype.raycast = acceleratedRaycast` (patched once in the 3D chunk). Bounds trees are computed lazily on the first raycast against a geometry. `raycaster.firstHitOnly = true`.
- Pickable: walls (`w_`), node caps (→ their first wall), openings (`o_`), floors (`r_` meta id or `face:{faceKey}`), placements (`f_`), fixtures (`x_`). Not pickable: slab, ground, shadows, helpers.
- **Click** = pointer up within 4 px (mouse/pen) or 10 px (touch) of pointer down and within 500 ms → raycast → select (Shift toggles) or clear selection on miss.
- **Hover** (mouse/pen): raycast at most once per frame on pointer move when no button is pressed → `hoverId`; cursor `pointer` over pickables.
- **Highlight:** selected and hovered meshes get an outline built from `EdgesGeometry(geometry, 30)` + `LineSegments(LineBasicMaterial({ color: primary, depthTest: false, transparent: true, opacity: selected ? 0.95 : 0.5 }))`, `renderOrder 999`; created on demand and disposed when deselected.

### 5.11 Editing in 3D (same commands as 2D)

| Interaction | Behaviour |
|---|---|
| Move furniture / fixture | Select → a floating mini-toolbar above the object (Move / Rotate / Delete / Edit design) and `TransformControls` (`three/examples/jsm/controls/TransformControls.js`; add `controls.getHelper()` to `helpers`) attached to a proxy `Object3D` at the footprint centre. **Move**: `showY = false` (floor plane only); on `objectChange` compute the back centre (`centre − f·D/2`), run `snapFootprint` (zoom equivalent = pixels per mm at the object's distance), `exec('movePlacement' | 'moveFixture', …, { merge: true, silent: true })`, then re-sync the proxy to the snapped result. **Rotate**: `showX = showZ = false`, `rotationSnap = 15°` (`null` while Shift is held); command `rotatePlacement { pivot: 'center' }` / `moveFixture { rotation }`. `dragging-changed` disables camera-controls during the drag and seals on release. |
| Move wall | Pointer down on the **selected** wall below its top band → drag: intersect the ray with the horizontal plane `y = hit.y`; `distance = dot(hitPlan − startPlan, n)` → `moveWall { finalize: false }` merged; release → `moveWall { finalize: true }` merged + seal. |
| Change wall height | Hovering the top 150 mm band of the selected wall shows `ns-resize`; drag: intersect the ray with the vertical plane through the centre line (normal `n`); `height = round(y·1000)` snapped to 50 mm (Alt: 10 mm), clamped to `[max(300, highest opening top), 10000]` → `setWallProps { height }` merged; seal on release. |
| Move opening | Drag a selected opening: ray ∩ wall's vertical plane → `u` → `snapOpeningPosition` with `preferredWallId` → `moveOpening` merged. |
| Add door/window/opening | Opening tool active in 3D: hovering a wall face shows a ghost box (opening size, thickness + 20 mm, green; red if invalid) at the snapped `u`; click → `addOpening` with `swing = (hit face normal · n > 0 ? 'left' : 'right')`, `hinge 'start'`. |
| Place furniture / fixture | Furniture/Fixture tool active in 3D: ghost box follows the floor hit point (`y = 0` plane), snapped with `snapFootprint`; wall-mounted designs (`mounting 'wall' | 'loft'`) prefer wall faces; click places. |
| Nodes, wall drawing, rooms, dimensions, text, measure, background | 2D only; activating these tools switches to 2D (§6.3). |

Keyboard in 3D: Delete, Esc, Ctrl/Cmd+Z/Y, `[`/`]` rotation and arrow nudges act on the selection exactly as in 2D (nudges in plan axes).

### 5.12 Acceptance criteria — 3D

- [ ] A wall with a door (sill 0) and a window renders with a notch and a hole, mitered ends with no visible gap at L, T and X junctions (screenshot tests at 4 camera angles).
- [ ] Room floors are visible from above and invisible from below (backface).
- [ ] A placement with rotation 90° in 2D faces −x in 3D (front of the furniture model points to world −x), matching the 2D front triangle.
- [ ] In cutaway mode, orbiting to the south side lowers the south exterior walls and restores them when orbiting away.
- [ ] Walk mode: walking into a wall stops at 250 mm from its face; walking through a door opening succeeds.
- [ ] Moving furniture with the gizmo snaps it flush against a wall face and sets `wallAttachment`; the 2D view shows the same position after switching.
- [ ] Changing a wall's height by dragging its top updates the properties panel live and undo reverts it in one step.
- [ ] No frames are rendered while the camera is idle and nothing changes (renderer `info.render.frame` constant over 2 s).

---

## 6. 2D ↔ 3D switching

### 6.1 Principles
One store, one document, one selection, one command bus; **no conversion step**. Both views render from `doc` + `geometry`. After the 3D view has been opened once, both views stay mounted (`v-show`) and the inactive one is paused.

### 6.2 Camera framing sync (always on switch)
- **2D → 3D:** orbit target = `(centerX/1000, 0, centerY/1000)`; distance chosen so that the visible plan width in 3D (`2 · d · tan(fov/2) · aspect` at the target, adjusted for polar 55°) equals the 2D visible width `widthPx / zoom` mm; azimuth/polar keep their last 3D values (default 30° / 55°). If the 3D camera is `top`, set the ortho zoom so that the scale matches exactly.
- **3D → 2D:** `centerX/Y` = orbit target projected to plan; zoom = `widthPx / visibleWidthMm` from the current camera distance (top camera: exact from ortho zoom). Walk mode → 2D centres on the eye position at the current zoom.
- With `prefers-reduced-motion` the 3D camera jumps; otherwise camera-controls animates for ≤ 300 ms (the switch is complete when the first frame is rendered, not when the animation ends).

### 6.3 Tools and selection
Selection, hover and the active tool are preserved. If the active tool does not support 3D (`supports3d = false`: wall, room, dimension, text, measure, background, pan) the tool switches to Select when entering 3D; pressing such a tool's shortcut (or clicking it) while in 3D switches to 2D first, then activates the tool.

### 6.4 Performance target
- First switch on a 100-wall plan with 20 placements: ≤ 500 ms from click to first 3D frame (chunk prefetched; scene build ≤ 250 ms; furniture models stream in afterwards as placeholders resolve).
- Subsequent switches: ≤ 150 ms.
- Measured with `performance.mark('plan:switch:start')` / `performance.mark('plan:switch:frame')` (first `renderer.render` after the switch) and reported in dev builds to the console.

### 6.5 Acceptance criteria — switching
- [ ] Zooming into a bedroom in 2D and pressing `3` shows the same bedroom centred in 3D; orbiting and pressing `2` centres 2D on the orbit target.
- [ ] A selection made in 3D is selected in 2D and vice versa; undo history is shared.
- [ ] Unsaved changes and autosave status are unaffected by switching.

---

## 7. Tools (`tools/`)

### 7.1 Framework

```ts
export interface ToolPointerEvent {
  model: Vec2; screen: Vec2;              // model mm (float), screen px relative to the canvas
  button: number; buttons: number; pointerType: 'mouse' | 'pen' | 'touch'; pointerId: number;
  shift: boolean; alt: boolean; mod: boolean;   // mod = Ctrl (Win/Linux) or Cmd (macOS)
  timeStamp: number; clickCount: number;
}
export interface ToolContext { store: PlanEditorStore; t: (k: string, p?: object) => string; snap(input: Partial<SnapInput>): SnapResult; hit(p: Vec2): Hit[]; setCursor(c: string): void }
export interface PlanTool {
  id: ToolId | `ext:${string}`;               // extension tools (§15.4) use the 'ext:' prefix
  supports3d: boolean;
  phase: Ref<string>;                         // state-machine state, shown in the status hint
  preview: ShallowRef<ToolPreview | null>;    // rendered by ToolPreviewLayer (2D) / ghost meshes (3D)
  hintKey: ComputedRef<string>;               // plan_editor.hints.<tool>.<phase>
  activate(ctx: ToolContext, options?: unknown): void;
  deactivate(ctx: ToolContext): void;         // must cancel in-progress actions and seal
  onPointerDown(e: ToolPointerEvent, ctx: ToolContext): void;
  onPointerMove(e: ToolPointerEvent, ctx: ToolContext): void;
  onPointerUp(e: ToolPointerEvent, ctx: ToolContext): void;
  onDoubleClick?(e: ToolPointerEvent, ctx: ToolContext): void;
  onKeyDown(e: KeyboardEvent, ctx: ToolContext): boolean;   // true = consumed (global shortcuts skipped)
  onCancel(ctx: ToolContext): void;           // Esc, second finger landing, mode switch
}
```

Rules for every tool:
- A "click" is pointer down + up within 4 px (mouse/pen) / 10 px (touch) and 500 ms; a "drag" starts when movement exceeds that threshold.
- All tools call `snapPoint` / `snapFootprint` / `snapOpeningPosition` with `pointerType`, `zoom`, modifiers and `settings` from `view` (`04` §5). `Alt` disables snapping, `Shift` = 45° lock where an origin exists.
- Drags execute commands with `{ merge: true, silent: true }` and call `seal()` on pointer up; Esc during a drag undoes the merged entry (`store.undo()` if the top entry is the drag's entry) and returns to the previous phase.
- Esc in a tool's idle phase activates the Select tool (Select's idle Esc clears the selection).
- Cursors: Select `default` (`move` over a draggable selected entity, handle-specific cursors over handles), Pan `grab`/`grabbing`, Wall/Room/Dimension/Measure/Background-calibrate `crosshair`, Door/Window/Opening `crosshair`, Furniture/Fixture `copy`, Text `text`.
- Touch loupe (§7.13) is shown during touch drags in Wall, Room, Dimension, Measure and Background-calibrate.

### 7.2 Select tool (`V`)

| Phase | Event | Action → next phase |
|---|---|---|
| `idle` | down on handle | start handle drag → `dragHandle` |
| `idle` | down on entity (hit) | if not selected: select (Shift toggles, else replace); remember hit → `pressEntity` |
| `idle` | down on room or empty (mouse/pen) | → `pressEmpty` |
| `idle` | down on room or empty (touch) | start long-press timer 500 ms → `pressEmptyTouch` |
| `pressEntity` | drag | body drag by kind (below) → `dragEntity` |
| `pressEntity` | up (click) | Alt+click: cycle to the next hit at that point; double-click: room → focus name field, label → inline text edit, dimension text → inline length edit → `idle` |
| `pressEmpty` | drag | marquee → `marquee` |
| `pressEmpty` | up (click) | room hit → select room; else clear selection (unless Shift) → `idle` |
| `pressEmptyTouch` | drag before 500 ms | pan the view (one-finger pan) → `panning` |
| `pressEmptyTouch` | 500 ms elapsed without move | haptic `navigator.vibrate?.(10)`, ring feedback → `longPressed` |
| `longPressed` | drag | marquee → `marquee` |
| `longPressed` | up | open context menu at the point (§12.4) → `idle` |
| `marquee` | move | rectangle preview; left→right = window, right→left = crossing |
| `marquee` | up | `hitTestRect` → replace selection (Shift adds) → `idle` |
| `dragEntity` / `dragHandle` | move | merged command (below) |
| `dragEntity` / `dragHandle` | up | final command with `finalize: true` where applicable, seal → `idle` |

Body drag by kind: node → `moveNode` (snap excluding the node and its walls); wall → `moveWall` with `distance = dot(snapped − press, n)` where `snapped = snapPoint({ cursor, origin: null, exclude: {wall, its nodes} })` (so the wall can snap onto other nodes/walls), rounded to 10 mm when the snap kind is `none` or `grid`; opening → `moveOpening` (with `snapOpeningPosition`, may change wall); placement → `movePlacement` (`snapFootprint`); fixture → `moveFixture` (`snapFootprint`); label → `setLabel { position }`; dimension → `setDimension { offset }`; multi-selection (≥ 2 movable entities) → `translateEntities` (snap the press point's displacement with `snapPoint` using the primary entity's reference point); background (when the Background tool is not active, the background is not draggable).

Keyboard (when the canvas or a non-input element has focus): Delete/Backspace → `deleteEntities(selection)`; arrows → `nudgeEntities { ids, dx, dy }` 10 mm (Shift 100, Alt 1) with `merge: true` (compose mode, `04` §6.6; sealed 800 ms after the last nudge, §3.4); `[` / `]` → rotate selected placements/fixtures/labels by −15°/+15° (Shift: ±90°); Enter → focus the first field of the properties panel; Esc → clear selection.

### 7.3 Wall tool (`W`)

Options (shown in a compact options bar at the top-left of the canvas and in the properties panel when nothing is selected): **Preset** — Exterior (`defaults.exteriorWallThicknessMm`, kind exterior, brick), Interior (`doc.meta.defaultWallThickness`, interior, brick), Partition (75 mm, partition, drywall), Half wall (115 mm, half, brick, height 1000), Custom; **Thickness** (LengthInput), **Height** (LengthInput, default `meta.defaultWallHeight`). Last used preset persists per device.

| Phase | Event | Action |
|---|---|---|
| `idle` | move | snap marker preview |
| `idle` | click at snapped `S` | `start = S.nodeId ? { nodeId } : { point: S.point }`; `chainFirst = start`; `segments = 0` → `drawing` |
| `drawing` | move | preview: ghost rectangle of the current thickness from start to the snapped cursor (`origin = start point`, `previousDir` = last segment direction), length/direction pill; invalid (< 10 mm) in grey |
| `drawing` | click at `P` | `exec('addWall', { from: start, to: P.nodeId ? { nodeId } : { point }, ...preset })`; success → `start = { nodeId: result.endNodeId }`, `segments++`; if `P` is `chainFirst`'s node and `segments ≥ 2` → `idle` (closed loop) |
| `drawing` | double-click | end chain (the preceding click already added the last segment) → `idle` |
| `drawing` | Enter / Esc | end chain → `idle` (Esc in `idle` → Select tool) |
| `drawing` | Backspace | if the top history entry is this chain's last `addWall`: `undo()`, `segments--`, `start` = that wall's start node; if `segments === 0` → `idle` |
| `drawing` | typing `0-9 . , ' "` | open `DrawInput` (below) with the typed character |
| `drawing` (touch) | press-drag-release | segment from `start` to the release point; a press farther than 16 px from the current start begins a new chain at the press point |

`DrawInput.vue`: floating panel 16 px below-right of the cursor (kept inside the viewport) with fields **Length** (LengthInput, focused, prefilled with the typed character) and **Direction** (AngleInput, degrees, CCW from east, `04` §2.1-10; prefilled with the current snapped direction). `Tab`/`Shift+Tab` switches fields; `Enter` → end point `= start + dir · length` where `dir` comes from the Direction field (if edited) else the current cursor direction → `addWall` → the input stays open (empty) for the next segment; `Esc` closes the input without ending the chain. Touch: a "Type length" button in the floating tool bar opens the same panel.

Touch floating bar (bottom centre, while drawing): **Undo segment**, **Type length**, **Done**.

### 7.4 Room tool (`R`)

Options: same presets as the Wall tool (default Interior).

| Phase | Event | Action |
|---|---|---|
| `idle` | down (or click) at snapped `C1` | → `sizing` |
| `sizing` | move | preview of 4 ghost walls for the rectangle `C1`–cursor (Shift = square), labels `W × D` (`formatLength`); invalid if a side < 300 mm |
| `sizing` | up after drag / second click | `exec('addWallChain', { points: [c1, (c2.x, c1.y), c2, (c1.x, c2.y)], closed: true, ...preset })` → find the new room containing the rectangle centre in the new geometry → select it (`face:{faceKey}` or meta) → open/focus the properties **Name** field → `idle` (tool stays active) |
| `sizing` | typing digits | `DrawInput` in room mode: **Width** and **Depth** fields (also accepts `3600 x 3000`, `12'x10'`, separators `x`, `×`, `*`, `by` in the Width field, split and parsed with `parseLength`); Enter creates the rectangle extending from `C1` toward the cursor's quadrant |
| `sizing` | Esc | cancel → `idle` |

Walls coinciding with existing walls are deduplicated by the engine (`04` §6.5 `insertWallSegment`), so rooms drawn side by side share walls.

### 7.5 Door (`D`), Window (`N`), Opening (`O`) tools — `OpeningTool` with `kind`

Options: **Type** (door: single_swing, double_swing, sliding, pocket, bifold, main_entrance; window: casement, sliding_window, fixed, french_window, bay, ventilator); **Width** preset chips (door 750 / 800 / 900 / 1000 / 1200 (double); window 600 / 900 / 1200 / 1500 / 1800; opening 900 / 1200 / 1500) + custom LengthInput; **Height**; **Sill** (windows). Defaults from `PlanDefaults` (§1.3; `02` §13 `units`).

| Phase | Event | Action |
|---|---|---|
| `idle` | move | `snapOpeningPosition` → ghost symbol (engine `drawOpening` on a temporary opening) on the wall; red + `reasonKey` text if invalid; swing side follows the cursor side unless locked |
| `idle` | Shift+F / Shift+H | toggle swing lock (flip) / hinge |
| `idle` | click on a valid ghost | `exec('addOpening', …, { select: 'created' })`; tool stays active |
| `idle` | click on no wall | toast `plan_editor.hints.opening.click_wall` |
| touch | drag | ghost follows; release places if valid |

### 7.6 Furniture tool (`F`)

Opens DesignPickerPanel (§10.1). Phases: `picking` (panel open, nothing attached) → choose a design → `placing { designId, rotation }` → ghost footprint (engine `drawPlacement` on a temporary placement; back centre = cursor − `f·D/2` so the footprint centre follows the pointer), `snapFootprint`; `[`/`]` rotate the ghost ±15° (Shift ±90°); click → `exec('addPlacement', { designId, x, y, rotation, elevation: defaultElevation(design, attachment), wallAttachment }, { select: 'created' })` → Select tool. Esc in `placing` → `picking`; Esc in `picking` → Select tool and close the panel. Dragging a design card onto the canvas (pointer drag, desktop and touch) is equivalent to choose + place at the drop point.

### 7.7 Fixture tool (`X`)

Opens FixtureLibraryPanel (§9.3). Same phases as Furniture, using `fixtureFootprint` and `addFixture`; after placement the tool **stays** in `placing` with the same key (fixtures such as chairs are placed repeatedly); Esc → `picking`; Esc again → Select tool.

### 7.8 Dimension tool (`Shift+D`)

Snapping includes `on_face`. `idle` → click A → `pickB` → click B (≥ 10 mm from A) → `pickOffset` (offset = signed distance of the cursor from line AB along `perpLeft(normalize(B − A))`, snapped to 50 mm) → click → `addDimension { a, b, offset, attachedTo }` where `attachedTo = { wallId, face }` if A and B snapped to the two ends of the same face of the same wall (`face` = that side) or to both centre-line ends (`face: 'center'`), else `null` → `idle`. Esc steps back one phase.

### 7.9 Text tool (`T`)

Click → an HTML input (single line, max 200 chars, model-size font preview) at the point → Enter → `addLabel { position, text }` → Select tool with the label selected; Esc or empty Enter cancels.

### 7.10 Measure tool (`M`)

Not stored. Clicks add points (snapping incl. `on_face`); the preview shows each segment length, the running total and the angle at each interior vertex; the status bar shows the total. Double-click/Enter finishes the polyline (kept visible until the next click starts a new one); Esc clears; Backspace removes the last point. Leaving the tool clears the measurement.

### 7.11 Pan tool (`H`)

Drag pans; Space-drag and two-finger gestures pan in every tool.

### 7.12 Background tool (`B`)

Opens the Background flyout: **Upload / Replace** (navigates, after flushing autosave, to the import page of `10` §9.1 targeting this plan, where the customer picks auto or trace mode; when the plan already has walls a confirm dialog first warns `plan_editor.background.replace_warning` "Accepting a new blueprint replaces this floor's drawing. Save a checkpoint first?" with **Save checkpoint and continue** / **Continue** / **Cancel**, because `06` replaces the plan content on accept); **Calibrate**; **Opacity** slider 0–100 % (`setBackgroundProps`, merged); **Rotation** AngleInput (about the image centre); **Visible**, **Locked** toggles; **Remove** (confirm dialog). The flyout is disabled with a hint when there is no background (except Upload).

Calibrate phases: `p1` (click a point; snapping only to existing nodes) → `p2` → CalibrateDialog: **Real distance** LengthInput (required, ≥ 100 mm) + checkbox **Also scale existing drawing** (default checked when the plan has walls, else unchecked) → `calibrateBackground { space: 'plan', p1, p2, realDistance, scaleGeometry }` (`04` §6.6; `06`'s review uses the `space: 'image'` variant) → toast `plan_editor.background.calibrated` with the factor. Move: with the image unlocked, dragging inside it moves it (`setBackgroundProps { position }` merged); rotate handle per §4.10.

### 7.13 Touch loupe (`Loupe.vue`)

During touch drags in the tools listed in §7.1: a circle of 120 px diameter, centred 100 px above the touch point (below it when the touch is within 140 px of the top edge), with a 2× magnified view (`<svg>` with a viewBox of 60 × 60 screen px around the snapped point containing `<use href="#plan-content-root">`) and a crosshair at the snapped point.

### 7.14 Clipboard (`store/clipboard.ts`)

- **Copy** (Ctrl/Cmd+C): build a `PlanFragment` (`04` §6.6) from the selection: selected walls with their nodes and openings, placements, fixtures, labels, unattached dimensions, attached dimensions whose wall is copied, and RoomMetas of selected rooms whose walls are all copied. Keep it in module memory and write `'furny-plan-fragment:v1:' + JSON.stringify({ projectId, fragment })` with `navigator.clipboard.writeText` (best effort, errors ignored).
- **Paste** (Ctrl/Cmd+V): use the in-memory fragment, else try `navigator.clipboard.readText()` and parse the prefix. Offset: if the pointer is over the canvas, the fragment bbox centre goes to the pointer; else `(+500, +500)`. Placements whose `designId` is not in `designs` (other project) are removed before inserting, with a toast `plan_editor.clipboard.placements_skipped`. `exec('insertFragment', …, { select: 'created' })`.
- **Cut** = copy + `deleteEntities`; **Duplicate** (Ctrl/Cmd+D) = copy + paste with `(+500, +500)` as one command.

### 7.15 Acceptance criteria — tools

- [ ] Drawing a 4-segment closed chain with clicks creates 4 walls and 1 room; Backspace during drawing removes only the last segment.
- [ ] Typing `3.2m` Enter while drawing creates a 3200 mm wall along the current direction; typing `3600` Tab `90` Enter creates a 3600 mm wall pointing up the screen.
- [ ] The Room tool creates a rectangle room whose name field is focused; a second room drawn sharing one side creates 7 walls total, not 8.
- [ ] The Door tool places a door centred under the cursor; a click where the door does not fit shows the reason and creates nothing.
- [ ] Furniture placed near a wall attaches to it; Esc during a drag restores the pre-drag position.
- [ ] Every tool works with touch only (Playwright with `hasTouch`), including marquee via long-press-drag.
- [ ] Copy/paste of a room (4 walls + door) into empty space creates an independent room with a new door; pasting over an existing wall joins/splits correctly.

---

## 8. Properties panel (`PropertiesPanel.vue`, `panels/props/*`)

### 8.1 Inputs

- **`LengthInput.vue`** — props `{ modelValue: number | null (mm); min?: number; max?: number; allowNegative?: boolean; mixed?: boolean; disabled?: boolean; label: string }`; emits `commit(mm)`. Displays `formatLength(value, unitPrefs)`; on focus selects all; on Enter/blur parses with `parseLength(text, { unit: userUnit, min, max, allowNegative })`; on error shows `t(error.messageKey, { ...params, min: formatLength(min), max: formatLength(max) })` below (red, `aria-invalid`, `aria-describedby`) and keeps focus; Esc reverts. ArrowUp/ArrowDown step ±10 mm (Shift ±100, Alt ±1) and commit immediately (merged under one history entry via the field's merge key). `mixed` shows placeholder `plan_editor.props.mixed` and empty text. If the parse result is `rounded`, a small hint shows the normalised value for 2 s.
- **`AngleInput.vue`** — degrees, accepts `45`, `45°`, `-15` (normalised to [0, 360)), 0.01° precision; ArrowUp/Down ±1° (Shift ±15°).
- **`ColorSwatchInput.vue`** — 12 swatches + "Default" (null) + custom hex input (`^#[0-9a-fA-F]{6}$`).
- Selects use reka-ui `Select` with translated option labels; toggles use `Switch`.
- Every field commits a command on change; a failed command shows the error under the field and reverts the displayed value.

### 8.2 Panels by selection

| Selection | Fields (→ command) | Read-only info | Actions |
|---|---|---|---|
| Nothing | Default wall height, Default wall thickness, Floor thickness, North angle (toggle + AngleInput) (→ `setPlanMeta`); the plan name is the page title (renamed on the project page, `10`) | walls, rooms, total area (`formatArea`), background summary | Show plan outline |
| Room | Name (≤ 80; when the current type is `other`, committing a name also sets `type = suggestRoomType(name)` from `engine/plan/roomNames.ts` in the same command), Type (19 `RoomType`s, labels `plan_editor.room_type.<type>`), Floor finish, Floor colour, Show area (→ `setRoomMeta`) | Area, Perimeter, Size (if `netRect`) | Reset label position; Select walls of this room |
| Wall | Length (→ `setWallLength auto`), Thickness, Height, Kind, Material, Interior colour (→ `setWallProps`) | Direction (`displayDeg`), openings count, rooms on each side | Split in middle (`splitWall at L/2`), Add door / Add window (activates the tool with `preferredWallId`), Delete |
| Node | X, Y (→ `moveNode finalize`) | connected walls | Merge walls (if `mergeCollinearWalls` is valid), Delete node |
| Opening | Kind (segmented), Type, Width (→ `resizeOpening keep center`), Height, Sill (windows), Distance from start (`u0` → `moveOpening`), Distance from end, Hinge (start/end), Swing (left/right), Label (≤ 16) | wall | Flip swing, Flip hinge, Delete |
| Placement | X, Y (→ `movePlacement`, keeps attachment only if still flush), Rotation (→ `rotatePlacement pivot center`), Elevation, Mirrored (→ `setPlacementProps`) | thumbnail, design name, W × H × D, room (room containing the footprint centre), wall attachment status, conflicts | Edit design / View design (§10.3), Detach from wall, Delete |
| Fixture | Type (→ `setFixtureProps libraryKey`), Width, Depth, Height, Elevation, Rotation, Label | — | Reset to default size, Delete |
| Dimension | Offset (→ `setDimension`); attached: Length (→ `setWallLength`) | measured length, attachment | Detach (→ `setDimension { attachedTo: null }`), Delete |
| Text label | Text (≤ 200), Font size (LengthInput; model mm), Rotation (→ `setLabel`) | — | Delete |
| Background | as Background flyout (§7.12) | pixel size, scale (mm/px) | Calibrate, Remove |
| Multiple | Header `t('plan_editor.props.multi', { count })` with per-kind counts; common fields when all items share a kind: walls → Thickness, Height, Kind, Material, Colour; openings → Height, Sill, Type; placements → Elevation, Mirrored; fixtures → Elevation, Height (mixed values show "Mixed") | — | Delete all |

Read-only mode renders the same panels with every input `disabled` and actions hidden (inspection still works).

### 8.3 Acceptance criteria — properties

- [ ] Typing `9'` in a wall's Thickness field shows `out_of_range` (2743 mm > 1000) and does not change the wall.
- [ ] Changing a window's height so that `sill + height > wall height` shows `opening_too_tall` under the field.
- [ ] Multi-selecting 3 walls with thickness 115, 115, 230 shows "Mixed"; entering `150` sets all three in one history entry.
- [ ] All panels are fully operable with keyboard only (Tab order top-to-bottom, Enter commits, Esc reverts).

---

## 9. Fixture library (normative for `03` §1 `Fixture.libraryKey`)

### 9.1 Data model (`resources/js/engine/plan/fixtures.ts` — engine, pure data + small builder functions)

```ts
export const FIXTURE_KEYS = [ /* the 35 keys of §9.4, in table order */ ] as const;
export type FixtureKey = typeof FIXTURE_KEYS[number];        // used by PlanDocumentSchema (z.enum(FIXTURE_KEYS))
export type FixtureCategory = 'bedroom' | 'living' | 'dining' | 'study' | 'kitchen' | 'bathroom' | 'utility' | 'structure' | 'outdoor';
export type FixtureMaterialKey = 'wood' | 'fabric' | 'mattress' | 'pillow' | 'white' | 'ceramic' | 'metal' | 'dark' | 'stone' | 'glass' | 'plant' | 'rug' | 'paint' | 'water';

// Normalised fixture space: x ∈ [−0.5, 0.5] across the width (left → right seen from the front),
// y ∈ [0, 1] from back (0) to front (1), z ∈ [0, 1] up (fractions of height). Values slightly outside (≤ 1.05) are allowed for decals.
export type Fixture2DItem =
  | { t: 'rect'; x0: number; x1: number; y0: number; y1: number; detail?: boolean; dashed?: boolean; fill?: string }
  | { t: 'ellipse'; cx: number; cy: number; rx: number; ry: number; detail?: boolean }
  | { t: 'line'; x0: number; y0: number; x1: number; y1: number; detail?: boolean; dashed?: boolean }
  | { t: 'polyline'; pts: Array<[number, number]>; closed: boolean; detail?: boolean };
export interface FixturePrimitive { shape: 'box' | 'cylinder' | 'sphere'; x: [number, number]; y: [number, number]; z: [number, number]; mat: FixtureMaterialKey }

export interface FixtureDef {
  key: FixtureKey; category: FixtureCategory;
  nameKey: string;                       // 'plan_editor.fixtures.<key>'
  width: number; depth: number; height: number; elevation: number;   // defaults (mm)
  noConflict: boolean;                   // 04 §5.9
  symbol2d(w: number, d: number): Fixture2DItem[];
  primitives3d(w: number, d: number, h: number): FixturePrimitive[];
}
export const FIXTURE_LIBRARY: Record<FixtureKey, FixtureDef>;
```

`drawFixture` (`04` §8) maps normalised 2D items to plan space through the fixture footprint (`fixtureFootprint`, centre origin, rotation): non-`detail` items use style `fixture`, `detail` items `fixture_detail`; ellipses become 24-segment polygons; `fill` overrides the fill colour. The 3D builder (§5.6) maps primitives as specified there. Every fixture is resizable (width, depth, height) in the properties panel; primitives scale with it except where a builder function uses absolute mm (L-shapes below).

### 9.2 Material palette (3D)

| Key | Colour | Roughness | Notes |
|---|---|---|---|
| wood | `#A47551` | 0.7 | |
| fabric | `#9C968D` | 0.95 | |
| mattress | `#ECEAE4` | 0.9 | |
| pillow | `#FFFFFF` | 0.9 | |
| white | `#F2F2EF` | 0.4 | appliances |
| ceramic | `#FAFAFA` | 0.25 | |
| metal | `#B9BDC2` | 0.35 | metalness 0.6 |
| dark | `#3A3A3A` | 0.5 | |
| stone | `#8E8A84` | 0.5 | counter tops |
| glass | shared glass material (§5.7) | | |
| plant | `#5E8C4A` | 0.9 | |
| rug | `#C8B59A` | 1.0 | |
| paint | `#E8E4DC` | 0.9 | columns |
| water | `#CFE3F2` | 0.1 | opacity 0.7 |

### 9.3 Fixture library panel (`FixtureLibraryPanel.vue`)

Category tabs (`plan_editor.fixture_category.<category>`; first tab "All"), a search box (matches translated names, case/diacritic-insensitive), and a grid of 88 × 88 px cards each showing a mini SVG of the symbol (default size, fitted) and the translated name. Cards are buttons (`aria-label` = name + default size); Enter/click starts placement (§7.7); cards are draggable onto the canvas. The last 6 used keys are shown in a "Recent" row (per device, `fs:plan-editor:recent-fixtures`).

### 9.4 Library (35 entries)

Notation (normalised coordinates of §9.1): 2D `R(x0,x1,y0,y1)` rect, `E(cx,cy,rx,ry)` ellipse, `L(x0,y0,x1,y1)` line, `P[…]` polyline; items after the first are `detail` unless stated. 3D `B(x0,x1, y0,y1, z0,z1, mat)` box, `C(…)` vertical cylinder inscribed in that box, `S(…)` sphere inscribed. "Legs(t, z1, mat)" = four boxes of `t × t` mm at the footprint corners from z 0 to z1.

| Key | Cat. | W × D × H (mm) | Elev. | 2D symbol | 3D primitives |
|---|---|---|---|---|---|
| `bed_single` | bedroom | 900 × 1900 × 900 | 0 | R(−.5,.5,0,1); R(−.5,.5,0,.04); R(−.4,.4,.05,.16); L(−.5,.38,.5,.38) | B(−.5,.5,.03,1,0,.28,wood); B(−.48,.48,.04,.99,.28,.5,mattress); B(−.5,.5,0,.03,0,1,wood); B(−.4,.4,.05,.16,.5,.58,pillow); B(−.49,.49,.38,.99,.5,.52,fabric) |
| `bed_double` | bedroom | 1400 × 1900 × 900 | 0 | as single but pillows R(−.45,−.03,.05,.16), R(.03,.45,.05,.16) | as single with the two pillows |
| `bed_queen` | bedroom | 1500 × 2000 × 900 | 0 | as `bed_double` | as `bed_double` |
| `bed_king` | bedroom | 1800 × 2000 × 900 | 0 | as `bed_double` | as `bed_double` |
| `bedside_table` | bedroom | 450 × 400 × 550 | 0 | R(−.5,.5,0,1); L(−.5,.3,.5,.3) | B(−.5,.5,0,1,0,1,wood) |
| `wardrobe_generic` | bedroom | 1200 × 600 × 2100 | 0 | R(−.5,.5,0,1); L(−.45,.5,.45,.5) dashed (rod); L(0,.93,0,1) | B(−.5,.5,0,1,0,1,wood) |
| `dresser` | bedroom | 1000 × 450 × 800 | 0 | R(−.5,.5,0,1); L(−.5,.85,.5,.85) | B(−.5,.5,0,1,0,1,wood) |
| `sofa_2` | living | 1500 × 850 × 800 | 0 | R(−.5,.5,0,1) (outline); R(−.5,.5,0,.22); R(−.5,−.38,.22,1); R(.38,.5,.22,1); R(−.38,0,.22,.95); R(0,.38,.22,.95) | B(−.5,.5,0,.22,0,1,fabric); B(−.5,−.38,.22,1,0,.7,fabric); B(.38,.5,.22,1,0,.7,fabric); B(−.38,.38,.22,.98,0,.5,fabric) |
| `sofa_3` | living | 2100 × 900 × 800 | 0 | as `sofa_2` with cushions R(−.38,−.127,.22,.95), R(−.127,.127,.22,.95), R(.127,.38,.22,.95) | as `sofa_2` |
| `sofa_l` | living | 2400 × 1600 × 800 | 0 | `s = min(900, 0.6·min(W,D))`, `b = 0.22·s`; fractions `sx=s/W, sy=s/D, bx=b/W, by=b/D`. Outline P[(−.5,0),(.5,0),(.5,sy),(−.5+sx,sy),(−.5+sx,1),(−.5,1)] closed; backs R(−.5,.5,0,by), R(−.5,−.5+bx,by,1); seats R(−.5+bx,.5−bx,by,sy), R(−.5+bx,−.5+sx,sy,1); arm R(.5−bx,.5,by,sy) | backs B(−.5,.5,0,by,0,1,fabric), B(−.5,−.5+bx,by,1,0,1,fabric); seats B(−.5+bx,.5−bx,by,sy,0,.5,fabric), B(−.5+bx,−.5+sx,sy,1,0,.5,fabric); arm B(.5−bx,.5,by,sy,0,.7,fabric). Mirror image: set width ↔ depth and rotate 90°. |
| `armchair` | living | 800 × 800 × 800 | 0 | R(−.5,.5,0,1); R(−.5,.5,0,.22); R(−.5,−.36,.22,1); R(.36,.5,.22,1); R(−.36,.36,.22,.95) | B(−.5,.5,0,.22,0,1,fabric); B(−.5,−.36,.22,1,0,.7,fabric); B(.36,.5,.22,1,0,.7,fabric); B(−.36,.36,.22,.98,0,.5,fabric) |
| `coffee_table` | living | 1000 × 550 × 420 | 0 | R(−.5,.5,0,1) | B(−.5,.5,0,1,.9,1,wood); Legs(50, .9, wood) |
| `tv` | living | 1200 × 80 × 700 | 900 | R(−.5,.5,0,1); L(−.5,1,.5,1) (screen side) | B(−.5,.5,0,1,0,1,dark) |
| `rug` | living | 2000 × 1400 × 10 | 0 | R(−.5,.5,0,1); R(−.46,.46,.06,.94) dashed | B(−.5,.5,0,1,0,1,rug) — `noConflict` |
| `plant` | living | 450 × 450 × 1200 | 0 | E(0,.5,.5,.5); E(0,.5,.22,.22) | C(−.25,.25,.25,.75,0,.35,dark); S(−.5,.5,0,1,.3,1,plant) |
| `dining_table_4` | dining | 1200 × 1700 × 900 (table top at 750; chairs included in the footprint) | 0 | table R(−.5,.5,.265,.735) (outline style); chairs R(−.35,−.05,.03,.24), R(.05,.35,.03,.24), R(−.35,−.05,.76,.97), R(.05,.35,.76,.97) | top B(−.5,.5,.265,.735,.8,.84,wood); legs B at the 4 table corners 60 mm square, z 0–.8, wood; chair seats B(chair rects, 0, .5, wood); chair backs B(chair x-range, .03–.06 / .94–.97, .5, 1, wood) |
| `dining_table_6` | dining | 1800 × 1700 × 900 | 0 | as `dining_table_4` with three chairs per side at x-ranges (−.42,−.2), (−.11,.11), (.2,.42) | as `dining_table_4` with six chairs |
| `chair` | dining | 450 × 500 × 900 | 0 | R(−.5,.5,.12,1); R(−.5,.5,0,.12) | B(−.5,.5,.1,1,0,.5,wood); B(−.5,.5,0,.1,0,1,wood) |
| `desk_generic` | study | 1200 × 600 × 750 | 0 | R(−.5,.5,0,1) | B(−.5,.5,0,1,.95,1,wood); B(−.5,−.47,0,1,0,.95,wood); B(.47,.5,0,1,0,.95,wood) |
| `office_chair` | study | 600 × 600 × 1000 | 0 | E(0,.55,.45,.42) (outline); R(−.35,.35,.02,.14) | C(−.08,.08,.47,.63,0,.45,metal); C(−.45,.45,.15,.95,.45,.52,fabric); B(−.35,.35,.02,.12,.55,1,fabric) |
| `kitchen_counter` | kitchen | 2400 × 600 × 900 | 0 | R(−.5,.5,0,1); L(−.5,.92,.5,.92) | B(−.5,.5,0,.95,0,.95,white); B(−.5,.5,0,1,.95,1,stone) |
| `kitchen_counter_l` | kitchen | 2400 × 1800 × 900 | 0 | `a = min(600, 0.45·min(W,D))`, `ax = a/W`, `ay = a/D`. P[(−.5,0),(.5,0),(.5,ay),(−.5+ax,ay),(−.5+ax,1),(−.5,1)] closed; front-edge lines offset 50 mm inside (P[(.5,ay−50/D),(−.5+ax−50/W,ay−50/D),(−.5+ax−50/W,1)]) | B(−.5,.5,0,ay,0,.95,white); B(−.5,−.5+ax,ay,1,0,.95,white); B(−.5,.5,0,ay,.95,1,stone); B(−.5,−.5+ax,ay,1,.95,1,stone). Mirror image: swap width/depth and rotate 90°. |
| `sink` | kitchen | 800 × 500 × 50 | 850 | R(−.5,.5,0,1); R(−.42,.42,.12,.88); E(0,.07,.04,.04) | B(−.5,.5,0,1,0,1,metal); B(−.42,.42,.12,.88,.6,1.02,dark) — `noConflict` |
| `hob` | kitchen | 600 × 520 × 20 | 900 | R(−.5,.5,0,1); E(−.22,.27,.13,.15); E(.22,.27,.13,.15); E(−.22,.73,.13,.15); E(.22,.73,.13,.15) | B(−.5,.5,0,1,0,1,dark); four C(burner boxes, 1, 1.5, metal) — `noConflict` |
| `fridge` | kitchen | 700 × 700 × 1800 | 0 | R(−.5,.5,0,1); L(−.5,.93,.5,.93) | B(−.5,.5,0,1,0,1,white) |
| `dishwasher` | kitchen | 600 × 600 × 850 | 0 | R(−.5,.5,0,1); L(−.5,.93,.5,.93) | B(−.5,.5,0,1,0,1,white) |
| `wc` | bathroom | 380 × 700 × 780 | 0 | R(−.5,.5,0,.25) (outline style); E(0,.62,.45,.36) (outline style) | B(−.5,.5,0,.25,.45,1,ceramic); C(−.45,.45,.25,.98,0,.52,ceramic) |
| `basin` | bathroom | 550 × 450 × 850 | 0 | R(−.5,.5,0,.1) (outline style); E(0,.55,.45,.4) (outline style); E(0,.55,.3,.26) | C(−.45,.45,.1,.95,.82,1,ceramic); C(−.12,.12,.3,.6,0,.82,ceramic) |
| `shower` | bathroom | 900 × 900 × 2000 | 0 | R(−.5,.5,0,1); L(−.5,0,.5,1); L(.5,0,−.5,1); E(0,.5,.04,.04) | B(−.5,.5,0,1,0,.015,ceramic); B(−.5,.5,.99,1,.015,1,glass); B(.49,.5,0,.99,.015,1,glass) |
| `bathtub` | bathroom | 1700 × 750 × 550 | 0 | R(−.5,.5,0,1); E(0,.5,.44,.38) | B(−.5,.5,0,1,0,1,ceramic); B(−.44,.44,.12,.88,.92,1.005,water) |
| `washing_machine` | utility | 600 × 600 × 850 | 0 | R(−.5,.5,0,1); E(0,.6,.3,.3) | B(−.5,.5,0,1,0,1,white) |
| `water_heater` | utility | 450 × 450 × 700 | 1600 | E(0,.5,.5,.5) dashed (wall-mounted) | C(−.5,.5,0,1,0,1,white) |
| `stairs_straight` | structure | 1000 × 3000 × 3000 (H = floor-to-floor) | 0 | R(−.5,.5,0,1); tread lines L(−.5,i/12,.5,i/12) for i = 1…11; arrow P[(0,.95),(0,.08)] and P[(−.12,.2),(0,.08),(.12,.2)] (arrow points to the top of the flight) | 12 steps: for i = 0…11 B(−.5,.5, 1−(i+1)/12, 1−i/12, 0, (i+1)/12, wood) |
| `column` | structure | 300 × 300 × 2700 | 0 | R(−.5,.5,0,1) with `fill: '#3B3B3B'` | B(−.5,.5,0,1,0,1,paint) |
| `car` | outdoor | 1800 × 4500 × 1500 | 0 | R(−.5,.5,0,1); R(−.42,.42,.28,.62); L(−.42,.36,.42,.36) | B(−.5,.5,0,1,.12,.5,metal); B(−.42,.42,.28,.65,.5,1,glass); wheels C(−.5,−.42,.12,.25,0,.25,dark), C(.42,.5,.12,.25,0,.25,dark), C(−.5,−.42,.75,.88,0,.25,dark), C(.42,.5,.75,.88,0,.25,dark) |

Translation keys: `plan_editor.fixtures.<key>` for all 35 keys (en values are the obvious names: "Single bed", "Double bed", "Queen bed", "King bed", "Bedside table", "Wardrobe (generic)", "Dresser", "2-seat sofa", "3-seat sofa", "L-shaped sofa", "Armchair", "Coffee table", "TV", "Rug", "Plant", "Dining table (4)", "Dining table (6)", "Chair", "Desk (generic)", "Office chair", "Kitchen counter", "L-shaped kitchen counter", "Sink", "Hob", "Fridge", "Dishwasher", "WC", "Wash basin", "Shower", "Bathtub", "Washing machine", "Water heater", "Straight stairs", "Column", "Car").

### 9.5 Acceptance criteria — fixtures

- [ ] Every key renders a 2D symbol and a 3D model without errors at default size and at 50 % / 200 % sizes (parametrised component test).
- [ ] Every 2D symbol's outline lies within the footprint (all normalised coordinates within [−0.5, 0.5] × [0, 1] after evaluating builders at default size).
- [ ] The library panel lists 35 entries; search "sofa" finds three.

---

## 10. Custom furniture placement

### 10.1 Design picker (`DesignPickerPanel.vue`)

- Lists `designs` sorted by `updatedAt` desc; search by name; each card: thumbnail (or template icon), name, size summary `W × D × H` (`formatLength` summary style), badges: **In order {number}** when `lockedByOrderNumber`, **Placed ×n** when already placed in this plan.
- Empty state: `plan_editor.designs.empty` + button **Design new furniture** (if `canCreateDesign`).
- **Design new furniture** (only when `canCreateDesign`): flush autosave (await), then Inertia-visit the new-design page of `10` §10.2 with `return_plan={planId}` and, when exactly one wall is selected, `hint_width` = the free length of that wall's face on the side of the room the user last clicked (face length minus the widths of placements attached to that face, floored to 10 mm; omitted if < 300). The handoff back (`10` §10.4) reopens this editor with `?place={designId}` and the Furniture tool starts in `placing` for that design (§1.2).

### 10.2 Placement rules

- Footprint = design `widthMm × depthMm` (`FootprintProvider`, `04` §5.8); height = `heightMm`.
- **Default elevation** at placement: `mounting 'floor' | null` → 0; `'wall'` → 1400 (rationale: standard wall-cabinet underside above a 900 mm counter with 500 mm clearance); `'loft'` → `max(0, wallHeight − heightMm)` where `wallHeight` = the attached wall's height (if snapped) else `meta.defaultWallHeight`. The elevation is set only when the placement is created; later moves keep it.
- Wall-mounted designs (`wall`/`loft`) use `2 × furnitureTol` for face snapping (they are always against a wall).
- **Wall attachment**: set from `snapFootprint` (`04` §5.8) on placement and moves; moving away beyond tolerance sets it to `null`; the properties panel shows "Against wall" with **Detach**.
- Elevation can be edited in the properties panel (LengthInput, 0–10000); a hint `plan_editor.props.elevation_hint_wall` is shown for wall/loft designs.

### 10.3 Edit design / view design

**Edit design** flushes autosave and Inertia-visits the builder page of the design (`10` §10.3, with `return_plan={planId}`; admin context: the admin design viewer of `11`). If the design is locked by an order, the button reads **View design** and opens the builder in its read-only locked state (`03` §5 423 handling), where "Duplicate to edit" is offered by the builder. Staff context: link to the admin design view.

### 10.4 Checks popover (`ChecksPopover.vue`)

Opened from the Checks button in `#topbar-end` (badge = number of errors + warnings + conflicts). Sections:
1. **Errors** (red): `validatePlan` issues with severity `error` (text `plan_editor.issues.<code>`) and the note `plan_editor.issues.errors_block_saving`.
2. **Warnings** (amber): `validatePlan` warnings, derive issues of severity `warning` (`engine.plan.derive.*`), placement conflicts (`engine.plan.conflict.*` with the names of both entities), `design_model_failed` (§5.5).
Each row: icon, message, **Show** (selects the involved entities and `zoomToEntity`). Issues with severity `info` are not listed. The list updates live (debounced 200 ms).

### 10.5 Conflict highlighting

Entities involved in conflicts are outlined with the `conflict` style in 2D (amber dashed) and with amber edges in 3D. Non-blocking: placement, saving and ordering are never prevented.

### 10.6 Door clearance zones

When `view.showClearances` is on, `ClearanceLayer` fills every `doorSwingSectors` polygon (`04` §5.9) with `#F59E0B` at 12 % opacity and a dashed amber outline (2D only).

### 10.7 Acceptance criteria — placement

- [ ] Placing a 1800 × 600 wardrobe against a wall sets `wallAttachment` with the correct side; moving the wall 300 mm moves the wardrobe with it (post-process, `04` §6.4).
- [ ] A design with `mounting 'wall'` is placed at elevation 1400 and does not conflict with a 900 mm counter beneath it.
- [ ] Placing furniture inside a door swing shows an amber highlight and a Checks entry, and still saves.
- [ ] "Design new furniture" → builder → "Place in plan" (`10` §10.4) returns to the editor in placing mode for the new design, and `place` is removed from the URL after placing or cancelling.

---

## 11. Saving, conflicts, revisions, thumbnails

### 11.1 Autosave (`editor/shared/useDocumentAutosave.ts`)

Implements `03` §5 client steps 1–7 **exactly** (debounce 1500 ms, max wait 10 s, single in-flight request, localStorage draft `fs:draft:plan:{planId}` throttled 1 s, backoff 2/4/8/16/30 s, keepalive on unload). Plan-specific additions:

1. **Trigger:** every bus event with non-empty patches marks the document dirty. View changes (camera, mode) never mark it dirty.
2. **Payload:** `{ document: withView(doc), baseVersion }` where `withView` sets `view = { mode2d: camera2d, mode3d: camera3d (if the 3D view was opened, else the previous value), lastMode: mode }`.
3. **Pre-validation:** before sending, run `validatePlan`; if it has errors → status `invalid`, no request; autosave resumes automatically when the errors are fixed (next bus event).
4. **Responses:** `200` → `baseVersion = version`, status `saved`, schedule thumbnail (§11.6). `409` → status `conflict`, ConflictDialog (§11.2). `423 { reason: 'plan_locked' }` → read-only reason `plan_locked` (§15.3), status `readonly`, keep the local draft, show the banner with **Save as copy**. `422` → status `error` (`03` §5). Network/5xx → `offline` with retry.

The status is shown by the layout's `SaveStatusIndicator` (`15`): the editor emits `saveStatus` to the host, which passes it to `EditorLayout`. `invalid` ("Fix {count} problem(s) to save", clickable — opens the Checks popover) is one of the indicator's statuses (15 §7.3, §9.31); `readonly` is not passed (the host sets the layout's `readOnly` instead).

| Status | Icon | Text key | Notes |
|---|---|---|---|
| saved | check | `plan_editor.save.saved` ("Saved · {time}") | relative time, refreshed every 30 s |
| dirty | dot | `plan_editor.save.dirty` | |
| saving | spinner | `plan_editor.save.saving` | |
| offline | cloud-off | `plan_editor.save.offline` ("Offline — changes kept on this device") | retry countdown in the tooltip |
| conflict | alert | `plan_editor.save.conflict` | click opens ConflictDialog |
| invalid | alert (red) | `plan_editor.save.invalid` ("Fix {count} problem(s) to save") | click opens Checks |
| error | alert (red) | `plan_editor.save.error` | click shows details + **Retry** |
| readonly | lock | `plan_editor.save.readonly` | |

The status element has `role="status"` and `aria-live="polite"` (announces only transitions to saved/offline/conflict/invalid/error).

### 11.2 Conflict dialog (`ConflictDialog.vue`)

Modal (`role="alertdialog"`), shown on 409 or on load when the local draft's `baseVersion < workingVersion` (`03` §5.6). Text: `plan_editor.conflict.body` with `{name}` (savedBy) and `{time}` (savedAt). Buttons:
- **Reload theirs** → clear the local draft, `router.reload({ only: ['plan'] })`, `store.reset(migratePlan(plan.workingDocument), workingVersion)`.
- **Keep mine** → PUT with `baseVersion = currentVersion` (overwrites), autosave resumes.
- **Save mine as copy** → POST `/api/plans/{plan}/duplicate-with-document { document: withView(doc), name: t('plan_editor.copy_name', { name }) }` → clear the local draft → Inertia-visit `editUrl`.
Autosave stays paused while the dialog is open; the dialog cannot be dismissed with Esc (a choice is required).

### 11.3 Restore unsaved draft

On load, if `localStorage` holds a draft with `baseVersion === workingVersion` whose document differs (deep compare) from `workingDocument`: RestoreDraftDialog (`plan_editor.restore_draft.*`) with **Restore** (load the draft as the current document, mark dirty → autosave) and **Discard** (delete the draft).

### 11.4 Revisions panel (`RevisionsPanel.vue`) and compare dialog

- Lists revisions newest first (50 per page, "Load more"): `#number`, label or `plan_editor.revisions.reason.<reason>`, author, relative time (absolute in tooltip). Loading skeleton; error state with Retry; empty state `plan_editor.revisions.empty`.
- Row actions: **Preview** → `RevisionCompareDialog`; **Restore** (if not read-only and mode `plan`) → confirm (`plan_editor.revisions.restore_confirm`: "Your current plan is saved as a revision first") → flush autosave → POST restore → `store.reset(migratePlan(workingDocument), workingVersion)` (clears undo history, rationale: history patches refer to the replaced document) → toast `plan_editor.revisions.restored {number}`.
- **Compare dialog:** two panes side by side (stacked < 1024 px): left = revision, right = current. Each pane is an `<img>` of the SVG produced by `svgFromDrawing(buildPlanDrawing(...))` (geometry of the revision derived in the worker, §3.6) — rendered as an image (data URL), never as inline HTML, so user text cannot inject markup. Toggle **Highlight differences**: entities present only in the current document are outlined green, only in the revision red, present in both but not deep-equal amber (comparison by entity id per collection).

### 11.5 Checkpoints (Ctrl/Cmd+S)

`CheckpointPopover` anchored to SaveStatus: optional label input (≤ 120 chars, `plan_revisions.label`) + **Save checkpoint**. Pressing Ctrl/Cmd+S again while the popover is open saves without a label. Flow: flush autosave (if `invalid`/`conflict` → abort with toast `plan_editor.checkpoint.blocked`) → POST revisions `{ label }` → toast `plan_editor.checkpoint.saved {number}` → refresh RevisionsPanel if open. Hidden in read-only mode and in mode `import-review`.

### 11.6 Thumbnails and project cover (`export/thumbnail.ts`)

- After a successful save, schedule a thumbnail upload: trailing debounce 60 s (at most one upload per 60 s); skipped when the document identity equals the last uploaded one. When the plan has no thumbnail yet (`plan.thumbnailUrl === null`, e.g. right after `06` accepted an import), one is generated 5 s after the first load even without a save (`06` §11.5 step 8). Mode `import-review` never uploads thumbnails.
- Render: `buildPlanDrawing` with rooms, walls, openings, furniture, fixtures (no dimensions, no background, no labels smaller than 2 % of the bbox), fit into 800 × 600 with 24 px padding on white → PNG via the rasterizer of §14.1 (scale 1) → presigned PUT (purpose `plan_thumbnail`) → POST `/api/plans/{plan}/thumbnail`.
- **Project cover:** when this plan has the lowest `levelIndex` among `levels` and the 3D scene exists in this session, also render a 1200 × 800 image from a fixed camera (azimuth 35°, polar 55°, `fitToBox`, cutaway mode) into a `WebGLRenderTarget`, read pixels, encode PNG → purpose `project_cover` → POST `/api/projects/{project}/cover`; at most once per 10 minutes.
- Failures are silent (console warning only); they never affect save status.

### 11.7 Leaving the page

`beforeunload` warning when dirty or saving (`03` §5.7). Inertia navigation away (back button, floor switcher, Edit design) first awaits `flush()` (max 5 s; on timeout, navigation proceeds and the localStorage draft remains).

### 11.8 Acceptance criteria — saving

- [ ] After a change, a PUT is sent 1.5 s after the last command; 30 rapid commands within 10 s produce at most 2 PUTs.
- [ ] Simulated 409 opens the conflict dialog; each of the three choices behaves as specified (Playwright with mocked routes).
- [ ] With the network offline, the status shows offline, changes survive a page reload (restore prompt), and saving resumes when online.
- [ ] A document containing an `opening_overlap` error shows status `invalid` and sends no request until fixed.
- [ ] Ctrl/Cmd+S creates a revision with the typed label; restoring it replaces the document and clears undo.

---

## 12. Keyboard shortcuts, context menus, help, onboarding

### 12.1 Shortcut registry (`input/shortcuts.ts`)

```ts
interface Shortcut { id: string; keys: string[]; labelKey: string; group: 'tools' | 'edit' | 'view' | 'selection' | '3d'; when?(s: PlanEditorStore): boolean; run(s: PlanEditorStore): void }
```

`mod` = Cmd on macOS (`navigator.userAgentData?.platform ?? navigator.platform` matches `/mac/i`), Ctrl elsewhere. The handler is attached to the editor root (`keydown`), ignores events whose target is an `input`, `textarea`, `select` or `[contenteditable]` (except `Esc` and `mod+s`), ignores auto-repeat for tool keys, and first offers the event to the active tool (`onKeyDown` returning `true` stops it). Single-letter tool shortcuts are disabled in read-only mode and in walk mode.

| Action | Keys | Notes |
|---|---|---|
| Select / Pan tools | `V` / `H` | hold `Space` = temporary pan |
| Wall / Room | `W` / `R` | |
| Door / Window / Opening | `D` / `N` / `O` | |
| Furniture / Fixture | `F` / `X` | |
| Dimension / Text / Measure | `Shift+D` / `T` / `M` | |
| Background | `B` | |
| Undo / Redo | `mod+Z` / `mod+Shift+Z`, `Ctrl+Y` (Win/Linux) | |
| Delete selection | `Delete`, `Backspace` | |
| Cancel / deselect | `Esc` | tool cancel first, then selection, then tool → Select |
| Nudge | arrows 10 mm; `Shift`+arrows 100 mm; `Alt`+arrows 1 mm | pan when nothing is selected |
| Rotate selection | `[` / `]` ±15°; with `Shift` ±90° | placements, fixtures, labels |
| Flip door swing / hinge | `Shift+F` / `Shift+H` | selected openings or Opening tool ghost |
| Copy / Cut / Paste / Duplicate | `mod+C` / `mod+X` / `mod+V` / `mod+D` | |
| Select all | `mod+A` | walls, openings, placements, fixtures, labels, dimensions |
| Grid / Snapping | `G` / `S` | toast shows the new state |
| 2D / 3D | `2` / `3` | |
| Zoom in / out / fit | `=` or `+` / `-` / `0` | 3D: dolly in/out / reset camera |
| 3D camera mode | `C` | cycles Orbit → Top → Walk (walk only with the feature flag) |
| 3D wall display | `Shift+C` | cycles Full → Cutaway → Low |
| 3D orbit with keyboard | arrows (canvas focused, nothing selected) | azimuth ±15°, `Shift`: polar ±10° |
| Walk | `W A S D` / arrows, `Shift` run, `Esc` release pointer | walk mode only |
| Checkpoint | `mod+S` | |
| Properties focus | `Enter` | |
| Plan outline (list view) | `L` | |
| Help | `?` (`Shift+/`) | |

### 12.2 Context menus (`ContextMenu.vue`, reka-ui ContextMenu; right-click or long-press)

| Target | Items |
|---|---|
| Wall | Split here (`splitWall` at the click's `u`), Add door here, Add window here (start the tool with the ghost locked to this wall), Merge with neighbour (if `mergeCollinearWalls` valid at an end node), Select room on each side, Properties, Delete |
| Node | Merge walls (if valid), Delete node |
| Opening | Flip swing, Flip hinge, Properties, Delete |
| Placement | Rotate 90°, Duplicate, Edit design / View design, Detach from wall (if attached), Delete |
| Fixture | Rotate 90°, Duplicate, Reset size, Delete |
| Room | Rename (focus name), Room type ▸ (submenu of types), Show/Hide area, Reset label position |
| Dimension / Label | Edit, Delete |
| Empty canvas | Paste here (if clipboard), Add text here, Zoom to fit, Grid on/off, Snapping on/off |

Items not allowed in read-only mode are hidden (only Properties/Zoom remain).

### 12.3 Help overlay (`HelpOverlay.vue`)

Modal dialog opened by `?` or the Help button: tabs **Shortcuts** (generated from the registry, grouped, showing platform-specific keys), **Mouse & touch** (gesture table from §4.2 / §7), **Tips** (6 short tips, keys `plan_editor.help.tips.1…6`), and a **Replay tour** button. Esc closes; focus returns to the opener.

### 12.4 Onboarding tour (`OnboardingTour.vue`)

Shown on the first visit (no `fs:tour:plan-editor:v1` in localStorage) in editable mode on ≥ 768 px, after the document has loaded. Five steps, each a popover anchored to an element with `data-tour="<id>"`, with Back / Next / Skip and a step counter; Esc = Skip; finishing or skipping writes the flag.

| # | Anchor | Title / body keys |
|---|---|---|
| 1 | `toolbar-draw` (Wall + Room buttons) | `plan_editor.tour.1.title` / `.body` — draw walls (W) or whole rooms (R) |
| 2 | `canvas` | `plan_editor.tour.2.*` — snapping, Shift for straight lines, type a length while drawing |
| 3 | `properties` | `plan_editor.tour.3.*` — select anything to edit exact sizes |
| 4 | `view-toggle` | `plan_editor.tour.4.*` — switch 2D/3D any time |
| 5 | `save-status` | `plan_editor.tour.5.*` — autosave and checkpoints (Ctrl/Cmd+S) |

The tour traps focus inside the popover, highlights the anchor with a 4 px primary ring, and scrolls/opens panels needed for the anchor (step 3 opens the properties sheet on tablets).

---

## 13. Accessibility

1. **Landmarks:** EditorLayout provides the header/footer regions (`15`); Toolbar `role="toolbar"` (arrow keys move between buttons, Home/End jump, roving tabindex); PropertiesPanel `aside` with `aria-label=t('plan_editor.props.title')`; StatusBar `footer`; flyouts are `role="dialog"` (non-modal, `aria-labelledby`).
2. **Canvas:** the 2D/3D container is focusable (`tabindex="0"`), `role="application"`, `aria-roledescription=t('plan_editor.canvas.roledescription')`, `aria-label` = plan name, `aria-describedby` → a visually hidden paragraph with keyboard instructions (`plan_editor.canvas.instructions`). Focus ring: 2 px primary outline with 2 px offset (`:focus-visible`).
3. **Live region:** a visually hidden `aria-live="polite"` region announces tool changes (`plan_editor.announce.tool`), selection changes (`plan_editor.announce.selected`, en: "{kind} selected, {size}" → "Wall selected, 3.2 m"), command results (`plan_editor.announce.<command>`), undo/redo (`plan_editor.announce.undo` with the action label) and errors.
4. **Textual alternative — Plan outline** (`PlanOutlinePanel.vue`, `L`): a structured list of Rooms (name, type, area, size), Walls (index, length, thickness, kind), Doors & windows (label, type, width × height, wall), Furniture (design name, size, room), Fixtures (type, size, room), Dimensions and Text. Every row is a button that selects the entity and moves focus to the properties panel; rows have Delete buttons in editable mode. This list is the complete keyboard/screen-reader path for inspecting and editing a plan (all edits happen through the properties panel).
5. **Keyboard-only editing:** select via the outline, edit via properties, move via arrow nudges, rotate via `[`/`]`, delete via Delete, undo/redo via shortcuts; drawing new walls by keyboard: Wall tool + `Enter` on the canvas starts a chain at the viewport centre (or at the selected node), then `DrawInput` (length + direction) adds segments.
6. **Colour:** information is never conveyed by colour alone (selection also shows handles; conflicts also listed in Checks; invalid previews also show a text reason). All UI text meets WCAG AA contrast (canvas colours in §4.3 were chosen ≥ 4.5:1 for text on fills).
7. **Motion:** `prefers-reduced-motion: reduce` disables camera animations, zoom animations and the tour's highlight transition.
8. **Touch targets** ≥ 44 × 44 px on touch devices (§2.2).
9. All icon-only buttons have `aria-label`; toggles use `aria-pressed`; menus use reka-ui primitives (correct ARIA roles and keyboard handling).

Acceptance: axe-core (via Playwright) reports no serious/critical violations on the editor page in 2D, 3D and with each dialog open; the outline panel lists all rooms of the HDB fixture with areas; a screen-reader smoke test (NVDA/VoiceOver checklist in `16`) can rename a room and change a wall's thickness without a pointer.

---

## 14. Exports (`export/`)

`ExportDialog.vue`: format radio (PNG, SVG, PDF, DXF, GLB) with format-specific options; **Export** button shows a spinner and is disabled during export; errors → toast `plan_editor.export.failed` (+ console error). Exports are available in read-only mode (not on phones, whose top bar has no export entry, `15` §7.3). File names (`export/fileName.ts`): `{projectSlug}-{planSlug}-{YYYYMMDD}.{ext}` with slugs from `name.normalize('NFKD')`, ASCII letters/digits, `-`, max 40 chars each; date in the user's timezone. Downloads use an object URL on a temporary `<a download>`; the URL is revoked after 10 s.

Common 2D options: **Include** checkboxes — background image (default off), dimensions (on), furniture (on), fixtures (on), room areas (on), text labels (on). The drawing is built with `buildPlanDrawing` (`04` §8) with `lod: 0`; the viewBox is the drawing bbox expanded by 5 % (min 500 mm) on every side.

### 14.1 PNG
`svgFromDrawing` with `widthPx/heightPx` = **2 ×** the CSS pixel size the whole plan would occupy when fitted into the current 2D canvas element (letterboxed to the bbox aspect), capped at 8192 px on the long side; text and stroke sizes converted from the screen px styles (§4.3) at that scale; white background. Background image (if included) is fetched (signed URL) and inlined as a data URL first. Rasterise: `Blob(svg, 'image/svg+xml')` → object URL → `Image` → `decode()` → draw on a `<canvas>` → `toBlob('image/png')`.

### 14.2 SVG
The same SVG string with `width="{bboxWidthMm/100}mm"` and `height="{bboxHeightMm/100}mm"` (physical size at scale 1:100, a common plan scale; it remains a vector).

### 14.3 PDF (jsPDF + svg2pdf.js)
- Options: paper **A4** / **A3** (default A4), landscape; scale **Auto** (default) or a fixed value from `[20, 25, 50, 75, 100, 125, 150, 200, 250, 500, 1000]`.
- Layout (mm): margins 10; title block 22 mm high across the bottom; drawing area = page − margins − title block. Auto scale = the smallest denominator `N` in the list such that the drawing bbox / N fits the drawing area; a fixed scale that does not fit shows an inline error and disables Export.
- Styles: stroke widths in paper mm (wall outline 0.35, door leaf 0.25, swing 0.13, glass 0.18, dims 0.13, furniture 0.25, fixtures 0.18), text heights in paper mm (room name 3.0, area/size 2.5, dims 2.0, furniture label 2.0); `textSizeMm(style) = paperMm × N`; `TextLabel` keeps its model size.
- Build the SVG string, parse it with `DOMParser` into an `SVGElement`, then `await pdf.svg(el, { x, y, width, height })` (svg2pdf.js) into the drawing area.
- Fonts: Noto Sans Regular/Bold TTF loaded lazily from `/fonts/NotoSans-Regular.ttf` and `/fonts/NotoSans-Bold.ttf` (self-hosted, SIL OFL; committed in `public/fonts/`, 15 §2) and registered with `addFileToVFS` + `addFont`; used for all text (Latin, Greek, Cyrillic coverage).
- **Title block** (left → right): business name (`app.name`) bold + project name + plan name; `t('plan_editor.export.pdf.scale', { n })` + a scale bar (metric 0–1–2–5 m; imperial 0–5–10–20 ft) + north arrow when `meta.northAngle !== null`; date (`Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone })`), `t('plan_editor.export.pdf.units', { unit })` ("Dimensions in mm" / "Dimensions in feet and inches"), page size.
- `pdf.save(fileName)`.

### 14.4 DXF (`exportDxf.ts`, `@tarikjabiri/dxf`)
Mapping exactly as `04` §8.4: layers WALLS, OPENINGS, ROOMS, DIMS, FURNITURE, FIXTURES, TEXT with the listed ACI colours; `$INSUNITS = 4`; y flipped; texts use the paper-independent model sizes for scale 1:100 (`textSizeMm = paperMm × 100`); background never exported. Use the library's document/model-space/layer APIs as typed in the pinned version; output encoded as UTF-8 text with MIME `application/dxf`.

### 14.5 GLB
`GLTFExporter` (`three/examples/jsm/exporters/GLTFExporter.js`) `parseAsync(sceneManager.exportRoot(), { binary: true, onlyVisible: true })`. `exportRoot()` returns a temporary group with walls in `full` display mode (never cutaway stubs), node caps, floors, slab, openings, furniture (resolved models; placeholders if still loading, after waiting up to 5 s), fixtures; excludes ground, shadows, helpers, gizmos and outlines. If the 3D view was never opened, the SceneManager is created headless (no renderer) just for the export and disposed afterwards. Units are metres (glTF native). Options: include furniture (on), include fixtures (on).

### 14.6 Acceptance criteria — exports
- [ ] PNG of the HDB fixture is 2× the fitted canvas size, has a white background and matches the SVG export visually (pixel diff < 1 % after rasterising both at the same size).
- [ ] SVG export contains no `<script>`, no external URLs except an inlined background, and escapes a room named `<b>&"x"</b>`.
- [ ] PDF A4 auto-scale of an 11 000 × 8 900 mm plan (bbox with 5 % margins: 12 100 × 9 790 mm; drawing area 277 × 168 mm ⇒ N ≥ 58.3) selects **1:75** and the title block shows "1:75".
- [ ] The DXF opens in LibreCAD/ezdxf with the 7 layers, `$INSUNITS = 4`, and the wall outlines' coordinates equal the plan's (y negated).
- [ ] GLB loads in three.js `GLTFLoader` with the plan's bounding box in metres (±1 mm).

---

## 15. Read-only mode

### 15.1 Reasons and triggers

| Reason | Trigger | Banner | Actions |
|---|---|---|---|
| `archived` | host `readOnlyReason = 'archived'` (`10` §8.2) | page-owned (`10`) | page-owned (Unarchive) |
| `no_permission` | host `readOnlyReason = 'no_permission'` (admin without `plans.edit_any`, `11` §6.4) | `ReadOnlyBanner` `plan_editor.readonly.no_permission` "You can view this plan but not edit it." | — |
| `plan_locked` | `lock !== null`, or a `423 plan_locked` save response | `ReadOnlyBanner` `plan_editor.readonly.plan_locked` "Locked by {name} on {date}: measurements verified by our team." | `canLock`: **Unlock**; others: **Save as copy** (`duplicate-with-document`, opens the editable copy) |
| `small_screen` | viewport < 768 px | page-owned phone banner (`10`) | — |

### 15.2 Behaviour

- Toolbar shows only Select, Pan and Measure; tool shortcuts for other tools do nothing (toast once).
- Properties panel is inspect-only (disabled inputs); context menus show only non-mutating items; drag handles are not rendered; keyboard Delete/nudge/rotate do nothing.
- `exec()` refuses every command (§3.4) — defence in depth.
- Autosave disabled (status `readonly`); no localStorage drafts are written; thumbnails not uploaded.
- 2D/3D switching, cameras, walk mode, the outline panel, revisions **preview** (not restore), exports and help remain available.

### 15.3 Locking (staff)

Staff with `canLock` (`plans.edit_any`) see a Lock toggle in `#topbar-end` (mode `plan` only). **Lock**: confirm dialog (`plan_editor.lock.confirm`) → flush autosave → POST `/api/plans/{plan}/lock` → the page reloads the `plan` prop → read-only `plan_locked`. **Unlock**: DELETE → reload → editable. Lock state changes are logged server-side (activity log). Customers cannot lock.

### 15.4 Import review mode (`06` §11)

With `mode: 'import-review'` the editor behaves exactly as in `plan` mode except:
- Saving goes through `saveAdapter: { save(document, baseVersion): Promise<SaveResponse>; draftKey: string }` (`06` review-document endpoint, `review_version` as the version); revisions, checkpoints, thumbnails, locking and "Design new furniture" are hidden.
- `PlanEditorProps` accepts `extensions?: PlanEditorExtensions`:

```ts
interface PlanEditorExtensions {
  tools?: PlanTool[];                         // extra tools (ids 'ext:…') shown in an extra toolrail group (06: 'ext:check_dimension', key K)
  shortcuts?: Shortcut[];                     // §12.1 registry entries
  overlay2d?: Component;                      // rendered between the TEXT content layer and SelectionLayer; receives the store as prop
  entityStyle?: (entityId: string) => { fill?: string; stroke?: string; dashed?: boolean; glyph?: 'warning' } | null; // confidence colouring (06 §11.2)
  inspectorTabs?: Array<{ id: string; labelKey: string; component: Component }>;   // 06 review panel tabs (Scale, Attention, Rooms)
  banner?: Component;                         // rendered into #banner
  onBusEvent?: (e: BusEvent<PlanDocument>) => void;   // 06 marks edited entities as reviewed
}
```
- `Loupe.vue` is exported with props `magnification` (default 2) and `diameterPx` (default 120); `06` uses 4× / 160 px for calibration.

---

## 16. Performance budgets and memory

### 16.1 Budgets (mid-range laptop: 4-core, integrated GPU, Chrome; CI asserts with Playwright on the `16` reference runner using 2× the targets)

| Metric | Target |
|---|---|
| Editor JS (excluding the 3D chunk), gzip | ≤ 250 KB |
| 3D chunk, gzip | ≤ 700 KB |
| Page props → first 2D frame, 100-wall plan | ≤ 300 ms |
| Pan/zoom frame scripting, 300 walls | ≤ 8 ms (60 fps) |
| Node drag frame (command + derive + patch), 100 walls | ≤ 16 ms |
| Hover hit-test | ≤ 1 ms |
| 2D→3D first switch / subsequent (§6.4) | ≤ 500 ms / ≤ 150 ms |
| 3D orbit, 100 walls + 30 placements + 40 fixtures | 60 fps; ≤ 300 draw calls |
| 3D incremental update after moving one wall | ≤ 30 ms |
| Exports (100 walls): PNG / SVG / DXF / PDF / GLB | ≤ 1.5 s / 0.3 s / 0.5 s / 4 s / 2 s |
| Heap growth after 10 mount/unmount cycles (Chromium `performance.memory`) | ≤ 20 MB |

Implementation levers already specified: shallow document + revision map (§3.3), `v-memo` per entity, screen-size text via one CSS variable (§4.3), lazy indices (§3.5), culling (§4.1), on-demand 3D rendering (§5.1), geometry caching/ref-counting (§5.5–5.6).

### 16.2 Memory and disposal rules

1. Every `BufferGeometry` created by builders is disposed when replaced or when its entity is removed (`geometry.disposeBoundsTree?.(); geometry.dispose()`); shared geometries (design models, fixture caches) are reference-counted and disposed at count 0.
2. Materials and textures live in registries and are disposed only in `SceneManager.dispose()` (plus the blob-shadow `CanvasTexture`).
3. `SceneManager.dispose()`: traverse `root` with `disposeObject3D` (geometries, materials not in registries, outlines), dispose registries, `TransformControls.dispose()`, `CameraControls.dispose()`, `PointerLockControls.dispose()`, render targets, remove DOM listeners, cancel rAF loops, `renderer.renderLists.dispose()`. Tres disposes the renderer on unmount.
4. 2D: the drawing cache map is cleared on unmount; object URLs (exports, PNG thumbnails) are revoked; `ResizeObserver`s disconnected.
5. Store disposal per §3.7. Engine worker requests from the compare dialog are cancelled when it closes (`01` §5.5 cancellation).

---

## 17. i18n keys (`resources/lang/en/plan_editor.php`)

Key groups (every key used in this file must exist; a test enumerates them, §18):

- `plan_editor.loading`, `plan_editor.load_error.{title,body}`, `plan_editor.empty.{title,body,draw_walls,draw_room,import,trace}`
- `plan_editor.topbar.{back,rename,switch_plan,view_2d,view_3d,view_options,checks,revisions,export,help,lock,unlock,more}`
- `plan_editor.tools.{select,pan,wall,room,door,window,opening,furniture,fixture,dimension,text,measure,background,outline}`
- `plan_editor.hints.<tool>.<phase>` for every tool phase in §7 (such as `plan_editor.hints.wall.drawing`: "Click to add a corner · Enter or double-click to finish · type a length")
- `plan_editor.presets.{exterior,interior,partition,half,custom}`, `plan_editor.draw_input.{length,direction,width,depth,done,undo_segment,type_length}`
- `plan_editor.props.*` (field labels for every field in §8.2, `mixed`, `multi`, `title`, `elevation_hint_wall`, section headings), `plan_editor.room_type.<type>` (19), `plan_editor.floor_finish.<finish>` (6), `plan_editor.wall_kind.<kind>` (4), `plan_editor.wall_material.<material>` (5), `plan_editor.door_type.<type>` (6), `plan_editor.window_type.<type>` (6), `plan_editor.opening_kind.<kind>` (3)
- `plan_editor.room.unnamed`, `plan_editor.design.missing`
- `plan_editor.fixtures.<key>` (35), `plan_editor.fixture_category.<category>` (9 + `all`, `recent`)
- `plan_editor.designs.{empty,new,in_order,placed_count,search}`
- `plan_editor.issues.<code>` for every `03` §1.1 code, `errors_block_saving`, `design_model_failed`
- `plan_editor.save.{saved,dirty,saving,offline,conflict,invalid,error,readonly,retry}`, `plan_editor.conflict.{title,body,reload,keep,copy}`, `plan_editor.copy_name`, `plan_editor.restore_draft.{title,body,restore,discard}`
- `plan_editor.revisions.{title,empty,load_more,preview,restore,restore_confirm,restored,highlight,reason.<reason>}` (5 reasons from `02` §3.3), `plan_editor.checkpoint.{label,save,saved,blocked}`
- `plan_editor.view.*` (every item of §2.4), `plan_editor.walk.{click_to_look,ghost}`, `plan_editor.view3d.load_failed`, `plan_editor.camera.{orbit,top,walk}`, `plan_editor.walls3d.{full,cutaway,low}`
- `plan_editor.background.{upload,replace,calibrate,calibrate_body,real_distance,scale_existing,opacity,rotation,visible,locked,remove,remove_confirm,calibrated,load_failed}`
- `plan_editor.clipboard.{copied,pasted,placements_skipped}`, `plan_editor.context.*` (every item of §12.2)
- `plan_editor.help.{title,shortcuts,gestures,tips.1..6,replay_tour}`, `plan_editor.shortcuts.<id>`, `plan_editor.tour.{1..5}.{title,body}`, `plan_editor.tour.{next,back,skip,done,step}`
- `plan_editor.canvas.{roledescription,instructions}`, `plan_editor.announce.{tool,selected,undo,redo,<command>}`
- `plan_editor.export.{title,format.<fmt>,include.<layer>,paper,scale,auto,scale_too_small,failed,pdf.scale,pdf.units}`
- `plan_editor.readonly.{toast,no_permission,plan_locked}`, `plan_editor.background.replace_warning`, `plan_editor.lock.{confirm,locked,unlocked}`
- `plan_editor.phone.{summary,sheet_label,rooms,furniture,view_design}`, `plan_editor.undo_label`, `plan_editor.redo_label`

---

## 18. Tests

**Vitest + @vue/test-utils** (`resources/js/editor/plan/__tests__/`):
- `viewport2d.test.ts`: `zoomAt` keeps the anchor fixed; `fit`; `scaleDenominator(0.0378) ≈ 100`.
- `store.test.ts`: exec in read-only refuses; selection sanitising after delete/undo; revision bumps for node → walls → openings/attached placements; nudge sealing after 800 ms (fake timers).
- `tools/*.test.ts`: each tool's state machine driven with synthetic `ToolPointerEvent`s against `makeRectPlan`; asserts commands executed and phases (every table row in §7).
- `LengthInput.test.ts`: parse/commit/error/revert/arrow-stepping/mixed.
- `fixtures.test.ts`: §9.5.
- `exports.test.ts`: file names; SVG escaping; PDF scale selection (pure function); DXF entity counts per layer for `makeRectPlan`.
- `i18n-keys.test.ts`: every key referenced in `resources/js/editor/plan/**` (regex over `t('…')` literals and the generated key lists of §17) exists in `plan_editor.php`/`engine.php`.
- `autosave.test.ts` (shared): `03` §5 timings and response handling with mocked `fetch`.

**Browser tests** (Pest browser plugin / Playwright, `tests/Browser/PlanEditor/*`): draw a 2-room flat with doors and windows by mouse; same on a touch-emulated tablet; 2D↔3D switch preserving selection; furniture placement against a wall + 3D gizmo move; conflict dialog flows; offline + restore draft; checkpoint + restore; exports download (all five formats); phone viewer; read-only (support role, locked plan, archived project); axe-core scans; performance traces of §16.1.

---

## 19. Acceptance criteria — editor as a whole

- [ ] A customer can, on desktop and on a tablet, draw the `brochure-2bhk` plan from scratch (walls, doors, windows, room names), place two custom furniture designs and five fixtures, view it in 3D, walk through it, and export PDF — without any console error.
- [ ] Every user-visible string is a translation key; switching the locale to a pseudo-locale (`en-XA`, test only) changes every label.
- [ ] Every command available by pointer is available by keyboard (shortcut, properties panel or outline panel).
- [ ] All section-level acceptance criteria above (§2.5, §3.9, §4.14, §5.12, §6.5, §7.15, §8.3, §9.5, §10.7, §11.8, §13, §14.6) pass in CI.

---

_Appendix merged into the target documents during reconciliation (see 19-reconciliation-log.md)._
