/**
 * Catalog snapshot (08 §2): the only catalog shape the engine consumes. The
 * server builds it from the six catalog tables plus the `pricing` and
 * `business` settings; the engine never reads a database (01 §5.3).
 *
 * The snapshot carries active and inactive (archived) rows alike, flagged
 * `isActive`, so documents that reference archived codes keep resolving.
 * Unknown keys are stripped on parse (08 §2.2); hardware `specs` keep theirs
 * (08 §2.3).
 *
 * Money is integer minor units. Numbers that are decimals in the database
 * (`thicknessMm`, `wasteFactor`, `kerfMm`) are plain JSON numbers.
 */
import { z } from 'zod';
import { parseHardwareSpecs } from './specs';

export const BOARD_TYPES = [
    'particle_board',
    'mdf',
    'hdf',
    'plywood',
    'blockboard',
    'solid_wood',
    'glass',
    'acrylic',
    'metal_sheet',
] as const;
export type BoardType = (typeof BOARD_TYPES)[number];

export const SURFACES = [
    'raw',
    'melamine',
    'laminate',
    'veneer',
    'painted',
    'lacquered',
    'pre_laminated',
] as const;
export type Surface = (typeof SURFACES)[number];

export const HARDWARE_CATEGORIES = [
    'hinge',
    'hinge_plate',
    'drawer_slide',
    'handle',
    'knob',
    'leg',
    'plinth_leg',
    'hanging_rod',
    'rod_support',
    'shelf_support',
    'connector',
    'lock',
    'lift_mechanism',
    'sliding_track',
    'sliding_roller',
    'gas_strut',
    'damper',
    'screw_pack',
    'wall_bracket',
    'led_strip',
    'other',
] as const;
export type HardwareCategory = (typeof HARDWARE_CATEGORIES)[number];

export const FINISH_TYPES = [
    'none',
    'laminate',
    'veneer',
    'paint',
    'pu',
    'lacquer',
    'duco',
    'membrane',
] as const;
export type FinishType = (typeof FINISH_TYPES)[number];

export const LABOUR_UNITS = [
    'sheet',
    'meter',
    'part',
    'piece',
    'item',
    'sqm',
    'hour',
] as const;
export type LabourUnit = (typeof LABOUR_UNITS)[number];

/** The 14 labour rate keys of 08 §4.3. */
export const LABOUR_KEYS = [
    'cutting_per_sheet',
    'edge_banding_per_meter',
    'hinge_cup_boring_each',
    'drilling_per_hole',
    'assembly_per_part',
    'drawer_assembly_each',
    'hinge_install_each',
    'hardware_fitting_each',
    'sliding_door_fitting_each',
    'glass_fitting_each',
    'finishing_per_sqm',
    'packing_per_item',
    'installation_per_item',
    'general_per_hour',
] as const;
export type LabourKey = (typeof LABOUR_KEYS)[number];

export const HARDWARE_UNITS = [
    'piece',
    'pair',
    'set',
    'meter',
    'pack',
] as const;
export type HardwareUnit = (typeof HARDWARE_UNITS)[number];

export const SHEET_BILLING_MODES = ['used_area', 'whole_sheets'] as const;
export type SheetBillingMode = (typeof SHEET_BILLING_MODES)[number];

/** Part roles a material may be used for (03 §2); `CatalogMaterial.usage` adds `'glass'`. */
export const MATERIAL_ROLES = [
    'carcass',
    'back',
    'shelf',
    'front',
    'top',
    'drawer_box',
    'drawer_bottom',
    'plinth',
    'leg',
] as const;
export type MaterialRole = (typeof MATERIAL_ROLES)[number];

/** Non-negative integer (money in minor units, lengths in mm). */
const Minor = z.number().int().nonnegative();
const Positive = z.number().positive();
const ColorHex = z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable();
const Code = z.string().min(1);

export const CatalogMaterialSchema = z.object({
    id: z.string(),
    code: Code,
    name: z.string(),
    boardType: z.enum(BOARD_TYPES),
    thicknessMm: Positive,
    sheetLengthMm: Minor,
    sheetWidthMm: Minor,
    hasGrain: z.boolean(),
    decorName: z.string().nullable(),
    colorHex: ColorHex,
    textureUrl: z.string().nullable(),
    textureThumbUrl: z.string().nullable(),
    surface: z.enum(SURFACES),
    pricePerSheetMinor: Minor,
    wasteFactor: z.number().nonnegative(),
    densityKgM3: z.number().positive().nullable(),
    usage: z.array(z.string()),
    defaultEdgeBandCode: z.string().nullable(),
    isActive: z.boolean(),
    sortOrder: z.number().int(),
});
export type CatalogMaterial = z.output<typeof CatalogMaterialSchema>;

