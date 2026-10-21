import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    createFormat,
    currencyFractionDigits,
    currencySymbol,
    currencyTokens,
    formatMoneyAmount,
    formatBps,
    formatDate,
    formatDateTime,
    formatDuration,
    formatFileSize,
    formatMoney,
    formatNumber,
    formatPercent,
    formatRelative,
    formatTime,
    minorToMajorString,
    numberSeparators,
    parseMajorToMinor,
    setFormatContext,
    todayInBusinessTz,
} from '@/lib/format';

beforeEach(() => {
    setFormatContext({
        locale: 'en-IN',
        currency: 'INR',
        timeZone: 'Asia/Kolkata',
        businessTimeZone: 'Asia/Kolkata',
    });
});

afterEach(() => {
    vi.useRealTimers();
});

describe('formatMoney', () => {
    it('formats minor units with the business locale and currency', () => {
        expect(formatMoney(1234567)).toBe('₹12,345.67');
    });

    it('uses lakh grouping for en-IN', () => {
        expect(formatMoney(1234567890)).toBe('₹1,23,45,678.90');
    });

    it('is exact for amounts a float division would blur', () => {
        expect(formatMoney(900719925474099)).toBe('₹90,07,19,92,54,740.99');
        expect(formatMoney(5)).toBe('₹0.05');
        expect(formatMoney(0)).toBe('₹0.00');
    });

    it('formats negatives and honours signDisplay', () => {
        expect(formatMoney(-1234567)).toBe('-₹12,345.67');
        expect(formatMoney(1234567, undefined, { signDisplay: 'always' })).toBe(
            '+₹12,345.67',
        );
        expect(formatMoney(0, undefined, { signDisplay: 'exceptZero' })).toBe(
            '₹0.00',
        );
    });

    it('takes fraction digits from the currency', () => {
        expect(formatMoney(1500, 'JPY', undefined)).toContain('1,500');
        expect(formatMoney(1500, 'JPY')).not.toContain('.');
        expect(formatMoney(1234567, 'KWD')).toContain('1,234.567');
    });

    it('formats USD, EUR and BHD exactly (0.05 / 1,234.50 / three digits)', () => {
        const plain = (text: string): string => text.replaceAll('\u00a0', ' ');

        for (const locale of ['en-US', 'en-IN']) {
            const format = createFormat({
                locale,
                currency: 'INR',
                timeZone: 'UTC',
                businessTimeZone: 'UTC',
            });

            expect(format.formatMoney(1234567, 'USD'), locale).toBe(
                '$12,345.67',
            );
            expect(format.formatMoney(5, 'USD')).toBe('$0.05');
            expect(format.formatMoney(-5, 'USD')).toBe('-$0.05');
            expect(format.formatMoney(123450, 'EUR')).toBe('€1,234.50');
            expect(plain(format.formatMoney(1234567, 'BHD'))).toBe(
                'BHD 1,234.567',
            );
            expect(plain(format.formatMoney(5, 'BHD'))).toBe('BHD 0.005');
            expect(plain(format.formatMoney(-5, 'BHD'))).toBe('-BHD 0.005');
        }
    });

    it('can use the compact notation for charts', () => {
        expect(formatMoney(1234567890, undefined, { compact: true })).toBe(
            '₹1.2Cr',
        );
    });

    it('rejects amounts that are not integer minor units', () => {
        expect(() => formatMoney(12.5)).toThrow(RangeError);
        expect(() => formatMoney(Number.NaN)).toThrow(RangeError);
        expect(() => formatMoney(2 ** 53)).toThrow(RangeError);
    });
});

describe('minorToMajorString', () => {
    it('writes a plain decimal string without symbol or grouping', () => {
        expect(minorToMajorString(1234567, 'INR')).toBe('12345.67');
        expect(minorToMajorString(5, 'INR')).toBe('0.05');
        expect(minorToMajorString(100, 'INR')).toBe('1.00');
        expect(minorToMajorString(0, 'INR')).toBe('0.00');
    });

    it('handles negatives and currencies with 0 or 3 fraction digits', () => {
        expect(minorToMajorString(-5, 'INR')).toBe('-0.05');
        expect(minorToMajorString(-1234567, 'INR')).toBe('-12345.67');
        expect(minorToMajorString(1500, 'JPY')).toBe('1500');
        expect(minorToMajorString(1234567, 'KWD')).toBe('1234.567');
    });
});

