/**
 * `estimateFurniture` (07 §8.10): the live estimate pipeline, one call for the
 * worker RPC. Pure; the quote uses the same functions (master §2.1).
 */
import type { CatalogSnapshot } from '../catalog/snapshot';
import { generateFurniture } from '../furniture/generate';
import type { FurnitureDocument } from '../furniture/schema';
import { bomOptionsFor, computeBom } from './bom';
import { priceBom, type PriceBreakdown } from './pricing';
import type { Bom } from './types';

/** Generate, compute the BOM with nesting, and price one item without installation. */
export function estimateFurniture(
    doc: FurnitureDocument,
    catalog: CatalogSnapshot,
): { bom: Bom; price: PriceBreakdown } {
    const model = generateFurniture(doc, catalog);
    const bom = computeBom(model, catalog, bomOptionsFor(doc, true));
    const price = priceBom(bom, catalog, catalog.pricing, {
        quantity: 1,
        includeInstallation: false,
    });
    return { bom, price };
}
