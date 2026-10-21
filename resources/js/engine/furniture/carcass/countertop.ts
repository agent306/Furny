/**
 * Countertop (07 §3.6): a full-size top board over the carcass, in front,
 * left and right of which it overhangs. The carcass keeps its own top panel.
 */
import { makePart } from '../parts';
import type { GenContext } from '../types';
import type { Envelope } from './envelope';

/** Overhang beyond which the board needs brackets. */
const MAX_FREE_OVERHANG = 300;

export function countertopPart(ctx: GenContext, env: Envelope): void {
    const C = ctx.doc.carcass;
    const ct = C?.countertop;
    if (!ct?.enabled) return;

    const { width, height } = ctx.doc.dims;
    const depth = env.Dc + env.fz + ct.overhangFront;

    ctx.parts.push(
        makePart(
            {
                key: 'countertop',
                nameKey: 'parts.countertop',
                role: 'top',
                materialCode: ctx.doc.materials.top.materialCode,
                box: {
                    min: [0, height - env.ctT, 0],
                    size: [width, env.ctT, depth],
                },
                thicknessAxis: 'y',
                grainAxis: 'x',
                banded: ['front', 'left', 'right'],
                visibleFaces: 1,
            },
            ctx,
        ),
    );

    if (
        Math.max(ct.overhangFront, ct.overhangLeft, ct.overhangRight) >
        MAX_FREE_OVERHANG
    ) {
        ctx.issue('furniture.countertop_overhang_large', 'warning');
    }
}
