/**
 * `derivePlanGeometry`: wall outlines, opening frames, poché, node caps and
 * the exterior outline (04 §3.1, §3.5-§3.8, §7.1; 03 §1.2).
 *
 * Plan space is x right, y down (04 §2.1). The function is pure: the input
 * document is never mutated and `-0` is normalised to `0` in every output
 * coordinate. Vertices are shared between structures (an outline contains the
 * very `Vec2` objects of its `WallEnd`s, `leftFace`, ...), so consumers must
 * treat all returned points as read-only.
 *
 * Room detection (04 §4) arrives in a later task: until then `rooms` is empty
 * and `leftRoomKey`, `rightRoomKey` and `exteriorSide` are `null`.
 */
import { difference, union } from '../geometry/clip';
import {
    ensureCW,
    ringBBox,
    signedArea,
    type PolygonWithHoles,
    type Ring,
} from '../geometry/polygon';
import { EPS } from '../geometry/tolerance';
import {
    add,
    angleOf,
    dist,
    dot,
    scale,
    sub,
    type Vec2,
} from '../geometry/vec2';
import type { Opening, PlanDocument, Wall } from './schema';
import type { DeriveIssue } from './types';
import {
    buildWallGraph,
    buildWallOutline,
    computeAllWallEnds,
    type WallEnd,
    type WallInfo,
} from './walls';

/** A room found by room detection (04 §4.5); filled by a later task. */
export interface DerivedRoom {
    faceKey: string;
    /** Net polygon (CW). */
    polygon: Vec2[];
    areaMm2: number;
    perimeterMm: number;
    centroid: Vec2;
    metaId: string | null;
    /** CCW hole rings of the net polygon. */
    holes: Vec2[][];
    /** Centre-line face, used for anchor containment and overlap. */
    facePolygon: PolygonWithHoles;
    labelPoint: Vec2;
    labelRadius: number;
    /** Sorted, unique ids of the walls bounding the face. */
    wallIds: string[];
    netRect: { width: number; depth: number } | null;
}

export interface DerivedWall {
    centerline: [Vec2, Vec2];
    /** CW mitered polygon (04 §3.4). */
    outline: Vec2[];
    leftFace: [Vec2, Vec2];
    rightFace: [Vec2, Vec2];
    /** Centre-line length (float). */
    length: number;
    /** Along-wall interval of each opening, sorted by `u0`. */
    openings: Array<{ id: string; u0: number; u1: number }>;
    id: string;
    dir: Vec2;
    normal: Vec2;
    thickness: number;
    height: number;
    kind: Wall['kind'];
    endA: WallEnd;
    endB: WallEnd;
    /** faceKey of the room on the +n side; `null` until room detection runs. */
    leftRoomKey: string | null;
    rightRoomKey: string | null;
    exteriorSide: 'left' | 'right' | null;
    /** Outline minus the opening cut rectangles (04 §3.7). */
    pocheParts: PolygonWithHoles[];
    /** u-range where both faces are full depth (04 §3.6-5). */
    safeU: [number, number];
}

export interface DerivedOpening {
    id: string;
    wallId: string;
    u0: number;
    u1: number;
    /** Middle of `[u0, u1]` on the centre line. */
    center: Vec2;
    /** CW rectangle across the wall from `u0` to `u1`, 0.5 mm beyond each face. */
    cut: Vec2[];
    jambStart: { left: Vec2; right: Vec2 };
    jambEnd: { left: Vec2; right: Vec2 };
    /** +1 = swings to +n (`'left'`). */
    swingSign: 1 | -1;
    hingeU: number;
    issues: DeriveIssue[];
}

export interface DerivedPlan {
    walls: Record<string, DerivedWall>;
    /** Sorted by faceKey. */
    rooms: DerivedRoom[];
    openings: Record<string, DerivedOpening>;
    /** Incident valid walls (sorted by wall id) of every node in the plan. */
    nodes: Record<string, { wallIds: string[] }>;
    nodeCaps: Record<string, Vec2[]>;
    wallsUnion: PolygonWithHoles[];
    roomIndexByMetaId: Record<string, number>;
    roomIndexByFaceKey: Record<string, number>;
    bbox: { min: Vec2; max: Vec2 };
    exteriorOutline: Vec2[] | null;
    issues: DeriveIssue[];
    /** The document this was derived from (identity). */
    docRef: PlanDocument;
}

/** Distance by which opening cuts overshoot each wall face (04 §3.6-3). */
const CUT_OVERSHOOT = 0.5;
/** Float noise allowed when comparing an opening to `safeU`. */
const U_TOL = 1e-6;

