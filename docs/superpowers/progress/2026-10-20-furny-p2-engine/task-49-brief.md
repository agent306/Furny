### Task 49: Worker RPC + `useEngineWorker`

**Files:**
- Create: `resources/js/editor/workers/engineRpc.ts`, `resources/js/editor/workers/engine.worker.ts`, `resources/js/editor/shared/useEngineWorker.ts`
- Test: `resources/js/editor/workers/__tests__/engineRpc.test.ts`, `resources/js/editor/shared/__tests__/useEngineWorker.test.ts`

**Spec refs:** `01 §5.5`, `07 §8.10`, `05 §1.1` (file location of `useEngineWorker.ts`)

**Interfaces:**
- Consumes: `@/engine` (`computeBom`, `nestSheets`, `derivePlanGeometry`, `estimateFurniture`); `vue` (`getCurrentScope`, `onScopeDispose`) in the composable only.
- Produces: `EngineRpcMethods` (`computeBom(model, catalog, options)`, `nestSheets(rows, partQty, catalog, options)`, `derivePlanGeometry(doc)`, `estimateFurniture(doc, catalog)`); `RpcRequest { id: number; method; params: unknown[] }`; `RpcResponse = { id; ok: true; result } | { id; ok: false; error: { name: string; message: string } }`; `RpcPort { postMessage(msg: RpcRequest): void; onmessage: ((e: { data: RpcResponse }) => void) | null; terminate?(): void }`; `handleRpcRequest(req): RpcResponse`; `createInlinePort(): RpcPort` (main-thread fallback, answers on a macrotask); `createRpcClient(port): EngineRpcClient & { dispose(): void }`; `class EngineWorkerStaleError extends Error` (`name 'EngineWorkerStaleError'`); `useEngineWorker(): EngineRpcClient & { dispose(): void }` (real `Worker` via `new Worker(new URL('../workers/engine.worker.ts', import.meta.url), { type: 'module' })` when `typeof Worker !== 'undefined'`, else inline port; disposes on scope dispose).

- [ ] **Step 1: Write the failing tests** — `engineRpc.test.ts` (**review focus 5**) with a fake port that queues requests and delivers responses in a test-controlled order: two `estimateFurniture` calls, responses delivered newest-first and oldest-first → the latest resolves with `price.unitPriceMinor 2431300` (wardrobe + seed), the earlier rejects with `EngineWorkerStaleError` and its late response is ignored; concurrent calls of different methods do not cancel each other; a handler exception → rejection with the handler's message; unknown method → `{ ok: false }`; `dispose()` rejects pending calls with `EngineWorkerStaleError` and calls `terminate`; `handleRpcRequest({ id: 1, method: 'derivePlanGeometry', params: [makeRectPlan(5000,4000,230)] })` → `ok: true` with 1 room; `createInlinePort` round-trips. `useEngineWorker.test.ts`: inside `effectScope` with `Worker` undefined the composable uses the inline port and resolves `derivePlanGeometry`; `scope.stop()` disposes (pending call rejects stale).
- [ ] **Step 2: Run it, expect FAIL** — `yarn vitest run resources/js/editor/workers resources/js/editor/shared`
- [ ] **Step 3: Implement** — client keeps `latestIdByMethod`; on response, if `id !== latestIdByMethod[method]` drop it (promise already rejected when superseded); worker file: `self.onmessage = (e) => self.postMessage(handleRpcRequest(e.data))`.
- [ ] **Step 4: Run tests, expect PASS** — same command.
- [ ] **Step 5: Quality gates** — `yarn eslint resources/js/editor && yarn prettier --check resources/js/editor && yarn vue-tsc --noEmit`
- [ ] **Step 6: Commit** — `git add resources/js/editor/workers resources/js/editor/shared/useEngineWorker.ts resources/js/editor/shared/__tests__` → `feat(editor): add engine web worker RPC with stale-request cancellation`

