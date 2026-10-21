/**
 * Planar graph from wall centre lines, face walk and island nesting
 * (04 §4.1–§4.3). Pure functions; the graph is plain data.
 */
import Flatbush from 'flatbush';
import { pointInRing, signedArea, type Ring } from './polygon';
import { closestPointOnSeg, intersectSegments } from './segment';
import { EPS } from './tolerance';
import { angleOf, cross, dist, lerp, sub, type Vec2 } from './vec2';

export interface PlanarEdge {
    v0: number;
    v1: number;
    /** Sorted, unique ids of the walls that contribute to this edge. */
    wallIds: string[];
}

/**
 * Half-edge `2e` is `edges[e].v0 → v1`, `2e + 1` is `v1 → v0`. `vertices`
 * keeps every clustered point (pruning never renumbers); `out[v]` lists the
 * half-edges leaving `v` sorted by ascending angle (empty for isolated or
 * pruned vertices). `edges` excludes the pruned `filaments`.
 */
export interface PlanarGraph {
    vertices: Vec2[];
    edges: PlanarEdge[];
    out: number[][];
    filaments: PlanarEdge[];
}

export interface FaceCycle {
    ring: Vec2[];
    halfEdges: number[];
    /** Signed area: positive = bounded face (CW on screen), negative = component boundary. */
    area: number;
}

export interface RawFace {
    /** CW (`signedArea > 0`). */
    ring: Vec2[];
    /** CCW (`signedArea < 0`). */
    holes: Vec2[][];
    /** Half-edges of the outer cycle followed by those of every hole cycle; each has this face on its right. */
    halfEdges: number[];
    wallIds: Set<string>;
}

interface SplitPoint {
    t: number;
    id: number;
}

/** Spatial hash with 1 mm cells; a point joins the first cluster representative within `EPS` (04 §2.3). */
class PointClusters {
    readonly points: Vec2[] = [];
    private readonly cells = new Map<string, number[]>();

    private static key(cx: number, cy: number): string {
        return `${cx},${cy}`;
    }

    add(p: Vec2): number {
        // `+ 0` turns -0 into 0 so hashes and outputs never contain it.
        const q: Vec2 = { x: p.x + 0, y: p.y + 0 };
        const cx = Math.floor(q.x);
        const cy = Math.floor(q.y);
        let best = -1;
        let bestD = Infinity;
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                const bucket = this.cells.get(
                    PointClusters.key(cx + dx, cy + dy),
                );
                if (!bucket) continue;
                for (const id of bucket) {
                    const d = dist(this.points[id]!, q);
                    if (d <= EPS && d < bestD) {
                        best = id;
                        bestD = d;
                    }
                }
            }
        }
        if (best >= 0) return best;
        const id = this.points.length;
        this.points.push(q);
        const k = PointClusters.key(cx, cy);
        const bucket = this.cells.get(k);
        if (bucket) bucket.push(id);
        else this.cells.set(k, [id]);
        return id;
    }
}

/**
 * Builds the planar graph of 04 §4.1. Splits happen at segment crossings,
 * at endpoints lying within `EPS` of another segment's interior and at the
 * ends of collinear overlaps; near-parallel segments (within `ANGLE_TOL`)
 * additionally get an exact line crossing, because `intersectSegments` only
 * tests `s2.a` against the line of `s1` in that case and can miss or
 * misreport shallow crossings of long walls.
 */
