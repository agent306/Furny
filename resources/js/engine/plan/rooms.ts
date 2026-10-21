/**
 * Room detection (04 §4): face walk over the wall centre lines, net polygons
 * (face minus the union of wall outlines), `faceKey`, label placement,
 * RoomMeta association and the room side of every wall (04 §3.5).
 *
 * Pure functions. Face rings and holes come from the planar graph and are
 * shared with `facePolygon`: treat every returned point as read-only. `-0` is
 * normalised to `0` in every output coordinate.
 */
import { cyrb53 } from '../geometry/hash';
import { difference } from '../geometry/clip';
import {
    buildPlanarGraph,
    nestFaces,
    walkFaces,
    type PlanarGraph,
    type RawFace,
} from '../geometry/planarFaces';
import {
    area,
    isAxisRectangle,
    perimeter,
    pointInPolygon,
    polygonCentroid,
    signedDistToPolygon,
    simplifyCollinear,
    type PolygonWithHoles,
    type Ring,
} from '../geometry/polygon';
import { polylabel } from '../geometry/polylabel';
import { MIN_ROOM_NET_AREA } from '../geometry/tolerance';
import { dist, dot, sub, type Vec2 } from '../geometry/vec2';
import type { DerivedRoom, DerivedWall } from './derive';
import type { PlanDocument } from './schema';
import type { DeriveIssue } from './types';
import type { WallGraph } from './walls';

/** Net polygon and metrics of one face (04 §4.5 steps 2-6), before keys and labels. */
export interface RoomNet {
    /** CW. */
    polygon: Vec2[];
    /** CCW. */
    holes: Vec2[][];
    areaMm2: number;
    perimeterMm: number;
    centroid: Vec2;
    netRect: { width: number; depth: number } | null;
}

/** Room side keys of one wall (04 §3.5); `null` = no room on that side. */
export interface WallRoomSides {
    left: string | null;
    right: string | null;
    /**
     * The side that faces no bounded face at all while the other side does.
     * A side facing a dropped sub-minimum face is not exterior.
     */
    exteriorSide: 'left' | 'right' | null;
}

export interface RoomAnalysis {
    /** Sorted by `faceKey`, `metaId` still `null`, `labelPoint` = pole of inaccessibility. */
    rooms: DerivedRoom[];
    /** Entry for every wall that has at least one non-pruned sub-edge. */
    wallSides: Map<string, WallRoomSides>;
}

const z = (n: number): number => (n === 0 ? 0 : n);
const clean = (p: Vec2): Vec2 => ({ x: z(p.x), y: z(p.y) });
const cmpStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * `'fk_' + cyrb53(sorted unique ids joined '|').toString(36)` (04 §4.6).
 * Collision suffixes are added by `detectRooms`.
 */
export function faceKeyFor(wallIds: string[]): string {
    const ids = [...new Set(wallIds)].sort(cmpStr);
    return `fk_${cyrb53(ids.join('|')).toString(36)}`;
}

/**
 * Net polygon of a face (04 §4.5 steps 2-6): the largest piece of
 * `face − wallsUnion`; `null` when it is smaller than `MIN_ROOM_NET_AREA`
 * (thin faces between near-parallel walls are not rooms). Does not mutate the
 * inputs.
 */
export function computeRoomNet(
    ring: Ring,
    holes: Ring[],
    wallsUnion: PolygonWithHoles[],
): RoomNet | null {
    const pieces = difference([{ outer: ring, holes }], wallsUnion);
    let best: PolygonWithHoles | null = null;
    let bestArea = 0;
    for (const piece of pieces) {
        const a = area(piece);
        if (a > bestArea) {
            best = piece;
            bestArea = a;
        }
    }
    if (!best || bestArea < MIN_ROOM_NET_AREA) return null;

    const polygon = simplifyCollinear(best.outer).map(clean);
    if (polygon.length < 3) return null;
    const netHoles = best.holes
        .map((h) => simplifyCollinear(h).map(clean))
        .filter((h) => h.length >= 3);
    let perimeterMm = perimeter(polygon);
    for (const h of netHoles) perimeterMm += perimeter(h);
    const rect = isAxisRectangle(polygon);
    return {
        polygon,
        holes: netHoles,
        areaMm2: Math.round(bestArea),
        perimeterMm: Math.round(perimeterMm),
        centroid: clean(polygonCentroid(best)),
        // a w x d label would mislead for a room with holes (islands, columns)
        netRect:
            rect && netHoles.length === 0
                ? { width: rect.width, depth: rect.depth }
                : null,
    };
}

