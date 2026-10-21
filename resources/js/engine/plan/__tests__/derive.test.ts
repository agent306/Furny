import { describe, expect, it } from 'vitest';
import { area, signedArea, type Ring } from '../../geometry/polygon';
import type { Vec2 } from '../../geometry/vec2';
import { derivePlanGeometry } from '../derive';
import type { Opening, PlanDocument } from '../schema';
import {
    emptyPlan,
    makeGridPlan,
    makeLPlan,
    makeRectPlan,
} from '../testing/fixtures';
import { buildWallGraph, computeAllWallEnds } from '../walls';

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

function addOpening(
    doc: PlanDocument,
    id: string,
    wallId: string,
    spec: Partial<Opening> = {},
): void {
    doc.openings[id] = {
        id,
        wallId,
        kind: 'door',
        type: 'single_swing',
        offset: 1000,
        width: 900,
        height: 2100,
        sillHeight: 0,
        hinge: 'start',
        swing: 'left',
        label: null,
        ...spec,
    };
}

/** One 4000 mm, 230 mm thick wall `(0,0) -> (4000,0)`. */
function singleWall(): PlanDocument {
    return build(
        [
            [0, 0],
            [4000, 0],
        ],
        [[0, 1, 230]],
    );
}

function deepFreeze<T>(value: T): T {
    if (value !== null && typeof value === 'object') {
        for (const child of Object.values(value)) deepFreeze(child);
        Object.freeze(value);
    }
    return value;
}

function bounds(ring: Ring): {
    x0: number;
    x1: number;
    y0: number;
    y1: number;
} {
    const xs = ring.map((p) => p.x);
    const ys = ring.map((p) => p.y);
    return {
        x0: Math.min(...xs),
        x1: Math.max(...xs),
        y0: Math.min(...ys),
        y1: Math.max(...ys),
    };
}

const finite = (p: Vec2): boolean =>
    Number.isFinite(p.x) && Number.isFinite(p.y);

describe('derivePlanGeometry: opening frames', () => {
    const doc = singleWall();
    addOpening(doc, 'o0', 'w0', { hinge: 'end' });
    const plan = derivePlanGeometry(doc);
    const o = plan.openings['o0']!;

    it('computes the along-wall interval and centre', () => {
        expect(o.wallId).toBe('w0');
        expect(o.u0).toBe(550);
        expect(o.u1).toBe(1450);
        expect(o.center).toEqual({ x: 1000, y: 0 });
        expect(plan.walls['w0']!.openings).toEqual([
            { id: 'o0', u0: 550, u1: 1450 },
        ]);
        expect(o.issues).toEqual([]);
    });

    it('cuts a CW rectangle 0.5 mm beyond each face', () => {
        expect(o.cut).toHaveLength(4);
        expect(bounds(o.cut)).toEqual({
            x0: 550,
            x1: 1450,
            y0: -115.5,
            y1: 115.5,
        });
        expect(signedArea(o.cut)).toBeGreaterThan(0);
    });

    it('places the jamb points on the faces', () => {
        expect(o.jambStart).toEqual({
            left: { x: 550, y: -115 },
            right: { x: 550, y: 115 },
        });
        expect(o.jambEnd).toEqual({
            left: { x: 1450, y: -115 },
            right: { x: 1450, y: 115 },
        });
    });

    it('maps swing and hinge to swingSign and hingeU', () => {
        expect(o.swingSign).toBe(1);
        expect(o.hingeU).toBe(1450);

        const flipped = singleWall();
        addOpening(flipped, 'o1', 'w0', { swing: 'right', hinge: 'start' });
        const f = derivePlanGeometry(flipped).openings['o1']!;
        expect(f.swingSign).toBe(-1);
        expect(f.hingeU).toBe(550);
    });

    it('sorts wall.openings by u0', () => {
        const d = singleWall();
        addOpening(d, 'oa', 'w0', { offset: 3000, width: 800 });
        addOpening(d, 'ob', 'w0', { offset: 1000, width: 800 });
        const p = derivePlanGeometry(d);
        expect(p.walls['w0']!.openings.map((x) => x.id)).toEqual(['ob', 'oa']);
    });

    it('measures along the wall direction on a vertical wall', () => {
        const d = build(
            [
                [0, 0],
                [0, 3000],
            ],
            [[0, 1, 200]],
        );
        addOpening(d, 'o0', 'w0', { offset: 1500, width: 1000 });
        const p = derivePlanGeometry(d).openings['o0']!;
        expect(p.center).toEqual({ x: 0, y: 1500 });
        // d = (0,1), n = (1,0): the left face is at x = +100.
        expect(p.jambStart.left).toEqual({ x: 100, y: 1000 });
        expect(p.jambStart.right).toEqual({ x: -100, y: 1000 });
        expect(signedArea(p.cut)).toBeGreaterThan(0);
    });
});

