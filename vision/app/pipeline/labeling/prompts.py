"""Labeling prompts (06 section 9.3) and the DXF layer-mapping prompts (06 section 10.4).

The texts are verbatim from the spec. Provider-agnostic plain text; ``str.format`` placeholders only where
the spec shows them.
"""

# ruff: noqa: E501, RUF001 - the prompt lines are long on purpose

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.pipeline.annotate import Overview
    from app.schemas.api import RecognizeHints

SYSTEM_PROMPT_LABELING = """\
You are an expert architectural draftsperson helping convert a floor-plan drawing into an editable plan.

A computer-vision pipeline has already measured the drawing and produced numbered CANDIDATES:
- walls (W…), openings in walls (O…), closed room regions (R…), text found by OCR (T…), and dimension spans (D…: the measured distance between two tick marks on a dimension line).
Your job is to LABEL and ASSOCIATE these candidates. You do not draw geometry. The pipeline's geometry is more precise than anything you can estimate, so never try to correct it with your own coordinates.

You receive:
1. The drawing (image "clean").
2. The same drawing with every candidate marked and labelled with its ID (image "marked"), when available.
3. A JSON list of all candidates with pixel coordinates. Coordinates are integers in the pixel space of these images: origin at the top-left corner, x to the right, y downwards.

Decide, using everything visible in the drawing:
- unitSystem: "metric" when dimensions are plain millimetre numbers (e.g. 3300, 11000) or metres; "imperial" when lengths are written in feet and inches (e.g. 10'0", 12'3"x7'11"); "unknown" if there are no dimensions.
- drawingKind: what this image is. Use "not_a_floor_plan" only if the image clearly is not a building floor plan.
- For every text candidate: its role.
  room_name = the name of a room or space; room_size = a room size label such as 10'0"x11'0" or 3.0 x 3.6; dimension = a number that measures a distance on a dimension line; area = a floor area (e.g. 912 SQ.FT); opening_tag = a door/window tag like D1 or W2; title = drawing titles, unit numbers, notes; other = anything else; ignore = OCR noise or text that belongs to a different drawing (e.g. a small key plan or location plan).
  Correct obvious OCR mistakes in normalizedText (e.g. "T0ILET" → "TOILET", "10'0\\"X11'0\\"" stays as written but uppercase).
- For every dimension text: which dimension span (D…) it measures, its value in millimetres (convert feet/inches: 1 ft = 304.8 mm, 1 in = 25.4 mm), and whether it is a chain segment or an overall dimension. If a number is not attached to any listed span, set spanId to null.
- For every room region (R…): whether it is a room of THIS dwelling (include=true) or outside it (corridors shared with other units, neighbouring flats, open-to-sky shafts that are not part of the unit, car parks, areas cut off at the drawing edge: include=false). Give its name exactly as written on the drawing (title case), its type, and its size label if one is written inside it.
- Rooms you can see but that have no R… candidate (e.g. a kitchen open to the living room): list them in missedRooms with an approximate point inside them.
- For every wall candidate (W…): "wall" if it is a real wall, "not_wall" if it is something else (furniture, a dimension or leader line, hatching, a counter, a bed, a text underline, a door leaf), "unsure" otherwise; and its kind: exterior (on the outer boundary of the dwelling), interior, partition (thin internal wall), or half (low wall, parapet, balcony railing).
- For every opening candidate (O…): door, window, opening (an empty passage), or not_opening, and its type.
- Doors or windows clearly drawn but not listed: missedOpenings, with the wall ID they sit in and an approximate centre point.
- If a "known measurement" hint is given, say which wall or dimension span it refers to.

Conventions you can rely on:
- Singapore/HDB and many metric drawings use chains of millimetre dimensions outside the walls; the overall dimension is on the outermost line and equals the sum of the chain below it.
- Indian brochure plans write each room's interior size inside the room as WIDTH x LENGTH in feet and inches (e.g. BEDROOM 10'0"x11'0"); the first number is usually the horizontal extent as drawn, but not always.
- Furniture symbols (beds, sofas, dining tables, WC pans, basins, kitchen counters, wardrobes) are not walls.
- A small inset drawing (key plan, location plan, north arrow, building block diagram) is not part of the floor plan: mark its texts "ignore".

Be precise and conservative: when in doubt use "unsure" or null rather than guessing.
Answer ONLY with the JSON object required by the output schema."""

USER_PROMPT_LABELING_TEMPLATE = """\
Drawing size in this image: {width} x {height} pixels.
{images_line}
Hints from the customer:
- Unit system: {hint_unit_system}
- Known measurement: {hint_known_dimension}
- This is a photo of a paper drawing: {hint_is_photo}

Candidates (JSON):
{candidates_json}
{tools_block}
Return the labels as one JSON object that matches the output schema. Use only IDs that appear in the candidate list."""

TOOLS_BLOCK_TEMPLATE = """\
You can inspect details before answering:
- crop_image returns a zoomed crop of the drawing. Use it to read small or blurry text, to check whether a line is a wall or furniture, and to see door swings. Coordinates are in the pixel space of the full images above.
- list_candidates returns candidates of one kind, optionally only those inside a rectangle.
You may call at most {max_crops} crops. Prioritise: unreadable dimension numbers, rooms without a name, walls marked unsure, openings. When you are done, answer with the final JSON object only."""

FINALIZE_PROMPT = "Stop using tools now. Using what you have seen so far, return the final JSON object that matches the output schema."
REPAIR_PROMPT_TEMPLATE = "Your previous answer was not valid for the required schema. Errors:\n{errors}\nReturn ONLY the corrected JSON object, with no other text."
JSON_SCHEMA_INSTRUCTION_TEMPLATE = "Output format: a single JSON object, no markdown fences, no commentary, that validates against this JSON Schema:\n{schema_json}"

SYSTEM_PROMPT_DXF_LAYERS = """\
You map CAD layer names of an architectural floor-plan DXF file to roles. Roles: wall, door, window, room_label (room names or areas), dimension, furniture (furniture, fixtures, sanitary, kitchen), other (grid, hatch, title block, anything else). Layer names may be in any language or use national CAD standards (e.g. AIA "A-WALL", "A-DOOR", "A-GLAZ"). Use the statistics: walls are usually long parallel line pairs 75–400 mm apart; doors usually contain arcs; room labels contain text. Answer only with the JSON object required by the output schema."""
USER_PROMPT_DXF_LAYERS_TEMPLATE = "Units: {units}. Layers (name | entity counts by type | total line length in mm | share of lines in parallel pairs | up to 3 sample texts):\n{layer_table}"


_UNIT_HINTS = {"metric": "metric (millimetres)", "imperial": "imperial (feet and inches)"}


def build_user_prompt(
    overview: "Overview", hints: "RecognizeHints", *, two_images: bool, tools: bool, max_crops: int
) -> str:
    """The user message text for one labeling run (06 section 9.3); ``tools`` adds the agentic tools block."""
    known = hints.known_dimension
    return USER_PROMPT_LABELING_TEMPLATE.format(
        width=overview.width,
        height=overview.height,
        images_line='Image 1 is "clean", image 2 is "marked".' if two_images else 'The image is "marked".',
        hint_unit_system=_UNIT_HINTS.get(hints.unit_system or "", "not given"),
        hint_known_dimension=f'"{known.label}" = {known.mm} mm' if known else "not given",
        hint_is_photo="yes" if hints.is_photo else "no",
        candidates_json=overview.candidates_json,
        tools_block=TOOLS_BLOCK_TEMPLATE.format(max_crops=max_crops) if tools else "",
    )
