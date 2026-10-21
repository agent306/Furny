import { describe, expect, it } from 'vitest';
import type { ExecuteResult } from '../../../commands/types';
import { testIds } from '../../../testing/ids';
import { mulberry32 } from '../../../testing/random';
import type {
    DimensionAnnotation,
    FurniturePlacement,
    Opening,
    PlanDocument,
    RoomMeta,
} from '../../schema';
import { makeGridPlan, makeRectPlan } from '../../testing/fixtures';
import { planErrorKeys, validatePlan } from '../../validate';
import { MOVE_COMMANDS } from '../moves';
import { PLAN_COMMANDS } from '../registry';
import {
    Graph,
    busOf,
    ok,
    oneWall,
    planBus,
    refused,
} from '../../testing/graph';

// ---- fixtures ----------------------------------------------------------------

const at = (doc: PlanDocument, id: string): [number, number] => [
    doc.nodes[id]!.x,
    doc.nodes[id]!.y,
];

/** `x,y>x,y` of a wall's ends. */
const endsOf = (doc: PlanDocument, id: string): string => {
    const w = doc.walls[id]!;
    return `${at(doc, w.a).join(',')}>${at(doc, w.b).join(',')}`;
};

const lengthOf = (doc: PlanDocument, id: string): number => {
    const w = doc.walls[id]!;
    return Math.hypot(
        doc.nodes[w.b]!.x - doc.nodes[w.a]!.x,
        doc.nodes[w.b]!.y - doc.nodes[w.a]!.y,
    );
};

type Bus = ReturnType<typeof busOf>;

function expectUndoRestores(bus: Bus, start: PlanDocument): void {
    expect(bus.undo()).toBe(true);
    expect(bus.getDoc()).toEqual(start);
}

/** A refused command leaves the very same document and no history entry. */
function expectRefusedUntouched(
    bus: Bus,
    run: () => ExecuteResult<unknown>,
    code: string,
) {
    const before = bus.getDoc();
    const entries = bus.history().undo.length;
    expect(refused(run()).code).toBe(code);
    expect(bus.getDoc()).toBe(before);
    expect(bus.history().undo.length).toBe(entries);
}

/** Moves a node over many absolute drag steps, merging each into one entry. */
function drag(
    bus: Bus,
    nodeId: string,
    from: [number, number],
    to: [number, number],
    steps: number,
    finalize: boolean,
) {
    for (let i = 1; i <= steps; i += 1) {
        const t = i / steps;
        ok(
            bus.execute(
                'moveNode',
                {
                    nodeId,
                    to: {
                        x: from[0] + (to[0] - from[0]) * t,
                        y: from[1] + (to[1] - from[1]) * t,
                    },
                    finalize: false,
                },
                { merge: true },
            ),
        );
    }
    if (!finalize) return null;
    return ok(
        bus.execute(
            'moveNode',
            { nodeId, to: { x: to[0], y: to[1] }, finalize: true },
            { merge: true },
        ),
    );
}

// ---- registry ----------------------------------------------------------------

describe('registry', () => {
    it('registers moveNode, moveWall and setWallLength with labels and schemas', () => {
        expect(Object.keys(MOVE_COMMANDS)).toEqual([
            'moveNode',
            'moveWall',
            'setWallLength',
        ]);
        for (const [name, label] of [
            ['moveNode', 'move_node'],
            ['moveWall', 'move_wall'],
            ['setWallLength', 'set_wall_length'],
        ] as const) {
            const def = PLAN_COMMANDS[name];
            expect(def.type).toBe(name);
            expect(def.labelKey).toBe(`engine.plan.command.label.${label}`);
            expect(def.paramsSchema).toBeDefined();
            expect(def.touchesGeometry).toBe(true);
        }
    });

    it('moveNode and moveWall merge with replace mode, setWallLength does not merge', () => {
        const node = PLAN_COMMANDS.moveNode;
        expect(node.mergeMode ?? 'replace').toBe('replace');
        expect(
            node.mergeKey?.({
                nodeId: 'n_a',
                to: { x: 1, y: 2 },
                finalize: false,
            }),
        ).toBe('moveNode:n_a');
        const wall = PLAN_COMMANDS.moveWall;
        expect(wall.mergeMode ?? 'replace').toBe('replace');
        expect(
            wall.mergeKey?.({ wallId: 'w_a', distance: 5, finalize: true }),
        ).toBe('moveWall:w_a');
        expect(PLAN_COMMANDS.setWallLength.mergeKey).toBeUndefined();
    });

    it('rejects params of the wrong type', () => {
        const { g } = oneWall();
        const bus = busOf(g);
        const r = bus.execute('moveNode', {
            nodeId: 'n_0000000001',
            to: { x: 'far' },
            finalize: false,
        } as never);
        expect(refused(r).code).toBe('invalid_params');
    });
});

// ---- moveNode ----------------------------------------------------------------

