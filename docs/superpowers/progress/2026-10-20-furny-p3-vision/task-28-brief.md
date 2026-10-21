### Task 28: DXF reader, units, layer classification, LLM layer mapping

**Files:**
- Create: `vision/app/pipeline/dxf/reader.py`, `vision/app/pipeline/dxf/layers.py`, `vision/tests/support/dxfgen.py`
- Test: `vision/tests/test_dxf_reader.py`

**Spec refs:** `06 §10.1`, `06 §10.2`, `06 §10.4`, `06 §5.4` (`dxf` inspect info), `18 §8.3`

**Interfaces:**
- Produces, in `reader.py`:
  - `DxfEntityRecord(kind: Literal["line", "arc", "circle", "hatch", "text", "insert_bbox"], layer: str, points: list[Pt], center: Pt | None, radius: float | None, start_deg: float | None, end_deg: float | None, text: str | None)` in drawing units.
  - `DxfDrawing(records: list[DxfEntityRecord], insunits: int, unit_factor_mm: float, units_guessed: bool, layer_stats: dict[str, LayerStats], extents: tuple[float, float, float, float])`.
  - `read_dxf(data: bytes, hints: RecognizeHints, ctx) -> DxfDrawing`.
  - `dxf_info(data: bytes) -> DxfInfo` (`insunits`, `layerCount`, `entityCount`).
  - Constant `MAX_DXF_ENTITIES = 200_000`.
- Produces, in `layers.py`: `LayerRole`, `classify_layers_regex(names) -> dict[str, LayerRole]`, `parallel_pair_share(segments) -> float`, and `classify_layers(drawing, provider: LLMProvider | None, ctx) -> tuple[dict[str, LayerRole], list[UsageCall]]`.
- Produces, in tests: `dxfgen.make_room_dxf(insunits: int = 4, scale: float = 1.0, wall_layer="A-WALL", door_layer="A-DOOR", window_layer="A-GLAZ", label_layer="A-AREA-IDEN") -> bytes`. It draws a 6000×4000 mm room with 230 mm double-line walls, a 900 mm door gap with an ARC on the door layer, a 1200 mm window gap with two lines on the window layer, and a TEXT `BEDROOM`; coordinates are multiplied by `scale`.

- [ ] **Step 1: Write the failing test.**
  - `test_units`: `insunits=4` → factor 1. `insunits=1` with geometry ÷ 25.4 → factor 25.4, and extents × factor ≈ 6000 ± 1. `insunits=6` (metres) → 1000. `insunits=0` with mm-sized extents → mm, `units_guessed`, warning `dxf_units_guessed` `{"assumed": "mm"}`. `insunits=0` with extents 600 and an imperial hint → inches.
  - `test_layer_regex`: `A-WALL` → wall, `MUR_EXT` → wall, `A-DOOR` → door, `A-GLAZ` → window, `DIM` → dimension, `A-AREA-IDEN` → room_label, `FURN` → furniture, `Defpoints` → other, `0` → other, `XYZ` → unclassified (absent).
  - `test_insert_exploded`: a block with lines on layer `0` inserted on layer `A-WALL` → records with `layer == "A-WALL"`; nesting depth > 4 is ignored.
  - `test_dxf_too_complex`: `MAX_DXF_ENTITIES` monkeypatched to 50 → `VisionError("dxf_too_complex")` with status 422.
  - `test_corrupt`: random bytes after `0\nSECTION` → `corrupt_file`.
  - `test_binary_dxf`: `ezdxf` saved with `fmt="bin"` reads the same record count.
  - `test_llm_layer_mapping`: layers renamed `L1` (walls) and `L2` (doors) → regex finds no wall layer → `FakeProvider` returns `{"layers": [{"name": "L1", "role": "wall"}]}`. The call is text-only with `effort == "low"`, purpose `dxf_layers` and the system prompt `SYSTEM_PROMPT_DXF_LAYERS`. The result maps L1 → wall, and L2 keeps its regex result.
  - `test_heuristic_layer_guess`: provider `None` → the layer with the largest line length among layers with ≥ 20 % parallel-pair coverage becomes wall, with warning `dxf_layers_guessed`.
  - `test_dxf_info`: `{insunits: 4, layerCount: ≥ 4, entityCount: n}`.
- [ ] **Step 2: Run it, expect FAIL.** Command: `uv run pytest tests/test_dxf_reader.py -q`.
- [ ] **Step 3: Implement** per 06 §10.1, §10.2 and §10.4.
  - ASCII is decoded with the `$DWGCODEPAGE` fallback `cp1252` (`errors="replace"`), then `ezdxf.read(io.StringIO)`. Binary goes through a temp file and `ezdxf.readfile`. On `DXFStructureError`, retry with `ezdxf.recover.read`.
  - Bulges become ARC records. Solid HATCH boundary paths become polylines.
  - `MTEXT.plain_text()` is used for text.
- [ ] **Step 4: Run tests, expect PASS.** Same command as Step 2.
- [ ] **Step 5: Quality gates.** `uv run ruff check . && uv run ruff format --check . && uv run mypy app`
- [ ] **Step 6: Commit.** `git add vision/app/pipeline/dxf/reader.py vision/app/pipeline/dxf/layers.py vision/tests/support/dxfgen.py vision/tests/test_dxf_reader.py` then `git commit -m "feat(vision): DXF reading, unit detection and layer classification" -m "$FURNY_TRAILER"`.

---

