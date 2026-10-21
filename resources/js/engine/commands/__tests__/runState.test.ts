import { describe, expect, it } from 'vitest';
import { defaultPipeline } from '../bus';
import type { Pipeline } from '../types';
import { setup, type Ctx, type TestDoc } from './busFixture';

/** A pipeline that numbers its runs through `runState` and records what it was handed. */
function numbering() {
    const handed: unknown[] = [];
    let n = 0;
    const pipeline: Pipeline<TestDoc, Ctx> = (
        doc,
        def,
        params,
        ctx,
        runState,
    ) => {
        handed.push(runState);
        const r = defaultPipeline(doc, def, params, ctx);
        n += 1;
        return r.ok ? { ok: true, value: { ...r.value, runState: n } } : r;
    };
    return { pipeline, handed };
}

describe('runState', () => {
    it('hands a replace merge the state of the entry it re-runs, and keeps the state it returns', () => {
        const { pipeline, handed } = numbering();
        const { bus } = setup({ pipeline });
        for (const v of [1, 2, 3]) {
            bus.execute('set', { id: 'a', v }, { merge: true });
        }
        expect(handed).toEqual([undefined, 1, 2]);
        expect(bus.history().undo.at(-1)!.runState).toBe(3);
    });

    it('starts a new entry, and so a new run, after seal and after a different merge key', () => {
        const { pipeline, handed } = numbering();
        const { bus } = setup({ pipeline });
        bus.execute('set', { id: 'a', v: 1 }, { merge: true });
        bus.execute('set', { id: 'a', v: 2 }, { merge: true });
        bus.seal();
        bus.execute('set', { id: 'a', v: 3 }, { merge: true });
        bus.execute('set', { id: 'b', v: 3 }, { merge: true });
        expect(handed).toEqual([undefined, 1, undefined, undefined]);
        // the two sealed entries dropped their state; the open one keeps it
        expect(bus.history().undo.map((e) => e.runState)).toEqual([
            undefined,
            undefined,
            4,
        ]);
    });

    it('leaves an entry without runState when the pipeline returns none', () => {
        const { bus } = setup();
        bus.execute('set', { id: 'a', v: 1 });
        expect('runState' in bus.history().undo[0]!).toBe(false);
    });

    it('drops the state of an entry when it is sealed, and never brings it back through undo and redo', () => {
        const { pipeline } = numbering();
        const { bus } = setup({ pipeline });
        bus.execute('set', { id: 'a', v: 1 }, { merge: true });
        expect(bus.history().undo[0]!.runState).toBe(1);
        bus.seal();
        const [sealed] = bus.history().undo;
        expect(sealed!.sealed).toBe(true);
        expect('runState' in sealed!).toBe(false);
        // the rest of the entry is untouched by the seal
        expect(sealed!.patches.length).toBeGreaterThan(0);
        expect(sealed!.mergeKey).toBe('set:a');

        // an entry sealed by a different merge key
        bus.execute('set', { id: 'b', v: 2 }, { merge: true });
        bus.execute('set', { id: 'c', v: 3 }, { merge: true });
        expect(bus.history().undo.map((e) => 'runState' in e)).toEqual([
            false,
            false,
            true,
        ]);

        // an entry sealed by undo, and again by redo
        expect(bus.undo()).toBe(true);
        expect('runState' in bus.history().redo[0]!).toBe(false);
        expect(bus.redo()).toBe(true);
        expect(bus.history().undo.map((e) => 'runState' in e)).toEqual([
            false,
            false,
            false,
        ]);
    });

    it('does not hand a sealed entry back to the pipeline: a merge after seal() starts fresh', () => {
        const { pipeline, handed } = numbering();
        const { bus } = setup({ pipeline });
        bus.execute('set', { id: 'a', v: 1 }, { merge: true });
        bus.seal();
        bus.execute('set', { id: 'a', v: 2 }, { merge: true });
        expect(handed).toEqual([undefined, undefined]);
    });
});
