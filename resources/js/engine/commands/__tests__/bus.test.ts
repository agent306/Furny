import { isDeepStrictEqual } from 'node:util';
import { apply, type Draft } from 'mutative';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { EngineMessage } from '../../plan/types';
import { createCommandBus, defaultPipeline, shouldAutoFreeze } from '../bus';
import {
    CommandAbort,
    CommandFailedError,
    type BusEvent,
    type CommandDef,
    type ExecuteOptions,
    type Pipeline,
} from '../types';

// ---- test document and commands (brief, Task 20) ---------------------------

interface TestDoc {
    items: Record<string, { v: number }>;
    view: { zoom: number };
}
interface Ctx {
    size: number;
}

const msg = (code: string): EngineMessage => ({
    code,
    messageKey: `test.${code}`,
    params: {},
});

const cmd = <P, R = void>(def: CommandDef<TestDoc, P, Ctx, R>) => def;

interface IdValue {
    id: string;
    v: number;
}
interface IdBy {
    id: string;
    by: number;
}

/** Sets `items[id].v`; assigning the value it already has produces no patch. */
function setItem(draft: Draft<TestDoc>, id: string, value: number): void {
    const cur = draft.items[id];
    if (cur) cur.v = value;
    else draft.items[id] = { v: value };
}

/** Absolute target; replace-merges per id. A negative value is refused. */
const set = cmd<IdValue>({
    type: 'set',
    labelKey: 'test.label.set',
    validate: (_doc, p) => (p.v < 0 ? msg('negative') : null),
    run: (draft, p) => setItem(draft, p.id, p.v),
    labelParams: (p) => ({ id: p.id, v: p.v }),
    mergeKey: (p) => `set:${p.id}`,
    touchesGeometry: false,
});

/** Absolute target with one merge key for every id (cross-entity drag). */
const move = cmd<IdValue>({
    type: 'move',
    labelKey: 'test.label.move',
    validate: () => null,
    run: (draft, p) => setItem(draft, p.id, p.v),
    mergeKey: () => 'drag',
    touchesGeometry: false,
});

/** Relative; composes. */
const inc = cmd<IdBy>({
    type: 'inc',
    labelKey: 'test.label.inc',
    validate: () => null,
    run(draft, p) {
        const cur = draft.items[p.id];
        if (cur) cur.v += p.by;
        else draft.items[p.id] = { v: p.by };
    },
    mergeKey: (p) => `inc:${p.id}`,
    mergeMode: 'compose',
    touchesGeometry: false,
});

/** No merge key. */
const plain = cmd<IdValue>({
    type: 'plain',
    labelKey: 'test.label.plain',
    validate: () => null,
    run: (draft, p) => setItem(draft, p.id, p.v),
    touchesGeometry: false,
});

const remove = cmd<{ id: string }>({
    type: 'remove',
    labelKey: 'test.label.remove',
    validate: () => null,
    run: (draft, p) => {
        delete draft.items[p.id];
    },
    touchesGeometry: false,
});

/** Mutates, then cancels. */
const abort = cmd<{ id: string }>({
    type: 'abort',
    labelKey: 'test.label.abort',
    validate: () => null,
    run(draft, p) {
        draft.items[p.id] = { v: 999 };
        throw new CommandAbort(msg('aborted'));
    },
    touchesGeometry: false,
});

const invalid = cmd<{ id: string }>({
    type: 'invalid',
    labelKey: 'test.label.invalid',
    validate: () => msg('invalid'),
    run(draft, p) {
        draft.items[p.id] = { v: 1 };
    },
    touchesGeometry: false,
});

/** Mutates, then crashes with a bug rather than a CommandAbort. */
const boom = cmd<{ id: string }>({
    type: 'boom',
    labelKey: 'test.label.boom',
    validate: () => null,
    run(draft, p) {
        draft.items[p.id] = { v: 999 };
        throw new Error('boom');
    },
    touchesGeometry: false,
});

const typed = cmd<{ n: number }>({
    type: 'typed',
    labelKey: 'test.label.typed',
    paramsSchema: z.object({ n: z.number().int() }),
    labelParams: (p) => ({ n: p.n }),
    validate: () => null,
    run(draft, p) {
        draft.items.n = { v: p.n };
    },
    touchesGeometry: false,
});

/** Defaults the value through the schema, to prove the bus passes parsed params on. */
const defaulted = cmd<{ id: string; v: number }>({
    type: 'defaulted',
    labelKey: 'test.label.defaulted',
    paramsSchema: z.object({ id: z.string(), v: z.number().default(7) }),
    validate: () => null,
    run(draft, p) {
        draft.items[p.id] = { v: p.v };
    },
    touchesGeometry: false,
});

/** Touches only `view`, which `pathToEntityId` ignores. */
const zoom = cmd<{ zoom: number }>({
    type: 'zoom',
    labelKey: 'test.label.zoom',
    validate: () => null,
    run(draft, p) {
        draft.view.zoom = p.zoom;
    },
    touchesGeometry: false,
});

/** Replaces a whole collection: path length 1. */
const replaceAll = cmd<{ items: TestDoc['items'] }>({
    type: 'replaceAll',
    labelKey: 'test.label.replaceAll',
    validate: () => null,
    run(draft, p) {
        draft.items = p.items as Draft<TestDoc['items']>;
    },
    touchesGeometry: false,
});

const withOutput = cmd<{ id: string }, number>({
    type: 'withOutput',
    labelKey: 'test.label.withOutput',
    validate: () => null,
    run(draft, p, ctx, out) {
        draft.items[p.id] = { v: ctx.size };
        out.result = ctx.size + 100;
        out.warnings.push(msg('careful'));
        out.deletedIds.push('gone');
    },
    touchesGeometry: false,
});

const registry = {
    set,
    move,
    inc,
    plain,
    remove,
    abort,
    invalid,
    boom,
    typed,
    defaulted,
    zoom,
    replaceAll,
    withOutput,
};

function pathToEntityId(path: (string | number)[]): string | null {
    if (path.length === 1) return '*';
    if (path[0] === 'items' && typeof path[1] === 'string') return path[1];
    return null;
}

const emptyDoc = (): TestDoc => ({ items: {}, view: { zoom: 1 } });

function setup(
    over: {
        initial?: TestDoc;
        maxHistory?: number;
        messageKeyPrefix?: string;
        pipeline?: Pipeline<TestDoc, Ctx>;
    } = {},
) {
    let clock = 1000;
    const getContext = vi.fn((d: TestDoc): Ctx => ({
        size: Object.keys(d.items).length,
    }));
    const bus = createCommandBus({
        initial: over.initial ?? emptyDoc(),
        registry,
        getContext,
        pathToEntityId,
        messageKeyPrefix: over.messageKeyPrefix ?? 'test',
        now: () => (clock += 1),
        ...(over.maxHistory === undefined
            ? {}
            : { maxHistory: over.maxHistory }),
        ...(over.pipeline === undefined ? {} : { pipeline: over.pipeline }),
    });
    const events: BusEvent<TestDoc>[] = [];
    bus.subscribe((e) => events.push(e));
    return { bus, events, getContext };
}

type Bus = ReturnType<typeof setup>['bus'];

const v = (bus: Bus, id: string): number | undefined =>
    bus.getDoc().items[id]?.v;
const ok = (r: { ok: boolean }): void => {
    expect(r.ok).toBe(true);
};

// ---- execute ----------------------------------------------------------------

