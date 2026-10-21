import { describe, expect, it } from 'vitest';
import type { ExecuteResult } from '../../../commands/types';
import { mulberry32 } from '../../../testing/random';
import { testIds } from '../../../testing/ids';
import type { IdPrefix } from '../../../ids';
import { derivePlanGeometry } from '../../derive';
import type {
    DimensionAnnotation,
    FurniturePlacement,
    Opening,
    PlanDocument,
    RoomMeta,
    Wall,
} from '../../schema';
import {
    emptyPlan,
    makeDirtyPlan,
    makeGridPlan,
    makeRectPlan,
} from '../../testing/fixtures';
import { planErrorKeys, validatePlan } from '../../validate';
import type { PlanCommandContext } from '../pipeline';
import { PLAN_COMMANDS, createPlanBus } from '../registry';
import { WALL_COMMANDS } from '../walls';

// ---- fixtures ----------------------------------------------------------------

type NewId = (prefix: IdPrefix) => string;

const FOOTPRINT = { width: 1000, depth: 500, height: 700 };

/** Builds a wall graph by hand; ids come from the factory the bus will use. */
class Graph {
    readonly ids: NewId = testIds();
    doc: PlanDocument = emptyPlan();

    node(x: number, y: number): string {
        const id = this.ids('n');
        this.doc.nodes[id] = { id, x, y };
        return id;
    }

    wall(a: string, b: string, over: Partial<Wall> = {}): string {
        const id = this.ids('w');
        this.doc.walls[id] = {
            id,
            a,
            b,
            thickness: 115,
            height: 2700,
            kind: 'interior',
            justification: 'center',
            material: 'brick',
            colorHex: null,
            ...over,
        };
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

    dimension(wallId: string, face: 'left' | 'right' | 'center'): string {
        const id = this.ids('d');
        const d: DimensionAnnotation = {
            id,
            a: { x: 0, y: 0 },
            b: { x: 1, y: 1 },
            offset: 300,
            attachedTo: { kind: 'wall', wallId, face },
        };
        this.doc.annotations.dimensions[id] = d;
        return id;
    }

    meta(name: string, x: number, y: number): string {
        const id = this.ids('r');
        const m: RoomMeta = {
            id,
            anchor: { x, y },
            name,
            type: 'other',
            floorFinish: 'tile',
            floorColorHex: null,
            labelOffset: null,
            showArea: true,
        };
        this.doc.rooms[id] = m;
        return id;
    }
}

function planBus(doc: PlanDocument, ids: NewId) {
    return createPlanBus({
        initial: doc,
        footprints: () => FOOTPRINT,
        newId: ids,
    });
}

function busOf(g: Graph) {
    return planBus(g.doc, g.ids);
}

/** The value of a successful execute. */
function ok<T>(r: ExecuteResult<T>): Extract<ExecuteResult<T>, { ok: true }> {
    if (!r.ok) throw new Error(`expected ok, got ${r.error.code}`);
    return r;
}

/** The error of a refused execute. */
function refused<T>(r: ExecuteResult<T>) {
    if (r.ok) throw new Error('expected an error');
    return r.error;
}

const pt = (x: number, y: number) => ({ point: { x, y } });

const wallList = (doc: PlanDocument): Wall[] =>
    Object.values(doc.walls).sort((p, q) => (p.id < q.id ? -1 : 1));

const nodeAt = (doc: PlanDocument, x: number, y: number): string | undefined =>
    Object.values(doc.nodes).find((n) => n.x === x && n.y === y)?.id;

const endsOf = (doc: PlanDocument, w: Wall): string => {
    const a = doc.nodes[w.a]!;
    const b = doc.nodes[w.b]!;
    return `${a.x},${a.y}>${b.x},${b.y}`;
};

/** A horizontal 5000 mm wall (0,0)-(5000,0) with distinguishable properties. */
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
    return { g, a, b, w, bus: busOf(g) };
}

/** A horizontal wall split at N (x = 2500) into two equal walls, plus a stem going down. */
function tJunction(stemOver: Partial<Wall> = {}) {
    const g = new Graph();
    const left = g.node(0, 0);
    const n = g.node(2500, 0);
    const right = g.node(5000, 0);
    const foot = g.node(2500, 3000);
    const w1 = g.wall(left, n);
    const w2 = g.wall(n, right);
    const stem = g.wall(n, foot, stemOver);
    return { g, left, n, right, foot, w1, w2, stem, bus: busOf(g) };
}

function expectUndoRestores(
    bus: ReturnType<typeof busOf>,
    start: PlanDocument,
): void {
    expect(bus.undo()).toBe(true);
    expect(bus.getDoc()).toEqual(start);
}

// ---- registry ----------------------------------------------------------------

describe('registry', () => {
    it('registers the seven wall commands with labels and schemas', () => {
        const names = [
            'addWall',
            'addWallChain',
            'splitWall',
            'mergeCollinearWalls',
            'deleteWalls',
            'deleteNode',
            'setWallProps',
        ] as const;
        for (const name of names) {
            const def = PLAN_COMMANDS[name];
            expect(def.type).toBe(name);
            expect(def.labelKey).toBe(
                `engine.plan.command.label.${name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)}`,
            );
            expect(def.paramsSchema).toBeDefined();
            expect(def.touchesGeometry).toBe(true);
        }
        expect(Object.keys(WALL_COMMANDS)).toEqual(names);
    });

    it('only setWallProps merges (replace, keyed by the sorted wall ids)', () => {
        for (const [name, def] of Object.entries(WALL_COMMANDS)) {
            if (name === 'setWallProps') continue;
            expect(def.mergeKey).toBeUndefined();
        }
        const def = WALL_COMMANDS.setWallProps;
        expect(def.mergeMode ?? 'replace').toBe('replace');
        const props = { thickness: 150 };
        expect(def.mergeKey?.({ wallIds: ['w_b', 'w_a'], props })).toBe(
            'wallProps:w_a,w_b',
        );
        expect(def.mergeKey?.({ wallIds: ['w_a', 'w_b', 'w_a'], props })).toBe(
            'wallProps:w_a,w_b',
        );
    });
});

// ---- addWall -------------------------------------------------------------------

