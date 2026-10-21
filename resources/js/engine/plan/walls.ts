/**
 * Wall graph, node joins and mitered wall outlines (04 §3.1-§3.4).
 *
 * Plan space is x right, y down (04 §2.1). All functions are pure: inputs are
 * never mutated and `-0` is normalised to `0` in every output coordinate.
 * Corners shared by two walls are the very same `Vec2` object, so adjacent
 * outlines meet exactly; consumers must treat all returned points as read-only.
 */
import { lineIntersection } from '../geometry/segment';
import {
    ensureCW,
    signedArea,
    simplifyCollinear,
    type Ring,
} from '../geometry/polygon';
import { ANGLE_TOL, EPS, MITER_LIMIT } from '../geometry/tolerance';
import {
    add,
    angleOf,
    dist,
    dot,
    isParallel,
    len,
    normalize,
    perpLeft,
    scale,
    sub,
    type Vec2,
} from '../geometry/vec2';
import { distPointLine } from '../geometry/segment';
import type { PlanDocument, Wall } from './schema';
import type { DeriveIssue } from './types';

/** Short codes of every `DeriveIssue`; message key is `engine.plan.derive.<code>`. */
export const DERIVE_ISSUE_CODES = [
    'wall_skipped',
    'outline_fallback',
    'opening_skipped',
    'opening_clamped',
    'opening_in_junction',
    'room_meta_duplicate',
] as const;

export type DeriveIssueCode = (typeof DERIVE_ISSUE_CODES)[number];

/** One end of a wall after joining it with the walls at its node (04 §3.1). */
export interface WallEnd {
    /** Corner on the left (+n) face line at this end. */
    left: Vec2;
    /** Corner on the right (-n) face line at this end. */
    right: Vec2;
    /** Extra outline points between the two corners (node point, bevel midpoints). */
    via: Vec2[];
    /** `free` = dangling square end; `junction` = node degree >= 3. */
    joint: 'free' | 'miter' | 'bevel' | 'junction';
}

/** A wall that passed the adjacency checks, with its derived frame. */
export interface WallInfo {
    wall: Wall;
    A: Vec2;
    B: Vec2;
    /** Unit direction A -> B. */
    d: Vec2;
    /** Left normal `(d.y, -d.x)` (04 §2.1). */
    n: Vec2;
    length: number;
}

export interface WallGraph {
    valid: Map<string, WallInfo>;
    /** Node id -> ids of the valid walls ending at it (sorted by wall id). */
    incident: Map<string, string[]>;
    issues: DeriveIssue[];
}

const TWO_PI = 2 * Math.PI;
/** mm; a crossing must exceed this to count as a self-intersection. */
const CROSS_TOL = 1e-9;

/** `-0` -> `0`. */
const z = (n: number): number => (n === 0 ? 0 : n);
const clean = (p: Vec2): Vec2 => ({ x: z(p.x), y: z(p.y) });
const cmpId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function skipped(
    wallId: string,
    reason: 'missing_node' | 'same_node' | 'too_short',
): DeriveIssue {
    return {
        code: 'wall_skipped',
        messageKey: 'engine.plan.derive.wall_skipped',
        params: { wallId, reason },
        severity: 'warning',
        entityIds: [wallId],
    };
}

/** Adjacency of the valid walls; skips broken walls with `wall_skipped` (04 §3.2). */
export function buildWallGraph(doc: PlanDocument): WallGraph {
    const valid = new Map<string, WallInfo>();
    const incident = new Map<string, string[]>();
    const issues: DeriveIssue[] = [];

    for (const id of Object.keys(doc.walls).sort(cmpId)) {
        const wall = doc.walls[id]!;
        const na = doc.nodes[wall.a];
        const nb = doc.nodes[wall.b];
        if (!na || !nb) {
            issues.push(skipped(id, 'missing_node'));
            continue;
        }
        if (wall.a === wall.b) {
            issues.push(skipped(id, 'same_node'));
            continue;
        }
        const A = clean({ x: na.x, y: na.y });
        const B = clean({ x: nb.x, y: nb.y });
        const length = len(sub(B, A));
        if (length < EPS) {
            issues.push(skipped(id, 'too_short'));
            continue;
        }
        const d = clean(normalize(sub(B, A)));
        const n = clean(perpLeft(d));
        valid.set(id, { wall, A, B, d, n, length });
        for (const nodeId of [wall.a, wall.b]) {
            const list = incident.get(nodeId);
            if (list) list.push(id);
            else incident.set(nodeId, [id]);
        }
    }
    return { valid, incident, issues };
}

