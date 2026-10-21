/**
 * `tv_unit` (07 §2.4.9): a low media cabinet, on visible legs or wall-hung,
 * in three layouts.
 */
import { z } from 'zod';
import type { Front, FurnitureDocument, Section } from '../schema';
import type { SectionBuilders } from './common';
import {
    tracked,
    carcassDocument,
    commonCarcass,
    defaultSlideCode,
    dimensionFields,
    drawersContent,
    fitDrawers,
    hingedFront,
    interiorHeight,
    leaf,
    otherFront,
    resolveDefaultMaterials,
    selectField,
    shelvesContent,
    split,
} from './common';
import type { TemplateDefinition } from './types';

const MOUNTINGS = ['floor', 'wall'] as const;
const LAYOUTS = ['drawers_open_door', 'doors_open_doors', 'flaps'] as const;
const LEG_HEIGHT = 100;

export const tvUnitParamsSchema = z.object({
    width: z.number().int().min(900).max(3000),
    height: z.number().int().min(300).max(700),
    depth: z.number().int().min(300).max(550),
    mounting: z.enum(MOUNTINGS),
    layout: z.enum(LAYOUTS),
});
export type TvUnitParams = z.infer<typeof tvUnitParamsSchema>;

const defaults: TvUnitParams = {
    width: 1800,
    height: 450,
    depth: 400,
    mounting: 'floor',
    layout: 'drawers_open_door',
};

export const tvUnit: TemplateDefinition<TvUnitParams> = {
    key: 'tv_unit',
    family: 'carcass',
    category: 'tv_unit',
    nameKey: 'templates.tv_unit.name',
    descriptionKey: 'templates.tv_unit.description',
    thumbnail: '/images/templates/tv_unit.svg',
    fields: [
        ...dimensionFields([900, 3000], [300, 700], [300, 550]),
        selectField('mounting', MOUNTINGS),
        selectField('layout', LAYOUTS),
    ],
    defaults,
    paramsSchema: tvUnitParamsSchema,

    generate(params, ctx): FurnitureDocument {
        const slide = defaultSlideCode(ctx, 'side_mount');
        // Two drawers, or one when the height leaves boxes under 60 mm.
        const drawerCount = fitDrawers(
            2,
            interiorHeight(
                params.height,
                params.mounting === 'floor' ? LEG_HEIGHT : 0,
            ),
        );
        const columnContents = {
            drawers_open_door: [
                { weight: 1, content: drawersContent(drawerCount, slide) },
                { weight: 2, content: { type: 'empty' } },
                { weight: 1, content: shelvesContent(1) },
            ],
            doors_open_doors: [
                { weight: 1, content: shelvesContent(1) },
                { weight: 2, content: { type: 'empty' } },
                { weight: 1, content: shelvesContent(1) },
            ],
            flaps: [
                { weight: 1, content: { type: 'empty' } },
                { weight: 1, content: { type: 'empty' } },
                { weight: 1, content: { type: 'empty' } },
            ],
        } as const;
        const columns = columnContents[params.layout];

        const sections: Section[] = [];
        const builders: SectionBuilders = columns.map(({ weight, content }) => [
            { mode: 'flex', weight },
            tracked(sections, () => leaf(content, ctx)),
        ]);
        const interior = split('columns', builders, ctx);
        const column = (index: number): string[] => [
            (sections[index] as Section).id,
        ];

        let fronts: Front[];
        switch (params.layout) {
            case 'drawers_open_door':
                fronts = [hingedFront(column(2), 1, 'right', ctx)];
                break;
            case 'doors_open_doors':
                fronts = [
                    hingedFront(column(0), 1, 'left', ctx),
                    hingedFront(column(2), 1, 'right', ctx),
                ];
                break;
            case 'flaps':
                fronts = sections.map((_, index) =>
                    otherFront('flap_down', column(index), 1, ctx),
                );
                break;
        }

        return carcassDocument(
            'tv_unit',
            { width: params.width, height: params.height, depth: params.depth },
            resolveDefaultMaterials(tvUnit, ctx),
            {
                ...commonCarcass(ctx),
                construction: { top: 'over_sides', bottom: 'between_sides' },
                mounting: params.mounting,
                // Visible cabinet legs when standing on the floor.
                plinth:
                    params.mounting === 'floor'
                        ? {
                              type: 'legs',
                              height: LEG_HEIGHT,
                              setback: 0,
                              legCode: null,
                          }
                        : {
                              type: 'none',
                              height: 0,
                              setback: 0,
                              legCode: null,
                          },
                interior,
                fronts,
            },
        );
    },
};
