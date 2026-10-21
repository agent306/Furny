/**
 * `bedside_table` (07 §2.4.13): a small table on legs with one or two
 * drawers, an open compartment or a door.
 */
import { z } from 'zod';
import type { Content, Front, FurnitureDocument, Section } from '../schema';
import {
    tracked,
    carcassDocument,
    commonCarcass,
    defaultSlideCode,
    dimensionFields,
    drawersContent,
    hingedFront,
    leaf,
    resolveDefaultMaterials,
    selectField,
    shelvesContent,
    split,
} from './common';
import type { TemplateDefinition } from './types';

const VARIANTS = ['drawer_open', 'two_drawers', 'drawer_door'] as const;
const LEG_HEIGHT = 100;
const DRAWER_ROW_HEIGHT = 150;

export const bedsideTableParamsSchema = z.object({
    width: z.number().int().min(300).max(700),
    height: z.number().int().min(400).max(700),
    depth: z.number().int().min(300).max(500),
    variant: z.enum(VARIANTS),
});
export type BedsideTableParams = z.infer<typeof bedsideTableParamsSchema>;

const defaults: BedsideTableParams = {
    width: 450,
    height: 550,
    depth: 400,
    variant: 'drawer_open',
};

export const bedsideTable: TemplateDefinition<BedsideTableParams> = {
    key: 'bedside_table',
    family: 'carcass',
    category: 'storage',
    nameKey: 'templates.bedside_table.name',
    descriptionKey: 'templates.bedside_table.description',
    thumbnail: '/images/templates/bedside_table.svg',
    fields: [
        ...dimensionFields([300, 700], [400, 700], [300, 500]),
        selectField('variant', VARIANTS),
    ],
    defaults,
    paramsSchema: bedsideTableParamsSchema,

    generate(params, ctx): FurnitureDocument {
        const slide = defaultSlideCode(ctx, 'side_mount');
        // One drawer over a lower compartment: open, or shelved behind a door.
        const drawerOver = (lower: Content, into: Section[] = []) =>
            split(
                'rows',
                [
                    [
                        { mode: 'fixed', mm: DRAWER_ROW_HEIGHT },
                        () => leaf(drawersContent(1, slide), ctx),
                    ],
                    [
                        { mode: 'flex', weight: 1 },
                        tracked(into, () => leaf(lower, ctx)),
                    ],
                ],
                ctx,
            );

        let interior: Section;
        let fronts: Front[] = [];
        switch (params.variant) {
            case 'drawer_open':
                interior = drawerOver({ type: 'empty' });
                break;
            case 'two_drawers':
                interior = leaf(drawersContent(2, slide), ctx);
                break;
            case 'drawer_door': {
                const lower: Section[] = [];
                interior = drawerOver(shelvesContent(1), lower);
                fronts = [
                    hingedFront([(lower[0] as Section).id], 1, 'auto', ctx),
                ];
                break;
            }
        }

        return carcassDocument(
            'bedside_table',
            { width: params.width, height: params.height, depth: params.depth },
            resolveDefaultMaterials(bedsideTable, ctx),
            {
                ...commonCarcass(ctx),
                construction: { top: 'over_sides', bottom: 'between_sides' },
                plinth: {
                    type: 'legs',
                    height: LEG_HEIGHT,
                    setback: 0,
                    legCode: null,
                },
                interior,
                fronts,
            },
        );
    },
};