describe('addWall', () => {
    it('drawn across a wall: 4 walls share one new node; one undo restores the wall (04 6.8)', () => {
        const g = new Graph();
        g.wall(g.node(0, 2000), g.node(4000, 2000));
        const bus = busOf(g);
        const start = bus.getDoc();
        const r = ok(
            bus.execute('addWall', { from: pt(2000, 0), to: pt(2000, 4000) }),
        );
        const doc = bus.getDoc();
        expect(Object.keys(doc.walls)).toHaveLength(4);
        expect(Object.keys(doc.nodes)).toHaveLength(5);
        const centre = nodeAt(doc, 2000, 2000)!;
        expect(centre).toBeDefined();
        const touching = wallList(doc).filter(
            (w) => w.a === centre || w.b === centre,
        );
        expect(touching).toHaveLength(4);
        expect(r.result.wallIds).toHaveLength(2);
        expect(r.result.startNodeId).toBe(nodeAt(doc, 2000, 0));
        expect(r.result.endNodeId).toBe(nodeAt(doc, 2000, 4000));
        expect(bus.history().undo).toHaveLength(1);
        expectUndoRestores(bus, start);
        expect(bus.getDoc()).toEqual(g.doc);
    });

    it('joins a node whose position is 3 mm off the end point', () => {
        const { g, b, bus } = oneWall();
        const start = bus.getDoc();
        const r = ok(
            bus.execute('addWall', { from: pt(5003, 0), to: pt(5000, 3000) }),
        );
        expect(r.result.startNodeId).toBe(b);
        const doc = bus.getDoc();
        expect(Object.keys(doc.nodes)).toHaveLength(3);
        expect(Object.keys(doc.walls)).toHaveLength(2);
        expect(doc.nodes[b]).toEqual(g.doc.nodes[b]);
        expectUndoRestores(bus, start);
    });

    it('makes a T node when the end is 3 mm from a centre line', () => {
        const { g, a, b, w, bus } = oneWall();
        const start = bus.getDoc();
        const r = ok(
            bus.execute('addWall', { from: pt(2000, 3), to: pt(2000, 2500) }),
        );
        const doc = bus.getDoc();
        const t = r.result.startNodeId;
        expect(doc.nodes[t]).toMatchObject({ x: 2000, y: 0 });
        expect(Object.keys(doc.walls)).toHaveLength(3);
        expect(doc.walls[w]).toMatchObject({ a, b: t });
        const tail = wallList(doc).find((x) => x.a === t && x.b === b)!;
        expect(tail).toMatchObject({ thickness: 230, colorHex: '#aabbcc' });
        expectUndoRestores(bus, start);
        expect(bus.getDoc()).toEqual(g.doc);
    });

    it('refuses a wall exactly over an existing one with wall_duplicate and leaves the document alone', () => {
        const { bus } = oneWall();
        const start = bus.getDoc();
        const error = refused(
            bus.execute('addWall', { from: pt(0, 0), to: pt(5000, 0) }),
        );
        expect(error).toMatchObject({
            code: 'wall_duplicate',
            messageKey: 'engine.plan.command.wall_duplicate',
        });
        expect(bus.getDoc()).toBe(start);
        expect(bus.canUndo()).toBe(false);
    });

    it('creates only the uncovered part when a longer wall overlaps half of one', () => {
        const g = new Graph();
        const a = g.node(0, 0);
        const m = g.node(2000, 0);
        const w = g.wall(a, m);
        const bus = busOf(g);
        const start = bus.getDoc();
        const r = ok(
            bus.execute('addWall', { from: pt(0, 0), to: pt(4000, 0) }),
        );
        const doc = bus.getDoc();
        expect(r.result.wallIds).toHaveLength(1);
        expect(r.result.startNodeId).toBe(a);
        expect(Object.keys(doc.walls)).toHaveLength(2);
        const added = doc.walls[r.result.wallIds[0]!]!;
        expect(added).toMatchObject({ a: m, b: r.result.endNodeId });
        expect(doc.walls[w]).toEqual(g.doc.walls[w]);
        expectUndoRestores(bus, start);
    });

    it('takes defaults: interior 115, exterior 230, height 2700, brick, no colour', () => {
        const { bus } = oneWall();
        const interior = ok(
            bus.execute('addWall', { from: pt(0, 1000), to: pt(1000, 1000) }),
        );
        const exterior = ok(
            bus.execute('addWall', {
                from: pt(0, 2000),
                to: pt(1000, 2000),
                kind: 'exterior',
            }),
        );
        const doc = bus.getDoc();
        expect(doc.walls[interior.result.wallIds[0]!]).toMatchObject({
            thickness: 115,
            height: 2700,
            kind: 'interior',
            justification: 'center',
            material: 'brick',
            colorHex: null,
        });
        expect(doc.walls[exterior.result.wallIds[0]!]).toMatchObject({
            thickness: 230,
            kind: 'exterior',
        });
    });

    it('takes the document default thickness and height, and explicit props', () => {
        const g = new Graph();
        g.doc.meta.defaultWallThickness = 140;
        g.doc.meta.defaultWallHeight = 2600;
        const bus = busOf(g);
        const a = ok(
            bus.execute('addWall', { from: pt(0, 0), to: pt(1000, 0) }),
        );
        const b = ok(
            bus.execute('addWall', {
                from: pt(0, 500),
                to: pt(1000, 500),
                thickness: 200.4,
                height: 3000,
                kind: 'half',
                material: 'glass',
            }),
        );
        const doc = bus.getDoc();
        expect(doc.walls[a.result.wallIds[0]!]).toMatchObject({
            thickness: 140,
            height: 2600,
        });
        expect(doc.walls[b.result.wallIds[0]!]).toMatchObject({
            thickness: 200,
            height: 3000,
            kind: 'half',
            material: 'glass',
        });
    });

    it('rounds free points to integer millimetres', () => {
        const g = new Graph();
        const bus = busOf(g);
        const r = ok(
            bus.execute('addWall', {
                from: pt(0.4, 0.6),
                to: pt(1000.5, -0.4),
            }),
        );
        const doc = bus.getDoc();
        expect(doc.nodes[r.result.startNodeId]).toMatchObject({ x: 0, y: 1 });
        expect(doc.nodes[r.result.endNodeId]).toMatchObject({ x: 1001, y: 0 });
        expect(Object.is(doc.nodes[r.result.endNodeId]!.y, -0)).toBe(false);
    });

    it('accepts node references', () => {
        const { a, b, bus } = (() => {
            const g = new Graph();
            const a = g.node(0, 0);
            const b = g.node(3000, 0);
            return { a, b, bus: busOf(g) };
        })();
        const r = ok(
            bus.execute('addWall', { from: { nodeId: a }, to: { nodeId: b } }),
        );
        expect(r.result).toMatchObject({ startNodeId: a, endNodeId: b });
    });

    it('checks ranges: out_of_range with field, min and max', () => {
        const { bus } = oneWall();
        const base = { from: pt(0, 1000), to: pt(1000, 1000) };
        const cases: Array<[Record<string, unknown>, string, number, number]> =
            [
                [{ thickness: 49 }, 'thickness', 50, 1000],
                [{ thickness: 1001 }, 'thickness', 50, 1000],
                [{ height: 299 }, 'height', 300, 10000],
                [{ height: 10001 }, 'height', 300, 10000],
                [{ to: pt(1_000_001, 0) }, 'to.point.x', -1_000_000, 1_000_000],
                [
                    { from: pt(0, -1_000_001) },
                    'from.point.y',
                    -1_000_000,
                    1_000_000,
                ],
            ];
        for (const [over, field, min, max] of cases) {
            const error = refused(
                bus.execute('addWall', { ...base, ...over } as never),
            );
            expect(error.code).toBe('out_of_range');
            expect(error.messageKey).toBe('engine.plan.command.out_of_range');
            expect(error.params).toEqual({ field, min, max });
        }
        // the bounds themselves are fine
        ok(bus.execute('addWall', { ...base, thickness: 50, height: 300 }));
        ok(
            bus.execute('addWall', {
                from: pt(0, 3000),
                to: pt(1000, 3000),
                thickness: 1000,
                height: 10000,
            }),
        );
    });

    it('refuses unknown nodes, zero-length walls and bad params', () => {
        const { a, bus } = oneWall();
        expect(
            refused(
                bus.execute('addWall', {
                    from: { nodeId: 'n_missing' },
                    to: pt(0, 1000),
                }),
            ),
        ).toMatchObject({ code: 'not_found', params: { id: 'n_missing' } });
        expect(
            refused(
                bus.execute('addWall', {
                    from: { nodeId: a },
                    to: { nodeId: a },
                }),
            ).code,
        ).toBe('wall_too_short');
        expect(
            refused(
                bus.execute('addWall', { from: pt(0, 100), to: pt(9, 100) }),
            ).code,
        ).toBe('wall_too_short');
        const bad = refused(
            bus.execute('addWall', {
                from: pt(0, 100),
                to: pt(900, 100),
                kind: 'castle',
            } as never),
        );
        expect(bad).toMatchObject({
            code: 'invalid_params',
            params: { command: 'addWall', field: 'kind' },
        });
        expect(
            refused(bus.execute('addWall', { from: pt(0, 0) } as never)).code,
        ).toBe('invalid_params');
    });

    it('refuses when the plan is full (too_large)', () => {
        const g = new Graph();
        const a = g.node(0, 0);
        const b = g.node(1000, 0);
        for (let i = 0; i < 2000; i += 1) g.wall(a, b);
        const error = WALL_COMMANDS.addWall.validate(
            g.doc,
            { from: { nodeId: a }, to: pt(0, 5000) },
            {} as PlanCommandContext,
        );
        expect(error).toMatchObject({
            code: 'too_large',
            params: { kind: 'walls', count: 2000, max: 2000 },
        });
    });
});

// ---- addWallChain --------------------------------------------------------------

