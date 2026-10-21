# Task 18 review: room faces, `CandidateSet`, traced rooms truth

Range `0c33449..bbf88fc` (32b80ff, b878b2b, bbf88fc). The diff file is non-empty (64 619 bytes, 8 files) and was read in full. No hunk was cut off. Rulings R18-a and R18-c and the 9 spec-19 deviations are accepted and are not re-flagged.

## Spec compliance

- ✅ **Spec compliant** with 06 §8.6 steps 1–7, the brief and its Controller additions, taking the accepted deviations into account. The checks:
  - **Interface.** `find_room_faces(wall_mask, graph, openings, tokens, region, t_median) -> (list[RoomFace], int32 map)` is at `rooms.py:74-81`. The `RoomFace` fields are at `candidates.py:214-232`. The `CandidateSet` fields and `scale_y` are at `candidates.py:235-324`.
  - **Mechanics.** The step 2 components use connectivity 4 (`rooms.py:285`). The border, area and aspect filters are at `rooms.py:293-296`. Polygons come from `RETR_EXTERNAL` plus `approxPolyDP(0.5 t)` (`rooms.py:301-305`). The anchor is the distance-transform argmax on a zero-padded crop (`rooms.py:111-114`). Ids are sorted by the anchor's (y, x) (`rooms.py:115`).
  - **The brief's 6 tests** are all present in `test_rooms.py`: `test_two_rooms_with_door_closure`, `test_open_face_flag`, `test_border_and_sliver_discarded`, `test_contains_text_ids`, `test_face_id_map` and `test_candidate_set_scale_y`. The R18-c tests and the step 1 rule tests are present too.
  - **Addition A.**
    - Both truth files exist, with `method` and `judgement_calls`.
    - The match rule is `reference.py` `room_metrics`, and a self-test checks it (`test_room_metric_scores_the_truth_itself`).
    - The floors 4 / 3, the strict HDB ≥ 7 xfail (R18-a) and labels ≥ 0.8 are in place.
    - Merged and split rooms are reported.
  - **Stage boundary (06 I12).** `rooms.py` imports only `schemas.candidates` and `utils.geometry`.
  - **Addition C.** No earlier stage is touched: the diff's file list contains only `rooms.py`, `candidates.py` and test files. So the walls, openings and dims floors cannot have moved.
- ⚠️ **The face-id map is not part of `CandidateSet`.** Whoever applies `scale_y` (anisotropy, Task 21/22) must also resample the map (nearest neighbour) or rebuild it. Otherwise the side test of 06 §8.7 step 1 reads unscaled pixels. This cannot be verified from this diff.
- ⚠️ **The spec-19 entries for the 9 deviations are not in this diff.** The controller states they are logged.

## Metrics, confirmed on an export of bbf88fc

`git archive bbf88fc vision` was extracted to scratch and the chain was run with the worktree's venv. The export has been deleted.

| | HDB | Brochure |
|---|---|---|
| Faces / open | 6 / 4 (R3–R6) | 6 / 0 |
| Matched | 4: toilet-1 R1, bedroom-1 R2, recess R5, balcony R6 | 3: bedroom-right R1, toilet-right R3, kitchen R5 |
| Merged | R3 = toilet-2, toilet-3, bedroom-2, bedroom-3, bay; R4 = store, living, kitchen | R2 = bedroom-left, toilet-left; R4 = deck, living |
| Split | none | living (R4, R6) |
| Labels | 3 / 3 = 1.00 | 3 / 3 = 1.00 |
| Rooms stage / non-OCR chain | 0.05 s / 1.66 s | 0.04 s / 1.06 s |

These match report §C3–C4 exactly.

## Truth verification

**Method.** I overlaid both truth files on the source images and inspected crops at 2–5× (scratch `r18/*.png`). I profiled a 9 × 9 window at every brochure point and cross-checked the HDB label tokens in `hdb-3room.ocr.json`.

**Verdict.** No room has a wrong point, label, polygon or `open` flag. Two judgement calls need a note (M1) and there is one cosmetic polygon artefact (M2).

### HDB

| Room | Point | Polygon | Label | `open` | Notes |
|---|---|---|---|---|---|
| toilet-1 | ✓ | ✓ | ✓ | ✓ | Token at normalized (533–616, 406). |
| toilet-2 | ✓ | ✓ | ✓ | ✓ | The OCR has only "1900" here, so no TOILET token; confirmed. |
| toilet-3 | ✓ | ✓ | ✓ | ✓ | Token "TOILE". |
| bedroom-1 | ✓ | ✓ | ✓ | ✓ | The notch under toilet 1 (x 368–418, y 364–480) is right. |
| bedroom-2 | ✓ | ✓ | ✓ | ✓ | L-shaped around toilet 2. |
| bedroom-3 | ✓ | ✓ | ✓ | ✓ | It includes the en-suite vestibule x 980–1115, y 360–480, where toilet 3's door is. |
| store | ✓ | ✓ | null is right | ✓ | It opens to the kitchen through the bi-fold at x 272–297, y 385–435. |
| living | ✓ | see M2 | ✓ | ✓ | |
| balcony | ✓ | ✓ | ✓ | `open: false` ✓ | It meets the living room through sliding doors. |
| kitchen | ✓ | ✓ | ✓ | `open: true` ✓ | |

