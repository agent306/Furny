import { afterEach, describe, expect, it, vi } from 'vitest';
import { effectScope } from 'vue';
import { makeRectPlan } from '@/engine/plan/testing/fixtures';
import { EngineWorkerStaleError } from '../../workers/engineRpc';
import { useEngineWorker } from '../useEngineWorker';

afterEach(() => vi.unstubAllGlobals());

describe('useEngineWorker', () => {
    it('falls back to the inline port when Worker is unavailable', async () => {
        vi.stubGlobal('Worker', undefined);
        const scope = effectScope();
        const engine = scope.run(() => useEngineWorker())!;
        const derived = await engine.derivePlanGeometry(
            makeRectPlan(5000, 4000, 230),
        );
        expect(derived.rooms).toHaveLength(1);
        scope.stop();
    });

    it('disposes with the scope: pending calls reject stale', async () => {
        vi.stubGlobal('Worker', undefined);
        const scope = effectScope();
        const engine = scope.run(() => useEngineWorker())!;
        const pending = engine.derivePlanGeometry(
            makeRectPlan(5000, 4000, 230),
        );
        scope.stop();
        await expect(pending).rejects.toBeInstanceOf(EngineWorkerStaleError);
    });

    it('spawns a module Worker when available and terminates it on dispose', () => {
        const instances: { terminate: ReturnType<typeof vi.fn> }[] = [];
        const ctor = vi.fn(function () {
            const w = {
                postMessage: vi.fn(),
                terminate: vi.fn(),
                onmessage: null,
            };
            instances.push(w);
            return w;
        });
        vi.stubGlobal('Worker', ctor);
        const scope = effectScope();
        scope.run(() => useEngineWorker());
        expect(ctor).toHaveBeenCalledOnce();
        expect((ctor.mock.calls[0] as unknown[])[1]).toEqual({
            type: 'module',
        });
        scope.stop();
        expect(instances[0]!.terminate).toHaveBeenCalledOnce();
    });
});
