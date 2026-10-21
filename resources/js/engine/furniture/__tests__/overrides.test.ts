import { describe, expect, it } from 'vitest';
import { seedCatalog } from '../../testing/seedCatalog';
import { generateFurniture } from '../generate';
import type { ExtraHardware, ExtraPart, FurnitureDocument } from '../schema';
import { assign, diningTable, wardrobeFixture } from '../testing/docs';
import type { FurnitureModel, Part } from '../types';

const catalog = seedCatalog();
const B = 'EB08-WHITE';
const LEAF = 'front.fr_0000000001.leaf.1';
const SIDE = 'carcass.side.left';
const HINGES = 'front.fr_0000000001.hinges';

const generate = (patch: (doc: FurnitureDocument) => void): FurnitureModel =>
    generateFurniture(wardrobeFixture(patch), catalog);
const plain = generateFurniture(wardrobeFixture(), catalog);

const partOf = (model: FurnitureModel, key: string): Part => {
    const part = model.parts.find((p) => p.key === key);
    if (!part) throw new Error(`no part ${key}`);
    return part;
};
const boxOf = (part: Part) =>
    part.geometry.kind === 'box' ? part.geometry.box : null;
const issuesOf = (model: FurnitureModel, code: string) =>
    model.issues.filter((i) => i.code === code);
const lineOf = (model: FurnitureModel, key: string) =>
    model.hardware.find((h) => h.key === key);
const weightOf = (model: FurnitureModel) =>
    issuesOf(model, 'furniture.weight_estimate')[0]?.params.kg;

const extraPart = (over: Partial<ExtraPart> = {}): ExtraPart => ({
    id: 'p_0000000001',
    name: 'Filler',
    role: 'front',
    materialCode: 'PB18-OAK',
    length: 700,
    width: 60,
    qty: 2,
    edges: { L1: B, L2: null, W1: null, W2: null },
    grain: 'length',
    note: null,
    placement: null,
    ...over,
});