export const CatalogEdgeBandSchema = z.object({
    id: z.string(),
    code: Code,
    name: z.string(),
    thicknessMm: Positive,
    widthMm: Minor,
    colorHex: ColorHex,
    pricePerMeterMinor: Minor,
    isActive: z.boolean(),
});
export type CatalogEdgeBand = z.output<typeof CatalogEdgeBandSchema>;

export const CatalogHardwareSchema = z
    .object({
        id: z.string(),
        code: Code,
        name: z.string(),
        category: z.enum(HARDWARE_CATEGORIES),
        specs: z.record(z.string(), z.unknown()),
        unit: z.enum(HARDWARE_UNITS),
        priceMinor: Minor,
        isDefaultFor: z.array(z.string()),
        imageUrl: z.string().nullable(),
        isActive: z.boolean(),
        sortOrder: z.number().int(),
    })
    .transform((row, ctx) => {
        const parsed = parseHardwareSpecs(row.category, row.specs);
        if (!parsed.success) {
            for (const issue of parsed.error.issues) {
                ctx.addIssue({
                    code: 'custom',
                    message: issue.message,
                    path: ['specs', ...issue.path],
                });
            }
            return z.NEVER;
        }
        return { ...row, specs: parsed.data };
    });
export type CatalogHardware = z.output<typeof CatalogHardwareSchema>;

export const CatalogFinishSchema = z.object({
    id: z.string(),
    code: Code,
    name: z.string(),
    finishType: z.enum(FINISH_TYPES),
    pricePerSqmMinor: Minor,
    appliesTo: z.array(z.enum(BOARD_TYPES)),
    colorHex: ColorHex,
    textureUrl: z.string().nullable(),
    isActive: z.boolean(),
});
export type CatalogFinish = z.output<typeof CatalogFinishSchema>;

export const CatalogLabourRateSchema = z.object({
    id: z.string(),
    key: z.enum(LABOUR_KEYS),
    name: z.string(),
    unit: z.enum(LABOUR_UNITS),
    rateMinor: Minor,
    isActive: z.boolean(),
});
export type CatalogLabourRate = z.output<typeof CatalogLabourRateSchema>;

export const CatalogTaxRateSchema = z.object({
    id: z.string(),
    name: z.string(),
    rateBps: Minor,
    isDefault: z.boolean(),
    isActive: z.boolean(),
});
export type CatalogTaxRate = z.output<typeof CatalogTaxRateSchema>;

export const PricingSettingsSchema = z.object({
    pricesIncludeTax: z.boolean(),
    defaultTaxRateId: z.string().nullable(),
    marginBps: Minor,
    overheadBps: Minor,
    minimumOrderMinor: Minor,
    roundingMinor: Minor,
    estimateDisclaimerKey: z.string(),
    installationBps: Minor,
    deliveryFlatMinor: Minor,
    kerfMm: z.number().nonnegative(),
    sheetTrimMm: z.number().nonnegative(),
    nestingAllowRotationDefault: z.boolean(),
    sheetBillingMode: z.enum(SHEET_BILLING_MODES),
    edgePremillMm: z.number().int().min(0).max(3),
});
export type PricingSettings = z.output<typeof PricingSettingsSchema>;

/**
 * Arrays arrive sorted by the server (08 §2.1): materials by sortOrder then
 * code, edge bands and finishes by code, hardware by category, sortOrder,
 * code, labour rates by key, tax rates by rateBps desc then name. The schema
 * does not reorder; `CatalogIndex` sorts what it needs itself.
 */
export const CatalogSnapshotSchema = z.object({
    version: z.number().int().nonnegative(),
    currency: z.string().min(1),
    generatedAt: z.string(),
    materials: z.array(CatalogMaterialSchema),
    edgeBands: z.array(CatalogEdgeBandSchema),
    hardware: z.array(CatalogHardwareSchema),
    finishes: z.array(CatalogFinishSchema),
    labourRates: z.array(CatalogLabourRateSchema),
    taxRates: z.array(CatalogTaxRateSchema),
    pricing: PricingSettingsSchema,
});
export type CatalogSnapshot = z.output<typeof CatalogSnapshotSchema>;