describe('derivePlanGeometry: poché', () => {
    it('subtracts the opening from the outline', () => {
        const doc = singleWall();
        addOpening(doc, 'o0', 'w0');
        const w = derivePlanGeometry(doc).walls['w0']!;
        expect(w.pocheParts).toHaveLength(2);
        const total = w.pocheParts.reduce((s, p) => s + area(p), 0);
        expect(
            Math.abs(
                total - (area({ outer: w.outline, holes: [] }) - 900 * 230),
            ),
        ).toBeLessThan(1);
        for (const part of w.pocheParts) {
            expect(signedArea(part.outer)).toBeGreaterThan(0);
        }
    });

    it('returns the outline itself, untouched, for a wall without openings', () => {
        const w = derivePlanGeometry(singleWall()).walls['w0']!;
        expect(w.pocheParts).toEqual([{ outer: w.outline, holes: [] }]);
        expect(w.pocheParts[0]!.outer).toBe(w.outline);
    });

    it('window and opening kinds subtract as well', () => {
        const doc = singleWall();
        addOpening(doc, 'o0', 'w0', {
            kind: 'window',
            type: 'casement',
            offset: 700,
            width: 600,
            sillHeight: 900,
        });
        addOpening(doc, 'o1', 'w0', {
            kind: 'opening',
            type: 'opening',
            offset: 2500,
            width: 1000,
        });
        const w = derivePlanGeometry(doc).walls['w0']!;
        expect(w.pocheParts).toHaveLength(3);
        const total = w.pocheParts.reduce((s, p) => s + area(p), 0);
        expect(
            Math.abs(total - (4000 * 230 - 600 * 230 - 1000 * 230)),
        ).toBeLessThan(1);
    });

    it('merges overlapping openings into one hole', () => {
        const doc = singleWall();
        addOpening(doc, 'o0', 'w0', { offset: 1000, width: 800 });
        addOpening(doc, 'o1', 'w0', { offset: 1400, width: 800 });
        const w = derivePlanGeometry(doc).walls['w0']!;
        expect(w.pocheParts).toHaveLength(2);
        const total = w.pocheParts.reduce((s, p) => s + area(p), 0);
        // union of [600,1400] and [1000,1800] = 1200 mm
        expect(Math.abs(total - (4000 - 1200) * 230)).toBeLessThan(1);
    });
});

