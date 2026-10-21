/**
 * `loft_cabinet` (07 §2.4.3): wall-hung storage above a wardrobe or a door.
 */
import { z } from 'zod';
import type { Front, FurnitureDocument, Section } from '../schema';
import type { SectionBuilders } from './common';
import {
    autoDoorCount,
    BOARD_THICKNESS,
    DOORS_MAX,
    outerHingeSide,
    tracked,
    carcassDocument,
    columnsFromDoors,
    commonCarcass,
    dimensionFields,
    fitDoors,
    hingedFront,
    intField,
    leaf,
    otherFront,
    resolveDefaultMaterials,
    selectField,
    split,
} from './common';
import type { TemplateDefinition } from './types';

const FRONT_KINDS = ['hinged', 'flap_up'] as const;

export const loftCabinetParamsSchema = z.object({
    width: z.number().int().min(400).max(3600),
    height: z.number().int().min(300).max(1000),
    depth: z.number().int().min(300).max(750),
    doors: z.union([z.literal('auto'), z.number().int().min(1).max(DOORS_MAX)]),
    frontKind: z.enum(FRONT_KINDS),
});
export type LoftCabinetParams = z.infer<typeof loftCabinetParamsSchema>;

const defaults: LoftCabinetParams = {
    width: 1800,
    height: 600,
    depth: 600,
    doors: 'auto',
    frontKind: 'hinged',
};

export const loftCabinet: TemplateDefinition<LoftCabinetParams> = {
    key: 'loft_cabinet',
    family: 'carcass',
    category: 'wardrobe',
    nameKey: 'templates.loft_cabinet.name',
    descriptionKey: 'templates.loft_cabinet.description',
    thumbnail: '/images/templates/loft_cabinet.svg',
    fields: [
        ...dimensionFields([400, 3600], [300, 1000], [300, 750]),
        intField('doors', 1, DOORS_MAX, { allowAuto: true }),
        selectField('frontKind', FRONT_KINDS),
    ],
    defaults,
    paramsSchema: loftCabinetParamsSchema,

    generate(params, ctx): FurnitureDocument {
        const requested =
            params.doors === 'auto'
                ? autoDoorCount(params.width)
                : params.doors;
        // Fewer doors when the width cannot give each one 100 mm.
        const doors = fitDoors(requested, params.width - 2 * BOARD_THICKNESS);
        const columns = columnsFromDoors(doors);

        const sections: Section[] = [];
        const builders: SectionBuilders = columns.map((doorsInColumn) => [
            { mode: 'flex', weight: doorsInColumn },
            tracked(sections, () => leaf({ type: 'empty' }, ctx)),
        ]);
        // A divided section needs two children, so a single column is the root itself.
        const interior =
            columns.length > 1
                ? split('columns', builders, ctx)
                : (builders[0] as SectionBuilders[number])[1]();

        const fronts: Front[] = columns.map((doorsInColumn, index) => {
            const covers = [(sections[index] as Section).id];
            return params.frontKind === 'hinged'
                ? hingedFront(
                      covers,
                      doorsInColumn,
                      outerHingeSide(doorsInColumn, index, columns.length),
                      ctx,
                  )
                : otherFront('flap_up', covers, 1, ctx);
        });

        return carcassDocument(
            'loft_cabinet',
            { width: params.width, height: params.height, depth: params.depth },
            resolveDefaultMaterials(loftCabinet, ctx),
            {
                ...commonCarcass(ctx),
                mounting: 'loft',
                back: { type: 'nailed' },
                interior,
                fronts,
            },
        );
    },
};
