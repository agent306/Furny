/**
 * BOM budget (08 §9.3). `yarn bench:check` asserts it against
 * `bench-thresholds.json` (16 §10); the bench name is the threshold key.
 */
import { bench, describe } from 'vitest';
import { generateFurniture } from '../furniture/generate';
import { perfWardrobe } from '../testing/perf';
import { seedCatalog } from '../testing/seedCatalog';
import { bomOptionsFor, computeBom } from './bom';

const catalog = seedCatalog();
const wardrobe = perfWardrobe();
const model = generateFurniture(wardrobe, catalog);
const options = bomOptionsFor(wardrobe, false);

describe('bom (08 §9.3)', () => {
    bench('computeBom without nesting wardrobe', () => {
        computeBom(model, catalog, options);
    });
});
