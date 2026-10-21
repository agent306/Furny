/**
 * Point snapping (04 §5.1, §5.3-§5.5, §5.10-§5.11): `snapPoint` and its
 * settings. The index lives in `snapIndex.ts`, the grid in `grid.ts`; both are
 * re-exported here so this is the one import for snapping.
 *
 * Plan space is x right, y down (04 §2.1). `snapPoint` runs on every pointer
 * move, so it only touches the index items near the cursor. Results are
 * integer millimetres, never `-0`, and depend on nothing but the inputs: item
 * arrays are sorted by entity id, hits are visited in index order, and ties go
 * to the earlier candidate.
 */
import { ANGLE_TOL, ANGLE_TOL_DEG, EPS, roundMm } from '../geometry/tolerance';
import { distPointLine, intersectSegments } from '../geometry/segment';
import {
    add,
    angleOf,
    cross,
    dist,
    dot,
    len,
    normDeg,
    normalize,
    perpLeft,
    scale,
    sub,
    type Vec2,
} from '../geometry/vec2';
import type { UnitSystem } from '../units/types';
import { gridPoint, rawPoint } from './grid';
import {
    query,
    type SnapIndex,
    type SnapNodeItem,
    type SnapWallItem,
} from './snapIndex';
import {
    ALIGNMENT_RADIUS_PX,
    snapTolerance,
    TIE_EPS,
    z,
    type Box,
} from './snapShared';

export { gridStepFor, rawStepFor } from './grid';
export { snapFootprint } from './snapFootprint';
export type { FootprintSnapInput, FootprintSnapResult } from './snapFootprint';
export { buildSnapIndex } from './snapIndex';
export { OPENING_SNAP_REASONS, snapOpeningPosition } from './snapOpening';
export type {
    OpeningSnapInput,
    OpeningSnapReason,
    OpeningSnapResult,
} from './snapOpening';
export type {
    SnapFaceItem,
    SnapFootprintItem,
    SnapIndex,
    SnapItemIndex,
    SnapKeyPointItem,
    SnapNodeItem,
    SnapWallItem,
} from './snapIndex';

export const SNAP_KINDS = [
    'endpoint',
    'intersection',
    'midpoint',
    'perpendicular',
    'guide_intersection',
    'on_wall',
    'on_face',
    'extension',
    'alignment',
    'angle',
    'grid',
    'none',
] as const;
export type SnapKind = (typeof SNAP_KINDS)[number];

export interface SnapSettings {
    /** Global toggle (S key); `false` leaves only raw rounding. */
    enabled: boolean;
    kinds: Record<Exclude<SnapKind, 'none'>, boolean>;
    /** Grid snapping only happens while the grid is visible. */
    gridVisible: boolean;
    /** Soft angle snapping step, default 15. */
    angleStepDeg: 15 | 45 | 90;
    /** Selects the grid sequence (§5.6). */
    unitSystem: UnitSystem;
}

/** `shift` = hard 45° lock from the origin; `alt` = disable snapping. */
export interface SnapModifiers {
    shift: boolean;
    alt: boolean;
}

export interface SnapInput {
    /** Model mm (float), already converted from screen. */
    cursor: Vec2;
    /** Screen px per mm. */
    zoom: number;
    pointerType: 'mouse' | 'pen' | 'touch';
    /** Start point of the segment being drawn or measured. */
    origin: Vec2 | null;
    /** Direction of the previous chain segment (relative angle rays). */
    previousDir: Vec2 | null;
    /** Entity ids ignored: the dragged node, its walls, the wall being drawn. */
    exclude: ReadonlySet<string>;
    settings: SnapSettings;
    modifiers: SnapModifiers;
    /**
     * `on_face` candidates exist only for tools that ask for faces
     * (Dimension, Measure; 04 §5.4 prio 6). Default `false`.
     */
    includeFaces?: boolean;
}

/** Infinite guides are clipped to the segment `a`-`b`. */
export interface SnapGuide {
    kind:
        | 'extension'
        | 'alignment'
        | 'angle'
        | 'perpendicular'
        | 'parallel'
        | 'face';
    a: Vec2;
    b: Vec2;
}

export interface SnapMarker {
    kind: Exclude<SnapKind, 'none' | 'on_wall' | 'grid'>;
    at: Vec2;
}