describe('parseMajorToMinor', () => {
    it.each([
        ['12,345.67', 2, 1234567],
        ['12.5', 2, 1250],
        ['12', 2, 1200],
        ['0.05', 2, 5],
        ['.5', 2, 50],
        ['5.', 2, 500],
        ['0', 2, 0],
        ['007.10', 2, 710],
        ['1500', 0, 1500],
        ['1.234', 3, 1234],
    ])('parses %j with %i digits to %i', (text, digits, expected) => {
        expect(parseMajorToMinor(text, digits)).toBe(expected);
    });

    it('accepts lakh and western grouping', () => {
        expect(parseMajorToMinor('1,23,456.78', 2)).toBe(12345678);
        expect(parseMajorToMinor('12,34,56,789', 2)).toBe(12345678900);
        expect(parseMajorToMinor('1,234,567.89', 2)).toBe(123456789);
        expect(parseMajorToMinor('999', 2)).toBe(99900);
        expect(parseMajorToMinor('1,000', 2)).toBe(100000);
    });

    it('rejects broken grouping and several separators', () => {
        for (const text of [
            '12,34',
            '1,2345',
            '1,,000',
            ',500',
            '1,000,',
            '0,123',
            '1,23,45',
            '12,345,67',
            '1.2.3',
            '1.234,56',
            '1,000.50.00',
            '1,000,00.00',
        ]) {
            expect(parseMajorToMinor(text, 2), text).toBeNull();
        }
    });

    it('never rounds: more fraction digits than allowed is null', () => {
        expect(parseMajorToMinor('1.005', 2)).toBeNull();
        expect(parseMajorToMinor('12.500', 2)).toBeNull();
        expect(parseMajorToMinor('12.0', 0)).toBeNull();
        expect(parseMajorToMinor('0.0001', 2)).toBeNull();
        expect(parseMajorToMinor('1.2345', 3)).toBeNull();
    });

    it('trims surrounding whitespace but not inner whitespace', () => {
        expect(parseMajorToMinor('  12.5 ', 2)).toBe(1250);
        expect(parseMajorToMinor(' 12.5\n', 2)).toBe(1250);
        expect(parseMajorToMinor('1 234', 2)).toBeNull();
        expect(parseMajorToMinor('12 .5', 2)).toBeNull();
        expect(parseMajorToMinor('- 5', 2)).toBeNull();
    });

    it('rejects empty, non-numeric and symbol-prefixed input', () => {
        for (const text of [
            '',
            '   ',
            '.',
            '-',
            '+',
            'abc',
            '12a',
            '1e3',
            '0x10',
            'NaN',
            'Infinity',
            '₹100',
            '100%',
            '(5)',
        ]) {
            expect(parseMajorToMinor(text, 2), text).toBeNull();
        }
    });

    it('maps any Unicode decimal digit to ASCII and ignores bidi marks', () => {
        // Arabic-Indic, extended Arabic-Indic (Persian), Devanagari, fullwidth and mathematical digits.
        expect(parseMajorToMinor('١٢٣', 2)).toBe(12300);
        expect(parseMajorToMinor('۱۲۳.۵', 2)).toBe(12350);
        expect(parseMajorToMinor('१,२३,४५६.७८', 2)).toBe(12345678);
        expect(parseMajorToMinor('１２３', 2)).toBe(12300);
        expect(parseMajorToMinor('𝟗𝟕', 0)).toBe(97);
        // Double-struck (U+1D7D8) and monospace (U+1D7F6) digits.
        expect(parseMajorToMinor('𝟚𝟘', 0)).toBe(20);
        expect(parseMajorToMinor('𝟷𝟾𝟿', 0)).toBe(189);
        expect(parseMajorToMinor('𝟷𝟾𝟿.𝟻', 2)).toBe(18950);
        expect(parseMajorToMinor('\u200e12.5\u200f', 2)).toBe(1250);
        expect(parseMajorToMinor('\u200f-\u200e5', 2)).toBe(-500);
    });

    it('parses ar-EG input with Arabic-Indic digits and separators', () => {
        const separators = numberSeparators('ar-EG');

        expect(parseMajorToMinor('١٬٢٣٤٫٥٦', 2, separators)).toBe(123456);
        expect(parseMajorToMinor('\u200f١٬٢٣٤٫٥٦\u200e', 2, separators)).toBe(
            123456,
        );
    });

    it('still rejects look-alike characters that are not decimal digits', () => {
        // Superscript two (No), vulgar fraction (No) and circled one (No) are not Nd.
        for (const text of ['²', '½', '①', '1²']) {
            expect(parseMajorToMinor(text, 2), text).toBeNull();
        }
    });

    it('parses a leading sign and never returns negative zero', () => {
        expect(parseMajorToMinor('-12.34', 2)).toBe(-1234);
        expect(parseMajorToMinor('−12.34', 2)).toBe(-1234);
        expect(parseMajorToMinor('+12.34', 2)).toBe(1234);
        expect(parseMajorToMinor('-1,23,456.78', 2)).toBe(-12345678);
        expect(Object.is(parseMajorToMinor('-0', 2), 0)).toBe(true);
        expect(Object.is(parseMajorToMinor('-0.00', 2), 0)).toBe(true);
        expect(parseMajorToMinor('--5', 2)).toBeNull();
        expect(parseMajorToMinor('-+5', 2)).toBeNull();
    });

    it('stays exact up to the safe-integer limit and rejects beyond it', () => {
        expect(parseMajorToMinor('90071992547409.91', 2)).toBe(
            Number.MAX_SAFE_INTEGER,
        );
        expect(parseMajorToMinor('90071992547409.92', 2)).toBeNull();
        expect(parseMajorToMinor('99999999999999999999', 2)).toBeNull();
        expect(parseMajorToMinor('-90071992547409.91', 2)).toBe(
            -Number.MAX_SAFE_INTEGER,
        );
    });

    it('is the inverse of minorToMajorString', () => {
        for (const minor of [0, 1, 5, 99, 100, 1234567, -1234567, 123456789]) {
            expect(parseMajorToMinor(minorToMajorString(minor, 'INR'), 2)).toBe(
                minor,
            );
        }
    });

    it('rejects a nonsensical digit count', () => {
        expect(() => parseMajorToMinor('1', -1)).toThrow(RangeError);
        expect(() => parseMajorToMinor('1', 1.5)).toThrow(RangeError);
    });
});