describe('derivePlanGeometry: opening issues', () => {
    it('clamps an opening past the wall end and reports it', () => {
        const doc = singleWall();
        addOpening(doc, 'o0', 'w0', { offset: 3800, width: 1000 });
        const plan = derivePlanGeometry(doc);
        const o = plan.openings['o0']!;
        expect(o.u0).toBe(3300);
        expect(o.u1).toBe(4000);
        expect(o.issues.map((i) => i.code)).toContain('opening_clamped');
        const clamped = plan.issues.find((i) => i.code === 'opening_clamped')!;
        expect(clamped.messageKey).toBe('engine.plan.derive.opening_clamped');
        expect(clamped.entityIds).toContain('o0');
        expect(bounds(o.cut).x1).toBe(4000);
        expect(plan.walls['w0']!.openings).toEqual([
            { id: 'o0', u0: 3300, u1: 4000 },
        ]);
    });

    it('keeps a fully out-of-range opening zero-width and cuts nothing', () => {
        const doc = singleWall();
        addOpening(doc, 'o0', 'w0', { offset: 5000, width: 500 });
        const plan = derivePlanGeometry(doc);
        expect(plan.openings['o0']!.u0).toBe(4000);
        expect(plan.openings['o0']!.u1).toBe(4000);
        expect(plan.issues.map((i) => i.code)).toContain('opening_clamped');
        expect(plan.walls['w0']!.pocheParts).toEqual([
            { outer: plan.walls['w0']!.outline, holes: [] },
        ]);
    });

    it('flags an opening inside a junction with an info issue', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        const top = Object.keys(doc.walls)[0]!;
        addOpening(doc, 'o_j', top, { offset: 300, width: 400 });
        const plan = derivePlanGeometry(doc);
        const w = plan.walls[top]!;
        expect(w.safeU[0]).toBe(115);
        expect(w.safeU[1]).toBe(4885);
        const found = plan.issues.filter(
            (i) => i.code === 'opening_in_junction',
        );
        expect(found).toHaveLength(1);
        expect(found[0]!.severity).toBe('info');
        expect(found[0]!.messageKey).toBe(
            'engine.plan.derive.opening_in_junction',
        );
        expect(plan.openings['o_j']!.issues).toEqual(found);
    });

    it('does not flag an opening that sits inside safeU', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        const top = Object.keys(doc.walls)[0]!;
        addOpening(doc, 'o_ok', top, { offset: 2500, width: 900 });
        const plan = derivePlanGeometry(doc);
        expect(plan.issues).toEqual([]);
    });

    it('skips an opening on a missing wall', () => {
        const doc = singleWall();
        addOpening(doc, 'o0', 'w_missing');
        const plan = derivePlanGeometry(doc);
        expect(plan.openings).toEqual({});
        expect(plan.issues).toEqual([
            {
                code: 'opening_skipped',
                messageKey: 'engine.plan.derive.opening_skipped',
                params: { openingId: 'o0', wallId: 'w_missing' },
                severity: 'warning',
                entityIds: ['o0', 'w_missing'],
            },
        ]);
    });

    it('skips an opening on a wall that was itself skipped', () => {
        const doc = singleWall();
        doc.walls['w1'] = { ...doc.walls['w0']!, id: 'w1', b: 'n_gone' };
        addOpening(doc, 'o0', 'w1');
        const plan = derivePlanGeometry(doc);
        expect(plan.issues.map((i) => i.code).sort()).toEqual([
            'opening_skipped',
            'wall_skipped',
        ]);
        expect(plan.openings).toEqual({});
    });
});