export interface SnapResult {
    /** Integer mm. */
    point: Vec2;
    kind: SnapKind;
    /** Endpoint snaps. */
    nodeId: string | null;
    /** `on_wall`, `midpoint`, `perpendicular`. */
    wallId: string | null;
    /** Centre-line parameter (mm from node a) when `wallId` is set. */
    u: number | null;
    guides: SnapGuide[];
    markers: SnapMarker[];
    /** Integer mm. */
    lengthFromOrigin: number | null;
    /** Counter-clockwise on screen from east, `[0, 360)`, 0.01° (04 §2.1-10). */
    displayAngleDeg: number | null;
}

// ---------------------------------------------------------------------------
// Settings, grid and rounding (04 §5.3, §5.6)
// ---------------------------------------------------------------------------

export function defaultSnapSettings(system: UnitSystem): SnapSettings {
    return {
        enabled: true,
        kinds: {
            endpoint: true,
            intersection: true,
            midpoint: true,
            perpendicular: true,
            guide_intersection: true,
            on_wall: true,
            on_face: true,
            extension: true,
            alignment: true,
            angle: true,
            grid: true,
        },
        gridVisible: true,
        angleStepDeg: 15,
        unitSystem: system,
    };
}

// ---------------------------------------------------------------------------
// snapPoint (04 §5.4, §5.5)
// ---------------------------------------------------------------------------

/** Angle snapping needs the cursor at least this far (px) from the origin. */
const ANGLE_MIN_PX = 20;
/** Extension lines reach this far (mm) beyond a wall end, at least. */
const EXTENSION_REACH_MM = 600;
const EXTENSION_REACH_PX = 60;
const SIN_ANGLE_TOL = Math.sin(ANGLE_TOL);

type PointKind = 'endpoint' | 'intersection' | 'midpoint' | 'perpendicular';
type MarkerKind = SnapMarker['kind'];

/** A guide whose far end is the final snapped point unless `b` is given. */
interface GuideSpec {
    kind: SnapGuide['kind'];
    a: Vec2;
    b: Vec2 | null;
}

/** A snap outcome before rounding. */
interface Resolved {
    prio: number;
    kind: SnapKind;
    at: Vec2;
    dist: number;
    nodeId: string | null;
    wallId: string | null;
    u: number | null;
    guides: GuideSpec[];
    marker: MarkerKind | null;
}

interface LineCand {
    prio: 6 | 7 | 8;
    kind: 'on_wall' | 'on_face' | 'extension' | 'alignment' | 'angle';
    /** Distance from the cursor to the line (to the segment for walls and faces). */
    dist: number;
    /** A point on the line; the anchor of its guide. */
    p: Vec2;
    /** Unit direction. */
    d: Vec2;
    /** Half-line from `p` along `d` (angle rays). */
    ray: boolean;
    /** Segment length from `p` along `d` (walls, faces); `null` for lines and rays. */
    segLength: number | null;
    guide: GuideSpec | null;
    wallId: string | null;
}

interface Ctx {
    input: SnapInput;
    index: SnapIndex;
    /** The cursor, or its projection on the locked ray. */
    c: Vec2;
    tol: number;
    exclude: ReadonlySet<string>;
}

/** Counts as the earlier candidate unless `d` is better by more than the tie slack. */
const better = (d: number, than: number): boolean => d < than - TIE_EPS;

function pickBest(list: Resolved[]): Resolved | null {
    let best: Resolved | null = null;
    for (const r of list) {
        if (best === null || r.prio < best.prio) best = r;
        else if (r.prio === best.prio && better(r.dist, best.dist)) best = r;
    }
    return best;
}

function pointResolved(
    prio: number,
    kind: PointKind,
    at: Vec2,
    c: Vec2,
    extra: Partial<Resolved> = {},
): Resolved {
    return {
        prio,
        kind,
        at,
        dist: dist(at, c),
        nodeId: null,
        wallId: null,
        u: null,
        guides: [],
        marker: kind,
        ...extra,
    };
}

