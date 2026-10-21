import { describe, expect, it } from 'vitest';
import type { ExecuteResult } from '../../../commands/types';
import { derivePlanGeometry } from '../../derive';
import type { PlanDocument } from '../../schema';
import {
    Graph,
    busOf,
    ok,
    oneWall,
    refused,
    scaleWorld,
} from '../../testing/graph';
import { PLAN_COMMANDS } from '../registry';

// ---- fixtures ----------------------------------------------------------------

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
    const error = refused(run());
    expect(error.code).toBe(code);
    expect(bus.getDoc()).toBe(before);
    expect(bus.history().undo.length).toBe(entries);
    return error;
}

const rescale = (bus: Bus, factor: number) =>
    bus.execute('rescalePlan', { factor });

// ---- registry ----------------------------------------------------------------

describe('registry', () => {
    it('registers rescalePlan (geometry pass) and setPlanMeta (none), neither merging', () => {
        for (const [name, label, geometry] of [
            ['rescalePlan', 'rescale_plan', true],
            ['setPlanMeta', 'set_plan_meta', false],
        ] as const) {
            const def = PLAN_COMMANDS[name];
            expect(def.type).toBe(name);
            expect(def.labelKey).toBe(`engine.plan.command.label.${label}`);
            expect(def.paramsSchema).toBeDefined();
            expect(def.touchesGeometry).toBe(geometry);
            expect(def.mergeKey).toBeUndefined();
        }
    });
});

// ---- rescalePlan -------------------------------------------------------------

