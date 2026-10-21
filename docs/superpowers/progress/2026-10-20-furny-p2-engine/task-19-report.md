# Task 19 report: svgFromDrawing + hit index

Status: DONE_WITH_CONCERNS (interpretations below). Base fae9a16.

## Implemented
- `resources/js/engine/plan/drawing/svg.ts`: `SvgExportOptions` (spec fields + `palette`), `SvgStyle`, `svgFromDrawing`.
  - `<g id="layer-X">` for all 8 layers in paint order (empty ones kept), `<g data-entity>` per group (plain `<g>` for the id-less wall outline group), poly with holes = one `<path fill-rule="evenodd">`, arcs = `M … A` (plan angles map directly, sweep-flag 1; >180 sets large-arc; a full turn becomes two half arcs), text with `transform="translate rotate"`, `dy = dyEm * size`, `text-anchor`, `dominant-baseline` (middle / hanging / alphabetic), halo (`paint-order="stroke"`) when a text style has a stroke, one `<pattern patternUnits="userSpaceOnUse">` per hatch style (emitted for every style that defines a hatch, STYLE_KEYS order, id `hatch-{style}`; tile = base rect + one line, rotated by `patternTransform`; line width = 10 % of spacing).
  - Numbers: `toFixed(2)` stripped, `-0` -> `0`; a non-finite number throws `RangeError` (fail loudly, no NaN/Infinity in output).
  - Colours: `fillKey` resolves through `palette` (own-property lookup; missing key throws naming the key). Style colours (stroke/fill/hatch/page background): a palette key if it is one, else a literal CSS colour, always escaped.
  - Dashes: item `dashed` or a style `dash` array -> `stroke-dasharray`; style array if present, else default `6 x width, 4 x width` (6 4 if width 0). Empty array = none.
  - Escaping: `& < > " '` (`&amp; &lt; &gt; &quot; &#39;`) in all text and attribute values, tab/CR/LF as char refs in attributes, XML-1.0-illegal characters (controls, lone surrogates, U+FFFE/F) stripped so the output stays well-formed.
  - Background image: the only `href` (no xlink). Allowed: `data:image/(png|jpeg|gif|webp)…,` or `http(s)://` without whitespace. Anything else (javascript:, data:text/html, data:image/svg+xml, relative, `//host`, whitespace tricks, empty) DROPS the `<image>` silently (documented, tested). Position = unrotated top-left, `rotate(deg cx cy)` about the centre, `preserveAspectRatio="none"`, opacity omitted at 1.
- `resources/js/engine/plan/hitIndex.ts`: `HitKind`, `Hit`, `HitLayerMask`, `HitIndex`, `buildHitIndex`, `hitTest`, `hitTestRect`. One Flatbush per class (reusing `buildClass`/`query` from snapIndex, now exported with `segBox`/`ringBox`).
  - Priority (04 §5.12): opening (cut ring, inside or <= tol) -> node (<= tol) -> user dimension (dim_line segs + text boxes, <= tol) -> text label box -> room label box -> placement/fixture footprint (inside or <= tol) -> wall (outline inside or <= tol) -> room (net polygon with holes, inside only) -> background. `hitTest` returns the hits of ALL classes, class order first (so [0] is the winner, the rest feeds Alt-cycling).
  - Within a class: bodies = inside before edge, inside by `elevation + height` desc then later id (id descending) first; edge hits by distance then top, id. Walls by outline distance, then centre-line distance (picks the right wall in a joint), then id. Rooms by smaller area. Others by distance, id.
  - Tolerance = `snapTolerance(pointerType, zoom)` (8 px mouse/pen, 16 px touch, / zoom). Labels, room labels, rooms are inside-only (no tolerance, as 04 §5.12 words them). Non-positive zoom throws.
  - Mask: `Partial<Record<HitKind, boolean>>`, `false` hides a kind; background needs explicit `background: true` AND visible AND unlocked (05 §4.10 / 04 §5.12).
  - Ids: rooms are `metaId` or `face:{faceKey}` (05 §3.2), background is `'background'`. Placement of an unknown design is hittable as the 600 x 600 square drawn for it (`MISSING_SIZE` now exported from drawing/items.ts). Zero-width openings produce no hit shape (Task 12 ruling).
  - `hitTestRect`: window = entity bbox fully inside (nodes, openings, walls, bodies, user dims, labels, rooms); crossing = geometry meets the rect (walls by outline, openings by cut, bodies by footprint, nodes, dim lines/text), rooms excluded; sorted unique ids; corners in any order. Room labels and auto dimensions are not selectable.
