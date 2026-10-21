import { describe, expect, it } from 'vitest';
import type { ExecuteResult } from '../../../commands/types';
import { testIds } from '../../../testing/ids';
import { derivePlanGeometry } from '../../derive';
import { placementFootprint } from '../../footprint';
import { MAX_PLACEMENTS } from '../../limits';
import type { FurniturePlacement, PlanDocument } from '../../schema';
import { FOOTPRINT, busOf, ok, oneWall, refused } from '../../testing/graph';
import { PLAN_COMMANDS, createPlanBus } from '../registry';

// ---- fixtures ----------------------------------------------------------------

type Bus = ReturnType<typeof busOf>;

/** The wall of `oneWall` is at y = 0, 230 thick: its right face is y = 115, facing rotation 0. */
const RIGHT_FACE_Y = 115;
/** Rotation of a placement standing against the left face (y = -115). */
const LEFT_FACE_ROTATION = 180;

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

/** A bus on `oneWall` whose designs are all known except `des_gone`. */
function wallBus() {
    const { g, w } = oneWall();
    const bus = createPlanBus({
        initial: g.doc,
        footprints: (id) => (id === 'des_gone' ? null : FOOTPRINT),
        newId: g.ids,
    });
    return { g, w, bus };
}

/** A plain bus with one placement `des_x` at (2000, 1000), rotation 0, unattached. */
function placedBus(over: Partial<FurniturePlacement> = {}) {
    const { g, w } = oneWall();
    const id = g.placement(w, 'right', 2000, 1000);
    g.doc.placements[id] = {
        ...g.doc.placements[id]!,
        wallAttachment: null,
        ...over,
    };
    return { g, w, id, bus: busOf(g) };
}

const placementOf = (bus: Bus, id: string): FurniturePlacement =>
    bus.getDoc().placements[id]!;

// ---- registry ----------------------------------------------------------------

describe('registry', () => {
    it('registers the five placement commands with labels, schemas and no geometry pass', () => {
        for (const [name, label] of [
            ['addPlacement', 'add_placement'],
            ['movePlacement', 'move_placement'],
            ['rotatePlacement', 'rotate_placement'],
            ['setPlacementProps', 'set_placement_props'],
            ['deletePlacements', 'delete_placements'],
        ] as const) {
            const def = PLAN_COMMANDS[name];
            expect(def.type).toBe(name);
            expect(def.labelKey).toBe(`engine.plan.command.label.${label}`);
            expect(def.paramsSchema).toBeDefined();
            expect(def.touchesGeometry).toBe(false);
        }
    });

    it('movePlacement and rotatePlacement merge with replace mode per placement', () => {
        const move = PLAN_COMMANDS.movePlacement;
        expect(move.mergeMode ?? 'replace').toBe('replace');
        expect(
            move.mergeKey?.({
                placementId: 'f_a',
                x: 0,
                y: 0,
                wallAttachment: null,
            }),
        ).toBe('placement:f_a');
        const rotate = PLAN_COMMANDS.rotatePlacement;
        expect(rotate.mergeMode ?? 'replace').toBe('replace');
        expect(
            rotate.mergeKey?.({
                placementId: 'f_a',
                rotation: 0,
                pivot: 'center',
            }),
        ).toBe('placementRot:f_a');
        for (const name of [
            'addPlacement',
            'setPlacementProps',
            'deletePlacements',
        ] as const) {
            expect(PLAN_COMMANDS[name].mergeKey).toBeUndefined();
        }
    });
});

// ---- addPlacement ------------------------------------------------------------