describe('numbers', () => {
    it('formatNumber follows the business locale', () => {
        expect(formatNumber(1234567.891)).toBe('12,34,567.891');
        expect(formatNumber(12.3456, { maximumFractionDigits: 1 })).toBe(
            '12.3',
        );
    });

    it('formatPercent takes a fraction', () => {
        expect(formatPercent(0.352)).toBe('35%');
        expect(formatPercent(0.3525, 1)).toBe('35.3%');
        expect(formatPercent(0.5, 1)).toBe('50%');
    });

    it('formatBps takes basis points', () => {
        expect(formatBps(3500)).toBe('35%');
        expect(formatBps(1250)).toBe('12.5%');
        expect(formatBps(1275)).toBe('12.75%');
        expect(formatBps(0)).toBe('0%');
    });
});

describe('formatFileSize', () => {
    it.each([
        [0, '0 B'],
        [512, '512 B'],
        [1023, '1,023 B'],
        [1024, '1 KB'],
        [1536, '1.5 KB'],
        [5 * 1024 * 1024, '5 MB'],
        [1.5 * 1024 * 1024, '1.5 MB'],
        [3 * 1024 ** 3, '3 GB'],
        [1048575, '1 MB'],
        [1048575 - 1024 * 3, '1,021 KB'],
        [1023.6, '1 KB'],
        [1024 ** 3 - 1, '1 GB'],
        [2 ** 50, '1,024 TB'],
    ])('%i bytes is %s', (bytes, expected) => {
        expect(formatFileSize(bytes)).toBe(expected);
    });

    it('shows a dash for impossible sizes', () => {
        expect(formatFileSize(-1)).toBe('—');
        expect(formatFileSize(Number.NaN)).toBe('—');
    });
});

