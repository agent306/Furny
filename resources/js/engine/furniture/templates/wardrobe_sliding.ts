/**
 * `wardrobe_sliding` (07 §2.4.2): a floor-standing wardrobe with sliding
 * doors, alternating shelf and hanging columns.
 */
import { z } from 'zod';
import {
    DEFAULT_ROD_TOP_CLEARANCE,
    DEFAULT_SHELF_FRONT_SETBACK,
    MAX_SLIDING_LEAF_WIDTH,
} from '../constants';
import type { FurnitureDocument, Section } from '../schema';
import {
    carcassDocument,
    clamp,
    commonCarcass,
    dimensionFields,
    evenSplit,
    interiorHeight,
    intField,
    leaf,
    lengthField,
    otherFront,
    resolveDefaultMaterials,
    shelfCount,
    shelvesContent,
    split,
} from './common';
import type { TemplateDefinition } from './types';

const BOARD_THICKNESS = 18;
const SHELF_PITCH = 400;
const HANGING_ZONE_TOP = 350;
const LEAVES_MIN = 2;
const LEAVES_MAX = 4;

export const wardrobeSlidingParamsSchema = z.object({
    width: z.number().int().min(1200).max(3600),
    height: z.number().int().min(1800).max(2700),
    depth: z.number().int().min(550).max(750),
    leaves: z.union([
        z.literal('auto'),
        z.number().int().min(LEAVES_MIN).max(LEAVES_MAX),
    ]),
    plinthHeight: z.number().int().min(0).max(150),
});
export type WardrobeSlidingParams = z.infer<typeof wardrobeSlidingParamsSchema>;

const defaults: WardrobeSlidingParams = {
    width: 2400,
    height: 2100,
    depth: 650,
    leaves: 'auto',
    plinthHeight: 100,
};

/** Resolves `leaves = 'auto'` to `clamp(max(2, ceil((width - 36) / 1000)), 2, 4)`. */
export function slidingLeafCount(params: WardrobeSlidingParams): number {
    if (params.leaves !== 'auto') return params.leaves;
    const wide = Math.ceil(
        (params.width - 2 * BOARD_THICKNESS) / MAX_SLIDING_LEAF_WIDTH,
    );
    return clamp(Math.max(LEAVES_MIN, wide), LEAVES_MIN, LEAVES_MAX);
}

export const wardrobeSliding: TemplateDefinition<WardrobeSlidingParams> = {
    key: 'wardrobe_sliding',
    family: 'carcass',
    category: 'wardrobe',
    nameKey: 'templates.wardrobe_sliding.name',
    descriptionKey: 'templates.wardrobe_sliding.description',
    thumbnail: '/images/templates/wardrobe_sliding.svg',
    fields: [
        ...dimensionFields([1200, 3600], [1800, 2700], [550, 750]),
        intField('leaves', LEAVES_MIN, LEAVES_MAX, { allowAuto: true }),
        lengthField('plinthHeight', 0, 150, { advanced: true }),
    ],
    defaults,
    paramsSchema: wardrobeSlidingParamsSchema,

    generate(params, ctx): FurnitureDocument {
        const leaves = slidingLeafCount(params);
        const ih = interiorHeight(params.height, params.plinthHeight);

        // Odd columns hold shelves, even columns the hanging zone.
        const interior = evenSplit(
            'columns',
            leaves,
            (index): Section =>
                index % 2 === 0
                    ? leaf(
                          shelvesContent(
                              shelfCount(ih, SHELF_PITCH),
                              DEFAULT_SHELF_FRONT_SETBACK,
                          ),
                          ctx,
                      )
                    : split(
                          'rows',
                          [
                              [
                                  { mode: 'fixed', mm: HANGING_ZONE_TOP },
                                  () => leaf({ type: 'empty' }, ctx),
                              ],
                              [
                                  { mode: 'flex', weight: 1 },
                                  () =>
                                      leaf(
                                          {
                                              type: 'hanging_rod',
                                              topClearance:
                                                  DEFAULT_ROD_TOP_CLEARANCE,
                                              rodCode: null,
                                          },
                                          ctx,
                                      ),
                              ],
                          ],
                          ctx,
                      ),
            ctx,
        );

        const common = commonCarcass(ctx);
        return carcassDocument(
            'wardrobe_sliding',
            { width: params.width, height: params.height, depth: params.depth },
            resolveDefaultMaterials(wardrobeSliding, ctx),
            {
                ...common,
                // Setback 0: the bottom track sits on the carcass bottom.
                plinth:
                    params.plinthHeight > 0
                        ? {
                              type: 'plinth',
                              height: params.plinthHeight,
                              setback: 0,
                              legCode: null,
                          }
                        : common.plinth,
                handles: {
                    ...common.handles,
                    code:
                        ctx.catalog.defaultHardware('handle.flush')?.code ??
                        common.handles.code,
                },
                interior,
                fronts: [otherFront('sliding', [interior.id], leaves, ctx)],
            },
        );
    },
};
