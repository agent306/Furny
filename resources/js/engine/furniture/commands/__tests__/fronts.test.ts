import { describe, expect, it } from 'vitest';
import type { Content, Front, FurnitureDocument } from '../../schema';
import { diningTable, wardrobeFixture } from '../../testing/docs';
import {
    FIXTURE_FRONTS as FR,
    FIXTURE_SECTIONS as S,
    furnitureBus,
    ok,
    refused,
    roundTrip,
    sectionOf,
} from '../../testing/commands';

const DRAWERS = (behindDoor: boolean): Content => ({
    type: 'drawers',
    count: 3,
    frontHeights: 'equal',
    slideCode: null,
    behindDoor,
});

const NEW_FRONT: Omit<Front, 'id'> = {
    kind: 'hinged',
    covers: [S.shelves],
    leaves: 1,
    hingeSide: 'right',
    overlay: 'half',
    glass: false,
    handleCode: 'inherit',
    hingeCode: 'auto',
    slidingTrackCode: null,
};

/** The fixture with drawers in the first column and no front on it. */
const drawerColumn = (behindDoor: boolean) =>
    wardrobeFixture((d) => {
        d.carcass!.fronts = d.carcass!.fronts.filter((f) => f.id !== FR.left);
        sectionOf(d, S.shelves).content = DRAWERS(behindDoor);
    });

const frontsOf = (doc: FurnitureDocument) => doc.carcass!.fronts;

describe('addFront', () => {
    it('adds a front with a new fr_ id; undo removes it', () => {
        const { after, result } = roundTrip('furniture.addFront', {
            ...NEW_FRONT,
            covers: [S.rod],
        });
        expect(result.result).toEqual({ frontId: 'fr_0000000003' });
        expect(frontsOf(after)).toHaveLength(3);
        expect(frontsOf(after)[2]).toEqual({
            ...NEW_FRONT,
            covers: [S.rod],
            id: 'fr_0000000003',
        });
    });

    it('sets behindDoor on the drawers it covers', () => {
        const { after } = roundTrip(
            'furniture.addFront',
            NEW_FRONT,
            drawerColumn(false),
        );
        expect(sectionOf(after, S.shelves).content).toEqual(DRAWERS(true));
    });

    it('refuses an unknown section, empty covers and a table document', () => {
        const bus = furnitureBus();
        expect(
            refused(
                bus.execute('furniture.addFront', {
                    ...NEW_FRONT,
                    covers: ['s_0000000099'],
                }),
            ),
        ).toMatchObject({ code: 'not_found', params: { id: 's_0000000099' } });
        expect(
            refused(
                bus.execute('furniture.addFront', { ...NEW_FRONT, covers: [] }),
            ).code,
        ).toBe('invalid_params');
        expect(
            refused(
                furnitureBus(diningTable()).execute(
                    'furniture.addFront',
                    NEW_FRONT,
                ),
            ),
        ).toMatchObject({ code: 'not_found', params: { id: 'carcass' } });
        expect(bus.history().undo).toHaveLength(0);
    });
});

describe('updateFront', () => {
    it('merges the patch into the front', () => {
        const { after } = roundTrip('furniture.updateFront', {
            frontId: FR.left,
            patch: { overlay: 'half', hingeSide: 'right' },
        });
        expect(frontsOf(after)[0]).toMatchObject({
            id: FR.left,
            overlay: 'half',
            hingeSide: 'right',
            kind: 'hinged',
            covers: [S.shelves],
        });
    });

    it('re-syncs behindDoor when covers change', () => {
        const doc = wardrobeFixture((d) => {
            sectionOf(d, S.shelves).content = DRAWERS(true);
            sectionOf(d, S.rod).content = DRAWERS(false);
            d.carcass!.fronts = d.carcass!.fronts.slice(0, 1);
        });
        const { after } = roundTrip(
            'furniture.updateFront',
            { frontId: FR.left, patch: { covers: [S.rod] } },
            doc,
        );
        expect(sectionOf(after, S.shelves).content).toEqual(DRAWERS(false));
        expect(sectionOf(after, S.rod).content).toEqual(DRAWERS(true));
    });

    it('merges under front:{frontId}', () => {
        const bus = furnitureBus();
        ok(
            bus.execute('furniture.updateFront', {
                frontId: FR.left,
                patch: { leaves: 2 },
            }),
        );
        ok(
            bus.execute(
                'furniture.updateFront',
                { frontId: FR.left, patch: { leaves: 3 } },
                { merge: true },
            ),
        );
        expect(bus.history().undo).toHaveLength(1);
        expect(bus.history().undo[0]!.mergeKey).toBe(`front:${FR.left}`);
    });

    it('refuses an unknown front, unknown covers and empty covers', () => {
        const bus = furnitureBus();
        expect(
            refused(
                bus.execute('furniture.updateFront', {
                    frontId: 'fr_0000000099',
                    patch: {},
                }),
            ),
        ).toMatchObject({ code: 'not_found', params: { id: 'fr_0000000099' } });
        expect(
            refused(
                bus.execute('furniture.updateFront', {
                    frontId: FR.left,
                    patch: { covers: ['s_0000000099'] },
                }),
            ).code,
        ).toBe('not_found');
        expect(
            refused(
                bus.execute('furniture.updateFront', {
                    frontId: FR.left,
                    patch: { covers: [] },
                }),
            ).code,
        ).toBe('invalid_params');
    });

    it('ignores an id in the patch', () => {
        const bus = furnitureBus();
        ok(
            bus.execute('furniture.updateFront', {
                frontId: FR.left,
                patch: { id: 'fr_0000000077', glass: true } as never,
            }),
        );
        expect(frontsOf(bus.getDoc())[0]).toMatchObject({
            id: FR.left,
            glass: true,
        });
    });
});

describe('removeFront', () => {
    it('removes the front; undo restores it', () => {
        const { after } = roundTrip('furniture.removeFront', {
            frontId: FR.right,
        });
        expect(frontsOf(after).map((f) => f.id)).toEqual([FR.left]);
    });

    it('resets behindDoor to false for the drawers it covered', () => {
        const doc = wardrobeFixture((d) => {
            sectionOf(d, S.shelves).content = DRAWERS(true);
        });
        const { after } = roundTrip(
            'furniture.removeFront',
            { frontId: FR.left },
            doc,
        );
        expect(sectionOf(after, S.shelves).content).toEqual(DRAWERS(false));
    });

    it('refuses an unknown front', () => {
        expect(
            refused(
                furnitureBus().execute('furniture.removeFront', {
                    frontId: 'fr_0000000099',
                }),
            ).code,
        ).toBe('not_found');
    });
});
