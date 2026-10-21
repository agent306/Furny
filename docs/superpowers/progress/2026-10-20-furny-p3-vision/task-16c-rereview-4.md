# Re-review 4: Task 16c fix round 4 (0bb2772..f2ea8ef)

**What I reviewed**
- The fix diff `review-0bb2772..f2ea8ef.diff`: commits 1545352 and f2ea8ef, touching `region.py` and `test_preprocess.py`.
- The "Fix round 4" section of `task-16c-report.md`, including F4-7, the controller's ruling on warnings.

**How I ran it**
- Everything ran in an export of f2ea8ef with its own venv, in `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/rv16c/src`. The export is deleted.
- Scripts are in `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/rv16c/work/`. The new one is `warn_cmp.py`.

## Floors, reproduced at f2ea8ef

| | HDB | Brochure |
|---|---|---|
| Recall / precision | 0.8892 / 0.9628 | 0.9117 / 0.8650 |
| Free ends | 9 | 17 |
| Faces | 5 | 3 |
| Outer-cycle free ends | 0 | 0 |
| Enclosed share | 0.997 | 0.99 |
| Region | (118, 81, 1709, 1473) | (131, 150, 1212, 1082) |
| Dims R / P / spans / labels | 0.833 / 1.000 / 0.979 / 0.923 | – |
| Chain | 1.7 s | 0.8 s |

All of these match F4-3.

## Finding verdict

**R3-1: the surround rule dropped a double-line plan around a solid core. ADDRESSED.**

The fix is at region.py, `detect_plan_region`. A strip drawing is now dropped only when its box holds a solid drawing that both:
- has at least 30 % of the strip drawing's mass;
- covers at least `SURROUND_MIN_COVER` = 0.50 of its box.

**Core cases** (`cc_mass3.py`): the region is the whole plan, with no warning.

| Solid element | t 14 | t 24 |
|---|---|---|
| core 120 × 300 | (139, 239, 1025, 825) | (133, 233, 1037, 837) |
| core 180 × 360 | (139, 239, 1025, 825) | (133, 233, 1037, 837) |
| two 90 × 200 lift shafts | (139, 239, 1025, 825) | (133, 233, 1037, 837) |
| core 100 × 300 | (139, 239, 1025, 825) | (133, 233, 1037, 837) |

The other solid elements also keep the plan (`cc_mass.py`, `cc_mass2.py`):
- square cores from 120² to 200²;
- 1, 4 or 12 columns of 40 × 40;
- a cluster of six 50 × 50 columns;
- a 120 × 120 core touching the partition.

**HDB ring** (`hdb_drawings.py`): the dimension-chain strip drawing (box (56, 56, 1866, 1457), mass 93.4k) is still dropped. The solid plan's box (210, 173, 1525, 1289) covers 0.72 of it and holds 91.6k. The region is unchanged at (118, 81, 1709, 1473).

**New test.** `test_a_solid_core_inside_a_double_line_plan_keeps_the_plan` covers 3 cores × t 14 / t 24. It asserts both the region and that no warning is raised.

## New warning rule (`INSIDE_MIN_SHARE` = 0.80): no harmful regression

`warn_cmp.py` runs every case under the new rule and under the old one, where every drawing with at least 30 % of the main plan's mass counts as a rival. Regions are identical in every case.

| Case | Old warning | New warning |
|---|---|---|
| Rule, title-block frame, 250 px logo, bold title, r 160 rose (filled and double plans) | `{components: 2}` | `{components: 2}` |
| Half-size key-plan inset at the right | `{components: 2}` | `{components: 2}` |
| Twin plan side by side | `{components: 2}` | `{components: 2}` |
| Inset hugging the plan (it groups into the plan) | none | none |
| Plan alone | none | none |
| Filled plan with a bold sheet border | none | none |
| Double plan with a bold sheet border | `{2}` | none |
| Brochure | `{3}` | `{2}` |

- The double plan with a bold sheet border is the accepted side effect: the region is the whole page and holds the plan.
- On the brochure, the dropped rival is a strip drawing (box (199, 0, 1081, 1169)): the plan's own double lines merged with the "FLAT-105-505 / 912 SQ.FT" label box above the plan. 87 % of its box lies inside the region, so it no longer counts.
  - The real excluded rival, the key plan at the bottom (box (197, 1324, 1080, 291), outside the region), still warns.
  - The old count of 3 partly counted the plan twice: once as a solid drawing and once through its strips. The new count is the more accurate one.

All my earlier region cases are unchanged from round 3, for both the filled and the double-line plan:
- tables, tiles and hatch (`cc_region.py`);
- uneven title-block and schedule tables (`cc_region2.py`);
- regular n × n double-line plans, with or without a column (`cc_region3.py`);
- rule, frame and border (`cc_region4.py`);
- stipple and poché inside walls, t 14 and t 24 (`cc_region5.py`);
- logos, roses and bold titles (`cc_mass.py`, `cc_mass2.py`).

The one known exception is the huge bold "PLAN" title (30 px stroke). It still takes the region, as it did before 16c; this is the out-of-scope observation from re-review 3.

**Wall-stage cases.** The walls code is unchanged since round 2, and the results are unchanged:
- doors bridge 24 of 24;
- the original `side=-1` test door bridges;
- all bridge negatives stay unbridged (1a–1g, 1b, 1h, 1i, with the same-style control bridged).

## New breakage in the fix diff

**Minor: a dead assertion in a test.** test_preprocess.py, `test_tables_with_uneven_rows_do_not_become_the_plan_region`, gained `if case == "title-block frame": assert ...warnings...`. That test is parametrized over `"title-block"` and `"schedule"`, so the branch never runs.
- It looks copied from `test_a_bold_rule_or_frame_does_not_take_the_region`, where the same branch does run and asserts the frame's warning.
- Fix: delete the branch, or assert the table cases' intended warning, which is none.

## Out-of-scope observations

None new.

## Verdict

**Fix round:** all findings are addressed, with no new Critical or Important breakage.
- R3-1 is fixed.
- The new warning rule causes no harmful regression.
- One Minor remains open: the dead assertion in the uneven-table test.