describe('addPlacement', () => {
    it('adds a placement with the defaults', () => {
        const { bus } = wallBus();
        const start = bus.getDoc();
        const r = ok(
            bus.execute('addPlacement', {
                designId: 'des_a',
                x: 1000.4,
                y: 2000.6,
                rotation: 90,
            }),
        );
        expect(r.result.placementId).toMatch(/^f_/);
        expect(placementOf(bus, r.result.placementId)).toEqual({
            id: r.result.placementId,
            designId: 'des_a',
            x: 1000,
            y: 2001,
            rotation: 90,
            elevation: 0,
            mirrored: false,
            wallAttachment: null,
        });
        expect(r.changedIds.has(r.result.placementId)).toBe(true);
        expectUndoRestores(bus, start);
    });

    it('normalises the rotation into [0, 360)', () => {
        const { bus } = wallBus();
        const rotationOf = (rotation: number): number => {
            const r = ok(
                bus.execute('addPlacement', {
                    designId: 'des_a',
                    x: 0,
                    y: 0,
                    rotation,
                }),
            );
            return placementOf(bus, r.result.placementId).rotation;
        };
        expect(rotationOf(370)).toBe(10);
        expect(rotationOf(-90)).toBe(270);
        expect(rotationOf(360)).toBe(0);
        expect(rotationOf(720.5)).toBe(0.5);
    });

    it('takes elevation, mirrored and a wall attachment as given', () => {
        const { w, bus } = wallBus();
        const start = bus.getDoc();
        const r = ok(
            bus.execute('addPlacement', {
                designId: 'des_a',
                x: 2000,
                y: RIGHT_FACE_Y,
                rotation: 0,
                elevation: 1200,
                mirrored: true,
                wallAttachment: { wallId: w, side: 'right' },
            }),
        );
        expect(placementOf(bus, r.result.placementId)).toMatchObject({
            elevation: 1200,
            mirrored: true,
            wallAttachment: { wallId: w, side: 'right' },
        });
        expectUndoRestores(bus, start);
    });

    it('refuses a design the footprint provider does not know with design_unknown', () => {
        const { bus } = wallBus();
        const error = expectRefusedUntouched(
            bus,
            () =>
                bus.execute('addPlacement', {
                    designId: 'des_gone',
                    x: 0,
                    y: 0,
                    rotation: 0,
                }),
            'design_unknown',
        );
        expect(error.messageKey).toBe('engine.plan.command.design_unknown');
        expect(error.params).toEqual({ designId: 'des_gone' });
    });

    it('refuses an attachment to a wall that does not exist', () => {
        const { bus } = wallBus();
        const error = expectRefusedUntouched(
            bus,
            () =>
                bus.execute('addPlacement', {
                    designId: 'des_a',
                    x: 0,
                    y: 0,
                    rotation: 0,
                    wallAttachment: { wallId: 'w_nope', side: 'left' },
                }),
            'not_found',
        );
        expect(error.params).toEqual({ id: 'w_nope' });
    });

    it('checks the ranges of the coordinates and the elevation', () => {
        const { bus } = wallBus();
        const base = { designId: 'des_a', x: 0, y: 0, rotation: 0 };
        const cases: Array<[Record<string, number>, string, number, number]> = [
            [{ x: 1_000_001 }, 'x', -1_000_000, 1_000_000],
            [{ y: -1_000_001 }, 'y', -1_000_000, 1_000_000],
            [{ elevation: 10_001 }, 'elevation', 0, 10_000],
            [{ elevation: -1 }, 'elevation', 0, 10_000],
        ];
        for (const [over, field, min, max] of cases) {
            const error = expectRefusedUntouched(
                bus,
                () => bus.execute('addPlacement', { ...base, ...over }),
                'out_of_range',
            );
            expect(error.params).toEqual({ field, min, max });
        }
        ok(bus.execute('addPlacement', { ...base, elevation: 10_000 }));
    });

    it('refuses a placement beyond the plan limit with too_large', () => {
        const { g, bus } = wallBus();
        const ids = testIds();
        const doc = bus.getDoc();
        const full: PlanDocument = {
            ...doc,
            placements: Object.fromEntries(
                Array.from({ length: MAX_PLACEMENTS }, () => {
                    const id = ids('f');
                    return [id, { ...placementOfNew(id) }];
                }),
            ),
        };
        const fullBus = createPlanBus({
            initial: full,
            footprints: () => FOOTPRINT,
            newId: g.ids,
        });
        const error = expectRefusedUntouched(
            fullBus,
            () =>
                fullBus.execute('addPlacement', {
                    designId: 'des_a',
                    x: 0,
                    y: 0,
                    rotation: 0,
                }),
            'too_large',
        );
        expect(error.params).toEqual({
            kind: 'placements',
            count: MAX_PLACEMENTS,
            max: MAX_PLACEMENTS,
        });
    });

    it('refuses an empty design id and a non-numeric position', () => {
        const { bus } = wallBus();
        for (const params of [
            { designId: '', x: 0, y: 0, rotation: 0 },
            { designId: 'des_a', x: 'a', y: 0, rotation: 0 },
            { designId: 'des_a', x: 0, y: 0 },
        ]) {
            expect(
                refused(bus.execute('addPlacement', params as never)).code,
            ).toBe('invalid_params');
        }
    });
});

