import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cmpId } from '../../compare';
import { mutateCatalog, seedCatalog } from '../../testing/seedCatalog';
import {
    BOARD_TYPES,
    CatalogSnapshotSchema,
    HARDWARE_CATEGORIES,
    LABOUR_KEYS,
    type CatalogSnapshot,
} from '../snapshot';
import {
    HARDWARE_ROLE_KEYS,
    HARDWARE_SPEC_SCHEMAS,
    parseHardwareSpecs,
} from '../specs';

const raw = JSON.parse(
    readFileSync(
        new URL(
            '../../../../../tests/fixtures/catalog/seed-snapshot.json',
            import.meta.url,
        ),
        'utf8',
    ),
) as CatalogSnapshot;

/** 08 §7.3 row order with the SLD families expanded: row n has sortOrder n × 10. */
const HARDWARE_ROW_ORDER = [
    'HNG-FO-SC',
    'HNG-HO-SC',
    'HNG-IN-SC',
    'HNG-PLATE-0',
    'SLD-BB-250',
    'SLD-BB-300',
    'SLD-BB-350',
    'SLD-BB-400',
    'SLD-BB-450',
    'SLD-BB-500',
    'SLD-BB-550',
    'SLD-BB-600',
    'SLD-UM-350',
    'SLD-UM-400',
    'SLD-UM-450',
    'SLD-UM-500',
    'HDL-BAR-160',
    'HDL-BAR-320',
    'HDL-FLUSH',
    'KNB-ROUND-30',
    'LEG-PLINTH-100',
    'LEG-CAB-ADJ',
    'LEG-TBL-710',
    'ROD-OVAL-1200',
    'ROD-SUP',
    'SHF-PIN-5',
    'CON-CAM-15',
    'CON-DOWEL-8',
    'CON-TBL-CORNER',
    'BRK-WALL-HANG',
    'BRK-ANTITIP',
    'TRK-SLD-2T-3000',
    'ROL-SLD-SET',
    'GAS-80N',
    'LFT-STAY-SC',
    'BSK-PULL-600',
    'SCR-PACK',
    'LCK-CAM-20',
    'DMP-PUSH',
    'LED-STRIP-12V',
];

