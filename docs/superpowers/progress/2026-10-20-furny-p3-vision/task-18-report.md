# Task 18 report: room faces and `CandidateSet`

**Status: NEEDS_CONTEXT.** Everything below is implemented, tested and pushed:
- `find_room_faces` (06 §8.6 steps 1–7);
- `RoomFace` and `CandidateSet` with `scale_y`;
- the brief's synthetic tests;
- the traced rooms truth for both reference plans and the reference acceptance tests.

Every floor in C holds. **The HDB target of ≥ 7 matched rooms is not met: 4 of 12 are matched.** The rooms that fail are merged through walls that the walls stage never extracts (I11, I12, I14, I16, I17). Adding those walls is a walls-stage design change, beyond 06 §8.6.

An oracle run proves the rooms stage itself. When the five traced walls are drawn into the wall mask, `find_room_faces` matches **11 of 11** HDB rooms (§5). The kitchen is open onto the living room and shares its face, as drawn. I stopped as rule B asks. The proposed rulings are in §6.

The ≥ 7 target is a strict xfail, `test_hdb_seven_rooms_are_matched`. It replaces Task 16c's graph-face xfail `test_hdb_seven_rooms_are_faces`, which has moved here. The reached values are regression floors.

Commits, pushed to `origin/build/p3-vision`:

| SHA | Subject |
|---|---|
| `32b80ff` | feat(vision): room face detection and CandidateSet |
| `b878b2b` | test(vision): traced rooms truth and acceptance for the reference blueprints |

---

## 1. Final metrics

| Metric | HDB | Brochure | Target / floor | Met? |
|---|---|---|---|---|
| Matched rooms | **4 / 12** | **3 / 7** | HDB ≥ 7; brochure: report and set a floor | HDB **no**; floors 4 / 3 set |
| Labels in their room's face (of matched rooms with a label token) | **1.00** (3 / 3) | **1.00** (3 / 3) | ≥ 0.80 | Yes |
| Room faces (§8.6) / open faces | 6 / 6 | 6 / 0 | – | (see concern 2) |
| Graph bounded faces (Task 17 floor) | 6 | 4 | ≥ 6 / ≥ 4 | Yes |
| Walls R / P | 0.927 / 0.973 | 0.920 / 0.864 | ≥ 0.927 / 0.973; ≥ 0.920 / 0.864 | Yes, unchanged |
| Outer-cycle free ends | 0 | 0 | 0 | Yes |
| Openings R / P, hinge and swing | 0.462 / 0.667, 1.00 | 0.625 / 1.000, 1.00 | ≥ 0.461 / 0.666; ≥ 0.625 / 1.0 | Yes, unchanged |
| Dims R / P / intervals / labels / ticks R / P | 0.833 / 1.000 / 0.979 / 0.923 / 0.985 / 0.932 | 0 lines | unchanged | Yes |
| Non-OCR chain (rooms stage) | 1.58–1.68 s (0.06–0.08 s) | 1.07–1.33 s (0.05–0.10 s) | < 10 s | Yes |

Walls, openings and dims metrics are identical to Task 17's: this task does not touch any stage before rooms.

## 2. What was implemented

### 2.1 `app/pipeline/rooms.py`

The function follows the brief's interface:

```
find_room_faces(wall_mask, graph, openings, tokens, region, t_median) -> (list[RoomFace], int32 face-id map)
```

**Step 1: closures.**
- `closed` starts as the wall mask. Every graph wall is added, drawn at its thickness along its centre line *outside its openings* (deviation 1).
- Every opening interval is drawn across as a line of its wall's thickness. The intervals come from the openings stage's candidates together with the graph's own `openings_px` and gaps, merged per wall.
- Every remaining end-to-end gap of at most 18 t between collinear walls is closed too:
  - the walls are anti-parallel within 3°;
  - the far end lies within 0.5 t across the line;
  - t is the mean thickness of the two walls;
  - at least one of the two ends must be free (deviation 2);
  - no other graph wall may cross the closure;
  - pairs are taken greedily, shortest first, and each end is used once.

**Steps 2–3.**
- `free = ~closed` inside the plan region, clipped to the page, in 4-connected components (`connectedComponentsWithStats`).
- These components are not faces:
  - components touching the region border;
  - components with area < 0.002 × the region area;
  - components whose bounding-box aspect is > 15.

**Step 4.** The polygon is the largest `findContours(RETR_EXTERNAL)` contour, simplified with `approxPolyDP(0.5 t_median)`.

**Step 5.** The anchor is the argmax of each face's own distance transform. The transform runs on the face's cropped mask with a zero border, so the anchor is strictly inside.

**Step 6.** `contains_text_ids` lists the tokens whose box centre lies in the face polygon. When faces nest, the token goes to the smallest one. The caller passes the plan-region tokens (`in_region`).

