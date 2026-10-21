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
    expect(error.messageKey).toBe(`engine.plan.command.${code}`);
    expect(bus.getDoc()).toBe(before);
    expect(bus.history().undo.length).toBe(entries);
    return error;
}

const BACKGROUND = {
    importId: null,
    mediaUuid: 'media-9',
    pixelWidth: 2000,
    pixelHeight: 1500,
    mmPerPixel: 5,
    position: { x: 100, y: 200 },
    rotation: 0,
    opacity: 0.4,
    visible: true,
    locked: false,
};

/** A one-wall plan with the unlocked background of `Graph.background` (10 mm per pixel). */
function withBackground(over: Parameters<Graph['background']>[0] = {}) {
    const world = oneWall();
    world.g.background(over);
    return { ...world, bus: busOf(world.g) };
}

const planCalibration = (
    bus: Bus,
    over: Partial<{
        p1: { x: number; y: number };
        p2: { x: number; y: number };
        realDistance: number;
        scaleGeometry: boolean;
    }> = {},
) =>
    bus.execute('calibrateBackground', {
        space: 'plan' as const,
        p1: { x: 0, y: 0 },
        p2: { x: 1000, y: 0 },
        realDistance: 3000,
        scaleGeometry: false,
        ...over,
    });

const imageCalibration = (
    bus: Bus,
    over: Partial<{
        a: { x: number; y: number };
        b: { x: number; y: number };
        distanceMm: number;
    }> = {},
) =>
    bus.execute('calibrateBackground', {
        space: 'image' as const,
        a: { x: 0, y: 0 },
        b: { x: 100, y: 0 },
        distanceMm: 1500,
        ...over,
    });

// ---- registry ----------------------------------------------------------------

describe('registry', () => {
    it('registers the four background commands; only calibrate runs the geometry pass', () => {
        for (const [name, label, geometry] of [
            ['setBackground', 'set_background', false],
            ['setBackgroundProps', 'set_background_props', false],
            ['calibrateBackground', 'calibrate_background', true],
            ['removeBackground', 'remove_background', false],
        ] as const) {
            const def = PLAN_COMMANDS[name];
            expect(def.type).toBe(name);
            expect(def.labelKey).toBe(`engine.plan.command.label.${label}`);
            expect(def.paramsSchema).toBeDefined();
            expect(def.touchesGeometry).toBe(geometry);
        }
    });

    it('setBackgroundProps merges with replace mode under bgProps; the others do not merge', () => {
        const def = PLAN_COMMANDS.setBackgroundProps;
        expect(def.mergeMode ?? 'replace').toBe('replace');
        expect(def.mergeKey?.({ props: {} })).toBe('bgProps');
        for (const name of [
            'setBackground',
            'calibrateBackground',
            'removeBackground',
        ] as const) {
            expect(PLAN_COMMANDS[name].mergeKey).toBeUndefined();
        }
    });
});

// ---- setBackground -----------------------------------------------------------

describe('setBackground', () => {
    it('sets the background of a plan without one, rounding the position and normalising the rotation', () => {
        const { g } = oneWall();
        const bus = busOf(g);
        const start = bus.getDoc();
        const r = ok(
            bus.execute('setBackground', {
                background: {
                    ...BACKGROUND,
                    position: { x: 100.4, y: -0.2 },
                    rotation: 450.004,
                },
            }),
        );
        expect(r.changedIds.has('background')).toBe(true);
        expect(bus.getDoc().background).toEqual({
            ...BACKGROUND,
            position: { x: 100, y: 0 },
            rotation: 90,
        });
        expectUndoRestores(bus, start);
    });

    it('replaces an existing background, even a locked one', () => {
        const { g } = oneWall();
        g.background({ locked: true });
        const bus = busOf(g);
        const start = bus.getDoc();
        ok(bus.execute('setBackground', { background: BACKGROUND }));
        expect(bus.getDoc().background).toEqual(BACKGROUND);
        expectUndoRestores(bus, start);
    });

    it.each([
        ['pixelWidth', 0, 'background.pixelWidth'],
        ['pixelWidth', -5, 'background.pixelWidth'],
        ['pixelWidth', 10.5, 'background.pixelWidth'],
        ['pixelHeight', 0, 'background.pixelHeight'],
        ['mmPerPixel', 0.009, 'background.mmPerPixel'],
        ['mmPerPixel', 1000.1, 'background.mmPerPixel'],
        ['opacity', 1.1, 'background.opacity'],
        ['opacity', -0.1, 'background.opacity'],
        ['position', { x: 1_000_001, y: 0 }, 'background.position.x'],
    ])('refuses %s = %j as out_of_range on %s', (key, value, field) => {
        const { g } = oneWall();
        const bus = busOf(g);
        const error = expectRefusedUntouched(
            bus,
            () =>
                bus.execute('setBackground', {
                    background: { ...BACKGROUND, [key]: value },
                }),
            'out_of_range',
        );
        expect(error.params.field).toBe(field);
    });

    it('accepts the ends of the scale and opacity ranges', () => {
        const { g } = oneWall();
        const bus = busOf(g);
        for (const [mmPerPixel, opacity] of [
            [0.01, 0],
            [1000, 1],
        ] as const) {
            ok(
                bus.execute('setBackground', {
                    background: { ...BACKGROUND, mmPerPixel, opacity },
                }),
            );
        }
    });

    it('refuses an empty mediaUuid as invalid_params', () => {
        const { g } = oneWall();
        const bus = busOf(g);
        expectRefusedUntouched(
            bus,
            () =>
                bus.execute('setBackground', {
                    background: { ...BACKGROUND, mediaUuid: '' },
                }),
            'invalid_params',
        );
    });
});