describe('addWallChain', () => {
    const square = [pt(0, 0), pt(4000, 0), pt(4000, 3000), pt(0, 3000)];

    it('closed with 4 points creates a room (one new face); undo restores the document', () => {
        const g = new Graph();
        const bus = busOf(g);
        const start = bus.getDoc();
        const r = ok(
            bus.execute('addWallChain', { points: square, closed: true }),
        );
        const doc = bus.getDoc();
        expect(r.result.wallIds).toHaveLength(4);
        expect(r.result.nodeIds).toHaveLength(4);
        expect(Object.keys(doc.nodes)).toHaveLength(4);
        expect(derivePlanGeometry(start).rooms).toHaveLength(0);
        expect(derivePlanGeometry(doc).rooms).toHaveLength(1);
        expect(bus.history().undo).toHaveLength(1);
        expectUndoRestores(bus, start);
    });

    it('an open chain shares the nodes between consecutive walls', () => {
        const bus = busOf(new Graph());
        const r = ok(
            bus.execute('addWallChain', {
                points: square.slice(0, 3),
                closed: false,
            }),
        );
        const doc = bus.getDoc();
        expect(r.result.wallIds).toHaveLength(2);
        expect(r.result.nodeIds).toHaveLength(3);
        const [w1, w2] = r.result.wallIds.map((id) => doc.walls[id]!);
        expect(w1!.b).toBe(w2!.a);
        expect(w1!.a).toBe(r.result.nodeIds[0]);
        expect(w2!.b).toBe(r.result.nodeIds[2]);
    });

    it('needs at least 2 points, or 3 when closed (invalid_params)', () => {
        const bus = busOf(new Graph());
        const one = refused(
            bus.execute('addWallChain', {
                points: [pt(0, 0)],
                closed: false,
            }),
        );
        expect(one).toMatchObject({
            code: 'invalid_params',
            params: { command: 'addWallChain', field: 'points' },
        });
        const two = refused(
            bus.execute('addWallChain', {
                points: [pt(0, 0), pt(1000, 0)],
                closed: true,
            }),
        );
        expect(two).toMatchObject({
            code: 'invalid_params',
            params: { field: 'points' },
        });
        ok(
            bus.execute('addWallChain', {
                points: [pt(0, 0), pt(1000, 0)],
                closed: false,
            }),
        );
        ok(
            bus.execute('addWallChain', {
                points: [pt(0, 5000), pt(1000, 5000), pt(500, 6000)],
                closed: true,
            }),
        );
    });

    it('applies thickness, kind and defaults to every wall', () => {
        const bus = busOf(new Graph());
        const r = ok(
            bus.execute('addWallChain', {
                points: square,
                closed: true,
                kind: 'exterior',
            }),
        );
        for (const id of r.result.wallIds) {
            expect(bus.getDoc().walls[id]).toMatchObject({
                thickness: 230,
                kind: 'exterior',
                height: 2700,
            });
        }
    });

    it('a room drawn against an existing wall reuses it instead of failing', () => {
        const g = new Graph();
        const tl = g.node(0, 0);
        const tr = g.node(4000, 0);
        const br = g.node(4000, 3000);
        const bl = g.node(0, 3000);
        g.wall(tl, tr);
        g.wall(tr, br);
        g.wall(br, bl);
        g.wall(bl, tl);
        const bus = busOf(g);
        const start = bus.getDoc();
        // a second room to the right sharing the wall x = 4000
        const r = ok(
            bus.execute('addWallChain', {
                points: [
                    pt(4000, 0),
                    pt(8000, 0),
                    pt(8000, 3000),
                    pt(4000, 3000),
                ],
                closed: true,
            }),
        );
        expect(r.result.wallIds).toHaveLength(3);
        expect(r.result.nodeIds).toEqual([
            tr,
            nodeAt(bus.getDoc(), 8000, 0),
            nodeAt(bus.getDoc(), 8000, 3000),
            br,
        ]);
        expect(derivePlanGeometry(bus.getDoc()).rooms).toHaveLength(2);
        expectUndoRestores(bus, start);
    });

    it('is wall_duplicate when every segment is already there', () => {
        const g = new Graph();
        const a = g.node(0, 0);
        const b = g.node(4000, 0);
        const c = g.node(4000, 3000);
        g.wall(a, b);
        g.wall(b, c);
        const bus = busOf(g);
        const start = bus.getDoc();
        const error = refused(
            bus.execute('addWallChain', {
                points: [pt(0, 0), pt(4000, 0), pt(4000, 3000)],
                closed: false,
            }),
        );
        expect(error.code).toBe('wall_duplicate');
        expect(bus.getDoc()).toBe(start);
    });

    it('aborts on a repeated point, checks node ids and ranges', () => {
        const bus = busOf(new Graph());
        expect(
            refused(
                bus.execute('addWallChain', {
                    points: [pt(0, 0), pt(0, 0), pt(1000, 0)],
                    closed: false,
                }),
            ).code,
        ).toBe('wall_too_short');
        expect(
            refused(
                bus.execute('addWallChain', {
                    points: [pt(0, 0), { nodeId: 'n_nope' }],
                    closed: false,
                }),
            ),
        ).toMatchObject({ code: 'not_found', params: { id: 'n_nope' } });
        expect(
            refused(
                bus.execute('addWallChain', {
                    points: [pt(0, 0), pt(10, 0), pt(2_000_000, 0)],
                    closed: false,
                }),
            ).params,
        ).toEqual({
            field: 'points.2.point.x',
            min: -1_000_000,
            max: 1_000_000,
        });
        expect(
            refused(
                bus.execute('addWallChain', {
                    points: square,
                    closed: true,
                    thickness: 10,
                }),
            ).params,
        ).toEqual({ field: 'thickness', min: 50, max: 1000 });
    });

    it('refuses when the chain cannot fit in the plan (too_large)', () => {
        const g = new Graph();
        const a = g.node(0, 0);
        const b = g.node(1000, 0);
        for (let i = 0; i < 1998; i += 1) g.wall(a, b);
        const error = WALL_COMMANDS.addWallChain.validate(
            g.doc,
            { points: square, closed: true },
            {} as PlanCommandContext,
        );
        expect(error).toMatchObject({ code: 'too_large' });
    });
});

// ---- splitWall -------------------------------------------------------------------

describe('splitWall', () => {
    it('splits at the distance from a, copies props and moves openings beyond the cut', () => {
        const { g, a, b, w } = oneWall();
        const early = g.opening(w, 600, 900);
        const late = g.opening(w, 3500, 1200, {
            kind: 'window',
            type: 'casement',
        });
        const bus = busOf(g);
        const start = bus.getDoc();
        const r = ok(bus.execute('splitWall', { wallId: w, at: 2000 }));
        const doc = bus.getDoc();
        expect(doc.nodes[r.result.nodeId]).toEqual({
            id: r.result.nodeId,
            x: 2000,
            y: 0,
        });
        expect(doc.walls[w]).toMatchObject({ a, b: r.result.nodeId });
        expect(doc.walls[r.result.newWallId]).toMatchObject({
            a: r.result.nodeId,
            b,
            thickness: 230,
            kind: 'exterior',
            material: 'concrete',
            colorHex: '#aabbcc',
        });
        expect(doc.openings[early]).toMatchObject({ wallId: w, offset: 600 });
        expect(doc.openings[late]).toMatchObject({
            wallId: r.result.newWallId,
            offset: 1500,
        });
        expectUndoRestores(bus, start);
        expect(bus.getDoc()).toEqual(g.doc);
    });

    it('rejects at outside [10, length - 10] with out_of_range on field at', () => {
        const { w, bus } = oneWall();
        const start = bus.getDoc();
        for (const at of [5, 9, 4991, 4995, 0, -20, 6000]) {
            const error = refused(bus.execute('splitWall', { wallId: w, at }));
            expect(error.code).toBe('out_of_range');
            expect(error.params).toEqual({ field: 'at', min: 10, max: 4990 });
        }
        expect(bus.getDoc()).toBe(start);
    });

    it('accepts both ends of the range', () => {
        for (const at of [10, 4990]) {
            const { w, bus } = oneWall();
            const r = ok(bus.execute('splitWall', { wallId: w, at }));
            expect(bus.getDoc().nodes[r.result.nodeId]!.x).toBe(at);
        }
    });

    it('cannot split a 20 mm wall in two: the helper refuses the stub', () => {
        const g = new Graph();
        const w = g.wall(g.node(0, 0), g.node(20, 0));
        const bus = busOf(g);
        expect(
            refused(bus.execute('splitWall', { wallId: w, at: 10 })).code,
        ).toBe('wall_too_short');
    });

    it('rounds at to a whole millimetre first', () => {
        const { w, bus } = oneWall();
        const r = ok(bus.execute('splitWall', { wallId: w, at: 1999.6 }));
        expect(bus.getDoc().nodes[r.result.nodeId]!.x).toBe(2000);
    });

    it('works on a diagonal wall', () => {
        const g = new Graph();
        const w = g.wall(g.node(0, 0), g.node(3000, 4000));
        const bus = busOf(g);
        const r = ok(bus.execute('splitWall', { wallId: w, at: 2500 }));
        expect(bus.getDoc().nodes[r.result.nodeId]).toMatchObject({
            x: 1500,
            y: 2000,
        });
    });

    it('refuses a cut through an opening, an unknown wall and bad params', () => {
        const { g, w } = oneWall();
        g.opening(w, 2500, 900);
        const bus = busOf(g);
        expect(
            refused(bus.execute('splitWall', { wallId: w, at: 2500 })).code,
        ).toBe('split_through_opening');
        ok(bus.execute('splitWall', { wallId: w, at: 2050 }));
        expect(
            refused(bus.execute('splitWall', { wallId: 'w_missing', at: 100 })),
        ).toMatchObject({ code: 'not_found', params: { id: 'w_missing' } });
        expect(
            refused(bus.execute('splitWall', { wallId: w } as never)).code,
        ).toBe('invalid_params');
    });
});