**Step 7.**
- Faces are numbered `R1..` in the anchors' `(y, x)` order. The map holds k on the pixels of `R{k}`.
- `open`: the free space is labelled a second time, with only the closures ≤ 6 t drawn. A face is open when that component, at its anchor, reaches pixels outside the face other than the long closures' own pixels.
- Here t is the closed wall's thickness, or the mean of the pair for a collinear closure.

**Stage boundary (06 I12).** `rooms.py` imports only `schemas/candidates.py` types and `utils.geometry`.

### 2.2 `app/schemas/candidates.py`

- **`RoomFace`** has the brief's fields and is frozen with slots.
- **`CandidateSet`** has the brief's fields and is frozen. `scale_y(f)` returns a copy:
  - every y coordinate is multiplied: token quads and boxes, segments, dimension lines, spans, nodes, walls' a/b, room polygons, anchors and boxes, and the region's y and h (rounded);
  - lengths along a line follow that line's new length: wall `openings_px`, gap and opening `u0` / `u1`, and tick positions;
  - room areas scale by f;
  - lengths measured across a line are kept: stroke widths, wall thickness, and the height of horizontal text. The height of vertical text, which is an extent along y, scales.

### 2.3 Harness and truth

**`tests/support/reference.py`:**
- `run_chain` now runs `find_room_faces` (with `in_region` tokens) and times it as `rooms`;
- `ChainResult.rooms` and `.face_map`;
- `TruthRoom`, `load_rooms_truth`, `label_token`, `room_metrics` and `RoomMetrics`.

**`tests/test_reference_rooms.py`:**
- truth consistency;
- a metric self-test: the truth polygons match all rooms, a joined pair is merged and a halved room is split;
- the floors `ROOMS_FLOOR = {hdb 4, brochure 3}`;
- the strict-xfail HDB ≥ 7;
- labels ≥ 0.8;
- well-formed faces: id order, anchors inside, map values, nothing touching the border;
- the rooms stage < 1 s.

**`tests/test_reference_walls.py`:** the strict xfail `test_hdb_seven_rooms_are_faces` (graph faces) is removed. It is superseded by the rooms-based `test_hdb_seven_rooms_are_matched`.

## 3. Rooms truth and profile checks

Files: `vision/tests/fixtures/reference/{hdb-3room,brochure-2bhk}.drawing-rooms.json`. Coordinates are in source px.

Each room has:
- `id`;
- `point`, the interior point;
- `label` as printed, or null;
- `open`, plus `opens_onto` for open rooms;
- `polygon`, the rough outline.

