import { describe, expect, it } from 'vitest';
import { union } from '../../geometry/clip';
import { area, signedArea, type Ring } from '../../geometry/polygon';
import { EPS } from '../../geometry/tolerance';
import { v, type Vec2 } from '../../geometry/vec2';
import type { PlanDocument } from '../schema';
import {
    emptyPlan,
    makeGridPlan,
    makeLPlan,
    makeRectPlan,
} from '../testing/fixtures';
import {
    DERIVE_ISSUE_CODES,
    buildWallGraph,
    buildWallOutline,
    computeAllWallEnds,
    computeNodeJoins,
    type WallEnd,
    type WallGraph,
} from '../walls';

type NodeSpec = readonly [number, number];
/** `[nodeIndexA, nodeIndexB, thickness]` with node indices into the node list. */
type WallSpec = readonly [number, number, number?];

/** Hand-built document: nodes `n0..`, walls `w0..` (115 mm unless stated). */
function build(nodes: NodeSpec[], walls: WallSpec[]): PlanDocument {
    const doc = emptyPlan();
    nodes.forEach(([x, y], i) => {
        doc.nodes[`n${i}`] = { id: `n${i}`, x, y };
    });
    walls.forEach(([a, b, t = 115], i) => {
        doc.walls[`w${i}`] = {
            id: `w${i}`,
            a: `n${a}`,
            b: `n${b}`,
            thickness: t,
            height: 2700,
            kind: 'interior',
            justification: 'center',
            material: 'brick',
            colorHex: null,
        };
    });
    return doc;
}

interface Built {
    g: WallGraph;
    ends: ReturnType<typeof computeAllWallEnds>;
    outline: (id: string) => Vec2[];
}

function analyse(doc: PlanDocument): Built {
    const g = buildWallGraph(doc);
    const ends = computeAllWallEnds(g);
    const outline = (id: string): Vec2[] => {
        const info = g.valid.get(id);
        const e = ends.get(id);
        if (!info || !e) throw new Error(`no wall ${id}`);
        return buildWallOutline(info, e.endA, e.endB).outline;
    };
    return { g, ends, outline };
}

const near = (p: Vec2, x: number, y: number, tol = 1e-6): boolean =>
    Math.abs(p.x - x) <= tol && Math.abs(p.y - y) <= tol;
const has = (ring: Vec2[], x: number, y: number): boolean =>
    ring.some((p) => near(p, x, y));
const sameValue = (a: Vec2, b: Vec2): boolean => a.x === b.x && a.y === b.y;

function endsOf(b: Built, id: string): { endA: WallEnd; endB: WallEnd } {
    const e = b.ends.get(id);
    if (!e) throw new Error(`no ends for ${id}`);
    return e;
}

