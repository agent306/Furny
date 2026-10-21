import { describe, expect, it } from 'vitest';
import { formatAngle, formatArea, formatLength } from '../format';
import {
    MM2_PER_FT2,
    MM_PER_FOOT,
    MM_PER_INCH,
    coerceUnitPrefs,
    type FormatLengthOptions,
    type LengthUnit,
    type UnitPrefs,
} from '../types';

function prefs(unit: LengthUnit, locale = 'en'): UnitPrefs {
    return {
        system: unit === 'ftin' || unit === 'in' ? 'imperial' : 'metric',
        unit,
        locale,
    };
}

const METRIC = prefs('mm');
const IMPERIAL = prefs('ftin');

describe('constants', () => {
    it('matches 04 §1.2 / §1.4', () => {
        expect(MM_PER_INCH).toBe(25.4);
        expect(MM_PER_FOOT).toBe(304.8);
        expect(MM2_PER_FT2).toBe(92_903.04);
    });
});

describe('formatLength: 04 §1.5 table', () => {
    it.each<[number, LengthUnit, 'editor' | 'summary', string]>([
        [3200, 'mm', 'editor', '3200 mm'],
        [3205, 'cm', 'editor', '320.5 cm'],
        [3200, 'm', 'editor', '3.2 m'],
        [3205, 'm', 'editor', '3.205 m'],
        [3200, 'mm', 'summary', '3.20 m'],
        [850, 'mm', 'summary', '850 mm'],
        [3200, 'ftin', 'editor', '10\' 6"'],
        [3213, 'ftin', 'editor', '10\' 6 1/2"'],
        [3048, 'ftin', 'editor', '10\' 0"'],
        [152, 'ftin', 'editor', '6"'],
        [10, 'ftin', 'editor', '3/8"'],
        [0, 'ftin', 'editor', '0"'],
        [-152, 'ftin', 'editor', '-6"'],
        [3200, 'in', 'editor', '126"'],
        [304, 'ftin', 'editor', '1\' 0"'],
    ])('%d mm as %s (%s) -> %j', (mm, unit, style, expected) => {
        expect(formatLength(mm, prefs(unit), { style })).toBe(expected);
    });
});

describe('formatLength: metric details', () => {
    it.each<[number, LengthUnit, FormatLengthOptions | undefined, string]>([
        [3200, 'cm', undefined, '320 cm'],
        [3201, 'cm', undefined, '320.1 cm'],
        [0, 'cm', undefined, '0 cm'],
        [850, 'm', undefined, '0.85 m'],
        [0, 'm', undefined, '0 m'],
        [1_000_000, 'm', undefined, '1000 m'],
        [1_000_000, 'mm', undefined, '1000000 mm'],
        [3200.4, 'mm', undefined, '3200 mm'],
        [3200.5, 'mm', undefined, '3201 mm'],
        [-3200, 'mm', undefined, '-3200 mm'],
        [-3205, 'm', undefined, '-3.205 m'],
        [3200, 'mm', { signed: true }, '+3200 mm'],
        [-3200, 'mm', { signed: true }, '-3200 mm'],
        [0, 'mm', { signed: true }, '0 mm'],
        [3200, 'mm', { showUnit: false }, '3200'],
        [3205, 'cm', { showUnit: false }, '320.5'],
        [3205, 'm', { showUnit: false }, '3.205'],
        [-0.2, 'mm', undefined, '0 mm'],
        [-0.2, 'mm', { signed: true }, '0 mm'],
        [999, 'mm', { style: 'summary' }, '999 mm'],
        [999.6, 'mm', { style: 'summary' }, '1.00 m'],
        [1000, 'mm', { style: 'summary' }, '1.00 m'],
        [1005, 'mm', { style: 'summary' }, '1.01 m'],
        [1_234_567, 'mm', { style: 'summary' }, '1,234.57 m'],
        [-3200, 'mm', { style: 'summary' }, '-3.20 m'],
        [3200, 'cm', { style: 'summary' }, '3.20 m'],
        [850, 'cm', { style: 'summary' }, '850 mm'],
        [3200, 'm', { style: 'summary' }, '3.20 m'],
        [850, 'm', { style: 'summary' }, '850 mm'],
        [3200, 'mm', { style: 'summary', showUnit: false }, '3.20'],
        [3200, 'mm', { style: 'summary', signed: true }, '+3.20 m'],
    ])('%d mm in %s with %j -> %j', (mm, unit, opts, expected) => {
        expect(formatLength(mm, prefs(unit), opts)).toBe(expected);
    });

    it('uses the locale decimal separator but an ASCII minus', () => {
        expect(formatLength(3205, prefs('m', 'de'))).toBe('3,205 m');
        expect(formatLength(-3205, prefs('m', 'de'))).toBe('-3,205 m');
        expect(formatLength(-3205, prefs('m', 'sv'))).toBe('-3,205 m');
        expect(
            formatLength(1_234_567, prefs('mm', 'de'), { style: 'summary' }),
        ).toBe('1.234,57 m');
    });
});