describe('moveNode', () => {
    it('moves a node, merges nothing, and undo restores the document', () => {
        const { g, a, b, w } = oneWall();
        const bus = busOf(g);
        const start = bus.getDoc();
        const r = ok(
            bus.execute('moveNode', {
                nodeId: b,
                to: { x: 5000.4, y: 1200.6 },
                finalize: false,
            }),
        );
        expect(r.result).toEqual({ mergedInto: null });
        expect(at(bus.getDoc(), b)).toEqual([5000, 1201]);
        expect(at(bus.getDoc(), a)).toEqual([0, 0]);
        expect(r.changedIds.has(b)).toBe(true);
        expect(r.changedIds.has(w)).toBe(false);
        expectUndoRestores(bus, start);
    });

    it('writes no negative zero', () => {
        const { g, b } = oneWall();
        const bus = busOf(g);
        ok(
            bus.execute('moveNode', {
                nodeId: b,
                to: { x: -0.2, y: 3000 },
                finalize: false,
            }),
        );
        expect(Object.is(bus.getDoc().nodes[b]!.x, 0)).toBe(true);
    });

    it('refuses an unknown node and a target outside the coordinate range', () => {
        const { g, b } = oneWall();
        const bus = busOf(g);
        expectRefusedUntouched(
            bus,
            () =>
                bus.execute('moveNode', {
                    nodeId: 'n_nope',
                    to: { x: 0, y: 0 },
                    finalize: false,
                }),
            'not_found',
        );
        const r = refused(
            bus.execute('moveNode', {
                nodeId: b,
                to: { x: 1_000_001, y: 0 },
                finalize: false,
            }),
        );
        expect(r.code).toBe('out_of_range');
        expect(r.params).toMatchObject({
            field: 'to.x',
            min: -1_000_000,
            max: 1_000_000,
        });
    });

    it('refuses a move that makes an incident wall shorter than 10 mm', () => {
        const { g, b } = oneWall();
        const bus = busOf(g);
        const r = refused(
            bus.execute('moveNode', {
                nodeId: b,
                to: { x: 9, y: 0 },
                finalize: false,
            }),
        );
        expect(r.code).toBe('wall_too_short');
        expect(r.params).toMatchObject({ length: 9 });
        // exactly 10 mm is fine
        ok(
            bus.execute('moveNode', {
                nodeId: b,
                to: { x: 0, y: 10 },
                finalize: false,
            }),
        );
    });

    it('measures every incident wall, not only the first', () => {
        const g = new Graph();
        const n = g.node(0, 0);
        const p = g.node(3000, 0);
        const q = g.node(0, 3000);
        g.wall(n, p);
        g.wall(q, n);
        const bus = busOf(g);
        expectRefusedUntouched(
            bus,
            () =>
                bus.execute('moveNode', {
                    nodeId: n,
                    to: { x: 0, y: 2995 },
                    finalize: false,
                }),
            'wall_too_short',
        );
    });

    describe('openings', () => {
        it('moving node a keeps each opening distance to node b (04 6.8)', () => {
            const { g, a, w } = oneWall();
            const o1 = g.opening(w, 1000, 900);
            const o2 = g.opening(w, 4000, 900, { kind: 'window' });
            const bus = busOf(g);
            const start = bus.getDoc();
            ok(
                bus.execute('moveNode', {
                    nodeId: a,
                    to: { x: 1000, y: 0 },
                    finalize: false,
                }),
            );
            const doc = bus.getDoc();
            // length 5000 -> 4000: distances to b were 4000 and 1000
            expect(doc.openings[o1]!.offset).toBe(0 + 450);
            expect(doc.openings[o2]!.offset).toBe(3000);
            expectUndoRestores(bus, start);
        });

        it('moving node b keeps the offsets', () => {
            const { g, b, w } = oneWall();
            const o1 = g.opening(w, 1000, 900);
            const o2 = g.opening(w, 4000, 900);
            const bus = busOf(g);
            const start = bus.getDoc();
            ok(
                bus.execute('moveNode', {
                    nodeId: b,
                    to: { x: 7000, y: 0 },
                    finalize: false,
                }),
            );
            expect(bus.getDoc().openings[o1]!.offset).toBe(1000);
            expect(bus.getDoc().openings[o2]!.offset).toBe(4000);
            expectUndoRestores(bus, start);
        });

        it('a slanting move keeps the distance to the far end on a diagonal wall', () => {
            const g = new Graph();
            const a = g.node(0, 0);
            const b = g.node(3000, 4000);
            const w = g.wall(a, b);
            const o = g.opening(w, 4000, 900); // 1000 from b
            const bus = busOf(g);
            const start = bus.getDoc();
            ok(
                bus.execute('moveNode', {
                    nodeId: a,
                    to: { x: 1500, y: 2000 },
                    finalize: false,
                }),
            );
            // new length 2500, distance to b stays 1000
            expect(bus.getDoc().openings[o]!.offset).toBe(1500);
            expectUndoRestores(bus, start);
        });

        it('shrinking a wall below an opening width aborts opening_no_fit (04 6.8)', () => {
            const { g, b, w } = oneWall();
            const o = g.opening(w, 2500, 900);
            const bus = busOf(g);
            for (const finalize of [false, true]) {
                const before = bus.getDoc();
                const r = refused(
                    bus.execute('moveNode', {
                        nodeId: b,
                        to: { x: 800, y: 0 },
                        finalize,
                    }),
                );
                expect(r.code).toBe('opening_no_fit');
                expect(r.params).toMatchObject({ wallId: w, openingId: o });
                expect(bus.getDoc()).toBe(before);
            }
            expect(bus.canUndo()).toBe(false);
        });

        it('an opening that still fits is clamped into the shorter wall', () => {
            const { g, b, w } = oneWall();
            const o = g.opening(w, 4500, 900);
            const bus = busOf(g);
            const start = bus.getDoc();
            ok(
                bus.execute('moveNode', {
                    nodeId: b,
                    to: { x: 3000, y: 0 },
                    finalize: false,
                }),
            );
            expect(bus.getDoc().openings[o]!.offset).toBe(2550);
            expectUndoRestores(bus, start);
        });

        it('a pre-existing overlap does not block the move (Task 22 ruling)', () => {
            const { g, b, w } = oneWall();
            g.opening(w, 1000, 900);
            g.opening(w, 1500, 900); // overlaps the first one already
            const bus = busOf(g);
            const start = bus.getDoc();
            ok(
                bus.execute('moveNode', {
                    nodeId: b,
                    to: { x: 5000, y: 700 },
                    finalize: false,
                }),
            );
            expectUndoRestores(bus, start);
        });

        it('an overlap the clamp creates aborts opening_overlap', () => {
            const { g, b, w } = oneWall();
            g.opening(w, 800, 900);
            g.opening(w, 2300, 900); // clear of the first by 700 mm
            const bus = busOf(g);
            // shortening to 2000 pushes the second one to offset 1550, onto the first
            expectRefusedUntouched(
                bus,
                () =>
                    bus.execute('moveNode', {
                        nodeId: b,
                        to: { x: 2000, y: 0 },
                        finalize: false,
                    }),
                'opening_overlap',
            );
        });
    });

    describe('drags (04 6.8)', () => {
        function gridDrag() {
            const ids = testIds();
            const start = makeGridPlan(3, 3, 3000, ids);
            const node = Object.values(start.nodes).find(
                (n) => n.x === 3000 && n.y === 3000,
            )!;
            const bus = planBus(start, ids);
            return { start, node, bus };
        }

        it('200 moveNode steps and a finalize are one history entry; undo restores the pre-drag document', () => {
            const { start, node, bus } = gridDrag();
            drag(bus, node.id, [3000, 3000], [3400, 2700], 200, false);
            expect(bus.history().undo).toHaveLength(1);
            const r = ok(
                bus.execute(
                    'moveNode',
                    {
                        nodeId: node.id,
                        to: { x: 3400, y: 2700 },
                        finalize: true,
                    },
                    { merge: true },
                ),
            );
            expect(r.result).toEqual({ mergedInto: null });
            expect(bus.history().undo).toHaveLength(1);
            expect(at(bus.getDoc(), node.id)).toEqual([3400, 2700]);
            const end = bus.getDoc();
            bus.seal();
            expectUndoRestores(bus, start);
            expect(bus.canUndo()).toBe(false);
            expect(bus.redo()).toBe(true);
            expect(bus.getDoc()).toEqual(end);
        });

        it('finalize:false steps do no topology work', () => {
            // dragging the node across a distant wall changes only the node
            const g = new Graph();
            const n = g.node(0, 0);
            const far = g.node(3000, 0);
            const w = g.wall(n, far);
            const x1 = g.node(1500, -2000);
            const x2 = g.node(1500, 2000);
            const cross = g.wall(x1, x2);
            const bus = busOf(g);
            const nodes = Object.keys(bus.getDoc().nodes).length;
            ok(
                bus.execute(
                    'moveNode',
                    { nodeId: far, to: { x: 3000, y: 1500 }, finalize: false },
                    { merge: true },
                ),
            );
            ok(
                bus.execute(
                    'moveNode',
                    { nodeId: n, to: { x: 0, y: 1400 }, finalize: false },
                    { merge: true },
                ),
            );
            // still no split: the move crosses nothing yet; now cross it
            ok(
                bus.execute(
                    'moveNode',
                    { nodeId: n, to: { x: 1400, y: 1400 }, finalize: false },
                    { merge: true },
                ),
            );
            const doc = bus.getDoc();
            expect(Object.keys(doc.nodes)).toHaveLength(nodes);
            expect(Object.keys(doc.walls).sort()).toEqual([w, cross].sort());
        });

        it('a finalize that merges, splits and crosses is still one entry, and one undo restores the pre-drag document', () => {
            const g = new Graph();
            const a = g.node(0, 0);
            const b = g.node(3000, 0);
            const w = g.wall(a, b);
            const x1 = g.node(1500, 1000);
            const x2 = g.node(1500, 3000);
            g.wall(x1, x2);
            const bus = busOf(g);
            const start = bus.getDoc();
            // drag b down across the vertical wall and on to its end node x2
            drag(bus, b, [3000, 0], [1500, 3003], 40, false);
            expect(Object.keys(bus.getDoc().walls)).toHaveLength(2);
            const r = ok(
                bus.execute(
                    'moveNode',
                    { nodeId: b, to: { x: 1500, y: 3003 }, finalize: true },
                    { merge: true },
                ),
            );
            expect(r.result).toEqual({ mergedInto: x2 });
            expect(bus.history().undo).toHaveLength(1);
            bus.seal();
            expect(bus.getDoc().walls[w]).toBeDefined();
            expectUndoRestores(bus, start);
        });

        it('a failing finalize keeps the document at the last merged step', () => {
            const { g, b, w } = oneWall();
            g.opening(w, 2500, 900);
            const bus = busOf(g);
            drag(bus, b, [5000, 0], [3000, 0], 5, false);
            const before = bus.getDoc();
            expect(
                refused(
                    bus.execute(
                        'moveNode',
                        { nodeId: b, to: { x: 700, y: 0 }, finalize: true },
                        { merge: true },
                    ),
                ).code,
            ).toBe('opening_no_fit');
            expect(bus.getDoc()).toBe(before);
            expect(bus.history().undo).toHaveLength(1);
        });
    });

    describe('finalize: merge into a node', () => {
        function pair() {
            const g = new Graph();
            const a = g.node(0, 0);
            const b = g.node(3000, 0);
            const c = g.node(3000, 3000);
            const ab = g.wall(a, b);
            const bc = g.wall(b, c);
            return { g, a, b, c, ab, bc, bus: busOf(g) };
        }

        it('within 5 mm of another node: mergedInto that node, the moved node is gone (04 6.6)', () => {
            const g = new Graph();
            const a = g.node(0, 0);
            const b = g.node(3000, 0);
            const c = g.node(0, 3000);
            const d = g.node(3000, 3000);
            const ab = g.wall(a, b);
            g.wall(b, d);
            g.wall(d, c);
            const bus = busOf(g);
            const start = bus.getDoc();
            const r = ok(
                bus.execute('moveNode', {
                    nodeId: c,
                    to: { x: 3, y: -4 },
                    finalize: true,
                }),
            );
            expect(r.result).toEqual({ mergedInto: a });
            const doc = bus.getDoc();
            expect(doc.nodes[c]).toBeUndefined();
            expect(at(doc, a)).toEqual([0, 0]);
            expect(doc.walls[ab]).toBeDefined();
            expect(r.deletedIds).toContain(c);
            expect(planErrorKeys(validatePlan(doc)).size).toBe(0);
            expectUndoRestores(bus, start);
        });

        it('without finalize it only moves the node', () => {
            const g = new Graph();
            const a = g.node(0, 0);
            const b = g.node(3000, 0);
            const c = g.node(0, 3000);
            g.wall(a, b);
            g.wall(b, c);
            const bus = busOf(g);
            const r = ok(
                bus.execute('moveNode', {
                    nodeId: c,
                    to: { x: 3, y: -4 },
                    finalize: false,
                }),
            );
            expect(r.result).toEqual({ mergedInto: null });
            expect(bus.getDoc().nodes[a]).toBeDefined();
            expect(at(bus.getDoc(), c)).toEqual([3, -4]);
        });

        it('exactly 5 mm away still merges, 6 mm does not', () => {
            for (const [dx, merged] of [
                [5, true],
                [6, false],
            ] as const) {
                const g = new Graph();
                const t = g.node(0, 0);
                g.wall(t, g.node(0, -3000));
                const m = g.node(4000, 4000);
                g.wall(m, g.node(4000, 8000));
                const bus = busOf(g);
                const r = ok(
                    bus.execute('moveNode', {
                        nodeId: m,
                        to: { x: dx, y: 0 },
                        finalize: true,
                    }),
                );
                expect(r.result.mergedInto).toBe(merged ? t : null);
            }
        });

        it('merges into the nearest of several nodes', () => {
            const g = new Graph();
            const m = g.node(5000, 5000);
            const n1 = g.node(0, 0);
            const n2 = g.node(4, 0);
            const far = g.node(0, 3000);
            g.wall(m, far);
            g.wall(n1, g.node(0, -3000));
            g.wall(n2, g.node(4, -3000));
            const bus = busOf(g);
            const r = ok(
                bus.execute('moveNode', {
                    nodeId: m,
                    to: { x: 3, y: 0 },
                    finalize: true,
                }),
            );
            expect(r.result.mergedInto).toBe(n2);
        });

        it('a wall to the merge target is merged away with its openings', () => {
            const { g, a, b, ab, bc } = pair();
            g.opening(ab, 1500, 900);
            const bus = busOf(g);
            const start = bus.getDoc();
            const r = ok(
                bus.execute('moveNode', {
                    nodeId: a,
                    to: { x: 3002, y: 2 },
                    finalize: true,
                }),
            );
            expect(r.result).toEqual({ mergedInto: b });
            const doc = bus.getDoc();
            expect(doc.walls[ab]).toBeUndefined();
            expect(Object.keys(doc.openings)).toHaveLength(0);
            expect(doc.walls[bc]).toBeDefined();
            expect(doc.nodes[a]).toBeUndefined();
            expect(r.deletedIds).toEqual(expect.arrayContaining([a, ab]));
            expectUndoRestores(bus, start);
        });

        it('the 10 mm minimum applies to the other walls, to the position the node ends at', () => {
            // a has walls to b and to p; p is 8 mm from b, so a landing on b leaves a 8 mm wall
            const g = new Graph();
            const a = g.node(0, 0);
            const b = g.node(3000, 0);
            const p = g.node(3008, 0);
            g.wall(a, b);
            g.wall(a, p);
            const bus = busOf(g);
            expectRefusedUntouched(
                bus,
                () =>
                    bus.execute('moveNode', {
                        nodeId: a,
                        to: { x: 3003, y: 0 },
                        finalize: true,
                    }),
                'wall_too_short',
            );
        });

        it('folds a wall that now duplicates another, keeping the smaller id', () => {
            const g = new Graph();
            const t = g.node(0, 0);
            const n = g.node(0, 2000);
            const x = g.node(4000, 1000);
            const tx = g.wall(t, x);
            const nx = g.wall(n, x);
            const bus = busOf(g);
            const start = bus.getDoc();
            const r = ok(
                bus.execute('moveNode', {
                    nodeId: n,
                    to: { x: 2, y: 2 },
                    finalize: true,
                }),
            );
            expect(r.result.mergedInto).toBe(t);
            const doc = bus.getDoc();
            expect(Object.keys(doc.walls)).toEqual([tx]);
            expect(r.deletedIds).toContain(nx);
            expect(planErrorKeys(validatePlan(doc)).size).toBe(0);
            expectUndoRestores(bus, start);
        });
    });

    describe('finalize: a wall under the drop point', () => {
        function tPlan() {
            const g = new Graph();
            const l = g.node(0, 0);
            const r = g.node(6000, 0);
            const w = g.wall(l, r);
            const s = g.node(2000, 3000);
            const t = g.node(2000, 6000);
            const stem = g.wall(s, t);
            return { g, l, r, w, s, t, stem, bus: busOf(g) };
        }

        it('splits it and merges into the new node: a T (04 6.6)', () => {
            const { l, r, w, s, stem, bus } = tPlan();
            const start = bus.getDoc();
            const res = ok(
                bus.execute('moveNode', {
                    nodeId: s,
                    to: { x: 2000, y: 3 },
                    finalize: true,
                }),
            );
            const doc = bus.getDoc();
            const t = res.result.mergedInto!;
            expect(t).not.toBeNull();
            expect(doc.nodes[s]).toBeUndefined();
            expect(at(doc, t)).toEqual([2000, 0]);
            const around = Object.values(doc.walls)
                .filter((x) => x.a === t || x.b === t)
                .map((x) => x.id)
                .sort();
            expect(around).toHaveLength(3);
            expect(around).toContain(stem);
            expect(doc.walls[w]!.a).toBe(l);
            expect(doc.walls[w]!.b).toBe(t);
            const tail = around.find((id) => id !== w && id !== stem)!;
            expect(doc.walls[tail]).toMatchObject({ a: t, b: r });
            expect(planErrorKeys(validatePlan(doc)).size).toBe(0);
            expectUndoRestores(bus, start);
        });

        it('does not split without finalize', () => {
            const { s, bus } = tPlan();
            ok(
                bus.execute('moveNode', {
                    nodeId: s,
                    to: { x: 2000, y: 3 },
                    finalize: false,
                }),
            );
            expect(Object.keys(bus.getDoc().walls)).toHaveLength(2);
        });

        it('a wall at the moved node is no snap target', () => {
            // sliding the end along its own wall never splits or merges it
            const { g, a, b } = oneWall();
            const bus = busOf(g);
            const r = ok(
                bus.execute('moveNode', {
                    nodeId: b,
                    to: { x: 4000, y: 0 },
                    finalize: true,
                }),
            );
            expect(r.result.mergedInto).toBeNull();
            expect(Object.keys(bus.getDoc().walls)).toHaveLength(1);
            expect(Object.keys(bus.getDoc().nodes).sort()).toEqual([a, b]);
        });

        it('a wall exactly 5 mm from the drop point is a snap target, 6 mm is not', () => {
            for (const [y, snaps] of [
                [5, true],
                [6, false],
            ] as const) {
                const { s, bus } = tPlan();
                const r = ok(
                    bus.execute('moveNode', {
                        nodeId: s,
                        to: { x: 2000, y },
                        finalize: true,
                    }),
                );
                expect(r.result.mergedInto !== null).toBe(snaps);
                expect(Object.keys(bus.getDoc().walls)).toHaveLength(
                    snaps ? 3 : 2,
                );
            }
        });

        it('projecting exactly 10 mm from a wall end snaps to the end, 11 mm splits', () => {
            const { l, r, s, bus } = tPlan();
            const start = bus.getDoc();
            expect(
                ok(
                    bus.execute('moveNode', {
                        nodeId: s,
                        to: { x: 10, y: 0 },
                        finalize: true,
                    }),
                ).result.mergedInto,
            ).toBe(l);
            expect(bus.undo()).toBe(true);
            expect(bus.getDoc()).toEqual(start);
            expect(
                ok(
                    bus.execute('moveNode', {
                        nodeId: s,
                        to: { x: 5990, y: 0 },
                        finalize: true,
                    }),
                ).result.mergedInto,
            ).toBe(r);
            expect(bus.undo()).toBe(true);
            for (const x of [11, 5989]) {
                const split = ok(
                    bus.execute('moveNode', {
                        nodeId: s,
                        to: { x, y: 0 },
                        finalize: true,
                    }),
                ).result.mergedInto!;
                expect(split).not.toBeNull();
                expect([l, r]).not.toContain(split);
                expect(at(bus.getDoc(), split)).toEqual([x, 0]);
                expect(bus.undo()).toBe(true);
                expect(bus.getDoc()).toEqual(start);
            }
        });

        it('a drop within 10 mm of the wall end snaps to that end node', () => {
            const { r, s, bus } = tPlan();
            const res = ok(
                bus.execute('moveNode', {
                    nodeId: s,
                    to: { x: 5993, y: 3 },
                    finalize: true,
                }),
            );
            expect(res.result.mergedInto).toBe(r);
            expect(Object.keys(bus.getDoc().walls)).toHaveLength(2);
        });

        it('a drop on an opening aborts split_through_opening and leaves the document', () => {
            const { g, w, s } = tPlan();
            g.opening(w, 2000, 900);
            const bus = busOf(g);
            expectRefusedUntouched(
                bus,
                () =>
                    bus.execute('moveNode', {
                        nodeId: s,
                        to: { x: 2000, y: 3 },
                        finalize: true,
                    }),
                'split_through_opening',
            );
        });

        it('splits a wall with an opening beside the drop point and hands the opening to the right part', () => {
            const { g, w, l, s } = tPlan();
            const o = g.opening(w, 4500, 900);
            const bus = busOf(g);
            const start = bus.getDoc();
            const res = ok(
                bus.execute('moveNode', {
                    nodeId: s,
                    to: { x: 2000, y: -2 },
                    finalize: true,
                }),
            );
            const doc = bus.getDoc();
            const opening = doc.openings[o]!;
            expect(opening.wallId).not.toBe(w);
            expect(opening.offset).toBe(2500);
            expect(doc.walls[w]!.a).toBe(l);
            expect(res.result.mergedInto).toBe(doc.walls[w]!.b);
            expectUndoRestores(bus, start);
        });
    });

    describe('finalize: ties and order', () => {
        /** A node with `rest` placed by id, in the given insertion order. */
        const docOf = (
            nodes: Array<[string, number, number]>,
            walls: Array<[string, string, string]>,
            reverse: boolean,
        ): PlanDocument => {
            const g = new Graph();
            for (const [id, x, y] of reverse ? [...nodes].reverse() : nodes) {
                g.doc.nodes[id] = { id, x, y };
            }
            for (const [id, a, b] of reverse ? [...walls].reverse() : walls) {
                g.doc.walls[id] = {
                    id,
                    a,
                    b,
                    thickness: 115,
                    height: 2700,
                    kind: 'interior',
                    justification: 'center',
                    material: 'brick',
                    colorHex: null,
                };
            }
            return g.doc;
        };

        it('two incident walls that cross a third: the same ids whatever the insertion order', () => {
            const nodes: Array<[string, number, number]> = [
                ['n_m', 0, 0],
                ['n_p', 100, 3000],
                ['n_q', 100, -3000],
                ['n_t1', 2000, -3000],
                ['n_t2', 2000, 3000],
            ];
            const walls: Array<[string, string, string]> = [
                ['w_a', 'n_m', 'n_p'],
                ['w_b', 'n_q', 'n_m'],
                ['w_t', 'n_t1', 'n_t2'],
            ];
            const results = [false, true].map((reverse) => {
                const doc = docOf(nodes, walls, reverse);
                const bus = planBus(doc, testIds());
                const r = ok(
                    bus.execute('moveNode', {
                        nodeId: 'n_m',
                        to: { x: 4000, y: 0 },
                        finalize: true,
                    }),
                );
                return { doc: bus.getDoc(), result: r.result };
            });
            const [forward, reversed] = results as [
                (typeof results)[number],
                (typeof results)[number],
            ];
            // really three crossings' worth of splitting happened
            expect(Object.keys(forward.doc.walls)).toHaveLength(7);
            expect(reversed.doc).toEqual(forward.doc);
            expect(Object.keys(reversed.doc.walls).sort()).toEqual(
                Object.keys(forward.doc.walls).sort(),
            );
            expect(Object.keys(reversed.doc.nodes).sort()).toEqual(
                Object.keys(forward.doc.nodes).sort(),
            );
            expect(reversed.result).toEqual(forward.result);
        });

        it('equidistant nodes: the smaller id wins, whatever the insertion order', () => {
            for (const reverse of [false, true]) {
                const doc = docOf(
                    [
                        ['n_a', -3, 0],
                        ['n_b', 3, 0],
                        ['n_c', -3, -3000],
                        ['n_d', 3, -3000],
                        ['n_m', 4000, 4000],
                        ['n_z', 4000, 8000],
                    ],
                    [
                        ['w_1', 'n_a', 'n_c'],
                        ['w_2', 'n_b', 'n_d'],
                        ['w_3', 'n_m', 'n_z'],
                    ],
                    reverse,
                );
                const bus = planBus(doc, testIds());
                const r = ok(
                    bus.execute('moveNode', {
                        nodeId: 'n_m',
                        to: { x: 0, y: 0 },
                        finalize: true,
                    }),
                );
                expect(r.result.mergedInto).toBe('n_a');
            }
        });

        it('equidistant walls: the smaller id is split, whatever the insertion order', () => {
            for (const reverse of [false, true]) {
                const doc = docOf(
                    [
                        ['n_1', -2000, 3],
                        ['n_2', 2000, 3],
                        ['n_3', -2000, -3],
                        ['n_4', 2000, -3],
                        ['n_m', 0, -4000],
                        ['n_z', 0, -8000],
                    ],
                    [
                        ['w_b', 'n_1', 'n_2'],
                        ['w_a', 'n_3', 'n_4'],
                        ['w_m', 'n_m', 'n_z'],
                    ],
                    reverse,
                );
                const bus = planBus(doc, testIds());
                const r = ok(
                    bus.execute('moveNode', {
                        nodeId: 'n_m',
                        to: { x: 0, y: 0 },
                        finalize: true,
                    }),
                );
                const t = r.result.mergedInto!;
                expect(at(bus.getDoc(), t)).toEqual([0, -3]);
                expect(bus.getDoc().walls['w_a']!.b).toBe(t);
                expect(bus.getDoc().walls['w_b']!.b).toBe('n_2');
            }
        });

        it('walls that reach the merge target are split where they now cross another wall', () => {
            const g = new Graph();
            const t = g.node(0, 0);
            g.wall(t, g.node(0, -3000));
            const n = g.node(4000, 4000);
            const y = g.node(-3000, 800);
            const ny = g.wall(n, y);
            const x1 = g.node(-1500, -2000);
            const x2 = g.node(-1500, 500);
            const v = g.wall(x1, x2);
            const bus = busOf(g);
            const start = bus.getDoc();
            // from n the wall passes the foot of v; from t it crosses v at (-1500, 400)
            const r = ok(
                bus.execute('moveNode', {
                    nodeId: n,
                    to: { x: 3, y: 3 },
                    finalize: true,
                }),
            );
            expect(r.result.mergedInto).toBe(t);
            const doc = bus.getDoc();
            const cross = Object.values(doc.nodes).find(
                (c) => c.x === -1500 && c.y === 400,
            )!;
            expect(cross).toBeDefined();
            expect(Object.keys(doc.walls)).toHaveLength(5);
            expect(doc.walls[ny]).toMatchObject({ a: t });
            expect(doc.walls[ny]!.b).toBe(cross.id);
            expect(doc.walls[v]!.b).toBe(cross.id);
            expectUndoRestores(bus, start);
        });
    });

    describe('finalize: crossings', () => {
        it('a wall that now crosses another is split at the crossing, both walls', () => {
            const g = new Graph();
            const a = g.node(0, 0);
            const b = g.node(4000, 0);
            const w = g.wall(a, b);
            const x1 = g.node(2000, 1000);
            const x2 = g.node(2000, 3000);
            const v = g.wall(x1, x2);
            const bus = busOf(g);
            const start = bus.getDoc();
            // moving b to (4000, 2000) makes a-b cross the vertical wall at (2000, 1000)... which is x1
            // so take a clean crossing instead: b to (4000, 2400) crosses x=2000 at y=1200
            ok(
                bus.execute('moveNode', {
                    nodeId: b,
                    to: { x: 4000, y: 2400 },
                    finalize: false,
                }),
            );
            expect(Object.keys(bus.getDoc().walls)).toHaveLength(2);
            expect(bus.undo()).toBe(true);
            const r = ok(
                bus.execute('moveNode', {
                    nodeId: b,
                    to: { x: 4000, y: 2400 },
                    finalize: true,
                }),
            );
            expect(r.result).toEqual({ mergedInto: null });
            const doc = bus.getDoc();
            expect(Object.keys(doc.walls)).toHaveLength(4);
            const cross = Object.values(doc.nodes).find(
                (n) => n.x === 2000 && n.y === 1200,
            )!;
            expect(cross).toBeDefined();
            const around = Object.values(doc.walls).filter(
                (x) => x.a === cross.id || x.b === cross.id,
            );
            expect(around).toHaveLength(4);
            expect(doc.walls[w]!.a).toBe(a);
            expect(doc.walls[v]!.a).toBe(x1);
            expect(planErrorKeys(validatePlan(doc))).toEqual(
                planErrorKeys(validatePlan(start)),
            );
            expect(
                validatePlan(doc).filter(
                    (i) => i.code === 'plan.walls_intersect',
                ),
            ).toHaveLength(0);
            expectUndoRestores(bus, start);
        });

        it('a finalize that changes nothing else just moves the node', () => {
            const { g, b } = oneWall();
            const bus = busOf(g);
            const r = ok(
                bus.execute('moveNode', {
                    nodeId: b,
                    to: { x: 5000, y: 100 },
                    finalize: true,
                }),
            );
            expect(r.result.mergedInto).toBeNull();
            expect(Object.keys(bus.getDoc().walls)).toHaveLength(1);
        });
    });

    describe('followers (04 6.4)', () => {
        it('an attached placement and dimension follow the moved wall, in the same entry', () => {
            const g = new Graph();
            const a = g.node(0, 0);
            const b = g.node(4000, 0);
            const w = g.wall(a, b);
            const p: FurniturePlacement = {
                id: g.ids('f'),
                designId: 'des_x',
                x: 2000,
                y: 57.5,
                rotation: 0,
                elevation: 0,
                mirrored: false,
                wallAttachment: { wallId: w, side: 'right' },
            };
            g.doc.placements[p.id] = p;
            const dim: DimensionAnnotation = {
                id: g.ids('d'),
                a: { x: 0, y: 0 },
                b: { x: 1, y: 1 },
                offset: 300,
                attachedTo: { kind: 'wall', wallId: w, face: 'center' },
            };
            g.doc.annotations.dimensions[dim.id] = dim;
            const bus = busOf(g);
            const start = bus.getDoc();
            ok(
                bus.execute('moveNode', {
                    nodeId: b,
                    to: { x: 4000, y: 800 },
                    finalize: true,
                }),
            );
            const doc = bus.getDoc();
            expect(doc.annotations.dimensions[dim.id]!.b).toEqual({
                x: 4000,
                y: 800,
            });
            expect(doc.placements[p.id]!.rotation).not.toBe(0);
            expect(bus.history().undo).toHaveLength(1);
            expectUndoRestores(bus, start);
        });

        it('a room meta follows its room when a corner moves', () => {
            const ids = testIds();
            const doc = makeRectPlan(5000, 4000, 230, ids);
            const meta: RoomMeta = {
                id: ids('r'),
                anchor: { x: 2500, y: 2000 },
                name: 'Hall',
                type: 'other',
                floorFinish: 'tile',
                floorColorHex: null,
                labelOffset: null,
                showArea: true,
            };
            doc.rooms[meta.id] = meta;
            const corner = Object.values(doc.nodes).find(
                (n) => n.x === 5000 && n.y === 4000,
            )!;
            const bus = planBus(doc, ids);
            const start = bus.getDoc();
            ok(
                bus.execute('moveNode', {
                    nodeId: corner.id,
                    to: { x: 5000, y: 3000 },
                    finalize: true,
                }),
            );
            expect(bus.getDoc().rooms[meta.id]).toBeDefined();
            expectUndoRestores(bus, start);
        });
    });
});

