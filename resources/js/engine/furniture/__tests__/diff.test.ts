import { describe, expect, it } from 'vitest';
import { seedCatalog } from '../../testing/seedCatalog';
import {
    CHANGE_KINDS,
    CHANGE_MESSAGE_KEYS,
    diffFurniture,
    type ChangeItem,
} from '../diff';
import { highlightMap } from '../diffHighlight';
import { generateFurniture } from '../generate';
import type { ExtraPart, Front, FurnitureDocument } from '../schema';
import {
    assign,
    boxDocument,
    flex,
    leafSection,
    splitSection,
    templateWardrobe,
    wardrobeFixture,
} from '../testing/docs';

const catalog = seedCatalog();
const base = (): FurnitureDocument => wardrobeFixture();
const patched = (
    from: () => FurnitureDocument,
    patch: (doc: FurnitureDocument) => void,
): FurnitureDocument => {
    const doc = from();
    patch(doc);
    return doc;
};
/** Diff of a document against a patched copy of itself. */
const diff = (
    patch: (doc: FurnitureDocument) => void,
    from: () => FurnitureDocument = base,
): ChangeItem[] => diffFurniture(from(), patched(from, patch), catalog);
const ofKind = (items: ChangeItem[], kind: ChangeItem['kind']) =>
    items.filter((i) => i.kind === kind);
const carcassOf = (doc: FurnitureDocument) => {
    if (!doc.carcass) throw new Error('carcass expected');
    return doc.carcass;
};
const extraPart = (): ExtraPart => ({
    id: 'p_0000000001',
    name: 'Kick strip',
    role: 'carcass',
    materialCode: 'PB18-WHITE',
    length: 800,
    width: 100,
    qty: 1,
    edges: { L1: null, L2: null, W1: null, W2: null },
    grain: 'none',
    note: null,
    placement: null,
});
const hingedFront = (id: string, covers: string[]): Front => ({
    id,
    kind: 'hinged',
    covers,
    leaves: 1,
    hingeSide: 'auto',
    overlay: 'full',
    glass: false,
    handleCode: 'inherit',
    hingeCode: 'auto',
    slidingTrackCode: null,
});

