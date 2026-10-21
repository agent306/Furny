import { describe, expect, it } from 'vitest';
import { generateFurniture } from '../../furniture/generate';
import { wardrobeFixture } from '../../furniture/testing/docs';
import { seedCatalog } from '../../testing/seedCatalog';
import { bomOptionsFor, computeBom } from '../bom';
import { displayUnitPrice, LABOUR_KEYS_ORDER, priceBom } from '../pricing';

/** 08 §4.7 / §10.2: the wardrobe fixture against the seed catalog. */
const catalog = seedCatalog();
const doc = wardrobeFixture();
const model = generateFurniture(doc, catalog);
const nestedBom = computeBom(model, catalog, bomOptionsFor(doc, true));
const price = priceBom(nestedBom, catalog, catalog.pricing, {
    quantity: 1,
    includeInstallation: true,
});

type Row = [kind: string, code: string, quantity: number, cost: number];
const rows = (): Row[] =>
    price.lines.map((l) => [l.kind, l.code, l.quantity, l.costMinor]);

describe('priceBom: wardrobe (08 §4.7)', () => {
    it('prices the material lines', () => {
        expect(price.lines.slice(0, 2)).toEqual([
            {
                kind: 'material',
                code: 'HDF3-WHITE',
                description: 'HDF 3 mm White (one side) (3 mm)',
                quantity: 1.3,
                unit: 'sheet',
                unitCostMinor: 65000,
                costMinor: 84500,
            },
            {
                kind: 'material',
                code: 'PB18-WHITE',
                description: 'PB 18 mm Frosty White (18 mm)',
                quantity: 4.27,
                unit: 'sheet',
                unitCostMinor: 215000,
                costMinor: 918050,
            },
        ]);
    });

    it('prices edge band and hardware per code', () => {
        expect(rows().slice(2, 14)).toEqual([
            ['edge_band', 'EB08-WHITE', 32.77, 19662],
            ['hardware', 'BRK-ANTITIP', 1, 6000],
            ['hardware', 'CON-CAM-15', 16, 14400],
            ['hardware', 'CON-DOWEL-8', 16, 1600],
            ['hardware', 'HDL-BAR-160', 3, 54000],
            ['hardware', 'HNG-FO-SC', 8, 96000],
            ['hardware', 'HNG-HO-SC', 4, 50000],
            ['hardware', 'HNG-PLATE-0', 12, 30000],
            ['hardware', 'ROD-OVAL-1200', 1, 22000],
            ['hardware', 'ROD-SUP', 2, 6000],
            ['hardware', 'SCR-PACK', 1, 12000],
            ['hardware', 'SHF-PIN-5', 16, 6400],
        ]);
    });

    it('prices the labour lines in the order of 08 §4.3', () => {
        expect(rows().slice(14)).toEqual([
            ['labour', 'cutting_per_sheet', 5.57, 83550],
            ['labour', 'edge_banding_per_meter', 32.77, 39324],
            ['labour', 'hinge_cup_boring_each', 12, 12000],
            ['labour', 'drilling_per_hole', 302, 30200],
            ['labour', 'assembly_per_part', 20, 80000],
            ['labour', 'hinge_install_each', 12, 24000],
            ['labour', 'hardware_fitting_each', 7, 17500],
            ['labour', 'packing_per_item', 1, 30000],
        ]);
        const cutting = price.lines.find((l) => l.code === 'cutting_per_sheet');
        expect(cutting).toMatchObject({
            description: 'Panel cutting',
            unit: 'sheet',
            unitCostMinor: 15000,
        });
    });

    it('exposes the labour key order of the spec table', () => {
        expect(LABOUR_KEYS_ORDER).toHaveLength(14);
        expect(LABOUR_KEYS_ORDER[0]).toBe('cutting_per_sheet');
        expect(LABOUR_KEYS_ORDER[11]).toBe('packing_per_item');
    });

    it('has the totals of 08 §4.7', () => {
        expect(price).toMatchObject({
            materialCostMinor: 1002550,
            edgeBandCostMinor: 19662,
            hardwareCostMinor: 298400,
            finishingCostMinor: 0,
            labourCostMinor: 316574,
            directCostMinor: 1637186,
            overheadMinor: 163719,
            marginMinor: 630317,
            unitPriceMinor: 2431300,
            installationMinor: 194600,
            quantity: 1,
            totalBeforeTaxMinor: 2625900,
            currency: 'INR',
        });
    });

    it('orders lines materials, edge bands, hardware, finishing, labour with no zero quantities', () => {
        const order = [
            'material',
            'edge_band',
            'hardware',
            'finishing',
            'labour',
        ];
        const kinds = price.lines.map((l) => order.indexOf(l.kind));
        expect(kinds).toEqual([...kinds].sort((a, b) => a - b));
        expect(price.lines.every((l) => l.quantity > 0)).toBe(true);
    });

    it('multiplies the total by the quantity', () => {
        const three = priceBom(nestedBom, catalog, catalog.pricing, {
            quantity: 3,
            includeInstallation: true,
        });
        expect(three.totalBeforeTaxMinor).toBe(3 * 2625900);
        expect(three.unitPriceMinor).toBe(2431300);
    });

    it('omits installation when not requested', () => {
        const p = priceBom(nestedBom, catalog, catalog.pricing, {
            quantity: 1,
            includeInstallation: false,
        });
        expect(p.installationMinor).toBe(0);
        expect(p.totalBeforeTaxMinor).toBe(2431300);
    });
});

describe('priceBom: whole_sheets (08 §4.7)', () => {
    it('bills the nested sheets', () => {
        const pricing = {
            ...catalog.pricing,
            sheetBillingMode: 'whole_sheets' as const,
        };
        const p = priceBom(nestedBom, catalog, pricing, {
            quantity: 1,
            includeInstallation: true,
        });
        expect(p).toMatchObject({
            materialCostMinor: 1205000,
            directCostMinor: 1861086,
            overheadMinor: 186109,
            marginMinor: 716518,
            unitPriceMinor: 2763800,
        });
        expect(
            p.lines.find((l) => l.code === 'cutting_per_sheet')?.costMinor,
        ).toBe(105000);
    });
});

describe('displayUnitPrice (08 §4.6)', () => {
    it('grosses up and rounds when prices include tax', () => {
        const pricing = { ...catalog.pricing, pricesIncludeTax: true };
        expect(displayUnitPrice(2431300, pricing, catalog.taxRates)).toBe(
            2869000,
        );
    });

    it('returns the amount unchanged when prices exclude tax', () => {
        expect(
            displayUnitPrice(2431300, catalog.pricing, catalog.taxRates),
        ).toBe(2431300);
    });

    it('treats a missing default tax rate as 0 %', () => {
        const pricing = {
            ...catalog.pricing,
            pricesIncludeTax: true,
            defaultTaxRateId: null,
        };
        expect(displayUnitPrice(2431300, pricing, catalog.taxRates)).toBe(
            2431300,
        );
    });
});
