import { describe, expect, it } from 'vitest';
import type { CatalogSnapshot, LabourKey } from '../../catalog/snapshot';
import { mutateCatalog, seedCatalog } from '../../testing/seedCatalog';
import { priceBom } from '../pricing';
import type { Bom, BomMaterial, CutListRow } from '../types';

/** 08 §4.3 / §10.5: every labour quantity rule against a minimal BOM. */
const catalog = seedCatalog();
const options = { quantity: 1, includeInstallation: false };

const emptyBom = (over: Partial<Bom> = {}): Bom => ({
    engineVersion: '1.0.0',
    catalogVersion: 1,
    cutList: [],
    materials: [],
    edgeBanding: [],
    hardware: [],
    finishing: [],
    operations: {
        hingeCups: 0,
        shelfPinHoles: 0,
        dowels: 0,
        camLocks: 0,
        slideScrewSets: 0,
        handleHoles: 0,
    },
    nesting: null,
    issues: [],
    ...over,
});

const row = (
    materialCode: string,
    partKeys: string[],
    qty = partKeys.length,
): CutListRow => ({
    rowKey: `r-${partKeys.join('+')}`,
    partKeys,
    name: 'x',
    nameKey: 'parts.extra',
    nameParams: {},
    materialCode,
    thickness: 18,
    length: 500,
    width: 300,
    cutLength: 500,
    cutWidth: 300,
    qty,
    grain: 'none',
    edges: { L1: null, L2: null, W1: null, W2: null },
});

const material = (
    materialCode: string,
    netAreaMm2: number,
    sheetsBilled = 1,
): BomMaterial => ({
    materialCode,
    partCount: 1,
    netAreaMm2,
    sheetsEstimated: sheetsBilled,
    sheetsNested: null,
    sheetsBilled,
    utilization: null,
});

const labour = (bom: Bom, c: CatalogSnapshot = catalog, o = options) =>
    priceBom(bom, c, c.pricing, o)
        .lines.filter((l) => l.kind === 'labour')
        .map((l) => [l.code, l.quantity, l.costMinor] as const);

const only = (bom: Bom, key: LabourKey, c: CatalogSnapshot = catalog) =>
    labour(bom, c).find(([code]) => code === key);

