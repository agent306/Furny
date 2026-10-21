/**
 * `dressing_unit` (07 §2.4.18): a tall dresser with a door cabinet on each
 * side of an open mirror niche, and rows of drawers below.
 */
import { z } from 'zod';
import type { Content, FurnitureDocument, Section } from '../schema';
import type { SectionBuilders } from './common';
import {
    tracked,
    carcassDocument,
    commonCarcass,
    defaultSlideCode,
    dimensionFields,
    drawersContent,
    hingedFront,
    intField,
    leaf,
    resolveDefaultMaterials,
    shelvesContent,
    split,
} from './common';
import type { TemplateDefinition } from './types';

const PLINTH_HEIGHT = 80;
const PLINTH_SETBACK = 20;
const SIDE_SHELVES = 3;
/** Height per drawer row, including its share of the divider. */
const DRAWER_ROW_HEIGHT = 170;

export const dressingUnitParamsSchema = z.object({
    width: z.number().int().min(900).max(1800),
    height: z.number().int().min(1500).max(2200),
    depth: z.number().int().min(400).max(600),
    drawerRows: z.number().int().min(2).max(4),
});
export type DressingUnitParams = z.infer<typeof dressingUnitParamsSchema>;

const defaults: DressingUnitParams = {
    width: 1200,
    height: 1800,
    depth: 450,
    drawerRows: 3,
};

export const dressingUnit: TemplateDefinition<DressingUnitParams> = {
    key: 'dressing_unit',
    family: 'carcass',
    category: 'storage',
    nameKey: 'templates.dressing_unit.name',
    descriptionKey: 'templates.dressing_unit.description',
    thumbnail: '/images/templates/dressing_unit.svg',
    fields: [
        ...dimensionFields([900, 1800], [1500, 2200], [400, 600]),
        intField('drawerRows', 2, 4),
    ],
    defaults,
    paramsSchema: dressingUnitParamsSchema,

    generate(params, ctx): FurnitureDocument {
        const slide = defaultSlideCode(ctx, 'side_mount');
        const top: Section[] = [];
        const topColumn = (
            weight: number,
            content: Content,
        ): SectionBuilders[number] => [
            { mode: 'flex', weight },
            tracked(top, () => leaf(content, ctx)),
        ];
        const drawerColumn = (): SectionBuilders[number] => [
            { mode: 'flex', weight: 1 },
            () => leaf(drawersContent(params.drawerRows, slide), ctx),
        ];

        const interior = split(
            'rows',
            [
                [
                    { mode: 'flex', weight: 1 },
                    () =>
                        split(
                            'columns',
                            [
                                topColumn(1, shelvesContent(SIDE_SHELVES)),
                                topColumn(2, { type: 'empty' }),
                                topColumn(1, shelvesContent(SIDE_SHELVES)),
                            ],
                            ctx,
                        ),
                ],
                [
                    {
                        mode: 'fixed',
                        mm: params.drawerRows * DRAWER_ROW_HEIGHT,
                    },
                    () =>
                        split('columns', [drawerColumn(), drawerColumn()], ctx),
                ],
            ],
            ctx,
        );

        return carcassDocument(
            'dressing_unit',
            { width: params.width, height: params.height, depth: params.depth },
            resolveDefaultMaterials(dressingUnit, ctx),
            {
                ...commonCarcass(ctx),
                plinth: {
                    type: 'plinth',
                    height: PLINTH_HEIGHT,
                    setback: PLINTH_SETBACK,
                    legCode: null,
                },
                interior,
                fronts: [
                    hingedFront([(top[0] as Section).id], 1, 'left', ctx),
                    hingedFront([(top[2] as Section).id], 1, 'right', ctx),
                ],
            },
        );
    },
};
