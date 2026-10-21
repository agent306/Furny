import { describe, expect, it } from 'vitest';
import type { ExecuteResult } from '../../../commands/types';
import { cyrb53 } from '../../../geometry/hash';
import type { PlanDocument } from '../../schema';
import { FOOTPRINT, Graph, busOf, ok, refused } from '../../testing/graph';
import { definePlanCommand } from '../define';
import { mayAddNoWall, type PlanFragment } from '../fragment';
import { PLAN_COMMANDS, createPlanBus } from '../registry';

// ---- fixtures ----------------------------------------------------------------

type Bus = ReturnType<typeof busOf>;

const at = (doc: PlanDocument, id: string): [number, number] => [
    doc.nodes[id]!.x,
    doc.nodes[id]!.y,
];

const lengthOf = (doc: PlanDocument, id: string): number => {
    const w = doc.walls[id]!;
    return Math.hypot(
        doc.nodes[w.b]!.x - doc.nodes[w.a]!.x,
        doc.nodes[w.b]!.y - doc.nodes[w.a]!.y,
    );
};

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
    const error = refused(run());
    expect(error.code).toBe(code);
    expect(bus.getDoc()).toBe(before);
    expect(bus.history().undo.length).toBe(entries);
    return error;
}

/**
 * A closed 5000 x 3000 room, nodes clockwise from (0,0), walls top, right,
 * bottom, left; a door on the top wall and a window on the right wall.
 */
function room() {
    const g = new Graph();
    const n1 = g.node(0, 0);
    const n2 = g.node(5000, 0);
    const n3 = g.node(5000, 3000);
    const n4 = g.node(0, 3000);
    const top = g.wall(n1, n2);
    const right = g.wall(n2, n3);
    const bottom = g.wall(n3, n4);
    const left = g.wall(n4, n1);
    const door = g.opening(top, 1000, 900);
    const window = g.opening(right, 1500, 1200, {
        kind: 'window',
        type: 'casement',
        sillHeight: 900,
        height: 1200,
    });
    return {
        g,
        nodes: [n1, n2, n3, n4] as const,
        walls: [top, right, bottom, left] as const,
        top,
        right,
        bottom,
        left,
        door,
        window,
    };
}

// ---- registry ----------------------------------------------------------------

describe('registry', () => {
    it('completes PLAN_COMMANDS with the four selection-wide commands (43 in all)', () => {
        expect(Object.keys(PLAN_COMMANDS)).toHaveLength(43);
        for (const [name, label, mode] of [
            ['translateEntities', 'translate_entities', 'replace'],
            ['nudgeEntities', 'nudge_entities', 'compose'],
            ['insertFragment', 'insert_fragment', undefined],
            ['deleteEntities', 'delete_entities', undefined],
        ] as const) {
            const def = PLAN_COMMANDS[name];
            expect(def.type).toBe(name);
            expect(def.labelKey).toBe(`engine.plan.command.label.${label}`);
            expect(def.paramsSchema).toBeDefined();
            expect(def.touchesGeometry).toBe(true);
            expect(def.mergeMode).toBe(mode);
        }
    });

    it('keys translate and nudge merges by cyrb53 of the sorted ids joined by commas', () => {
        const hash = cyrb53('t_2,w_1');
        expect(
            PLAN_COMMANDS.translateEntities.mergeKey?.({
                ids: ['w_1', 't_2', 'w_1'],
                dx: 1,
                dy: 2,
                finalize: false,
            }),
        ).toBe(`translate:${hash}`);
        expect(
            PLAN_COMMANDS.nudgeEntities.mergeKey?.({
                ids: ['t_2', 'w_1'],
                dx: 1,
                dy: 2,
            }),
        ).toBe(`nudge:${hash}`);
        expect(PLAN_COMMANDS.insertFragment.mergeKey).toBeUndefined();
        expect(PLAN_COMMANDS.deleteEntities.mergeKey).toBeUndefined();
    });
});

// ---- translateEntities -------------------------------------------------------

