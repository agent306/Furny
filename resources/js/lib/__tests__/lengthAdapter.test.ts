import { describe, expect, it } from 'vitest';
import { formatLengthValue, parseLengthInput } from '@/lib/lengthAdapter';

const ok = (mm: number) => ({ ok: true, mm });
const invalid = { ok: false, reason: 'invalid' };
const unsupported = { ok: false, reason: 'unsupported' };

describe('parseLengthInput (P1 metric placeholder, 04 §1.2 subset)', () => {
    it.each([
        ['3200', 'mm', 3200],
        ['3200mm', 'mm', 3200],
        ['3200 mm', 'mm', 3200],
        ['3200 MM', 'mm', 3200],
        ['320cm', 'mm', 3200],
        ['3.2m', 'mm', 3200],
        ['3.2 metres', 'mm', 3200],
        ['3.2 meters', 'mm', 3200],
        ['320 centimetres', 'mm', 3200],
        ['3200 millimetres', 'mm', 3200],
        ['.5m', 'mm', 500],
        ['12', 'cm', 120],
        ['1.5', 'm', 1500],
        ['240', 'cm', 2400],
        ['0', 'mm', 0],
    ] as const)('%s in %s is %i mm', (text, unit, mm) => {
        expect(parseLengthInput(text, unit)).toEqual(ok(mm));
    });

    it('3.2m is 3200 (the brief example)', () => {
        expect(parseLengthInput('3.2m', 'mm')).toEqual({ ok: true, mm: 3200 });
    });

    it('normalises width, case, NBSP and tabs', () => {
        expect(parseLengthInput('  ３２００ Ｍｍ ', 'mm')).toEqual(ok(3200));
        expect(parseLengthInput('3200\tmm', 'mm')).toEqual(ok(3200));
    });

    describe('thousands separators and decimal commas (master §6.1 / 04 §1.2 step 6)', () => {
        it.each([
            ['2,400 mm', 2400],
            ['2,400', 2400],
            ['1,234.5mm', 1235],
            ['1,234,567', 1234567],
            ['3,2 m', 3200],
            ['3,2m', 3200],
        ] as const)('%s is %i mm', (text, mm) => {
            expect(parseLengthInput(text, 'mm')).toEqual(ok(mm));
        });

        it.each(['1,2,3', '2,40,0', '1,234,56', '3 200', '2,4,00 mm'])(
            '%s is invalid',
            (text) => {
                expect(parseLengthInput(text, 'mm')).toEqual(invalid);
            },
        );
    });

    describe('rounding is half away from zero, on exact decimals', () => {
        it.each([
            ['0.5mm', 1],
            ['1.5mm', 2],
            ['2.5mm', 3],
            ['0.4mm', 0],
            ['1.0005m', 1001],
            ['1.0004m', 1000],
            ['0.15cm', 2],
            ['1234.5', 1235],
            ['-0.5mm', -1],
            ['-2.5', -3],
            ['-0.4', 0],
        ] as const)('%s is %i mm', (text, mm) => {
            expect(parseLengthInput(text, 'mm')).toEqual(ok(mm));
        });

        it('negative zero is zero', () => {
            const result = parseLengthInput('-0.4', 'mm');

            expect(result.ok && Object.is(result.mm, -0)).toBe(false);
        });
    });

    describe('signs', () => {
        it('accepts a leading plus or minus, including the unicode minus', () => {
            expect(parseLengthInput('+50', 'mm')).toEqual(ok(50));
            expect(parseLengthInput('-50', 'mm')).toEqual(ok(-50));
            expect(parseLengthInput('−50 cm', 'mm')).toEqual(ok(-500));
            expect(parseLengthInput('–50', 'mm')).toEqual(ok(-50));
        });

        it('rejects a second sign', () => {
            expect(parseLengthInput('--5', 'mm')).toEqual(invalid);
            expect(parseLengthInput('5-', 'mm')).toEqual(invalid);
        });
    });

    describe('rejects what is not a plain decimal length', () => {
        it.each([
            '',
            '   ',
            'abc',
            'NaN',
            'Infinity',
            '-Infinity',
            '1e3',
            '1E3mm',
            '0x10',
            '3200 kg',
            '3200 x',
            '1/2',
            '6 1/2',
            '3200+100',
            '1.2.3',
            '.',
            '12ab',
            'mm',
            '5 5mm',
        ])('%j is invalid', (text) => {
            expect(parseLengthInput(text, 'mm')).toEqual(invalid);
        });

        it('never reaches Infinity or an unsafe integer', () => {
            expect(parseLengthInput('9'.repeat(400), 'mm')).toEqual(invalid);
            expect(parseLengthInput('9'.repeat(17), 'mm')).toEqual(invalid);
            expect(parseLengthInput('99999999999999999999m', 'mm')).toEqual(
                invalid,
            );
            expect(parseLengthInput('9007199254740991', 'mm')).toEqual(
                ok(Number.MAX_SAFE_INTEGER),
            );
        });

        it('does not throw for any input (fuzz)', () => {
            const alphabet = '0123456789.,\'"/-+ xXeEmcn′″abℝ';

            for (let n = 0; n < 2000; n++) {
                const length = n % 12;
                let text = '';

                for (let i = 0; i < length; i++) {
                    text +=
                        alphabet[
                            (n * 31 + i * 17 + (n >> 3)) % alphabet.length
                        ];
                }

                const result = parseLengthInput(text, 'mm');

                if (result.ok) {
                    expect(Number.isSafeInteger(result.mm)).toBe(true);
                }
            }
        });
    });

    describe('imperial input is "unsupported" in P1', () => {
        it.each([
            '7\'10"',
            '7′10″',
            "10'",
            '10ft',
            '10 ft 6 in',
            '126in',
            '6"',
            '10 feet',
            '5 inches',
            '1/2"',
            '10\' 6 1/2"',
        ])('%s', (text) => {
            expect(parseLengthInput(text, 'mm')).toEqual(unsupported);
        });

        it('a bare number in an imperial unit is unsupported (bare = inches)', () => {
            expect(parseLengthInput('10', 'ftin')).toEqual(unsupported);
            expect(parseLengthInput('6 1/2', 'in')).toEqual(unsupported);
        });

        it('an explicit metric suffix still works under an imperial unit', () => {
            expect(parseLengthInput('3.2m', 'ftin')).toEqual(ok(3200));
            expect(parseLengthInput('2400mm', 'in')).toEqual(ok(2400));
        });

        it('nonsense in an imperial unit is invalid, not unsupported', () => {
            expect(parseLengthInput('abc', 'ftin')).toEqual(invalid);
            expect(parseLengthInput('', 'in')).toEqual(invalid);
        });
    });
});