describe('part overrides (07 §3.14 step 1)', () => {
    it('removes a part and its model front', () => {
        const model = generate((d) => {
            d.overrides.parts[LEAF] = { removed: true };
        });
        expect(model.parts.map((p) => p.key)).not.toContain(LEAF);
        expect(model.parts).toHaveLength(19);
        expect(model.fronts.map((f) => f.id)).toEqual([
            'front.fr_0000000002.leaf.1',
            'front.fr_0000000002.leaf.2',
        ]);
    });

    it('removes a part that is not a front without touching the fronts', () => {
        const model = generate((d) => {
            d.overrides.parts['plinth.return.2'] = { removed: true };
        });
        expect(model.parts.map((p) => p.key)).not.toContain('plinth.return.2');
        expect(model.fronts).toEqual(plain.fronts);
    });

    it('sets the material and its thickness, keeps the geometry and marks the part overridden', () => {
        const model = generate((d) => {
            d.overrides.parts[SIDE] = { materialCode: 'PB18-OAK' };
            d.overrides.parts['carcass.top'] = { materialCode: 'PB25-WHITE' };
        });
        expect(partOf(model, SIDE)).toMatchObject({
            materialCode: 'PB18-OAK',
            thickness: 18,
            overridden: true,
        });
        expect(partOf(model, 'carcass.top')).toMatchObject({
            materialCode: 'PB25-WHITE',
            thickness: 25,
            length: 1764,
            width: 582,
        });
        expect(partOf(model, 'carcass.top').geometry).toEqual(
            partOf(plain, 'carcass.top').geometry,
        );
        expect(partOf(plain, SIDE).overridden).toBe(false);
    });

    it('replaces single edges; null removes a band', () => {
        const model = generate((d) => {
            d.overrides.parts[SIDE] = { edges: { W2: 'EB20-WHITE', L1: null } };
        });
        expect(partOf(model, SIDE).edges).toEqual({
            L1: null,
            L2: null,
            W1: B,
            W2: 'EB20-WHITE',
        });
        expect(partOf(model, SIDE).overridden).toBe(true);
    });

    it('applies lengthDelta and widthDelta to the size and grows the box from the min corner', () => {
        const model = generate((d) => {
            d.overrides.parts[SIDE] = { lengthDelta: -10, widthDelta: 5 };
        });
        const side = partOf(model, SIDE);
        expect([side.length, side.width]).toEqual([1990, 587]);
        // The side is thin in x, long in y (length) and deep in z (width).
        const before = boxOf(partOf(plain, SIDE));
        expect(boxOf(side)).toEqual({
            min: before?.min,
            size: [18, 1990, 587],
        });
    });

    it('applies a widthDelta along the width axis of a horizontal panel', () => {
        const model = generate((d) => {
            d.overrides.parts['carcass.top'] = {
                lengthDelta: 4,
                widthDelta: -2,
            };
        });
        const top = partOf(model, 'carcass.top');
        expect([top.length, top.width]).toEqual([1768, 580]);
        expect(boxOf(top)?.size).toEqual([1768, 18, 580]);
    });

    it('rejects a delta that makes a size zero or negative: override_invalid, size kept', () => {
        const model = generate((d) => {
            d.overrides.parts[SIDE] = { lengthDelta: -2000 };
            d.overrides.parts['carcass.top'] = { widthDelta: -600 };
        });
        expect(partOf(model, SIDE).length).toBe(2000);
        expect(boxOf(partOf(model, SIDE))).toEqual(boxOf(partOf(plain, SIDE)));
        expect(partOf(model, 'carcass.top').width).toBe(582);
        // The top's override applies before the long-panel split (spec 19,
        // Task 40 fix round 1), so its issue comes first.
        expect(issuesOf(model, 'furniture.override_invalid')).toEqual([
            expect.objectContaining({
                severity: 'error',
                params: { key: 'carcass.top' },
                entityIds: ['carcass.top'],
            }),
            expect.objectContaining({
                severity: 'error',
                params: { key: SIDE },
                entityIds: [SIDE],
            }),
        ]);
    });

    it('sets the grain', () => {
        const model = generate((d) => {
            d.overrides.parts[SIDE] = { grain: 'width' };
        });
        expect(partOf(model, SIDE).grain).toBe('width');
    });

    it('marks a part overridden for a note alone and changes nothing else', () => {
        const model = generate((d) => {
            d.overrides.parts[SIDE] = { note: 'drill on site' };
        });
        expect(partOf(model, SIDE)).toEqual({
            ...partOf(plain, SIDE),
            overridden: true,
        });
    });

    it('drops an override of a missing part with info override_orphaned', () => {
        const model = generate((d) => {
            d.overrides.parts['section.s_0000000009.shelf.1'] = {
                removed: true,
            };
        });
        expect(issuesOf(model, 'furniture.override_orphaned')).toMatchObject([
            {
                severity: 'info',
                params: { key: 'section.s_0000000009.shelf.1' },
                entityIds: ['section.s_0000000009.shelf.1'],
            },
        ]);
        expect(model.parts).toEqual(plain.parts);
    });

    it('lowers the weight estimate for a removed part (estimated after the overrides)', () => {
        const model = generate((d) => {
            d.overrides.parts[LEAF] = { removed: true };
        });
        // 144.41 - 606 x 1997 x 18 x 650 / 1e9 (14.16) = 130.25.
        expect(weightOf(model)).toBe(130.3);
    });
});

describe('part overrides: fallbacks and glass fronts', () => {
    it('falls back to the role default for an unknown override material', () => {
        // Carcass in PB18-OAK; the carcass default material is PB18-WHITE.
        const model = generate((d) => {
            d.materials.carcass = assign('PB18-OAK');
            d.overrides.parts[SIDE] = { materialCode: 'GONE' };
        });
        expect(partOf(model, SIDE)).toMatchObject({
            materialCode: 'PB18-WHITE',
            thickness: 18,
            overridden: true,
        });
        expect(partOf(model, 'carcass.side.right').materialCode).toBe(
            'PB18-OAK',
        );
    });

    const GLASS_LEAF = 'front.fr_0000000001.leaf.1';
    const glassDoor = (removed: string[]) =>
        generate((d) => {
            const front = d.carcass?.fronts[0];
            if (front) front.glass = true;
            for (const key of removed)
                d.overrides.parts[key] = { removed: true };
        });

    it('keeps a glass door front while some of its parts remain, on a remaining part', () => {
        const model = glassDoor([`${GLASS_LEAF}.stile.left`]);
        const front = model.fronts.find((f) => f.id === GLASS_LEAF);
        expect(front?.partKey).toBe(`${GLASS_LEAF}.glass`);
        expect(model.fronts).toHaveLength(3);
    });

    it('keeps the front on its own part when another frame part is removed', () => {
        const model = glassDoor([`${GLASS_LEAF}.rail.top`]);
        expect(model.fronts.find((f) => f.id === GLASS_LEAF)?.partKey).toBe(
            `${GLASS_LEAF}.stile.left`,
        );
    });

    it('drops a glass door front when all its parts are removed', () => {
        const model = glassDoor(
            [
                'glass',
                'rail.bottom',
                'rail.top',
                'stile.left',
                'stile.right',
            ].map((s) => `${GLASS_LEAF}.${s}`),
        );
        expect(model.fronts.map((f) => f.id)).toEqual([
            'front.fr_0000000002.leaf.1',
            'front.fr_0000000002.leaf.2',
        ]);
    });
});

