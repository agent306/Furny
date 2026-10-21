import { describe, expect, it } from 'vitest';
import type { ExtraHardware, ExtraPart, FurnitureDocument } from '../../schema';
import { wardrobeFixture } from '../../testing/docs';
import { furnitureBus, ok, refused, roundTrip } from '../../testing/commands';

const EXTRA_PART: Omit<ExtraPart, 'id'> = {
    name: 'Cleat',
    role: 'carcass',
    materialCode: 'PB18-WHITE',
    length: 800,
    width: 80,
    qty: 2,
    edges: { L1: null, L2: null, W1: null, W2: null },
    grain: 'length',
    note: null,
    placement: null,
};
const EXTRA_HW: Omit<ExtraHardware, 'id'> = {
    code: 'LCK-CAM-20',
    qty: 1,
    note: null,
};

const withOverrides = (patch: (d: FurnitureDocument) => void) =>
    wardrobeFixture((d) => patch(d));

describe('setPartOverride', () => {
    it('sets the override of a part key; a second call replaces it', () => {
        const { after, bus } = roundTrip('furniture.setPartOverride', {
            partKey: 'carcass.top',
            patch: { lengthDelta: -2, note: 'trim' },
        });
        expect(after.overrides.parts).toEqual({
            'carcass.top': { lengthDelta: -2, note: 'trim' },
        });
        ok(
            bus.execute('furniture.setPartOverride', {
                partKey: 'carcass.top',
                patch: { removed: true },
            }),
        );
        expect(bus.getDoc().overrides.parts['carcass.top']).toEqual({
            removed: true,
        });
    });

    it('null deletes the override, and so does an empty object', () => {
        const doc = withOverrides((d) => {
            d.overrides.parts['carcass.top'] = { lengthDelta: 3 };
            d.overrides.parts['carcass.bottom'] = { widthDelta: 3 };
        });
        const viaNull = roundTrip(
            'furniture.setPartOverride',
            { partKey: 'carcass.top', patch: null },
            structuredClone(doc),
        );
        expect(viaNull.after.overrides.parts).toEqual({
            'carcass.bottom': { widthDelta: 3 },
        });
        const viaEmpty = roundTrip(
            'furniture.setPartOverride',
            { partKey: 'carcass.bottom', patch: {} },
            structuredClone(doc),
        );
        expect(viaEmpty.after.overrides.parts).toEqual({
            'carcass.top': { lengthDelta: 3 },
        });
    });

    it('deleting an override that does not exist leaves no entry', () => {
        const bus = furnitureBus();
        ok(
            bus.execute('furniture.setPartOverride', {
                partKey: 'carcass.top',
                patch: null,
            }),
        );
        expect(bus.history().undo).toHaveLength(0);
    });

    it('merges under part:{partKey}', () => {
        const bus = furnitureBus();
        ok(
            bus.execute('furniture.setPartOverride', {
                partKey: 'carcass.top',
                patch: { lengthDelta: 1 },
            }),
        );
        ok(
            bus.execute(
                'furniture.setPartOverride',
                { partKey: 'carcass.top', patch: { lengthDelta: 2 } },
                { merge: true },
            ),
        );
        expect(bus.history().undo).toHaveLength(1);
        expect(bus.history().undo[0]!.mergeKey).toBe('part:carcass.top');
    });

    it('refuses a bad override with invalid_params and __proto__ as a key', () => {
        const bus = furnitureBus();
        expect(
            refused(
                bus.execute('furniture.setPartOverride', {
                    partKey: 'carcass.top',
                    patch: { grain: 'diagonal' as never },
                }),
            ).code,
        ).toBe('invalid_params');
        expect(
            refused(
                bus.execute('furniture.setPartOverride', {
                    partKey: '__proto__',
                    patch: { removed: true },
                }),
            ).code,
        ).toBe('invalid_params');
    });
});

