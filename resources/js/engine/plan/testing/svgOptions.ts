import type { RoomColorKey, StyleKey } from '../drawing/types';
import { STYLE_KEYS } from '../drawing/types';
import type { SvgExportOptions, SvgStyle } from '../drawing/svg';

/**
 * Test-only SVG export options (04 §8.3): a fixed palette and a fixed style
 * table, so the SVG tests never depend on the app theme. Not exported from the
 * engine index.
 */

export const TEST_PALETTE: Readonly<Record<RoomColorKey, string>> = {
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
};

const INK = '#1A1A1A';

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
    wall: filled('#3B3B3B'),
    wall_exterior: {
        ...filled('#262626'),
        hatch: { angleDeg: 45, spacingMm: 60, color: '#5A5A5A' },
    },
    wall_half: filled('#8C8C8C'),
    wall_glass: { ...stroked('#5B8DB8', 0.26), fill: '#CFE3F2' },
    wall_outline: stroked(INK, 0.33),
    opening_jamb: stroked(INK, 0.26),
    door_leaf: stroked(INK, 0.4),
    door_swing: stroked(INK, 0.2),
    door_main_leaf: stroked(INK, 0.66),
    sliding_panel: { ...stroked(INK, 0.26), fill: '#FFFFFF' },
    window_frame: stroked(INK, 0.26),
    window_glass: stroked('#3C7CC0', 0.26),
    threshold: stroked(INK, 0.26),
    room_fill: filled('#F2F2F2'),
    room_name: { ...filled('#1F2937'), fontWeight: 600 },
    room_area: filled('#4B5563'),
    room_dims: filled('#6B7280'),
    furniture: { ...stroked('#8A6A43', 0.33), fill: '#F3E9DA' },
    furniture_front: { ...stroked('#8A6A43', 0.66), fill: '#8A6A43' },
    furniture_label: filled('#5C4630'),
    furniture_missing: {
        ...stroked('#DC2626', 0.33),
        fill: '#FEE2E2',
        dash: [6, 4],
    },
    fixture: { ...stroked('#6B7280', 0.26), fill: '#FFFFFF' },
    fixture_detail: stroked('#9CA3AF', 0.2),
    dim_line: stroked('#6B7280', 0.2),
    dim_tick: stroked('#6B7280', 0.2),
    dim_text: { ...filled('#374151'), stroke: '#FBFAF8', strokeWidthMm: 0.8 },
    dim_ext: stroked('#6B7280', 0.2),
    label: filled('#111827'),
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
