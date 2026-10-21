/** `formatLength`, `formatArea`, `formatAngle` (04 §1.3-§1.4). */
import {
    MM2_PER_FT2,
    MM_PER_INCH,
    coerceUnitPrefs,
    type FormatLengthOptions,
    type UnitPrefs,
} from './types';

const formatters = new Map<string, Intl.NumberFormat>();

/** Formats a non-negative number; formatters are cached by `locale|min|max|grouping`. */
function formatNumber(
    value: number,
    locale: string,
    minFraction: number,
    maxFraction: number,
    grouping: boolean,
): string {
    const key = `${locale}|${minFraction}|${maxFraction}|${grouping}`;
    let formatter = formatters.get(key);
    if (!formatter) {
        formatter = new Intl.NumberFormat(locale, {
            useGrouping: grouping,
            minimumFractionDigits: minFraction,
            maximumFractionDigits: maxFraction,
        });
        formatters.set(key, formatter);
    }
    return formatter.format(value);
}

/**
 * ASCII sign prefix so the result can be re-parsed. `rounded` is the
 * magnitude after display rounding: values that display as zero get no sign.
 */
function signPrefix(
    negative: boolean,
    rounded: number,
    signed: boolean,
): string {
    if (rounded === 0) return '';
    if (negative) return '-';
    return signed ? '+' : '';
}

const FRACTIONS = ['', '1/8', '1/4', '3/8', '1/2', '5/8', '3/4', '7/8'];

function formatImperial(
    mm: number,
    unit: 'ftin' | 'in',
    signed: boolean,
): string {
    // Integer eighths of an inch, round half up (04 §1.3).
    const n8 = Math.round((Math.abs(mm) / MM_PER_INCH) * 8);
    const feet = unit === 'ftin' ? Math.floor(n8 / 96) : 0;
    const rem = n8 - feet * 96;
    const inches = Math.floor(rem / 8);
    const frac = FRACTIONS[rem % 8] ?? '';
    let inchText: string;
    if (frac === '') inchText = `${inches}"`;
    else if (inches === 0) inchText = `${frac}"`;
    else inchText = `${inches} ${frac}"`;
    const body = feet > 0 ? `${feet}' ${inchText}` : inchText;
    return signPrefix(mm < 0, n8, signed) + body;
}

/** Formats integer millimetres in the user's unit (04 §1.3). */
export function formatLength(
    mm: number,
    prefs: UnitPrefs,
    opts: FormatLengthOptions = {},
): string {
    const { unit, locale } = coerceUnitPrefs(prefs);
    const style = opts.style ?? 'editor';
    const showUnit = opts.showUnit ?? true;
    const signed = opts.signed ?? false;

    if (unit === 'ftin' || unit === 'in') {
        return formatImperial(mm, unit, signed);
    }

    // Metric. Round to whole mm first so Intl never rounds a decimal tie.
    const rounded = Math.round(Math.abs(mm));
    const negative = mm < 0;
    const sign = signPrefix(negative, rounded, signed);

    if (style === 'summary') {
        if (rounded < 1000) {
            return `${sign}${formatNumber(rounded, locale, 0, 0, true)}${showUnit ? ' mm' : ''}`;
        }
        const metres = Math.round(rounded / 10) / 100;
        return `${sign}${formatNumber(metres, locale, 2, 2, true)}${showUnit ? ' m' : ''}`;
    }

    switch (unit) {
        case 'mm':
            return `${sign}${formatNumber(rounded, locale, 0, 0, false)}${showUnit ? ' mm' : ''}`;
        case 'cm':
            return `${sign}${formatNumber(rounded / 10, locale, 0, 1, false)}${showUnit ? ' cm' : ''}`;
        default:
            return `${sign}${formatNumber(rounded / 1000, locale, 0, 3, false)}${showUnit ? ' m' : ''}`;
    }
}

/** Formats an area in mm2 as m2 (2 decimals) or ft2 (integer, grouped) (04 §1.4). */
export function formatArea(mm2: number, prefs: UnitPrefs): string {
    const { system, locale } = coerceUnitPrefs(prefs);
    const abs = Math.abs(mm2);
    if (system === 'imperial') {
        const ft2 = Math.round(abs / MM2_PER_FT2);
        return `${signPrefix(mm2 < 0, ft2, false)}${formatNumber(ft2, locale, 0, 0, true)} ft²`;
    }
    const hundredths = Math.round(abs / 10_000);
    return `${signPrefix(mm2 < 0, hundredths, false)}${formatNumber(hundredths / 100, locale, 2, 2, false)} m²`;
}

/** Degrees with up to one decimal, trailing zeros stripped (04 §1.4). */
export function formatAngle(deg: number, locale: string): string {
    const tenths = Math.round(Math.abs(deg) * 10);
    return `${signPrefix(deg < 0, tenths, false)}${formatNumber(tenths / 10, locale, 0, 1, false)}°`;
}
