import { describe, expect, it } from 'vitest';
import { createCommandBus } from '../../../commands/bus';
import type { CommandDef } from '../../../commands/types';
import { seedCatalog } from '../../../testing/seedCatalog';
import { indexCatalog } from '../../catalogIndex';
import type { FurnitureDocument } from '../../schema';
import {
    FIXTURE_FRONTS as FR,
    FIXTURE_SECTIONS as S,
    furnitureBus,
    idsAfterFixture,
    ok,
    refused,
} from '../../testing/commands';
import { diningTable, wardrobeFixture } from '../../testing/docs';
import {
    FURNITURE_COMMAND_ERROR_CODES,
    furniturePipeline,
    type FurnitureCommandContext,
} from '../pipeline';
import {
    FURNITURE_COMMANDS,
    createFurnitureBus,
    furnitureEntityIdsOf,
    furniturePathToEntityId,
} from '../registry';

const TYPES = [
    'setDims',
    'setConstruction',
    'setMounting',
    'setPlinth',
    'setBack',
    'setCountertop',
    'setHandles',
    'splitSection',
    'setChildSize',
    'insertChild',
    'removeChild',
    'mergeSections',
    'setContent',
    'addFront',
    'updateFront',
    'removeFront',
    'setMaterial',
    'setTable',
    'setPartOverride',
    'addExtraPart',
    'updateExtraPart',
    'removeExtraPart',
    'setHardwareOverride',
    'addExtraHardware',
    'updateExtraHardware',
    'removeExtraHardware',
    'resetOverrides',
    'setNotes',
];

const snake = (name: string) =>
    name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

describe('FURNITURE_COMMANDS', () => {
    it('has the 28 commands of 07 §9, keyed furniture.<name>', () => {
        expect(Object.keys(FURNITURE_COMMANDS)).toHaveLength(28);
        expect(Object.keys(FURNITURE_COMMANDS).sort()).toEqual(
            TYPES.map((t) => `furniture.${t}`).sort(),
        );
    });

    it('every command has its key as type, a snake_case labelKey, a params schema, replace mode and no geometry pass', () => {
        for (const [key, def] of Object.entries(FURNITURE_COMMANDS)) {
            expect(def.type).toBe(key);
            expect(def.labelKey).toBe(
                `engine.furniture.command.label.${snake(key.slice('furniture.'.length))}`,
            );
            expect(def.paramsSchema).toBeDefined();
            expect(def.mergeMode).toBe('replace');
            expect(def.touchesGeometry).toBe(false);
        }
        expect(FURNITURE_COMMANDS['furniture.setDims'].labelKey).toBe(
            'engine.furniture.command.label.set_dims',
        );
    });

    it('only the commands 07 §9 marks as mergeable have a mergeKey, with its pattern', () => {
        const keys: Record<string, string | null> = {};
        const sample = {
            parentId: 'P',
            index: 3,
            sectionId: 'S',
            frontId: 'F',
            partKey: 'K',
            hardwareKey: 'H',
            id: 'I',
        };
        for (const [type, def] of Object.entries(FURNITURE_COMMANDS)) {
            keys[type] = def.mergeKey?.(sample as never) ?? null;
        }
        expect(keys).toEqual({
            'furniture.setDims': 'dims',
            'furniture.setConstruction': null,
            'furniture.setMounting': null,
            'furniture.setPlinth': 'plinth',
            'furniture.setBack': null,
            'furniture.setCountertop': 'countertop',
            'furniture.setHandles': null,
            'furniture.splitSection': null,
            'furniture.setChildSize': 'size:P:3',
            'furniture.insertChild': null,
            'furniture.removeChild': null,
            'furniture.mergeSections': null,
            'furniture.setContent': 'content:S',
            'furniture.addFront': null,
            'furniture.updateFront': 'front:F',
            'furniture.removeFront': null,
            'furniture.setMaterial': null,
            'furniture.setTable': 'table',
            'furniture.setPartOverride': 'part:K',
            'furniture.addExtraPart': null,
            'furniture.updateExtraPart': 'extra:I',
            'furniture.removeExtraPart': null,
            'furniture.setHardwareOverride': 'hw:H',
            'furniture.addExtraHardware': null,
            'furniture.updateExtraHardware': 'xhw:I',
            'furniture.removeExtraHardware': null,
            'furniture.resetOverrides': null,
            'furniture.setNotes': 'notes',
        });
        expect(
            FURNITURE_COMMANDS['furniture.setChildSize'].mergeKey!({
                parentId: 'P',
                index: 3,
                size: { mode: 'flex', weight: 1 },
                drag: true,
            }),
        ).toBe('drag:P');
    });

    it('lists the error codes of the furniture commands', () => {
        expect(FURNITURE_COMMAND_ERROR_CODES).toEqual([
            'not_found',
            'invalid_params',
            'not_leaf',
            'not_split',
            'out_of_range',
            'invalid_document',
        ]);
    });
});

