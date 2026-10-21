import { apply, create, type Draft, type Patches } from 'mutative';
import type { EngineMessage, Result } from '../plan/types';
import {
    CommandAbort,
    CommandFailedError,
    type AnyCommandDef,
    type BusEvent,
    type CommandBus,
    type CommandBusConfig,
    type CommandOutput,
    type ExecuteOptions,
    type ExecuteResult,
    type HistoryEntry,
    type Pipeline,
    type PipelineOutput,
} from './types';

/**
 * Generic undoable command bus on mutative (04 §6.1-§6.3).
 *
 * Atomicity: a command first runs against an immutable document and produces a
 * new document plus patches (nothing is shared with the bus yet); only when
 * that and every other fallible step (label params, merge key, entity-id
 * extraction) succeeded does the bus commit, in one synchronous block that
 * cannot throw. So a refused or crashing command leaves the document, both
 * stacks, the open transaction and the merge state exactly as they were, and
 * no subscriber is notified.
 *
 * Subscribers are notified after the commit, in subscription order, and each
 * event is delivered to every subscriber even when some throw (a listener
 * cannot corrupt the bus or starve the others). After the last subscriber was
 * notified the first listener error is rethrown (several: an `AggregateError`)
 * from the call that caused the event, so a failing listener is never silent.
 * That throw reports the listener, not the command: the change is already
 * committed. Listeners may unsubscribe (also themselves) while being notified:
 * a listener removed during delivery is not called for the event still in
 * flight, one added during delivery starts with the next event. An event
 * produced by a listener that calls back into the bus is queued and delivered
 * after the current one, so every subscriber sees events in commit order.
 */

/**
 * Whether committed documents are frozen: in development builds and under
 * Vitest, so an accidental mutation of a committed document throws instead of
 * corrupting history. Production leaves documents unfrozen (04 §6.1).
 */
export function shouldAutoFreeze(): boolean {
    if (import.meta.env?.DEV === true) return true;
    const proc = (
        globalThis as {
            process?: { env?: Record<string, string | undefined> };
        }
    ).process;
    return proc?.env?.VITEST !== undefined;
}

type PatchPath = (string | number)[];

/**
 * The default pipeline (04 §6.1): `validate`, then one `create()` with
 * patches; a thrown `CommandAbort` becomes an error result, any other
 * exception propagates. The bus has already parsed the params.
 */
export function defaultPipeline<D extends object, C>(
    doc: D,
    def: AnyCommandDef<D, C>,
    params: unknown,
    ctx: C,
): Result<PipelineOutput<D>> {
    const invalid = def.validate(doc, params, ctx);
    if (invalid !== null) return { ok: false, error: invalid };
    const out: CommandOutput<unknown> = {
        result: undefined,
        warnings: [],
        deletedIds: [],
    };
    try {
        const [next, patches, inversePatches] = create(
            doc,
            (draft) => {
                def.run(draft as Draft<D>, params, ctx, out);
            },
            { enablePatches: true, enableAutoFreeze: shouldAutoFreeze() },
        ) as [D, Patches, Patches];
        return {
            ok: true,
            value: {
                doc: next,
                patches,
                inversePatches,
                result: out.result,
                warnings: out.warnings,
                deletedIds: out.deletedIds,
            },
        };
    } catch (error) {
        if (error instanceof CommandAbort) {
            return { ok: false, error: error.reason };
        }
        throw error;
    }
}

/** Freezes `value` and everything it holds (documents are plain data). */
function deepFreeze<T>(value: T): T {
    if (typeof value !== 'object' || value === null || Object.isFrozen(value)) {
        return value;
    }
    Object.freeze(value);
    if (value instanceof Map) value.forEach((v) => deepFreeze(v));
    else if (value instanceof Set) value.forEach((v) => deepFreeze(v));
    else Object.values(value).forEach((v) => deepFreeze(v));
    return value;
}

