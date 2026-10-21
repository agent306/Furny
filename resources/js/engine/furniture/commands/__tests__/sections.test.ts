import { describe, expect, it } from 'vitest';
import type { Content, FurnitureDocument } from '../../schema';
import { seedCatalog } from '../../../testing/seedCatalog';
import { isSaveBlocking, validateFurniture } from '../../validate';
import { wardrobeFixture } from '../../testing/docs';
import {
    FIXTURE_FRONTS as FR,
    FIXTURE_SECTIONS as S,
    furnitureBus,
    ok,
    refused,
    roundTrip,
    sectionIdsOf,
    sectionOf,
} from '../../testing/commands';

const SHELVES: Content = {
    type: 'shelves',
    count: 4,
    adjustable: true,
    frontSetback: 20,
};
const DRAWERS = (behindDoor: boolean): Content => ({
    type: 'drawers',
    count: 3,
    frontHeights: 'equal',
    slideCode: null,
    behindDoor,
});

/** The fixture without its fronts. */
const bare = () =>
    wardrobeFixture((d) => {
        d.carcass!.fronts = [];
    });

const frontsOf = (doc: FurnitureDocument) => doc.carcass!.fronts;

describe('splitSection', () => {
    it('splits a leaf in 2 columns: content moves to child 1, the rest is empty, all flex 1', () => {
        const { after, result } = roundTrip('furniture.splitSection', {
            sectionId: S.shelves,
            direction: 'columns',
            count: 2,
        });
        expect(sectionOf(after, S.shelves)).toEqual({
            id: S.shelves,
            split: 'columns',
            content: null,
            children: [
                {
                    size: { mode: 'flex', weight: 1 },
                    section: {
                        id: 's_0000000006',
                        split: 'none',
                        children: [],
                        content: SHELVES,
                    },
                },
                {
                    size: { mode: 'flex', weight: 1 },
                    section: {
                        id: 's_0000000007',
                        split: 'none',
                        children: [],
                        content: { type: 'empty' },
                    },
                },
            ],
        });
        expect(result.result).toEqual({
            childIds: ['s_0000000006', 's_0000000007'],
        });
    });

    it('keeps the front that covers the section covering it (now a non-leaf)', () => {
        const { after } = roundTrip('furniture.splitSection', {
            sectionId: S.shelves,
            direction: 'columns',
            count: 2,
        });
        expect(frontsOf(after).find((f) => f.id === FR.left)!.covers).toEqual([
            S.shelves,
        ]);
    });

    it('makes rows, up to 8 children, ids in order', () => {
        const { after } = roundTrip('furniture.splitSection', {
            sectionId: S.rod,
            direction: 'rows',
            count: 8,
        });
        const rod = sectionOf(after, S.rod);
        expect(rod.split).toBe('rows');
        expect(rod.children.map((c) => c.section.id)).toEqual(
            [6, 7, 8, 9, 10, 11, 12, 13].map(
                (n) => `s_${String(n).padStart(10, '0')}`,
            ),
        );
        expect(rod.children[0]!.section.content).toEqual({
            type: 'hanging_rod',
            topClearance: 60,
            rodCode: null,
        });
        expect(
            rod.children
                .slice(1)
                .every((c) => c.section.content!.type === 'empty'),
        ).toBe(true);
    });

    it('refuses a section that is already split with not_leaf', () => {
        const bus = furnitureBus();
        const before = bus.getDoc();
        const error = refused(
            bus.execute('furniture.splitSection', {
                sectionId: S.rows,
                direction: 'columns',
                count: 2,
            }),
        );
        expect(error.code).toBe('not_leaf');
        expect(error.messageKey).toBe('engine.furniture.command.not_leaf');
        expect(bus.getDoc()).toBe(before);
        expect(bus.history().undo).toHaveLength(0);
    });

    it('refuses an unknown section and a count outside 2..8', () => {
        const bus = furnitureBus();
        expect(
            refused(
                bus.execute('furniture.splitSection', {
                    sectionId: 's_0000000099',
                    direction: 'rows',
                    count: 2,
                }),
            ),
        ).toMatchObject({ code: 'not_found', params: { id: 's_0000000099' } });
        for (const count of [1, 9]) {
            expect(
                refused(
                    bus.execute('furniture.splitSection', {
                        sectionId: S.rod,
                        direction: 'rows',
                        count,
                    }),
                ),
            ).toMatchObject({
                code: 'out_of_range',
                params: { field: 'count', min: 2, max: 8 },
            });
        }
        expect(
            refused(
                bus.execute('furniture.splitSection', {
                    sectionId: S.rod,
                    direction: 'diagonal' as never,
                    count: 2,
                }),
            ).code,
        ).toBe('invalid_params');
    });

    it('sets behindDoor on drawers moved under a front', () => {
        const doc = wardrobeFixture((d) => {
            sectionOf(d, S.shelves).content = DRAWERS(false);
        });
        const { after } = roundTrip(
            'furniture.splitSection',
            { sectionId: S.shelves, direction: 'rows', count: 2 },
            doc,
        );
        const [first, second] = sectionOf(after, S.shelves).children;
        expect(first!.section.content).toEqual(DRAWERS(true));
        expect(second!.section.content).toEqual({ type: 'empty' });
    });

    it('leaves drawers that no front covers in front of the cabinet', () => {
        const doc = bare();
        sectionOf(doc, S.shelves).content = DRAWERS(false);
        const { after } = roundTrip(
            'furniture.splitSection',
            { sectionId: S.shelves, direction: 'rows', count: 2 },
            doc,
        );
        expect(
            sectionOf(after, S.shelves).children[0]!.section.content,
        ).toEqual(DRAWERS(false));
    });
});