describe('derivePlanGeometry: walls', () => {
    it('exposes the 04 §3.1 wall fields', () => {
        const plan = derivePlanGeometry(singleWall());
        const w = plan.walls['w0']!;
        expect(w.id).toBe('w0');
        expect(w.centerline).toEqual([
            { x: 0, y: 0 },
            { x: 4000, y: 0 },
        ]);
        expect(w.length).toBe(4000);
        expect(w.dir).toEqual({ x: 1, y: 0 });
        expect(w.normal).toEqual({ x: 0, y: -1 });
        expect(w.thickness).toBe(230);
        expect(w.height).toBe(2700);
        expect(w.kind).toBe('interior');
        expect(w.leftFace).toEqual([
            { x: 0, y: -115 },
            { x: 4000, y: -115 },
        ]);
        expect(w.rightFace).toEqual([
            { x: 0, y: 115 },
            { x: 4000, y: 115 },
        ]);
        expect(w.leftFace[0]).toBe(w.endA.left);
        expect(w.rightFace[1]).toBe(w.endB.right);
        expect(w.safeU).toEqual([0, 4000]);
        expect(signedArea(w.outline)).toBe(4000 * 230);
        expect([w.leftRoomKey, w.rightRoomKey, w.exteriorSide]).toEqual([
            null,
            null,
            null,
        ]);
        expect(plan.rooms).toEqual([]);
        expect(plan.roomIndexByMetaId).toEqual({});
        expect(plan.roomIndexByFaceKey).toEqual({});
        expect(plan.docRef).toBeDefined();
    });

    it('keeps docRef as the identity of the input', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        expect(derivePlanGeometry(doc).docRef).toBe(doc);
    });

    it('skips a wall with a missing node and keeps the others', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        const [first, second] = Object.keys(doc.walls) as [string, string];
        const aNode = doc.walls[first]!.a;
        const broken = { ...doc.walls[second]!, id: 'w_broken', b: 'n_gone' };
        doc.walls['w_broken'] = broken;
        const plan = derivePlanGeometry(doc);
        expect(plan.walls['w_broken']).toBeUndefined();
        expect(Object.keys(plan.walls)).toHaveLength(4);
        const skipped = plan.issues.filter((i) => i.code === 'wall_skipped');
        expect(skipped).toHaveLength(1);
        expect(skipped[0]!.severity).toBe('warning');
        expect(skipped[0]!.entityIds).toEqual(['w_broken']);
        expect(plan.nodes[aNode]!.wallIds).not.toContain('w_broken');
        expect(plan.nodes[broken.a]!.wallIds).not.toContain('w_broken');
    });

    it('lists the incident valid walls of every node, including orphans', () => {
        const doc = makeLPlan();
        doc.nodes['n_orphan'] = { id: 'n_orphan', x: 9000, y: 9000 };
        const plan = derivePlanGeometry(doc);
        const g = buildWallGraph(doc);
        for (const [nodeId, ids] of g.incident) {
            expect(plan.nodes[nodeId]!.wallIds).toEqual(ids);
        }
        expect(plan.nodes['n_orphan']).toEqual({ wallIds: [] });
        expect(Object.keys(plan.nodes)).toHaveLength(
            Object.keys(doc.nodes).length,
        );
        const degrees = Object.values(plan.nodes).map((n) => n.wallIds.length);
        expect(degrees.filter((n) => n === 3)).toHaveLength(2);
    });

    it('does not mutate a deep-frozen document', () => {
        const doc = deepFreeze(makeLPlan());
        const before = JSON.stringify(doc);
        expect(() => derivePlanGeometry(doc)).not.toThrow();
        expect(JSON.stringify(doc)).toBe(before);
    });

    it('is deterministic and produces only finite, non-negative-zero numbers', () => {
        const doc = makeGridPlan(4, 3);
        const a = derivePlanGeometry(doc);
        const b = derivePlanGeometry(doc);
        expect(JSON.stringify({ ...a, docRef: null })).toBe(
            JSON.stringify({ ...b, docRef: null }),
        );
        const text = JSON.stringify({ ...a, docRef: null });
        expect(text).not.toContain('null,null');
        for (const w of Object.values(a.walls)) {
            expect(w.outline.every(finite)).toBe(true);
            expect(w.outline.length).toBeGreaterThanOrEqual(4);
            expect(signedArea(w.outline)).toBeGreaterThan(0);
        }
        const negZero = (value: unknown): boolean =>
            Object.is(value, -0) ||
            (Array.isArray(value) && value.some(negZero)) ||
            (value !== null &&
                typeof value === 'object' &&
                Object.values(value).some(negZero));
        expect(negZero({ ...a, docRef: null })).toBe(false);
    });
});

