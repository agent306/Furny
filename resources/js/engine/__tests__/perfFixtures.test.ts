import { describe, expect, it } from 'vitest';
import { generateFurniture } from '../furniture/generate';
import { mulberry32 } from '../testing/random';
import { perfWardrobe, randomParts } from '../testing/perf';
import { seedCatalog } from '../testing/seedCatalog';

describe('performance fixtures (16 §10)', () => {
    it('perfWardrobe is the 6-door wardrobe of 45 to 70 parts', () => {
        const model = generateFurniture(perfWardrobe(), seedCatalog());
        expect(model.parts.length).toBeGreaterThanOrEqual(45);
        expect(model.parts.length).toBeLessThanOrEqual(70);
    });

    it('randomParts is deterministic for a seed', () => {
        const a = randomParts(300, mulberry32(5));
        expect(a).toHaveLength(300);
        expect(randomParts(300, mulberry32(5))).toEqual(a);
    });
});
