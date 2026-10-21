import { create, type Draft } from 'mutative';
import { describe, expect, it } from 'vitest';
import { CommandAbort, type CommandOutput } from '../../../commands/types';
import { dist } from '../../../geometry/vec2';
import { testIds } from '../../../testing/ids';
import type { IdPrefix } from '../../../ids';
import type {
    FurniturePlacement,
    Opening,
    PlanDocument,
    Wall,
} from '../../schema';
import { emptyPlan } from '../../testing/fixtures';
import { definePlanCommand } from '../define';
import {
    insertWallSegment,
    mergeNodeInto,
    nextOpeningLabel,
    reclampOpenings,
    resolveEndpoint,
    splitIntersections,
    splitWallAt,
    wallLength,
    type WallProps,
} from '../helpers';
import { createPlanBus } from '../registry';

// ---- fixtures ----------------------------------------------------------------

type Doc = Draft<PlanDocument>;
type NewId = (prefix: IdPrefix) => string;
type Out = CommandOutput<unknown>;

const PROPS: WallProps = {
    thickness: 115,
    height: 2700,
    kind: 'interior',
    justification: 'center',
    material: 'brick',
    colorHex: null,
};

/** Builds a wall graph; ids come from the same factory the helpers will use. */
class Graph {
    readonly ids: NewId = testIds();
    doc: PlanDocument = emptyPlan();

    node(x: number, y: number): string {
        const id = this.ids('n');
        this.doc.nodes[id] = { id, x, y };
        return id;
    }

    wall(a: string, b: string, props: Partial<WallProps> = {}): string {
        const id = this.ids('w');
        this.doc.walls[id] = { ...PROPS, ...props, id, a, b };
        return id;
    }

    opening(
        wallId: string,
        offset: number,
        width: number,
        over: Partial<Opening> = {},
    ): string {
        const id = this.ids('o');
        this.doc.openings[id] = {
            id,
            wallId,
            kind: 'door',
            type: 'single_swing',
            offset,
            width,
            height: 2100,
            sillHeight: 0,
            hinge: 'start',
            swing: 'left',
            label: null,
            ...over,
        };
        return id;
    }

    placement(
        wallId: string,
        side: 'left' | 'right',
        x: number,
        y: number,
    ): string {
        const id = this.ids('f');
        const p: FurniturePlacement = {
            id,
            designId: 'des_x',
            x,
            y,
            rotation: 0,
            elevation: 0,
            mirrored: false,
            wallAttachment: { wallId, side },
        };
        this.doc.placements[id] = p;
        return id;
    }

    dimension(wallId: string): string {
        const id = this.ids('d');
        this.doc.annotations.dimensions[id] = {
            id,
            a: { x: 0, y: 0 },
            b: { x: 1, y: 1 },
            offset: 300,
            attachedTo: { kind: 'wall', wallId, face: 'left' },
        };
        return id;
    }

    /** The graph after `recipe` ran on a mutative draft with this factory. */
    run<T>(recipe: (d: Doc, ctx: { newId: NewId }, out: Out) => T): {
        doc: PlanDocument;
        value: T;
        out: Out;
    } {
        const out: Out = { result: undefined, warnings: [], deletedIds: [] };
        let value!: T;
        const doc = create(this.doc, (d) => {
            value = recipe(d as Doc, { newId: this.ids }, out);
        });
        return { doc, value, out };
    }

    /** The abort code `recipe` throws. */
    abortOf(recipe: (d: Doc, ctx: { newId: NewId }, out: Out) => unknown) {
        try {
            this.run(recipe);
        } catch (error) {
            if (error instanceof CommandAbort) return error.reason;
            throw error;
        }
        throw new Error('expected a CommandAbort');
    }
}

const wallsOf = (doc: PlanDocument): Wall[] =>
    Object.values(doc.walls).sort((p, q) => (p.id < q.id ? -1 : 1));

const at = (doc: PlanDocument, id: string): [number, number] => [
    doc.nodes[id]!.x,
    doc.nodes[id]!.y,
];

const endsOf = (doc: PlanDocument, wallId: string): string =>
    `${at(doc, doc.walls[wallId]!.a)}>${at(doc, doc.walls[wallId]!.b)}`;

/** A horizontal wall (0,0)-(5000,0) with distinguishable properties. */
function oneWall() {
    const g = new Graph();
    const a = g.node(0, 0);
    const b = g.node(5000, 0);
    const w = g.wall(a, b, {
        thickness: 230,
        kind: 'exterior',
        material: 'concrete',
        colorHex: '#aabbcc',
    });
    return { g, a, b, w };
}

// ---- wallLength ------------------------------------------------------------

describe('wallLength', () => {
    it('is the centre-line length, a float for a diagonal', () => {
        const g = new Graph();
        const w = g.wall(g.node(0, 0), g.node(3000, 4000));
        const diagonal = g.wall(g.node(0, 0), g.node(1, 1));
        const { value } = g.run((d) => [
            wallLength(d, w),
            wallLength(d, diagonal),
        ]);
        expect(value[0]).toBe(5000);
        expect(value[1]).toBeCloseTo(Math.SQRT2, 12);
    });

    it('aborts not_found for a missing wall', () => {
        const g = new Graph();
        expect(g.abortOf((d) => wallLength(d, 'w_nothing'))).toMatchObject({
            code: 'not_found',
            messageKey: 'engine.plan.command.not_found',
        });
    });
});

// ---- resolveEndpoint -------------------------------------------------------