// ---- moveWall ----------------------------------------------------------------

describe('moveWall', () => {
    /** The top wall of a rectangle: (0,0)->(5000,0), so +n points up the screen. */
    function rect() {
        const ids = testIds();
        const doc = makeRectPlan(5000, 4000, 230, ids);
        const top = Object.values(doc.walls).find(
            (w) => doc.nodes[w.a]!.y === 0 && doc.nodes[w.b]!.y === 0,
        )!;
        return { doc, top, bus: planBus(doc, ids), ids };
    }

    function isClosedRectangle(doc: PlanDocument): boolean {
        const walls = Object.values(doc.walls);
        if (walls.length !== 4 || Object.keys(doc.nodes).length !== 4) {
            return false;
        }
        const degree = new Map<string, number>();
        for (const w of walls) {
            degree.set(w.a, (degree.get(w.a) ?? 0) + 1);
            degree.set(w.b, (degree.get(w.b) ?? 0) + 1);
            const a = doc.nodes[w.a]!;
            const b = doc.nodes[w.b]!;
            if (a.x !== b.x && a.y !== b.y) return false;
        }
        return [...degree.values()].every((n) => n === 2);
    }

    it('on the top wall of a rectangle by -500 keeps it closed and rectangular (04 6.8)', () => {
        const { doc: start, top, bus } = rect();
        ok(
            bus.execute('moveWall', {
                wallId: top.id,
                distance: -500,
                finalize: true,
            }),
        );
        const doc = bus.getDoc();
        expect(isClosedRectangle(doc)).toBe(true);
        expect(endsOf(doc, top.id)).toBe('0,500>5000,500');
        // the side walls slid along their lines and kept their ends below
        const ys = Object.values(doc.nodes)
            .map((n) => n.y)
            .sort((p, q) => p - q);
        expect(ys).toEqual([500, 500, 4000, 4000]);
        expect(Object.keys(doc.walls).sort()).toEqual(
            Object.keys(start.walls).sort(),
        );
        expectUndoRestores(bus, start);
    });

    it('+n is the left side of a->b: a positive distance moves the top wall up', () => {
        const { top, bus, doc: start } = rect();
        ok(
            bus.execute('moveWall', {
                wallId: top.id,
                distance: 300,
                finalize: false,
            }),
        );
        expect(endsOf(bus.getDoc(), top.id)).toBe('0,-300>5000,-300');
        expect(isClosedRectangle(bus.getDoc())).toBe(true);
        expectUndoRestores(bus, start);
    });

    it('moves every wall of a rectangle both ways', () => {
        const { doc: start, bus } = rect();
        for (const wall of Object.values(start.walls)) {
            for (const distance of [-400, 250]) {
                ok(
                    bus.execute('moveWall', {
                        wallId: wall.id,
                        distance,
                        finalize: true,
                    }),
                );
                expect(isClosedRectangle(bus.getDoc())).toBe(true);
                expectUndoRestores(bus, start);
            }
        }
    });

    it('a zero distance changes nothing', () => {
        const { top, bus } = rect();
        const start = bus.getDoc();
        ok(
            bus.execute('moveWall', {
                wallId: top.id,
                distance: 0,
                finalize: true,
            }),
        );
        expect(bus.getDoc()).toEqual(start);
    });

    it('rounds the distance and the new positions to whole millimetres', () => {
        const { top, bus } = rect();
        ok(
            bus.execute('moveWall', {
                wallId: top.id,
                distance: 100.4,
                finalize: false,
            }),
        );
        expect(endsOf(bus.getDoc(), top.id)).toBe('0,-100>5000,-100');
    });

    describe('neighbours slide along their own lines', () => {
        it('diagonal neighbours at both ends (04 6.6)', () => {
            const g = new Graph();
            const a = g.node(0, 0);
            const b = g.node(4000, 0);
            const p1 = g.node(-2000, 2000);
            const p2 = g.node(6000, 2000);
            const w = g.wall(a, b);
            const o1 = g.wall(a, p1);
            const o2 = g.wall(b, p2);
            const bus = busOf(g);
            const start = bus.getDoc();
            // -n is down the screen: the wall moves toward the far nodes
            ok(
                bus.execute('moveWall', {
                    wallId: w,
                    distance: -500,
                    finalize: true,
                }),
            );
            const doc = bus.getDoc();
            expect(at(doc, a)).toEqual([-500, 500]);
            expect(at(doc, b)).toEqual([4500, 500]);
            expect(at(doc, p1)).toEqual([-2000, 2000]);
            expect(at(doc, p2)).toEqual([6000, 2000]);
            expect(endsOf(doc, o1)).toBe('-500,500>-2000,2000');
            expect(endsOf(doc, o2)).toBe('4500,500>6000,2000');
            expectUndoRestores(bus, start);
        });

        it('a slanted moved wall slides its neighbours and stays parallel', () => {
            const g = new Graph();
            const a = g.node(0, 0);
            const b = g.node(3000, 4000);
            const p1 = g.node(0, 4000);
            const p2 = g.node(3000, 0);
            const w = g.wall(a, b);
            g.wall(a, p1);
            g.wall(b, p2);
            const bus = busOf(g);
            const start = bus.getDoc();
            // d = (0.6, 0.8), n = (0.8, -0.6); distance 500 moves by (400, -300)
            ok(
                bus.execute('moveWall', {
                    wallId: w,
                    distance: 500,
                    finalize: true,
                }),
            );
            const doc = bus.getDoc();
            // a slides along the vertical line x = 0 until it meets the shifted line
            const ax = doc.nodes[a]!.x;
            const bx = doc.nodes[b]!.x;
            expect(ax).toBe(0);
            expect(bx).toBe(3000);
            // the shifted line passes through (400, -300) with direction (3, 4):
            // at x = 0 -> y = -300 - 4/3 * 400
            expect(doc.nodes[a]!.y).toBe(-833);
            // at x = 3000 -> y = -300 + 4/3 * 2600
            expect(doc.nodes[b]!.y).toBe(3167);
            expectUndoRestores(bus, start);
        });

        it('a neighbour that is parallel to the wall is stretched, not slid', () => {
            const g = new Graph();
            const a = g.node(0, 0);
            const b = g.node(3000, 0);
            const c = g.node(6000, 0);
            const w = g.wall(a, b);
            const o = g.wall(b, c); // collinear continuation
            const bus = busOf(g);
            const start = bus.getDoc();
            ok(
                bus.execute('moveWall', {
                    wallId: w,
                    distance: 200,
                    finalize: true,
                }),
            );
            const doc = bus.getDoc();
            expect(at(doc, b)).toEqual([3000, -200]);
            expect(at(doc, c)).toEqual([6000, 0]);
            expect(doc.walls[o]).toBeDefined();
            expectUndoRestores(bus, start);
        });

        it('a near-parallel neighbour: plain translation past the guard 10*|distance| + 1000', () => {
            // O leaves a at 5 degrees to W: sliding by `distance` moves a by distance / sin(5deg) = 11.47 * distance
            const build = () => {
                const g = new Graph();
                const a = g.node(0, 0);
                const b = g.node(5000, 0);
                const far = g.node(
                    Math.round(-3000 * Math.cos((5 * Math.PI) / 180)),
                    Math.round(3000 * Math.sin((5 * Math.PI) / 180)),
                );
                const w = g.wall(a, b);
                g.wall(a, far);
                return { g, a, b, far, w };
            };
            // distance 600: slide of 6884 <= 7000 -> a slides along O
            {
                const { g, a, far, w } = build();
                const bus = busOf(g);
                const start = bus.getDoc();
                ok(
                    bus.execute('moveWall', {
                        wallId: w,
                        distance: 600,
                        finalize: false,
                    }),
                );
                const na = at(bus.getDoc(), a);
                expect(na[1]).toBe(-600);
                expect(na[0]).not.toBe(0);
                // on the line through the unmoved far node
                const f = at(bus.getDoc(), far);
                expect(Math.abs(na[0] * f[1] - na[1] * f[0])).toBeLessThan(
                    2 * Math.hypot(...f),
                );
                expectUndoRestores(bus, start);
            }
            // distance 800: slide of 9179 > 9000 -> a is translated
            {
                const { g, a, w } = build();
                const bus = busOf(g);
                const start = bus.getDoc();
                ok(
                    bus.execute('moveWall', {
                        wallId: w,
                        distance: 800,
                        finalize: true,
                    }),
                );
                expect(at(bus.getDoc(), a)).toEqual([0, -800]);
                expectUndoRestores(bus, start);
            }
        });

        it('translates at an end with no other wall', () => {
            const { g, w, a, b } = oneWall();
            const bus = busOf(g);
            const start = bus.getDoc();
            ok(
                bus.execute('moveWall', {
                    wallId: w,
                    distance: 700,
                    finalize: true,
                }),
            );
            expect(at(bus.getDoc(), a)).toEqual([0, -700]);
            expect(at(bus.getDoc(), b)).toEqual([5000, -700]);
            expectUndoRestores(bus, start);
        });

        it('three walls at one end: that end is translated and the walls there stretch (04 6.6)', () => {
            const g = new Graph();
            const a = g.node(0, 0);
            const b = g.node(4000, 0);
            const up = g.node(-2000, -2000);
            const down = g.node(-2000, 2000);
            const p2 = g.node(6000, 2000);
            const w = g.wall(a, b);
            const o1 = g.wall(a, up);
            const o2 = g.wall(a, down);
            const o3 = g.wall(b, p2);
            const bus = busOf(g);
            const start = bus.getDoc();
            ok(
                bus.execute('moveWall', {
                    wallId: w,
                    distance: -500,
                    finalize: true,
                }),
            );
            const doc = bus.getDoc();
            // a has two other walls: plain translation (it would be (-500, 500) if it slid)
            expect(at(doc, a)).toEqual([0, 500]);
            // b has one other wall at 45 degrees: it slides along it
            expect(at(doc, b)).toEqual([4500, 500]);
            expect(endsOf(doc, o1)).toBe('0,500>-2000,-2000');
            expect(endsOf(doc, o2)).toBe('0,500>-2000,2000');
            expect(endsOf(doc, o3)).toBe('4500,500>6000,2000');
            expectUndoRestores(bus, start);
        });

        it('a T at both ends translates both', () => {
            const g = new Graph();
            const a = g.node(0, 0);
            const b = g.node(4000, 0);
            const w = g.wall(a, b);
            g.wall(a, g.node(0, -2000));
            g.wall(a, g.node(0, 2000));
            g.wall(b, g.node(4000, -2000));
            g.wall(b, g.node(4000, 2000));
            const bus = busOf(g);
            const start = bus.getDoc();
            ok(
                bus.execute('moveWall', {
                    wallId: w,
                    distance: 300,
                    finalize: true,
                }),
            );
            expect(endsOf(bus.getDoc(), w)).toBe('0,-300>4000,-300');
            expectUndoRestores(bus, start);
        });
    });

    describe('validation', () => {
        it('refuses an unknown wall and a distance out of range', () => {
            const { top, bus } = rect();
            expectRefusedUntouched(
                bus,
                () =>
                    bus.execute('moveWall', {
                        wallId: 'w_nope',
                        distance: 1,
                        finalize: false,
                    }),
                'not_found',
            );
            expectRefusedUntouched(
                bus,
                () =>
                    bus.execute('moveWall', {
                        wallId: top.id,
                        distance: 3_000_000,
                        finalize: false,
                    }),
                'out_of_range',
            );
            const r = refused(
                bus.execute('moveWall', {
                    wallId: top.id,
                    distance: 1_500_000,
                    finalize: false,
                }),
            );
            expect(r.code).toBe('out_of_range');
        });

        it('refuses a move that leaves a neighbour under 10 mm', () => {
            const { top, bus } = rect();
            // the side walls are 4000 long; moving down by 3995 leaves 5
            const r = refused(
                bus.execute('moveWall', {
                    wallId: top.id,
                    distance: -3995,
                    finalize: false,
                }),
            );
            expect(r.code).toBe('wall_too_short');
            expect(r.params).toMatchObject({ length: 5 });
            ok(
                bus.execute('moveWall', {
                    wallId: top.id,
                    distance: -3990,
                    finalize: false,
                }),
            );
        });

        it('refuses a move that turns a neighbour round, even when it is still 10 mm long', () => {
            const ids = testIds();
            const doc = makeRectPlan(5000, 300, 230, ids);
            const top = Object.values(doc.walls).find(
                (w) => doc.nodes[w.a]!.y === 0 && doc.nodes[w.b]!.y === 0,
            )!;
            const bus = planBus(doc, ids);
            const r = refused(
                bus.execute('moveWall', {
                    wallId: top.id,
                    distance: -310,
                    finalize: false,
                }),
            );
            expect(r.code).toBe('wall_too_short');
            expect(r.params).toMatchObject({ length: 10 });
            expect(r.params['wallId']).not.toBe(top.id);
            expect(bus.getDoc()).toBe(doc);
            // 10 mm short of the opposite wall is the last allowed position
            ok(
                bus.execute('moveWall', {
                    wallId: top.id,
                    distance: -290,
                    finalize: false,
                }),
            );
        });

        it('refuses a move that would leave the coordinate range', () => {
            const g = new Graph();
            const a = g.node(0, 999_000);
            const b = g.node(4000, 999_000);
            const w = g.wall(a, b);
            const bus = busOf(g);
            expectRefusedUntouched(
                bus,
                () =>
                    bus.execute('moveWall', {
                        wallId: w,
                        distance: -5000,
                        finalize: false,
                    }),
                'out_of_range',
            );
        });
    });

    describe('openings', () => {
        it('openings on the moved wall keep their offset', () => {
            const { doc, top, ids } = rect();
            const g = { doc, ids };
            const o: Opening = {
                id: g.ids('o'),
                wallId: top.id,
                kind: 'window',
                type: 'casement',
                offset: 1500,
                width: 1200,
                height: 1200,
                sillHeight: 900,
                hinge: 'start',
                swing: 'left',
                label: null,
            };
            doc.openings[o.id] = o;
            const bus = planBus(doc, ids);
            const start = bus.getDoc();
            ok(
                bus.execute('moveWall', {
                    wallId: top.id,
                    distance: -500,
                    finalize: true,
                }),
            );
            expect(bus.getDoc().openings[o.id]!.offset).toBe(1500);
            expect(bus.getDoc().openings[o.id]!.wallId).toBe(top.id);
            expectUndoRestores(bus, start);
        });

        it('a neighbour whose end a moved keeps the distance to its other end', () => {
            const ids = testIds();
            const doc = makeRectPlan(5000, 4000, 230, ids);
            // the left wall runs (0,4000)->(0,0): its b end is the top-left corner
            const left = Object.values(doc.walls).find(
                (w) => doc.nodes[w.a]!.x === 0 && doc.nodes[w.b]!.x === 0,
            )!;
            const top = Object.values(doc.walls).find(
                (w) => doc.nodes[w.a]!.y === 0 && doc.nodes[w.b]!.y === 0,
            )!;
            const bottom = Object.values(doc.walls).find(
                (w) => doc.nodes[w.a]!.y === 4000 && doc.nodes[w.b]!.y === 4000,
            )!;
            const o: Opening = {
                id: ids('o'),
                wallId: left.id,
                kind: 'door',
                type: 'single_swing',
                offset: 500,
                width: 900,
                height: 2100,
                sillHeight: 0,
                hinge: 'start',
                swing: 'left',
                label: null,
            };
            doc.openings[o.id] = o;
            const bus = planBus(doc, ids);
            const start = bus.getDoc();
            // top moves down: left's b end moves, the offset from a stays
            ok(
                bus.execute('moveWall', {
                    wallId: top.id,
                    distance: -1000,
                    finalize: true,
                }),
            );
            expect(bus.getDoc().openings[o.id]!.offset).toBe(500);
            expectUndoRestores(bus, start);
            // bottom moves up: left's a end moves, the distance to b (500) stays
            const bus2 = planBus(
                { ...doc, openings: { [o.id]: { ...o, offset: 3500 } } },
                ids,
            );
            const start2 = bus2.getDoc();
            ok(
                bus2.execute('moveWall', {
                    wallId: bottom.id,
                    distance: -1000,
                    finalize: true,
                }),
            );
            expect(lengthOf(bus2.getDoc(), left.id)).toBe(3000);
            expect(bus2.getDoc().openings[o.id]!.offset).toBe(2500);
            expectUndoRestores(bus2, start2);
        });

        it('the moved wall keeps its offsets when its length changes (45 degree neighbours)', () => {
            for (const [distance, length] of [
                [-500, 4000],
                [500, 2000],
            ] as const) {
                const g = new Graph();
                const a = g.node(0, 0);
                const b = g.node(3000, 0);
                const w = g.wall(a, b);
                g.wall(a, g.node(-2000, 2000));
                g.wall(b, g.node(5000, 2000));
                const o = g.opening(w, 1000, 900);
                const bus = busOf(g);
                const start = bus.getDoc();
                ok(
                    bus.execute('moveWall', {
                        wallId: w,
                        distance,
                        finalize: true,
                    }),
                );
                expect(lengthOf(bus.getDoc(), w)).toBe(length);
                expect(bus.getDoc().openings[o]!.offset).toBe(1000);
                expectUndoRestores(bus, start);
            }
        });

        it('shrinking a neighbour below an opening width aborts opening_no_fit', () => {
            const ids = testIds();
            const doc = makeRectPlan(5000, 4000, 230, ids);
            const left = Object.values(doc.walls).find(
                (w) => doc.nodes[w.a]!.x === 0 && doc.nodes[w.b]!.x === 0,
            )!;
            const top = Object.values(doc.walls).find(
                (w) => doc.nodes[w.a]!.y === 0 && doc.nodes[w.b]!.y === 0,
            )!;
            const o: Opening = {
                id: ids('o'),
                wallId: left.id,
                kind: 'door',
                type: 'single_swing',
                offset: 400,
                width: 900,
                height: 2100,
                sillHeight: 0,
                hinge: 'start',
                swing: 'left',
                label: null,
            };
            doc.openings[o.id] = o;
            const bus = planBus(doc, ids);
            expectRefusedUntouched(
                bus,
                () =>
                    bus.execute('moveWall', {
                        wallId: top.id,
                        distance: -3500,
                        finalize: true,
                    }),
                'opening_no_fit',
            );
        });
    });

    describe('finalize', () => {
        function crossing() {
            const g = new Graph();
            const a = g.node(1000, 3000);
            const b = g.node(4000, 3000);
            const w = g.wall(a, b);
            const x1 = g.node(2500, 1000);
            const x2 = g.node(2500, 2000);
            const v = g.wall(x1, x2);
            return { g, a, b, w, v, bus: busOf(g) };
        }

        it('splits what a sliding neighbour now crosses, both walls', () => {
            const g = new Graph();
            const a = g.node(0, 0);
            const b = g.node(4000, 0);
            const w = g.wall(a, b);
            const p1 = g.node(-2000, 2000);
            const o = g.wall(a, p1);
            const x1 = g.node(100, -1000);
            const x2 = g.node(100, -50);
            const v = g.wall(x1, x2);
            const bus = busOf(g);
            const start = bus.getDoc();
            // a slides 200 mm up the 45 degree line to (200, -200): the neighbour
            // now runs over (100, -100) on v; the moved wall itself crosses nothing
            ok(
                bus.execute('moveWall', {
                    wallId: w,
                    distance: 200,
                    finalize: false,
                }),
            );
            expect(Object.keys(bus.getDoc().walls)).toHaveLength(3);
            expect(bus.undo()).toBe(true);
            ok(
                bus.execute('moveWall', {
                    wallId: w,
                    distance: 200,
                    finalize: true,
                }),
            );
            const doc = bus.getDoc();
            expect(at(doc, a)).toEqual([200, -200]);
            const cross = Object.values(doc.nodes).find(
                (n) => n.x === 100 && n.y === -100,
            )!;
            expect(cross).toBeDefined();
            expect(Object.keys(doc.walls)).toHaveLength(5);
            expect(doc.walls[o]).toMatchObject({ a, b: cross.id });
            expect(doc.walls[v]).toMatchObject({ a: x1, b: cross.id });
            expect(doc.walls[w]).toMatchObject({ a, b });
            expectUndoRestores(bus, start);
        });

        it('splits the moved wall and the walls it now crosses, only with finalize', () => {
            const { w, v, bus } = crossing();
            const start = bus.getDoc();
            // up by 1500: the wall lies at y = 1500 and crosses the vertical wall
            ok(
                bus.execute('moveWall', {
                    wallId: w,
                    distance: 1500,
                    finalize: false,
                }),
            );
            expect(Object.keys(bus.getDoc().walls)).toHaveLength(2);
            expect(bus.undo()).toBe(true);
            ok(
                bus.execute('moveWall', {
                    wallId: w,
                    distance: 1500,
                    finalize: true,
                }),
            );
            const doc = bus.getDoc();
            expect(Object.keys(doc.walls)).toHaveLength(4);
            const cross = Object.values(doc.nodes).find(
                (n) => n.x === 2500 && n.y === 1500,
            )!;
            expect(cross).toBeDefined();
            expect(doc.walls[w]!.b).toBe(cross.id);
            expect(doc.walls[v]!.b).toBe(cross.id);
            expectUndoRestores(bus, start);
        });

        it('a drag of 200 steps and a finalize that splits is one entry; undo restores the pre-drag document', () => {
            const { w, bus } = crossing();
            const start = bus.getDoc();
            for (let i = 1; i <= 200; i += 1) {
                ok(
                    bus.execute(
                        'moveWall',
                        {
                            wallId: w,
                            distance: (1500 * i) / 200,
                            finalize: false,
                        },
                        { merge: true },
                    ),
                );
            }
            expect(bus.history().undo).toHaveLength(1);
            ok(
                bus.execute(
                    'moveWall',
                    { wallId: w, distance: 1500, finalize: true },
                    { merge: true },
                ),
            );
            expect(bus.history().undo).toHaveLength(1);
            expect(Object.keys(bus.getDoc().walls)).toHaveLength(4);
            bus.seal();
            expectUndoRestores(bus, start);
            expect(bus.redo()).toBe(true);
            expect(Object.keys(bus.getDoc().walls)).toHaveLength(4);
        });
    });
});