describe('furniturePipeline', () => {
    const breakDoc: CommandDef<
        FurnitureDocument,
        Record<string, never>,
        FurnitureCommandContext
    > = {
        type: 'test.break',
        labelKey: 'engine.furniture.command.label.test_break',
        validate: () => null,
        run(draft) {
            draft.dims.width = 1.5;
        },
        mergeMode: 'replace',
        touchesGeometry: false,
    };

    it('aborts a command whose result fails FurnitureDocumentSchema with invalid_document, changing nothing', () => {
        const bus = createFurnitureBus({
            initial: wardrobeFixture(),
            catalog: indexCatalog(seedCatalog()),
            newId: idsAfterFixture(),
            registry: { ...FURNITURE_COMMANDS, 'test.break': breakDoc },
        });
        const before = bus.getDoc();
        const error = refused(bus.execute('test.break', {}));
        expect(error.code).toBe('invalid_document');
        expect(error.messageKey).toBe(
            'engine.furniture.command.invalid_document',
        );
        expect(error.params.path).toBe('dims.width');
        expect(bus.getDoc()).toBe(before);
        expect(bus.history().undo).toHaveLength(0);
        // and an ordinary command still runs afterwards
        ok(bus.execute('furniture.setNotes', { notes: 'x' }));
    });

    it('is what createFurnitureBus runs; the generic bus with the default pipeline would accept the bad document', () => {
        const generic = createCommandBus({
            initial: wardrobeFixture(),
            registry: { 'test.break': breakDoc },
            getContext: () =>
                ({
                    catalog: indexCatalog(seedCatalog()),
                    newId: idsAfterFixture(),
                }) as FurnitureCommandContext,
            pathToEntityId: () => '*',
            messageKeyPrefix: 'engine.furniture.command',
        });
        expect(generic.execute('test.break', {}).ok).toBe(true);

        const guarded = createCommandBus({
            initial: wardrobeFixture(),
            registry: { 'test.break': breakDoc },
            getContext: () =>
                ({
                    catalog: indexCatalog(seedCatalog()),
                    newId: idsAfterFixture(),
                }) as FurnitureCommandContext,
            pathToEntityId: () => '*',
            messageKeyPrefix: 'engine.furniture.command',
            pipeline: furniturePipeline,
        });
        expect(refused(guarded.execute('test.break', {})).code).toBe(
            'invalid_document',
        );
    });
});