/** A wall seen from one of its nodes. */
interface Arm {
    id: string;
    atA: boolean;
    /** Outgoing unit direction from the node. */
    u: Vec2;
    angle: number;
    /** Half thickness. */
    half: number;
    length: number;
    cw: Vec2;
    ccw: Vec2;
    midCw: Vec2 | null;
    midCcw: Vec2 | null;
}

/**
 * Orders arms by outgoing angle (clockwise on screen). Arms within
 * `ANGLE_TOL` of each other (including across the +-pi seam) are ordered by
 * wall id so the result does not depend on input order (04 §3.3-1).
 */
function orderArms(arms: Arm[]): Arm[] {
    const sorted = [...arms].sort(
        (p, q) => p.angle - q.angle || cmpId(p.id, q.id),
    );
    const k = sorted.length;
    const gapAfter = (i: number): number => {
        const g = sorted[(i + 1) % k]!.angle - sorted[i]!.angle;
        return i === k - 1 ? g + TWO_PI : g;
    };
    let start = -1;
    for (let i = 0; i < k; i++) {
        if (gapAfter(i) > ANGLE_TOL) {
            start = (i + 1) % k;
            break;
        }
    }
    if (start < 0) return sorted.sort((p, q) => cmpId(p.id, q.id));
    const rotated = [...sorted.slice(start), ...sorted.slice(0, start)];
    const out: Arm[] = [];
    let run: Arm[] = [rotated[0]!];
    const flush = (): void => {
        out.push(...run.sort((p, q) => cmpId(p.id, q.id)));
    };
    for (let i = 1; i < k; i++) {
        let g = rotated[i]!.angle - rotated[i - 1]!.angle;
        if (g < 0) g += TWO_PI;
        if (g <= ANGLE_TOL) {
            run.push(rotated[i]!);
        } else {
            flush();
            run = [rotated[i]!];
        }
    }
    flush();
    return out;
}

/** `rot90cw(u)`: the side of a wall that faces the next wall clockwise. */
const cwSide = (u: Vec2): Vec2 => ({ x: -u.y, y: u.x });
/** The side facing the previous wall. */
const ccwSide = (u: Vec2): Vec2 => ({ x: u.y, y: -u.x });

/**
 * Joins every wall ending at `nodeId` (04 §3.3). Returns the `WallEnd` of each
 * incident wall at this node, keyed by wall id; empty if no valid wall ends here.
 */
export function computeNodeJoins(
    nodeId: string,
    g: WallGraph,
): Map<string, WallEnd> {
    const result = new Map<string, WallEnd>();
    const ids = g.incident.get(nodeId);
    if (!ids || ids.length === 0) return result;

    const arms: Arm[] = [];
    let N: Vec2 = { x: 0, y: 0 };
    for (const id of ids) {
        const info = g.valid.get(id)!;
        const atA = info.wall.a === nodeId;
        N = atA ? info.A : info.B;
        const u = atA ? info.d : clean(scale(info.d, -1));
        arms.push({
            id,
            atA,
            u,
            angle: angleOf(u),
            half: info.wall.thickness / 2,
            length: info.length,
            cw: N,
            ccw: N,
            midCw: null,
            midCcw: null,
        });
    }

    if (arms.length === 1) {
        const arm = arms[0]!;
        const info = g.valid.get(arm.id)!;
        const off = scale(info.n, arm.half);
        result.set(arm.id, {
            left: clean(add(N, off)),
            right: clean(sub(N, off)),
            via: [],
            joint: 'free',
        });
        return result;
    }

    const ordered = orderArms(arms);
    const k = ordered.length;
    for (let idx = 0; idx < k; idx++) {
        const wi = ordered[idx]!;
        const wj = ordered[(idx + 1) % k]!;
        const Bi = clean(add(N, scale(cwSide(wi.u), wi.half)));
        const Bj = clean(add(N, scale(ccwSide(wj.u), wj.half)));
        if (isParallel(wi.u, wj.u)) {
            // Collinear continuation or overlap: perpendicular step (04 §3.3-4).
            wi.cw = Bi;
            wj.ccw = dist(Bi, Bj) <= EPS ? Bi : Bj;
            continue;
        }
        const raw = lineIntersection(Bi, wi.u, Bj, wj.u);
        const P = raw ? clean(raw) : null;
        const valid =
            P !== null &&
            Number.isFinite(P.x) &&
            Number.isFinite(P.y) &&
            len(sub(P, N)) <= MITER_LIMIT * Math.max(wi.half, wj.half) &&
            dot(sub(P, N), wi.u) <= wi.length / 2 &&
            dot(sub(P, N), wj.u) <= wj.length / 2;
        if (valid) {
            wi.cw = P;
            wj.ccw = P;
        } else {
            const M = clean(scale(add(Bi, Bj), 0.5));
            wi.cw = Bi;
            wi.midCw = M;
            wj.ccw = Bj;
            wj.midCcw = M;
        }
    }

    const anyBevel = ordered.some((a) => a.midCw !== null || a.midCcw !== null);
    const joint: WallEnd['joint'] =
        k >= 3 ? 'junction' : anyBevel ? 'bevel' : 'miter';
    for (const arm of ordered) {
        // At node a the outgoing direction is +d, so the cw side is -n (right);
        // at node b it is -d, so the cw side is +n (left) (04 §3.3-5).
        const left = arm.atA ? arm.ccw : arm.cw;
        const right = arm.atA ? arm.cw : arm.ccw;
        // Both ends list the points from the cw corner to the ccw corner (04 §3.3-6).
        const nodeOnLine =
            k === 2 &&
            !anyBevel &&
            Math.abs(ordered[0]!.half - ordered[1]!.half) <= EPS &&
            distPointLine(N, left, right) <= EPS;
        const via: Vec2[] = [];
        if (arm.midCw) via.push(arm.midCw);
        if (!nodeOnLine) via.push(N);
        if (arm.midCcw) via.push(arm.midCcw);
        result.set(arm.id, { left, right, via, joint });
    }
    return result;
}

