/**
 * Sides, top and bottom of the carcass (07 §3.3) and their four joints.
 */
import { makePart } from '../parts';
import type { GenContext, PhysEdge } from '../types';
import type { Envelope } from './envelope';

/** Pushes `carcass.side.left/right`, `carcass.top`, `carcass.bottom` and the 4 joints. */
export function carcassPanels(ctx: GenContext, env: Envelope): void {
    const C = ctx.doc.carcass;
    if (!C) return;
    const { x0, y0, Wc, Hc, Dc, zp } = env;
    const tc = ctx.t('carcass');
    const hasCountertop = env.ctT > 0;

    const topOver = C.construction.top === 'over_sides';
    const bottomOver = C.construction.bottom === 'over_sides';

    const ys0 = y0 + (bottomOver ? tc : 0);
    const ys1 = y0 + Hc - (topOver ? tc : 0);
    const depth = Dc - zp;

    const sideBanded: PhysEdge[] = ['front'];
    if (!topOver && !hasCountertop) sideBanded.push('top');
    if (!bottomOver && C.mounting !== 'floor') sideBanded.push('bottom');

    const side = (key: string, nameKey: string, x: number): void => {
        ctx.parts.push(
            makePart(
                {
                    key,
                    nameKey,
                    role: 'carcass',
                    materialCode: ctx.doc.materials.carcass.materialCode,
                    box: { min: [x, ys0, zp], size: [tc, ys1 - ys0, depth] },
                    thicknessAxis: 'x',
                    grainAxis: 'y',
                    banded: sideBanded,
                    visibleFaces: 1,
                },
                ctx,
            ),
        );
    };
    side('carcass.side.left', 'parts.side_left', x0);
    side('carcass.side.right', 'parts.side_right', x0 + Wc - tc);

    const horizontal = (
        key: string,
        nameKey: string,
        over: boolean,
        y: number,
        visibleFaces: 0 | 1,
    ): void => {
        const banded: PhysEdge[] = over
            ? ['front', 'left', 'right']
            : ['front'];
        ctx.parts.push(
            makePart(
                {
                    key,
                    nameKey,
                    role: 'carcass',
                    materialCode: ctx.doc.materials.carcass.materialCode,
                    box: {
                        min: [over ? x0 : x0 + tc, y, zp],
                        size: [over ? Wc : Wc - 2 * tc, tc, depth],
                    },
                    thicknessAxis: 'y',
                    grainAxis: 'x',
                    banded,
                    visibleFaces,
                },
                ctx,
            ),
        );
    };
    horizontal(
        'carcass.top',
        'parts.top',
        topOver,
        y0 + Hc - tc,
        topOver && !hasCountertop ? 1 : 0,
    );
    horizontal('carcass.bottom', 'parts.bottom', bottomOver, y0, 0);

    for (const member of ['carcass.top', 'carcass.bottom']) {
        for (const other of ['carcass.side.left', 'carcass.side.right']) {
            ctx.joints.push({ member, other, length: depth });
        }
    }
}
