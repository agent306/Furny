import { describe, expect, it } from 'vitest';
import { roundPoint } from '../../../geometry/vec2';
import { testIds } from '../../../testing/ids';
import { derivePlanGeometry } from '../../derive';
import { makeRectPlan } from '../../testing/fixtures';
import { ok, planBus, refused } from '../../testing/graph';
import { PLAN_COMMANDS } from '../registry';

// ---- fixtures ----------------------------------------------------------------

/** A 4000 x 3000 room (200 mm walls), its bus and the faceKey of the room. */
function roomBus() {
    const ids = testIds();
    const doc = makeRectPlan(4000, 3000, 200, ids);
    const geom = derivePlanGeometry(doc);
    const room = geom.rooms[0]!;
    return { bus: planBus(doc, ids), doc, room, faceKey: room.faceKey };
}

type Bus = ReturnType<typeof roomBus>['bus'];

const entries = (bus: Bus): number => bus.history().undo.length;

// ---- registry ----------------------------------------------------------------

describe('registry', () => {
    it('registers both room meta commands without geometry post-processing', () => {
        for (const [name, label] of [
            ['setRoomMeta', 'set_room_meta'],
            ['deleteRoomMeta', 'delete_room_meta'],
        ] as const) {
            const def = PLAN_COMMANDS[name];
            expect(def.type).toBe(name);
            expect(def.labelKey).toBe(`engine.plan.command.label.${label}`);
            expect(def.paramsSchema).toBeDefined();
            expect(def.touchesGeometry).toBe(false);
        }
    });

    it('setRoomMeta merges with replace mode per faceKey', () => {
        const def = PLAN_COMMANDS.setRoomMeta;
        expect(def.mergeMode ?? 'replace').toBe('replace');
        expect(def.mergeKey?.({ faceKey: 'f1', props: {} })).toBe(
            'roomMeta:f1',
        );
        expect(PLAN_COMMANDS.deleteRoomMeta.mergeKey).toBeUndefined();
    });
});

// ---- setRoomMeta -------------------------------------------------------------