describe('translateEntities', () => {
    it('moves each node of the selected walls once and stretches the walls shared with unselected ones', () => {
        const r = room();
        const bus = busOf(r.g);
        const start = bus.getDoc();
        const [n1, n2, n3, n4] = r.nodes;
        // n1 is both selected and an end of the selected wall: it moves once
        ok(
            bus.execute('translateEntities', {
                ids: [r.top, n1],
                dx: 0,
                dy: -500,
                finalize: false,
            }),
        );
        const doc = bus.getDoc();
        expect(at(doc, n1)).toEqual([0, -500]);
        expect(at(doc, n2)).toEqual([5000, -500]);
        expect(at(doc, n3)).toEqual([5000, 3000]);
        expect(at(doc, n4)).toEqual([0, 3000]);
        expect(lengthOf(doc, r.right)).toBe(3500);
        expect(lengthOf(doc, r.left)).toBe(3500);
        expect(bus.history().undo).toHaveLength(1);
        expectUndoRestores(bus, start);
    });

    it('moves openings implicitly: same offset on a moved wall, distance to the fixed end kept on a stretched one', () => {
        const r = room();
        const bus = busOf(r.g);
        ok(
            bus.execute('translateEntities', {
                ids: [r.top],
                dx: 0,
                dy: -500,
                finalize: false,
            }),
        );
        const doc = bus.getDoc();
        expect(doc.openings[r.door]!.offset).toBe(1000);
        expect(doc.openings[r.door]!.wallId).toBe(r.top);
        // the right wall's `a` moved: 3500 - (3000 - 1500)
        expect(doc.openings[r.window]!.offset).toBe(2000);
    });

    it('moves a RoomMeta anchor only when every wall of its face moves', () => {
        const r = room();
        const meta = r.g.meta('Living', 2500, 1500);
        const bus = busOf(r.g);
        ok(
            bus.execute('translateEntities', {
                ids: [r.top],
                dx: 0,
                dy: -500,
                finalize: false,
            }),
        );
        expect(bus.getDoc().rooms[meta]!.anchor).toEqual({ x: 2500, y: 1500 });
        bus.seal();
        ok(
            bus.execute('translateEntities', {
                ids: [...r.walls],
                dx: 1000,
                dy: 0,
                finalize: false,
            }),
        );
        expect(bus.getDoc().rooms[meta]!.anchor).toEqual({ x: 3500, y: 1500 });
    });

    it('moves free placements, fixtures, labels, free dimensions and an unlocked background', () => {
        const r = room();
        const free = r.g.ids('f');
        r.g.doc.placements[free] = {
            id: free,
            designId: 'des_x',
            x: 2000,
            y: 2000,
            rotation: 0,
            elevation: 0,
            mirrored: false,
            wallAttachment: null,
        };
        const fixture = r.g.ids('x');
        r.g.doc.fixtures[fixture] = {
            id: fixture,
            libraryKey: 'wc',
            x: 4000,
            y: 2500,
            rotation: 0,
            width: 400,
            depth: 700,
            height: 800,
            elevation: 0,
            label: null,
        };
        const label = r.g.ids('t');
        r.g.doc.annotations.labels[label] = {
            id: label,
            position: { x: 100, y: 200 },
            text: 'Hall',
            fontSize: 250,
            rotation: 0,
        };
        const dim = r.g.ids('d');
        r.g.doc.annotations.dimensions[dim] = {
            id: dim,
            a: { x: 0, y: 4000 },
            b: { x: 5000, y: 4000 },
            offset: 300,
            attachedTo: null,
        };
        r.g.background({ position: { x: 10, y: 20 } });
        const bus = busOf(r.g);
        const start = bus.getDoc();
        ok(
            bus.execute('translateEntities', {
                ids: [free, fixture, label, dim, 'background'],
                dx: 100.4,
                dy: -50,
                finalize: true,
            }),
        );
        const doc = bus.getDoc();
        expect([doc.placements[free]!.x, doc.placements[free]!.y]).toEqual([
            2100, 1950,
        ]);
        expect([doc.fixtures[fixture]!.x, doc.fixtures[fixture]!.y]).toEqual([
            4100, 2450,
        ]);
        expect(doc.annotations.labels[label]!.position).toEqual({
            x: 200,
            y: 150,
        });
        expect(doc.annotations.dimensions[dim]!.a).toEqual({ x: 100, y: 3950 });
        expect(doc.annotations.dimensions[dim]!.b).toEqual({
            x: 5100,
            y: 3950,
        });
        expect(doc.background!.position).toEqual({ x: 110, y: -30 });
        expect(doc.nodes).toEqual(start.nodes);
        expectUndoRestores(bus, start);
    });

    it('moves a RoomMeta anchor with a merged drag of its whole room, measured from the drag start each step', () => {
        const r = room();
        const meta = r.g.meta('Living', 2500, 1500);
        const bus = busOf(r.g);
        const start = bus.getDoc();
        for (const dx of [100, 250, 400]) {
            ok(
                bus.execute(
                    'translateEntities',
                    { ids: [...r.walls], dx, dy: 0, finalize: dx === 400 },
                    { merge: true },
                ),
            );
            // a replace re-run on the start document: not 100 + 250 + ...
            expect(bus.getDoc().rooms[meta]!.anchor).toEqual({
                x: 2500 + dx,
                y: 1500,
            });
        }
        expect(bus.history().undo).toHaveLength(1);
        expectUndoRestores(bus, start);
    });

    it('gives a replace re-run the geometry of the drag start (ctx.geometry of the base document)', () => {
        const r = room();
        const seen: PlanDocument[] = [];
        const probe = definePlanCommand<{ v: number }>({
            type: 'probe',
            labelKey: 'probe',
            validate: () => null,
            run(d, p, ctx) {
                seen.push(ctx.geometry.docRef);
                d.meta.floorThickness = p.v;
            },
            mergeKey: () => 'probe',
            mergeMode: 'replace',
            touchesGeometry: false,
        });
        const bus = createPlanBus({
            initial: r.g.doc,
            footprints: () => FOOTPRINT,
            newId: r.g.ids,
            registry: { ...PLAN_COMMANDS, probe },
        });
        const start = bus.getDoc();
        for (const v of [10, 20, 30]) {
            ok(bus.execute('probe', { v }, { merge: true }));
        }
        expect(seen).toHaveLength(3);
        expect(seen[0]).toBe(start);
        // the re-runs see the drag start again, not the previous step
        for (const doc of seen.slice(1)) expect(doc).toEqual(start);
    });

    it('moves only the unattached dimensions of a selection; an attached one stays with its wall', () => {
        const r = room();
        // a wall of its own, away from the room the selection moves
        const far = r.g.wall(r.g.node(10_000, 0), r.g.node(14_000, 0));
        const attached = r.g.dimension(far, 'left');
        const bus = busOf(r.g);
        const before = bus.getDoc();
        ok(
            bus.execute('translateEntities', {
                ids: [attached, r.top],
                dx: 0,
                dy: -500,
                finalize: false,
            }),
        );
        expect(bus.getDoc().annotations.dimensions[attached]).toEqual(
            before.annotations.dimensions[attached],
        );
    });

    it('leaves a locked background where it is', () => {
        const r = room();
        r.g.background({ locked: true, position: { x: 10, y: 20 } });
        const bus = busOf(r.g);
        ok(
            bus.execute('translateEntities', {
                ids: [r.top, 'background'],
                dx: 0,
                dy: -100,
                finalize: false,
            }),
        );
        expect(bus.getDoc().background!.position).toEqual({ x: 10, y: 20 });
        expect(at(bus.getDoc(), r.nodes[0])).toEqual([0, -100]);
    });

    it('lets a placement attached to a moved wall follow the wall, and detaches a selected one whose wall stays', () => {
        const r = room();
        // the top wall's right face (y = +57.5) is the room side
        const onTop = r.g.placement(r.top, 'right', 2500, 58);
        const onBottom = r.g.placement(r.bottom, 'left', 2500, 2942);
        const bus = busOf(r.g);
        const before = bus.getDoc();
        ok(
            bus.execute('translateEntities', {
                ids: [r.top, onTop, onBottom],
                dx: 0,
                dy: -500,
                finalize: false,
            }),
        );
        const doc = bus.getDoc();
        expect(doc.placements[onTop]!.wallAttachment).toEqual({
            wallId: r.top,
            side: 'right',
        });
        // stands on the moved face, y = -500 + 57.5, rounded half away from zero
        expect(doc.placements[onTop]!.y).toBe(-443);
        expect(doc.placements[onTop]!.x).toBe(before.placements[onTop]!.x);
        expect(doc.placements[onBottom]!.wallAttachment).toBeNull();
        expect(doc.placements[onBottom]!.y).toBe(2442);
    });

    it('with finalize merges a moved node into an unmoved node within 5 mm, without finalize it does not', () => {
        const g = new Graph();
        const n1 = g.node(0, 0);
        const n2 = g.node(3000, 0);
        const n3 = g.node(4000, 2000);
        const n4 = g.node(4000, 5000);
        g.wall(n1, n2);
        const moving = g.wall(n3, n4);
        const bus = busOf(g);
        const start = bus.getDoc();
        // n3 lands at (3003, 2): 3.6 mm from n2
        const params = { ids: [moving], dx: -997, dy: -1998 };
        ok(bus.execute('translateEntities', { ...params, finalize: false }));
        expect(bus.getDoc().nodes[n3]).toBeDefined();
        expect(at(bus.getDoc(), n3)).toEqual([3003, 2]);

        const r = ok(
            bus.execute(
                'translateEntities',
                { ...params, finalize: true },
                { merge: true },
            ),
        );
        const doc = bus.getDoc();
        expect(bus.history().undo).toHaveLength(1);
        expect(doc.nodes[n3]).toBeUndefined();
        expect(doc.walls[moving]!.a).toBe(n2);
        expect(at(doc, n2)).toEqual([3000, 0]);
        expect(at(doc, n4)).toEqual([3003, 3002]);
        expect(r.deletedIds).toContain(n3);
        expectUndoRestores(bus, start);
    });

    it('with finalize splits the walls a moved wall now crosses', () => {
        const g = new Graph();
        const a = g.node(0, 0);
        const b = g.node(4000, 0);
        const fixed = g.wall(a, b);
        const c = g.node(2000, 1000);
        const d = g.node(2000, 3000);
        const moving = g.wall(c, d);
        const bus = busOf(g);
        ok(
            bus.execute('translateEntities', {
                ids: [moving],
                dx: 0,
                dy: -2000,
                finalize: true,
            }),
        );
        const doc = bus.getDoc();
        expect(Object.keys(doc.walls)).toHaveLength(4);
        expect(lengthOf(doc, fixed)).toBe(2000);
        expect(lengthOf(doc, moving)).toBe(1000);
    });

    it('refuses an unknown id, an id with an unknown prefix and a missing background with not_found', () => {
        const r = room();
        const bus = busOf(r.g);
        for (const id of ['w_zzzzzzzzzz', 'q_0000000001', 'background']) {
            const error = expectRefusedUntouched(
                bus,
                () =>
                    bus.execute('translateEntities', {
                        ids: [r.top, id],
                        dx: 10,
                        dy: 0,
                        finalize: false,
                    }),
                'not_found',
            );
            expect(error.params).toEqual({ id });
        }
    });

    it('refuses a stretched wall under 10 mm with wall_too_short', () => {
        const r = room();
        const bus = busOf(r.g);
        const error = expectRefusedUntouched(
            bus,
            () =>
                bus.execute('translateEntities', {
                    ids: [r.top],
                    dx: 0,
                    dy: 2995,
                    finalize: false,
                }),
            'wall_too_short',
        );
        expect(error.params).toEqual({ wallId: r.right, length: 5 });
    });

    it('refuses a move out of the coordinate range and a shift beyond it with out_of_range', () => {
        const r = room();
        const bus = busOf(r.g);
        const error = expectRefusedUntouched(
            bus,
            () =>
                bus.execute('translateEntities', {
                    ids: [r.top],
                    dx: 999_000,
                    dy: 0,
                    finalize: false,
                }),
            'out_of_range',
        );
        expect(error.params).toEqual({
            field: 'position.x',
            min: -1_000_000,
            max: 1_000_000,
        });
        expect(
            refused(
                bus.execute('translateEntities', {
                    ids: [r.top],
                    dx: 0,
                    dy: 2_000_001,
                    finalize: false,
                }),
            ).params,
        ).toEqual({ field: 'dy', min: -2_000_000, max: 2_000_000 });
    });

    it('merges a drag into one entry (replace) and drops a zero move', () => {
        const r = room();
        const bus = busOf(r.g);
        const start = bus.getDoc();
        for (let i = 1; i <= 20; i += 1) {
            ok(
                bus.execute(
                    'translateEntities',
                    { ids: [r.top], dx: 0, dy: -10 * i, finalize: i === 20 },
                    { merge: true },
                ),
            );
        }
        expect(bus.history().undo).toHaveLength(1);
        expect(at(bus.getDoc(), r.nodes[0])).toEqual([0, -200]);
        expectUndoRestores(bus, start);
        ok(
            bus.execute('translateEntities', {
                ids: [r.top],
                dx: 0,
                dy: 0,
                finalize: true,
            }),
        );
        expect(bus.history().undo).toHaveLength(0);
    });
});