describe('resolveEndpoint', () => {
    it('returns an existing node id and aborts for an unknown one', () => {
        const { g, a } = oneWall();
        expect(
            g.run((d, c, o) => resolveEndpoint(d, { nodeId: a }, c, o)).value,
        ).toBe(a);
        expect(
            g.abortOf((d, c, o) =>
                resolveEndpoint(d, { nodeId: 'n_missing' }, c, o),
            ).code,
        ).toBe('not_found');
    });

    it('reuses a node 3 mm away without creating anything', () => {
        const { g, b } = oneWall();
        const r = g.run((d, c, o) =>
            resolveEndpoint(d, { point: { x: 5003, y: 0 } }, c, o),
        );
        expect(r.value).toBe(b);
        expect(r.doc).toBe(g.doc);
    });

    it('picks the nearest of two nodes within tolerance, ties by id', () => {
        const g = new Graph();
        const n1 = g.node(100, 0);
        const n2 = g.node(104, 0);
        const near = (x: number) =>
            g.run((d, c, o) => resolveEndpoint(d, { point: { x, y: 0 } }, c, o))
                .value;
        expect(near(103)).toBe(n2);
        expect(near(101)).toBe(n1);
        expect(near(102)).toBe(n1); // 2 mm from both: the smaller id
    });

    it('splits a wall whose centre line is 3 mm away: T node, a -> N, N -> b with the same props', () => {
        const { g, a, b, w } = oneWall();
        const { doc, value } = g.run((d, c, o) =>
            resolveEndpoint(d, { point: { x: 2000, y: 3 } }, c, o),
        );
        expect(at(doc, value)).toEqual([2000, 0]);
        expect(doc.walls[w]).toMatchObject({ id: w, a, b: value });
        const tail = wallsOf(doc).find((x) => x.id !== w)!;
        expect(tail).toMatchObject({
            a: value,
            b,
            thickness: 230,
            kind: 'exterior',
            material: 'concrete',
            colorHex: '#aabbcc',
            height: 2700,
            justification: 'center',
        });
        expect(Object.keys(doc.walls)).toHaveLength(2);
    });

    it('creates a rounded node when nothing is near', () => {
        const { g } = oneWall();
        const { doc, value } = g.run((d, c, o) =>
            resolveEndpoint(d, { point: { x: 1234.6, y: -400.5 } }, c, o),
        );
        expect(doc.nodes[value]).toEqual({ id: value, x: 1235, y: -401 });
        expect(Object.keys(doc.walls)).toHaveLength(1);
    });

    it('does not split a wall within tolerance of its end', () => {
        const { g } = oneWall();
        // 4 mm along, 4 mm off: no node within 5 mm, projection inside the end margin
        const { doc, value } = g.run((d, c, o) =>
            resolveEndpoint(d, { point: { x: 4, y: -4 } }, c, o),
        );
        expect(Object.keys(doc.walls)).toHaveLength(1);
        expect(doc.nodes[value]).toEqual({ id: value, x: 4, y: -4 });
    });

    it('writes a new node without a negative zero', () => {
        const { g } = oneWall();
        const { doc, value } = g.run((d, c, o) =>
            resolveEndpoint(d, { point: { x: -0.2, y: -3000.2 } }, c, o),
        );
        expect(Object.is(doc.nodes[value]!.x, 0)).toBe(true);
        expect(doc.nodes[value]!.y).toBe(-3000);
    });

    it('splits the nearer of two walls within tolerance', () => {
        const g = new Graph();
        const w1 = g.wall(g.node(0, 0), g.node(5000, 0));
        const w2 = g.wall(g.node(0, 4), g.node(5000, 4));
        const { doc } = g.run((d, c, o) =>
            resolveEndpoint(d, { point: { x: 2500, y: 3 } }, c, o),
        );
        expect(Object.keys(doc.walls)).toHaveLength(3);
        expect(doc.walls[w1]!.b).toBe(g.doc.walls[w1]!.b);
        expect(doc.walls[w2]!.b).not.toBe(g.doc.walls[w2]!.b);
    });
});

// ---- splitWallAt -----------------------------------------------------------

describe('splitWallAt', () => {
    it('aborts split_through_opening when the cut is strictly inside an opening', () => {
        const { g, w } = oneWall();
        g.opening(w, 2500, 900); // 2050..2950
        const reason = g.abortOf((d, c, o) =>
            splitWallAt(d, w, { x: 2500, y: 0 }, c, o),
        );
        expect(reason).toMatchObject({
            code: 'split_through_opening',
            messageKey: 'engine.plan.command.split_through_opening',
        });
        // the opening's edges are not inside it
        for (const x of [2050, 2950]) {
            expect(() =>
                g.run((d, c, o) => splitWallAt(d, w, { x, y: 0 }, c, o)),
            ).not.toThrow();
        }
    });

    it('creates the node at the rounded projection, keeps the id on a -> N and copies props', () => {
        const { g, a, b, w } = oneWall();
        const { doc, value } = g.run((d, c, o) =>
            splitWallAt(d, w, { x: 1999.6, y: 40 }, c, o),
        );
        expect(doc.nodes[value]).toEqual({ id: value, x: 2000, y: 0 });
        expect(doc.walls[w]).toMatchObject({ a, b: value, thickness: 230 });
        const tail = wallsOf(doc).find((x) => x.id !== w)!;
        expect(tail).toMatchObject({ a: value, b, colorHex: '#aabbcc' });
    });

    it('rounds the new node without a negative zero', () => {
        const g = new Graph();
        const w = g.wall(g.node(0, 1000), g.node(0, -1000));
        const { doc, value } = g.run((d, c, o) =>
            splitWallAt(d, w, { x: 3, y: -0.3 }, c, o),
        );
        expect(Object.is(doc.nodes[value]!.x, 0)).toBe(true);
        expect(Object.is(doc.nodes[value]!.y, 0)).toBe(true);
    });

    it('moves the openings beyond the cut to the new wall with offset - dist(A, N)', () => {
        const { g, w } = oneWall();
        const before = g.opening(w, 600, 900);
        const after = g.opening(w, 3500, 1200, {
            kind: 'window',
            type: 'casement',
        });
        const { doc } = g.run((d, c, o) =>
            splitWallAt(d, w, { x: 2000, y: 0 }, c, o),
        );
        const tail = wallsOf(doc).find((x) => x.id !== w)!.id;
        expect(doc.openings[before]).toMatchObject({ wallId: w, offset: 600 });
        expect(doc.openings[after]).toMatchObject({
            wallId: tail,
            offset: 1500,
        });
    });

    it('re-attaches placements beyond the cut to the new wall, same side; dimensions stay', () => {
        const { g, w } = oneWall();
        const near = g.placement(w, 'left', 500, -100);
        const far = g.placement(w, 'right', 4000, 100);
        const dim = g.dimension(w);
        const { doc } = g.run((d, c, o) =>
            splitWallAt(d, w, { x: 2000, y: 0 }, c, o),
        );
        const tail = wallsOf(doc).find((x) => x.id !== w)!.id;
        expect(doc.placements[near]!.wallAttachment).toEqual({
            wallId: w,
            side: 'left',
        });
        expect(doc.placements[far]!.wallAttachment).toEqual({
            wallId: tail,
            side: 'right',
        });
        expect(doc.annotations.dimensions[dim]!.attachedTo!.wallId).toBe(w);
    });

    it('takes every new id from ctx.newId', () => {
        const { g, w } = oneWall();
        const used: string[] = [];
        const ctx = {
            newId: (prefix: IdPrefix) => {
                const id = `${prefix}_fixed${String(used.length).padStart(5, '0')}`;
                used.push(id);
                return id;
            },
        };
        const out: Out = { result: undefined, warnings: [], deletedIds: [] };
        const doc = create(g.doc, (d) => {
            splitWallAt(d as Doc, w, { x: 2000, y: 0 }, ctx, out);
        });
        expect(used.sort()).toEqual(['n_fixed00000', 'w_fixed00001'].sort());
        expect(doc.nodes.n_fixed00000).toBeDefined();
        expect(doc.walls.w_fixed00001).toBeDefined();
    });
});

// ---- insertWallSegment -----------------------------------------------------

