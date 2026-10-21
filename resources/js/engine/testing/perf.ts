/**
 * Fixtures of the performance budgets (16 §10; 04 §7.3, 07 §12.7, 08 §9.3).
 * Test-only; not exported from the engine index.
 */
import { templateWardrobe } from '../furniture/testing/docs';
import type { FurnitureDocument } from '../furniture/schema';
import type { CutListRow } from '../bom/types';

/** The 3600 x 2400 six-door wardrobe of 07 §12.7 (about 50 parts). */
export function perfWardrobe(): FurnitureDocument {
    return templateWardrobe({
        width: 3600,
        height: 2400,
        doors: 6,
        internalDrawers: 4,
        hangingStyle: 'double',
    });
}

/** `count` single-quantity cut-list rows of one material, sizes drawn from `random`. */
export function randomParts(count: number, random: () => number): CutListRow[] {
    return Array.from({ length: count }, (_, i) => {
        const cutLength = 150 + Math.floor(random() * 1050);
        const cutWidth = 80 + Math.floor(random() * 520);
        return {
            rowKey: `r${String(i).padStart(8, '0')}`,
            partKeys: [`p${i}`],
            name: `Part ${i}`,
            nameKey: 'parts.extra',
            nameParams: {},
            materialCode: 'PB18-WHITE',
            thickness: 18,
            length: cutLength,
            width: cutWidth,
            cutLength,
            cutWidth,
            qty: 1,
            grain: 'none',
            edges: { L1: null, L2: null, W1: null, W2: null },
        };
    });
}