- Test-only helpers (not exported): `plan/testing/svgOptions.ts` (fixed `TEST_PALETTE`, `TEST_STYLES`, `testSvgOptions`), `plan/testing/xmlCheck.ts` (strict XML well-formedness tokenizer; the engine project runs in Node with no DOM, jsdom is not installed and happy-dom's SVG parser is lenient; the checker has its own rejection tests).

## Tests
- `plan/drawing/__tests__/svg.test.ts` (63): structure, layers/entities, evenodd holes, arcs, text, escaping (malicious room name, entity id, fillKey, palette value, literal fill, font family with quotes, label text, illegal chars), numbers (<= 2 decimals regex, no -0/NaN, non-finite throws), strokes/dashes/hatches, background image (accept/drop table), determinism (twice + shuffled-id doc), smoke on both reference plans (+ label, dimension, background) with strict XML parse, NaN/Infinity scan, <= 2 decimals scan, single href, no unresolved tokens; checker self-tests.
- `plan/__tests__/hitIndex.test.ts` (44): every priority rule, tolerance by pointer and zoom, stacking, mask, background (incl. rotation), room islands, hitTestRect window/crossing, shuffled-doc determinism, both reference plans.

### TDD evidence
- RED svg: `yarn vitest run --project engine …/svg.test.ts` -> `Failed to load url ../svg … Does the file exist?` (module missing, expected).
- RED hit: with hitIndex.ts moved away -> `Cannot find module '../hitIndex'` (expected). (Written test-first; the RED run for hit index was re-demonstrated after the implementation by removing the file.)
- GREEN: `yarn vitest run --project engine resources/js/engine/plan/drawing/__tests__/svg.test.ts resources/js/engine/plan/__tests__/hitIndex.test.ts` -> 2 files, 107 tests passed.
- Full engine project: 39 files, 1338 tests passed (was 1231). Gates: `yarn eslint resources/js/engine && yarn prettier --check resources/js/engine && yarn vue-tsc --noEmit` clean; `yarn build:engine-cli` builds.

## Files changed
Created: plan/drawing/svg.ts, plan/hitIndex.ts, plan/drawing/__tests__/svg.test.ts, plan/__tests__/hitIndex.test.ts, plan/testing/svgOptions.ts, plan/testing/xmlCheck.ts.
Modified: engine/index.ts (+ `svgFromDrawing`, `SvgExportOptions`, `SvgStyle`, `buildHitIndex`, `hitTest`, `hitTestRect`, `Hit`, `HitIndex`, `HitKind`, `HitLayerMask`), plan/drawing/index.ts, plan/drawing/items.ts (`export` on MISSING_SIZE), plan/snapIndex.ts (`export` on buildClass, segBox, ringBox).

## Concerns / decisions to confirm
1. `palette` semantics: fillKey strict (throws); style colours fall back to literal when not a palette key (so P1's `PLAN_STYLES -> SvgExportOptions.styles` can pass hex or tokens). A mistyped token in a style silently becomes an invalid colour string; if you want strict-only, change `Writer.colour`.
2. Bad background `href` is dropped silently, not thrown. A throw is a one-line change.
3. Text boxes in the hit index use the `sizeMm` the drawing was built with (05 §4.6 width estimate 0.56 em). Screen-sized text styles (room_*, dim_text, furniture_label) are fixed-px on screen but `sizeMm` is px/zoom at build time, so room-label / dimension-text hit boxes are only exact at the zoom the drawing was built for. P4 must rebuild the index when it rebuilds the drawing for a zoom change (or accept the approximation).
4. Auto dimensions are deliberately not `dimension` hits (their drawing entity id is the wall id and would collide); P4 inline length editing must use the drawing items.
5. `hitTestRect` includes node ids (n_…) in both modes; the editor may filter by prefix if marquee should not select nodes. Window mode includes rooms by their bbox (spec: crossing excludes rooms, window does not).
6. `hitTest` returns hits of all classes (best first), not only the winning class.
7. `hitIndex.ts` is ~600 lines after prettier (one file as the brief lists); candidate for a split (shapes helpers vs index) if you want it.
8. Log in 19: `dashed`/style-dash default factor (6 x, 4 x stroke width), hatch tile construction, svg `href`-only (no xlink), hit result ordering, room/label tolerance rules.

## Fix round 1
Commits: 5af0231 (svg), 598b2e2 (hit index). Full engine project 39 files / 1386 tests passed; `yarn eslint resources/js/engine && yarn prettier --check resources/js/engine && yarn vue-tsc --noEmit` clean (exit 0); `yarn build:engine-cli` builds.

### Important
1. font-weight: `nattr('font-weight', …)` (throws "not finite" for a non-number, test with `'600" onload="alert(1)'`). Grepped svg.ts for every `${…}` in attribute position: all values go through `attr`/`nattr` (the only other interpolations are numbers via `num`, the validated id prefix, and constants). Extra test: malicious `fontFamily` and `background` strings stay escaped.
2. Priority mutants, all killed in a scratch copy: opening/node swap (touch-free case via zoom 0.05, point inside a cut and 130 mm from n1), dimension/label swap (point on the dim line inside a label box; room masked), room_label/body and wall/room swaps. Wall tie-break now uses a real tie: walls of different thickness (230/115 and 115/230), the point on the mitre line (28.75, 57.5) / (57.5, 28.75); both outline distances are 0 (asserted) and the centre-line distance decides. Id-asc, id-desc and reversed tie-break mutants all fail.

### Rulings applied (log in spec 19)
3. Equal-top stacked bodies: recency = later position in the document's record order (`placements`, then `fixtures`; JS insertion order), not id compare. Bodies are indexed in record order with a `seq`. Test with ids `f_zzzzzzzzzz, f_aaaaaaaaaa, f_mmmmmmmmmm` and fixture-after-placement.
4. `svgFromDrawing` writes only `data:image/(png|jpeg|gif|webp)` hrefs by default; http(s) needs `allowRemoteHref: true` (the opt-in does not widen other schemes). Tests for both.
5. Text: `alignment-baseline` next to `dominant-baseline`; a stroked style (dim_text) is now a stroke-only underlay `<text>` (fill none, stroke, round join) before the fill `<text>`; no `paint-order`. Shape tests.
6. `idPrefix` (default `''`, `^[A-Za-z_][\w.-]*$` or empty, otherwise throws) on `layer-*`, `hatch-*` and the `url(#…)` references; tests for default, prefix, no clashes, invalid prefixes.
7. Style colours (stroke, fill, hatch colour) are palette tokens only; unknown token throws, as does a literal like `#3B3B3B`; inherited keys (`constructor`, `toString`) throw. Test styles now name tokens (`cRRGGBB`) and `TEST_PALETTE` maps them. Still literal CSS: the page `background` option (spec example '#ffffff') and a poly's literal `fill` override (fixture fills); both are escaped. P1's PLAN_STYLES-to-SvgExportOptions generator must therefore emit palette token keys, not hex.

### Minor
8. Removed the dead inside-before-edge comparison in the body ranking (distance already puts inside first).
9. `num()` throws `RangeError` ("too large") for |v| >= 1e15; 1e14 and 1e-9 format without exponents. Tests.
10. New tests: attribute tab/CR/LF char refs; opacity clamp; exact hatch pattern body and HATCH_LINE_SHARE (and unfilled tile); dimension text box away from the line tolerance; textRing anchors (start/middle/end), baselines (top/bottom), dyEm and code-point counting, empty text; segMeetsRect y-clip; room-vs-room smaller-area order (both input orders, id order opposite).
11. xmlCheck validates character references against the XML 1.0 Char production (`&#0;`, `&#1;`, `&#x8;`, surrogates, U+FFFE, > U+10FFFF rejected; tab/LF/CR/astral accepted). Self-tests added.
12. svg.ts regex uses `￾￿` escapes (the source had raw characters); `Object.hasOwn` for the style lookup, so `'constructor'` throws "no style for constructor".
13. Split: `hitIndex.ts` (types, entries, `buildHitIndex`; 382 lines) and `hitTest.ts` (`hitTest`, `hitTestRect`; 236 lines). `engine/index.ts` exports unchanged. Tests import `hitTest`/`hitTestRect` from `../hitTest`.
14. `hitTestRect` docblock: hidden-layer filtering is the caller's job (05 §4.10); the function takes no mask. Note for P4: filter the returned ids by visible/selectable layers (hidden furniture, locked background) before selecting.

### Mutant verification
Scratch copy (outside the worktree) of resources/js/engine with symlinked node_modules; 28 mutants applied one at a time and run against the owning test file, all KILLED: class-order swaps (4), wall tie-break (3), recency by id / reversed, top ascending, room order by id, y-clip dropped, dimension texts dropped, anchor end/middle, font-weight raw, `in` instead of `hasOwn` (palette, styles), remote href default on, no alignment-baseline, halo via paint-order, prefix ignored (hatch ref, layer), no exponent guard, HATCH_LINE_SHARE, opacity clamp dropped, attribute newline raw.