describe('formatDuration', () => {
    it.each([
        [80000, '1 min 20 s'],
        [0, '0 s'],
        [400, '0 s'],
        [1000, '1 s'],
        [60000, '1 min'],
        [3600000, '1 h'],
        [3725000, '1 h 2 min 5 s'],
        [90000000, '25 h'],
    ])('%i ms is %s', (ms, expected) => {
        expect(formatDuration(ms)).toBe(expected);
    });

    it('shows a dash for impossible durations', () => {
        expect(formatDuration(-5)).toBe('—');
        expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('—');
    });
});

describe('dates', () => {
    for (const timeZone of [
        'America/Los_Angeles',
        'Pacific/Kiritimati',
        'UTC',
        'Asia/Kolkata',
    ]) {
        it(`formatDate never shifts a date-only string (user zone ${timeZone})`, () => {
            setFormatContext({ timeZone });

            expect(formatDate('2026-10-20')).toBe('20 Oct 2026');
            expect(formatDate('2026-01-01', 'long')).toBe('1 January 2026');
            expect(formatDate('2026-12-31', 'short')).toBe('31/12/26');
        });
    }

    it.each([
        ['America/Los_Angeles', 420],
        ['Pacific/Kiritimati', -840],
    ])(
        'formatDate stays put when the process itself runs in %s',
        (tz, offsetMinutes) => {
            const previous = process.env.TZ;
            process.env.TZ = tz;

            try {
                // Guard against a vacuous test: the zone really changed.
                expect(new Date(2026, 9, 20, 12).getTimezoneOffset()).toBe(
                    offsetMinutes,
                );

                setFormatContext({ timeZone: tz });

                expect(formatDate('2026-10-20')).toBe('20 Oct 2026');
                expect(formatDateTime('2026-10-20')).toBe('20 Oct 2026');
            } finally {
                if (previous === undefined) {
                    delete process.env.TZ;
                } else {
                    process.env.TZ = previous;
                }
            }
        },
    );

    it('formatDate converts an instant to the user zone date', () => {
        setFormatContext({ timeZone: 'Pacific/Kiritimati' });
        // 2026-10-20 12:00Z is already the 21st at UTC+14.
        expect(formatDate('2026-10-20T12:00:00Z')).toBe('21 Oct 2026');

        setFormatContext({ timeZone: 'America/Los_Angeles' });
        // 2026-10-20 03:00Z is still the 19th at UTC-7 (PDT).
        expect(formatDate('2026-10-20T03:00:00Z')).toBe('19 Oct 2026');
    });

    it('formatDateTime renders the user zone and treats offset-less input as UTC', () => {
        setFormatContext({ timeZone: 'Asia/Kolkata' });

        expect(formatDateTime('2026-10-20T04:30:00Z')).toBe(
            '20 Oct 2026, 10:00 am',
        );
        expect(formatDateTime('2026-10-20T04:30:00')).toBe(
            '20 Oct 2026, 10:00 am',
        );
        expect(formatDateTime('2026-10-20T10:00:00+05:30', 'long')).toContain(
            '20 October 2026',
        );
    });

    it('formatTime renders only the time of an instant', () => {
        setFormatContext({ timeZone: 'Asia/Kolkata' });

        expect(formatTime('2026-10-20T04:30:00Z')).toBe('10:00 am');
        expect(formatTime('2026-10-20')).toBe('—');
    });

    it('shows a dash for text that is not a date', () => {
        expect(formatDate('not a date')).toBe('—');
        expect(formatDate('2026-02-30')).toBe('—');
        expect(formatDate('')).toBe('—');
        expect(formatDateTime('2026-13-01T00:00:00Z')).toBe('—');
    });

    it('todayInBusinessTz uses the business zone, not the user zone', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-10-20T20:00:00Z'));
        setFormatContext({
            businessTimeZone: 'Asia/Kolkata',
            timeZone: 'America/Los_Angeles',
        });

        expect(todayInBusinessTz()).toBe('2026-10-21');

        setFormatContext({ businessTimeZone: 'America/Los_Angeles' });

        expect(todayInBusinessTz()).toBe('2026-10-20');
    });

    it('reads a space-separated datetime like the ISO form (Safari rejects the raw string)', () => {
        setFormatContext({ timeZone: 'Asia/Kolkata' });

        expect(formatDateTime('2026-10-20 04:30:00')).toBe(
            '20 Oct 2026, 10:00 am',
        );
        expect(formatDateTime('2026-10-20 04:30:00+00:00')).toBe(
            '20 Oct 2026, 10:00 am',
        );
        expect(formatTime('2026-10-20 04:30')).toBe('10:00 am');
    });

    it.each([
        // US spring forward: 2026-03-08 02:00 EST -> 03:00 EDT (07:00Z).
        ['2026-03-08T04:59:59Z', '2026-03-07'],
        ['2026-03-08T05:00:00Z', '2026-03-08'],
        ['2026-03-08T06:59:59Z', '2026-03-08'],
        ['2026-03-08T07:00:00Z', '2026-03-08'],
        ['2026-03-09T03:59:59Z', '2026-03-08'],
        ['2026-03-09T04:00:00Z', '2026-03-09'],
        // US fall back: 2026-11-01 02:00 EDT -> 01:00 EST (06:00Z).
        ['2026-11-01T03:59:59Z', '2026-10-31'],
        ['2026-11-01T04:00:00Z', '2026-11-01'],
        ['2026-11-01T05:30:00Z', '2026-11-01'], // 01:30 EDT
        ['2026-11-01T06:30:00Z', '2026-11-01'], // 01:30 EST, the repeated hour
        ['2026-11-02T04:59:59Z', '2026-11-01'],
        ['2026-11-02T05:00:00Z', '2026-11-02'],
    ])(
        'todayInBusinessTz in New York at %s is %s (DST boundaries)',
        (instant, expected) => {
            setFormatContext({
                businessTimeZone: 'America/New_York',
                timeZone: 'Asia/Kolkata',
            });

            expect(todayInBusinessTz(new Date(instant))).toBe(expected);
        },
    );

    it('todayInBusinessTz can be asked about another instant', () => {
        setFormatContext({ businessTimeZone: 'Pacific/Kiritimati' });

        expect(todayInBusinessTz(new Date('2026-10-20T12:00:00Z'))).toBe(
            '2026-10-21',
        );
    });
});

