/**
 * Plinth (07 §3.5): front and back boards plus the returns between them. A
 * `legs` base only gets the front kickboard, and only when it is set back.
 */
import { PLINTH_RETURN_SPACING, fl } from '../constants';
import { makePart } from '../parts';
import type { GenContext } from '../types';
import type { Envelope } from './envelope';

/** A returns row needs at least this clear depth between front and back boards. */
const MIN_RETURN_DEPTH = 50;

export function plinthParts(ctx: GenContext, env: Envelope): void {
    const C = ctx.doc.carcass;
    if (!C || C.mounting !== 'floor' || C.plinth.type === 'none') return;
    const h = env.plinthH;
    if (h <= 0) return;

    const { x0, Wc, Dc } = env;
    const sb = C.plinth.setback;
    // Legs only get a kickboard when it is set back from the carcass front.
    if (C.plinth.type === 'legs' && sb <= 0) return;
    const tp = ctx.t('plinth');
    const material = ctx.doc.materials.plinth.materialCode;

    ctx.parts.push(
        makePart(
            {
                key: 'plinth.front',
                nameKey: 'parts.plinth_front',
                role: 'plinth',
                materialCode: material,
                box: { min: [x0, 0, Dc - sb - tp], size: [Wc, h, tp] },
                thicknessAxis: 'z',
                grainAxis: 'x',
                banded: sb > 0 ? ['left', 'right'] : [],
                visibleFaces: 1,
            },
            ctx,
        ),
    );
    if (C.plinth.type !== 'plinth') return;

    ctx.parts.push(
        makePart(
            {
                key: 'plinth.back',
                nameKey: 'parts.plinth_back',
                role: 'plinth',
                materialCode: material,
                box: { min: [x0, 0, 0], size: [Wc, h, tp] },
                thicknessAxis: 'z',
                grainAxis: 'x',
                banded: [],
                visibleFaces: 0,
            },
            ctx,
        ),
    );

    const returnDepth = Dc - sb - 2 * tp;
    if (returnDepth < MIN_RETURN_DEPTH) {
        ctx.issue('furniture.plinth_too_shallow', 'warning');
        return;
    }
    const n = 2 + fl((Wc - 1) / PLINTH_RETURN_SPACING);
    for (let k = 1; k <= n; k++) {
        const rx = x0 + ((k - 1) * (Wc - tp)) / (n - 1);
        ctx.parts.push(
            makePart(
                {
                    key: `plinth.return.${k}`,
                    nameKey: 'parts.plinth_return',
                    nameParams: { n: k },
                    role: 'plinth',
                    materialCode: material,
                    box: { min: [rx, 0, tp], size: [tp, h, returnDepth] },
                    thicknessAxis: 'x',
                    grainAxis: 'z',
                    banded: [],
                    visibleFaces: 0,
                },
                ctx,
            ),
        );
    }
}
