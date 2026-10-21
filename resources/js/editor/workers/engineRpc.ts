import {
    computeBom,
    derivePlanGeometry,
    estimateFurniture,
    nestSheets,
} from '@/engine';

/** The engine calls that may run off the main thread (01 §5.5). */
export interface EngineRpcMethods {
    computeBom: typeof computeBom;
    nestSheets: typeof nestSheets;
    derivePlanGeometry: typeof derivePlanGeometry;
    estimateFurniture: typeof estimateFurniture;
}

export type RpcMethod = keyof EngineRpcMethods;

export type EngineRpcClient = {
    [K in RpcMethod]: (
        ...args: Parameters<EngineRpcMethods[K]>
    ) => Promise<ReturnType<EngineRpcMethods[K]>>;
};

export interface RpcRequest {
    id: number;
    method: RpcMethod;
    params: unknown[];
}

export type RpcResponse =
    | { id: number; ok: true; result: unknown }
    | { id: number; ok: false; error: { name: string; message: string } };

export interface RpcPort {
    postMessage(msg: RpcRequest): void;
    onmessage: ((e: { data: RpcResponse }) => void) | null;
    /** The worker failed to load or threw uncaught; the client treats it as fatal. */
    onerror?: (() => void) | null;
    /** A reply could not be deserialised: its caller is unknown, so all pending calls fail. */
    onmessageerror?: (() => void) | null;
    terminate?(): void;
}

/** A call was superseded by a newer one for the same method, or the client was disposed. */
export class EngineWorkerStaleError extends Error {
    constructor(message = 'Engine request superseded or disposed') {
        super(message);
        this.name = 'EngineWorkerStaleError';
    }
}

/** The worker failed (load error, uncaught exception or undeliverable reply). */
export class EngineWorkerError extends Error {
    constructor(message = 'Engine worker failed') {
        super(message);
        this.name = 'EngineWorkerError';
    }
}

const handlers: Record<RpcMethod, (...params: never[]) => unknown> = {
    computeBom,
    nestSheets,
    derivePlanGeometry,
    estimateFurniture,
};

/** Runs one request; never throws. Shared by the worker and the inline fallback. */
export function handleRpcRequest(req: RpcRequest): RpcResponse {
    try {
        if (!Object.hasOwn(handlers, req.method)) {
            throw new Error(`Unknown engine method: ${String(req.method)}`);
        }
        const fn = handlers[req.method] as (...p: unknown[]) => unknown;
        return { id: req.id, ok: true, result: fn(...req.params) };
    } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        return {
            id: req.id,
            ok: false,
            error: { name: err.name, message: err.message },
        };
    }
}

/** Main-thread fallback when Workers are unavailable; answers on a macrotask. */
export function createInlinePort(): RpcPort {
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const port: RpcPort = {
        onmessage: null,
        postMessage(msg) {
            const t = setTimeout(() => {
                timers.delete(t);
                port.onmessage?.({ data: handleRpcRequest(msg) });
            }, 0);
            timers.add(t);
        },
        terminate() {
            timers.forEach(clearTimeout);
            timers.clear();
        },
    };
    return port;
}

interface Pending {
    method: RpcMethod;
    resolve: (v: unknown) => void;
    reject: (e: unknown) => void;
}

export function createRpcClient(
    port: RpcPort,
): EngineRpcClient & { dispose(): void } {
    let nextId = 1;
    let disposed = false;
    let failed = false;
    const pending = new Map<number, Pending>();
    const latestIdByMethod = new Map<RpcMethod, number>();

    port.onmessage = ({ data }) => {
        const entry = pending.get(data.id);
        // Superseded calls were already rejected and removed; drop their late replies.
        if (!entry || latestIdByMethod.get(entry.method) !== data.id) return;
        pending.delete(data.id);
        if (data.ok) {
            entry.resolve(data.result);
        } else {
            const err = new Error(data.error.message);
            err.name = data.error.name;
            entry.reject(err);
        }
    };

    const rejectAll = (reason: Error) => {
        pending.forEach((p) => p.reject(reason));
        pending.clear();
        latestIdByMethod.clear();
    };
    // Fatal by policy: an uncaught exception leaves the worker alive (HTML spec), but the event
    // cannot tell that from a script-load failure, so later calls reject until a new client.
    port.onerror = () => {
        failed = true;
        rejectAll(new EngineWorkerError());
    };
    // Not fatal: one reply was lost, the worker itself is still alive.
    port.onmessageerror = () =>
        rejectAll(new EngineWorkerError('Engine worker reply was unreadable'));

    const call = (method: RpcMethod, params: unknown[]) =>
        new Promise<unknown>((resolve, reject) => {
            if (disposed) return reject(new EngineWorkerStaleError());
            if (failed) return reject(new EngineWorkerError());
            const previous = latestIdByMethod.get(method);
            if (previous !== undefined) {
                pending.get(previous)?.reject(new EngineWorkerStaleError());
                pending.delete(previous);
            }
            const id = nextId++;
            latestIdByMethod.set(method, id);
            pending.set(id, { method, resolve, reject });
            try {
                port.postMessage({ id, method, params });
            } catch (e) {
                pending.delete(id);
                latestIdByMethod.delete(method);
                reject(e);
            }
        });

    const client = {
        dispose() {
            if (disposed) return;
            disposed = true;
            pending.forEach((p) => p.reject(new EngineWorkerStaleError()));
            pending.clear();
            port.onmessage = null;
            port.onerror = null;
            port.onmessageerror = null;
            port.terminate?.();
        },
    } as EngineRpcClient & { dispose(): void };
    for (const method of Object.keys(handlers) as RpcMethod[]) {
        (client as unknown as Record<string, unknown>)[method] = (
            ...params: unknown[]
        ) => call(method, params);
    }
    return client;
}