/** Point candidates, priorities 1-4 (§5.4). */
function pointCandidates(ctx: Ctx): Resolved[] {
    const { input, index, c, tol, exclude } = ctx;
    const kinds = input.settings.kinds;
    const out: Resolved[] = [];
    const box: Box = [c.x - tol, c.y - tol, c.x + tol, c.y + tol];

    if (kinds.endpoint) {
        for (const n of query(index.nodes, ...box)) {
            if (exclude.has(n.id) || dist(n.at, c) > tol) continue;
            out.push(pointResolved(1, 'endpoint', n.at, c, { nodeId: n.id }));
        }
    }

    const walls = query(index.centerlines, ...box).filter(
        (w) => !exclude.has(w.wallId),
    );

    if (kinds.intersection) {
        for (let i = 0; i < walls.length; i += 1) {
            for (let j = i + 1; j < walls.length; j += 1) {
                const w1 = walls[i]!;
                const w2 = walls[j]!;
                if (
                    w1.nodeA === w2.nodeA ||
                    w1.nodeA === w2.nodeB ||
                    w1.nodeB === w2.nodeA ||
                    w1.nodeB === w2.nodeB
                ) {
                    continue;
                }
                const hit = intersectSegments(w1, w2);
                if (hit.kind !== 'point' || dist(hit.point, c) > tol) continue;
                out.push(pointResolved(2, 'intersection', hit.point, c));
            }
        }
    }

    if (kinds.midpoint) {
        for (const k of query(index.keyPoints, ...box)) {
            if (k.kind !== 'wall_mid' || exclude.has(k.wallId)) continue;
            if (dist(k.at, c) > tol) continue;
            const wall = index.wallById.get(k.wallId)!;
            out.push(
                pointResolved(3, 'midpoint', k.at, c, {
                    wallId: k.wallId,
                    u: wall.length / 2,
                }),
            );
        }
    }

    const origin = input.origin;
    if (kinds.perpendicular && origin !== null) {
        for (const w of walls) {
            const t = dot(sub(origin, w.a), w.dir);
            if (t < 0 || t > w.length) continue;
            const foot = add(w.a, scale(w.dir, t));
            if (dist(foot, origin) < EPS || dist(foot, c) > tol) continue;
            out.push(
                pointResolved(4, 'perpendicular', foot, c, {
                    wallId: w.wallId,
                    u: t,
                    guides: [{ kind: 'perpendicular', a: origin, b: null }],
                }),
            );
        }
    }
    return out;
}

/** Signed distance of `p` along segment-or-line `(a, d)`, clamped for segments. */
function lineProjection(
    c: Vec2,
    cand: Pick<LineCand, 'p' | 'd' | 'segLength' | 'ray'>,
): number {
    const s = dot(sub(c, cand.p), cand.d);
    if (cand.segLength !== null)
        return Math.min(cand.segLength, Math.max(0, s));
    if (cand.ray) return Math.max(0, s);
    return s;
}

/** Wall and face candidates, priority 6. */
function surfaceCandidates(ctx: Ctx): LineCand[] {
    const { input, index, c, tol, exclude } = ctx;
    const kinds = input.settings.kinds;
    const out: LineCand[] = [];
    const box: Box = [c.x - tol, c.y - tol, c.x + tol, c.y + tol];

    if (kinds.on_wall) {
        for (const w of query(index.centerlines, ...box)) {
            if (exclude.has(w.wallId)) continue;
            const cand: LineCand = {
                prio: 6,
                kind: 'on_wall',
                dist: 0,
                p: w.a,
                d: w.dir,
                ray: false,
                segLength: w.length,
                guide: null,
                wallId: w.wallId,
            };
            cand.dist = dist(
                c,
                add(w.a, scale(w.dir, lineProjection(c, cand))),
            );
            if (cand.dist <= tol) out.push(cand);
        }
    }
    if (kinds.on_face && input.includeFaces === true) {
        for (const f of query(index.faces, ...box)) {
            if (exclude.has(f.wallId)) continue;
            const length = dist(f.a, f.b);
            if (length < 1e-9) continue;
            const cand: LineCand = {
                prio: 6,
                kind: 'on_face',
                dist: 0,
                p: f.a,
                d: scale(sub(f.b, f.a), 1 / length),
                ray: false,
                segLength: length,
                guide: { kind: 'face', a: f.a, b: f.b },
                wallId: f.wallId,
            };
            cand.dist = dist(
                c,
                add(f.a, scale(cand.d, lineProjection(c, cand))),
            );
            if (cand.dist <= tol) out.push(cand);
        }
    }
    return out;
}

/**
 * Wall extension lines (priority 7, §5.4): the infinite line of a wall. Beyond
 * an end it needs a node within max(600 mm, 60 px) of the cursor's projection;
 * where the cursor projects onto the wall itself the line is kept for pairing
 * (walls near the cursor are found through the centre-line index).
 */
