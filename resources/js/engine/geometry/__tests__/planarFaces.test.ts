import { describe, expect, it } from 'vitest';
import { signedArea } from '../polygon';
import {
    buildPlanarGraph,
    nestFaces,
    walkFaces,
    type PlanarGraph,
} from '../planarFaces';
import { v, type Vec2 } from '../vec2';

type S = { a: Vec2; b: Vec2; wallId: string };

const seg = (
    id: string,
    ax: number,
    ay: number,
    bx: number,
    by: number,
): S => ({ a: v(ax, ay), b: v(bx, by), wallId: id });

/** Closed polyline of axis points as one wall per side, ids `${prefix}0..`. */
function loop(prefix: string, pts: Array<[number, number]>): S[] {
    return pts.map((p, i) => {
        const q = pts[(i + 1) % pts.length]!;
        return seg(`${prefix}${i}`, p[0], p[1], q[0], q[1]);
    });
}

const square = (prefix: string, x: number, y: number, size: number): S[] =>
    loop(prefix, [
        [x, y],
        [x + size, y],
        [x + size, y + size],
        [x, y + size],
    ]);

const vertexAt = (g: PlanarGraph, x: number, y: number): number =>
    g.vertices.findIndex((p) => p.x === x && p.y === y);

function analyse(segments: S[]) {
    const graph = buildPlanarGraph(segments);
    const cycles = walkFaces(graph);
    return {
        graph,
        cycles,
        positive: cycles.filter((c) => c.area > 0),
        negative: cycles.filter((c) => c.area < 0),
    };
}