describe('seed-snapshot.json (08 §7, 02 §13–§14)', () => {
    it('has the row counts of 08 §7', () => {
        expect(raw.materials).toHaveLength(12);
        expect(raw.edgeBands).toHaveLength(8);
        expect(raw.hardware).toHaveLength(40);
        expect(raw.finishes).toHaveLength(6);
        expect(raw.labourRates).toHaveLength(14);
        expect(raw.taxRates).toHaveLength(4);
    });

    it('has the header values', () => {
        expect(raw.version).toBe(1);
        expect(raw.currency).toBe('INR');
        expect(raw.generatedAt).toBe('2026-10-20T00:00:00Z');
    });

    it('has the 02 §13 pricing defaults', () => {
        expect(raw.pricing).toEqual({
            marginBps: 3500,
            overheadBps: 1000,
            roundingMinor: 100,
            installationBps: 800,
            kerfMm: 4,
            sheetTrimMm: 10,
            nestingAllowRotationDefault: true,
            sheetBillingMode: 'used_area',
            edgePremillMm: 0,
            pricesIncludeTax: false,
            defaultTaxRateId: 'seed-tax-gst18',
            minimumOrderMinor: 0,
            deliveryFlatMinor: 0,
            estimateDisclaimerKey: 'estimates.disclaimer',
        });
    });

    it('has the 02 §14 tax rates', () => {
        expect(raw.taxRates).toEqual([
            {
                id: 'seed-tax-gst18',
                name: 'GST 18%',
                rateBps: 1800,
                isDefault: true,
                isActive: true,
            },
            {
                id: 'seed-tax-gst12',
                name: 'GST 12%',
                rateBps: 1200,
                isDefault: false,
                isActive: true,
            },
            {
                id: 'seed-tax-gst5',
                name: 'GST 5%',
                rateBps: 500,
                isDefault: false,
                isActive: true,
            },
            {
                id: 'seed-tax-none',
                name: 'No tax 0%',
                rateBps: 0,
                isDefault: false,
                isActive: true,
            },
        ]);
    });

    it('stores prices as rupees × 100 and ids as seed-<code>', () => {
        const mat = raw.materials.find((m) => m.code === 'PB18-WHITE');
        expect(mat?.pricePerSheetMinor).toBe(215000);
        expect(mat?.id).toBe('seed-PB18-WHITE');
        expect(
            raw.edgeBands.find((e) => e.code === 'EB08-WHITE'),
        ).toMatchObject({ pricePerMeterMinor: 600, id: 'seed-EB08-WHITE' });
        expect(raw.hardware.find((h) => h.code === 'HNG-FO-SC')).toMatchObject({
            priceMinor: 12000,
            id: 'seed-HNG-FO-SC',
        });
        expect(raw.finishes.find((f) => f.code === 'FIN-DUCO')).toMatchObject({
            pricePerSqmMinor: 90000,
            id: 'seed-FIN-DUCO',
        });
        expect(
            raw.labourRates.find((l) => l.key === 'installation_per_item'),
        ).toMatchObject({
            rateMinor: 150000,
            id: 'seed-installation_per_item',
        });
    });

    it('keeps decimals as JSON numbers and urls null', () => {
        const oak = raw.materials.find((m) => m.code === 'PB18-OAK');
        expect(oak).toMatchObject({
            thicknessMm: 18,
            wasteFactor: 0.12,
            hasGrain: true,
            textureUrl: null,
            textureThumbUrl: null,
        });
        expect(
            raw.edgeBands.find((e) => e.code === 'EB04-WHITE'),
        ).toMatchObject({ thicknessMm: 0.4, widthMm: 22 });
        expect(raw.hardware.every((h) => h.imageUrl === null)).toBe(true);
    });

    it('numbers hardware by 08 §7.3 row order × 10 (SLD rows expanded)', () => {
        const bySort = [...raw.hardware].sort(
            (a, b) => a.sortOrder - b.sortOrder,
        );
        expect(bySort.map((h) => h.code)).toEqual(HARDWARE_ROW_ORDER);
        expect(bySort.map((h) => h.sortOrder)).toEqual(
            HARDWARE_ROW_ORDER.map((_, i) => (i + 1) * 10),
        );
    });

    it('numbers materials 10..120', () => {
        expect(raw.materials.map((m) => m.sortOrder)).toEqual(
            Array.from({ length: 12 }, (_, i) => (i + 1) * 10),
        );
    });

    it('lists arrays in the 08 §2.1 sort orders', () => {
        const sorted = <T>(rows: T[], cmp: (a: T, b: T) => number): T[] =>
            [...rows].sort(cmp);
        expect(raw.materials).toEqual(
            sorted(
                raw.materials,
                (a, b) => a.sortOrder - b.sortOrder || cmpId(a.code, b.code),
            ),
        );
        expect(raw.edgeBands).toEqual(
            sorted(raw.edgeBands, (a, b) => cmpId(a.code, b.code)),
        );
        expect(raw.hardware).toEqual(
            sorted(
                raw.hardware,
                (a, b) =>
                    cmpId(a.category, b.category) ||
                    a.sortOrder - b.sortOrder ||
                    cmpId(a.code, b.code),
            ),
        );
        expect(raw.finishes).toEqual(
            sorted(raw.finishes, (a, b) => cmpId(a.code, b.code)),
        );
        expect(raw.labourRates).toEqual(
            sorted(raw.labourRates, (a, b) => cmpId(a.key, b.key)),
        );
        expect(raw.taxRates).toEqual(
            sorted(
                raw.taxRates,
                (a, b) => b.rateBps - a.rateBps || cmpId(a.name, b.name),
            ),
        );
    });

    it('has all 14 labour keys of 08 §4.3', () => {
        expect(LABOUR_KEYS).toHaveLength(14);
        expect(raw.labourRates.map((l) => l.key).sort(cmpId)).toEqual(
            [...LABOUR_KEYS].sort(cmpId),
        );
    });
});

