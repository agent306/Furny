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
 * `createPlanDeriver` caches by entity identity (04 §7.2); `derivePlanGeometry`
 * is a fresh deriver per call.
 *
 * Rooms (04 §4) are detected from the wall centre lines and the union of the
 * wall outlines, then associated with the document's `RoomMeta` anchors.
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
import {
    analyzeRooms,
    associateRoomMetas,
    resolveRoomNet,
    type ResolvedRoomNet,
    type RoomNetResolver,
} from './rooms';
import type { DeriveIssue } from './types';
import {
    buildWallGraph,
    buildWallOutline,
    computeNodeJoins,
    type WallEnd,
    type WallGraph,
    type WallInfo,
} from './walls';
import { cmpId } from '../compare';

/** A room found by room detection (04 §4.5). */
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
    /** faceKey of the room on the +n side; `null` when there is none. */
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

/** Counts of what the last `derive` call recomputed (tests, perf diagnostics). */
export interface DeriverStats {
    /** Nodes whose joins were recomputed. */
    joins: number;
    /** Walls whose outline, openings or poché were recomputed. */
    outlines: number;
    /** Faces whose net polygon (and label) was recomputed. */
    roomNets: number;
    /** The whole previous result was returned (only `docRef` may differ). */
    fullHit: boolean;
}

export interface PlanDeriver {
    derive(doc: PlanDocument): DerivedPlan;
    /** Drops every cache; the next `derive` recomputes everything. */
    clear(): void;
    stats(): DeriverStats;
}

type WallShape = Pick<
    DerivedWall,
    | 'centerline'
    | 'outline'
    | 'leftFace'
    | 'rightFace'
    | 'length'
    | 'id'
    | 'dir'
    | 'normal'
    | 'thickness'
    | 'height'
    | 'kind'
    | 'endA'
    | 'endB'
    | 'safeU'
>;

/** Cached derivation of one wall (04 §7.2-4). */
interface WallEntry {
    wall: Wall;
    endA: WallEnd;
    endB: WallEnd;
    shape: WallShape;
    bbox: { min: Vec2; max: Vec2 };
    fallbackIssue: DeriveIssue | null;
    openings: Opening[];
    derived: DerivedOpening[];
    openingIssues: DeriveIssue[];
    /** Room fields are `null`; every `derive` copies it and fills them in. */
    base: DerivedWall;
}

/** Cached join of one node (04 §7.2-3). */
interface NodeEntry {
    sig: string;
    joins: Map<string, WallEnd>;
}

/** Cached net of one face (04 §7.2-6). */
interface NetEntry {
    /** The outlines it was computed against. */
    clip: Ring[];
    resolved: ResolvedRoomNet | null;
}

/** Everything that depends only on `nodes`, `walls` and `openings`. */
interface Core {
    walls: Record<string, DerivedWall>;
    openings: Record<string, DerivedOpening>;
    nodes: Record<string, { wallIds: string[] }>;
    nodeCaps: Record<string, Vec2[]>;
    wallsUnion: PolygonWithHoles[];
    bbox: { min: Vec2; max: Vec2 };
    exteriorOutline: Vec2[] | null;
    /** All issues except those of the RoomMeta association. */
    issues: DeriveIssue[];
    /** Rooms before the RoomMeta association. */
    rooms: DerivedRoom[];
}

interface UnionEntry {
    outlines: Ring[];
    wallsUnion: PolygonWithHoles[];
    exteriorOutline: Vec2[] | null;
    bbox: { min: Vec2; max: Vec2 };
}

const SEP = '\u0001';

const sameRefs = <T>(a: readonly T[], b: readonly T[]): boolean =>
    a.length === b.length && a.every((x, i) => x === b[i]);

/** Boxes that share area; touching along an edge cannot change a difference. */
const boxesOverlap = (
    a: { min: Vec2; max: Vec2 },
    b: { min: Vec2; max: Vec2 },
): boolean =>
    a.min.x < b.max.x &&
    b.min.x < a.max.x &&
    a.min.y < b.max.y &&
    b.min.y < a.max.y;

const ringKey = (ring: Ring, holes: Ring[]): string => {
    const one = (r: Ring): string => r.map((p) => `${p.x},${p.y}`).join(';');
    return [ring, ...holes].map(one).join('/');
};

/** Signature of everything `computeNodeJoins` reads for one node (04 §7.2-3). */
function nodeSignature(nodeId: string, ids: string[], g: WallGraph): string {
    const parts: string[] = [];
    let at = '';
    for (const id of ids) {
        const info = g.valid.get(id)!;
        const atA = info.wall.a === nodeId;
        const own = atA ? info.A : info.B;
        const other = atA ? info.B : info.A;
        at = `${own.x},${own.y}`;
        parts.push(
            `${id}:${atA ? 'a' : 'b'}:${other.x},${other.y}:${info.wall.thickness}`,
        );
    }
    return [at, ...parts].join(SEP);
}