describe('buildPlanarGraph', () => {
    it('builds a unit square with sorted out lists', () => {
        const g = buildPlanarGraph(square('w', 0, 0, 10));
        expect(g.vertices).toEqual([
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 0, y: 10 },
        ]);
        expect(g.edges).toHaveLength(4);
        expect(g.filaments).toHaveLength(0);
        for (const hs of g.out) {
            expect(hs).toHaveLength(2);
        }
        // Half-edge 2e = v0->v1, 2e+1 = v1->v0.
        const e0 = g.edges[0]!;
        expect(e0.v0).toBe(0);
        expect(e0.v1).toBe(1);
        // out[1]: 1->2 (angle pi/2) before 1->0 (angle pi), ascending angle.
        const out1 = g.out[1]!;
        const targets = out1.map((h) => {
            const e = g.edges[h >> 1]!;
            return h % 2 === 0 ? e.v1 : e.v0;
        });
        expect(targets).toEqual([2, 0]);
    });

    it('is empty for no segments and ignores zero-length segments', () => {
        const empty = buildPlanarGraph([]);
        expect(empty.vertices).toEqual([]);
        expect(empty.edges).toEqual([]);
        const zero = buildPlanarGraph([seg('z', 5, 5, 5, 5)]);
        expect(zero.edges).toEqual([]);
        expect(walkFaces(zero)).toEqual([]);
    });

    it('prunes a dangling edge into filaments and still yields the square face', () => {
        const segs = [...square('w', 0, 0, 100), seg('d', 100, 50, 200, 50)];
        const { graph, positive, negative } = analyse(segs);
        // The dangling wall splits the right side at (100, 50) and ends at (200, 50).
        expect(graph.filaments).toHaveLength(1);
        expect(graph.filaments[0]!.wallIds).toEqual(['d']);
        expect(graph.edges).toHaveLength(5);
        expect(positive).toHaveLength(1);
        expect(negative).toHaveLength(1);
        expect(positive[0]!.area).toBe(10000);
    });

    it('prunes whole chains of dangling edges repeatedly', () => {
        const segs = [
            ...square('w', 0, 0, 100),
            seg('d1', 100, 50, 200, 50),
            seg('d2', 200, 50, 200, 150),
        ];
        const { graph, positive } = analyse(segs);
        expect(graph.filaments.map((f) => f.wallIds[0]).sort()).toEqual([
            'd1',
            'd2',
        ]);
        expect(positive).toHaveLength(1);
    });

    it('creates a vertex where two segments cross', () => {
        const segs = [
            ...square('w', 0, 0, 100),
            seg('x1', 0, 0, 100, 100),
            seg('x2', 100, 0, 0, 100),
        ];
        const { graph, positive, negative } = analyse(segs);
        expect(vertexAt(graph, 50, 50)).toBeGreaterThanOrEqual(0);
        expect(positive).toHaveLength(4);
        expect(negative).toHaveLength(1);
        for (const f of positive) expect(f.area).toBeCloseTo(2500, 6);
    });

    it('splits a segment at an endpoint of another within EPS of its interior', () => {
        const segs = [
            seg('long', 0, 0, 1000, 0),
            seg('stub', 500, 0.3, 500, 300),
        ];
        const g = buildPlanarGraph(segs);
        const all = [...g.edges, ...g.filaments];
        expect(all).toHaveLength(3);
        // (500, 0.3) clusters onto the split point of `long`, which is the
        // first inserted point, and stays within 0.5 mm of the line.
        const splitVertex = g.vertices.find(
            (p) => Math.abs(p.x - 500) < 1e-9 && Math.abs(p.y) <= 0.5,
        );
        expect(splitVertex).toBeDefined();
    });

    it('dedupes collinear overlapping segments into one edge carrying both wall ids', () => {
        const g = buildPlanarGraph([
            seg('a', 0, 0, 100, 0),
            seg('b', 50, 0, 150, 0),
        ]);
        const all = [...g.edges, ...g.filaments];
        // Vertices 0, 50, 100, 150 -> edges 0-50 (a), 50-100 (a+b), 100-150 (b).
        expect(all).toHaveLength(3);
        const shared = all.filter((e) => e.wallIds.length === 2);
        expect(shared).toHaveLength(1);
        expect(shared[0]!.wallIds).toEqual(['a', 'b']);
        const ends = [shared[0]!.v0, shared[0]!.v1]
            .map((i) => g.vertices[i]!.x)
            .sort((p, q) => p - q);
        expect(ends).toEqual([50, 100]);
    });

    it('dedupes identical segments given in opposite directions', () => {
        const g = buildPlanarGraph([
            seg('a', 0, 0, 100, 0),
            seg('b', 100, 0, 0, 0),
        ]);
        const all = [...g.edges, ...g.filaments];
        expect(all).toHaveLength(1);
        expect(all[0]!.wallIds).toEqual(['a', 'b']);
    });

    it('clusters endpoints 0.3 mm apart into one vertex that keeps the first point exactly', () => {
        const segs = [
            seg('a', 0, 0, 100, 0),
            seg('b', 100.3, 0, 100, 100),
            seg('c', 100, 100, 0, 100),
            seg('d', 0, 100, 0, 0),
        ];
        const { graph, positive } = analyse(segs);
        expect(graph.vertices).toHaveLength(4);
        expect(vertexAt(graph, 100, 0)).toBeGreaterThanOrEqual(0);
        expect(graph.vertices.some((p) => p.x === 100.3)).toBe(false);
        expect(positive).toHaveLength(1);
    });

    it('does not cluster endpoints 0.8 mm apart', () => {
        const g = buildPlanarGraph([
            seg('a', 0, 0, 100, 0),
            seg('b', 100.8, 0, 200, 0),
        ]);
        expect(g.vertices).toHaveLength(4);
    });

    it('splits long near-parallel segments that really cross (intersectSegments misses them)', () => {
        // 0.46 degrees apart: both are "parallel" within ANGLE_TOL, and s2.a is 40 mm
        // off line s1, so intersectSegments reports none although they cross at (5000, 0).
        const g = buildPlanarGraph([
            seg('a', 0, 0, 10000, 0),
            seg('b', 0, 40, 10000, -40),
        ]);
        const all = [...g.edges, ...g.filaments];
        expect(all).toHaveLength(4);
        expect(vertexAt(g, 5000, 0)).toBeGreaterThanOrEqual(0);
    });

    it('splits a shallow crossing whose start point lies within EPS of the other line', () => {
        // intersectSegments reports a full-length overlap here; the true crossing is at x = 25.
        const g = buildPlanarGraph([
            seg('a', 0, 0, 10000, 0),
            seg('b', 0, 0.2, 10000, -80),
        ]);
        const all = [...g.edges, ...g.filaments];
        expect(all).toHaveLength(3);
        const cross = g.vertices.find(
            (p) => Math.abs(p.x - 25) < 0.5 && Math.abs(p.y) < 0.01,
        );
        expect(cross).toBeDefined();
        const first = all.find((e) => e.wallIds.length === 2);
        expect(first).toBeDefined();
        expect(first!.wallIds).toEqual(['a', 'b']);
    });

    it('does not report -0 in vertex coordinates', () => {
        const g = buildPlanarGraph([seg('a', -0, -0, 10, -0)]);
        for (const p of g.vertices) {
            expect(Object.is(p.x, -0)).toBe(false);
            expect(Object.is(p.y, -0)).toBe(false);
        }
    });

    it('is deterministic regardless of Flatbush query order', () => {
        const segs = [
            ...square('w', 0, 0, 100),
            seg('x1', 0, 0, 100, 100),
            seg('x2', 100, 0, 0, 100),
        ];
        expect(buildPlanarGraph(segs)).toEqual(buildPlanarGraph(segs));
    });
});