describe('seed rows regression guard', () => {
    // One JSON line per row: a change to any price, code, sortOrder, active
    // flag, spec or other field of the seed fails this test. Update the file
    // snapshot (`vitest -u`) only for a deliberate seed change.
    const lines = (title: string, rows: readonly unknown[]): string =>
        [
            `# ${title} (${rows.length})`,
            ...rows.map((r) => JSON.stringify(r)),
        ].join('\n');

    it('pins every row of the seed snapshot', async () => {
        const text = [
            JSON.stringify({
                version: raw.version,
                currency: raw.currency,
                generatedAt: raw.generatedAt,
            }),
            lines('pricing', [raw.pricing]),
            lines('materials', raw.materials),
            lines('edgeBands', raw.edgeBands),
            lines('hardware', raw.hardware),
            lines('finishes', raw.finishes),
            lines('labourRates', raw.labourRates),
            lines('taxRates', raw.taxRates),
        ].join('\n\n');
        await expect(`${text}\n`).toMatchFileSnapshot(
            './__snapshots__/seed-rows.txt',
        );
    });
});

describe('CatalogSnapshotSchema', () => {
    it('parses the seed snapshot', () => {
        const result = CatalogSnapshotSchema.safeParse(raw);
        expect(result.success).toBe(true);
    });

    it('strips unknown keys at every level', () => {
        const dirty = structuredClone(raw) as unknown as Record<
            string,
            unknown
        >;
        dirty.extra = 1;
        (dirty.pricing as Record<string, unknown>).extra = 2;
        (dirty.materials as Record<string, unknown>[])[0]!.extra = 3;
        (dirty.taxRates as Record<string, unknown>[])[0]!.extra = 4;
        const parsed = CatalogSnapshotSchema.parse(dirty);
        expect(parsed).not.toHaveProperty('extra');
        expect(parsed.pricing).not.toHaveProperty('extra');
        expect(parsed.materials[0]).not.toHaveProperty('extra');
        expect(parsed.taxRates[0]).not.toHaveProperty('extra');
    });

    it('keeps extra keys inside hardware specs (passthrough)', () => {
        const dirty = structuredClone(raw);
        dirty.hardware[0]!.specs = { ...dirty.hardware[0]!.specs, vendor: 'x' };
        const parsed = CatalogSnapshotSchema.parse(dirty);
        expect(parsed.hardware[0]!.specs.vendor).toBe('x');
    });

    it('rejects non-integer money and unknown enums', () => {
        const badMoney = structuredClone(raw);
        badMoney.materials[0]!.pricePerSheetMinor = 10.5;
        expect(CatalogSnapshotSchema.safeParse(badMoney).success).toBe(false);

        const badBoard = structuredClone(raw) as unknown as {
            materials: { boardType: string }[];
        };
        badBoard.materials[0]!.boardType = 'cardboard';
        expect(CatalogSnapshotSchema.safeParse(badBoard).success).toBe(false);

        const badKey = structuredClone(raw) as unknown as {
            labourRates: { key: string }[];
        };
        badKey.labourRates[0]!.key = 'made_up';
        expect(CatalogSnapshotSchema.safeParse(badKey).success).toBe(false);
    });

    it('reports hardware spec errors at the specs path', () => {
        const dirty = structuredClone(raw);
        const hinge = dirty.hardware.find((h) => h.category === 'hinge')!;
        delete hinge.specs.overlay;
        const result = CatalogSnapshotSchema.safeParse(dirty);
        expect(result.success).toBe(false);
        if (!result.success) {
            const paths = result.error.issues.map((i) => i.path.join('.'));
            const idx = dirty.hardware.indexOf(hinge);
            expect(paths).toContain(`hardware.${idx}.specs.overlay`);
        }
    });

    it('normalises hex colours to lower case', () => {
        const upper = structuredClone(raw);
        upper.materials[0]!.colorHex = '#AABBCC';
        upper.edgeBands[0]!.colorHex = '#A0703C';
        upper.finishes[0]!.colorHex = '#FfEeDd';
        const parsed = CatalogSnapshotSchema.parse(upper);
        expect(parsed.materials[0]!.colorHex).toBe('#aabbcc');
        expect(parsed.edgeBands[0]!.colorHex).toBe('#a0703c');
        expect(parsed.finishes[0]!.colorHex).toBe('#ffeedd');
        upper.materials[0]!.colorHex = 'red';
        expect(CatalogSnapshotSchema.safeParse(upper).success).toBe(false);
    });

    it('stores every seed colour in lower case', () => {
        const hexes = JSON.stringify(raw).match(/"#[0-9a-fA-F]{6}"/g) ?? [];
        expect(hexes.length).toBeGreaterThan(10);
        for (const hex of hexes) expect(hex).toBe(hex.toLowerCase());
        expect(seedCatalog().materials[0]!.colorHex).toBe('#f4f4f2');
    });

    it('requires an ISO datetime for generatedAt', () => {
        const bad = { ...structuredClone(raw), generatedAt: 'yesterday' };
        expect(CatalogSnapshotSchema.safeParse(bad).success).toBe(false);
    });

    it('requires positive sheet dimensions and an integer sheetTrimMm', () => {
        const zero = structuredClone(raw);
        zero.materials[0]!.sheetLengthMm = 0;
        expect(CatalogSnapshotSchema.safeParse(zero).success).toBe(false);
        const trim = structuredClone(raw);
        trim.pricing.sheetTrimMm = 2.5;
        expect(CatalogSnapshotSchema.safeParse(trim).success).toBe(false);
    });

    it('lists every enum value of 08 §2.1', () => {
        expect(BOARD_TYPES).toHaveLength(9);
        expect(HARDWARE_CATEGORIES).toHaveLength(21);
    });
});

