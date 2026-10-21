/**
 * Helpers shared by the draw functions: output rounding and item builders.
 * Coordinates and lengths are rounded to 0.01 mm and never `-0`; arc angles
 * keep four decimals so an arc stays within 0.01 mm of the swing sector it
 * mirrors for radii up to a few metres.
 */
import { ensureCW } from '../../geometry/polygon';
import { normDeg, type Vec2 } from '../../geometry/vec2';
import type { DrawItem, RoomColorKey, StyleKey } from './types';

/** Rounds to 0.01 and normalises `-0`. */
export const r2 = (n: number): number => {
    const v = Math.round(n * 100) / 100;
    return v === 0 ? 0 : v;
};

/** Rounds an angle to four decimals and normalises `-0`. */
export const rAngle = (deg: number): number => {
    const v = Math.round(deg * 1e4) / 1e4;
    return v === 0 ? 0 : v;
};

export const pt = (p: Vec2): Vec2 => ({ x: r2(p.x), y: r2(p.y) });

export const degOf = (dir: Vec2): number =>
    normDeg((Math.atan2(dir.y, dir.x) * 180) / Math.PI);

export function line(
    a: Vec2,
    b: Vec2,
    style: StyleKey,
    dashed = false,
): DrawItem {
    return {
        t: 'line',
        a: pt(a),
        b: pt(b),
        style,
        ...(dashed ? { dashed: true } : {}),
    };
}

export function poly(
    pts: Vec2[],
    style: StyleKey,
    opts: {
        closed?: boolean;
        holes?: Vec2[][];
        fill?: string;
        fillKey?: RoomColorKey;
        dashed?: boolean;
        cw?: boolean;
    } = {},
): DrawItem {
    const ring = opts.cw ? ensureCW(pts) : pts;
    return {
        t: 'poly',
        pts: ring.map(pt),
        ...(opts.holes && opts.holes.length > 0
            ? { holes: opts.holes.map((h) => h.map(pt)) }
            : {}),
        closed: opts.closed ?? true,
        style,
        ...(opts.fill !== undefined ? { fill: opts.fill } : {}),
        ...(opts.fillKey !== undefined ? { fillKey: opts.fillKey } : {}),
        ...(opts.dashed ? { dashed: true } : {}),
    };
}

/**
 * Quarter-circle arc centred on `hinge`, running from the closed leaf
 * (`closedDir`) to the open leaf (`openDir`) or the other way round,
 * whichever sweeps clockwise on screen.
 */
export function quarterArc(
    hinge: Vec2,
    closedDir: Vec2,
    openDir: Vec2,
    radius: number,
    style: StyleKey,
): DrawItem {
    const clockwise = closedDir.x * openDir.y - closedDir.y * openDir.x > 0;
    const start = degOf(clockwise ? closedDir : openDir);
    return {
        t: 'arc',
        c: pt(hinge),
        r: r2(radius),
        startDeg: rAngle(start),
        endDeg: rAngle(start + 90),
        style,
    };
}

export function text(
    at: Vec2,
    value: string,
    sizeMm: number,
    style: StyleKey,
    opts: {
        dyEm?: number;
        rotationDeg?: number;
        anchor?: 'start' | 'middle' | 'end';
        baseline?: 'middle' | 'top' | 'bottom';
    } = {},
): DrawItem {
    return {
        t: 'text',
        at: pt(at),
        text: value,
        sizeMm: r2(sizeMm),
        dyEm: opts.dyEm ?? 0,
        rotationDeg: r2(opts.rotationDeg ?? 0),
        anchor: opts.anchor ?? 'middle',
        baseline: opts.baseline ?? 'middle',
        style,
    };
}
