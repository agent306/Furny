/**
 * Cut list CSV (08 §8.1): UTF-8 with BOM, CRLF, `,` separator, RFC 4180
 * quoting, `.` decimals. English header and part names are spec-fixed.
 */
import type { CatalogSnapshot } from '../catalog/snapshot';
import type { FurnitureDocument } from '../furniture/schema';
import type { Bom, CutListRow } from './types';

export const CUT_LIST_CSV_COLUMNS = [
    'row_no',
    'part_name',
    'qty',
    'material_code',
    'material_name',
    'thickness_mm',
    'length_mm',
    'width_mm',
    'cut_length_mm',
    'cut_width_mm',
    'grain',
    'edge_l1',
    'edge_l2',
    'edge_w1',
    'edge_w2',
    'edge_band_mm',
    'area_m2',
    'part_keys',
    'notes',
] as const;

const BOM = '\uFEFF';
const EOL = '\r\n';

/** One CSV field: quoted when it holds `,`, `"`, CR or LF; `"` doubled. */
export function csvField(value: string | number): string {
    const text = String(value);
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** `qty × Σ banded finished edge lengths` in mm. */
function edgeBandMm(row: CutListRow): number {
    const { L1, L2, W1, W2 } = row.edges;
    const perPiece =
        (L1 === null ? 0 : row.length) +
        (L2 === null ? 0 : row.length) +
        (W1 === null ? 0 : row.width) +
        (W2 === null ? 0 : row.width);
    return row.qty * perPiece;
}

/** `length × width × qty / 1e6` to 3 decimals, half up on integers. */
function areaM2(row: CutListRow): string {
    const milli = Math.floor((row.length * row.width * row.qty + 500) / 1000);
    return `${Math.floor(milli / 1000)}.${String(milli % 1000).padStart(3, '0')}`;
}

function notesOf(row: CutListRow, doc: FurnitureDocument): string {
    const notes: string[] = [];
    for (const key of row.partKeys) {
        const override = doc.overrides.parts[key]?.note;
        if (override) notes.push(override);
        const extra = doc.overrides.extraParts.find(
            (e) => `extra.${e.id}` === key,
        )?.note;
        if (extra) notes.push(extra);
    }
    return notes.join(' | ');
}

export function cutListCsv(
    bom: Bom,
    catalog: CatalogSnapshot,
    doc: FurnitureDocument,
): string {
    const names = new Map(catalog.materials.map((m) => [m.code, m.name]));
    const out = [CUT_LIST_CSV_COLUMNS.join(',')];
    bom.cutList.forEach((row, i) => {
        const fields: Array<string | number> = [
            i + 1,
            row.name,
            row.qty,
            row.materialCode,
            names.get(row.materialCode) ?? '',
            row.thickness,
            row.length,
            row.width,
            row.cutLength,
            row.cutWidth,
            row.grain,
            row.edges.L1 ?? '',
            row.edges.L2 ?? '',
            row.edges.W1 ?? '',
            row.edges.W2 ?? '',
            edgeBandMm(row),
            areaM2(row),
            row.partKeys.join(' '),
            notesOf(row, doc),
        ];
        out.push(fields.map(csvField).join(','));
    });
    return BOM + out.join(EOL) + EOL;
}