const z = (n: number): number => (n === 0 ? 0 : n);
const clean = (p: Vec2): Vec2 => ({ x: z(p.x), y: z(p.y) });
const cmpId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const issue = (
    code: string,
    severity: DeriveIssue['severity'],
    params: DeriveIssue['params'],
    entityIds: string[],
): DeriveIssue => ({
    code,
    messageKey: `engine.plan.derive.${code}`,
    params,
    severity,
    entityIds,
});

/** Frame of one opening on its wall (04 §3.6 steps 1-4). */
function buildOpening(
    o: Opening,
    info: WallInfo,
    safeU: [number, number],
): DerivedOpening {
    const { A, d, n, length } = info;
    const half = info.wall.thickness / 2;
    const issues: DeriveIssue[] = [];

    const raw0 = o.offset - o.width / 2;
    const raw1 = o.offset + o.width / 2;
    const u0 = Math.min(Math.max(raw0, 0), length);
    const u1 = Math.min(Math.max(raw1, 0), length);
    if (u0 !== raw0 || u1 !== raw1) {
        issues.push(
            issue(
                'opening_clamped',
                'warning',
                { openingId: o.id, wallId: o.wallId, u0: raw0, u1: raw1 },
                [o.id, o.wallId],
            ),
        );
    }
    if (u0 < safeU[0] - U_TOL || u1 > safeU[1] + U_TOL) {
        issues.push(
            issue(
                'opening_in_junction',
                'info',
                { openingId: o.id, wallId: o.wallId, u0, u1 },
                [o.id, o.wallId],
            ),
        );
    }

    const pointAt = (u: number): Vec2 => clean(add(A, scale(d, u)));
    const jamb = (u: number): { left: Vec2; right: Vec2 } => {
        const p = pointAt(u);
        const off = scale(n, half);
        return { left: clean(add(p, off)), right: clean(sub(p, off)) };
    };
    const jambStart = jamb(u0);
    const jambEnd = jamb(u1);
    const reach = scale(n, half + CUT_OVERSHOOT);
    const p0 = pointAt(u0);
    const p1 = pointAt(u1);
    const cut = ensureCW([
        clean(add(p0, reach)),
        clean(add(p1, reach)),
        clean(sub(p1, reach)),
        clean(sub(p0, reach)),
    ]);

    return {
        id: o.id,
        wallId: o.wallId,
        u0,
        u1,
        center: pointAt((u0 + u1) / 2),
        cut,
        jambStart,
        jambEnd,
        swingSign: o.swing === 'left' ? 1 : -1,
        hingeU: o.hinge === 'start' ? u0 : u1,
        issues,
    };
}

/** Poché of one wall: the outline minus its opening cuts (04 §3.7). */
function buildPoche(outline: Ring, cuts: Ring[]): PolygonWithHoles[] {
    const solid = cuts.filter((c) => signedArea(c) > 1);
    if (solid.length === 0) return [{ outer: outline, holes: [] }];
    return difference(
        [{ outer: outline, holes: [] }],
        solid.map((c) => ({ outer: c, holes: [] })),
    );
}

/**
 * Node cap ring (04 §3.8): the distinct corners of the walls ending at `N`
 * sorted clockwise on screen. `null` when fewer than three corners remain.
 */
function buildNodeCap(N: Vec2, ends: WallEnd[]): Vec2[] | null {
    const corners: Vec2[] = [];
    for (const end of ends) {
        for (const c of [end.left, end.right]) {
            if (!corners.some((q) => dist(q, c) <= EPS)) corners.push(c);
        }
    }
    if (corners.length < 3) return null;
    corners.sort(
        (p, q) => angleOf(sub(p, N)) - angleOf(sub(q, N)) || p.x - q.x,
    );
    return corners;
}

function emptyBBox(): { min: Vec2; max: Vec2 } {
    return { min: { x: 0, y: 0 }, max: { x: 0, y: 0 } };
}

function bboxOf(points: Vec2[]): { min: Vec2; max: Vec2 } {
    return points.length === 0 ? emptyBBox() : ringBBox(points);
}

