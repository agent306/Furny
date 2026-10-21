### Task 7: Fixture library data + room-name dictionary

**Files:**
- Create: `resources/js/engine/plan/fixtures.ts`, `resources/js/engine/plan/roomNames.ts`, `resources/js/engine/plan/roomTypes.ts`
- Test: `resources/js/engine/plan/__tests__/fixtures.test.ts`, `roomNames.test.ts`

**Spec refs:** `05 §9.1`, `05 §9.4` (35 entries, normative data), `05 §9.5`, `06 §7.8` (ROOM_NAMES list), `03 §1` (`RoomType`)

**Interfaces:**
- Consumes: —
- Produces: `ROOM_TYPES` (the 19 `RoomType` values of 03 §1, `as const`) and `type RoomType`; `FIXTURE_KEYS` (35 keys in 05 §9.4 table order), `type FixtureKey`, `FixtureCategory`, `FixtureMaterialKey`, `Fixture2DItem`, `FixturePrimitive`, `FixtureDef`, `FIXTURE_LIBRARY: Record<FixtureKey, FixtureDef>`; `ROOM_NAMES: Record<string, RoomType>` (keys upper-case, from 06 §7.8, `BATH`/`BATHROOM` → `bathroom`), `suggestRoomType(name: string): RoomType`.

- [ ] **Step 1: Write the failing tests** — `FIXTURE_KEYS.length === 35`, first `'bed_single'`, last `'car'`; defaults spot checks: `bed_double` 1400×1900×900 elev 0; `tv` elevation 900; `sink` 800×500×50 elev 850 `noConflict`; `hob` and `rug` `noConflict`; every other key `noConflict === false`; `water_heater` elevation 1600; every `symbol2d(w,d)` item at default size (and 50 %/200 %) has normalised coordinates within `[−0.5, 0.5] × [0, 1]` (05 §9.5; decals ≤ 1.05 allowed); `sofa_l` and `kitchen_counter_l` builders use the absolute-mm formulas (`s = min(900, 0.6·min(W,D))`, `a = min(600, 0.45·min(W,D))`); `primitives3d` non-empty for all 35. `suggestRoomType('Master Bedroom') === 'master_bedroom'`, `'M.BED' → 'master_bedroom'`, `'Bed Room' → 'bedroom'`, `'Living/Dining' → 'living'`, `'Kitchn' → 'kitchen'` (fuzzy ratio ≥ 0.8), `'W.C' → 'toilet'`, `'Bathroom' → 'bathroom'`, `'Sit out' → 'balcony'`, `'Open to sky' → 'ots'`, `'xyz' → 'other'`; multiword phrases win over single words (`'MASTER BEDROOM'` is not `bedroom`).
- [ ] **Step 2: Run it, expect FAIL** — `yarn vitest run resources/js/engine/plan`
- [ ] **Step 3: Implement** — transcribe 05 §9.4 into `FixtureDef`s (2D notation `R/E/L/P`, 3D `B/C/S`, `Legs(t, z1, mat)` helper); `nameKey = 'plan_editor.fixtures.' + key`. `suggestRoomType`: upper-case, strip punctuation except `/`, try multiword keys longest first, then per-word Levenshtein ratio `1 − dist/max(len)` ≥ 0.8.
- [ ] **Step 4: Run tests, expect PASS** — same command.
- [ ] **Step 5: Quality gates** — `yarn eslint resources/js/engine && yarn prettier --check resources/js/engine && yarn vue-tsc --noEmit`
- [ ] **Step 6: Commit** — `git add resources/js/engine/plan resources/js/engine/index.ts` → `feat(engine): add fixture library and room-name suggestions`

