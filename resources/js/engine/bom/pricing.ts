/**
 * `priceBom` (08 §4): the price of a BOM from catalog prices, labour rates,
 * overhead, margin and rounding. Pure and deterministic; money is integer
 * minor units, every product runs through the `money.ts` BigInt helpers.
 */
import {
    LABOUR_KEYS,
    type CatalogSnapshot,
    type CatalogTaxRate,
    type HardwareCategory,
    type LabourKey,
    type PricingSettings,
} from '../catalog/snapshot';
import { cmpId } from '../compare';
import { indexCatalog } from '../furniture/catalogIndex';
import {
    applyBps,
    ceilDiv,
    ceilDivBig,
    costFromHundredths,
    grossUp,
    product,
    roundUpToStep,
    toSafeNumber,
} from '../money';
import type { Bom } from './types';

export interface PriceOptions {
    quantity: number;
    includeInstallation: boolean;
}

export interface PriceLine {
    kind: 'material' | 'edge_band' | 'hardware' | 'finishing' | 'labour';
    /** Material / edge band / hardware / finish code, or the labour key. */
    code: string;
    /** English, for exports (08 §4). */
    description: string;
    quantity: number;
    unit: string;
    unitCostMinor: number;
    costMinor: number;
}

/** 03 §3.3: all amounts excluding tax. */
export interface PriceBreakdown {
    currency: string;
    lines: PriceLine[];
    materialCostMinor: number;
    edgeBandCostMinor: number;
    hardwareCostMinor: number;
    finishingCostMinor: number;
    labourCostMinor: number;
    directCostMinor: number;
    overheadMinor: number;
    marginMinor: number;
    unitPriceMinor: number;
    installationMinor: number;
    quantity: number;
    totalBeforeTaxMinor: number;
}

/** The labour keys in the table order of 08 §4.3. */
export const LABOUR_KEYS_ORDER: readonly LabourKey[] = LABOUR_KEYS;

const DRAWER_KEY = /\.drawer\.\d+\./;
const DRAWER_LEFT_SIDE_KEY = /\.drawer\.\d+\.side\.left$/;

/** 08 §4.3 #8. */
const FITTING_CATEGORIES: ReadonlySet<HardwareCategory> = new Set([
    'handle',
    'knob',
    'hanging_rod',
    'rod_support',
    'lock',
    'lift_mechanism',
    'gas_strut',
    'damper',
    'leg',
    'plinth_leg',
    'wall_bracket',
    'other',
]);

const sum = (values: Iterable<number>): number => {
    let total = 0;
    for (const v of values) total += v;
    return total;
};

/** 08 §4.1: the billed quantity of a material in hundredths of a sheet. */
function sheetHundredths(
    netAreaMm2: number,
    sheetsBilled: number,
    sheetLengthMm: number,
    sheetWidthMm: number,
    wasteFactor: number,
    areaBilled: boolean,
): number {
    if (!areaBilled) return sheetsBilled * 100;
    return ceilDivBig(
        product(netAreaMm2, 1000 + Math.round(wasteFactor * 1000), 100),
        product(sheetLengthMm, sheetWidthMm, 1000),
    );
}

