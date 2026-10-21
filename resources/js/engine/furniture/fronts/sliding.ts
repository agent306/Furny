/**
 * Sliding fronts (07 §4.6, hardware §6.10): 2-4 overlapping leaves running
 * inside the carcass on two tracks in the sliding zone at the front of the
 * interior. v1 covers the whole interior only.
 */
import type { Envelope } from '../carcass/envelope';
import {
    MAX_DOOR_HEIGHT,
    MAX_SLIDING_LEAF_WIDTH,
    MIN_SLIDING_LEAF_WIDTH,
    SLIDING_HEIGHT_DEDUCTION,
    SLIDING_OVERLAP,
    SLIDING_TRACK_PITCH_EXTRA,
    fl,
} from '../constants';
import {
    addHardwareLine,
    frontHandleTarget,
    handleCodeFor,
    handleOrientation,
    handlesFor,
    type HandleLeaf,
} from '../rules/hardware';
import { leafWeightKg, roundKg } from '../rules/weight';
import type { Front } from '../schema';
import type { GenContext } from '../types';
import { glassFeasible } from './glass';
import { leafBody } from './leaf';
import type { OpeningRect } from './openings';

/** Leaves stand this far above the interior bottom (07 §4.6: bottom 15, top 25). */
const SLIDING_BOTTOM_CLEARANCE = 15;
/** The front track's front face stands this far behind the carcass front plane. */
const SLIDING_TRACK_SETBACK = 6;
const MIN_SLIDING_LEAVES = 2;
const MAX_SLIDING_LEAVES = 4;
/** Opening and interior bounds match within this distance. */
const TOLERANCE = 0.5;

const clamp = (v: number, lo: number, hi: number): number =>
    Math.min(hi, Math.max(lo, v));

/**
 * The leaves of the carcass's sliding front (07 §4.6). Errors and makes
 * nothing when the opening is not the whole interior; an unsupported leaf
 * count is an error and is clamped into 2..4. Odd leaves run on the front
 * track, even ones on the rear track.
 */
export function slidingFront(
    ctx: GenContext,
    env: Pick<Envelope, 'Dc' | 'interior'>,
    front: Front,
    opening: OpeningRect,
): void {
    const [ix0, iy0] = env.interior.min;
    const [Wo, Ho] = env.interior.size;
    const bounds = [ix0, ix0 + Wo, iy0, iy0 + Ho];
    const sides = [opening.x0, opening.x1, opening.y0, opening.y1];
    if (sides.some((v, i) => Math.abs(v - (bounds[i] ?? v)) > TOLERANCE)) {
        ctx.issue(
            'furniture.sliding_front_partial',
            'error',
            { frontId: front.id },
            [front.id],
        );
        return;
    }

    let n =
        front.leaves === 'auto'
            ? clamp(
                  Math.max(2, Math.ceil(Wo / MAX_SLIDING_LEAF_WIDTH)),
                  MIN_SLIDING_LEAVES,
                  MAX_SLIDING_LEAVES,
              )
            : front.leaves;
    if (n < MIN_SLIDING_LEAVES || n > MAX_SLIDING_LEAVES) {
        ctx.issue(
            'furniture.sliding_leaves_unsupported',
            'error',
            { frontId: front.id },
            [front.id],
        );
        n = clamp(n, MIN_SLIDING_LEAVES, MAX_SLIDING_LEAVES);
    }

    const lw = (Wo + (n - 1) * SLIDING_OVERLAP) / n;
    const lh = Ho - SLIDING_HEIGHT_DEDUCTION;
    const warn = (code: string, params: Record<string, number> = {}) =>
        ctx.issue(code, 'warning', { frontId: front.id, ...params }, [
            front.id,
        ]);
    if (lw < MIN_SLIDING_LEAF_WIDTH) warn('furniture.sliding_leaf_narrow');
    if (lh > MAX_DOOR_HEIGHT) warn('furniture.door_tall', { height: fl(lh) });
    if (fl(lw) <= 0 || fl(lh) <= 0) return;

    const tf = ctx.t('front');
    const pitch = tf + SLIDING_TRACK_PITCH_EXTRA;
    const glass = front.glass && glassFeasible(ctx, front, lw, lh);
    const y0 = iy0 + SLIDING_BOTTOM_CLEARANCE;
    const handles: HandleLeaf[] = [];
    let heaviest = 0;
    for (let k = 1; k <= n; k++) {
        const x0 = ix0 + (k - 1) * (lw - SLIDING_OVERLAP);
        const z1 = env.Dc - SLIDING_TRACK_SETBACK - (k % 2 === 1 ? 0 : pitch);
        const key = `front.${front.id}.leaf.${k}`;
        const body = leafBody(
            ctx,
            key,
            { x0, x1: x0 + lw, y0, y1: y0 + lh, z0: z1 - tf, z1 },
            {
                nameKey: 'parts.sliding_door',
                nameParams: { leaf: k },
                grainAxis: 'y',
            },
            glass,
        );
        heaviest = Math.max(heaviest, leafWeightKg(body.parts, ctx.idx));
        // Pulls sit on the outer half: left stile on the left leaves.
        handles.push({
            part: body.edgePart(k <= Math.ceil(n / 2) ? 'left' : 'right'),
            w: fl(lw),
            h: fl(lh),
            count: 1,
        });
        ctx.fronts.push({
            id: key,
            frontId: front.id,
            kind: 'sliding',
            rect: { x: fl(x0), y: fl(y0), w: fl(lw), h: fl(lh) },
            partKey: body.partKey,
        });
    }

    slidingHardware(ctx, front, Wo, n, heaviest);
    handlesFor(
        ctx,
        frontHandleTarget(front.id),
        handleCodeFor(ctx, front),
        handles,
        handleOrientation(ctx, 'sliding'),
    );
}

/**
 * Track sets (`ceil(Wo / track length)`) and one roller set per leaf; none
 * when `slidingTrackCode` is null. Warns when a leaf is heavier than the
 * rollers carry.
 */
function slidingHardware(
    ctx: GenContext,
    front: Front,
    Wo: number,
    n: number,
    heaviestKg: number,
): void {
    if (front.slidingTrackCode === null) return;
    const trackCode =
        front.slidingTrackCode === 'auto'
            ? ctx.idx.defaultHardware('sliding_track.default')?.code
            : front.slidingTrackCode;
    const trackLength = ctx.idx.hardware(trackCode ?? '')?.specs.lengthMm;
    const hasLength = typeof trackLength === 'number' && trackLength > 0;
    addHardwareLine(ctx, {
        key: `front.${front.id}.track`,
        roleKey: 'sliding_track.default',
        code: trackCode,
        qty: hasLength ? Math.ceil(Wo / trackLength) : 1,
        reasonKey: 'hardware.reason.sliding_track',
        reasonParams: hasLength ? { length: trackLength } : {},
        frontId: front.id,
        sectionId: null,
    });

    const rollerCode = addHardwareLine(ctx, {
        key: `front.${front.id}.rollers`,
        roleKey: 'sliding_roller.default',
        qty: n,
        reasonKey: 'hardware.reason.sliding_rollers',
        frontId: front.id,
        sectionId: null,
    });
    const maxKg = ctx.idx.hardware(rollerCode ?? '')?.specs.maxLeafWeightKg;
    if (typeof maxKg === 'number' && heaviestKg > maxKg) {
        ctx.issue(
            'furniture.sliding_leaf_heavy',
            'warning',
            { frontId: front.id, kg: roundKg(heaviestKg) },
            [front.id],
        );
    }
}