/** Outline, faces and usable range of one wall from its joined ends. */
function buildWallShape(
    id: string,
    info: WallInfo,
    endA: WallEnd,
    endB: WallEnd,
): { shape: WallShape; fallbackIssue: DeriveIssue | null } {
    const built = buildWallOutline(info, endA, endB);
    const { A, B, d, n, length } = info;
    const half = info.wall.thickness / 2;
    const fallbackIssue = built.fallback
        ? issue(
              'outline_fallback',
              built.fallbackReason === 'self_intersection' ? 'info' : 'warning',
              {
                  wallId: id,
                  reason: built.fallbackReason ?? 'degenerate',
              },
              [id],
          )
        : null;

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
    return {
        shape: {
            centerline: [A, B],
            outline: built.outline,
            leftFace,
            rightFace,
            length,
            id,
            dir: d,
            normal: n,
            thickness: info.wall.thickness,
            height: info.wall.height,
            kind: info.wall.kind,
            endA,
            endB,
            safeU,
        },
        fallbackIssue,
    };
}

/**
 * Creates a deriver that caches by entity identity (04 §7.2): with a
 * structurally shared document (mutative) only what an edit touched is
 * recomputed. Results equal those of a fresh deriver.
 */
export function createPlanDeriver(): PlanDeriver {
    let lastDoc: PlanDocument | null = null;
    let lastResult: DerivedPlan | null = null;
    let lastCore: Core | null = null;
    let nodeCache = new Map<string, NodeEntry>();
    let wallCache = new Map<string, WallEntry>();
    let netCache = new Map<string, NetEntry>();
    let unionCache: UnionEntry | null = null;
    let lastStats: DeriverStats = {
        joins: 0,
        outlines: 0,
        roomNets: 0,
        fullHit: false,
    };

    function deriveCore(doc: PlanDocument, stats: DeriverStats): Core {
        const g = buildWallGraph(doc);
        const issues: DeriveIssue[] = [...g.issues];

        // Node joins (04 §7.2-3).
        const nextNodes = new Map<string, NodeEntry>();
        const ends = new Map<string, { endA: WallEnd; endB: WallEnd }>();
        const joinsOf = new Map<string, Map<string, WallEnd>>();
        for (const nodeId of [...g.incident.keys()].sort(cmpId)) {
            const ids = g.incident.get(nodeId)!;
            const sig = nodeSignature(nodeId, ids, g);
            let entry = nodeCache.get(nodeId);
            if (!entry || entry.sig !== sig) {
                stats.joins += 1;
                entry = { sig, joins: computeNodeJoins(nodeId, g) };
            }
            nextNodes.set(nodeId, entry);
            joinsOf.set(nodeId, entry.joins);
        }
        for (const [id, info] of g.valid) {
            const endA = joinsOf.get(info.wall.a)?.get(id);
            const endB = joinsOf.get(info.wall.b)?.get(id);
            if (endA && endB) ends.set(id, { endA, endB });
        }

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

        // Wall outlines and poché (04 §7.2-4).
        const nextWalls = new Map<string, WallEntry>();
        const walls: Record<string, DerivedWall> = {};
        const openings: Record<string, DerivedOpening> = {};
        const openingIssues: DeriveIssue[] = [];
        for (const [id, info] of g.valid) {
            const e = ends.get(id);
            if (!e) continue;
            const { endA, endB } = e;
            const list = openingsByWall.get(id) ?? [];
            const prev = wallCache.get(id);
            const reusableEntry =
                prev !== undefined &&
                prev.wall === info.wall &&
                prev.endA === endA &&
                prev.endB === endB
                    ? prev
                    : null;
            let entry: WallEntry;
            if (reusableEntry && sameRefs(reusableEntry.openings, list)) {
                entry = reusableEntry;
            } else {
                stats.outlines += 1;
                const built =
                    reusableEntry ?? buildWallShape(id, info, endA, endB);
                const shape = built.shape;
                const derived = list
                    .map((o) => buildOpening(o, info, shape.safeU))
                    .sort((p, q) => p.u0 - q.u0 || cmpId(p.id, q.id));
                entry = {
                    wall: info.wall,
                    endA,
                    endB,
                    shape,
                    bbox: reusableEntry?.bbox ?? ringBBox(shape.outline),
                    fallbackIssue: built.fallbackIssue,
                    openings: list,
                    derived,
                    openingIssues: derived.flatMap((o) => o.issues),
                    base: {
                        ...shape,
                        openings: derived.map((o) => ({
                            id: o.id,
                            u0: o.u0,
                            u1: o.u1,
                        })),
                        leftRoomKey: null,
                        rightRoomKey: null,
                        exteriorSide: null,
                        pocheParts: buildPoche(
                            shape.outline,
                            derived.map((o) => o.cut),
                        ),
                    },
                };
            }
            nextWalls.set(id, entry);
            if (entry.fallbackIssue) issues.push(entry.fallbackIssue);
            for (const o of entry.derived) openings[o.id] = o;
            openingIssues.push(...entry.openingIssues);
            walls[id] = { ...entry.base };
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
                !nodeEnds.some(
                    (x) => x.joint === 'junction' || x.joint === 'bevel',
                )
            ) {
                continue;
            }
            const cap = buildNodeCap(clean({ x: node.x, y: node.y }), nodeEnds);
            if (cap) nodeCaps[nodeId] = cap;
        }

        // Union, exterior outline, bbox (04 §7.2-7).
        const wallIds = Object.keys(walls).sort(cmpId);
        const outlines = wallIds.map((id) => walls[id]!.outline);
        let unionEntry = unionCache;
        if (!unionEntry || !sameRefs(unionEntry.outlines, outlines)) {
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
            unionEntry = {
                outlines,
                wallsUnion,
                exteriorOutline,
                bbox:
                    outlines.length > 0 ? bboxOf(outlines.flat()) : emptyBBox(),
            };
        }
        const bbox =
            outlines.length > 0
                ? unionEntry.bbox
                : bboxOf(
                      Object.values(doc.nodes).map((nd) =>
                          clean({ x: nd.x, y: nd.y }),
                      ),
                  );

        // Room nets, local to each face (04 §7.2-5, §7.2-6).
        const nextNets = new Map<string, NetEntry>();
        const localBoxes = wallIds.map((id) => ({
            outline: walls[id]!.outline,
            bbox: nextWalls.get(id)!.bbox,
        }));
        const resolveNet: RoomNetResolver = (ring, holes) => {
            const key = ringKey(ring, holes);
            const faceBox = ringBBox(ring);
            const clip = localBoxes
                .filter((w) => boxesOverlap(w.bbox, faceBox))
                .map((w) => w.outline);
            let entry = netCache.get(key);
            if (!entry || !sameRefs(entry.clip, clip)) {
                stats.roomNets += 1;
                entry = {
                    clip,
                    resolved: resolveRoomNet(
                        ring,
                        holes,
                        clip.map((outer) => ({ outer, holes: [] })),
                    ),
                };
            }
            nextNets.set(key, entry);
            return entry.resolved;
        };
        const analysis = analyzeRooms(
            g,
            unionEntry.wallsUnion,
            walls,
            resolveNet,
        );
        for (const [wallId, sides] of analysis.wallSides) {
            const w = walls[wallId];
            if (!w) continue;
            w.leftRoomKey = sides.left;
            w.rightRoomKey = sides.right;
            w.exteriorSide = sides.exteriorSide;
        }

        nodeCache = nextNodes;
        wallCache = nextWalls;
        netCache = nextNets;
        unionCache = unionEntry;
        return {
            walls,
            openings,
            nodes,
            nodeCaps,
            wallsUnion: unionEntry.wallsUnion,
            bbox,
            exteriorOutline: unionEntry.exteriorOutline,
            issues,
            rooms: analysis.rooms,
        };
    }

    function assemble(doc: PlanDocument, core: Core): DerivedPlan {
        const associated = associateRoomMetas(core.rooms, doc);
        const rooms = associated.rooms;
        const roomIndexByMetaId: Record<string, number> = {};
        const roomIndexByFaceKey: Record<string, number> = {};
        rooms.forEach((room, i) => {
            roomIndexByFaceKey[room.faceKey] = i;
            if (room.metaId !== null) roomIndexByMetaId[room.metaId] = i;
        });
        return {
            walls: core.walls,
            rooms,
            openings: core.openings,
            nodes: core.nodes,
            nodeCaps: core.nodeCaps,
            wallsUnion: core.wallsUnion,
            roomIndexByMetaId,
            roomIndexByFaceKey,
            bbox: core.bbox,
            exteriorOutline: core.exteriorOutline,
            issues: [...core.issues, ...associated.issues],
            docRef: doc,
        };
    }

    return {
        derive(doc) {
            const stats: DeriverStats = {
                joins: 0,
                outlines: 0,
                roomNets: 0,
                fullHit: false,
            };
            const prev = lastDoc;
            const geometrySame =
                prev !== null &&
                lastCore !== null &&
                prev.nodes === doc.nodes &&
                prev.walls === doc.walls &&
                prev.openings === doc.openings;
            let result: DerivedPlan;
            if (geometrySame && lastResult && prev.rooms === doc.rooms) {
                // Whole result (04 §7.2-1).
                stats.fullHit = true;
                result =
                    lastResult.docRef === doc
                        ? lastResult
                        : { ...lastResult, docRef: doc };
            } else if (geometrySame) {
                // Rooms association only (04 §7.2-2).
                result = assemble(doc, lastCore!);
            } else {
                lastCore = deriveCore(doc, stats);
                result = assemble(doc, lastCore);
            }
            lastDoc = doc;
            lastResult = result;
            lastStats = stats;
            return result;
        },
        clear() {
            lastDoc = null;
            lastResult = null;
            lastCore = null;
            nodeCache = new Map();
            wallCache = new Map();
            netCache = new Map();
            unionCache = null;
        },
        stats() {
            return { ...lastStats };
        },
    };
}

/** Derives walls, openings, poché, node caps, rooms and the exterior outline. */
export function derivePlanGeometry(doc: PlanDocument): DerivedPlan {
    return createPlanDeriver().derive(doc);
}