**Method** (recorded in each file's `method`):
- **Polygons.** A room's polygon is the face of the verified wall truth (`*.drawing-walls.json`) that holds its point: the centre lines are polygonized and simplified by 0.5 px. The polygons are therefore rough by half a wall thickness.
- **Open kitchens.** In both plans the kitchen opens onto the living room without a door. On the HDB there is no wall at all. On the brochure there is the 30 px side opening at x 152, y 215–245, which no truth wall spans. In both, the kitchen is cut out of the shared truth face (HDB: x 140–297, y 182–480; brochure: x < 152).

**Profile checks** (`method.points`):
- Every point was checked on the decoded image with a 9 × 9 px window.
- HDB: every window reads gray 255 (minimum).
  - The Task 16c truth-test points of toilets 1–3, the store, bedroom 3, the balcony and the bay sat on glyphs or lines (minimum 0). They were moved.
- Brochure: minima are ≥ 199 on the room fills.
  - The deck's wood-grain fill reads 130 (median 148). Wall poché reads 85–105 and line work reads < 80.
  - The deck point was moved off the "10'1"x4'0"" text.
- **Label tokens.** Each labelled room was checked for a replayed OCR token centred inside its polygon. All of them have one except **HDB toilet 2**: its TOILET is overprinted by the vertical "1900", and OCR read only "1900". Toilet 3 reads "TOILE", which parses as TOILET.

### HDB: 12 rooms

| Room | Point | Label | Open | Token |
|---|---|---|---|---|
| toilet-1 | (360, 320) | TOILET | – | T21 |
| toilet-2 | (680, 330) | TOILET | – | none (overprinted) |
| toilet-3 | (1010, 230) | TOILET | – | T20 "TOILE" |
| bedroom-1 | (522, 337) | BEDROOM | – | T29 |
| bedroom-2 | (844, 344) | BEDROOM | – | T27 |
| bedroom-3 | (940, 690) | BEDROOM | – | T38 |
| store | (340, 425) | null | – | – |
| living | (443, 588) | LIVING ROOM | – | T40 |
| kitchen | (230, 330) | KITCHEN | onto living | T28 |
| balcony | (600, 880) | BALCONY | – | T46 |
| recess (600 beside the balcony) | (860, 865) | null | – | – |
| bay (above toilet 3) | (960, 160) | null | – | – |

### Brochure: 7 rooms

The spaces outside the flat (the OTS, the hatched 6'6" × 7'0" shaft, the 5'8" strip and the corridor) are `not_rooms`: a face there is neutral.

| Room | Point | Label | Open | Token |
|---|---|---|---|---|
| bedroom-left | (128, 112) | BEDROOM | – | T5 |
| bedroom-right | (318, 112) | BEDROOM | – | T6 |
| deck | (232, 90) | DECK | – (folding doors) | T3 |
| living | (225, 215) | LIVING/DINING | – | T14 |
| kitchen | (135, 235) | KITCHEN | onto living | T23 |
| toilet-left | (135, 180) | TOILET | – | T9 |
| toilet-right | (262, 190) | TOILET | – | T15 |

### Match rule (the controller's, plus the open flag)

- A truth room is **matched** when exactly one face polygon contains its point and that face holds no other truth room's point. The one exception is an open room that opens onto it.
- An open room sharing its host's face is reported as `open_in_host`. It is neither matched nor missed, so it is never double-counted.
- A face holding the points of two or more spaces **merges** them.
- A truth room is **split** when two or more faces each lie at least half inside its polygon.

## 4. Per-room results

### HDB (6 faces, all `open`; see concern 2)

| Truth room | Face | Result | Label in face |
|---|---|---|---|
| toilet-1 | R1 | **matched** | yes (T21) |
| bedroom-1 | R2 | **matched** | yes (T29) |
| balcony | R6 | **matched** | yes (T46) |
| recess | R5 | **matched** | (no label) |
| toilet-2, toilet-3, bedroom-2, bedroom-3, bay | R3 | merged | – |
| store, living, kitchen | R4 | merged (the kitchen with living is as drawn; the store is not) | – |

**Merged.**
- R3 holds toilet-2, toilet-3, bedroom-2, bedroom-3 and the bay.
- R4 holds the store and living plus the kitchen.

**Split:** none.

Why each merge happens:

| Merge | Missing wall | Why it is missing | Stage |
|---|---|---|---|
| toilet 2 ↔ bedroom 2 | **I11** (y 364, x 648–765) | its faces are broken under the "1200" label in the ink itself (Task 16c R-c′ residual) | walls |
| bay ↔ bedroom 2 | **I12** (B0–V6t, y 178) | not extracted | walls |
| bay ↔ toilet 3 | **I16** (y 178, x 980–1115) | faint faces and window (R17-d 5) | walls |
| toilet 3 ↔ bedroom 3 | **I14** (y 360, x 980–1115) | its faces are cut by the "1800" end tick into 11–26 px pieces (R17-d 1) | walls |
| store ↔ living | **I17** (x 299, y 364–480) | its stubs (20–22 src px) are below the 0.03 L pairing length (R17-d 2) | walls |

None of these is a gap between collinear walls, so 06 §8.6 step 1 cannot close any of them. I checked the near cases:
- I13's top end at (1508, 273) is free, but no vertical wall lies above it.
- The bay's line y 274 has no graph wall right of B, because the black block at the top right is a vertical wall only.
- The I11 line (y 560) has no wall within 18 t on either side.

### Brochure (6 faces, none open)

| Truth room | Face | Result | Label in face |
|---|---|---|---|
| bedroom-right | R1 | **matched** | yes (T6) |
| toilet-right | R3 | **matched** | yes (T15) |
| kitchen | R5 | **matched** (its open side is closed by a collinear closure of 5.7 t) | yes (T23) |
| bedroom-left, toilet-left | R2 | merged | – |
| deck, living | R4 | merged; living is also **split** (R4, R6) | – |

- **R6** is a 3142 px false face at the living room's side-table/lamp symbol (source x 225–240, y 290–306; corrected in fix round 1, M5), made by furniture lines read as walls. It is about 0.25 m² at the plan's scale (about 8.8 mm/px, from the deck's 10'1"), so it falls to the post-scale < 1 m² filter (Task 21).
- **bedroom-left ↔ toilet-left.** W20, the toilet's top wall piece, is tilted 8.5° by the door arc (the Task 17 residual for D2). Its free end does not face W25's free end within 3°, so the 72 px (2.5 t) door gap stays open.
- **deck ↔ living.** The deck's bottom wall (W26 in the truth) is only a double-line piece traced across the bi-fold (W15, x 679–874; Task 17 residual D6). Its free end at x 679 faces the *perpendicular* W7 117 px (4.5 t) away, and there is no collinear partner. Closing it is the R-b situation (a partition's end against a perpendicular wall): walls stage, not §8.6.
- **Closures used:** the collinear closures are the bedroom-left door (4.8 t), the kitchen's open side (5.7 t) and the right toilet's door side (4.3 t). Without them, the brochure falls to 3 faces and 1 matched room (§5).

## 5. Measurements

**Ablations** (rooms stage only; matched rooms, HDB | brochure):

| Variant | HDB | Brochure |
|---|---|---|
| Final | 6 faces, 4 matched | 6 faces, 3 matched |
| No collinear closures | 6, 4 | **3, 1** |
| Graph walls not drawn (mask plus closures only; deviation 1) | **0, 0** | 5, 3 |
| Graph walls drawn whole, no opening closures | 6, 4, **0 open** | 6, 3 |

The last line shows that every HDB face is open only through door closures longer than 6 t (concern 2).

**Oracle** (HDB). Selected truth walls are drawn into `ext.mask` at their truth thickness, and the rest of the chain is unchanged:

| Walls added | Matched |
|---|---|
| none | 4 |
| I17 | 6 (store, living) |
| I11 + I17, or I14 + I17 | 7 |
| I11 + I12 + I17, I11 + I14 + I17, or I14 + I16 + I17 | 8 |
| any four of the five | 9 |
| **I11, I12, I14, I16, I17** | **11 / 11** (kitchen `open_in_host`), labels 1.00 |

**Closure inventory** (HDB): the doors close at 6.2–12.5 t, and the graph gaps at 1.7–9.8 t. HDB has no collinear closures.

## 6. Blocker and proposed rulings

**Blocker.** HDB ≥ 7 needs at least two of the walls I11, I14 or I17 (the pairs in §5). These are walls-stage extractions that ruling R17-d and Task 16c's R-c′ already carried to Task 34. No general rule within 06 §8.6 recovers them.

**Proposed ruling R18-a (my recommendation).** Accept Task 18 as committed:
- the rooms stage per 06 §8.6;
- floors at the reached values: HDB 4, brochure 3, labels ≥ 0.8;
- keep ≥ 7 as the strict xfail and move it to Task 34 with the R17-d walls residuals.

The oracle shows the rooms stage reaches 11/11 once those walls exist. This matches the Task 17 ruling: the heuristic path is the fallback, and the AI labeler's `missedRooms` (06 §8.7 step 2) and the review UX are 06's correction path.

**Alternative R18-b.** A walls-stage follow-up before Task 19, in this order:
1. **I17:** pair short face stubs (< 0.03 L) whose both ends meet perpendicular walls. This gives +2 (store, living).
2. **I14:** rejoin face pieces cut by a dimension line's end tick within the tick's length. This gives +1 (bedroom 3), and toilet 3 with I16.
3. **I11:** recover face lines broken under a label from the gray image.

I have **not** prototyped these. Each changes the walls stage, and each needs checking against the wall, opening and dims floors.

**Proposed ruling R18-c (the `open` flag; concern 2).** Count only passages (kind `opening`) and collinear closures as "long closures" for `open`, not door or window closures. Today every HDB room reads `open` because its door is wider than 6 t (bedroom doors are 7.8–12.5 t), which costs every room 0.2 confidence in 06 §8.7 step 9.

I implemented the spec and the brief literally. The brief's door test keeps its door at 70 px ≤ 6 t, which suggests a wider door would make the face open. The change would be one line plus a test.

## 7. Deviations (for spec 19)

1. **06 §8.6 step 1: graph walls in `closed`.** `closed` holds the wall mask and every graph wall drawn at its thickness along its centre line outside its openings. The graph's L/T closures, R-b extensions and jog links are walls the mask lacks. Without them the HDB has 0 faces (§5).
2. **06 §8.6 step 1: collinear closures.** A "remaining end-to-end gap ≤ 18 t between collinear walls" is read as follows:
   - the walls are anti-parallel within 3°;
   - the far end lies within 0.5 t across the line;
   - t is the mean of the two walls' thicknesses;
   - **at least one of the two ends is free**;
   - no other wall crosses the gap;
   - pairs are taken shortest first, each end once.

   Two junction ends that line up across a corridor are not joined (`test_aligned_junction_ends_are_not_closed`).
3. **06 §8.6 step 1: opening intervals.** The closures are the union per wall of the openings stage's candidates and the graph's own `openings_px` and gaps. That includes gaps the openings stage dropped as label-hidden passages.
4. **06 §8.6 step 7: `open`.** It is computed by relabelling the free space with only the ≤ 6 t closures drawn. t is the closed wall's thickness, or the pair's mean thickness for a collinear closure. Door and window closures count (concern 2, R18-c).
5. **06 §8.6 step 6: `contains_text_ids`.** A token belongs to the face whose polygon (outer contour) contains its box centre, and to the smallest such face when faces nest.
6. **`scale_y`.** Along-line lengths follow their line (opening, gap and tick positions), areas scale, and across-line widths and thicknesses are kept (§2.2).
7. **Acceptance metric and truth.**
   - The match rule with the open-room exception and the `open_in_host` report (§3).
   - Labels are scored over matched rooms whose label has a replayed OCR token in the room.
   - Judgement calls in the truth:
     - the HDB kitchen rectangle;
     - the brochure kitchen cut at x 152;
     - the HDB bay and 600 recess as unlabelled rooms;
     - the brochure's outside spaces as `not_rooms`.
8. **Test move.** `test_hdb_seven_rooms_are_faces` (graph faces, `test_reference_walls.py`) is replaced by `test_hdb_seven_rooms_are_matched` (§8.6 rooms against the traced rooms truth, `test_reference_rooms.py`).

## 8. Tests and evidence

**RED.**
- `uv run pytest tests/test_rooms.py -q` with no module: `ModuleNotFoundError: No module named 'app.pipeline.rooms'` at collection.
- Against a stub returning `([], zeros)`: **11 failed, 1 passed**. The pass was `scale_y`, because the schema had been written before that run.
- Against a `scale_y` that returns `self`: **1 failed** (`assert {'N1': (10.0, 20.0) ...} == {'N1': (10.0, 21.0) ...}`).

The failures were expected: no faces, no ids, no map values, and no scaling.

**Rules switched off, after the fix:**

| Rule off | Fails |
|---|---|
| free-end requirement | `test_aligned_junction_ends_are_not_closed` |
| collinear closures | `test_collinear_wall_ends_are_closed_up_to_18_t[70, 150, 240]` |
| graph walls drawn | `test_graph_walls_close_the_mask` |

A "continuation" guard in `_ends` changed no test and no reference output. Shortest-first pairing already prevents what it guarded, so it was removed.

**GREEN.**

| Command | Result |
|---|---|
| `uv run pytest tests/test_rooms.py -q` | 12 passed |
| `uv run pytest tests/test_reference_rooms.py -q` | 12 passed, 1 xfailed (strict HDB ≥ 7) |
| `uv run pytest -q` (full, at `b878b2b`) | **934 passed, 1 skipped, 3 xfailed** in 188 s. The xfails are HDB ≥ 7 rooms and Task 17's 2 hollow-stretch residuals |
| `uv run ruff check .` / `ruff format --check .` / `mypy app` | clean / 86 files formatted / no issues in 53 files |

**Overlays.** Faces are coloured with their ids and `open`, the mask is red, and the truth points are green:
- `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/t18/hdb-3room-rooms.png`
- `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/t18/brochure-2bhk-rooms.png`

Every other scratch file has been deleted.

## 9. Files

- **New:**
  - `vision/app/pipeline/rooms.py`;
  - `vision/tests/test_rooms.py`;
  - `vision/tests/test_reference_rooms.py`;
  - `vision/tests/fixtures/reference/hdb-3room.drawing-rooms.json`;
  - `vision/tests/fixtures/reference/brochure-2bhk.drawing-rooms.json`.
- **Changed:**
  - `vision/app/schemas/candidates.py` (`RoomFace`, `CandidateSet`);
  - `vision/tests/support/reference.py` (the rooms stage in `run_chain`, rooms truth and metrics);
  - `vision/tests/test_reference_walls.py` (the graph-face ≥ 7 xfail moved to the rooms tests).
- **Not touched:** every walls, graph, openings and dimension module and every earlier truth file.

## 10. Concerns

1. **HDB ≥ 7 is not met** (4 / 12). NEEDS_CONTEXT; see §6, rulings R18-a and R18-b.
2. **The `open` flag on real drawings.** Read literally, 06 §8.6 counts door closures. Every HDB room is open, because its doors are 6.2–12.5 t, while no brochure room is (its doors are 3–4 t). This needs a ruling (R18-c).
3. **Brochure R6**, a false 0.25 m² face from furniture lines, survives here and relies on Task 21's < 1 m² filter.
4. **Truth judgement calls** need an independent look (§7, item 7), especially the kitchen cut-outs and the bay and recess counted as rooms.
5. **Callers (Tasks 30 and 33) must pass an empty graph and empty openings** at 20 mm/px, as preflight notes. With an empty graph, `closed` is the mask only, which suits rasterised expected walls.

---

# Continuation: controller rulings on the NEEDS_CONTEXT

**Status: DONE.** Commit `bbf88fc` (pushed): fix(vision): only passages and gaps leave a room face open (ruling R18-c).

## C1. Rulings applied

**R18-a: accepted.**
- `ROOMS_FLOOR` stays at HDB 4 and brochure 3.
- `test_hdb_seven_rooms_are_matched` stays a strict xfail. Its reason now reads "Task 34 target (ruling R18-a)".

**R18-b: not adopted.** No walls-stage change.

**R18-c: accepted; logged for spec 19 as deviation 9 below.**
- `_Closure` now carries `passage`. `_opening_intervals` returns `(u0, u1, passage)` per merged interval, and `passage` is false as soon as a door or window candidate lies on the interval.
- These count as passages:
  - openings of kind `opening`;
  - graph gaps that no candidate lies on;
  - collinear closures.
- `long` now means a passage longer than 6 t. The 6 t length rule of 06 §8.6 is kept for passages and gaps.
- Docstrings updated: the `rooms.py` module, step 7, and `RoomFace`.

**Truth `method` notes.** Both rooms JSONs gained `method.judgement_calls`:
- **HDB:** the kitchen cut-out (rectangle x 140–297, y 182–480; living = the face minus it; open onto living), and the bay and 600 recess counted as unlabelled rooms because they are faces of the verified wall truth.
- **Brochure:** the kitchen cut-out at x 152 (open onto living), and the outside spaces as `not_rooms`.

`test_truth_rooms_are_consistent` now requires the `judgement_calls` key.

## C2. Tests

The new tests are in `tests/test_rooms.py`:
- `test_wide_door_keeps_the_room_closed`: a 120 px door (> 6 t = 84) in the Task 16 plan through the full chain gives 2 faces, neither open.
- `test_only_passages_and_gaps_open_a_face[door, window, opening, none]`: a 150 px closure on a hand-built graph. A door or window gives `open: false`. A passage or a bare graph gap gives `open: true`.

The existing `test_open_face_flag` still holds: a 120 px passage leaves both faces `open: true`.

**RED.** Against the `b878b2b` `rooms.py`, 3 tests failed:
- `test_wide_door_keeps_the_room_closed`;
- the `door` case of `test_only_passages_and_gaps_open_a_face`;
- the `window` case.

The two passage/gap cases and every earlier test passed.

**GREEN.**

| Command | Result |
|---|---|
| `uv run pytest tests/test_rooms.py -q` | 17 passed |
| `uv run pytest -q` (full) | **939 passed, 1 skipped, 3 xfailed** in 197 s |
| `ruff check` / `ruff format --check` / `mypy app` | clean / 86 files formatted / no issues in 53 files |

## C3. Open counts after R18-c

| | Before | After |
|---|---|---|
| HDB | 6 of 6 open | **4 of 6** open: R3, R4, R5, R6 |
| Brochure | 0 of 6 | **0 of 6** |

On the HDB, R1 (toilet 1) and R2 (bedroom 1) are now closed: only their doors closed them. R3–R6 stay open through bare graph gaps of 8.5–9.8 t (W34, W49, W51; no door or window candidate on them). Matched rooms, labels and every other metric are unchanged.

## C4. Final metrics

| Metric | HDB | Brochure | Floor / target |
|---|---|---|---|
| Matched rooms | 4 / 12 | 3 / 7 | floors 4 / 3; HDB ≥ 7 is a strict xfail carried to Task 34 |
| Labels in their room's face | 1.00 (3 / 3) | 1.00 (3 / 3) | ≥ 0.80 |
| Room faces / open | 6 / 4 | 6 / 0 | – |
| Graph bounded faces | 6 | 4 | ≥ 6 / ≥ 4 |
| Walls R / P, outer free ends | 0.927 / 0.973, 0 | 0.920 / 0.864, 0 | floors hold |
| Openings R / P, hinge and swing | 0.462 / 0.667, 1.00 | 0.625 / 1.000, 1.00 | floors hold |
| Dims R / P / intervals / labels / ticks R / P | 0.833 / 1.000 / 0.979 / 0.923 / 0.985 / 0.932 | 0 lines | unchanged |
| Non-OCR chain (rooms stage) | 1.69 s (0.06 s) | 1.16 s (0.06 s) | < 10 s |

## C5. Residuals (Task 34)

1. **HDB ≥ 7 matched rooms** (ruling R18-a). This needs the walls-stage residuals below. With all five walls present, `find_room_faces` matches 11 of 11 (oracle, §5).
2. **I11**, toilet 2's bottom wall: its faces are broken under the "1200" label (R-c′). Fixing it separates toilet 2 from bedroom 2.
3. **I14**, the wall between toilet 3 and bedroom 3: its faces are cut by the "1800" dimension's end tick (R17-d 1).
4. **I16**, toilet 3's top wall: faint faces and window (R17-d 5). **I12**, the bay's bottom wall, is also missing; with I16 it separates the bay.
5. **I17**, the store wall: its stubs are below the 0.03 L pairing length (R17-d 2). Fixing it separates the store from the living room.
6. **Brochure W20** tilted 8.5° (D2) and the **deck's bottom wall** (D6): these merge bedroom-left with toilet-left, and the deck with living.
7. **Brochure R6**, a 0.25 m² false face, is left to Task 21's < 1 m² filter.

## C6. Deviations added for spec 19

9. **R18-c, the `open` flag (06 §8.6 step 7).** Only passage closures longer than 6 t open a face:
   - passages;
   - graph gaps with no door or window candidate on them;
   - collinear closures.

   Door and window closures never do, whatever their width.

---

# Fix round 1 (review `task-18-review.md`)

**Status: DONE, with one deviation from the I2 ruling as worded (FR1-2), for the controller to confirm.** Commit `793e48c` (pushed): fix(vision): Task 18 review fixes (scale_y text and widths, corridor crossings, ledges, ridge anchors).

## FR1-1. I1 and M3: `CandidateSet.scale_y`

- **Text height (I1).** `height_px` now scales when `angle == 0`, where it is the box height, and is kept when `angle == 90`, where it is the box width. This follows `TextToken`'s rule.
- **Widths across a line (M3).** A wall's `thickness_px` and a segment's `width_px` scale by `factor / k`, where k is the line's own stretch: the area scales by `factor` and the length by k.
  - A horizontal line's width scales by f.
  - A vertical line's width is kept.
  - A diagonal line's width scales by f / k.
- **`theta0`.** It becomes `atan2(f·sin θ, cos θ) mod 90`, that is, tan θ′ = f · tan θ.
- **Docstring.** It now states that the face-id map is not in the set: a caller of `scale_y` must rebuild it or resample it (nearest neighbour). That is the note for Task 21/22.
- **Test.** `test_scale_y_scales_lengths_across_y` covers:
  - a token at angle 0, whose `height_px` equals the new box height, 11.0;
  - a token at angle 90, whose `height_px` equals the box width, 10.0;
  - horizontal, vertical and diagonal walls;
  - horizontal and vertical segments;
  - `theta0` at 10° and at 0°.

## FR1-2. I2: a corridor crossing aligned partitions

**The rule as worded.** I first implemented the ruling as worded: skip a passage or bare-gap interval spanning a whole wall between two nodes of degree ≥ 3. It fixed D2, but **HDB fell from 3 matched rooms to 2** (ledges excluded), and the balcony and the recess merged into bedroom 3. Two HDB walls cause this:
- **W49** (y ≈ 1236–1242, x 1282–1371): the recess's top wall, X6, whose double line the walls stage does not pair (R17-d 4);
- **W48** (16 px): the next piece along.

Both are whole-wall gaps between degree-3 nodes. They are real walls that the walls stage reads as gaps, and closing them as passages is what separated those spaces.

**What is implemented instead.** A narrower general rule from the same idea:
- The interval is skipped when it spans the whole wall (within t of both ends) **and both ends are crossings**. A crossing is an end where another wall leaves the node on *both* sides of the gap wall's line, each at least 45° off it.
- That is exactly a corridor's width between two through walls where aligned partitions meet it.
- At W48 and W49, each end has a perpendicular wall on one side only (a T), so they are still closed.
- Doors and windows are never skipped.

**Measurements:**

| Rule | HDB matched (ledges excluded) | Brochure | D2 aligned | D3 offset |
|---|---|---|---|---|
| None (the original code) | 3 | 3 | 6 faces, corridor split, both open | 5 faces |
| Degree ≥ 3 at both ends (as worded) | **2** | 3 | 5 faces | 5 faces |
| Crossings at both ends (committed) | 3 | 3 | 5 faces, none open | 5 faces |

If you want the rule as worded, it is a one-line change: replace `between_crossings` with a degree test. The cost is the HDB floor at 2.

**Tests.**
- `test_corridor_across_partitions_is_one_closed_face[aligned, offset]` runs the full chain on the reviewer's D2 case (partitions at x 1200 above and below a 150 px corridor) and the D3 case (partitions at x 1000 and x 1400). Each gives 5 faces, one corridor face spanning the plan, and none open.
- `test_door_between_junctions_still_closes` is hand-built. The same whole-wall interval between crossings gives 3 faces when it is a passage, and 4 when it is a door.

## FR1-3. M1: ledges

- The HDB `recess` and `bay` now carry `"kind": "ledge"`.
  - `TruthRoom.kind` defaults to `"room"`.
  - `room_metrics` leaves ledges out, like the `not_rooms`: they are neither matched nor counted against.
- The truth test checks that `kind` is in {room, ledge}. The metric self-test expects all non-ledge rooms to match, and its merge pair is two rooms.
- The `judgement_calls` note records the ledges: the recess is about 0.72 m², below 06 §8.6's 1 m² filter; the bay is an AC ledge reached only through a window.
- **Floors re-based:** `ROOMS_FLOOR` HDB 3 (toilet-1, bedroom-1, balcony), brochure 3.
- **Target:** ≥ 7 is now over the HDB's 10 rooms, ledges excluded. It stays a strict xfail for Task 34, and its reason was updated. With the five missing truth walls in place, all 10 would match (the oracle of §5).

## FR1-4. M2: the HDB living and kitchen polygons

- The kitchen is now the living/kitchen face's part left of the I1/I17 wall line, the polyline (297, 181) → (299, 364) → (299, 480), and above y 480. The living room is the face minus that part.
- Both polygons are cleaned with a ±0.5 px buffer and simplified by 0.5 px. That removes the 1 px sliver along the kitchen's top edge and the 2 px strip at x 297–299.
- The `traced` and `judgement_calls` notes now describe that cut, not "the rectangle x 140–297".
- The overlap between the two polygons is 0.0, and both points stay inside their polygons.

## FR1-5. M5, M6 and M7

- **M5.** Report §4 now calls brochure R6 the living room's side-table/lamp symbol at source x 225–240, y 290–306.
- **M6.** `_is_open` now works inside the bounding box of the reached component. The box comes from `connectedComponentsWithStats` of the short-closure labelling, and it holds the face. Each check compares labels inside that crop only; there is no full-page boolean pass per face. The rooms stage takes 0.03–0.09 s.
- **M7.** The anchor is now the pixel, among those within 0.5 px of the distance-transform maximum, that lies nearest the middle of those pixels. Test: `test_corridor_anchor_sits_mid_ridge`. In a full-width corridor the anchor is at x 1200 ± 10, y 925 ± 2; before the fix it was at x 375.

The anchors moved, but the reference faces, matches and labels are unchanged. The overlay PNGs in `t18/` are from before this round: the faces are the same, and only the anchor labels would move.

## FR1-6. M4: logged for spec 19, no code change

Carried to Task 21/34:
- A balcony with an open front and no return stubs, or with a front wider than 18 t, merges with the outside and is dropped, never reported `open`.
- The bounding-box aspect limit of 15 drops a 0.9 × 12 m corridor; a minimum width in mm after scale would be more robust.
- A label token centred on a wall falls in no face. 06 §8.7's `missedRooms` covers it.

**Note for Task 21/22.** The face-id map is not in `CandidateSet`. A caller of `scale_y` must rebuild it, for example with `cv2.fillPoly` from the scaled polygons, or resample it with nearest neighbour.

## FR1-7. Evidence

**RED** (the new tests before the fix): 4 failed.
- `test_scale_y_scales_lengths_across_y`: `assert 10.0 == 11.0`.
- `test_corridor_across_partitions_is_one_closed_face[aligned]`: `assert 6 == 5`.
- `test_door_between_junctions_still_closes`: `assert 4 == 3`.
- `test_corridor_anchor_sits_mid_ridge`: `assert 375.0 == 1200 ± 10`.

The offset corridor case already passed.

**Rules switched off, after the fix:**

| Rule off | Fails |
|---|---|
| the crossing skip | the aligned corridor and the door/passage test |
| ridge middle (first maximum used) | the anchor test |

**GREEN:**

| Command | Result |
|---|---|
| `uv run pytest tests/test_rooms.py tests/test_reference_rooms.py -q` | 34 passed, 1 xfailed |
| `uv run pytest -q` (full) | **944 passed, 1 skipped, 3 xfailed** in 183 s |
| `ruff check` / `ruff format --check` / `mypy app` | clean / 86 files formatted / no issues in 53 files |

## FR1-8. Metrics

| Metric | HDB | Brochure | Floor / target |
|---|---|---|---|
| Matched rooms (ledges excluded) | 3 / 10 | 3 / 7 | floors 3 / 3; HDB ≥ 7 is a strict xfail for Task 34 |
| Labels in their room's face | 1.00 (3 / 3) | 1.00 (3 / 3) | ≥ 0.80 |
| Room faces / open | 6 / 4 | 6 / 0 | – |
| Graph bounded faces | 6 | 4 | ≥ 6 / ≥ 4 |
| Walls R / P, outer free ends | 0.927 / 0.973, 0 | 0.920 / 0.864, 0 | floors hold |
| Openings R / P, hinge and swing | 0.462 / 0.667, 1.00 | 0.625 / 1.000, 1.00 | floors hold |
| Dims | 0.833 / 1.000 / 0.979 / 0.923 / 0.985 / 0.932 | 0 lines | unchanged |
| Non-OCR chain (rooms stage) | 1.75 s (0.05 s) | 1.10 s (0.06 s) | < 10 s |

## FR1-9. Deviations added for spec 19

10. **06 §8.6 step 1 (review I2).** A passage or bare-gap interval spanning a whole wall whose two ends are both crossings is not closed. A crossing is an end where another wall leaves on both sides of the line, at least 45° off it. This is narrower than the ruling's "degree ≥ 3", for the HDB reason given in FR1-2.
11. **06 §8.6 step 5 (M7).** On a flat ridge, the anchor is the ridge pixel nearest the ridge's middle. The tolerance is 0.5 px of the maximum.
12. **`scale_y` (I1, M3).** Widths across a line scale by f / k, text height follows the token's orientation, and `theta0` is turned.
13. **Truth (M1).** Ledges are neutral in the metric, and the floors are re-based.
14. **M4 limits**, as listed in FR1-6.
