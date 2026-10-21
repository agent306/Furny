/**
 * `nestSheets` (08 §5.4): the cut list nested per material by the guillotine
 * packer. Glass and unknown materials have no sheet and are skipped.
 */
import type { CatalogSnapshot } from '../../catalog/snapshot';
import { cmpId } from '../../compare';
import { indexCatalog } from '../../furniture/catalogIndex';
import type { PartKey } from '../../furniture/schema';
import type { CutListRow, NestingResult } from '../types';
import { nestMaterial, type NestItem, type NestRotation } from './guillotine';

/** Error issue codes the BOM adds (08 §3.9). */
export const BOM_ISSUE_CODES = ['bom.part_exceeds_sheet'] as const;

export type BomIssueCode = (typeof BOM_ISSUE_CODES)[number];

export function nestSheets(
    rows: readonly CutListRow[],
    partQty: ReadonlyMap<PartKey, number>,
    catalog: CatalogSnapshot,
    options: { kerf: number; trim: number; allowRotation: boolean },
): NestingResult {
    const idx = indexCatalog(catalog);
    const byMaterial = new Map<string, CutListRow[]>();
    for (const row of rows) {
        const group = byMaterial.get(row.materialCode);
        if (group) group.push(row);
        else byMaterial.set(row.materialCode, [row]);
    }

    const { kerf, trim } = options;
    const result: NestingResult = { sheets: [], kerf, trim, unplaced: [] };
    for (const code of [...byMaterial.keys()].sort(cmpId)) {
        const material = idx.material(code);
        if (!material || material.boardType === 'glass') continue;
        const items: NestItem[] = [];
        for (const row of byMaterial.get(code)!) {
            const rotation: NestRotation =
                material.hasGrain && row.grain !== 'none'
                    ? row.grain === 'length'
                        ? 'length_along_sheet'
                        : 'width_along_sheet'
                    : options.allowRotation
                      ? 'free'
                      : 'length_along_sheet';
            for (const key of row.partKeys) {
                const qty = partQty.get(key) ?? 1;
                for (let k = 1; k <= qty; k++) {
                    items.push({
                        rowKey: row.rowKey,
                        partKey: k === 1 ? key : `${key}#${k}`,
                        length: row.cutLength,
                        width: row.cutWidth,
                        rotation,
                    });
                }
            }
        }
        const nested = nestMaterial(
            items,
            {
                materialCode: code,
                sheetLength: material.sheetLengthMm,
                sheetWidth: material.sheetWidthMm,
            },
            { kerf, trim },
        );
        result.sheets.push(...nested.sheets);
        result.unplaced.push(...nested.unplaced);
    }
    result.unplaced.sort(cmpId);
    return result;
}
