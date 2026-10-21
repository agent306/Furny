# Re-review 3: Task 16c fix round 3 (29436f2..0bb2772)

**Inputs**
- The fix diff `review-29436f2..0bb2772.diff`, one commit. It touches `binarize.py`, `region.py` and `test_preprocess.py`.
- The "Fix round 3" section of `task-16c-report.md`.
- The controller's two accepted departures:
  - **Pixel mass:** wall mass is measured in pixels.
  - **Surround rule:** a strip drawing around a solid plan holding at least 30 % of its mass is no candidate.

  I checked both for soundness, not for compliance.

**How I ran it**
- Everything ran in an export of 0bb2772 with its own venv, in `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/rv16c/src`. The export is deleted.
- My scripts are in `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/rv16c/work/`. The new ones are `cc_mass.py`, `cc_mass2.py`, `cc_mass3.py` and `hdb_drawings.py`.

## Metrics, reproduced at 0bb2772

| | HDB | Brochure |
|---|---|---|
| Recall / precision | 0.8892 / 0.9628 | 0.9117 / 0.8650 |
| Free ends | 9 | 17 |
| Faces | 5 | 3 |
| Outer-cycle free ends | 0 | 0 |
| Enclosed share | 0.997 | 0.99 |
| Region | (118, 81, 1709, 1473) | (131, 150, 1212, 1082) |
| Walls stage | 0.17 s | 0.12 s |
| Chain | 1.7 s | 0.7 s |

- HDB dims (R / P / spans / labels): 0.833 / 1.000 / 0.979 / 0.923.
- All of this matches F3-3.

**All my earlier counter-cases still hold:**
- doors bridge 24 / 24;
- the original `side=-1` test door bridges;
- every bridge negative stays unbridged (hatch, tiles, sofa, ground lines, and the mixed-style plain gaps);
- the outside-arc cases match round 2: north arrows don't bridge, and only a circle centred within about 0.5 t of the jamb does;
- rejoin takes 0.30 s at 11.5k segments;
- the arc check costs 0.01 / 0.01 / 0.01 / 0.03 s per candidate at gaps of 150 / 340 / 540 / 1000 px;
- the R-a, dimension (Minor 1, accepted) and fin cases are unchanged.

## Finding verdicts

**R2-1: any long bold stroke turned off a double-line plan's strips. ADDRESSED.**
- `detect_plan_region` now picks the drawing with the most wall mass (region.py `detect_plan_region` and `_drawings`).
- Results from `cc_region4.py`:

  | Page | Double-line plan | Filled plan |
  |---|---|---|
  | + an 800 px bold rule | (139, 239, 1025, 825), the plan | plan |
  | + a bold title-block frame | plan, with `plan_region_ambiguous` warned | plan, with `plan_region_ambiguous` warned |
  | + a bold sheet border | whole page | whole page |

  The sheet border is the accepted Task 34 residual, and the plan stays inside the region.
- All my round 1–2 region cases still keep the plan for both plan kinds (`cc_region.py`, `cc_region2.py`, `cc_region3.py`):
  - the 40 px table, the 30 px terrace and the 45° hatch;
  - the uneven title-block table and the uneven schedule;
  - n × n regular double-line plans, with or without a column.

**R2-2: stipple inside walls read as table text. ADDRESSED.**
- Glyphs are now counted only in row-sized cells outside all strips (binarize.py `_is_table`).
- Results from `cc_region5.py`, double-line plan:

  | Wall fill | t 14 | t 24 |
  |---|---|---|
  | stipple | (139, 239, 1025, 825), same as alone | (133, 233, 1037, 837), same as alone |
  | poché hatch | same as alone | same as alone |

**Departure 1 (wall mass in pixels): sound in practice.** These graphics beside a 900 × 700 plan were tested (`cc_mass.py`, `cc_mass2.py`):
- **Solid logos** 120² to 500²: the plan keeps the region for both the filled and the double-line plan. From 250² up it warns `plan_region_ambiguous`.
  - Sauvola hollows large solid fills into rings, so a logo's mass stays small. A 160 × 160 core weighs only 11.2k px.