/** O(n²) proper-crossing test between non-adjacent edges. */
function selfIntersects(r: Ring): boolean {
    const n = r.length;
    const orient = (a: Vec2, b: Vec2, c: Vec2): number =>
        (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    for (let i = 0; i < n; i++) {
        for (let k = i + 1; k < n; k++) {
            if (k === i + 1 || (i === 0 && k === n - 1)) continue;
            const a = r[i]!;
            const b = r[(i + 1) % n]!;
            const c = r[k]!;
            const d = r[(k + 1) % n]!;
            const o1 = orient(a, b, c);
            const o2 = orient(a, b, d);
            const o3 = orient(c, d, a);
            const o4 = orient(c, d, b);
            if (o1 * o2 < -1e-9 && o3 * o4 < -1e-9) return true;
        }
    }
    return false;
}

function unionArea(rings: Ring[]): number {
    return union(rings.map((outer) => ({ outer, holes: [] }))).reduce(
        (s, p) => s + area(p),
        0,
    );
}

function sumArea(rings: Ring[]): number {
    return rings.reduce((s, r) => s + Math.abs(signedArea(r)), 0);
}

function everyCoordinate(b: Built): number[] {
    const out: number[] = [];
    const push = (p: Vec2): void => {
        out.push(p.x, p.y);
    };
    for (const [id, e] of b.ends) {
        for (const end of [e.endA, e.endB]) {
            push(end.left);
            push(end.right);
            end.via.forEach(push);
        }
        b.outline(id).forEach(push);
    }
    return out;
}

describe('buildWallGraph', () => {
    it('keeps valid walls with direction, normal and length', () => {
        const doc = build(
            [
                [0, 0],
                [0, 1000],
            ],
            [[0, 1, 115]],
        );
        const g = buildWallGraph(doc);
        const info = g.valid.get('w0')!;
        expect(info.A).toEqual(v(0, 0));
        expect(info.B).toEqual(v(0, 1000));
        expect(info.d).toEqual(v(0, 1));
        // 04 §2.1: d = (0,1) -> n = (1,0)
        expect(info.n).toEqual(v(1, 0));
        expect(Object.is(info.n.y, -0)).toBe(false);
        expect(info.length).toBe(1000);
        expect(g.incident.get('n0')).toEqual(['w0']);
        expect(g.incident.get('n1')).toEqual(['w0']);
        expect(g.issues).toEqual([]);
    });

    it('skips missing-node, a===b and sub-EPS walls with wall_skipped', () => {
        const doc = build(
            [
                [0, 0],
                [1000, 0],
                [1000, 0],
            ],
            [
                [0, 1],
                [1, 1],
                [1, 2],
            ],
        );
        // w3 references a node that does not exist
        doc.walls['w3'] = { ...doc.walls['w0']!, id: 'w3', b: 'n99' };
        const g = buildWallGraph(doc);
        expect([...g.valid.keys()]).toEqual(['w0']);
        expect(g.issues.map((i) => i.entityIds[0]).sort()).toEqual([
            'w1',
            'w2',
            'w3',
        ]);
        for (const issue of g.issues) {
            expect(issue.code).toBe('wall_skipped');
            expect(issue.messageKey).toBe('engine.plan.derive.wall_skipped');
            expect(issue.severity).toBe('warning');
        }
        expect(g.incident.get('n1')).toEqual(['w0']);
    });

    it('does not mutate the document', () => {
        const doc = makeLPlan();
        const before = structuredClone(doc);
        computeAllWallEnds(buildWallGraph(doc));
        expect(doc).toEqual(before);
    });

    it('exports the derive issue codes', () => {
        expect(DERIVE_ISSUE_CODES).toEqual([
            'wall_skipped',
            'outline_fallback',
            'opening_skipped',
            'opening_clamped',
            'opening_in_junction',
            'room_meta_duplicate',
        ]);
    });
});

describe('04 §3.9 edge cases', () => {
    it('L-corner, equal 115: shared miter corners, quadrilaterals', () => {
        const b = analyse(
            build(
                [
                    [0, 0],
                    [1000, 0],
                    [1000, 1000],
                ],
                [
                    [0, 1],
                    [1, 2],
                ],
            ),
        );
        const o0 = b.outline('w0');
        const o1 = b.outline('w1');
        expect(o0).toHaveLength(4);
        expect(o1).toHaveLength(4);
        expect(has(o0, 1057.5, -57.5) && has(o1, 1057.5, -57.5)).toBe(true);
        expect(has(o0, 942.5, 57.5) && has(o1, 942.5, 57.5)).toBe(true);
        const e0 = endsOf(b, 'w0').endB;
        const e1 = endsOf(b, 'w1').endA;
        expect(e0.joint).toBe('miter');
        expect(e1.joint).toBe('miter');
        expect(e0.via).toEqual([]);
        expect(e1.via).toEqual([]);
        // same coordinates, and literally the same value objects
        expect(e0.left).toBe(e1.left);
        expect(e0.right).toBe(e1.right);
        expect(sameValue(e0.left, v(1057.5, -57.5))).toBe(true);
        expect(sameValue(e0.right, v(942.5, 57.5))).toBe(true);
        // trapezoid: parallel sides 1057.5 and 942.5 long, 115 apart
        expect(area({ outer: o0, holes: [] })).toBeCloseTo(115_000, 6);
    });

    it('L-corner 230 vs 115: node is a via and the union has no gap', () => {
        const b = analyse(
            build(
                [
                    [0, 0],
                    [1000, 0],
                    [1000, 1000],
                ],
                [
                    [0, 1, 230],
                    [1, 2, 115],
                ],
            ),
        );
        const n = v(1000, 0);
        expect(endsOf(b, 'w0').endB.via.some((p) => sameValue(p, n))).toBe(
            true,
        );
        expect(endsOf(b, 'w1').endA.via.some((p) => sameValue(p, n))).toBe(
            true,
        );
        // the node is collinear with the two miter corners, so the outline
        // assembly (simplifyCollinear) drops it again from the final ring
        expect(b.outline('w0')).toHaveLength(4);
        expect(b.outline('w1')).toHaveLength(4);
        const rings = [b.outline('w0'), b.outline('w1')];
        expect(unionArea(rings)).toBeCloseTo(sumArea(rings), 1);
        expect(
            Math.abs(unionArea(rings) - sumArea(rings)) / sumArea(rings),
        ).toBeLessThan(0.001);
    });

    it('T-junction: through pieces share the far side point, stem has inside corners', () => {
        const b = analyse(
            build(
                [
                    [0, 0],
                    [1000, 0],
                    [2000, 0],
                    [1000, 1000],
                ],
                [
                    [0, 1],
                    [1, 2],
                    [1, 3],
                ],
            ),
        );
        const t1 = b.outline('w0');
        const t2 = b.outline('w1');
        const stem = b.outline('w2');
        expect(has(t1, 1000, -57.5) && has(t2, 1000, -57.5)).toBe(true);
        expect(has(stem, 942.5, 57.5)).toBe(true);
        expect(has(stem, 1057.5, 57.5)).toBe(true);
        const rings = [t1, t2, stem];
        expect(
            Math.abs(unionArea(rings) - sumArea(rings)) / sumArea(rings),
        ).toBeLessThan(0.001);
        for (const id of ['w0', 'w1', 'w2']) {
            const e = endsOf(b, id);
            const atNode = id === 'w0' ? e.endB : e.endA;
            expect(atNode.joint).toBe('junction');
        }
    });

    it('X-junction: four inside corners, every outline contains the node', () => {
        const b = analyse(
            build(
                [
                    [0, 0],
                    [1000, 0],
                    [0, 1000],
                    [-1000, 0],
                    [0, -1000],
                ],
                [
                    [0, 1],
                    [0, 2],
                    [0, 3],
                    [0, 4],
                ],
            ),
        );
        const all = ['w0', 'w1', 'w2', 'w3'].flatMap((id) => b.outline(id));
        for (const sx of [-1, 1]) {
            for (const sy of [-1, 1]) {
                expect(has(all, sx * 57.5, sy * 57.5)).toBe(true);
            }
        }
        for (const id of ['w0', 'w1', 'w2', 'w3']) {
            expect(has(b.outline(id), 0, 0)).toBe(true);
            expect(endsOf(b, id).endA.joint).toBe('junction');
        }
        const rings = ['w0', 'w1', 'w2', 'w3'].map((id) => b.outline(id));
        expect(
            Math.abs(unionArea(rings) - sumArea(rings)) / sumArea(rings),
        ).toBeLessThan(0.001);
    });

    it('collinear, equal thickness: corners coincide at x = 1000', () => {
        const b = analyse(
            build(
                [
                    [0, 0],
                    [1000, 0],
                    [2000, 0],
                ],
                [
                    [0, 1],
                    [1, 2],
                ],
            ),
        );
        const eb = endsOf(b, 'w0').endB;
        const ea = endsOf(b, 'w1').endA;
        expect(eb.joint).toBe('miter');
        expect(sameValue(eb.left, ea.left)).toBe(true);
        expect(sameValue(eb.right, ea.right)).toBe(true);
        expect(near(eb.left, 1000, -57.5)).toBe(true);
        expect(near(eb.right, 1000, 57.5)).toBe(true);
        expect(eb.via).toEqual([]);
        expect(b.outline('w0')).toHaveLength(4);
    });

    it('collinear 230 / 115: perpendicular step at the node', () => {
        const b = analyse(
            build(
                [
                    [0, 0],
                    [1000, 0],
                    [2000, 0],
                ],
                [
                    [0, 1, 230],
                    [1, 2, 115],
                ],
            ),
        );
        const eb = endsOf(b, 'w0').endB;
        const ea = endsOf(b, 'w1').endA;
        expect(near(eb.left, 1000, -115)).toBe(true);
        expect(near(eb.right, 1000, 115)).toBe(true);
        expect(near(ea.left, 1000, -57.5)).toBe(true);
        expect(near(ea.right, 1000, 57.5)).toBe(true);
        const rings = [b.outline('w0'), b.outline('w1')];
        expect(
            Math.abs(unionArea(rings) - sumArea(rings)) / sumArea(rings),
        ).toBeLessThan(0.001);
    });

    it('acute 20 degree wedge: bevel with midpoint via', () => {
        const a = (20 * Math.PI) / 180;
        const b = analyse(
            build(
                [
                    [0, 0],
                    [1000, 0],
                    [
                        Math.round(1000 * Math.cos(a)),
                        Math.round(1000 * Math.sin(a)),
                    ],
                ],
                [
                    [0, 1],
                    [0, 2],
                ],
            ),
        );
        const w0 = endsOf(b, 'w0').endA;
        const w1 = endsOf(b, 'w1').endA;
        expect(w0.joint).toBe('bevel');
        expect(w1.joint).toBe('bevel');
        // inner wedge (between the two arms): B_i on w0's cw side, B_j on w1's ccw side
        const info1 = b.g.valid.get('w1')!;
        const u1 = v(info1.d.x, info1.d.y);
        const Bi = v(0, 57.5);
        const Bj = v(u1.y * 57.5, -u1.x * 57.5);
        const M = v((Bi.x + Bj.x) / 2, (Bi.y + Bj.y) / 2);
        expect(w0.via.some((p) => near(p, M.x, M.y, 1e-9))).toBe(true);
        expect(w1.via.some((p) => near(p, M.x, M.y, 1e-9))).toBe(true);
        for (const id of ['w0', 'w1']) {
            const o = b.outline(id);
            expect(signedArea(o)).toBeGreaterThan(0);
            expect(selfIntersects(o)).toBe(false);
        }
    });

    it('30 mm wall between two L-corners: bevel by the half-length rule, simple outline', () => {
        // Z shape: w0 up into (0,0), short w1 to (30,0), w2 down from (30,0)
        const b = analyse(
            build(
                [
                    [0, -1000],
                    [0, 0],
                    [30, 0],
                    [30, 1000],
                ],
                [
                    [0, 1],
                    [1, 2],
                    [2, 3],
                ],
            ),
        );
        const short = endsOf(b, 'w1');
        expect(short.endA.joint).toBe('bevel');
        expect(short.endB.joint).toBe('bevel');
        const o = b.outline('w1');
        expect(selfIntersects(o)).toBe(false);
        expect(signedArea(o)).toBeGreaterThan(1);
        expect(
            buildWallOutline(b.g.valid.get('w1')!, short.endA, short.endB)
                .fallback,
        ).toBe(false);
        for (const id of ['w0', 'w2']) {
            expect(selfIntersects(b.outline(id))).toBe(false);
        }
    });

    it('30 mm wall in a U shape never yields a self-intersecting outline', () => {
        const b = analyse(
            build(
                [
                    [0, -1000],
                    [0, 0],
                    [30, 0],
                    [30, -1000],
                ],
                [
                    [0, 1],
                    [1, 2],
                    [2, 3],
                ],
            ),
        );
        const info = b.g.valid.get('w1')!;
        const e = endsOf(b, 'w1');
        const res = buildWallOutline(info, e.endA, e.endB);
        expect(selfIntersects(res.outline)).toBe(false);
        expect(signedArea(res.outline)).toBeGreaterThan(1);
        expect(res.fallback).toBe(true);
        // the fallback is the plain rectangle
        expect(res.outline).toHaveLength(4);
        expect(has(res.outline, 0, -57.5)).toBe(true);
        expect(has(res.outline, 30, 57.5)).toBe(true);
    });

    it('dangling end: square cap, clockwise rectangle, joint free', () => {
        const b = analyse(
            build(
                [
                    [0, 0],
                    [1000, 0],
                ],
                [[0, 1, 100]],
            ),
        );
        const e = endsOf(b, 'w0');
        expect(e.endA.joint).toBe('free');
        expect(e.endB.joint).toBe('free');
        expect(e.endA.via).toEqual([]);
        const o = b.outline('w0');
        const expected = [v(0, -50), v(1000, -50), v(1000, 50), v(0, 50)];
        const start = o.findIndex((p) => sameValue(p, expected[0]!));
        expect(start).toBeGreaterThanOrEqual(0);
        expect(o.map((_, i) => o[(start + i) % o.length])).toEqual(expected);
        expect(signedArea(o)).toBeGreaterThan(0);
        expect(
            buildWallOutline(b.g.valid.get('w0')!, e.endA, e.endB).fallback,
        ).toBe(false);
    });

    it('overlapping walls with identical outgoing direction do not throw', () => {
        const b = analyse(
            build(
                [
                    [0, 0],
                    [1000, 0],
                    [500, 0],
                ],
                [
                    [0, 1],
                    [0, 2],
                ],
            ),
        );
        const coords = everyCoordinate(b);
        expect(coords.length).toBeGreaterThan(0);
        expect(coords.every(Number.isFinite)).toBe(true);
        // tie broken by wall id: result is stable under wall renaming of insertion order
        const again = analyse(
            build(
                [
                    [0, 0],
                    [1000, 0],
                    [500, 0],
                ],
                [
                    [0, 1],
                    [0, 2],
                ],
            ),
        );
        expect(everyCoordinate(again)).toEqual(coords);
    });

    it('node with walls in all 4 quadrants plus a 15 degree arm is finite', () => {
        const r = 1200;
        const deg = (d: number): NodeSpec => [
            Math.round(r * Math.cos((d * Math.PI) / 180)),
            Math.round(r * Math.sin((d * Math.PI) / 180)),
        ];
        const nodes: NodeSpec[] = [
            [0, 0],
            deg(45),
            deg(135),
            deg(225),
            deg(315),
            deg(60),
            deg(0),
        ];
        const walls: WallSpec[] = [
            [0, 1],
            [0, 2],
            [0, 3],
            [0, 4],
            [0, 5, 230],
            [0, 6, 60],
        ];
        const b = analyse(build(nodes, walls));
        const coords = everyCoordinate(b);
        expect(coords.length).toBeGreaterThan(0);
        expect(coords.every(Number.isFinite)).toBe(true);
        for (const id of b.g.valid.keys()) {
            const info = b.g.valid.get(id)!;
            const e = endsOf(b, id);
            const res = buildWallOutline(info, e.endA, e.endB);
            expect(res.outline.length).toBeGreaterThanOrEqual(3);
            expect(signedArea(res.outline)).toBeGreaterThan(0);
        }
    });
});

describe('computeNodeJoins', () => {
    it('returns an empty map for an unknown or unused node', () => {
        const g = buildWallGraph(makeRectPlan(1000, 1000, 115));
        expect(computeNodeJoins('nope', g).size).toBe(0);
    });

    it('returns the end of each incident wall only', () => {
        const doc = build(
            [
                [0, 0],
                [1000, 0],
                [2000, 0],
            ],
            [
                [0, 1],
                [1, 2],
            ],
        );
        const g = buildWallGraph(doc);
        const joins = computeNodeJoins('n1', g);
        expect([...joins.keys()].sort()).toEqual(['w0', 'w1']);
        expect(computeNodeJoins('n0', g).get('w0')!.joint).toBe('free');
    });

    it('is independent of wall insertion order', () => {
        const nodes: NodeSpec[] = [
            [0, 0],
            [1000, 0],
            [0, 1000],
            [-1000, 0],
        ];
        const walls: WallSpec[] = [
            [0, 1],
            [0, 2],
            [0, 3],
        ];
        const a = computeNodeJoins('n0', buildWallGraph(build(nodes, walls)));
        const doc = build(nodes, walls);
        const reordered = emptyPlan();
        reordered.nodes = doc.nodes;
        for (const id of ['w2', 'w0', 'w1'])
            reordered.walls[id] = doc.walls[id]!;
        const c = computeNodeJoins('n0', buildWallGraph(reordered));
        expect([...c.entries()].sort()).toEqual([...a.entries()].sort());
    });
});

describe('04 §3.10 tessellation of the plan fixtures', () => {
    const cases: Array<[string, () => PlanDocument]> = [
        ['makeRectPlan(5000,4000,230)', () => makeRectPlan(5000, 4000, 230)],
        ['makeLPlan()', () => makeLPlan()],
        ['makeGridPlan(7,6)', () => makeGridPlan(7, 6)],
    ];

    it.each(cases)('%s', (_name, make) => {
        const doc = make();
        const b = analyse(doc);
        expect(b.g.issues).toEqual([]);
        const rings: Ring[] = [];
        for (const id of b.g.valid.keys()) {
            const info = b.g.valid.get(id)!;
            const e = endsOf(b, id);
            const res = buildWallOutline(info, e.endA, e.endB);
            expect(res.fallback).toBe(false);
            const o = res.outline;
            expect(o.length).toBeGreaterThanOrEqual(4);
            expect(
                o.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)),
            ).toBe(true);
            expect(signedArea(o)).toBeGreaterThan(0);
            expect(selfIntersects(o)).toBe(false);
            rings.push(o);
        }
        expect(rings).toHaveLength(Object.keys(doc.walls).length);
        const sum = sumArea(rings);
        expect(Math.abs(unionArea(rings) - sum) / sum).toBeLessThan(0.001);
        expect(everyCoordinate(b).some((c) => Object.is(c, -0))).toBe(false);
    });

    it('the left face of a wall drawn left to right has smaller y than its centre line', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        const b = analyse(doc);
        const top = [...b.g.valid.entries()].find(
            ([, i]) => i.A.y === 0 && i.B.y === 0 && i.B.x > i.A.x,
        );
        expect(top).toBeDefined();
        const [id] = top!;
        const e = endsOf(b, id);
        expect(e.endA.left.y).toBeLessThan(0);
        expect(e.endB.left.y).toBeLessThan(0);
        expect(e.endA.right.y).toBeGreaterThan(0);
        expect(e.endB.right.y).toBeGreaterThan(0);
    });
});

describe('buildWallOutline', () => {
    it('falls back to the plain rectangle when the corners cross', () => {
        const b = analyse(
            build(
                [
                    [0, 0],
                    [1000, 0],
                ],
                [[0, 1, 100]],
            ),
        );
        const info = b.g.valid.get('w0')!;
        const e = endsOf(b, 'w0');
        // swap the end-B corners so the quad becomes a bow-tie
        const bad: WallEnd = {
            ...e.endB,
            left: e.endB.right,
            right: e.endB.left,
        };
        const res = buildWallOutline(info, e.endA, bad);
        expect(res.fallback).toBe(true);
        expect(res.outline).toEqual([
            v(0, -50),
            v(1000, -50),
            v(1000, 50),
            v(0, 50),
        ]);
    });

    it('keeps the miter tolerance meaningful (EPS)', () => {
        expect(EPS).toBe(0.5);
    });
});