function extensionCandidates(ctx: Ctx): LineCand[] {
    const { input, index, c, tol, exclude } = ctx;
    if (!input.settings.kinds.extension) return [];
    const reach = Math.max(EXTENSION_REACH_MM, EXTENSION_REACH_PX / input.zoom);
    const r = reach + tol;
    const out: LineCand[] = [];
    const seen = new Set<string>();
    const consider = (w: SnapWallItem): void => {
        if (seen.has(w.wallId) || exclude.has(w.wallId)) return;
        seen.add(w.wallId);
        const s = dot(sub(c, w.a), w.dir);
        const interior = s >= -EPS && s <= w.length + EPS;
        const nearStart = interior ? s < w.length / 2 : s < 0;
        const overshoot = interior ? 0 : nearStart ? -s : s - w.length;
        if (overshoot > reach) return;
        const off = Math.abs(cross(w.dir, sub(c, w.a)));
        if (off > tol) return;
        const anchor = nearStart ? w.a : w.b;
        out.push({
            prio: 7,
            kind: 'extension',
            dist: off,
            p: anchor,
            d: w.dir,
            ray: false,
            segLength: null,
            guide: { kind: 'extension', a: anchor, b: null },
            wallId: null,
        });
    };
    for (const w of query(
        index.centerlines,
        c.x - tol,
        c.y - tol,
        c.x + tol,
        c.y + tol,
    )) {
        consider(w);
    }
    for (const n of query(index.nodes, c.x - r, c.y - r, c.x + r, c.y + r)) {
        for (const wallId of index.wallsAtNode.get(n.id) ?? []) {
            const w = index.wallById.get(wallId);
            if (w !== undefined) consider(w);
        }
    }
    return out;
}

/** Horizontal and vertical lines through nearby nodes (priority 7, §5.4). */
function alignmentCandidates(ctx: Ctx): LineCand[] {
    const { input, index, c, tol, exclude } = ctx;
    if (!input.settings.kinds.alignment) return [];
    const radius = ALIGNMENT_RADIUS_PX / input.zoom;
    const out: LineCand[] = [];
    // Equal lines keep the node closest to the cursor.
    const byLine = new Map<string, { cand: LineCand; node: number }>();
    const addLine = (key: string, node: SnapNodeItem, cand: LineCand): void => {
        const d = dist(node.at, c);
        const known = byLine.get(key);
        if (known === undefined) {
            byLine.set(key, { cand, node: d });
            out.push(cand);
        } else if (better(d, known.node)) {
            const at = out.indexOf(known.cand);
            out[at] = cand;
            byLine.set(key, { cand, node: d });
        }
    };
    const line = (node: SnapNodeItem, vertical: boolean): LineCand => ({
        prio: 7,
        kind: 'alignment',
        dist: vertical ? Math.abs(c.x - node.at.x) : Math.abs(c.y - node.at.y),
        p: node.at,
        d: vertical ? { x: 0, y: 1 } : { x: 1, y: 0 },
        ray: false,
        segLength: null,
        guide: { kind: 'alignment', a: node.at, b: null },
        wallId: null,
    });
    for (const n of query(
        index.nodes,
        c.x - tol,
        c.y - radius,
        c.x + tol,
        c.y + radius,
    )) {
        if (exclude.has(n.id) || Math.abs(c.x - n.at.x) > tol) continue;
        if (dist(n.at, c) > radius) continue;
        addLine(`v${n.at.x}`, n, line(n, true));
    }
    for (const n of query(
        index.nodes,
        c.x - radius,
        c.y - tol,
        c.x + radius,
        c.y + tol,
    )) {
        if (exclude.has(n.id) || Math.abs(c.y - n.at.y) > tol) continue;
        if (dist(n.at, c) > radius) continue;
        addLine(`h${n.at.y}`, n, line(n, false));
    }
    return out;
}

const isStepMultiple = (displayDeg: number, step: number): boolean => {
    const r = normDeg(displayDeg) % step;
    return Math.min(r, step - r) <= ANGLE_TOL_DEG;
};

const cleanDir = (d: Vec2): Vec2 => ({
    x: Math.abs(d.x) < 1e-12 ? 0 : d.x,
    y: Math.abs(d.y) < 1e-12 ? 0 : d.y,
});