**The kitchen cut-out is correct.** No wall or door separates the kitchen from the living room. The only line work at y ≈ 475 is the small appliance box at x 160–205. The cut at y 480, on the store and bedroom-1 wall line, is the natural extent of the kitchen: the 3300 dimension spans y 182–475.

### Brochure

| Room | Point | Polygon | Label | `open` | Notes |
|---|---|---|---|---|---|
| bedroom-left | ✓ | ✓ | ✓ | ✓ | Window minimum 212 (floor). |
| bedroom-right | ✓ | ✓ | ✓ | ✓ | Window minimum 209. Its bed is on the left, so the point is on the floor. |
| deck | ✓ | ✓ | ✓ | `open: false` ✓ | Minimum 130 on the wood grain. Reached through folding doors. |
| living | ✓ | ✓ | ✓ | ✓ | Minimum 208. |
| toilet-left | ✓ | ✓ | ✓ | ✓ | Its door is in the top wall, to bedroom-left. |
| toilet-right | ✓ | ✓ | ✓ | ✓ | Its door is in the left wall, to living. |
| kitchen | ✓ | ✓ | ✓ | `open: true` ✓ | |

**The kitchen cut is correct.** The kitchen's right side has a wall only from y ≈ 245 to 307 (behind the fridge). Above it, at x 152, y 217–245, is a 28 px doorless opening to the living room, so x 152 is the right cut. Treating the OTS, shaft, strip and corridor as `not_rooms` is correct: none is inside the flat's outline.

### Judgement calls

- **Kitchen cut-outs (both plans): agreed.**
- **The 600 recess.** It is in the controller's own Task 16c list of room-like spaces (16c brief line 95), so counting it follows that ruling. However:
  - its interior is about 50 × 112 source px at 11.35 mm/px, roughly 0.57 × 1.27 m = **0.72 m²**;
  - the matched face R5 is 13 304 normalized px, also about 0.74 m²;
  - 06 §8.6's post-scale filter (< 1 m², Task 21) will drop it.

  The HDB floor of 4 therefore contains a face that the pipeline is specified to discard (M1).
- **The bay.** It is the implementer's addition: 16c's 10 spaces did not include it. It is an HDB AC ledge, a thick outline outside toilet 3's window (window lines at x 987–1077, y 173–183), with no door. Its interior is about 1.95 × 0.57 m ≈ 1.1 m², borderline for the 1 m² filter. As a face of the wall truth it is a fair "face" to score. As a "room" towards the ≥ 7 target it is not: if the walls stage separated it later, it would count as one of the 7 rooms (M1).

## Generality counter-cases

Scripts are in scratch `r18/scripts/cases*.py` and were run on the bbf88fc export. The full chain is `render_plan → run → find_openings → find_room_faces`, except where a case says "hand-built".