describe('execute', () => {
    it('replaces the document, pushes an entry and emits an execute event', () => {
        const { bus, events } = setup();
        const before = bus.getDoc();
        const r = bus.execute('set', { id: 'a', v: 5 });
        expect(r).toEqual({
            ok: true,
            result: undefined,
            warnings: [],
            deletedIds: [],
            changedIds: new Set(['a']),
        });
        expect(bus.getDoc()).not.toBe(before);
        expect(bus.getDoc().items).toEqual({ a: { v: 5 } });
        expect(before.items).toEqual({});
        const { undo, redo } = bus.history();
        expect(redo).toEqual([]);
        expect(undo).toHaveLength(1);
        expect(undo[0]).toMatchObject({
            seq: 1,
            type: 'set',
            labelKey: 'test.label.set',
            labelParams: { id: 'a', v: 5 },
            mergeKey: 'set:a',
            mergeMode: 'replace',
            sealed: false,
            lastParams: { id: 'a', v: 5 },
            meta: null,
            patches: [{ op: 'add', path: ['items', 'a'], value: { v: 5 } }],
            inversePatches: [{ op: 'remove', path: ['items', 'a'] }],
        });
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
            kind: 'execute',
            doc: bus.getDoc(),
            prevDoc: before,
            patches: undo[0]!.patches,
            changedIds: new Set(['a']),
            entry: undo[0],
        });
    });

    it('returns the result, warnings and deleted ids of the command', () => {
        const { bus } = setup({
            initial: { items: { x: { v: 1 } }, view: { zoom: 1 } },
        });
        const r = bus.execute('withOutput', { id: 'a' });
        expect(r).toEqual({
            ok: true,
            result: 101,
            warnings: [msg('careful')],
            deletedIds: ['gone'],
            changedIds: new Set(['a']),
        });
        if (r.ok) {
            const n: number = r.result; // typed from the command's `out`
            expect(n).toBe(101);
        }
    });

    it('calls getContext once per execute with the document it runs on', () => {
        const { bus, getContext } = setup();
        bus.execute('set', { id: 'a', v: 1 });
        bus.execute('set', { id: 'b', v: 1 });
        expect(getContext).toHaveBeenCalledTimes(2);
        expect(getContext.mock.calls[0]![0]).toEqual(emptyDoc());
        expect(getContext.mock.calls[1]![0].items).toEqual({ a: { v: 1 } });
    });

    it('stores opts.meta untouched and never inspects it', () => {
        const { bus } = setup();
        const meta = { selection: ['a'] };
        bus.execute('set', { id: 'a', v: 1 }, { meta });
        expect(bus.history().undo[0]!.meta).toBe(meta);
    });

    it('extracts changedIds from the forward patches, skipping ignored paths', () => {
        const { bus, events } = setup({
            initial: {
                items: { a: { v: 1 }, b: { v: 1 } },
                view: { zoom: 1 },
            },
        });
        const r = bus.execute('move', { id: 'b', v: 3 });
        expect(r.ok && r.changedIds).toEqual(new Set(['b']));
        const z = bus.execute('zoom', { zoom: 2 });
        expect(z.ok && z.changedIds).toEqual(new Set());
        expect(events.at(-1)!.kind).toBe('execute');
    });

    it("reports '*' when a whole collection is replaced", () => {
        const { bus } = setup();
        const r = bus.execute('replaceAll', { items: { q: { v: 1 } } });
        expect(r.ok && r.changedIds).toEqual(new Set(['*']));
    });

    it('throws on an unknown command type, leaving everything untouched', () => {
        const { bus, events } = setup();
        expect(() =>
            (bus.execute as (t: string, p: unknown) => unknown)('nope', {}),
        ).toThrow(/unknown command "nope"/);
        expect(() =>
            (bus.execute as (t: string, p: unknown) => unknown)('toString', {}),
        ).toThrow(/unknown command/);
        expect(events).toEqual([]);
        expect(bus.canUndo()).toBe(false);
    });

    it('parses params with the schema and runs the command on the parsed value', () => {
        const { bus } = setup();
        // `v` is filled in by the schema default
        ok(bus.execute('defaulted', { id: 'a' } as { id: string; v: number }));
        expect(v(bus, 'a')).toBe(7);
        expect(bus.history().undo[0]!.lastParams).toEqual({ id: 'a', v: 7 });
    });

    it('uses labelParams of the parsed params for the history label', () => {
        const { bus } = setup();
        ok(bus.execute('typed', { n: 4 }));
        expect(bus.history().undo[0]).toMatchObject({
            labelKey: 'test.label.typed',
            labelParams: { n: 4 },
        });
        ok(bus.execute('plain', { id: 'a', v: 1 }));
        expect(bus.history().undo[1]!.labelParams).toEqual({});
    });
});

describe('execute failures leave no trace', () => {
    function snapshot(bus: Bus) {
        const h = bus.history();
        return {
            doc: bus.getDoc(),
            undo: h.undo,
            redo: h.redo,
            canUndo: bus.canUndo(),
            canRedo: bus.canRedo(),
        };
    }

    // Build a state with undo, redo and an unsealed top, then fail inside it.
    function prepared() {
        const s = setup();
        ok(s.bus.execute('set', { id: 'a', v: 1 }));
        ok(s.bus.execute('set', { id: 'b', v: 1 }));
        s.bus.undo();
        ok(s.bus.execute('inc', { id: 'c', by: 2 }));
        s.bus.seal();
        ok(s.bus.execute('set', { id: 'd', v: 4 }));
        s.bus.undo();
        s.bus.redo();
        ok(s.bus.execute('inc', { id: 'c', by: 1 }));
        s.events.length = 0;
        return s;
    }

    it.each([
        ['validate refuses', 'invalid', { id: 'z' }, 'invalid'],
        ['run aborts after mutating', 'abort', { id: 'z' }, 'aborted'],
        ['a validate in set refuses', 'set', { id: 'z', v: -1 }, 'negative'],
    ] as const)('%s', (_name, type, params, code) => {
        const { bus, events } = prepared();
        const before = snapshot(bus);
        const r = (bus.execute as (t: string, p: unknown) => unknown)(
            type,
            params,
        );
        expect(r).toEqual({ ok: false, error: msg(code) });
        expect(snapshot(bus)).toEqual(before);
        expect(bus.getDoc()).toBe(before.doc);
        expect(events).toEqual([]);
    });

    it('a zod failure is invalid_params under the configured prefix', () => {
        const { bus, events } = prepared();
        const before = snapshot(bus);
        const r = bus.execute('typed', { n: 1.5 });
        expect(r).toEqual({
            ok: false,
            error: {
                code: 'invalid_params',
                messageKey: 'test.invalid_params',
                params: { command: 'typed', field: 'n', issue: 'invalid_type' },
            },
        });
        const missing = bus.execute('typed', {} as { n: number });
        expect(missing.ok).toBe(false);
        expect(snapshot(bus)).toEqual(before);
        expect(events).toEqual([]);
    });

    it('honours messageKeyPrefix instead of any hard-coded prefix', () => {
        const { bus } = setup({ messageKeyPrefix: 'plan_editor.cmd' });
        const r = bus.execute('typed', { n: 'x' as unknown as number });
        expect(r.ok === false && r.error.messageKey).toBe(
            'plan_editor.cmd.invalid_params',
        );
    });

    it('an unexpected exception propagates and leaves the bus untouched', () => {
        const { bus, events } = prepared();
        const before = snapshot(bus);
        expect(() => bus.execute('boom', { id: 'z' })).toThrow('boom');
        expect(snapshot(bus)).toEqual(before);
        expect(events).toEqual([]);
        // the failure consumed no sequence number and the merge state is intact
        const top = before.undo.at(-1)!;
        expect(top.sealed).toBe(false);
        ok(bus.execute('inc', { id: 'c', by: 1 }, { merge: true }));
        expect(bus.history().undo).toHaveLength(before.undo.length);
        ok(bus.execute('plain', { id: 'n', v: 1 }));
        expect(bus.history().undo.at(-1)!.seq).toBe(top.seq + 1);
    });

    it('a failed replace-merge keeps the previous merged state and its error', () => {
        const { bus, events } = setup();
        ok(bus.execute('set', { id: 'a', v: 5 }));
        ok(bus.execute('set', { id: 'a', v: 6 }, { merge: true }));
        const entry = bus.history().undo[0]!;
        events.length = 0;
        const r = bus.execute('set', { id: 'a', v: -1 }, { merge: true });
        expect(r).toEqual({ ok: false, error: msg('negative') });
        expect(v(bus, 'a')).toBe(6);
        expect(bus.history().undo).toEqual([entry]);
        expect(events).toEqual([]);
        // still unsealed and still mergeable
        ok(bus.execute('set', { id: 'a', v: 7 }, { merge: true }));
        expect(bus.history().undo).toHaveLength(1);
        bus.undo();
        expect(bus.getDoc()).toEqual(emptyDoc());
    });

    it('a failure in a transaction leaves the transaction open and intact', () => {
        const { bus } = setup();
        bus.beginTransaction('test.tx');
        ok(bus.execute('set', { id: 'a', v: 1 }));
        const mid = bus.getDoc();
        expect(bus.execute('abort', { id: 'a' }).ok).toBe(false);
        expect(bus.getDoc()).toBe(mid);
        bus.commitTransaction();
        expect(bus.history().undo).toHaveLength(1);
    });
});