describe('furniturePathToEntityId', () => {
    const doc = wardrobeFixture();

    it('maps an override path to its key, with or without a document', () => {
        expect(
            furniturePathToEntityId(['overrides', 'parts', 'carcass.top']),
        ).toBe('carcass.top');
        expect(
            furniturePathToEntityId(
                ['overrides', 'parts', 'carcass.top', 'note'],
                doc,
            ),
        ).toBe('carcass.top');
        expect(
            furniturePathToEntityId([
                'overrides',
                'hardware',
                'hinge.x',
                'qtyDelta',
            ]),
        ).toBe('hinge.x');
    });

    it('maps section paths to the section id, using the document to read the indices', () => {
        const base = ['carcass', 'interior'];
        expect(furniturePathToEntityId([...base, 'split'], doc)).toBe(S.root);
        expect(
            furniturePathToEntityId(
                [...base, 'children', 0, 'section', 'content', 'count'],
                doc,
            ),
        ).toBe(S.shelves);
        expect(
            furniturePathToEntityId(
                [
                    ...base,
                    'children',
                    1,
                    'section',
                    'children',
                    1,
                    'section',
                    'content',
                ],
                doc,
            ),
        ).toBe(S.rod);
        // a child's size belongs to that child
        expect(
            furniturePathToEntityId(
                [...base, 'children', 1, 'size', 'weight'],
                doc,
            ),
        ).toBe(S.rows);
        // a child added, removed or replaced changes its parent; an index out of range too
        expect(furniturePathToEntityId([...base, 'children', 1], doc)).toBe(
            S.root,
        );
        expect(furniturePathToEntityId([...base, 'children'], doc)).toBe(
            S.root,
        );
        expect(
            furniturePathToEntityId(
                [...base, 'children', 7, 'section', 'content'],
                doc,
            ),
        ).toBe(S.root);
    });

    it('maps front paths to the front id; an index the document does not have is a collection change', () => {
        expect(
            furniturePathToEntityId(['carcass', 'fronts', 1, 'overlay'], doc),
        ).toBe(FR.right);
        expect(furniturePathToEntityId(['carcass', 'fronts', 1], doc)).toBe(
            FR.right,
        );
        expect(furniturePathToEntityId(['carcass', 'fronts', 2], doc)).toBe(
            '*',
        );
        expect(furniturePathToEntityId(['carcass', 'fronts'], doc)).toBe('*');
    });

    it('maps extra part and hardware paths to their ids', () => {
        const withExtras = wardrobeFixture((d) => {
            d.overrides.extraParts.push({
                id: 'p_0000000001',
                name: 'x',
                role: 'carcass',
                materialCode: 'PB18-WHITE',
                length: 100,
                width: 50,
                qty: 1,
                edges: { L1: null, L2: null, W1: null, W2: null },
                grain: 'none',
                note: null,
                placement: null,
            });
            d.overrides.extraHardware.push({
                id: 'h_0000000001',
                code: 'X',
                qty: 1,
                note: null,
            });
        });
        expect(
            furniturePathToEntityId(
                ['overrides', 'extraParts', 0, 'qty'],
                withExtras,
            ),
        ).toBe('p_0000000001');
        expect(
            furniturePathToEntityId(
                ['overrides', 'extraHardware', 0, 'qty'],
                withExtras,
            ),
        ).toBe('h_0000000001');
        expect(
            furniturePathToEntityId(['overrides', 'extraParts', 0], doc),
        ).toBe('*');
    });

    it('is * for the rest, and for sections and fronts when no document is at hand', () => {
        expect(furniturePathToEntityId(['dims', 'width'])).toBe('*');
        expect(
            furniturePathToEntityId(['materials', 'carcass', 'materialCode']),
        ).toBe('*');
        expect(furniturePathToEntityId(['notes'])).toBe('*');
        expect(furniturePathToEntityId(['table', 'top'], diningTable())).toBe(
            '*',
        );
        expect(
            furniturePathToEntityId(['carcass', 'plinth', 'height'], doc),
        ).toBe('*');
        expect(furniturePathToEntityId(['carcass', 'interior', 'split'])).toBe(
            '*',
        );
        expect(
            furniturePathToEntityId(['carcass', 'fronts', 0, 'covers']),
        ).toBe('*');
        expect(furniturePathToEntityId([])).toBe('*');
    });
});

