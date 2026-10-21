import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as money from '../money';
import {
    applyBps,
    ceilDiv,
    multiplyMinor,
    roundHalfUpDiv,
    roundUpToStep,
} from '../money';

interface MoneyCase {
    fn: string;
    args: number[];
    expected: number;
}

const cases = JSON.parse(
    readFileSync(
        new URL(
            '../../../../tests/fixtures/money/minor-math.json',
            import.meta.url,
        ),
        'utf8',
    ),
) as MoneyCase[];

describe('shared money fixtures (minor-math.json)', () => {
    it('is non-empty and only names exported integer helpers', () => {
        expect(cases.length).toBeGreaterThan(0);
        for (const c of cases) {
            expect(typeof (money as Record<string, unknown>)[c.fn]).toBe(
                'function',
            );
            expect(c.args.every(Number.isInteger)).toBe(true);
        }
    });

    it.each(cases)('$fn($args) = $expected', ({ fn, args, expected }) => {
        const f = (
            money as unknown as Record<string, (...a: number[]) => number>
        )[fn]!;
        expect(f(...args)).toBe(expected);
    });
});

describe('multiplyMinor (TS-only display helper)', () => {
    it.each([
        [1000, 1.005, 1005],
        [1000, 0, 0],
        [-1000, 1.005, -1005],
        [999, 0.5, 500],
        [100, 1, 100],
    ])('multiplyMinor(%d, %d) = %d', (amount, factor, expected) => {
        expect(multiplyMinor(amount, factor)).toBe(expected);
    });

    it('rejects non-integer amounts and non-finite factors', () => {
        expect(() => multiplyMinor(1.5, 2)).toThrow(RangeError);
        expect(() => multiplyMinor(100, Number.NaN)).toThrow(RangeError);
        expect(() => multiplyMinor(100, Infinity)).toThrow(RangeError);
    });
});

describe('input validation', () => {
    it('roundHalfUpDiv rejects a zero or negative divisor', () => {
        expect(() => roundHalfUpDiv(1, 0)).toThrow(RangeError);
        expect(() => roundHalfUpDiv(1, -2)).toThrow(RangeError);
    });

    it('roundHalfUpDiv rejects non-integer inputs', () => {
        expect(() => roundHalfUpDiv(1.5, 2)).toThrow(RangeError);
        expect(() => roundHalfUpDiv(1, 2.5)).toThrow(RangeError);
        expect(() => roundHalfUpDiv(Number.NaN, 2)).toThrow(RangeError);
    });

    it('ceilDiv rejects negative numerators and non-positive divisors', () => {
        expect(() => ceilDiv(-1, 2)).toThrow(RangeError);
        expect(() => ceilDiv(1, 0)).toThrow(RangeError);
    });

    it('roundUpToStep rejects non-integer inputs', () => {
        expect(() => roundUpToStep(1.5, 100)).toThrow(RangeError);
        expect(() => roundUpToStep(100, 0.5)).toThrow(RangeError);
    });

    it('throws RangeError when the result exceeds MAX_SAFE_INTEGER', () => {
        expect(() => roundHalfUpDiv(Number.MAX_SAFE_INTEGER, 1)).not.toThrow();
        expect(() => applyBps(Number.MAX_SAFE_INTEGER, 20000)).toThrow(
            RangeError,
        );
        expect(() => roundUpToStep(Number.MAX_SAFE_INTEGER, 10)).toThrow(
            RangeError,
        );
    });
});
