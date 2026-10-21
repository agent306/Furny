import { describe, expect, it } from 'vitest';
import { diningTable } from '../../testing/docs';
import { furnitureBus, refused, roundTrip } from '../../testing/commands';

describe('setConstruction', () => {
    it('sets top and bottom independently', () => {
        const { after } = roundTrip('furniture.setConstruction', {
            top: 'over_sides',
        });
        expect(after.carcass!.construction).toEqual({
            top: 'over_sides',
            bottom: 'between_sides',
        });
        const both = roundTrip('furniture.setConstruction', {
            top: 'over_sides',
            bottom: 'over_sides',
        });
        expect(both.after.carcass!.construction.bottom).toBe('over_sides');
    });
});

describe('setMounting', () => {
    const NO_PLINTH = { type: 'none', height: 0, setback: 0, legCode: null };

    it('wall and loft reset the plinth', () => {
        for (const mounting of ['wall', 'loft'] as const) {
            const { after } = roundTrip('furniture.setMounting', { mounting });
            expect(after.carcass!.mounting).toBe(mounting);
            expect(after.carcass!.plinth).toEqual(NO_PLINTH);
        }
    });

    it('floor keeps the plinth', () => {
        const bus = furnitureBus();
        bus.execute('furniture.setMounting', { mounting: 'wall' });
        bus.execute('furniture.setPlinth', { type: 'legs', height: 120 });
        bus.execute('furniture.setMounting', { mounting: 'floor' });
        expect(bus.getDoc().carcass!.mounting).toBe('floor');
        expect(bus.getDoc().carcass!.plinth.type).toBe('legs');
    });
});

describe('setPlinth', () => {
    it('type none sets the height to 0, whatever height is given', () => {
        const { after } = roundTrip('furniture.setPlinth', { type: 'none' });
        expect(after.carcass!.plinth).toEqual({
            type: 'none',
            height: 0,
            setback: 20,
            legCode: null,
        });
        const withHeight = roundTrip('furniture.setPlinth', {
            type: 'none',
            height: 80,
        });
        expect(withHeight.after.carcass!.plinth.height).toBe(0);
    });

    it('merges the given fields into the plinth', () => {
        const { after } = roundTrip('furniture.setPlinth', {
            type: 'legs',
            height: 120,
            legCode: 'LEG-ADJ-100',
        });
        expect(after.carcass!.plinth).toEqual({
            type: 'legs',
            height: 120,
            setback: 20,
            legCode: 'LEG-ADJ-100',
        });
    });

    it('merges a drag under the key plinth', () => {
        const bus = furnitureBus();
        bus.execute('furniture.setPlinth', { height: 110 });
        bus.execute('furniture.setPlinth', { height: 130 }, { merge: true });
        expect(bus.history().undo).toHaveLength(1);
        expect(bus.history().undo[0]!.mergeKey).toBe('plinth');
    });

    it('refuses a negative or oversized value with out_of_range { field, min, max }', () => {
        const bus = furnitureBus();
        const error = refused(
            bus.execute('furniture.setPlinth', { height: -5 }),
        );
        expect(error.code).toBe('out_of_range');
        expect(error.params).toEqual({ field: 'height', min: 0, max: 6000 });
        expect(
            refused(bus.execute('furniture.setPlinth', { setback: 9000 }))
                .params.field,
        ).toBe('setback');
    });
});

describe('setBack', () => {
    it('sets the back type', () => {
        const { after } = roundTrip('furniture.setBack', { type: 'nailed' });
        expect(after.carcass!.back).toEqual({ type: 'nailed' });
    });
});

describe('setCountertop', () => {
    const top = {
        enabled: true,
        overhangFront: 20,
        overhangLeft: 0,
        overhangRight: 10,
    };

    it('sets a countertop, changes it and removes it with null', () => {
        const set = roundTrip('furniture.setCountertop', top);
        expect(set.after.carcass!.countertop).toEqual(top);

        const bus = furnitureBus();
        bus.execute('furniture.setCountertop', top);
        bus.execute('furniture.setCountertop', { ...top, overhangFront: 40 });
        expect(bus.getDoc().carcass!.countertop!.overhangFront).toBe(40);
        bus.execute('furniture.setCountertop', null);
        expect(bus.getDoc().carcass!.countertop).toBeNull();
        bus.undo();
        expect(bus.getDoc().carcass!.countertop!.overhangFront).toBe(40);
    });

    it('merges under the key countertop', () => {
        const bus = furnitureBus();
        bus.execute('furniture.setCountertop', top);
        bus.execute(
            'furniture.setCountertop',
            { ...top, overhangFront: 30 },
            { merge: true },
        );
        expect(bus.history().undo).toHaveLength(1);
        expect(bus.history().undo[0]!.mergeKey).toBe('countertop');
    });

    it('refuses a negative overhang', () => {
        const bus = furnitureBus();
        const error = refused(
            bus.execute('furniture.setCountertop', {
                ...top,
                overhangLeft: -1,
            }),
        );
        expect(error.code).toBe('out_of_range');
        expect(error.params.field).toBe('overhangLeft');
    });
});

describe('setHandles', () => {
    it('merges the given fields', () => {
        const { after } = roundTrip('furniture.setHandles', {
            orientation: 'horizontal',
            code: null,
        });
        expect(after.carcass!.handles).toEqual({
            code: null,
            orientation: 'horizontal',
            placement: 'auto',
        });
    });
});

describe('carcass commands on a table', () => {
    it('are refused with not_found { id: "carcass" }', () => {
        const bus = furnitureBus(diningTable());
        for (const [type, params] of [
            ['furniture.setConstruction', { top: 'over_sides' }],
            ['furniture.setMounting', { mounting: 'wall' }],
            ['furniture.setPlinth', { height: 50 }],
            ['furniture.setBack', { type: 'none' }],
            ['furniture.setCountertop', null],
            ['furniture.setHandles', { code: null }],
        ] as const) {
            const error = refused(bus.execute(type, params as never));
            expect(error.code).toBe('not_found');
            expect(error.params).toEqual({ id: 'carcass' });
        }
        expect(bus.history().undo).toHaveLength(0);
    });
});
