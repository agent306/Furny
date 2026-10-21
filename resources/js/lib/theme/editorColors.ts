import { useTheme } from '@/composables/useTheme';

/**
 * Every editor colour token of 15 §3.1, by CSS variable name (`--wall` → `wall`).
 * The P2 engine's drawing model uses these names; `editorColors.test.ts` pins them.
 */
export const EDITOR_COLOR_KEYS = [
    'canvas-bg',
    'canvas-grid-minor',
    'canvas-grid-major',
    'canvas-axis',
    'wall',
    'wall-stroke',
    'wall-exterior-hatch',
    'wall-half',
    'opening-door',
    'opening-window',
    'opening-gap',
    'placement-fill',
    'placement-stroke',
    'fixture-fill',
    'fixture-stroke',
    'selection',
    'selection-fill',
    'hover-outline',
    'snap-guide',
    'snap-point',
    'dimension',
    'dimension-text',
    'measure',
    'label-text',
    'confidence-high',
    'confidence-med',
    'confidence-low',
    'diff-added',
    'diff-changed',
    'diff-removed',
    'diff-removed-ghost',
    'room-living',
    'room-bedroom',
    'room-kitchen',
    'room-bath',
    'room-outdoor',
    'room-utility',
    'room-study',
    'room-pooja',
    'room-circulation',
    'room-other',
    'room-label',
] as const;

export type EditorColorKey = (typeof EDITOR_COLOR_KEYS)[number];

/**
 * The 19 room types of 03 §1 / 15 §3.4. The P2 engine's `RoomType` must equal
 * this union; P4 then switches `roomTypeToColorKey` to the engine type.
 */
export const EDITOR_ROOM_TYPES = [
    'living',
    'dining',
    'bedroom',
    'master_bedroom',
    'dress',
    'kitchen',
    'bathroom',
    'toilet',
    'balcony',
    'deck',
    'utility',
    'store',
    'garage',
    'ots',
    'study',
    'pooja',
    'foyer',
    'corridor',
    'other',
] as const;

export type EditorRoomType = (typeof EDITOR_ROOM_TYPES)[number];

const ROOM_TYPE_COLOR_KEY: Readonly<Record<EditorRoomType, EditorColorKey>> = {
    living: 'room-living',
    dining: 'room-living',
    bedroom: 'room-bedroom',
    master_bedroom: 'room-bedroom',
    dress: 'room-bedroom',
    kitchen: 'room-kitchen',
    bathroom: 'room-bath',
    toilet: 'room-bath',
    balcony: 'room-outdoor',
    deck: 'room-outdoor',
    utility: 'room-utility',
    store: 'room-utility',
    garage: 'room-utility',
    ots: 'room-utility',
    study: 'room-study',
    pooja: 'room-pooja',
    foyer: 'room-circulation',
    corridor: 'room-circulation',
    other: 'room-other',
};

export function roomTypeToColorKey(type: EditorRoomType): EditorColorKey {
    return ROOM_TYPE_COLOR_KEY[type];
}

/**
 * The light palette, copied from the `:root` block of app.css (`var()`
 * references resolved). Every export (PNG/SVG/PDF/print) uses it, whatever
 * the viewer's theme (15 §1). `editorColors.test.ts` keeps it in sync.
 */
