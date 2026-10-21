# Task 14b re-review 1 (fix round 1: 36b0753..12a2298)

**Verdict: APPROVED.** Every finding from the first review is addressed. The fix introduces no Critical or Important breakage. Three new Minor issues are listed below; none blocks the task.

**Scope.** I reviewed read-only, from `review-36b0753..12a2298.diff`. Every run used an exported copy of 12a2298 (`git archive`), in `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/rv14b-fr1/`. Task 16c (at 36b0753) is not under review here.

**What I ran:**
- My first-round counter-cases (`tests/test_rv_counter.py`, copied into the export): **26 of 26 pass**. These include c1b, c1c, c2b and the controls c1d and c2c.
- New counter-cases (`tests/test_rv_fr1.py`): **8 of 11 pass**. The three failures are N1 and two cases of N2.
- The reference metrics, recomputed with `run_chain` (`rv14b-tools/metrics_fr1.py`). The report's metrics table is confirmed below.
- My truth tools (profile, end and tick checks), re-run on the three corrected truth lines.

I did not re-run the full suite. The report names its covering tests and gives their output: `uv run pytest -q` → 799 passed, 1 skipped, 1 xfailed.

## Finding verdicts

**I1 (labels are owned only on the baseline side, so stacked chains lose their labels) — ADDRESSED**
- `dimensions.py:97-196` (`_Labels.owners`) now picks the nearest line on either side.
- Stacked lines within 2 text heights contest the label. The contest is decided, in order, by:
  - (a) the line whose ticks bracket the label;
  - (b) scale fit;
  - (c) the marks on the bracketing ticks;
  - (d) which line has no label of its own;
  - (e) distance.
- All my counter-cases now pass: c1b; c1c with gaps 30/40/50; c2b with gaps 30/40/50; the controls c1d and c2c; c1a and c2a.
- An extra case also passes: an inner chain [300, 900, 1500] with an outer *overall* line [300, 1500], labels 15 px below or above the line, gaps 25/30/40, at all 6 phases with jitter. Both lines are kept, and T1 goes to the chain and T3 to the overall line.
- The implementer's phase-robust versions are in `test_dimensions.py`.
- **For the controller:** rules (c) and (d) go beyond your ruling, which named only (a), (b) and nearest. The report justifies them with c1b (the label is at the same distance from both lines) and with the fix2 stacked control at gap 25. I find both justifications sound.

**M1 (metrics blind to ticks; wrong 11000 span) — ADDRESSED**

`reference.py` gains tick recall and precision. I recomputed both, and the 11000 label's span:

| Metric | Measured | Target |
|---|---|---|
| Tick recall | 0.985 (1 of 68 missed: i3500@0) | ≥ 0.85 |
| Tick precision | 0.932 (5 of 74 false: L7@0, L10@0, L16@108, L17@-2, L17@457) | ≥ 0.90 |
| 11000 label span | (235.5, 77.7)–(1725.9, 49.2) | within 0.5 % L of the ticks |

- The 11000 span's ends are within 2.8 px of the traced ticks at (236.9, 80.1) and (1724.2, 47.7); the tolerance is 8.5 px.
- The stray 7000 fragment (L15) is gone.
- Two door-jamb ticks are gone: 3600's at 719 and 790, and 3100's at 509. One remains: 3100's at 434, reported as L16@108.
- The new tests `test_hdb_tick_positions` and `test_hdb_overall_label_goes_to_the_overall_line` encode the targets.
- **Nit:** the report says "1 of 66" ticks missed; the denominator is 68.

**M2 (stale docstring references) — ADDRESSED**
- `region.py` annotation docstring and `dimension_candidates.py:147,205` are corrected.
- A grep of `app/` finds no remaining `_Evidence` or `segments.in_region`.

**M3 (`extract_walls(tokens=…)` unused) — ADDRESSED**
- At 12a2298, `walls.py` no longer has the `tokens` parameter (removed by 16c). Its docstring (around `walls.py:1200`) says no rule reads OCR tokens.

**M4 (`seconds` in the fixture) — ADDRESSED**
- `record_ocr` now logs the time instead of writing it. The `seconds` field is gone from both `*.ocr.json` fixtures; a grep finds none.

