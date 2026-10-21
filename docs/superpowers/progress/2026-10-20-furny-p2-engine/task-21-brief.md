### Task 21: Plan command pipeline, post-process, room-meta reconciliation

**Files:**
- Create: `resources/js/engine/plan/commands/paths.ts`, `pipeline.ts`, `postprocess.ts`, `define.ts`, `registry.ts`, `resources/js/engine/plan/reconcile.ts`
- Test: `resources/js/engine/plan/commands/__tests__/pipeline.test.ts`, `resources/js/engine/plan/__tests__/reconcile.test.ts`

**Spec refs:** `04 §6.3–§6.4`, `04 §4.4(b)`, `04 §4.9` (re-association), `04 §6.7`

**Interfaces:**
- Consumes: Tasks 12–13 (`createPlanDeriver`, `validatePlan`, `planErrorKeys`), 20, `intersectionArea`, `rotationFromFront`.
- Produces: `planPathToEntityId(path)`; `PlanCommandContext`, `PlanDefaults`, `defaultPlanDefaults(doc, exteriorThickness = 230): PlanDefaults` (900/2100 doors, 1200/1200/900 windows, 900/2100 openings); `PLAN_COMMAND_ERROR_CODES` (the 22 codes of 04 §6.7); `planPipeline: Pipeline<PlanDocument, PlanCommandContext>`; `executePlanCommand(doc, def, params, ctx)`; `postProcess(draft, info, out)`; `reconcileRoomMetas(draft, prevGeom, nextGeom): { deletedMetaIds: string[]; movedAnchors: string[] }`; `definePlanCommand<P, R>(def)` (typed identity helper); `PLAN_COMMANDS` (registry object; empty here, each later task adds its group); `createPlanBus({ initial, footprints, defaults?, newId?, maxHistory? })` (context = shared deriver + current geometry); `PlanCommandType`.

- [ ] **Step 1: Write the failing tests** — `planPathToEntityId`: `['walls','w_x','a'] → 'w_x'`, `['annotations','labels','t_x'] → 't_x'`, `['background','opacity'] → 'background'`, `['meta','x'] → 'meta'`, `['view','mode2d'] → null`, `['walls'] → '*'`. Pipeline with test-only commands defined in the test (`test.moveNodes`, `test.addRawWall` that writes a wall directly, `touchesGeometry: true`): orphaned related node deleted in phase 2; dimension attached to a wall `left` face recomputed from `leftFace` (rounded) and deleted when the wall is deleted (`out.deletedIds` lists it); placement attached to a moved wall follows the face (new `x,y` on the face, rotation `rotationFromFront`); a command creating a duplicate wall returns `introduces_error` with `params.issue 'plan.wall_duplicate'` and the doc is unchanged; on `makeDirtyPlan()` (pre-existing errors) a command that adds no new error succeeds; patches = phase1 + phase2, inverse = phase2⁻¹ + phase1⁻¹ (undo restores deep-equal). `reconcileRoomMetas` unit tests on hand-built before/after docs (derive both): (1) node move keeps every `metaId`; (2) wall between two named rooms removed → larger room's meta kept, other id in `deletedMetaIds`; (3) wall added splitting a named room → meta stays in the part containing its anchor, other part unnamed; (4) wall move leaving an anchor outside → anchor set to the new `labelPoint` (`movedAnchors`); (5) delete-and-redraw: meta orphaned (no change) then re-attaches when its face closes again; tie on equal areas → smallest id wins; `labelOffset` reset to null when outside the net polygon.
- [ ] **Step 2: Run it, expect FAIL** — `yarn vitest run resources/js/engine/plan/commands resources/js/engine/plan/__tests__/reconcile.test.ts`
- [ ] **Step 3: Implement** — 04 §6.4 steps 1–5 and the four post-process steps (only entities related to `changed`); reconcile per 04 §4.4(b) items 1–7 (`intersectionArea ≥ 0.2 × min(area)` candidates; merge rule by previous area; anchor maintenance with `ANCHOR_MIN_CLEARANCE`).
- [ ] **Step 4: Run tests, expect PASS** — same command.
- [ ] **Step 5: Quality gates** — `yarn eslint resources/js/engine && yarn prettier --check resources/js/engine && yarn vue-tsc --noEmit`
- [ ] **Step 6: Commit** — `git add resources/js/engine/plan resources/js/engine/index.ts` → `feat(engine): add plan command pipeline with post-processing and room re-association`