/** Rays from the origin (priority 8, §5.4). */
function angleCandidates(ctx: Ctx): LineCand[] {
    const { input, c, tol } = ctx;
    const origin = input.origin;
    if (!input.settings.kinds.angle || origin === null) return [];
    if (dist(c, origin) < ANGLE_MIN_PX / input.zoom) return [];
    const step = input.settings.angleStepDeg;
    const rays: Array<{ d: Vec2; guide: SnapGuide['kind'] }> = [];
    for (let deg = 0; deg < 360; deg += step) {
        const rad = (deg * Math.PI) / 180;
        rays.push({
            d: cleanDir({ x: Math.cos(rad), y: -Math.sin(rad) }),
            guide: 'angle',
        });
    }
    const prev =
        input.previousDir === null ? null : normalize(input.previousDir);
    if (prev !== null && len(prev) > 0) {
        const perp = perpLeft(prev);
        const relative: Array<{ d: Vec2; guide: SnapGuide['kind'] }> = [
            { d: prev, guide: 'parallel' },
            { d: scale(prev, -1), guide: 'parallel' },
            { d: perp, guide: 'perpendicular' },
            { d: scale(perp, -1), guide: 'perpendicular' },
        ];
        for (const r of relative) {
            const display = (-angleOf(r.d) * 180) / Math.PI;
            if (!isStepMultiple(display, step)) rays.push(r);
        }
    }
    const out: LineCand[] = [];
    const rel = sub(c, origin);
    for (const r of rays) {
        if (dot(rel, r.d) < 0) continue;
        const off = Math.abs(cross(r.d, rel));
        if (off > tol) continue;
        out.push({
            prio: 8,
            kind: 'angle',
            dist: off,
            p: origin,
            d: r.d,
            ray: true,
            segLength: null,
            guide: { kind: r.guide, a: origin, b: null },
            wallId: null,
        });
    }
    return out;
}

const isSurface = (l: LineCand): boolean =>
    l.kind === 'on_wall' || l.kind === 'on_face';

/** Centre-line parameter (mm from node a) of `at`, clamped to the wall. */
function uOnWall(index: SnapIndex, wallId: string, at: Vec2): number | null {
    const w = index.wallById.get(wallId);
    if (w === undefined) return null;
    return Math.min(w.length, Math.max(0, dot(sub(at, w.a), w.dir)));
}

/** Resolves a single line candidate to the projection of the cursor on it. */
function resolveLine(ctx: Ctx, cand: LineCand): Resolved {
    const s = lineProjection(ctx.c, cand);
    const at = add(cand.p, scale(cand.d, s));
    const surface = isSurface(cand);
    return {
        prio: cand.prio,
        kind: cand.kind,
        at,
        dist: dist(at, ctx.c),
        nodeId: null,
        wallId: surface ? cand.wallId : null,
        u:
            surface && cand.wallId !== null
                ? uOnWall(ctx.index, cand.wallId, at)
                : null,
        guides: cand.guide === null ? [] : [cand.guide],
        marker: null,
    };
}

/** Line-line intersection as distances along both lines; `null` when parallel. */
function crossLines(
    p: LineCand,
    q: LineCand,
): { s: number; t: number; at: Vec2 } | null {
    const denom = cross(p.d, q.d);
    if (Math.abs(denom) <= SIN_ANGLE_TOL) return null;
    const diff = sub(q.p, p.p);
    const s = cross(diff, q.d) / denom;
    const t = cross(diff, p.d) / denom;
    return { s, t, at: add(p.p, scale(p.d, s)) };
}

const onLine = (cand: LineCand, s: number): boolean => {
    if (cand.ray) return s >= -EPS;
    if (cand.segLength !== null) return s >= -EPS && s <= cand.segLength + EPS;
    return true;
};

/**
 * Crossings of line candidates near the cursor (§5.5-5). Walls and faces
 * (priority 6) cross guide lines (extension, alignment, angle; 7-8) and guide
 * lines cross each other; two walls crossing each other are `intersection`
 * (a point candidate). A crossing of two guide lines is a `guide_intersection`
 * (also with a wall or face, which then supplies `wallId` and `u`); an angle
 * ray meeting a wall or face stays `on_wall` / `on_face`, as in the shift
 * lock (§5.5-2). With `ray` set (the locked ray) only crossings with it count.
 * Walls and faces pair first, so at equal distance they win the tie.
 */
