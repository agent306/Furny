import { describe, expect, it } from 'vitest';
import type { ExecuteResult } from '../../../commands/types';
import { testIds } from '../../../testing/ids';
import { FIXTURE_KEYS, FIXTURE_LIBRARY } from '../../fixtures';
import { fixtureFootprint } from '../../footprint';
import { MAX_FIXTURES } from '../../limits';
import type { Fixture, PlanDocument } from '../../schema';
import { FOOTPRINT, busOf, ok, oneWall, refused } from '../../testing/graph';
import { PLAN_COMMANDS, createPlanBus } from '../registry';

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

const fixtureOf = (bus: Bus, id: string): Fixture => bus.getDoc().fixtures[id]!;

/** A bus holding one 2000 x 800 x 900 fixture at (3000, 2000), rotation `rotation`. */
function fixtureBus(over: Partial<Fixture> = {}) {
    const { g } = oneWall();
    const id = g.ids('x');
    g.doc.fixtures[id] = {
        id,
        libraryKey: 'sofa_3',
        x: 3000,
        y: 2000,
        rotation: 0,
        width: 2000,
        depth: 800,
        height: 900,
        elevation: 0,
        label: null,
        ...over,
    };
    return { g, id, bus: busOf(g) };
}

const CORNERS = [
    'back_left',
    'back_right',
    'front_right',
    'front_left',
] as const;

// ---- registry ----------------------------------------------------------------

describe('registry', () => {
    it('registers the four fixture commands with labels, schemas and no geometry pass', () => {
        for (const [name, label] of [
            ['addFixture', 'add_fixture'],
            ['moveFixture', 'move_fixture'],
            ['setFixtureProps', 'set_fixture_props'],
            ['deleteFixtures', 'delete_fixtures'],
        ] as const) {
            const def = PLAN_COMMANDS[name];
            expect(def.type).toBe(name);
            expect(def.labelKey).toBe(`engine.plan.command.label.${label}`);
            expect(def.paramsSchema).toBeDefined();
            expect(def.touchesGeometry).toBe(false);
        }
    });

    it('moveFixture and setFixtureProps merge with replace mode', () => {
        const move = PLAN_COMMANDS.moveFixture;
        expect(move.mergeMode ?? 'replace').toBe('replace');
        expect(move.mergeKey?.({ fixtureId: 'x_a', x: 0, y: 0 })).toBe(
            'fixture:x_a',
        );
        const props = PLAN_COMMANDS.setFixtureProps;
        expect(props.mergeMode ?? 'replace').toBe('replace');
        expect(
            props.mergeKey?.({ fixtureIds: ['x_b', 'x_a', 'x_b'], props: {} }),
        ).toBe('fixtureProps:x_a,x_b');
        expect(PLAN_COMMANDS.addFixture.mergeKey).toBeUndefined();
        expect(PLAN_COMMANDS.deleteFixtures.mergeKey).toBeUndefined();
    });
});

// ---- addFixture --------------------------------------------------------------