// ---- setWallLength -----------------------------------------------------------

describe('setWallLength', () => {
    it('folds the piece a long setWallLength lays over a collinear neighbour into it (property test, sequence 46)', () => {
        const ids = testIds();
        const start = makeGridPlan(3, 3, 3000, ids);
        const bus = planBus(start, ids);
        ok(bus.execute('deleteNode', { nodeId: 'n_0000000002' }));
        const before = bus.getDoc();
        // w11 (3000,9000)-(6000,9000): its `a` end moves out past (0,9000),
        // so the wall now runs over w10, which joins the same two nodes
        ok(
            bus.execute('setWallLength', {
                wallId: 'w_0000000011',
                length: 6827,
                anchor: 'b',
            }),
        );
        const doc = bus.getDoc();
        const known = planErrorKeys(validatePlan(before));
        expect(
            [...planErrorKeys(validatePlan(doc))].filter((k) => !known.has(k)),
        ).toEqual([]);
        expect(doc.walls.w_0000000010).toBeDefined();
        expect(bus.undo()).toBe(true);
        expect(bus.getDoc()).toEqual(before);
    });

    it("anchor 'a' keeps a and moves b; anchor 'b' keeps b and moves a", () => {
        const { g, a, b, w } = oneWall();
        const bus = busOf(g);
        const start = bus.getDoc();
        const r = ok(
            bus.execute('setWallLength', {
                wallId: w,
                length: 3000,
                anchor: 'a',
            }),
        );
        expect(r.result).toEqual({ movedNodeId: b });
        expect(endsOf(bus.getDoc(), w)).toBe('0,0>3000,0');
        expectUndoRestores(bus, start);
        const r2 = ok(
            bus.execute('setWallLength', {
                wallId: w,
                length: 3000,
                anchor: 'b',
            }),
        );
        expect(r2.result).toEqual({ movedNodeId: a });
        expect(endsOf(bus.getDoc(), w)).toBe('2000,0>5000,0');
        expectUndoRestores(bus, start);
    });

    it('works along a diagonal and rounds the new position', () => {
        const g = new Graph();
        const a = g.node(0, 0);
        const b = g.node(3000, 4000);
        const w = g.wall(a, b);
        const bus = busOf(g);
        const start = bus.getDoc();
        ok(
            bus.execute('setWallLength', {
                wallId: w,
                length: 10_000,
                anchor: 'a',
            }),
        );
        expect(at(bus.getDoc(), b)).toEqual([6000, 8000]);
        expectUndoRestores(bus, start);
        ok(
            bus.execute('setWallLength', {
                wallId: w,
                length: 1000.4,
                anchor: 'a',
            }),
        );
        expect(at(bus.getDoc(), b)).toEqual([600, 800]);
    });

    describe("anchor 'auto'", () => {
        // a - b - c - d chain with a stem from c; degrees: a 1, b 2, c 3, d 1
        function chain() {
            const g = new Graph();
            const a = g.node(0, 0);
            const b = g.node(2000, 0);
            const c = g.node(4000, 0);
            const d = g.node(6000, 0);
            const e = g.node(4000, 3000);
            const ab = g.wall(a, b);
            const bc = g.wall(b, c);
            const cd = g.wall(c, d);
            g.wall(c, e);
            return { g, a, b, c, d, ab, bc, cd, bus: busOf(g) };
        }

        it('moves b when deg(b) = 1', () => {
            const { g, c, d, cd } = chain();
            const bus = busOf(g);
            const r = ok(
                bus.execute('setWallLength', {
                    wallId: cd,
                    length: 1000,
                    anchor: 'auto',
                }),
            );
            expect(r.result.movedNodeId).toBe(d);
            expect(at(bus.getDoc(), c)).toEqual([4000, 0]);
            expect(at(bus.getDoc(), d)).toEqual([5000, 0]);
        });

        it('moves a when only deg(a) = 1', () => {
            const { g, a, b, ab } = chain();
            const bus = busOf(g);
            const start = bus.getDoc();
            const r = ok(
                bus.execute('setWallLength', {
                    wallId: ab,
                    length: 1000,
                    anchor: 'auto',
                }),
            );
            expect(r.result.movedNodeId).toBe(a);
            expect(at(bus.getDoc(), a)).toEqual([1000, 0]);
            expect(at(bus.getDoc(), b)).toEqual([2000, 0]);
            expectUndoRestores(bus, start);
        });

        it('moves b when both ends are free, and when neither is', () => {
            const free = oneWall();
            const bus1 = busOf(free.g);
            expect(
                ok(
                    bus1.execute('setWallLength', {
                        wallId: free.w,
                        length: 2000,
                        anchor: 'auto',
                    }),
                ).result.movedNodeId,
            ).toBe(free.b);
            const { g, b, c, bc } = chain();
            const bus2 = busOf(g);
            const r = ok(
                bus2.execute('setWallLength', {
                    wallId: bc,
                    length: 1000,
                    anchor: 'auto',
                }),
            );
            expect(r.result.movedNodeId).toBe(c);
            expect(at(bus2.getDoc(), b)).toEqual([2000, 0]);
            expect(at(bus2.getDoc(), c)).toEqual([3000, 0]);
        });
    });

    it('keeps the distance of each opening to the unmoved end', () => {
        const { g, w } = oneWall();
        const o = g.opening(w, 4000, 900); // 1000 from b
        const bus = busOf(g);
        const start = bus.getDoc();
        // anchor b: a moves, so distances to b are kept
        ok(
            bus.execute('setWallLength', {
                wallId: w,
                length: 3000,
                anchor: 'b',
            }),
        );
        expect(bus.getDoc().openings[o]!.offset).toBe(2000);
        expectUndoRestores(bus, start);
        // anchor a: b moves, offsets are kept
        ok(
            bus.execute('setWallLength', {
                wallId: w,
                length: 4500,
                anchor: 'a',
            }),
        );
        expect(bus.getDoc().openings[o]!.offset).toBe(4000);
    });

    it('shrinking below an opening width aborts opening_no_fit and leaves the document', () => {
        const { g, w } = oneWall();
        g.opening(w, 2500, 900);
        const bus = busOf(g);
        expectRefusedUntouched(
            bus,
            () =>
                bus.execute('setWallLength', {
                    wallId: w,
                    length: 800,
                    anchor: 'a',
                }),
            'opening_no_fit',
        );
    });

    it('refuses an unknown wall and a length out of range', () => {
        const { g, w } = oneWall();
        const bus = busOf(g);
        expectRefusedUntouched(
            bus,
            () =>
                bus.execute('setWallLength', {
                    wallId: 'w_nope',
                    length: 100,
                    anchor: 'a',
                }),
            'not_found',
        );
        const r = refused(
            bus.execute('setWallLength', { wallId: w, length: 9, anchor: 'a' }),
        );
        expect(r.code).toBe('out_of_range');
        expect(r.params).toMatchObject({ field: 'length', min: 10 });
        expectRefusedUntouched(
            bus,
            () =>
                bus.execute('setWallLength', {
                    wallId: w,
                    length: 5_000_000,
                    anchor: 'a',
                }),
            'out_of_range',
        );
        ok(
            bus.execute('setWallLength', {
                wallId: w,
                length: 10,
                anchor: 'a',
            }),
        );
    });

    it('refuses a length whose new position makes another wall at the node too short', () => {
        const g = new Graph();
        const a = g.node(0, 0);
        const b = g.node(5000, 0);
        const c = g.node(5000, 3000);
        const w = g.wall(a, b);
        g.wall(b, c);
        const bus = busOf(g);
        // b moves along a-b; its other wall b-c is 3000 long and stays long enough...
        ok(
            bus.execute('setWallLength', {
                wallId: w,
                length: 4000,
                anchor: 'a',
            }),
        );
        // ...but a position 7 mm from c would not be: c is the end of the wall at b
        const g2 = new Graph();
        const a2 = g2.node(0, 0);
        const b2 = g2.node(5000, 0);
        const c2 = g2.node(3000, 7);
        const w2 = g2.wall(a2, b2);
        g2.wall(b2, c2);
        const bus2 = busOf(g2);
        expectRefusedUntouched(
            bus2,
            () =>
                bus2.execute('setWallLength', {
                    wallId: w2,
                    length: 3000,
                    anchor: 'a',
                }),
            'wall_too_short',
        );
        void c;
    });

    it('a moved end that lands on another node merges into it (the moveNode finalize)', () => {
        const g = new Graph();
        const a = g.node(0, 0);
        const b = g.node(5000, 0);
        const w = g.wall(a, b);
        const t = g.node(3000, 3);
        g.wall(t, g.node(3000, 4000));
        const bus = busOf(g);
        const start = bus.getDoc();
        const r = ok(
            bus.execute('setWallLength', {
                wallId: w,
                length: 3000,
                anchor: 'a',
            }),
        );
        expect(r.result.movedNodeId).toBe(b);
        expect(bus.getDoc().nodes[b]).toBeUndefined();
        expect(bus.getDoc().walls[w]!.b).toBe(t);
        expectUndoRestores(bus, start);
    });

    it('splits what the longer wall now crosses, in one entry', () => {
        const g = new Graph();
        const a = g.node(0, 0);
        const b = g.node(2000, 0);
        const w = g.wall(a, b);
        g.wall(g.node(3000, -1000), g.node(3000, 1000));
        const bus = busOf(g);
        const start = bus.getDoc();
        ok(
            bus.execute('setWallLength', {
                wallId: w,
                length: 4000,
                anchor: 'a',
            }),
        );
        expect(Object.keys(bus.getDoc().walls)).toHaveLength(4);
        expect(bus.history().undo).toHaveLength(1);
        expectUndoRestores(bus, start);
    });

    it('never merges its own wall away: a moved end snapping onto the fixed end is refused', () => {
        // x ends at the fixed node a and leaves at 20 degrees; a 10 mm wall's end
        // is 3.4 mm from x and projects 9.4 mm from its end a
        const g = new Graph();
        const a = g.node(0, 0);
        const b = g.node(5000, 0);
        const w = g.wall(a, b);
        const far = g.node(
            Math.round(3000 * Math.cos(Math.PI / 9)),
            Math.round(3000 * Math.sin(Math.PI / 9)),
        );
        g.wall(a, far);
        const bus = busOf(g);
        const r = refused(
            bus.execute('setWallLength', {
                wallId: w,
                length: 10,
                anchor: 'a',
            }),
        );
        expect(r.code).toBe('wall_too_short');
        expect(r.params).toMatchObject({ wallId: w, length: 0 });
        expect(bus.getDoc()).toBe(g.doc);
        expect(bus.canUndo()).toBe(false);
    });

    it('refuses a moved end that would snap onto a node under 10 mm from the fixed end', () => {
        const g = new Graph();
        const a = g.node(0, 0);
        const b = g.node(5000, 0);
        const w = g.wall(a, b);
        g.wall(g.node(8, 0), g.node(8, 3000));
        const bus = busOf(g);
        const r = refused(
            bus.execute('setWallLength', {
                wallId: w,
                length: 12,
                anchor: 'a',
            }),
        );
        expect(r.code).toBe('wall_too_short');
        expect(r.params).toMatchObject({ wallId: w, length: 8 });
        expect(bus.getDoc()).toBe(g.doc);
    });

    it('reports a length that would leave the coordinate range as out_of_range on length', () => {
        const g = new Graph();
        const a = g.node(900_000, 0);
        const b = g.node(901_000, 0);
        const w = g.wall(a, b);
        const bus = busOf(g);
        const r = refused(
            bus.execute('setWallLength', {
                wallId: w,
                length: 200_000,
                anchor: 'a',
            }),
        );
        expect(r.code).toBe('out_of_range');
        expect(r.params).toEqual({
            field: 'length',
            min: 10,
            max: 100_000,
        });
        ok(
            bus.execute('setWallLength', {
                wallId: w,
                length: 100_000,
                anchor: 'a',
            }),
        );
        expect(at(bus.getDoc(), b)).toEqual([1_000_000, 0]);
    });

    it('does not merge consecutive edits into one entry', () => {
        const { g, w } = oneWall();
        const bus = busOf(g);
        ok(
            bus.execute(
                'setWallLength',
                { wallId: w, length: 4000, anchor: 'a' },
                { merge: true },
            ),
        );
        ok(
            bus.execute(
                'setWallLength',
                { wallId: w, length: 3000, anchor: 'a' },
                { merge: true },
            ),
        );
        expect(bus.history().undo).toHaveLength(2);
    });
});

