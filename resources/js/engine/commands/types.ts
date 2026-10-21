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
    /** Opaque editor data (selection before/after); never inspected by the engine. */
    meta: unknown;
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
    entry: Readonly<HistoryEntry> | null;
}

export interface ExecuteOptions {
    merge?: boolean;
    history?: boolean;
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
    beginTransaction(
        labelKey: string,
        labelParams?: Record<string, string | number>,
    ): void;
    commitTransaction(): void;
    rollbackTransaction(): void;
    /**
     * `begin; fn; commit`. Rolls back and rethrows when `fn` throws, and rolls
     * back and throws `CommandFailedError` when any execute inside returned an
     * error (even if `fn` ignored it).
     */
    transaction<T>(
        labelKey: string,
        fn: () => T,
        labelParams?: Record<string, string | number>,
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
}

/**
 * Runs one command on one document without touching any bus state. The bus
 * has already parsed `params` with the command's `paramsSchema`.
 */
export type Pipeline<D, C> = (
    doc: D,
    def: AnyCommandDef<D, C>,
    params: unknown,
    ctx: C,
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
}