describe('priceBom labour rules (08 §4.3)', () => {
    it('adds only packing to an empty BOM', () => {
        expect(labour(emptyBom())).toEqual([['packing_per_item', 1, 30000]]);
    });

    it('assembly_per_part excludes drawer instances and glass rows', () => {
        const bom = emptyBom({
            cutList: [
                row('PB18-WHITE', ['carcass.side.left', 'carcass.side.right']),
                row('PB18-WHITE', [
                    'table.drawer.1.side.left',
                    'table.drawer.1.side.right',
                ]),
                row('GLASS5-CLEAR', ['front.fr_1.leaf.1.glass']),
            ],
        });
        expect(only(bom, 'assembly_per_part')).toEqual([
            'assembly_per_part',
            2,
            8000,
        ]);
    });

    it('assembly_per_part counts only the non-drawer keys of a mixed row', () => {
        const bom = emptyBom({
            cutList: [
                row('PB18-WHITE', [
                    'shelf.1',
                    'x.drawer.1.back',
                    'shelf.2',
                    'x.drawer.2.back',
                ]),
            ],
        });
        expect(only(bom, 'assembly_per_part')?.[1]).toBe(2);
    });

    it('drawer_assembly_each counts the left side keys', () => {
        const bom = emptyBom({
            cutList: [
                row('PB18-WHITE', [
                    'a.drawer.1.side.left',
                    'a.drawer.1.side.right',
                    'a.drawer.2.side.left',
                    'a.drawer.2.side.right',
                    'b.drawer.10.side.left',
                    'carcass.side.left',
                ]),
            ],
        });
        expect(only(bom, 'drawer_assembly_each')).toEqual([
            'drawer_assembly_each',
            3,
            75000,
        ]);
    });

    it('hinge_install_each counts hinges only, not plates', () => {
        const bom = emptyBom({
            hardware: [
                { code: 'HNG-FO-SC', qty: 8 },
                { code: 'HNG-HO-SC', qty: 4 },
                { code: 'HNG-PLATE-0', qty: 12 },
            ],
        });
        expect(only(bom, 'hinge_install_each')).toEqual([
            'hinge_install_each',
            12,
            24000,
        ]);
    });

    it('hardware_fitting_each counts the listed categories', () => {
        const bom = emptyBom({
            hardware: [
                { code: 'HDL-BAR-160', qty: 3 }, // handle
                { code: 'KNB-ROUND-30', qty: 1 }, // knob
                { code: 'ROD-OVAL-1200', qty: 1 }, // hanging_rod
                { code: 'ROD-SUP', qty: 2 }, // rod_support
                { code: 'LCK-CAM-20', qty: 1 }, // lock
                { code: 'LFT-STAY-SC', qty: 1 }, // lift_mechanism
                { code: 'GAS-80N', qty: 1 }, // gas_strut
                { code: 'DMP-PUSH', qty: 1 }, // damper
                { code: 'LEG-CAB-ADJ', qty: 4 }, // leg
                { code: 'LEG-PLINTH-100', qty: 4 }, // plinth_leg
                { code: 'BRK-ANTITIP', qty: 1 }, // wall_bracket
                { code: 'BSK-PULL-600', qty: 1 }, // other
                // not counted
                { code: 'SHF-PIN-5', qty: 16 },
                { code: 'CON-CAM-15', qty: 16 },
                { code: 'SCR-PACK', qty: 1 },
                { code: 'SLD-BB-400', qty: 2 },
                { code: 'LED-STRIP-12V', qty: 2 },
                { code: 'ROL-SLD-SET', qty: 2 },
                { code: 'HNG-PLATE-0', qty: 4 },
            ],
        });
        expect(only(bom, 'hardware_fitting_each')?.[1]).toBe(21);
    });

    it('sliding_door_fitting_each sums sliding rollers', () => {
        const bom = emptyBom({ hardware: [{ code: 'ROL-SLD-SET', qty: 3 }] });
        expect(only(bom, 'sliding_door_fitting_each')).toEqual([
            'sliding_door_fitting_each',
            3,
            120000,
        ]);
    });

    it('glass_fitting_each sums the quantities of glass rows', () => {
        const bom = emptyBom({
            cutList: [
                row('GLASS5-CLEAR', ['g.1', 'g.2'], 2),
                row('GLASS5-CLEAR', ['g.3'], 1),
                row('PB18-WHITE', ['p.1'], 1),
            ],
        });
        expect(only(bom, 'glass_fitting_each')).toEqual([
            'glass_fitting_each',
            3,
            60000,
        ]);
    });

    it('finishing_per_sqm sums the finishing line quantities', () => {
        const bom = emptyBom({
            finishing: [
                { finishCode: 'FIN-DUCO', areaMm2: 1_500_000 },
                { finishCode: 'FIN-PU-MATT', areaMm2: 500_001 },
            ],
        });
        const { lines } = priceBom(bom, catalog, catalog.pricing, options);
        expect(
            lines
                .filter((l) => l.kind === 'finishing')
                .map((l) => [l.code, l.quantity, l.costMinor]),
        ).toEqual([
            ['FIN-DUCO', 1.5, 135000],
            ['FIN-PU-MATT', 0.51, 56100],
        ]);
        // 1.50 + 0.51 sqm at 20 000
        expect(lines.find((l) => l.code === 'finishing_per_sqm')).toMatchObject(
            {
                quantity: 2.01,
                unit: 'sqm',
                costMinor: 40200,
            },
        );
    });

    it('never produces installation_per_item or general_per_hour lines', () => {
        const bom = emptyBom({ hardware: [{ code: 'HNG-FO-SC', qty: 2 }] });
        const codes = labour(bom, catalog, {
            quantity: 1,
            includeInstallation: true,
        }).map(([c]) => c);
        expect(codes).not.toContain('installation_per_item');
        expect(codes).not.toContain('general_per_hour');
    });

    it('skips a labour key whose rate is inactive', () => {
        const c = mutateCatalog(catalog, (d) => {
            d.labourRates.find((r) => r.key === 'packing_per_item')!.isActive =
                false;
        });
        expect(labour(emptyBom(), c)).toEqual([]);
    });
});

