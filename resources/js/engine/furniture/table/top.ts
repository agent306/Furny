/**
 * The table top (07 §3.13 top): `k` layers, a box for a rectangle and an
 * extruded outline for the other shapes.
 */
import type { GenContext } from '../types';
import { FOUR_EDGES, panel, span3, type Frame } from './frame';
import { circleOutline, ellipseOutline, roundedRectOutline } from './outlines';

/** The outline of a non-rectangular top, or null for a rectangle (07 §3.13 top geometry). */
function topOutline(f: Frame): Array<[number, number]> | null {
    const { W, D } = f;
    const top = f.T.top;
    switch (top.shape) {
        case 'rectangle':
            return null;
        case 'rounded_rectangle':
            return roundedRectOutline(
                W,
                D,
                Math.min(top.cornerRadius, Math.min(W, D) / 2),
            );
        case 'round':
            // W != D is an error; the ellipse keeps the top inside W x D.
            return W === D ? circleOutline(W) : ellipseOutline(W, D);
        case 'oval':
            return ellipseOutline(W, D);
    }
}

/** `table.top` and `table.top.layer.{m}`, `m = 2..k`, from the top down. */
export function topParts(ctx: GenContext, f: Frame): void {
    const outline = topOutline(f);
    for (let m = 1; m <= f.k; m++) {
        const y0 = f.H - m * f.tTop;
        panel(ctx, {
            key: m === 1 ? 'table.top' : `table.top.layer.${m}`,
            nameKey: m === 1 ? 'parts.table_top' : 'parts.table_top_layer',
            nameParams: m === 1 ? undefined : { n: m },
            role: 'top',
            box: span3([0, f.W], [y0, y0 + f.tTop], [0, f.D]),
            thin: 'y',
            grain: 'x',
            banded: FOUR_EDGES,
            faces: m === 1 ? 1 : 0,
            geometry: outline
                ? {
                      kind: 'extruded',
                      outline,
                      plane: 'xz',
                      y: y0,
                      thickness: f.tTop,
                  }
                : undefined,
        });
    }
}