// ---- setBackgroundProps ------------------------------------------------------

describe('setBackgroundProps', () => {
    const setProps = (bus: Bus, props: object) =>
        bus.execute('setBackgroundProps', { props });

    it('sets any subset of the props, rounding the position and normalising the rotation', () => {
        const { bus } = withBackground();
        const start = bus.getDoc();
        ok(
            setProps(bus, {
                position: { x: 10.6, y: -20.4 },
                rotation: -90,
                opacity: 0.25,
                visible: false,
                locked: true,
            }),
        );
        expect(bus.getDoc().background).toEqual({
            ...start.background,
            position: { x: 11, y: -20 },
            rotation: 270,
            opacity: 0.25,
            visible: false,
            locked: true,
        });
        expectUndoRestores(bus, start);
        ok(setProps(bus, { opacity: 1 }));
        expect(bus.getDoc().background).toEqual({
            ...start.background!,
            opacity: 1,
        });
    });

    it('works on a locked background, which is how it is unlocked', () => {
        const { bus } = withBackground({ locked: true });
        ok(setProps(bus, { locked: false }));
        expect(bus.getDoc().background!.locked).toBe(false);
    });

    it('merges a drag of the background into one history entry that undoes to the start', () => {
        const { bus } = withBackground();
        const start = bus.getDoc();
        for (let x = 1; x <= 20; x += 1) {
            ok(
                bus.execute(
                    'setBackgroundProps',
                    { props: { position: { x: x * 10, y: 5 } } },
                    { merge: true },
                ),
            );
        }
        expect(bus.history().undo.length).toBe(1);
        expect(bus.getDoc().background!.position).toEqual({ x: 200, y: 5 });
        expectUndoRestores(bus, start);
    });

    it('is refused without a background, and for an opacity outside 0 to 1 or a far position', () => {
        const { g } = oneWall();
        const none = busOf(g);
        expectRefusedUntouched(
            none,
            () => setProps(none, { opacity: 0.5 }),
            'background_missing',
        );
        const { bus } = withBackground();
        expect(
            expectRefusedUntouched(
                bus,
                () => setProps(bus, { opacity: 1.5 }),
                'out_of_range',
            ).params,
        ).toEqual({ field: 'props.opacity', min: 0, max: 1 });
        expectRefusedUntouched(
            bus,
            () => setProps(bus, { position: { x: 0, y: -2_000_000 } }),
            'out_of_range',
        );
    });

    it('leaves no history entry when nothing changes', () => {
        const { bus } = withBackground();
        ok(setProps(bus, {}));
        ok(setProps(bus, { opacity: 0.5, position: { x: 0, y: 0 } }));
        expect(bus.history().undo.length).toBe(0);
    });
});

// ---- removeBackground --------------------------------------------------------