// ---- mergeCollinearWalls ------------------------------------------------------------

describe('mergeCollinearWalls', () => {
    it('undoes a split exactly: openings, placements and dimensions come back', () => {
        const { g, w } = oneWall();
        g.opening(w, 1000, 900);
        g.opening(w, 3500, 1200, { kind: 'window', type: 'casement' });
        // against the left face (y = -115) so the post-process keeps them
        for (const x of [4000, 500]) {
            const id = g.placement(w, 'left', x, -115);
            g.doc.placements[id]!.rotation = 180;
        }
        const dim = g.dimension(w, 'left');
        // on the left face (y = -115) so the post-process keeps it
        g.doc.annotations.dimensions[dim]!.a = { x: 0, y: -115 };
        g.doc.annotations.dimensions[dim]!.b = { x: 5000, y: -115 };
        const bus = busOf(g);
        const before = bus.getDoc();
        const split = ok(bus.execute('splitWall', { wallId: w, at: 2000 }));
        const r = ok(
            bus.execute('mergeCollinearWalls', { nodeId: split.result.nodeId }),
        );
        expect(r.result).toEqual({
            keptWallId: w,
            removedWallId: split.result.newWallId,
        });
        const merged = bus.getDoc();
        expect(Object.keys(merged.nodes)).toHaveLength(2);
        expect(merged.openings).toEqual(before.openings);
        expect(merged.walls[w]).toEqual(before.walls[w]);
        expect(merged.placements).toEqual(before.placements);
        expect(merged.annotations).toEqual(before.annotations);
        expect(r.deletedIds).toEqual(
            expect.arrayContaining([
                split.result.newWallId,
                split.result.nodeId,
            ]),
        );
        expect(bus.undo()).toBe(true);
        expect(bus.getDoc().walls[split.result.newWallId]).toBeDefined();
        expect(bus.undo()).toBe(true);
        expect(bus.getDoc()).toEqual(before);
    });

    it('shifts the openings of K by len(R) when K.a was replaced and re-projects those of R', () => {
        const g = new Graph();
        const west = g.node(0, 0);
        const n = g.node(2000, 0);
        const east = g.node(5000, 0);
        const k = g.wall(n, east); // smaller id, its a end is the node
        const r = g.wall(west, n);
        const ok1 = g.opening(k, 500, 900);
        const ok2 = g.opening(r, 800, 900);
        const bus = busOf(g);
        const start = bus.getDoc();
        const res = ok(bus.execute('mergeCollinearWalls', { nodeId: n }));
        expect(res.result).toEqual({ keptWallId: k, removedWallId: r });
        const doc = bus.getDoc();
        expect(doc.walls[k]).toMatchObject({ a: west, b: east });
        expect(doc.walls[r]).toBeUndefined();
        expect(doc.nodes[n]).toBeUndefined();
        expect(doc.openings[ok1]).toMatchObject({ wallId: k, offset: 2500 });
        expect(doc.openings[ok2]).toMatchObject({
            wallId: k,
            offset: 800,
            hinge: 'start',
            swing: 'left',
        });
        expectUndoRestores(bus, start);
    });

    it('keeps K.a and replaces K.b: K openings do not move', () => {
        const g = new Graph();
        const west = g.node(0, 0);
        const n = g.node(2000, 0);
        const east = g.node(5000, 0);
        const k = g.wall(west, n);
        const r = g.wall(n, east);
        const ko = g.opening(k, 700, 900);
        const ro = g.opening(r, 1000, 900);
        const bus = busOf(g);
        ok(bus.execute('mergeCollinearWalls', { nodeId: n }));
        const doc = bus.getDoc();
        expect(doc.walls[k]).toMatchObject({ a: west, b: east });
        expect(doc.openings[ko]!.offset).toBe(700);
        expect(doc.openings[ro]).toMatchObject({ wallId: k, offset: 3000 });
    });

    it('flips hinge, swing and attached sides when R runs against K', () => {
        const g = new Graph();
        const west = g.node(0, 0);
        const n = g.node(2000, 0);
        const east = g.node(5000, 0);
        const k = g.wall(n, east);
        const r = g.wall(n, west); // runs from the node back to the west
        const ro = g.opening(r, 800, 900, { hinge: 'start', swing: 'left' });
        const p = g.placement(r, 'left', 1000, 60);
        const d = g.dimension(r, 'right');
        const bus = busOf(g);
        const start = bus.getDoc();
        ok(bus.execute('mergeCollinearWalls', { nodeId: n }));
        const doc = bus.getDoc();
        // 800 from the node towards the west: 1200 from the new a end
        expect(doc.openings[ro]).toMatchObject({
            wallId: k,
            offset: 1200,
            hinge: 'end',
            swing: 'right',
        });
        expect(doc.placements[p]!.wallAttachment).toEqual({
            wallId: k,
            side: 'right',
        });
        expect(doc.annotations.dimensions[d]!.attachedTo).toEqual({
            kind: 'wall',
            wallId: k,
            face: 'left',
        });
        expectUndoRestores(bus, start);
    });

    it('is not_collinear at a corner, a T junction, a free end and an unknown node', () => {
        const corner = new Graph();
        const c = corner.node(0, 0);
        corner.wall(c, corner.node(3000, 0));
        corner.wall(c, corner.node(0, 3000));
        const bus = busOf(corner);
        expect(
            refused(bus.execute('mergeCollinearWalls', { nodeId: c })),
        ).toMatchObject({
            code: 'not_collinear',
            messageKey: 'engine.plan.command.not_collinear',
        });

        const t = tJunction();
        expect(
            refused(t.bus.execute('mergeCollinearWalls', { nodeId: t.n })).code,
        ).toBe('not_collinear');
        expect(
            refused(t.bus.execute('mergeCollinearWalls', { nodeId: t.left }))
                .code,
        ).toBe('not_collinear');
        expect(
            refused(
                t.bus.execute('mergeCollinearWalls', { nodeId: 'n_nowhere' }),
            ),
        ).toMatchObject({ code: 'not_found', params: { id: 'n_nowhere' } });
    });

    it('allows the 0.5 degree tolerance and rejects a slightly bigger kink', () => {
        for (const [dy, code] of [
            [20, null],
            [60, 'not_collinear'],
        ] as const) {
            const g = new Graph();
            const n = g.node(2500, 0);
            g.wall(g.node(0, 0), n);
            g.wall(n, g.node(5000, dy));
            const bus = busOf(g);
            const r = bus.execute('mergeCollinearWalls', { nodeId: n });
            if (code === null) expect(r.ok).toBe(true);
            else expect(refused(r).code).toBe(code);
        }
    });

    it('is props_differ when thickness, height, kind, material or colour differ', () => {
        for (const over of [
            { thickness: 200 },
            { height: 2500 },
            { kind: 'exterior' },
            { material: 'concrete' },
            { colorHex: '#112233' },
        ] as const) {
            const g = new Graph();
            const n = g.node(2500, 0);
            g.wall(g.node(0, 0), n);
            g.wall(n, g.node(5000, 0), over);
            const bus = busOf(g);
            const error = refused(
                bus.execute('mergeCollinearWalls', { nodeId: n }),
            );
            expect(error.code).toBe('props_differ');
            expect(error.params).toMatchObject({
                nodeId: n,
                field: Object.keys(over)[0],
            });
        }
    });
});

