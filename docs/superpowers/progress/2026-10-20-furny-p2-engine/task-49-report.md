# Task 49 report: Worker RPC + useEngineWorker

Status: DONE

## Implemented
- `resources/js/editor/workers/engineRpc.ts`: `EngineRpcMethods`, `RpcRequest/Response/Port`, `EngineWorkerStaleError`, `handleRpcRequest` (never throws; unknown method and handler exceptions give `ok: false`), `createInlinePort` (macrotask; `terminate` clears timers), `createRpcClient` (latest id per method; superseded call rejected stale at call time, late reply dropped; `dispose` rejects pending stale, terminates port; calls after dispose reject stale).
- `resources/js/editor/workers/engine.worker.ts`: `self.onmessage = e => self.postMessage(handleRpcRequest(e.data))`.
- `resources/js/editor/shared/useEngineWorker.ts`: real module `Worker` when `typeof Worker !== 'undefined'`, else inline port; `onScopeDispose(client.dispose)` when in a scope.
- Production code imports only `@/engine` (index).

## TDD
- RED: `yarn vitest run resources/js/editor` -> both files failed `Failed to resolve import "../engineRpc"` / `../useEngineWorker` (2 failed, no tests).
- GREEN: 2 files, 14 tests passed (11 engineRpc, 3 useEngineWorker).

## Gates
- eslint / prettier --check / vue-tsc on `resources/js/editor`: clean.
- `yarn vite build`: ok. App entry does not reach the composable yet, so also built a throwaway config (deleted, outside repo output) with `useEngineWorker.ts` as input: emitted `engine.worker-*.js` 408 kB, so the worker bundles.
- Full `yarn vitest run`: 208 files, 5198 tests, 0 failures. `yarn lint` exit 0, `yarn typecheck` exit 0, `yarn format:check` clean.

## Deviations / decisions
- `engineRpc.test.ts` reads the wardrobe fixture JSON via `readFileSync(resolve(...))` + `FurnitureDocumentSchema` instead of `wardrobeFixture()`: that helper uses a `file:` URL that happy-dom's URL rejects (editor tests run in the `app` project/happy-dom). Fixture content is identical (unitPriceMinor 2431300 asserted).
- Test fixtures use `vi.stubGlobal('Worker', undefined)` per carry I10; extra test covers the real-Worker branch with a stubbed constructor (module type, terminate on scope stop).
- `RpcRequest.method` typed `keyof EngineRpcMethods`; `Map` params (nestSheets partQty) rely on structured clone.

## Concerns
- None blocking. `useEngineWorker` is not yet imported by app code, so the worker chunk only appears once an editor page uses it.

## Fix round 1

Changes (`engineRpc.ts`, `useEngineWorker.ts`):
1. `RpcPort` gains optional `onerror` / `onmessageerror`; `createRpcClient` wires both (the real `Worker` is the port, so assigning them wires the real events). New `EngineWorkerError` (name `EngineWorkerError`, fixed non-sensitive messages; the worker's own error text is not forwarded). Both events reject every pending call and clear `pending` and `latestIdByMethod`.
   - Decision: `error` is fatal. Later calls reject immediately with `EngineWorkerError` and nothing is posted; a new `useEngineWorker()` is needed. `messageerror` is not fatal: the worker is alive and one reply was lost, but the lost reply's caller is unknown, so all pending calls fail and the client keeps working. `dispose` also detaches both handlers.
2. `port.postMessage` is wrapped in try/catch: on a synchronous throw (DataCloneError) the `pending` and `latestIdByMethod` entries are deleted and the call rejects with the thrown error.
3. JSDoc on `useEngineWorker` documents `EngineWorkerStaleError` (callers must handle it), `EngineWorkerError` and the fatal-error behaviour.

Tests added (engineRpc: 5, useEngineWorker: 1):
- error rejects all pending; error is fatal (nothing posted); messageerror rejects pending and the client stays usable; a late reply after failure is ignored; sync postMessage throw rejects and a later call still works; stubbed Worker `onerror` rejects the pending call with `EngineWorkerError`.
- Caveat: the sync-throw test passes before the fix too, since the Promise executor already turns a throw into a rejection. The leaked map entries it fixes are not observable through the public API, so the test guards the rejection and the follow-up call only.

RED (before implementation, `yarn vitest run resources/js/editor`): 5 failed (error/messageerror tests timed out at 5000 ms because the promises never settled; the useEngineWorker wiring test failed with `instances[0].onerror is not a function`), 15 passed.
GREEN: `yarn vitest run resources/js/editor` -> 2 files, 20 tests passed. `yarn eslint resources/js/editor` clean; `yarn prettier --check resources/js/editor` clean; `yarn vue-tsc --noEmit` exit 0.
