import type { Draft, Patches } from 'mutative';
import type { z } from 'zod';
import type { EngineMessage, Result } from '../plan/types';

/**
 * Types of the generic undoable command bus (04 §6.1). The bus knows nothing
 * about the document it holds; the plan editor (04 §6.4) and the furniture
 * builder (07) each supply a document type, a context and a command registry.
 */

export interface CommandDef<D, P, C, R = void> {
    type: string;
    /** i18n key of the history label, e.g. `engine.plan.command.label.add_wall`. */
    labelKey: string;
    /** Optional params schema; the bus parses `params` with it before anything else. */
    paramsSchema?: z.ZodType<P>;
    /** Interpolation values of the history label, computed from the (parsed) params. */
    labelParams?(params: P): Record<string, string | number>;
    /** Cheap pre-check; no mutation. Returns the error to refuse the command. */
    validate(doc: D, params: P, ctx: C): EngineMessage | null;
    /** Mutates the draft only; throws `CommandAbort` to cancel. */
    run(draft: Draft<D>, params: P, ctx: C, out: CommandOutput<R>): void;
    /** Non-null: mergeable with an unsealed top entry carrying the same key. */
    mergeKey?(params: P): string | null;
    /** `replace` (default): absolute target, e.g. drags. `compose`: relative, e.g. nudges. */
    mergeMode?: 'replace' | 'compose';
    /** Plan: run the geometry post-processing phase (04 §6.4). */
    touchesGeometry: boolean;
}

/**
 * The loosest command shape a registry may hold. Every member of `CommandDef`
 * that mentions `P` or `R` is a method (bivariant), so a command with concrete
 * params and result types is assignable to this without `any`.
 */
export type AnyCommandDef<D, C> = CommandDef<D, unknown, C, unknown>;

export class CommandAbort extends Error {
    constructor(public readonly reason: EngineMessage) {
        super(reason.code);
        this.name = 'CommandAbort';
    }
}

/**
 * Thrown by `CommandBus.transaction` after it rolled back because an execute
 * inside it returned an error (the error is `error`).
 */
export class CommandFailedError extends Error {
    constructor(public readonly error: EngineMessage) {
        super(error.code);
        this.name = 'CommandFailedError';
    }
}

export interface CommandOutput<R> {
    result: R;
    warnings: EngineMessage[];
    deletedIds: string[];
}

export interface HistoryEntry {
    /** Monotonically increasing; never reused, not even after `reset`. */
    seq: number;
    type: string;
    labelKey: string;
    labelParams: Record<string, string | number>;
    patches: Patches;
    inversePatches: Patches;
    mergeKey: string | null;
    mergeMode: 'replace' | 'compose';
    sealed: boolean;
    /** Params of the last merged command (needed for `replace`). */
    lastParams: unknown;
    /** Millisecond timestamp of the last update. */
    at: number;
    /**
     * Opaque editor data (selection before/after); never inspected by the
     * engine. A merge keeps the entry's existing `meta` object (the first
     * step's), so the editor can fill `selectionAfter` into it through the
     * entry it receives with every `merge` event.
     */
    meta: unknown;
    /**
     * Opaque state the pipeline returned for the run that produced this entry
     * (`PipelineOutput.runState`). A `replace` merge hands it back to the
     * pipeline when it re-runs the command, so the re-run can repeat what the
     * first run chose (the plan pipeline replays the ids it issued). The bus
     * never inspects it; absent when the pipeline returned none.
     */
    runState?: unknown;
}

export type ExecuteResult<R> =
    | {
          ok: true;
          result: R;
          warnings: EngineMessage[];
          deletedIds: string[];
          changedIds: ReadonlySet<string>;
      }
    | { ok: false; error: EngineMessage };

export interface BusEvent<D> {
    kind:
        'execute' | 'merge' | 'undo' | 'redo' | 'reset' | 'commit' | 'rollback';
    doc: D;
    prevDoc: D;
    /** Forward patches that produced `doc` from `prevDoc`. */
    patches: Patches;
    /** `'*'` means "everything". */
    changedIds: ReadonlySet<string>;
    /**
     * The entry the event created or updated. `null` for `reset` and
     * `rollback`, for commands that left no entry (`history: false`, inside a
     * transaction), and for a `merge` that returned the document to the start
     * of the merged sequence: that merge drops the now empty entry, so there
     * is nothing left to undo.
     */
    entry: Readonly<HistoryEntry> | null;
}

export interface ExecuteOptions {
    merge?: boolean;
    history?: boolean;
    /** Stored on a new entry; ignored by a merge, which keeps the entry's existing `meta`. */
    meta?: unknown;
}