describe('insertWallSegment', () => {
    it('across an existing wall splits both: 4 walls share one new node', () => {
        const g = new Graph();
        const w = g.wall(g.node(0, 0), g.node(4000, 0));
        const from = g.node(2000, -1000);
        const to = g.node(2000, 1000);
        const { doc, value } = g.run((d, c, o) =>
            insertWallSegment(d, from, to, PROPS, c, o),
        );
        expect(value.lastNodeId).toBe(to);
        expect(value.wallIds).toHaveLength(2);
        expect(wallsOf(doc)).toHaveLength(4);
        expect(Object.keys(doc.nodes)).toHaveLength(5);
        const fresh = Object.keys(doc.nodes).find(
            (id) => !(id in g.doc.nodes),
        )!;
        const touching = wallsOf(doc).filter(
            (x) => x.a === fresh || x.b === fresh,
        );
        expect(touching).toHaveLength(4);
        expect(at(doc, fresh)).toEqual([2000, 0]);
        // ordered from -> to
        expect(doc.walls[value.wallIds[0]!]).toMatchObject({
            a: from,
            b: fresh,
        });
        expect(doc.walls[value.wallIds[1]!]).toMatchObject({
            a: fresh,
            b: to,
        });
        expect(doc.walls[w]!.b).toBe(fresh);
    });

    it('joins an existing node within 5 mm of the segment interior', () => {
        const g = new Graph();
        const from = g.node(0, 0);
        const to = g.node(4000, 0);
        const near = g.node(2000, 4);
        const far = g.node(3000, 6);
        const { doc, value } = g.run((d, c, o) =>
            insertWallSegment(d, from, to, PROPS, c, o),
        );
        expect(
            value.wallIds.map((id) => [doc.walls[id]!.a, doc.walls[id]!.b]),
        ).toEqual([
            [from, near],
            [near, to],
        ]);
        expect(far in doc.nodes).toBe(true);
    });

    it('creates only the uncovered ends of a collinear overlap', () => {
        const g = new Graph();
        const a = g.node(1000, 0);
        const b = g.node(3000, 0);
        const existing = g.wall(a, b);
        const from = g.node(0, 0);
        const to = g.node(4000, 0);
        const { doc, value } = g.run((d, c, o) =>
            insertWallSegment(d, from, to, PROPS, c, o),
        );
        expect(value.wallIds.map((id) => endsOf(doc, id))).toEqual([
            '0,0>1000,0',
            '3000,0>4000,0',
        ]);
        expect(doc.walls[existing]).toBe(g.doc.walls[existing]);
        expect(wallsOf(doc)).toHaveLength(3);
    });

    it('handles a partial overlap at the far end and at the near end', () => {
        // existing 0..2000; new 1000..4000 starts inside it
        const g = new Graph();
        const e1 = g.node(0, 0);
        const e2 = g.node(2000, 0);
        g.wall(e1, e2);
        const from = g.node(1000, 0);
        const to = g.node(4000, 0);
        const far = g.run((d, c, o) =>
            insertWallSegment(d, from, to, PROPS, c, o),
        );
        expect(far.value.wallIds.map((id) => endsOf(far.doc, id))).toEqual([
            '2000,0>4000,0',
        ]);

        // existing 0..2000; new -1000..1000 ends inside it
        const h = new Graph();
        const f1 = h.node(0, 0);
        const f2 = h.node(2000, 0);
        h.wall(f1, f2);
        const from2 = h.node(-1000, 0);
        const to2 = h.node(1000, 0);
        const near = h.run((d, c, o) =>
            insertWallSegment(d, from2, to2, PROPS, c, o),
        );
        expect(near.value.wallIds.map((id) => endsOf(near.doc, id))).toEqual([
            '-1000,0>0,0',
        ]);
    });

    it('also covers a segment drawn right to left and a wall running the other way', () => {
        const g = new Graph();
        const e1 = g.node(3000, 0);
        const e2 = g.node(1000, 0); // runs right to left
        g.wall(e1, e2);
        const from = g.node(4000, 0);
        const to = g.node(0, 0);
        const { doc, value } = g.run((d, c, o) =>
            insertWallSegment(d, from, to, PROPS, c, o),
        );
        expect(value.wallIds.map((id) => endsOf(doc, id))).toEqual([
            '4000,0>3000,0',
            '1000,0>0,0',
        ]);
    });

    it('aborts wall_duplicate when the segment is fully covered', () => {
        const g = new Graph();
        const a = g.node(0, 0);
        const b = g.node(4000, 0);
        g.wall(a, b);
        // the same two nodes
        expect(
            g.abortOf((d, c, o) => insertWallSegment(d, a, b, PROPS, c, o)),
        ).toMatchObject({
            code: 'wall_duplicate',
            messageKey: 'engine.plan.command.wall_duplicate',
        });
        // the other way round
        expect(
            g.abortOf((d, c, o) => insertWallSegment(d, b, a, PROPS, c, o))
                .code,
        ).toBe('wall_duplicate');
        // a segment inside the wall, on its own nodes
        const m1 = g.node(1000, 0);
        const m2 = g.node(3000, 0);
        expect(
            g.abortOf((d, c, o) => insertWallSegment(d, m1, m2, PROPS, c, o))
                .code,
        ).toBe('wall_duplicate');
        // and one drawn over two walls that already cover it
        const g2 = new Graph();
        const p = g2.node(0, 0);
        const q = g2.node(2000, 0);
        const r = g2.node(4000, 0);
        g2.wall(p, q);
        g2.wall(q, r);
        expect(
            g2.abortOf((d, c, o) => insertWallSegment(d, p, r, PROPS, c, o))
                .code,
        ).toBe('wall_duplicate');
    });

    it('aborts wall_too_short under 10 mm and accepts exactly 10 mm', () => {
        const g = new Graph();
        const a = g.node(0, 0);
        const short = g.node(9, 0);
        const ok = g.node(10, 0);
        expect(
            g.abortOf((d, c, o) => insertWallSegment(d, a, short, PROPS, c, o)),
        ).toMatchObject({
            code: 'wall_too_short',
            messageKey: 'engine.plan.command.wall_too_short',
        });
        expect(
            g.abortOf((d, c, o) => insertWallSegment(d, a, a, PROPS, c, o))
                .code,
        ).toBe('wall_too_short');
        const { value } = g.run((d, c, o) =>
            insertWallSegment(d, a, ok, PROPS, c, o),
        );
        expect(value.wallIds).toHaveLength(1);
    });

    it('gives every new wall the props and ids from ctx.newId', () => {
        const g = new Graph();
        const from = g.node(0, 0);
        const to = g.node(3000, 0);
        const props: WallProps = {
            ...PROPS,
            thickness: 230,
            kind: 'exterior',
            colorHex: '#112233',
        };
        const { doc, value } = g.run((d, c, o) =>
            insertWallSegment(d, from, to, props, c, o),
        );
        expect(doc.walls[value.wallIds[0]!]).toEqual({
            ...props,
            id: value.wallIds[0],
            a: from,
            b: to,
        });
        expect(value.wallIds[0]).toBe('w_0000000001');
    });

    it('splits several crossed walls in order along from -> to, whatever the insertion order', () => {
        const build = (reverse: boolean, leftToRight: boolean) => {
            const g = new Graph();
            const xs = [3000, 1000, 2000];
            const order = reverse ? [...xs].reverse() : xs;
            const verticals = new Map<number, string>();
            for (const x of order) {
                verticals.set(x, g.wall(g.node(x, -500), g.node(x, 500)));
            }
            const left = g.node(0, 0);
            const right = g.node(4000, 0);
            const [from, to] = leftToRight ? [left, right] : [right, left];
            const { doc, value } = g.run((d, c, o) =>
                insertWallSegment(d, from, to, PROPS, c, o),
            );
            const created = Object.values(doc.nodes)
                .filter((n) => n.y === 0 && n.x % 1000 === 0)
                .filter((n) => n.id !== left && n.id !== right)
                .sort((p, q) => (p.id < q.id ? -1 : 1))
                .map((n) => n.x);
            expect(verticals.size).toBe(3);
            return {
                created,
                walls: value.wallIds.map((id) => endsOf(doc, id)),
            };
        };
        const forward = build(false, true);
        expect(forward.created).toEqual([1000, 2000, 3000]);
        expect(forward.walls).toEqual([
            '0,0>1000,0',
            '1000,0>2000,0',
            '2000,0>3000,0',
            '3000,0>4000,0',
        ]);
        // node ids ascend along the drawing direction
        expect(build(false, false).created).toEqual([3000, 2000, 1000]);
        // object insertion order does not change which id goes where
        expect(build(true, true).created).toEqual(forward.created);
        expect(build(true, true).walls).toEqual(forward.walls);
    });

    it('rounds the node it makes on a diagonal crossing', () => {
        const g = new Graph();
        g.wall(g.node(0, 0), g.node(3001, 2000));
        const from = g.node(0, 1500);
        const to = g.node(4000, 500);
        const { doc } = g.run((d, c, o) =>
            insertWallSegment(d, from, to, PROPS, c, o),
        );
        for (const n of Object.values(doc.nodes)) {
            expect(Number.isInteger(n.x)).toBe(true);
            expect(Number.isInteger(n.y)).toBe(true);
            expect(Object.is(n.x, -0) || Object.is(n.y, -0)).toBe(false);
        }
        expect(Object.keys(doc.nodes)).toHaveLength(5);
    });

    it('aborts split_through_opening when the crossed wall has an opening at the crossing', () => {
        const g = new Graph();
        const w = g.wall(g.node(0, 0), g.node(4000, 0));
        g.opening(w, 2000, 900);
        const from = g.node(2000, -1000);
        const to = g.node(2000, 1000);
        expect(
            g.abortOf((d, c, o) => insertWallSegment(d, from, to, PROPS, c, o))
                .code,
        ).toBe('split_through_opening');
    });
});

