import { describe, expect, it } from 'vitest';
import { furnitureBus, ok, refused, roundTrip } from '../../testing/commands';

describe('setMaterial', () => {
    it('sets the material of a role and of every applyToRoles role', () => {
        const { before, after } = roundTrip('furniture.setMaterial', {
            role: 'carcass',
            materialCode: 'PB18-OAK',
            applyToRoles: ['shelf', 'plinth'],
        });
        for (const role of ['carcass', 'shelf', 'plinth'] as const) {
            expect(after.materials[role]).toEqual({
                materialCode: 'PB18-OAK',
                edgeBandCode: null,
                finishCode: null,
            });
        }
        for (const role of [
            'back',
            'front',
            'top',
            'drawer_box',
            'leg',
        ] as const) {
            expect(after.materials[role]).toEqual(before.materials[role]);
        }
    });

    it('sets edgeBandCode and finishCode, null clearing them', () => {
        const { after, bus } = roundTrip('furniture.setMaterial', {
            role: 'front',
            edgeBandCode: 'EB08-OAK',
            finishCode: 'FIN-LACQUER-MATT',
        });
        expect(after.materials.front).toEqual({
            materialCode: 'PB18-WHITE',
            edgeBandCode: 'EB08-OAK',
            finishCode: 'FIN-LACQUER-MATT',
        });
        ok(
            bus.execute('furniture.setMaterial', {
                role: 'front',
                edgeBandCode: null,
                finishCode: null,
            }),
        );
        expect(bus.getDoc().materials.front).toEqual({
            materialCode: 'PB18-WHITE',
            edgeBandCode: null,
            finishCode: null,
        });
    });

    it('accepts the role and repeated roles in applyToRoles', () => {
        const { after } = roundTrip('furniture.setMaterial', {
            role: 'carcass',
            materialCode: 'PB18-OAK',
            applyToRoles: ['carcass', 'shelf', 'shelf'],
        });
        expect(after.materials.shelf.materialCode).toBe('PB18-OAK');
    });

    it('writes no entry when nothing changes', () => {
        const bus = furnitureBus();
        ok(
            bus.execute('furniture.setMaterial', {
                role: 'carcass',
                materialCode: 'PB18-WHITE',
            }),
        );
        ok(bus.execute('furniture.setMaterial', { role: 'carcass' }));
        expect(bus.history().undo).toHaveLength(0);
    });

    it('refuses an unknown role with invalid_params', () => {
        const bus = furnitureBus();
        expect(
            refused(
                bus.execute('furniture.setMaterial', {
                    role: 'glass' as never,
                    materialCode: 'X',
                }),
            ).code,
        ).toBe('invalid_params');
        expect(
            refused(
                bus.execute('furniture.setMaterial', {
                    role: 'carcass',
                    applyToRoles: ['nope' as never],
                }),
            ).code,
        ).toBe('invalid_params');
    });
});
