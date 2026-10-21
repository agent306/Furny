import { describe, expect, it } from 'vitest';
import { EngineInputError } from '../../errors';
import { mutateCatalog, seedCatalog } from '../../testing/seedCatalog';
import { indexCatalog } from '../catalogIndex';
import { createGenContext } from '../context';
import { migrateFurniture } from '../migrate';
import type { FurnitureDocument } from '../schema';

function doc(
    over: Partial<Record<string, string | null>> = {},
): FurnitureDocument {
    const mat = (code: string, band: string | null = null) => ({
        materialCode: code,
        edgeBandCode: band,
        finishCode: null,
    });
    return migrateFurniture({
        schemaVersion: 1,
        templateKey: 'custom_box',
        family: 'carcass',
        dims: { width: 600, height: 720, depth: 560 },
        materials: {
            carcass: mat(over.carcass ?? 'PB18-WHITE', over.band ?? null),
            back: mat('HDF3-WHITE'),
            shelf: mat('PB18-WHITE'),
            front: mat('PB18-WHITE'),
            top: mat('PB18-WHITE'),
            drawer_box: mat('PLY12-BWR'),
            drawer_bottom: mat('HDF3-WHITE'),
            plinth: mat('PB18-WHITE'),
            leg: mat('SW50-RUBBER'),
        },
        carcass: null,
        table: null,
        overrides: {
            parts: {},
            extraParts: [],
            hardware: {},
            extraHardware: [],
        },
        notes: null,
    });
}

describe('createGenContext', () => {
    it('starts empty and indexes the snapshot (or takes an index)', () => {
        const snap = seedCatalog();
        const ctx = createGenContext(doc(), snap);
        expect(ctx.idx).toBe(indexCatalog(snap));
        expect(ctx.parts).toEqual([]);
        expect(ctx.hardware).toEqual([]);
        expect(ctx.fronts).toEqual([]);
        expect(ctx.sections).toEqual([]);
        expect(ctx.issues).toEqual([]);
        expect(ctx.joints).toEqual([]);
        expect(ctx.edgeMap.size).toBe(0);
        expect(createGenContext(doc(), indexCatalog(snap)).idx).toBe(ctx.idx);
    });

    it('mat and t resolve the assigned material, or the role default for an unknown code', () => {
        const snap = seedCatalog();
        expect(createGenContext(doc(), snap).mat('back').code).toBe(
            'HDF3-WHITE',
        );
        expect(createGenContext(doc(), snap).t('back')).toBe(3);
        expect(createGenContext(doc(), snap).t('carcass')).toBe(18);
        const unknown = createGenContext(doc({ carcass: 'NOPE' }), snap);
        expect(unknown.mat('carcass').code).toBe('PB18-WHITE');
        expect(unknown.t('carcass')).toBe(18);
    });

    it('t rounds the thickness', () => {
        const snap = mutateCatalog(seedCatalog(), (d) => {
            const m = d.materials.find((x) => x.code === 'PB18-WHITE');
            if (m) m.thicknessMm = 15.5;
        });
        expect(createGenContext(doc(), snap).t('carcass')).toBe(16);
    });

    it('mat throws EngineInputError when the catalog has no material', () => {
        const snap = mutateCatalog(seedCatalog(), (d) => {
            d.materials = [];
        });
        const ctx = createGenContext(doc(), snap);
        expect(() => ctx.mat('carcass')).toThrow(EngineInputError);
    });

    it('roleBand prefers the document band, then the material default, then null', () => {
        const snap = seedCatalog();
        expect(
            createGenContext(doc({ band: 'EB2-OAK' }), snap).roleBand(
                'carcass',
            ),
        ).toBe('EB2-OAK');
        expect(createGenContext(doc(), snap).roleBand('carcass')).toBe(
            'EB08-WHITE',
        );
        const noDefault = mutateCatalog(snap, (d) => {
            for (const m of d.materials) m.defaultEdgeBandCode = null;
        });
        expect(
            createGenContext(doc(), noDefault).roleBand('carcass'),
        ).toBeNull();
    });

    it('issue records and returns an issue with a derived messageKey', () => {
        const ctx = createGenContext(doc(), seedCatalog());
        const issue = ctx.issue('furniture.shelf_sag', 'warning', { kg: 3 }, [
            's_1',
        ]);
        expect(issue).toEqual({
            code: 'furniture.shelf_sag',
            severity: 'warning',
            messageKey: 'engine.furniture.issue.shelf_sag',
            params: { kg: 3 },
            entityIds: ['s_1'],
        });
        expect(ctx.issues).toEqual([issue]);
        expect(ctx.issue('furniture.back_split', 'info')).toMatchObject({
            params: {},
            entityIds: [],
        });
    });

    it('addHardware appends lines', () => {
        const ctx = createGenContext(doc(), seedCatalog());
        const line = {
            key: 'carcass.screws',
            code: 'SCR-PACK',
            qty: 1,
            reasonKey: 'hardware.reason.screws',
            reasonParams: {},
            frontId: null,
            sectionId: null,
            source: 'generated' as const,
            overridden: false,
        };
        ctx.addHardware(line);
        expect(ctx.hardware).toEqual([line]);
    });
});