// ---- splitIntersections ----------------------------------------------------------

describe('splitIntersections', () => {
    it('splits both crossing walls at the crossing', () => {
        const g = new Graph();
        const h = g.wall(g.node(0, 0), g.node(4000, 0));
        const v = g.wall(g.node(2000, -1000), g.node(2000, 1000));
        const { doc } = g.run((d, c, o) => splitIntersections(d, h, c, o));
        expect(wallsOf(doc)).toHaveLength(4);
        const fresh = Object.keys(doc.nodes).filter(
            (id) => !(id in g.doc.nodes),
        );
        expect(fresh).toHaveLength(1);
        expect(
            wallsOf(doc).filter((x) => x.a === fresh[0] || x.b === fresh[0]),
        ).toHaveLength(4);
        expect(doc.walls[h]!.b).toBe(fresh[0]);
        expect(doc.walls[v]!.b).toBe(fresh[0]);
    });

    it('cuts several crossings along the wall and moves the openings with the cuts', () => {
        const g = new Graph();
        const h = g.wall(g.node(0, 0), g.node(4000, 0));
        const o = g.opening(h, 3500, 600);
        g.wall(g.node(1000, -500), g.node(1000, 500));
        g.wall(g.node(3000, -500), g.node(3000, 500));
        const { doc } = g.run((d, c, out) => splitIntersections(d, h, c, out));
        expect(wallsOf(doc)).toHaveLength(7);
        expect(doc.openings[o]).toMatchObject({ offset: 500 });
        expect(endsOf(doc, doc.openings[o]!.wallId)).toBe('3000,0>4000,0');
        expect(endsOf(doc, h)).toBe('0,0>1000,0');
    });

    it('splits the wall at a node near its interior and reuses a node near the crossing', () => {
        const g = new Graph();
        const h = g.wall(g.node(0, 0), g.node(4000, 0));
        const loose = g.node(1500, 3);
        // ends 2 mm past the crossing: its end node is reused, it is not split
        const v = g.wall(g.node(3000, -1000), g.node(3000, 2));
        const { doc } = g.run((d, c, o) => splitIntersections(d, h, c, o));
        expect(wallsOf(doc)).toHaveLength(4);
        expect(Object.keys(doc.nodes)).toHaveLength(5);
        expect(endsOf(doc, v)).toBe('3000,-1000>3000,2');
        expect(doc.walls[h]!.b).toBe(loose);
        expect(
            wallsOf(doc)
                .filter((x) => x.id !== h && x.id !== v)
                .map((x) => endsOf(doc, x.id))
                .sort(),
        ).toEqual(['1500,3>3000,2', '3000,2>4000,0']);
    });

    it('leaves a wall with no crossings alone', () => {
        const { g, w } = oneWall();
        const { doc } = g.run((d, c, o) => splitIntersections(d, w, c, o));
        expect(doc).toBe(g.doc);
    });

    it('aborts split_through_opening', () => {
        const g = new Graph();
        const h = g.wall(g.node(0, 0), g.node(4000, 0));
        g.opening(h, 2000, 900);
        g.wall(g.node(2000, -1000), g.node(2000, 1000));
        expect(
            g.abortOf((d, c, o) => splitIntersections(d, h, c, o)).code,
        ).toBe('split_through_opening');
    });
});

// ---- mergeNodeInto -----------------------------------------------------------------

describe('mergeNodeInto', () => {
    it('rewires walls, deletes the source node and reports it', () => {
        const g = new Graph();
        const src = g.node(0, 0);
        const dst = g.node(10, 0);
        const far = g.node(0, 3000);
        const w = g.wall(src, far);
        const { doc, out } = g.run((d, c, o) =>
            mergeNodeInto(d, src, dst, c, o),
        );
        expect(doc.walls[w]).toMatchObject({ a: dst, b: far });
        expect(src in doc.nodes).toBe(false);
        expect(out.deletedIds).toEqual([src]);
    });

    it('deletes the walls that become degenerate together with their openings', () => {
        const g = new Graph();
        const src = g.node(0, 0);
        const dst = g.node(100, 0);
        const far = g.node(0, 3000);
        const between = g.wall(src, dst);
        const o1 = g.opening(between, 50, 40, {
            kind: 'window',
            type: 'fixed',
        });
        const keep = g.wall(far, src);
        const { doc, out } = g.run((d, c, o) =>
            mergeNodeInto(d, src, dst, c, o),
        );
        expect(between in doc.walls).toBe(false);
        expect(o1 in doc.openings).toBe(false);
        expect(doc.walls[keep]).toMatchObject({ a: far, b: dst });
        expect(out.deletedIds).toEqual([between, o1, src]);
    });

    it('keeps the smaller id of a duplicate pair and transfers openings that fit, re-projected', () => {
        const g = new Graph();
        const a = g.node(0, 0);
        const b = g.node(5000, 0);
        const src = g.node(3000, 4000);
        const keeper = g.wall(a, b);
        const loser = g.wall(a, src); // 5000 long, becomes a -> b
        const door = g.opening(loser, 1000, 900, {
            hinge: 'start',
            swing: 'left',
        });
        const { doc, out } = g.run((d, c, o) => mergeNodeInto(d, src, b, c, o));
        expect(Object.keys(doc.walls)).toEqual([keeper]);
        expect(doc.openings[door]).toMatchObject({
            wallId: keeper,
            offset: 600,
            hinge: 'start',
            swing: 'left',
        });
        expect(out.deletedIds).toEqual([loser, src]);
    });

    it('keeps the smaller id even when it is the rewired wall, and flips hinge and swing for a reversed wall', () => {
        const g = new Graph();
        const a = g.node(0, 0);
        const b = g.node(5000, 0);
        const src = g.node(3000, 4000);
        const rewired = g.wall(a, src); // smaller id than `other`
        const other = g.wall(b, a); // runs b -> a
        const door = g.opening(other, 1000, 900, {
            hinge: 'start',
            swing: 'left',
        });
        const { doc } = g.run((d, c, o) => mergeNodeInto(d, src, b, c, o));
        expect(Object.keys(doc.walls)).toEqual([rewired]);
        expect(doc.walls[rewired]).toMatchObject({ a, b });
        // 1000 from b -> 4000 from a; the door now hinges at the other end
        expect(doc.openings[door]).toMatchObject({
            wallId: rewired,
            offset: 4000,
            hinge: 'end',
            swing: 'right',
        });
    });

    it('deletes openings that overlap the keeper or do not fit, with a report', () => {
        const g = new Graph();
        const a = g.node(0, 0);
        const b = g.node(5000, 0);
        const src = g.node(3000, 4000);
        const keeper = g.wall(a, b);
        g.opening(keeper, 600, 900);
        const loser = g.wall(a, src);
        const clash = g.opening(loser, 1000, 900, {
            kind: 'window',
            type: 'fixed',
        }); // -> 600: overlaps the door
        const fits = g.opening(loser, 4500, 900); // centre (2700, 3600) -> 2700
        const { doc, out } = g.run((d, c, o) => mergeNodeInto(d, src, b, c, o));
        expect(clash in doc.openings).toBe(false);
        expect(doc.openings[fits]).toMatchObject({
            wallId: keeper,
            offset: 2700,
        });
        expect(out.deletedIds).toEqual([clash, loser, src]);
    });

    it('does nothing for the same node and aborts for an unknown one', () => {
        const { g, a } = oneWall();
        expect(g.run((d, c, o) => mergeNodeInto(d, a, a, c, o)).doc).toBe(
            g.doc,
        );
        expect(
            g.abortOf((d, c, o) => mergeNodeInto(d, a, 'n_missing', c, o)).code,
        ).toBe('not_found');
    });
});

