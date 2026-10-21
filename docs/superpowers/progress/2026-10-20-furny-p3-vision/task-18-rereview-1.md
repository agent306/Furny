# Task 18 re-review 1: fix round 1 (`bbf88fc..793e48c`)

The diff file is non-empty (44 526 bytes, 6 files) and was read in full. The report's "Fix round 1" section names the covering tests and shows their output:
- `test_rooms.py` + `test_reference_rooms.py`: 34 passed, 1 xfailed;
- the full suite: 944 passed, 1 skipped, 3 xfailed;
- the RED run: 4 failing tests, each with its assertion.

I checked the fixes on an export of 793e48c (since deleted) with scripts in scratch `r18/scripts/` (`helpers.py` and `rr1.py`–`rr3.py`). I did not re-run the suite.

## Finding verdicts

### I1: `scale_y` scaled `height_px` for the wrong orientation — ADDRESSED

- `candidates.py:284` now reads `height = t.height_px * factor if t.angle == 0 else t.height_px`.
- Checked at f = 1.10:
  - a horizontal token's box height becomes 11.0 and its `height_px` becomes 11.0;
  - a vertical token's box width stays 10.0 and its `height_px` stays 10.0.
- `test_scale_y_scales_lengths_across_y` (`test_rooms.py:219`) pins both orientations.

### I2: a corridor crossing aligned partitions was split into two open faces — ADDRESSED under the narrower rule you accepted

- **The rule.** `rooms.py:101-105` skips a whole-wall passage or bare-gap closure when both of the wall's ends are crossings (`_crossed_ends`, `rooms.py:202`). Doors and windows are never skipped.
- **D2 (partitions aligned at x 1200 across the corridor):** 5 faces. The corridor is one closed face (308–2090 × 805–940) and no face is open. Before the fix it was 6 faces with the corridor split.
- **D3 (offset partitions):** 5 faces, unchanged.
- **A corridor dead-ending in a T (T3):** corridor along y 800–950 from x 300 to 1600, ending at the wall x 1600, with partitions aligned at x 1000.
  - Result: 6 faces, which is correct: TL, TR, BL, BM and BR rooms plus the corridor.
  - The corridor is one closed face (308–1591).
  - A plain T at the corridor's end does not reintroduce the split.
- **Residual: an L-turning corridor (T1) is still split. Minor, and the trade-off you accepted.**
  - The case: the corridor turns down at x 1200, and the partition above it is collinear with the corridor's inner wall below.
  - The gap wall W8 runs from N5 (degree 4, a crossing) to N8 (degree 3: the inner wall turns, so walls leave on one side only).
  - Its closure is therefore drawn, and the corridor splits into its two legs: R3 (308–1191 × 805–940) and R4 (1207–1341 × 807–1491). Both are `open`.
  - Topologically, N8 looks the same as the HDB's W48/W49 T-ends, so no local rule tells the two apart. The `open` flag at least marks both legs. Recommend logging this case with deviation 10 in spec 19 / Task 34.
- **Related (T2):** the same geometry with the corridor's bottom wall stopping at x 1200, so the corridor runs into the bottom-right room. The left leg becomes its own `open` face, and the right part merges with the room. That is acceptable, since no wall separates them.
- **Tests.** `test_corridor_across_partitions_is_one_closed_face[aligned, offset]` (`test_rooms.py:369`) and `test_door_between_junctions_still_closes` (`test_rooms.py:383`) pin the rule. I checked the R18-c invariant: a door between crossings still closes.

### M1: the ledges (bay and recess) — ADDRESSED

- The HDB `recess` and `bay` carry `"kind": "ledge"`.
- `TruthRoom.kind` defaults to `"room"` (`reference.py:811`), and `room_metrics` drops ledges (`reference.py:872`).
- `ROOMS_FLOOR` is HDB 3 / brochure 3 (`test_reference_rooms.py:37`).
- The xfail's reason now reads ≥ 7 of 10.
- **Export run:**
  - HDB: matched toilet-1 → R1, bedroom-1 → R2, balcony → R5 (3 rooms).
  - Brochure: 3 matched.
  - Labels 1.00 / 1.00.
  - Faces / open: HDB 6 / 4, brochure 6 / 0.
  - Rooms stage 0.042 / 0.037 s.