export function buildPlanarGraph(
    segments: Array<{ a: Vec2; b: Vec2; wallId: string }>,
): PlanarGraph {
    const n = segments.length;
    const clusters = new PointClusters();

    // Endpoints first, so document nodes keep their exact coordinates.
    const endA: number[] = [];
    const endB: number[] = [];
    for (const s of segments) {
        endA.push(clusters.add(s.a));
        endB.push(clusters.add(s.b));
    }

    const splits: SplitPoint[][] = segments.map(() => []);
    const addSplit = (i: number, t: number, p: Vec2): void => {
        splits[i]!.push({ t, id: clusters.add(p) });
    };

    if (n > 1) {
        const index = new Flatbush(n);
        for (const s of segments) {
            index.add(
                Math.min(s.a.x, s.b.x) - EPS,
                Math.min(s.a.y, s.b.y) - EPS,
                Math.max(s.a.x, s.b.x) + EPS,
                Math.max(s.a.y, s.b.y) + EPS,
            );
        }
        index.finish();

        for (let i = 0; i < n; i++) {
            const si = segments[i]!;
            const candidates = index
                .search(
                    Math.min(si.a.x, si.b.x) - EPS,
                    Math.min(si.a.y, si.b.y) - EPS,
                    Math.max(si.a.x, si.b.x) + EPS,
                    Math.max(si.a.y, si.b.y) + EPS,
                )
                .filter((j) => j > i)
                .sort((p, q) => p - q);
            for (const j of candidates) splitPair(i, j, segments, addSplit);
        }
    }

    // Sub-edges, deduplicated by unordered vertex pair.
    const edgeIndex = new Map<string, number>();
    const edgeList: Array<{ v0: number; v1: number; walls: Set<string> }> = [];
    segments.forEach((s, i) => {
        const list: SplitPoint[] = [
            { t: 0, id: endA[i]! },
            ...splits[i]!,
            { t: 1, id: endB[i]! },
        ];
        list.sort((p, q) => p.t - q.t);
        for (let k = 0; k + 1 < list.length; k++) {
            const u = list[k]!.id;
            const w = list[k + 1]!.id;
            if (u === w) continue;
            const key = u < w ? `${u}:${w}` : `${w}:${u}`;
            const found = edgeIndex.get(key);
            if (found === undefined) {
                edgeIndex.set(key, edgeList.length);
                edgeList.push({ v0: u, v1: w, walls: new Set([s.wallId]) });
            } else {
                edgeList[found]!.walls.add(s.wallId);
            }
        }
    });

    const vertices = clusters.points;
    const toEdge = (e: (typeof edgeList)[number]): PlanarEdge => ({
        v0: e.v0,
        v1: e.v1,
        wallIds: [...e.walls].sort(),
    });

    // Filament pruning: peel degree-1 vertices until none remain.
    const degree = new Array<number>(vertices.length).fill(0);
    const incident: number[][] = vertices.map(() => []);
    edgeList.forEach((e, k) => {
        degree[e.v0]!++;
        degree[e.v1]!++;
        incident[e.v0]!.push(k);
        incident[e.v1]!.push(k);
    });
    const removed = new Array<boolean>(edgeList.length).fill(false);
    const removedOrder: number[] = [];
    const stack: number[] = [];
    degree.forEach((d, vi) => {
        if (d === 1) stack.push(vi);
    });
    while (stack.length > 0) {
        const vi = stack.pop()!;
        if (degree[vi] !== 1) continue;
        const k = incident[vi]!.find((e) => !removed[e]);
        if (k === undefined) continue;
        removed[k] = true;
        removedOrder.push(k);
        const e = edgeList[k]!;
        const other = e.v0 === vi ? e.v1 : e.v0;
        degree[vi]!--;
        degree[other]!--;
        if (degree[other] === 1) stack.push(other);
    }

    const edges: PlanarEdge[] = [];
    edgeList.forEach((e, k) => {
        if (!removed[k]) edges.push(toEdge(e));
    });
    const filaments = removedOrder
        .slice()
        .sort((p, q) => p - q)
        .map((k) => toEdge(edgeList[k]!));

    const out: number[][] = vertices.map(() => []);
    edges.forEach((e, k) => {
        out[e.v0]!.push(2 * k);
        out[e.v1]!.push(2 * k + 1);
    });
    const target = (h: number): number => {
        const e = edges[h >> 1]!;
        return h % 2 === 0 ? e.v1 : e.v0;
    };
    out.forEach((hs, vi) => {
        const from = vertices[vi]!;
        const ang = new Map<number, number>();
        for (const h of hs)
            ang.set(h, angleOf(sub(vertices[target(h)]!, from)));
        hs.sort((p, q) => ang.get(p)! - ang.get(q)! || p - q);
    });

    return { vertices, edges, out, filaments };
}

/** Registers the split points of one candidate segment pair (04 §4.1 step 2). */
function splitPair(
    i: number,
    j: number,
    segments: Array<{ a: Vec2; b: Vec2 }>,
    addSplit: (i: number, t: number, p: Vec2) => void,
): void {
    const s1 = segments[i]!;
    const s2 = segments[j]!;

    // Endpoints within EPS of the other segment's interior (covers T joints
    // and the ends of collinear overlaps).
    const touch = (p: Vec2, host: number, other: { a: Vec2; b: Vec2 }) => {
        const c = closestPointOnSeg(p, other);
        if (c.dist <= EPS && c.t > 0 && c.t < 1) addSplit(host, c.t, p);
    };
    touch(s1.a, j, s2);
    touch(s1.b, j, s2);
    touch(s2.a, i, s1);
    touch(s2.b, i, s1);

    const hit = intersectSegments(s1, s2);
    if (hit.kind === 'point') {
        addSplit(i, hit.t, hit.point);
        addSplit(j, hit.u, hit.point);
        return;
    }

    // `none` or `overlap` from the near-parallel branch: take the exact line
    // crossing, which that branch cannot see. Overlap end points are already
    // covered by the endpoint tests above.
    const r = sub(s1.b, s1.a);
    const s = sub(s2.b, s2.a);
    const denom = cross(r, s);
    if (denom === 0) return;
    const qp = sub(s2.a, s1.a);
    const t = cross(qp, s) / denom;
    const u = cross(qp, r) / denom;
    const et = EPS / Math.hypot(r.x, r.y);
    const eu = EPS / Math.hypot(s.x, s.y);
    if (t < -et || t > 1 + et || u < -eu || u > 1 + eu) return;
    const tc = Math.min(1, Math.max(0, t));
    const uc = Math.min(1, Math.max(0, u));
    const p = lerp(s1.a, s1.b, t);
    addSplit(i, tc, p);
    addSplit(j, uc, p);
}