describe('addFixture', () => {
    it('takes the size and elevation of the library entry', () => {
        const { bus } = fixtureBus();
        const start = bus.getDoc();
        const r = ok(
            bus.execute('addFixture', {
                libraryKey: 'bed_double',
                x: 1000.4,
                y: 2000,
            }),
        );
        expect(r.result.fixtureId).toMatch(/^x_/);
        expect(fixtureOf(bus, r.result.fixtureId)).toEqual({
            id: r.result.fixtureId,
            libraryKey: 'bed_double',
            x: 1000,
            y: 2000,
            rotation: 0,
            width: 1400,
            depth: 1900,
            height: 900,
            elevation: 0,
            label: null,
        });
        expect(r.changedIds.has(r.result.fixtureId)).toBe(true);
        expectUndoRestores(bus, start);
    });

    it('matches the library defaults for every key', () => {
        const { bus } = fixtureBus();
        for (const key of FIXTURE_KEYS) {
            const def = FIXTURE_LIBRARY[key];
            const r = ok(
                bus.execute('addFixture', { libraryKey: key, x: 0, y: 0 }),
            );
            expect(fixtureOf(bus, r.result.fixtureId)).toMatchObject({
                width: def.width,
                depth: def.depth,
                height: def.height,
                elevation: def.elevation,
            });
        }
    });

    it('lets the params override sizes, elevation, rotation and label', () => {
        const { bus } = fixtureBus();
        const r = ok(
            bus.execute('addFixture', {
                libraryKey: 'bed_double',
                x: 0,
                y: 0,
                rotation: 370,
                width: 1500.4,
                depth: 2000,
                height: 500,
                elevation: 100,
                label: 'Master',
            }),
        );
        expect(fixtureOf(bus, r.result.fixtureId)).toMatchObject({
            rotation: 10,
            width: 1500,
            depth: 2000,
            height: 500,
            elevation: 100,
            label: 'Master',
        });
    });

    it('refuses a key that is not in the library with fixture_unknown', () => {
        const { bus } = fixtureBus();
        const error = expectRefusedUntouched(
            bus,
            () =>
                bus.execute('addFixture', { libraryKey: 'piano', x: 0, y: 0 }),
            'fixture_unknown',
        );
        expect(error.messageKey).toBe('engine.plan.command.fixture_unknown');
        expect(error.params).toEqual({ key: 'piano' });
    });

    it('checks the ranges of coordinates, sizes and elevation', () => {
        const { bus } = fixtureBus();
        const base = { libraryKey: 'chair', x: 0, y: 0 };
        const cases: Array<[Record<string, number>, string, number, number]> = [
            [{ x: 1_000_001 }, 'x', -1_000_000, 1_000_000],
            [{ y: -1_000_001 }, 'y', -1_000_000, 1_000_000],
            [{ width: 49 }, 'width', 50, 20_000],
            [{ width: 20_001 }, 'width', 50, 20_000],
            [{ depth: 49 }, 'depth', 50, 20_000],
            [{ height: -1 }, 'height', 0, 10_000],
            [{ height: 10_001 }, 'height', 0, 10_000],
            [{ elevation: 10_001 }, 'elevation', 0, 10_000],
        ];
        for (const [over, field, min, max] of cases) {
            const error = expectRefusedUntouched(
                bus,
                () => bus.execute('addFixture', { ...base, ...over }),
                'out_of_range',
            );
            expect(error.params).toEqual({ field, min, max });
        }
        ok(
            bus.execute('addFixture', {
                ...base,
                width: 50,
                depth: 20_000,
                height: 0,
                elevation: 10_000,
            }),
        );
    });

    it('refuses a fixture beyond the plan limit with too_large', () => {
        const { g } = oneWall();
        const ids = testIds();
        const doc: PlanDocument = {
            ...g.doc,
            fixtures: Object.fromEntries(
                Array.from({ length: MAX_FIXTURES }, () => {
                    const id = ids('x');
                    const f: Fixture = {
                        id,
                        libraryKey: 'chair',
                        x: 0,
                        y: 0,
                        rotation: 0,
                        width: 450,
                        depth: 450,
                        height: 900,
                        elevation: 0,
                        label: null,
                    };
                    return [id, f];
                }),
            ),
        };
        const bus = createPlanBus({
            initial: doc,
            footprints: () => FOOTPRINT,
            newId: g.ids,
        });
        const error = expectRefusedUntouched(
            bus,
            () =>
                bus.execute('addFixture', { libraryKey: 'chair', x: 0, y: 0 }),
            'too_large',
        );
        expect(error.params).toEqual({
            kind: 'fixtures',
            count: MAX_FIXTURES,
            max: MAX_FIXTURES,
        });
    });
});

// ---- moveFixture -------------------------------------------------------------

