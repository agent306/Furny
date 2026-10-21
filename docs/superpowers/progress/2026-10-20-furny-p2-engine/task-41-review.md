# Task 41 review: furniture builder commands (012b8e4..e1433bf)

Reviewed from the diff package `review-012b8e4..e1433bf.diff` (read in one pass, sources first, then tests). Code outside the diff was read only for named risks (listed under "Checks run"). Empirical probes and mutations ran in a scratch copy, which has since been deleted. The worktree was not touched apart from writing this file.

## Spec Compliance

- ✅ Spec compliant (07 §9, 07 §12.5, 04 §6.1–§6.2, brief Produces list and Step 1 test list).
  - All 28 commands are registered as `furniture.<name>`, each with a zod `paramsSchema`, a `labelKey` of the form `engine.furniture.command.label.<snake>`, `mergeMode 'replace'` and `touchesGeometry false` (`helpers.ts:28-35`, `registry.ts:30-39`). `registry.test.ts:62-127` pins the 28 keys, the label keys and the exact mergeKey table.
  - Only the commands that 07 §9 marks as mergeable have a mergeKey. No id-creating command (`addFront`, `splitSection`, `insertChild`, `addExtraPart`, `addExtraHardware`) has one, so the runState id replay is never needed (controller ruling met).
  - Only `setDims` clamps (`dims.ts:33-50`). Every other bound refuses with `out_of_range {field,min,max}`, for example `sections.ts:137-141` and `construction.ts:84-93` (controller ruling met).
  - `furniturePipeline` runs `defaultPipeline` and then `FurnitureDocumentSchema.safeParse`, and returns `invalid_document` with no state change (`pipeline.ts:56-71`). This is tested with the brief's `dims.width = 1.5` command.
  - `syncBehindDoor` runs after `splitSection`, `removeChild`, `mergeSections`, `setContent`, `addFront`, `updateFront` and `removeFront`.
  - Each item in the brief's Step 1 test list has a matching test. Every file the brief names is present. The extra `helpers.ts`, `testing/commands.ts` and the `construction`, `notes` and `registry` tests are reasonable support.
- Accepted rulings, verified against the code: the `drag` flag selects the merge key (`sections.ts:277-280`). `removeChild` down to one child renames the child into the parent and fronts follow it (`sections.ts:355-379`). Wrong-family commands are refused with `not_found {id:'carcass'|'table'}`. Override `patch` replaces the override (`overrides.ts:51-59`). `setTable` does not couple depth to width. The invented bounds match the report.
- ⚠️ Cannot verify from the diff: the never-under-report property under multi-step sequences depends on how P4 interprets a section id (see I1). The controller should rule on the contract before P4 builds its revision map.

## Strengths

- The no-op discipline is solid. `assign`, `mergeFields` and `mergeDeep` skip equal values (`helpers.ts:109-177`), so an unchanged command leaves no entry, and a merged burst that returns to its start drops its entry. Tests pin this (`notes.test.ts:23-31`, `dims.test.ts:115-122`, `overrides.test.ts:70-79`).
- `snapshot` deep-copies with `current` plus `structuredClone`, which fixes the committed-document mutation the implementer found. A mutation that removes the clone is caught by the suite.
- `rewireFronts` iterates from the end, so splices never shift indices that are still to be visited. I probed a single-command case where a shifted sibling changes inside `removeChild`: undo and redo restored the documents exactly, and the length patch contributed `'*'`.
- `roundTrip` (`testing/commands.ts:105-125`) holds every command to apply, then undo deep-equal, then redo deep-equal. `registry.test.ts:361-638` checks `changedIds` for all 28 commands.
- Validation refuses unknown sections, empty `covers` and unknown front or extra ids before `run`. After `run`, the schema check catches any wrongly typed field that is left.

## Issues

### Critical (Must Fix)

None.

### Important (Should Fix)