/** True if two non-adjacent edges of `r` properly cross. */
function selfIntersects(r: Ring): boolean {
    const n = r.length;
    const o = (a: Vec2, b: Vec2, c: Vec2): number =>
        (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    for (let i = 0; i < n; i++) {
        for (let k = i + 2; k < n; k++) {
            if (i === 0 && k === n - 1) continue;
            const a = r[i]!;
            const b = r[i + 1]!;
            const c = r[k]!;
            const d = r[(k + 1) % n]!;
            if (
                o(a, b, c) * o(a, b, d) < -CROSS_TOL &&
                o(c, d, a) * o(c, d, b) < -CROSS_TOL
            ) {
                return true;
            }
        }
    }
    return false;
}

/** Why `buildWallOutline` gave up on the mitered shape. */
export type OutlineFallbackReason = 'degenerate' | 'self_intersection';

/**
 * Closed CW outline of a wall from its two joined ends (04 §3.4). Falls back
 * to the plain rectangle (flagged `fallback: true`, with the cause in
 * `fallbackReason`) when the mitered shape is degenerate (< 3 vertices,
 * area <= 1 mm2) or self-intersecting.
 */
export function buildWallOutline(
    info: WallInfo,
    endA: WallEnd,
    endB: WallEnd,
): {
    outline: Vec2[];
    fallback: boolean;
    fallbackReason: OutlineFallbackReason | null;
} {
    const raw: Ring = [
        endA.left,
        endB.left,
        ...endB.via,
        endB.right,
        endA.right,
        ...endA.via,
    ];
    const outline = ensureCW(simplifyCollinear(raw, EPS));
    const solid = outline.length >= 3 && signedArea(outline) > 1;
    if (solid && !selfIntersects(outline)) {
        return { outline, fallback: false, fallbackReason: null };
    }
    const off = scale(info.n, info.wall.thickness / 2);
    return {
        outline: ensureCW([
            clean(add(info.A, off)),
            clean(add(info.B, off)),
            clean(sub(info.B, off)),
            clean(sub(info.A, off)),
        ]),
        fallback: true,
        fallbackReason: solid ? 'self_intersection' : 'degenerate',
    };
}

/** Joins every node and returns both ends of every valid wall. */
export function computeAllWallEnds(
    g: WallGraph,
): Map<string, { endA: WallEnd; endB: WallEnd }> {
    const joins = new Map<string, Map<string, WallEnd>>();
    for (const nodeId of [...g.incident.keys()].sort(cmpId)) {
        joins.set(nodeId, computeNodeJoins(nodeId, g));
    }
    const out = new Map<string, { endA: WallEnd; endB: WallEnd }>();
    for (const [id, info] of g.valid) {
        const endA = joins.get(info.wall.a)?.get(id);
        const endB = joins.get(info.wall.b)?.get(id);
        if (endA && endB) out.set(id, { endA, endB });
    }
    return out;
}
