import { describe, expect, it } from 'vitest';
import type { FurnitureDocument } from '../../furniture/schema';
import { generateFurniture } from '../../furniture/generate';
import { wardrobeFixture } from '../../furniture/testing/docs';
import { seedCatalog } from '../../testing/seedCatalog';
import { bomOptionsFor, computeBom } from '../bom';
import { CUT_LIST_CSV_COLUMNS, csvField, cutListCsv } from '../exportCsv';

/** 08 §8.1: the wardrobe fixture against the seed catalog. */
const catalog = seedCatalog();

function csvOf(doc: FurnitureDocument): string {
    const model = generateFurniture(doc, catalog);
    return cutListCsv(
        computeBom(model, catalog, bomOptionsFor(doc, false)),
        catalog,
        doc,
    );
}

const lines = (csv: string): string[] => csv.slice(1).split('\r\n');

const EXTRA_ID = 'p_0123456789';
const withExtra = (name: string, note: string | null) =>
    wardrobeFixture((d) => {
        d.overrides.extraParts.push({
            id: EXTRA_ID,
            name,
            role: 'carcass',
            materialCode: 'PB18-WHITE',
            length: 300,
            width: 100,
            qty: 1,
            edges: { L1: null, L2: null, W1: null, W2: null },
            grain: 'none',
            note,
            placement: null,
        });
    });

describe('csvField', () => {
    it('quotes only fields with comma, quote, CR or LF', () => {
        expect(csvField('plain')).toBe('plain');
        expect(csvField(1.5)).toBe('1.5');
        expect(csvField('a,b')).toBe('"a,b"');
        expect(csvField('say "hi"')).toBe('"say ""hi"""');
        expect(csvField('a\nb')).toBe('"a\nb"');
        expect(csvField('a\rb')).toBe('"a\rb"');
        expect(csvField('')).toBe('');
    });
});

describe('cutListCsv: wardrobe (08 §8.1)', () => {
    const csv = csvOf(wardrobeFixture());
    const rows = lines(csv);

    it('starts with a BOM and ends with CRLF', () => {
        expect(csv.startsWith('\uFEFF')).toBe(true);
        expect(csv.endsWith('\r\n')).toBe(true);
        expect(csv.includes('\n\n')).toBe(false);
    });

    it('has the exact 19-column header', () => {
        expect(CUT_LIST_CSV_COLUMNS).toHaveLength(19);
        expect(rows[0]).toBe(
            'row_no,part_name,qty,material_code,material_name,thickness_mm,length_mm,width_mm,cut_length_mm,cut_width_mm,grain,edge_l1,edge_l2,edge_w1,edge_w2,edge_band_mm,area_m2,part_keys,notes',
        );
    });

    it('has 12 data rows plus the empty tail after the last CRLF', () => {
        expect(rows).toHaveLength(1 + 12 + 1);
        expect(rows[13]).toBe('');
    });

    it('writes rows byte-exactly', () => {
        expect(rows[1]).toBe(
            '1,Back panel 2,1,HDF3-WHITE,HDF 3 mm White (one side),3,1978,1180,1978,1180,none,,,,,0,2.334,carcass.back.2,',
        );
        expect(rows[3]).toBe(
            '3,Left side / Right side,2,PB18-WHITE,PB 18 mm Frosty White,18,2000,582,1999,581,none,EB08-WHITE,,EB08-WHITE,,5164,2.328,carcass.side.left carcass.side.right,',
        );
    });
});

describe('cutListCsv: quoting and notes', () => {
    it('quotes a name with comma and quotes', () => {
        const rows = lines(csvOf(withExtra('Filler, "left"', null)));
        const row = rows.find((r) => r.includes(EXTRA_ID))!;
        expect(row).toContain(',"Filler, ""left""",1,PB18-WHITE,');
    });

    it('quotes a name with a newline', () => {
        const csv = csvOf(withExtra('Two\nlines', null));
        expect(csv).toContain(',"Two\nlines",1,PB18-WHITE,');
    });

    it('joins part override notes and extra-part notes of the row keys with " | "', () => {
        const doc = withExtra('Filler', 'Glue, then clamp');
        doc.overrides.parts['carcass.side.left'] = { note: 'Check grain' };
        doc.overrides.parts['carcass.side.right'] = { note: 'Pre-drill' };
        const rows = lines(csvOf(doc));
        expect(rows[3]!.endsWith(',Check grain | Pre-drill')).toBe(true);
        const extra = rows.find((r) => r.includes(EXTRA_ID))!;
        expect(extra.endsWith(`,extra.${EXTRA_ID},"Glue, then clamp"`)).toBe(
            true,
        );
    });
});