// ---- reclampOpenings ---------------------------------------------------------------

describe('reclampOpenings', () => {
    /** A 4000 mm wall whose `a` end moves 1000 mm towards `b` (or `b` towards `a`). */
    function shortened(end: 'a' | 'b' | 'both' | 'none') {
        const g = new Graph();
        const a = g.node(0, 0);
        const b = g.node(4000, 0);
        const w = g.wall(a, b);
        const door = g.opening(w, 3000, 900);
        const run = (move: (d: Doc) => void, moved = end) =>
            g.run((d) => {
                move(d);
                reclampOpenings(d, w, moved, 4000);
            });
        return { g, a, b, w, door, run };
    }

    it("movedEnd 'a' keeps the distance to node b", () => {
        const { a, door, run } = shortened('a');
        const { doc } = run((d) => {
            d.nodes[a]!.x = 1000;
        });
        // 1000 from b before, 1000 from b now: 3000 - 1000 = 2000
        expect(doc.openings[door]!.offset).toBe(2000);
    });

    it("movedEnd 'b' keeps the offset, clamped into the shorter wall", () => {
        const { b, door, run } = shortened('b');
        const { doc } = run((d) => {
            d.nodes[b]!.x = 2000;
        });
        expect(doc.openings[door]!.offset).toBe(1550); // 2000 - 450
    });

    it("movedEnd 'both' and 'none' keep the offset", () => {
        const { g, w, door } = shortened('none');
        const none = g.run((d) => reclampOpenings(d, w, 'none', 4000));
        expect(none.doc).toBe(g.doc);
        const both = g.run((d) => {
            d.nodes[g.doc.walls[w]!.b]!.x = 4500;
            reclampOpenings(d, w, 'both', 4000);
        });
        expect(both.doc.openings[door]!.offset).toBe(3000);
        const shrunk = g.run((d) => {
            d.nodes[g.doc.walls[w]!.b]!.x = 3200;
            reclampOpenings(d, w, 'both', 4000);
        });
        expect(shrunk.doc.openings[door]!.offset).toBe(2750);
    });

    it('aborts opening_no_fit when an opening is wider than the wall', () => {
        const { b, run } = shortened('b');
        let reason: unknown;
        try {
            run((d) => {
                d.nodes[b]!.x = 800;
            });
        } catch (error) {
            reason = (error as CommandAbort).reason;
        }
        expect(reason).toMatchObject({
            code: 'opening_no_fit',
            messageKey: 'engine.plan.command.opening_no_fit',
        });
    });

    it('aborts opening_overlap when clamping makes two openings collide', () => {
        const g = new Graph();
        const b = g.node(4000, 0);
        const w = g.wall(g.node(0, 0), b);
        g.opening(w, 1000, 900);
        g.opening(w, 3000, 900);
        // 2000 long: 550..1450 and 1100..2000 collide
        expect(
            g.abortOf((d) => {
                d.nodes[b]!.x = 2000;
                reclampOpenings(d, w, 'b', 4000);
            }),
        ).toMatchObject({
            code: 'opening_overlap',
            messageKey: 'engine.plan.command.opening_overlap',
        });
    });

    it('lets two openings that only touch stay', () => {
        const g = new Graph();
        const b = g.node(4000, 0);
        const w = g.wall(g.node(0, 0), b);
        g.opening(w, 450, 900); // 0..900
        const second = g.opening(w, 3000, 900);
        // 1800 long: the second is pulled to 1350 = 900..1800
        const { doc } = g.run((d) => {
            d.nodes[b]!.x = 1800;
            reclampOpenings(d, w, 'b', 4000);
        });
        expect(doc.openings[second]!.offset).toBe(1350);
    });

    it('writes only the offsets that change', () => {
        const g = new Graph();
        const w = g.wall(g.node(0, 0), g.node(4000, 0));
        g.opening(w, 2000, 900);
        const [, patches] = create(
            g.doc,
            (d) => {
                reclampOpenings(d as Doc, w, 'none', 4000);
            },
            { enablePatches: true },
        );
        expect(patches).toEqual([]);
    });

    it('keeps integer offsets for a diagonal wall of non-integer length', () => {
        const g = new Graph();
        const a = g.node(0, 0);
        const b = g.node(3000, 1000);
        const w = g.wall(a, b);
        const door = g.opening(w, 3000, 900);
        const { doc } = g.run((d) => {
            d.nodes[a]!.x = 500;
            reclampOpenings(
                d,
                w,
                'a',
                dist({ x: 0, y: 0 }, { x: 3000, y: 1000 }),
            );
        });
        expect(Number.isInteger(doc.openings[door]!.offset)).toBe(true);
    });
});

// ---- nextOpeningLabel --------------------------------------------------------------