describe('setRoomMeta', () => {
    it('creates the RoomMeta of a face that has none, anchored at the label point', () => {
        const { bus, doc, room, faceKey } = roomBus();
        const r = ok(bus.execute('setRoomMeta', { faceKey, props: {} }));
        expect(r.result.created).toBe(true);
        expect(r.result.metaId).toMatch(/^r_/);
        expect(bus.getDoc().rooms[r.result.metaId]).toEqual({
            id: r.result.metaId,
            anchor: roundPoint(room.labelPoint),
            name: '',
            type: 'other',
            floorFinish: 'tile',
            floorColorHex: null,
            labelOffset: null,
            showArea: true,
        });
        expect(r.changedIds.has(r.result.metaId)).toBe(true);
        expect(bus.undo()).toBe(true);
        expect(bus.getDoc()).toEqual(doc);
    });

    it('applies the props to a new RoomMeta: name trimmed, colour lower-cased, offset rounded', () => {
        const { bus, doc, faceKey } = roomBus();
        const r = ok(
            bus.execute('setRoomMeta', {
                faceKey,
                props: {
                    name: '  Living room  ',
                    type: 'living',
                    floorFinish: 'wood',
                    floorColorHex: '#AABBCC',
                    labelOffset: { x: 10.4, y: -20.6 },
                    showArea: false,
                },
            }),
        );
        expect(bus.getDoc().rooms[r.result.metaId]).toMatchObject({
            name: 'Living room',
            type: 'living',
            floorFinish: 'wood',
            floorColorHex: '#aabbcc',
            labelOffset: { x: 10, y: -21 },
            showArea: false,
        });
        expect(bus.undo()).toBe(true);
        expect(bus.getDoc()).toEqual(doc);
    });

    it('updates the RoomMeta the face has on a second call (created false)', () => {
        const { bus, faceKey } = roomBus();
        const first = ok(
            bus.execute('setRoomMeta', { faceKey, props: { name: 'Hall' } }),
        );
        const afterFirst = bus.getDoc();
        const second = ok(
            bus.execute('setRoomMeta', {
                faceKey,
                props: { type: 'foyer', showArea: false },
            }),
        );
        expect(second.result).toEqual({
            metaId: first.result.metaId,
            created: false,
        });
        expect(Object.keys(bus.getDoc().rooms)).toEqual([first.result.metaId]);
        expect(bus.getDoc().rooms[first.result.metaId]).toMatchObject({
            name: 'Hall',
            type: 'foyer',
            showArea: false,
        });
        expect(bus.undo()).toBe(true);
        expect(bus.getDoc()).toEqual(afterFirst);
    });

    it('updates a RoomMeta that exists in the document and keeps its anchor', () => {
        const ids = testIds();
        const doc = makeRectPlan(4000, 3000, 200, ids);
        doc.rooms.r_0000000009 = {
            id: 'r_0000000009',
            anchor: { x: 1500, y: 1200 },
            name: 'Old',
            type: 'bedroom',
            floorFinish: 'carpet',
            floorColorHex: null,
            labelOffset: { x: 5, y: 5 },
            showArea: true,
        };
        const faceKey = derivePlanGeometry(doc).rooms[0]!.faceKey;
        const bus = planBus(doc, ids);
        const r = ok(
            bus.execute('setRoomMeta', {
                faceKey,
                props: { name: 'New', labelOffset: null },
            }),
        );
        expect(r.result).toEqual({ metaId: 'r_0000000009', created: false });
        expect(bus.getDoc().rooms.r_0000000009).toEqual({
            ...doc.rooms.r_0000000009,
            name: 'New',
            labelOffset: null,
        });
        expect(bus.undo()).toBe(true);
        expect(bus.getDoc()).toEqual(doc);
    });

    it('drops the history entry of a call that changes nothing', () => {
        const { bus, faceKey } = roomBus();
        ok(
            bus.execute('setRoomMeta', {
                faceKey,
                props: { name: 'Hall', labelOffset: { x: 5, y: 6 } },
            }),
        );
        const before = bus.getDoc();
        const count = entries(bus);
        const r = ok(
            bus.execute('setRoomMeta', {
                faceKey,
                props: { name: ' Hall ', labelOffset: { x: 5, y: 6 } },
            }),
        );
        expect(r.result.created).toBe(false);
        expect(bus.getDoc()).toBe(before);
        expect(entries(bus)).toBe(count);
    });

    it('refuses an unknown faceKey with not_found', () => {
        const { bus } = roomBus();
        const before = bus.getDoc();
        const e = refused(
            bus.execute('setRoomMeta', { faceKey: 'nope', props: {} }),
        );
        expect(e.code).toBe('not_found');
        expect(e.messageKey).toBe('engine.plan.command.not_found');
        expect(e.params).toEqual({ id: 'nope' });
        expect(bus.getDoc()).toBe(before);
        expect(entries(bus)).toBe(0);
    });

    it('counts the name in code points after trimming: 80 pass, 81 are out_of_range', () => {
        const { bus, faceKey } = roomBus();
        const emoji80 = '\u{1F6CB}'.repeat(80);
        const r = ok(
            bus.execute('setRoomMeta', {
                faceKey,
                props: { name: ` ${emoji80} ` },
            }),
        );
        expect(bus.getDoc().rooms[r.result.metaId]!.name).toBe(emoji80);

        const before = bus.getDoc();
        const e = refused(
            bus.execute('setRoomMeta', {
                faceKey,
                props: { name: `${emoji80}x` },
            }),
        );
        expect(e.code).toBe('out_of_range');
        expect(e.params).toEqual({ field: 'props.name', min: 0, max: 80 });
        expect(bus.getDoc()).toBe(before);
    });

    it('accepts an empty or blank name', () => {
        const { bus, faceKey } = roomBus();
        const r = ok(
            bus.execute('setRoomMeta', { faceKey, props: { name: '   ' } }),
        );
        expect(bus.getDoc().rooms[r.result.metaId]!.name).toBe('');
    });

    it('refuses a label offset outside the coordinate range', () => {
        const { bus, faceKey } = roomBus();
        const e = refused(
            bus.execute('setRoomMeta', {
                faceKey,
                props: { labelOffset: { x: 1_000_001, y: 0 } },
            }),
        );
        expect(e.code).toBe('out_of_range');
        expect(e.params).toMatchObject({ field: 'props.labelOffset.x' });
    });

    it('refuses params of the wrong type', () => {
        const { bus, faceKey } = roomBus();
        for (const props of [
            { type: 'cellar' },
            { floorFinish: 'lava' },
            { floorColorHex: 'red' },
            { showArea: 'yes' },
        ]) {
            const r = bus.execute('setRoomMeta', { faceKey, props } as never);
            expect(refused(r).code).toBe('invalid_params');
        }
    });

    it('merges consecutive calls on one face into one entry that undoes to the start', () => {
        const { bus, doc, faceKey } = roomBus();
        for (const name of ['H', 'Ha', 'Hall']) {
            ok(
                bus.execute(
                    'setRoomMeta',
                    { faceKey, props: { name } },
                    { merge: true },
                ),
            );
        }
        expect(entries(bus)).toBe(1);
        const [meta] = Object.values(bus.getDoc().rooms);
        expect(meta!.name).toBe('Hall');
        expect(bus.undo()).toBe(true);
        expect(bus.getDoc()).toEqual(doc);
    });
});

// ---- deleteRoomMeta ----------------------------------------------------------

describe('deleteRoomMeta', () => {
    it('deletes the RoomMeta and reports its id', () => {
        const { bus, faceKey } = roomBus();
        const { result } = ok(
            bus.execute('setRoomMeta', { faceKey, props: { name: 'Hall' } }),
        );
        const withMeta = bus.getDoc();
        const r = ok(bus.execute('deleteRoomMeta', { metaId: result.metaId }));
        expect(r.deletedIds).toEqual([result.metaId]);
        expect(bus.getDoc().rooms).toEqual({});
        expect(bus.undo()).toBe(true);
        expect(bus.getDoc()).toEqual(withMeta);
    });

    it('refuses an unknown id with not_found', () => {
        const { bus } = roomBus();
        const e = refused(bus.execute('deleteRoomMeta', { metaId: 'r_x' }));
        expect(e.code).toBe('not_found');
        expect(e.params).toEqual({ id: 'r_x' });
        expect(entries(bus)).toBe(0);
    });
});