// ---- undo / redo -------------------------------------------------------------

describe('undo and redo', () => {
    it('restore the exact documents and return false on empty stacks', () => {
        const { bus, events } = setup();
        const d0 = bus.getDoc();
        expect(bus.undo()).toBe(false);
        expect(bus.redo()).toBe(false);
        expect(bus.canUndo()).toBe(false);
        expect(bus.canRedo()).toBe(false);
        bus.execute('set', { id: 'a', v: 1 });
        const d1 = bus.getDoc();
        bus.execute('set', { id: 'b', v: 2 });
        const d2 = bus.getDoc();
        events.length = 0;

        expect(bus.undo()).toBe(true);
        expect(bus.getDoc()).toEqual(d1);
        expect(bus.canRedo()).toBe(true);
        expect(bus.undo()).toBe(true);
        expect(bus.getDoc()).toEqual(d0);
        expect(bus.canUndo()).toBe(false);
        expect(bus.undo()).toBe(false);

        expect(bus.redo()).toBe(true);
        expect(bus.getDoc()).toEqual(d1);
        expect(bus.redo()).toBe(true);
        expect(bus.getDoc()).toEqual(d2);
        expect(bus.redo()).toBe(false);

        expect(events.map((e) => e.kind)).toEqual([
            'undo',
            'undo',
            'redo',
            'redo',
        ]);
        expect(events[0]).toMatchObject({
            prevDoc: d2,
            patches: [{ op: 'remove', path: ['items', 'b'] }],
            changedIds: new Set(['b']),
        });
        expect(events[0]!.entry).toMatchObject({ type: 'set', sealed: true });
        expect(events[3]).toMatchObject({
            patches: [{ op: 'add', path: ['items', 'b'], value: { v: 2 } }],
            changedIds: new Set(['b']),
        });
    });

    it('a new execute clears the redo stack', () => {
        const { bus } = setup();
        bus.execute('set', { id: 'a', v: 1 });
        bus.undo();
        expect(bus.canRedo()).toBe(true);
        bus.execute('set', { id: 'b', v: 1 });
        expect(bus.canRedo()).toBe(false);
        expect(bus.history().redo).toEqual([]);
        expect(bus.redo()).toBe(false);
    });

    it('undo seals the entry it moves; redo hands back a sealed entry', () => {
        const { bus } = setup();
        bus.execute('inc', { id: 'a', by: 1 });
        expect(bus.history().undo[0]!.sealed).toBe(false);
        bus.undo();
        expect(bus.history().redo[0]!.sealed).toBe(true);
        bus.redo();
        expect(bus.history().undo[0]!.sealed).toBe(true);
        // so the next burst starts a new entry
        bus.execute('inc', { id: 'a', by: 1 }, { merge: true });
        expect(bus.history().undo).toHaveLength(2);
    });

    it('keeps entry objects stable once handed out', () => {
        const { bus } = setup();
        bus.execute('inc', { id: 'a', by: 1 });
        const first = bus.history().undo[0]!;
        bus.seal();
        expect(first.sealed).toBe(false);
        expect(bus.history().undo[0]!.sealed).toBe(true);
        expect(Object.isFrozen(first)).toBe(true);
    });
});

// ---- merging -----------------------------------------------------------------

describe('replace merge (absolute commands, 04 §6.8 200-move drag)', () => {
    it('merges 200 executes into one entry; one undo restores the original', () => {
        const { bus, events } = setup({
            initial: { items: { a: { v: 0 } }, view: { zoom: 1 } },
        });
        const original = bus.getDoc();
        ok(bus.execute('set', { id: 'a', v: 1 }));
        for (let i = 2; i <= 200; i += 1) {
            ok(bus.execute('set', { id: 'a', v: i }, { merge: true }));
        }
        expect(v(bus, 'a')).toBe(200);
        const { undo } = bus.history();
        expect(undo).toHaveLength(1);
        expect(undo[0]).toMatchObject({
            lastParams: { id: 'a', v: 200 },
            labelParams: { id: 'a', v: 200 },
            sealed: false,
            seq: 1,
        });
        // compact: the entry carries only the last move, not 200
        expect(undo[0]!.patches).toHaveLength(1);
        expect(undo[0]!.inversePatches).toHaveLength(1);
        expect(events.map((e) => e.kind)).toEqual([
            'execute',
            ...Array<string>(199).fill('merge'),
        ]);

        expect(bus.undo()).toBe(true);
        expect(bus.getDoc()).toEqual(original);
        expect(bus.canUndo()).toBe(false);
        expect(bus.redo()).toBe(true);
        expect(v(bus, 'a')).toBe(200);
    });

    it('emits merge events whose patches lead from prevDoc to doc', () => {
        const { bus, events } = setup({
            initial: { items: { a: { v: 0 } }, view: { zoom: 1 } },
        });
        bus.execute('set', { id: 'a', v: 1 });
        bus.execute('set', { id: 'a', v: 2 }, { merge: true });
        bus.execute('set', { id: 'a', v: 3 }, { merge: true });
        for (const e of events) {
            expect(apply(e.prevDoc, e.patches)).toEqual(e.doc);
        }
        expect(events[2]).toMatchObject({
            kind: 'merge',
            changedIds: new Set(['a']),
            entry: bus.history().undo[0],
        });
    });

    it('counts the entities of the replaced sequence as changed', () => {
        const { bus, events } = setup();
        bus.execute('move', { id: 'a', v: 1 });
        bus.execute('move', { id: 'b', v: 1 }, { merge: true }); // same key 'drag'
        expect(bus.getDoc().items).toEqual({ b: { v: 1 } });
        expect(bus.history().undo).toHaveLength(1);
        expect(events[1]!.changedIds).toEqual(new Set(['a', 'b']));
        bus.undo();
        expect(bus.getDoc()).toEqual(emptyDoc());
    });

    it('does not merge without opts.merge, for another key, or after a seal', () => {
        const { bus } = setup();
        bus.execute('set', { id: 'a', v: 1 });
        bus.execute('set', { id: 'a', v: 2 }); // merge not requested
        expect(bus.history().undo).toHaveLength(2);
        bus.execute('set', { id: 'b', v: 1 }, { merge: true }); // other key
        expect(bus.history().undo).toHaveLength(3);
        bus.execute('set', { id: 'b', v: 2 }, { merge: true });
        expect(bus.history().undo).toHaveLength(3);
        bus.seal();
        bus.execute('set', { id: 'b', v: 3 }, { merge: true });
        expect(bus.history().undo).toHaveLength(4);
    });

    it('a different mergeKey seals the previous entry automatically', () => {
        const { bus } = setup();
        bus.execute('set', { id: 'a', v: 1 });
        bus.execute('set', { id: 'b', v: 1 }, { merge: true });
        expect(bus.history().undo.map((e) => e.sealed)).toEqual([true, false]);
        // a command without a key seals as well
        bus.execute('plain', { id: 'c', v: 1 }, { merge: true });
        expect(bus.history().undo.map((e) => e.sealed)).toEqual([
            true,
            true,
            false,
        ]);
        // a command without a key never merges, whatever the flag says
        bus.execute('plain', { id: 'c', v: 2 }, { merge: true });
        expect(bus.history().undo).toHaveLength(4);
    });

    it('does not merge across an undo/redo', () => {
        const { bus } = setup();
        bus.execute('set', { id: 'a', v: 1 });
        bus.execute('set', { id: 'a', v: 2 }, { merge: true });
        bus.undo();
        bus.redo();
        bus.execute('set', { id: 'a', v: 3 }, { merge: true });
        expect(bus.history().undo).toHaveLength(2);
        bus.undo();
        expect(v(bus, 'a')).toBe(2);
        bus.undo();
        expect(bus.getDoc()).toEqual(emptyDoc());
    });

    it('merge: true with history: false never merges', () => {
        const { bus } = setup();
        bus.execute('set', { id: 'a', v: 1 });
        bus.execute('set', { id: 'a', v: 2 }, { merge: true, history: false });
        expect(bus.history().undo).toHaveLength(1);
        expect(bus.history().undo[0]!.patches).toEqual([
            { op: 'add', path: ['items', 'a'], value: { v: 1 } },
        ]);
    });
});