describe('moveFixture', () => {
    it('moves the fixture and optionally rotates it', () => {
        const { id, bus } = fixtureBus({ rotation: 30 });
        const start = bus.getDoc();
        ok(bus.execute('moveFixture', { fixtureId: id, x: 10.4, y: -20 }));
        expect(fixtureOf(bus, id)).toMatchObject({
            x: 10,
            y: -20,
            rotation: 30,
        });
        ok(
            bus.execute('moveFixture', {
                fixtureId: id,
                x: 1,
                y: 2,
                rotation: -90,
            }),
        );
        expect(fixtureOf(bus, id)).toMatchObject({ x: 1, y: 2, rotation: 270 });
        expect(bus.undo()).toBe(true);
        expect(bus.undo()).toBe(true);
        expect(bus.getDoc()).toEqual(start);
    });

    it('drops the entry of a move that changes nothing', () => {
        const { id, bus } = fixtureBus();
        const before = bus.getDoc();
        ok(bus.execute('moveFixture', { fixtureId: id, x: 3000, y: 2000 }));
        expect(bus.getDoc()).toBe(before);
        expect(bus.history().undo.length).toBe(0);
    });

    it('refuses an unknown fixture and a coordinate out of range', () => {
        const { id, bus } = fixtureBus();
        expect(
            expectRefusedUntouched(
                bus,
                () =>
                    bus.execute('moveFixture', {
                        fixtureId: 'x_no',
                        x: 0,
                        y: 0,
                    }),
                'not_found',
            ).params,
        ).toEqual({ id: 'x_no' });
        expect(
            expectRefusedUntouched(
                bus,
                () =>
                    bus.execute('moveFixture', { fixtureId: id, x: 0, y: 2e6 }),
                'out_of_range',
            ).params,
        ).toMatchObject({ field: 'y' });
    });

    it('merges a drag into one entry that undoes to the start', () => {
        const { id, bus } = fixtureBus();
        const start = bus.getDoc();
        for (let x = 100; x <= 500; x += 100) {
            ok(
                bus.execute(
                    'moveFixture',
                    { fixtureId: id, x, y: x },
                    { merge: true },
                ),
            );
        }
        expect(bus.history().undo.length).toBe(1);
        expect(fixtureOf(bus, id)).toMatchObject({ x: 500, y: 500 });
        expectUndoRestores(bus, start);
    });
});

// ---- setFixtureProps ---------------------------------------------------------