function placementOfNew(id: string): FurniturePlacement {
    return {
        id,
        designId: 'des_x',
        x: 0,
        y: 0,
        rotation: 0,
        elevation: 0,
        mirrored: false,
        wallAttachment: null,
    };
}

// ---- movePlacement -----------------------------------------------------------

describe('movePlacement', () => {
    it('sets the position, the optional rotation and the attachment exactly as given', () => {
        const { w, id, bus } = placedBus({ rotation: 30 });
        const start = bus.getDoc();
        ok(
            bus.execute('movePlacement', {
                placementId: id,
                x: 3000.4,
                y: 500,
                wallAttachment: { wallId: w, side: 'left' },
            }),
        );
        expect(placementOf(bus, id)).toMatchObject({
            x: 3000,
            y: 500,
            rotation: 30,
            wallAttachment: { wallId: w, side: 'left' },
        });
        ok(
            bus.execute('movePlacement', {
                placementId: id,
                x: 10,
                y: 20,
                rotation: 400,
                wallAttachment: null,
            }),
        );
        expect(placementOf(bus, id)).toMatchObject({
            x: 10,
            y: 20,
            rotation: 40,
            wallAttachment: null,
        });
        expect(bus.undo()).toBe(true);
        expect(bus.undo()).toBe(true);
        expect(bus.getDoc()).toEqual(start);
    });

    it('keeps the document order of the placements', () => {
        const { g, w, id } = placedBus();
        const second = g.placement(w, 'right', 100, 100);
        const bus = busOf(g);
        const order = Object.keys(bus.getDoc().placements);
        expect(order).toEqual([id, second]);
        ok(
            bus.execute('movePlacement', {
                placementId: id,
                x: 9,
                y: 9,
                wallAttachment: null,
            }),
        );
        expect(Object.keys(bus.getDoc().placements)).toEqual(order);
    });

    it('drops the entry of a move that changes nothing', () => {
        const { w, id, bus } = placedBus({
            wallAttachment: { wallId: 'w_0000000001', side: 'right' },
        });
        const before = bus.getDoc();
        const attached = placementOf(bus, id).wallAttachment!;
        expect(attached.wallId).toBe(w);
        ok(
            bus.execute('movePlacement', {
                placementId: id,
                x: 2000,
                y: 1000,
                wallAttachment: { wallId: w, side: 'right' },
            }),
        );
        expect(bus.getDoc()).toBe(before);
        expect(bus.history().undo.length).toBe(0);
    });

    it('refuses an unknown placement, an unknown wall and a coordinate out of range', () => {
        const { id, bus } = placedBus();
        const move = (over: object) => () =>
            bus.execute('movePlacement', {
                placementId: id,
                x: 0,
                y: 0,
                wallAttachment: null,
                ...over,
            });
        expect(
            expectRefusedUntouched(
                bus,
                move({ placementId: 'f_no' }),
                'not_found',
            ).params,
        ).toEqual({ id: 'f_no' });
        expect(
            expectRefusedUntouched(
                bus,
                move({ wallAttachment: { wallId: 'w_no', side: 'left' } }),
                'not_found',
            ).params,
        ).toEqual({ id: 'w_no' });
        expect(
            expectRefusedUntouched(bus, move({ x: 2_000_000 }), 'out_of_range')
                .params,
        ).toMatchObject({ field: 'x' });
    });

    it('requires the attachment in the params', () => {
        const { id, bus } = placedBus();
        expect(
            refused(
                bus.execute('movePlacement', {
                    placementId: id,
                    x: 0,
                    y: 0,
                } as never),
            ).code,
        ).toBe('invalid_params');
    });

    it('merges a drag into one entry that undoes to the start', () => {
        const { id, bus } = placedBus();
        const start = bus.getDoc();
        for (let x = 100; x <= 1000; x += 100) {
            ok(
                bus.execute(
                    'movePlacement',
                    { placementId: id, x, y: x, wallAttachment: null },
                    { merge: true },
                ),
            );
        }
        expect(bus.history().undo.length).toBe(1);
        expect(placementOf(bus, id)).toMatchObject({ x: 1000, y: 1000 });
        expectUndoRestores(bus, start);
    });
});

// ---- rotatePlacement ---------------------------------------------------------

