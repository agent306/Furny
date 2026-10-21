/**
 * Front commands (07 §9): `addFront`, `updateFront` and `removeFront`. Each
 * re-syncs `behindDoor` of the drawers (`syncBehindDoor`). A front must cover
 * at least one section, and every section it covers must exist.
 */
import { z } from 'zod';
import type { EngineMessage } from '../../plan/types';
import { FrontSchema, type FurnitureDocument } from '../schema';
import {
    carcassOf,
    checkCarcass,
    defineFurnitureCommand,
    mergeFields,
    notFound,
} from './helpers';
import { findSection, syncBehindDoor } from './sections';

const FrontFieldsSchema = FrontSchema.omit({ id: true }).extend({
    covers: z.array(z.string()).min(1),
});

/** `not_found` for the first of `covers` that is not a section. */
function checkCovers(
    doc: Pick<FurnitureDocument, 'carcass'>,
    covers: readonly string[],
): EngineMessage | null {
    const missing = checkCarcass(doc);
    if (missing !== null) return missing;
    const root = doc.carcass!.interior;
    const unknown = covers.find((id) => findSection(root, id) === undefined);
    return unknown === undefined ? null : notFound(unknown);
}

// ---- addFront -------------------------------------------------------------------------------

type AddFrontParams = z.infer<typeof FrontFieldsSchema>;

const addFront = defineFurnitureCommand<AddFrontParams, { frontId: string }>({
    type: 'furniture.addFront',
    labelKey: 'engine.furniture.command.label.add_front',
    paramsSchema: FrontFieldsSchema,
    validate: (doc, p) => checkCovers(doc, p.covers),
    run(d, p, ctx, out) {
        const id = ctx.newId('fr');
        carcassOf(d).fronts.push({ ...p, covers: [...new Set(p.covers)], id });
        syncBehindDoor(d);
        out.result = { frontId: id };
    },
});

// ---- updateFront ----------------------------------------------------------------------------

const UpdateFrontSchema = z.object({
    frontId: z.string(),
    patch: FrontFieldsSchema.partial(),
});
type UpdateFrontParams = z.infer<typeof UpdateFrontSchema>;

const updateFront = defineFurnitureCommand<UpdateFrontParams>({
    type: 'furniture.updateFront',
    labelKey: 'engine.furniture.command.label.update_front',
    paramsSchema: UpdateFrontSchema,
    validate(doc, p) {
        const missing = checkCarcass(doc);
        if (missing !== null) return missing;
        if (!doc.carcass!.fronts.some((f) => f.id === p.frontId)) {
            return notFound(p.frontId);
        }
        return p.patch.covers === undefined
            ? null
            : checkCovers(doc, p.patch.covers);
    },
    run(d, p) {
        const front = carcassOf(d).fronts.find((f) => f.id === p.frontId)!;
        mergeFields(front, {
            ...p.patch,
            ...(p.patch.covers === undefined
                ? {}
                : { covers: [...new Set(p.patch.covers)] }),
        });
        syncBehindDoor(d);
    },
    mergeKey: (p) => `front:${p.frontId}`,
});

// ---- removeFront ----------------------------------------------------------------------------

const RemoveFrontSchema = z.object({ frontId: z.string() });
type RemoveFrontParams = z.infer<typeof RemoveFrontSchema>;

const removeFront = defineFurnitureCommand<RemoveFrontParams>({
    type: 'furniture.removeFront',
    labelKey: 'engine.furniture.command.label.remove_front',
    paramsSchema: RemoveFrontSchema,
    validate(doc, p) {
        return (
            checkCarcass(doc) ??
            (doc.carcass!.fronts.some((f) => f.id === p.frontId)
                ? null
                : notFound(p.frontId))
        );
    },
    run(d, p, _ctx, out) {
        const fronts = carcassOf(d).fronts;
        fronts.splice(
            fronts.findIndex((f) => f.id === p.frontId),
            1,
        );
        out.deletedIds.push(p.frontId);
        syncBehindDoor(d);
    },
});

/** The front commands, registered in `FURNITURE_COMMANDS` (07 §9). */
export const FRONT_COMMANDS = {
    'furniture.addFront': addFront,
    'furniture.updateFront': updateFront,
    'furniture.removeFront': removeFront,
};