describe('hardware spec schemas (08 §2.3)', () => {
    it('has a schema for every category', () => {
        expect(Object.keys(HARDWARE_SPEC_SCHEMAS).sort(cmpId)).toEqual(
            [...HARDWARE_CATEGORIES].sort(cmpId),
        );
    });

    it('accepts every seed hardware row', () => {
        for (const h of raw.hardware) {
            const r = parseHardwareSpecs(h.category, h.specs);
            expect(r.success, h.code).toBe(true);
        }
    });

    it('rejects slide and track lengths below 1 mm', () => {
        expect(
            parseHardwareSpecs('drawer_slide', {
                type: 'side_mount',
                family: 'f',
                lengthMm: 0,
            }).success,
        ).toBe(false);
        expect(
            parseHardwareSpecs('sliding_track', { lengthMm: 0 }).success,
        ).toBe(false);
    });

    it('rejects a hinge without overlay (16 §7.1)', () => {
        expect(parseHardwareSpecs('hinge', { crankMm: 0 }).success).toBe(false);
        expect(parseHardwareSpecs('hinge', { overlay: 'wide' }).success).toBe(
            false,
        );
    });

    it('applies the documented hinge defaults', () => {
        const r = parseHardwareSpecs('hinge', { overlay: 'half' });
        expect(r.success && r.data).toMatchObject({
            overlay: 'half',
            cupDiameterMm: 35,
            boringDistanceMm: 4,
            integratedPlate: false,
        });
        expect(
            parseHardwareSpecs('hinge', {
                overlay: 'full',
                boringDistanceMm: 7,
            }).success,
        ).toBe(false);
    });

    it('requires type, family and lengthMm on drawer slides', () => {
        const ok = { type: 'side_mount', family: 'bb45', lengthMm: 450 };
        expect(parseHardwareSpecs('drawer_slide', ok).success).toBe(true);
        for (const key of ['type', 'family', 'lengthMm']) {
            const bad: Record<string, unknown> = { ...ok };
            delete bad[key];
            expect(parseHardwareSpecs('drawer_slide', bad).success, key).toBe(
                false,
            );
        }
    });

    it('defaults slide geometry by slide type', () => {
        const side = parseHardwareSpecs('drawer_slide', {
            type: 'side_mount',
            family: 'f',
            lengthMm: 400,
        });
        expect(side.success && side.data).toMatchObject({
            clearancePerSideMm: 12.7,
        });
        const under = parseHardwareSpecs('drawer_slide', {
            type: 'undermount',
            family: 'um',
            lengthMm: 400,
        });
        expect(under.success && under.data).toMatchObject({
            innerWidthDeductionMm: 42,
            lengthDeductionMm: 10,
            bottomRecessMm: 13,
            maxSideThicknessMm: 16,
        });
        const explicit = parseHardwareSpecs('drawer_slide', {
            type: 'undermount',
            family: 'um',
            lengthMm: 400,
            innerWidthDeductionMm: 40,
        });
        expect(explicit.success && explicit.data).toMatchObject({
            innerWidthDeductionMm: 40,
        });
    });

    it('enforces the other required fields', () => {
        expect(
            parseHardwareSpecs('plinth_leg', { minHeightMm: 95 }).success,
        ).toBe(false);
        expect(parseHardwareSpecs('connector', {}).success).toBe(false);
        expect(parseHardwareSpecs('connector', { kind: 'glue' }).success).toBe(
            false,
        );
        expect(parseHardwareSpecs('sliding_track', { tracks: 2 }).success).toBe(
            false,
        );
        expect(
            parseHardwareSpecs('sliding_track', { lengthMm: 3000, tracks: 4 })
                .success,
        ).toBe(false);
    });

    it('defaults handle, knob and rod values', () => {
        const handle = parseHardwareSpecs('handle', { lengthMm: 160 });
        expect(handle.success && handle.data).toMatchObject({ holeCount: 2 });
        const knob = parseHardwareSpecs('knob', {});
        expect(knob.success && knob.data).toMatchObject({ holeCount: 1 });
        const rod = parseHardwareSpecs('hanging_rod', {});
        expect(rod.success && rod.data).toMatchObject({ maxLengthMm: 1200 });
    });

    it('passes extra keys through and accepts empty specs', () => {
        const r = parseHardwareSpecs('lock', { brand: 'acme' });
        expect(r.success && r.data).toEqual({ brand: 'acme' });
        for (const cat of [
            'rod_support',
            'lock',
            'damper',
            'led_strip',
        ] as const) {
            expect(parseHardwareSpecs(cat, {}).success).toBe(true);
        }
    });

    it('lists the 28 role keys of 07 §6.11 without duplicates', () => {
        expect(HARDWARE_ROLE_KEYS).toHaveLength(28);
        expect(new Set(HARDWARE_ROLE_KEYS).size).toBe(28);
    });
});