describe('rotatePlacement', () => {
    it('with pivot center keeps the footprint centre fixed', () => {
        const { id, bus } = placedBus();
        const start = bus.getDoc();
        const centreOf = (): { x: number; y: number } =>
            placementFootprint(placementOf(bus, id), FOOTPRINT).center;
        expect(centreOf()).toEqual({ x: 2000, y: 1250 });
        ok(
            bus.execute('rotatePlacement', {
                placementId: id,
                rotation: 90,
                pivot: 'center',
            }),
        );
        // f(90) = (-1, 0): P' = C - f * depth / 2
        expect(placementOf(bus, id)).toMatchObject({
            x: 2250,
            y: 1250,
            rotation: 90,
        });
        expect(centreOf()).toEqual({ x: 2000, y: 1250 });
        expectUndoRestores(bus, start);
    });

    it('with pivot center keeps the centre within rounding at an oblique angle', () => {
        const { id, bus } = placedBus({ rotation: 20 });
        const before = placementFootprint(
            placementOf(bus, id),
            FOOTPRINT,
        ).center;
        ok(
            bus.execute('rotatePlacement', {
                placementId: id,
                rotation: 137.5,
                pivot: 'center',
            }),
        );
        const after = placementFootprint(
            placementOf(bus, id),
            FOOTPRINT,
        ).center;
        expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(0.5);
        expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(0.5);
        expect(placementOf(bus, id).rotation).toBe(137.5);
    });

    it('with pivot back_center keeps x, y and normalises the rotation', () => {
        const { id, bus } = placedBus();
        ok(
            bus.execute('rotatePlacement', {
                placementId: id,
                rotation: -45,
                pivot: 'back_center',
            }),
        );
        expect(placementOf(bus, id)).toMatchObject({
            x: 2000,
            y: 1000,
            rotation: 315,
        });
    });

    it('keeps the attachment while the rotation matches the attached face within 0.5 degrees', () => {
        const { g, w } = oneWall();
        const id = g.placement(w, 'right', 2000, RIGHT_FACE_Y);
        const bus = busOf(g);
        const start = bus.getDoc();
        const rotate = (rotation: number) =>
            ok(
                bus.execute('rotatePlacement', {
                    placementId: id,
                    rotation,
                    pivot: 'back_center',
                }),
            );
        rotate(0.4);
        expect(placementOf(bus, id).wallAttachment).toEqual({
            wallId: w,
            side: 'right',
        });
        // wraps at 360: 359.7 is 0.3 away from the face rotation 0
        rotate(359.7);
        expect(placementOf(bus, id).wallAttachment).not.toBeNull();
        rotate(0.5);
        expect(placementOf(bus, id).wallAttachment).not.toBeNull();
        rotate(0.6);
        expect(placementOf(bus, id).wallAttachment).toBeNull();
        for (let i = 0; i < 4; i += 1) expect(bus.undo()).toBe(true);
        expect(bus.getDoc()).toEqual(start);
    });

    it('detaches when the rotation falls just short of the face on the other side of 360', () => {
        const { g, w } = oneWall();
        const id = g.placement(w, 'right', 2000, RIGHT_FACE_Y);
        const bus = busOf(g);
        ok(
            bus.execute('rotatePlacement', {
                placementId: id,
                rotation: 359.4,
                pivot: 'back_center',
            }),
        );
        expect(placementOf(bus, id).wallAttachment).toBeNull();
    });

    it('judges the face of the attached side', () => {
        const { g, w } = oneWall();
        const id = g.placement(w, 'left', 2000, -RIGHT_FACE_Y);
        const bus = busOf(g);
        const start = bus.getDoc();
        const geom = derivePlanGeometry(start);
        expect(geom.walls[w]!.normal).toEqual({ x: 0, y: -1 });
        ok(
            bus.execute('rotatePlacement', {
                placementId: id,
                rotation: LEFT_FACE_ROTATION,
                pivot: 'back_center',
            }),
        );
        expect(placementOf(bus, id).wallAttachment).not.toBeNull();
        ok(
            bus.execute('rotatePlacement', {
                placementId: id,
                rotation: 0,
                pivot: 'back_center',
            }),
        );
        expect(placementOf(bus, id).wallAttachment).toBeNull();
    });

    it('refuses an unknown placement', () => {
        const { bus } = placedBus();
        expectRefusedUntouched(
            bus,
            () =>
                bus.execute('rotatePlacement', {
                    placementId: 'f_no',
                    rotation: 1,
                    pivot: 'center',
                }),
            'not_found',
        );
    });

    it('needs the footprint of the design for pivot center only', () => {
        const { w, bus } = wallBus();
        const doc = bus.getDoc();
        const placement: FurniturePlacement = {
            ...placementOfNew('f_0000000001'),
            designId: 'des_gone',
            wallAttachment: { wallId: w, side: 'right' },
        };
        bus.reset({ ...doc, placements: { [placement.id]: placement } });
        const error = expectRefusedUntouched(
            bus,
            () =>
                bus.execute('rotatePlacement', {
                    placementId: placement.id,
                    rotation: 10,
                    pivot: 'center',
                }),
            'design_unknown',
        );
        expect(error.params).toEqual({ designId: 'des_gone' });
        ok(
            bus.execute('rotatePlacement', {
                placementId: placement.id,
                rotation: 10,
                pivot: 'back_center',
            }),
        );
    });

    it('merges a rotate drag into one entry that undoes to the start', () => {
        const { id, bus } = placedBus();
        const start = bus.getDoc();
        for (const rotation of [10, 20, 30, 45]) {
            ok(
                bus.execute(
                    'rotatePlacement',
                    { placementId: id, rotation, pivot: 'center' },
                    { merge: true },
                ),
            );
        }
        expect(bus.history().undo.length).toBe(1);
        const merged = bus.getDoc();
        expect(bus.undo()).toBe(true);
        expect(bus.getDoc()).toEqual(start);
        // replace mode: the result is the last call alone, run on the start
        ok(
            bus.execute('rotatePlacement', {
                placementId: id,
                rotation: 45,
                pivot: 'center',
            }),
        );
        expect(bus.getDoc()).toEqual(merged);
    });
});