describe('formatLength: imperial details', () => {
    it.each<[number, LengthUnit, FormatLengthOptions | undefined, string]>([
        [3200, 'ftin', undefined, '10\' 6"'],
        [3201, 'ftin', undefined, '10\' 6"'],
        [3181, 'ftin', undefined, '10\' 5 1/4"'],
        [3188, 'ftin', undefined, '10\' 5 1/2"'],
        [3195, 'ftin', undefined, '10\' 5 3/4"'],
        [3197, 'ftin', undefined, '10\' 5 7/8"'],
        [3205, 'ftin', undefined, '10\' 6 1/8"'],
        [3210, 'ftin', undefined, '10\' 6 3/8"'],
        [3216, 'ftin', undefined, '10\' 6 5/8"'],
        [3219, 'ftin', undefined, '10\' 6 3/4"'],
        [3222, 'ftin', undefined, '10\' 6 7/8"'],
        [3229, 'ftin', undefined, '10\' 7 1/8"'],
        [3, 'ftin', undefined, '1/8"'],
        [6, 'ftin', undefined, '1/4"'],
        [13, 'ftin', undefined, '1/2"'],
        [16, 'ftin', undefined, '5/8"'],
        [19, 'ftin', undefined, '3/4"'],
        [22, 'ftin', undefined, '7/8"'],
        [1, 'ftin', undefined, '0"'],
        [305, 'ftin', undefined, '1\' 0"'],
        [330, 'ftin', undefined, '1\' 1"'],
        [-3213, 'ftin', undefined, '-10\' 6 1/2"'],
        [-1, 'ftin', undefined, '0"'],
        [3200, 'ftin', { signed: true }, '+10\' 6"'],
        [-3200, 'ftin', { signed: true }, '-10\' 6"'],
        [0, 'ftin', { signed: true }, '0"'],
        [3200, 'ftin', { showUnit: false }, '10\' 6"'],
        [3200, 'ftin', { style: 'summary' }, '10\' 6"'],
        [3213, 'in', undefined, '126 1/2"'],
        [10, 'in', undefined, '3/8"'],
        [0, 'in', undefined, '0"'],
        [-152, 'in', undefined, '-6"'],
        [3200, 'in', { showUnit: false }, '126"'],
        [1_000_000, 'ftin', undefined, '3280\' 10 1/8"'],
    ])('%d mm in %s with %j -> %j', (mm, unit, opts, expected) => {
        expect(formatLength(mm, prefs(unit), opts)).toBe(expected);
    });

    it('is not affected by the locale', () => {
        expect(formatLength(3213, prefs('ftin', 'de'))).toBe('10\' 6 1/2"');
    });
});