describe('diffFurniture (07 §12.6)', () => {
    it('returns [] for identical documents', () => {
        expect(diffFurniture(base(), base(), catalog)).toEqual([]);
    });

    it('width 2100: price first, then dims, parts collapsed, no front items', () => {
        const items = diff((d) => {
            d.dims.width = 2100;
        });
        expect(items[0]).toMatchObject({
            kind: 'price_changed',
            messageKey: 'changes.price_changed',
            significance: 'major',
            entityId: null,
            params: { direction: 'up' },
        });
        expect(items[0]?.params.afterMinor).toBeGreaterThan(
            items[0]?.params.beforeMinor as number,
        );
        expect(items[1]).toMatchObject({
            kind: 'dims_changed',
            significance: 'major',
            params: { dimension: 'width', beforeMm: 1800, afterMm: 2100 },
        });
        const many = items.find(
            (i) => i.messageKey === 'changes.parts_changed_many',
        );
        expect(many).toMatchObject({
            kind: 'part_changed',
            significance: 'minor',
            entityId: null,
            before: null,
            after: null,
        });
        expect(many?.params.count).toBeGreaterThan(10);
        expect(ofKind(items, 'part_changed')).toHaveLength(1);
        expect(items.some((i) => i.kind.startsWith('front_'))).toBe(false);
    });

    it('half overlay on fr_0000000002', () => {
        const items = diff((d) => {
            const front = carcassOf(d).fronts.find(
                (f) => f.id === 'fr_0000000002',
            );
            if (front) front.overlay = 'half';
        });
        expect(ofKind(items, 'front_changed')).toEqual([
            expect.objectContaining({
                messageKey: 'changes.front_changed',
                entityId: 'fr_0000000002',
                significance: 'minor',
                params: { front: 'Door over Column 2', fields: 'overlay' },
            }),
        ]);
        const hw = ofKind(items, 'hardware_qty_changed');
        expect(hw.find((h) => h.entityId === 'HNG-FO-SC')).toMatchObject({
            before: 8,
            after: 4,
            params: { before: 8, after: 4 },
        });
        expect(hw.find((h) => h.entityId === 'HNG-HO-SC')).toMatchObject({
            before: 4,
            after: 8,
        });
        expect(ofKind(items, 'part_changed').map((p) => p.entityId)).toEqual(
            expect.arrayContaining([
                'front.fr_0000000002.leaf.1',
                'front.fr_0000000002.leaf.2',
            ]),
        );
    });

    it('extra hardware LCK-CAM-20 x 1 is hardware_added', () => {
        const items = diff((d) => {
            d.overrides.extraHardware.push({
                id: 'h_0000000001',
                code: 'LCK-CAM-20',
                qty: 1,
                note: null,
            });
        });
        const added = ofKind(items, 'hardware_added');
        expect(added).toHaveLength(1);
        expect(added[0]).toMatchObject({
            messageKey: 'changes.hardware_added',
            entityId: 'LCK-CAM-20',
            significance: 'minor',
            before: null,
            after: 1,
            params: { qty: 1, name: 'Cupboard cam lock 20 mm' },
        });
    });

    it('removed hardware and notes', () => {
        const items = diffFurniture(
            patched(base, (d) => {
                d.overrides.extraHardware.push({
                    id: 'h_0000000001',
                    code: 'LCK-CAM-20',
                    qty: 2,
                    note: null,
                });
                d.notes = 'a';
            }),
            patched(base, (d) => {
                d.notes = 'b';
            }),
            catalog,
        );
        expect(ofKind(items, 'hardware_removed')[0]).toMatchObject({
            messageKey: 'changes.hardware_removed',
            before: 2,
            after: null,
            params: { qty: 2 },
        });
        expect(ofKind(items, 'notes_changed')).toEqual([
            expect.objectContaining({
                messageKey: 'changes.notes_changed',
                significance: 'minor',
                entityId: null,
                params: {},
                before: 'a',
                after: 'b',
            }),
        ]);
    });
});

describe('notes', () => {
    it('treats null and the empty string as the same notes', () => {
        const items = diffFurniture(
            patched(base, (d) => {
                d.notes = null;
            }),
            patched(base, (d) => {
                d.notes = '';
            }),
            catalog,
        );
        expect(ofKind(items, 'notes_changed')).toEqual([]);
    });
});

describe('material, edge band, finish', () => {
    it('carcass material is major', () => {
        const items = diff((d) => {
            d.materials.carcass = assign('PB18-OAK');
        });
        expect(ofKind(items, 'material_changed')[0]).toMatchObject({
            messageKey: 'changes.material_changed',
            significance: 'major',
            entityId: 'carcass',
            before: 'PB18-WHITE',
            after: 'PB18-OAK',
            params: {
                role: 'Carcass',
                before: 'PB 18 mm Frosty White',
                after: 'PB 18 mm Natural Oak',
            },
        });
    });

    it('drawer_box material is minor (document with drawers)', () => {
        const items = diff(
            (d) => {
                d.materials.drawer_box = assign('PLY18-BWR');
            },
            () => templateWardrobe({ internalDrawers: 2 }),
        );
        const m = ofKind(items, 'material_changed').find(
            (i) => i.entityId === 'drawer_box',
        );
        expect(m).toMatchObject({
            significance: 'minor',
            params: { role: 'Drawer box' },
        });
    });

    it('a role without parts emits nothing', () => {
        const items = diff((d) => {
            d.materials.drawer_box = assign('PLY18-BWR');
        });
        expect(ofKind(items, 'material_changed')).toEqual([]);
    });

    it('edge band is minor with Default for null', () => {
        const items = diff((d) => {
            d.materials.carcass = {
                ...assign('PB18-WHITE'),
                edgeBandCode: 'EB04-WHITE',
            };
        });
        const e = ofKind(items, 'material_changed');
        expect(e).toHaveLength(1);
        expect(e[0]).toMatchObject({
            messageKey: 'changes.edge_band_changed',
            significance: 'minor',
            entityId: 'carcass',
            before: null,
            after: 'EB04-WHITE',
            params: {
                role: 'Carcass',
                before: 'Default',
                after: '0.4 × 22 White',
            },
        });
    });

    it('finish is major with None for null', () => {
        const items = diff((d) => {
            d.materials.front = {
                ...assign('PB18-WHITE'),
                finishCode: 'FIN-DUCO',
            };
        });
        expect(ofKind(items, 'material_changed')[0]).toMatchObject({
            messageKey: 'changes.finish_changed',
            significance: 'major',
            params: { role: 'Front', before: 'None', after: 'Duco paint' },
        });
    });
});

