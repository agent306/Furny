import { describe, expect, it } from 'vitest';
import { ceilDivBig, product, toSafeNumber } from '../intMath';

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
});