### M2: the HDB living polygon artefacts — ADDRESSED

- The living polygon no longer has the sliver along y 182 or the x 297–299 strip. The kitchen now runs to the I1/I17 line: (297, 181) → (299, 364) → (299, 480).
- Checked with shapely:
  - all polygons are valid;
  - kitchen ∩ living = 0, kitchen ∩ toilet-1 = 0 and kitchen ∩ store = 0;
  - both points lie inside their polygons.
- The `traced` and `judgement_calls` notes now describe this cut.

### M3: across-line widths and `theta0` were not scaled — ADDRESSED

- Widths scale by `across = factor / stretch` (`candidates.py:306`, 318, 329). `theta0` is turned (`candidates.py:311`).
- Checked at f = 1.10:

  | Quantity | Before → after | Expected |
  |---|---|---|
  | Horizontal wall thickness | 14 → 15.4 | 15.4 |
  | Vertical wall thickness | 14 → 14 | 14 |
  | 45° wall thickness | 10 → 10.4643 | w·f/k = 10.4643 |
  | 45° segment width | 2 → 2.0929 | 2.0929 |
  | `theta0` | 30° → 32.419° | atan(f·tan 30°) = 32.419° |
  | `theta0` | 89.5° → 89.5455° | stays in range |
  | `theta0` | 0° → 0° | 0° |

- The f/k rule for widths is exact for a strip under diag(1, f): its area scales by f and its length by k.
- The docstring now carries the note about the face-id map (`candidates.py:264`), which settles the earlier ⚠️.

### M4: spec-level generality limits — ADDRESSED (logged, no code change, as asked)

They are listed in report FR1-6 and as deviation 14. The spec-19 file itself is not in this diff.

### M5: report misidentified brochure R6 — ADDRESSED

Report §4 now names the living room's side-table/lamp symbol at source (225–240, 290–306).

### M6: `_is_open` made full-page passes per face — ADDRESSED

- `rooms.py:360-376` reads only inside the reach component's `connectedComponentsWithStats` box. This is equivalent to the old test, because reach is empty outside that box.
- The open flags are unchanged on both references: HDB, the same four faces (renumbered by the new anchors); brochure, none.

### M7: corridor anchors sat at one end — ADDRESSED

- `_anchor` (`rooms.py:343`) picks the ridge pixel (within 0.5 px of the maximum) nearest the mean of the ridge pixels.
- Rendered 1 × 8 m corridor (y 308–851): the anchor was at y 335 and is now at y 613.
- 1 × 12 m corridor (y 308–1130): the anchor is at y 675.
- Every anchor I checked is strictly inside its polygon.
- **Note (not a defect).** On the D2 corridor, the 0.5 px band holds only two clusters of ridge pixels next to the door recesses, at x 600–900 and 1500–1800. Their mean (x 1121) falls between them, so the anchor lands at x 1502, inside the corridor and on its ridge. "Mid-ridge" is guaranteed only for a flat ridge, which is all the fix claims.

## New breakage in the fix diff

None.

- The `_degrees`/`_ends` refactor (`rooms.py`) is behaviour-preserving.
- The skipped closure also leaves no wall piece drawn, because the cut covers the whole wall, so the corridor really is free.
- The ledge filter in `room_metrics` runs before the merge and split logic, so a face holding a ledge point and a room point is not called merged. That is consistent with treating ledges as neutral.

## Out-of-scope observations

None new.

## Verdict

**Fix round: all findings addressed, no new Critical or Important breakage.**

One Minor residual stays open for the record: the L-turning corridor (T1) still splits under the narrower I2 rule. It is the trade-off you accepted; log it with deviation 10 and carry it to Task 34.
