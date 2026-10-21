import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    EDITOR_COLOR_KEYS,
    EDITOR_ROOM_TYPES,
    EXPORT_PALETTE,
    cssColorToHex,
    readEditorColors,
    roomTypeToColorKey,
    type EditorColorKey,
    type EditorRoomType,
} from '@/lib/theme/editorColors';
import { useTheme } from '@/composables/useTheme';
import { lightTokens } from '@/test/cssTokens';

// Pinned independently of the implementation: the P2 engine's drawing model
// uses these exact names (15 §3.5, 03 §1), so a rename must fail here.
const SPEC_COLOR_KEYS = [
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
];

const SPEC_ROOM_TYPES = [
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
];

// 15 §3.4, one row per room type.
const ROOM_TYPE_TOKENS: ReadonlyArray<
    readonly [EditorRoomType, EditorColorKey]
> = [
    ['living', 'room-living'],
    ['dining', 'room-living'],
    ['bedroom', 'room-bedroom'],
    ['master_bedroom', 'room-bedroom'],
    ['dress', 'room-bedroom'],
    ['kitchen', 'room-kitchen'],
    ['bathroom', 'room-bath'],
    ['toilet', 'room-bath'],
    ['balcony', 'room-outdoor'],
    ['deck', 'room-outdoor'],
    ['utility', 'room-utility'],
    ['store', 'room-utility'],
    ['garage', 'room-utility'],
    ['ots', 'room-utility'],
    ['study', 'room-study'],
    ['pooja', 'room-pooja'],
    ['foyer', 'room-circulation'],
    ['corridor', 'room-circulation'],
    ['other', 'room-other'],
];

describe('editor colour keys', () => {
    it('are exactly the names of 15 §3.5', () => {
        expect([...EDITOR_COLOR_KEYS].sort()).toEqual(
            [...SPEC_COLOR_KEYS].sort(),
        );
    });

    it('all exist as tokens in the :root block of app.css', () => {
        const tokens = lightTokens();

        for (const key of EDITOR_COLOR_KEYS) {
            expect(tokens, key).toHaveProperty(`--${key}`);
        }
    });
});

describe('EXPORT_PALETTE', () => {
    it('equals the :root values parsed from app.css for every EditorColorKey', () => {
        const tokens = lightTokens();
        const expected = Object.fromEntries(
            SPEC_COLOR_KEYS.map((key) => [key, tokens[`--${key}`]]),
        );

        expect(EXPORT_PALETTE).toEqual(expected);
    });

    it('is frozen', () => {
        expect(Object.isFrozen(EXPORT_PALETTE)).toBe(true);
    });
});

describe('room types', () => {
    it('are the 19 values the P2 engine RoomType must equal', () => {
        expect([...EDITOR_ROOM_TYPES]).toEqual(SPEC_ROOM_TYPES);
    });

    it.each(ROOM_TYPE_TOKENS)('%s maps to %s', (type, key) => {
        expect(roomTypeToColorKey(type)).toBe(key);
    });

    it('covers every room type', () => {
        expect(ROOM_TYPE_TOKENS.map(([type]) => type)).toEqual(SPEC_ROOM_TYPES);
    });
});

describe('cssColorToHex', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('reads the sRGB pixel of a 1×1 canvas painted with the colour', () => {
        const fillRect = vi.fn();
        const fillStyle = vi.fn();
        const context = {
            set fillStyle(value: string) {
                fillStyle(value);
            },
            clearRect: vi.fn(),
            fillRect,
            getImageData: () => ({
                data: Uint8ClampedArray.of(0x12, 0xab, 0x3c, 255),
            }),
        };

        vi.spyOn(document, 'createElement').mockReturnValue({
            width: 0,
            height: 0,
            getContext: () => context,
        } as unknown as HTMLCanvasElement);

        expect(cssColorToHex('oklch(0.42 0.065 50)')).toBe(0x12ab3c);
        expect(fillStyle).toHaveBeenCalledWith('oklch(0.42 0.065 50)');
        expect(fillRect).toHaveBeenCalledWith(0, 0, 1, 1);
    });

    it('parses plain hex colours without a canvas', () => {
        const create = vi.spyOn(document, 'createElement');

        expect(cssColorToHex('#fbfaf7')).toBe(0xfbfaf7);
        expect(cssColorToHex('#fff')).toBe(0xffffff);
        expect(create).not.toHaveBeenCalled();
    });
});

describe('readEditorColors', () => {
    afterEach(() => {
        document.documentElement.removeAttribute('style');
        document.documentElement.classList.remove('dark');
        useTheme().setAppearance('light');
    });

    it('reads the values from the document CSS and refreshes when the theme resolves differently', () => {
        const root = document.documentElement;
        root.style.setProperty('--wall', 'oklch(0.3 0.01 60)');
        useTheme().setAppearance('light');

        expect(readEditorColors().wall).toBe('oklch(0.3 0.01 60)');

        // Cached until the resolved theme changes.
        root.style.setProperty('--wall', 'oklch(0.9 0.01 60)');
        expect(readEditorColors().wall).toBe('oklch(0.3 0.01 60)');

        useTheme().setAppearance('dark');
        expect(readEditorColors().wall).toBe('oklch(0.9 0.01 60)');
    });

    it('falls back to the light export palette for tokens the document does not define', () => {
        useTheme().setAppearance('light');

        expect(readEditorColors()['room-label']).toBe(
            EXPORT_PALETTE['room-label'],
        );
    });
});