/** In dev and tests the patch lists handed out by the bus cannot be mutated. */
function frozenPatches(patches: Patches): Patches {
    if (shouldAutoFreeze()) {
        for (const patch of patches) Object.freeze(patch);
        Object.freeze(patches);
    }
    return patches;
}

const isThenable = (v: unknown): boolean =>
    (typeof v === 'object' || typeof v === 'function') &&
    v !== null &&
    typeof (v as { then?: unknown }).then === 'function';

/** One executed command inside a transaction. */
interface Step {
    forward: Patches;
    inverse: Patches;
    /** False for `history: false` commands: in the document, not in the entry. */
    history: boolean;
}

/** A transaction level (the base one, or a nested `begin`). */
interface Mark<D> {
    doc: D;
    steps: number;
    /** Number of failures logged when the level opened. */
    failed: number;
}

interface Frame<D> {
    labelKey: string;
    labelParams: Record<string, string | number>;
    meta: unknown;
    steps: Step[];
    /** One mark per open level; the first is the transaction start. */
    marks: Mark<D>[];
    /** Errors of the executes that failed inside this transaction, in order. */
    failed: EngineMessage[];
}

interface Subscription<D> {
    fn: (e: BusEvent<D>) => void;
}

const TRANSACTION_TYPE = 'transaction';

const resultOf = (
    out: PipelineOutput<unknown>,
    changedIds: ReadonlySet<string>,
): ExecuteResult<unknown> => ({
    ok: true,
    result: out.result,
    warnings: out.warnings,
    deletedIds: out.deletedIds,
    changedIds: new Set(changedIds),
});

export function createCommandBus<
    D extends object,
    C,
    M extends Record<string, AnyCommandDef<D, C>>,
