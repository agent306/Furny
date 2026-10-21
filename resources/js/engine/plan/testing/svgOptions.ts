import type { StyleKey } from '../drawing/types';
import { STYLE_KEYS } from '../drawing/types';
import type { SvgExportOptions, SvgStyle } from '../drawing/svg';

/**
 * Test-only SVG export options (04 §8.3): a fixed palette and a fixed style
 * table, so the SVG tests never depend on the app theme. Not exported from the
 * engine index.
 */

/**
 * Palette of the tests: the room fill tokens (15 §3.4) and one token `cRRGGBB`
 * per style colour, which resolves to `#RRGGBB`. Style colours are palette
 * tokens (an unknown one throws), so the styles below name tokens only.
 */
export const TEST_PALETTE: Readonly<Record<string, string>> = {
    'room-living': '#F5EFE4',
    'room-bedroom': '#E8EEF6',
    'room-kitchen': '#F6ECE3',
    'room-bath': '#E2F0F0',
    'room-outdoor': '#ECF3E6',
    'room-utility': '#F6ECE3',
    'room-study': '#E8EEF6',
    'room-pooja': '#F8EDF2',
    'room-circulation': '#F5EFE4',
    'room-other': '#F2F2F2',
    c111827: '#111827',
    c1A1A1A: '#1A1A1A',
    c1F2937: '#1F2937',
    c262626: '#262626',
    c374151: '#374151',
    c3B3B3B: '#3B3B3B',
    c3C7CC0: '#3C7CC0',
    c4B5563: '#4B5563',
    c5A5A5A: '#5A5A5A',
    c5B8DB8: '#5B8DB8',
    c5C4630: '#5C4630',
    c6B7280: '#6B7280',
    c8A6A43: '#8A6A43',
    c8C8C8C: '#8C8C8C',
    c9CA3AF: '#9CA3AF',
    cCFE3F2: '#CFE3F2',
    cDC2626: '#DC2626',
    cF2F2F2: '#F2F2F2',
    cF3E9DA: '#F3E9DA',
    cFBFAF8: '#FBFAF8',
    cFEE2E2: '#FEE2E2',
    cFFFFFF: '#FFFFFF',
};

const INK = 'c1A1A1A';

const none: SvgStyle = {
    stroke: null,
    strokeWidthMm: 0,
    fill: null,
    dash: null,
};

const stroked = (stroke: string, strokeWidthMm: number): SvgStyle => ({
    ...none,
    stroke,
    strokeWidthMm,
});

const filled = (fill: string): SvgStyle => ({ ...none, fill });

export const TEST_STYLES: Readonly<Record<StyleKey, SvgStyle>> = {
    wall: filled('c3B3B3B'),
    wall_exterior: {
        ...filled('c262626'),
        hatch: { angleDeg: 45, spacingMm: 60, color: 'c5A5A5A' },
    },
    wall_half: filled('c8C8C8C'),
    wall_glass: { ...stroked('c5B8DB8', 0.26), fill: 'cCFE3F2' },
    wall_outline: stroked(INK, 0.33),
    opening_jamb: stroked(INK, 0.26),
    door_leaf: stroked(INK, 0.4),
    door_swing: stroked(INK, 0.2),
    door_main_leaf: stroked(INK, 0.66),
    sliding_panel: { ...stroked(INK, 0.26), fill: 'cFFFFFF' },
    window_frame: stroked(INK, 0.26),
    window_glass: stroked('c3C7CC0', 0.26),
    threshold: stroked(INK, 0.26),
    room_fill: filled('cF2F2F2'),
    room_name: { ...filled('c1F2937'), fontWeight: 600 },
    room_area: filled('c4B5563'),
    room_dims: filled('c6B7280'),
    furniture: { ...stroked('c8A6A43', 0.33), fill: 'cF3E9DA' },
    furniture_front: { ...stroked('c8A6A43', 0.66), fill: 'c8A6A43' },
    furniture_label: filled('c5C4630'),
    furniture_missing: {
        ...stroked('cDC2626', 0.33),
        fill: 'cFEE2E2',
        dash: [6, 4],
    },
    fixture: { ...stroked('c6B7280', 0.26), fill: 'cFFFFFF' },
    fixture_detail: stroked('c9CA3AF', 0.2),
    dim_line: stroked('c6B7280', 0.2),
    dim_tick: stroked('c6B7280', 0.2),
    dim_text: { ...filled('c374151'), stroke: 'cFBFAF8', strokeWidthMm: 0.8 },
    dim_ext: stroked('c6B7280', 0.2),
    label: filled('c111827'),
};

// Every style key must be covered; a missing one fails the type check above,
// and this guards the runtime list.
for (const key of STYLE_KEYS) {
    if (!(key in TEST_STYLES)) throw new Error(`no test style for ${key}`);
}

export function testSvgOptions(
    overrides: Partial<SvgExportOptions> = {},
): SvgExportOptions {
    return {
        viewBox: { min: { x: -500, y: -500 }, max: { x: 10500, y: 8500 } },
        widthPx: 1100,
        heightPx: 900,
        styles: TEST_STYLES,
        background: '#ffffff',
        fontFamily: 'Inter, Arial, sans-serif',
        palette: TEST_PALETTE,
        ...overrides,
    };
}
