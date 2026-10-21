import { isDeepStrictEqual } from 'node:util';
import { apply } from 'mutative';
import { describe, expect, it } from 'vitest';
import { CommandFailedError, type ExecuteOptions } from '../types';
import { ok, setup, type TestDoc } from './busFixture';

/**
 * Random operation sequences against a reference model that keeps plain
 * document snapshots (see `Ref`). The model shares no code with the bus.
 */

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
            // a merge that ends where the sequence started leaves nothing to undo
            if (isDeepStrictEqual(t.after, t.before)) this.undoStack.pop();
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

type Op =
    | 'set'
    | 'move'
    | 'inc'
    | 'burst'
    | 'nudgeUndo'
    | 'plain'
    | 'remove'
    | 'setBad'
    | 'abort'
    | 'zoom'
    | 'seal'
    | 'undo'
    | 'redo'
    | 'begin'
    | 'commit'
    | 'rollback'
    | 'txFn'
    | 'reset';

type Weights = Record<Op, number>;

const WEIGHTS: Weights = {
    set: 8,
    move: 4,
    inc: 8,
    burst: 16,
    nudgeUndo: 4,
    plain: 4,
    remove: 4,
    setBad: 3,
    abort: 2,
    zoom: 4,
    seal: 3,
    undo: 10,
    redo: 7,
    begin: 2,
    commit: 4,
    rollback: 2,
    txFn: 6,
    reset: 2.5,
};

/** Few undos, seals and resets, so the history grows until it hits the cap. */
const GROWING: Weights = {
    ...WEIGHTS,
    seal: 1,
    undo: 1,
    redo: 0.5,
    reset: 0,
    plain: 60,
    rollback: 1,
};

/** Counts of what a run exercised; the minimums are asserted per run. */
interface Reached {
    replaceMerges: number;
    composeMerges: number;
    /** `merge` events that dropped the entry (the drag returned to its start) */
    droppedMerges: number;
    mergesInTransaction: number;
    multiPatchUndos: number;
    multiPatchRedos: number;
    commits: number;
    rollbacks: number;
    resets: number;
    capHit: boolean;
}

const MINIMUM: Omit<Reached, 'capHit'> = {
    replaceMerges: 10,
    composeMerges: 10,
    droppedMerges: 1,
    mergesInTransaction: 10,
    multiPatchUndos: 3,
    multiPatchRedos: 2,
    commits: 3,
    rollbacks: 3,
    resets: 1,
};

describe.each([
    { seed: 1, cap: 200, ops: 200, hitsCap: false },
    { seed: 2, cap: 200, ops: 200, hitsCap: false },
    { seed: 3, cap: 200, ops: 200, hitsCap: false },
    { seed: 4, cap: 25, ops: 200, hitsCap: false },
    { seed: 5, cap: 8, ops: 200, hitsCap: true },
    // enough operations for the default 200-entry cap to be reached
    { seed: 6, cap: 200, ops: 1500, hitsCap: true, growing: true },
])(
    'random sequences against a snapshot model (seed $seed, cap $cap, $ops operations)',
    ({ seed, cap, ops, hitsCap, growing }) => {
        const weights = growing === true ? GROWING : WEIGHTS;
        const total = Object.values(weights).reduce((n, w) => n + w, 0);
        it('keeps the document equal to the model after every operation', () => {
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

            type Kind = 'set' | 'move' | 'inc' | 'plain' | 'remove';
            /** One random history command on both sides (or the given kind and id). */
            const randomCommand = (
                merge: boolean,
                forced?: { kind: Kind; id: (typeof IDS)[number] },
            ): void => {
                const id = forced?.id ?? pick(IDS);
                const kind =
                    forced?.kind ??
                    pick(['set', 'move', 'inc', 'plain', 'remove'] as const);
                const value = Math.floor(rng() * 6);
                const by = Math.floor(rng() * 5) - 1;
                const opts: ExecuteOptions = { merge };
                if (merge && ref.tx !== null) reached.mergesInTransaction += 1;
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
            const reached: Reached = {
                replaceMerges: 0,
                composeMerges: 0,
                droppedMerges: 0,
                mergesInTransaction: 0,
                multiPatchUndos: 0,
                multiPatchRedos: 0,
                commits: 0,
                rollbacks: 0,
                resets: 0,
                capHit: false,
            };
            const drain = (): void => {
                for (const e of events.splice(0)) {
                    if (e.kind === 'merge') {
                        if (e.entry === null) reached.droppedMerges += 1;
                        else if (e.entry.mergeMode === 'compose') {
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
                if (h.undo.length === cap) reached.capHit = true;
                drain();
            };

            const executed: string[] = [];
            for (let step = 0; step < ops; step += 1) {
                let r = rng() * total;
                const op = (Object.keys(weights) as Op[]).find(
                    (name) => (r -= weights[name]) < 0,
                )!;
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
                    case 'burst': {
                        // a drag or a nudge burst: the same command, merging
                        const kind = pick(['set', 'move', 'inc'] as const);
                        const id = pick(IDS);
                        const n = 2 + Math.floor(rng() * 5);
                        for (let k = 0; k < n; k += 1) {
                            randomCommand(true, { kind, id });
                            if (k < n - 1) compare(`burst ${step}.${k}`);
                        }
                        break;
                    }
                    case 'nudgeUndo': {
                        // nudges, then undo and redo of the composed entry
                        const id = pick(IDS);
                        const n = 2 + Math.floor(rng() * 4);
                        for (let k = 0; k < n; k += 1) {
                            randomCommand(true, { kind: 'inc', id });
                        }
                        compare(`nudges ${step}`);
                        expect(bus.undo()).toBe(ref.undo());
                        compare(`nudges undo ${step}`);
                        expect(bus.redo()).toBe(ref.redo());
                        break;
                    }
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
                        reached.resets += 1;
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

            const minimum =
                growing === true ? { ...MINIMUM, resets: 0 } : MINIMUM;
            for (const [what, min] of Object.entries(minimum)) {
                expect(
                    reached[what as keyof typeof MINIMUM],
                    `${what} reached`,
                ).toBeGreaterThanOrEqual(min);
            }
            if (hitsCap)
                expect(reached.capHit, 'history cap reached').toBe(true);
        });
    },
);
