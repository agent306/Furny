/**
 * `custom_box` (07 §2.4.19): a blank carcass for staff and advanced users.
 */
import { z } from 'zod';
import type { FurnitureDocument } from '../schema';
import {
    carcassDocument,
    commonCarcass,
    dimensionFields,
    leaf,
    resolveDefaultMaterials,
    selectField,
} from './common';
import type { TemplateDefinition } from './types';

const MOUNTINGS = ['floor', 'wall', 'loft'] as const;
/**
 * 07 §2.4.19 allows 100-3000. Below 120 the 80 mm interior is lost to the two
 * boards (R40-3); above 2420 the sides exceed the seed boards' usable length
 * (R40-2). Spec 19.
 */
const HEIGHT_MIN = 120;
const HEIGHT_MAX = 2420;

export const customBoxParamsSchema = z.object({
    width: z.number().int().min(150).max(6000),
    height: z.number().int().min(HEIGHT_MIN).max(HEIGHT_MAX),
    depth: z.number().int().min(100).max(1200),
    mounting: z.enum(MOUNTINGS),
});
export type CustomBoxParams = z.infer<typeof customBoxParamsSchema>;

const defaults: CustomBoxParams = {
    width: 600,
    height: 720,
    depth: 560,
    mounting: 'floor',
};

export const customBox: TemplateDefinition<CustomBoxParams> = {
    key: 'custom_box',
    family: 'carcass',
    category: 'other',
    nameKey: 'templates.custom_box.name',
    descriptionKey: 'templates.custom_box.description',
    thumbnail: '/images/templates/custom_box.svg',
    fields: [
        ...dimensionFields([150, 6000], [HEIGHT_MIN, HEIGHT_MAX], [100, 1200]),
        selectField('mounting', MOUNTINGS),
    ],
    defaults,
    paramsSchema: customBoxParamsSchema,

    generate(params, ctx): FurnitureDocument {
        return carcassDocument(
            'custom_box',
            { width: params.width, height: params.height, depth: params.depth },
            resolveDefaultMaterials(customBox, ctx),
            {
                ...commonCarcass(ctx),
                mounting: params.mounting,
                interior: leaf({ type: 'empty' }, ctx),
                fronts: [],
            },
        );
    },
};