/** The price of `bom` (08 §4). `pricing` is normally `catalog.pricing`. */
export function priceBom(
    bom: Bom,
    catalog: CatalogSnapshot,
    pricing: PricingSettings,
    options: PriceOptions,
): PriceBreakdown {
    const idx = indexCatalog(catalog);
    const isGlass = (code: string): boolean =>
        idx.material(code)?.boardType === 'glass';

    const materialLines: PriceLine[] = [];
    let nonGlassSheetsH = 0;
    for (const m of [...bom.materials].sort((a, b) =>
        cmpId(a.materialCode, b.materialCode),
    )) {
        const material = idx.material(m.materialCode);
        if (!material) continue;
        const glass = material.boardType === 'glass';
        const qtyH = sheetHundredths(
            m.netAreaMm2,
            m.sheetsBilled,
            material.sheetLengthMm,
            material.sheetWidthMm,
            material.wasteFactor,
            glass || pricing.sheetBillingMode === 'used_area',
        );
        if (!glass) nonGlassSheetsH += qtyH;
        if (qtyH <= 0) continue;
        materialLines.push({
            kind: 'material',
            code: material.code,
            description: `${material.name} (${material.thicknessMm} mm)`,
            quantity: qtyH / 100,
            unit: 'sheet',
            unitCostMinor: material.pricePerSheetMinor,
            costMinor: costFromHundredths(qtyH, material.pricePerSheetMinor),
        });
    }

    const edgeBandLines: PriceLine[] = [];
    let edgeBandH = 0;
    for (const e of [...bom.edgeBanding].sort((a, b) =>
        cmpId(a.edgeBandCode, b.edgeBandCode),
    )) {
        const band = idx.edgeBand(e.edgeBandCode);
        if (!band) continue;
        const qtyH = ceilDiv(e.lengthMm, 10);
        if (qtyH <= 0) continue;
        edgeBandH += qtyH;
        edgeBandLines.push({
            kind: 'edge_band',
            code: band.code,
            description: band.name,
            quantity: qtyH / 100,
            unit: 'm',
            unitCostMinor: band.pricePerMeterMinor,
            costMinor: costFromHundredths(qtyH, band.pricePerMeterMinor),
        });
    }

    const hardwareLines: PriceLine[] = [];
    let hingeQty = 0;
    let fittingQty = 0;
    let rollerQty = 0;
    for (const h of [...bom.hardware].sort((a, b) => cmpId(a.code, b.code))) {
        const item = idx.hardware(h.code);
        if (!item || h.qty <= 0) continue;
        if (item.category === 'hinge') hingeQty += h.qty;
        if (FITTING_CATEGORIES.has(item.category)) fittingQty += h.qty;
        if (item.category === 'sliding_roller') rollerQty += h.qty;
        hardwareLines.push({
            kind: 'hardware',
            code: item.code,
            description: item.name,
            quantity: h.qty,
            unit: item.unit,
            unitCostMinor: item.priceMinor,
            costMinor: toSafeNumber(product(h.qty, item.priceMinor)),
        });
    }

    const finishingLines: PriceLine[] = [];
    let finishingH = 0;
    for (const f of [...bom.finishing].sort((a, b) =>
        cmpId(a.finishCode, b.finishCode),
    )) {
        const finish = idx.finish(f.finishCode);
        if (!finish) continue;
        const qtyH = ceilDiv(f.areaMm2, 10_000);
        if (qtyH <= 0) continue;
        finishingH += qtyH;
        finishingLines.push({
            kind: 'finishing',
            code: finish.code,
            description: finish.name,
            quantity: qtyH / 100,
            unit: 'sqm',
            unitCostMinor: finish.pricePerSqmMinor,
            costMinor: costFromHundredths(qtyH, finish.pricePerSqmMinor),
        });
    }

    // 08 §4.3 #5, #6, #10: per-part rules over the cut list. A row merges
    // parts of one size, and `Bom` keeps no per-key quantity, so a mixed row
    // counts its drawer keys as an equal share of the row quantity.
    let assemblyParts = 0;
    let drawerBoxes = 0;
    let glassPieces = 0;
    for (const row of bom.cutList) {
        if (isGlass(row.materialCode)) {
            glassPieces += row.qty;
            continue;
        }
        const keys = row.partKeys.length;
        const drawerKeys = row.partKeys.filter((k) => DRAWER_KEY.test(k));
        drawerBoxes += row.partKeys.filter((k) =>
            DRAWER_LEFT_SIDE_KEY.test(k),
        ).length;
        assemblyParts +=
            row.qty - Math.round((row.qty * drawerKeys.length) / (keys || 1));
    }

    const { operations: ops } = bom;
    // `installation_per_item` and `general_per_hour` never produce a line.
    const labourQtyH: Record<LabourKey, number> = {
        cutting_per_sheet: nonGlassSheetsH,
        edge_banding_per_meter: edgeBandH,
        hinge_cup_boring_each: ops.hingeCups * 100,
        drilling_per_hole:
            (ops.shelfPinHoles +
                2 * ops.dowels +
                2 * ops.camLocks +
                ops.handleHoles) *
            100,
        assembly_per_part: assemblyParts * 100,
        drawer_assembly_each: drawerBoxes * 100,
        hinge_install_each: hingeQty * 100,
        hardware_fitting_each: fittingQty * 100,
        sliding_door_fitting_each: rollerQty * 100,
        glass_fitting_each: glassPieces * 100,
        finishing_per_sqm: finishingH,
        packing_per_item: 100,
        installation_per_item: 0,
        general_per_hour: 0,
    };
    const labourLines: PriceLine[] = [];
    for (const key of LABOUR_KEYS_ORDER) {
        const rate = idx.labour(key);
        const qtyH = labourQtyH[key];
        if (!rate || !rate.isActive || qtyH <= 0) continue;
        labourLines.push({
            kind: 'labour',
            code: key,
            description: rate.name,
            quantity: qtyH / 100,
            unit: rate.unit,
            unitCostMinor: rate.rateMinor,
            costMinor: costFromHundredths(qtyH, rate.rateMinor),
        });
    }

    const total = (lines: PriceLine[]): number =>
        sum(lines.map((l) => l.costMinor));
    const materialCostMinor = total(materialLines);
    const edgeBandCostMinor = total(edgeBandLines);
    const hardwareCostMinor = total(hardwareLines);
    const finishingCostMinor = total(finishingLines);
    const labourCostMinor = total(labourLines);
    const directCostMinor =
        materialCostMinor +
        edgeBandCostMinor +
        hardwareCostMinor +
        finishingCostMinor +
        labourCostMinor;
    const overheadMinor = applyBps(directCostMinor, pricing.overheadBps);
    const marginMinor = applyBps(
        directCostMinor + overheadMinor,
        pricing.marginBps,
    );
    const unitPriceMinor = roundUpToStep(
        directCostMinor + overheadMinor + marginMinor,
        pricing.roundingMinor,
    );

    const minInstall = idx.labour('installation_per_item');
    const installationMinor = options.includeInstallation
        ? roundUpToStep(
              Math.max(
                  applyBps(unitPriceMinor, pricing.installationBps),
                  minInstall?.isActive ? minInstall.rateMinor : 0,
              ),
              pricing.roundingMinor,
          )
        : 0;

    return {
        currency: catalog.currency,
        lines: [
            ...materialLines,
            ...edgeBandLines,
            ...hardwareLines,
            ...finishingLines,
            ...labourLines,
        ],
        materialCostMinor,
        edgeBandCostMinor,
        hardwareCostMinor,
        finishingCostMinor,
        labourCostMinor,
        directCostMinor,
        overheadMinor,
        marginMinor,
        unitPriceMinor,
        installationMinor,
        quantity: options.quantity,
        totalBeforeTaxMinor: toSafeNumber(
            product(unitPriceMinor + installationMinor, options.quantity),
        ),
    };
}

/**
 * 08 §4.6: the unit price as shown to the customer, tax-inclusive (rounded up
 * to `roundingMinor`) when `pricesIncludeTax`, else unchanged.
 */
export function displayUnitPrice(
    amountExclMinor: number,
    pricing: PricingSettings,
    taxRates: CatalogTaxRate[],
): number {
    if (!pricing.pricesIncludeTax) return amountExclMinor;
    const rate =
        taxRates.find((t) => t.id === pricing.defaultTaxRateId)?.rateBps ?? 0;
    return roundUpToStep(grossUp(amountExclMinor, rate), pricing.roundingMinor);
}
