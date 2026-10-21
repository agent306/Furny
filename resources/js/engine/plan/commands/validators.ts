/**
 * Checks and messages shared by the plan commands (04 §6.6 intro): ids that
 * must exist, numeric ranges and the plan size limit. `check*` functions are
 * for `validate` and return the refusal or `null`; `fail` and `assert*` are
 * for `run` and throw a `CommandAbort`. The limits themselves live in
 * `plan/limits.ts`, shared with `validatePlan`.
 */
import { CommandAbort } from '../../commands/types';
import { MAX_COORD, roundMm } from '../../geometry/tolerance';
import { MAX_OPENINGS, MAX_WALLS } from '../limits';
import { cmpId } from '../../compare';
import type { PlanDocument } from '../schema';
import type { EngineMessage } from '../types';
import type { EndpointRef } from './helpers';
import { planCommandMessage, type PlanCommandErrorCode } from './pipeline';

/** A planner's result: the values to write, or the refusal. */
export type Planned<T> = T | { error: EngineMessage };

/** Whether a planner refused. */
export const hasError = <T extends object>(
    v: Planned<T>,
): v is { error: EngineMessage } => 'error' in v;

/** `roundMm` without a negative zero. */
export const mm = (v: number): number => roundMm(v) + 0;

export const has = (record: object, id: string): boolean =>
    Object.hasOwn(record, id);

export function message(
    code: PlanCommandErrorCode,
    params: Record<string, string | number> = {},
): EngineMessage {
    return planCommandMessage(code, params);
}

export function fail(
    code: PlanCommandErrorCode,
    params: Record<string, string | number> = {},
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

/** A node that must exist, or a free point inside the coordinate range. */
export function checkRef(
    doc: Pick<PlanDocument, 'nodes'>,
    ref: EndpointRef,
    field: string,
): EngineMessage | null {
    if ('nodeId' in ref) {
        return has(doc.nodes, ref.nodeId) ? null : notFound(ref.nodeId);
    }
    return (
        checkRange(`${field}.point.x`, ref.point.x, -MAX_COORD, MAX_COORD) ??
        checkRange(`${field}.point.y`, ref.point.y, -MAX_COORD, MAX_COORD)
    );
}

/** `too_large` when `count` more walls would not fit in the plan (`plan.too_large`). */
export function checkCapacity(
    doc: Pick<PlanDocument, 'walls'>,
    count: number,
): EngineMessage | null {
    const walls = Object.keys(doc.walls).length;
    return walls + count > MAX_WALLS
        ? message('too_large', { kind: 'walls', count: walls, max: MAX_WALLS })
        : null;
}

/** `too_large` when one more opening would not fit in the plan (`plan.too_large`). */
export function checkOpeningCapacity(
    doc: Pick<PlanDocument, 'openings'>,
): EngineMessage | null {
    const openings = Object.keys(doc.openings).length;
    return openings + 1 > MAX_OPENINGS
        ? message('too_large', {
              kind: 'openings',
              count: openings,
              max: MAX_OPENINGS,
          })
        : null;
}

/** `out_of_range` unless `|value| <= MAX_COORD`. */
export const checkCoord = (
    field: string,
    value: number,
): EngineMessage | null => checkRange(field, value, -MAX_COORD, MAX_COORD);

/** A free point inside the coordinate range, `field` being the name of the param. */
export function checkPoint(
    field: string,
    point: { x: number; y: number },
): EngineMessage | null {
    return (
        checkCoord(`${field}.x`, point.x) ?? checkCoord(`${field}.y`, point.y)
    );
}

/** `too_large` when one more `kind` entity would not fit in `record` (`plan.too_large`). */
export function checkCollectionCapacity(
    record: object,
    kind: string,
    max: number,
): EngineMessage | null {
    const count = Object.keys(record).length;
    return count + 1 > max ? message('too_large', { kind, count, max }) : null;
}

/** The distinct ids of a selection, in id order. */
export const uniqueSorted = (ids: readonly string[]): string[] =>
    [...new Set(ids)].sort(cmpId);

/** `not_found` for the first id that is not a key of `record`. */
export function checkIds(
    record: object,
    ids: readonly string[],
): EngineMessage | null {
    for (const id of ids) if (!has(record, id)) return notFound(id);
    return null;
}

/**
 * For `run`: aborts `too_large` when the draft holds more walls than a plan
 * may. Commands that split other walls add walls `validate` cannot count.
 */
export function assertWallCapacity(doc: Pick<PlanDocument, 'walls'>): void {
    const walls = Object.keys(doc.walls).length;
    if (walls > MAX_WALLS) {
        fail('too_large', { kind: 'walls', count: walls, max: MAX_WALLS });
    }
}