**I1. `furniturePathToEntityId` mis-attributes section changes in multi-step sequences: the changed section is not reported and a wrong sibling is reported instead.** `registry.ts:67-106` (the loop at `:92-104`) and the binding `registry.ts:140` (`furniturePathToEntityId(path, bus.getDoc())`).
- The report claims that `bus.getDoc()` "is the document the patches apply to", and that the failure mode is "over-reporting ('*'), never silence". Neither claim holds for `commitTransaction` (forward patches of every step are resolved against the *final* doc), for redo of a transaction, or for undo of a transaction (the inverse patches of earlier steps are resolved against the pre-undo doc).
- Fronts and extras are safe, because any length change emits `'*'`. Section arrays report only the parent, so a deeper path walks the wrong child.
- Reproduced:
  ```
  bus.transaction('x', () => {
    setContent({ sectionId: 's_5' /* rows.children[1] */, content: { type: 'empty' } });
    insertChild({ parentId: 's_3', index: 0 });
  });
  // commit changedIds = { s_4, s_3 }; undo changedIds = { s_3, s_4 }
  ```
  `s_5`'s content changed, and `s_5` exists before and after, but it is never reported. `s_4` (unchanged) is reported in its place.
- The property survives only if a reported section id is read as "this section and its whole subtree". That holds here because a structural change at depth k always reports the true ancestor. That contract is not stated anywhere: the doc comment says that `children[i].size` belongs to the child, which invites a per-id reading. 05 §3.3's per-id revision map with `v-memo` would show stale content for `s_5`.
- Fix: state the subtree contract in the `furniturePathToEntityId` doc comment and in the report or ledger. Correct the "never silence" claim. Add a transaction or undo test that pins the subtree reading, using the scenario above. Alternatively, have the bus resolve paths per step (outside this task).

**I2. The behindDoor sync in `mergeSections` is untested, so removing it leaves every test green.** `sections.ts:422`.
- Mutation: I deleted the `syncBehindDoor(d)` call in `mergeSections`, and all 135 tests still pass.
- The rule matters in practice. Probe: rows `s_3` = [`s_4` drawers `behindDoor:false`, uncovered; `s_5` covered by `fr_2`]. `mergeSections(s_3)` correctly gives `s_3` drawers with `behindDoor:true`. Without the sync it stays `false`, which produces a `furniture.drawers_forced_behind_door` warning and the wrong drawer geometry (07 §3.12).
- This is the controller's "syncBehindDoor after front/content changes" rule, and the `sections.test.ts:498-562` block never uses drawers.
- Fix: add that case to the mergeSections tests.
- The `removeChild` sync (`sections.ts:380`) also survives deletion. It is a no-op for consistent documents, so a test there is optional.

### Minor (Nice to Have)

**M1. Spec-inherited merge hazard: a `replace` merge of partial params silently drops earlier fields.** `dims.ts:56`, `construction.ts:106` (plinth), `fronts.ts:78`, `table.ts:55`, `overrides.ts:116,195`.
- 04 §6.2 re-runs only the latest params on the base document. Probes:
  - `setDims {width:2000}` followed by `setDims {height:1800}` with `merge:true` ends at width 1800 (the original); the width edit is lost.
  - `updateFront {overlay:'half'}` followed by `{glass:true}` merged ends with overlay `'full'`.
- This is safe only if the editor seals between fields (07 §9 says that text inputs seal on blur).
- Ledger for P4. Alternatively, accumulate the burst's params through `runState` (the pipeline is handed `top.runState` on a replace re-run), or add a test that pins the current behaviour.

**M2. The `content` atomic rule of `setTable` is untested, and the schema gate cannot catch it.** `table.ts:47`, `table.test.ts:30-62`.
- Emptying `ATOMIC` leaves all tests green. The "replaces arrays" test switches drawers to drawers, so merge and replace give the same result. TableSpec has no arrays outside `content`, so the array rule is never really exercised.
- Without `ATOMIC`, switching an end cabinet from drawers to shelves gives `{type:'shelves', frontHeights, slideCode, behindDoor, adjustable, …}` and the command still succeeds. `furniturePipeline` keeps the unparsed doc, and zod's default object mode strips unknown keys rather than rejecting them (`pipeline.ts:61-62`).
- Fix: test a content type switch. Optionally make the pipeline compare against `parsed.data`, or use strict schemas, so that stray keys are refused.

**M3. `setPlinth {height:120}` on a `type:'none'` plinth stores height 120.** `construction.ts:95-105` applies "none → height 0" only when the params carry `type:'none'`, not when the resulting type is `none`. Probe: `setMounting 'wall'` then `setPlinth {height:120}` gives `{type:'none', height:120}`. The generator ignores it (`carcass/envelope.ts:139`), but the document is denormalised and creates diff noise. Fix: `if (plinth.type === 'none') plinth.height = 0`.