describe('nextOpeningLabel', () => {
    const labelled = (...labels: Array<string | null>) => {
        const g = new Graph();
        const w = g.wall(g.node(0, 0), g.node(9000, 0));
        labels.forEach((label, i) => {
            g.opening(w, 500 + i * 1000, 800, { label });
        });
        return g;
    };

    it("is 'D3' after D1 and D2 and 'W1' with no window labels", () => {
        const g = labelled('D1', 'D2');
        expect(g.run((d) => nextOpeningLabel(d, 'door')).value).toBe('D3');
        expect(g.run((d) => nextOpeningLabel(d, 'window')).value).toBe('W1');
    });

    it('uses the largest number, not the count, and counts doors and windows separately', () => {
        const g = labelled('D1', 'D5', 'W2', null);
        expect(g.run((d) => nextOpeningLabel(d, 'door')).value).toBe('D6');
        expect(g.run((d) => nextOpeningLabel(d, 'window')).value).toBe('W3');
    });

    it("ignores labels that are not 'D' or 'W' followed by digits only", () => {
        const g = labelled('Dx', 'D', 'd9', 'D2x', 'XD9', 'D-4', 'D 7');
        expect(g.run((d) => nextOpeningLabel(d, 'door')).value).toBe('D1');
    });

    it('is not fooled by huge numbers', () => {
        const g = labelled('D99999999999999999999999', 'D2');
        expect(g.run((d) => nextOpeningLabel(d, 'door')).value).toBe('D3');
    });
});

// ---- through the pipeline and the bus ----------------------------------------------

describe('helpers in a command', () => {
    const addWall = definePlanCommand<
        { from: { x: number; y: number }; to: { x: number; y: number } },
        string[]
    >({
        type: 'test.addWall',
        labelKey: 'test.label.addWall',
        validate: () => null,
        run(draft, p, ctx, out) {
            const from = resolveEndpoint(draft, { point: p.from }, ctx, out);
            const to = resolveEndpoint(draft, { point: p.to }, ctx, out);
            const { wallIds } = insertWallSegment(
                draft,
                from,
                to,
                PROPS,
                ctx,
                out,
            );
            out.result = wallIds;
        },
        touchesGeometry: true,
    });

    function room() {
        const g = new Graph();
        const tl = g.node(0, 0);
        const tr = g.node(5000, 0);
        const br = g.node(5000, 4000);
        const bl = g.node(0, 4000);
        g.wall(tl, tr);
        g.wall(tr, br);
        g.wall(br, bl);
        g.wall(bl, tl);
        const bus = createPlanBus({
            initial: g.doc,
            footprints: () => null,
            newId: g.ids,
            registry: { addWall },
        });
        return { g, bus };
    }

    it('a wall drawn across a room splits both walls it meets; undo restores the document', () => {
        const { g, bus } = room();
        const start = bus.getDoc();
        // from the middle of the top wall to the middle of the bottom wall
        const r = bus.execute('addWall', {
            from: { x: 2500, y: 2 },
            to: { x: 2500, y: 3998 },
        });
        expect(r.ok).toBe(true);
        const doc = bus.getDoc();
        expect(Object.keys(doc.walls)).toHaveLength(7);
        expect(Object.keys(doc.nodes)).toHaveLength(6);
        expect(bus.undo()).toBe(true);
        expect(bus.getDoc()).toEqual(start);
        expect(bus.getDoc()).toEqual(g.doc);
    });

    it('drawing over an existing wall returns wall_duplicate and changes nothing', () => {
        const { bus } = room();
        const start = bus.getDoc();
        const r = bus.execute('addWall', {
            from: { x: 1, y: 1 },
            to: { x: 5001, y: -1 },
        });
        expect(r).toMatchObject({
            ok: false,
            error: {
                code: 'wall_duplicate',
                messageKey: 'engine.plan.command.wall_duplicate',
            },
        });
        expect(bus.getDoc()).toBe(start);
        expect(bus.canUndo()).toBe(false);
    });

    it('a longer wall overlapping half of an existing one creates only the uncovered part', () => {
        const { bus } = room();
        // top wall is 0..5000; draw 2500..7500 along it
        const r = bus.execute('addWall', {
            from: { x: 2500, y: 0 },
            to: { x: 7500, y: 0 },
        });
        expect(r.ok).toBe(true);
        const doc = bus.getDoc();
        const created = Object.values(doc.walls).filter(
            (w) => w.a !== undefined && doc.nodes[w.b]!.x === 7500,
        );
        expect(created).toHaveLength(1);
        expect(doc.nodes[created[0]!.a]).toMatchObject({ x: 5000, y: 0 });
    });
});

// ---- fix round 1 ---------------------------------------------------------------------

describe('tolerance boundaries (5 mm)', () => {
    it('reuses a node at exactly 5 mm and not at 5.001 mm', () => {
        const g = new Graph();
        const n = g.node(0, 0);
        const reuse = (x: number) =>
            g.run((d, c, o) => resolveEndpoint(d, { point: { x, y: 0 } }, c, o))
                .value;
        expect(reuse(5)).toBe(n);
        expect(reuse(5.001)).not.toBe(n);
        expect(reuse(-5)).toBe(n);
    });

    it('snaps to a wall at exactly 5 mm and not at 5.001 mm', () => {
        const { g, w } = oneWall();
        const snap = (y: number) =>
            g.run((d, c, o) =>
                resolveEndpoint(d, { point: { x: 2500, y } }, c, o),
            ).doc;
        expect(Object.keys(snap(5).walls)).toHaveLength(2);
        expect(snap(5).walls[w]!.b).not.toBe(g.doc.walls[w]!.b);
        expect(Object.keys(snap(5.001).walls)).toHaveLength(1);
        expect(Object.keys(snap(-5).walls)).toHaveLength(2);
    });

    it('treats a projection under 5 mm from the wall end as no wall snap, and refuses a split under 10 mm', () => {
        const { g } = oneWall();
        const at = (x: number) =>
            g.run((d, c, o) => resolveEndpoint(d, { point: { x, y: 4 } }, c, o))
                .doc;
        // x = 4.9: u < 5, a plain node and no split
        expect(Object.keys(at(4.9).walls)).toHaveLength(1);
        // u = 5 is inside the snap margin but would leave a stub: refused
        expect(
            g.abortOf((d, c, o) =>
                resolveEndpoint(d, { point: { x: 5, y: 4 } }, c, o),
            ).code,
        ).toBe('wall_too_short');
        expect(
            g.abortOf((d, c, o) =>
                resolveEndpoint(d, { point: { x: 4995, y: 4 } }, c, o),
            ).code,
        ).toBe('wall_too_short');
        // 4.001 mm beyond the node tolerance of the end, over 10 mm in
        expect(Object.keys(at(10.5).walls)).toHaveLength(2);
    });

    it('joins a node at exactly 5 mm from the segment interior and not at 5.001 mm', () => {
        const join = (offset: number) => {
            const g = new Graph();
            const from = g.node(0, 0);
            const to = g.node(4000, 0);
            const node = g.node(2000, offset);
            const { doc, value } = g.run((d, c, o) =>
                insertWallSegment(d, from, to, PROPS, c, o),
            );
            return {
                walls: value.wallIds.length,
                used: Object.values(doc.walls).some(
                    (w) => w.a === node || w.b === node,
                ),
            };
        };
        expect(join(5)).toEqual({ walls: 2, used: true });
        expect(join(-5)).toEqual({ walls: 2, used: true });
        expect(join(5.001)).toEqual({ walls: 1, used: false });
    });
});

