/**
 * Opening positioning along a wall (04 §5.7): which wall is under the cursor,
 * where along it the opening centre goes (centre / return targets, else a
 * 10 mm grid), which side it swings to and whether the spot is valid.
 *
 * Plan space is x right, y down (04 §2.1). Results are integer millimetres,
 * never `-0`, and depend on nothing but the inputs: walls and openings are
 * visited in id order and ties go to the earlier candidate.
 */
import { pointInRing, ringBBox } from '../geometry/polygon';
import { closestPointOnSeg } from '../geometry/segment';
import { add, dot, scale, sub, type Vec2 } from '../geometry/vec2';
import { roundMm } from '../geometry/tolerance';
import type { DerivedPlan, DerivedWall } from './derive';
import type { PlanDocument } from './schema';
import {
    cmp,
    SLACK,
    snapTolerance,
    TIE_EPS,
    z,
    type SnapPointerType,
} from './snapShared';
import type { SnapGuide, SnapModifiers } from './snapping';

export interface OpeningSnapInput {
    /** Model mm (float). */
    cursor: Vec2;
    /** Screen px per mm. */
    zoom: number;
    pointerType: SnapPointerType;
    /** Width of the opening being placed (mm). */
    width: number;
    /** The opening being moved, ignored in the overlap test; `null` when adding. */
    openingId: string | null;
    /** Wall of the previous call; kept while the cursor is still in its reach. */
    preferredWallId: string | null;
    geom: DerivedPlan;
    doc: PlanDocument;
    modifiers: SnapModifiers;
}

export const OPENING_SNAP_REASONS = [
    'engine.plan.snap.opening_no_fit',
    'engine.plan.snap.opening_overlap',
] as const;
export type OpeningSnapReason = (typeof OPENING_SNAP_REASONS)[number];

export interface OpeningSnapResult {
    /** `null` when no wall is under the cursor. */
    wallId: string | null;
    /** Integer mm, centre of the opening along the centre line. */
    offset: number;
    /** Fits within the wall and overlaps no other opening. */
    valid: boolean;
    /** Cursor side of the centre line (`left` is `+n`); ignored for windows. */
    swing: 'left' | 'right';
    /** `start` when the cursor is before the opening centre, else `end`. */
    hinge: 'start' | 'end';
    guides: SnapGuide[];
    /** Set when `!valid` and a wall was found; `null` without a wall. */
    reasonKey: OpeningSnapReason | null;
}

/** The opening edge keeps this distance from the inner face corner (04 §5.7-3). */
const RETURN_ALLOWANCE = 100;
/** Free positions round to this many mm (04 §5.7-4). */
const FREE_STEP = 10;
interface Found {
    wall: DerivedWall;
    /** Cursor distance to the centre line. */
    dist: number;
    /** The cursor is inside the wall outline. */
    inside: boolean;
}

/** `wall` if the cursor is in its outline or within `2 x tol + t/2` of the centre line. */
function reachOf(wall: DerivedWall, cursor: Vec2, tol: number): Found | null {
    const [a, b] = wall.centerline;
    const d = closestPointOnSeg(cursor, { a, b }).dist;
    const box = ringBBox(wall.outline);
    const inside =
        cursor.x >= box.min.x &&
        cursor.x <= box.max.x &&
        cursor.y >= box.min.y &&
        cursor.y <= box.max.y &&
        pointInRing(cursor, wall.outline) !== 'outside';
    if (!inside && d > 2 * tol + wall.thickness / 2) return null;
    return { wall, dist: d, inside };
}

/**
 * The wall whose outline contains the cursor, else the nearest centre line
 * within `2 x tol + thickness / 2`; `preferredWallId` wins while it qualifies.
 */
function wallUnderCursor(
    geom: DerivedPlan,
    cursor: Vec2,
    tol: number,
    preferredWallId: string | null,
): DerivedWall | null {
    if (preferredWallId !== null) {
        const preferred = geom.walls[preferredWallId];
        if (preferred !== undefined && reachOf(preferred, cursor, tol)) {
            return preferred;
        }
    }
    let best: Found | null = null;
    for (const id of Object.keys(geom.walls).sort(cmp)) {
        const hit = reachOf(geom.walls[id]!, cursor, tol);
        if (hit === null) continue;
        if (
            best === null ||
            (hit.inside && !best.inside) ||
            (hit.inside === best.inside && hit.dist < best.dist - TIE_EPS)
        ) {
            best = hit;
        }
    }
    return best === null ? null : best.wall;
}

/** A line across the wall thickness at centre-line parameter `u`. */
function acrossWall(wall: DerivedWall, u: number): SnapGuide {
    const centre = add(wall.centerline[0], scale(wall.dir, u));
    const half = scale(wall.normal, wall.thickness / 2);
    const a = add(centre, half);
    const b = sub(centre, half);
    return {
        kind: 'face',
        a: { x: z(a.x), y: z(a.y) },
        b: { x: z(b.x), y: z(b.y) },
    };
}

