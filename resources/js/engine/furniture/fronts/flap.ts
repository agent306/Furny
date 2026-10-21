/**
 * Flap fronts (07 §4.3): one leaf over the front rectangle, hinged on the top
 * (`flap_up`) or bottom (`flap_down`) edge, with its lift hardware (§6.3).
 */
import type { Envelope } from '../carcass/envelope';
import { fl } from '../constants';
import {
    flapMechanism,
    frontHandleTarget,
    handleCodeFor,
    handleCount,
    handleOrientation,
    handlesFor,
    hingesFor,
} from '../rules/hardware';
import { leafWeightKg, roundKg } from '../rules/weight';
import type { Front } from '../schema';
import type { GenContext } from '../types';
import { glassFeasible, leafBody } from './glass';
import { checkLeafSize, leafZ } from './hinged';
import { frontRect, type OpeningRect } from './openings';

/** Heavier flaps warn `furniture.flap_heavy` (07 §6.3). */
const MAX_FLAP_WEIGHT_KG = 8;

/**
 * The single leaf of a flap (07 §4.3): the rectangle of a single hinged leaf,
 * grain along x; numeric `leaves > 1` is ignored with a warning. Hinges are
 * counted along the leaf width.
 */
export function flapFront(
    ctx: GenContext,
    env: Pick<Envelope, 'Dc'>,
    front: Front,
    opening: OpeningRect,
): void {
    if (typeof front.leaves === 'number' && front.leaves > 1) {
        ctx.issue(
            'furniture.flap_leaves_ignored',
            'warning',
            { frontId: front.id },
            [front.id],
        );
    }
    const rect = frontRect(opening, front.overlay);
    const lw = rect.x1 - rect.x0;
    const lh = rect.y1 - rect.y0;
    if (!checkLeafSize(ctx, front, lw, lh)) return;

    const [z0, z1] = leafZ(env, ctx.t('front'), front.overlay);
    const key = `front.${front.id}.leaf.1`;
    const body = leafBody(
        ctx,
        key,
        { x0: rect.x0, x1: rect.x1, y0: rect.y0, y1: rect.y1, z0, z1 },
        { nameKey: 'parts.flap', grainAxis: 'x' },
        front.glass && glassFeasible(ctx, front, lw, lh),
    );
    const hingeEdge = front.kind === 'flap_down' ? 'bottom' : 'top';
    const kg = leafWeightKg(body.parts, ctx.idx);
    if (kg > MAX_FLAP_WEIGHT_KG) {
        ctx.issue(
            'furniture.flap_heavy',
            'warning',
            { frontId: front.id, kg: roundKg(kg) },
            [front.id],
        );
    }

    hingesFor(ctx, front, [
        {
            part: body.edgePart(hingeEdge),
            edgeLength: fl(lw),
            weightKg: kg,
            edgeClass: opening.edges[hingeEdge].cls,
        },
    ]);
    flapMechanism(ctx, front, fl(lw));
    handlesFor(
        ctx,
        frontHandleTarget(front.id),
        handleCodeFor(ctx, front),
        [
            {
                part: body.edgePart(hingeEdge === 'top' ? 'bottom' : 'top'),
                w: fl(lw),
                h: fl(lh),
                count: handleCount('flap', fl(lw)),
            },
        ],
        handleOrientation(ctx, 'flap'),
    );
    ctx.fronts.push({
        id: key,
        frontId: front.id,
        kind: 'flap',
        rect: { x: fl(rect.x0), y: fl(rect.y0), w: fl(lw), h: fl(lh) },
        partKey: body.partKey,
    });
}