**M4. `syncBehindDoor` normalises every drawers leaf in the document.** `sections.ts:74-91`. Probe: `updateFront {glass:true}` on `fr_1` flipped an unrelated uncovered `s_5` drawers `behindDoor:true` to `false`. That state ("internal drawer boxes, no visible front", 03 §2) can only come from a loaded or template document, because `setContent` forces it. 07 §9's `removeFront` says "previously covered drawers". This is reported as ruling #11; ledger it.

**M5. `mergeSections` deletes the later front even when it also covers sections outside the merged one.** `sections.ts:411-421`. Probe: `fr_1` covers [`s_4`] and `fr_2` covers [`s_5`, `s_2`]. After `mergeSections(s_3)`, `fr_2` is deleted, so `s_2` silently loses its door. This is literal 07 §9 ("the later one is deleted"); dropping only `sectionId` from the later front would keep `s_2`'s door. Ledger it.

**M6. `addFront` and `updateFront` accept duplicate ids within `covers`, and fronts that overlap existing ones.** `fronts.ts:18-20`. Probe: `addFront covers:[s_2, s_2]` over `fr_1`'s `s_2` succeeds. `validateFurniture` then reports `front_overlap` (save-blocking), so this is caught downstream, but deduplicating `covers` in the command costs nothing.

**M7. No test covers `changedIds` for undo, redo, merges or transactions.** `registry.test.ts:361-638` checks only the forward `execute`. See I1.

**M8. `setChildSize` and `insertChild` can produce `fixed_sizes_exceed`.** Probe: two fixed 6000 mm children. `validateFurniture` reports it (save-blocking). This is consistent with the "validator, not command" split, and no change is needed beyond noting it for the ledger.

## Checks run

- **Bus integration.** Risk: the `pathToEntityId` doc binding and replace or runState. I read `engine/commands/bus.ts` (execute, merge, step, commit and rollback) and `types.ts` (Pipeline and runState). `idsOf` runs before `doc` is replaced in execute, merge and step, which is correct for single commands. In commit, forward patches are resolved against the final doc (I1). `furniturePipeline` drops `runState`, which is harmless because no id-creating command is mergeable.
- **behindDoor semantics.** Risk: `syncBehindDoor` diverging from the generator. I read `carcass/envelope.ts::coveringFront` and the 07 §3.12 text. Both use the same "self or ancestor" test.
- **Invariants.** Risk: commands producing documents the validator rejects. I read `validate.ts::treeIssues` and `SAVE_BLOCKING_CODES`. Probes covered `front_overlap` and `fixed_sizes_exceed`. Removing a child down to 0 or 1 children is handled.
- **TableSpec.** Risk: `SetTableSchema` not being a real DeepPartial. I read `schema.ts:188-221`. All nested objects are partial (`top`, `base`, `apron`, `drawers`, `endCabinets`).
- **Probes (scratch copy).** Transaction commit and undo `changedIds` (I1); the shifted-sibling single command (fine); M1, M3, M4, M5, M6 and M8 as described above.
- **Mutations** (`vitest run resources/js/engine/furniture/commands`, 135 tests):

  | Mutation | Result |
  |---|---|
  | Drop `syncBehindDoor` in `mergeSections` | survives (I2) |
  | Drop `syncBehindDoor` in `removeChild` | survives (no-op in practice) |
  | Empty `ATOMIC` in `setTable` | survives (M2) |
  | Remove `structuredClone` from `snapshot` | killed |

## Assessment

**Spec:** ✅

**Task quality:** NEEDS FIXES

**Reasoning:** The commands follow 07 §9 and the controller's rulings, and undo, redo and merge are correct for single commands. However, the never-under-report property of `furniturePathToEntityId` fails for multi-step sequences: a wrong sibling is reported. The report's "never silence" claim is wrong, and the subtree contract that would make it true is not stated. The `mergeSections` behindDoor sync is untested, so removing it would go unnoticed.

---

# Re-review 1 (fix round 1: e1433bf..6b7aba3)