interface Target {
    /** Opening centre (mm along the wall). */
    offset: number;
    /** Where the guide crosses the wall. */
    guideU: number;
}

/** Centre and return targets that fit the opening (04 §5.7-3). */
function targetsFor(wall: DerivedWall, width: number): Target[] {
    const lo = width / 2;
    const hi = wall.length - width / 2;
    const [safe0, safe1] = wall.safeU;
    const out: Target[] = [
        { offset: wall.length / 2, guideU: wall.length / 2 },
        {
            offset: safe0 + RETURN_ALLOWANCE + width / 2,
            guideU: safe0 + RETURN_ALLOWANCE,
        },
        {
            offset: safe1 - RETURN_ALLOWANCE - width / 2,
            guideU: safe1 - RETURN_ALLOWANCE,
        },
    ];
    return out.filter((t) => t.offset >= lo - SLACK && t.offset <= hi + SLACK);
}

/** Whether `[offset - width/2, offset + width/2]` overlaps another opening of the wall. */
function overlapsOther(
    doc: PlanDocument,
    wallId: string,
    openingId: string | null,
    offset: number,
    width: number,
): boolean {
    const u0 = offset - width / 2;
    const u1 = offset + width / 2;
    for (const id of Object.keys(doc.openings).sort(cmp)) {
        const o = doc.openings[id]!;
        if (o.wallId !== wallId || o.id === openingId) continue;
        const o0 = o.offset - o.width / 2;
        const o1 = o.offset + o.width / 2;
        if (u0 < o1 - SLACK && o0 < u1 - SLACK) return true;
    }
    return false;
}

const NO_WALL: OpeningSnapResult = {
    wallId: null,
    offset: 0,
    valid: false,
    swing: 'left',
    hinge: 'start',
    guides: [],
    reasonKey: null,
};

/**
 * Positions an opening of `input.width` along the wall under the cursor
 * (04 §5.7):
 *
 * 1. the wall under the cursor (sticky `preferredWallId`);
 * 2. clamp to `[width/2, length - width/2]`; wider than the wall is
 *    `opening_no_fit`;
 * 3. snap to the wall centre or a return position within tol, with a `face`
 *    guide;
 * 4. else round to 10 mm;
 * 5. overlap with another opening is `opening_overlap`;
 * 6. Alt skips 3 and 4 (1 mm rounding).
 */
export function snapOpeningPosition(
    input: OpeningSnapInput,
): OpeningSnapResult {
    const { cursor, width, geom, doc } = input;
    const tol = snapTolerance(input.pointerType, input.zoom);
    const wall = wallUnderCursor(geom, cursor, tol, input.preferredWallId);
    if (wall === null) return { ...NO_WALL, guides: [] };

    const [a] = wall.centerline;
    const rel = sub(cursor, a);
    const cursorU = dot(rel, wall.dir);
    const swing: 'left' | 'right' =
        dot(rel, wall.normal) >= 0 ? 'left' : 'right';
    const hingeFor = (offset: number): 'start' | 'end' =>
        cursorU < offset ? 'start' : 'end';

    if (wall.length < width - SLACK) {
        const offset = z(roundMm(wall.length / 2));
        return {
            wallId: wall.id,
            offset,
            valid: false,
            swing,
            hinge: hingeFor(offset),
            guides: [],
            reasonKey: 'engine.plan.snap.opening_no_fit',
        };
    }

    const lo = width / 2;
    const hi = wall.length - width / 2;
    const clampedU = Math.min(hi, Math.max(lo, cursorU));

    let target: Target | null = null;
    let raw: number;
    if (input.modifiers.alt) {
        raw = roundMm(clampedU);
    } else {
        let bestGap = Infinity;
        for (const t of targetsFor(wall, width)) {
            const gap = Math.abs(clampedU - t.offset);
            if (gap <= tol && gap < bestGap - TIE_EPS) {
                target = t;
                bestGap = gap;
            }
        }
        raw =
            target === null
                ? roundMm(clampedU / FREE_STEP) * FREE_STEP
                : roundMm(target.offset);
    }

    // Integer offsets whose opening stays on the wall.
    const minOffset = Math.ceil(lo - SLACK);
    const maxOffset = Math.floor(hi + SLACK);
    const offset = z(
        minOffset > maxOffset
            ? roundMm(wall.length / 2)
            : Math.min(maxOffset, Math.max(minOffset, raw)),
    );

    const overlap = overlapsOther(doc, wall.id, input.openingId, offset, width);
    return {
        wallId: wall.id,
        offset,
        valid: !overlap,
        swing,
        hinge: hingeFor(offset),
        guides: target === null ? [] : [acrossWall(wall, target.guideU)],
        reasonKey: overlap ? 'engine.plan.snap.opening_overlap' : null,
    };
}