describe('rescalePlan', () => {
    it('doubles coordinates and the sizes the spec scales, keeps heights, sills and furniture sizes, and one undo restores the document', () => {
        const w = scaleWorld();
        w.g.doc.walls[w.north]!.thickness = 600;
        const bus = busOf(w.g);
        const start = bus.getDoc();
        ok(rescale(bus, 2));
        const doc = bus.getDoc();

        expect(w.nodes.map((id) => doc.nodes[id]!)).toEqual([
            { id: w.nodes[0], x: 2000, y: 1000 },
            { id: w.nodes[1], x: 12000, y: 1000 },
            { id: w.nodes[2], x: 12000, y: 7000 },
            { id: w.nodes[3], x: 2000, y: 7000 },
        ]);
        // 600 -> 1000 (clamped), 200 -> 400
        expect(doc.walls[w.north]!.thickness).toBe(1000);
        expect(
            Object.values(doc.walls)
                .filter((x) => x.id !== w.north)
                .map((x) => x.thickness),
        ).toEqual([400, 400, 400]);
        expect(doc.walls[w.north]!.height).toBe(2700);

        const door = doc.openings[w.door]!;
        expect([door.offset, door.width, door.height, door.sillHeight]).toEqual(
            [2000, 1800, 2100, 0],
        );
        const window = doc.openings[w.window]!;
        expect([window.offset, window.width, window.height]).toEqual([
            7000, 2400, 1200,
        ]);
        expect(window.sillHeight).toBe(900);

        expect(doc.rooms[w.meta]!.anchor).toEqual({ x: 6000, y: 4000 });
        expect(doc.rooms[w.meta]!.labelOffset).toEqual({ x: 200, y: -400 });
        expect(doc.annotations.labels[w.label]!.position).toEqual({
            x: 4000,
            y: 2000,
        });
        expect(doc.annotations.labels[w.label]!.fontSize).toBe(250);
        const free = doc.annotations.dimensions[w.freeDimension]!;
        expect([free.a, free.b, free.offset]).toEqual([
            { x: 2000, y: 8000 },
            { x: 12000, y: 8000 },
            600,
        ]);
        const placement = doc.placements[w.freePlacement]!;
        expect([placement.x, placement.y, placement.elevation]).toEqual([
            6000, 4000, 150,
        ]);
        const fixture = doc.fixtures[w.fixture]!;
        expect([fixture.x, fixture.y]).toEqual([10000, 6000]);
        expect([fixture.width, fixture.depth, fixture.height]).toEqual([
            400, 700, 800,
        ]);
        expect(doc.background).toMatchObject({
            mmPerPixel: 20,
            position: { x: 1000, y: 400 },
        });
        expect(bus.history().undo.length).toBe(1);
        expectUndoRestores(bus, start);
    });

    it('keeps attached dimensions on the wall face and scales their offset', () => {
        const w = scaleWorld();
        const bus = busOf(w.g);
        ok(rescale(bus, 2));
        const doc = bus.getDoc();
        const north = derivePlanGeometry(doc).walls[w.north]!;
        const dim = doc.annotations.dimensions[w.attachedDimension]!;
        expect(dim.a).toEqual({
            x: Math.round(north.rightFace[0].x),
            y: Math.round(north.rightFace[0].y),
        });
        expect(dim.b).toEqual({
            x: Math.round(north.rightFace[1].x),
            y: Math.round(north.rightFace[1].y),
        });
        expect(dim.offset).toBe(600);
        expect(dim.attachedTo).toEqual({
            kind: 'wall',
            wallId: w.north,
            face: 'right',
        });
    });

    it.each([2, 0.6, 3.3])(
        'keeps a wall-attached placement on the new face at k times its distance along it (factor %s)',
        (factor) => {
            const w = scaleWorld();
            const bus = busOf(w.g);
            const face = (doc: PlanDocument) =>
                derivePlanGeometry(doc).walls[w.north]!.rightFace;
            const [a0, b0] = face(bus.getDoc());
            const u0 = bus.getDoc().placements[w.attachedPlacement]!.x - a0.x;
            expect(b0.y).toBe(a0.y);
            ok(rescale(bus, factor));
            const doc = bus.getDoc();
            const [a1, b1] = face(doc);
            const p = doc.placements[w.attachedPlacement]!;
            // on the new face line (the wall is horizontal) ...
            expect(Math.abs(p.y - a1.y)).toBeLessThanOrEqual(0.5);
            expect(b1.y).toBeCloseTo(a1.y, 6);
            // ... at k times the old distance from its start
            expect(Math.abs(p.x - a1.x - u0 * factor)).toBeLessThanOrEqual(1.5);
            expect(p.wallAttachment).toEqual({
                wallId: w.north,
                side: 'right',
            });
        },
    );

    it('keeps the room meta bound to its room', () => {
        const w = scaleWorld();
        const bus = busOf(w.g);
        ok(rescale(bus, 2));
        const meta = bus.getDoc().rooms[w.meta]!;
        expect(meta.name).toBe('Living');
        const room = derivePlanGeometry(bus.getDoc()).rooms[0]!;
        expect(room.metaId).toBe(w.meta);
    });

    it('clamps a halved thickness at 50 and a scaled opening width into 300 to 6000, then re-fits the offset', () => {
        const g = new Graph();
        const a = g.node(0, 0);
        const b = g.node(2000, 0);
        const wall = g.wall(a, b, { thickness: 60 });
        // 400 wide at 220: halved it is 200 wide (clamped to 300) at 110, which pokes out of the wall start
        const door = g.opening(wall, 220, 400);
        const bus = busOf(g);
        const start = bus.getDoc();
        ok(rescale(bus, 0.5));
        expect(bus.getDoc().walls[wall]!.thickness).toBe(50);
        const o = bus.getDoc().openings[door]!;
        expect(o.width).toBe(300);
        expect(o.offset).toBe(150);
        expectUndoRestores(bus, start);

        const wide = new Graph();
        const wa = wide.node(0, 0);
        const wb = wide.node(20000, 0);
        const ww = wide.wall(wa, wb);
        const o2 = wide.opening(ww, 10000, 5000);
        const bus2 = busOf(wide);
        ok(rescale(bus2, 2));
        expect(bus2.getDoc().openings[o2]!.width).toBe(6000);
        expect(bus2.getDoc().openings[o2]!.offset).toBe(20000);
    });

    it('scales a document without a background', () => {
        const { g } = oneWall();
        const bus = busOf(g);
        ok(rescale(bus, 3));
        expect(bus.getDoc().nodes[Object.keys(bus.getDoc().nodes)[1]!]!.x).toBe(
            15000,
        );
        expect(bus.getDoc().background).toBeNull();
    });

    it('rounds scaled coordinates to whole millimetres', () => {
        const g = new Graph();
        const a = g.node(0, 0);
        const b = g.node(1001, 333);
        g.wall(a, b);
        const bus = busOf(g);
        ok(rescale(bus, 1.5));
        const n = bus.getDoc().nodes[b]!;
        expect([n.x, n.y]).toEqual([1502, 500]);
    });

    it('accepts the ends of the factor range and refuses outside it', () => {
        const { g } = oneWall();
        const bus = busOf(g);
        for (const factor of [0.009, 100.5, 0, -2]) {
            const error = expectRefusedUntouched(
                bus,
                () => rescale(bus, factor),
                'out_of_range',
            );
            expect(error.params).toEqual({
                field: 'factor',
                min: 0.01,
                max: 100,
            });
            expect(error.messageKey).toBe('engine.plan.command.out_of_range');
        }
        // 5000 -> 50 mm
        ok(rescale(bus, 0.01));
        expect(bus.undo()).toBe(true);
        ok(rescale(bus, 100));
        expect(Object.values(bus.getDoc().nodes).map((n) => n.x)).toContain(
            500000,
        );
    });

    it('aborts wall_too_short when any wall would fall under 10 mm, and changes nothing', () => {
        const g = new Graph();
        const a = g.node(0, 0);
        const b = g.node(5000, 0);
        const c = g.node(5000, 500);
        g.wall(a, b);
        const short = g.wall(b, c);
        const bus = busOf(g);
        // 500 * 0.01 = 5
        const error = expectRefusedUntouched(
            bus,
            () => rescale(bus, 0.01),
            'wall_too_short',
        );
        expect(error.params).toMatchObject({ wallId: short, length: 5 });
        expect(error.messageKey).toBe('engine.plan.command.wall_too_short');
        // 10 mm is allowed: 500 * 0.02
        ok(rescale(bus, 0.02));
    });

    it('aborts out_of_range on coordinates when the factor pushes one past the limit', () => {
        const g = new Graph();
        const a = g.node(0, 0);
        const b = g.node(50000, 0);
        g.wall(a, b);
        const bus = busOf(g);
        const error = expectRefusedUntouched(
            bus,
            () => rescale(bus, 100),
            'out_of_range',
        );
        expect(error.params).toMatchObject({ field: 'coordinates' });
    });

    it('aborts out_of_range when the background scale would leave 0.01 to 1000', () => {
        const { g } = oneWall();
        g.background({ mmPerPixel: 500 });
        const bus = busOf(g);
        const error = expectRefusedUntouched(
            bus,
            () => rescale(bus, 3),
            'out_of_range',
        );
        expect(error.params).toMatchObject({
            field: 'background.mmPerPixel',
            min: 0.01,
            max: 1000,
        });
    });

    it('aborts opening_no_fit when a 300 mm opening cannot fit the shrunken wall', () => {
        const g = new Graph();
        const a = g.node(0, 0);
        const b = g.node(1000, 0);
        const wall = g.wall(a, b);
        const door = g.opening(wall, 500, 900);
        const bus = busOf(g);
        const error = expectRefusedUntouched(
            bus,
            () => rescale(bus, 0.1),
            'opening_no_fit',
        );
        expect(error.params).toMatchObject({ wallId: wall, openingId: door });
    });

    it('a factor of 1 changes nothing and leaves no history entry', () => {
        const w = scaleWorld();
        const bus = busOf(w.g);
        const r = ok(rescale(bus, 1));
        expect(r.changedIds.size).toBe(0);
        expect(bus.history().undo.length).toBe(0);
    });
});