describe('priceBom glass and billing (08 §4.1)', () => {
    const glassBom = emptyBom({
        cutList: [row('GLASS5-CLEAR', ['g.1'])],
        materials: [material('GLASS5-CLEAR', 1_000_000, 9)],
    });
    const pbBom = emptyBom({
        materials: [material('PB18-WHITE', 1_000_000, 9)],
    });
    const whole = {
        ...catalog.pricing,
        sheetBillingMode: 'whole_sheets' as const,
    };

    it('prices glass by area even in whole_sheets and keeps it out of cutting', () => {
        const p = priceBom(glassBom, catalog, whole, options);
        const glass = catalog.materials.find((m) => m.code === 'GLASS5-CLEAR')!;
        const sheetArea = glass.sheetLengthMm * glass.sheetWidthMm;
        const waste = Math.round(glass.wasteFactor * 1000);
        const qtyH = Math.ceil(
            (1_000_000 * (1000 + waste) * 100) / (sheetArea * 1000),
        );
        expect(p.lines[0]).toMatchObject({
            kind: 'material',
            code: 'GLASS5-CLEAR',
            quantity: qtyH / 100,
        });
        expect(p.lines.some((l) => l.code === 'cutting_per_sheet')).toBe(false);
    });

    it('bills sheetsBilled for non-glass in whole_sheets', () => {
        const p = priceBom(pbBom, catalog, whole, options);
        expect(p.lines[0]).toMatchObject({
            quantity: 9,
            costMinor: 9 * 215000,
        });
        expect(
            p.lines.find((l) => l.code === 'cutting_per_sheet'),
        ).toMatchObject({ quantity: 9, costMinor: 9 * 15000 });
    });
});

describe('priceBom installation and rounding (08 §4.4, §4.5)', () => {
    // unit price 100 000 -> 8 % = 8 000, below the 150 000 minimum charge
    const pricing = {
        ...catalog.pricing,
        overheadBps: 0,
        marginBps: 0,
        installationBps: 800,
    };
    const bom = emptyBom({ hardware: [{ code: 'SCR-PACK', qty: 1 }] });
    const base = mutateCatalog(catalog, (d) => {
        d.labourRates.find((r) => r.key === 'packing_per_item')!.isActive =
            false;
        d.hardware.find((h) => h.code === 'SCR-PACK')!.priceMinor = 100000;
    });

    it('applies the minimum installation charge', () => {
        const p = priceBom(bom, base, pricing, {
            quantity: 1,
            includeInstallation: true,
        });
        expect(p.unitPriceMinor).toBe(100000);
        expect(p.installationMinor).toBe(150000);
        expect(p.totalBeforeTaxMinor).toBe(250000);
    });

    it('uses a zero minimum without an installation_per_item rate', () => {
        const c = mutateCatalog(base, (d) => {
            d.labourRates.find(
                (r) => r.key === 'installation_per_item',
            )!.isActive = false;
        });
        const p = priceBom(bom, c, pricing, {
            quantity: 1,
            includeInstallation: true,
        });
        expect(p.installationMinor).toBe(8000);
    });

    it.each([0, 1])(
        'does not round up with roundingMinor %i',
        (roundingMinor) => {
            const p = priceBom(
                bom,
                base,
                { ...pricing, roundingMinor, marginBps: 3333 },
                { quantity: 1, includeInstallation: false },
            );
            expect(p.marginMinor).toBe(33330);
            expect(p.unitPriceMinor).toBe(133330);
        },
    );
});