describe('formatLengthValue', () => {
    it('mm is a bare integer', () => {
        expect(formatLengthValue(2400, { system: 'metric', unit: 'mm' })).toBe(
            '2400',
        );
        expect(formatLengthValue(0, { system: 'metric', unit: 'mm' })).toBe(
            '0',
        );
        expect(formatLengthValue(-50, { system: 'metric', unit: 'mm' })).toBe(
            '-50',
        );
        expect(
            formatLengthValue(1_234_567, { system: 'metric', unit: 'mm' }),
        ).toBe('1234567');
    });

    it('cm has up to one decimal, trailing zeros stripped (04 §1.3)', () => {
        expect(formatLengthValue(3200, { system: 'metric', unit: 'cm' })).toBe(
            '320',
        );
        expect(formatLengthValue(3205, { system: 'metric', unit: 'cm' })).toBe(
            '320.5',
        );
        expect(formatLengthValue(-3205, { system: 'metric', unit: 'cm' })).toBe(
            '-320.5',
        );
    });

    it('m has up to three decimals, trailing zeros stripped', () => {
        expect(formatLengthValue(3200, { system: 'metric', unit: 'm' })).toBe(
            '3.2',
        );
        expect(formatLengthValue(3205, { system: 'metric', unit: 'm' })).toBe(
            '3.205',
        );
        expect(formatLengthValue(850, { system: 'metric', unit: 'm' })).toBe(
            '0.85',
        );
        expect(formatLengthValue(3000, { system: 'metric', unit: 'm' })).toBe(
            '3',
        );
    });

    it('imperial falls back to millimetres until P4', () => {
        expect(
            formatLengthValue(3200, { system: 'imperial', unit: 'ftin' }),
        ).toBe('3200');
        expect(formatLengthValue(3200, { system: 'metric', unit: 'in' })).toBe(
            '3200',
        );
    });

    it('round-trips through parseLengthInput for every metric unit', () => {
        for (const unit of ['mm', 'cm', 'm'] as const) {
            for (let mm = 0; mm <= 50_000; mm += 37) {
                const text = formatLengthValue(mm, { system: 'metric', unit });

                expect(parseLengthInput(text, unit), `${text} ${unit}`).toEqual(
                    ok(mm),
                );
            }
        }
    });
});
