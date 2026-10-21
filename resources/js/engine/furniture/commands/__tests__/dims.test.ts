import { describe, expect, it } from 'vitest';
import { diningTable, wardrobeFixture } from '../../testing/docs';
import { furnitureBus, ok, refused, roundTrip } from '../../testing/commands';

describe('setDims', () => {
    it('sets the given dimensions and leaves the others; undo restores', () => {
        const { after } = roundTrip('furniture.setDims', { width: 2100 });
        expect(after.dims).toEqual({ width: 2100, height: 2100, depth: 600 });
    });

    it('clamps to 03 §2.4: width 150-6000, height 100-3000, depth 100-1200', () => {
        const { after } = roundTrip('furniture.setDims', {
            width: 7000,
            height: 50,
            depth: 5000,
        });
        expect(after.dims).toEqual({ width: 6000, height: 100, depth: 1200 });

        const low = roundTrip('furniture.setDims', { width: 10, depth: 1 });
        expect(low.after.dims).toEqual({
            width: 150,
            height: 2100,
            depth: 100,
        });
    });

    it('rounds to whole millimetres', () => {
        const { after } = roundTrip('furniture.setDims', { height: 2000.6 });
        expect(after.dims.height).toBe(2001);
    });

    it('keeps depth = width on a round table, the width leading', () => {
        const round = () =>
            diningTable((d) => {
                d.table.top.shape = 'round';
                d.dims = { width: 900, height: 750, depth: 900 };
            });

        expect(
            roundTrip('furniture.setDims', { width: 1000 }, round()).after.dims,
        ).toEqual({ width: 1000, height: 750, depth: 1000 });
        expect(
            roundTrip('furniture.setDims', { depth: 700 }, round()).after.dims,
        ).toEqual({ width: 700, height: 750, depth: 700 });
        expect(
            roundTrip('furniture.setDims', { width: 800, depth: 500 }, round())
                .after.dims,
        ).toEqual({ width: 800, height: 750, depth: 800 });
    });

    it('caps a round table diameter at the depth range (1200) and floors it at 150', () => {
        const round = () =>
            diningTable((d) => {
                d.table.top.shape = 'round';
                d.dims = { width: 900, height: 750, depth: 900 };
            });
        expect(
            roundTrip('furniture.setDims', { width: 3000 }, round()).after.dims,
        ).toEqual({ width: 1200, height: 750, depth: 1200 });
        expect(
            roundTrip('furniture.setDims', { depth: 20 }, round()).after.dims,
        ).toEqual({ width: 150, height: 750, depth: 150 });
    });

    it('does not couple depth to width on other tables or on carcasses', () => {
        const table = roundTrip(
            'furniture.setDims',
            { width: 2000 },
            diningTable(),
        );
        expect(table.after.dims).toEqual({
            width: 2000,
            height: 750,
            depth: 900,
        });
        const height = roundTrip(
            'furniture.setDims',
            { height: 800 },
            diningTable((d) => {
                d.table.top.shape = 'round';
                d.dims = { width: 900, height: 750, depth: 900 };
            }),
        );
        expect(height.after.dims).toEqual({
            width: 900,
            height: 800,
            depth: 900,
        });
    });

    it('merges a typing burst into one entry (mergeKey dims) that undoes to the start', () => {
        const bus = furnitureBus();
        const original = bus.getDoc();
        ok(bus.execute('furniture.setDims', { width: 1900 }));
        ok(bus.execute('furniture.setDims', { width: 2000 }, { merge: true }));
        ok(bus.execute('furniture.setDims', { width: 2100 }, { merge: true }));
        expect(bus.history().undo).toHaveLength(1);
        expect(bus.history().undo[0]!.mergeKey).toBe('dims');
        expect(bus.getDoc().dims.width).toBe(2100);
        bus.undo();
        expect(bus.getDoc()).toEqual(original);
    });

    it('a merge re-runs only the latest params: the editor seals between fields (07 §9)', () => {
        // Documented limitation of replace merges (04 §6.2): different fields
        // in one burst lose the earlier ones, so a field change is sealed
        // (blur, pointer-up) before the next field is edited.
        const bus = furnitureBus();
        ok(bus.execute('furniture.setDims', { width: 2000 }));
        ok(bus.execute('furniture.setDims', { height: 1800 }, { merge: true }));
        expect(bus.getDoc().dims).toEqual({
            width: 1800,
            height: 1800,
            depth: 600,
        });

        const sealed = furnitureBus();
        ok(sealed.execute('furniture.setDims', { width: 2000 }));
        sealed.seal();
        ok(
            sealed.execute(
                'furniture.setDims',
                { height: 1800 },
                { merge: true },
            ),
        );
        expect(sealed.getDoc().dims).toEqual({
            width: 2000,
            height: 1800,
            depth: 600,
        });
    });

    it('opens a new entry without merge: true, and after seal()', () => {
        const bus = furnitureBus();
        ok(bus.execute('furniture.setDims', { width: 1900 }));
        ok(bus.execute('furniture.setDims', { width: 2000 }));
        expect(bus.history().undo).toHaveLength(2);
        bus.seal();
        ok(bus.execute('furniture.setDims', { width: 2100 }, { merge: true }));
        expect(bus.history().undo).toHaveLength(3);
    });

    it('writes no entry when nothing changes', () => {
        const bus = furnitureBus();
        const doc = bus.getDoc();
        ok(bus.execute('furniture.setDims', { width: 1800 }));
        ok(bus.execute('furniture.setDims', {}));
        expect(bus.getDoc()).toBe(doc);
        expect(bus.history().undo).toHaveLength(0);
    });

    it('refuses params that are not numbers with invalid_params', () => {
        const bus = furnitureBus(wardrobeFixture());
        const error = refused(
            bus.execute('furniture.setDims', { width: 'wide' as never }),
        );
        expect(error.code).toBe('invalid_params');
        expect(error.messageKey).toBe(
            'engine.furniture.command.invalid_params',
        );
        expect(bus.history().undo).toHaveLength(0);
    });
});