export const EXPORT_PALETTE: Readonly<Record<EditorColorKey, string>> =
    Object.freeze({
        'canvas-bg': 'oklch(0.99 0.003 85)',
        'canvas-grid-minor': 'oklch(0.94 0.005 80)',
        'canvas-grid-major': 'oklch(0.88 0.008 80)',
        'canvas-axis': 'oklch(0.80 0.010 80)',
        wall: 'oklch(0.30 0.010 60)',
        'wall-stroke': 'oklch(0.20 0.010 60)',
        'wall-exterior-hatch': 'oklch(0.55 0.010 60)',
        'wall-half': 'oklch(0.55 0.010 60)',
        'opening-door': 'oklch(0.35 0.015 60)',
        'opening-window': 'oklch(0.55 0.090 220)',
        'opening-gap': 'oklch(0.99 0.003 85)',
        'placement-fill': 'oklch(0.88 0.045 65)',
        'placement-stroke': 'oklch(0.45 0.065 50)',
        'fixture-fill': 'oklch(0.95 0.004 80)',
        'fixture-stroke': 'oklch(0.60 0.010 60)',
        selection: 'oklch(0.60 0.170 250)',
        'selection-fill': 'oklch(0.60 0.170 250 / 0.14)',
        'hover-outline': 'oklch(0.60 0.170 250 / 0.55)',
        'snap-guide': 'oklch(0.62 0.240 330)',
        'snap-point': 'oklch(0.62 0.240 330)',
        dimension: 'oklch(0.42 0.030 250)',
        'dimension-text': 'oklch(0.30 0.030 250)',
        measure: 'oklch(0.55 0.180 40)',
        'label-text': 'oklch(0.30 0.012 60)',
        'confidence-high': 'oklch(0.58 0.130 150)',
        'confidence-med': 'oklch(0.72 0.150 70)',
        'confidence-low': 'oklch(0.58 0.210 27)',
        'diff-added': 'oklch(0.62 0.160 150)',
        'diff-changed': 'oklch(0.75 0.150 75)',
        'diff-removed': 'oklch(0.60 0.200 27)',
        'diff-removed-ghost': 'oklch(0.60 0.200 27 / 0.25)',
        'room-living': 'oklch(0.955 0.030 85)',
        'room-bedroom': 'oklch(0.950 0.025 250)',
        'room-kitchen': 'oklch(0.955 0.035 55)',
        'room-bath': 'oklch(0.950 0.030 205)',
        'room-outdoor': 'oklch(0.950 0.040 140)',
        'room-utility': 'oklch(0.945 0.008 80)',
        'room-study': 'oklch(0.950 0.025 300)',
        'room-pooja': 'oklch(0.955 0.035 30)',
        'room-circulation': 'oklch(0.970 0.008 80)',
        'room-other': 'oklch(0.965 0.004 80)',
        'room-label': 'oklch(0.32 0.015 60)',
    });

let cache: {
    resolved: string;
    colors: Record<EditorColorKey, string>;
} | null = null;

/**
 * Current editor colours as CSS strings, read from the document's resolved
 * theme. Cached; the cache is dropped when the resolved theme changes.
 */
export function readEditorColors(): Record<EditorColorKey, string> {
    const { resolved } = useTheme();

    if (cache?.resolved === resolved.value) {
        return cache.colors;
    }

    const style =
        typeof document === 'undefined'
            ? null
            : getComputedStyle(document.documentElement);
    const colors = Object.fromEntries(
        EDITOR_COLOR_KEYS.map((key) => [
            key,
            style?.getPropertyValue(`--${key}`).trim() || EXPORT_PALETTE[key],
        ]),
    ) as Record<EditorColorKey, string>;

    cache = { resolved: resolved.value, colors };

    return colors;
}

function parseHex(css: string): number | null {
    const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(css.trim());
    const digits = match?.[1];

    if (!digits) {
        return null;
    }

    return parseInt(
        digits.length === 3
            ? [...digits].map((digit) => digit + digit).join('')
            : digits,
        16,
    );
}

/**
 * Converts any CSS colour (including oklch) to a three.js-compatible sRGB hex
 * number by painting it on a 1×1 canvas. Alpha is ignored.
 */
export function cssColorToHex(css: string): number {
    const hex = parseHex(css);

    if (hex !== null) {
        return hex;
    }

    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true });

    if (!context) {
        throw new Error('A 2D canvas is required to convert CSS colours.');
    }

    context.clearRect(0, 0, 1, 1);
    context.fillStyle = css;
    context.fillRect(0, 0, 1, 1);
    const [r = 0, g = 0, b = 0] = context.getImageData(0, 0, 1, 1).data;

    return (r << 16) | (g << 8) | b;
}