**M5 (wrong direction in the report) — ADDRESSED**
- Corrected in the "Fix round 1" section. The baseline-side rule it described is gone anyway.

**T1 (i3100-bed1 end and tick inside the wall) — ADDRESSED**
- p1 and tick[1] are now at x 640.5, the wall face (gray row 454: the wall spans x 641–658).
- Profile offsets are 0.00 / 0.01 / 0.00.

**T2 (bottom tick[0] off the extension line) — ADDRESSED**
- bottom tick[0] = 6.7, i.e. x 143.2. bottom-overall tick[0] = 6.1, i.e. x 142.6.
- Both now sit on the extension lines; my tick check gives +0.0 / +0.2 px.

**T3 (bottom ends inside the stroke) — ADDRESSED**
- Both lines now run from 136.5 to 1132.6.
- My end check finds the ink starting at +0.0 / −1.0 px and ending at +0.9 / −0.1 px.
- Profile offsets are ≤ 0.47 px, and p90 is ≤ 0.95 px.

## Metrics confirmed (12a2298, scratch run)

| Metric | Value |
|---|---|
| HDB dimension recall | 0.833 (unmatched: left, left-overall, i600, i400) |
| HDB dimension precision | 1.000 (21 lines) |
| Intervals | 0.979 (missed: i3500#0) |
| Labels | 0.923 |
| Tick recall / precision | 0.985 / 0.932 |
| HDB walls R / P | 0.8920 / 0.9628 |
| Brochure walls R / P | 0.9117 / 0.8650 |
| Brochure dimension lines | 0 |
| Dimensions stage | 0.31 s / 0.00 s |
| Non-OCR chain | 1.6 s / 0.7 s |

All of these match the report's table.

## New breakage in the fix diff

**N1 — Minor (the cost of your accepted deviation): genuinely crossing chains lose a shared tick.**
- **Where:** `dimensions.py:229` (`_drop_crossings`).
- **What happens:** I built a horizontal chain with 4 ticks [300, 750, 1200, 1650] and a vertical chain with 3 ticks [300, 600, 900], crossing at (750, 600). One slash at the crossing serves both lines, and each line has its own labels. The vertical chain loses its middle tick and comes back as `[300, 900]`. Its two 3000 intervals merge into a single span that lists both labels.
  - With 3 ticks against 3, both chains keep the tick, because the rule then requires "more ticks".
  - Test: `test_rv_fr1.py::test_crossing_chains_share_a_slash[h_ticks0]`.
- **Narrowing that would keep HDB's fix:** drop the marked tick only when the crossing lies at an *end* of this line (within the dedupe gap of p0 or p1). That is the extension-line geometry: the x ≈ 821 line ends about 8 px past the top chain. Two genuinely crossing chains meet in the interior of both.

**N2 — Minor (regression against c495a09): a chain dimensioned to a wall face loses that end tick when its last interval is short.**
- **Where:** `dimension_ticks.py:688-697`. The "end extra" rule drops *any* tick within 0.015 L beyond the outermost mark, including `WALL` ticks.
- **Why it matters:** a `WALL` tick is the Task 14b tick kind for "slash merged into the wall the line ends at". So a short last interval up to a wall face, such as a wall-thickness interval or a 150–300 mm dimension to a wall, loses its end tick.
- **Test:** `test_rv_fr1.py::test_short_last_interval_to_a_wall_face`, a slash chain [300, 750, 1200] ending at a solid wall `last_gap` px past the last slash, where 0.015 L = 36 px.

  | last_gap | 12a2298 | c495a09 (old head) |
  |---|---|---|
  | 20 px | FAIL: `[300, 750, 1200]` | pass |
  | 30 px | FAIL: `[300, 750, 1200]` | pass |
  | 50 px | pass | pass |

- **Fix:** exempt `WALL` ticks from the end-extra filter, as the jamb rule already does, or limit the filter to `BAR`/`THROUGH` strokes. Then re-check the HDB tick precision.

**N3 — Minor: `_draw_pieces` can stop short of the line's end.**
- **Where:** `dimension_ticks.py:502`. `pts[::4]` subsamples the centre polyline without keeping its last point, so the drawn stroke can end up to 3 px short of `length + slack`.
- **Fix:** append the final point after subsampling.

## Out-of-scope observations

None.