describe('setChildSize', () => {
    it('sets a fixed size and a flex weight; undo restores', () => {
        const fixedSize = roundTrip('furniture.setChildSize', {
            parentId: S.root,
            index: 0,
            size: { mode: 'fixed', mm: 600 },
        });
        expect(fixedSize.after.carcass!.interior.children[0]!.size).toEqual({
            mode: 'fixed',
            mm: 600,
        });
        const flexSize = roundTrip('furniture.setChildSize', {
            parentId: S.root,
            index: 1,
            size: { mode: 'flex', weight: 3 },
        });
        expect(flexSize.after.carcass!.interior.children[1]!.size).toEqual({
            mode: 'flex',
            weight: 3,
        });
    });

    it('merges under size:{parentId}:{index}, or drag:{parentId} for an elevation drag', () => {
        const bus = furnitureBus();
        bus.execute('furniture.setChildSize', {
            parentId: S.root,
            index: 0,
            size: { mode: 'fixed', mm: 500 },
        });
        expect(bus.history().undo[0]!.mergeKey).toBe(`size:${S.root}:0`);
        bus.seal();

        const original = bus.getDoc();
        for (const mm of [510, 520, 530]) {
            ok(
                bus.execute(
                    'furniture.setChildSize',
                    {
                        parentId: S.root,
                        index: 0,
                        size: { mode: 'fixed', mm },
                        drag: true,
                    },
                    { merge: true },
                ),
            );
        }
        expect(bus.history().undo).toHaveLength(2);
        expect(bus.history().undo[1]!.mergeKey).toBe(`drag:${S.root}`);
        expect(bus.getDoc().carcass!.interior.children[0]!.size).toEqual({
            mode: 'fixed',
            mm: 530,
        });
        bus.undo();
        expect(bus.getDoc()).toEqual(original);
    });

    it('refuses a leaf parent with not_split, a bad index and bad sizes', () => {
        const bus = furnitureBus();
        const size = { mode: 'fixed', mm: 300 } as const;
        expect(
            refused(
                bus.execute('furniture.setChildSize', {
                    parentId: S.shelves,
                    index: 0,
                    size,
                }),
            ).code,
        ).toBe('not_split');
        expect(
            refused(
                bus.execute('furniture.setChildSize', {
                    parentId: 's_0000000099',
                    index: 0,
                    size,
                }),
            ).code,
        ).toBe('not_found');
        for (const index of [-1, 2]) {
            expect(
                refused(
                    bus.execute('furniture.setChildSize', {
                        parentId: S.root,
                        index,
                        size,
                    }),
                ),
            ).toMatchObject({
                code: 'out_of_range',
                params: { field: 'index', min: 0, max: 1 },
            });
        }
        expect(
            refused(
                bus.execute('furniture.setChildSize', {
                    parentId: S.root,
                    index: 0,
                    size: { mode: 'fixed', mm: 0 },
                }),
            ),
        ).toMatchObject({ code: 'out_of_range', params: { field: 'size.mm' } });
        expect(
            refused(
                bus.execute('furniture.setChildSize', {
                    parentId: S.root,
                    index: 0,
                    size: { mode: 'flex', weight: 0 },
                }),
            ),
        ).toMatchObject({
            code: 'out_of_range',
            params: { field: 'size.weight' },
        });
        expect(bus.history().undo).toHaveLength(0);
    });
});

