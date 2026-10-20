# 04 — Geometry Engine (units, wall graph, rooms, snapping, commands)

Read the master document, `01-architecture.md`, `02-data-model.md` and `03-design-documents.md` first. This file is **normative** for everything under:

- `resources/js/engine/units/`
- `resources/js/engine/geometry/`
- `resources/js/engine/plan/` (except `schema.ts` and `migrate.ts`, which implement `03` §1 and §4 verbatim)
- `resources/js/engine/commands/` (generic command bus)

It is consumed by the plan editor (`05-plan-editor.md`), the blueprint import review (`06`), the engine CLI (`01` §5.4: `validate-plan`, `plan-summary`) and the Web Worker (`01` §5.5).

The engine contract from `01` §5.1 applies to every file here: **no imports from `vue`, `three`, `@tresjs/*`, DOM globals (`window`, `document`, `HTMLCanvasElement`, `Image`, `localStorage`) or `fetch`.** Allowed imports: `zod`, `mutative`, `clipper2-ts`, `earcut`, `flatbush`, `nanoid`, and the built-in `Intl` object.

---

## 0. Scope, files and global conventions

### 0.1 File map

| File | Exports (public ones are re-exported from `engine/index.ts`) |
|---|---|
| `engine/units/types.ts` | `UnitSystem`, `LengthUnit`, `UnitPrefs`, `ParseLengthContext`, `ParseLengthResult`, `ParseLengthError` |
| `engine/units/parse.ts` | `parseLength`, `normalizeLengthInput` (internal, exported for tests) |
| `engine/units/format.ts` | `formatLength`, `formatArea`, `formatAngle`, `MM_PER_INCH`, `MM_PER_FOOT`, `MM2_PER_FT2` |
| `engine/geometry/tolerance.ts` | tolerance constants (§0.3) |
| `engine/geometry/vec2.ts` | `Vec2`, vector helpers (§2.2) |
| `engine/geometry/segment.ts` | segment helpers, `intersectSegments` (§2.4) |
| `engine/geometry/polygon.ts` | `signedArea`, `polygonCentroid`, `pointInPolygon`, `perimeter`, `simplifyCollinear`, `ensureCW` (§2.5) |
| `engine/geometry/clip.ts` | the **only** importer of `clipper2-ts` (§2.6) |
| `engine/geometry/triangulate.ts` | the **only** importer of `earcut` (§2.7) |
| `engine/geometry/planarFaces.ts` | `buildPlanarGraph`, `walkFaces` (§4.1–4.3) |
| `engine/geometry/polylabel.ts` | `polylabel` (§4.7) |
| `engine/geometry/hash.ts` | `cyrb53` (§4.6) |
| `engine/plan/derive.ts` | `derivePlanGeometry`, `createPlanDeriver` (§3, §4, §7) |
| `engine/plan/walls.ts` | `computeNodeJoins`, `buildWallOutline` (§3) |
| `engine/plan/rooms.ts` | `detectRooms`, `associateRoomMetas` (§4) |
| `engine/plan/reconcile.ts` | `reconcileRoomMetas` (§4.4) |
| `engine/plan/footprint.ts` | `placementFootprint`, `fixtureFootprint`, `frontVector`, `rotationFromFront` (§5.8) |
| `engine/plan/conflicts.ts` | `computePlacementConflicts`, `doorSwingSectors` (§5.9) |
| `engine/plan/snapping.ts` | `buildSnapIndex`, `snapPoint`, `snapFootprint`, `snapOpeningPosition`, `gridStepFor` (§5) |
| `engine/plan/hitIndex.ts` | `buildHitIndex`, `hitTest`, `hitTestRect` (§5.12) |
| `engine/plan/validate.ts` | `validatePlan(doc: PlanDocument, geom?: DerivedPlan): Issue[]` — rules from `03` §1.1 except the server-only `plan.placement_design_missing`; memoised by document identity (last 4 documents) |
| `engine/plan/summary.ts` | `planSummary` (§4.8) |
| `engine/plan/fixtures.ts` | `FIXTURE_KEYS`, `FIXTURE_LIBRARY` (data; content normative in `05` §9) |
| `engine/plan/roomNames.ts` | `ROOM_NAMES`, `suggestRoomType(name: string): RoomType` — content normative in `06` (mirrors `vision/app/utils/roomnames.py`); used by the editor's room naming (`05` §8.2) |
| `engine/plan/commands/*.ts` | one file per command group (§6.6) + `registry.ts`, `helpers.ts`, `postprocess.ts` |
| `engine/plan/drawing/*.ts` | `buildPlanDrawing`, `drawWall`, `drawOpening`, `drawRoom`, `drawPlacement`, `drawFixture`, `drawDimension`, `drawLabel`, `autoDimensions`, `svgFromDrawing` (§8) |
| `engine/plan/testing/fixtures.ts` | `makeRectPlan`, `makeGridPlan`, `makeLPlan` test document builders (§9) |
| `engine/commands/bus.ts` | `createCommandBus` generic (§6.1–6.3) |
| `engine/commands/types.ts` | `CommandDef`, `CommandResult`, `HistoryEntry`, `BusEvent` |

### 0.2 Conventions

1. **Document values** (anything stored in a `PlanDocument`) are integer mm (`03`). Every command rounds coordinates with `roundMm(v) = Math.sign(v) * Math.round(Math.abs(v))` (round half away from zero) before writing.
2. **Derived values** (outlines, intersections, centroids, label points) are `number` floats and are **never written back** into the document except through `roundMm`. The derived types reuse the structural shape `{ x: number; y: number }` (`Vec2`), which is assignable to `03`'s `Point`.
3. Angles inside the engine are radians unless a name ends in `Deg`. Document angles (`rotation`, `northAngle`) are degrees normalised to `[0, 360)` with `normDeg(d) = ((d % 360) + 360) % 360`, and rounded to 0.01° when written (`Math.round(d * 100) / 100`).
4. Functions never mutate their inputs. Commands mutate only the `mutative` draft passed to them.
5. Every user-visible message is a translation key (`messageKey`) plus `params`; the engine never produces English sentences. Key prefixes: `engine.units.*`, `engine.plan.command.*`, `engine.plan.derive.*`, `engine.plan.snap.*`, `engine.plan.conflict.*`.

### 0.3 Tolerances and constants (`engine/geometry/tolerance.ts`)

| Constant | Value | Meaning / rationale |
|---|---|---|
| `EPS` | `0.5` (mm) | Two points closer than this are the same point; a point closer than this to a line is on it. Half the storage resolution. |
| `ANGLE_TOL_DEG` | `0.5` | Two directions within 0.5° are parallel/collinear. Rounding a node to integer mm on a ≥ 100 mm wall moves its direction by < 0.41°. |
| `ANGLE_TOL` | `ANGLE_TOL_DEG * Math.PI / 180` | radians |
| `NODE_MERGE_TOL` | `5` (mm) | Command-level: a new endpoint within 5 mm of an existing node joins it; within 5 mm of a wall centre line splits that wall. Below any meaningful site-measurement precision. |
| `MIN_WALL_LENGTH` | `10` (mm) | `03` §1.1 `plan.wall_degenerate`. |
| `MITER_LIMIT` | `4` | Miter length / half thickness. Same as the SVG default; corners sharper than ≈ 29° get a bevel. |
| `CLIPPER_SCALE` | `1000` | mm → integer µm before calling Clipper (`Clipper64`), exact for our coordinate range (±1e6 mm → ±1e9 µm, far below 2^53). |
| `MIN_ROOM_NET_AREA` | `40_000` (mm²) | Faces whose net polygon is smaller than 200 × 200 mm are slivers, not rooms. |
| `ANCHOR_MIN_CLEARANCE` | `100` (mm) | A RoomMeta anchor closer than this to its face boundary is moved to the label point (§4.4). |
| `MAX_COORD` | `1_000_000` (mm) | `03` §1.1 coordinate range. |

### 0.4 Shared result shapes

```ts
// engine/plan/types.ts
export interface EngineMessage { code: string; messageKey: string; params: Record<string, string | number> }
export interface DeriveIssue extends EngineMessage { severity: 'warning' | 'info'; entityIds: string[] }
export type Result<T, E = EngineMessage> = { ok: true; value: T } | { ok: false; error: E };
```

`Issue` (from `03` §3.1) is used by `validatePlan`; `DeriveIssue` is only produced by derivation, is never saved, and is shown by the editor in its "Checks" popover (`05` §10.4).

---

## 1. Units (`engine/units/`)

### 1.1 Types

```ts
export type UnitSystem = 'metric' | 'imperial';
export type LengthUnit = 'mm' | 'cm' | 'm' | 'ftin' | 'in';   // = users.length_unit values (02 §1.1)

export interface UnitPrefs {
  system: UnitSystem;
  unit: LengthUnit;          // metric: mm|cm|m, imperial: ftin|in. A mismatched pair is coerced: metric+ftin/in → mm, imperial+mm/cm/m → ftin.
  locale: string;            // BCP-47, from auth.user.locale; 'en' in v1
}

export interface ParseLengthContext {
  unit: LengthUnit;          // unit for bare numbers (master §6.1)
  allowNegative?: boolean;   // default false
  allowZero?: boolean;       // default true
  min?: number;              // mm, inclusive; default allowNegative ? -MAX_COORD : 0
  max?: number;              // mm, inclusive; default MAX_COORD
}

export type ParseLengthErrorCode =
  | 'empty' | 'syntax' | 'unknown_unit' | 'negative' | 'zero'
  | 'too_small' | 'too_large' | 'division_by_zero';

export interface ParseLengthError {
  code: ParseLengthErrorCode;
  messageKey: `engine.units.error.${ParseLengthErrorCode}`;
  params: { min?: number; max?: number; unit?: string };   // min/max in mm; the UI formats them with formatLength
}

export type ParseLengthResult =
  | { ok: true; mm: number; rounded: boolean }   // mm is an integer; rounded = true if the exact value was not an integer mm
  | { ok: false; error: ParseLengthError };
```

### 1.2 `parseLength(input: string, ctx: ParseLengthContext): ParseLengthResult`

**Step 1 — normalisation** (`normalizeLengthInput`):

1. If `input` is not a string, or `input.trim() === ''` → error `empty`.
2. Apply `input.normalize('NFKC')`.
3. Character mapping: `′ ’ ‘ ‛ ´ \`` → `'`; `″ “ ” ‟ 〃` → `"`; the two-character sequence `''` → `"`; `−` (U+2212), `–` (U+2013) → `-`; every whitespace character (incl. NBSP U+00A0, tab) → a single ASCII space.
4. Lower-case (`toLowerCase()`), collapse runs of spaces to one, trim.
5. Sign: if the string starts with `-` or `+`, record `negative = (char === '-')`, remove it and trim again.
6. Commas:
   - If the string matches `^\d{1,3}(,\d{3})+(\.\d+)?` at its start (thousands groups), remove those commas (`3,200` → `3200`, `1,234.5mm` → `1234.5mm`).
   - Else if the string contains exactly one `,` and no `.`, replace the comma with `.` (decimal comma: `3,2 m` → `3.2 m`).
   - Else if any `,` remains → error `syntax`.

**Step 2 — pattern matching.** Define these regex fragments (all applied to the normalised string, full-match `^…$`):

```
NUM     = (\d+(?:\.\d*)?|\.\d+)
INCHVAL = (?:(\d+)[ -](\d+)\/(\d+)|(\d+)\/(\d+)|NUM)        // mixed number | fraction | decimal
MUNIT   = (mm|millimet(?:er|re)s?|cm|centimet(?:er|re)s?|m|met(?:er|re)s?)
FUNIT   = (?:'|ft|foot|feet)
IUNIT   = (?:"|in|inch|inches)
```

Try in this order; the first match wins:

| # | Pattern | Meaning |
|---|---|---|
| P1 | `NUM ?MUNIT` | metric value |
| P2 | `NUM ?FUNIT ?-? ?INCHVAL ?IUNIT?` | feet + inches (inch unit optional after a feet part: `10'6`, `10ft6`) |
| P3 | `NUM ?FUNIT` | feet only |
| P4 | `INCHVAL ?IUNIT` | inches only (`6"`, `6 1/2"`, `1/2in`, `126in`) |
| P5 | `INCHVAL` | bare number; fractions/mixed numbers allowed **only** if `ctx.unit ∈ {'in','ftin'}`, otherwise `syntax` |
| P6 | `NUM ?[a-z]+` | a number followed by an unrecognised word → `unknown_unit` (params.unit = the word) |
| — | anything else | `syntax` |

**Step 3 — value.** Compute a float `v` in mm:

