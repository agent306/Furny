/**
 * `tall_cabinet` (07 §2.4.6): a full-height kitchen unit with two doors, or
 * an open niche for an oven or microwave between the doors.
 */
import { z } from 'zod';
import type { FurnitureDocument, Section } from '../schema';
import {
    tracked,
    booleanField,
    carcassDocument,
    commonCarcass,
    dimensionFields,
    hingedFront,
    leaf,
    resolveDefaultMaterials,
    shelvesContent,
    split,
} from './common';
import type { TemplateDefinition } from './types';

const LEG_HEIGHT = 100;
const LEG_SETBACK = 50;
const NICHE_HEIGHT = 600;

export const tallCabinetParamsSchema = z.object({
    width: z.number().int().min(300).max(900),
    height: z.number().int().min(1800).max(2400),
    depth: z.number().int().min(450).max(650),
    applianceNiche: z.boolean(),
});
export type TallCabinetParams = z.infer<typeof tallCabinetParamsSchema>;

const defaults: TallCabinetParams = {
    width: 600,
    height: 2100,
    depth: 560,
    applianceNiche: false,
};

export const tallCabinet: TemplateDefinition<TallCabinetParams> = {
    key: 'tall_cabinet',
    family: 'carcass',
    category: 'kitchen',
    nameKey: 'templates.tall_cabinet.name',
    descriptionKey: 'templates.tall_cabinet.description',
    thumbnail: '/images/templates/tall_cabinet.svg',
    fields: [
        ...dimensionFields([300, 900], [1800, 2400], [450, 650]),
        booleanField('applianceNiche'),
    ],
    defaults,
    paramsSchema: tallCabinetParamsSchema,

    generate(params, ctx): FurnitureDocument {
        // Top and bottom rows (the niche, when present, sits between them).
        const rows: Section[] = [];
        const row = (count: number) =>
            tracked(rows, () => leaf(shelvesContent(count), ctx));
        const flex = { mode: 'flex', weight: 1 } as const;
        const interior = params.applianceNiche
            ? split(
                  'rows',
                  [
                      [flex, row(2)],
                      [
                          { mode: 'fixed', mm: NICHE_HEIGHT },
                          () => leaf({ type: 'empty' }, ctx),
                      ],
                      [flex, row(2)],
                  ],
                  ctx,
              )
            : split(
                  'rows',
                  [
                      [flex, row(2)],
                      [flex, row(3)],
                  ],
                  ctx,
              );

        return carcassDocument(
            'tall_cabinet',
            { width: params.width, height: params.height, depth: params.depth },
            resolveDefaultMaterials(tallCabinet, ctx),
            {
                ...commonCarcass(ctx),
                plinth: {
                    type: 'legs',
                    height: LEG_HEIGHT,
                    setback: LEG_SETBACK,
                    legCode: null,
                },
                interior,
                fronts: [
                    hingedFront([(rows[0] as Section).id], 'auto', 'auto', ctx),
                    hingedFront([(rows[1] as Section).id], 'auto', 'auto', ctx),
                ],
            },
        );
    },
};
