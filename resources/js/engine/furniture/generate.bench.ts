/**
 * Furniture budgets (07 §12.7). `yarn bench:check` asserts them against
 * `bench-thresholds.json` (16 §10); the bench names are the threshold keys.
 */
import { bench, describe } from 'vitest';
import { estimateFurniture } from '../bom/estimate';
import { seedCatalog } from '../testing/seedCatalog';
import { perfWardrobe } from '../testing/perf';
import { generateFurniture } from './generate';

const catalog = seedCatalog();
const wardrobe = perfWardrobe();

describe('furniture (07 §12.7)', () => {
    bench('generateFurniture wardrobe', () => {
        generateFurniture(wardrobe, catalog);
    });
    bench('estimateFurniture wardrobe', () => {
        estimateFurniture(wardrobe, catalog);
    });
});
