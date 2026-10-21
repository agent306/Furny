import { describe, expect, it } from 'vitest';
import { mutateCatalog, seedCatalog } from '../../../testing/seedCatalog';
import { indexCatalog } from '../../catalogIndex';
import { createGenContext } from '../../context';
import { makePart } from '../../parts';
import type { Part } from '../../types';
import { BOX_ROOT_ID, boxDocument, frontOn } from '../../testing/docs';
import {
    flapMechanism,
    handleCodeFor,
    hingeCount,
    hingeRoleKey,
} from '../hardware';
import { leafWeightKg, partWeightKg } from '../weight';

const catalog = seedCatalog();
const idx = indexCatalog(catalog);

describe('hingeCount (07 §6.2, §12.4)', () => {
    it.each([
        [900, 5, 2],
        [901, 5, 3],
        [1600, 11, 3],
        [1997, 14.16, 4],
        [2100, 10, 5],
        [800, 13, 4],
        [500, 25, 5],
        [2000, 6, 4],
        [500, 6, 2],
        [500, 6.01, 3],
        [500, 12, 3],
        [500, 17, 4],
        [500, 17.01, 5],
    ])('hingeCount(%d, %d) = %d', (length, kg, expected) => {
        expect(hingeCount(length, kg)).toBe(expected);
    });
});

describe('hingeRoleKey (07 §6.2)', () => {
    it.each([
        ['full', 'outer', 'hinge.full_overlay'],
        ['full', 'divider_open', 'hinge.full_overlay'],
        ['full', 'shared', 'hinge.half_overlay'],
        ['half', 'outer', 'hinge.half_overlay'],
        ['half', 'divider_open', 'hinge.half_overlay'],
        ['half', 'shared', 'hinge.half_overlay'],
        ['inset', 'outer', 'hinge.inset'],
        ['inset', 'divider_open', 'hinge.inset'],
        ['inset', 'shared', 'hinge.inset'],
    ] as const)('%s on a %s edge -> %s', (overlay, cls, roleKey) => {
        expect(hingeRoleKey(overlay, cls)).toBe(roleKey);
    });
});

describe('handleCodeFor (07 §6.4)', () => {
    const ctxWith = (handleCode: string | null) =>
        createGenContext(
            boxDocument({
                width: 600,
                height: 720,
                depth: 560,
                fronts: [
                    frontOn('fr_0000000001', [BOX_ROOT_ID], { handleCode }),
                ],
            }),
            catalog,
        );

    it('resolves inherit to the carcass handle', () => {
        const ctx = ctxWith('inherit');
        const front = ctx.doc.carcass?.fronts[0];
        expect(front && handleCodeFor(ctx, front)).toBe('HDL-BAR-160');
    });

    it('keeps an explicit code and null', () => {
        for (const code of ['KNB-ROUND-30', null]) {
            const ctx = ctxWith(code);
            const front = ctx.doc.carcass?.fronts[0];
            expect(front && handleCodeFor(ctx, front)).toBe(code);
        }
    });

    it('inherits null from carcass handles', () => {
        const ctx = ctxWith('inherit');
        if (ctx.doc.carcass) ctx.doc.carcass.handles.code = null;
        const front = ctx.doc.carcass?.fronts[0];
        expect(front && handleCodeFor(ctx, front)).toBeNull();
    });
});

describe('flapMechanism (07 §6.3)', () => {
    const run = (
        kind: 'flap_up' | 'flap_down',
        width: number,
        snapshot = catalog,
    ) => {
        const ctx = createGenContext(
            boxDocument({ width: 600, height: 720, depth: 560 }),
            snapshot,
        );
        const front = frontOn('fr_0000000001', [BOX_ROOT_ID], { kind });
        flapMechanism(ctx, front, width);
        return ctx;
    };

    it.each([
        ['flap_up', 600, 'front.fr_0000000001.gas_struts', 'GAS-80N', 1],
        ['flap_up', 601, 'front.fr_0000000001.gas_struts', 'GAS-80N', 2],
        ['flap_down', 600, 'front.fr_0000000001.stays', 'LFT-STAY-SC', 1],
        ['flap_down', 900, 'front.fr_0000000001.stays', 'LFT-STAY-SC', 2],
    ] as const)('%s %d wide -> %s %s x %d', (kind, width, key, code, qty) => {
        expect(run(kind, width).hardware).toMatchObject([
            { key, code, qty, frontId: 'fr_0000000001', sectionId: null },
        ]);
    });

    it('warns no_default_hardware when the catalog has no gas strut', () => {
        const none = mutateCatalog(catalog, (draft) => {
            draft.hardware = draft.hardware.filter(
                (h) => h.category !== 'gas_strut',
            );
        });
        const ctx = run('flap_up', 900, none);
        expect(ctx.hardware).toEqual([]);
        expect(ctx.issues).toMatchObject([
            {
                code: 'furniture.no_default_hardware',
                severity: 'warning',
                params: { roleKey: 'gas_strut.default' },
            },
        ]);
    });
});

describe('partWeightKg / leafWeightKg (07 §6.1)', () => {
    const ctx = createGenContext(
        boxDocument({ width: 600, height: 720, depth: 560 }),
        catalog,
    );
    const panel = (materialCode: string, w: number, h: number): Part =>
        makePart(
            {
                key: `p.${materialCode}`,
                nameKey: 'parts.door',
                role: 'front',
                materialCode,
                box: { min: [0, 0, 0], size: [w, h, 18] },
                thicknessAxis: 'z',
                grainAxis: 'y',
                banded: [],
                visibleFaces: 2,
            },
            ctx,
        );

    it('multiplies the finished size by the material density', () => {
        // 07 §12.2 door weights: 606 x 1997 and 593 x 1997 at 18 mm, 650 kg/m3.
        expect(partWeightKg(panel('PB18-WHITE', 606.5, 1997), idx)).toBeCloseTo(
            (606 * 1997 * 18 * 650) / 1e9,
            9,
        );
        expect(partWeightKg(panel('PB18-WHITE', 606.5, 1997), idx)).toBeCloseTo(
            14.16,
            2,
        );
        expect(
            partWeightKg(panel('PB18-WHITE', 593.25, 1997), idx),
        ).toBeCloseTo(13.86, 2);
    });

    it('falls back to the board-type default density', () => {
        const noDensity = mutateCatalog(catalog, (draft) => {
            for (const m of draft.materials) {
                if (m.code === 'MDF18-RAW') m.densityKgM3 = null;
            }
        });
        const part = panel('MDF18-RAW', 1000, 1000);
        expect(partWeightKg(part, indexCatalog(noDensity))).toBeCloseTo(
            0.018 * 750,
            9,
        );
    });

    it('weighs nothing for an unknown material code', () => {
        const part = { ...panel('PB18-WHITE', 1000, 1000), materialCode: 'X' };
        expect(partWeightKg(part, idx)).toBe(0);
    });

    it('sums the parts of a leaf, times their qty', () => {
        const a = panel('PB18-WHITE', 1000, 1000);
        const b = { ...panel('PLY18-BWR', 1000, 500), qty: 3 };
        expect(leafWeightKg([a, b], idx)).toBeCloseTo(
            0.018 * 650 + 3 * 0.009 * 600,
            9,
        );
        expect(leafWeightKg([], idx)).toBe(0);
    });
});
