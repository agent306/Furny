import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    computeQuoteTotals,
    parseQuantityMilli,
    type QuoteTotals,
    type QuoteTotalsInput,
} from '../quoteTotals';

interface QuoteFixture extends QuoteTotalsInput {
    description: string;
    expected: QuoteTotals | { error: string };
}

const dir = join(import.meta.dirname, '../../../../tests/fixtures/quotes');
const files = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort();

describe('shared quote fixtures (tests/fixtures/quotes)', () => {
    it('finds every required fixture', () => {
        expect(files).toEqual([
            'discount-exceeds.json',
            'exclusive-two-rates.json',
            'fractional-qty.json',
            'hidden-lines.json',
            'inclusive-two-rates.json',
            'untaxed-group.json',
        ]);
    });

    it.each(files)('%s', (file) => {
        const fx = JSON.parse(
            readFileSync(join(dir, file), 'utf8'),
        ) as QuoteFixture;
        const result = computeQuoteTotals(fx);
        if ('error' in fx.expected) {
            expect(result).toEqual({ ok: false, code: fx.expected.error });
        } else {
            expect(result).toEqual({ ok: true, totals: fx.expected });
        }
    });
});

describe('parseQuantityMilli', () => {
    it('parses exact decimals', () => {
        expect(parseQuantityMilli('2.5')).toBe(2500);
        expect(parseQuantityMilli('0.001')).toBe(1);
        expect(parseQuantityMilli('3')).toBe(3000);
        expect(parseQuantityMilli('9999999.999')).toBe(9_999_999_999);
    });

    it('rejects more than 3 decimals and malformed input', () => {
        expect(() => parseQuantityMilli('1.0001')).toThrow(RangeError);
        expect(() => parseQuantityMilli('')).toThrow(RangeError);
        expect(() => parseQuantityMilli('-1')).toThrow(RangeError);
        expect(() => parseQuantityMilli('1e3')).toThrow(RangeError);
        expect(() => parseQuantityMilli('1.')).toThrow(RangeError);
    });
});