describe('removeBackground', () => {
    it('removes the background, reports it as deleted, and undo restores it', () => {
        const { bus } = withBackground();
        const start = bus.getDoc();
        const r = ok(bus.execute('removeBackground', {}));
        expect(bus.getDoc().background).toBeNull();
        expect(r.deletedIds).toEqual(['background']);
        expect(r.changedIds.has('background')).toBe(true);
        expectUndoRestores(bus, start);
        expect(bus.getDoc().background).toEqual(start.background);
        expect(bus.redo()).toBe(true);
        expect(bus.getDoc().background).toBeNull();
    });

    it('does nothing, and leaves no history entry, without a background', () => {
        const { g } = oneWall();
        const bus = busOf(g);
        const r = ok(bus.execute('removeBackground', {}));
        expect(r.deletedIds).toEqual([]);
        expect(bus.history().undo.length).toBe(0);
    });
});

// ---- calibrateBackground, plan space -------------------------------------------------

describe('calibrateBackground, space plan', () => {
    it('triples mmPerPixel, keeps p1 fixed and returns the factor; geometry stays', () => {
        const { bus } = withBackground();
        const start = bus.getDoc();
        const r = ok(planCalibration(bus));
        expect(r.result).toEqual({ factor: 3 });
        expect(bus.getDoc().background!.mmPerPixel).toBe(30);
        expect(bus.getDoc().background!.position).toEqual({ x: 0, y: 0 });
        expect(bus.getDoc().nodes).toBe(start.nodes);
        expect(bus.getDoc().walls).toBe(start.walls);
        expectUndoRestores(bus, start);
    });

    it('scales the background position about p1, so the point under p1 stays under p1', () => {
        const { bus } = withBackground({ position: { x: 500, y: 200 } });
        ok(
            planCalibration(bus, {
                p1: { x: 100, y: 100 },
                p2: { x: 1100, y: 100 },
            }),
        );
        // p1 + (position - p1) * 3
        expect(bus.getDoc().background!.position).toEqual({ x: 1300, y: 400 });
    });

    it('rounds p1 and p2 and keeps a fractional factor exact', () => {
        const { bus } = withBackground();
        const r = ok(
            planCalibration(bus, {
                p1: { x: 0.4, y: 0 },
                p2: { x: 1000.2, y: 0 },
                realDistance: 2500,
            }),
        );
        expect(r.result.factor).toBe(2.5);
        expect(bus.getDoc().background!.mmPerPixel).toBe(25);
    });

    it('with scaleGeometry, scales every point of the plan about p1 and none of the sizes', () => {
        const w = scaleWorld();
        const bus = busOf(w.g);
        const start = bus.getDoc();
        const r = ok(
            planCalibration(bus, {
                p1: { x: 1000, y: 500 },
                p2: { x: 2000, y: 500 },
                realDistance: 3000,
                scaleGeometry: true,
            }),
        );
        expect(r.result).toEqual({ factor: 3 });
        const doc = bus.getDoc();
        const about = (v: number, c: number) => c + (v - c) * 3;
        // p1 is node n1: it stays, the others move away from it
        expect(
            w.nodes.map((id) => [doc.nodes[id]!.x, doc.nodes[id]!.y]),
        ).toEqual([
            [1000, 500],
            [16000, 500],
            [16000, 9500],
            [1000, 9500],
        ]);
        // thicknesses and heights stay
        for (const wall of Object.values(doc.walls)) {
            expect(wall.thickness).toBe(200);
            expect(wall.height).toBe(2700);
        }
        // openings: offsets x3, widths and heights stay
        expect(doc.openings[w.door]).toMatchObject({
            offset: 3000,
            width: 900,
            height: 2100,
        });
        expect(doc.openings[w.window]).toMatchObject({
            offset: 10500,
            width: 1200,
        });
        const free = doc.placements[w.freePlacement]!;
        expect([free.x, free.y]).toEqual([about(3000, 1000), about(2000, 500)]);
        const fixture = doc.fixtures[w.fixture]!;
        expect([fixture.x, fixture.y]).toEqual([
            about(5000, 1000),
            about(3000, 500),
        ]);
        expect([fixture.width, fixture.depth]).toEqual([400, 700]);
        expect(doc.annotations.labels[w.label]!.position).toEqual({
            x: about(2000, 1000),
            y: about(1000, 500),
        });
        expect(doc.annotations.labels[w.label]!.fontSize).toBe(250);
        const dim = doc.annotations.dimensions[w.freeDimension]!;
        expect([dim.a, dim.b, dim.offset]).toEqual([
            { x: 1000, y: about(4000, 500) },
            { x: about(6000, 1000), y: about(4000, 500) },
            300,
        ]);
        expect(doc.rooms[w.meta]!.anchor).toEqual({
            x: about(3000, 1000),
            y: about(2000, 500),
        });
        expect(doc.rooms[w.meta]!.labelOffset).toEqual({ x: 100, y: -200 });
        // the background scales about p1 as well
        expect(doc.background).toMatchObject({
            mmPerPixel: 30,
            position: { x: 1000 + (500 - 1000) * 3, y: 500 + (200 - 500) * 3 },
        });
        expect(bus.history().undo.length).toBe(1);
        expectUndoRestores(bus, start);
    });

    it('with scaleGeometry, attached dimensions follow the new face and attached placements stay on it', () => {
        const w = scaleWorld();
        const bus = busOf(w.g);
        const face = (doc: PlanDocument) =>
            derivePlanGeometry(doc).walls[w.north]!.rightFace;
        const [a0] = face(bus.getDoc());
        const u0 = bus.getDoc().placements[w.attachedPlacement]!.x - a0.x;
        ok(
            planCalibration(bus, {
                p1: { x: 0, y: 0 },
                p2: { x: 1000, y: 0 },
                realDistance: 2000,
                scaleGeometry: true,
            }),
        );
        const doc = bus.getDoc();
        const [a1, b1] = face(doc);
        // thickness 200 is unchanged, so the face is 100 below the doubled centre line
        expect(a1.y).toBeCloseTo(1100, 6);
        const dim = doc.annotations.dimensions[w.attachedDimension]!;
        expect(dim.a).toEqual({ x: Math.round(a1.x), y: Math.round(a1.y) });
        expect(dim.b).toEqual({ x: Math.round(b1.x), y: Math.round(b1.y) });
        expect(dim.offset).toBe(300);
        const p = doc.placements[w.attachedPlacement]!;
        expect(Math.abs(p.y - a1.y)).toBeLessThanOrEqual(0.5);
        expect(Math.abs(p.x - a1.x - u0 * 2)).toBeLessThanOrEqual(1.5);
    });

    it('with scaleGeometry, a factor under 1 shrinks the plan and re-fits the openings', () => {
        const w = scaleWorld();
        const bus = busOf(w.g);
        const r = ok(
            planCalibration(bus, {
                p1: { x: 0, y: 0 },
                p2: { x: 1000, y: 0 },
                realDistance: 500,
                scaleGeometry: true,
            }),
        );
        expect(r.result.factor).toBe(0.5);
        const doc = bus.getDoc();
        expect(doc.nodes[w.nodes[1]!]).toMatchObject({ x: 3000, y: 250 });
        // 5000 -> 2500 long; door at 500 (width 900, needs 450..) and window at 1750 (1200 wide)
        expect(doc.openings[w.door]).toMatchObject({ offset: 500, width: 900 });
        expect(doc.openings[w.window]).toMatchObject({
            offset: 1750,
            width: 1200,
        });
    });

    it('with scaleGeometry, aborts wall_too_short when the shrink would leave a wall under 10 mm', () => {
        const g = new Graph();
        const a = g.node(0, 0);
        const b = g.node(5000, 0);
        const c = g.node(5000, 90);
        g.wall(a, b);
        const short = g.wall(b, c);
        g.background();
        const bus = busOf(g);
        const error = expectRefusedUntouched(
            bus,
            () =>
                planCalibration(bus, {
                    realDistance: 100,
                    scaleGeometry: true,
                }),
            'wall_too_short',
        );
        expect(error.params).toMatchObject({ wallId: short, length: 9 });
        // without scaleGeometry the same calibration is fine
        ok(planCalibration(bus, { realDistance: 100 }));
    });

    it('aborts opening_no_fit instead of leaving an opening wider than its wall', () => {
        const g = new Graph();
        const a = g.node(0, 0);
        const b = g.node(2000, 0);
        const wall = g.wall(a, b);
        g.opening(wall, 1000, 900);
        g.background();
        const bus = busOf(g);
        expectRefusedUntouched(
            bus,
            () =>
                planCalibration(bus, {
                    realDistance: 100,
                    scaleGeometry: true,
                }),
            'opening_no_fit',
        );
    });

    describe('refusals', () => {
        it('without a background: background_missing', () => {
            const { g } = oneWall();
            const bus = busOf(g);
            expectRefusedUntouched(
                bus,
                () => planCalibration(bus),
                'background_missing',
            );
            expectRefusedUntouched(
                bus,
                () => imageCalibration(bus),
                'background_missing',
            );
        });

        it('on a locked background: background_locked, whatever else is wrong', () => {
            const { bus } = withBackground({ locked: true });
            expectRefusedUntouched(
                bus,
                () => planCalibration(bus),
                'background_locked',
            );
            expectRefusedUntouched(
                bus,
                () => imageCalibration(bus, { distanceMm: 1 }),
                'background_locked',
            );
        });

        it('with points under 10 pixels apart: calibration_too_short', () => {
            const { bus } = withBackground();
            // 99 mm at 10 mm per pixel is 9.9 px
            const error = expectRefusedUntouched(
                bus,
                () => planCalibration(bus, { p2: { x: 99, y: 0 } }),
                'calibration_too_short',
            );
            expect(error.params).toEqual({ pixels: 9.9, min: 10 });
            expectRefusedUntouched(
                bus,
                () => planCalibration(bus, { p2: { x: 0, y: 0 } }),
                'calibration_too_short',
            );
            // exactly 10 px is enough
            ok(planCalibration(bus, { p2: { x: 100, y: 0 } }));
        });

        it('with a real distance under 100 mm: out_of_range', () => {
            const { bus } = withBackground();
            const error = expectRefusedUntouched(
                bus,
                () => planCalibration(bus, { realDistance: 99 }),
                'out_of_range',
            );
            expect(error.params).toMatchObject({
                field: 'realDistance',
                min: 100,
            });
            ok(planCalibration(bus, { realDistance: 100 }));
        });

        it('with a point outside the coordinate range, or a factor that takes mmPerPixel outside 0.01 to 1000: out_of_range', () => {
            const { bus } = withBackground();
            expect(
                expectRefusedUntouched(
                    bus,
                    () => planCalibration(bus, { p1: { x: 2_000_000, y: 0 } }),
                    'out_of_range',
                ).params.field,
            ).toBe('p1.x');
            // 10 mm per pixel x 200 = 2000
            expect(
                expectRefusedUntouched(
                    bus,
                    () => planCalibration(bus, { realDistance: 200_000 }),
                    'out_of_range',
                ).params,
            ).toEqual({ field: 'mmPerPixel', min: 0.01, max: 1000 });
        });
    });
});

