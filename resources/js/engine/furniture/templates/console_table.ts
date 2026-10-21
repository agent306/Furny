/**
 * `console_table` (07 §2.4.17): a narrow table on four solid legs with up to
 * three drawers under the top.
 */
import { z } from 'zod';
import type { FurnitureDocument } from '../schema';
import {
    dimensionFields,
    intField,
    resolveDefaultMaterials,
    tableDocument,
    tableTop,
} from './common';
import type { TemplateDefinition } from './types';

const OVERHANG = 20;
const LEG_SECTION = 50;
const APRON_HEIGHT = 100;
const APRON_INSET = 10;
const DRAWERS_MAX = 3;
/**
 * 07 §2.4.17 allows 350. At 350-355 the drawers' depth (base depth less the
 * two aprons and the front) is under the shortest seed slide (250 + 10 rear
 * clearance): `drawer_no_slide`. Raised to the next step (R40-3, spec 19).
 */
const DEPTH_MIN = 360;

export const consoleTableParamsSchema = z.object({
    width: z.number().int().min(600).max(1800),
    height: z.number().int().min(700).max(900),
    depth: z.number().int().min(DEPTH_MIN).max(450),
    drawers: z.number().int().min(0).max(DRAWERS_MAX),
});
export type ConsoleTableParams = z.infer<typeof consoleTableParamsSchema>;

const defaults: ConsoleTableParams = {
    width: 1200,
    height: 800,
    depth: 400,
    drawers: 2,
};

export const consoleTable: TemplateDefinition<ConsoleTableParams> = {
    key: 'console_table',
    family: 'table',
    category: 'table',
    nameKey: 'templates.console_table.name',
    descriptionKey: 'templates.console_table.description',
    thumbnail: '/images/templates/console_table.svg',
    fields: [
        ...dimensionFields([600, 1800], [700, 900], [DEPTH_MIN, 450]),
        intField('drawers', 0, DRAWERS_MAX),
    ],
    defaults,
    paramsSchema: consoleTableParamsSchema,

    generate(params, ctx): FurnitureDocument {
        return tableDocument(
            'console_table',
            { width: params.width, height: params.height, depth: params.depth },
            resolveDefaultMaterials(consoleTable, ctx),
            {
                top: tableTop('rectangle', OVERHANG),
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
                    drawers:
                        params.drawers > 0
                            ? {
                                  count: params.drawers,
                                  side: 'front',
                                  slideCode: null,
                              }
                            : null,
                    lowerShelf: false,
                    endCabinets: null,
                },
            },
        );
    },
};