describe('insertChild', () => {
    it('inserts an empty leaf with flex 1 by default', () => {
        const { after, result } = roundTrip('furniture.insertChild', {
            parentId: S.root,
            index: 1,
        });
        const children = after.carcass!.interior.children;
        expect(children).toHaveLength(3);
        expect(children[1]).toEqual({
            size: { mode: 'flex', weight: 1 },
            section: {
                id: 's_0000000006',
                split: 'none',
                children: [],
                content: { type: 'empty' },
            },
        });
        expect(children[0]!.section.id).toBe(S.shelves);
        expect(children[2]!.section.id).toBe(S.rows);
        expect(result.result).toEqual({ sectionId: 's_0000000006' });
    });

    it('takes a size, and index = length appends', () => {
        const { after } = roundTrip('furniture.insertChild', {
            parentId: S.rows,
            index: 2,
            size: { mode: 'fixed', mm: 200 },
        });
        const rows = sectionOf(after, S.rows).children;
        expect(rows.map((c) => c.section.id)).toEqual([
            S.empty,
            S.rod,
            's_0000000006',
        ]);
        expect(rows[2]!.size).toEqual({ mode: 'fixed', mm: 200 });
    });

    it('refuses a leaf parent and an index outside 0..length', () => {
        const bus = furnitureBus();
        expect(
            refused(
                bus.execute('furniture.insertChild', {
                    parentId: S.rod,
                    index: 0,
                }),
            ).code,
        ).toBe('not_split');
        expect(
            refused(
                bus.execute('furniture.insertChild', {
                    parentId: S.root,
                    index: 3,
                }),
            ),
        ).toMatchObject({
            code: 'out_of_range',
            params: { field: 'index', min: 0, max: 2 },
        });
    });
});