function crossings(
    ctx: Ctx,
    lines: LineCand[],
    ray: LineCand | null,
): Resolved[] {
    const gated = !ctx.input.settings.kinds.guide_intersection;
    const out: Resolved[] = [];
    const consider = (p: LineCand, q: LineCand): void => {
        const hit = crossLines(p, q);
        if (hit === null || !onLine(p, hit.s) || !onLine(q, hit.t)) return;
        const d = dist(hit.at, ctx.c);
        if (d > ctx.tol) return;
        const surface = isSurface(p) ? p : null;
        const surfaceWall = surface?.wallId ?? null;
        const asSurface = surface !== null && q.kind === 'angle';
        if (!asSurface && gated) return;
        out.push({
            prio: 5,
            kind: asSurface ? surface.kind : 'guide_intersection',
            at: hit.at,
            dist: d,
            nodeId: null,
            wallId: surface?.wallId ?? null,
            u:
                surfaceWall === null
                    ? null
                    : uOnWall(ctx.index, surfaceWall, hit.at),
            guides: [p.guide, q.guide].filter((g) => g !== null),
            marker: asSurface ? null : 'guide_intersection',
        });
    };
    const surfaces = lines.filter(isSurface);
    const guides = lines.filter((l) => !isSurface(l));
    if (ray !== null) {
        for (const l of [...surfaces, ...guides]) consider(l, ray);
        return out;
    }
    for (const w of surfaces) {
        for (const g of guides) consider(w, g);
    }
    for (let i = 0; i < guides.length; i += 1) {
        for (let j = i + 1; j < guides.length; j += 1) {
            consider(guides[i]!, guides[j]!);
        }
    }
    return out;
}

/** The ray of the shift lock (§5.5-2). */
interface Lock {
    origin: Vec2;
    d: Vec2;
}

const DIAGONAL = Math.SQRT1_2;
const LOCK_DIRECTIONS: readonly Vec2[] = [
    { x: 1, y: 0 },
    { x: DIAGONAL, y: DIAGONAL },
    { x: 0, y: 1 },
    { x: -DIAGONAL, y: DIAGONAL },
    { x: -1, y: 0 },
    { x: -DIAGONAL, y: -DIAGONAL },
    { x: 0, y: -1 },
    { x: DIAGONAL, y: -DIAGONAL },
];

function lockFor(origin: Vec2, cursor: Vec2): { lock: Lock; projected: Vec2 } {
    const rel = sub(cursor, origin);
    const k = len(rel) < 1e-9 ? 0 : Math.round(angleOf(rel) / (Math.PI / 4));
    const d = LOCK_DIRECTIONS[((k % 8) + 8) % 8]!;
    return {
        lock: { origin, d },
        projected: add(origin, scale(d, Math.max(0, dot(rel, d)))),
    };
}

const onLock = (lock: Lock, p: Vec2): boolean =>
    distPointLine(p, lock.origin, add(lock.origin, lock.d)) <= EPS &&
    dot(sub(p, lock.origin), lock.d) >= -EPS;

const projectOnLock = (lock: Lock, p: Vec2): Vec2 =>
    add(
        lock.origin,
        scale(lock.d, Math.max(0, dot(sub(p, lock.origin), lock.d))),
    );

/** The locked ray as a line candidate, for pairing. */
const lockRay = (lock: Lock): LineCand => ({
    prio: 8,
    kind: 'angle',
    dist: 0,
    p: lock.origin,
    d: lock.d,
    ray: true,
    segLength: null,
    guide: { kind: 'angle', a: lock.origin, b: null },
    wallId: null,
});

const roundPointClean = (p: Vec2): Vec2 => ({
    x: z(roundMm(p.x)),
    y: z(roundMm(p.y)),
});

/**
 * Length and display angle of `point` seen from `origin`. The angle is taken
 * towards `exactPoint` (the snap before integer rounding) so that a point on
 * a 15 degree ray reads 15 and not 15.01 once rounded far from the origin.
 */
function readout(
    point: Vec2,
    origin: Vec2 | null,
    exactPoint: Vec2 = point,
): { lengthFromOrigin: number | null; displayAngleDeg: number | null } {
    if (origin === null)
        return { lengthFromOrigin: null, displayAngleDeg: null };
    const deg = normDeg((-angleOf(sub(exactPoint, origin)) * 180) / Math.PI);
    return {
        lengthFromOrigin: z(Math.round(len(sub(point, origin)))),
        displayAngleDeg: z(normDeg(Math.round(deg * 100) / 100)),
    };
}