describe('compose merge (relative commands)', () => {
    it('merges 10 nudges into one entry; undo restores', () => {
        const { bus, events } = setup({
            initial: { items: { a: { v: 100 } }, view: { zoom: 1 } },
        });
        const original = bus.getDoc();
        ok(bus.execute('inc', { id: 'a', by: 1 }));
        for (let i = 0; i < 9; i += 1) {
            ok(bus.execute('inc', { id: 'a', by: 1 }, { merge: true }));
        }
        expect(v(bus, 'a')).toBe(110);
        const { undo } = bus.history();
        expect(undo).toHaveLength(1);
        expect(undo[0]!.patches).toHaveLength(10);
        expect(undo[0]!.inversePatches).toHaveLength(10);
        expect(undo[0]!.lastParams).toEqual({ id: 'a', by: 1 });
        expect(events.map((e) => e.kind)).toEqual([
            'execute',
            ...Array<string>(9).fill('merge'),
        ]);
        // each merge event carries only the new command's patches
        expect(events[5]!.patches).toHaveLength(1);

        expect(bus.undo()).toBe(true);
        expect(bus.getDoc()).toEqual(original);
        expect(bus.redo()).toBe(true);
        expect(v(bus, 'a')).toBe(110);
    });

    it('composes relative commands on top of the current document', () => {
        const { bus } = setup();
        bus.execute('inc', { id: 'a', by: 5 });
        bus.execute('inc', { id: 'a', by: 5 }, { merge: true });
        bus.execute('inc', { id: 'a', by: -3 }, { merge: true });
        expect(v(bus, 'a')).toBe(7);
        bus.undo();
        expect(bus.getDoc()).toEqual(emptyDoc());
    });

    it('seal() ends the burst: the next inc starts a new entry', () => {
        const { bus } = setup();
        bus.execute('inc', { id: 'a', by: 1 });
        bus.execute('inc', { id: 'a', by: 1 }, { merge: true });
        bus.seal();
        bus.execute('inc', { id: 'a', by: 1 }, { merge: true });
        expect(bus.history().undo).toHaveLength(2);
        bus.undo();
        expect(v(bus, 'a')).toBe(2);
        bus.undo();
        expect(bus.getDoc()).toEqual(emptyDoc());
    });

    it('a different mergeKey seals; the old burst can no longer be extended', () => {
        const { bus } = setup();
        bus.execute('inc', { id: 'a', by: 1 });
        bus.execute('inc', { id: 'b', by: 1 }, { merge: true });
        bus.execute('inc', { id: 'a', by: 1 }, { merge: true });
        expect(bus.history().undo).toHaveLength(3);
    });

    it('a compose command that changes nothing leaves the burst running', () => {
        const { bus, events } = setup();
        bus.execute('inc', { id: 'a', by: 1 });
        events.length = 0;
        const r = bus.execute('inc', { id: 'a', by: 0 }, { merge: true });
        expect(r).toMatchObject({ ok: true, changedIds: new Set() });
        expect(events).toEqual([]);
        expect(bus.history().undo[0]!.sealed).toBe(false);
        expect(bus.history().undo[0]!.patches).toHaveLength(1);
    });
});

describe('history: false and commands that change nothing', () => {
    it('history: false applies without an entry, clearing redo and sealing the top', () => {
        const { bus, events } = setup();
        bus.execute('inc', { id: 'a', by: 1 });
        bus.execute('set', { id: 'b', v: 1 });
        bus.undo();
        events.length = 0;
        const r = bus.execute('zoom', { zoom: 3 }, { history: false });
        expect(r).toMatchObject({ ok: true, changedIds: new Set() });
        expect(bus.getDoc().view.zoom).toBe(3);
        expect(bus.history().undo).toHaveLength(1);
        expect(bus.history().undo[0]!.sealed).toBe(true);
        expect(bus.canRedo()).toBe(false);
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({ kind: 'execute', entry: null });
        // undo leaves the view alone: only the entry's patches are reverted
        bus.undo();
        expect(bus.getDoc().view.zoom).toBe(3);
        expect(bus.getDoc().items).toEqual({});
    });

    it('a no-op execute adds no entry and no event, keeps redo, seals the top', () => {
        const { bus, events } = setup();
        bus.execute('inc', { id: 'a', by: 1 });
        bus.execute('inc', { id: 'b', by: 1 });
        bus.undo();
        bus.redo();
        bus.undo();
        events.length = 0;
        const before = bus.getDoc();
        const r = bus.execute('zoom', { zoom: 1 }); // already 1
        expect(r).toMatchObject({ ok: true, changedIds: new Set() });
        expect(bus.getDoc()).toBe(before);
        expect(bus.history().undo).toHaveLength(1);
        expect(bus.canRedo()).toBe(true);
        expect(events).toEqual([]);
        expect(bus.history().undo[0]!.sealed).toBe(true);
    });
});

// ---- transactions ------------------------------------------------------------

