/**
 * Test-only builder for BOM inputs: a box part with sensible defaults, so a
 * test states only the fields it is about.
 */
import type { EdgeId } from '../../furniture/schema';
import type { Part } from '../../furniture/types';

export const NO_EDGES: Record<EdgeId, string | null> = {
    L1: null,
    L2: null,
    W1: null,
    W2: null,
};

export function panel(over: Partial<Part> = {}): Part {
    const length = over.length ?? 1000;
    const width = over.width ?? 500;
    const thickness = over.thickness ?? 18;
    return {
        key: 'test.part',
        nameKey: 'parts.extra',
        nameParams: { name: 'Test part' },
        role: 'carcass',
        materialCode: 'PB18-WHITE',
        thickness,
        length,
        width,
        grain: 'none',
        edges: { ...NO_EDGES },
        qty: 1,
        geometry: {
            kind: 'box',
            box: { min: [0, 0, 0], size: [length, thickness, width] },
        },
        operations: {
            hingeCups: 0,
            shelfPinHoles: 0,
            slideScrewSets: 0,
            handleHoles: 0,
            dowels: 0,
            camLocks: 0,
        },
        visibleFaces: 1,
        source: 'generated',
        overridden: false,
        ...over,
    };
}