// ---- deleteWalls ----------------------------------------------------------------------

describe('deleteWalls', () => {
    it('cascades openings and attached dimensions, and detaches placements', () => {
        const g = new Graph();
        const a = g.node(0, 0);
        const b = g.node(4000, 0);
        const c = g.node(4000, 3000);
        const w1 = g.wall(a, b);
        const w2 = g.wall(b, c);
        const o1 = g.opening(w1, 1000, 900);
        const o2 = g.opening(w1, 3000, 900);
        const o3 = g.opening(w2, 1500, 900);
        const d1 = g.dimension(w1, 'left');
        const d2 = g.dimension(w2, 'center');
        const p1 = g.placement(w1, 'left', 2000, 60);
        const p2 = g.placement(w2, 'right', 3940, 1500);
        const bus = busOf(g);
        const start = bus.getDoc();
        const r = ok(bus.execute('deleteWalls', { wallIds: [w1] }));
        const doc = bus.getDoc();
        expect(doc.walls[w1]).toBeUndefined();
        expect(doc.walls[w2]).toBeDefined();
        expect(doc.openings[o1]).toBeUndefined();
        expect(doc.openings[o2]).toBeUndefined();
        expect(doc.openings[o3]).toBeDefined();
        expect(doc.annotations.dimensions[d1]).toBeUndefined();
        expect(doc.annotations.dimensions[d2]).toBeDefined();
        expect(doc.placements[p1]).toMatchObject({
            x: 2000,
            y: 60,
            wallAttachment: null,
        });
        expect(doc.placements[p2]!.wallAttachment).toEqual({
            wallId: w2,
            side: 'right',
        });
        // the end node only w1 used is gone, the shared one stays
        expect(doc.nodes[a]).toBeUndefined();
        expect(doc.nodes[b]).toBeDefined();
        expect(new Set(r.result.deletedIds)).toEqual(
            new Set([w1, o1, o2, d1, a]),
        );
        expect(r.deletedIds).toEqual(r.result.deletedIds);
        expectUndoRestores(bus, start);
    });

    it('deleting the stem of a T merges the collinear pieces into one wall (04 6.8)', () => {
        const { g, left, n, right, foot, w1, w2, stem } = tJunction();
        const o1 = g.opening(w1, 1000, 900);
        const o2 = g.opening(w2, 1000, 900);
        const bus = busOf(g);
        const start = bus.getDoc();
        const r = ok(bus.execute('deleteWalls', { wallIds: [stem] }));
        const doc = bus.getDoc();
        expect(Object.keys(doc.walls)).toEqual([w1]);
        expect(doc.walls[w1]).toMatchObject({ a: left, b: right });
        expect(doc.nodes[n]).toBeUndefined();
        expect(doc.nodes[foot]).toBeUndefined();
        expect(doc.openings[o1]).toMatchObject({ wallId: w1, offset: 1000 });
        expect(doc.openings[o2]).toMatchObject({ wallId: w1, offset: 3500 });
        expect(new Set(r.result.deletedIds)).toEqual(
            new Set([stem, foot, w2, n]),
        );
        expect(bus.history().undo).toHaveLength(1);
        expectUndoRestores(bus, start);
    });

    it('keeps the pieces when their properties differ', () => {
        const g = new Graph();
        const left = g.node(0, 0);
        const n = g.node(2500, 0);
        const right = g.node(5000, 0);
        const foot = g.node(2500, 3000);
        const w1 = g.wall(left, n);
        const w2 = g.wall(n, right, { thickness: 230, kind: 'exterior' });
        const stem = g.wall(n, foot);
        const bus = busOf(g);
        const start = bus.getDoc();
        ok(bus.execute('deleteWalls', { wallIds: [stem] }));
        const doc = bus.getDoc();
        expect(Object.keys(doc.walls).sort()).toEqual([w1, w2]);
        expect(doc.nodes[n]).toBeDefined();
        expect(doc.nodes[foot]).toBeUndefined();
        expectUndoRestores(bus, start);
    });

    it('does not merge at a corner or at a node that still has three walls', () => {
        const t = tJunction();
        const bus = t.bus;
        const start = bus.getDoc();
        ok(bus.execute('deleteWalls', { wallIds: [t.w1] }));
        // N now has the stem and w2: a corner, not collinear
        expect(Object.keys(bus.getDoc().walls).sort()).toEqual([t.w2, t.stem]);
        expectUndoRestores(bus, start);
    });

    it('deletes several walls at once, every node that becomes free and the metas of lost rooms', () => {
        const rect = makeRectPlan(4000, 3000, 230);
        const ids = testIds();
        const bus = planBus(rect, ids);
        const walls = Object.keys(rect.walls);
        const r = ok(bus.execute('deleteWalls', { wallIds: walls }));
        expect(Object.keys(bus.getDoc().nodes)).toHaveLength(0);
        expect(Object.keys(bus.getDoc().walls)).toHaveLength(0);
        expect(r.result.deletedIds).toHaveLength(walls.length + 4);
    });

    it('refuses unknown walls and an empty list', () => {
        const { w, bus } = oneWall();
        expect(
            refused(bus.execute('deleteWalls', { wallIds: [w, 'w_nope'] })),
        ).toMatchObject({ code: 'not_found', params: { id: 'w_nope' } });
        expect(refused(bus.execute('deleteWalls', { wallIds: [] })).code).toBe(
            'invalid_params',
        );
        expect(bus.canUndo()).toBe(false);
    });

    it('handles duplicate ids in the list', () => {
        const { w, bus } = oneWall();
        ok(bus.execute('deleteWalls', { wallIds: [w, w] }));
        expect(Object.keys(bus.getDoc().walls)).toHaveLength(0);
    });
});

// ---- deleteNode ------------------------------------------------------------------------

describe('deleteNode', () => {
    it('deletes the node and every wall on it, with their openings', () => {
        const g = new Graph();
        const n = g.node(2000, 2000);
        const ends = [
            g.node(0, 2000),
            g.node(4000, 2000),
            g.node(2000, 0),
            g.node(2000, 4000),
        ];
        const walls = ends.map((e) => g.wall(n, e));
        const o = g.opening(walls[0]!, 1000, 900);
        const bus = busOf(g);
        const start = bus.getDoc();
        const r = ok(bus.execute('deleteNode', { nodeId: n }));
        const doc = bus.getDoc();
        expect(Object.keys(doc.walls)).toHaveLength(0);
        expect(Object.keys(doc.nodes)).toHaveLength(0);
        expect(doc.openings[o]).toBeUndefined();
        expect(new Set(r.result.deletedIds)).toEqual(
            new Set([n, ...ends, ...walls, o]),
        );
        expectUndoRestores(bus, start);
    });

    it('deletes both walls at a through node', () => {
        const t = tJunction();
        const start = t.bus.getDoc();
        ok(t.bus.execute('deleteNode', { nodeId: t.n }));
        const doc = t.bus.getDoc();
        expect(Object.keys(doc.walls)).toHaveLength(0);
        expectUndoRestores(t.bus, start);
    });

    it('merges what a removed branch leaves straight', () => {
        const t = tJunction();
        const start = t.bus.getDoc();
        ok(t.bus.execute('deleteNode', { nodeId: t.foot }));
        const doc = t.bus.getDoc();
        expect(Object.keys(doc.walls)).toEqual([t.w1]);
        expect(doc.walls[t.w1]).toMatchObject({ a: t.left, b: t.right });
        expectUndoRestores(t.bus, start);
    });

    it('deletes a lone node and rejects an unknown one', () => {
        const g = new Graph();
        const lone = g.node(100, 100);
        g.wall(g.node(0, 0), g.node(1000, 0));
        const bus = busOf(g);
        const start = bus.getDoc();
        const r = ok(bus.execute('deleteNode', { nodeId: lone }));
        expect(r.result.deletedIds).toEqual([lone]);
        expect(bus.getDoc().nodes[lone]).toBeUndefined();
        expect(Object.keys(bus.getDoc().walls)).toHaveLength(1);
        expectUndoRestores(bus, start);
        expect(
            refused(bus.execute('deleteNode', { nodeId: 'n_nope' })),
        ).toMatchObject({ code: 'not_found', params: { id: 'n_nope' } });
    });
});

