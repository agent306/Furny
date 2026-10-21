import { describe, expect, it } from 'vitest';
import type { Patches } from 'mutative';
import { createCommandBus } from '../bus';
import { emptyDoc, pathToEntityId, registry, type TestDoc } from './busFixture';

/** A bus whose `entityIdsOf` records the document each patch list was read against. */
function recording() {
    const calls: Array<{ base: TestDoc; patches: Patches }> = [];
    const bus = createCommandBus({
        initial: emptyDoc(),
        registry,
        getContext: () => ({ size: 0 }),
        pathToEntityId: () => 'path',
        entityIdsOf(base, patches) {
            calls.push({ base, patches });
            return [`n${patches.length}`, null];
        },
        messageKeyPrefix: 'test',
    });
    return { bus, calls };
}

describe('entityIdsOf', () => {
    it('replaces pathToEntityId, and null entries are ignored', () => {
        const { bus } = recording();
        const r = bus.execute('set', { id: 'a', v: 1 });
        expect(r.ok && [...r.changedIds]).toEqual(['n1']);
    });

    it('is given the document the patches apply to: execute, undo, redo, commit, merge, rollback', () => {
        const { bus, calls } = recording();
        const start = bus.getDoc();
        bus.execute('set', { id: 'a', v: 1 });
        const afterSet = bus.getDoc();
        expect(calls.at(-1)!.base).toBe(start);

        bus.undo();
        expect(calls.at(-1)!.base).toBe(afterSet);
        const undone = bus.getDoc();
        bus.redo();
        expect(calls.at(-1)!.base).toBe(undone);

        bus.seal();
        const before = bus.getDoc();
        bus.beginTransaction('t');
        bus.execute('set', { id: 'b', v: 1 });
        bus.execute('set', { id: 'c', v: 1 });
        const inside = bus.getDoc();
        const stepCalls = calls.length;
        bus.commitTransaction();
        expect(calls.length).toBe(stepCalls + 1);
        expect(calls.at(-1)!.base).toBe(before);
        expect(calls.at(-1)!.patches).toHaveLength(2);

        bus.beginTransaction('r');
        bus.execute('set', { id: 'd', v: 1 });
        const pre = bus.getDoc();
        bus.rollbackTransaction();
        expect(calls.at(-1)!.base).toBe(pre);
        expect(inside).not.toBe(pre);

        bus.seal();
        bus.execute('set', { id: 'e', v: 1 }, { merge: true });
        const merging = bus.getDoc();
        bus.execute('set', { id: 'e', v: 2 }, { merge: true });
        // inverse of the entry, then the new patches: both start at the current document
        expect(calls.at(-1)!.base).toBe(merging);
        expect(calls.at(-1)!.patches).toHaveLength(2);
    });

    it('is not used when absent: pathToEntityId still maps the paths', () => {
        const bus = createCommandBus({
            initial: emptyDoc(),
            registry,
            getContext: () => ({ size: 0 }),
            pathToEntityId,
            messageKeyPrefix: 'test',
        });
        const r = bus.execute('set', { id: 'a', v: 1 });
        expect(r.ok && [...r.changedIds]).toEqual(['a']);
    });
});