Scope: the findings above and the fix diff (`review-e1433bf..6b7aba3.diff`, read once). The fix report ("Fix round 1" in `task-41-report.md`) names the covering tests and gives RED/GREEN evidence. I re-ran the I1 reproduction and three mutations in a scratch copy under `rv41`, which has since been deleted.

## Finding Verdicts

- **I1: `furniturePathToEntityId` mis-attributed section changes across multi-patch sequences.** ADDRESSED.
  - The bus has a new optional `entityIdsOf(base, patches)` (`commands/types.ts:257`). `idsOf(base, …)` (`commands/bus.ts:214`) is now called with the document the patches apply to:
    - `doc` for execute, compose merge, undo, redo and rollback;
    - `doc` for a replace merge, whose patches are `[top.inversePatches, out.patches]` and so start at `doc`;
    - `start.doc` for commit.
  - All five `idsOf` call sites were updated.
  - `furnitureEntityIdsOf` (`registry.ts:128-143`) walks the patches in order, applying each indexed patch before it reads the next one. This matches the controller ruling.
  - The subtree contract is now in the doc comment (`registry.ts:93-101`).
  - Re-run of my reproduction (transaction `setContent(s_5)` then `insertChild(s_3, 0)`): commit `{s_5, s_3}`, undo `{s_3, s_5}`, redo `{s_5, s_3}`. `s_4` is no longer misreported.
  - The tests cover commit, undo, redo, rollback and a replace-merge drag (`registry.test.ts:641-745`). The generic bus test (`commands/__tests__/entityIdsOf.test.ts`) pins the base document for each event.
  - Mutation: removing the per-patch `apply` in `furnitureEntityIdsOf` makes 2 tests fail. The plan bus is unaffected (the option is absent, so the old path is kept).
- **I2: the `mergeSections` behindDoor sync was untested.** ADDRESSED. `sections.test.ts:564-592` covers drawers in `s_4` with the door only on `s_5`: after the merge the drawers are `behindDoor:true`, plus the converse with no door. Mutation: deleting `syncBehindDoor(d)` in `mergeSections` makes 2 tests fail.
- **M1: a replace merge of partial params drops earlier fields.** Declined as a code change and pinned (`dims.test.ts:104-132`). I accept the decline: this behaviour is inherited from 04 §6.2 and 07 §9 (the editor seals on blur or pointer-up), and the test now documents it. It stays on the ledger for P4.
- **M2: the `content` atomic rule of `setTable` was untested.** ADDRESSED. `table.test.ts:64-80` switches drawers to shelves and expects the shelves content exactly. Mutation: emptying `ATOMIC` makes 1 test fail. The point that the pipeline does not refuse stray keys is still open and is ledgered.
- **M3: `setPlinth` kept a height on a `none` plinth.** ADDRESSED (`construction.ts:103`, test at `construction.test.ts:59-69`).
- **M4: `syncBehindDoor` normalises every drawers leaf.** Declined. I accept the decline as Minor and ledgered: 07 §9 `setContent` ("iff covered") makes behindDoor equal to coverage, so only loaded or template documents can hold the other state.
- **M5: `mergeSections` deletes the later front even when it also covers sections outside the merge.** Declined ("literal 07 §9"). NOT ACCEPTED. It is upgraded to **Important** per the controller instruction, because it can leave other sections uncovered.
  - Probe on the wardrobe fixture: `splitSection(s_4, rows, 2)` gives `s_6` and `s_7`. Then `fr_3` covers `[s_6]` and the later `fr_4` covers `[s_7, s_5]`. The input has no error issues.
  - `mergeSections(s_4)` then renames `s_7` to `s_4`. `fr_4` becomes `[s_4, s_5]` and, as the later of two fronts on `s_4`, is deleted.
  - Result: `s_5`, which is outside the merged section, silently loses its door. The output passes validateFurniture (no errors) and zod, so nothing flags the loss.
  - When the pair front comes first, it survives as `[s_4, s_5]`, which is fine. The outcome therefore depends on array order.
  - I found no case with a valid input that leads to a rejected document. Inputs that would (a front spanning a full-height column divider) are already `front_not_rectangle`.
  - Fix: when the later front covers other sections, remove only `sectionId` from its `covers` (and delete it only if `covers` becomes empty), or keep the front whose `covers` extends beyond the merged section. Then ledger the deviation from the literal 07 §9 text. Location: `sections.ts:411-421` (unchanged by the fix).