describe('seedCatalog / mutateCatalog (test helpers)', () => {
    it('parses to the same data as the JSON file', () => {
        const seed = seedCatalog();
        expect(seed.materials.map((m) => m.code)).toEqual(
            raw.materials.map((m) => m.code),
        );
        expect(seed.version).toBe(1);
        expect(seed.pricing.marginBps).toBe(3500);
    });

    it('applies a validated pricing patch without touching the base', () => {
        const patched = seedCatalog({
            pricing: { marginBps: 0, pricesIncludeTax: true },
        });
        expect(patched.pricing.marginBps).toBe(0);
        expect(patched.pricing.pricesIncludeTax).toBe(true);
        expect(patched.pricing.overheadBps).toBe(1000);
        expect(patched.materials).toBe(seedCatalog().materials);
        expect(seedCatalog().pricing.marginBps).toBe(3500);
        expect(Object.isFrozen(patched)).toBe(true);
        expect(() => seedCatalog({ pricing: { edgePremillMm: 9 } })).toThrow();
        expect(() => seedCatalog({ pricing: { sheetTrimMm: 1.5 } })).toThrow();
    });

    it('parses once and returns the same deep-frozen snapshot', () => {
        const a = seedCatalog();
        expect(seedCatalog()).toBe(a);
        expect(Object.isFrozen(a)).toBe(true);
        expect(Object.isFrozen(a.materials[0])).toBe(true);
        expect(Object.isFrozen(a.hardware[0]!.specs)).toBe(true);
        expect(Object.isFrozen(a.pricing)).toBe(true);
    });

    it('mutateCatalog returns a new frozen snapshot and leaves the base alone', () => {
        const base = seedCatalog();
        const next = mutateCatalog(base, (draft) => {
            draft.version = 2;
            draft.materials[0]!.isActive = false;
        });
        expect(next).not.toBe(base);
        expect(next.version).toBe(2);
        expect(next.materials[0]!.isActive).toBe(false);
        expect(base.version).toBe(1);
        expect(base.materials[0]!.isActive).toBe(true);
        expect(Object.isFrozen(next)).toBe(true);
        expect(Object.isFrozen(next.materials[0])).toBe(true);
        expect(next.materials[1]).toBe(base.materials[1]);
    });
});