// ---- nudgeEntities -----------------------------------------------------------

describe('nudgeEntities', () => {
    it('composes ten nudges into one entry; after seal the next nudge starts a new one (04 §6.8)', () => {
        const r = room();
        const bus = busOf(r.g);
        const start = bus.getDoc();
        for (let i = 0; i < 10; i += 1) {
            ok(
                bus.execute(
                    'nudgeEntities',
                    { ids: [r.top], dx: 0, dy: -10 },
                    { merge: true },
                ),
            );
        }
        expect(bus.history().undo).toHaveLength(1);
        expect(bus.history().undo[0]!.mergeMode).toBe('compose');
        expect(at(bus.getDoc(), r.nodes[0])).toEqual([0, -100]);
        const afterBurst = bus.getDoc();

        bus.seal();
        ok(
            bus.execute(
                'nudgeEntities',
                { ids: [r.top], dx: 0, dy: -10 },
                { merge: true },
            ),
        );
        expect(bus.history().undo).toHaveLength(2);
        expect(at(bus.getDoc(), r.nodes[0])).toEqual([0, -110]);

        expectUndoRestores(bus, afterBurst);
        expectUndoRestores(bus, start);
    });

    it('finalizes every step: a nudge onto an unmoved node merges into it', () => {
        const g = new Graph();
        const n1 = g.node(0, 0);
        const n2 = g.node(3000, 0);
        const n3 = g.node(3008, 1000);
        const n4 = g.node(3008, 3000);
        g.wall(n1, n2);
        const moving = g.wall(n3, n4);
        const bus = busOf(g);
        ok(bus.execute('nudgeEntities', { ids: [moving], dx: -5, dy: -998 }));
        expect(bus.getDoc().walls[moving]!.a).toBe(n2);
        expect(bus.getDoc().nodes[n3]).toBeUndefined();
    });
});

