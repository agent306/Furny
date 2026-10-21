/**
 * `wall_cabinet` (07 §2.4.5): a wall-hung kitchen cabinet with a hinged door,
 * a lift-up flap or an open front.
 */
import { z } from 'zod';
import type { Front, FurnitureDocument } from '../schema';
import {
    carcassDocument,
    commonCarcass,
    dimensionFields,
    hingedFront,
    leaf,
    otherFront,
    resolveDefaultMaterials,
    selectField,
    shelvesContent,
} from './common';
import type { TemplateDefinition } from './types';

const FRONT_KINDS = ['hinged', 'flap_up', 'open'] as const;
/** Cabinets taller than this get a second shelf. */
const TWO_SHELF_HEIGHT = 600;

export const wallCabinetParamsSchema = z.object({
    width: z.number().int().min(300).max(1200),
    height: z.number().int().min(300).max(1000),
    depth: z.number().int().min(250).max(400),
    frontKind: z.enum(FRONT_KINDS),
});
export type WallCabinetParams = z.infer<typeof wallCabinetParamsSchema>;

const defaults: WallCabinetParams = {
    width: 600,
    height: 700,
    depth: 330,
    frontKind: 'hinged',
};

export const wallCabinet: TemplateDefinition<WallCabinetParams> = {
    key: 'wall_cabinet',
    family: 'carcass',
    category: 'kitchen',
    nameKey: 'templates.wall_cabinet.name',
    descriptionKey: 'templates.wall_cabinet.description',
    thumbnail: '/images/templates/wall_cabinet.svg',
    fields: [
        ...dimensionFields([300, 1200], [300, 1000], [250, 400]),
        selectField('frontKind', FRONT_KINDS),
    ],
    defaults,
    paramsSchema: wallCabinetParamsSchema,

    generate(params, ctx): FurnitureDocument {
        const interior = leaf(
            shelvesContent(params.height > TWO_SHELF_HEIGHT ? 2 : 1),
            ctx,
        );
        const fronts: Front[] = [];
        if (params.frontKind === 'hinged') {
            fronts.push(hingedFront([interior.id], 'auto', 'auto', ctx));
        } else if (params.frontKind === 'flap_up') {
            fronts.push(otherFront('flap_up', [interior.id], 1, ctx));
        }
        return carcassDocument(
            'wall_cabinet',
            { width: params.width, height: params.height, depth: params.depth },
            resolveDefaultMaterials(wallCabinet, ctx),
            {
                ...commonCarcass(ctx),
                mounting: 'wall',
                interior,
                fronts,
            },
        );
    },
};