describe('changedIds of the commands', () => {
    const EXTRA = {
        name: 'Cleat',
        role: 'carcass' as const,
        materialCode: 'PB18-WHITE',
        length: 800,
        width: 80,
        qty: 2,
        edges: { L1: null, L2: null, W1: null, W2: null },
        grain: 'length' as const,
        note: null,
        placement: null,
    };
    const withExtras = () =>
        wardrobeFixture((d) => {
            d.overrides.extraParts.push({ ...EXTRA, id: 'p_0000000001' });
            d.overrides.extraHardware.push({
                id: 'h_0000000001',
                code: 'LCK-CAM-20',
                qty: 1,
                note: null,
            });
            d.overrides.parts['extra.p_0000000001'] = { lengthDelta: 1 };
            d.overrides.parts['carcass.top'] = { lengthDelta: 1 };
            d.overrides.hardware['hinge.x'] = { qtyDelta: 1 };
        });

    type Case = [
        name: string,
        run: (
            bus: ReturnType<typeof furnitureBus>,
        ) => ReturnType<ReturnType<typeof furnitureBus>['execute']>,
        expected: string[],
        doc?: () => FurnitureDocument,
    ];
    const cases: Case[] = [
        [
            'setDims',
            (b) => b.execute('furniture.setDims', { width: 2000 }),
            ['*'],
        ],
        [
            'setConstruction',
            (b) =>
                b.execute('furniture.setConstruction', { top: 'over_sides' }),
            ['*'],
        ],
        [
            'setMounting',
            (b) => b.execute('furniture.setMounting', { mounting: 'wall' }),
            ['*'],
        ],
        [
            'setPlinth',
            (b) => b.execute('furniture.setPlinth', { height: 80 }),
            ['*'],
        ],
        [
            'setBack',
            (b) => b.execute('furniture.setBack', { type: 'none' }),
            ['*'],
        ],
        [
            'setCountertop',
            (b) =>
                b.execute('furniture.setCountertop', {
                    enabled: true,
                    overhangFront: 20,
                    overhangLeft: 0,
                    overhangRight: 0,
                }),
            ['*'],
        ],
        [
            'setHandles',
            (b) => b.execute('furniture.setHandles', { code: null }),
            ['*'],
        ],
        [
            'splitSection',
            (b) =>
                b.execute('furniture.splitSection', {
                    sectionId: S.shelves,
                    direction: 'rows',
                    count: 2,
                }),
            [S.shelves],
        ],
        [
            'setChildSize',
            (b) =>
                b.execute('furniture.setChildSize', {
                    parentId: S.root,
                    index: 0,
                    size: { mode: 'fixed', mm: 500 },
                }),
            [S.shelves],
        ],
        [
            'insertChild',
            (b) =>
                b.execute('furniture.insertChild', {
                    parentId: S.root,
                    index: 1,
                }),
            [S.root],
        ],
        [
            'removeChild',
            (b) =>
                b.execute('furniture.removeChild', {
                    parentId: S.root,
                    index: 1,
                }),
            // fr_2 left the array (a shortened collection is '*'); fr_1 changed its covers
            [S.root, FR.left, '*'],
        ],
        [
            'mergeSections',
            (b) => b.execute('furniture.mergeSections', { sectionId: S.rows }),
            [S.rows],
        ],
        [
            'setContent',
            (b) =>
                b.execute('furniture.setContent', {
                    sectionId: S.rod,
                    content: { type: 'empty' },
                }),
            [S.rod],
        ],
        [
            'addFront',
            (b) =>
                b.execute('furniture.addFront', {
                    kind: 'hinged',
                    covers: [S.rod],
                    leaves: 1,
                    hingeSide: 'left',
                    overlay: 'full',
                    glass: false,
                    handleCode: null,
                    hingeCode: null,
                    slidingTrackCode: null,
                }),
            ['*'],
        ],
        [
            'updateFront',
            (b) =>
                b.execute('furniture.updateFront', {
                    frontId: FR.right,
                    patch: { overlay: 'half' },
                }),
            [FR.right],
        ],
        [
            'removeFront',
            // removing a front shifts the array: the collection changed
            (b) => b.execute('furniture.removeFront', { frontId: FR.left }),
            [FR.left, '*'],
        ],
        [
            'setMaterial',
            (b) =>
                b.execute('furniture.setMaterial', {
                    role: 'front',
                    materialCode: 'PB18-OAK',
                }),
            ['*'],
        ],
        [
            'setTable',
            (b) =>
                b.execute('furniture.setTable', {
                    patch: { top: { overhang: 80 } },
                }),
            ['*'],
            () => diningTable(),
        ],
        [
            'setPartOverride',
            (b) =>
                b.execute('furniture.setPartOverride', {
                    partKey: 'carcass.top',
                    patch: { lengthDelta: 2 },
                }),
            ['carcass.top'],
        ],
        [
            'addExtraPart',
            (b) => b.execute('furniture.addExtraPart', EXTRA),
            ['*'],
        ],
        [
            'updateExtraPart',
            (b) =>
                b.execute('furniture.updateExtraPart', {
                    id: 'p_0000000001',
                    patch: { qty: 3 },
                }),
            ['p_0000000001'],
            withExtras,
        ],
        [
            'removeExtraPart',
            (b) =>
                b.execute('furniture.removeExtraPart', { id: 'p_0000000001' }),
            ['extra.p_0000000001', '*'],
            withExtras,
        ],
        [
            'setHardwareOverride',
            (b) =>
                b.execute('furniture.setHardwareOverride', {
                    hardwareKey: 'hinge.x',
                    patch: null,
                }),
            ['hinge.x'],
            withExtras,
        ],
        [
            'addExtraHardware',
            (b) =>
                b.execute('furniture.addExtraHardware', {
                    code: 'LCK-CAM-20',
                    qty: 1,
                    note: null,
                }),
            ['*'],
        ],
        [
            'updateExtraHardware',
            (b) =>
                b.execute('furniture.updateExtraHardware', {
                    id: 'h_0000000001',
                    patch: { qty: 2 },
                }),
            ['h_0000000001'],
            withExtras,
        ],
        [
            'removeExtraHardware',
            (b) =>
                b.execute('furniture.removeExtraHardware', {
                    id: 'h_0000000001',
                }),
            ['*'],
            withExtras,
        ],
        [
            'resetOverrides',
            (b) => b.execute('furniture.resetOverrides', { scope: 'all' }),
            ['carcass.top', 'extra.p_0000000001', 'hinge.x'],
            withExtras,
        ],
        [
            'setNotes',
            (b) => b.execute('furniture.setNotes', { notes: 'hello' }),
            ['*'],
        ],
    ];

    it('covers every command', () => {
        expect(cases.map(([name]) => `furniture.${name}`).sort()).toEqual(
            Object.keys(FURNITURE_COMMANDS).sort(),
        );
    });

    it.each(cases)(
        '%s reports the entities its patches touch',
        (_name, run, expected, doc) => {
            const bus = furnitureBus(doc?.());
            const result = ok(run(bus));
            expect(result.changedIds).toEqual(new Set(expected));
        },
    );
});

