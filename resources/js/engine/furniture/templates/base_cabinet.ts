/**
 * `base_cabinet` (07 §2.4.4): a kitchen base unit on adjustable legs with a
 * kickboard, as a door, drawer, door-and-drawer or pull-out basket unit.
 */
import { z } from 'zod';
import type { Front, FurnitureDocument, Section } from '../schema';
import {
    booleanField,
    carcassDocument,
    commonCarcass,
    defaultSlideCode,
    dimensionFields,
    drawersContent,
    fitDrawers,
    hingedFront,
    intField,
    interiorHeight,
    leaf,
    lengthField,
    resolveDefaultMaterials,
    selectField,
    shelvesContent,
    split,
} from './common';
import type { TemplateDefinition } from './types';

const VARIANTS = ['door', 'drawers', 'door_drawer', 'basket'] as const;
const LEG_SETBACK = 50;
const COUNTERTOP_OVERHANG_FRONT = 20;
const DRAWER_ROW_HEIGHT = 150;
const BASKET_COUNT = 2;
/** The worktop board the countertop material preference selects. */
const COUNTERTOP_THICKNESS = 25;
/** With a countertop the top role prefers a thick worktop board (a conditional preference). */
const COUNTERTOP_MATERIALS: Pick<TemplateDefinition, 'preferredMaterials'> = {
    preferredMaterials: { top: ['PB25-WHITE'] },
};

export const baseCabinetParamsSchema = z.object({
    width: z.number().int().min(150).max(1200),
    height: z.number().int().min(700).max(950),
    depth: z.number().int().min(450).max(650),
    variant: z.enum(VARIANTS),
    drawerCount: z.number().int().min(2).max(5),
    countertop: z.boolean(),
    plinthHeight: z.number().int().min(80).max(150),
});
export type BaseCabinetParams = z.infer<typeof baseCabinetParamsSchema>;

const defaults: BaseCabinetParams = {
    width: 600,
    height: 850,
    depth: 560,
    variant: 'door',
    drawerCount: 3,
    countertop: false,
    plinthHeight: 100,
};

export const baseCabinet: TemplateDefinition<BaseCabinetParams> = {
    key: 'base_cabinet',
    family: 'carcass',
    category: 'kitchen',
    nameKey: 'templates.base_cabinet.name',
    descriptionKey: 'templates.base_cabinet.description',
    thumbnail: '/images/templates/base_cabinet.svg',
    fields: [
        ...dimensionFields([150, 1200], [700, 950], [450, 650]),
        selectField('variant', VARIANTS),
        intField('drawerCount', 2, 5, {
            visibleIf: { key: 'variant', equals: 'drawers' },
        }),
        booleanField('countertop'),
        lengthField('plinthHeight', 80, 150, { advanced: true }),
    ],
    defaults,
    paramsSchema: baseCabinetParamsSchema,

    generate(params, ctx): FurnitureDocument {
        const slide = defaultSlideCode(ctx, 'undermount');
        let interior: Section;
        let fronts: Front[] = [];
        switch (params.variant) {
            case 'door': {
                interior = leaf(shelvesContent(1), ctx);
                fronts = [hingedFront([interior.id], 'auto', 'auto', ctx)];
                break;
            }
            case 'drawers': {
                // Fewer drawers when the height leaves boxes under 60 mm.
                const count = fitDrawers(
                    params.drawerCount,
                    interiorHeight(params.height, params.plinthHeight) -
                        (params.countertop ? COUNTERTOP_THICKNESS : 0),
                );
                interior = leaf(drawersContent(count, slide), ctx);
                break;
            }
            case 'door_drawer': {
                let shelvesRow: Section | undefined;
                interior = split(
                    'rows',
                    [
                        [
                            { mode: 'fixed', mm: DRAWER_ROW_HEIGHT },
                            () => leaf(drawersContent(1, slide), ctx),
                        ],
                        [
                            { mode: 'flex', weight: 1 },
                            () => (shelvesRow = leaf(shelvesContent(1), ctx)),
                        ],
                    ],
                    ctx,
                );
                fronts = [
                    hingedFront(
                        [(shelvesRow as Section).id],
                        'auto',
                        'auto',
                        ctx,
                    ),
                ];
                break;
            }
            case 'basket': {
                interior = leaf(
                    {
                        type: 'pull_out_basket',
                        count: BASKET_COUNT,
                        basketCode: null,
                    },
                    ctx,
                );
                fronts = [hingedFront([interior.id], 1, 'auto', ctx)];
                break;
            }
        }

        return carcassDocument(
            'base_cabinet',
            { width: params.width, height: params.height, depth: params.depth },
            resolveDefaultMaterials(
                params.countertop ? COUNTERTOP_MATERIALS : {},
                ctx,
            ),
            {
                ...commonCarcass(ctx),
                plinth: {
                    type: 'legs',
                    height: params.plinthHeight,
                    setback: LEG_SETBACK,
                    legCode: null,
                },
                countertop: params.countertop
                    ? {
                          enabled: true,
                          overhangFront: COUNTERTOP_OVERHANG_FRONT,
                          overhangLeft: 0,
                          overhangRight: 0,
                      }
                    : null,
                interior,
                fronts,
            },
        );
    },
};