/** Derives walls, openings, poché, node caps and the exterior outline. */
export function derivePlanGeometry(doc: PlanDocument): DerivedPlan {
    const g = buildWallGraph(doc);
    const ends = computeAllWallEnds(g);
    const issues: DeriveIssue[] = [...g.issues];

    // Openings per wall (those on missing or skipped walls are skipped).
    const openingsByWall = new Map<string, Opening[]>();
    const skippedOpenings: DeriveIssue[] = [];
    for (const id of Object.keys(doc.openings).sort(cmpId)) {
        const o = doc.openings[id]!;
        if (!g.valid.has(o.wallId) || !ends.has(o.wallId)) {
            skippedOpenings.push(
                issue(
                    'opening_skipped',
                    'warning',
                    { openingId: id, wallId: o.wallId },
                    [id, o.wallId],
                ),
            );
            continue;
        }
        const list = openingsByWall.get(o.wallId);
        if (list) list.push(o);
        else openingsByWall.set(o.wallId, [o]);
    }

    const walls: Record<string, DerivedWall> = {};
    const openings: Record<string, DerivedOpening> = {};
    const openingIssues: DeriveIssue[] = [];

    for (const [id, info] of g.valid) {
        const e = ends.get(id);
        if (!e) continue;
        const { endA, endB } = e;
        const built = buildWallOutline(info, endA, endB);
        const { A, B, d, n, length } = info;
        const half = info.wall.thickness / 2;
        if (built.fallback) {
            issues.push(
                issue(
                    'outline_fallback',
                    built.fallbackReason === 'self_intersection'
                        ? 'info'
                        : 'warning',
                    {
                        wallId: id,
                        reason: built.fallbackReason ?? 'degenerate',
                    },
                    [id],
                ),
            );
        }

        // A fallback outline is the plain rectangle, so faces and the usable
        // range follow it instead of the (unusable) mitered corners.
        const off = scale(n, half);
        const leftFace: [Vec2, Vec2] = built.fallback
            ? [clean(add(A, off)), clean(add(B, off))]
            : [endA.left, endB.left];
        const rightFace: [Vec2, Vec2] = built.fallback
            ? [clean(sub(A, off)), clean(sub(B, off))]
            : [endA.right, endB.right];
        const along = (p: Vec2): number => dot(sub(p, A), d);
        const safeU: [number, number] = built.fallback
            ? [0, length]
            : [
                  Math.max(0, along(endA.left), along(endA.right)),
                  Math.min(length, along(endB.left), along(endB.right)),
              ];

        const derived = (openingsByWall.get(id) ?? [])
            .map((o) => buildOpening(o, info, safeU))
            .sort((p, q) => p.u0 - q.u0 || cmpId(p.id, q.id));
        for (const o of derived) {
            openings[o.id] = o;
            openingIssues.push(...o.issues);
        }

        walls[id] = {
            centerline: [A, B],
            outline: built.outline,
            leftFace,
            rightFace,
            length,
            openings: derived.map((o) => ({ id: o.id, u0: o.u0, u1: o.u1 })),
            id,
            dir: d,
            normal: n,
            thickness: info.wall.thickness,
            height: info.wall.height,
            kind: info.wall.kind,
            endA,
            endB,
            leftRoomKey: null,
            rightRoomKey: null,
            exteriorSide: null,
            pocheParts: buildPoche(
                built.outline,
                derived.map((o) => o.cut),
            ),
            safeU,
        };
    }
    issues.push(...skippedOpenings, ...openingIssues);

    const nodes: Record<string, { wallIds: string[] }> = {};
    for (const nodeId of Object.keys(doc.nodes).sort(cmpId)) {
        nodes[nodeId] = { wallIds: [...(g.incident.get(nodeId) ?? [])] };
    }

    const nodeCaps: Record<string, Vec2[]> = {};
    for (const [nodeId, wallIds] of g.incident) {
        const node = doc.nodes[nodeId];
        if (!node) continue;
        const nodeEnds: WallEnd[] = [];
        for (const wid of wallIds) {
            const e = ends.get(wid);
            if (!e) continue;
            nodeEnds.push(
                g.valid.get(wid)!.wall.a === nodeId ? e.endA : e.endB,
            );
        }
        if (
            !nodeEnds.some((x) => x.joint === 'junction' || x.joint === 'bevel')
        ) {
            continue;
        }
        const cap = buildNodeCap(clean({ x: node.x, y: node.y }), nodeEnds);
        if (cap) nodeCaps[nodeId] = cap;
    }

    const outlines = Object.keys(walls)
        .sort(cmpId)
        .map((id) => walls[id]!.outline);
    const wallsUnion =
        outlines.length === 0
            ? []
            : union(outlines.map((outer) => ({ outer, holes: [] })));
    let exteriorOutline: Vec2[] | null = null;
    let best = 0;
    for (const p of wallsUnion) {
        const a = Math.abs(signedArea(p.outer));
        if (a > best) {
            best = a;
            exteriorOutline = p.outer;
        }
    }

    const bbox =
        outlines.length > 0
            ? bboxOf(outlines.flat())
            : bboxOf(
                  Object.values(doc.nodes).map((nd) =>
                      clean({ x: nd.x, y: nd.y }),
                  ),
              );

    return {
        walls,
        rooms: [],
        openings,
        nodes,
        nodeCaps,
        wallsUnion,
        roomIndexByMetaId: {},
        roomIndexByFaceKey: {},
        bbox,
        exteriorOutline,
        issues,
        docRef: doc,
    };
}
