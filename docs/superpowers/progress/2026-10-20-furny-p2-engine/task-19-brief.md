### Task 19: `svgFromDrawing` + hit index

**Files:**
- Create: `resources/js/engine/plan/drawing/svg.ts`, `resources/js/engine/plan/hitIndex.ts`
- Test: `resources/js/engine/plan/drawing/__tests__/svg.test.ts`, `resources/js/engine/plan/__tests__/hitIndex.test.ts`

**Spec refs:** `04 §8.3`, `04 §5.12`, `04 §9` (drawing row)

**Interfaces:**
- Consumes: Task 18, Tasks 15–16.
- Produces: `SvgExportOptions`, `svgFromDrawing(d, o): string`; `HitKind`, `Hit`, `HitLayerMask`, `HitIndex`, `buildHitIndex(doc, geom, drawing, footprints)`, `hitTest(index, p, zoom, pointerType, layers): Hit[]`, `hitTestRect(index, min, max, mode): string[]`.

- [ ] **Step 1: Write the failing tests** — a room named `<script>alert(1)</script> & "x"` appears escaped (`&lt;script&gt;…&amp; &quot;x&quot;`) and the output contains no `<script`; one `<g id="layer-WALLS">` per layer in paint order and `<g data-entity="w_…">` per group; a poly with holes is one `<path fill-rule="evenodd">`; every number has ≤ 2 decimals (regex scan); arcs use SVG `A` commands; hatch styles emit one `<pattern patternUnits="userSpaceOnUse">`; background image is the only `href`. Hit index: a point inside an opening's cut wins over the wall; node within tolerance wins over wall; stacked placements → higher `elevation + height` first; room hit inside its net polygon only when nothing else; `hitTestRect` window selects only fully-inside entities, crossing selects walls by outline but never rooms.
- [ ] **Step 2: Run it, expect FAIL** — `yarn vitest run resources/js/engine/plan/drawing/__tests__/svg.test.ts resources/js/engine/plan/__tests__/hitIndex.test.ts`
- [ ] **Step 3: Implement** — XML-escape `& < > " '` in all text and attribute values; numbers via `toFixed(2)` stripped of trailing zeros; hit priority order of 04 §5.12.
- [ ] **Step 4: Run tests, expect PASS** — same command.
- [ ] **Step 5: Quality gates** — `yarn eslint resources/js/engine && yarn prettier --check resources/js/engine && yarn vue-tsc --noEmit`
- [ ] **Step 6: Commit** — `git add resources/js/engine/plan resources/js/engine/index.ts` → `feat(engine): export drawings to SVG and add hit testing`