// ---- insertFragment ----------------------------------------------------------

const emptyFragment = (): PlanFragment => ({
    nodes: {},
    walls: {},
    openings: {},
    placements: {},
    fixtures: {},
    dimensions: {},
    labels: {},
    rooms: {},
});

/** The whole of a room world as a fragment, as the editor's copy produces it. */
function fragmentOf(doc: PlanDocument): PlanFragment {
    return {
        nodes: doc.nodes,
        walls: doc.walls,
        openings: doc.openings,
        placements: doc.placements,
        fixtures: doc.fixtures,
        dimensions: doc.annotations.dimensions,
        labels: doc.annotations.labels,
        rooms: doc.rooms,
    };
}

describe('insertFragment', () => {
    /** A room with one of everything, copied into a fragment. */
    function copiedRoom() {
        const r = room();
        r.g.placement(r.top, 'right', 2500, 58);
        const fixture = r.g.ids('x');
        r.g.doc.fixtures[fixture] = {
            id: fixture,
            libraryKey: 'wc',
            x: 4000,
            y: 2500,
            rotation: 90,
            width: 400,
            depth: 700,
            height: 800,
            elevation: 0,
            label: 'WC',
        };
        const label = r.g.ids('t');
        r.g.doc.annotations.labels[label] = {
            id: label,
            position: { x: 100, y: 200 },
            text: 'Hall',
            fontSize: 250,
            rotation: 0,
        };
        const free = r.g.ids('d');
        r.g.doc.annotations.dimensions[free] = {
            id: free,
            a: { x: 0, y: 4000 },
            b: { x: 5000, y: 4000 },
            offset: 300,
            attachedTo: null,
        };
        r.g.dimension(r.bottom, 'left');
        r.g.meta('Living', 2500, 1500);
        return { r, fragment: fragmentOf(r.g.doc) };
    }

    it('remaps every id (idMap covers all) and offsets every coordinate', () => {
        const { r, fragment } = copiedRoom();
        const bus = busOf(r.g);
        const start = bus.getDoc();
        const result = ok(
            bus.execute('insertFragment', { fragment, dx: 10_000, dy: 500 }),
        ).result;
        const { idMap } = result;
        const old = [
            ...Object.keys(fragment.nodes),
            ...Object.keys(fragment.walls),
            ...Object.keys(fragment.openings),
            ...Object.keys(fragment.placements),
            ...Object.keys(fragment.fixtures),
            ...Object.keys(fragment.dimensions),
            ...Object.keys(fragment.labels),
            ...Object.keys(fragment.rooms),
        ];
        expect(Object.keys(idMap).sort()).toEqual([...old].sort());
        for (const id of old) {
            expect(idMap[id]).not.toBe(id);
            expect(idMap[id]!.slice(0, 2)).toBe(id.slice(0, 2));
        }
        const doc = bus.getDoc();
        for (const [id, node] of Object.entries(fragment.nodes)) {
            expect(at(doc, idMap[id]!)).toEqual([
                node.x + 10_000,
                node.y + 500,
            ]);
        }
        for (const [id, wall] of Object.entries(fragment.walls)) {
            const pasted = doc.walls[idMap[id]!]!;
            expect([pasted.a, pasted.b]).toEqual([
                idMap[wall.a],
                idMap[wall.b],
            ]);
            expect(pasted.thickness).toBe(wall.thickness);
        }
        const door = doc.openings[idMap[r.door]!]!;
        expect(door.wallId).toBe(idMap[r.top]);
        expect(door.offset).toBe(1000);
        const [fixtureId] = Object.keys(fragment.fixtures);
        expect(doc.fixtures[idMap[fixtureId!]!]).toMatchObject({
            x: 14_000,
            y: 3000,
            rotation: 90,
            label: 'WC',
        });
        const [labelId] = Object.keys(fragment.labels);
        expect(doc.annotations.labels[idMap[labelId!]!]!.position).toEqual({
            x: 10_100,
            y: 700,
        });
        const [placementId] = Object.keys(fragment.placements);
        const placement = doc.placements[idMap[placementId!]!]!;
        expect(placement.wallAttachment).toEqual({
            wallId: idMap[r.top],
            side: 'right',
        });
        expect([placement.x, placement.y]).toEqual([12_500, 558]);
        for (const [id, dim] of Object.entries(fragment.dimensions)) {
            const pasted = doc.annotations.dimensions[idMap[id]!]!;
            if (dim.attachedTo === null) {
                expect(pasted.a).toEqual({ x: 10_000, y: 4500 });
                expect(pasted.attachedTo).toBeNull();
            } else {
                expect(pasted.attachedTo).toEqual({
                    kind: 'wall',
                    wallId: idMap[r.bottom],
                    face: 'left',
                });
            }
        }
        const [metaId] = Object.keys(fragment.rooms);
        expect(doc.rooms[idMap[metaId!]!]!.anchor).toEqual({
            x: 12_500,
            y: 2000,
        });
        // the original is untouched
        for (const id of old) {
            if (id.startsWith('n_'))
                expect(doc.nodes[id]).toEqual(start.nodes[id]);
        }
        expectUndoRestores(bus, start);
    });

    it('splits an existing wall a pasted wall crosses, and splits the pasted wall too', () => {
        const g = new Graph();
        const a = g.node(0, 0);
        const b = g.node(6000, 0);
        const existing = g.wall(a, b);
        const src = new Graph();
        const p = src.node(3000, -2000);
        const q = src.node(3000, 2000);
        const pastedWall = src.wall(p, q);
        const fragment = { ...emptyFragment(), ...fragmentOf(src.doc) };
        const bus = busOf(g);
        const { idMap } = ok(
            bus.execute('insertFragment', { fragment, dx: 0, dy: 0 }),
        ).result;
        const doc = bus.getDoc();
        expect(Object.keys(doc.walls)).toHaveLength(4);
        const middle = Object.values(doc.nodes).find(
            (n) => n.x === 3000 && n.y === 0,
        )!;
        const around = Object.values(doc.walls).filter(
            (w) => w.a === middle.id || w.b === middle.id,
        );
        expect(around).toHaveLength(4);
        expect(lengthOf(doc, existing)).toBe(3000);
        expect(lengthOf(doc, idMap[pastedWall]!)).toBe(2000);
    });

    it('joins a pasted wall end to an existing node and makes a T on an existing wall', () => {
        const g = new Graph();
        const a = g.node(0, 0);
        const b = g.node(6000, 0);
        const existing = g.wall(a, b);
        const src = new Graph();
        // (0, 2) is within 5 mm of node a; (2000, 1) lies on the existing wall
        const p = src.node(0, 2);
        const q = src.node(0, 3000);
        const r = src.node(2000, 1);
        const s = src.node(2000, 3000);
        src.wall(p, q);
        src.wall(r, s);
        const bus = busOf(g);
        const { idMap } = ok(
            bus.execute('insertFragment', {
                fragment: fragmentOf(src.doc),
                dx: 0,
                dy: 0,
            }),
        ).result;
        const doc = bus.getDoc();
        expect(idMap[p]).toBe(a);
        expect(at(doc, idMap[r]!)).toEqual([2000, 0]);
        expect(lengthOf(doc, existing)).toBe(2000);
        expect(Object.keys(doc.walls)).toHaveLength(4);
    });

    it('drops an opening whose wall an existing wall fully covers, with the fragment_opening_dropped warning', () => {
        const g = new Graph();
        const a = g.node(0, 0);
        const b = g.node(6000, 0);
        g.wall(a, b);
        const src = new Graph();
        const p = src.node(1000, 0);
        const q = src.node(4000, 0);
        const w = src.wall(p, q);
        const door = src.opening(w, 1500, 900);
        const bus = busOf(g);
        const start = bus.getDoc();
        const r = ok(
            bus.execute('insertFragment', {
                fragment: fragmentOf(src.doc),
                dx: 0,
                dy: 0,
            }),
        );
        expect(r.warnings).toEqual([
            {
                code: 'fragment_opening_dropped',
                messageKey: 'engine.plan.command.fragment_opening_dropped',
                params: { openingId: door },
            },
        ]);
        expect(r.result.idMap).toEqual({});
        // nothing was pasted, and the wall under it was not split
        expect(bus.getDoc()).toEqual(start);
        expect(bus.history().undo).toHaveLength(0);
    });

    it('pastes the uncovered part of a partly covered wall, with only the openings on that part', () => {
        const g = new Graph();
        const a = g.node(0, 0);
        const b = g.node(6000, 0);
        const existing = g.wall(a, b);
        const src = new Graph();
        const p = src.node(1000, 0);
        const q = src.node(8000, 0);
        const w = src.wall(p, q);
        // centred at x = 2500 (covered) and x = 7000 (pasted)
        const covered = src.opening(w, 1500, 900);
        const kept = src.opening(w, 6000, 900);
        const bus = busOf(g);
        const r = ok(
            bus.execute('insertFragment', {
                fragment: fragmentOf(src.doc),
                dx: 0,
                dy: 0,
            }),
        );
        const { idMap } = r.result;
        const doc = bus.getDoc();
        expect(r.warnings.map((m) => m.params)).toEqual([
            { openingId: covered },
        ]);
        const piece = idMap[w]!;
        expect(at(doc, doc.walls[piece]!.a)).toEqual([6000, 0]);
        expect(at(doc, doc.walls[piece]!.b)).toEqual([8000, 0]);
        expect(doc.openings[idMap[kept]!]).toMatchObject({
            wallId: piece,
            offset: 1000,
        });
        expect(idMap[covered]).toBeUndefined();
        // the existing wall was split where the pasted wall starts, and got no opening
        expect(lengthOf(doc, existing)).toBe(1000);
        expect(Object.keys(doc.openings)).toEqual([idMap[kept]]);
    });

    it('refuses a wall end missing from the fragment with not_found, and a paste out of range with out_of_range', () => {
        const g = new Graph();
        const bus = busOf(g);
        const src = new Graph();
        const p = src.node(0, 0);
        const q = src.node(1000, 0);
        src.wall(p, q);
        const fragment = fragmentOf(src.doc);
        expect(
            expectRefusedUntouched(
                bus,
                () =>
                    bus.execute('insertFragment', {
                        fragment: {
                            ...fragment,
                            nodes: { [p]: fragment.nodes[p]! },
                        },
                        dx: 0,
                        dy: 0,
                    }),
                'not_found',
            ).params,
        ).toEqual({ id: q });
        expectRefusedUntouched(
            bus,
            () =>
                bus.execute('insertFragment', {
                    fragment,
                    dx: 999_500,
                    dy: 0,
                }),
            'out_of_range',
        );
    });

    it('refuses a fragment record whose key is not its id with invalid_params', () => {
        const bus = busOf(new Graph());
        const src = new Graph();
        const p = src.node(0, 0);
        expectRefusedUntouched(
            bus,
            () =>
                bus.execute('insertFragment', {
                    fragment: {
                        ...emptyFragment(),
                        nodes: { n_zzzzzzzzzz: src.doc.nodes[p]! },
                    },
                    dx: 0,
                    dy: 0,
                }),
            'invalid_params',
        );
    });
});