describe('construction', () => {
    it('mounting is major', () => {
        const items = diff((d) => {
            carcassOf(d).mounting = 'wall';
        });
        expect(ofKind(items, 'construction_changed')[0]).toMatchObject({
            messageKey: 'changes.construction_changed',
            significance: 'major',
            entityId: 'mounting',
            before: 'floor',
            after: 'wall',
            params: { field: 'Mounting', before: 'floor', after: 'wall' },
        });
    });

    it('plinth.height is minor with beforeMm/afterMm', () => {
        const items = diff((d) => {
            carcassOf(d).plinth.height = 120;
        });
        expect(ofKind(items, 'construction_changed')).toEqual([
            expect.objectContaining({
                significance: 'minor',
                entityId: 'plinth.height',
                before: 100,
                after: 120,
                params: {
                    field: 'Plinth height',
                    beforeMm: 100,
                    afterMm: 120,
                },
            }),
        ]);
    });

    it('countertop null to set is one item', () => {
        const items = diff((d) => {
            carcassOf(d).countertop = {
                enabled: true,
                overhangFront: 20,
                overhangLeft: 0,
                overhangRight: 0,
            };
        });
        expect(
            ofKind(items, 'construction_changed').map((i) => i.entityId),
        ).toEqual(['countertop']);
    });

    it('templateKey change is major', () => {
        const items = diff((d) => {
            d.templateKey = 'custom_box';
        });
        expect(ofKind(items, 'construction_changed')[0]).toMatchObject({
            entityId: 'templateKey',
            significance: 'major',
        });
    });
});