function emptyResult(point: Vec2, origin: Vec2 | null): SnapResult {
    return {
        point,
        kind: 'none',
        nodeId: null,
        wallId: null,
        u: null,
        guides: [],
        markers: [],
        ...readout(point, origin),
    };
}

/**
 * The ids to ignore: `input.exclude` plus every wall of an excluded node, so a
 * dragged node never snaps to its own walls (a deliberate widening of the
 * literal 04 §5.1, which leaves that to the caller).
 */
function expandExclude(
    input: SnapInput,
    index: SnapIndex,
): ReadonlySet<string> {
    if (input.exclude.size === 0) return input.exclude;
    const out = new Set(input.exclude);
    for (const id of input.exclude) {
        for (const wallId of index.wallsAtNode.get(id) ?? []) out.add(wallId);
    }
    return out;
}

/**
 * Snaps a cursor position (04 §5.5). The algorithm:
 *
 * 1. disabled or Alt: raw rounding;
 * 2. Shift with an origin: project onto the nearest 45° ray and only accept
 *    candidates on it;
 * 3.-4. point candidates (endpoint, intersection, midpoint, perpendicular);
 * 5. crossings of walls and guide lines (extension, alignment, angle);
 * 6. the best single wall, face or guide line;
 * 7. the grid, else raw rounding;
 * 8.-9. integer rounding and the origin readout.
 */
export function snapPoint(input: SnapInput, index: SnapIndex): SnapResult {
    const { settings, modifiers, origin, cursor, zoom } = input;
    if (!settings.enabled || modifiers.alt) {
        return emptyResult(rawPoint(cursor, zoom), origin);
    }

    const tol = snapTolerance(input.pointerType, zoom);
    let lock: Lock | null = null;
    let c = cursor;
    if (modifiers.shift && origin !== null) {
        const locked = lockFor(origin, cursor);
        lock = locked.lock;
        c = locked.projected;
    }
    const ctx: Ctx = {
        input,
        index,
        c,
        tol,
        exclude: expandExclude(input, index),
    };

    let best: Resolved | null = null;

    let points = pointCandidates(ctx);
    if (lock !== null) {
        const l = lock;
        points = points
            .filter((p) => onLock(l, p.at))
            .map((p) => ({ ...p, at: projectOnLock(l, p.at) }));
    }
    best = pickBest(points);

    if (best === null) {
        const lines = [
            ...surfaceCandidates(ctx),
            ...extensionCandidates(ctx),
            ...alignmentCandidates(ctx),
            ...(lock === null ? angleCandidates(ctx) : []),
        ];
        best = pickBest(
            crossings(ctx, lines, lock === null ? null : lockRay(lock)),
        );
        if (best === null && lock === null) {
            best = pickBest(lines.map((l) => resolveLine(ctx, l)));
        }
    }

    if (
        best === null &&
        lock === null &&
        settings.gridVisible &&
        settings.kinds.grid
    ) {
        best = {
            prio: 9,
            kind: 'grid',
            at: gridPoint(cursor, zoom, settings.unitSystem),
            dist: 0,
            nodeId: null,
            wallId: null,
            u: null,
            guides: [],
            marker: null,
        };
    }

    if (best === null && lock === null) {
        return emptyResult(rawPoint(cursor, zoom), origin);
    }

    const chosen: Resolved = best ?? {
        prio: 8,
        kind: 'angle',
        at: c,
        dist: 0,
        nodeId: null,
        wallId: null,
        u: null,
        guides: [],
        marker: null,
    };
    // The locked ray's own guide always leads.
    const guides =
        lock === null
            ? chosen.guides
            : [
                  { kind: 'angle' as const, a: lock.origin, b: null },
                  ...chosen.guides.filter((g) => g.kind !== 'angle'),
              ];
    const point = roundPointClean(chosen.at);
    return {
        point,
        kind: chosen.kind,
        nodeId: chosen.nodeId,
        wallId: chosen.wallId,
        u: chosen.u,
        guides: guides.map((g) => ({ kind: g.kind, a: g.a, b: g.b ?? point })),
        markers:
            chosen.marker === null ? [] : [{ kind: chosen.marker, at: point }],
        ...readout(point, origin, chosen.at),
    };
}