// ---- setWallProps -----------------------------------------------------------------------

describe('setWallProps', () => {
    it('sets thickness, height, kind, material and colour on all given walls', () => {
        const t = tJunction();
        const start = t.bus.getDoc();
        ok(
            t.bus.execute('setWallProps', {
                wallIds: [t.w1, t.stem],
                props: {
                    thickness: 150,
                    height: 2900,
                    kind: 'partition',
                    material: 'drywall',
                    colorHex: '#123abc',
                },
            }),
        );
        const doc = t.bus.getDoc();
        for (const id of [t.w1, t.stem]) {
            expect(doc.walls[id]).toMatchObject({
                thickness: 150,
                height: 2900,
                kind: 'partition',
                material: 'drywall',
                colorHex: '#123abc',
            });
        }
        expect(doc.walls[t.w2]).toEqual(start.walls[t.w2]);
        expectUndoRestores(t.bus, start);
    });

    it("lower-cases '#AABBCC', accepts null and rejects 'red'", () => {
        const { w, bus } = oneWall();
        ok(
            bus.execute('setWallProps', {
                wallIds: [w],
                props: { colorHex: '#AABBCC' },
            }),
        );
        expect(bus.getDoc().walls[w]!.colorHex).toBe('#aabbcc');
        ok(
            bus.execute('setWallProps', {
                wallIds: [w],
                props: { colorHex: '#FF00aa' },
            }),
        );
        expect(bus.getDoc().walls[w]!.colorHex).toBe('#ff00aa');
        ok(
            bus.execute('setWallProps', {
                wallIds: [w],
                props: { colorHex: null },
            }),
        );
        expect(bus.getDoc().walls[w]!.colorHex).toBeNull();
        for (const bad of ['red', '#abc', '#12345g', 'aabbcc', '#aabbccdd']) {
            const error = refused(
                bus.execute('setWallProps', {
                    wallIds: [w],
                    props: { colorHex: bad },
                }),
            );
            expect(error).toMatchObject({
                code: 'invalid_params',
                params: { command: 'setWallProps', field: 'props.colorHex' },
            });
        }
    });

    it('checks ranges with out_of_range', () => {
        const { w, bus } = oneWall();
        const cases: Array<[Record<string, number>, string, number, number]> = [
            [{ thickness: 49 }, 'props.thickness', 50, 1000],
            [{ thickness: 1001 }, 'props.thickness', 50, 1000],
            [{ height: 299 }, 'props.height', 300, 10000],
            [{ height: 10001 }, 'props.height', 300, 10000],
        ];
        for (const [props, field, min, max] of cases) {
            const error = refused(
                bus.execute('setWallProps', { wallIds: [w], props }),
            );
            expect(error.code).toBe('out_of_range');
            expect(error.params).toEqual({ field, min, max });
        }
        ok(
            bus.execute('setWallProps', {
                wallIds: [w],
                props: { thickness: 50, height: 300 },
            }),
        );
    });

    it('rejects a height below an opening (opening_too_tall), counting the sill', () => {
        const { g, w } = oneWall();
        g.opening(w, 1000, 900); // door, top at 2100
        g.opening(w, 3000, 1200, {
            kind: 'window',
            type: 'casement',
            sillHeight: 900,
            height: 1200,
        }); // top at 2100
        const bus = busOf(g);
        const error = refused(
            bus.execute('setWallProps', {
                wallIds: [w],
                props: { height: 2099 },
            }),
        );
        expect(error.code).toBe('opening_too_tall');
        expect(error.params).toMatchObject({ wallId: w });
        expect(error.params.openingId).toBeDefined();
        ok(
            bus.execute('setWallProps', {
                wallIds: [w],
                props: { height: 2100 },
            }),
        );
        expect(bus.getDoc().walls[w]!.height).toBe(2100);
        // other properties are not blocked by it
        ok(
            bus.execute('setWallProps', {
                wallIds: [w],
                props: { thickness: 200 },
            }),
        );
    });

    it('does not let a pre-existing too-tall opening block a change that does not lower the wall', () => {
        const g = new Graph();
        const w = g.wall(g.node(0, 0), g.node(4000, 0), { height: 2000 });
        g.opening(w, 2000, 900); // 2100 in a 2000 wall: already invalid
        const bus = busOf(g);
        ok(
            bus.execute('setWallProps', {
                wallIds: [w],
                props: { height: 2050 },
            }),
        );
        expect(
            refused(
                bus.execute('setWallProps', {
                    wallIds: [w],
                    props: { height: 1900 },
                }),
            ).code,
        ).toBe('opening_too_tall');
    });

    it('thickness change moves an attached placement with the face', () => {
        const g = new Graph();
        const w = g.wall(g.node(0, 0), g.node(5000, 0), { thickness: 100 });
        const face = (doc: PlanDocument) =>
            derivePlanGeometry(doc).walls[w]!.leftFace[0].y;
        const p = g.placement(w, 'left', 2500, face(g.doc));
        const bus = busOf(g);
        const start = bus.getDoc();
        const y0 = start.placements[p]!.y;
        ok(
            bus.execute('setWallProps', {
                wallIds: [w],
                props: { thickness: 300 },
            }),
        );
        const doc = bus.getDoc();
        expect(doc.placements[p]!.y).toBe(face(doc));
        expect(Math.abs(doc.placements[p]!.y - y0)).toBe(100);
        expect(doc.placements[p]!.x).toBe(2500);
        expect(doc.placements[p]!.wallAttachment).toEqual({
            wallId: w,
            side: 'left',
        });
        // same history entry
        expect(bus.history().undo).toHaveLength(1);
        expectUndoRestores(bus, start);
    });

    it('recomputes the points of an attached dimension', () => {
        const g = new Graph();
        const w = g.wall(g.node(0, 0), g.node(5000, 0), { thickness: 100 });
        const d = g.dimension(w, 'left');
        const bus = busOf(g);
        const start = bus.getDoc();
        ok(
            bus.execute('setWallProps', {
                wallIds: [w],
                props: { thickness: 300 },
            }),
        );
        const geom = derivePlanGeometry(bus.getDoc());
        const dim = bus.getDoc().annotations.dimensions[d]!;
        expect(dim.a).toEqual({
            x: geom.walls[w]!.leftFace[0].x,
            y: geom.walls[w]!.leftFace[0].y,
        });
        expectUndoRestores(bus, start);
    });

    it('merges a drag of values into one history entry', () => {
        const { w, bus } = oneWall();
        const start = bus.getDoc();
        for (const thickness of [150, 160, 170, 180]) {
            ok(
                bus.execute(
                    'setWallProps',
                    { wallIds: [w], props: { thickness } },
                    { merge: true },
                ),
            );
        }
        expect(bus.history().undo).toHaveLength(1);
        expect(bus.getDoc().walls[w]!.thickness).toBe(180);
        expectUndoRestores(bus, start);
    });

    it('refuses unknown walls and empty id lists', () => {
        const { w, bus } = oneWall();
        expect(
            refused(
                bus.execute('setWallProps', {
                    wallIds: ['w_no'],
                    props: { thickness: 100 },
                }),
            ),
        ).toMatchObject({ code: 'not_found', params: { id: 'w_no' } });
        expect(
            refused(
                bus.execute('setWallProps', {
                    wallIds: [],
                    props: { thickness: 100 },
                }),
            ).code,
        ).toBe('invalid_params');
        expect(
            refused(
                bus.execute('setWallProps', {
                    wallIds: [w],
                    props: { kind: 'moat' as never },
                }),
            ).code,
        ).toBe('invalid_params');
    });
});

// ---- re-association (04 4.9) ---------------------------------------------------------------

