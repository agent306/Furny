import { describe, expect, it } from 'vitest';
import { diningTable, studyDesk } from '../../testing/docs';
import { furnitureBus, ok, refused, roundTrip } from '../../testing/commands';

describe('setTable', () => {
    it('deep-merges the patch: untouched fields of the same object stay', () => {
        const { before, after } = roundTrip(
            'furniture.setTable',
            {
                patch: {
                    top: { overhang: 80 },
                    base: { apron: { height: 100 } },
                },
            },
            diningTable(),
        );
        expect(after.table!.top).toEqual({
            ...before.table!.top,
            overhang: 80,
        });
        expect(after.table!.base.apron).toEqual({
            enabled: true,
            height: 100,
            inset: 15,
        });
        expect(after.table!.base.type).toBe('four_legs');
        expect(after.table!.storage).toEqual(before.table!.storage);
    });

    it('replaces arrays instead of merging them', () => {
        const doc = studyDesk((d) => {
            d.table.storage.endCabinets!.content = {
                type: 'drawers',
                count: 3,
                frontHeights: [100, 200, 300],
                slideCode: null,
                behindDoor: false,
            };
        });
        const { after } = roundTrip(
            'furniture.setTable',
            {
                patch: {
                    storage: {
                        endCabinets: {
                            content: {
                                type: 'drawers',
                                count: 2,
                                frontHeights: [150, 250],
                                slideCode: null,
                                behindDoor: false,
                            },
                        },
                    },
                },
            },
            doc,
        );
        const content = after.table!.storage.endCabinets!.content;
        expect(content).toMatchObject({ count: 2, frontHeights: [150, 250] });
        expect(after.table!.storage.endCabinets!.width).toBe(400);
    });

    it('sets nullable objects: null clears, an object fills', () => {
        const filled = roundTrip(
            'furniture.setTable',
            {
                patch: {
                    storage: {
                        drawers: { count: 2, side: 'front', slideCode: null },
                    },
                },
            },
            diningTable(),
        );
        expect(filled.after.table!.storage.drawers).toEqual({
            count: 2,
            side: 'front',
            slideCode: null,
        });
        const cleared = roundTrip(
            'furniture.setTable',
            { patch: { storage: { endCabinets: null } } },
            studyDesk(),
        );
        expect(cleared.after.table!.storage.endCabinets).toBeNull();
    });

    it('merges under the key table', () => {
        const bus = furnitureBus(diningTable());
        ok(
            bus.execute('furniture.setTable', {
                patch: { top: { overhang: 60 } },
            }),
        );
        ok(
            bus.execute(
                'furniture.setTable',
                { patch: { top: { overhang: 70 } } },
                { merge: true },
            ),
        );
        expect(bus.history().undo).toHaveLength(1);
        expect(bus.history().undo[0]!.mergeKey).toBe('table');
    });

    it('refuses a carcass document with not_found { id: "table" } and bad patches with invalid_params', () => {
        expect(
            refused(
                furnitureBus().execute('furniture.setTable', {
                    patch: { top: { overhang: 10 } },
                }),
            ),
        ).toMatchObject({ code: 'not_found', params: { id: 'table' } });
        const bus = furnitureBus(diningTable());
        expect(
            refused(
                bus.execute('furniture.setTable', {
                    patch: { top: { shape: 'triangle' as never } },
                }),
            ).code,
        ).toBe('invalid_params');
        expect(bus.history().undo).toHaveLength(0);
    });

    it('aborts with invalid_document when the merge leaves a half-filled object', () => {
        const bus = furnitureBus(diningTable());
        const before = bus.getDoc();
        const error = refused(
            bus.execute('furniture.setTable', {
                patch: { storage: { drawers: { count: 2 } } },
            }),
        );
        expect(error.code).toBe('invalid_document');
        expect(bus.getDoc()).toBe(before);
    });
});