describe('removeChild', () => {
    it('down to one child: the parent becomes a leaf with its content; fronts left with no covers go', () => {
        const { after, result } = roundTrip('furniture.removeChild', {
            parentId: S.root,
            index: 1,
        });
        expect(after.carcass!.interior).toEqual({
            id: S.root,
            split: 'none',
            children: [],
            content: SHELVES,
        });
        // fr_2 covered only the removed column; fr_1 followed its section into the root.
        expect(frontsOf(after).map((f) => f.id)).toEqual([FR.left]);
        expect(frontsOf(after)[0]!.covers).toEqual([S.root]);
        expect(sectionIdsOf(after)).toEqual([S.root]);
        expect(result.deletedIds.sort()).toEqual(
            [FR.right, S.shelves, S.rows, S.empty, S.rod].sort(),
        );
    });

    it('a remaining leaf under a nested parent: the parent keeps its id and its front', () => {
        const { after } = roundTrip('furniture.removeChild', {
            parentId: S.rows,
            index: 0,
        });
        expect(sectionOf(after, S.rows)).toEqual({
            id: S.rows,
            split: 'none',
            children: [],
            content: { type: 'hanging_rod', topClearance: 60, rodCode: null },
        });
        expect(frontsOf(after).map((f) => f.covers)).toEqual([
            [S.shelves],
            [S.rows],
        ]);
    });

    it('a remaining divided child: the parent adopts its split and children', () => {
        const { after } = roundTrip('furniture.removeChild', {
            parentId: S.root,
            index: 0,
        });
        const root = after.carcass!.interior;
        expect(root.id).toBe(S.root);
        expect(root.split).toBe('rows');
        expect(root.content).toBeNull();
        expect(root.children.map((c) => c.section.id)).toEqual([
            S.empty,
            S.rod,
        ]);
        // fr_1 covered the removed column; fr_2 followed s_3 into the root.
        expect(frontsOf(after).map((f) => [f.id, f.covers])).toEqual([
            [FR.right, [S.root]],
        ]);
    });

    it('with more than two children it only removes one', () => {
        const bus = furnitureBus();
        ok(
            bus.execute('furniture.insertChild', {
                parentId: S.root,
                index: 2,
            }),
        );
        const before = bus.getDoc();
        ok(
            bus.execute('furniture.removeChild', {
                parentId: S.root,
                index: 1,
            }),
        );
        const root = bus.getDoc().carcass!.interior;
        expect(root.split).toBe('columns');
        expect(root.children.map((c) => c.section.id)).toEqual([
            S.shelves,
            's_0000000006',
        ]);
        expect(frontsOf(bus.getDoc()).map((f) => f.id)).toEqual([FR.left]);
        bus.undo();
        expect(bus.getDoc()).toEqual(before);
    });

    it('removes deleted ids from a front that keeps other sections', () => {
        const doc = wardrobeFixture((d) => {
            d.carcass!.fronts[1]!.covers = [S.empty, S.rod];
        });
        const { after } = roundTrip(
            'furniture.removeChild',
            { parentId: S.rows, index: 1 },
            doc,
        );
        // s_5 is gone; s_4 is the remaining child and became s_3.
        expect(frontsOf(after)[1]!.covers).toEqual([S.rows]);
    });

    it('refuses a leaf parent, an unknown parent and a bad index', () => {
        const bus = furnitureBus();
        expect(
            refused(
                bus.execute('furniture.removeChild', {
                    parentId: S.rod,
                    index: 0,
                }),
            ).code,
        ).toBe('not_split');
        expect(
            refused(
                bus.execute('furniture.removeChild', {
                    parentId: 's_0000000099',
                    index: 0,
                }),
            ).code,
        ).toBe('not_found');
        expect(
            refused(
                bus.execute('furniture.removeChild', {
                    parentId: S.root,
                    index: 2,
                }),
            ),
        ).toMatchObject({
            code: 'out_of_range',
            params: { field: 'index', min: 0, max: 1 },
        });
    });
});

describe('mergeSections', () => {
    it('turns a split into a leaf holding the first leaf content in pre-order', () => {
        const { after, result } = roundTrip('furniture.mergeSections', {
            sectionId: S.root,
        });
        expect(after.carcass!.interior).toEqual({
            id: S.root,
            split: 'none',
            children: [],
            content: SHELVES,
        });
        expect(sectionIdsOf(after)).toEqual([S.root]);
        expect(result.deletedIds).toEqual(
            expect.arrayContaining([
                S.shelves,
                S.rows,
                S.empty,
                S.rod,
                FR.right,
            ]),
        );
    });

    it('rewires covers to the merged id, and deletes the later of two fronts covering it', () => {
        const { after } = roundTrip('furniture.mergeSections', {
            sectionId: S.root,
        });
        expect(frontsOf(after).map((f) => [f.id, f.covers])).toEqual([
            [FR.left, [S.root]],
        ]);
    });

    it('deduplicates the covers of one front and keeps fronts of other sections', () => {
        const doc = wardrobeFixture((d) => {
            d.carcass!.fronts[1]!.covers = [S.empty, S.rod];
        });
        const { after } = roundTrip(
            'furniture.mergeSections',
            { sectionId: S.rows },
            doc,
        );
        expect(frontsOf(after).map((f) => [f.id, f.covers])).toEqual([
            [FR.left, [S.shelves]],
            [FR.right, [S.rows]],
        ]);
        // content of the first leaf (s_4: empty)
        expect(sectionOf(after, S.rows).content).toEqual({ type: 'empty' });
    });

    it('refuses a leaf with not_split and an unknown section with not_found', () => {
        const bus = furnitureBus();
        expect(
            refused(
                bus.execute('furniture.mergeSections', { sectionId: S.rod }),
            ).code,
        ).toBe('not_split');
        expect(
            refused(
                bus.execute('furniture.mergeSections', {
                    sectionId: 's_0000000099',
                }),
            ).code,
        ).toBe('not_found');
    });
});

