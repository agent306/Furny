/**
 * `dining_table` (07 §2.4.15): a dining table on four legs, a trestle or a
 * pedestal, with a rectangular, rounded, round or oval top.
 */
import { z } from 'zod';
import type { FurnitureDocument } from '../schema';
import {
    NOT_ROUND,
    TABLE_SHAPES,
    lengthField,
    resolveDefaultMaterials,
    selectField,
    tableDims,
    tableDocument,
    tableTop,
} from './common';
import type { TemplateDefinition } from './types';

const BASES = ['four_legs', 'trestle', 'pedestal'] as const;
const LEG_SOURCES = ['solid', 'hardware'] as const;
/** Also the largest round top (its depth equals its width). */
const DEPTH_MAX = 1200;
const OVERHANG = 50;
const LEG_SECTION = 50;
const APRON_HEIGHT = 90;
const APRON_INSET = 15;

export const diningTableParamsSchema = z.object({
    width: z.number().int().min(900).max(3000),
    height: z.number().int().min(700).max(780),
    depth: z.number().int().min(700).max(DEPTH_MAX),
    shape: z.enum(TABLE_SHAPES),
    base: z.enum(BASES),
    legSource: z.enum(LEG_SOURCES),
});
export type DiningTableParams = z.infer<typeof diningTableParamsSchema>;

const defaults: DiningTableParams = {
    width: 1800,
    height: 750,
    depth: 900,
    shape: 'rectangle',
    base: 'four_legs',
    legSource: 'solid',
};

export const diningTable: TemplateDefinition<DiningTableParams> = {
    key: 'dining_table',
    family: 'table',
    category: 'table',
    nameKey: 'templates.dining_table.name',
    descriptionKey: 'templates.dining_table.description',
    thumbnail: '/images/templates/dining_table.svg',
    fields: [
        lengthField('width', 900, 3000),
        lengthField('height', 700, 780, {}, 5),
        lengthField('depth', 700, DEPTH_MAX, { visibleIf: NOT_ROUND }),
        selectField('shape', TABLE_SHAPES),
        selectField('base', BASES),
        selectField('legSource', LEG_SOURCES),
    ],
    defaults,
    paramsSchema: diningTableParamsSchema,
    preferredMaterials: { top: ['PB25-WHITE'], leg: ['SW50-RUBBER'] },

    generate(params, ctx): FurnitureDocument {
        return tableDocument(
            'dining_table',
            tableDims(params, DEPTH_MAX),
            resolveDefaultMaterials(diningTable, ctx),
            {
                top: tableTop(params.shape, OVERHANG),
                base: {
                    type: params.base,
                    legSource: params.legSource,
                    legCode: null,
                    legSection: LEG_SECTION,
                    apron: {
                        enabled: params.base === 'four_legs',
                        height: APRON_HEIGHT,
                        inset: APRON_INSET,
                    },
                    stretcher: false,
                },
                storage: {
                    drawers: null,
                    lowerShelf: false,
                    endCabinets: null,
                },
            },
        );
    },
};