- `mm`/`millimet…` × 1, `cm`/`centimet…` × 10, `m`/`met…` × 1000.
- Feet × `MM_PER_FOOT = 304.8`; inches × `MM_PER_INCH = 25.4`; feet+inches = feet × 304.8 + inches × 25.4. An inches part ≥ 12 is accepted (`10' 14"` = 11' 2"). Rationale: lenient input never hurts; the formatted echo shows the normalised value.
- Fraction `a/b`: if `b === 0` → `division_by_zero`. Mixed `n a/b` = `n + a/b`. Any positive integer denominator is accepted.
- Bare (P5): × 1 (`mm`), × 10 (`cm`), × 1000 (`m`), × 25.4 (`in`), × 25.4 (`ftin`: **bare numbers are inches**, as in SketchUp/AutoCAD architectural units; rationale: one consistent rule, and the echo makes the interpretation visible).

**Step 4 — finish.**

1. `if (negative) v = -v`.
2. `mm = roundMm(v)`; `rounded = Math.abs(v - mm) > 1e-9`.
3. `mm < 0 && !ctx.allowNegative` → `negative`. `mm === 0 && ctx.allowZero === false` → `zero`.
4. `mm < min` → `too_small` (params.min); `mm > max` → `too_large` (params.max).
5. Return `{ ok: true, mm, rounded }`.

No arithmetic expressions in v1 (`3200+100` → `syntax`). Space-separated thousands (`3 200`) → `syntax` (ambiguous with mixed numbers).

### 1.3 `formatLength(mm: number, prefs: UnitPrefs, opts?: FormatLengthOptions): string`

```ts
export interface FormatLengthOptions {
  style?: 'editor' | 'summary';   // default 'editor'
  showUnit?: boolean;              // default true
  signed?: boolean;                // default false; true prefixes '+' for positive values
}
```

Unit symbols (`mm`, `cm`, `m`, `'`, `"`) are locale-independent technical symbols and are not translated. Numbers are formatted with `new Intl.NumberFormat(prefs.locale, { useGrouping: style === 'summary', minimumFractionDigits, maximumFractionDigits })`; cache formatters in a `Map` keyed by `locale|min|max|grouping`. Negative values are prefixed with `-` (ASCII hyphen-minus, so the result can be re-parsed).

| Unit | `editor` style | `summary` style |
|---|---|---|
| `mm` | integer + ` mm` (`3200 mm`) | `< 1000`: `850 mm`; `≥ 1000`: metres with exactly 2 decimals (`3.20 m`) |
| `cm` | up to 1 decimal, trailing zeros stripped (`320 cm`, `320.5 cm`) | same rule as `mm` summary |
| `m` | up to 3 decimals, trailing zeros stripped (`3.2 m`, `3.205 m`, `0.85 m`) | same rule as `mm` summary |
| `ftin` | `F' I N/D"` (below) | same as editor |
| `in` | total inches with fraction (`126"`, `126 1/2"`) | same as editor |

Imperial algorithm (exact integer arithmetic on eighths):

1. `n8 = Math.round(Math.abs(mm) / 25.4 * 8)` (round half up).
2. `ftin`: `feet = Math.floor(n8 / 96)`, `rem = n8 - feet * 96`, `inches = Math.floor(rem / 8)`, `e = rem % 8`. `in`: `feet = 0`, `inches = Math.floor(n8 / 8)`, `e = n8 % 8`.
3. Fraction text for `e` (reduced): 1→`1/8`, 2→`1/4`, 3→`3/8`, 4→`1/2`, 5→`5/8`, 6→`3/4`, 7→`7/8`.
4. Inch text: `e === 0` → `${inches}"`; `inches === 0 && e > 0` → `${frac}"`; else `${inches} ${frac}"`.
5. `ftin` with `feet > 0` → `${feet}' ${inchText}` (`10' 0"`, `10' 6 3/8"`); `feet === 0` → `inchText` only (`6"`, `0"`).
6. `showUnit: false` is ignored for imperial (the prime marks are the value syntax).

### 1.4 `formatArea(mm2: number, prefs: UnitPrefs): string` and `formatAngle(deg: number, locale: string): string`

- Metric: `mm2 / 1e6` with exactly 2 decimals + ` m²` (`12.35 m²`, `0.45 m²`).
- Imperial: `mm2 / MM2_PER_FT2` (`92_903.04`) rounded to an integer + ` ft²` (`133 ft²`), grouping on (`1,250 ft²`).
- `formatAngle`: up to 1 decimal, trailing zeros stripped, `°` suffix (`45°`, `22.5°`).

### 1.5 Test table (Vitest `engine/units/__tests__/parse.test.ts`, `format.test.ts`) — every row is a required test

**parseLength** (`ctx.unit = 'mm'` unless stated):

| Input | ctx | Result |
|---|---|---|
| `3200` | mm | 3200 |
| `3200mm` / `3200 mm` / `3200 MM` | mm | 3200 |
| `320cm` | mm | 3200 |
| `3.2m` / `3,2 m` / `3.2 metres` | mm | 3200 |
| `.5m` | mm | 500 |
| `3,200` | mm | 3200 |
| `1,234.5mm` | mm | 1235 (rounded = true) |
| `10'6"` / `10′6″` / `10’6”` / `10'-6"` / `10 ft 6 in` / `10ft6` | mm | 3200 (3200.4) |
| `10' 6 1/2"` | mm | 3213 (3213.1) |
| `10' 14"` | mm | 3404 (3403.6) |
| `5'11.5"` | mm | 1816 |
| `126in` | mm | 3200 |
| `10ft` / `10'` | mm | 3048 |
| `6"` | mm | 152 |
| `1/2"` | mm | 13 |
| `6 1/2` | in | 165 |
| `6-1/2"` | mm | 165 |
| `6 1/2` | mm | error `syntax` |
| `12` | cm | 120 |
| `1.5` | m | 1500 |
| `10` | ftin | 254 (bare = inches) |
| `0.5mm` | mm | 1 (rounded = true) |
| `-50` | mm, allowNegative | −50 |
| `-50` | mm | error `negative` |
| `0` | mm, allowZero false | error `zero` |
| `''` / `'   '` | mm | error `empty` |
| `abc` | mm | error `syntax` |
| `3200 kg` | mm | error `unknown_unit` (unit = `kg`) |
| `1/0"` | mm | error `division_by_zero` |
| `3 200` | mm | error `syntax` |
| `2000000` | mm | error `too_large` (max 1000000) |
| `50` | mm, min 300 | error `too_small` (min 300) |
| `1,2,3` | mm | error `syntax` |

**formatLength** (`locale 'en'`):

| mm | unit | style | Output |
|---|---|---|---|
| 3200 | mm | editor | `3200 mm` |
| 3205 | cm | editor | `320.5 cm` |
| 3200 | m | editor | `3.2 m` |
| 3205 | m | editor | `3.205 m` |
| 3200 | mm | summary | `3.20 m` |
| 850 | mm | summary | `850 mm` |
| 3200 | ftin | editor | `10' 6"` |
| 3213 | ftin | editor | `10' 6 1/2"` |
| 3048 | ftin | editor | `10' 0"` |
| 152 | ftin | editor | `6"` |
| 10 | ftin | editor | `3/8"` |
| 0 | ftin | editor | `0"` |
| −152 | ftin | editor | `-6"` |
| 3200 | in | editor | `126"` |
| 304 | ftin | editor | `1' 0"` (304 / 25.4 × 8 = 95.75 → 96 eighths: rounding carries into the next foot) |

**formatArea**: `12_350_000` metric → `12.35 m²`; same imperial → `133 ft²`; `0` → `0.00 m²`; `116_128_800` imperial → `1,250 ft²`.

**Round-trip property test**: for 2000 random integers `mm ∈ [0, 50 000]` and every metric unit, `parseLength(formatLength(mm, prefs), {unit}).mm === mm`. For imperial, `|parse(format(mm)) − mm| ≤ 2` (1/8" = 3.175 mm resolution).

### 1.6 Acceptance criteria — units

- [ ] Every row of §1.5 passes.
- [ ] `parseLength` never throws for any string input (fuzz test: 10 000 random strings from the alphabet `0-9 .,'"/-a-z′″` → returns a result object).
- [ ] Error results always carry a `messageKey` of the form `engine.units.error.<code>` and the keys exist in `resources/lang/en/engine.php`.

---

## 2. Geometry primitives (`engine/geometry/`)

### 2.1 Coordinate, orientation and normal conventions (normative — referenced by `03` §1 `Opening.swing`)

Plan space: **x → right, y → down** (screen convention), units mm (master §6.2).

1. **Wall direction.** For wall `w` with nodes `A = nodes[w.a]`, `B = nodes[w.b]`: `d = (B − A) / |B − A|`.
2. **Normal.** `n = (d.y, −d.x)`. `+n` is the **left** side of the wall when walking from `a` to `b` *as seen on screen*. Examples: `d = (1, 0)` (walking right) → `n = (0, −1)` (up on screen); `d = (0, 1)` (walking down the screen) → `n = (1, 0)` (screen right).
3. **Sides.** `side = 'left'` ⇔ `+n`; `side = 'right'` ⇔ `−n`. `Opening.swing = 'left'` means the door leaf swings into the `+n` half-plane. `FurniturePlacement.wallAttachment.side = 'left'` means the furniture stands on the `+n` side, back against the left face. `DimensionAnnotation.attachedTo.face = 'left'` measures the left face.
4. **Left/right faces.** `leftFace` is the boundary line at `+n · thickness/2`, `rightFace` at `−n · thickness/2`.
5. **Orientation test.** `orient(a, b, c) = (b.x − a.x)(c.y − a.y) − (b.y − a.y)(c.x − a.x)`. In y-down space `orient < 0` ⇔ `c` is on the **left** (`+n`) of `a→b`; `orient > 0` ⇔ right. `sideOf(a, b, c): -1 | 0 | 1` returns `+1` for left, `−1` for right, `0` if the distance from `c` to line `ab` is `≤ EPS`.
6. **Polygon winding.** `signedArea(p) = ½ Σ (x_i·y_{i+1} − x_{i+1}·y_i)`. In y-down space a polygon that is **clockwise on screen ("CW") has positive signed area.** Every polygon output by the engine (wall outlines, room polygons, poché parts, footprints) is CW (`signedArea > 0`); every hole is CCW (`signedArea < 0`).
7. **Angles.** `angleOf(v) = Math.atan2(v.y, v.x)` in `(−π, π]`. Increasing angle is **clockwise on screen**. Document rotations are clockwise degrees (master §6.2), so `rotation` and `angleOf` share orientation.
8. **Rotation of a vector by θ (clockwise on screen):** `rot(v, θ) = (v.x cosθ − v.y sinθ, v.x sinθ + v.y cosθ)`.
9. **Front vector of a placement/fixture** with rotation `θ` (deg): `frontVector(θ) = rot((0, 1), θ) = (−sin θ, cos θ)`. Inverse: `rotationFromFront(f) = normDeg(atan2(−f.x, f.y) · 180/π)`.
10. **Display direction** of a wall (status bar, wall-drawing direction input, `05` §7.3) is **counter-clockwise on screen from east**: `displayDeg = normDeg(−angleOf(d) · 180/π)`. This is the only CCW convention and exists only in the UI; it is never stored.

### 2.2 `vec2.ts`

```ts
export interface Vec2 { x: number; y: number }
export const v = (x: number, y: number): Vec2;
export function add(a: Vec2, b: Vec2): Vec2;
export function sub(a: Vec2, b: Vec2): Vec2;
export function scale(a: Vec2, k: number): Vec2;
export function dot(a: Vec2, b: Vec2): number;
export function cross(a: Vec2, b: Vec2): number;          // a.x*b.y − a.y*b.x
export function len(a: Vec2): number;
export function dist(a: Vec2, b: Vec2): number;
export function dist2(a: Vec2, b: Vec2): number;
export function normalize(a: Vec2): Vec2;                 // returns (0,0) for |a| < 1e-12
export function perpLeft(d: Vec2): Vec2;                  // (d.y, −d.x) — the +normal of §2.1
export function rot(a: Vec2, rad: number): Vec2;
export function lerp(a: Vec2, b: Vec2, t: number): Vec2;
export function angleOf(a: Vec2): number;
export function nearlyEqual(a: Vec2, b: Vec2, eps = EPS): boolean;
export function roundPoint(a: Vec2): Vec2;                // roundMm on both
export function normDeg(d: number): number;
export function isParallel(d1: Vec2, d2: Vec2, tol = ANGLE_TOL): boolean;   // |cross(n1,n2)| ≤ sin(tol)
```

### 2.3 Robustness rules

- Document coordinates are integers ≤ 1e6 in magnitude, so `orient` on three document points is computed **exactly** in IEEE doubles (products ≤ 4e12 < 2^53). Use it directly for topology decisions on document points.
- For derived (float) points, compare against tolerances: collinearity uses distance-to-line `≤ EPS`, never `orient === 0`.
- Line–line intersection: `t = cross(c − a, s) / cross(r, s)` with `r = b − a`, `s = d − c`. If `|cross(normalize(r), normalize(s))| ≤ sin(ANGLE_TOL)` the lines are parallel → caller-specific fallback (never divide).
- All functions that cluster or dedupe points use a spatial hash with cell size `1` mm and check the 9 neighbouring cells against `EPS`.

### 2.4 `segment.ts`

```ts
export interface Seg { a: Vec2; b: Vec2 }
export function segLength(s: Seg): number;
export function projectParam(p: Vec2, s: Seg): number;           // t along s, unclamped (0 at a, 1 at b)
export function closestPointOnSeg(p: Vec2, s: Seg): { point: Vec2; t: number; dist: number };
export function distPointLine(p: Vec2, a: Vec2, b: Vec2): number; // infinite line
export type SegIntersection =
  | { kind: 'none' }
  | { kind: 'point'; point: Vec2; t: number; u: number }          // t on s1, u on s2 in [0,1] (within EPS-equivalent)
  | { kind: 'overlap'; t0: number; t1: number; u0: number; u1: number }; // collinear overlap interval on s1 (t0<t1) and matching params on s2
export function intersectSegments(s1: Seg, s2: Seg, eps = EPS): SegIntersection;
export function lineIntersection(p: Vec2, dp: Vec2, q: Vec2, dq: Vec2): Vec2 | null; // null if parallel
```

`intersectSegments` algorithm:
1. If parallel (§2.3): if `distPointLine(s2.a, s1.a, s1.b) > eps` → `none`. Else project `s2.a`, `s2.b` on `s1` → `[t0, t1]` (sorted), intersect with `[0, 1]`; if the overlap length × |s1| `> eps` → `overlap`; if it is a single point (touching end to end) → `point`; else `none`.
2. Else compute `t`, `u`. Convert `eps` to parameter tolerance `et = eps/|s1|`, `eu = eps/|s2|`. If `t ∈ [−et, 1+et]` and `u ∈ [−eu, 1+eu]` → `point` with `t`, `u` clamped to `[0,1]`; else `none`.

### 2.5 `polygon.ts`

```ts
export type Ring = Vec2[];                          // not closed (first point is not repeated)
export interface PolygonWithHoles { outer: Ring; holes: Ring[] }
export function signedArea(r: Ring): number;
export function area(p: PolygonWithHoles): number;  // |outer| − Σ|holes|
export function perimeter(r: Ring): number;
export function polygonCentroid(p: PolygonWithHoles): Vec2;   // area-weighted; for |area| < 1 returns vertex average
export function pointInRing(pt: Vec2, r: Ring, eps = EPS): 'inside' | 'outside' | 'boundary';
export function pointInPolygon(pt: Vec2, p: PolygonWithHoles, eps = EPS): 'inside' | 'outside' | 'boundary';
export function ensureCW(r: Ring): Ring;            // reverses if signedArea < 0
export function ensureCCW(r: Ring): Ring;
export function simplifyCollinear(r: Ring, eps = EPS): Ring; // removes vertices within eps of the line through neighbours and duplicate vertices
export function ringBBox(r: Ring): { min: Vec2; max: Vec2 };
export function distToRing(pt: Vec2, r: Ring): number;
export function signedDistToPolygon(pt: Vec2, p: PolygonWithHoles): number; // > 0 inside
export function isAxisRectangle(r: Ring, angleTol = ANGLE_TOL): { width: number; depth: number; angle: number } | null; // 4 vertices after simplifyCollinear, all corners 90° ± tol
```

`pointInRing`: first check `distToRing ≤ eps` → `boundary`; otherwise the standard even–odd ray cast toward +x.

### 2.6 `clip.ts` — Clipper2 wrapper

The rest of the engine calls only these functions; all `clipper2-ts` API names live here. Implementation: scale every coordinate by `CLIPPER_SCALE` and `Math.round` to build `Path64`s, run the Clipper64 operation with `FillRule.NonZero`, scale results back by `1/CLIPPER_SCALE`, drop rings with `|area| < 1 mm²`, return outer rings CW and holes CCW (§2.1-6), nesting holes under the outer ring that contains their first vertex (use Clipper's `PolyTree64` output when the operation supports it, otherwise compute nesting with `pointInRing`). If the exact exported names in `clipper2-ts 2.0.1-18` differ from the C# Clipper2 names (`Clipper.Union`, `Clipper.Difference`, `Clipper.Intersect`, `Clipper.InflatePaths`, `JoinType.Miter`, `EndType.Polygon`), adapt inside this file only.

```ts
export function union(polys: PolygonWithHoles[]): PolygonWithHoles[];
export function difference(subject: PolygonWithHoles[], clip: PolygonWithHoles[]): PolygonWithHoles[];
export function intersection(a: PolygonWithHoles[], b: PolygonWithHoles[]): PolygonWithHoles[];
export function offset(polys: PolygonWithHoles[], delta: number, join: 'miter' | 'square' | 'round', miterLimit = MITER_LIMIT): PolygonWithHoles[];
export function intersectionArea(a: PolygonWithHoles[], b: PolygonWithHoles[]): number;
```

`union`, `difference`, `intersection`, `offset`, `intersectionArea` (and `triangulate`, §2.7) are **public** (re-exported from `engine/index.ts`): the editor's 3D builders use them (`05` §5.2–5.3).

### 2.7 `triangulate.ts`

```ts
export function triangulate(p: PolygonWithHoles): { positions: Float64Array; indices: Uint32Array };
```
Flattens outer + holes into earcut's input (`earcut(flat, holeIndices, 2)`), returns 2D positions (mm) and triangle indices. Used by the 3D floor builder (`05` §5.3) and tests. Output triangles are re-ordered so each triangle is CW in plan space.

### 2.8 Acceptance criteria — primitives

- [ ] `sideOf((0,0),(1000,0),(500,−10)) === 1` (left), `sideOf((0,0),(1000,0),(500,10)) === −1`.
- [ ] `signedArea([(0,0),(10,0),(10,10),(0,10)]) === 100` (CW on screen).
- [ ] `frontVector(0) ≈ (0,1)`, `frontVector(90) ≈ (−1,0)`, `rotationFromFront((1,0)) === 270`.
- [ ] `intersectSegments` returns `overlap` for `((0,0),(100,0))` vs `((50,0.3),(150,0.3))` and `point` at `(50,0)` for a perpendicular crossing; `none` for parallel lines 1 mm apart.
- [ ] `clip.union` of two overlapping 100×100 squares offset by 50 returns one ring of area 15 000 (±1).

---

## 3. Wall graph and wall outlines (`engine/plan/walls.ts`)

### 3.1 Derived types (extend `03` §1.2 `PlanGeometry`; every field of `PlanGeometry` keeps its `03` meaning)

```ts
export interface WallEnd {
  left: Vec2;          // corner on the left face line at this end
  right: Vec2;         // corner on the right face line at this end
  via: Vec2[];         // extra outline points between the two corners (node point and/or bevel midpoints), in outline order
  joint: 'free' | 'miter' | 'bevel' | 'junction'; // free = dangling square end; junction = node degree ≥ 3
}

export interface DerivedWall {
  // --- fields from 03 PlanGeometry.walls[id] ---
  centerline: [Vec2, Vec2];
  outline: Vec2[];                 // CW: [endA.left, endB.left, ...endB.via, endB.right, endA.right, ...endA.via]
  leftFace: [Vec2, Vec2];          // [endA.left, endB.left]
  rightFace: [Vec2, Vec2];         // [endA.right, endB.right]
  length: number;                  // centre-line length (float)
  openings: Array<{ id: string; u0: number; u1: number }>;  // sorted by u0
  // --- engine extensions ---
  id: string;
  dir: Vec2; normal: Vec2;         // §2.1
  thickness: number; height: number; kind: Wall['kind'];
  endA: WallEnd; endB: WallEnd;
  leftRoomKey: string | null;      // faceKey of the room on the +n side, null = outside/none
  rightRoomKey: string | null;
  exteriorSide: 'left' | 'right' | null; // side facing outside (exactly one side has no room), else null
  pocheParts: PolygonWithHoles[];  // outline minus opening cut rectangles (§3.7)
  safeU: [number, number];         // u-range where both faces are full-depth (between the inner-most corners), for 3D holes (§3.6)
}

export interface DerivedOpening {
  id: string; wallId: string;
  u0: number; u1: number; center: Vec2;      // center on the centre line
  cut: Vec2[];                              // CW rectangle across the full wall thickness from u0 to u1
  jambStart: { left: Vec2; right: Vec2 };   // face points at u0
  jambEnd: { left: Vec2; right: Vec2 };     // face points at u1
  swingSign: 1 | -1;                        // +1 = swings to +n ('left')
  hingeU: number;                           // u0 if hinge 'start', u1 if 'end'
  issues: DeriveIssue[];                    // engine.plan.derive.opening_in_junction, opening_clamped
}
```

`derivePlanGeometry` returns `DerivedPlan` (§7.1), which contains `walls: Record<string, DerivedWall>` and `openings: Record<string, DerivedOpening>`.

### 3.2 Adjacency

1. Skip (and emit `DeriveIssue` `engine.plan.derive.wall_skipped`, severity warning) every wall whose `a`/`b` node is missing, whose `a === b`, or whose length `< EPS`.
2. `incident: Map<nodeId, string[]>` lists the valid walls at each node.
3. For each wall and each of its end nodes `N`, the **outgoing direction** from `N` is `u = normalize(other − N)` and its angle `α = angleOf(u)`.

### 3.3 Node joins — `computeNodeJoins(nodeId, ctx): Map<wallId, WallEnd>`

For node `N` with incident walls `W = [w_0 … w_{k−1}]`:

**k = 1 (dangling end).** `left = N + n_w·t/2`, `right = N − n_w·t/2` where `n_w` is the wall's own normal (§2.1, defined by its `a→b` direction, not by the outgoing direction). `via = []`, `joint = 'free'`.

**k ≥ 2.**

1. Sort walls by outgoing angle `α` ascending (= clockwise on screen). Ties (two walls with identical outgoing direction within `ANGLE_TOL`, i.e. overlapping walls) are broken by wall id; they are treated as a parallel pair (step 4).
2. For each wall `w_i`, its two side lines at `N`:
   - `cwSide_i = rot90cw(u_i) = (−u_i.y, u_i.x)` — the side facing the next wall clockwise.
   - `ccwSide_i = (u_i.y, −u_i.x)` — the side facing the previous wall.
   - The lines are `L_i^cw: N + cwSide_i·t_i/2 + s·u_i` and `L_i^ccw: N + ccwSide_i·t_i/2 + s·u_i`.
3. For each consecutive pair `(i, j = (i+1) mod k)` compute the wedge corner between `L_i^cw` and `L_j^ccw`:
   - `B_i = N + cwSide_i·t_i/2`, `B_j = N + ccwSide_j·t_j/2` (the side points exactly at the node).
   - If `isParallel(u_i, u_j)` (collinear continuation or overlap) → **parallel case** (step 4).
   - Else `P = lineIntersection(B_i, u_i, B_j, u_j)`.
   - **Miter is valid iff** `|P − N| ≤ MITER_LIMIT · max(t_i, t_j)/2` **and** `dot(P − N, u_i) ≤ len_i/2` **and** `dot(P − N, u_j) ≤ len_j/2` (the corner must not run past the middle of either wall).
   - Miter valid → wall `i`'s cw corner = `P`, wall `j`'s ccw corner = `P` (the **same** object value, so adjacent outlines share the vertex exactly).
   - Miter invalid → **bevel**: `M = (B_i + B_j)/2`; wall `i`'s cw corner = `B_i` with extra via point `M`; wall `j`'s ccw corner = `B_j` with extra via point `M`.
4. **Parallel case:** wall `i`'s cw corner = `B_i`, wall `j`'s ccw corner = `B_j`. If `|B_i − B_j| ≤ EPS` (equal thickness, straight continuation) they are the same point (use `B_i` for both). If not (different thicknesses), the outline gets a perpendicular step: no via points are needed because the next step adds `N`.
5. Map each wall's corners to its own `left`/`right`: if `N` is the wall's node `a`, its outgoing direction is `+d`, so `cwSide = (−d.y, d.x) = −n` → the **cw corner is the right corner** and the ccw corner is the left corner. If `N` is node `b`, outgoing is `−d`, `cwSide = +n` → the **cw corner is the left corner**.
6. `via` for k ≥ 2: the point `N` itself, plus any bevel midpoints, ordered so the outline stays simple:
   - At end **B** (outline goes `…endB.left → via → endB.right…`): `via = [M_ccw?, N, M_cw?]` where `M_ccw` is the bevel midpoint shared with the wall on the left-corner side, `M_cw` the one on the right-corner side (each present only if that wedge was bevelled). Order them so that walking from `left` to `right` passes left-side bevel midpoint, `N`, right-side bevel midpoint.
   - At end **A** (outline goes `…endA.right → via → endA.left`): mirrored order (`[M_right?, N, M_left?]`).
   - For k = 2 with equal thickness and both corners collinear with `N` within `EPS`, omit `N` (it lies on the miter line) — keeps 2-wall corners as clean quadrilaterals.
7. `joint` = `'junction'` if k ≥ 3, else `'miter'` if no bevel happened, else `'bevel'`.

Rationale: adding `N` makes every wall polygon a closed shape that, together with its neighbours, **tessellates the junction without gaps or overlaps** for any number of walls and any thicknesses (each wedge region is split along the line corner–`N`).

### 3.4 Outline assembly — `buildWallOutline(wall, endA, endB): Vec2[]`

`outline = [endA.left, endB.left, ...endB.via, endB.right, endA.right, ...endA.via]`, then `simplifyCollinear(…, EPS)` and `ensureCW`. If the result has fewer than 3 vertices or `signedArea ≤ 1` (degenerate, such as two corners crossed due to an extremely acute junction), fall back to the plain rectangle (`N ± n·t/2` at both ends, no miters) and emit `DeriveIssue` `engine.plan.derive.outline_fallback` (warning) for the wall. Fallback outlines may overlap neighbours; the 2D renderer strokes the union (`05` §4.4) so overlaps are invisible.

### 3.5 Faces and room sides

`leftFace = [endA.left, endB.left]`, `rightFace = [endA.right, endB.right]`. `leftRoomKey`/`rightRoomKey` come from the face walk (§4.2: the bounded face of half-edge `u→v` lies on its **right**), mapped through the planar-graph edge(s) that originate from this wall. If different sub-edges of a wall (a wall crossed by another wall without a node) border different faces, use the face of the longest sub-edge. `exteriorSide = 'left'` if `leftRoomKey === null && rightRoomKey !== null`, `'right'` in the mirrored case, else `null`.

### 3.6 Opening frames

For each opening `o` on wall `w` (skip with `DeriveIssue` `engine.plan.derive.opening_skipped` if the wall is missing/skipped):

1. `u0 = o.offset − o.width/2`, `u1 = o.offset + o.width/2` (float; not clamped — out-of-bounds openings are caught by `validatePlan`, but derivation clamps to `[0, length]` for drawing and emits `engine.plan.derive.opening_clamped`).
2. `pointAt(u) = A + d·u`; `jamb(u) = { left: pointAt(u) + n·t/2, right: pointAt(u) − n·t/2 }`.
3. `cut = ensureCW([jamb(u0).left, jamb(u1).left, jamb(u1).right, jamb(u0).right])`, then extended by `0.5` mm beyond each face along `±n` so Clipper differences remove the full thickness.
4. `swingSign = o.swing === 'left' ? 1 : −1`; `hingeU = o.hinge === 'start' ? u0 : u1`.
5. `safeU` for the wall: `uMin = max(0, dot(endA.left − A, d), dot(endA.right − A, d))`, `uMax = min(length, dot(endB.left − A, d), dot(endB.right − A, d))`. If `u0 < uMin` or `u1 > uMax` add `DeriveIssue` `engine.plan.derive.opening_in_junction` (info) — the 3D builder clips the hole to `safeU` (`05` §5.2).

### 3.7 Poché parts

`pocheParts = difference([{ outer: outline, holes: [] }], openings.map(o => ({ outer: o.cut, holes: [] })))`. Openings of kind `window` also subtract (the window symbol is drawn on top); kind `opening` subtracts. If the wall has no openings, `pocheParts = [{ outer: outline, holes: [] }]` without calling Clipper.

### 3.8 Node caps and exterior outline

- `nodeCaps: Record<nodeId, Vec2[]>`: for every node with k ≥ 3 **or** with at least one bevelled wedge, the CW ring of all distinct corners (miter points and bevel side points) of its walls, sorted by angle around `N`. Used only by the 3D builder (`05` §5.2) to close the vertical prism at junctions, because 3D walls are extruded with straight ends between their two corners.
- `exteriorOutline`: `union(all wall outlines)`; take the result polygon with the largest `|area|`; return its outer ring (CW). `null` if there are no walls.

### 3.9 Edge cases (each is a required unit test, §9)

| Case | Expected outline behaviour |
|---|---|
| L-corner, equal thickness 115, 90° | Both walls share outer corner `N + (−57.5, −57.5)`-style miter point and inner corner; outlines are quadrilaterals (no `N` via). |
| L-corner, thickness 230 vs 115 | Shared miter corners computed from the two different offsets; outlines include `N` as via; union has no gap (area of union = sum of areas). |
| T-junction (straight wall split into two pieces + stem) | Through pieces share the side point on the far side; stem corners are the two inside miter points; three outlines tessellate. |
| X-junction (4 walls) | Four inside miter corners; all four outlines contain `N`. |
| Collinear continuation, equal thickness | Corners coincide; outlines meet along the perpendicular through `N`. |
| Collinear continuation, different thickness | Perpendicular step at `N`. |
| Acute 20° wedge | Miter rejected by `MITER_LIMIT` → bevel with midpoint `M` via. |
| Very short wall (length 30) between two corners | Miter rejected by the half-length rule → bevel; outline remains simple. |
| Dangling end | Square cap. |
| Two walls with the same outgoing direction (overlap) | Treated as parallel pair; no crash; `outline_fallback` is not required. |
| Node with walls in all 4 quadrants plus one acute | Sort and pairing still cyclic; no NaN in any output (assert `Number.isFinite`). |

### 3.10 Acceptance criteria — wall outlines

- [ ] For the fixtures `makeRectPlan(5000, 4000, 230)`, `makeLPlan()` and `makeGridPlan(7, 6)` the union area of all wall outlines equals the sum of individual outline areas within 0.1 % (no overlaps) and `exteriorOutline` has no holes except the building interior handled by room detection.
- [ ] Every outline is CW, has ≥ 4 finite vertices, and contains no self-intersection (checked with an O(n²) test in Vitest).
- [ ] `leftFace` of a wall drawn left→right on screen lies above (smaller y) its centre line.

---

## 4. Room detection (`engine/plan/rooms.ts`, `engine/geometry/planarFaces.ts`)

### 4.1 Planar graph from wall centre lines — `buildPlanarGraph(segments)`

Input: one segment per valid wall (`{ a, b, wallId }`, document points).

1. **Spatial candidates.** Build a `Flatbush` over segment bounding boxes expanded by `EPS`; for each segment query its box to get candidate pairs `(i < j)`.
2. **Split points.** For each pair run `intersectSegments`:
   - `point` → add the intersection point to both segments' split lists (with their parameters).
   - `overlap` → add the overlap's end points to both segments' split lists.
   Also, for each segment, every endpoint of any other segment within `EPS` of its interior is a split point.
3. **Vertex clustering.** Collect all endpoints and split points; cluster within `EPS` with the 1 mm spatial hash; each cluster's representative is the first inserted point (endpoints before intersections, so document nodes keep exact coordinates).
4. **Sub-edges.** Sort each segment's split parameters, map to cluster ids, emit sub-edges between consecutive distinct clusters. Deduplicate sub-edges with the same unordered vertex pair; a deduplicated edge keeps the **set** of contributing `wallId`s (collinear overlapping walls).
5. **Prune filaments.** Repeatedly remove vertices of degree 1 together with their edge until none remain (dangling walls bound no face). Keep the removed edges in `filaments` (used only for diagnostics).
6. Output `PlanarGraph { vertices: Vec2[]; edges: Array<{ v0; v1; wallIds: string[] }>; out: number[][] }` where `out[v]` lists half-edge ids leaving `v` **sorted by angle ascending** (`angleOf(target − v)`), half-edge `2e` = `v0→v1`, `2e+1` = `v1→v0`.

### 4.2 Face walk — `walkFaces(graph)`

1. `next(h)`: let `h = u→v`; at `v` find the index `k` of the twin `v→u` in `out[v]`; `next(h) = out[v][(k − 1 + deg(v)) % deg(v)]` (the previous half-edge in ascending-angle order).
2. For every unvisited half-edge, follow `next` until returning to the start; mark visited; record the cycle of vertices and the half-edges.
3. With this rule (proof in the test: unit square traced `A→B→C→D`), **bounded faces have positive signed area (CW on screen)** and the face of half-edge `u→v` lies on its **right** (`−n` side when `u→v` has wall direction `d`). Each connected component produces exactly one negative-area cycle: its outer boundary.
4. Discard cycles with `|signedArea| < 1` mm² (numerical degeneracy).

### 4.3 Nesting (rooms with islands)

1. Positive cycles are **candidate faces**; negative cycles are **component boundaries**.
2. For each component boundary `C`, find the smallest-area candidate face `F` from a **different** connected component such that `pointInRing(C[0], F.ring) === 'inside'`. If found, `C` (reversed to CCW) becomes a hole of `F`. If not found, `C` is the plan's outer boundary and is discarded.
3. Result: `RawFace { ring: Vec2[] (CW); holes: Vec2[][] (CCW); halfEdges: number[]; wallIds: Set<string> }`.

### 4.4 RoomMeta association and re-association (normative; referenced by `03` §1 `RoomMeta.anchor`)

There are two distinct steps:

**(a) Association inside `derivePlanGeometry` (pure, no history).** For each derived room (face) collect the RoomMetas whose `anchor` is `'inside'` the face's **centre-line ring** (holes excluded). If exactly one → `metaId = meta.id`. If several → `metaId` = the one with the lexicographically smallest id; the others get no face and produce `DeriveIssue` `engine.plan.derive.room_meta_duplicate` (warning). Metas inside no face are orphaned (`validatePlan` reports `plan.room_anchor_outside`). Faces with no meta have `metaId = null`.

**(b) Re-association inside every geometry-changing command (`reconcileRoomMetas`, runs in the post-process phase of §6.4, so its document changes are part of the same history entry).** Inputs: `prevGeom` (before the command), `nextGeom` (derived from the command's phase-1 output), the draft document.

1. For each meta `m` in `draft.rooms`, let `prev = prevGeom.rooms.find(r => r.metaId === m.id)` (may be undefined).
2. If `prev` is undefined: if `m.anchor` is inside some next face, that face is `m`'s target; else `m` stays orphaned (no change — it re-attaches when a face closes around its anchor again; rationale: deleting a wall to redraw it must not lose the room name).
3. If `prev` exists:
   1. If a next face has the same `faceKey` → target = that face.
   2. Else candidates = next faces with `intersectionArea(prev.facePolygon, next.facePolygon) ≥ 0.2 × min(area(prev), area(next))`. If a candidate contains `m.anchor` → target = it; else the candidate with the largest intersection area; ties → smaller `faceKey`.
   3. If there is no candidate → `m` stays orphaned (anchor unchanged).
4. **Merge rule.** If two or more metas target the same next face, the winner is the meta whose `prev` area was largest (orphans count as area 0); ties → smallest id. Losers are **deleted** from `draft.rooms` (undo restores them). Rationale: removing the wall between two rooms creates one room; keeping the bigger room's name matches user expectation.
5. **Split rule.** When one previous face becomes several next faces, the meta goes to the target from step 3.2; the other new faces get no meta and display as unnamed rooms (`05` §4.6). Rationale: duplicating names would put two "Master Bedroom"s into order item room labels (`02` §8.2 `room_label`).
6. **Anchor maintenance.** For every meta with a target face: if `m.anchor` is not `'inside'` the target's centre-line ring, or its distance to the target's **net** polygon boundary is `< ANCHOR_MIN_CLEARANCE`, set `m.anchor = roundPoint(target.labelPoint)`. If `m.labelOffset !== null` and `centroid + labelOffset` is not inside the target's net polygon, set `m.labelOffset = null`.
7. `reconcileRoomMetas` returns `{ deletedMetaIds: string[]; movedAnchors: string[] }` for the command result.

### 4.5 Net polygon and metrics

For each raw face:

1. `wallsUnion = union(all wall outlines)` — computed **once per derivation** (it is also used for `exteriorOutline`).
2. `pieces = difference([{ outer: ring, holes }], wallsUnion)`.
3. Take the piece with the largest area; if none or its area `< MIN_ROOM_NET_AREA` → the face is not a room (dropped, not reported). Other pieces (slivers caused by a near-touching wall) are ignored.
4. `polygon = simplifyCollinear(piece.outer)` (CW), `holes = piece.holes.map(simplifyCollinear)` (CCW).
5. `areaMm2 = Math.round(area(piece))`; `perimeterMm = Math.round(perimeter(outer) + Σ perimeter(holes))`; `centroid = polygonCentroid(piece)`.
6. `netRect = isAxisRectangle(polygon)` → `{ width, depth }` where `width` is the length of the edge whose direction is closest to the x axis; `null` if not a rectangle (`05` §4.6 uses it for "3.60 × 3.00 m" labels).

Rationale for using the wall-outline difference instead of a uniform inward offset: walls around one room may have different thicknesses; the difference with the actual mitered outlines is exact for every combination.

```ts
export interface DerivedRoom {
  // --- fields from 03 PlanGeometry.rooms[n] ---
  faceKey: string; polygon: Vec2[]; areaMm2: number; perimeterMm: number; centroid: Vec2; metaId: string | null;
  // --- engine extensions ---
  holes: Vec2[][];              // CCW
  facePolygon: PolygonWithHoles;// centre-line face (used for anchor containment and overlap)
  labelPoint: Vec2;             // §4.7
  labelRadius: number;          // distance from labelPoint to the nearest boundary (mm)
  wallIds: string[];            // sorted, unique
  netRect: { width: number; depth: number } | null;
}
```

### 4.6 `faceKey`

`faceKey = 'fk_' + cyrb53(wallIds.join('|')).toString(36)` where `wallIds` is the sorted unique list of wall ids from the face's outer cycle (hole cycles excluded). If two faces produce the same key (possible only with walls crossing without nodes), sort the colliding faces by `(centroid.y, centroid.x)` and append `_2`, `_3`, … to all but the first. `cyrb53` (in `geometry/hash.ts`):

```ts
export function cyrb53(str: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}
```

A `faceKey` is stable while the set of bounding walls is unchanged (moving nodes, changing thickness, adding openings do not change it). Splitting or merging walls changes it; §4.4 handles that.

### 4.7 Label placement — `polylabel(p: PolygonWithHoles, precision = 10): { point: Vec2; distance: number }`

Pole of inaccessibility (the interior point farthest from the boundary), Mapbox polylabel algorithm:

1. Compute the bbox; `cellSize = min(width, height)`; if `cellSize === 0` return `{ point: bbox.min, distance: 0 }`.
2. `h = cellSize / 2`. Cover the bbox with square cells of size `cellSize`; each cell has centre `c`, half-size `h`, `d = signedDistToPolygon(c, p)` and `max = d + h·√2` (best possible distance inside the cell).
3. Initial best: the area centroid cell (if its `d` is better) versus the bbox-centre cell.
4. Push all cells into a max-priority queue by `max`.
5. Pop a cell; if `cell.d > best.d` → `best = cell`. If `cell.max − best.d ≤ precision` → skip. Otherwise split into four child cells of half-size `h/2` and push them.
6. Stop when the queue is empty; return `best.c`, `best.d`.

The priority queue is a binary heap implemented inline (no dependency). Precision 10 mm; rationale: sub-centimetre accuracy is invisible and keeps the search under 0.2 ms for a 40-vertex room.

`labelPoint` = `meta.labelOffset !== null ? centroid + labelOffset : polylabel(net).point`.

### 4.8 `planSummary(doc): PlanSummary` (engine CLI `plan-summary`, `02` §3.2 `plans.summary`)

```ts
export interface PlanSummary {
  wallCount: number; roomCount: number;
  rooms: Array<{ id: string; name: string | null; areaMm2: number }>; // id = metaId ?? faceKey; name = meta name or null
  totalAreaMm2: number;    // Σ net room areas ("carpet area")
  bbox: { min: Point; max: Point } | null;   // rounded to integer mm; null for an empty plan
}
```

### 4.9 Acceptance criteria — rooms

- [ ] `makeRectPlan(5000, 4000, 230)` yields exactly 1 room with net area `(5000−230)×(4000−230) = 17 982 900` mm² (±1) and `netRect = {width: 4770, depth: 3770}`.
- [ ] `makeGridPlan(7, 6)` (97 walls) yields 42 rooms; the sum of net areas plus the wall union area equals the area of the exterior outline (±0.1 %).
- [ ] A free-standing closed 4-wall box inside a room produces a room with one hole, and the box's interior is its own room.
- [ ] A dangling wall inside a room does not create a new room; the room's net polygon has a notch.
- [ ] Two walls crossing without a node (imported doc) produce four rooms.
- [ ] Re-association: (1) moving a node keeps every `metaId`; (2) deleting the wall between two named rooms keeps the larger room's meta and deletes the other in the same history entry; undo restores both; (3) adding a wall that splits a named room keeps the meta in the part containing its anchor and leaves the other part unnamed; (4) after a wall move that leaves an anchor outside its room, the anchor is moved to the new label point.
- [ ] `faceKey` is identical before and after moving a node or changing thickness.

---

## 5. Snapping engine (`engine/plan/snapping.ts`)

### 5.1 API

```ts
export type SnapKind =
  | 'endpoint' | 'intersection' | 'midpoint' | 'perpendicular' | 'guide_intersection'
  | 'on_wall' | 'on_face' | 'extension' | 'alignment' | 'angle' | 'grid' | 'none';

export interface SnapSettings {
  enabled: boolean;                       // global toggle (S key); false ⇒ only raw rounding
  kinds: Record<Exclude<SnapKind, 'none'>, boolean>; // all true by default
  gridVisible: boolean;                   // grid snapping only when visible
  angleStepDeg: 15 | 45 | 90;             // soft angle snapping step, default 15
  unitSystem: UnitSystem;                 // grid sequence (§5.6)
}

export interface SnapModifiers { shift: boolean; alt: boolean }   // shift = hard 45° lock from origin; alt = disable snapping

export interface SnapInput {
  cursor: Vec2;                 // model mm (float), already converted from screen
  zoom: number;                 // screen px per mm
  pointerType: 'mouse' | 'pen' | 'touch';
  origin: Vec2 | null;          // start point of the segment being drawn/measured
  previousDir: Vec2 | null;     // direction of the previous chain segment (for relative perpendicular/parallel)
  exclude: ReadonlySet<string>; // entity ids ignored (dragged node, its walls, the wall being drawn)
  settings: SnapSettings;
  modifiers: SnapModifiers;
}

export interface SnapGuide { kind: 'extension' | 'alignment' | 'angle' | 'perpendicular' | 'parallel' | 'face'; a: Vec2; b: Vec2 } // infinite guides are clipped to the given segment
export interface SnapMarker { kind: Exclude<SnapKind, 'none' | 'on_wall' | 'grid'>; at: Vec2 }

export interface SnapResult {
  point: Vec2;                  // integer mm
  kind: SnapKind;
  nodeId: string | null;        // endpoint snaps
  wallId: string | null;        // on_wall / midpoint / perpendicular / endpoint-on-wall
  u: number | null;             // centre-line parameter (mm from node a) when wallId is set
  guides: SnapGuide[];          // to render (05 §4.9)
  markers: SnapMarker[];
  lengthFromOrigin: number | null;   // integer mm
  displayAngleDeg: number | null;    // §2.1-10 convention
}

export function snapPoint(input: SnapInput, index: SnapIndex): SnapResult;
export function gridStepFor(zoom: number, system: UnitSystem): { step: number; major: number }; // mm
```

### 5.2 Index — `buildSnapIndex(doc, geom, footprints): SnapIndex`

A `Flatbush` per item class, rebuilt (not updated) whenever `geom` changes — rebuild of 2000 walls takes < 2 ms. When an item class is empty, its index is `null` (Flatbush requires ≥ 1 item).

| Index | Items |
|---|---|
| `nodes` | every node point (zero-size boxes) |
| `centerlines` | every derived wall centre-line segment |
| `faces` | every left/right face segment (with `wallId`, `side`) |
| `footprints` | every placement/fixture footprint polygon bbox (with entity id, rotation, corners) |
| `keyPoints` | wall midpoints, opening jamb centre points |

`SnapIndex` also keeps plain arrays aligned with each Flatbush's item order.

### 5.3 Tolerances

- Base tolerance in screen px: `8` for `mouse`/`pen`, `16` for `touch`. In mm: `tol = tolPx / zoom`.
- Furniture/fixture-to-face snapping uses `2 × tol` (furniture is dragged by its body, the back edge is far from the pointer).
- Raw rounding step when nothing snaps: the largest `s ∈ {1, 5, 10, 50, 100}` mm with `s × zoom ≤ 4` px (positions finer than ~4 px are meaningless). Result `kind = 'none'`.

### 5.4 Candidates and priorities (lower number wins)

| Prio | Kind | Source | Marker |
|---|---|---|---|
| 1 | `endpoint` | node within `tol` | filled square |
| 2 | `intersection` | intersection of two wall centre lines within `tol` (only where walls cross without a node, i.e. imported docs) | X |
| 3 | `midpoint` | wall centre-line midpoint within `tol` | triangle |
| 4 | `perpendicular` | if `origin` set: foot of the perpendicular from `origin` onto a wall centre line, within `tol` of the cursor and inside the segment | right-angle glyph |
| 5 | `guide_intersection` | intersection of two line candidates of prio 7–8 within `tol` | small circle |
| 6 | `on_wall` | closest point on a wall centre line within `tol` | none (wall highlight) |
| 6 | `on_face` | closest point on a wall face within `tol` (only when the tool asks for faces: Dimension tool, Measure tool) | none |
| 7 | `extension` | infinite line through a wall's centre line, considered only for walls having a node within `max(600 mm, 60 px / zoom)` of the cursor's projection; plus `alignment`: horizontal and vertical lines through every node within `400 / zoom` mm (400 screen px) of the cursor; a line qualifies when the cursor is within `tol` of it | dashed guide |
| 8 | `angle` | if `origin` set: rays from `origin` at multiples of `angleStepDeg` (and, if `previousDir` is set, rays parallel and perpendicular to `previousDir`); candidate if cursor distance to the ray `≤ tol` and the cursor is ≥ `20 / zoom` mm from origin | dotted guide from origin |
| 9 | `grid` | nearest grid intersection if `settings.gridVisible` | none |

### 5.5 Algorithm — `snapPoint`

1. If `!settings.enabled` or `modifiers.alt`: return `kind 'none'`, point = raw rounding (§5.3), no guides. `lengthFromOrigin`/`displayAngleDeg` still filled when `origin` is set.
2. If `modifiers.shift` and `origin`: **hard angle lock** — project the cursor onto the nearest ray from `origin` at a multiple of 45°; continue with that projected point as the cursor but only allow candidates that lie on that ray (`endpoint`, `intersection`, `midpoint` within `tol` of the ray become their projection onto the ray only if within `EPS` of it; `on_wall` becomes the ray ∩ wall line). Always emit an `angle` guide for the ray.
3. Query point candidates (prio 1–4) with `index.search(cursor ± tol)` and exact distance checks, skipping `exclude`.
4. If any point candidate exists → choose the lowest priority, ties by screen distance → done (step 8).
5. Gather line candidates (prio 6–8). For every pair of line candidates whose lines intersect within `tol` of the cursor (and are not parallel), create a `guide_intersection` with both guides. If any → choose the closest → done.
6. Else choose the best single line candidate by priority then distance: point = projection of the cursor onto the line.
7. Else grid (prio 9) if visible; else raw rounding.
8. Round the chosen point to integer mm. For `on_wall` results the rounding may move the point ≤ 0.71 mm off the centre line; commands re-project (`§6.5 resolveEndpoint`).
9. Fill `lengthFromOrigin = round(dist(origin, point))` and `displayAngleDeg` (§2.1-10) when `origin` is set; fill guides/markers for the winner (and both guides for `guide_intersection`).

Performance: ≤ 0.5 ms per call for 500 walls (benchmark §9).

### 5.6 Grid

`gridStepFor(zoom, system)` chooses the smallest step from the sequence whose on-screen spacing `step × zoom ≥ 16` px; `major = step × 5` for metric 50/500/5000 steps, `× 10` for 10/100/1000, imperial: `× 12` for 1", `× 2` for 6", `× 5` for 1' and 5', `× 2` for 10'.

| System | Sequence (mm) |
|---|---|
| metric | 10, 50, 100, 500, 1000, 5000, 10000 |
| imperial | 25.4 (1"), 152.4 (6"), 304.8 (1'), 1524 (5'), 3048 (10'), 15240 (50') |

Grid lines are anchored at plan origin (0, 0). Imperial grid points are rounded to integer mm only when used as a snap result.

### 5.7 Opening positioning — `snapOpeningPosition(input)`

```ts
export interface OpeningSnapInput { cursor: Vec2; zoom: number; pointerType: SnapInput['pointerType']; width: number; openingId: string | null; preferredWallId: string | null; geom: DerivedPlan; doc: PlanDocument; modifiers: SnapModifiers }
export interface OpeningSnapResult {
  wallId: string | null;          // null = no wall under the cursor
  offset: number;                 // integer mm, centre along the centre line
  valid: boolean;                 // fits within the wall and does not overlap other openings
  swing: 'left' | 'right';        // cursor side of the centre line (left ⇔ +n); for windows ignored
  hinge: 'start' | 'end';         // 'start' if cursor u < offset, else 'end'
  guides: SnapGuide[];
  reasonKey: string | null;       // engine.plan.snap.opening_no_fit | opening_overlap when !valid
}
```

1. Wall under cursor: the wall whose **outline** contains the cursor, else the nearest centre line within `2 × tol + thickness/2`; prefer `preferredWallId` if it qualifies (sticky while dragging).
2. `u = projectParam × length`. Clamp to `[width/2, length − width/2]`; if `length < width` → `valid = false`, `reasonKey = engine.plan.snap.opening_no_fit`.
3. Snap targets along the wall (within `tol` in u): wall centre (`length/2`), and "return" positions where the opening edge is `100` mm from the inner face corner at either end (`u0 = safeU[0] + 100`, `u1 = safeU[1] − 100`; rationale: 100 mm is a standard door return/frame allowance). Emit a `face` guide for the chosen target.
4. Without a target, round `u` to 10 mm.
5. Validate overlap with other openings on the wall (excluding `openingId`) → `valid = false`, `reasonKey = engine.plan.snap.opening_overlap`.
6. Alt disables steps 3–4 (raw 1 mm rounding).

### 5.8 Footprints and footprint snapping

```ts
export interface FootprintSize { width: number; depth: number; height: number }
export type FootprintProvider = (designId: string) => FootprintSize | null;   // from furniture_designs width/depth/height_mm
export interface Footprint { corners: [Vec2, Vec2, Vec2, Vec2]; // CW: back-left, back-right, front-right, front-left (as seen from the front)
  backCenter: Vec2; center: Vec2; front: Vec2; width: number; depth: number; rotation: number }
export function placementFootprint(p: FurniturePlacement, size: FootprintSize): Footprint; // p.x,p.y = back centre (master §6.2)
export function fixtureFootprint(f: Fixture): Footprint;                                    // f.x,f.y = footprint centre (03)
```

Footprint construction (rotation `θ`, front `f = frontVector(θ)`, right-hand axis `r = rot((1,0), θ)` — at θ = 0 the viewer stands at +y looking toward −y and their right hand points to +x):
- placement: `backCenter = (p.x, p.y)`, `center = backCenter + f·depth/2`.
- fixture: `center = (f.x, f.y)`, `backCenter = center − f·depth/2`.
- `backLeft = backCenter − r·width/2`, `backRight = backCenter + r·width/2`, `frontRight = backRight + f·depth`, `frontLeft = backLeft + f·depth`. Return `ensureCW` order as listed (verify sign in a test; reorder if negative).
- `mirrored` does not change the footprint.

```ts
export interface FootprintSnapInput {
  cursorBackCenter: Vec2;      // where the back centre would be without snapping (pointer + grab offset)
  rotation: number; width: number; depth: number; elevation: number; height: number;
  zoom: number; pointerType: SnapInput['pointerType']; modifiers: SnapModifiers;
  exclude: ReadonlySet<string>; settings: SnapSettings;
  keepRotation: boolean;       // true while rotating with a handle; false while moving (wall snapping may set rotation)
}
export interface FootprintSnapResult {
  backCenter: Vec2; rotation: number;                       // integer mm, 0.01° precision
  wallAttachment: { wallId: string; side: 'left' | 'right' } | null;
  guides: SnapGuide[]; markers: SnapMarker[];
}
export function snapFootprint(input: FootprintSnapInput, index: SnapIndex, geom: DerivedPlan): FootprintSnapResult;
```

Algorithm:
1. Alt or snapping disabled → round back centre to raw step, keep rotation, attachment `null`.
2. **Wall faces.** Query `faces` within `2·tol` of `cursorBackCenter`. For each face segment `[p0, p1]` of wall `w`, side `s`: distance from `cursorBackCenter` to the face line `≤ 2·tol` and its projection inside the segment (with `width/2` slack). Front direction `f = s === 'left' ? +n_w : −n_w`. New rotation `= rotationFromFront(f)` unless `keepRotation` (then the face qualifies only if `|rotation − rotationFromFront(f)| ≤ 1°`). Position along the face: `t = projection length from p0`; clamp `t ∈ [width/2, faceLen − width/2]` when `faceLen ≥ width`; snap `t` to `width/2`, `faceLen − width/2` (flush with a corner) and `faceLen/2` within `tol`. `backCenter = p0 + dir·t`. Pick the qualifying face with the smallest distance. Attachment = `{ wallId, side }`. Emit a `face` guide along the face and an endpoint marker when corner-flush.
3. **Furniture alignment** (applied after step 2 along the free axis, or alone if no face): for other footprints whose rotation equals ours modulo 90° (±0.5°), compare our four edge lines and centre lines with theirs in our local frame; snap each axis independently within `tol` to: edge-to-edge flush (our left edge = their right edge and vice versa, back = back, front = front) and centre alignment. Emit `alignment` guides spanning both footprints. When a wall face was chosen in step 2, alignment only adjusts the coordinate along the face.
4. Grid: if no face and no alignment, snap `backCenter` to grid (if visible), else raw rounding.

### 5.9 Placement conflicts — `computePlacementConflicts(doc, geom, footprints): PlacementConflict[]`

```ts
export interface PlacementConflict {
  kind: 'overlaps_wall' | 'overlaps_item' | 'blocks_door' | 'blocks_window';
  entityId: string;          // placement or fixture id
  otherId: string;           // wall, placement, fixture or opening id
  messageKey: `engine.plan.conflict.${PlacementConflict['kind']}`;
  params: Record<string, string | number>;
}
```

Non-blocking warnings (editor highlights; never prevent saving):
1. **Wall overlap:** `intersectionArea(footprint, wallPocheParts) > 2500` mm² (tolerates flush contact and ≤ 5 mm rounding). Vertical intervals are ignored for walls (walls are full-height except `half`; for `half` walls only if `elevation < wall.height`).
2. **Item overlap:** two footprints (placements and fixtures) intersect with area `> 2500` mm² **and** their vertical intervals `[elevation, elevation + height]` overlap by > 10 mm. Fixtures whose library entry has `noConflict: true` (`rug`, `sink`, `hob` — rugs lie under things, sinks and hobs sit inside counters; `05` §9) never conflict.
3. **Door swing:** for openings with `type ∈ {single_swing, double_swing, main_entrance, french_window}`, build the swing sector polygon(s): centre at the hinge jamb point on the swing face, radius = leaf width (`width` for single/main, `width/2` per leaf for double/french), 90° sector between the closed leaf (along the wall) and the open leaf (along `swingSign·n`), approximated by 16 segments. Footprint ∩ sector area `> 2500` mm² and the item's elevation `< opening.height` → `blocks_door`.
4. **Window:** footprint intersects the window's cut rectangle extended 300 mm into each side and the item's vertical interval overlaps `[sillHeight, sillHeight + height]` → `blocks_window`.

Placements whose design footprint is unknown (`FootprintProvider` returns `null`) are skipped.

`export function doorSwingSectors(doc: PlanDocument, geom: DerivedPlan): Array<{ openingId: string; polygon: Vec2[] }>` returns the swing sectors of step 3 (CW polygons) for the editor's clearance-zone overlay (`05` §10.6).

### 5.10 Output consumption

Renderers draw `guides` as screen-space dashed lines (clipped to the viewport) and `markers` as fixed-size glyphs (`05` §4.9). The status bar shows `kind` via key `engine.plan.snap.kind.<kind>`.

### 5.11 Acceptance criteria — snapping

- [ ] With zoom 0.1 px/mm and a mouse, a cursor 70 mm from a node snaps to it (tol = 80 mm); at 90 mm it does not.
- [ ] With touch at the same zoom, 150 mm snaps (tol = 160 mm).
- [ ] Endpoint beats midpoint when both are within tolerance; midpoint beats on_wall.
- [ ] On an empty plan, drawing from (0,0), a cursor at (3000, 40) with zoom 0.1 snaps to angle 0° (distance 40 ≤ 80) → point (3000, 0), `displayAngleDeg 0`, `lengthFromOrigin 3000`.
- [ ] Shift from origin (0,0) with cursor (1000, 900) yields (950, 950)-projection on the 45° ray (rounded), display angle 315° (down-right on screen is −45° CCW).
- [ ] Alt returns `kind 'none'`.
- [ ] A 1200-wide footprint dragged near the left face of a 4000 mm wall attaches with `side 'left'`, rotation equal to `rotationFromFront(+n)`, and is clamped inside the face.
- [ ] Grid step at zoom 0.1 metric = 500 mm (50 mm → 5 px, 100 → 10 px, 500 → 50 px ≥ 16).

### 5.12 Hit index (`engine/plan/hitIndex.ts`)

```ts
export type HitKind = 'handle' | 'opening' | 'node' | 'dimension' | 'label' | 'room_label' | 'placement' | 'fixture' | 'wall' | 'room' | 'background';
export interface Hit { kind: HitKind; id: string; distancePx: number }
export function buildHitIndex(doc: PlanDocument, geom: DerivedPlan, drawing: PlanDrawing, footprints: FootprintProvider): HitIndex;
export function hitTest(index: HitIndex, p: Vec2, zoom: number, pointerType: SnapInput['pointerType'], layers: HitLayerMask): Hit[]; // sorted best-first
export function hitTestRect(index: HitIndex, min: Vec2, max: Vec2, mode: 'window' | 'crossing'): string[];
```

Priority order (first non-empty class wins, then by distance): opening (point within its cut rectangle expanded by `tol`) → node (≤ `tol`) → dimension text/line (≤ `tol`) → text label bbox → room label bbox → placement/fixture footprint (inside, or ≤ `tol` from edge; when stacked, the one with the higher `elevation + height`, then the most recently added id order) → wall (inside outline or ≤ `tol` from it) → room (inside net polygon) → background (inside image rect, only if not locked and the Background tool is active). Handles are tested by the editor before calling `hitTest` (`05` §4.10). `hitTestRect` `window` selects entities whose bbox is fully inside; `crossing` selects any whose geometry intersects the rect (walls by outline, rooms excluded from crossing selection).

---

## 6. Command system

### 6.1 Generic command bus (`engine/commands/bus.ts`, `engine/commands/types.ts`)

The bus is document-type agnostic (also used by the furniture builder, `07`). It is built on `mutative`: `create(base, recipe, { enablePatches: true })` returns `[next, patches, inversePatches]`; `apply(base, patches)` replays them. Options: `enableAutoFreeze: false` in production; `true` when `import.meta.env?.DEV` or in Vitest (catches accidental mutation of committed documents).

```ts
import type { Draft, Patches } from 'mutative';

export interface CommandDef<D, P, C, R = void> {
  type: string;
  labelKey: string;                                   // i18n key, pattern 'engine.plan.command.label.add_wall' (history list, undo toasts)
  validate(doc: D, params: P, ctx: C): EngineMessage | null;   // cheap pre-check, no mutation
  run(draft: Draft<D>, params: P, ctx: C, out: CommandOutput<R>): void; // throws CommandAbort to cancel
  mergeKey?(params: P): string | null;               // non-null ⇒ mergeable with an unsealed top entry having the same key
  mergeMode?: 'replace' | 'compose';                  // default 'replace'
  touchesGeometry: boolean;                           // plan: run phase-2 post-processing (§6.4)
}

export class CommandAbort extends Error { constructor(public readonly reason: EngineMessage) { super(reason.code) } }
export interface CommandOutput<R> { result: R; warnings: EngineMessage[]; deletedIds: string[] }

export interface HistoryEntry {
  seq: number;                 // monotonically increasing
  type: string; labelKey: string; labelParams: Record<string, string | number>;
  patches: Patches; inversePatches: Patches;
  mergeKey: string | null; mergeMode: 'replace' | 'compose'; sealed: boolean;
  lastParams: unknown;         // params of the last merged command (needed for 'replace')
  at: number;                  // ms timestamp of last update
  meta: unknown;               // opaque editor data (selection before/after), never inspected by the engine
}

export type ExecuteResult<R> =
  | { ok: true; result: R; warnings: EngineMessage[]; deletedIds: string[]; changedIds: ReadonlySet<string> }
  | { ok: false; error: EngineMessage };

export interface BusEvent<D> {
  kind: 'execute' | 'merge' | 'undo' | 'redo' | 'reset' | 'commit' | 'rollback';
  doc: D; prevDoc: D;
  patches: Patches;            // forward patches that produced `doc` from `prevDoc`
  changedIds: ReadonlySet<string>;   // '*' means "everything"
  entry: Readonly<HistoryEntry> | null;
}

export interface ExecuteOptions { merge?: boolean; history?: boolean; meta?: unknown }

export interface CommandBus<D, C, M extends Record<string, CommandDef<D, any, C, any>>> {
  getDoc(): D;
  execute<K extends keyof M & string>(type: K, params: Parameters<M[K]['run']>[1], opts?: ExecuteOptions): ExecuteResult<unknown>;
  undo(): boolean;
  redo(): boolean;
  canUndo(): boolean;
  canRedo(): boolean;
  seal(): void;                                       // seals the top entry (ends a drag / nudge burst)
  beginTransaction(labelKey: string, labelParams?: Record<string, string | number>): void;
  commitTransaction(): void;
  rollbackTransaction(): void;
  transaction<T>(labelKey: string, fn: () => T): T;  // begin; fn; commit — rollback + rethrow on exception or on any failed execute inside
  reset(doc: D): void;                                // replace document, clear history (load, restore revision)
  subscribe(fn: (e: BusEvent<D>) => void): () => void;
  history(): { undo: ReadonlyArray<Readonly<HistoryEntry>>; redo: ReadonlyArray<Readonly<HistoryEntry>> };
}

export function createCommandBus<D, C, M extends Record<string, CommandDef<D, any, C, any>>>(cfg: {
  initial: D;
  registry: M;
  getContext(doc: D): C;                              // called once per execute with the current document
  pipeline?: Pipeline<D, C>;                          // default: single-phase create(); plan supplies §6.4
  pathToEntityId(path: (string | number)[]): string | null; // §6.3
  maxHistory?: number;                                // default 200
}): CommandBus<D, C, M>;
```

### 6.2 History semantics

1. **Execute.** `validate` → error result (document untouched, no event). Otherwise run the pipeline; a thrown `CommandAbort` → error result. On success the document is replaced, the redo stack is cleared, an entry is pushed (unless `history: false`), and an `execute` event is emitted.
2. **History cap.** When the undo stack exceeds `maxHistory` (200), drop the oldest entry.
3. **Merging.** Merge happens iff `opts.merge === true`, the top entry exists, is unsealed, has the same non-null `mergeKey`, and no undo/redo happened since it was pushed.
   - `replace` (absolute-target commands: drags): `base = apply(doc, top.inversePatches)`; re-run the pipeline on `base` with the new params; the top entry's `patches`/`inversePatches` are **replaced** by the new ones relative to `base`; `lastParams` updated. Result: one compact entry whatever the drag length. If the re-run fails, the document stays at the previous merged state and the error is returned.
   - `compose` (relative commands: keyboard nudges): run on the current document; `patches = top.patches.concat(new)`, `inversePatches = new.inverse.concat(top.inversePatches)`.
   - Emits a `merge` event.
4. **Sealing.** `seal()` marks the top entry sealed. The bus also seals automatically when a command with a different `mergeKey` (or none) executes, on undo/redo, and on `commitTransaction`. The editor seals on pointer-up and 800 ms after the last nudge (`05` §3.4).
5. **Undo/redo.** `undo` applies the top entry's `inversePatches`, moves it to the redo stack, emits `undo`. `redo` applies `patches`, emits `redo`. Both return `false` when the stack is empty. Undo of an unsealed entry seals it first.
6. **Transactions.** `beginTransaction` opens a frame (nested begins only increment a depth counter). Commands executed inside apply immediately (the UI sees intermediate states) and their patches are appended to the frame. `commitTransaction` at depth 0 pushes **one** entry with the transaction's `labelKey` (no entry if no patches). `rollbackTransaction` applies the accumulated inverse patches in reverse and emits `rollback`. Merging is disabled inside transactions.
7. **Reset.** `reset(doc)` clears both stacks, replaces the document, emits `reset` with `changedIds = {'*'}`.

### 6.3 Changed-entity extraction

`changedIds` = the set of `pathToEntityId(patch.path)` over all forward patches (and inverse patches for undo). Plan mapping (`engine/plan/commands/paths.ts`):

| Patch path prefix | Entity id |
|---|---|
| `['nodes', id, …]`, `['walls', id, …]`, `['openings', id, …]`, `['rooms', id, …]`, `['placements', id, …]`, `['fixtures', id, …]` | `id` |
| `['annotations', 'dimensions' \| 'labels', id, …]` | `id` |
| `['background', …]` | `'background'` |
| `['meta', …]` | `'meta'` |
| `['view', …]` | `null` (ignored) |
| any path of length 1 (a whole collection replaced) | `'*'` |

The editor turns `changedIds` into its entity revision map (`05` §3.3); walls incident to a changed node are added by the editor using `DerivedPlan.nodes`.

### 6.4 Plan command pipeline (`engine/plan/commands/pipeline.ts`)

```ts
export interface PlanCommandContext {
  geometry: DerivedPlan;                    // geometry of the current document (cached deriver)
  derive(doc: PlanDocument): DerivedPlan;   // the shared cached deriver (§7)
  footprints: FootprintProvider;
  defaults: PlanDefaults;
  newId(prefix: 'n' | 'w' | 'o' | 'r' | 'f' | 'x' | 'd' | 't'): string;  // engine/ids.ts; injectable for deterministic tests
}
export interface PlanDefaults {
  wallHeight: number;            // doc.meta.defaultWallHeight
  interiorThickness: number;     // doc.meta.defaultWallThickness
  exteriorThickness: number;     // units.default_exterior_wall_thickness_mm (02 §13), 230
  doorWidth: number; doorHeight: number;           // 900 / 2100
  windowWidth: number; windowHeight: number; windowSill: number;  // 1200 / 1200 / 900
  openingWidth: number; openingHeight: number;     // 900 / 2100
}
```

Steps for `executePlanCommand(doc, def, params, ctx)`:

1. `err = def.validate(doc, params, ctx)`; return it if non-null.
2. **Phase 1:** `[doc1, p1, i1] = create(doc, d => def.run(d, params, ctx, out), { enablePatches: true })`.
3. If `def.touchesGeometry`: `geom1 = ctx.derive(doc1)`; **Phase 2:** `[doc2, p2, i2] = create(doc1, d => postProcess(d, { prevDoc: doc, prevGeom: ctx.geometry, geom: geom1, changed: changedIdsOf(p1) }, out), …)`. Else `doc2 = doc1`, `p2 = i2 = []`.
4. **Invariant check:** `before = errorKeys(validatePlan(doc))`, `after = errorKeys(validatePlan(doc2))` where `errorKeys` = set of `code + '|' + sorted(entityIds).join(',')` for severity `error`. If `after \ before` is non-empty → return error `engine.plan.command.introduces_error` with `params.issue` = the first new code. Rationale: imported documents may already contain errors; commands must never add new ones but must still be usable to fix old ones. (`validatePlan` is cached by document identity, so `before` is free.)
5. Return `{ doc: doc2, patches: [...p1, ...p2], inversePatches: [...i2, ...i1] }`.

**Post-process (`postprocess.ts`)**, in this order, touching only entities related to `changed` (walls in `changed`, walls incident to nodes in `changed`, and their nodes):

1. Delete nodes in the related set that no wall references.
2. For every `DimensionAnnotation` with `attachedTo.wallId` in the related walls: recompute `a`, `b` from `geom1` (`left` → `leftFace`, `right` → `rightFace`, `center` → `centerline`), rounded. If the wall no longer exists → delete the dimension (record in `out.deletedIds`).
3. For every placement with `wallAttachment.wallId` in the related walls: if the wall is gone → `wallAttachment = null`. Else let `u` = the projection length of the placement's back centre on the **previous** face segment (`prevGeom`), clamp `u` to `[w/2, faceLen − w/2]` on the **new** face (or `faceLen/2` if it does not fit), set `x, y = round(newFace.p0 + dir·u)` and `rotation = rotationFromFront(side normal)`. Rationale: furniture placed against a wall follows the wall.
4. `reconcileRoomMetas(draft, prevGeom, geom1)` (§4.4).

### 6.5 Shared helpers (`engine/plan/commands/helpers.ts`)

```ts
type EndpointRef = { nodeId: string } | { point: Vec2 };

function resolveEndpoint(d: Draft<PlanDocument>, ref: EndpointRef, ctx, out): string; // returns node id
function splitWallAt(d, wallId: string, point: Vec2, ctx, out): string;               // returns the new node id
function insertWallSegment(d, fromNodeId: string, toNodeId: string, props: WallProps, ctx, out): { wallIds: string[]; lastNodeId: string };
function splitIntersections(d, wallId: string, ctx, out): void;
function mergeNodeInto(d, srcNodeId: string, dstNodeId: string, ctx, out): void;
function reclampOpenings(d, wallId: string, movedEnd: 'a' | 'b' | 'both' | 'none', oldLength: number): void; // throws CommandAbort
function nextOpeningLabel(d, kind: 'door' | 'window'): string;
```

**`resolveEndpoint`**: (1) `{ nodeId }` → must exist. (2) `{ point }` → nearest node within `NODE_MERGE_TOL` → reuse. (3) Else the nearest wall whose centre line is within `NODE_MERGE_TOL` and whose projection `u ∈ [NODE_MERGE_TOL, length − NODE_MERGE_TOL]` → `splitWallAt(projection)`. (4) Else create node `newId('n')` at `roundPoint(point)`.

**`splitWallAt(wallId, point)`**: `u = projection of point on the centre line`; if `u` is strictly inside an opening interval `(u0, u1)` → `CommandAbort(engine.plan.command.split_through_opening)`. Create node at `roundPoint(A + d·u)`. The original wall becomes `a → N` (keeps its id); a new wall `N → b` (`newId('w')`) copies all props. Openings with `offset < u` stay with offset unchanged; the others move to the new wall with `offset − dist(A, N)`. Placements attached to the original wall whose back centre projects beyond `u` re-attach to the new wall (same side). Dimensions attached to the original wall stay attached to it.

**`insertWallSegment(from, to, props)`** (the core of `addWall`):
1. `S = segment(nodes[from], nodes[to])`. If `|S| < MIN_WALL_LENGTH` → abort `wall_too_short`.
2. Split points on `S` (with parameter `t`):
   - every existing node (other than from/to) within `NODE_MERGE_TOL` of `S`'s interior → join at that node;
   - every other wall `W` whose centre line properly crosses `S` (`intersectSegments` kind `point` with `t ∈ (0,1)` and the crossing strictly inside `W`) → if the crossing is within `NODE_MERGE_TOL` of a node of `W`, use that node, else `splitWallAt(W, crossing)`;
   - every wall collinear-overlapping `S` (`overlap` within `NODE_MERGE_TOL` distance and `isParallel`): its end nodes inside `S` become split points and the overlapped interval is marked **covered**.
3. Sort by `t`, dedupe split points closer than `NODE_MERGE_TOL` (keep existing nodes over new ones).
4. For consecutive pairs `(P_k, P_{k+1})`: skip if covered, if shorter than `MIN_WALL_LENGTH`, or if a wall already joins these two nodes; else create a wall `newId('w')` with `props`.
5. If no wall was created → abort `engine.plan.command.wall_duplicate`.
6. Return the created wall ids (in order from `from` to `to`) and `lastNodeId = to`.

**`splitIntersections(wallId)`**: for every other wall properly crossing it, split both at the crossing (reuse nodes within `NODE_MERGE_TOL`); for every node within `NODE_MERGE_TOL` of its interior, split it there. Used by `finalize` steps.

**`mergeNodeInto(src, dst)`**: rewire every wall referencing `src` to `dst`; delete walls that became degenerate (`a === b`) together with their openings; if two walls now share the same unordered node pair, keep the one with the smaller id, transfer the other's openings to it when they fit without overlap (re-projecting their centres), otherwise delete them; delete `src`. Every deleted id is appended to `out.deletedIds`.

**`reclampOpenings(wallId, movedEnd, oldLength)`**: for every opening on the wall: if only node `a` moved, `offset = newLength − (oldLength − offset)` (keeps the distance to the unmoved end `b`); if only `b` moved, keep `offset`; if both/none, keep `offset`. Then clamp to `[width/2, newLength − width/2]`; if `width > newLength` → abort `engine.plan.command.opening_no_fit`; if two openings overlap after clamping → abort `engine.plan.command.opening_overlap`.

**`nextOpeningLabel(kind)`**: `D{n}` for doors, `W{n}` for windows, where `n` = 1 + the largest integer `k` among existing labels matching `^D(\d+)$` (resp. `^W(\d+)$`); `opening` kind gets `null`.

### 6.6 Command catalogue

All commands live in `engine/plan/commands/` and are registered in `registry.ts` as `PLAN_COMMANDS`. Unless stated otherwise every coordinate param is rounded to integer mm in `run`, every id param must exist (`validate` → `engine.plan.command.not_found` with `params.id`), and numeric params are range-checked (`engine.plan.command.out_of_range` with `params.field`, `params.min`, `params.max`). Ranges: coordinates `|v| ≤ 1 000 000`; wall thickness 50–1000; wall height 300–10000; opening width 300–6000, opening height 300–(wall height − sill), sill 0–3000; fixture width/depth 50–20000, fixture height 0–10000; elevations 0–10000; label `fontSize` 50–5000; label text 1–200 chars after trim; opening `label` null or 1–16 chars; room name 0–80 chars after trim (fits `order_items.room_label`); background `mmPerPixel` 0.01–1000, `opacity` 0–1. Size limits from `03` §1.1 `plan.too_large` are checked by `validate` of every add/insert command (`engine.plan.command.too_large`).

| Command | Params | Merge | Geometry | Result |
|---|---|---|---|---|
| `addWall` | `{ from: EndpointRef; to: EndpointRef; thickness?; height?; kind?; material? }` | — | yes | `{ wallIds: string[]; startNodeId; endNodeId }` |
| `addWallChain` | `{ points: EndpointRef[]; closed: boolean; thickness?; height?; kind?; material? }` | — | yes | `{ wallIds; nodeIds }` |
| `moveNode` | `{ nodeId; to: Vec2; finalize: boolean }` | replace `moveNode:{id}` | yes | `{ mergedInto: string \| null }` |
| `moveWall` | `{ wallId; distance: number; finalize: boolean }` | replace `moveWall:{id}` | yes | — |
| `setWallLength` | `{ wallId; length: number; anchor: 'a' \| 'b' \| 'auto' }` | — | yes | `{ movedNodeId }` |
| `splitWall` | `{ wallId; at: number }` | — | yes | `{ nodeId; newWallId }` |
| `mergeCollinearWalls` | `{ nodeId }` | — | yes | `{ keptWallId; removedWallId }` |
| `deleteWalls` | `{ wallIds: string[] }` | — | yes | `{ deletedIds }` |
| `deleteNode` | `{ nodeId }` | — | yes | `{ deletedIds }` |
| `setWallProps` | `{ wallIds; props: Partial<{ thickness; height; kind; material; colorHex }> }` | replace `wallProps:{ids}` | yes | — |
| `addOpening` | `{ wallId; kind; type?; offset; width?; height?; sillHeight?; hinge?; swing?; label?: string \| null }` | — | yes | `{ openingId }` |
| `moveOpening` | `{ openingId; wallId?: string; offset: number }` | replace `moveOpening:{id}` | yes | — |
| `resizeOpening` | `{ openingId; width?; height?; sillHeight?; keep: 'center' \| 'start' \| 'end' }` | replace `resizeOpening:{id}` | yes | — |
| `setOpeningProps` | `{ openingIds; props: Partial<{ kind; type; height; sillHeight; hinge; swing; label }> }` | — | yes | — |
| `flipOpening` | `{ openingIds; what: 'swing' \| 'hinge' \| 'both' }` | — | yes | — |
| `deleteOpenings` | `{ openingIds }` | — | yes | — |
| `setRoomMeta` | `{ faceKey; props: Partial<{ name; type; floorFinish; floorColorHex; labelOffset; showArea }> }` | replace `roomMeta:{faceKey}` | no | `{ metaId; created: boolean }` |
| `deleteRoomMeta` | `{ metaId }` | — | no | — |
| `addPlacement` | `{ designId; x; y; rotation; elevation?; mirrored?; wallAttachment? }` | — | no | `{ placementId }` |
| `movePlacement` | `{ placementId; x; y; rotation?; wallAttachment: {wallId; side} \| null }` | replace `placement:{id}` | no | — |
| `rotatePlacement` | `{ placementId; rotation; pivot: 'center' \| 'back_center' }` | replace `placementRot:{id}` | no | — |
| `setPlacementProps` | `{ placementIds; props: Partial<{ elevation; mirrored }> }` | — | no | — |
| `deletePlacements` | `{ placementIds }` | — | no | — |
| `addFixture` | `{ libraryKey; x; y; rotation?; width?; depth?; height?; elevation?; label? }` | — | no | `{ fixtureId }` |
| `moveFixture` | `{ fixtureId; x; y; rotation? }` | replace `fixture:{id}` | no | — |
| `setFixtureProps` | `{ fixtureIds; props: Partial<{ libraryKey; width; depth; height; elevation; rotation; label }>; keep?: 'center' \| CornerKey }` | replace `fixtureProps:{ids}` | no | — |
| `deleteFixtures` | `{ fixtureIds }` | — | no | — |
| `addDimension` | `{ a; b; offset; attachedTo }` | — | yes¹ | `{ dimensionId }` |
| `setDimension` | `{ dimensionId; a?; b?; offset?; attachedTo? }` | replace `dim:{id}` | yes¹ | — |
| `deleteDimensions` | `{ dimensionIds }` | — | no | — |
| `addLabel` | `{ position; text; fontSize?; rotation? }` | — | no | `{ labelId }` |
| `setLabel` | `{ labelId; props: Partial<{ position; text; fontSize; rotation }> }` | replace `label:{id}` | no | — |
| `deleteLabels` | `{ labelIds }` | — | no | — |
| `setBackground` | `{ background: BackgroundImage }` | — | no | — |
| `setBackgroundProps` | `{ props: Partial<{ position; rotation; opacity; visible; locked }> }` | replace `bgProps` | no | — |
| `calibrateBackground` | `{ space: 'plan'; p1: Vec2; p2: Vec2; realDistance: number; scaleGeometry: boolean } \| { space: 'image'; a: Vec2; b: Vec2; distanceMm: number }` | — | yes | `{ factor: number }` |
| `rescalePlan` | `{ factor: number }` | — | yes | — |
| `removeBackground` | `{}` | — | no | — |
| `setPlanMeta` | `{ props: Partial<{ defaultWallHeight; defaultWallThickness; floorThickness; northAngle }> }` | — | no | — |
| `translateEntities` | `{ ids: string[]; dx; dy; finalize: boolean }` | replace `translate:{hash(ids)}` | yes | — |
| `nudgeEntities` | `{ ids: string[]; dx; dy }` | **compose** `nudge:{hash(ids)}` | yes | — |
| `insertFragment` | `{ fragment: PlanFragment; dx; dy }` | — | yes | `{ idMap: Record<string, string> }` |
| `deleteEntities` | `{ ids: string[] }` | — | yes | `{ deletedIds }` |

¹ only to recompute attached dimension points.

**Detailed semantics** (validation → mutation → result invariants):

- **`addWall`** — defaults: `thickness = kind === 'exterior' ? defaults.exteriorThickness : defaults.interiorThickness`, `height = defaults.wallHeight`, `kind = 'interior'`, `material = 'brick'`, `colorHex = null`, `justification = 'center'`. Run: `from = resolveEndpoint(from)`, `to = resolveEndpoint(to)`; if `from === to` → abort `wall_too_short`; `insertWallSegment(from, to)`. Invariants: no wall crosses another without a shared node; no duplicate node pairs; all new walls ≥ 10 mm.
- **`addWallChain`** — runs `addWall` logic for each consecutive pair (and last→first if `closed`), reusing the node ids returned by the previous segment. Requires ≥ 2 points (≥ 3 if closed). The Room tool uses it with 4 points, `closed: true`.
- **`moveNode`** — validate: every incident wall would be ≥ `MIN_WALL_LENGTH` (except walls to a node within `NODE_MERGE_TOL` of `to` when `finalize`, which are merged away). Run: set position; for each incident wall `reclampOpenings(w, moved end, oldLength)`. If `finalize`: (1) if another node is within `NODE_MERGE_TOL` of `to` → `mergeNodeInto(nodeId, nearest)`, `result.mergedInto = nearest`; (2) else if a non-incident wall centre line is within `NODE_MERGE_TOL` → `splitWallAt` there and merge into the new node; (3) `splitIntersections` for each (remaining) incident wall.
- **`moveWall`** — parallel move by signed `distance` along the wall's `+n`. For each end node `N` (position `P`): if `N` has exactly one other incident wall `O` and `O` is not parallel to the moved wall, slide `N` along `O`'s line: `P' = lineIntersection(P + n·distance, d, P, dir(O))`; if `|P' − P| > 10·|distance| + 1000` (near-parallel) or `O` is parallel, or `N` has 0 or ≥ 2 other walls → `P' = P + n·distance` (connected walls stretch). Validation: all touched walls ≥ `MIN_WALL_LENGTH`. Openings on the moved wall keep `offset` (then clamp); openings on neighbour walls use `reclampOpenings` with their moved end. `finalize` → `splitIntersections` for the moved wall and the neighbours.
- **`setWallLength`** — moving node: `anchor 'a'` ⇒ `b` moves; `'b'` ⇒ `a` moves; `'auto'` ⇒ `b` if `deg(b) = 1`, else `a` if `deg(a) = 1`, else `b`. New position = `fixed + dir(fixed→moving)·length`, then identical to `moveNode { finalize: true }`.
- **`splitWall`** — `at ∈ [MIN_WALL_LENGTH, length − MIN_WALL_LENGTH]` (else `out_of_range`); `splitWallAt`.
- **`mergeCollinearWalls`** — validate: node degree exactly 2; the two walls' outgoing directions are opposite within `ANGLE_TOL` (else `engine.plan.command.not_collinear`); identical `thickness`, `height`, `kind`, `material`, `colorHex` (else `engine.plan.command.props_differ`). Kept wall `K` = smaller id; removed `R`. Replace `K`'s endpoint at the node with `R`'s far node (direction unchanged). Openings of `K` shift by `len(R)` if `K.a` was replaced; openings of `R` are re-projected by centre point. Dimensions and placements attached to `R` move to `K` (swap `left`/`right` when `dot(d_R, d_K) < 0`). Delete `R` and the node.
- **`deleteWalls`** — cascade: openings on them, dimensions attached to them (deleted), placements attached (`wallAttachment = null`). Then for each end node now of degree 2 whose walls satisfy `mergeCollinearWalls` validation → merge (keeps straight walls clean after removing a T-branch). `deleteNode` = `deleteWalls(incident walls)`.
- **`setWallProps`** — height change: every opening on the wall must satisfy `sillHeight + height ≤ newHeight` (else `engine.plan.command.opening_too_tall`). `colorHex` must match `^#[0-9a-f]{6}$` (lower-cased in run) or be `null`. Changing `thickness` triggers post-process (attached furniture follows the face).
- **`addOpening`** — defaults by kind: door `{ type 'single_swing', width doorWidth, height doorHeight, sill 0 }`, window `{ type 'casement', width windowWidth, height windowHeight, sill windowSill }`, opening `{ type 'opening', width openingWidth, height openingHeight, sill 0 }`; `hinge 'start'`, `swing 'left'`, `label` = `nextOpeningLabel` when undefined. `type` must belong to `kind` (`DoorType` for door, `WindowType` for window, `'opening'` for opening) else `engine.plan.command.type_mismatch`. If `sill + height > wall.height` for a window, `height` is reduced to `wall.height − sill` when ≥ 300, else `opening_too_tall`. Bounds and overlap: `width/2 ≤ offset ≤ length − width/2` (`opening_no_fit`), no overlap (`opening_overlap`).
- **`moveOpening`** — optional target wall (dragging a door to another wall); same bounds/overlap/height checks on the target; `swing`/`hinge` unchanged.
- **`resizeOpening`** — `keep 'start'`: `u0` fixed ⇒ `offset' = u0 + width'/2`; `'end'`: `u1` fixed; `'center'`: offset unchanged. Then bounds/overlap/height checks.
- **`setOpeningProps`** — changing `kind` applies that kind's default `type`, `height`, `sillHeight` unless given; then the usual checks.
- **`flipOpening`** — `swing` toggles left/right, `hinge` toggles start/end.
- **`setRoomMeta`** — face must exist in `ctx.geometry.rooms` (else `not_found`). If the face has `metaId` → update props; else create `{ id: newId('r'), anchor: roundPoint(face.labelPoint), name: '', type: 'other', floorFinish: 'tile', floorColorHex: null, labelOffset: null, showArea: true, ...props }`. `name` trimmed. `floorColorHex` as in `setWallProps`.
- **`addPlacement`** — `ctx.footprints(designId)` must be non-null (else `engine.plan.command.design_unknown`). `elevation` default 0, `mirrored` false, `rotation` normalised. If `wallAttachment` is given, the wall must exist.
- **`movePlacement`** — sets `x, y`, optional rotation, and `wallAttachment` exactly as given (the editor passes the snap result; `null` detaches).
- **`rotatePlacement`** — `pivot 'center'`: the footprint centre `C` stays fixed: `C = P + f(θ)·D/2`, `P' = C − f(θ')·D/2`. Detaches (`wallAttachment = null`) unless `θ'` equals the attached face's rotation within 0.5°.
- **`addFixture`** — `libraryKey ∈ FIXTURE_KEYS` (else `engine.plan.command.fixture_unknown`); size/elevation defaults from `FIXTURE_LIBRARY[libraryKey]` (`05` §9); `label` default `null`.
- **`setFixtureProps`** — when `width`/`depth` change and `keep` is a corner key (`'back_left' | 'back_right' | 'front_left' | 'front_right'`), the opposite corner of the footprint stays fixed and `x, y` are recomputed; `keep 'center'` (default) keeps `x, y`. Changing `libraryKey` resets width/depth/height/elevation to the new defaults unless also given.
- **`addDimension` / `setDimension`** — `|a − b| ≥ 10` (else `engine.plan.command.dimension_too_short`); `|offset| ≤ 50 000`. When `attachedTo` is set, `a`/`b` are overwritten in post-process from the wall face.
- **`addLabel` / `setLabel`** — text trimmed, 1–200 chars (`engine.plan.command.text_length`); `fontSize` default 250.
- **`setBackground`** — `pixelWidth`, `pixelHeight` > 0 integers; `mediaUuid` non-empty; ranges as above. Replaces any existing background.
- **`calibrateBackground`** — requires a background (`engine.plan.command.background_missing`) that is not locked (`engine.plan.command.background_locked`). **`space: 'image'`** (`06` §12.2 "plan.background.calibrate"): `a`, `b` are image pixel coordinates; `|a − b| ≥ 10` px, `distanceMm ≥ 100`; sets `mmPerPixel = distanceMm / |a − b|`, `position` unchanged; result `factor` = new/old `mmPerPixel`. **`space: 'plan'`** (editor Background tool): `pxDist = |p1 − p2| / mmPerPixel` must be ≥ 10 (`engine.plan.command.calibration_too_short`); `realDistance ≥ 100`. `k = realDistance / |p1 − p2|`. `mmPerPixel *= k`; `position = round(p1 + (position − p1)·k)` (the background rotates about its centre, `05` §4.12; scaling `position` and size about `p1` keeps every image point consistent with that rotation). If `scaleGeometry`: every node, placement `x,y`, fixture `x,y`, label position, unattached dimension point and RoomMeta anchor is scaled about `p1` by `k` (rounded); opening `offset`s are multiplied by `k` then clamped; thicknesses and sizes are **not** scaled. Result `{ factor: k }`.
- **`rescalePlan`** (used by `06` §11.3 "Check a dimension") — `factor ∈ [0.01, 100]`. Multiplies about the origin `(0, 0)` and rounds: every node coordinate, wall `thickness` (clamped 50–1000), opening `offset` and `width` (width clamped 300–6000), RoomMeta `anchor` and `labelOffset`, text label `position`, dimension `a`, `b`, `offset`, placement and fixture `x, y` (not sizes), `background.mmPerPixel` and `background.position`. Heights, sills, elevations and furniture/fixture sizes are unchanged. If any opening no longer fits after rounding it is clamped (`reclampOpenings` rules); abort only if a wall would fall below `MIN_WALL_LENGTH`.
- **`setPlanMeta`** — ranges: wall height 300–10000, thickness 50–1000, floor 0–1000, `northAngle` null or [0, 360).
- **`translateEntities`** — collects: nodes of walls in `ids` plus node ids in `ids` (each moved once); placements, fixtures, labels, unattached dimensions in `ids`; RoomMeta anchors whose face's walls are all moved; `'background'` if present and unlocked. Openings move implicitly with their walls. Walls shared with unselected walls stretch. `finalize` → `splitIntersections` for every wall incident to a moved node, and merge moved nodes with unmoved nodes within `NODE_MERGE_TOL`.
- **`nudgeEntities`** — identical to `translateEntities { finalize: true }` but registered with `mergeMode: 'compose'` so consecutive keyboard nudges (relative steps) merge into one entry (`hash(ids)` = `cyrb53(sorted ids joined by ',')`).
- **`insertFragment`** — `PlanFragment = Pick<PlanDocument, 'nodes' | 'walls' | 'openings' | 'placements' | 'fixtures'> & { dimensions; labels; rooms }` (a subset with original ids, produced by the editor's copy, `05` §7.14). Every id is remapped with `newId(prefix)`, coordinates offset by `(dx, dy)`, references rewritten; walls are inserted with `insertWallSegment` (so pasted walls join/split existing ones); openings whose wall did not get created (fully covered by an existing wall) are dropped and reported in `warnings` (`engine.plan.command.fragment_opening_dropped`); placements keep `designId` (the editor only pastes placements whose design belongs to the same project).
- **`deleteEntities`** — partitions `ids` by prefix (`w_`, `n_`, `o_`, `r_`, `f_`, `x_`, `d_`, `t_`, `'background'`) and runs the matching delete logic inside one run; walls first (so their cascades are not double-deleted).

### 6.7 Command error codes

`messageKey = 'engine.plan.command.' + code`: `not_found`, `out_of_range`, `too_large`, `wall_too_short`, `wall_duplicate`, `split_through_opening`, `opening_no_fit`, `opening_overlap`, `opening_too_tall`, `type_mismatch`, `not_collinear`, `props_differ`, `design_unknown`, `fixture_unknown`, `dimension_too_short`, `text_length`, `background_missing`, `background_locked`, `calibration_too_short`, `introduces_error`, `fragment_opening_dropped` (warning only), `invalid_params` (zod failure of the params object; every command's params have a zod schema in `registry.ts` and the bus validates them before `validate`). History labels: `engine.plan.command.label.<snake_case_type>`.

### 6.8 Acceptance criteria — commands

- [ ] Drawing a wall across an existing wall splits both; the result has 4 walls sharing one new node; one undo restores the original single wall exactly (deep-equal document).
- [ ] Drawing a wall whose end is 3 mm from an existing node joins that node; 3 mm from a wall's centre line creates a T-junction node on that wall.
- [ ] Drawing a wall exactly over an existing wall returns `wall_duplicate` and leaves the document unchanged; drawing a longer wall overlapping half of an existing one creates only the uncovered part.
- [ ] A 200-move drag of a node creates exactly one history entry; undo restores the pre-drag document.
- [ ] Ten arrow-key nudges within 800 ms create one entry (compose); after 800 ms idle the next nudge creates a new entry.
- [ ] Moving node `a` of a wall keeps every opening's distance to node `b`; shrinking a wall below an opening's width aborts with `opening_no_fit`.
- [ ] `moveWall` on the top wall of a rectangle keeps the rectangle closed and rectangular (neighbours slide).
- [ ] Deleting the stem of a T merges the two collinear pieces back into one wall (when props equal).
- [ ] `calibrateBackground { space: 'plan' }` with `p1=(0,0)`, `p2=(1000,0)`, `realDistance 3000` triples `mmPerPixel`, keeps `p1` fixed, and with `scaleGeometry` triples all node coordinates; the `image` variant with `a=(0,0)`, `b=(100,0)`, `distanceMm 1500` sets `mmPerPixel = 15`.
- [ ] `rescalePlan { factor: 2 }` doubles node coordinates and wall thicknesses (clamped at 1000), keeps heights; one undo restores the document.
- [ ] No command can introduce a `validatePlan` error (property test: 500 random command sequences on `makeGridPlan(3,3)`; after each successful command, the error set never grows).
- [ ] History never exceeds 200 entries.

---

## 7. `derivePlanGeometry`: caching, incremental strategy and budgets

### 7.1 Signature and output

```ts
export interface DerivedPlan extends PlanGeometry {     // PlanGeometry = 03 §1.2
  walls: Record<string, DerivedWall>;
  rooms: DerivedRoom[];                                  // sorted by faceKey
  openings: Record<string, DerivedOpening>;
  nodes: Record<string, { wallIds: string[] }>;          // incident valid walls
  nodeCaps: Record<string, Vec2[]>;
  wallsUnion: PolygonWithHoles[];
  roomIndexByMetaId: Record<string, number>;
  roomIndexByFaceKey: Record<string, number>;
  issues: DeriveIssue[];
  docRef: PlanDocument;                                  // the document this was derived from (identity)
}
export function derivePlanGeometry(doc: PlanDocument): DerivedPlan;   // stateless convenience (fresh deriver each call)
export function createPlanDeriver(): { derive(doc: PlanDocument): DerivedPlan; clear(): void };
```

Derivation is a pure function of `doc.nodes`, `doc.walls`, `doc.openings` and `doc.rooms` (placements, fixtures, annotations, background and view do **not** affect it).

### 7.2 Caching (inside `createPlanDeriver`)

Mutative preserves object identity for untouched entities, so caches compare **references**:

1. **Whole result.** If `nodes`, `walls`, `openings`, `rooms` are the same objects as in the last call → return the last result (with `docRef` updated).
2. **Rooms association only.** If only `rooms` changed → reuse everything, recompute §4.4(a) association and `labelPoint`s for changed metas.
3. **Node joins.** Per node, a signature string `x,y|` + sorted incident `wallId:otherX,otherY:thickness` entries. Recompute `computeNodeJoins` only when the signature changed.
4. **Wall outlines / poché.** Per wall, memo keyed by (wall object, endA join object, endB join object, the list of its opening objects). Recompute outline and `pocheParts` only on change.
5. **Planar graph + face walk.** Recomputed whenever `nodes` or `walls` changed (< 1 ms for 100 walls).
6. **Room net polygons.** Per face, memo keyed by the face ring coordinates string + the outline objects of the walls whose bbox intersects the face bbox. The net polygon is `difference(face, union(those local outlines))` — equal to the global difference but local, so moving one node only recomputes the adjacent rooms. Polylabel memoised with the net polygon.
7. **wallsUnion / exteriorOutline.** Recomputed when any outline changed.

### 7.3 Performance budgets (Vitest `bench`, Node 22; CI asserts 2× the target to absorb runner variance)

| Operation | Fixture | Target | CI assert |
|---|---|---|---|
| Cold derive | `makeGridPlan(7, 6)`: 97 walls, 42 rooms, 40 openings | ≤ 15 ms | ≤ 30 ms |
| Warm derive after one `moveNode` | same | ≤ 4 ms | ≤ 8 ms |
| Cold derive | `makeGridPlan(22, 22)`: 1012 walls | ≤ 200 ms | ≤ 400 ms |
| `snapPoint` | 500-wall plan | ≤ 0.5 ms | ≤ 1 ms |
| `buildSnapIndex` + `buildHitIndex` | 500-wall plan | ≤ 3 ms | ≤ 6 ms |
| `executePlanCommand('moveNode', finalize false)` incl. derive | 97-wall plan | ≤ 6 ms | ≤ 12 ms |
| `validatePlan` | 97-wall plan | ≤ 3 ms | ≤ 6 ms |

The editor calls the deriver synchronously on the main thread (`05` §3.5); the worker variant (`01` §5.5) is used only for revision comparison renders.

---

## 8. Drawing model and export helpers (`engine/plan/drawing/`)

One drawing model feeds the live 2D renderer, SVG/PNG/PDF export (`05` §14) and the DXF writer (editor layer, `@tarikjabiri/dxf`). Using the same `draw*` functions everywhere guarantees that exports look like the screen.

### 8.1 Types

```ts
export type LayerName = 'BACKGROUND' | 'ROOMS' | 'FIXTURES' | 'FURNITURE' | 'WALLS' | 'OPENINGS' | 'DIMS' | 'TEXT';
// Paint order = the order above. DXF layer names: WALLS, OPENINGS, ROOMS, DIMS, FURNITURE, FIXTURES, TEXT (BACKGROUND is never exported to DXF).

export type StyleKey =
  | 'wall' | 'wall_exterior' | 'wall_half' | 'wall_glass' | 'wall_outline'
  | 'opening_jamb' | 'door_leaf' | 'door_swing' | 'door_main_leaf' | 'sliding_panel' | 'window_frame' | 'window_glass' | 'threshold'
  | 'room_fill' | 'room_name' | 'room_area' | 'room_dims'
  | 'furniture' | 'furniture_front' | 'furniture_label' | 'furniture_missing'
  | 'fixture' | 'fixture_detail'
  | 'dim_line' | 'dim_tick' | 'dim_text' | 'dim_ext'
  | 'label';

export type DrawItem =
  | { t: 'poly'; pts: Vec2[]; holes?: Vec2[][]; closed: boolean; style: StyleKey; fill?: string }   // fill overrides style fill (room colours)
  | { t: 'line'; a: Vec2; b: Vec2; style: StyleKey }
  | { t: 'arc'; c: Vec2; r: number; startDeg: number; endDeg: number; style: StyleKey } // plan-space angles (§2.1-7), sweep clockwise on screen from start to end
  | { t: 'circle'; c: Vec2; r: number; style: StyleKey }
  | { t: 'text'; at: Vec2; text: string; sizeMm: number; dyEm: number; rotationDeg: number; anchor: 'start' | 'middle' | 'end'; baseline: 'middle' | 'top' | 'bottom'; style: StyleKey }
    // dyEm: offset perpendicular to the text direction (positive = down in the text's rotated frame) in multiples of the rendered text size;
    // lets the live renderer draw screen-sized text (05 §4.3) while exports use sizeMm
  | { t: 'image'; href: string; at: Vec2; width: number; height: number; rotationDeg: number; opacity: number };

export interface DrawGroup { entityId: string | null; entityKind: 'wall' | 'opening' | 'room' | 'placement' | 'fixture' | 'dimension' | 'auto_dimension' | 'label' | 'background'; items: DrawItem[] }
export interface PlanDrawing { bbox: { min: Vec2; max: Vec2 } | null; layers: Record<LayerName, DrawGroup[]> }

export interface DrawingOptions {
  units: UnitPrefs;
  strings: { unnamedRoom: string; missingDesign: string };   // already translated by the caller
  footprints: FootprintProvider;
  designName(designId: string): string | null;
  textSizeMm(style: StyleKey): number;      // screen: px / zoom; export: paper mm × scale denominator
  include: {
    background: { href: string } | null; rooms: boolean; roomAreas: boolean; roomDims: boolean;
    furniture: boolean; fixtures: boolean; doorSwings: boolean; autoDimensions: boolean; userDimensions: boolean; labels: boolean;
  };
  lod: 0 | 1 | 2;                           // 0 = full, 1 = medium, 2 = coarse (05 §4.7)
}

export function buildPlanDrawing(doc: PlanDocument, geom: DerivedPlan, opts: DrawingOptions): PlanDrawing;
export function drawWall(w: DerivedWall, wall: Wall, opts: DrawingOptions): DrawGroup;
export function drawOpening(o: DerivedOpening, opening: Opening, w: DerivedWall, opts: DrawingOptions): DrawGroup;
export function drawRoom(r: DerivedRoom, meta: RoomMeta | null, opts: DrawingOptions): DrawGroup;
export function drawPlacement(p: FurniturePlacement, opts: DrawingOptions): DrawGroup;
export function drawFixture(f: Fixture, opts: DrawingOptions): DrawGroup;   // symbols from FIXTURE_LIBRARY (05 §9)
export function drawDimension(d: DimensionAnnotation, opts: DrawingOptions): DrawGroup;
export function autoDimensions(w: DerivedWall, wall: Wall, opts: DrawingOptions): DrawGroup; // entityKind 'auto_dimension', entityId = wall id
export function drawLabel(l: TextLabel, opts: DrawingOptions): DrawGroup;
export function svgFromDrawing(d: PlanDrawing, o: SvgExportOptions): string;
```

### 8.2 Symbol rules

- **Walls:** each `pocheParts` polygon with style `wall` / `wall_exterior` (kind exterior) / `wall_half` / `wall_glass` (material glass). The outline stroke is drawn once for the whole plan from `wallsUnion` (`wall_outline`) so internal joints are invisible.
- **Doors** (hinge point `H = jamb(hingeU)` on the swing face `swingSign`; leaf length = clear width):
  - `single_swing`: leaf line from `H` perpendicular to the wall (`swingSign·n`), length `width`; arc centred at `H` from the open leaf to the far jamb on the same face (90°).
  - `double_swing`: two leaves of `width/2` from both jambs, two arcs meeting at the centre.
  - `main_entrance`: as `single_swing` with style `door_main_leaf` (heavier) plus a `threshold` line across the opening on the centre line.
  - `sliding`: two `sliding_panel` rectangles of length `0.55·width` and depth 30 mm, at `±thickness/6` from the centre line, one from each jamb.
  - `pocket`: one panel of length `width` starting at the hinge jamb and extending into the wall (`dashed` portion = inside the wall).
  - `bifold`: two leaves of `width/2` forming a "V" toward the swing side, each at 30° from the wall line, hinged at the hinge jamb.
  - Swing arcs are omitted when `include.doorSwings === false` or `lod ≥ 1` (leaf lines kept).
- **Windows** (between the two jambs): `window_frame` lines on both faces; `casement`/`ventilator`: two `window_glass` lines at `±20` mm from the centre line; `ventilator` adds one diagonal; `sliding_window`: two overlapping glass lines at `±thickness/6` each spanning `0.55·width`; `fixed`: one glass line on the centre line; `french_window`: frame + glass as casement plus double-swing leaves (`door_leaf`) and arcs; `bay`: a trapezoid projecting 400 mm to the exterior side (`exteriorSide`, else `+n`) with 45° sides, glass on the outer edge.
- **Openings (`opening` kind):** two `opening_jamb` lines across the wall at `u0` and `u1`.
- **Rooms:** `room_fill` polygon (net polygon + holes) with `fill` from the room-type colour (`05` §4.6); label text items at `labelPoint` stacked with `dyEm` (name `−0.6`, area `+0.6`, dims `+1.8` when all three are shown; a single line uses `0`): name (`room_name`; empty name → `strings.unnamedRoom`), area (`room_area`, `formatArea`) if `meta?.showArea ?? true` and `include.roomAreas`, rectangle dims (`room_dims`, `"{w} × {d}"` with `formatLength(…, {style:'summary'})`) if `netRect` and `include.roomDims`.
- **Furniture:** footprint polygon (`furniture`), front edge (`furniture_front`) plus a small isosceles triangle (base 150 mm, height 100 mm) at the front-edge midpoint pointing outward; name text (`furniture_label`, design name, hidden at `lod ≥ 1`). Unknown design → dashed `furniture_missing` 600 × 600 square with `strings.missingDesign`.
- **Fixtures:** see `05` §9 (symbol primitives are data in `FIXTURE_LIBRARY`).
- **Auto dimensions** (one group per wall with length ≥ 300 mm): dimension side = `exteriorSide ?? 'left'`; dimension line offset `thickness/2 + 400` mm from the centre line on that side; row 1 = overall centre-line length; row 2 (only if the wall has openings) = chain `0 → u0₁ → u1₁ → … → length`, offset a further 350 mm. Ticks are 45° `dim_tick` strokes of 150 mm; extension lines (`dim_ext`) from 100 mm off the face to 100 mm beyond the dimension line. Text = `formatLength(segment, units)`, anchored at the segment midpoint with `baseline 'bottom'`, `dyEm −0.25` (just above the line), rotated with the line and normalised to `(−90°, 90°]` so it is never upside down.
- **User dimensions:** same graphics from `a`, `b`, signed `offset` along `perpLeft(normalize(b − a))`.
- **Labels:** `label` text at `position`, `sizeMm = label.fontSize` (model-space size, scales with zoom by design, `03` §1 `TextLabel.fontSize`), rotation `label.rotation`.

### 8.3 `svgFromDrawing`

```ts
export interface SvgExportOptions {
  viewBox: { min: Vec2; max: Vec2 };      // model mm
  widthPx: number; heightPx: number;       // output size attributes
  styles: Record<StyleKey, { stroke: string | null; strokeWidthMm: number; fill: string | null; dash: number[] | null; fontWeight?: 400 | 600; hatch?: { angleDeg: number; spacingMm: number; color: string } }>;
  background: string | null;               // '#ffffff' for exports
  fontFamily: string;                      // 'Inter, Arial, sans-serif'
}
```

Rules: one `<g id="layer-{LAYER}">` per layer in paint order; one `<g data-entity="{id}">` per group; `poly` with holes → a single `<path fill-rule="evenodd">`; arcs → SVG `A` path commands (convert plan angles directly since SVG is also y-down); text → `<text>` with `transform="rotate(...)"`, `dominant-baseline`, `text-anchor`; hatches → one `<pattern patternUnits="userSpaceOnUse">` per hatch style. **All text content and attribute values are XML-escaped** (`& < > " '`) — room names and labels are user input. Numbers are written with at most 2 decimals. The output contains no scripts, no external references except the background image `href` (which the PNG/PDF exporters inline as a data URL).

### 8.4 DXF mapping (implemented in `resources/js/editor/plan/export/exportDxf.ts`, `05` §14.4)

| DrawItem | DXF entity |
|---|---|
| `poly` closed | `LWPOLYLINE` closed (holes as separate closed LWPOLYLINEs) |
| `poly` open | `LWPOLYLINE` |
| `line` | `LINE` |
| `arc` | `ARC` (angles converted for y-flip: `start' = −endDeg`, `end' = −startDeg`) |
| `circle` | `CIRCLE` |
| `text` | `TEXT` (height = `sizeMm`, rotation = `−rotationDeg`, alignment from anchor) |
| `image` | skipped |

Coordinates: `x_dxf = x`, `y_dxf = −y` (DXF is y-up). Header `$INSUNITS = 4` (millimetres). Layer colours (ACI): WALLS 7, OPENINGS 4, ROOMS 8, DIMS 1, FURNITURE 5, FIXTURES 3, TEXT 7.

---

## 9. Required unit tests (Vitest, `resources/js/engine/**/__tests__/*.test.ts`)

Test document builders (`engine/plan/testing/fixtures.ts`), deterministic ids via an injected counter `newId`:
- `makeRectPlan(w, h, t)`: 4 walls, nodes at `(0,0)`, `(w,0)`, `(w,h)`, `(0,h)`, thickness `t`, kind exterior.
- `makeLPlan()`: L-shaped flat 8000 × 6000 with a 3000 × 2500 notch, exterior 230, one interior wall 115, two doors, two windows.
- `makeGridPlan(cols, rows, cell = 3000)`: grid of rooms; exterior 230, interior 115; a 900 mm door centred on each of the first 40 interior walls in ascending id order (fewer if the grid has fewer interior walls), giving 40 openings for (7, 6).
- The `03` §6 fixtures `hdb-3room.json` and `brochure-2bhk.json` are also loaded in tests.

| File | Required cases |
|---|---|
| `units/parse.test.ts`, `format.test.ts` | every row of §1.5; fuzz; round-trip |
| `geometry/vec2.test.ts`, `segment.test.ts`, `polygon.test.ts` | §2.8 checks; `pointInRing` boundary/inside/outside; `simplifyCollinear` removes a vertex 0.3 mm off line; `isAxisRectangle` positive and rotated-45° negative |
| `geometry/clip.test.ts` | union/difference/intersection areas; offset of a 1000 square by 100 (miter) = 1200 square |
| `geometry/planarFaces.test.ts` | unit square traced CW with positive area; two adjacent squares → 2 faces + outer; dangling edge pruned; nested square → hole; crossing segments split |
| `geometry/polylabel.test.ts` | square → centre; L-shape → point inside the thicker arm with distance ≥ 0.45 × arm width; polygon with hole avoids the hole |
| `plan/walls.test.ts` | every row of §3.9; tessellation (union area = sum) for L, T, X and grid fixtures |
| `plan/rooms.test.ts` | §4.9 list; faceKey stability; `netRect` for rect rooms; HDB fixture produces ≥ 9 rooms with the named metas attached |
| `plan/reconcile.test.ts` | split, merge, move, delete-and-redraw (orphan then re-attach) scenarios of §4.4 |
| `plan/snapping.test.ts` | §5.11 list; grid steps for zoom 0.01/0.1/1 in both systems; opening snap centre/return/no-fit/overlap |
| `plan/footprint.test.ts` | footprint CW order for rotations 0/90/180/270; `rotationFromFront` inverse of `frontVector` for 0..359 |
| `plan/conflicts.test.ts` | furniture inside a door swing → `blocks_door`; wall cabinet (elevation 1400) above a counter → no item conflict; rug never conflicts; flush against wall → no wall conflict |
| `commands/bus.test.ts` | execute/undo/redo; replace & compose merging; transactions commit/rollback/nested; history cap 200; `history: false`; changedIds extraction |
| `plan/commands/*.test.ts` | one file per group; every command: happy path, each validation error code, undo restores deep-equal doc; §6.8 list |
| `plan/derive.bench.ts` | §7.3 budgets |
| `plan/drawing.test.ts` | `svgFromDrawing` escapes `<script>` in a room name; door symbol arc endpoints lie on the face; auto-dimension chain segment sum equals wall length |
| `engine/purity.test.ts` | imports every engine module in a Node environment without DOM (`01` §5.1) |

---

## 10. Acceptance criteria — engine as a whole

- [ ] `yarn test engine` passes, coverage ≥ 90 % lines for `engine/units`, `engine/geometry`, `engine/plan` (excluding `testing/`).
- [ ] ESLint `no-restricted-imports` forbids `vue`, `three`, `@tresjs/*` in `resources/js/engine/**`; `clipper2-ts` is imported only by `geometry/clip.ts`, `earcut` only by `geometry/triangulate.ts`.
- [ ] Engine CLI `plan-summary` and `validate-plan` on both `03` §6 plan fixtures return results matching committed snapshots.
- [ ] All `messageKey`s produced by the engine exist in `resources/lang/en/engine.php` (test enumerates the code lists of §1.1, §6.7, §5.9, §3 derive issues).

---

_Appendix merged into the target documents during reconciliation (see 19-reconciliation-log.md)._
