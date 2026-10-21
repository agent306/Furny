import { z } from 'zod';
import { type Draft } from 'mutative';
import { expect, vi } from 'vitest';
import type { EngineMessage } from '../../plan/types';
import { createCommandBus } from '../bus';
import {
    CommandAbort,
    type BusEvent,
    type CommandDef,
    type Pipeline,
} from '../types';

/**
 * Shared fixture of the bus tests: a small document, a registry of test
 * commands (absolute, relative, refusing, crashing, typed) and a `setup()`
 * that builds a bus with a deterministic clock and an event recorder.
 */

// ---- test document and commands (brief, Task 20) ---------------------------

export interface TestDoc {
    items: Record<string, { v: number }>;
    view: { zoom: number };
}
export interface Ctx {
    size: number;
}

export const msg = (code: string): EngineMessage => ({
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
    labelParams: (p) => ({ id: p.id, by: p.by }),
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

export const registry = {
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

export function pathToEntityId(path: (string | number)[]): string | null {
    if (path.length === 1) return '*';
    if (path[0] === 'items' && typeof path[1] === 'string') return path[1];
    return null;
}

export const emptyDoc = (): TestDoc => ({ items: {}, view: { zoom: 1 } });

export function setup(
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

export type Bus = ReturnType<typeof setup>['bus'];

export const v = (bus: Bus, id: string): number | undefined =>
    bus.getDoc().items[id]?.v;
export const ok = (r: { ok: boolean }): void => {
    expect(r.ok).toBe(true);
};
