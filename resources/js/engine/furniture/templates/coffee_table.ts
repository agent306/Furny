/**
 * `coffee_table` (07 §2.4.16): a low table on four solid legs with an apron
 * and an optional lower shelf.
 */
import { z } from 'zod';
import type { FurnitureDocument } from '../schema';
import {
    NOT_ROUND,
    TABLE_SHAPES,
    booleanField,
    lengthField,
    resolveDefaultMaterials,
    selectField,
    tableDims,
    tableDocument,
    tableTop,
} from './common';
import type { TemplateDefinition } from './types';

/** Also the largest round top (its depth equals its width). */
const DEPTH_MAX = 900;
const OVERHANG = 30;
const LEG_SECTION = 50;
const APRON_HEIGHT = 70;
const APRON_INSET = 10;

export const coffeeTableParamsSchema = z.object({
    width: z.number().int().min(500).max(1600),
    height: z.number().int().min(300).max(500),
    depth: z.number().int().min(400).max(DEPTH_MAX),
    shape: z.enum(TABLE_SHAPES),
    lowerShelf: z.boolean(),
});
export type CoffeeTableParams = z.infer<typeof coffeeTableParamsSchema>;

const defaults: CoffeeTableParams = {
    width: 1000,
    height: 420,
    depth: 550,
    shape: 'rectangle',
    lowerShelf: true,
};

export const coffeeTable: TemplateDefinition<CoffeeTableParams> = {
    key: 'coffee_table',
    family: 'table',
    category: 'table',
    nameKey: 'templates.coffee_table.name',
    descriptionKey: 'templates.coffee_table.description',
    thumbnail: '/images/templates/coffee_table.svg',
    fields: [
        lengthField('width', 500, 1600),
        lengthField('height', 300, 500),
        lengthField('depth', 400, DEPTH_MAX, { visibleIf: NOT_ROUND }),
        selectField('shape', TABLE_SHAPES),
        booleanField('lowerShelf'),
    ],
    defaults,
    paramsSchema: coffeeTableParamsSchema,

    generate(params, ctx): FurnitureDocument {
        return tableDocument(
            'coffee_table',
            tableDims(params, DEPTH_MAX),
            resolveDefaultMaterials(coffeeTable, ctx),
            {
                top: tableTop(params.shape, OVERHANG),
                base: {
                    type: 'four_legs',
                    legSource: 'solid',
                    legCode: null,
                    legSection: LEG_SECTION,
                    apron: {
                        enabled: true,
                        height: APRON_HEIGHT,
                        inset: APRON_INSET,
                    },
                    stretcher: false,
                },
                storage: {
                    drawers: null,
                    lowerShelf: params.lowerShelf,
                    endCabinets: null,
                },
            },
        );
    },
};