describe('room meta re-association in the command entry', () => {
    /** A 6000 x 4000 room split by a wall at x = 4000 into a larger left and smaller right room. */
    function twoRooms() {
        const ids = testIds();
        const setup = planBus(makeRectPlan(6000, 4000, 230, ids), ids);
        const split = ok(
            setup.execute('addWall', { from: pt(4000, 0), to: pt(4000, 4000) }),
        );
        const doc = structuredClone(setup.getDoc());
        const left = metaIn(ids, doc, 2000, 2000, 'Living');
        const right = metaIn(ids, doc, 5000, 2000, 'Study');
        return {
            bus: planBus(doc, ids),
            wall: split.result.wallIds[0]!,
            left,
            right,
        };
    }

    function metaIn(
        ids: NewId,
        doc: PlanDocument,
        x: number,
        y: number,
        name: string,
    ): string {
        const id = ids('r');
        doc.rooms[id] = {
            id,
            anchor: { x, y },
            name,
            type: 'other',
            floorFinish: 'tile',
            floorColorHex: null,
            labelOffset: null,
            showArea: true,
        };
        return id;
    }

    it('deleting the wall between two named rooms keeps the larger room, deletes the other meta, one entry', () => {
        const { bus, wall, left, right } = twoRooms();
        const start = bus.getDoc();
        expect(derivePlanGeometry(start).rooms).toHaveLength(2);
        const r = ok(bus.execute('deleteWalls', { wallIds: [wall] }));
        const doc = bus.getDoc();
        expect(Object.keys(doc.rooms)).toEqual([left]);
        expect(doc.rooms[left]!.name).toBe('Living');
        expect(r.deletedIds).toContain(right);
        const rooms = derivePlanGeometry(doc).rooms;
        expect(rooms).toHaveLength(1);
        expect(rooms[0]!.metaId).toBe(left);
        // one entry: a single undo brings the wall and both metas back
        expect(bus.history().undo).toHaveLength(1);
        expect(bus.undo()).toBe(true);
        expect(bus.getDoc()).toEqual(start);
        expect(Object.keys(bus.getDoc().rooms).sort()).toEqual(
            [left, right].sort(),
        );
        expect(bus.canUndo()).toBe(false);
        // and redo applies both again
        expect(bus.redo()).toBe(true);
        expect(Object.keys(bus.getDoc().rooms)).toEqual([left]);
    });

    it('a command that opens both rooms leaves their metas orphaned; one undo restores the document', () => {
        const { bus, wall, left, right } = twoRooms();
        const start = bus.getDoc();
        // the node where the divider meets the top wall takes the top wall's halves with it
        const node = bus.getDoc().walls[wall]!.a;
        ok(bus.execute('deleteNode', { nodeId: node }));
        expect(bus.history().undo).toHaveLength(1);
        expect(derivePlanGeometry(bus.getDoc()).rooms).toHaveLength(0);
        expect(Object.keys(bus.getDoc().rooms).sort()).toEqual(
            [left, right].sort(),
        );
        expectUndoRestores(bus, start);
    });

    it('a wall that splits a named room keeps the meta in the anchor part', () => {
        const ids = testIds();
        const doc = makeRectPlan(6000, 4000, 230, ids);
        const meta = metaIn(ids, doc, 1500, 2000, 'Hall');
        const bus = planBus(doc, ids);
        const start = bus.getDoc();
        ok(bus.execute('addWall', { from: pt(3000, 0), to: pt(3000, 4000) }));
        const after = bus.getDoc();
        expect(after.rooms[meta]).toEqual(start.rooms[meta]);
        const rooms = derivePlanGeometry(after).rooms;
        expect(rooms).toHaveLength(2);
        const owner = rooms.find((r) => r.metaId === meta)!;
        expect(owner.labelPoint.x).toBeLessThan(3000);
        expect(rooms.filter((r) => r.metaId !== null)).toHaveLength(1);
        expectUndoRestores(bus, start);
    });

    it('moves the meta to the part with the anchor when the wall passes over it', () => {
        const ids = testIds();
        const doc = makeRectPlan(6000, 4000, 230, ids);
        const meta = metaIn(ids, doc, 4500, 2000, 'Den');
        const bus = planBus(doc, ids);
        const start = bus.getDoc();
        ok(bus.execute('addWall', { from: pt(3000, 0), to: pt(3000, 4000) }));
        const rooms = derivePlanGeometry(bus.getDoc()).rooms;
        const owner = rooms.find((r) => r.metaId === meta)!;
        expect(owner.labelPoint.x).toBeGreaterThan(3000);
        expectUndoRestores(bus, start);
    });
});

// ---- dirty plans -------------------------------------------------------------------------------

describe('commands on a dirty plan', () => {
    function dirty() {
        const ids = testIds();
        const doc = makeDirtyPlan(ids);
        return { doc, bus: planBus(doc, ids) };
    }

    const errorsOf = (doc: PlanDocument) => planErrorKeys(validatePlan(doc));

    function expectNoNewErrors(before: PlanDocument, after: PlanDocument) {
        const was = errorsOf(before);
        for (const key of errorsOf(after)) expect(was.has(key)).toBe(true);
    }

    it('addWall and addWallChain draw in free space', () => {
        const { doc, bus } = dirty();
        expect(errorsOf(doc).size).toBeGreaterThan(0);
        const orphan = nodeAt(doc, 6500, 500)!;
        ok(
            bus.execute('addWall', {
                from: { nodeId: orphan },
                to: pt(6500, 3500),
            }),
        );
        ok(
            bus.execute('addWallChain', {
                points: [
                    pt(7000, 0),
                    pt(9000, 0),
                    pt(9000, 2000),
                    pt(7000, 2000),
                ],
                closed: true,
            }),
        );
        expectNoNewErrors(doc, bus.getDoc());
        expect(bus.undo() && bus.undo()).toBe(true);
        expect(bus.getDoc()).toEqual(doc);
    });

    it('addWall can join the dirty parts of the plan', () => {
        const { doc, bus } = dirty();
        ok(bus.execute('addWall', { from: pt(500, 500), to: pt(500, 3500) }));
        expectNoNewErrors(doc, bus.getDoc());
        expectUndoRestores(bus, doc);
    });

    it('splitWall and mergeCollinearWalls', () => {
        const { doc, bus } = dirty();
        // the left wall of the rectangle is clean
        const left = wallList(doc).find(
            (w) => endsOf(doc, w) === '0,4000>0,0',
        )!;
        const split = ok(
            bus.execute('splitWall', { wallId: left.id, at: 1500 }),
        );
        expectNoNewErrors(doc, bus.getDoc());
        ok(bus.execute('mergeCollinearWalls', { nodeId: split.result.nodeId }));
        expectNoNewErrors(doc, bus.getDoc());
        expect(bus.undo() && bus.undo()).toBe(true);
        expect(bus.getDoc()).toEqual(doc);
    });

    it('deleteWalls, deleteNode (orphan and coincident nodes)', () => {
        const { doc, bus } = dirty();
        const crossing = wallList(doc).find(
            (w) => endsOf(doc, w) === '1000,1000>4000,3000',
        )!;
        ok(bus.execute('deleteWalls', { wallIds: [crossing.id] }));
        ok(bus.execute('deleteNode', { nodeId: nodeAt(doc, 6500, 500)! }));
        const coincident = Object.values(doc.nodes).filter(
            (n) => n.x === 4400 && n.y === 3500,
        );
        expect(coincident).toHaveLength(2);
        ok(bus.execute('deleteNode', { nodeId: coincident[0]!.id }));
        expectNoNewErrors(doc, bus.getDoc());
        expect(bus.undo() && bus.undo() && bus.undo()).toBe(true);
        expect(bus.getDoc()).toEqual(doc);
    });

    it('setWallProps', () => {
        const { doc, bus } = dirty();
        const all = Object.keys(doc.walls);
        ok(
            bus.execute('setWallProps', {
                wallIds: all,
                props: { height: 3000, colorHex: '#FFEEDD' },
            }),
        );
        ok(
            bus.execute('setWallProps', {
                wallIds: [all[0]!],
                props: { thickness: 200 },
            }),
        );
        expectNoNewErrors(doc, bus.getDoc());
        expect(bus.undo() && bus.undo()).toBe(true);
        expect(bus.getDoc()).toEqual(doc);
    });
});

