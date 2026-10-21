import { clampRgb, parse, wcagContrast } from 'culori';
import { describe, expect, it } from 'vitest';
import {
    darkTokens,
    findRule,
    lightTokens,
    parseDeclarations,
    type Declarations,
} from '@/test/cssTokens';

// Pairs of 15 §14.6: [foreground, background, minimum ratio].
const STATUSES = ['success', 'warning', 'danger', 'info'] as const;
const ROOMS = [
    'living',
    'bedroom',
    'kitchen',
    'bath',
    'outdoor',
    'utility',
    'study',
    'pooja',
    'circulation',
    'other',
] as const;

const PAIRS: ReadonlyArray<readonly [string, string, number]> = [
    ...['background', 'card', 'muted'].flatMap(
        (surface) =>
            [
                ['foreground', surface, 4.5],
                ['muted-foreground', surface, 4.5],
            ] as const,
    ),
    ['primary-foreground', 'primary', 4.5],
    ...STATUSES.flatMap(
        (status) =>
            [
                [`${status}-foreground`, status, 4.5],
                [`${status}-subtle-foreground`, `${status}-subtle`, 4.5],
            ] as const,
    ),
    ['accent-foreground', 'accent', 4.5],
    ['ring', 'background', 3.0],
    ['border', 'background', 1.3],
    ...ROOMS.map((room) => ['room-label', `room-${room}`, 4.5] as const),
    ['dimension-text', 'canvas-bg', 4.5],
];

function ratio(tokens: Declarations, foreground: string, background: string) {
    const colour = (name: string) => {
        const value = tokens[`--${name}`];
        const parsed = value ? parse(value) : undefined;

        if (!parsed) {
            throw new Error(`Token --${name} is missing or not a colour`);
        }

        return clampRgb(parsed);
    };

    return wcagContrast(colour(foreground), colour(background));
}

describe.each([
    ['light', lightTokens],
    ['dark', darkTokens],
] as const)('%s theme contrast (15 §14.6)', (_theme, load) => {
    const tokens = load();

    it.each(PAIRS)('%s on %s is at least %d:1', (fg, bg, minimum) => {
        expect(ratio(tokens, fg, bg)).toBeGreaterThanOrEqual(minimum);
    });
});

describe('print token block (15 §16)', () => {
    it('is an exact copy of the light :root block, applied to :root and .dark', () => {
        const root = parseDeclarations(findRule(':root').body);
        const print = parseDeclarations(
            findRule(':root, .dark', '@media print').body,
        );

        expect(Object.keys(root).length).toBeGreaterThan(100);
        expect(print).toEqual(root);
    });
});