describe('derivePlanGeometry: outline fallback', () => {
    it('emits outline_fallback at info for a self-intersecting miter (mild kink)', () => {
        // 2 degree kink between a 230 and a 115 wall: the mitered ring crosses itself.
        const doc = build(
            [
                [0, 0],
                [1000, 0],
                [2000, 35],
            ],
            [
                [0, 1, 230],
                [1, 2, 115],
            ],
        );
        const plan = derivePlanGeometry(doc);
        const found = plan.issues.filter((i) => i.code === 'outline_fallback');
        expect(found.length).toBeGreaterThan(0);
        for (const f of found) {
            expect(f.severity).toBe('info');
            expect(f.messageKey).toBe('engine.plan.derive.outline_fallback');
            expect(f.params['reason']).toBe('self_intersection');
        }
        const wallId = found[0]!.entityIds[0]!;
        // the fallback outline is the plain rectangle
        expect(plan.walls[wallId]!.outline).toHaveLength(4);
    });

    it('emits outline_fallback at warning for degenerate geometry', () => {
        // A zero-thickness wall collapses to a sliver: not a mere kink.
        const doc = build(
            [
                [0, 0],
                [1000, 0],
            ],
            [[0, 1, 0]],
        );
        const plan = derivePlanGeometry(doc);
        const found = plan.issues.filter((i) => i.code === 'outline_fallback');
        expect(found).toHaveLength(1);
        expect(found[0]!.severity).toBe('warning');
        expect(found[0]!.params).toEqual({
            wallId: 'w0',
            reason: 'degenerate',
        });
        expect(found[0]!.entityIds).toEqual(['w0']);
        expect(plan.walls['w0']!.outline.every(finite)).toBe(true);
    });

    it('uses plain-rectangle faces and a full safeU for a fallback wall', () => {
        const doc = build(
            [
                [0, 0],
                [1000, 0],
                [2000, 35],
            ],
            [
                [0, 1, 230],
                [1, 2, 115],
            ],
        );
        const plan = derivePlanGeometry(doc);
        const fb = plan.issues.find((i) => i.code === 'outline_fallback')!
            .entityIds[0]!;
        const w = plan.walls[fb]!;
        expect(w.safeU).toEqual([0, w.length]);
        expect(w.leftFace[0]).toEqual({
            x: w.centerline[0].x + w.normal.x * (w.thickness / 2),
            y: w.centerline[0].y + w.normal.y * (w.thickness / 2),
        });
    });
});

