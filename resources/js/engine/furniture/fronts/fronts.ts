/**
 * Front generation step of the pipeline (07 §3.1 step 3.4): the openings,
 * then the leaves of every front in document order, by kind.
 */
import type { Envelope } from '../carcass/envelope';
import type { SectionLayout } from '../carcass/layout';
import type { GenContext } from '../types';
import { flapFront } from './flap';
import { hingedLeaves } from './hinged';
import { openingsOf, type OpeningRect } from './openings';
import { slidingFront } from './sliding';

/**
 * Generates the front leaves and their hardware and returns the openings
 * (fronts and external drawer leaves, for the drawer fronts). Only the first
 * sliding front is built; any further one is `furniture.sliding_front_multiple`.
 */
export function frontParts(
    ctx: GenContext,
    env: Envelope,
    layout: SectionLayout,
): Map<string, OpeningRect> {
    const openings = openingsOf(ctx, env, layout);
    const extraSliding: string[] = [];
    let sliding = false;
    for (const front of ctx.doc.carcass?.fronts ?? []) {
        const opening = openings.get(front.id);
        if (!opening) continue;
        switch (front.kind) {
            case 'hinged':
                hingedLeaves(ctx, env, front, opening);
                break;
            case 'flap_up':
            case 'flap_down':
                flapFront(ctx, env, front, opening);
                break;
            case 'sliding':
                if (sliding) {
                    extraSliding.push(front.id);
                    break;
                }
                sliding = true;
                slidingFront(ctx, env, front, opening);
                break;
        }
    }
    if (extraSliding.length > 0) {
        ctx.issue(
            'furniture.sliding_front_multiple',
            'error',
            {},
            extraSliding,
        );
    }
    return openings;
}