describe('formatRelative', () => {
    const now = new Date('2026-10-20T12:00:00Z');
    const ago = (ms: number): string =>
        new Date(now.getTime() - ms).toISOString();

    it.each([
        [20_000, 'now'],
        [5 * 60_000, '5 min ago'],
        [3 * 3_600_000, '3 hr ago'],
        [26 * 3_600_000, 'yesterday'],
        [3 * 86_400_000, '3 days ago'],
        [14 * 86_400_000, '2 wk ago'],
        [90 * 86_400_000, '3 mo ago'],
        [800 * 86_400_000, '2 yr ago'],
    ])('%i ms in the past reads %s', (ms, expected) => {
        expect(formatRelative(ago(ms), now)).toBe(expected);
    });

    it('reads the future too', () => {
        expect(formatRelative('2026-10-20T15:00:00Z', now)).toBe('in 3 hr');
        expect(formatRelative('2026-10-21T12:00:00Z', now)).toBe('tomorrow');
    });

    it('shows a dash for text that is not a date', () => {
        expect(formatRelative('nope', now)).toBe('—');
    });
});

describe('createFormat', () => {
    it('binds to a context that can change between calls', () => {
        let context = {
            locale: 'en-US',
            currency: 'USD',
            timeZone: 'UTC',
            businessTimeZone: 'UTC',
        };
        const format = createFormat(() => context);

        expect(format.formatMoney(1234567)).toBe('$12,345.67');

        context = { ...context, locale: 'en-IN', currency: 'INR' };

        expect(format.formatMoney(1234567890)).toBe('₹1,23,45,678.90');
    });

    it('falls back to the business zone when the user zone is invalid', () => {
        const format = createFormat({
            locale: 'en-IN',
            currency: 'INR',
            timeZone: 'Mars/Olympus',
            businessTimeZone: 'Asia/Kolkata',
        });

        expect(format.formatDateTime('2026-10-20T04:30:00Z')).toBe(
            '20 Oct 2026, 10:00 am',
        );
    });
});

