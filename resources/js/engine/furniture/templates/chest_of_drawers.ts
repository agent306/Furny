/**
 * `chest_of_drawers` (07 §2.4.11): one or two columns of stacked drawers on
 * a plinth; the drawer fronts are part of the drawers, so there are no
 * separate fronts.
 */
import { z } from 'zod';
import type { FurnitureDocument } from '../schema';
import {
    BOARD_THICKNESS,
    carcassDocument,
    clamp,
    commonCarcass,
    defaultSlideCode,
    dimensionFields,
    drawersContent,
    evenSplit,
    fitDrawers,
    intField,
    interiorHeight,
    leaf,
    resolveDefaultMaterials,
    selectField,
} from './common';
import type { TemplateContext, TemplateDefinition } from './types';

const DRAWER_COUNT_MIN = 2;
const DRAWER_COUNT_MAX = 8;
/** Height per drawer for `drawerCount = 'auto'`. */
const AUTO_DRAWER_HEIGHT = 200;
const PLINTH_HEIGHT = 80;
const PLINTH_SETBACK = 20;
/** Wider chests get two columns. */
const TWO_COLUMN_WIDTH = 1000;
const COLUMNS = ['auto', '1', '2'] as const;
const SLIDE_TYPES = ['side_mount', 'undermount'] as const;
/** Depth a drawer takes besides its slide: front board, back offset and rear clearance. */
const SLIDE_DEPTH_ALLOWANCE = 45;

export const chestOfDrawersParamsSchema = z.object({
    width: z.number().int().min(400).max(1600),
    height: z.number().int().min(500).max(1400),
    depth: z.number().int().min(350).max(600),
    drawerCount: z.union([
        z.literal('auto'),
        z.number().int().min(DRAWER_COUNT_MIN).max(DRAWER_COUNT_MAX),
    ]),
    columns: z.enum(COLUMNS),
    slideType: z.enum(SLIDE_TYPES),
});
export type ChestOfDrawersParams = z.infer<typeof chestOfDrawersParamsSchema>;

const defaults: ChestOfDrawersParams = {
    width: 800,
    height: 1000,
    depth: 450,
    drawerCount: 'auto',
    columns: 'auto',
    slideType: 'side_mount',
};

/**
 * False when the shortest undermount slide is longer than `depth` allows, so
 * a chest that shallow takes side-mount slides whatever `slideType` says.
 */
function undermountFits(ctx: TemplateContext, depth: number): boolean {
    const family =
        ctx.catalog.defaultHardware('slide.undermount')?.specs.family;
    if (typeof family !== 'string') return true;
    const shortest = ctx.catalog.hardwareFamily('drawer_slide', family)[0]
        ?.specs.lengthMm;
    return (
        typeof shortest !== 'number' ||
        depth >= shortest + SLIDE_DEPTH_ALLOWANCE
    );
}

export const chestOfDrawers: TemplateDefinition<ChestOfDrawersParams> = {
    key: 'chest_of_drawers',
    family: 'carcass',
    category: 'storage',
    nameKey: 'templates.chest_of_drawers.name',
    descriptionKey: 'templates.chest_of_drawers.description',
    thumbnail: '/images/templates/chest_of_drawers.svg',
    fields: [
        ...dimensionFields([400, 1600], [500, 1400], [350, 600]),
        intField('drawerCount', DRAWER_COUNT_MIN, DRAWER_COUNT_MAX, {
            allowAuto: true,
        }),
        // `auto` is `width > 1000 ? 2 : 1` (07 §2.4.11): a default that follows the width.
        selectField('columns', COLUMNS),
        selectField('slideType', SLIDE_TYPES, { advanced: true }),
    ],
    defaults,
    paramsSchema: chestOfDrawersParamsSchema,

    generate(params, ctx): FurnitureDocument {
        const requested =
            params.drawerCount === 'auto'
                ? clamp(
                      Math.round(
                          (params.height -
                              PLINTH_HEIGHT -
                              2 * BOARD_THICKNESS) /
                              AUTO_DRAWER_HEIGHT,
                      ),
                      DRAWER_COUNT_MIN,
                      DRAWER_COUNT_MAX,
                  )
                : params.drawerCount;
        // Fewer drawers when the height leaves boxes under 60 mm.
        const drawerCount = fitDrawers(
            requested,
            interiorHeight(params.height, PLINTH_HEIGHT),
        );
        const columns =
            params.columns === 'auto'
                ? params.width > TWO_COLUMN_WIDTH
                    ? 2
                    : 1
                : Number(params.columns);
        // A shallow chest takes side-mount slides whatever `slideType` says.
        const slide = defaultSlideCode(
            ctx,
            params.slideType === 'undermount' &&
                undermountFits(ctx, params.depth)
                ? 'undermount'
                : 'side_mount',
        );

        const interior = evenSplit(
            'columns',
            columns,
            () => leaf(drawersContent(drawerCount, slide), ctx),
            ctx,
        );

        return carcassDocument(
            'chest_of_drawers',
            { width: params.width, height: params.height, depth: params.depth },
            resolveDefaultMaterials(chestOfDrawers, ctx),
            {
                ...commonCarcass(ctx),
                construction: { top: 'over_sides', bottom: 'between_sides' },
                plinth: {
                    type: 'plinth',
                    height: PLINTH_HEIGHT,
                    setback: PLINTH_SETBACK,
                    legCode: null,
                },
                interior,
                fronts: [],
            },
        );
    },
};
