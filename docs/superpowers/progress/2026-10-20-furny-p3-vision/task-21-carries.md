# Task 21 — carries from earlier tasks (binding; from progress.md and preflight.md)

1. Preflight K14: `assemble_document` gains `confidence_overrides: Mapping[str, float] | None = None` and `reason_overrides: Mapping[str, list[ReasonCode]] | None = None`, keyed by candidate id, applied before `overall`. (T30 fills them; T31 passes them through.)
2. Preflight K19: T21 emits warnings `rooms_without_names {count}` and `walls_unconnected {count}`, and pins the reasons `name_guessed`, `size_mismatch`, `unconnected`, `llm_unsure`.
3. Ruling (progress.md line 76): vision output must satisfy TS schema strictness — rotation/northAngle normalised to [0,360), colorHex/floorColorHex '#RRGGBB' or null, entity ids via new_id with correct prefix and record key == id, mmPerPixel > 0. Enforce in assemble/validate. (Task 34 adds the engine-CLI contract test.)
4. Task 20 carry: reject implausible scale samples at collection (minimum span length; plausibility band on mm/px → result is `scale_guessed`), keep the existing ±1e6 mm clamp as a backstop; make sure assembly/validation handles the absurd-scale path (coordinates beyond ±1e6 mm fail the document cleanly, not crash). The scale code is Task 20's (app/pipeline/scale*.py or equivalent) — change it minimally.
5. Task 18 carry: the face-id map is not part of CandidateSet — if assembly needs face ids after scale_y (anisotropy correction), rebuild the map rather than relying on stale ids.
6. Task 18 M4: spec limits noted for Task 21/34 — apply whatever 06 §8.x validation limits the brief names; do not invent new ones.
