import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../testing/random';
import { formatLength } from '../format';
import { normalizeLengthInput, parseLength } from '../parse';
import {
    PARSE_LENGTH_ERROR_CODES,
    type LengthUnit,
    type ParseLengthContext,
    type ParseLengthErrorCode,
    type UnitPrefs,
} from '../types';

const MM: ParseLengthContext = { unit: 'mm' };

describe('parseLength: 04 §1.5 success rows', () => {
    it.each<[string, ParseLengthContext, number, boolean]>([
        ['3200', MM, 3200, false],
        ['3200mm', MM, 3200, false],
        ['3200 mm', MM, 3200, false],
        ['3200 MM', MM, 3200, false],
        ['320cm', MM, 3200, false],
        ['3.2m', MM, 3200, false],
        ['3,2 m', MM, 3200, false],
        ['3.2 metres', MM, 3200, false],
        ['.5m', MM, 500, false],
        ['3,200', MM, 3200, false],
        ['1,234.5mm', MM, 1235, true],
        ['10\'6"', MM, 3200, true],
        ['10′6″', MM, 3200, true],
        ['10’6”', MM, 3200, true],
        ['10\'-6"', MM, 3200, true],
        ['10 ft 6 in', MM, 3200, true],
        ['10ft6', MM, 3200, true],
        ['10\' 6 1/2"', MM, 3213, true],
        ['10\' 14"', MM, 3404, true],
        ['5\'11.5"', MM, 1816, true],
        ['126in', MM, 3200, true],
        ['10ft', MM, 3048, false],
        ["10'", MM, 3048, false],
        ['6"', MM, 152, true],
        ['1/2"', MM, 13, true],
        ['6 1/2', { unit: 'in' }, 165, true],
        ['6-1/2"', MM, 165, true],
        ['12', { unit: 'cm' }, 120, false],
        ['1.5', { unit: 'm' }, 1500, false],
        ['10', { unit: 'ftin' }, 254, false],
        ['0.5mm', MM, 1, true],
        ['-50', { unit: 'mm', allowNegative: true }, -50, false],
    ])('%j with %j -> %d (rounded %s)', (input, ctx, mm, rounded) => {
        expect(parseLength(input, ctx)).toEqual({ ok: true, mm, rounded });
    });
});

describe('parseLength: 04 §1.5 error rows', () => {
    it.each<[string, ParseLengthContext, ParseLengthErrorCode, object]>([
        ['6 1/2', MM, 'syntax', {}],
        ['-50', MM, 'negative', {}],
        ['0', { unit: 'mm', allowZero: false }, 'zero', {}],
        ['', MM, 'empty', {}],
        ['   ', MM, 'empty', {}],
        ['abc', MM, 'syntax', {}],
        ['3200 kg', MM, 'unknown_unit', { unit: 'kg' }],
        ['1/0"', MM, 'division_by_zero', {}],
        ['3 200', MM, 'syntax', {}],
        ['2000000', MM, 'too_large', { max: 1_000_000 }],
        ['50', { unit: 'mm', min: 300 }, 'too_small', { min: 300 }],
        ['1,2,3', MM, 'syntax', {}],
    ])('%j with %j -> error %s', (input, ctx, code, params) => {
        expect(parseLength(input, ctx)).toEqual({
            ok: false,
            error: {
                code,
                messageKey: `engine.units.error.${code}`,
                params,
            },
        });
    });
});

describe('PARSE_LENGTH_ERROR_CODES', () => {
    it('lists exactly the eight codes of 04 §1.1', () => {
        expect([...PARSE_LENGTH_ERROR_CODES].sort()).toEqual([
            'division_by_zero',
            'empty',
            'negative',
            'syntax',
            'too_large',
            'too_small',
            'unknown_unit',
            'zero',
        ]);
    });
});