describe('extra parts', () => {
    it('addExtraPart adds a part with a new p_ id', () => {
        const { after, result } = roundTrip(
            'furniture.addExtraPart',
            EXTRA_PART,
        );
        expect(result.result).toEqual({ id: 'p_0000000001' });
        expect(after.overrides.extraParts).toEqual([
            { ...EXTRA_PART, id: 'p_0000000001' },
        ]);
    });

    it('updateExtraPart merges the patch, under extra:{id}', () => {
        const doc = () =>
            withOverrides((d) => {
                d.overrides.extraParts.push({
                    ...EXTRA_PART,
                    id: 'p_0000000001',
                });
            });
        const { after } = roundTrip(
            'furniture.updateExtraPart',
            {
                id: 'p_0000000001',
                patch: {
                    qty: 4,
                    edges: { L1: 'EB08-OAK', L2: null, W1: null, W2: null },
                },
            },
            doc(),
        );
        expect(after.overrides.extraParts[0]).toMatchObject({
            name: 'Cleat',
            qty: 4,
            edges: { L1: 'EB08-OAK', L2: null, W1: null, W2: null },
        });

        const bus = furnitureBus(doc());
        ok(
            bus.execute('furniture.updateExtraPart', {
                id: 'p_0000000001',
                patch: { qty: 4 },
            }),
        );
        ok(
            bus.execute(
                'furniture.updateExtraPart',
                { id: 'p_0000000001', patch: { qty: 5 } },
                { merge: true },
            ),
        );
        expect(bus.history().undo).toHaveLength(1);
        expect(bus.history().undo[0]!.mergeKey).toBe('extra:p_0000000001');
    });

    it('removeExtraPart removes the part and its override', () => {
        const doc = withOverrides((d) => {
            d.overrides.extraParts.push({ ...EXTRA_PART, id: 'p_0000000001' });
            d.overrides.parts['extra.p_0000000001'] = { lengthDelta: 5 };
            d.overrides.parts['carcass.top'] = { lengthDelta: 1 };
        });
        const { after } = roundTrip(
            'furniture.removeExtraPart',
            { id: 'p_0000000001' },
            doc,
        );
        expect(after.overrides.extraParts).toEqual([]);
        expect(after.overrides.parts).toEqual({
            'carcass.top': { lengthDelta: 1 },
        });
    });

    it('refuses an unknown id with not_found and a bad qty with invalid_params', () => {
        const bus = furnitureBus();
        for (const type of [
            'furniture.updateExtraPart',
            'furniture.removeExtraPart',
        ] as const) {
            expect(
                refused(bus.execute(type, { id: 'p_0000000009', patch: {} }))
                    .code,
            ).toBe('not_found');
        }
        expect(
            refused(
                bus.execute('furniture.addExtraPart', {
                    ...EXTRA_PART,
                    qty: 0,
                }),
            ).code,
        ).toBe('invalid_params');
    });
});

