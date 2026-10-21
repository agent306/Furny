/**
 * Hinged fronts (07 §4.2): one or two leaves over the front rectangle of an
 * opening, with hinges (§6.2) and handles (§6.4).
 */
import type { Envelope } from '../carcass/envelope';
import { DOOR_GAP, MAX_DOOR_HEIGHT, MAX_DOOR_WIDTH, fl } from '../constants';
import {
    frontHandleTarget,
    handleCodeFor,
    handleOrientation,
    handlesFor,
    hingesFor,
    type HandleLeaf,
    type HingedLeaf,
} from '../rules/hardware';
import { leafWeightKg, roundKg } from '../rules/weight';
import type { Front } from '../schema';
import type { GenContext } from '../types';
import { glassFeasible } from './glass';
import { leafBody } from './leaf';
import { frontRect, type OpeningRect, type Overlay } from './openings';
import type { FurnitureIssueCode } from '../validate';

/** Smallest leaf width / height (07 §4.2 `front_too_small`). */
export const MIN_FRONT_SIZE = 100;
/** Heavier leaves warn `furniture.door_heavy` (07 §6.2). */
const MAX_DOOR_WEIGHT_KG = 22;

/**
 * z range of a hinged or flap leaf: in front of the carcass front plane
 * (full/half overlay) or inside it (inset), 07 §3.2.
 */
export function leafZ(
    env: Pick<Envelope, 'Dc'>,
    tf: number,
    overlay: Overlay,
): [number, number] {
    return overlay === 'inset' ? [env.Dc - tf, env.Dc] : [env.Dc, env.Dc + tf];
}

/**
 * Checks a leaf size: error `furniture.front_too_small` below 100 mm; false
 * when no part can be made at all (a size floors to 0 or less).
 */
export function checkLeafSize(
    ctx: GenContext,
    front: Front,
    lw: number,
    lh: number,
): boolean {
    if (lw < MIN_FRONT_SIZE || lh < MIN_FRONT_SIZE) {
        ctx.issue('furniture.front_too_small', 'error', { frontId: front.id }, [
            front.id,
        ]);
    }
    return fl(lw) > 0 && fl(lh) > 0;
}

/**
 * The leaves of a hinged front (07 §4.2): `n` = `leaves`, or for `'auto'`
 * `min(2, ceil(opening width / 600))`. More than 2 is an error and 2 are
 * made. Fewer than 1 cannot pass the schema (`leaves >= 1`); for callers
 * that bypass it, it is the same error (`hinged_leaves_unsupported`; its
 * English text, Task 51, asks for 1 or 2 leaves) and 1 is made. One leaf hinges on
 * `hingeSide` (`auto` = right), two on the outer sides. Named `hingedLeaves`
 * to keep `hingedFront` for the template helper (preflight I3).
 */
export function hingedLeaves(
    ctx: GenContext,
    env: Pick<Envelope, 'Dc'>,
    front: Front,
    opening: OpeningRect,
): void {
    const rect = frontRect(opening, front.overlay);
    const ow = opening.x1 - opening.x0;
    let n =
        front.leaves === 'auto'
            ? Math.min(2, Math.ceil(ow / MAX_DOOR_WIDTH))
            : front.leaves;
    // n < 1 is defence in depth: the schema already requires leaves >= 1.
    if (n < 1 || n > 2) {
        ctx.issue(
            'furniture.hinged_leaves_unsupported',
            'error',
            { frontId: front.id },
            [front.id],
        );
        n = n < 1 ? 1 : 2;
    }

    const lw = (rect.x1 - rect.x0 - (n - 1) * DOOR_GAP) / n;
    const lh = rect.y1 - rect.y0;
    const warn = (code: FurnitureIssueCode, params: Record<string, number>) =>
        ctx.issue(code, 'warning', { frontId: front.id, ...params }, [
            front.id,
        ]);
    if (ow / n > MAX_DOOR_WIDTH) {
        warn('furniture.door_wide', { width: fl(ow / n) });
    }
    if (lh > MAX_DOOR_HEIGHT) warn('furniture.door_tall', { height: fl(lh) });
    if (!checkLeafSize(ctx, front, lw, lh)) return;

    const [z0, z1] = leafZ(env, ctx.t('front'), front.overlay);
    const glass = front.glass && glassFeasible(ctx, front, lw, lh);
    const hinged: HingedLeaf[] = [];
    const handles: HandleLeaf[] = [];
    let heaviest = 0;
    for (let k = 1; k <= n; k++) {
        const x0 = rect.x0 + (k - 1) * (lw + DOOR_GAP);
        const hingeSide: 'left' | 'right' =
            n === 1
                ? front.hingeSide === 'auto'
                    ? 'right'
                    : front.hingeSide
                : k === 1
                  ? 'left'
                  : 'right';
        const key = `front.${front.id}.leaf.${k}`;
        const body = leafBody(
            ctx,
            key,
            { x0, x1: x0 + lw, y0: rect.y0, y1: rect.y1, z0, z1 },
            { nameKey: 'parts.door', nameParams: { leaf: k }, grainAxis: 'y' },
            glass,
        );
        const kg = leafWeightKg(body.parts, ctx.idx);
        heaviest = Math.max(heaviest, kg);
        hinged.push({
            part: body.edgePart(hingeSide),
            edgeLength: fl(lh),
            weightKg: kg,
            edgeClass: opening.edges[hingeSide].cls,
        });
        handles.push({
            part: body.edgePart(hingeSide === 'left' ? 'right' : 'left'),
            w: fl(lw),
            h: fl(lh),
            count: 1,
        });
        ctx.fronts.push({
            id: key,
            frontId: front.id,
            kind: 'door',
            rect: { x: fl(x0), y: fl(rect.y0), w: fl(lw), h: fl(lh) },
            hingeSide,
            partKey: body.partKey,
        });
    }

    if (heaviest > MAX_DOOR_WEIGHT_KG) {
        warn('furniture.door_heavy', { kg: roundKg(heaviest) });
    }
    hingesFor(ctx, front, hinged);
    handlesFor(
        ctx,
        frontHandleTarget(front.id),
        handleCodeFor(ctx, front),
        handles,
        handleOrientation(ctx, 'door'),
    );
}