| Case | Result |
|---|---|
| **L-shaped room** (partition x 1200 down to y 900, then y 900 to the outline) | 2 faces. The L face has 6 vertices, its anchor (763, 1036) is strictly inside, and it is closed. ✓ |
| **Furniture outlines** (2 px bed with pillow band, 150 px circular table, a wardrobe against a wall, a counter touching two walls), with a 70 px door | 2 faces, graph unchanged at 7 walls, no extra face. ✓ When furniture *is* read as walls (brochure R6), it does make a face. That is the walls stage's job, and Task 21's 1 m² filter is the backstop. |
| **Label straddling a wall** | A token centred on the partition is in no face. Tokens centred 20 px to either side go to their own side only. No token is listed twice. ✓ (A label lost on a wall is acceptable; 06 §8.7's `missedRooms` covers it.) |
| **Corridor mouth between aligned junction ends** (D1) | 4 faces, not the 3 that `test_aligned_junction_ends_are_not_closed` asserts on its hand-built graph. The walls stage records the junction-to-junction stretch as a graph gap, and `_opening_intervals` closes it as a passage. The corridor becomes a separate face with `open: true`. That is acceptable. |
| **Corridor crossing collinear partitions** (D2: rooms above and below a corridor, partitions aligned at x 1200) | **Breaks: the corridor is split into 2 faces (R3, R4), both `open`.** The graph has W8, from N5 (degree 4) to N8 (degree 4), made entirely of a gap (`openings_px` (1.3, 150.1)). The openings stage calls it a 132 px `opening`. With the partitions offset (D3), the result is the correct 5 faces. → **I2** |
| **Balcony open on one side** | Brief's expectation `open: true`: **not met for 2 of 3 variants.** <br>• No front wall and no returns (E1): the balcony joins the outside and is dropped. <br>• Return stubs with a 300 px front, 21 t > 18 t (E2): dropped. <br>• Return stubs with a 200 px front, 14 t (E3): a face with `open: true`. <br>This follows the spec (§8.6 step 1 closes only collinear gaps of 18 t or less). → M4 |
| **Tiny closet** (region 2032 × 1432, minimum area 5820 px²) | Interiors of 60 and 75 px are dropped (3600 and 5625 px²). 90 and 120 px are kept as faces. The threshold is applied exactly. ✓ |
| **Long narrow corridor** (t 14 px ≈ 200 mm, so 1 m = 70 px) | • 1.0 × 8 m (interior aspect 9.8): kept ✓ <br>• 1.0 × 12 m (14.8): kept <br>• 0.9 × 12 m (16.9): dropped <br>Real residential corridors survive. Long common corridors can be lost; that follows the spec. → M4 |
| **Closure at 6 t / 6 t + 1** (t 14; hand-built) | • Collinear gap 84 → closed; 85 → open ✓ <br>• Graph gap 84, passage or bare → closed; 85 → open ✓ <br>• Door at 84 or 85 → closed (R18-c) ✓ <br>• 18 t edge: 252 → 2 faces (open); 253 → 1 face ✓ |

## `CandidateSet.scale_y`

**Scaled, and checked by test or by my script:**
- node, wall a/b, segment and span y coordinates;
- dimension line ends;
- token quads and boxes;
- room polygons, anchors and boxes;
- the region's y/h.

x is never touched.

**Along-line u values are correct.** Opening and gap `u0`/`u1`, wall `openings_px` and dimension `tick_positions` are distances along a line from its first end. A linear y-stretch multiplies each of them by that line's own stretch: 1 for horizontal lines, `f` for vertical ones, `hypot(dx, f·dy)/len` in general. That is exactly what `stretch`/`along` do (`candidates.py:265-273`). Room `area_px × f` is correct.

**Wrong or missing:**
- **I1:** the text `height_px` is scaled for the wrong orientation.
- **M3:** wall `thickness_px`, segment `width_px` and `theta0` are kept.

## Strengths

- `rooms.py` is compact and readable. Every rule maps to a §8.6 step, and the module docstring states the deviations.
- The R18-c change is minimal: one `passage` flag carried through the interval merge, and `long` is defined from it.
- The tests isolate each rule. The hand-built graph tests cover free-end pairing, graph walls drawn into `closed`, the 18 t limit and passage versus door. The report shows each rule's test failing when that rule is switched off.
- The reference harness's metric is self-tested: the truth matches itself, a joined pair counts as merged, and a halved room counts as split.
- The oracle in report §5 (11 / 11 with the 5 missing truth walls drawn in) cleanly separates rooms-stage problems from walls-stage problems.
- The truth points were profile-checked. Moving the old 16c test points off glyphs was a real fix.

## Issues

### Critical

None.

### Important

**I1. `scale_y` scales `height_px` for the wrong text orientation** (`vision/app/schemas/candidates.py:278`).

```python
height = t.height_px * factor if t.angle == 90 else t.height_px
```

- `TextToken`'s contract is in its docstring and in `ocr_stage.py:137`. `height_px` is the box *height* (a y extent) for `angle == 0`, and the box *width* (an x extent) for `angle == 90`.
- Verified with my script at f = 1.10:
  - a horizontal token's box height becomes 11.0 while `height_px` stays 10.0;
  - a vertical token's box width stays 10.0 while `height_px` becomes 11.0.
- The scaled set therefore breaks the token's own invariant. Downstream text-height thresholds, such as 06 §8.4's 2.5 × text height, are off by f on both orientations.
- The report's §2.2 rationale ("the height of vertical text, which is an extent along y, scales") is the error.
- **Fix:** scale when `angle == 0`. Better, recompute from the scaled box (`y1 − y0` for angle 0, `x1 − x0` for angle 90). Add both orientations to `test_candidate_set_scale_y`.

**I2. A corridor crossing aligned partitions is split into two `open` faces** (`vision/app/pipeline/rooms.py:150`, together with the walls stage's gap recording).

- In D2 above, the graph holds a wall made entirely of gap between two 4-way junctions (W8, N5 to N8). `_opening_intervals` takes every graph gap as a closure, so the corridor is cut at x 1200.
- The rooms stage's own guard against this (the free-end rule, `rooms.py:217`; `test_aligned_junction_ends_are_not_closed`) applies only to its own collinear closures. In the full chain it is bypassed, because the walls stage records the junction-to-junction gap (06 §8.1 step 8) and deviation 3 closes every graph gap.
- Aligned partitions across a hallway are a very common residential layout. The result is one real room reported as two faces, each costing 0.2 confidence through `open`.
- **Fix (general rule).** In `_opening_intervals`/the closure loop, do not draw a passage or bare-gap closure whose interval spans (nearly) its whole wall when both of that wall's nodes have degree ≥ 3. This is the same "only a free end marks an unfinished wall" rule as deviation 2. Re-check the HDB/brochure floors after the change.
- The controller may instead carry it to the walls stage (do not record a gap between two junctions) or to Task 34. Either way, add the D2 case as a test.

### Minor

**M1. Truth judgement: the bay and the 600 recess** (`hdb-3room.drawing-rooms.json:11`, rooms `recess` and `bay`).
- **Recess.** It is a ≈ 0.72 m² space that 06 §8.6's post-scale filter drops. When Task 21 applies the filters on the reference chain, the HDB's matched count will fall from 4 to 3, below `ROOMS_FLOOR`.
- **Bay.** It is an AC ledge reachable only through a window, yet it can count towards the ≥ 7 room target.
- **Recommendation:** tag both, for example `"kind": "ledge"`, and exclude them from the matched count and the target. Alternatively, state now that Task 21 re-bases the floor.

**M2. Truth polygon artefacts in the HDB living room** (`hdb-3room.drawing-rooms.json:23`).
- The living polygon runs (146,182) → (297,182) at the start and (297,181) → (146,182) at the end. That is a degenerate 1 px sliver along the kitchen's top edge, plus a 2 px strip at x 297–299, y 182–480. Both are left over from the cut-out.
- The method notes say the rectangle is "x 140–297", but the polygon uses 146/155.
- The effect is cosmetic: the overlap test still holds (< 1 px²). Consider cleaning the polygon with `buffer(0)` and simplifying it, and aligning the note with the polygon.

**M3. `scale_y` keeps across-line widths whose across direction is y** (`candidates.py:258-260`, 307-318).
- A horizontal wall's `thickness_px` and a horizontal segment's `width_px` are y extents, and they grow by f in the resampled image. Keeping them under-reports horizontal wall thickness in mm by f after anisotropy.
- `theta0` is not updated either: tan θ′ = f · tan θ. This is negligible when θ0 ≈ 0.
- **Fix:** scale across-widths by the stretch of the line's normal, and recompute `theta0`. At minimum, correct the docstring.

**M4. Spec-level generality limits; record them for spec 19 or Task 21.**
- A balcony with an open front and no return stubs, or with a front wider than 18 t, merges with the outside. It is dropped, never `open: true`.
- The bounding-box aspect test drops a 0.9 × 12 m corridor (aspect 16.9). A mm-based minimum-width test after scale would be more robust.
- A label token centred on a wall is in no face.

**M5. Report inaccuracy** (task-18-report §4). Brochure R6 is the living room's side-table/lamp symbol at source (225–240, 290–306), not the stove; the stove is in the kitchen at x ≈ 107–125. The conclusion is unchanged: a 0.24 m² face that Task 21's filter removes.

**M6. `_is_open` work per face** (`rooms.py:132`, 308-316).
- `labels == k` and `reach & ~face & ~beyond_long` are full-page boolean passes for each face, so the cost is O(faces × page).
- Here it is 0.05 s. A 12 Mpx page with 25+ faces would be noticeably slower.
- **Fix:** crop to the reach component's stats box.

**M7. Corridor anchors sit at one end of the corridor** (`rooms.py:113`). `argmax` takes the first maximum of a flat distance-transform ridge. In my 1 × 8 m case the anchor is (935, 335) in a face spanning y 308–851. It is strictly inside, so this is spec-compliant, but it is a poor label-placement point. Taking the ridge maximum closest to the centroid would fix it.

## Assessment

- **Spec:** ✅ compliant, with the ⚠️ items above (face map under `scale_y`; spec-19 entries not in this diff).
- **Task quality: Needs fixes.**
  - I1 is a small, real correctness bug in the anisotropy copy.
  - I2 is a generality break for a common layout (aligned partitions across a corridor) that the rooms stage's own free-end rule was meant to prevent.
  - Everything else is well built and well tested.
- **Truth verification: ✅ accurate.** No wrong point, label, polygon or `open` flag in either file. The kitchen cut-outs are agreed. The bay and recess calls carry a forward risk (M1), and there is a cosmetic polygon artefact (M2).