describe('derivePlanGeometry: node caps, union and bbox', () => {
    it('gives an exterior outline of 5230 x 4230 for a 5000 x 4000 rectangle', () => {
        const plan = derivePlanGeometry(makeRectPlan(5000, 4000, 230));
        const ext = plan.exteriorOutline!;
        expect(Math.abs(Math.abs(signedArea(ext)) - 5230 * 4230)).toBeLessThan(
            1,
        );
        expect(signedArea(ext)).toBeGreaterThan(0);
        expect(plan.wallsUnion).toHaveLength(1);
        expect(plan.wallsUnion[0]!.holes).toHaveLength(1);
        expect(plan.nodeCaps).toEqual({});
        expect(bounds(ext)).toEqual({ x0: -115, x1: 5115, y0: -115, y1: 4115 });
    });

    it('bbox covers all wall outlines', () => {
        const plan = derivePlanGeometry(makeRectPlan(5000, 4000, 230));
        expect(plan.bbox).toEqual({
            min: { x: -115, y: -115 },
            max: { x: 5115, y: 4115 },
        });
    });

    it('wall outlines tile the union without overlap', () => {
        const plan = derivePlanGeometry(makeLPlan());
        const sum = Object.values(plan.walls).reduce(
            (s, w) => s + signedArea(w.outline),
            0,
        );
        const unionArea = plan.wallsUnion.reduce((s, p) => s + area(p), 0);
        expect(Math.abs(unionArea - sum) / sum).toBeLessThan(0.001);
    });

    it('closes a T-junction with a node cap', () => {
        const doc = makeLPlan();
        const t = Object.values(doc.nodes).find(
            (n) => n.x === 5000 && n.y === 0,
        )!;
        const plan = derivePlanGeometry(doc);
        const cap = plan.nodeCaps[t.id]!;
        expect(cap).toBeDefined();
        expect(cap.length).toBeGreaterThanOrEqual(3);
        expect(cap.every(finite)).toBe(true);
        expect(signedArea(cap)).toBeGreaterThan(0);
        // Every cap corner is a corner of an incident wall outline.
        const g = buildWallGraph(doc);
        const ends = computeAllWallEnds(g);
        const corners = plan.nodes[t.id]!.wallIds.flatMap((id) => {
            const e = ends.get(id)!;
            return g.valid.get(id)!.wall.a === t.id
                ? [e.endA.left, e.endA.right]
                : [e.endB.left, e.endB.right];
        });
        for (const c of cap) {
            expect(corners.some((q) => q.x === c.x && q.y === c.y)).toBe(true);
        }
    });

    it('gives the other L-plan T-junction and no 2-wall miter corner a cap', () => {
        const doc = makeLPlan();
        const plan = derivePlanGeometry(doc);
        const capped = Object.keys(plan.nodeCaps).sort();
        const t1 = Object.values(doc.nodes).find(
            (n) => n.x === 5000 && n.y === 0,
        )!;
        const t2 = Object.values(doc.nodes).find(
            (n) => n.x === 5000 && n.y === 3500,
        )!;
        expect(capped).toEqual([t1.id, t2.id].sort());
    });

    it('caps a bevelled two-wall corner', () => {
        // 20 degree wedge: the miter is rejected, so the corner bevels.
        const doc = build(
            [
                [0, 0],
                [3000, 0],
                [2060, 342],
            ],
            [
                [0, 1, 230],
                [1, 2, 230],
            ],
        );
        const bevelled = derivePlanGeometry(doc);
        expect(bevelled.walls['w0']!.endB.joint).toBe('bevel');
        expect(bevelled.nodeCaps['n1']).toBeDefined();
        expect(signedArea(bevelled.nodeCaps['n1']!)).toBeGreaterThan(0);
        expect(bevelled.nodeCaps['n0']).toBeUndefined();
    });

    it('handles a plan without walls', () => {
        const empty = derivePlanGeometry(emptyPlan());
        expect(empty.walls).toEqual({});
        expect(empty.exteriorOutline).toBeNull();
        expect(empty.wallsUnion).toEqual([]);
        expect(empty.bbox).toEqual({
            min: { x: 0, y: 0 },
            max: { x: 0, y: 0 },
        });
        expect(empty.issues).toEqual([]);

        const doc = emptyPlan();
        doc.nodes['n0'] = { id: 'n0', x: -100, y: 40 };
        doc.nodes['n1'] = { id: 'n1', x: 300, y: 900 };
        const nodesOnly = derivePlanGeometry(doc);
        expect(nodesOnly.bbox).toEqual({
            min: { x: -100, y: 40 },
            max: { x: 300, y: 900 },
        });
        expect(nodesOnly.nodes['n0']).toEqual({ wallIds: [] });
    });

    it('derives the 97-wall grid fixture with its 40 openings', () => {
        const plan = derivePlanGeometry(makeGridPlan(7, 6));
        expect(Object.keys(plan.walls)).toHaveLength(97);
        expect(Object.keys(plan.openings)).toHaveLength(40);
        expect(plan.issues.filter((i) => i.severity === 'warning')).toEqual([]);
    });

    it.each([1e9, 1e12, Number.NaN, Number.POSITIVE_INFINITY])(
        'derives in time independent of coordinate size (one node at %s)',
        (far) => {
            const doc = makeRectPlan(5000, 4000, 230);
            doc.nodes['n_0000000001']!.x = far;
            const t0 = performance.now();
            derivePlanGeometry(doc);
            expect(performance.now() - t0).toBeLessThan(200);
        },
    );
});