- **M6: duplicate ids within `covers`.** ADDRESSED (`fronts.ts:44`, `fronts.ts:77-82`, tests at `fronts.test.ts:67-73` and `:132-138`).
- **M7: no `changedIds` tests for undo, redo, merge or transaction.** ADDRESSED by the I1 tests.
- **M8: `fixed_sizes_exceed` can be produced by `setChildSize` and `insertChild`.** Declined. I accept this: the validator reports it as save-blocking, as intended.

## New Breakage in the Fix Diff

- **Minor:** `registry.ts:114-118` (`indexed`) applies only patches whose path is under `carcass.interior`, `carcass.fronts` or `overrides.extra*`.
  - A patch that replaces an ancestor wholesale (`['carcass']`, `['overrides']`) is not applied, so later indexed patches in the same list would be read against a stale document.
  - No current command emits such a patch, so this is latent.
  - Fix: also apply patches whose path is a strict prefix of an indexed root (length ≤ 2 under `carcass` or `overrides`).

## Out-of-Scope Observations

None.

## Verdict

**Spec:** ✅

**Fix round:** Findings remain open: M5, upgraded to Important. Everything else is addressed or accepted as declined, and no Critical or Important breakage was introduced.

**Task quality:** NEEDS FIXES (M5 only).

---

# Re-review 2 (fix round 2: 6b7aba3..3e9a95a)

Scope: M5 (Important) and the Minor in the `registry.ts` `indexed` filter, both reported in Re-review 1, plus the fix diff (`review-6b7aba3..3e9a95a.diff`, read once). Probes and a mutation ran in a scratch copy under `rv41`, which has since been deleted.

## Finding Verdicts

- **M5 (Important): `mergeSections` deleted a later front that also covered sections outside the merge.** ADDRESSED.
  - Code: `sections.ts:411-425`. For each later front that covers the merged section, only `section.id` is filtered out of its `covers`. The front is spliced, and recorded in `deletedIds`, only when nothing is left; otherwise `assign` writes the reduced `covers`. `syncBehindDoor` still runs afterwards. This matches the ruling.
  - Re-run of my reproduction, in both front orders. Starting document: `s_4` split into `s_6` and `s_7`, a single front on `[s_6]`, a pair front on `[s_7, s_5]`; no error issues.

    | Order | Fronts after `mergeSections(s_4)` | `changedIds` | `deletedIds` |
    |---|---|---|---|
    | Pair first | `fr_3 [s_4, s_5]` (the single `fr_4` became empty and was deleted) | `fr_3`, `*`, `s_4` | `s_6`, `s_7`, `fr_4` |
    | Pair last | `fr_3 [s_4]`, `fr_4 [s_5]` | `fr_3`, `fr_4`, `s_4` | `s_6`, `s_7` |

    In both orders `s_5` keeps its door. There are no `validateFurniture` errors, zod passes, and undo restores the original exactly.
  - Tests: `sections.test.ts:594-678` covers both orders through `it.each` (each section covered once, `changedIds`, `deletedIds`, undo), plus a document-level case.
  - Mutation: forcing whole-front deletion again (`if (true || rest.length === 0)`) makes 2 tests fail.
- **Minor: `registry.ts` `indexed` skipped ancestor-replacing patches.** ADDRESSED. `registry.ts:208-218` now also applies `[]`, `['carcass']` and `['overrides']` patches. `registry.test.ts:738-753` pins it with a `['carcass']` replace that has reversed fronts, followed by `fronts[0].overlay`, which gives `{'*', fr_2}`.

## New Breakage in the Fix Diff

None. I checked whether removing only the merged id could leave a later front's remaining `covers` non-rectangular or overlapping. For a valid input it cannot:
- A front that covers part of the merged section and also reaches outside it must touch the outside sections across the parent's full-span divider. Removing the merged part therefore leaves a contiguous run of sibling sections.
- The first front keeps the merged section alone, so the two fronts do not overlap.

The probes above give `[]` errors in both orders.

## Out-of-Scope Observations

None.

## Verdict

**Spec:** ✅

**Fix round:** All findings addressed, no new Critical or Important breakage.

**Task quality:** APPROVED. The 07 §9 deviation in M5 is ledgered by the implementer for spec 19.