// ---- calibrateBackground, image space ----------------------------------------------------

describe('calibrateBackground, space image', () => {
    it('sets mmPerPixel from two image pixels and a distance, leaving position and the plan alone', () => {
        const { bus } = withBackground({ position: { x: 300, y: -40 } });
        const start = bus.getDoc();
        const r = ok(imageCalibration(bus));
        expect(bus.getDoc().background!.mmPerPixel).toBe(15);
        expect(bus.getDoc().background!.position).toEqual({ x: 300, y: -40 });
        // new / old
        expect(r.result).toEqual({ factor: 1.5 });
        expect(bus.getDoc().nodes).toBe(start.nodes);
        expectUndoRestores(bus, start);
    });

    it('measures the pixel distance on both axes', () => {
        const { bus } = withBackground({ mmPerPixel: 10 });
        // 3-4-5: 50 px
        ok(
            imageCalibration(bus, {
                a: { x: 10, y: 10 },
                b: { x: 40, y: 50 },
                distanceMm: 1000,
            }),
        );
        expect(bus.getDoc().background!.mmPerPixel).toBe(20);
    });

    it('refuses points under 10 px apart, a distance under 100 mm, and a scale outside 0.01 to 1000', () => {
        const { bus } = withBackground();
        expectRefusedUntouched(
            bus,
            () => imageCalibration(bus, { b: { x: 9, y: 0 } }),
            'calibration_too_short',
        );
        expect(
            expectRefusedUntouched(
                bus,
                () => imageCalibration(bus, { distanceMm: 99 }),
                'out_of_range',
            ).params,
        ).toMatchObject({ field: 'distanceMm', min: 100 });
        // 1_000_000 / 100 px = 10000 mm per pixel
        expect(
            expectRefusedUntouched(
                bus,
                () => imageCalibration(bus, { distanceMm: 1_000_000 }),
                'out_of_range',
            ).params,
        ).toEqual({ field: 'mmPerPixel', min: 0.01, max: 1000 });
    });

    it('rejects an unknown space as invalid_params', () => {
        const { bus } = withBackground();
        const error = refused(
            bus.execute('calibrateBackground', {
                space: 'sideways',
            } as never),
        );
        expect(error.code).toBe('invalid_params');
    });
});