describe('sections, contents, fronts', () => {
    const box = () =>
        boxDocument({
            width: 1200,
            height: 720,
            depth: 560,
            interior: splitSection('s_0000000001', 'columns', [
                [flex(), leafSection('s_0000000002')],
                [flex(), leafSection('s_0000000003')],
            ]),
        });
    const splitSecond = (d: FurnitureDocument) => {
        const c = carcassOf(d).interior.children[1];
        if (c) {
            c.section = splitSection('s_0000000003', 'rows', [
                [flex(), leafSection('s_0000000004')],
                [flex(), leafSection('s_0000000005')],
            ]);
        }
    };
    const rows = (items: ChangeItem[]) =>
        ofKind(items, 'section_changed').map((i) => [
            i.messageKey,
            i.entityId,
            i.params.section,
        ]);

    it('size change', () => {
        const items = diff((d) => {
            const c = carcassOf(d).interior.children[0];
            if (c) c.size = { mode: 'flex', weight: 2 };
        }, box);
        expect(ofKind(items, 'section_changed')).toEqual([
            expect.objectContaining({
                messageKey: 'changes.section_size',
                entityId: 's_0000000001',
                significance: 'minor',
                params: { section: 'Interior' },
            }),
        ]);
    });

    it('layout change, added and removed', () => {
        const layout = diff((d) => {
            carcassOf(d).interior.split = 'rows';
        }, box);
        expect(ofKind(layout, 'section_changed')[0]).toMatchObject({
            messageKey: 'changes.section_layout',
        });

        expect(rows(diff(splitSecond, box))).toEqual(
            expect.arrayContaining([
                ['changes.section_layout', 's_0000000003', 'Column 2'],
                ['changes.section_added', 's_0000000004', 'Column 2 › Row 1'],
                ['changes.section_added', 's_0000000005', 'Column 2 › Row 2'],
            ]),
        );

        const removed = diffFurniture(
            patched(box, splitSecond),
            box(),
            catalog,
        );
        expect(rows(removed)).toEqual(
            expect.arrayContaining([
                ['changes.section_removed', 's_0000000004', 'Column 2 › Row 1'],
                ['changes.section_removed', 's_0000000005', 'Column 2 › Row 2'],
            ]),
        );
    });

    it('content change with summaries', () => {
        const items = diff((d) => {
            const leaf = carcassOf(d).interior.children[0]?.section;
            if (leaf) {
                leaf.content = {
                    type: 'shelves',
                    count: 3,
                    adjustable: true,
                    frontSetback: 20,
                };
            }
        }, box);
        expect(ofKind(items, 'content_changed')).toEqual([
            expect.objectContaining({
                messageKey: 'changes.content_changed',
                entityId: 's_0000000002',
                significance: 'minor',
                params: {
                    section: 'Column 1',
                    before: 'empty',
                    after: '3 adjustable shelves',
                },
            }),
        ]);
    });

    it('front added/removed are major; glass change is major', () => {
        const add = diff((d) => {
            carcassOf(d).fronts.push(
                hingedFront('fr_0000000009', ['s_0000000002']),
            );
        }, box);
        expect(ofKind(add, 'front_added')[0]).toMatchObject({
            messageKey: 'changes.front_added',
            significance: 'major',
            entityId: 'fr_0000000009',
            before: null,
            params: { kind: 'Door', sections: 'Column 1' },
        });
        const removed = diffFurniture(
            patched(box, (d) => {
                carcassOf(d).fronts.push(
                    hingedFront('fr_0000000009', [
                        's_0000000002',
                        's_0000000003',
                    ]),
                );
            }),
            box(),
            catalog,
        );
        expect(ofKind(removed, 'front_removed')[0]).toMatchObject({
            messageKey: 'changes.front_removed',
            significance: 'major',
            after: null,
            params: { kind: 'Door', sections: 'Column 1, Column 2' },
        });

        const glass = diff((d) => {
            const f = carcassOf(d).fronts.find((x) => x.id === 'fr_0000000001');
            if (f) f.glass = true;
        });
        expect(ofKind(glass, 'front_changed')[0]).toMatchObject({
            significance: 'major',
            params: { fields: 'glass' },
        });
    });
});

describe('parts', () => {
    it('lists part changes individually and collapses more than 10', () => {
        const items = diff((d) => {
            d.overrides.extraParts.push(extraPart());
        });
        expect(ofKind(items, 'part_added')).toEqual([
            expect.objectContaining({
                messageKey: 'changes.part_added',
                significance: 'minor',
                params: { name: 'Kick strip', lengthMm: 800, widthMm: 100 },
                before: null,
            }),
        ]);

        const removed = diffFurniture(
            patched(base, (d) => {
                d.overrides.extraParts.push(extraPart());
            }),
            base(),
            catalog,
        );
        expect(ofKind(removed, 'part_removed')[0]).toMatchObject({
            messageKey: 'changes.part_removed',
            params: { name: 'Kick strip' },
            after: null,
        });

        const many = diff((d) => {
            for (const role of [
                'carcass',
                'shelf',
                'front',
                'top',
                'plinth',
            ] as const) {
                d.materials[role] = assign('PB18-OAK');
            }
        });
        expect(ofKind(many, 'part_changed').map((i) => i.messageKey)).toEqual([
            'changes.parts_changed_many',
        ]);
    });

    it('collapses added and removed lists of more than 10 parts', () => {
        const none = () => templateWardrobe({ internalDrawers: 0 });
        const four = () => templateWardrobe({ internalDrawers: 4 });
        const countOf = (items: ChangeItem[], key: string) =>
            items.find((i) => i.messageKey === key)?.params.count;
        const added = diffFurniture(none(), four(), catalog);
        const gone = diffFurniture(four(), none(), catalog);
        expect(countOf(added, 'changes.parts_added_many')).toBeGreaterThan(10);
        expect(countOf(gone, 'changes.parts_removed_many')).toBe(
            countOf(added, 'changes.parts_added_many'),
        );
        expect(ofKind(added, 'part_added')).toHaveLength(1);
    });
});