/** Wall ids of the outer cycle of a face (hole cycles excluded, 04 §4.6). */
function outerCycleWallIds(pg: PlanarGraph, face: RawFace): string[] {
    const ids = new Set<string>();
    for (const h of face.halfEdges.slice(0, face.ring.length)) {
        for (const id of pg.edges[h >> 1]!.wallIds) ids.add(id);
    }
    return [...ids].sort(cmpStr);
}

interface Candidate {
    faceIndex: number;
    baseKey: string;
    net: RoomNet;
    face: RawFace;
}

/**
 * Detects the rooms of a plan and the room on each side of every wall.
 * Faces whose net area is below `MIN_ROOM_NET_AREA` are dropped (not reported);
 * a wall side facing a dropped face or the outside has key `null`.
 */
export function analyzeRooms(
    graph: WallGraph,
    wallsUnion: PolygonWithHoles[],
    derivedWalls: Record<string, DerivedWall>,
): RoomAnalysis {
    const segments: Array<{ a: Vec2; b: Vec2; wallId: string }> = [];
    for (const [wallId, info] of graph.valid) {
        if (derivedWalls[wallId]) {
            segments.push({ a: info.A, b: info.B, wallId });
        }
    }
    const pg = buildPlanarGraph(segments);
    const faces = nestFaces(pg, walkFaces(pg));

    const candidates: Candidate[] = [];
    faces.forEach((face, faceIndex) => {
        const net = computeRoomNet(face.ring, face.holes, wallsUnion);
        if (!net) return;
        candidates.push({
            faceIndex,
            baseKey: faceKeyFor(outerCycleWallIds(pg, face)),
            net,
            face,
        });
    });

    // Collisions (walls crossing without nodes): ordered by (centroid.y, x).
    const groups = new Map<string, Candidate[]>();
    for (const c of candidates) {
        const list = groups.get(c.baseKey);
        if (list) list.push(c);
        else groups.set(c.baseKey, [c]);
    }
    const keyOfFace = new Map<number, string>();
    for (const [baseKey, list] of groups) {
        list.sort(
            (p, q) =>
                p.net.centroid.y - q.net.centroid.y ||
                p.net.centroid.x - q.net.centroid.x,
        );
        list.forEach((c, i) => {
            keyOfFace.set(
                c.faceIndex,
                i === 0 ? baseKey : `${baseKey}_${i + 1}`,
            );
        });
    }

    const rooms: DerivedRoom[] = candidates.map((c) => {
        const { net, face } = c;
        const facePolygon: PolygonWithHoles = {
            outer: face.ring,
            holes: face.holes,
        };
        const label = polylabel({ outer: net.polygon, holes: net.holes });
        return {
            faceKey: keyOfFace.get(c.faceIndex)!,
            polygon: net.polygon,
            areaMm2: net.areaMm2,
            perimeterMm: net.perimeterMm,
            centroid: net.centroid,
            metaId: null,
            holes: net.holes,
            facePolygon,
            labelPoint: clean(label.point),
            labelRadius: label.distance,
            wallIds: [...face.wallIds].sort(cmpStr),
            netRect: net.netRect,
        };
    });
    rooms.sort((p, q) => cmpStr(p.faceKey, q.faceKey));

    // Room on the right of every half-edge (04 §4.2).
    const faceOfHalfEdge = new Map<number, number>();
    faces.forEach((face, faceIndex) => {
        for (const h of face.halfEdges) faceOfHalfEdge.set(h, faceIndex);
    });
    const sideOfHalfEdge = (h: number): Side => {
        const f = faceOfHalfEdge.get(h);
        return f === undefined
            ? { key: null, outside: true, length: 0 }
            : { key: keyOfFace.get(f) ?? null, outside: false, length: 0 };
    };

    // Per wall and side, the face of the longest sub-edge (04 §3.5).
    interface Side {
        key: string | null;
        /** Faces the unbounded outside (no face at all, not even a dropped one). */
        outside: boolean;
        length: number;
    }
    const best = new Map<string, { left: Side; right: Side }>();
    pg.edges.forEach((edge, e) => {
        const v0 = pg.vertices[edge.v0]!;
        const v1 = pg.vertices[edge.v1]!;
        const length = dist(v0, v1);
        for (const wallId of edge.wallIds) {
            const info = graph.valid.get(wallId);
            if (!info) continue;
            const forward = dot(sub(v1, v0), info.d) > 0;
            const right = {
                ...sideOfHalfEdge(forward ? 2 * e : 2 * e + 1),
                length,
            };
            const left = {
                ...sideOfHalfEdge(forward ? 2 * e + 1 : 2 * e),
                length,
            };
            const entry = best.get(wallId);
            if (!entry) {
                best.set(wallId, { left, right });
                continue;
            }
            if (length > entry.left.length) entry.left = left;
            if (length > entry.right.length) entry.right = right;
        }
    });
    const wallSides = new Map<string, WallRoomSides>();
    for (const [wallId, s] of best) {
        wallSides.set(wallId, {
            left: s.left.key,
            right: s.right.key,
            exteriorSide:
                s.left.outside && !s.right.outside
                    ? 'left'
                    : s.right.outside && !s.left.outside
                      ? 'right'
                      : null,
        });
    }
    return { rooms, wallSides };
}