describe('parseLength: wider grammar (04 §1.2)', () => {
    it.each<[string, ParseLengthContext, number]>([
        ['1/2in', MM, 13],
        ['3 millimetres', MM, 3],
        ['3 millimeters', MM, 3],
        ['2 centimetres', MM, 20],
        ['2 centimeters', MM, 20],
        ['2 meters', MM, 2000],
        ['2 metre', MM, 2000],
        ['10 feet 6 inches', MM, 3200],
        ['10 foot', MM, 3048],
        ['10 ft - 6', MM, 3200],
        ['6 inch', MM, 152],
        ["10'6 1/2", MM, 3213],
        ['10\'1/2"', MM, 3061],
        ['1 1/2in', MM, 38],
        ['1/2', { unit: 'in' }, 13],
        ['3/8', { unit: 'ftin' }, 10],
        ['+50', MM, 50],
        ['+ 50', MM, 50],
        ['  3200  ', MM, 3200],
        ['3200 mm', MM, 3200],
        ['3200\tmm', MM, 3200],
        ['３２００', MM, 3200],
        ['10‛6‟', MM, 3200],
        ['10 `6〃', MM, 3200],
        ["6''", MM, 152],
        ['3.', MM, 3],
        ['0', MM, 0],
        ['3200.0', MM, 3200],
        ['5-1/2', { unit: 'ftin' }, 140],
        ['.5', { unit: 'cm' }, 5],
    ])('%j with %j -> %d', (input, ctx, mm) => {
        expect(parseLength(input, ctx)).toMatchObject({ ok: true, mm });
    });

    it('reports rounded only when the exact value was not an integer', () => {
        expect(parseLength('3200.0', MM)).toEqual({
            ok: true,
            mm: 3200,
            rounded: false,
        });
        expect(parseLength('0.4', MM)).toEqual({
            ok: true,
            mm: 0,
            rounded: true,
        });
    });

    it('rounds half away from zero', () => {
        const neg: ParseLengthContext = { unit: 'mm', allowNegative: true };
        expect(parseLength('-0.5mm', neg)).toMatchObject({ mm: -1 });
        expect(parseLength('2.5mm', MM)).toMatchObject({ mm: 3 });
    });

    it('applies the sign to feet-and-inches as a whole', () => {
        const neg: ParseLengthContext = { unit: 'mm', allowNegative: true };
        expect(parseLength('-10\'6"', neg)).toMatchObject({ mm: -3200 });
    });

    it('never returns negative zero', () => {
        const neg: ParseLengthContext = { unit: 'mm', allowNegative: true };
        for (const input of ['-0', '-0.2mm']) {
            const r = parseLength(input, neg);
            expect(r.ok && Object.is(r.mm, 0)).toBe(true);
        }
        const r = parseLength('-0', MM);
        expect(r.ok && Object.is(r.mm, 0)).toBe(true);
    });
});

describe('parseLength: more errors', () => {
    it.each<[string, ParseLengthContext, ParseLengthErrorCode, object]>([
        ['1,234,567', MM, 'too_large', { max: 1_000_000 }],
        ['1.234,5', MM, 'syntax', {}],
        ['1,234,56', MM, 'syntax', {}],
        ['3200+100', MM, 'syntax', {}],
        ['-', MM, 'syntax', {}],
        ['--5', { unit: 'mm', allowNegative: true }, 'syntax', {}],
        ['m', MM, 'syntax', {}],
        ['1/2', MM, 'syntax', {}],
        ['1 1/2', { unit: 'cm' }, 'syntax', {}],
        ['10 kg', MM, 'unknown_unit', { unit: 'kg' }],
        ['5 x', MM, 'unknown_unit', { unit: 'x' }],
        ['5 mmm', MM, 'unknown_unit', { unit: 'mmm' }],
        ['1 1/0', { unit: 'in' }, 'division_by_zero', {}],
        ['10\' 1/0"', MM, 'division_by_zero', {}],
        ['0/0in', MM, 'division_by_zero', {}],
        ['5', { unit: 'mm', max: 4 }, 'too_large', { max: 4 }],
        [
            '-50',
            { unit: 'mm', allowNegative: true, min: -10 },
            'too_small',
            { min: -10 },
        ],
        [
            '-1000001',
            { unit: 'mm', allowNegative: true },
            'too_small',
            { min: -1_000_000 },
        ],
        ['-50', { unit: 'mm', min: 300 }, 'negative', {}],
        ['0', { unit: 'mm', min: 300 }, 'too_small', { min: 300 }],
        ['9'.repeat(400), MM, 'too_large', { max: 1_000_000 }],
        [`${'9'.repeat(400)}/${'9'.repeat(400)}"`, MM, 'syntax', {}],
    ])('%j with %j -> error %s', (input, ctx, code, params) => {
        expect(parseLength(input, ctx)).toEqual({
            ok: false,
            error: {
                code,
                messageKey: `engine.units.error.${code}`,
                params,
            },
        });
    });

    it('treats non-string input as empty', () => {
        for (const bad of [undefined, null, 42, {}]) {
            expect(parseLength(bad as unknown as string, MM)).toMatchObject({
                ok: false,
                error: { code: 'empty' },
            });
        }
    });
});