// ---- setPlacementProps -------------------------------------------------------

describe('setPlacementProps', () => {
    it('sets elevation and mirrored on every placement of the selection', () => {
        const { g, w, id } = placedBus();
        const other = g.placement(w, 'left', 500, -100);
        const bus = busOf(g);
        const start = bus.getDoc();
        ok(
            bus.execute('setPlacementProps', {
                placementIds: [other, id, id],
                props: { elevation: 850.4, mirrored: true },
            }),
        );
        for (const pid of [id, other]) {
            expect(placementOf(bus, pid)).toMatchObject({
                elevation: 850,
                mirrored: true,
            });
        }
        expectUndoRestores(bus, start);
    });

    it('leaves a field alone that is not given and drops a no-op', () => {
        const { id, bus } = placedBus({ elevation: 300 });
        const before = bus.getDoc();
        ok(
            bus.execute('setPlacementProps', {
                placementIds: [id],
                props: { mirrored: false },
            }),
        );
        expect(bus.getDoc()).toBe(before);
        expect(bus.history().undo.length).toBe(0);
        ok(
            bus.execute('setPlacementProps', {
                placementIds: [id],
                props: { mirrored: true },
            }),
        );
        expect(placementOf(bus, id).elevation).toBe(300);
    });

    it('refuses an unknown id and an elevation out of range', () => {
        const { id, bus } = placedBus();
        expectRefusedUntouched(
            bus,
            () =>
                bus.execute('setPlacementProps', {
                    placementIds: [id, 'f_no'],
                    props: { mirrored: true },
                }),
            'not_found',
        );
        const error = expectRefusedUntouched(
            bus,
            () =>
                bus.execute('setPlacementProps', {
                    placementIds: [id],
                    props: { elevation: 10_001 },
                }),
            'out_of_range',
        );
        expect(error.params).toEqual({
            field: 'props.elevation',
            min: 0,
            max: 10_000,
        });
    });
});

// ---- deletePlacements --------------------------------------------------------

describe('deletePlacements', () => {
    it('deletes the placements and reports their ids', () => {
        const { g, w, id } = placedBus();
        const other = g.placement(w, 'left', 500, -100);
        const bus = busOf(g);
        const start = bus.getDoc();
        const r = ok(
            bus.execute('deletePlacements', { placementIds: [other, id] }),
        );
        expect(r.deletedIds).toEqual([id, other].sort());
        expect(bus.getDoc().placements).toEqual({});
        expect(r.changedIds.has(id)).toBe(true);
        expectUndoRestores(bus, start);
    });

    it('refuses when one id is unknown and deletes nothing', () => {
        const { id, bus } = placedBus();
        expectRefusedUntouched(
            bus,
            () =>
                bus.execute('deletePlacements', { placementIds: [id, 'f_no'] }),
            'not_found',
        );
    });

    it('refuses an empty selection', () => {
        const { bus } = placedBus();
        expect(
            refused(bus.execute('deletePlacements', { placementIds: [] })).code,
        ).toBe('invalid_params');
    });
});