/** The rooms of a plan, sorted by `faceKey` (04 §4). See `analyzeRooms`. */
export function detectRooms(
    doc: PlanDocument,
    graph: WallGraph,
    wallsUnion: PolygonWithHoles[],
    derivedWalls: Record<string, DerivedWall>,
): DerivedRoom[] {
    return analyzeRooms(graph, wallsUnion, derivedWalls).rooms;
}

/**
 * RoomMeta association (04 §4.4 a, §4.7): a meta belongs to the room whose
 * centre-line face (holes excluded) contains its anchor; with several metas in
 * one room the smallest id wins and the others get `room_meta_duplicate`.
 * Metas inside no face stay orphaned. The winner's `labelOffset` places the
 * label at `centroid + labelOffset`. Returns new room objects for associated
 * rooms; the others are returned as is.
 */
export function associateRoomMetas(
    rooms: DerivedRoom[],
    doc: PlanDocument,
): { rooms: DerivedRoom[]; issues: DeriveIssue[] } {
    const issues: DeriveIssue[] = [];
    const metaIds = Object.keys(doc.rooms).sort(cmpStr);
    const inside = rooms.map(() => [] as string[]);
    for (const id of metaIds) {
        const anchor = doc.rooms[id]!.anchor;
        const at = rooms.findIndex(
            (r) => pointInPolygon(anchor, r.facePolygon) === 'inside',
        );
        if (at >= 0) inside[at]!.push(id);
    }

    const result = rooms.map((room, i): DerivedRoom => {
        const ids = inside[i]!;
        const winnerId = ids[0];
        if (winnerId === undefined) return room;
        for (const loser of ids.slice(1)) {
            issues.push({
                code: 'room_meta_duplicate',
                messageKey: 'engine.plan.derive.room_meta_duplicate',
                params: {
                    metaId: loser,
                    keptMetaId: winnerId,
                    faceKey: room.faceKey,
                },
                severity: 'warning',
                entityIds: [loser, winnerId],
            });
        }
        const offset = doc.rooms[winnerId]!.labelOffset;
        if (offset === null) return { ...room, metaId: winnerId };
        const labelPoint = clean({
            x: room.centroid.x + offset.x,
            y: room.centroid.y + offset.y,
        });
        return {
            ...room,
            metaId: winnerId,
            labelPoint,
            labelRadius: Math.max(
                0,
                signedDistToPolygon(labelPoint, {
                    outer: room.polygon,
                    holes: room.holes,
                }),
            ),
        };
    });
    return { rooms: result, issues };
}