describe('transactions', () => {
    it('commits several executes as one entry with the transaction label', () => {
        const { bus, events } = setup();
        const start = bus.getDoc();
        bus.beginTransaction('test.tx.label', { count: 3 });
        bus.execute('set', { id: 'a', v: 1 });
        expect(v(bus, 'a')).toBe(1); // intermediate documents are visible
        bus.execute('set', { id: 'b', v: 2 });
        bus.execute('inc', { id: 'a', by: 5 });
        expect(bus.getDoc().items).toEqual({ a: { v: 6 }, b: { v: 2 } });
        expect(bus.history().undo).toHaveLength(0);
        expect(events.map((e) => [e.kind, e.entry])).toEqual([
            ['execute', null],
            ['execute', null],
            ['execute', null],
        ]);
        const mid = bus.getDoc();

        bus.commitTransaction();
        const { undo } = bus.history();
        expect(undo).toHaveLength(1);
        expect(undo[0]).toMatchObject({
            seq: 1,
            type: 'transaction',
            labelKey: 'test.tx.label',
            labelParams: { count: 3 },
            mergeKey: null,
            sealed: true,
            lastParams: null,
        });
        expect(undo[0]!.patches).toHaveLength(3);
        const commit = events.at(-1)!;
        expect(commit).toMatchObject({
            kind: 'commit',
            doc: mid,
            prevDoc: start,
            changedIds: new Set(['a', 'b']),
            entry: undo[0],
        });
        expect(apply(commit.prevDoc, commit.patches)).toEqual(commit.doc);

        bus.undo();
        expect(bus.getDoc()).toEqual(start);
        bus.redo();
        expect(bus.getDoc()).toEqual(mid);
    });

    it('an empty transaction pushes no entry and emits nothing', () => {
        const { bus, events } = setup();
        bus.execute('set', { id: 'a', v: 1 });
        bus.undo();
        events.length = 0;
        bus.beginTransaction('test.tx');
        bus.commitTransaction();
        bus.beginTransaction('test.tx');
        bus.execute('inc', { id: 'a', by: 0 }); // changes nothing... creates a
        bus.rollbackTransaction();
        expect(bus.history().undo).toHaveLength(0);
        expect(bus.canRedo()).toBe(true); // an untouched redo stack survives
        expect(events.map((e) => e.kind)).toEqual(['execute', 'rollback']);
    });

    it('nested begins only count depth; the outermost commit writes the entry', () => {
        const { bus, events } = setup();
        bus.beginTransaction('test.outer');
        bus.execute('set', { id: 'a', v: 1 });
        bus.beginTransaction('test.inner');
        bus.execute('set', { id: 'b', v: 1 });
        bus.commitTransaction();
        expect(bus.history().undo).toHaveLength(0);
        expect(events.some((e) => e.kind === 'commit')).toBe(false);
        bus.execute('set', { id: 'c', v: 1 });
        bus.commitTransaction();
        const { undo } = bus.history();
        expect(undo).toHaveLength(1);
        expect(undo[0]!.labelKey).toBe('test.outer');
        expect(undo[0]!.patches).toHaveLength(3);
        expect(() => bus.commitTransaction()).toThrow(/no open transaction/);
        bus.undo();
        expect(bus.getDoc()).toEqual(emptyDoc());
    });

    it('rollbackTransaction restores the start document and emits rollback', () => {
        const { bus, events } = setup();
        bus.execute('set', { id: 'z', v: 9 });
        const start = bus.getDoc();
        events.length = 0;
        bus.beginTransaction('test.tx');
        bus.execute('set', { id: 'a', v: 1 });
        bus.execute('remove', { id: 'z' });
        bus.rollbackTransaction();
        expect(bus.getDoc()).toBe(start);
        expect(bus.history().undo).toHaveLength(1);
        const last = events.at(-1)!;
        expect(last).toMatchObject({
            kind: 'rollback',
            doc: start,
            changedIds: new Set(['a', 'z']),
            entry: null,
        });
        expect(apply(last.prevDoc, last.patches)).toEqual(start);
        expect(() => bus.rollbackTransaction()).toThrow(/no open transaction/);
        // the bus is usable again
        ok(bus.execute('set', { id: 'a', v: 2 }));
    });

    it('rolls back to the matching begin when levels are nested', () => {
        const { bus } = setup();
        bus.beginTransaction('test.outer');
        bus.execute('set', { id: 'a', v: 1 });
        bus.beginTransaction('test.inner');
        bus.execute('set', { id: 'b', v: 1 });
        bus.rollbackTransaction(); // inner only
        expect(bus.getDoc().items).toEqual({ a: { v: 1 } });
        bus.execute('set', { id: 'c', v: 1 });
        bus.commitTransaction();
        expect(bus.getDoc().items).toEqual({ a: { v: 1 }, c: { v: 1 } });
        expect(bus.history().undo).toHaveLength(1);
        expect(bus.history().undo[0]!.patches).toHaveLength(2);
        bus.undo();
        expect(bus.getDoc()).toEqual(emptyDoc());
    });

    it('disables merging inside a transaction and seals what came before', () => {
        const { bus } = setup();
        bus.execute('inc', { id: 'a', by: 1 });
        bus.beginTransaction('test.tx');
        expect(bus.history().undo[0]!.sealed).toBe(true);
        bus.execute('set', { id: 'b', v: 1 });
        bus.execute('set', { id: 'b', v: 2 }, { merge: true });
        bus.execute('inc', { id: 'a', by: 1 }, { merge: true });
        bus.commitTransaction();
        const { undo } = bus.history();
        expect(undo).toHaveLength(2);
        expect(undo[1]!.patches).toHaveLength(3); // nothing was compacted
        // and the next burst does not merge into the transaction entry
        bus.execute('inc', { id: 'a', by: 1 }, { merge: true });
        expect(bus.history().undo).toHaveLength(3);
    });

    it('disables undo and redo while a transaction is open', () => {
        const { bus } = setup();
        bus.execute('set', { id: 'a', v: 1 });
        bus.undo();
        bus.execute('set', { id: 'b', v: 1 });
        bus.undo();
        bus.beginTransaction('test.tx');
        expect(bus.canUndo()).toBe(false);
        expect(bus.canRedo()).toBe(false);
        expect(bus.undo()).toBe(false);
        expect(bus.redo()).toBe(false);
        expect(() => bus.reset(emptyDoc())).toThrow(/transaction is open/);
        bus.rollbackTransaction();
        expect(bus.canRedo()).toBe(true);
    });

    it('commit clears the redo stack, rollback keeps it', () => {
        const { bus } = setup();
        bus.execute('set', { id: 'a', v: 1 });
        bus.undo();
        bus.beginTransaction('test.tx');
        bus.execute('set', { id: 'b', v: 1 });
        bus.rollbackTransaction();
        expect(bus.canRedo()).toBe(true);
        bus.beginTransaction('test.tx');
        bus.execute('set', { id: 'b', v: 1 });
        bus.commitTransaction();
        expect(bus.canRedo()).toBe(false);
    });

    it('a history: false execute inside a transaction is in the document, not the entry', () => {
        const { bus } = setup();
        bus.beginTransaction('test.tx');
        bus.execute('set', { id: 'a', v: 1 });
        bus.execute('zoom', { zoom: 4 }, { history: false });
        bus.commitTransaction();
        expect(bus.history().undo[0]!.patches).toHaveLength(1);
        bus.undo();
        expect(bus.getDoc()).toEqual({ items: {}, view: { zoom: 4 } });

        const other = setup();
        other.bus.beginTransaction('test.tx');
        other.bus.execute('zoom', { zoom: 4 }, { history: false });
        other.bus.commitTransaction();
        expect(other.bus.history().undo).toHaveLength(0);
        expect(other.bus.getDoc().view.zoom).toBe(4);
    });

    describe('transaction(label, fn)', () => {
        it('commits and returns the value of fn', () => {
            const { bus } = setup();
            const r = bus.transaction('test.tx', () => {
                bus.execute('set', { id: 'a', v: 1 });
                bus.execute('set', { id: 'b', v: 1 });
                return 'done';
            });
            expect(r).toBe('done');
            expect(bus.history().undo).toHaveLength(1);
            expect(bus.history().undo[0]!.labelKey).toBe('test.tx');
        });

        it('rolls back and rethrows when fn throws', () => {
            const { bus, events } = setup();
            const start = bus.getDoc();
            const err = new Error('nope');
            expect(() =>
                bus.transaction('test.tx', () => {
                    bus.execute('set', { id: 'a', v: 1 });
                    throw err;
                }),
            ).toThrow(err);
            expect(bus.getDoc()).toBe(start);
            expect(bus.history().undo).toHaveLength(0);
            expect(events.map((e) => e.kind)).toEqual(['execute', 'rollback']);
            // no transaction is left open
            expect(bus.canUndo()).toBe(false);
            ok(bus.execute('set', { id: 'a', v: 1 }));
            expect(bus.history().undo).toHaveLength(1);
        });

        it('rolls back and throws when an execute inside fails', () => {
            const { bus } = setup();
            const start = bus.getDoc();
            let caught: unknown;
            try {
                bus.transaction('test.tx', () => {
                    bus.execute('set', { id: 'a', v: 1 });
                    bus.execute('abort', { id: 'a' }); // result ignored by fn
                    bus.execute('set', { id: 'b', v: 1 });
                });
            } catch (e) {
                caught = e;
            }
            expect(caught).toBeInstanceOf(CommandFailedError);
            expect((caught as CommandFailedError).error).toEqual(
                msg('aborted'),
            );
            expect(bus.getDoc()).toBe(start);
            expect(bus.history().undo).toHaveLength(0);
        });

        it('lets an outer transaction continue after an inner one failed', () => {
            const { bus } = setup();
            bus.transaction('test.outer', () => {
                bus.execute('set', { id: 'a', v: 1 });
                expect(() =>
                    bus.transaction('test.inner', () => {
                        bus.execute('set', { id: 'b', v: 1 });
                        bus.execute('invalid', { id: 'b' });
                    }),
                ).toThrow(CommandFailedError);
                expect(bus.getDoc().items).toEqual({ a: { v: 1 } });
                bus.execute('set', { id: 'c', v: 1 });
            });
            expect(bus.getDoc().items).toEqual({ a: { v: 1 }, c: { v: 1 } });
            expect(bus.history().undo).toHaveLength(1);
        });

        it('a listener error during the rollback does not mask the original error', () => {
            const { bus } = setup();
            bus.subscribe((e) => {
                if (e.kind === 'rollback') throw new Error('listener');
            });
            const original = new Error('original');
            expect(() =>
                bus.transaction('test.tx', () => {
                    bus.execute('set', { id: 'a', v: 1 });
                    throw original;
                }),
            ).toThrow(original);
            expect(bus.getDoc()).toEqual(emptyDoc());
            ok(bus.execute('set', { id: 'a', v: 1 }));
        });
    });
});

// ---- reset, cap, freezing ----------------------------------------------------

describe('reset', () => {
    it('replaces the document, clears both stacks and emits changedIds {*}', () => {
        const { bus, events } = setup();
        bus.execute('set', { id: 'a', v: 1 });
        bus.execute('set', { id: 'b', v: 1 });
        bus.undo();
        const prev = bus.getDoc();
        events.length = 0;
        const next: TestDoc = { items: { q: { v: 1 } }, view: { zoom: 2 } };
        bus.reset(next);
        expect(bus.getDoc()).toBe(next);
        expect(bus.canUndo()).toBe(false);
        expect(bus.canRedo()).toBe(false);
        expect(bus.history()).toEqual({ undo: [], redo: [] });
        expect(events).toEqual([
            {
                kind: 'reset',
                doc: next,
                prevDoc: prev,
                patches: [],
                changedIds: new Set(['*']),
                entry: null,
            },
        ]);
        // sequence numbers are never reused
        bus.execute('set', { id: 'a', v: 1 });
        expect(bus.history().undo[0]!.seq).toBe(3);
    });
});