describe('crossings are never left unsplit', () => {
    it('splits the crossed wall at a node within tolerance of the crossing, and S passes through it', () => {
        const g = new Graph();
        const w = g.wall(g.node(2000, -1000), g.node(2000, 1000));
        const q = g.node(2004, 0);
        g.wall(q, g.node(2004, 1500)); // V ends at Q
        const from = g.node(0, 0);
        const to = g.node(4000, 0);
        const { doc, value } = g.run((d, c, o) =>
            insertWallSegment(d, from, to, PROPS, c, o),
        );
        expect(value.wallIds.map((id) => endsOf(doc, id))).toEqual([
            '0,0>2004,0',
            '2004,0>4000,0',
        ]);
        expect(doc.walls[w]).toMatchObject({ b: q });
        const tail = wallsOf(doc).find((x) => x.a === q && x.b !== to)!;
        expect(Object.values(doc.nodes)).toHaveLength(6); // no new node
        expect(doc.walls[w]!.b).toBe(q);
        expect(tail).toBeDefined();
    });

    it("splits the crossed wall at S's end when the crossing is within 5 mm of it", () => {
        const g = new Graph();
        const w = g.wall(g.node(3996, -1000), g.node(3996, 1000));
        const from = g.node(0, 0);
        const to = g.node(4000, 0);
        const { doc, value } = g.run((d, c, o) =>
            insertWallSegment(d, from, to, PROPS, c, o),
        );
        expect(value.wallIds).toHaveLength(1);
        expect(doc.walls[w]!.b).toBe(to);
        expect(
            wallsOf(doc).filter((x) => x.a === to || x.b === to),
        ).toHaveLength(3);
    });

    it('aborts wall_too_short when the surviving node is not within 5 mm of the crossed wall', () => {
        const g = new Graph();
        g.wall(g.node(7, -1000), g.node(7, 1000));
        const from = g.node(0, 0);
        const to = g.node(4000, 0);
        expect(
            g.abortOf((d, c, o) => insertWallSegment(d, from, to, PROPS, c, o))
                .code,
        ).toBe('wall_too_short');
    });

    it('applies to splitIntersections: a crossing within 5 mm of the wall end splits the other wall at the end node', () => {
        const g = new Graph();
        const a = g.node(0, 0);
        const h = g.wall(a, g.node(4000, 0));
        const v = g.wall(g.node(4, -1000), g.node(4, 1000));
        const { doc } = g.run((d, c, o) => splitIntersections(d, h, c, o));
        expect(wallsOf(doc)).toHaveLength(3);
        expect(doc.walls[v]!.b).toBe(a);
        expect(endsOf(doc, h)).toBe('0,0>4000,0');
    });

    it('applies the 10 mm margin at the ends of splitIntersections: 10 mm is cut, 9 mm is refused', () => {
        const build = (x: number) => {
            const g = new Graph();
            const h = g.wall(g.node(0, 0), g.node(4000, 0));
            g.wall(g.node(x, -1000), g.node(x, 1000));
            return { g, h };
        };
        const ten = build(10);
        const { doc } = ten.g.run((d, c, o) =>
            splitIntersections(d, ten.h, c, o),
        );
        expect(wallsOf(doc)).toHaveLength(4);
        expect(endsOf(doc, ten.h)).toBe('0,0>10,0');
        const nine = build(9);
        expect(
            nine.g.abortOf((d, c, o) => splitIntersections(d, nine.h, c, o))
                .code,
        ).toBe('wall_too_short');
    });

    it('prefers an existing node over a wall split within reach (rank 1 beats rank 2)', () => {
        const g = new Graph();
        const h = g.wall(g.node(0, 0), g.node(4000, 0));
        g.wall(g.node(2000, -1000), g.node(2000, 1000));
        const q = g.node(1996, 3);
        const { doc } = g.run((d, c, o) => splitIntersections(d, h, c, o));
        // h is cut at Q, the vertical is split at Q as well; no node at 2000,0
        expect(doc.walls[h]!.b).toBe(q);
        expect(
            Object.values(doc.nodes).some((n) => n.x === 2000 && n.y === 0),
        ).toBe(false);
        expect(Object.keys(doc.nodes)).toHaveLength(5);
        expect(wallsOf(doc)).toHaveLength(4);
    });
});

describe('no short stubs', () => {
    it('drops a node 6 mm from `from`: one wall, `from` connected', () => {
        const g = new Graph();
        const from = g.node(0, 0);
        const to = g.node(4000, 0);
        g.node(6, 0);
        const { doc, value } = g.run((d, c, o) =>
            insertWallSegment(d, from, to, PROPS, c, o),
        );
        expect(value.wallIds.map((id) => endsOf(doc, id))).toEqual([
            '0,0>4000,0',
        ]);
    });

    it('keeps two nodes 6 mm apart from making a 6 mm gap or stub', () => {
        const g = new Graph();
        const from = g.node(0, 0);
        const to = g.node(4000, 0);
        g.node(2000, 0);
        g.node(2006, 0);
        const { doc, value } = g.run((d, c, o) =>
            insertWallSegment(d, from, to, PROPS, c, o),
        );
        expect(value.wallIds.map((id) => endsOf(doc, id))).toEqual([
            '0,0>2000,0',
            '2000,0>4000,0',
        ]);
        for (const w of Object.values(doc.walls)) {
            expect(
                dist(
                    { x: doc.nodes[w.a]!.x, y: doc.nodes[w.a]!.y },
                    { x: doc.nodes[w.b]!.x, y: doc.nodes[w.b]!.y },
                ),
            ).toBeGreaterThanOrEqual(10);
        }
    });

    it.each([6, 9, 10])(
        "routes S through the crossed wall's own node %s mm from the crossing",
        (gap) => {
            const g = new Graph();
            const x = g.node(2000, -gap);
            const w = g.wall(x, g.node(2000, 1000));
            const from = g.node(0, 0);
            const to = g.node(4000, 0);
            const { doc, value } = g.run((d, c, o) =>
                insertWallSegment(d, from, to, PROPS, c, o),
            );
            expect(value.wallIds).toHaveLength(2);
            expect(doc.walls[value.wallIds[0]!]).toMatchObject({
                a: from,
                b: x,
            });
            expect(doc.walls[value.wallIds[1]!]).toMatchObject({ a: x, b: to });
            expect(doc.walls[w]).toBe(g.doc.walls[w]); // not split
            expect(wallsOf(doc)).toHaveLength(3);
        },
    );

    it('splits the crossed wall normally 11 mm from its node', () => {
        const g = new Graph();
        const w = g.wall(g.node(2000, -11), g.node(2000, 1000));
        const from = g.node(0, 0);
        const to = g.node(4000, 0);
        const { doc } = g.run((d, c, o) =>
            insertWallSegment(d, from, to, PROPS, c, o),
        );
        expect(wallsOf(doc)).toHaveLength(4);
        expect(doc.walls[w]!.b).not.toBe(g.doc.walls[w]!.b);
    });
});

describe('segment already joined, and dangling walls', () => {
    it('skips a part whose two nodes a wall already joins', () => {
        const g = new Graph();
        const from = g.node(0, 0);
        const to = g.node(4000, 0);
        const mid = g.node(300, 4); // 0.76 degrees off S: not collinear
        const existing = g.wall(from, mid);
        const { doc, value } = g.run((d, c, o) =>
            insertWallSegment(d, from, to, PROPS, c, o),
        );
        expect(value.wallIds.map((id) => endsOf(doc, id))).toEqual([
            '300,4>4000,0',
        ]);
        expect(doc.walls[existing]).toBe(g.doc.walls[existing]);
    });

    it('ignores walls with a missing node when resolving a point, instead of aborting', () => {
        const { g } = oneWall();
        g.doc.walls.w_dangling01 = {
            ...PROPS,
            id: 'w_dangling01',
            a: 'n_missing001',
            b: 'n_missing002',
        };
        const { doc, value } = g.run((d, c, o) =>
            resolveEndpoint(d, { point: { x: 2500, y: 2 } }, c, o),
        );
        expect(doc.nodes[value]).toMatchObject({ x: 2500, y: 0 });
        expect(doc.walls.w_dangling01).toBe(g.doc.walls.w_dangling01);
    });
});