// ---- random drag sequences ---------------------------------------------------

/** Many drags with a full validation each take a few seconds. */
const SIM_TIMEOUT = 60_000;

describe('random drag sequences', () => {
    function simulate(seed: number, iterations: number) {
        const rand = mulberry32(seed);
        const int = (n: number) => Math.floor(rand() * n);
        const pick = <T>(items: T[]): T => items[int(items.length)]!;
        const ids = testIds();
        const start = makeGridPlan(3, 3, 3000, ids);
        const bus = planBus(start, ids);
        // docs[i]: the document with i entries applied
        const docs: PlanDocument[] = [start];
        const stats = {
            drags: 0,
            merged: 0,
            finalized: 0,
            undos: 0,
            redos: 0,
            split: 0,
        };

        const record = (): void => {
            const entries = bus.history().undo.length;
            docs.length = entries + 1;
            docs[entries] = bus.getDoc();
        };

        const checkNoNewErrors = (before: PlanDocument): void => {
            const known = planErrorKeys(validatePlan(before));
            for (const key of planErrorKeys(validatePlan(bus.getDoc()))) {
                expect(known.has(key)).toBe(true);
            }
        };

        const step = (
            run: (finalize: boolean) => ExecuteResult<unknown>,
            finalize: boolean,
        ) => {
            const before = bus.getDoc();
            const r = run(finalize);
            if (!r.ok) expect(bus.getDoc()).toBe(before);
            return r;
        };

        for (let iteration = 0; iteration < iterations; iteration += 1) {
            const roll = rand();
            if (roll < 0.62) {
                stats.drags += 1;
                const before = bus.getDoc();
                const nodeIds = Object.keys(before.nodes).sort();
                const wallIds = Object.keys(before.walls).sort();
                const nodeDrag = rand() < 0.6;
                const nodeId = pick(nodeIds);
                const wallId = pick(wallIds);
                const home = before.nodes[nodeId]!;
                // the drop point sometimes sits on another node or a wall
                const near =
                    rand() < 0.35 ? before.nodes[pick(nodeIds)]! : null;
                const target = near
                    ? { x: near.x + int(7) - 3, y: near.y + int(7) - 3 }
                    : {
                          x: home.x + int(1801) - 900,
                          y: home.y + int(1801) - 900,
                      };
                const distance = int(2201) - 1100;
                const steps = 1 + int(6);
                const moveStep = (i: number, finalize: boolean) =>
                    nodeDrag
                        ? bus.execute(
                              'moveNode',
                              {
                                  nodeId,
                                  to: finalize
                                      ? target
                                      : {
                                            x:
                                                home.x +
                                                ((target.x - home.x) * i) /
                                                    steps,
                                            y:
                                                home.y +
                                                ((target.y - home.y) * i) /
                                                    steps,
                                        },
                                  finalize,
                              },
                              { merge: true },
                          )
                        : bus.execute(
                              'moveWall',
                              {
                                  wallId,
                                  distance: finalize
                                      ? distance
                                      : (distance * i) / steps,
                                  finalize,
                              },
                              { merge: true },
                          );
                for (let i = 1; i <= steps; i += 1) {
                    step(() => moveStep(i, false), false);
                }
                if (rand() < 0.8) {
                    stats.finalized += 1;
                    const r = step(() => moveStep(steps, true), true);
                    if (r.ok) {
                        const result = r.result as
                            { mergedInto?: string | null } | undefined;
                        if (result?.mergedInto) stats.merged += 1;
                        if (
                            Object.keys(bus.getDoc().walls).length >
                            Object.keys(before.walls).length
                        ) {
                            stats.split += 1;
                        }
                        checkNoNewErrors(before);
                    }
                }
                if (rand() < 0.85) bus.seal();
                record();
            } else if (roll < 0.82) {
                if (bus.canUndo()) {
                    stats.undos += 1;
                    expect(bus.undo()).toBe(true);
                    expect(bus.getDoc()).toEqual(
                        docs[bus.history().undo.length],
                    );
                }
            } else if (bus.canRedo()) {
                stats.redos += 1;
                expect(bus.redo()).toBe(true);
                expect(bus.getDoc()).toEqual(docs[bus.history().undo.length]);
            }
        }
        return { bus, docs, stats };
    }

    it(
        'undo and redo reproduce every recorded document, interleaved with finalized drags',
        () => {
            const { bus, docs, stats } = simulate(20261021, 50);
            // the generator really reaches what it tests
            expect(stats.finalized).toBeGreaterThan(10);
            expect(stats.undos).toBeGreaterThan(3);
            expect(stats.redos).toBeGreaterThan(0);
            expect(stats.merged + stats.split).toBeGreaterThan(0);
            // rewind everything
            expect(bus.history().undo.length).toBe(docs.length - 1);
            for (let i = bus.history().undo.length - 1; i >= 0; i -= 1) {
                expect(bus.undo()).toBe(true);
                expect(bus.getDoc()).toEqual(docs[i]);
            }
            expect(bus.canUndo()).toBe(false);
            expect(bus.getDoc()).toEqual(docs[0]);
        },
        SIM_TIMEOUT,
    );

    it(
        'more seeds: undo all, redo all',
        () => {
            let reached = 0;
            for (const seed of [1, 2, 3]) {
                const { bus, docs, stats } = simulate(seed, 30);
                reached += stats.merged + stats.split;
                const end = bus.getDoc();
                while (bus.undo()) {
                    /* back to the start */
                }
                expect(bus.getDoc()).toEqual(docs[0]);
                while (bus.redo()) {
                    /* forward again */
                }
                expect(bus.getDoc()).toEqual(end);
            }
            expect(reached).toBeGreaterThan(0);
        },
        SIM_TIMEOUT,
    );
});