describe('performance', () => {
    it('formatMoney costs microseconds per call: 20,000 calls in under 300 ms', () => {
        const format = createFormat(() => ({
            locale: 'en-IN',
            currency: 'INR',
            timeZone: 'Asia/Kolkata',
            businessTimeZone: 'Asia/Kolkata',
        }));
        format.formatMoney(1); // build the Intl instance once, as a page would

        const started = performance.now();

        for (let i = 0; i < 20_000; i += 1) {
            format.formatMoney(1234567 + i);
        }

        expect(performance.now() - started).toBeLessThan(300);
    });

    it('formatMoney with the module-level functions too, and never touches time zones', () => {
        const zone = vi.spyOn(Intl, 'DateTimeFormat');

        for (let i = 0; i < 2_000; i += 1) {
            formatMoney(i);
        }

        expect(zone).not.toHaveBeenCalled();
        zone.mockRestore();
    });

    it('validates a time zone once, not on every date call', () => {
        const format = createFormat({
            locale: 'en-IN',
            currency: 'INR',
            timeZone: 'Pacific/Auckland',
            businessTimeZone: 'Pacific/Auckland',
        });
        format.formatDate('2026-10-20T00:00:00Z');
        const zone = vi.spyOn(Intl, 'DateTimeFormat');

        for (let i = 0; i < 500; i += 1) {
            format.formatDate('2026-10-20T00:00:00Z');
        }

        expect(zone).not.toHaveBeenCalled();
        zone.mockRestore();
    });
});

describe('formatMoneyAmount, currencySymbol and currencyFractionDigits (input support)', () => {
    it('splits formatMoney into the symbol and the grouped amount', () => {
        expect(currencySymbol()).toBe('₹');
        expect(formatMoneyAmount(1234567)).toBe('12,345.67');
        expect(formatMoneyAmount(1234567890)).toBe('1,23,45,678.90');
        expect(formatMoneyAmount(0)).toBe('0.00');
    });

    it('keeps the sign with the amount', () => {
        expect(formatMoneyAmount(-500)).toBe('-5.00');
    });

    it('follows 0-, 2- and 3-decimal currencies', () => {
        expect(currencyFractionDigits('JPY')).toBe(0);
        expect(currencyFractionDigits('INR')).toBe(2);
        expect(currencyFractionDigits('BHD')).toBe(3);
        expect(formatMoneyAmount(1500, 'JPY')).toBe('1,500');
        expect(formatMoneyAmount(1234567, 'BHD')).toBe('1,234.567');
        expect(currencySymbol('JPY')).toBe('JP¥');
        expect(currencySymbol('BHD')).toBe('BHD');
    });

    it('joins to what formatMoney prints (symbol and amount, in locale order)', () => {
        const format = createFormat({
            locale: 'de-DE',
            currency: 'EUR',
            timeZone: 'UTC',
            businessTimeZone: 'UTC',
        });

        expect(format.currencySymbol()).toBe('€');
        expect(format.formatMoneyAmount(1234567)).toBe('12.345,67');
        expect(format.formatMoney(1234567).replace(/\s/g, ' ')).toBe(
            '12.345,67 €',
        );
    });
});

describe('numberSeparators', () => {
    it.each([
        ['en-IN', '.', ','],
        ['en-US', '.', ','],
        ['de-DE', ',', '.'],
        ['fr-FR', ',', '\u202f'],
        ['ru-RU', ',', '\u00a0'],
        ['de-CH', '.', '\u2019'],
    ])('%s: decimal %j, group %j', (locale, decimal, group) => {
        expect(numberSeparators(locale)).toEqual({ decimal, group });
    });

    it('falls back to . and , for a locale Intl rejects', () => {
        expect(numberSeparators('not a locale')).toEqual({
            decimal: '.',
            group: ',',
        });
    });
});