describe('mergeSections and drawers', () => {
    it('sets behindDoor on the drawers of the merged section when a door covers it', () => {
        // s_4 holds drawers in front of the cabinet; the door only covers s_5.
        // Merging s_3 puts the drawers under that door.
        const doc = wardrobeFixture((d) => {
            sectionOf(d, S.empty).content = DRAWERS(false);
            d.carcass!.fronts[1]!.covers = [S.rod];
        });
        const { after } = roundTrip(
            'furniture.mergeSections',
            { sectionId: S.rows },
            doc,
        );
        expect(sectionOf(after, S.rows).content).toEqual(DRAWERS(true));
        expect(frontsOf(after)[1]!.covers).toEqual([S.rows]);
    });

    it('leaves the drawers in front when nothing covers the merged section', () => {
        const { after } = roundTrip(
            'furniture.mergeSections',
            { sectionId: S.rows },
            wardrobeFixture((d) => {
                sectionOf(d, S.empty).content = DRAWERS(true);
                d.carcass!.fronts = [d.carcass!.fronts[0]!];
            }),
        );
        expect(sectionOf(after, S.rows).content).toEqual(DRAWERS(false));
    });
});

describe('mergeSections and a front that reaches beyond the merge', () => {
    /**
     * s_4 is split in s_6 / s_7. One front covers s_6, the other covers s_7
     * and s_5 (outside the merge), in either order. Merging s_4 puts both
     * fronts on s_4; s_5 keeps its door whichever front comes first.
     */
    function setup(pairFirst: boolean) {
        const bus = furnitureBus();
        ok(bus.execute('furniture.removeFront', { frontId: FR.right }));
        ok(
            bus.execute('furniture.splitSection', {
                sectionId: S.empty,
                direction: 'rows',
                count: 2,
            }),
        );
        const front = (covers: string[]) => ({
            kind: 'hinged' as const,
            covers,
            leaves: 1 as const,
            hingeSide: 'left' as const,
            overlay: 'full' as const,
            glass: false,
            handleCode: 'inherit',
            hingeCode: 'auto',
            slidingTrackCode: null,
        });
        const single = front(['s_0000000006']);
        const pair = front(['s_0000000007', S.rod]);
        for (const covers of pairFirst ? [pair, single] : [single, pair]) {
            ok(bus.execute('furniture.addFront', covers));
        }
        bus.seal();
        return bus;
    }

    it.each([false, true])(
        'keeps the door of s_5 (pair front first: %s)',
        (pairFirst) => {
            const bus = setup(pairFirst);
            const before = bus.getDoc();
            const merged = ok(
                bus.execute('furniture.mergeSections', { sectionId: S.empty }),
            );
            const fronts = frontsOf(bus.getDoc());
            const coverOf = (id: string) =>
                fronts.filter((f) => f.covers.includes(id));
            // s_5 keeps its door, s_4 is covered exactly once
            expect(coverOf(S.rod)).toHaveLength(1);
            expect(coverOf(S.empty)).toHaveLength(1);
            // the front without s_5 survives only if it is the one that holds s_4
            expect(fronts).toHaveLength(pairFirst ? 2 : 3);
            const pair = frontsOf(before).find((f) =>
                f.covers.includes(S.rod),
            )!;
            // the patches name the section and the front whose covers changed
            expect(merged.changedIds).toContain(S.empty);
            expect(merged.changedIds).toContain(pair.id);
            expect(merged.deletedIds).toHaveLength(
                // s_6 / s_7 and, when the single front comes second, that front
                pairFirst ? 3 : 2,
            );
            bus.undo();
            expect(bus.getDoc()).toEqual(before);
        },
    );

    it('removes only the merged id from a later front that has other sections', () => {
        const doc = wardrobeFixture((d) => {
            const root = sectionOf(d, S.empty);
            root.split = 'rows';
            root.content = null;
            root.children = [6, 7].map((n) => ({
                size: { mode: 'flex' as const, weight: 1 },
                section: {
                    id: `s_${String(n).padStart(10, '0')}`,
                    split: 'none' as const,
                    children: [],
                    content: { type: 'empty' as const },
                },
            }));
            d.carcass!.fronts[1]!.covers = ['s_0000000006'];
            d.carcass!.fronts.push({
                ...d.carcass!.fronts[0]!,
                id: 'fr_0000000003',
                covers: ['s_0000000007', S.rod],
            });
        });
        const { after } = roundTrip(
            'furniture.mergeSections',
            { sectionId: S.empty },
            doc,
        );
        expect(frontsOf(after).map((f) => [f.id, f.covers])).toEqual([
            [FR.left, [S.shelves]],
            [FR.right, [S.empty]],
            ['fr_0000000003', [S.rod]],
        ]);
    });
});

