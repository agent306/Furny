/** `parseLength` (04 §1.2): lenient, unit-aware text to integer-mm parsing. */
import { MAX_COORD, roundMm } from '../geometry/tolerance';
import {
    MM_PER_FOOT,
    MM_PER_INCH,
    type ParseLengthContext,
    type ParseLengthError,
    type ParseLengthErrorCode,
    type ParseLengthResult,
} from './types';

function fail(
    code: ParseLengthErrorCode,
    params: ParseLengthError['params'] = {},
): { ok: false; error: ParseLengthError } {
    return {
        ok: false,
        error: { code, messageKey: `engine.units.error.${code}`, params },
    };
}

export type NormalizedLength =
    | { ok: true; text: string; negative: boolean }
    | { ok: false; error: ParseLengthError };

const THOUSANDS_PREFIX = /^\d{1,3}(,\d{3})+(\.\d+)?/;

/** Step 1 of 04 §1.2: normalisation, sign extraction and comma handling. */
export function normalizeLengthInput(input: string): NormalizedLength {
    if (typeof input !== 'string' || input.trim() === '') {
        return fail('empty');
    }
    let s = input
        .normalize('NFKC')
        .replace(/[′’‘‛´`]/g, "'")
        .replace(/[″“”‟〃]/g, '"')
        .replace(/''/g, '"')
        .replace(/[−–]/g, '-')
        .replace(/\s/g, ' ')
        .toLowerCase()
        .replace(/ {2,}/g, ' ')
        .trim();

    let negative = false;
    if (s.startsWith('-') || s.startsWith('+')) {
        negative = s.startsWith('-');
        s = s.slice(1).trim();
    }

    const thousands = THOUSANDS_PREFIX.exec(s);
    if (thousands) {
        s = thousands[0].replace(/,/g, '') + s.slice(thousands[0].length);
    } else if (s.includes(',')) {
        const single = s.indexOf(',') === s.lastIndexOf(',');
        if (single && !s.includes('.')) {
            s = s.replace(',', '.');
        } else {
            return fail('syntax');
        }
    }
    if (s.includes(',')) {
        return fail('syntax');
    }
    return { ok: true, text: s, negative };
}

// Regex fragments of 04 §1.2. Group names keep the five patterns readable.
const NUM = String.raw`\d+(?:\.\d*)?|\.\d+`;
const num = (name: string): string => `(?<${name}>${NUM})`;
const inchVal = (): string =>
    `(?:(?<iWhole>\\d+)[ -](?<iNum>\\d+)\\/(?<iDen>\\d+)` +
    `|(?<fNum>\\d+)\\/(?<fDen>\\d+)` +
    `|(?<iDec>${NUM}))`;
const MUNIT =
    '(?<munit>mm|millimet(?:er|re)s?|cm|centimet(?:er|re)s?|m|met(?:er|re)s?)';
const FUNIT = "(?:'|ft|foot|feet)";
const IUNIT = '(?:"|in|inch|inches)';

const P1 = new RegExp(`^${num('n')} ?${MUNIT}$`);
const P2 = new RegExp(
    `^${num('feet')} ?${FUNIT} ?-? ?${inchVal()} ?${IUNIT}?$`,
);
const P3 = new RegExp(`^${num('feet')} ?${FUNIT}$`);
const P4 = new RegExp(`^${inchVal()} ?${IUNIT}$`);
const P5 = new RegExp(`^${inchVal()}$`);
const P6 = new RegExp(`^${num('n')} ?(?<word>[a-z]+)$`);

type Groups = Record<string, string | undefined>;

/** Inch value of an INCHVAL match; `null` when a denominator is zero. */
function inchValue(g: Groups): number | null {
    if (g.iWhole !== undefined) {
        const den = Number(g.iDen);
        return den === 0 ? null : Number(g.iWhole) + Number(g.iNum) / den;
    }
    if (g.fNum !== undefined) {
        const den = Number(g.fDen);
        return den === 0 ? null : Number(g.fNum) / den;
    }
    return Number(g.iDec);
}

function metricFactor(unit: string): number {
    if (unit.startsWith('mm') || unit.startsWith('milli')) return 1;
    if (unit.startsWith('c')) return 10;
    return 1000;
}

function bareFactor(unit: ParseLengthContext['unit']): number {
    switch (unit) {
        case 'mm':
            return 1;
        case 'cm':
            return 10;
        case 'm':
            return 1000;
        default:
            // 'in' and 'ftin': bare numbers are inches (04 §1.2 step 3).
            return MM_PER_INCH;
    }
}

/** Steps 2-3: match the patterns and compute the exact value in mm. */
function evaluate(
    text: string,
    ctx: ParseLengthContext,
): { ok: true; v: number } | { ok: false; error: ParseLengthError } {
    let m: RegExpExecArray | null;

    if ((m = P1.exec(text))) {
        const g = m.groups as Groups;
        return { ok: true, v: Number(g.n) * metricFactor(g.munit ?? 'm') };
    }
    if ((m = P2.exec(text))) {
        const g = m.groups as Groups;
        const inches = inchValue(g);
        if (inches === null) return fail('division_by_zero');
        return {
            ok: true,
            v: Number(g.feet) * MM_PER_FOOT + inches * MM_PER_INCH,
        };
    }
    if ((m = P3.exec(text))) {
        const g = m.groups as Groups;
        return { ok: true, v: Number(g.feet) * MM_PER_FOOT };
    }
    if ((m = P4.exec(text))) {
        const inches = inchValue(m.groups as Groups);
        if (inches === null) return fail('division_by_zero');
        return { ok: true, v: inches * MM_PER_INCH };
    }
    if ((m = P5.exec(text))) {
        const g = m.groups as Groups;
        const fractional = g.iWhole !== undefined || g.fNum !== undefined;
        if (fractional && ctx.unit !== 'in' && ctx.unit !== 'ftin') {
            return fail('syntax');
        }
        const value = inchValue(g);
        if (value === null) return fail('division_by_zero');
        return { ok: true, v: value * bareFactor(ctx.unit) };
    }
    if ((m = P6.exec(text))) {
        return fail('unknown_unit', { unit: (m.groups as Groups).word });
    }
    return fail('syntax');
}

/**
 * Parses user text into integer millimetres (04 §1.2). Never throws; every
 * failure is a `ParseLengthError` with a translation key.
 */
export function parseLength(
    input: string,
    ctx: ParseLengthContext,
): ParseLengthResult {
    const normalized = normalizeLengthInput(input);
    if (!normalized.ok) return normalized;

    const evaluated = evaluate(normalized.text, ctx);
    if (!evaluated.ok) return evaluated;

    let v = evaluated.v;
    // Only huge digit runs reach this: Infinity / Infinity from a fraction.
    if (Number.isNaN(v)) return fail('syntax');
    if (normalized.negative) v = -v;

    // `+ 0` turns a negative zero from roundMm into 0 (hashes and snapshots).
    const mm = roundMm(v) + 0;
    const rounded = Math.abs(v - mm) > 1e-9;

    if (mm < 0 && !ctx.allowNegative) return fail('negative');
    if (mm === 0 && ctx.allowZero === false) return fail('zero');
    const min = ctx.min ?? (ctx.allowNegative ? -MAX_COORD : 0);
    const max = ctx.max ?? MAX_COORD;
    if (mm < min) return fail('too_small', { min });
    if (mm > max) return fail('too_large', { max });
    return { ok: true, mm, rounded };
}