>(cfg: CommandBusConfig<D, C, M>): CommandBus<D, C, M> {
    const { registry, getContext, pathToEntityId, messageKeyPrefix } = cfg;
    const pipeline: Pipeline<D, C> = cfg.pipeline ?? defaultPipeline;
    const maxHistory = cfg.maxHistory ?? 200;
    const now = cfg.now ?? Date.now;
    if (!Number.isInteger(maxHistory) || maxHistory < 1) {
        throw new RangeError(
            `createCommandBus: maxHistory must be a positive integer (got ${maxHistory})`,
        );
    }

    let doc: D = cfg.initial;
    let undoStack: Readonly<HistoryEntry>[] = [];
    let redoStack: Readonly<HistoryEntry>[] = [];
    let seq = 0;
    let frame: Frame<D> | null = null;

    // ---- helpers -------------------------------------------------------

    const patchDoc = (base: D, patches: Patches): D =>
        apply(base, patches, { enableAutoFreeze: shouldAutoFreeze() }) as D;

    function idsOf(...lists: Patches[]): ReadonlySet<string> {
        const ids = new Set<string>();
        for (const list of lists) {
            for (const patch of list) {
                const id = pathToEntityId(patch.path as PatchPath);
                if (id !== null) ids.add(id);
            }
        }
        return ids;
    }

    /** An immutable entry; its patch lists are frozen in dev and tests. */
    function makeEntry(e: HistoryEntry): Readonly<HistoryEntry> {
        frozenPatches(e.patches);
        frozenPatches(e.inversePatches);
        return Object.freeze(e);
    }

    const withSealed = (e: Readonly<HistoryEntry>): Readonly<HistoryEntry> =>
        e.sealed ? e : Object.freeze({ ...e, sealed: true });

    function sealTop(): void {
        const top = undoStack.at(-1);
        if (top !== undefined && !top.sealed) {
            undoStack[undoStack.length - 1] = withSealed(top);
        }
    }

    /** Pushes `entry` as the new top; drops the oldest entries beyond the cap. */
    function pushEntry(entry: Readonly<HistoryEntry>): void {
        undoStack.push(entry);
        while (undoStack.length > maxHistory) undoStack.shift();
    }

    function parseParams(
        def: AnyCommandDef<D, C>,
        params: unknown,
    ): Result<unknown> {
        if (def.paramsSchema === undefined) return { ok: true, value: params };
        const parsed = def.paramsSchema.safeParse(params);
        if (parsed.success) return { ok: true, value: parsed.data };
        const first = parsed.error.issues[0];
        return {
            ok: false,
            error: {
                code: 'invalid_params',
                messageKey: `${messageKeyPrefix}.invalid_params`,
                params: {
                    command: def.type,
                    field:
                        first === undefined
                            ? ''
                            : first.path.map(String).join('.'),
                    issue: first === undefined ? 'invalid' : first.code,
                },
            },
        };
    }

    // ---- notification --------------------------------------------------

    const subscriptions = new Set<Subscription<D>>();
    const queue: BusEvent<D>[] = [];
    let delivering = false;

    function notify(event: BusEvent<D>): void {
        frozenPatches(event.patches);
        queue.push(event);
        if (delivering) return;
        delivering = true;
        const errors: unknown[] = [];
        try {
            for (let e = queue.shift(); e !== undefined; e = queue.shift()) {
                for (const sub of [...subscriptions]) {
                    if (!subscriptions.has(sub)) continue;
                    try {
                        // each subscriber gets its own changedIds to play with
                        sub.fn(
                            Object.freeze({
                                ...e,
                                changedIds: new Set(e.changedIds),
                            }),
                        );
                    } catch (error) {
                        errors.push(error);
                    }
                }
            }
        } finally {
            delivering = false;
        }
        if (errors.length === 1) throw errors[0];
        if (errors.length > 1) {
            throw new AggregateError(
                errors,
                `command bus: ${errors.length} subscribers threw`,
            );
        }
    }

    // ---- commits (nothing but `notify` can throw in these) ------------------

    /**
     * A merge into the top entry. `entry` replaces it; `null` drops it (the
     * merged sequence ended where it started, so it would undo nothing).
     */
    function commitMerge(
        next: D,
        entry: Readonly<HistoryEntry> | null,
        patches: Patches,
        changedIds: ReadonlySet<string>,
    ): void {
        const prevDoc = doc;
        doc = next;
        if (entry === null) undoStack.pop();
        else undoStack[undoStack.length - 1] = entry;
        notify({ kind: 'merge', doc, prevDoc, patches, changedIds, entry });
    }

    /** A new change: a pushed entry, or a step of the open transaction. */
    function commitChange(
        out: PipelineOutput<D>,
        entry: Readonly<HistoryEntry> | null,
        history: boolean,
        changedIds: ReadonlySet<string>,
    ): void {
        const prevDoc = doc;
        doc = out.doc;
        if (frame !== null) {
            frame.steps.push({
                forward: out.patches,
                inverse: out.inversePatches,
                history,
            });
        } else {
            sealTop();
            redoStack = [];
            if (entry !== null) {
                seq = entry.seq;
                pushEntry(entry);
            }
        }
        notify({
            kind: 'execute',
            doc,
            prevDoc,
            patches: out.patches,
            changedIds,
            entry,
        });
    }

    // ---- execute -------------------------------------------------------

    function execute<K extends keyof M & string>(
        type: K,
        params: unknown,
        opts: ExecuteOptions = {},
    ): ExecuteResult<unknown> {
        const def = Object.hasOwn(registry, type) ? registry[type] : undefined;
        if (def === undefined) {
            throw new Error(
                `command bus: unknown command ${JSON.stringify(type)}`,
            );
        }

        const refused = (error: EngineMessage): ExecuteResult<unknown> => {
            frame?.failed.push(error);
            return { ok: false, error };
        };

        const parsed = parseParams(def, params);
        if (!parsed.ok) return refused(parsed.error);
        const p = parsed.value;

        const wantHistory = opts.history !== false;
        const mergeKey = def.mergeKey?.(p) ?? null;
        const mode = def.mergeMode ?? 'replace';
        const top = undoStack.at(-1);
        const merging =
            opts.merge === true &&
            frame === null &&
            wantHistory &&
            top !== undefined &&
            !top.sealed &&
            mergeKey !== null &&
            top.mergeKey === mergeKey;
        /** `top` with new patches; `meta` stays the entry's existing object. */
        const merged = (patches: Patches, inversePatches: Patches) =>
            makeEntry({
                ...top!,
                patches,
                inversePatches,
                mergeMode: mode,
                labelParams: def.labelParams?.(p) ?? {},
                lastParams: p,
                at: now(),
            });

        // 04 §6.2-3 `replace`: re-run on the state before the merged sequence.
        if (merging && mode === 'replace') {
            const base = patchDoc(doc, top.inversePatches);
            const run = pipeline(base, def, p, getContext(base));
            if (!run.ok) return refused(run.error);
            const out = run.value;
            // doc -> base -> new doc, so ids touched by the old drag count too
            const patches = [...top.inversePatches, ...out.patches];
            const changedIds = idsOf(patches);
            const entry =
                out.patches.length === 0
                    ? null
                    : merged(out.patches, out.inversePatches);
            commitMerge(out.doc, entry, patches, changedIds);
            return resultOf(out, changedIds);
        }

        const run = pipeline(doc, def, p, getContext(doc));
        if (!run.ok) return refused(run.error);
        const out = run.value;

        // A command that changed nothing: no entry, no event, redo survives.
        if (out.patches.length === 0) {
            if (!merging) sealTop();
            return resultOf(out, new Set());
        }
        const changedIds = idsOf(out.patches);

        // 04 §6.2-3 `compose`: run on the current document, append the patches.
        if (merging) {
            const entry = merged(
                [...top.patches, ...out.patches],
                [...out.inversePatches, ...top.inversePatches],
            );
            commitMerge(out.doc, entry, out.patches, changedIds);
            return resultOf(out, changedIds);
        }

        const entry =
            frame !== null || !wantHistory
                ? null
                : makeEntry({
                      seq: seq + 1,
                      type: def.type,
                      labelKey: def.labelKey,
                      labelParams: def.labelParams?.(p) ?? {},
                      patches: out.patches,
                      inversePatches: out.inversePatches,
                      mergeKey,
                      mergeMode: mode,
                      sealed: false,
                      lastParams: p,
                      at: now(),
                      meta: opts.meta ?? null,
                  });
        commitChange(out, entry, wantHistory, changedIds);
        return resultOf(out, changedIds);
    }

    // ---- undo / redo ---------------------------------------------------

    function step(direction: 'undo' | 'redo'): boolean {
        const from = direction === 'undo' ? undoStack : redoStack;
        const entry = from.at(-1);
        if (frame !== null || entry === undefined) return false;
        const patches =
            direction === 'undo' ? entry.inversePatches : entry.patches;
        const next = patchDoc(doc, patches);
        const changedIds = idsOf(patches);
        const sealed = withSealed(entry);
        const prevDoc = doc;
        doc = next;
        from.pop();
        if (direction === 'undo') redoStack.push(sealed);
        else undoStack.push(sealed);
        notify({
            kind: direction,
            doc,
            prevDoc,
            patches,
            changedIds,
            entry: sealed,
        });
        return true;
    }

    // ---- transactions --------------------------------------------------

    function beginTransaction(
        labelKey: string,
        labelParams: Record<string, string | number> = {},
        meta: unknown = null,
    ): void {
        if (frame === null) {
            sealTop();
            frame = {
                labelKey,
                labelParams: { ...labelParams },
                meta,
                steps: [],
                marks: [],
                failed: [],
            };
        }
        frame.marks.push({
            doc,
            steps: frame.steps.length,
            failed: frame.failed.length,
        });
    }

    function commitTransaction(): void {
        const f = frame;
        if (f === null) throw new Error('command bus: no open transaction');
        // A nested level only closes; the outermost one writes the entry.
        if (f.marks.length > 1) {
            f.marks.pop();
            return;
        }
        const start = f.marks[0]!;
        const kept = f.steps.filter((s) => s.history);
        const forward = f.steps.flatMap((s) => s.forward);
        const changedIds = idsOf(forward);
        const entry =
            kept.length === 0
                ? null
                : makeEntry({
                      seq: seq + 1,
                      type: TRANSACTION_TYPE,
                      labelKey: f.labelKey,
                      labelParams: f.labelParams,
                      patches: kept.flatMap((s) => s.forward),
                      inversePatches: kept
                          .toReversed()
                          .flatMap((s) => s.inverse),
                      mergeKey: null,
                      mergeMode: 'replace',
                      sealed: true,
                      lastParams: null,
                      at: now(),
                      meta: f.meta,
                  });
        frame = null;
        if (f.steps.length > 0) redoStack = [];
        if (entry === null) return;
        seq = entry.seq;
        pushEntry(entry);
        notify({
            kind: 'commit',
            doc,
            prevDoc: start.doc,
            patches: forward,
            changedIds,
            entry,
        });
    }

    function rollbackTransaction(): void {
        const f = frame;
        if (f === null) throw new Error('command bus: no open transaction');
        // Back to the matching begin: the whole transaction at depth 1.
        const mark = f.marks.at(-1)!;
        const undone = f.steps.slice(mark.steps).toReversed();
        const patches = undone.flatMap((s) => s.inverse);
        const changedIds = idsOf(patches);
        const prevDoc = doc;
        // the restored document may predate auto-freeze (e.g. `initial`)
        doc = shouldAutoFreeze() ? deepFreeze(mark.doc) : mark.doc;
        f.steps.length = mark.steps;
        f.failed.length = mark.failed;
        f.marks.pop();
        if (f.marks.length === 0) frame = null;
        notify({
            kind: 'rollback',
            doc,
            prevDoc,
            patches,
            changedIds,
            entry: null,
        });
    }

    function transaction(
        labelKey: string,
        fn: () => unknown,
        labelParams?: Record<string, string | number>,
        meta?: unknown,
    ): unknown {
        beginTransaction(labelKey, labelParams, meta);
        const f = frame!;
        const failedBefore = f.failed.length;
        // Roll back; a listener error raised by the rollback event must not
        // hide the error that caused it.
        const abort = (): void => {
            try {
                rollbackTransaction();
            } catch {
                // state was restored before notifying; the original error wins
            }
        };
        let value: unknown;
        try {
            value = fn();
        } catch (error) {
            abort();
            throw error;
        }
        if (isThenable(value)) {
            abort();
            // nobody will await it: do not leave an unhandled rejection behind
            void Promise.resolve(value).catch(() => {});
            throw new Error('command bus: transaction fn must be synchronous');
        }
        if (f.failed.length > failedBefore) {
            const error = f.failed[failedBefore]!; // the first failure
            abort();
            throw new CommandFailedError(error);
        }
        commitTransaction();
        return value;
    }

    // ---- public --------------------------------------------------------

    return {
        getDoc: () => doc,
        execute: execute as CommandBus<D, C, M>['execute'],
        undo: () => step('undo'),
        redo: () => step('redo'),
        canUndo: () => frame === null && undoStack.length > 0,
        canRedo: () => frame === null && redoStack.length > 0,
        seal: sealTop,
        beginTransaction,
        commitTransaction,
        rollbackTransaction,
        transaction: transaction as CommandBus<D, C, M>['transaction'],
        reset(next: D): void {
            if (frame !== null) {
                throw new Error(
                    'command bus: reset() while a transaction is open',
                );
            }
            const prevDoc = doc;
            doc = next;
            undoStack = [];
            redoStack = [];
            notify({
                kind: 'reset',
                doc,
                prevDoc,
                patches: [],
                changedIds: new Set(['*']),
                entry: null,
            });
        },
        subscribe(fn): () => void {
            const sub: Subscription<D> = { fn };
            subscriptions.add(sub);
            return () => {
                subscriptions.delete(sub);
            };
        },
        history: () => ({ undo: [...undoStack], redo: [...redoStack] }),
    };
}
