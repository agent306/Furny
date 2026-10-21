// P1 placeholder for the geometry engine's length parsing and formatting
// (`04` §1: `parseLength`, `formatLength`). The two exports and their
// signatures are the contract `LengthInput` is built on; P4 replaces the
// BODIES with the engine and leaves the signatures alone.
//
// What the placeholder covers: metric lengths (`mm`, `cm`, `m` and their long
// names, bare numbers in the current unit, `.` decimals, thousands commas and
// decimal commas as in `04` §1.2 step 6). Feet and inches are recognised and
// answered with `unsupported` so the UI can say so instead of "invalid".
//
// Everything is exact: the digits are shifted as a string and rounded half
// away from zero (`roundMm`, `04` §0), never multiplied as a float.

/** `users.length_unit` (02 §1.1): the unit for bare numbers and for display. */
export type LengthUnitKey = App.Domain.Identity.Enums.LengthUnit;

export type ParseLengthInputResult =
    { ok: true; mm: number } | { ok: false; reason: 'invalid' | 'unsupported' };

const INVALID = { ok: false, reason: 'invalid' } as const;
const UNSUPPORTED = { ok: false, reason: 'unsupported' } as const;

// Decimal places to shift to reach millimetres.
const METRIC_SHIFT = { mm: 0, cm: 1, m: 3 } as const;
type MetricUnit = keyof typeof METRIC_SHIFT;

const NUM = String.raw`(\d+(?:\.\d*)?|\.\d+)`;
const WITH_UNIT = new RegExp(
    String.raw`^${NUM} ?(mm|millimet(?:er|re)s?|cm|centimet(?:er|re)s?|m|met(?:er|re)s?)$`,
);
const BARE = new RegExp(`^${NUM}$`);
// `6 1/2` and `1/2`: valid bare numbers only in inches (04 §1.2 P5).
const BARE_FRACTION = /^(?:\d+[ -])?\d+\/\d+$/;
const THOUSANDS = /^\d{1,3}(?:,\d{3})+(?:\.\d+)?/;
// A digit followed by a feet or inch unit, or any prime mark next to a digit.
const IMPERIAL =
    /\d ?(?:ft|foot|feet|inch(?:es)?|in)(?![a-z])|\d.*['"]|['"].*\d/;

const APOSTROPHES = /[′’‘‛´`]/g;
const QUOTES = /[″“”‟〃]/g;

// `mm`, `millimetres`, `cm`, `centimeters`, `m`, `metres`, …
function metricUnit(name: string): MetricUnit {
    if (name === 'mm' || name.startsWith('milli')) {
        return 'mm';
    }

    return name.startsWith('c') ? 'cm' : 'm';
}

// `num` shifted by `places` decimal places, rounded half up to an integer,
// all in string and BigInt arithmetic. Null beyond a safe integer.
function scaleToMm(num: string, places: number): number | null {
    const [whole = '', fraction = ''] = num.split('.');
    const padded = fraction.padEnd(places, '0');
    const kept = BigInt(`${whole}${padded.slice(0, places)}` || '0');
    const roundUp = (padded[places] ?? '0') >= '5';
    const mm = kept + (roundUp ? 1n : 0n);

    return mm > BigInt(Number.MAX_SAFE_INTEGER) ? null : Number(mm);
}

function normalise(text: string): string {
    return text
        .normalize('NFKC')
        .replace(APOSTROPHES, "'")
        .replace(QUOTES, '"')
        .replace(/[−–]/g, '-')
        .replace(/\s/g, ' ')
        .toLowerCase()
        .replace(/ {2,}/g, ' ')
        .trim();
}

/**
 * Parses typed text into integer millimetres. `unit` is the unit of a bare
 * number. The sign is kept (`'-50'` → `-50`); callers decide whether a
 * negative is allowed.
 */
export function parseLengthInput(
    text: string,
    unit: LengthUnitKey,
): ParseLengthInputResult {
    let rest = normalise(text);
    let negative = false;

    if (rest === '') {
        return INVALID;
    }

    if (rest.startsWith('-') || rest.startsWith('+')) {
        negative = rest.startsWith('-');
        rest = rest.slice(1).trim();
    }

    // Thousands groups (`2,400 mm`, `1,234.5`), else one decimal comma
    // (`3,2 m`); any other comma is an error (04 §1.2 step 6).
    const grouped = THOUSANDS.exec(rest);

    if (grouped) {
        rest = grouped[0].replaceAll(',', '') + rest.slice(grouped[0].length);
    } else if (rest.split(',').length === 2 && !rest.includes('.')) {
        rest = rest.replace(',', '.');
    }

    if (rest.includes(',')) {
        return INVALID;
    }

    const suffixed = WITH_UNIT.exec(rest);
    const bare = suffixed ? null : BARE.exec(rest);
    const imperialUnit = unit === 'ftin' || unit === 'in';

    if (suffixed === null && (bare === null || imperialUnit)) {
        // Feet and inches, or a bare number that would mean inches.
        const imperial =
            IMPERIAL.test(rest) ||
            (imperialUnit && (bare !== null || BARE_FRACTION.test(rest)));

        return imperial ? UNSUPPORTED : INVALID;
    }

    const number = (suffixed ?? bare)?.[1] ?? '';
    const metric: MetricUnit = suffixed
        ? metricUnit(suffixed[2] ?? 'mm')
        : unit === 'cm' || unit === 'm'
          ? unit
          : 'mm';
    const mm = scaleToMm(number, METRIC_SHIFT[metric]);

    if (mm === null) {
        return INVALID;
    }

    return { ok: true, mm: negative && mm !== 0 ? -mm : mm };
}

/**
 * The editable text for `mm` in `opts.unit`, without the unit symbol (the
 * input draws that beside the field). `mm` is a bare integer, `cm` has up to
 * one decimal and `m` up to three, trailing zeros stripped (04 §1.3, editor
 * style). The `.` decimal point is what `parseLengthInput` reads back.
 * Imperial is not available in P1 and falls back to millimetres.
 */
export function formatLengthValue(
    mm: number,
    opts: { system: 'metric' | 'imperial'; unit: LengthUnitKey },
): string {
    const unit = opts.system === 'metric' ? opts.unit : 'mm';
    const places = unit === 'cm' ? 1 : unit === 'm' ? 3 : 0;
    const sign = mm < 0 ? '-' : '';
    const digits = String(Math.abs(Math.round(mm))).padStart(places + 1, '0');

    if (places === 0) {
        return `${sign}${digits}`;
    }

    const whole = digits.slice(0, -places);
    const fraction = digits.slice(-places).replace(/0+$/, '');

    return `${sign}${whole}${fraction === '' ? '' : `.${fraction}`}`;
}
