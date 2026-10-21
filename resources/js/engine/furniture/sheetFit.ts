/**
 * Sheet fit test (07 §3.4.1), shared by the back split and by the model-level
 * rule `furniture.part_exceeds_sheet`.
 */
import type { CatalogMaterial } from '../catalog/snapshot';
import type { PartGrain } from './types';

/**
 * Whether a finished `a x b` part fits the usable area of one sheet of `m`:
 * the sheet less `trim` (`pricing.sheetTrimMm`) on every edge. Fit uses
 * finished sizes; the <= 2 mm difference to cut sizes is absorbed by the trim.
 *
 * With a grained material the part's grain direction fixes its orientation:
 * `length` keeps the longer side along the sheet length, `width` puts the
 * shorter side there. Otherwise the part rotates freely, and the longer side
 * along the sheet length is always the best orientation.
 */
export function fitsSheet(
    a: number,
    b: number,
    m: CatalogMaterial,
    grain: PartGrain,
    trim: number,
): boolean {
    const usableLength = m.sheetLengthMm - 2 * trim;
    const usableWidth = m.sheetWidthMm - 2 * trim;
    const longSide = Math.max(a, b);
    const shortSide = Math.min(a, b);
    if (m.hasGrain && grain === 'length') {
        return longSide <= usableLength && shortSide <= usableWidth;
    }
    if (m.hasGrain && grain === 'width') {
        return shortSide <= usableLength && longSide <= usableWidth;
    }
    return longSide <= usableLength && shortSide <= usableWidth;
}
