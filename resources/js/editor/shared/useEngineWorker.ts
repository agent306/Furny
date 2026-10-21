import { getCurrentScope, onScopeDispose } from 'vue';
import {
    createInlinePort,
    createRpcClient,
    type EngineRpcClient,
    type RpcPort,
} from '../workers/engineRpc';

/**
 * Promise-based engine calls off the main thread (01 §5.5). Only the latest call per method
 * resolves.
 * - A superseded call (and any call pending when the scope is disposed) rejects with
 *   `EngineWorkerStaleError`; callers must catch it and treat it as "ignore this result".
 * - A worker `error` is fatal for this client: pending calls and every later call reject with
 *   `EngineWorkerError` until a new `useEngineWorker()` is created.
 * - A `messageerror` rejects all pending calls with `EngineWorkerError` but keeps the client
 *   usable.
 */
export function useEngineWorker(): EngineRpcClient & { dispose(): void } {
    const port: RpcPort =
        typeof Worker !== 'undefined'
            ? (new Worker(
                  new URL('../workers/engine.worker.ts', import.meta.url),
                  { type: 'module' },
              ) as unknown as RpcPort)
            : createInlinePort();
    const client = createRpcClient(port);
    if (getCurrentScope()) onScopeDispose(client.dispose);
    return client;
}