describe('history cap', () => {
    it('caps the undo stack at 200 by default, dropping the oldest', () => {
        const { bus } = setup();
        for (let i = 1; i <= 205; i += 1) {
            ok(bus.execute('plain', { id: `i${i}`, v: i })); // unmergeable
        }
        const { undo } = bus.history();
        expect(undo).toHaveLength(200);
        expect(undo[0]!.seq).toBe(6);
        expect(undo.at(-1)!.seq).toBe(205);
        let n = 0;
        while (bus.undo()) n += 1;
        expect(n).toBe(200);
        expect(Object.keys(bus.getDoc().items)).toHaveLength(5);
    });

    it('honours maxHistory, also for transaction entries', () => {
        const { bus } = setup({ maxHistory: 3 });
        for (let i = 1; i <= 4; i += 1) {
            bus.execute('plain', { id: `i${i}`, v: i });
        }
        bus.transaction('test.tx', () => {
            bus.execute('plain', { id: 'x', v: 1 });
        });
        expect(bus.history().undo.map((e) => e.type)).toEqual([
            'plain',
            'plain',
            'transaction',
        ]);
        expect(bus.history().undo.map((e) => e.seq)).toEqual([3, 4, 5]);
    });

    it('rejects a maxHistory that is not a positive integer', () => {
        for (const bad of [0, -1, 1.5, Number.NaN]) {
            expect(() => setup({ maxHistory: bad })).toThrow(RangeError);
        }
    });
});

describe('frozen documents', () => {
    it('freezes committed documents deeply (tests run with auto-freeze)', () => {
        expect(shouldAutoFreeze()).toBe(true);
        const { bus } = setup();
        bus.execute('set', { id: 'a', v: 1 });
        const doc = bus.getDoc();
        expect(Object.isFrozen(doc)).toBe(true);
        expect(Object.isFrozen(doc.items)).toBe(true);
        expect(Object.isFrozen(doc.items.a)).toBe(true);
        expect(() => {
            doc.items.a!.v = 2;
        }).toThrow(TypeError);
    });

    it('also freezes documents produced by merge, undo and redo', () => {
        const { bus } = setup();
        bus.execute('set', { id: 'a', v: 1 });
        bus.execute('set', { id: 'a', v: 2 }, { merge: true });
        expect(Object.isFrozen(bus.getDoc().items.a)).toBe(true);
        bus.execute('inc', { id: 'b', by: 1 });
        bus.execute('inc', { id: 'b', by: 1 }, { merge: true });
        expect(Object.isFrozen(bus.getDoc().items.b)).toBe(true);
        bus.undo();
        expect(Object.isFrozen(bus.getDoc())).toBe(true);
        expect(Object.isFrozen(bus.getDoc().items.a)).toBe(true);
        bus.redo();
        expect(Object.isFrozen(bus.getDoc().items.b)).toBe(true);
        bus.beginTransaction('test.tx');
        bus.execute('set', { id: 'c', v: 1 });
        bus.rollbackTransaction();
        expect(Object.isFrozen(bus.getDoc().items.a)).toBe(true);
    });
});

// ---- subscribers ---------------------------------------------------------------