describe('changedIds across several patches', () => {
    /** Events of the given kinds, in order. */
    function watch(bus: ReturnType<typeof furnitureBus>) {
        const seen: Array<{ kind: string; ids: ReadonlySet<string> }> = [];
        bus.subscribe((e) => seen.push({ kind: e.kind, ids: e.changedIds }));
        return seen;
    }

    // s_5 is rows.children[1]; inserting at rows[0] shifts it to index 2 after
    // the content of s_5 was set, so a path read against the wrong document
    // names s_4 instead of s_5.
    const sequence = (bus: ReturnType<typeof furnitureBus>) =>
        bus.transaction('test.sequence', () => {
            ok(
                bus.execute('furniture.setContent', {
                    sectionId: S.rod,
                    content: { type: 'empty' },
                }),
            );
            ok(
                bus.execute('furniture.insertChild', {
                    parentId: S.rows,
                    index: 0,
                }),
            );
        });

    it('reports the section whose content changed on commit, undo and redo of a transaction', () => {
        const bus = furnitureBus();
        const seen = watch(bus);
        sequence(bus);
        bus.undo();
        bus.redo();
        expect(seen.map((e) => e.kind)).toEqual([
            'execute',
            'execute',
            'commit',
            'undo',
            'redo',
        ]);
        for (const kind of ['commit', 'undo', 'redo']) {
            const ids = seen.find((e) => e.kind === kind)!.ids;
            expect(ids, kind).toContain(S.rod);
            expect(ids, kind).toContain(S.rows);
        }
    });

    it('reports it on a rollback', () => {
        const bus = furnitureBus();
        const seen = watch(bus);
        bus.beginTransaction('test.sequence');
        ok(
            bus.execute('furniture.setContent', {
                sectionId: S.rod,
                content: { type: 'empty' },
            }),
        );
        ok(
            bus.execute('furniture.insertChild', {
                parentId: S.rows,
                index: 0,
            }),
        );
        bus.rollbackTransaction();
        expect(seen.at(-1)!.kind).toBe('rollback');
        expect(seen.at(-1)!.ids).toContain(S.rod);
    });

    it('reports the dragged child through a replace merge', () => {
        const bus = furnitureBus();
        ok(
            bus.execute('furniture.insertChild', {
                parentId: S.rows,
                index: 0,
            }),
        );
        bus.seal();
        const seen = watch(bus);
        for (const mm of [300, 320, 340]) {
            ok(
                bus.execute(
                    'furniture.setChildSize',
                    {
                        parentId: S.rows,
                        index: 2,
                        size: { mode: 'fixed', mm },
                        drag: true,
                    },
                    { merge: true },
                ),
            );
        }
        expect(seen.map((e) => e.kind)).toEqual(['execute', 'merge', 'merge']);
        for (const e of seen) expect(e.ids, e.kind).toContain(S.rod);
    });

    it('reads later patches against the document an earlier whole-collection patch produced', () => {
        const base = wardrobeFixture();
        const swapped = structuredClone(base.carcass!);
        swapped.fronts.reverse();
        // after the first patch fronts[0] is fr_2, not fr_1
        expect(
            furnitureEntityIdsOf(base, [
                { op: 'replace', path: ['carcass'], value: swapped },
                {
                    op: 'replace',
                    path: ['carcass', 'fronts', 0, 'overlay'],
                    value: 'half',
                },
            ]),
        ).toEqual(new Set(['*', FR.right]));
    });

    it('reports nothing for no patch and * for a patch outside the tree', () => {
        expect(furnitureEntityIdsOf(wardrobeFixture(), [])).toEqual(new Set());
        expect(
            furnitureEntityIdsOf(wardrobeFixture(), [
                { op: 'replace', path: ['dims', 'width'], value: 1 },
            ]),
        ).toEqual(new Set(['*']));
    });
});