function originOf(graph: PlanarGraph, h: number): number {
    const e = graph.edges[h >> 1]!;
    return h % 2 === 0 ? e.v0 : e.v1;
}

/**
 * Walks every half-edge cycle (04 §4.2). With `next(u→v)` = the half-edge
 * before the twin in ascending-angle order at `v`, bounded faces come out
 * with positive signed area (CW on screen) and the face of `u→v` lies on
 * its right; each connected component adds one negative-area boundary
 * cycle. Cycles under 1 mm² are dropped.
 */
export function walkFaces(graph: PlanarGraph): FaceCycle[] {
    const total = graph.edges.length * 2;
    const posInOut = new Array<number>(total).fill(-1);
    for (const hs of graph.out) hs.forEach((h, k) => (posInOut[h] = k));

    const next = (h: number): number => {
        const v =
            h % 2 === 0 ? graph.edges[h >> 1]!.v1 : graph.edges[h >> 1]!.v0;
        const hs = graph.out[v]!;
        const k = posInOut[h ^ 1]!;
        return hs[(k - 1 + hs.length) % hs.length]!;
    };

    const visited = new Array<boolean>(total).fill(false);
    const cycles: FaceCycle[] = [];
    for (let start = 0; start < total; start++) {
        if (visited[start]) continue;
        const halfEdges: number[] = [];
        const ring: Vec2[] = [];
        let h = start;
        do {
            visited[h] = true;
            halfEdges.push(h);
            ring.push(graph.vertices[originOf(graph, h)]!);
            h = next(h);
        } while (h !== start);
        const area = signedArea(ring);
        if (Math.abs(area) < 1) continue;
        cycles.push({ ring, halfEdges, area });
    }
    return cycles;
}

/**
 * Nests components (04 §4.3): each negative cycle (component boundary)
 * becomes a hole of the smallest positive cycle of a different connected
 * component that contains its first vertex; otherwise it is the plan's
 * outer boundary and is dropped. A negative cycle already has CCW winding,
 * which is what holes need, so it is used as is.
 */
export function nestFaces(graph: PlanarGraph, cycles: FaceCycle[]): RawFace[] {
    // Connected components via union-find over the kept edges.
    const parent = graph.vertices.map((_, i) => i);
    const find = (x: number): number => {
        let r = x;
        while (parent[r] !== r) r = parent[r]!;
        let c = x;
        while (parent[c] !== r) {
            const nx = parent[c]!;
            parent[c] = r;
            c = nx;
        }
        return r;
    };
    for (const e of graph.edges) {
        const a = find(e.v0);
        const b = find(e.v1);
        if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
    }
    const componentOf = (c: FaceCycle): number =>
        find(originOf(graph, c.halfEdges[0]!));

    const faces = cycles
        .filter((c) => c.area > 0)
        .map((c) => ({
            cycle: c,
            component: componentOf(c),
            holes: [] as FaceCycle[],
        }));

    for (const boundary of cycles) {
        if (boundary.area >= 0) continue;
        const comp = componentOf(boundary);
        const probe = boundary.ring[0]!;
        let host: (typeof faces)[number] | null = null;
        for (const f of faces) {
            if (f.component === comp) continue;
            if (f.cycle.area <= -boundary.area) continue;
            if (host && f.cycle.area >= host.cycle.area) continue;
            if (pointInRing(probe, f.cycle.ring) === 'inside') host = f;
        }
        if (host) host.holes.push(boundary);
    }

    return faces.map(({ cycle, holes }): RawFace => {
        const halfEdges = [...cycle.halfEdges];
        for (const hole of holes) halfEdges.push(...hole.halfEdges);
        const wallIds = new Set<string>();
        for (const h of halfEdges)
            for (const id of graph.edges[h >> 1]!.wallIds) wallIds.add(id);
        const holeRings: Ring[] = holes.map((hole) => [...hole.ring]);
        return { ring: [...cycle.ring], holes: holeRings, halfEdges, wallIds };
    });
}