describe('overrides and the generation steps', () => {
    it('generates the connectors before the overrides, so they can be overridden', () => {
        const model = generate((d) => {
            d.overrides.parts['carcass.top'] = { removed: true };
            d.overrides.hardware['carcass.connectors.cam'] = { qtyDelta: 2 };
        });
        // The removed member's joints still count: 16 + 2.
        expect(lineOf(model, 'carcass.connectors.cam')).toMatchObject({
            qty: 18,
            overridden: true,
        });
        expect(lineOf(model, 'carcass.connectors.dowel')?.qty).toBe(16);
        expect(issuesOf(model, 'furniture.override_orphaned')).toEqual([]);
    });

    it('applies overrides before adding extras: an override of an extra key is orphaned', () => {
        const model = generate((d) => {
            d.overrides.extraParts.push(extraPart());
            d.overrides.extraHardware.push({
                id: 'h_0000000001',
                code: 'LCK-CAM-20',
                qty: 1,
                note: null,
            });
            d.overrides.parts['extra.p_0000000001'] = { grain: 'width' };
            d.overrides.hardware['extra.h_0000000001'] = { qtyDelta: 5 };
        });
        expect(partOf(model, 'extra.p_0000000001')).toMatchObject({
            grain: 'length',
            overridden: false,
        });
        expect(lineOf(model, 'extra.h_0000000001')).toMatchObject({
            qty: 1,
            overridden: false,
        });
        expect(
            issuesOf(model, 'furniture.override_orphaned').map((i) => i.params),
        ).toEqual([
            { key: 'extra.p_0000000001' },
            { key: 'extra.h_0000000001' },
        ]);
    });

    it('reports no orphaned overrides when the envelope is too small, but still adds the extras', () => {
        const model = generate((d) => {
            d.dims.height = 150;
            d.overrides.parts['carcass.top'] = { removed: true };
            d.overrides.hardware['carcass.screws'] = { qtyDelta: 1 };
            d.overrides.extraParts.push(extraPart());
        });
        expect(issuesOf(model, 'furniture.envelope_too_small')).toHaveLength(1);
        expect(issuesOf(model, 'furniture.override_orphaned')).toEqual([]);
        expect(model.parts.map((p) => p.key)).toEqual(['extra.p_0000000001']);
    });

    it('reports no orphaned overrides for a carcass document without its carcass spec', () => {
        const model = generate((d) => {
            d.carcass = null;
            d.overrides.parts['carcass.top'] = { removed: true };
            d.overrides.hardware['carcass.screws'] = { qtyDelta: 1 };
            d.overrides.extraParts.push(extraPart());
        });
        expect(issuesOf(model, 'furniture.override_orphaned')).toEqual([]);
        expect(model.parts.map((p) => p.key)).toEqual(['extra.p_0000000001']);
    });

    it('reports no orphaned overrides for a table document without its table spec (carry 3)', () => {
        const doc = diningTable((d) => {
            d.overrides.parts['table.top'] = { grain: 'width' };
            d.overrides.hardware['table.screws'] = { qtyDelta: 1 };
            d.overrides.extraParts.push(extraPart());
        });
        const model = generateFurniture({ ...doc, table: null }, catalog);
        expect(issuesOf(model, 'furniture.override_orphaned')).toEqual([]);
        expect(model.parts.map((p) => p.key)).toEqual(['extra.p_0000000001']);
        // with its spec the same document reports a missing key
        doc.overrides.parts['table.nope'] = { removed: true };
        expect(
            issuesOf(
                generateFurniture(doc, catalog),
                'furniture.override_orphaned',
            ).map((i) => i.params),
        ).toEqual([{ key: 'table.nope' }]);
    });
});

