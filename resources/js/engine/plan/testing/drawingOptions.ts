import type { DrawingOptions, StyleKey } from '../drawing/types';
import type { FootprintSize } from '../footprint';

/**
 * Test-only `DrawingOptions` (04 §8.1): metric millimetres, fixed strings,
 * fixed text sizes and every layer on. Not exported from the engine index.
 */

/** Furniture designs the default `footprints` provider knows. */
export const TEST_DESIGN_SIZES: Readonly<Record<string, FootprintSize>> = {
    sofa: { width: 1000, depth: 500, height: 750 },
    wardrobe: { width: 1200, depth: 600, height: 2100 },
};

export const TEST_TEXT_SIZES: Readonly<Partial<Record<StyleKey, number>>> = {
    room_name: 200,
    room_area: 160,
    room_dims: 160,
    furniture_label: 140,
    dim_text: 150,
};

const DEFAULT_TEXT_SIZE = 150;

export function testDrawingOptions(
    overrides: Partial<DrawingOptions> = {},
): DrawingOptions {
    return {
        units: { system: 'metric', unit: 'mm', locale: 'en' },
        strings: { unnamedRoom: 'Room', missingDesign: 'Missing design' },
        footprints: (designId) => TEST_DESIGN_SIZES[designId] ?? null,
        designName: (designId) =>
            designId in TEST_DESIGN_SIZES
                ? designId.charAt(0).toUpperCase() + designId.slice(1)
                : null,
        textSizeMm: (style) => TEST_TEXT_SIZES[style] ?? DEFAULT_TEXT_SIZE,
        include: {
            background: null,
            rooms: true,
            roomAreas: true,
            roomDims: true,
            furniture: true,
            fixtures: true,
            doorSwings: true,
            autoDimensions: true,
            userDimensions: true,
            labels: true,
        },
        lod: 0,
        ...overrides,
    };
}