describe('coerceUnitPrefs and mismatched pairs', () => {
    it.each<[UnitPrefs, UnitPrefs]>([
        [
            { system: 'metric', unit: 'ftin', locale: 'en' },
            { system: 'metric', unit: 'mm', locale: 'en' },
        ],
        [
            { system: 'metric', unit: 'in', locale: 'en' },
            { system: 'metric', unit: 'mm', locale: 'en' },
        ],
        [
            { system: 'imperial', unit: 'mm', locale: 'en' },
            { system: 'imperial', unit: 'ftin', locale: 'en' },
        ],
        [
            { system: 'imperial', unit: 'cm', locale: 'de' },
            { system: 'imperial', unit: 'ftin', locale: 'de' },
        ],
        [
            { system: 'imperial', unit: 'm', locale: 'en' },
            { system: 'imperial', unit: 'ftin', locale: 'en' },
        ],
        [
            { system: 'metric', unit: 'cm', locale: 'en' },
            { system: 'metric', unit: 'cm', locale: 'en' },
        ],
        [
            { system: 'imperial', unit: 'in', locale: 'en' },
            { system: 'imperial', unit: 'in', locale: 'en' },
        ],
    ])('coerces %j to %j', (input, expected) => {
        const copy = { ...input };
        expect(coerceUnitPrefs(input)).toEqual(expected);
        expect(input).toEqual(copy);
    });

    it('formatLength applies the coercion', () => {
        expect(
            formatLength(3200, {
                system: 'metric',
                unit: 'ftin',
                locale: 'en',
            }),
        ).toBe('3200 mm');
        expect(
            formatLength(3200, { system: 'imperial', unit: 'm', locale: 'en' }),
        ).toBe('10\' 6"');
    });
});

describe('formatArea', () => {
    it.each<[number, UnitPrefs, string]>([
        [12_350_000, METRIC, '12.35 m²'],
        [12_350_000, IMPERIAL, '133 ft²'],
        [0, METRIC, '0.00 m²'],
        [0, IMPERIAL, '0 ft²'],
        [116_128_800, IMPERIAL, '1,250 ft²'],
        [450_000, METRIC, '0.45 m²'],
        [10_000, METRIC, '0.01 m²'],
        [4_999, METRIC, '0.00 m²'],
        [-12_350_000, METRIC, '-12.35 m²'],
        [-12_350_000, IMPERIAL, '-133 ft²'],
        [-100, METRIC, '0.00 m²'],
        [1_234_560_000, METRIC, '1234.56 m²'],
        [12_350_000, prefs('cm'), '12.35 m²'],
        [12_350_000, prefs('in'), '133 ft²'],
        [
            12_350_000,
            { system: 'metric', unit: 'ftin', locale: 'en' },
            '12.35 m²',
        ],
        [
            12_350_000,
            { system: 'imperial', unit: 'mm', locale: 'en' },
            '133 ft²',
        ],
    ])('%d mm2 with %j -> %j', (mm2, p, expected) => {
        expect(formatArea(mm2, p)).toBe(expected);
    });

    it('uses the locale separators', () => {
        expect(formatArea(12_350_000, prefs('mm', 'de'))).toBe('12,35 m²');
        expect(formatArea(116_128_800, prefs('ftin', 'de'))).toBe('1.250 ft²');
    });
});

describe('formatAngle', () => {
    it.each<[number, string, string]>([
        [22.5, 'en', '22.5°'],
        [45, 'en', '45°'],
        [0, 'en', '0°'],
        [90.04, 'en', '90°'],
        [90.06, 'en', '90.1°'],
        [359.96, 'en', '0°'],
        [-359.96, 'en', '0°'],
        [359.94, 'en', '359.9°'],
        [720, 'en', '720°'],
        [-22.5, 'en', '-22.5°'],
        [-0.01, 'en', '0°'],
        [22.5, 'de', '22,5°'],
        [-22.5, 'sv', '-22,5°'],
    ])('%d deg in %s -> %j', (deg, locale, expected) => {
        expect(formatAngle(deg, locale)).toBe(expected);
    });
});