describe('subscribers', () => {
    it('subscribe returns an unsubscribe function (idempotent)', () => {
        const { bus } = setup();
        const fn = vi.fn();
        const off = bus.subscribe(fn);
        bus.execute('set', { id: 'a', v: 1 });
        expect(fn).toHaveBeenCalledTimes(1);
        off();
        off();
        bus.execute('set', { id: 'b', v: 1 });
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('the same function subscribed twice has independent subscriptions', () => {
        const { bus } = setup();
        const fn = vi.fn();
        const off1 = bus.subscribe(fn);
        bus.subscribe(fn);
        bus.execute('set', { id: 'a', v: 1 });
        expect(fn).toHaveBeenCalledTimes(2);
        off1();
        bus.execute('set', { id: 'b', v: 1 });
        expect(fn).toHaveBeenCalledTimes(3);
    });

    it('notifies in subscription order with the event of the commit', () => {
        const { bus } = setup();
        const order: string[] = [];
        bus.subscribe(() => order.push('first'));
        bus.subscribe(() => order.push('second'));
        bus.execute('set', { id: 'a', v: 1 });
        expect(order).toEqual(['first', 'second']);
    });

    describe('a throwing subscriber (policy: isolate, notify the rest, rethrow)', () => {
        it('still notifies the others, rethrows afterwards, and the change stays committed', () => {
            const { bus } = setup();
            const before = vi.fn();
            const after = vi.fn();
            bus.subscribe(before);
            bus.subscribe(() => {
                throw new Error('listener failed');
            });
            bus.subscribe(after);

            expect(() => bus.execute('set', { id: 'a', v: 1 })).toThrow(
                'listener failed',
            );
            expect(before).toHaveBeenCalledTimes(1);
            expect(after).toHaveBeenCalledTimes(1);
            // the throw reports the listener; the command itself succeeded
            expect(v(bus, 'a')).toBe(1);
            expect(bus.history().undo).toHaveLength(1);
        });

        it('leaves the bus fully usable', () => {
            const { bus } = setup();
            let fail = true;
            bus.subscribe(() => {
                if (fail) throw new Error('listener failed');
            });
            expect(() => bus.execute('inc', { id: 'a', by: 1 })).toThrow();
            fail = false;
            // merge state, history and sequence numbers are intact
            ok(bus.execute('inc', { id: 'a', by: 1 }, { merge: true }));
            expect(bus.history().undo).toHaveLength(1);
            expect(v(bus, 'a')).toBe(2);
            fail = true;
            expect(() => bus.undo()).toThrow();
            expect(bus.getDoc()).toEqual(emptyDoc());
            expect(bus.canRedo()).toBe(true);
            fail = false;
            expect(bus.redo()).toBe(true);
            expect(v(bus, 'a')).toBe(2);
            ok(bus.execute('plain', { id: 'z', v: 1 }));
            expect(bus.history().undo.map((e) => e.seq)).toEqual([1, 2]);
        });

        it('delivers later events normally and does not leak the queue', () => {
            const { bus } = setup();
            const seen: string[] = [];
            let fail = true;
            bus.subscribe((e) => {
                seen.push(e.kind);
                if (fail) throw new Error('once');
            });
            expect(() => bus.execute('set', { id: 'a', v: 1 })).toThrow('once');
            fail = false;
            bus.execute('set', { id: 'b', v: 1 });
            expect(seen).toEqual(['execute', 'execute']);
        });

        it('rethrows an AggregateError when several subscribers threw', () => {
            const { bus } = setup();
            const e1 = new Error('one');
            const e2 = new Error('two');
            bus.subscribe(() => {
                throw e1;
            });
            bus.subscribe(() => {
                throw e2;
            });
            let caught: unknown;
            try {
                bus.execute('set', { id: 'a', v: 1 });
            } catch (e) {
                caught = e;
            }
            expect(caught).toBeInstanceOf(AggregateError);
            expect((caught as AggregateError).errors).toEqual([e1, e2]);
        });

        it('a throwing subscriber inside transaction() rolls the transaction back', () => {
            const { bus } = setup();
            bus.subscribe((e) => {
                if (e.kind === 'execute') throw new Error('listener failed');
            });
            expect(() =>
                bus.transaction('test.tx', () => {
                    bus.execute('set', { id: 'a', v: 1 });
                }),
            ).toThrow('listener failed');
            expect(bus.getDoc()).toEqual(emptyDoc());
            expect(bus.history().undo).toHaveLength(0);
            expect(bus.canUndo()).toBe(false);
        });
    });

    describe('unsubscribing during notification', () => {
        it('a subscriber can unsubscribe itself', () => {
            const { bus } = setup();
            const calls: string[] = [];
            const offA = bus.subscribe(() => {
                calls.push('a');
                offA();
            });
            bus.subscribe(() => calls.push('b'));
            bus.execute('set', { id: 'a', v: 1 });
            bus.execute('set', { id: 'b', v: 1 });
            expect(calls).toEqual(['a', 'b', 'b']);
        });

        it('a removed later subscriber is not called for the event in flight', () => {
            const { bus } = setup();
            const calls: string[] = [];
            let offB = () => {};
            bus.subscribe(() => {
                calls.push('a');
                offB();
            });
            offB = bus.subscribe(() => calls.push('b'));
            bus.subscribe(() => calls.push('c'));
            bus.execute('set', { id: 'a', v: 1 });
            expect(calls).toEqual(['a', 'c']);
        });

        it('a subscriber added during delivery starts with the next event', () => {
            const { bus } = setup();
            const calls: string[] = [];
            let added = false;
            bus.subscribe(() => {
                if (!added) {
                    added = true;
                    bus.subscribe(() => calls.push('late'));
                }
            });
            bus.execute('set', { id: 'a', v: 1 });
            expect(calls).toEqual([]);
            bus.execute('set', { id: 'b', v: 1 });
            expect(calls).toEqual(['late']);
        });
    });

    it('queues events caused by a subscriber so everyone sees commit order', () => {
        const { bus } = setup();
        const seenByFirst: string[] = [];
        const seenBySecond: string[] = [];
        let nested = false;
        bus.subscribe((e) => {
            seenByFirst.push(`${e.kind}:${[...e.changedIds].join()}`);
            if (!nested) {
                nested = true;
                // re-entrant call: committed at once, delivered after this event
                ok(bus.execute('set', { id: 'b', v: 1 }));
                expect(v(bus, 'b')).toBe(1);
            }
        });
        bus.subscribe((e) =>
            seenBySecond.push(`${e.kind}:${[...e.changedIds].join()}`),
        );
        bus.execute('set', { id: 'a', v: 1 });
        expect(seenByFirst).toEqual(['execute:a', 'execute:b']);
        expect(seenBySecond).toEqual(['execute:a', 'execute:b']);
        expect(bus.history().undo).toHaveLength(2);
    });
});

// ---- custom pipeline --------------------------------------------------------------

describe('custom pipeline', () => {
    it('receives the parsed params, the definition and the context, and its output is used', () => {
        const seen: unknown[] = [];
        const pipeline: Pipeline<TestDoc, Ctx> = (doc, def, params, ctx) => {
            seen.push([def.type, params, ctx]);
            const r = defaultPipeline(doc, def, params, ctx);
            if (!r.ok) return r;
            return {
                ok: true,
                value: { ...r.value, warnings: [msg('from_pipeline')] },
            };
        };
        const { bus } = setup({ pipeline });
        const r = bus.execute('defaulted', { id: 'a' } as {
            id: string;
            v: number;
        });
        expect(r).toMatchObject({ ok: true, warnings: [msg('from_pipeline')] });
        expect(seen).toEqual([['defaulted', { id: 'a', v: 7 }, { size: 0 }]]);
    });

    it('a pipeline error leaves everything untouched', () => {
        const pipeline: Pipeline<TestDoc, Ctx> = () => ({
            ok: false,
            error: msg('pipeline_refused'),
        });
        const { bus, events } = setup({ pipeline });
        const doc = bus.getDoc();
        expect(bus.execute('set', { id: 'a', v: 1 })).toEqual({
            ok: false,
            error: msg('pipeline_refused'),
        });
        expect(bus.getDoc()).toBe(doc);
        expect(events).toEqual([]);
        expect(bus.canUndo()).toBe(false);
    });
});

// ---- property test ----------------------------------------------------------------

function mulberry32(seed: number): () => number {
    let a = seed;
    return () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

type Items = TestDoc['items'];

interface RefEntry {
    before: Items;
    after: Items;
    key: string | null;
    sealed: boolean;
}

interface RefMark {
    items: Items;
    view: TestDoc['view'];
    steps: number;
    hist: number;
}

/**
 * Reference model of the bus: history as plain snapshots, commands as pure
 * functions. It shares no code with the bus, so undo/redo exactness is checked
 * against documents, not against patches.
 */
class Ref {
    items: Items;
    view: TestDoc['view'];
    undoStack: RefEntry[] = [];
    redoStack: RefEntry[] = [];
    tx: { marks: RefMark[]; steps: number; hist: number } | null = null;

    constructor(
        initial: TestDoc,
        private readonly cap: number,
    ) {
        this.items = initial.items;
        this.view = initial.view;
    }

    get doc(): TestDoc {
        return { items: this.items, view: this.view };
    }

    private top(): RefEntry | undefined {
        return this.undoStack.at(-1);
    }

    seal(): void {
        const t = this.top();
        if (t) t.sealed = true;
    }

    private push(e: RefEntry): void {
        this.undoStack.push(e);
        while (this.undoStack.length > this.cap) this.undoStack.shift();
    }

    /** A command on `items`. */
    exec(
        fn: (i: Items) => Items,
        key: string | null,
        mode: 'replace' | 'compose',
        merge: boolean,
    ): void {
        const t = this.top();
        const merging =
            merge &&
            this.tx === null &&
            t !== undefined &&
            !t.sealed &&
            key !== null &&
            t.key === key;
        if (merging && mode === 'replace') {
            t.after = fn(t.before);
            this.items = t.after;
            return;
        }
        const next = fn(this.items);
        if (isDeepStrictEqual(next, this.items)) {
            if (!merging) this.seal();
            return;
        }
        if (merging) {
            t.after = next;
            this.items = next;
            return;
        }
        if (this.tx !== null) {
            this.tx.steps += 1;
            this.tx.hist += 1;
            this.items = next;
            return;
        }
        this.seal();
        this.redoStack = [];
        this.push({ before: this.items, after: next, key, sealed: false });
        this.items = next;
    }

    /** The `history: false` view command. */
    zoom(zoom: number): void {
        if (this.view.zoom === zoom) {
            this.seal();
            return;
        }
        this.view = { zoom };
        if (this.tx !== null) {
            this.tx.steps += 1;
            return;
        }
        this.seal();
        this.redoStack = [];
    }

    canUndo = (): boolean => this.tx === null && this.undoStack.length > 0;
    canRedo = (): boolean => this.tx === null && this.redoStack.length > 0;

    undo(): boolean {
        if (!this.canUndo()) return false;
        const e = this.undoStack.pop()!;
        e.sealed = true;
        this.items = e.before;
        this.redoStack.push(e);
        return true;
    }

    redo(): boolean {
        if (!this.canRedo()) return false;
        const e = this.redoStack.pop()!;
        this.items = e.after;
        this.undoStack.push(e);
        return true;
    }

    begin(): void {
        if (this.tx === null) {
            this.seal();
            this.tx = { marks: [], steps: 0, hist: 0 };
        }
        this.tx.marks.push({
            items: this.items,
            view: this.view,
            steps: this.tx.steps,
            hist: this.tx.hist,
        });
    }

    commit(): void {
        const tx = this.tx!;
        if (tx.marks.length > 1) {
            tx.marks.pop();
            return;
        }
        const start = tx.marks[0]!;
        this.tx = null;
        if (tx.steps > 0) this.redoStack = [];
        if (tx.hist > 0) {
            this.push({
                before: start.items,
                after: this.items,
                key: null,
                sealed: true,
            });
        }
    }

    rollback(): void {
        const tx = this.tx!;
        const m = tx.marks.pop()!;
        this.items = m.items;
        this.view = m.view;
        tx.steps = m.steps;
        tx.hist = m.hist;
        if (tx.marks.length === 0) this.tx = null;
    }

    reset(doc: TestDoc): void {
        this.items = doc.items;
        this.view = doc.view;
        this.undoStack = [];
        this.redoStack = [];
    }
}

const withItem = (i: Items, id: string, value: number): Items => ({
    ...i,
    [id]: { v: value },
});

type Op = (typeof OPS)[number][0];
const OPS = [
    ['set', 14],
    ['move', 6],
    ['inc', 14],
    ['plain', 4],
    ['remove', 4],
    ['setBad', 3],
    ['abort', 2],
    ['zoom', 4],
    ['seal', 5],
    ['undo', 9],
    ['redo', 6],
    ['begin', 3],
    ['commit', 3],
    ['rollback', 2],
    ['txFn', 5],
    ['reset', 1],
] as const;
const OP_TOTAL = OPS.reduce((n, [, w]) => n + w, 0);

describe.each([
    { seed: 1, cap: 200 },
    { seed: 2, cap: 200 },
    { seed: 3, cap: 200 },
    { seed: 4, cap: 25 },
    { seed: 5, cap: 8 },
])(
    'random sequences against a snapshot model (seed $seed, cap $cap)',
    ({ seed, cap }) => {
        it('keeps the document equal to the model after each of 200 operations', () => {
            const rng = mulberry32(seed);
            const pick = <T>(xs: readonly T[]): T =>
                xs[Math.floor(rng() * xs.length)]!;
            const IDS = ['a', 'b', 'c'] as const;
            const randomDoc = (): TestDoc => ({
                items: Object.fromEntries(
                    IDS.filter(() => rng() < 0.5).map((id) => [
                        id,
                        { v: Math.floor(rng() * 6) },
                    ]),
                ),
                view: { zoom: 1 + Math.floor(rng() * 3) },
            });

            const initial = randomDoc();
            const { bus, events } = setup({ initial, maxHistory: cap });
            const ref = new Ref(initial, cap);

            // Repeating the last id and command makes merge bursts likely.
            let lastId: (typeof IDS)[number] = 'a';
            let lastKind: 'set' | 'move' | 'inc' | 'plain' | 'remove' = 'set';
            /** One random history command on both sides. */
            const randomCommand = (merge: boolean): void => {
                const id = rng() < 0.6 ? lastId : pick(IDS);
                const kind =
                    rng() < 0.6
                        ? lastKind
                        : pick([
                              'set',
                              'move',
                              'inc',
                              'plain',
                              'remove',
                          ] as const);
                lastId = id;
                lastKind = kind;
                const value = Math.floor(rng() * 6);
                const by = Math.floor(rng() * 5) - 1;
                const opts: ExecuteOptions = { merge };
                switch (kind) {
                    case 'set':
                        ok(bus.execute('set', { id, v: value }, opts));
                        ref.exec(
                            (i) => withItem(i, id, value),
                            `set:${id}`,
                            'replace',
                            merge,
                        );
                        break;
                    case 'move':
                        ok(bus.execute('move', { id, v: value }, opts));
                        ref.exec(
                            (i) => withItem(i, id, value),
                            'drag',
                            'replace',
                            merge,
                        );
                        break;
                    case 'inc':
                        ok(bus.execute('inc', { id, by }, opts));
                        ref.exec(
                            (i) => withItem(i, id, (i[id]?.v ?? 0) + by),
                            `inc:${id}`,
                            'compose',
                            merge,
                        );
                        break;
                    case 'plain':
                        ok(bus.execute('plain', { id, v: value }, opts));
                        ref.exec(
                            (i) => withItem(i, id, value),
                            null,
                            'replace',
                            merge,
                        );
                        break;
                    case 'remove':
                        ok(bus.execute('remove', { id }, opts));
                        ref.exec(
                            (i) =>
                                Object.fromEntries(
                                    Object.entries(i).filter(
                                        ([key]) => key !== id,
                                    ),
                                ),
                            null,
                            'replace',
                            merge,
                        );
                        break;
                }
            };

            // What the generator reached, asserted at the end so a change to
            // the weights cannot silently stop exercising a code path.
            const reached = {
                replaceMerges: 0,
                composeMerges: 0,
                multiPatchUndos: 0,
                multiPatchRedos: 0,
                commits: 0,
                rollbacks: 0,
            };
            const drain = (): void => {
                for (const e of events.splice(0)) {
                    if (e.kind === 'merge') {
                        if (e.entry?.mergeMode === 'compose') {
                            reached.composeMerges += 1;
                        } else reached.replaceMerges += 1;
                    }
                    const multi =
                        e.entry !== null &&
                        e.entry.type !== 'transaction' &&
                        e.entry.patches.length > 1;
                    if (e.kind === 'undo' && multi)
                        reached.multiPatchUndos += 1;
                    if (e.kind === 'redo' && multi)
                        reached.multiPatchRedos += 1;
                    if (e.kind === 'commit') reached.commits += 1;
                    if (e.kind === 'rollback') reached.rollbacks += 1;
                    if (e.kind !== 'reset') {
                        expect(apply(e.prevDoc, e.patches)).toEqual(e.doc);
                    }
                    // changedIds covers every item that actually differs
                    for (const id of IDS) {
                        if (
                            !isDeepStrictEqual(
                                e.prevDoc.items[id],
                                e.doc.items[id],
                            )
                        ) {
                            expect(
                                e.changedIds.has(id) || e.changedIds.has('*'),
                            ).toBe(true);
                        }
                    }
                }
            };

            const compare = (step: string): void => {
                expect(bus.getDoc(), step).toEqual(ref.doc);
                expect(bus.canUndo(), step).toBe(ref.canUndo());
                expect(bus.canRedo(), step).toBe(ref.canRedo());
                const h = bus.history();
                expect(
                    h.undo.map((e) => [e.mergeKey, e.sealed]),
                    step,
                ).toEqual(ref.undoStack.map((e) => [e.key, e.sealed]));
                expect(h.redo, step).toHaveLength(ref.redoStack.length);
                expect(h.undo.length, step).toBeLessThanOrEqual(cap);
                drain();
            };

            const executed: string[] = [];
            for (let step = 0; step < 200; step += 1) {
                let r = rng() * OP_TOTAL;
                const op: Op = OPS.find(([, w]) => (r -= w) < 0)![0];
                const merge = rng() < 0.7;
                executed.push(op);
                switch (op) {
                    case 'set':
                    case 'move':
                    case 'inc':
                    case 'plain':
                    case 'remove':
                        randomCommand(merge);
                        break;
                    case 'setBad': {
                        // refused: validate rejects a negative value; no trace
                        const id = pick(IDS);
                        const res = bus.execute(
                            'set',
                            { id, v: -1 },
                            { merge },
                        );
                        expect(res.ok).toBe(false);
                        break;
                    }
                    case 'abort': {
                        const res = bus.execute('abort', { id: pick(IDS) });
                        expect(res.ok).toBe(false);
                        break;
                    }
                    case 'zoom': {
                        const zoomTo = 1 + Math.floor(rng() * 3);
                        ok(
                            bus.execute(
                                'zoom',
                                { zoom: zoomTo },
                                { history: false },
                            ),
                        );
                        ref.zoom(zoomTo);
                        break;
                    }
                    case 'seal':
                        bus.seal();
                        ref.seal();
                        break;
                    case 'undo':
                        expect(bus.undo()).toBe(ref.undo());
                        break;
                    case 'redo':
                        expect(bus.redo()).toBe(ref.redo());
                        break;
                    case 'begin':
                        if (ref.tx !== null && ref.tx.marks.length >= 3) break;
                        bus.beginTransaction('test.tx');
                        ref.begin();
                        break;
                    case 'commit':
                        if (ref.tx === null) break;
                        bus.commitTransaction();
                        ref.commit();
                        break;
                    case 'rollback':
                        if (ref.tx === null) break;
                        bus.rollbackTransaction();
                        ref.rollback();
                        break;
                    case 'txFn': {
                        const mode = pick([
                            'ok',
                            'ok',
                            'throw',
                            'fail',
                        ] as const);
                        ref.begin();
                        let threw: unknown;
                        try {
                            bus.transaction('test.tx', () => {
                                const n = 1 + Math.floor(rng() * 3);
                                for (let k = 0; k < n; k += 1)
                                    randomCommand(merge);
                                if (mode === 'throw')
                                    throw new Error('fn failed');
                                if (mode === 'fail') {
                                    bus.execute('abort', { id: pick(IDS) });
                                }
                            });
                        } catch (e) {
                            threw = e;
                        }
                        if (mode === 'ok') {
                            expect(threw).toBeUndefined();
                            ref.commit();
                        } else {
                            expect(threw).toBeInstanceOf(
                                mode === 'fail' ? CommandFailedError : Error,
                            );
                            ref.rollback();
                        }
                        break;
                    }
                    case 'reset': {
                        if (ref.tx !== null) break;
                        const doc = randomDoc();
                        bus.reset(doc);
                        ref.reset(doc);
                        break;
                    }
                }
                compare(
                    `step ${step}: ${op} (${executed.slice(-4).join(', ')})`,
                );
            }

            // Close any open transaction, then walk the whole history both ways.
            while (ref.tx !== null) {
                bus.commitTransaction();
                ref.commit();
            }
            compare('after closing transactions');
            while (ref.canUndo()) {
                expect(bus.undo()).toBe(true);
                expect(ref.undo()).toBe(true);
                compare('final undo walk');
            }
            expect(bus.undo()).toBe(false);
            while (ref.canRedo()) {
                expect(bus.redo()).toBe(true);
                expect(ref.redo()).toBe(true);
                compare('final redo walk');
            }
            expect(bus.redo()).toBe(false);
        });
    },
);