describe('hardware overrides (07 §3.14 step 2)', () => {
    it('drops a line whose qtyDelta takes it to zero', () => {
        const model = generate((d) => {
            d.overrides.hardware[HINGES] = { qtyDelta: -4 };
        });
        expect(lineOf(model, HINGES)).toBeUndefined();
        expect(model.hardware).toHaveLength(13);
    });

    it('adds qtyDelta, replaces the code and marks the line overridden', () => {
        const model = generate((d) => {
            d.overrides.hardware[HINGES] = { qtyDelta: 2, code: 'HNG-HO-SC' };
        });
        expect(lineOf(model, HINGES)).toMatchObject({
            code: 'HNG-HO-SC',
            qty: 6,
            overridden: true,
            source: 'generated',
        });
    });

    it('removes a line', () => {
        const model = generate((d) => {
            d.overrides.hardware['carcass.anti_tip'] = { removed: true };
        });
        expect(lineOf(model, 'carcass.anti_tip')).toBeUndefined();
    });

    it('drops an override of a missing line with info override_orphaned', () => {
        const model = generate((d) => {
            d.overrides.hardware['plinth.legs'] = { qtyDelta: 2 };
        });
        expect(issuesOf(model, 'furniture.override_orphaned')).toMatchObject([
            { params: { key: 'plinth.legs' }, entityIds: ['plinth.legs'] },
        ]);
        expect(model.hardware).toEqual(plain.hardware);
    });
});

describe('extra parts (07 §3.14 step 3)', () => {
    it('adds an extra part with its own key, name, size, edges, grain and quantity', () => {
        const model = generate((d) => {
            d.overrides.extraParts.push(extraPart());
        });
        expect(partOf(model, 'extra.p_0000000001')).toEqual({
            key: 'extra.p_0000000001',
            nameKey: 'parts.extra',
            nameParams: { name: 'Filler' },
            role: 'front',
            materialCode: 'PB18-OAK',
            thickness: 18,
            length: 700,
            width: 60,
            grain: 'length',
            edges: { L1: B, L2: null, W1: null, W2: null },
            qty: 2,
            geometry: {
                kind: 'box',
                box: { min: [0, 0, 0], size: [0, 0, 0] },
            },
            operations: {
                hingeCups: 0,
                shelfPinHoles: 0,
                slideScrewSets: 0,
                handleHoles: 0,
                dowels: 0,
                camLocks: 0,
            },
            visibleFaces: 2,
            source: 'extra',
            overridden: false,
        });
    });

    it.each([
        ['front', 2],
        ['carcass', 1],
        ['top', 1],
        ['plinth', 1],
        ['leg', 1],
        ['shelf', 0],
        ['back', 0],
        ['drawer_box', 0],
    ] as const)('gives a %s extra part %d visible faces', (role, faces) => {
        const model = generate((d) => {
            d.overrides.extraParts.push(extraPart({ role }));
        });
        expect(partOf(model, 'extra.p_0000000001').visibleFaces).toBe(faces);
    });

    it('places an extra part at its placement box', () => {
        const placement = {
            min: [1800, 100, 0] as [number, number, number],
            size: [18, 1997, 60] as [number, number, number],
        };
        const model = generate((d) => {
            d.overrides.extraParts.push(extraPart({ placement }));
        });
        expect(partOf(model, 'extra.p_0000000001').geometry).toEqual({
            kind: 'box',
            box: placement,
        });
    });

    it('falls back to the role default for an unknown extra part material', () => {
        const model = generate((d) => {
            d.overrides.extraParts.push(extraPart({ materialCode: 'GONE' }));
        });
        expect(partOf(model, 'extra.p_0000000001')).toMatchObject({
            materialCode: 'PB18-WHITE',
            thickness: 18,
        });
    });

    it('sorts extra parts in among the generated ones by key', () => {
        const model = generate((d) => {
            d.overrides.extraParts.push(extraPart());
        });
        const keys = model.parts.map((p) => p.key);
        expect(keys).toEqual([...keys].sort());
        expect(keys.indexOf('extra.p_0000000001')).toBe(6);
    });

    it('counts screw packs before the overrides', () => {
        const model = generate((d) => {
            d.overrides.extraParts.push(extraPart({ qty: 99 }));
        });
        expect(lineOf(model, 'carcass.screws')?.qty).toBe(1);
    });
});

describe('extra hardware (07 §3.14 step 4)', () => {
    it('adds an extra hardware line', () => {
        const extra: ExtraHardware = {
            id: 'h_0000000001',
            code: 'LCK-CAM-20',
            qty: 1,
            note: null,
        };
        const model = generate((d) => {
            d.overrides.extraHardware.push(extra);
        });
        expect(lineOf(model, 'extra.h_0000000001')).toEqual({
            key: 'extra.h_0000000001',
            code: 'LCK-CAM-20',
            qty: 1,
            reasonKey: 'hardware.reason.extra',
            reasonParams: {},
            frontId: null,
            sectionId: null,
            source: 'extra',
            overridden: false,
        });
        const keys = model.hardware.map((h) => h.key);
        expect(keys).toEqual([...keys].sort());
    });
});