// ---- determinism ----------------------------------------------------------------------------------

describe('determinism', () => {
    type Scenario = (
        bus: ReturnType<typeof busOf>,
        doc: PlanDocument,
    ) => unknown;

    const scenarios: Record<string, Scenario> = {
        addWall: (bus) =>
            bus.execute('addWall', { from: pt(2000, 0), to: pt(2000, 4000) }),
        addWallChain: (bus) =>
            bus.execute('addWallChain', {
                points: [pt(1000, -500), pt(1000, 4500), pt(2500, 4500)],
                closed: false,
            }),
        splitWall: (bus, doc) =>
            bus.execute('splitWall', {
                wallId: Object.keys(doc.walls)[0]!,
                at: 1234,
            }),
        mergeCollinearWalls: (bus) => {
            const s = ok(
                bus.execute('splitWall', {
                    wallId: Object.keys(bus.getDoc().walls)[0]!,
                    at: 1234,
                }),
            );
            return bus.execute('mergeCollinearWalls', {
                nodeId: s.result.nodeId,
            });
        },
        deleteWalls: (bus, doc) =>
            bus.execute('deleteWalls', {
                wallIds: Object.keys(doc.walls).slice(0, 2),
            }),
        deleteNode: (bus, doc) =>
            bus.execute('deleteNode', { nodeId: Object.keys(doc.nodes)[1]! }),
        setWallProps: (bus, doc) =>
            bus.execute('setWallProps', {
                wallIds: Object.keys(doc.walls).slice(0, 3),
                props: { thickness: 160, colorHex: '#ABCDEF' },
            }),
    };

    for (const [name, scenario] of Object.entries(scenarios)) {
        it(`${name} gives byte-identical output for the same doc and ids`, () => {
            const run = () => {
                const ids = testIds();
                const doc = makeGridPlan(3, 3, 3000, ids);
                const bus = planBus(doc, ids);
                const result = scenario(bus, doc);
                return JSON.stringify({
                    result,
                    doc: bus.getDoc(),
                    entries: bus
                        .history()
                        .undo.map((e) => [e.patches, e.inversePatches]),
                });
            };
            const first = run();
            expect(first).toContain('"ok":true');
            expect(run()).toBe(first);
        });
    }
});

// ---- random sequences ---------------------------------------------------------------------------------

/** 200 commands with a full validation each take a few seconds. */
const SIM_TIMEOUT = 60_000;

describe('random wall command sequences', () => {
    const TYPES = [
        'addWall',
        'addWallChain',
        'splitWall',
        'mergeCollinearWalls',
        'deleteWalls',
        'deleteNode',
        'setWallProps',
    ] as const;

    function simulate(seed: number) {
        const rand = mulberry32(seed);
        const int = (n: number) => Math.floor(rand() * n);
        const pick = <T>(items: T[]): T => items[int(items.length)]!;
        const ids = testIds();
        const start = makeGridPlan(3, 3, 3000, ids);
        const bus = planBus(start, ids);
        const docs: PlanDocument[] = [start];
        const okByType = new Map<string, number>();
        const coord = (): number =>
            rand() < 0.6 ? pick([0, 3000, 6000, 9000]) + int(7) - 3 : int(9001);
        const ref = (doc: PlanDocument) =>
            rand() < 0.4
                ? { nodeId: pick(Object.keys(doc.nodes).sort()) }
                : pt(coord(), coord());

        for (let step = 0; step < 200; step += 1) {
            const doc = bus.getDoc();
            const wallIds = Object.keys(doc.walls).sort();
            const nodeIds = Object.keys(doc.nodes).sort();
            const type = pick([...TYPES]);
            let r: ExecuteResult<unknown>;
            if (wallIds.length === 0 || nodeIds.length === 0) {
                r = bus.execute('addWall', { from: pt(0, 0), to: pt(3000, 0) });
            } else if (type === 'addWall') {
                r = bus.execute('addWall', {
                    from: ref(doc),
                    to: ref(doc),
                    ...(rand() < 0.3 ? { kind: 'exterior' as const } : {}),
                });
            } else if (type === 'addWallChain') {
                const points = Array.from({ length: 2 + int(3) }, () =>
                    ref(doc),
                );
                r = bus.execute('addWallChain', {
                    points,
                    closed: points.length >= 3 && rand() < 0.5,
                });
            } else if (type === 'splitWall') {
                const wallId = pick(wallIds);
                const wall = doc.walls[wallId]!;
                const length = Math.hypot(
                    doc.nodes[wall.b]!.x - doc.nodes[wall.a]!.x,
                    doc.nodes[wall.b]!.y - doc.nodes[wall.a]!.y,
                );
                r = bus.execute('splitWall', {
                    wallId,
                    at: 5 + int(Math.max(1, Math.round(length))),
                });
            } else if (type === 'mergeCollinearWalls') {
                // most picks are nodes with two walls, the only ones that can merge
                const degree = new Map<string, number>();
                for (const w of Object.values(doc.walls)) {
                    degree.set(w.a, (degree.get(w.a) ?? 0) + 1);
                    degree.set(w.b, (degree.get(w.b) ?? 0) + 1);
                }
                const through = nodeIds.filter((id) => degree.get(id) === 2);
                r = bus.execute('mergeCollinearWalls', {
                    nodeId:
                        through.length > 0 && rand() < 0.8
                            ? pick(through)
                            : pick(nodeIds),
                });
            } else if (type === 'deleteWalls') {
                r = bus.execute('deleteWalls', {
                    wallIds: [pick(wallIds), pick(wallIds)],
                });
            } else if (type === 'deleteNode') {
                r = bus.execute('deleteNode', { nodeId: pick(nodeIds) });
            } else {
                r = bus.execute('setWallProps', {
                    wallIds: [pick(wallIds)],
                    props: pick([
                        { thickness: 100 + int(200) },
                        { height: 2000 + int(1500) },
                        { colorHex: '#A1B2C3' },
                        {
                            kind: 'partition' as const,
                            material: 'drywall' as const,
                        },
                    ]),
                });
            }
            if (!r.ok) {
                expect(bus.getDoc()).toBe(doc);
                continue;
            }
            const next = bus.getDoc();
            // a command never adds a validation error
            const before = planErrorKeys(validatePlan(doc));
            for (const key of planErrorKeys(validatePlan(next))) {
                expect(before.has(key)).toBe(true);
            }
            if (next !== doc) {
                docs.push(next);
                okByType.set(type, (okByType.get(type) ?? 0) + 1);
            }
        }
        return { bus, docs, okByType };
    }

    it(
        '200 random commands, then undo everything: every step restores the previous document',
        () => {
            const { bus, docs, okByType } = simulate(20261020);
            // the generator really reaches the commands
            expect(docs.length).toBeGreaterThan(60);
            for (const type of TYPES) {
                expect(okByType.get(type) ?? 0).toBeGreaterThan(0);
            }
            expect(bus.history().undo.length).toBe(docs.length - 1);
            for (let i = docs.length - 2; i >= 0; i -= 1) {
                expect(bus.undo()).toBe(true);
                expect(bus.getDoc()).toEqual(docs[i]);
            }
            expect(bus.canUndo()).toBe(false);
            expect(bus.getDoc()).toEqual(docs[0]);
        },
        SIM_TIMEOUT,
    );

    it(
        'then redo everything: every step reproduces the document',
        () => {
            const { bus, docs } = simulate(7);
            while (bus.undo()) {
                /* back to the start */
            }
            expect(bus.getDoc()).toEqual(docs[0]);
            for (let i = 1; i < docs.length; i += 1) {
                expect(bus.redo()).toBe(true);
                expect(bus.getDoc()).toEqual(docs[i]);
            }
            expect(bus.canRedo()).toBe(false);
        },
        SIM_TIMEOUT,
    );

    it(
        'more seeds hold the same properties',
        () => {
            for (const seed of [1, 2]) {
                const { bus, docs } = simulate(seed);
                while (bus.undo()) {
                    /* back to the start */
                }
                expect(bus.getDoc()).toEqual(docs[0]);
                while (bus.redo()) {
                    /* forward again */
                }
                expect(bus.getDoc()).toEqual(docs[docs.length - 1]);
            }
        },
        SIM_TIMEOUT,
    );
});