describe('ordering', () => {
    it('sorts by significance, kind rank, entityId (null first), messageKey', () => {
        const items = diff((d) => {
            d.dims.width = 2100;
            d.notes = 'hello';
            carcassOf(d).plinth.height = 120;
            carcassOf(d).plinth.setback = 30;
            d.materials.front = {
                ...assign('PB18-WHITE'),
                finishCode: 'FIN-DUCO',
            };
        });
        const rank = (k: ChangeItem['kind']) => CHANGE_KINDS.indexOf(k);
        for (let i = 1; i < items.length; i++) {
            const a = items[i - 1] as ChangeItem;
            const b = items[i] as ChangeItem;
            const sa = a.significance === 'major' ? 0 : 1;
            const sb = b.significance === 'major' ? 0 : 1;
            expect(sa).toBeLessThanOrEqual(sb);
            if (sa !== sb) continue;
            expect(rank(a.kind)).toBeLessThanOrEqual(rank(b.kind));
            if (a.kind !== b.kind) continue;
            if (b.entityId === null) expect(a.entityId).toBeNull();
            else if (a.entityId !== null) {
                expect(a.entityId <= b.entityId).toBe(true);
            }
        }
        expect(
            items
                .filter((i) => i.kind === 'construction_changed')
                .map((i) => i.entityId),
        ).toEqual(['plinth.height', 'plinth.setback']);
    });

    it('CHANGE_KINDS is in rank order and message keys are listed', () => {
        expect(CHANGE_KINDS).toEqual([
            'price_changed',
            'dims_changed',
            'material_changed',
            'construction_changed',
            'front_added',
            'front_removed',
            'front_changed',
            'section_changed',
            'content_changed',
            'part_added',
            'part_removed',
            'part_changed',
            'hardware_added',
            'hardware_removed',
            'hardware_qty_changed',
            'notes_changed',
        ]);
        expect(CHANGE_MESSAGE_KEYS).toContain('changes.edge_band_changed');
        expect(CHANGE_MESSAGE_KEYS).toContain('changes.parts_added_many');
        expect(new Set(CHANGE_MESSAGE_KEYS).size).toBe(
            CHANGE_MESSAGE_KEYS.length,
        );
    });

    it('is deterministic and does not mutate inputs', () => {
        const a = base();
        const b = patched(base, (d) => {
            d.dims.width = 2100;
        });
        const snapA = JSON.stringify(a);
        const snapB = JSON.stringify(b);
        const one = diffFurniture(a, b, catalog);
        expect(diffFurniture(a, b, catalog)).toEqual(one);
        expect(JSON.stringify(a)).toBe(snapA);
        expect(JSON.stringify(b)).toBe(snapB);
    });
});

describe('highlightMap (07 §10.4)', () => {
    const model = (patch: (d: FurnitureDocument) => void = () => {}) =>
        generateFurniture(patched(base, patch), catalog);

    it('width change marks carcass.top changed', () => {
        const map = highlightMap(
            model(),
            model((d) => {
                d.dims.width = 2100;
            }),
        );
        expect(map.get('carcass.top')).toBe('changed');
    });

    it('identical models give an empty map', () => {
        expect(highlightMap(model(), model()).size).toBe(0);
    });

    it('added and removed extra parts', () => {
        const withExtra = model((d) => {
            d.overrides.extraParts.push(extraPart());
        });
        const without = model();
        const key = withExtra.parts.find((p) => p.source === 'extra')?.key;
        expect(key).toBeDefined();
        expect(highlightMap(without, withExtra).get(key as string)).toBe(
            'added',
        );
        expect(highlightMap(withExtra, without).get(key as string)).toBe(
            'removed',
        );
    });

    it('a material change marks the part changed', () => {
        const map = highlightMap(
            model(),
            model((d) => {
                d.materials.back = assign('PLY6-BWR');
            }),
        );
        const backs = [...map].filter(([k]) => k.startsWith('carcass.back'));
        expect(backs.length).toBeGreaterThan(0);
        expect(backs.every(([, h]) => h === 'changed')).toBe(true);
    });
});
