/**
 * Nesting budget (08 §9.3). `yarn bench:check` asserts it against
 * `bench-thresholds.json` (16 §10); the bench name is the threshold key.
 */
import { bench, describe } from 'vitest';
import { mulberry32 } from '../../testing/random';
import { randomParts } from '../../testing/perf';
import { seedCatalog } from '../../testing/seedCatalog';
import { nestSheets } from './index';

const catalog = seedCatalog();
const rows = randomParts(300, mulberry32(5));
const options = { kerf: 4, trim: 10, allowRotation: true };

describe('nesting (08 §9.3)', () => {
    bench('nestSheets 300 random parts', () => {
        nestSheets(rows, new Map(), catalog, options);
    });
});
