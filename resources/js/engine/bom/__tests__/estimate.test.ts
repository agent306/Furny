import { describe, expect, it } from 'vitest';
import { generateFurniture } from '../../furniture/generate';
import { wardrobeFixture } from '../../furniture/testing/docs';
import { seedCatalog } from '../../testing/seedCatalog';
import { bomOptionsFor, computeBom } from '../bom';
import { estimateFurniture } from '../estimate';
import { priceBom } from '../pricing';

const catalog = seedCatalog();
const doc = wardrobeFixture();

describe('estimateFurniture (07 §8.10)', () => {
    const { bom, price } = estimateFurniture(doc, catalog);

    it('returns the nested BOM and the unit price without installation', () => {
        expect(bom.nesting).not.toBeNull();
        expect(price.unitPriceMinor).toBe(2431300);
        expect(price.installationMinor).toBe(0);
        expect(price.quantity).toBe(1);
        expect(price.totalBeforeTaxMinor).toBe(2431300);
    });

    it('equals the quote: the same document without nesting prices identically (master §2.1)', () => {
        const model = generateFurniture(doc, catalog);
        const plain = computeBom(model, catalog, bomOptionsFor(doc, false));
        const quote = priceBom(plain, catalog, catalog.pricing, {
            quantity: 1,
            includeInstallation: false,
        });
        expect(plain.nesting).toBeNull();
        expect(quote).toEqual(price);
    });
});
