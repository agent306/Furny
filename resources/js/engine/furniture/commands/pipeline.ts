/**
 * Furniture command pipeline (07 §9): the generic single-phase pipeline of the
 * bus, then `FurnitureDocumentSchema` on the result. A command that leaves a
 * document the schema rejects is refused with `invalid_document` and changes
 * nothing. Also the context, the message-key prefix and the error codes shared
 * by every furniture command.
 */
import { defaultPipeline } from '../../commands/bus';
import type { Pipeline } from '../../commands/types';
import type { IdPrefix } from '../../ids';
import type { EngineMessage } from '../../plan/types';
import type { CatalogIndex } from '../catalogIndex';
import { FurnitureDocumentSchema, type FurnitureDocument } from '../schema';

/** The message-key prefix of every furniture command message. */
export const FURNITURE_COMMAND_KEY_PREFIX = 'engine.furniture.command';

/** Error codes of furniture commands; `messageKey` is `engine.furniture.command.{code}`. */
export const FURNITURE_COMMAND_ERROR_CODES = [
    'not_found',
    'invalid_params',
    'not_leaf',
    'not_split',
    'out_of_range',
    'invalid_document',
] as const;

export type FurnitureCommandErrorCode =
    (typeof FURNITURE_COMMAND_ERROR_CODES)[number];

/** A furniture command message: `engine.furniture.command.{code}` plus `params`. */
export function furnitureCommandMessage(
    code: FurnitureCommandErrorCode,
    params: EngineMessage['params'] = {},
): EngineMessage {
    return {
        code,
        messageKey: `${FURNITURE_COMMAND_KEY_PREFIX}.${code}`,
        params,
    };
}

export interface FurnitureCommandContext {
    catalog: CatalogIndex;
    /** `engine/ids.ts::newId`; injectable (`testIds()`) for deterministic tests. */
    newId(prefix: Extract<IdPrefix, 's' | 'fr' | 'p' | 'h'>): string;
}

/**
 * The pipeline of the furniture bus (07 §9): `defaultPipeline`, then the
 * schema check of the new doc. `invalid_document` carries the first
 * schema issue as `{ path, issue }`. A command that changed nothing skips the
 * check, since its document is the one it started from.
 */
export const furniturePipeline: Pipeline<
    FurnitureDocument,
    FurnitureCommandContext
> = (doc, def, params, ctx) => {
    const run = defaultPipeline(doc, def, params, ctx);
    if (!run.ok || run.value.patches.length === 0) return run;
    const parsed = FurnitureDocumentSchema.safeParse(run.value.doc);
    if (parsed.success) return run;
    const first = parsed.error.issues[0];
    return {
        ok: false,
        error: furnitureCommandMessage('invalid_document', {
            path: first === undefined ? '' : first.path.map(String).join('.'),
            issue: first === undefined ? 'invalid' : first.code,
        }),
    };
};
