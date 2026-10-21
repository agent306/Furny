/**
 * Building blocks shared by the furniture commands (07 §9): the typed
 * `defineFurnitureCommand`, the refusals (`check*` return one for `validate`,
 * `fail` throws one from `run`), and the write helpers that leave the draft
 * untouched when a value does not change. A command that changes nothing
 * leaves no patch, so the bus drops its entry, and a merged typing burst that
 * returns to its start leaves nothing to undo.
 */
import { current, isDraft } from 'mutative';
import {
    CommandAbort,
    type CommandDef,
    type CommandOutput,
} from '../../commands/types';
import type { EngineMessage } from '../../plan/types';
import type { CarcassSpec, FurnitureDocument, TableSpec } from '../schema';
import {
    furnitureCommandMessage,
    type FurnitureCommandContext,
    type FurnitureCommandErrorCode,
} from './pipeline';

/**
 * Typed identity helper for furniture commands: fixes the document and
 * context types, and the two settings 07 §9 gives every furniture command
 * (`mergeMode 'replace'`, `touchesGeometry false`).
 */
export function defineFurnitureCommand<P, R = void>(
    def: Omit<
        CommandDef<FurnitureDocument, P, FurnitureCommandContext, R>,
        'mergeMode' | 'touchesGeometry'
    >,
): CommandDef<FurnitureDocument, P, FurnitureCommandContext, R> {
    return { ...def, mergeMode: 'replace', touchesGeometry: false };
}

// ---- refusals -------------------------------------------------------------------------------

export const message = furnitureCommandMessage;

export function fail(
    code: FurnitureCommandErrorCode,
    params: EngineMessage['params'] = {},
): never {
    throw new CommandAbort(message(code, params));
}

export const notFound = (id: string): EngineMessage =>
    message('not_found', { id });

/** `out_of_range { field, min, max }` unless `min <= value <= max`. */
export function checkRange(
    field: string,
    value: number,
    min: number,
    max: number,
): EngineMessage | null {
    return value < min || value > max
        ? message('out_of_range', { field, min, max })
        : null;
}

/** The largest length a param may be: the widest overall dimension (03 §2.4). */
export const MAX_MM = 6000;

/** Whole millimetres, without a negative zero. */
export const mm = (value: number): number => Math.round(value) + 0;

/** `not_found { id: 'carcass' }` for a table (no carcass). */
export const checkCarcass = (
    doc: Pick<FurnitureDocument, 'carcass'>,
): EngineMessage | null => (doc.carcass === null ? notFound('carcass') : null);

/** `not_found { id: 'table' }` for a carcass (no table). */
export const checkTable = (
    doc: Pick<FurnitureDocument, 'table'>,
): EngineMessage | null => (doc.table === null ? notFound('table') : null);

/** The carcass of a document `validate` found to have one. */
export function carcassOf(
    doc: Pick<FurnitureDocument, 'carcass'>,
): CarcassSpec {
    return doc.carcass ?? fail('not_found', { id: 'carcass' });
}

/** The table of a document `validate` found to have one. */
export function tableOf(doc: Pick<FurnitureDocument, 'table'>): TableSpec {
    return doc.table ?? fail('not_found', { id: 'table' });
}

/** Records ids the command removed from the document, once each. */
export function pushDeleted(
    out: Pick<CommandOutput<unknown>, 'deletedIds'>,
    ...ids: string[]
): void {
    for (const id of ids) {
        if (!out.deletedIds.includes(id)) out.deletedIds.push(id);
    }
}

// ---- writing --------------------------------------------------------------------------------

type Plain = Record<string, unknown>;

const isPlain = (value: unknown): value is Plain =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

/** Structural equality of two JSON values; an `undefined` field counts as absent. */
export function sameJson(a: unknown, b: unknown): boolean {
    if (Object.is(a, b)) return true;
    if (Array.isArray(a) && Array.isArray(b)) {
        return a.length === b.length && a.every((v, i) => sameJson(v, b[i]));
    }
    if (isPlain(a) && isPlain(b)) {
        const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
        for (const key of keys) {
            if (!sameJson(a[key], b[key])) return false;
        }
        return true;
    }
    return false;
}

/**
 * `target[key] = value` unless it already holds an equal value. Objects and
 * arrays are new references on every call, so without this an unchanged value
 * would still produce a patch.
 */
export function assign<T extends object, K extends keyof T>(
    target: T,
    key: K,
    value: T[K],
): void {
    if (!sameJson(target[key], value)) target[key] = value;
}

/**
 * A deep copy of a value read from the draft, safe to put somewhere else in
 * the doc. A draft must not be moved around, and the plain object a
 * draft stands for may still be part of the committed document: later writes
 * to a value placed in the draft tree go straight to the object, so it must
 * be a copy.
 */
export function snapshot<T>(value: T): T {
    const plain = isDraft(value) ? (current(value as object) as T) : value;
    return structuredClone(plain);
}

/**
 * Deep-merges `patch` into `target`: objects merge field by field, everything
 * else (primitives, arrays, `null`, and the fields named in `atomic`) replaces.
 * `undefined` fields of the patch are skipped.
 */
export function mergeDeep(
    target: object,
    patch: object,
    atomic: ReadonlySet<string> = new Set(),
): void {
    const into = target as Plain;
    for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) continue;
        const existing = into[key];
        if (!atomic.has(key) && isPlain(value) && isPlain(existing)) {
            mergeDeep(existing, value, atomic);
        } else {
            assign(into, key, value);
        }
    }
}

/** Writes the defined fields of `patch` into `target` (a shallow merge). */
export function mergeFields(target: object, patch: object): void {
    const into = target as Plain;
    for (const [key, value] of Object.entries(patch)) {
        if (value !== undefined) assign(into, key, value);
    }
}