describe('walkFaces', () => {
    it('traces a unit square A->B->C->D as one positive (CW) face and one negative outer cycle', () => {
        const { cycles, positive, negative } = analyse(square('w', 0, 0, 10));
        expect(cycles).toHaveLength(2);
        expect(positive).toHaveLength(1);
        expect(negative).toHaveLength(1);
        expect(positive[0]!.area).toBe(100);
        expect(negative[0]!.area).toBe(-100);
        expect(signedArea(positive[0]!.ring)).toBe(100);
        expect(positive[0]!.halfEdges).toHaveLength(4);
        // A -> B -> C -> D (starting from half-edge 0 = A->B).
        expect(positive[0]!.ring).toEqual([
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 0, y: 10 },
        ]);
    });

    it('puts the face of half-edge u->v on its right', () => {
        const { graph, cycles } = analyse(square('w', 0, 0, 10));
        // Half-edge 0 = (0,0)->(10,0): right-hand side (screen) is y > 0, the interior.
        const inner = cycles.find((c) => c.halfEdges.includes(0))!;
        expect(inner.area).toBe(100);
        // Its twin (10,0)->(0,0) has the unbounded outside on its right.
        const outer = cycles.find((c) => c.halfEdges.includes(1))!;
        expect(outer.area).toBe(-100);
        expect(graph.edges[0]).toMatchObject({ v0: 0, v1: 1 });
    });

    it('gives two adjacent squares 2 faces and 1 outer cycle', () => {
        const segs = [
            ...square('l', 0, 0, 100),
            seg('r1', 100, 0, 200, 0),
            seg('r2', 200, 0, 200, 100),
            seg('r3', 200, 100, 100, 100),
        ];
        const { graph, positive, negative } = analyse(segs);
        expect(positive).toHaveLength(2);
        expect(negative).toHaveLength(1);
        expect(negative[0]!.area).toBe(-20000);
        // The shared edge (x = 100) carries the face on each side.
        const shared = graph.edges.findIndex(
            (e) =>
                graph.vertices[e.v0]!.x === 100 &&
                graph.vertices[e.v1]!.x === 100,
        );
        expect(shared).toBeGreaterThanOrEqual(0);
        const facesOnShared = positive.filter(
            (f) =>
                f.halfEdges.includes(2 * shared) ||
                f.halfEdges.includes(2 * shared + 1),
        );
        expect(facesOnShared).toHaveLength(2);
    });

    it('discards degenerate cycles below 1 mm2', () => {
        // A 0.9 mm2-ish sliver: 1 x 0.8 rectangle is a valid 0.8 mm2 face.
        const { cycles } = analyse(
            loop('s', [
                [0, 0],
                [1, 0],
                [1, 0.8],
                [0, 0.8],
            ]),
        );
        expect(cycles).toHaveLength(0);
    });

    it('yields two cycles per component and none for a pure tree', () => {
        const tree = buildPlanarGraph([
            seg('a', 0, 0, 100, 0),
            seg('b', 100, 0, 100, 100),
        ]);
        expect(walkFaces(tree)).toEqual([]);
        expect(tree.filaments).toHaveLength(2);
    });
});

