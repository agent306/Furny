import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { FurnitureDocumentSchema } from '@/engine';
import { makeRectPlan } from '@/engine/plan/testing/fixtures';
import { seedCatalog } from '@/engine/testing/seedCatalog';
import {
    createInlinePort,
    createRpcClient,
    EngineWorkerStaleError,
    handleRpcRequest,
    type RpcPort,
    type RpcRequest,
    type RpcResponse,
} from '../engineRpc';

/** Queues requests; the test delivers responses in any order it likes. */
function fakePort() {
    const sent: RpcRequest[] = [];
    const port: RpcPort & { terminate: ReturnType<typeof vi.fn> } = {
        postMessage: (msg) => void sent.push(msg),
        onmessage: null,
        terminate: vi.fn(),
    };
    const deliver = (res: RpcResponse) => port.onmessage?.({ data: res });
    const answer = (req: RpcRequest) => deliver(handleRpcRequest(req));
    return { port, sent, deliver, answer };
}

const catalog = seedCatalog();
// Read directly: wardrobeFixture() resolves a file: URL, which happy-dom's URL rejects.
const doc = FurnitureDocumentSchema.parse(
    JSON.parse(
        readFileSync(
            resolve('database/fixtures/furniture/wardrobe-3door.json'),
            'utf8',
        ),
    ),
);

describe('createRpcClient stale-request cancellation (01 §5.5)', () => {
    it.each(['newest-first', 'oldest-first'] as const)(
        'only the latest estimateFurniture resolves, responses %s',
        async (order) => {
            const { port, sent, answer } = fakePort();
            const client = createRpcClient(port);
            const first = client.estimateFurniture(doc, catalog);
            const second = client.estimateFurniture(doc, catalog);
            const firstSettled = first.then(
                () => 'resolved',
                (e: unknown) => e,
            );
            expect(sent).toHaveLength(2);

            if (order === 'newest-first') {
                answer(sent[1]!);
                answer(sent[0]!);
            } else {
                answer(sent[0]!);
                answer(sent[1]!);
            }

            const result = await second;
            expect(result.price.unitPriceMinor).toBe(2431300);
            const err = await firstSettled;
            expect(err).toBeInstanceOf(EngineWorkerStaleError);
            expect((err as Error).name).toBe('EngineWorkerStaleError');
        },
    );

    it('does not cancel concurrent calls of different methods', async () => {
        const { port, sent, answer } = fakePort();
        const client = createRpcClient(port);
        const a = client.estimateFurniture(doc, catalog);
        const b = client.derivePlanGeometry(makeRectPlan(5000, 4000, 230));
        sent.forEach(answer);
        expect((await a).price.unitPriceMinor).toBe(2431300);
        expect((await b).rooms).toHaveLength(1);
    });

    it('rejects with the handler message when the handler throws', async () => {
        const { port, sent, deliver } = fakePort();
        const client = createRpcClient(port);
        const p = client.derivePlanGeometry(makeRectPlan(5000, 4000, 230));
        deliver({
            id: sent[0]!.id,
            ok: false,
            error: { name: 'RangeError', message: 'boom' },
        });
        await expect(p).rejects.toThrow('boom');
    });

    it('dispose rejects pending calls as stale and terminates the port', async () => {
        const { port } = fakePort();
        const client = createRpcClient(port);
        const p = client.estimateFurniture(doc, catalog);
        client.dispose();
        await expect(p).rejects.toBeInstanceOf(EngineWorkerStaleError);
        expect(port.terminate).toHaveBeenCalledOnce();
    });

    it('rejects calls made after dispose', async () => {
        const { port } = fakePort();
        const client = createRpcClient(port);
        client.dispose();
        await expect(
            client.derivePlanGeometry(makeRectPlan(5000, 4000, 230)),
        ).rejects.toBeInstanceOf(EngineWorkerStaleError);
    });
});

describe('handleRpcRequest', () => {
    it('derives plan geometry', () => {
        const res = handleRpcRequest({
            id: 1,
            method: 'derivePlanGeometry',
            params: [makeRectPlan(5000, 4000, 230)],
        });
        expect(res.ok).toBe(true);
        if (res.ok) {
            expect(res.id).toBe(1);
            expect((res.result as { rooms: unknown[] }).rooms).toHaveLength(1);
        }
    });

    it('answers an unknown method with ok: false', () => {
        const res = handleRpcRequest({
            id: 2,
            method: 'nope' as never,
            params: [],
        });
        expect(res).toMatchObject({ id: 2, ok: false });
    });

    it('turns a handler exception into ok: false with its message', () => {
        const res = handleRpcRequest({
            id: 3,
            method: 'derivePlanGeometry',
            params: [null],
        });
        expect(res.ok).toBe(false);
        if (!res.ok) expect(res.error.message).not.toBe('');
    });
});

describe('createInlinePort', () => {
    it('round-trips on a macrotask', async () => {
        const client = createRpcClient(createInlinePort());
        const p = client.derivePlanGeometry(makeRectPlan(5000, 4000, 230));
        expect((await p).rooms).toHaveLength(1);
        client.dispose();
    });

    it('terminate clears pending deliveries', () => {
        vi.useFakeTimers();
        try {
            const port = createInlinePort();
            const onmessage = vi.fn();
            port.onmessage = onmessage;
            port.postMessage({
                id: 1,
                method: 'derivePlanGeometry',
                params: [makeRectPlan(5000, 4000, 230)],
            });
            port.terminate?.();
            vi.runAllTimers();
            expect(onmessage).not.toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });
});
