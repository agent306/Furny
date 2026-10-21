import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as money from '../money';
import {
    applyBps,
    ceilDiv,
    ceilDivBig,
    multiplyMinor,
    product,
    roundHalfUpDiv,
    roundUpToStep,
    toSafeNumber,
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

// Exact integer products for BOM totals (08 §1); they lived in bom/intMath.ts before the dedupe.
describe('BOM integer helpers (08 §1)', () => {
    it('multiplies exactly beyond 2^53', () => {
        // 2^30 × 2^30 × 3 = 3 458 764 513 820 540 928 (not representable as a double product chain)
        expect(product(2 ** 30, 2 ** 30, 3)).toBe(3458764513820540928n);
        expect(product()).toBe(1n);
        // 3 × (2^53 − 1) − 2 is not exact as a double; ceil(… / 3) = 2^53 − 1 exactly
        expect((2 ** 53 - 1) * 3 - 2).not.toBe(
            Number(product(2 ** 53 - 1, 3) - 2n),
        );
        expect(ceilDivBig(product(2 ** 53 - 1, 3) - 2n, 3n)).toBe(2 ** 53 - 1);
    });

    it('rejects operands that are not safe integers', () => {
        expect(() => product(1.5)).toThrow(RangeError);
        expect(() => product(2 ** 53)).toThrow(RangeError);
        expect(() => product(35.00000000000001)).toThrow(RangeError);
        expect(() => product(1.5)).toThrow(
            'operand must be a safe integer, got 1.5',
        );
    });

    it('rounds up, and refuses results outside the safe range', () => {
        expect(ceilDivBig(0n, 7n)).toBe(0);
        expect(ceilDivBig(7n, 7n)).toBe(1);
        expect(ceilDivBig(8n, 7n)).toBe(2);
        expect(() => ceilDivBig(-1n, 7n)).toThrow(RangeError);
        expect(() => ceilDivBig(1n, 0n)).toThrow(RangeError);
        expect(() => toSafeNumber(2n ** 53n)).toThrow(RangeError);
        expect(toSafeNumber(-(2n ** 53n - 1n))).toBe(-(2 ** 53 - 1));
    });

    it('ceilDiv keeps checking its numerator before its divisor', () => {
        expect(() => ceilDiv(-1, 0)).toThrow('n must be >= 0, got -1');
    });
});