describe('setFixtureProps', () => {
    it('keeps the back-left corner fixed when the width changes', () => {
        const { id, bus } = fixtureBus({
            libraryKey: 'bed_double',
            width: 1400,
            depth: 1900,
        });
        const start = bus.getDoc();
        const cornerBefore = fixtureFootprint(fixtureOf(bus, id)).corners[0];
        ok(
            bus.execute('setFixtureProps', {
                fixtureIds: [id],
                props: { width: 1600 },
                keep: 'back_left',
            }),
        );
        const after = fixtureOf(bus, id);
        expect(after.width).toBe(1600);
        expect(fixtureFootprint(after).corners[0]).toEqual(cornerBefore);
        // the footprint grew to the right, so the centre moved by half the growth
        expect([after.x, after.y]).toEqual([3100, 2000]);
        expectUndoRestores(bus, start);
    });

    it.each(CORNERS)(
        'keeps the %s corner fixed for a width and depth change at any rotation',
        (corner) => {
            const index = CORNERS.indexOf(corner);
            for (const rotation of [0, 90, 180, 270, 33]) {
                const { id, bus } = fixtureBus({ rotation });
                const before = fixtureFootprint(fixtureOf(bus, id)).corners[
                    index
                ]!;
                ok(
                    bus.execute('setFixtureProps', {
                        fixtureIds: [id],
                        props: { width: 2600, depth: 500 },
                        keep: corner,
                    }),
                );
                const after = fixtureFootprint(fixtureOf(bus, id)).corners[
                    index
                ]!;
                expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(0.5);
                expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(0.5);
            }
        },
    );

    it('turns the footprint about the kept corner when a rotation comes with the resize', () => {
        const { id, bus } = fixtureBus();
        const start = bus.getDoc();
        const kept = fixtureFootprint(fixtureOf(bus, id)).corners[0];
        ok(
            bus.execute('setFixtureProps', {
                fixtureIds: [id],
                props: { width: 1000, rotation: 90 },
                keep: 'back_left',
            }),
        );
        const after = fixtureOf(bus, id);
        expect(after).toMatchObject({ width: 1000, rotation: 90 });
        const corner = fixtureFootprint(after).corners[0];
        expect(Math.abs(corner.x - kept.x)).toBeLessThanOrEqual(0.5);
        expect(Math.abs(corner.y - kept.y)).toBeLessThanOrEqual(0.5);
        expectUndoRestores(bus, start);
    });

    it('keeps x, y for keep center and when keep is not given', () => {
        for (const keep of ['center', undefined] as const) {
            const { id, bus } = fixtureBus({ rotation: 45 });
            ok(
                bus.execute('setFixtureProps', {
                    fixtureIds: [id],
                    props: { width: 1000, depth: 1000 },
                    ...(keep === undefined ? {} : { keep }),
                }),
            );
            expect(fixtureOf(bus, id)).toMatchObject({
                x: 3000,
                y: 2000,
                width: 1000,
                depth: 1000,
            });
        }
    });

    it('does not move a corner-kept fixture whose size is unchanged', () => {
        const { id, bus } = fixtureBus();
        const before = bus.getDoc();
        ok(
            bus.execute('setFixtureProps', {
                fixtureIds: [id],
                props: { width: 2000, elevation: 0 },
                keep: 'front_right',
            }),
        );
        expect(bus.getDoc()).toBe(before);
        expect(bus.history().undo.length).toBe(0);
    });

    it('resets the sizes to the new defaults when the library key changes', () => {
        const { id, bus } = fixtureBus({ elevation: 300, label: 'keep me' });
        const start = bus.getDoc();
        ok(
            bus.execute('setFixtureProps', {
                fixtureIds: [id],
                props: { libraryKey: 'bed_double' },
            }),
        );
        expect(fixtureOf(bus, id)).toMatchObject({
            libraryKey: 'bed_double',
            width: 1400,
            depth: 1900,
            height: 900,
            elevation: 0,
            x: 3000,
            y: 2000,
            label: 'keep me',
        });
        expectUndoRestores(bus, start);
    });

    it('keeps the sizes given in the same call as a library key change', () => {
        const { id, bus } = fixtureBus();
        ok(
            bus.execute('setFixtureProps', {
                fixtureIds: [id],
                props: { libraryKey: 'bed_double', width: 1800, elevation: 50 },
            }),
        );
        expect(fixtureOf(bus, id)).toMatchObject({
            libraryKey: 'bed_double',
            width: 1800,
            depth: 1900,
            height: 900,
            elevation: 50,
        });
    });

    it('does not reset the sizes when the library key is the current one', () => {
        const { id, bus } = fixtureBus();
        const before = bus.getDoc();
        ok(
            bus.execute('setFixtureProps', {
                fixtureIds: [id],
                props: { libraryKey: 'sofa_3' },
            }),
        );
        expect(bus.getDoc()).toBe(before);
    });

    it('sets height, elevation, rotation and label, and clears the label with null', () => {
        const { id, bus } = fixtureBus({ label: 'old' });
        ok(
            bus.execute('setFixtureProps', {
                fixtureIds: [id],
                props: {
                    height: 700.4,
                    elevation: 200,
                    rotation: 450,
                    label: 'new',
                },
            }),
        );
        expect(fixtureOf(bus, id)).toMatchObject({
            height: 700,
            elevation: 200,
            rotation: 90,
            label: 'new',
        });
        ok(
            bus.execute('setFixtureProps', {
                fixtureIds: [id],
                props: { label: null },
            }),
        );
        expect(fixtureOf(bus, id).label).toBeNull();
    });

    it('applies the props to every fixture of the selection', () => {
        const { g, id } = fixtureBus();
        const other = g.ids('x');
        g.doc.fixtures[other] = {
            ...g.doc.fixtures[id]!,
            id: other,
            x: 0,
            y: 0,
            width: 1000,
        };
        const bus = busOf(g);
        const start = bus.getDoc();
        ok(
            bus.execute('setFixtureProps', {
                fixtureIds: [other, id],
                props: { width: 1200 },
                keep: 'back_left',
            }),
        );
        expect(fixtureOf(bus, id)).toMatchObject({ width: 1200, x: 2600 });
        expect(fixtureOf(bus, other)).toMatchObject({ width: 1200, x: 100 });
        expectUndoRestores(bus, start);
    });

    it('refuses an unknown fixture, an unknown key and values out of range', () => {
        const { id, bus } = fixtureBus();
        expectRefusedUntouched(
            bus,
            () =>
                bus.execute('setFixtureProps', {
                    fixtureIds: [id, 'x_no'],
                    props: { width: 1000 },
                }),
            'not_found',
        );
        expect(
            expectRefusedUntouched(
                bus,
                () =>
                    bus.execute('setFixtureProps', {
                        fixtureIds: [id],
                        props: { libraryKey: 'piano' },
                    }),
                'fixture_unknown',
            ).params,
        ).toEqual({ key: 'piano' });
        const cases: Array<[Record<string, number>, string, number, number]> = [
            [{ width: 49 }, 'props.width', 50, 20_000],
            [{ depth: 20_001 }, 'props.depth', 50, 20_000],
            [{ height: 10_001 }, 'props.height', 0, 10_000],
            [{ elevation: -1 }, 'props.elevation', 0, 10_000],
        ];
        for (const [props, field, min, max] of cases) {
            expect(
                expectRefusedUntouched(
                    bus,
                    () =>
                        bus.execute('setFixtureProps', {
                            fixtureIds: [id],
                            props,
                        }),
                    'out_of_range',
                ).params,
            ).toEqual({ field, min, max });
        }
    });

    it('refuses a keep that is not a corner or center', () => {
        const { id, bus } = fixtureBus();
        expect(
            refused(
                bus.execute('setFixtureProps', {
                    fixtureIds: [id],
                    props: {},
                    keep: 'middle',
                } as never),
            ).code,
        ).toBe('invalid_params');
    });

    it('merges a resize drag into one entry computed from the start', () => {
        const { id, bus } = fixtureBus();
        const start = bus.getDoc();
        for (const width of [2100, 2300, 2500]) {
            ok(
                bus.execute(
                    'setFixtureProps',
                    { fixtureIds: [id], props: { width }, keep: 'back_left' },
                    { merge: true },
                ),
            );
        }
        expect(bus.history().undo.length).toBe(1);
        expect(fixtureOf(bus, id)).toMatchObject({ width: 2500, x: 3250 });
        expectUndoRestores(bus, start);
    });
});

// ---- deleteFixtures ----------------------------------------------------------

describe('deleteFixtures', () => {
    it('deletes the fixtures and reports their ids', () => {
        const { id, bus } = fixtureBus();
        const start = bus.getDoc();
        const r = ok(bus.execute('deleteFixtures', { fixtureIds: [id, id] }));
        expect(r.deletedIds).toEqual([id]);
        expect(bus.getDoc().fixtures).toEqual({});
        expectUndoRestores(bus, start);
    });

    it('refuses an unknown id and an empty selection', () => {
        const { id, bus } = fixtureBus();
        expectRefusedUntouched(
            bus,
            () => bus.execute('deleteFixtures', { fixtureIds: [id, 'x_no'] }),
            'not_found',
        );
        expect(
            refused(bus.execute('deleteFixtures', { fixtureIds: [] })).code,
        ).toBe('invalid_params');
    });
});