// ---- setPlanMeta -------------------------------------------------------------

describe('setPlanMeta', () => {
    const set = (bus: Bus, props: object) =>
        bus.execute('setPlanMeta', { props });

    it('sets any subset of the four values, rounding the millimetres, and undo restores the document', () => {
        const { g } = oneWall();
        const bus = busOf(g);
        const start = bus.getDoc();
        const r = ok(
            set(bus, {
                defaultWallHeight: 2800.4,
                defaultWallThickness: 150,
                floorThickness: 200.6,
                northAngle: 123.5,
            }),
        );
        expect(r.changedIds.has('meta')).toBe(true);
        expect(bus.getDoc().meta).toEqual({
            ...start.meta,
            defaultWallHeight: 2800,
            defaultWallThickness: 150,
            floorThickness: 201,
            northAngle: 123.5,
        });
        expectUndoRestores(bus, start);

        ok(set(bus, { northAngle: 45 }));
        expect(bus.getDoc().meta).toEqual({ ...start.meta, northAngle: 45 });
        ok(set(bus, { northAngle: null }));
        expect(bus.getDoc().meta.northAngle).toBeNull();
        expect(bus.history().undo.length).toBe(2);
    });

    it('accepts both ends of every range', () => {
        const { g } = oneWall();
        const bus = busOf(g);
        ok(
            set(bus, {
                defaultWallHeight: 300,
                defaultWallThickness: 50,
                floorThickness: 0,
                northAngle: 0,
            }),
        );
        ok(
            set(bus, {
                defaultWallHeight: 10000,
                defaultWallThickness: 1000,
                floorThickness: 1000,
                northAngle: 359.99,
            }),
        );
        expect(bus.getDoc().meta).toMatchObject({
            defaultWallHeight: 10000,
            defaultWallThickness: 1000,
            floorThickness: 1000,
            northAngle: 359.99,
        });
    });

    it.each([
        ['defaultWallHeight', 299, 300, 10000],
        ['defaultWallHeight', 10001, 300, 10000],
        ['defaultWallThickness', 49, 50, 1000],
        ['defaultWallThickness', 1001, 50, 1000],
        ['floorThickness', -1, 0, 1000],
        ['floorThickness', 1001, 0, 1000],
        ['northAngle', 360, 0, 360],
        ['northAngle', -0.5, 0, 360],
    ])('refuses %s = %s as out_of_range', (field, value, min, max) => {
        const { g } = oneWall();
        const bus = busOf(g);
        const error = expectRefusedUntouched(
            bus,
            () => set(bus, { [field]: value }),
            'out_of_range',
        );
        expect(error.params).toEqual({ field: `props.${field}`, min, max });
    });

    it('applies nothing when one of several values is refused', () => {
        const { g } = oneWall();
        const bus = busOf(g);
        expectRefusedUntouched(
            bus,
            () => set(bus, { defaultWallHeight: 2800, northAngle: 400 }),
            'out_of_range',
        );
    });

    it('a value equal to the current one, or empty props, leaves no history entry', () => {
        const { g } = oneWall();
        const bus = busOf(g);
        const current = bus.getDoc().meta;
        ok(set(bus, {}));
        ok(set(bus, { defaultWallHeight: current.defaultWallHeight }));
        expect(bus.history().undo.length).toBe(0);
    });

    it('does not change createdWith', () => {
        const { g } = oneWall();
        const bus = busOf(g);
        ok(set(bus, { floorThickness: 100 }));
        expect(bus.getDoc().meta.createdWith).toBe('editor');
    });
});
