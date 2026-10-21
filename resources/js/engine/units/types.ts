/** Unit types, constants and preference coercion (04 §1.1). */

export type UnitSystem = 'metric' | 'imperial';
/** The `users.length_unit` values (02 §1.1). */
export type LengthUnit = 'mm' | 'cm' | 'm' | 'ftin' | 'in';

export interface UnitPrefs {
    system: UnitSystem;
    /** metric: mm|cm|m, imperial: ftin|in. A mismatched pair is coerced. */
    unit: LengthUnit;
    /** BCP-47 tag, from `auth.user.locale`; `'en'` in v1. */
    locale: string;
}

export interface ParseLengthContext {
    /** Unit for bare numbers (master §6.1). */
    unit: LengthUnit;
    /** Default false. */
    allowNegative?: boolean;
    /** Default true. */
    allowZero?: boolean;
    /** mm, inclusive; default `allowNegative ? -MAX_COORD : 0`. */
    min?: number;
    /** mm, inclusive; default `MAX_COORD`. */
    max?: number;
}

export const PARSE_LENGTH_ERROR_CODES = [
    'empty',
    'syntax',
    'unknown_unit',
    'negative',
    'zero',
    'too_small',
    'too_large',
    'division_by_zero',
] as const;

export type ParseLengthErrorCode = (typeof PARSE_LENGTH_ERROR_CODES)[number];

export interface ParseLengthError {
    code: ParseLengthErrorCode;
    messageKey: `engine.units.error.${ParseLengthErrorCode}`;
    /** min/max in mm; the UI formats them with `formatLength`. */
    params: { min?: number; max?: number; unit?: string };
}

export type ParseLengthResult =
    /** `mm` is an integer; `rounded` is true if the exact value was not an integer mm. */
    | { ok: true; mm: number; rounded: boolean }
    | { ok: false; error: ParseLengthError };

export interface FormatLengthOptions {
    /** Default `'editor'`. */
    style?: 'editor' | 'summary';
    /** Default true; ignored for imperial units (the prime marks are the value syntax). */
    showUnit?: boolean;
    /** Default false; true prefixes `+` for positive values. */
    signed?: boolean;
}

export const MM_PER_INCH = 25.4;
export const MM_PER_FOOT = 304.8;
export const MM2_PER_FT2 = 92_903.04;

/** Repairs a mismatched system/unit pair: metric+ftin/in -> mm, imperial+mm/cm/m -> ftin. */
export function coerceUnitPrefs(prefs: UnitPrefs): UnitPrefs {
    const imperialUnit = prefs.unit === 'ftin' || prefs.unit === 'in';
    if (prefs.system === 'metric' && imperialUnit) {
        return { ...prefs, unit: 'mm' };
    }
    if (prefs.system === 'imperial' && !imperialUnit) {
        return { ...prefs, unit: 'ftin' };
    }
    return { ...prefs };
}