- **Filled north-arrow roses**, r 80 / 120 / 160: plan in every case (r 160 warns).
- **Bold title text "FLOOR PLAN"**, scale 3–5 and stroke 10–18 px: plan in every case (warned).
- **A huge bold "PLAN"** (stroke 30 px, about 2× the wall thickness, text box 660 × 270) **does** beat the double-line plan: the region becomes (1282, 1332, 661, 269), with a warning.
  - This is not a regression. With no strips (the pre-16c behaviour) the region was the text as well, and round 2 took the text as its solid drawing too.
  - I record it as an observation, not a finding.

## New breakage in the fix diff

### R3-1. Important: Departure 2 (the surround rule) discards a double-line plan that encloses a solid stair or lift core

**Where.** `detect_plan_region` drops a strip drawing whenever its box contains a solid drawing whose mass is at least 30 % of the strip drawing's mass (the `_inside` filter). A core drawn in solid fill inside a double-line plan meets that test, so the plan's own walls are thrown out and the core becomes the region. No warning is emitted.

**Cases** (`cc_mass3.py`): a 900 × 700 double-line plan whose strips weigh 49.7k px at t 14 or 86.3k px at t 24.

| Solid element inside the plan | Core mass | At t 14 | At t 24 |
|---|---|---|---|
| core 120 × 300 | 15.2k (31 %) | **region = (722, 422, 156, 336), the core** | plan |
| core 180 × 360, stair plus lift | 20.0k (40 %) | **region = (688, 388, 224, 404)** | plan |
| two lift shafts, 90 × 200 each | 25.6k (52 %) | **region = (699, 459, 222, 302)** | plan |
| core 100 × 300 | 14.4k (29 %) | plan | plan |
| square cores 120² to 200², hollowed by Sauvola | 11k or less | plan | plan |
| 1, 4 or 12 columns of 40 × 40 | – | plan | – |
| a cluster of 6 columns of 50 × 50 | – | plan | – |

So any solid core inside the plan that weighs 30 % of the plan's strips takes the region. This is the controller's own adversarial example.

**Why the rule overreaches.** The HDB case it was written for has the solid plan filling most of the dimension ring's box. The core fills a few percent of the plan's box (`hdb_drawings.py`):

| | Solid box | Strip box | Area ratio |
|---|---|---|---|
| HDB | 1525 × 1289 | 1866 × 1457 | **0.72** |
| Core 120 × 300 case | 120 × 300 | 915 × 715 | **0.055** |

**Fix.** Add spatial dominance to the rule: the solid drawing's box must cover most of the strip drawing's box (for example ≥ 50 % of its area, or ≥ 50 % of its width and of its height) as well as hold ≥ 30 % of its mass. Add the core cases as tests.

### Other checks: clean

- `strip_structures` and `_drawings` group each kind as before.
- Attached strips add mass only, not extent.
- `MAX_COMPONENTS` now ranks components by mass.
- The `int32` label `bincount` keeps memory down. The report gives a peak under 1 GB for 6000 × 4000; I did not re-measure that.
- The rejected tables, grids and lone straight strips stay out of the candidates.

## Out-of-scope observations

- Very large bold title text (stroke about 2× the wall thickness) still beats a double-line plan. This predates 16c: the pre-16c thick ∪ bold rule took it as well. A text-likeness test on solid components, run before OCR, could go to Task 33/34.

## Verdict

**Fix round:** findings remain open.
- R2-1 and R2-2 are addressed, and Departure 1 (pixel mass) is sound against the logo, rose and title adversaries.
- **R3-1 (Important):** Departure 2 is unsound. A solid stair or lift core weighing ≥ 30 % of a double-line plan's strips (120 × 300, 180 × 360, or two 90 × 200 shafts, all at t 14) discards the plan, and the region becomes the core, without a warning. Requiring the solid box to dominate the strip box separates the HDB case (0.72 of the box area) from the core case (0.055).
