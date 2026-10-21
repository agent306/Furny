/**
 * Glass frame doors (07 §4.5): whether a leaf can be a glass frame. The frame
 * itself is built by `glassLeaf` in `leaf.ts`.
 */
import { GLASS_FRAME_WIDTH } from '../constants';
import type { Front } from '../schema';
import type { GenContext } from '../types';

/** Smallest clear glass area a frame must leave (07 §4.5: `2 x 60 + 100`). */
const MIN_GLASS_SIZE = 100;

/**
 * Whether the leaves of `front` (each `lw x lh`) can be glass frames; reports
 * `furniture.glass_door_too_small` or `furniture.no_glass_material` when not
 * (the leaves are then solid). Call once per front.
 */
export function glassFeasible(
    ctx: GenContext,
    front: Front,
    lw: number,
    lh: number,
): boolean {
    const min = 2 * GLASS_FRAME_WIDTH + MIN_GLASS_SIZE;
    if (lw < min || lh < min) {
        ctx.issue(
            'furniture.glass_door_too_small',
            'error',
            { frontId: front.id },
            [front.id],
        );
        return false;
    }
    if (!ctx.idx.glassMaterial()) {
        ctx.issue('furniture.no_glass_material', 'error', {}, [front.id]);
        return false;
    }
    return true;
}
