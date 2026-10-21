/**
 * Cut sizes (08 §3.2): the edge band thickness is taken off the finished
 * size, and the pre-mill allowance is added back per banded edge. The sums
 * run in whole micrometres so 2 × 0.8 mm is exactly 1600 µm before rounding.
 */
import type { CatalogSnapshot } from '../catalog/snapshot';
import { indexCatalog } from '../furniture/catalogIndex';
import type { EdgeId } from '../furniture/schema';
import type { Part } from '../furniture/types';
import { roundHalfUpDiv } from '../money';

/**
 * Band thickness in µm; 0 for no band. A code the catalog does not know
 * counts as 0 mm thick (the model already reports `furniture.unknown_code`).
 */
function bandUm(catalog: CatalogSnapshot, code: string | null): number {
    if (code === null) return 0;
    const band = indexCatalog(catalog).edgeBand(code);
    return band ? Math.round(band.thicknessMm * 1000) : 0;
}

function deltaUm(
    part: Part,
    catalog: CatalogSnapshot,
    pmUm: number,
    edges: readonly EdgeId[],
): number {
    let sum = 0;
    for (const e of edges) {
        const code = part.edges[e];
        if (code !== null) sum += bandUm(catalog, code) - pmUm;
    }
    return sum;
}

/**
 * Cut size of `part`: bands on the short edges `W1/W2` shorten the length,
 * bands on the long edges `L1/L2` the width. `premillMm` is
 * `pricing.edgePremillMm` (0 = no pre-mill).
 */
export function cutSize(
    part: Part,
    catalog: CatalogSnapshot,
    premillMm: number,
): { cutLength: number; cutWidth: number } {
    const pmUm = premillMm * 1000;
    const lenUm = deltaUm(part, catalog, pmUm, ['W1', 'W2']);
    const widUm = deltaUm(part, catalog, pmUm, ['L1', 'L2']);
    return {
        cutLength: part.length - roundHalfUpDiv(lenUm, 1000),
        cutWidth: part.width - roundHalfUpDiv(widUm, 1000),
    };
}