/** The params type of the command `M[K]`. */
export type ParamsOf<T> = T extends {
    run(draft: never, params: infer P, ...rest: never[]): void;
}
    ? P
    : never;

/** The result type of the command `M[K]` (`unknown` when `run` ignores `out`). */
export type ResultOf<T> = T extends {
    run(
        draft: never,
        params: never,
        ctx: never,
        out: CommandOutput<infer R>,
    ): void;
}
    ? R
    : unknown;

export interface CommandBus<
    D,
    C,
    M extends Record<string, AnyCommandDef<D, C>>,
> {
    getDoc(): D;
    execute<K extends keyof M & string>(
        type: K,
        params: ParamsOf<M[K]>,
        opts?: ExecuteOptions,
    ): ExecuteResult<ResultOf<M[K]>>;
    /** `false` when there is nothing to undo, or while a transaction is open. */
    undo(): boolean;
    /** `false` when there is nothing to redo, or while a transaction is open. */
    redo(): boolean;
    canUndo(): boolean;
    canRedo(): boolean;
    /** Seals the top entry (ends a drag / nudge burst). */
    seal(): void;
    /**
     * Opens a transaction (a nested call opens a savepoint level; only the
     * outermost call's label and `meta` are used for the committed entry).
     */
    beginTransaction(
        labelKey: string,
        labelParams?: Record<string, string | number>,
        meta?: unknown,
    ): void;
    commitTransaction(): void;
    /** Rolls back to the matching `beginTransaction` (the whole transaction at depth 1). */
    rollbackTransaction(): void;
    /**
     * `begin; fn; commit`. Rolls back and rethrows when `fn` throws, and rolls
     * back and throws `CommandFailedError` (carrying the first failure) when
     * any execute inside returned an error, even if `fn` ignored it.
     *
     * `fn` must be synchronous: commands run after its first `await` would
     * land outside the transaction. The type rejects a Promise-returning `fn`,
     * and at run time a returned thenable rolls the transaction back and throws
     * `transaction fn must be synchronous`.
     */
    transaction<T>(
        labelKey: string,
        fn: () => T extends PromiseLike<unknown> ? never : T,
        labelParams?: Record<string, string | number>,
        meta?: unknown,
    ): T;
    /** Replaces the document and clears history (load, restore revision). */
    reset(doc: D): void;
    subscribe(fn: (e: BusEvent<D>) => void): () => void;
    history(): {
        undo: ReadonlyArray<Readonly<HistoryEntry>>;
        redo: ReadonlyArray<Readonly<HistoryEntry>>;
    };
}

export interface PipelineOutput<D> {
    doc: D;
    /** Forward patches from the input document to `doc`. */
    patches: Patches;
    /** Patches that restore the input document from `doc`. */
    inversePatches: Patches;
    result: unknown;
    warnings: EngineMessage[];
    deletedIds: string[];
    /**
     * Opaque state to store on the history entry this run creates or replaces
     * (`HistoryEntry.runState`); `undefined` keeps what the entry has.
     */
    runState?: unknown;
}

/**
 * Runs one command on one document without touching any bus state. The bus
 * has already parsed `params` with the command's `paramsSchema`. `runState`
 * is the `runState` of the entry being re-run by a `replace` merge, and
 * `undefined` for a first run.
 */
export type Pipeline<D, C> = (
    doc: D,
    def: AnyCommandDef<D, C>,
    params: unknown,
    ctx: C,
    runState?: unknown,
) => Result<PipelineOutput<D>>;

export interface CommandBusConfig<
    D,
    C,
    M extends Record<string, AnyCommandDef<D, C>>,
> {
    initial: D;
    registry: M;
    /** Called once per execute with the document the pipeline runs on. */
    getContext(doc: D): C;
    /** Default: `defaultPipeline` (single-phase `create`); plan supplies 04 §6.4. */
    pipeline?: Pipeline<D, C>;
    /** 04 §6.3. `null` ignores the patch; `'*'` means "everything". */
    pathToEntityId(path: (string | number)[]): string | null;
    /** History cap; default 200. */
    maxHistory?: number;
    /** Prefix of the bus' own message keys, e.g. `engine.plan.command` -> `engine.plan.command.invalid_params`. */
    messageKeyPrefix: string;
    /** Clock for `HistoryEntry.at`; default `Date.now`. Injectable for tests. */
    now?: () => number;
    /**
     * Keep the state a `replace` merge re-runs on between steps (default
     * `true`). `false` rebuilds it from the entry's inverse patches every
     * step; the results are identical, only slower. For tests and diagnosis.
     */
    mergeBaseCache?: boolean;
}
