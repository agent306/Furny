### Task 18: Room faces and `CandidateSet`

**Files:**
- Create: `vision/app/pipeline/rooms.py`
- Modify: `vision/app/schemas/candidates.py` (add `RoomFace`, `CandidateSet`)
- Test: `vision/tests/test_rooms.py`

**Spec refs:** `06 §8.6` (steps 1–7; the post-scale filters are applied in Task 21)

**Interfaces:**
- Produces:
  - `RoomFace(id: str, polygon_px: tuple[Pt, ...], anchor_px: Pt, area_px: float, bbox: tuple[float, float, float, float], contains_text_ids: tuple[str, ...], open: bool)`.
  - `find_room_faces(wall_mask: np.ndarray, graph: WallGraph, openings: list[OpeningCandidate], tokens: list[TextToken], region: Rect, t_median: float) -> tuple[list[RoomFace], np.ndarray]`. The second element is the int32 face-id map: 0 for none, k for `R{k}`.
  - `@dataclass(frozen=True) CandidateSet(texts, segments, dimension_lines, spans, nodes, walls, gaps, openings, rooms, theta0: float, t_thin: float, t_median: float, region: Rect, drawing_kind_cv: DrawingKind)`, with `scale_y(factor: float) -> CandidateSet` returning a copy with every y coordinate multiplied (used by anisotropy correction).

- [ ] **Step 1: Write the failing test.**
  - `test_two_rooms_with_door_closure`: the 7-wall plan from Task 16 with a door in the partition → exactly 2 faces, neither touching the border; each `anchor_px` is strictly inside its polygon (`cv2.pointPolygonTest > 0`); `open is False`. Use a 70 px door so the closure stays ≤ 6t = 84 px.
  - `test_open_face_flag`: a 120 px gap closure (> 6t with t = 14) → `open is True`.
  - `test_border_and_sliver_discarded`: the outside region is discarded; a 400×10 px sliver (aspect > 15) is discarded; an area < 0.002 × region area is discarded.
  - `test_contains_text_ids`: tokens centred in the left room are listed only in that face.
  - `test_face_id_map`: the map value at each anchor equals the face index.
  - `test_candidate_set_scale_y`: `scale_y(1.05)` multiplies node, wall, room and span y coordinates and leaves x unchanged.
- [ ] **Step 2: Run it, expect FAIL.** Command: `uv run pytest tests/test_rooms.py -q`.
- [ ] **Step 3: Implement** per 06 §8.6 steps 1–7.
  - Use `cv2.connectedComponentsWithStats(connectivity=4)`, `cv2.findContours(RETR_EXTERNAL)` + `approxPolyDP(0.5 t)`, and the distance-transform maximum as the anchor.
  - Ids are `R{n}` sorted by anchor `(y, x)`.
- [ ] **Step 4: Run tests, expect PASS.** Same command as Step 2.
- [ ] **Step 5: Quality gates.** `uv run ruff check . && uv run ruff format --check . && uv run mypy app`
- [ ] **Step 6: Commit.** `git add vision/app/pipeline/rooms.py vision/app/schemas/candidates.py vision/tests/test_rooms.py` then `git commit -m "feat(vision): room face detection and CandidateSet" -m "$FURNY_TRAILER"`.

---


## Controller additions (binding)

### A. Reference rooms truth and acceptance

Trace `vision/tests/fixtures/reference/{hdb-3room,brochure-2bhk}.drawing-rooms.json` in source px. For each room record:
- an interior point;
- a rough polygon;
- the label as printed (e.g. BEDROOM, TOILET, KITCHEN), or `null`;
- an `open` flag for spaces that open onto another space without a door. The HDB kitchen is open to the living room.

Add a `method` note.

A truth room is **matched** when exactly one `RoomFace` contains its interior point and that face contains no other truth room's point.

Write `@pytest.mark.reference` tests on the full chain (walls → graph → openings → `find_room_faces`):
- HDB: ≥ 7 matched rooms. This is the existing strict xfail target from Task 16c (`test_hdb_seven_rooms_are_faces`). Turn it into a passing test, or follow the escalation rule below.
- Brochure: report the matched count, and set it as a floor.
- Labels: `contains_text_ids` must place each room label token in the face of the room it names, for ≥ 80 % of the matched rooms on both images.
- Report merged rooms (one face holding two truth rooms) and split rooms (one truth room covered by several faces).

### B. Generality first

Use general rules only (06 §8.6 steps 1–7). Do not add special cases tuned to one image.

If HDB cannot reach ≥ 7 without a design change beyond 06 §8.6, stop and report NEEDS_CONTEXT with:
- the metrics;
- which rooms fail and why;
- a proposed ruling.

The controller may re-scope ≥ 7 to a floor, as was done in Task 17.

### C. Floors that must not regress

- Walls: HDB ≥ 0.927 / 0.973, brochure ≥ 0.920 / 0.864, outer free ends 0.
- Openings: at least the current floors.
- Dims: unchanged.
- Non-OCR chain: < 10 s.