describe('hardware overrides', () => {
    it('setHardwareOverride sets, replaces and deletes (null or {})', () => {
        const { after, bus } = roundTrip('furniture.setHardwareOverride', {
            hardwareKey: 'hinge.fr_0000000001',
            patch: { qtyDelta: 2 },
        });
        expect(after.overrides.hardware).toEqual({
            'hinge.fr_0000000001': { qtyDelta: 2 },
        });
        ok(
            bus.execute('furniture.setHardwareOverride', {
                hardwareKey: 'hinge.fr_0000000001',
                patch: { removed: true },
            }),
        );
        expect(bus.getDoc().overrides.hardware).toEqual({
            'hinge.fr_0000000001': { removed: true },
        });

        for (const patch of [null, {}] as const) {
            const doc = withOverrides((d) => {
                d.overrides.hardware['hinge.fr_0000000001'] = { removed: true };
            });
            const cleared = roundTrip(
                'furniture.setHardwareOverride',
                { hardwareKey: 'hinge.fr_0000000001', patch },
                doc,
            );
            expect(cleared.after.overrides.hardware).toEqual({});
        }
    });

    it('setHardwareOverride merges under hw:{key}', () => {
        const bus = furnitureBus();
        ok(
            bus.execute('furniture.setHardwareOverride', {
                hardwareKey: 'hinge.x',
                patch: { qtyDelta: 2 },
            }),
        );
        ok(
            bus.execute(
                'furniture.setHardwareOverride',
                { hardwareKey: 'hinge.x', patch: { qtyDelta: 3 } },
                { merge: true },
            ),
        );
        expect(bus.history().undo).toHaveLength(1);
        expect(bus.history().undo[0]!.mergeKey).toBe('hw:hinge.x');
    });

    it.each([-1, 0, 1000])('addExtraHardware rejects qty %i', (qty) => {
        const bus = furnitureBus();
        expect(
            bus.execute('furniture.addExtraHardware', { ...EXTRA_HW, qty }).ok,
        ).toBe(false);
    });

    it('extra hardware: add (h_ id), update, remove', () => {
        const added = roundTrip('furniture.addExtraHardware', EXTRA_HW);
        expect(added.result.result).toEqual({ id: 'h_0000000001' });
        expect(added.after.overrides.extraHardware).toEqual([
            { ...EXTRA_HW, id: 'h_0000000001' },
        ]);

        const doc = () =>
            withOverrides((d) => {
                d.overrides.extraHardware.push({
                    ...EXTRA_HW,
                    id: 'h_0000000001',
                });
            });
        const updated = roundTrip(
            'furniture.updateExtraHardware',
            {
                id: 'h_0000000001',
                patch: { qty: 3, note: 'lock for the left door' },
            },
            doc(),
        );
        expect(updated.after.overrides.extraHardware[0]).toEqual({
            id: 'h_0000000001',
            code: 'LCK-CAM-20',
            qty: 3,
            note: 'lock for the left door',
        });

        const removed = roundTrip(
            'furniture.removeExtraHardware',
            { id: 'h_0000000001' },
            doc(),
        );
        expect(removed.after.overrides.extraHardware).toEqual([]);
    });

    it('updateExtraHardware merges under xhw:{id}', () => {
        const bus = furnitureBus(
            withOverrides((d) => {
                d.overrides.extraHardware.push({
                    ...EXTRA_HW,
                    id: 'h_0000000001',
                });
            }),
        );
        ok(
            bus.execute('furniture.updateExtraHardware', {
                id: 'h_0000000001',
                patch: { qty: 3 },
            }),
        );
        ok(
            bus.execute(
                'furniture.updateExtraHardware',
                { id: 'h_0000000001', patch: { qty: 4 } },
                { merge: true },
            ),
        );
        expect(bus.history().undo).toHaveLength(1);
        expect(bus.history().undo[0]!.mergeKey).toBe('xhw:h_0000000001');
    });

    it('refuses unknown extra hardware with not_found', () => {
        const bus = furnitureBus();
        expect(
            refused(
                bus.execute('furniture.updateExtraHardware', {
                    id: 'h_0000000009',
                    patch: { qty: 2 },
                }),
            ).code,
        ).toBe('not_found');
        expect(
            refused(
                bus.execute('furniture.removeExtraHardware', {
                    id: 'h_0000000009',
                }),
            ).code,
        ).toBe('not_found');
    });
});

describe('resetOverrides', () => {
    const loaded = () =>
        withOverrides((d) => {
            d.overrides.parts['carcass.top'] = { lengthDelta: 1 };
            d.overrides.hardware['hinge.fr_0000000001'] = { qtyDelta: 1 };
            d.overrides.extraParts.push({ ...EXTRA_PART, id: 'p_0000000001' });
            d.overrides.extraHardware.push({ ...EXTRA_HW, id: 'h_0000000001' });
        });

    it("'parts' clears the part overrides and keeps extras and hardware", () => {
        const { after, before } = roundTrip(
            'furniture.resetOverrides',
            { scope: 'parts' },
            loaded(),
        );
        expect(after.overrides).toEqual({
            ...before.overrides,
            parts: {},
        });
        expect(after.overrides.extraParts).toHaveLength(1);
    });

    it("'hardware' clears the hardware overrides only", () => {
        const { after, before } = roundTrip(
            'furniture.resetOverrides',
            { scope: 'hardware' },
            loaded(),
        );
        expect(after.overrides).toEqual({ ...before.overrides, hardware: {} });
    });

    it("'all' clears both maps and keeps the extras", () => {
        const { after, before } = roundTrip(
            'furniture.resetOverrides',
            { scope: 'all' },
            loaded(),
        );
        expect(after.overrides).toEqual({
            parts: {},
            hardware: {},
            extraParts: before.overrides.extraParts,
            extraHardware: before.overrides.extraHardware,
        });
    });

    it('leaves no entry when there is nothing to clear', () => {
        const bus = furnitureBus();
        ok(bus.execute('furniture.resetOverrides', { scope: 'all' }));
        expect(bus.history().undo).toHaveLength(0);
    });
});
