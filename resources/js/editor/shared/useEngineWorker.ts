import { getCurrentScope, onScopeDispose } from 'vue';
import {
    createInlinePort,
    createRpcClient,
    type EngineRpcClient,
    type RpcPort,
} from '../workers/engineRpc';

/** Promise-based engine calls off the main thread; only the latest call per method resolves (01 §5.5). */
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