describe('nestFaces', () => {
    it('makes a separate nested square a CCW hole of the bigger face and its own face', () => {
        const segs = [
            ...square('big', 0, 0, 1000),
            ...square('s', 400, 400, 200),
        ];
        const { graph, cycles } = analyse(segs);
        const faces = nestFaces(graph, cycles);
        expect(faces).toHaveLength(2);
        const big = faces.find((f) => signedArea(f.ring) === 1_000_000)!;
        const small = faces.find((f) => signedArea(f.ring) === 40_000)!;
        expect(big.holes).toHaveLength(1);
        expect(signedArea(big.holes[0]!)).toBe(-40_000);
        expect(small.holes).toHaveLength(0);
        expect([...big.wallIds].sort()).toEqual([
            'big0',
            'big1',
            'big2',
            'big3',
            's0',
            's1',
            's2',
            's3',
        ]);
        expect([...small.wallIds].sort()).toEqual(['s0', 's1', 's2', 's3']);
    });

    it('lists, for each face, only half-edges that have the face on their right', () => {
        const segs = [
            ...square('big', 0, 0, 1000),
            ...square('s', 400, 400, 200),
        ];
        const { graph, cycles } = analyse(segs);
        const faces = nestFaces(graph, cycles);
        const big = faces.find((f) => signedArea(f.ring) === 1_000_000)!;
        // 4 outer + 4 island half-edges, all from the cycles bounding the face.
        expect(big.halfEdges).toHaveLength(8);
        expect(new Set(big.halfEdges).size).toBe(8);
    });

    it('chooses the smallest enclosing face for doubly nested squares', () => {
        const segs = [
            ...square('a', 0, 0, 1000),
            ...square('b', 100, 100, 800),
            ...square('c', 400, 400, 200),
        ];
        const { graph, cycles } = analyse(segs);
        const faces = nestFaces(graph, cycles);
        expect(faces).toHaveLength(3);
        const byArea = (a: number) =>
            faces.find((f) => signedArea(f.ring) === a)!;
        expect(byArea(1_000_000).holes.map(signedArea)).toEqual([-640_000]);
        expect(byArea(640_000).holes.map(signedArea)).toEqual([-40_000]);
        expect(byArea(40_000).holes).toHaveLength(0);
    });

    it('discards the outer boundary of an isolated component', () => {
        const { graph, cycles } = analyse(square('w', 0, 0, 100));
        const faces = nestFaces(graph, cycles);
        expect(faces).toHaveLength(1);
        expect(faces[0]!.holes).toEqual([]);
    });

    it('does not make a face of the same component a host (touching squares)', () => {
        const segs = [...square('l', 0, 0, 100), ...square('r', 100, 0, 100)];
        const { graph, cycles } = analyse(segs);
        const faces = nestFaces(graph, cycles);
        expect(faces).toHaveLength(2);
        for (const f of faces) expect(f.holes).toHaveLength(0);
    });

    it('splits a square into 4 faces with a crossing X', () => {
        const segs = [
            ...square('w', 0, 0, 100),
            seg('x1', 0, 0, 100, 100),
            seg('x2', 100, 0, 0, 100),
        ];
        const { graph, cycles } = analyse(segs);
        const faces = nestFaces(graph, cycles);
        expect(faces).toHaveLength(4);
        expect(faces.reduce((s, f) => s + signedArea(f.ring), 0)).toBeCloseTo(
            10000,
            6,
        );
    });

    it('builds a 3 x 3 grid from long crossing walls with no shared nodes', () => {
        const segs: S[] = [];
        for (let k = 0; k <= 3; k++) {
            segs.push(seg(`h${k}`, 0, k * 100, 300, k * 100));
            segs.push(seg(`v${k}`, k * 100, 0, k * 100, 300));
        }
        const { graph, cycles } = analyse(segs);
        const faces = nestFaces(graph, cycles);
        expect(faces).toHaveLength(9);
        for (const f of faces) expect(signedArea(f.ring)).toBe(10000);
        expect(graph.filaments).toHaveLength(0);
    });
});
