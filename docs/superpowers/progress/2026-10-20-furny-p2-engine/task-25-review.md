# Task 25 review: opening commands (29365d4..baa9c3f)

### Spec Compliance

- Spec compliant against brief and 04 §6.6, with the already-decided ruling 1 (height reduction for every kind) outstanding. All six commands are registered, with the right labelKeys, schemas, `touchesGeometry`, and merge keys `moveOpening:{id}` / `resizeOpening:{id}` in replace mode. Defaults, labels D1/D2/W1/null, type_mismatch, no_fit, overlap, too_tall, keep start/end/center, setOpeningProps kind defaults, flip both, label 17 chars -> out_of_range and undo deep-equal are all present and tested.
- Cannot verify from the diff: the file header (openings.ts:14) says the rulings are "logged in spec 19", but this diff does not touch `19-reconciliation-log.md` and the log has no opening entry. The controller should add the entries (or the comment should say "to be logged").

### Strengths

- One planner per command, shared by `validate` and `run` (openings.ts `planAdd`, `planMove`, `planResize`, `planProps`). The two phases cannot disagree.
- Bounds tolerance (1e-6) matches `validatePlan` `BOUNDS_TOL` (validate.ts:57) and reuses the exported `overlaps` from helpers. The commands therefore cannot create a `validatePlan` bounds or overlap error.
- Ruling 2 is implemented cleanly. The height rule is judged only on a height, sill or wall change. The "already too tall" test shows move, flip, label and delete still work and undo is deep-equal.
- Duplicate ids are de-duplicated with `uniqueSorted`, so `flipOpening [a,a]` does not double-flip (tested).
- Tests assert exact values, use the shared graph fixtures, and `expectRefusedUntouched` checks document identity and history count on every refusal.
- `uniqueSorted` moved into validators.ts and walls.ts updated to import it, with no duplication.

### Mutation check

Scratch copy at `/tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/mut`. The worktree was not touched. 35 mutants run, 31 killed, 4 survived (3 equivalent, 1 real test gap).

- no_fit: lower bound removed, upper bound removed. Both killed (3 tests each).
- overlap: check skipped, self not excluded, other walls included. All killed.
- type_mismatch: always passes (add), and setOpeningProps check removed. Both killed.
- too_tall: `room<300` removed, refuse branch removed, reduce removed, moveOpening check removed, and moveOpening check applied on the same wall. All killed.
- keep modes: start wrong, end wrong, end sign flipped, center shifted, offset rounding removed. All killed.
- Others killed: label prefix, label range, capacity, flip-both, flip duplicate ids, window sill default, setProps kind-default type and height, setProps reduce/refuse selection, setProps height-check gating, label check dropped in add and in setProps, and the resize bounds gate.
- Survivors:
  0. `setProps` type check gated on `props.type === undefined` only is equivalent, because a kind change always supplies a matching default type.
  1. `at.offset <= half - SLACK` is an equivalent mutant, because offsets are integers.
  2. Unconditional `opening.offset = plan.offset` in run is an equivalent mutant. Mutative emits no patch for a same-value assignment (checked directly: `[]`). See Minor 1.
  3. `planResize` running `fitHeight` unconditionally survives. This is a real test gap. See Minor 2.

### Issues

#### Critical (Must Fix)
None.

#### Important (Should Fix)
None beyond ruling 1. When ruling 1 is narrowed, note that it has two sites:
- `addOpening` at openings.ts:317 (`'reduce'` for every kind).
- `setOpeningProps` at openings.ts:553, where a door switched to a low wall silently shortens too.

Narrow both, and the header comment at lines 14-22. The test "reduces an explicit height too, and a door on a low wall" and "a kind default that reaches over a low wall is reduced" encode the wrong behaviour. The second is a window case and stays valid.

#### Minor (Nice to Have)
1. openings.ts:412-413, 485-489, 592-600. The `if (x !== y) x = y` guards in `run` are redundant, because mutative already drops same-value writes. They add about 25 lines, and the header (lines 3-6) credits them for the no-op entry drop. Either remove them or fix the comment. The no-op tests pass without them.
2. Test gap: no test resizes (width or offset only) an opening that is already too tall. The ruling-2 test covers only move, flip, label and delete. Mutant "unconditional height check in `planResize`" survives. Add one resize case to the "already too tall" describe.
3. openings.ts:72. `SLACK` duplicates `BOUNDS_TOL` in validate.ts:57. Export one constant so the command and `validatePlan` cannot drift.
4. openings.ts:306. `doc as Draft<PlanDocument>` casts a `Pick` to the full draft type to call `nextOpeningLabel`. It is harmless, since the function reads only `openings`, but it is a type lie. Widen the parameter type of `nextOpeningLabel` to `Pick<PlanDocument,'openings'>`.
5. openings.ts:203. Label length uses UTF-16 `.length`, so one emoji counts as 2. Spec says "chars". Low risk, mention only.
6. openings.ts:~420-440 (`planResize`). A missing wall silently skips the checks (`wall !== undefined`). On a valid doc this never happens. No test.
7. Test gap: refusal of a kind change whose room above the sill is under 300 (`setOpeningProps`, too_tall via `room < 300`) is untested.

### Assessment

**Task quality:** Approved, after the decided ruling-1 narrowing, which must cover both `addOpening` and `setOpeningProps`.

**Reasoning:** The implementation matches 04 §6.6 and `validatePlan` tolerances. The key refusals and keep modes are killed by tests under mutation. The remaining findings are minor.