describe('normalizeLengthInput', () => {
    it.each<[string, string, boolean]>([
        ['  −3,200 MM ', '3200 mm', true],
        ['–3,2 m', '3.2 m', true],
        ['+1,234.5mm', '1234.5mm', false],
        ['10′6″', '10\'6"', false],
        ['10’6”', '10\'6"', false],
        // U+00B4 would otherwise be decomposed by NFKC into a space and a combining accent.
        ['10´6″', '10\'6"', false],
        ['5´', "5'", false],
        // A comma not followed by exactly three digits is a decimal comma, never a thousands separator.
        ['1,2345', '1.2345', false],
        ['1,234', '1234', false],
        ["6''", '6"', false],
        ['3200   mm', '3200 mm', false],
        ['10 FT 6 IN', '10 ft 6 in', false],
    ])('%j -> %j (negative %s)', (input, text, negative) => {
        expect(normalizeLengthInput(input)).toEqual({
            ok: true,
            text,
            negative,
        });
    });

    it.each<[string, ParseLengthErrorCode]>([
        ['', 'empty'],
        ['  \t', 'empty'],
        ['1,2,3', 'syntax'],
        ['1.5,3', 'syntax'],
    ])('%j -> error %s', (input, code) => {
        expect(normalizeLengthInput(input)).toMatchObject({
            ok: false,
            error: { code },
        });
    });
});

describe('parseLength: ledger rulings (Task 3)', () => {
    it('reads 1,2345 as a decimal comma, not as 12345', () => {
        expect(parseLength('1,2345', { unit: 'm' })).toEqual({
            ok: true,
            mm: 1235,
            rounded: true,
        });
        expect(parseLength('12,3456', MM)).toEqual({
            ok: true,
            mm: 12,
            rounded: true,
        });
        expect(parseLength('1,234', MM)).toEqual({
            ok: true,
            mm: 1234,
            rounded: false,
        });
    });

    it('accepts the acute accent as a foot mark', () => {
        expect(parseLength('10´6″', { unit: 'ftin' })).toEqual(
            parseLength('10\'6"', { unit: 'ftin' }),
        );
        expect(parseLength('5´', { unit: 'ftin' })).toEqual(
            parseLength("5'", { unit: 'ftin' }),
        );
    });
});

describe('parseLength: fuzz and round trip', () => {
    const ALPHABET = Array.from(
        '0123456789 .,\'"/-abcdefghijklmnopqrstuvwxyz′″',
    );

    it('never throws and always returns a well-formed result for 10 000 random strings', () => {
        const rand = mulberry32(42);
        const codes = new Set<string>(PARSE_LENGTH_ERROR_CODES);
        const contexts: ParseLengthContext[] = [
            MM,
            { unit: 'ftin', allowNegative: true },
            { unit: 'in', allowZero: false, min: 5, max: 5000 },
        ];
        for (let i = 0; i < 10_000; i++) {
            const length = Math.floor(rand() * 14);
            let s = '';
            for (let j = 0; j < length; j++) {
                s += ALPHABET[Math.floor(rand() * ALPHABET.length)];
            }
            const ctx = contexts[i % contexts.length]!;
            const r = parseLength(s, ctx);
            if (r.ok) {
                expect(Number.isInteger(r.mm)).toBe(true);
                expect(Object.is(r.mm, -0)).toBe(false);
                expect(typeof r.rounded).toBe('boolean');
            } else {
                expect(codes.has(r.error.code)).toBe(true);
                expect(r.error.messageKey).toBe(
                    `engine.units.error.${r.error.code}`,
                );
            }
        }
    });

    function roundTripSamples(): number[] {
        const rand = mulberry32(42);
        const samples = [0, 1, 999, 1000, 1001, 100_000];
        for (let i = 0; i < 10_000; i++) {
            samples.push(Math.floor(rand() * 100_001));
        }
        return samples;
    }

    function prefsFor(unit: LengthUnit): UnitPrefs {
        return {
            system: unit === 'ftin' || unit === 'in' ? 'imperial' : 'metric',
            unit,
            locale: 'en',
        };
    }

    it.each<LengthUnit>(['mm', 'cm', 'm'])(
        'metric %s: parse(format(mm)) === mm for 10 000 seeded samples in [0, 100 000]',
        (unit) => {
            const prefs = prefsFor(unit);
            for (const mm of roundTripSamples()) {
                const r = parseLength(formatLength(mm, prefs), { unit });
                expect(r).toMatchObject({ ok: true, mm });
            }
        },
    );

    it.each<LengthUnit>(['ftin', 'in'])(
        'imperial %s: |parse(format(mm)) - mm| <= 2 for 10 000 seeded samples in [0, 100 000]',
        (unit) => {
            const prefs = prefsFor(unit);
            for (const mm of roundTripSamples()) {
                const r = parseLength(formatLength(mm, prefs), { unit });
                expect(r.ok).toBe(true);
                if (r.ok) {
                    expect(Math.abs(r.mm - mm)).toBeLessThanOrEqual(2);
                }
            }
        },
    );

    it('round-trips the first 2000 samples through the summary-free editor style with grouping disabled', () => {
        const prefs = prefsFor('m');
        for (const mm of roundTripSamples().slice(0, 2000)) {
            expect(
                parseLength(formatLength(mm, prefs, { showUnit: false }), {
                    unit: 'm',
                }),
            ).toMatchObject({ ok: true, mm });
        }
    });
});
