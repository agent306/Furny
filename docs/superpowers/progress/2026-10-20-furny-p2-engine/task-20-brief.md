### Task 20: Generic command bus

**Files:**
- Create: `resources/js/engine/commands/types.ts`, `resources/js/engine/commands/bus.ts`
- Test: `resources/js/engine/commands/__tests__/bus.test.ts`

**Spec refs:** `04 §6.1–§6.3`, `04 §9` (bus row)

**Interfaces:**
- Consumes: `mutative` (`create`, `apply`, `Draft`, `Patches`), `zod`, `EngineMessage` (Task 8).
- Produces (04 §6.1 plus the pieces it leaves open, pinned here): `CommandDef<D,P,C,R>` with optional `paramsSchema?: z.ZodType<P>` and `labelParams?(params: P): Record<string, string | number>`; `CommandAbort`; `CommandOutput<R>`; `HistoryEntry`; `ExecuteResult<R>`; `BusEvent<D>`; `ExecuteOptions`; `CommandBus<D,C,M>`; `PipelineOutput<D> { doc; patches; inversePatches; result; warnings; deletedIds }`; `Pipeline<D,C> = (doc, def, params, ctx) => Result<PipelineOutput<D>>`; `defaultPipeline` (params zod parse → `invalid_params`, `validate`, single `create(…, { enablePatches: true })`, `CommandAbort` → error); `createCommandBus({ initial, registry, getContext, pipeline?, pathToEntityId, maxHistory = 200, messageKeyPrefix })` (`messageKeyPrefix` e.g. `'engine.plan.command'` builds `invalid_params` keys).

- [ ] **Step 1: Write the failing tests** — test document `{ items: Record<string, { v: number }> }` with test commands `set` (absolute, `mergeKey: p => 'set:' + p.id`, replace), `inc` (relative, `mergeMode: 'compose'`), `abort` (throws `CommandAbort`), `invalid` (validate returns a message), `typed` (`paramsSchema` z.object({ n: z.number().int() })). Cases: execute → doc replaced, entry pushed, `execute` event with `changedIds {'a'}`; validate error / abort / zod failure (`code 'invalid_params'`, `messageKey 'test.invalid_params'`) leave doc and history untouched and emit nothing; undo/redo restore exact docs and return `false` on empty stacks; redo stack cleared by a new execute; **replace merge**: 200 `set` executes with `merge: true` → 1 entry, one undo restores the original (04 §6.8 "200-move drag"); **compose merge**: 10 `inc` merges → 1 entry and undo restores; `seal()` then next `inc` → new entry; a different mergeKey seals automatically; undo/redo seals; `history: false` applies without an entry; transactions: begin → 3 executes (intermediate docs visible) → commit = 1 entry with the transaction label; empty transaction → no entry; nested begin/commit depth; `rollbackTransaction` restores the start doc and emits `rollback`; `transaction(label, fn)` rolls back and rethrows when `fn` throws or when an execute inside fails; merging disabled inside transactions; `reset(doc)` clears both stacks and emits `changedIds {'*'}`; history capped at 200 (execute 205 unmergeable commands → `history().undo.length === 200`); committed documents are frozen in tests (`Object.isFrozen(bus.getDoc())`); `subscribe` returns an unsubscribe function.
- [ ] **Step 2: Run it, expect FAIL** — `yarn vitest run resources/js/engine/commands`
- [ ] **Step 3: Implement** — semantics of 04 §6.2 items 1–7; `replace` merge re-runs the pipeline on `apply(doc, top.inversePatches)`; `changedIds` from `pathToEntityId` over forward patches (inverse for undo); `enableAutoFreeze` true when `import.meta.env?.DEV` or `process.env.VITEST` is set (guard `typeof process !== 'undefined'`).
- [ ] **Step 4: Run tests, expect PASS** — same command.
- [ ] **Step 5: Quality gates** — `yarn eslint resources/js/engine && yarn prettier --check resources/js/engine && yarn vue-tsc --noEmit`
- [ ] **Step 6: Commit** — `git add resources/js/engine/commands resources/js/engine/index.ts` → `feat(engine): add generic undoable command bus on mutative`