describe('setContent', () => {
    it('replaces the content of a leaf; undo restores', () => {
        const content: Content = {
            type: 'shelves',
            count: 6,
            adjustable: false,
            frontSetback: 30,
        };
        const { after } = roundTrip('furniture.setContent', {
            sectionId: S.shelves,
            content,
        });
        expect(sectionOf(after, S.shelves).content).toEqual(content);
    });

    it('merges a typing burst under content:{sectionId}', () => {
        const bus = furnitureBus();
        const original = bus.getDoc();
        for (const count of [5, 6, 7]) {
            ok(
                bus.execute(
                    'furniture.setContent',
                    { sectionId: S.shelves, content: { ...SHELVES, count } },
                    { merge: true },
                ),
            );
        }
        expect(bus.history().undo).toHaveLength(1);
        expect(bus.history().undo[0]!.mergeKey).toBe(`content:${S.shelves}`);
        bus.undo();
        expect(bus.getDoc()).toEqual(original);
    });

    it('forces behindDoor true on drawers that a front covers', () => {
        const { after } = roundTrip('furniture.setContent', {
            sectionId: S.shelves,
            content: DRAWERS(false),
        });
        expect(sectionOf(after, S.shelves).content).toEqual(DRAWERS(true));
        // covered through the ancestor s_3 as well
        const nested = roundTrip('furniture.setContent', {
            sectionId: S.empty,
            content: DRAWERS(false),
        });
        expect(sectionOf(nested.after, S.empty).content).toEqual(DRAWERS(true));
    });

    it('forces behindDoor false on drawers that no front covers', () => {
        const { after } = roundTrip(
            'furniture.setContent',
            { sectionId: S.shelves, content: DRAWERS(true) },
            bare(),
        );
        expect(sectionOf(after, S.shelves).content).toEqual(DRAWERS(false));
    });

    it('refuses a divided section with not_leaf, and bad content with invalid_params', () => {
        const bus = furnitureBus();
        expect(
            refused(
                bus.execute('furniture.setContent', {
                    sectionId: S.rows,
                    content: SHELVES,
                }),
            ).code,
        ).toBe('not_leaf');
        expect(
            refused(
                bus.execute('furniture.setContent', {
                    sectionId: 's_0000000099',
                    content: SHELVES,
                }),
            ).code,
        ).toBe('not_found');
        expect(
            refused(
                bus.execute('furniture.setContent', {
                    sectionId: S.shelves,
                    content: { ...SHELVES, count: 0 },
                }),
            ).code,
        ).toBe('invalid_params');
    });
});

describe('documents the section commands leave behind', () => {
    it('are valid against the catalog: nothing that blocks saving', () => {
        const runs = [
            [
                'furniture.splitSection',
                { sectionId: S.shelves, direction: 'columns', count: 2 },
            ],
            ['furniture.insertChild', { parentId: S.root, index: 1 }],
            ['furniture.removeChild', { parentId: S.root, index: 0 }],
            ['furniture.removeChild', { parentId: S.root, index: 1 }],
            ['furniture.mergeSections', { sectionId: S.rows }],
            ['furniture.mergeSections', { sectionId: S.root }],
        ] as const;
        for (const [type, params] of runs) {
            const bus = furnitureBus();
            ok(bus.execute(type, params as never));
            expect(
                isSaveBlocking(validateFurniture(bus.getDoc(), seedCatalog())),
                `${type} ${JSON.stringify(params)}`,
            ).toBe(false);
        }
    });
});