describe('splitWallAt guard', () => {
    it('refuses a point within 10 mm of either end, and one outside the wall', () => {
        const { g, w } = oneWall();
        for (const x of [0, 5, 10, 4990, 5000, 5010, -300]) {
            expect(
                g.abortOf((d, c, o) => splitWallAt(d, w, { x, y: 0 }, c, o))
                    .code,
            ).toBe('wall_too_short');
        }
        for (const x of [10.001, 4989.999]) {
            expect(() =>
                g.run((d, c, o) => splitWallAt(d, w, { x, y: 0 }, c, o)),
            ).not.toThrow();
        }
    });
});

describe('mergeNodeInto: pre-existing duplicates and re-attachment', () => {
    it('merges only duplicate groups that contain a moved wall', () => {
        const g = new Graph();
        const dst = g.node(0, 0);
        const z = g.node(3000, 0);
        const first = g.wall(dst, z);
        const second = g.wall(z, dst); // a duplicate that was already there
        const src = g.node(0, 500);
        const other = g.wall(src, g.node(0, 3000));
        const { doc } = g.run((d, c, o) => mergeNodeInto(d, src, dst, c, o));
        expect(first in doc.walls).toBe(true);
        expect(second in doc.walls).toBe(true);
        expect(doc.walls[other]!.a).toBe(dst);
    });

    it('re-attaches placements and dimensions of the deleted loser to the keeper, same side', () => {
        const g = new Graph();
        const a = g.node(0, 0);
        const b = g.node(5000, 0);
        const src = g.node(3000, 4000);
        const keeper = g.wall(a, b);
        const loser = g.wall(a, src);
        const p = g.placement(loser, 'right', 100, 100);
        const dim = g.dimension(loser); // face left
        const { doc, out } = g.run((d, c, o) => mergeNodeInto(d, src, b, c, o));
        expect(loser in doc.walls).toBe(false);
        expect(doc.placements[p]!.wallAttachment).toEqual({
            wallId: keeper,
            side: 'right',
        });
        expect(doc.annotations.dimensions[dim]!.attachedTo).toEqual({
            kind: 'wall',
            wallId: keeper,
            face: 'left',
        });
        expect(out.deletedIds).not.toContain(dim);
    });

    it('flips the side when the walls run in opposite directions', () => {
        const g = new Graph();
        const a = g.node(0, 0);
        const b = g.node(5000, 0);
        const src = g.node(3000, 4000);
        const keeper = g.wall(a, src);
        const loser = g.wall(b, a);
        const p = g.placement(loser, 'right', 100, 100);
        const dim = g.dimension(loser); // face left
        const { doc } = g.run((d, c, o) => mergeNodeInto(d, src, b, c, o));
        expect(Object.keys(doc.walls)).toEqual([keeper]);
        expect(doc.placements[p]!.wallAttachment).toEqual({
            wallId: keeper,
            side: 'left',
        });
        expect(doc.annotations.dimensions[dim]!.attachedTo!.face).toBe('right');
    });

    it('survives the pipeline: nothing is nulled or deleted by post-processing', () => {
        const g = new Graph();
        const a = g.node(0, 0);
        const b = g.node(5000, 0);
        const src = g.node(3000, 4000);
        g.wall(a, b);
        const loser = g.wall(a, src);
        const p = g.placement(loser, 'right', 100, 100);
        const dim = g.dimension(loser);
        const merge = definePlanCommand<{ src: string; dst: string }>({
            type: 'test.merge',
            labelKey: 'test.label.merge',
            validate: () => null,
            run(draft, params, ctx, out) {
                mergeNodeInto(draft, params.src, params.dst, ctx, out);
            },
            touchesGeometry: true,
        });
        const bus = createPlanBus({
            initial: g.doc,
            footprints: () => ({ width: 1000, depth: 500, height: 700 }),
            newId: g.ids,
            registry: { merge },
        });
        const r = bus.execute('merge', { src, dst: b });
        expect(r.ok).toBe(true);
        const doc = bus.getDoc();
        expect(doc.placements[p]!.wallAttachment).not.toBeNull();
        expect(doc.annotations.dimensions[dim]).toBeDefined();
    });
});

describe('reclampOpenings: pre-existing overlaps', () => {
    it('ignores a pair that overlapped before the edit and still aborts for a new one', () => {
        const g = new Graph();
        const b = g.node(4000, 0);
        const w = g.wall(g.node(0, 0), b);
        const x = g.opening(w, 1000, 900);
        const y = g.opening(w, 1300, 900); // overlaps x already
        const z = g.opening(w, 3500, 600);
        // shorten from b: z stays clear of the dirty pair
        const { doc } = g.run((d) => {
            d.nodes[b]!.x = 3900;
            reclampOpenings(d, w, 'b', 4000);
        });
        expect(doc.openings[x]!.offset).toBe(1000);
        expect(doc.openings[y]!.offset).toBe(1300);
        expect(doc.openings[z]!.offset).toBe(3500);
        // pulling z into the dirty pair is a new collision
        expect(
            g.abortOf((d) => {
                d.nodes[b]!.x = 2000;
                reclampOpenings(d, w, 'b', 4000);
            }).code,
        ).toBe('opening_overlap');
    });
});

describe('folded crossings', () => {
    it('splits every wall folded into a cut that a node then replaces', () => {
        const g = new Graph();
        const w1 = g.wall(g.node(2000, -1000), g.node(2000, 1000));
        const w2 = g.wall(g.node(2004, -1000), g.node(2004, 1000));
        const q = g.node(2005, 2);
        const from = g.node(0, 0);
        const to = g.node(4000, 0);
        const { doc, value } = g.run((d, c, o) =>
            insertWallSegment(d, from, to, PROPS, c, o),
        );
        expect(doc.walls[w1]!.b).toBe(q);
        expect(doc.walls[w2]!.b).toBe(q);
        expect(value.wallIds.map((id) => endsOf(doc, id))).toEqual([
            '0,0>2005,2',
            '2005,2>4000,0',
        ]);
        expect(wallsOf(doc)).toHaveLength(6);
    });

    it('never makes a wall under 10 mm when rounding moves a cut node closer to the end', () => {
        const g = new Graph();
        // crosses S (the diagonal) at 7.1875, 7.1875: 10.16 mm from `from`,
        // but the rounded node (7, 7) is only 9.9 mm away
        g.wall(g.node(-5, -31), g.node(100, 299));
        const from = g.node(0, 0);
        const to = g.node(4000, 4000);
        const { doc, value } = g.run((d, c, o) =>
            insertWallSegment(d, from, to, PROPS, c, o),
        );
        expect(value.wallIds.map((id) => endsOf(doc, id))).toEqual([
            '7,7>4000,4000',
        ]);
    });
});