// ---- deleteEntities ----------------------------------------------------------

describe('deleteEntities', () => {
    it('deletes mixed ids walls first, never twice, with their cascades', () => {
        const r = room();
        const attached = r.g.placement(r.top, 'right', 2500, 58);
        const kept = r.g.placement(r.right, 'left', 4942, 1500);
        const label = r.g.ids('t');
        r.g.doc.annotations.labels[label] = {
            id: label,
            position: { x: 100, y: 200 },
            text: 'Hall',
            fontSize: 250,
            rotation: 0,
        };
        const dim = r.g.dimension(r.top, 'right');
        r.g.background();
        const bus = busOf(r.g);
        const start = bus.getDoc();
        const result = ok(
            bus.execute('deleteEntities', {
                ids: ['background', label, attached, r.door, r.top, r.top],
            }),
        ).result;
        const doc = bus.getDoc();
        expect(doc.walls[r.top]).toBeUndefined();
        expect(doc.openings[r.door]).toBeUndefined();
        expect(doc.placements[attached]).toBeUndefined();
        expect(doc.annotations.labels[label]).toBeUndefined();
        expect(doc.annotations.dimensions[dim]).toBeUndefined();
        expect(doc.background).toBeNull();
        expect(doc.placements[kept]!.wallAttachment).toEqual({
            wallId: r.right,
            side: 'left',
        });
        expect(new Set(result.deletedIds).size).toBe(result.deletedIds.length);
        expect([...result.deletedIds].sort()).toEqual(
            [r.top, r.door, attached, label, dim, 'background'].sort(),
        );
        expect(result.deletedIds.indexOf(r.top)).toBeLessThan(
            result.deletedIds.indexOf(label),
        );
        expectUndoRestores(bus, start);
    });

    it('deletes a node with its walls and a RoomMeta, fixture and opening by id', () => {
        const r = room();
        const meta = r.g.meta('Living', 2500, 1500);
        const fixture = r.g.ids('x');
        r.g.doc.fixtures[fixture] = {
            id: fixture,
            libraryKey: 'wc',
            x: 4000,
            y: 2500,
            rotation: 0,
            width: 400,
            depth: 700,
            height: 800,
            elevation: 0,
            label: null,
        };
        const bus = busOf(r.g);
        const start = bus.getDoc();
        const n3 = r.nodes[2];
        const { deletedIds } = ok(
            bus.execute('deleteEntities', {
                ids: [n3, meta, fixture, r.window],
            }),
        ).result;
        const doc = bus.getDoc();
        expect(doc.nodes[n3]).toBeUndefined();
        expect(doc.walls[r.right]).toBeUndefined();
        expect(doc.walls[r.bottom]).toBeUndefined();
        expect(doc.rooms).toEqual({});
        expect(doc.fixtures).toEqual({});
        expect(deletedIds).toEqual(
            expect.arrayContaining([
                n3,
                r.right,
                r.bottom,
                r.window,
                meta,
                fixture,
            ]),
        );
        expect(new Set(deletedIds).size).toBe(deletedIds.length);
        expectUndoRestores(bus, start);
    });

    it('refuses an unknown id with not_found', () => {
        const r = room();
        const bus = busOf(r.g);
        expect(
            expectRefusedUntouched(
                bus,
                () =>
                    bus.execute('deleteEntities', {
                        ids: [r.top, 'f_zzzzzzzzzz'],
                    }),
                'not_found',
            ).params,
        ).toEqual({ id: 'f_zzzzzzzzzz' });
    });
});

describe('mayAddNoWall (insertFragment dry-run skip)', () => {
    const { g } = room();
    const doc = g.doc;
    const span = (a: [number, number], b: [number, number]) => ({
        a: { x: a[0], y: a[1] },
        b: { x: b[0], y: b[1] },
    });

    it('is false for a wall in empty space: the dry run is skipped', () => {
        expect(mayAddNoWall(doc, span([8000, 0], [12000, 0]), [])).toBe(false);
        // crossing and touching walls still add a wall
        expect(mayAddNoWall(doc, span([2500, -500], [2500, 3500]), [])).toBe(
            false,
        );
        expect(mayAddNoWall(doc, span([5000, 0], [9000, 0]), [])).toBe(false);
    });

    it('is true when an existing wall covers the segment', () => {
        expect(mayAddNoWall(doc, span([1000, 0], [2000, 0]), [[0, 1]])).toBe(
            true,
        );
    });

    it('is true when an existing wall lies on both ends of the segment', () => {
        expect(mayAddNoWall(doc, span([0, 0], [5000, 0]), [])).toBe(true);
    });

    it('is true for a segment whose ends could resolve to one node', () => {
        expect(mayAddNoWall(doc, span([8000, 0], [8010, 0]), [])).toBe(true);
    });
});
