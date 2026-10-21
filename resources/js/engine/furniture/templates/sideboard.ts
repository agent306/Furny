/**
 * `sideboard` (07 §2.4.12): a low cabinet with a door on each side of a
 * central block of three drawers, on legs unless `legHeight` is 0.
 */
import { z } from 'zod';
import type { Content, FurnitureDocument, Section } from '../schema';
import type { SectionBuilders } from './common';
import {
    carcassDocument,
    commonCarcass,
    defaultSlideCode,
    dimensionFields,
    drawersContent,
    fitDrawers,
    hingedFront,
    interiorHeight,
    leaf,
    lengthField,
    resolveDefaultMaterials,
    shelvesContent,
    split,
} from './common';
import type { TemplateDefinition } from './types';

const DRAWER_COUNT = 3;

export const sideboardParamsSchema = z.object({
    width: z.number().int().min(900).max(2700),
    height: z.number().int().min(600).max(1000),
    depth: z.number().int().min(350).max(550),
    legHeight: z.number().int().min(0).max(250),
});
export type SideboardParams = z.infer<typeof sideboardParamsSchema>;

const defaults: SideboardParams = {
    width: 1600,
    height: 800,
    depth: 450,
    legHeight: 150,
};

export const sideboard: TemplateDefinition<SideboardParams> = {
    key: 'sideboard',
    family: 'carcass',
    category: 'storage',
    nameKey: 'templates.sideboard.name',
    descriptionKey: 'templates.sideboard.description',
    thumbnail: '/images/templates/sideboard.svg',
    fields: [
        ...dimensionFields([900, 2700], [600, 1000], [350, 550]),
        lengthField('legHeight', 0, 250),
    ],
    defaults,
    paramsSchema: sideboardParamsSchema,

    generate(params, ctx): FurnitureDocument {
        const slide = defaultSlideCode(ctx, 'side_mount');
        const drawerCount = fitDrawers(
            DRAWER_COUNT,
            interiorHeight(params.height, params.legHeight),
        );
        const sections: Section[] = [];
        const column = (content: Content) => () => {
            const section = leaf(content, ctx);
            sections.push(section);
            return section;
        };
        const flex = { mode: 'flex', weight: 1 } as const;
        const builders: SectionBuilders = [
            [flex, column(shelvesContent(1))],
            [flex, column(drawersContent(drawerCount, slide))],
            [flex, column(shelvesContent(1))],
        ];
        const interior = split('columns', builders, ctx);

        const common = commonCarcass(ctx);
        return carcassDocument(
            'sideboard',
            { width: params.width, height: params.height, depth: params.depth },
            resolveDefaultMaterials(sideboard, ctx),
            {
                ...common,
                construction: { top: 'over_sides', bottom: 'between_sides' },
                plinth:
                    params.legHeight > 0
                        ? {
                              type: 'legs',
                              height: params.legHeight,
                              setback: 0,
                              legCode: null,
                          }
                        : common.plinth,
                interior,
                fronts: [
                    hingedFront([(sections[0] as Section).id], 1, 'left', ctx),
                    hingedFront([(sections[2] as Section).id], 1, 'right', ctx),
                ],
            },
        );
    },
};