describe('parseMajorToMinor with locale separators', () => {
    const de = numberSeparators('de-DE');
    const fr = numberSeparators('fr-FR');

    it('de-DE: . groups and , is the decimal', () => {
        expect(parseMajorToMinor('1.234,56', 2, de)).toBe(123456);
        expect(parseMajorToMinor('1.234.567,5', 2, de)).toBe(123456750);
        expect(parseMajorToMinor('1234,5', 2, de)).toBe(123450);
        expect(parseMajorToMinor(',5', 2, de)).toBe(50);
        expect(parseMajorToMinor('1.234', 2, de)).toBe(123400);
    });

    it('de-DE rejects the other locale’s spelling instead of guessing', () => {
        expect(parseMajorToMinor('1,234.56', 2, de)).toBeNull();
        expect(parseMajorToMinor('1,234', 2, de)).toBeNull();
        expect(parseMajorToMinor('12.34', 2, de)).toBeNull();
        expect(parseMajorToMinor('1.23', 2, de)).toBeNull();
        expect(parseMajorToMinor('1,2,3', 2, de)).toBeNull();
    });

    it('de-DE keeps lakh grouping valid, and the fraction limit', () => {
        expect(parseMajorToMinor('1.23.456,78', 2, de)).toBe(12345678);
        expect(parseMajorToMinor('1,005', 2, de)).toBeNull();
    });

    it('fr-FR: a space, NBSP or narrow NBSP groups', () => {
        expect(parseMajorToMinor('1\u202f234,56', 2, fr)).toBe(123456);
        expect(parseMajorToMinor('1\u00a0234,56', 2, fr)).toBe(123456);
        expect(parseMajorToMinor('1 234,56', 2, fr)).toBe(123456);
        expect(parseMajorToMinor('1 234 567', 2, fr)).toBe(123456700);
        expect(parseMajorToMinor('  1 234,56  ', 2, fr)).toBe(123456);
    });

    it('fr-FR rejects broken spacing and the . decimal', () => {
        expect(parseMajorToMinor('12 34,56', 2, fr)).toBeNull();
        expect(parseMajorToMinor('1 234.56', 2, fr)).toBeNull();
        expect(parseMajorToMinor('1  234', 2, fr)).toBeNull();
    });

    it('de-CH: an apostrophe typed on the keyboard groups', () => {
        const ch = numberSeparators('de-CH');

        expect(parseMajorToMinor('1\u2019234.50', 2, ch)).toBe(123450);
        expect(parseMajorToMinor("1'234.50", 2, ch)).toBe(123450);
    });

    it('the default stays . and ,', () => {
        expect(parseMajorToMinor('1,234.56', 2)).toBe(123456);
        expect(parseMajorToMinor('1.234,56', 2)).toBeNull();
        expect(parseMajorToMinor('1 234.56', 2)).toBeNull();
        expect(
            parseMajorToMinor('1,23,456.78', 2, { decimal: '.', group: ',' }),
        ).toBe(12345678);
    });

    it('signs, zero digits and the safe-integer cap still apply', () => {
        expect(parseMajorToMinor('-1.234,5', 2, de)).toBe(-123450);
        expect(parseMajorToMinor('1.500', 0, de)).toBe(1500);
        expect(parseMajorToMinor('12,5', 0, de)).toBeNull();
        expect(parseMajorToMinor('90.071.992.547.409,92', 2, de)).toBeNull();
    });
});

describe('currencyTokens', () => {
    it('lists the symbol, narrow symbol and ISO code, longest first', () => {
        expect(currencyTokens()).toEqual(['INR', '₹']);

        const format = createFormat({
            locale: 'en-IN',
            currency: 'INR',
            timeZone: 'UTC',
            businessTimeZone: 'UTC',
        });

        expect(format.currencyTokens('USD')).toEqual(['USD', '$']);
        expect(format.currencyTokens('JPY')).toEqual(['JP¥', 'JPY', '¥']);
    });
});
