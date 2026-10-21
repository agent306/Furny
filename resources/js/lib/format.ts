// Intl-based formatting (15 §15.6). Locale = business locale (`en-IN` →
// lakh grouping), time zone = the user's (fallback: the business zone).
//
// Money is integer minor units. Nothing here rounds money: amounts reach
// `Intl` as exact decimal strings, and `parseMajorToMinor` refuses input it
// would have to round. The engine's integer helpers (`engine/money`, 08 §1)
// are for pricing; this module only displays and parses.

export type FormatContext = {
    /** Business locale, e.g. `en-IN`. */
    locale: string;
    /** Business currency (ISO-4217). */
    currency: string;
    /** The viewing user's IANA time zone. */
    timeZone: string;
    /** `business.timezone`; decides "today" for date-only business rules. */
    businessTimeZone: string;
};

export type DateStyle = 'short' | 'medium' | 'long';

export type FormatMoneyOptions = {
    signDisplay?: 'auto' | 'always' | 'exceptZero';
    /** `notation: 'compact'` (charts). */
    compact?: boolean;
};

export const DEFAULT_FORMAT_CONTEXT: FormatContext = {
    locale: 'en-IN',
    currency: 'INR',
    timeZone: 'Asia/Kolkata',
    businessTimeZone: 'Asia/Kolkata',
};

/** Shown for missing or unreadable values. */
export const PLACEHOLDER = '—';

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;
const HAS_OFFSET = /(?:Z|[+-]\d{2}(?::?\d{2})?)$/i;

const caches = {
    number: new Map<string, Intl.NumberFormat>(),
    date: new Map<string, Intl.DateTimeFormat>(),
    relative: new Map<string, Intl.RelativeTimeFormat>(),
};

function cached<T>(cache: Map<string, T>, id: string, create: () => T): T {
    let value = cache.get(id);

    if (value === undefined) {
        value = create();
        cache.set(id, value);
    }

    return value;
}

// Option objects are flat records of primitives; `key=value` pairs keep two
// shapes with equal values (`{ dateStyle: 's' }` vs `{ timeStyle: 's' }`) apart
// without the cost of `JSON.stringify` on every call.
function optionsKey(locale: string, options: object): string {
    let id = locale;

    for (const [key, value] of Object.entries(options)) {
        id += `|${key}=${String(value)}`;
    }

    return id;
}

function numberFormat(
    locale: string,
    options: Intl.NumberFormatOptions,
): Intl.NumberFormat {
    return cached(
        caches.number,
        optionsKey(locale, options),
        () => new Intl.NumberFormat(locale, options),
    );
}

function dateFormat(
    locale: string,
    options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
    return cached(
        caches.date,
        optionsKey(locale, options),
        () => new Intl.DateTimeFormat(locale, options),
    );
}

function currencyFormat(
    locale: string,
    currency: string,
    signDisplay: FormatMoneyOptions['signDisplay'],
    compact: boolean,
): Intl.NumberFormat {
    return cached(
        caches.number,
        `${locale}|money|${currency}|${signDisplay ?? ''}|${compact ? 'c' : 's'}`,
        () =>
            new Intl.NumberFormat(locale, {
                style: 'currency',
                currency,
                signDisplay,
                notation: compact ? 'compact' : 'standard',
            }),
    );
}

const validZones = new Map<string, string>();

/** `candidate` if it is a time zone `Intl` knows, else `fallback`; memoised. */
function validTimeZone(candidate: string, fallback: string): string {
    const id = `${candidate}\u0000${fallback}`;
    let zone = validZones.get(id);

    if (zone === undefined) {
        try {
            new Intl.DateTimeFormat('en', { timeZone: candidate });
            zone = candidate;
        } catch {
            zone = fallback;
        }

        validZones.set(id, zone);
    }

    return zone;
}

const currencyDigits = new Map<string, number>();

/** Minor-unit digits of a currency: 0 (JPY), 2 (INR) or 3 (BHD, KWD). */
export function currencyFractionDigits(currency: string): number {
    return fractionDigitsFor(currency);
}

function fractionDigitsFor(currency: string): number {
    let digits = currencyDigits.get(currency);

    if (digits === undefined) {
        digits =
            numberFormat('en', {
                style: 'currency',
                currency,
            }).resolvedOptions().maximumFractionDigits ?? 2;
        currencyDigits.set(currency, digits);
    }

    return digits;
}

function assertMinorUnits(minor: number): void {
    if (!Number.isSafeInteger(minor)) {
        throw new RangeError(
            `Money is a safe integer count of minor units, got ${String(minor)}.`,
        );
    }
}

/** `12345.67`-style decimal text for inputs: no symbol, no grouping. Exact. */
export function minorToMajorString(minor: number, currency: string): string {
    assertMinorUnits(minor);

    const digits = fractionDigitsFor(currency);
    const sign = minor < 0 ? '-' : '';
    const absolute = String(Math.abs(minor));

    if (digits === 0) {
        return `${sign}${absolute}`;
    }

    const padded = absolute.padStart(digits + 1, '0');

    return `${sign}${padded.slice(0, -digits)}.${padded.slice(-digits)}`;
}

export type NumberSeparators = {
    /** Between the integer and fraction digits (`.` or `,`). */
    decimal: string;
    /** Between thousands (`,`, `.`, NBSP, narrow NBSP, `’` or `'`). */
    group: string;
};

const DEFAULT_SEPARATORS: NumberSeparators = { decimal: '.', group: ',' };
const separatorCache = new Map<string, NumberSeparators>();

/**
 * The decimal and group separators `Intl` uses for `locale` (`de-DE`: `,` and
 * `.`; `fr-FR`: `,` and U+202F). A locale `Intl` rejects gets `.` and `,`.
 */
export function numberSeparators(locale: string): NumberSeparators {
    const cached = separatorCache.get(locale);

    if (cached) {
        return cached;
    }

    let separators = DEFAULT_SEPARATORS;

    try {
        const parts = numberFormat(locale, {
            useGrouping: true,
        }).formatToParts(12345.6);
        const part = (type: string): string | undefined =>
            parts.find((candidate) => candidate.type === type)?.value;

        separators = {
            decimal: part('decimal') ?? DEFAULT_SEPARATORS.decimal,
            group: part('group') ?? DEFAULT_SEPARATORS.group,
        };
    } catch {
        // Keep the defaults.
    }

    separatorCache.set(locale, separators);

    return separators;
}

const escapeRegExp = (text: string): string =>
    text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Integer part with grouping separators: western (1,234,567) or lakh
// (12,34,567), with the locale's group and decimal characters.
type NumberGrammar = {
    western: RegExp;
    lakh: RegExp;
    decimalText: RegExp;
};

const grammars = new Map<string, NumberGrammar>();

function grammarFor({ decimal, group }: NumberSeparators): NumberGrammar {
    const id = `${decimal}\u0000${group}`;
    let grammar = grammars.get(id);

    if (grammar === undefined) {
        const g = escapeRegExp(group);
        const d = escapeRegExp(decimal);

        grammar = {
            western: new RegExp(`^[1-9]\\d{0,2}(?:${g}\\d{3})+$`),
            lakh: new RegExp(`^[1-9]\\d?(?:${g}\\d{2})*${g}\\d{3}$`),
            decimalText: new RegExp(`^([\\d${g}]*)(?:${d}(\\d*))?$`),
        };
        grammars.set(id, grammar);
    }

    return grammar;
}

// Invisible direction marks (LRM, RLM, Arabic letter mark) that `Intl` puts
// into right-to-left output and that a paste carries along.
const BIDI_MARKS = /[\u200e\u200f\u061c]/g;

// Any Unicode decimal digit (Nd) becomes its ASCII digit. Nd characters sit in
// contiguous runs of ten starting at zero, so a digit's value is its distance
// from the start of the Nd stretch it is in, modulo ten (the stretch of the
// mathematical digits holds five runs).
function toAsciiDigits(text: string): string {
    return text.replace(/\p{Nd}/gu, (char) => {
        const code = char.codePointAt(0) ?? 0;

        if (code >= 0x30 && code <= 0x39) {
            return char;
        }

        let start = code;

        while (start > 0 && /^\p{Nd}$/u.test(String.fromCodePoint(start - 1))) {
            start--;
        }

        return String((code - start) % 10);
    });
}

// Typing a plain space, NBSP or narrow NBSP is the same as the locale's
// space-like group; the keyboard apostrophe and `’` stand for each other, as
// CLDR 48 (ICU 78) spells the de-CH group `'` where older data has `’`.
function normaliseGroup(text: string, group: string): string {
    if (/^\s$/.test(group)) {
        return text.replace(/[ \u00a0\u202f]/g, group);
    }

    return group === '\u2019' || group === "'"
        ? text.replace(/['\u2019]/g, group)
        : text;
}

/**
 * Parses typed major-unit text into integer minor units using string and
 * `BigInt` arithmetic only. Returns `null` instead of guessing:
 *
 * - more fraction digits than `fractionDigits` (`'1.005'` → `null`, never
 *   rounded; `'12.50'` with 0 digits too),
 * - broken grouping, several decimal points, letters, currency symbols,
 *   inner whitespace, an empty string, a lone sign or dot,
 * - the other locale's spelling (`'1,234.56'` under `de-DE` separators),
 * - results beyond `Number.MAX_SAFE_INTEGER`.
 *
 * Any Unicode decimal digit (`'١٢٣'`, `'१२३'`, fullwidth) counts as its ASCII
 * digit, and LRM/RLM/ALM marks are ignored, so `Intl` output of right-to-left
 * locales and pasted text parse.
 *
 * Accepts surrounding whitespace, western or lakh grouping
 * (`'1,23,456.78'`), `'.5'`, `'5.'` and one leading `+`, `-` or `−` (U+2212).
 * 08 §1 fixes no parsing rules, so signs are accepted here and callers that
 * forbid negatives (`CurrencyInput`'s `allowNegative`) check the result.
 *
 * `separators` default to `.` decimal and `,` group; pass
 * `numberSeparators(locale)` for the business locale. A space-like group
 * (`fr-FR`) also accepts a plain space or NBSP.
 */
export function parseMajorToMinor(
    text: string,
    fractionDigits: number,
    separators: NumberSeparators = DEFAULT_SEPARATORS,
): number | null {
    if (!Number.isInteger(fractionDigits) || fractionDigits < 0) {
        throw new RangeError(
            `fractionDigits must be a non-negative integer, got ${String(fractionDigits)}.`,
        );
    }

    const { western, lakh, decimalText } = grammarFor(separators);
    let rest = normaliseGroup(
        toAsciiDigits(text.replace(BIDI_MARKS, '')).trim(),
        separators.group,
    );
    let negative = false;

    if (/^[-−]/.test(rest)) {
        negative = true;
        rest = rest.slice(1);
    } else if (rest.startsWith('+')) {
        rest = rest.slice(1);
    }

    const match = decimalText.exec(rest);

    if (match === null) {
        return null;
    }

    const grouped = match[1] ?? '';
    const fraction = match[2] ?? '';

    if (grouped === '' && fraction === '') {
        return null;
    }

    if (
        grouped.includes(separators.group) &&
        !western.test(grouped) &&
        !lakh.test(grouped)
    ) {
        return null;
    }

    if (fraction.length > fractionDigits) {
        return null;
    }

    const integer = grouped.replaceAll(separators.group, '') || '0';
    const minor = BigInt(integer + fraction.padEnd(fractionDigits, '0'));

    if (minor > BigInt(Number.MAX_SAFE_INTEGER)) {
        return null;
    }

    const value = Number(minor);

    return negative && value !== 0 ? -value : value;
}

type Temporal = { kind: 'date'; date: Date } | { kind: 'instant'; date: Date };

/**
 * `YYYY-MM-DD` is a calendar date (held as UTC midnight and only ever
 * formatted with `timeZone: 'UTC'`, so no zone can shift it); anything with a
 * time is an instant. A time without an offset is UTC (the app zone), never
 * the browser's.
 */
function parseTemporal(value: string): Temporal | null {
    const dateOnly = DATE_ONLY.exec(value);

    if (dateOnly) {
        const [, year = '', month = '', day = ''] = dateOnly;
        const date = new Date(
            Date.UTC(Number(year), Number(month) - 1, Number(day)),
        );
        const real =
            date.getUTCFullYear() === Number(year) &&
            date.getUTCMonth() === Number(month) - 1 &&
            date.getUTCDate() === Number(day);

        return real ? { kind: 'date', date } : null;
    }

    if (!DATE_TIME.test(value)) {
        return null;
    }

    // `2026-10-20 04:30:00` (a space) is not ISO-8601; Safari rejects it.
    const iso = value.replace(' ', 'T');
    const date = new Date(HAS_OFFSET.test(iso) ? iso : `${iso}Z`);

    return Number.isNaN(date.getTime()) ? null : { kind: 'instant', date };
}

/**
 * Removes one leading or trailing currency token (`₹`, `INR`; any case) and the
 * space, NBSP or narrow NBSP around it, keeping a sign that comes first:
 * `'-₹ 5'` → `'-5'`, `'12,345.67 INR'` → `'12,345.67'`. Text with no token, or
 * with a token on both ends, is returned trimmed, so the number parser still
 * rejects it.
 */
export function stripCurrencyTokens(
    text: string,
    tokens: readonly string[],
): string {
    let rest = text.trim();
    const sign = /^[-−+]/.exec(rest)?.[0] ?? '';

    rest = rest.slice(sign.length).trim();

    const lower = rest.toLowerCase();

    for (const token of tokens.map((candidate) => candidate.toLowerCase())) {
        if (lower.startsWith(token)) {
            rest = rest.slice(token.length).trim();
            break;
        }

        if (lower.endsWith(token)) {
            rest = rest.slice(0, rest.length - token.length).trim();
            break;
        }
    }

    return `${sign}${rest}`;
}

export type Formatters = ReturnType<typeof createFormat>;

/**
 * Formatting functions bound to a context. Pass a function to read the
 * context on every call (`useFormat` does, so prop changes apply at once).
 */
export function createFormat(source: FormatContext | (() => FormatContext)) {
    const read = (): FormatContext =>
        typeof source === 'function' ? source() : source;

    // Number formatting only needs `read()`; the time-zone checks run only for
    // the date functions.
    const context = (): FormatContext => {
        const raw = read();
        const businessTimeZone = validTimeZone(
            raw.businessTimeZone,
            DEFAULT_FORMAT_CONTEXT.businessTimeZone,
        );

        return {
            ...raw,
            businessTimeZone,
            timeZone: validTimeZone(raw.timeZone, businessTimeZone),
        };
    };

    function formatMoney(
        minor: number,
        currency?: string,
        options: FormatMoneyOptions = {},
    ): string {
        const { locale, currency: businessCurrency } = read();
        const code = currency ?? businessCurrency;

        // The exact decimal string, not `minor / 100`: no float in between.
        return currencyFormat(
            locale,
            code,
            options.signDisplay,
            options.compact === true,
        ).format(minorToMajorString(minor, code) as `${number}`);
    }

    // The same cached currency formatter, split at the symbol: the amount
    // text (`12,345.67`, `-0.005`) and the symbol (`₹`) apart, for inputs that
    // draw the symbol beside the field.
    function moneyParts(
        minor: number,
        currency?: string,
    ): { symbol: string; amount: string } {
        const { locale, currency: businessCurrency } = read();
        const code = currency ?? businessCurrency;
        const parts = currencyFormat(
            locale,
            code,
            undefined,
            false,
        ).formatToParts(minorToMajorString(minor, code) as `${number}`);
        const text = (own: boolean): string =>
            parts
                .filter((part) => (part.type === 'currency') === own)
                .map((part) => part.value)
                .join('')
                .trim();

        return { symbol: text(true), amount: text(false) };
    }

    /** `12,345.67`: the grouped amount of `formatMoney`, without the symbol. */
    function formatMoneyAmount(minor: number, currency?: string): string {
        return moneyParts(minor, currency).amount;
    }

    /** `₹`, `$`, `BHD`: the currency symbol of `formatMoney`. */
    function currencySymbol(currency?: string): string {
        return moneyParts(0, currency).symbol;
    }

    /**
     * What a user may paste around an amount for `currency`: its symbol
     * (`US$`), narrow symbol (`$`) and ISO code (`USD`), longest first.
     */
    function currencyTokens(currency?: string): string[] {
        const { locale, currency: businessCurrency } = read();
        const code = currency ?? businessCurrency;
        const narrow = cached(
            caches.number,
            `${locale}|narrow|${code}`,
            () =>
                new Intl.NumberFormat(locale, {
                    style: 'currency',
                    currency: code,
                    currencyDisplay: 'narrowSymbol',
                }),
        );
        const symbols = [
            currencySymbol(code),
            narrow.formatToParts(0).find((part) => part.type === 'currency')
                ?.value ?? '',
            code,
        ];

        return [...new Set(symbols.filter((token) => token !== ''))].sort(
            (a, b) => b.length - a.length,
        );
    }

    function formatNumber(
        n: number,
        options?: Intl.NumberFormatOptions,
    ): string {
        return numberFormat(read().locale, options ?? {}).format(n);
    }

    function formatPercent(fraction: number, digits = 0): string {
        return numberFormat(read().locale, {
            style: 'percent',
            minimumFractionDigits: 0,
            maximumFractionDigits: digits,
        }).format(fraction);
    }

    /** `3500 → "35%"`, `1250 → "12.5%"`: a basis point is 0.01%. */
    function formatBps(bps: number): string {
        return numberFormat(read().locale, {
            style: 'percent',
            minimumFractionDigits: 0,
            maximumFractionDigits: 2,
        }).format(bps / 10_000);
    }

    /**
     * A date-only string prints as that calendar date; an instant prints its
     * date in the user's zone. Unreadable input prints `—`.
     */
    function formatDate(
        isoOrDate: string,
        style: DateStyle = 'medium',
    ): string {
        const { locale, timeZone } = context();
        const parsed = parseTemporal(isoOrDate);

        if (parsed === null) {
            return PLACEHOLDER;
        }

        return dateFormat(locale, {
            dateStyle: style,
            timeZone: parsed.kind === 'date' ? 'UTC' : timeZone,
        }).format(parsed.date);
    }

    /** An instant in the user's zone; a date-only string has no time, so it prints as a date. */
    function formatDateTime(iso: string, style: DateStyle = 'medium'): string {
        const { locale, timeZone } = context();
        const parsed = parseTemporal(iso);

        if (parsed === null) {
            return PLACEHOLDER;
        }

        if (parsed.kind === 'date') {
            return formatDate(iso, style);
        }

        return dateFormat(locale, {
            dateStyle: style,
            timeStyle: 'short',
            timeZone,
        }).format(parsed.date);
    }

    /**
     * The time of an instant in the user's zone (`DateText kind="time"`):
     * hours and minutes, plus the zone name for `long`.
     */
    function formatTime(iso: string, style: DateStyle = 'short'): string {
        const { locale, timeZone } = context();
        const parsed = parseTemporal(iso);

        if (parsed === null || parsed.kind === 'date') {
            return PLACEHOLDER;
        }

        return dateFormat(locale, {
            timeStyle: style === 'long' ? 'long' : 'short',
            timeZone,
        }).format(parsed.date);
    }

    /** "3 hr ago", "yesterday". `now` exists for tests and tickers. */
    function formatRelative(
        iso: string,
        now: Date | number = Date.now(),
    ): string {
        const parsed = parseTemporal(iso);

        if (parsed === null) {
            return PLACEHOLDER;
        }

        const seconds = Math.trunc(
            (parsed.date.getTime() - new Date(now).getTime()) / 1000,
        );
        const magnitude = Math.abs(seconds);
        const [value, unit]: [number, Intl.RelativeTimeFormatUnit] =
            magnitude < 60
                ? [0, 'second']
                : magnitude < 3600
                  ? [Math.trunc(seconds / 60), 'minute']
                  : magnitude < 86_400
                    ? [Math.trunc(seconds / 3600), 'hour']
                    : magnitude < 7 * 86_400
                      ? [Math.trunc(seconds / 86_400), 'day']
                      : magnitude < 30 * 86_400
                        ? [Math.trunc(seconds / (7 * 86_400)), 'week']
                        : magnitude < 365 * 86_400
                          ? [Math.trunc(seconds / (30 * 86_400)), 'month']
                          : [Math.trunc(seconds / (365 * 86_400)), 'year'];

        return cached(
            caches.relative,
            read().locale,
            () =>
                new Intl.RelativeTimeFormat(read().locale, {
                    numeric: 'auto',
                    style: 'short',
                }),
        ).format(value, unit);
    }

    /**
     * Binary units (1 KB = 1024 B), one decimal at most: `1536 → "1.5 KB"`.
     * Rolls up after rounding (1048575 B is "1 MB", not "1,024 KB"). TB is the
     * largest unit, so 2^50 B prints as "1,024 TB".
     */
    function formatFileSize(bytes: number): string {
        if (!Number.isFinite(bytes) || bytes < 0) {
            return PLACEHOLDER;
        }

        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        let size = bytes;
        let index = 0;

        const last = units.length - 1;
        // What the reader sees: whole bytes, otherwise one decimal.
        const shown = (): number =>
            index === 0 ? Math.round(size) : Math.round(size * 10) / 10;

        while (index < last && (size >= 1024 || shown() >= 1024)) {
            size /= 1024;
            index += 1;
        }

        return `${numberFormat(read().locale, {
            maximumFractionDigits: index === 0 ? 0 : 1,
        }).format(size)} ${units[index]}`;
    }

    /** `80000 → "1 min 20 s"`; whole seconds, hours do not roll into days. */
    function formatDuration(ms: number): string {
        if (!Number.isFinite(ms) || ms < 0) {
            return PLACEHOLDER;
        }

        const total = Math.round(ms / 1000);
        const parts = [
            [Math.floor(total / 3600), 'h'],
            [Math.floor((total % 3600) / 60), 'min'],
            [total % 60, 's'],
        ] as const;
        const shown = parts
            .filter(([amount]) => amount > 0)
            .map(([amount, unit]) => `${String(amount)} ${unit}`);

        return shown.length > 0 ? shown.join(' ') : '0 s';
    }

    /** `YYYY-MM-DD` of the instant in the business zone. */
    function todayInBusinessTz(now: Date | number = Date.now()): string {
        const parts = dateFormat('en-US', {
            timeZone: context().businessTimeZone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        }).formatToParts(new Date(now));
        const part = (type: string): string =>
            parts.find((candidate) => candidate.type === type)?.value ?? '';

        return `${part('year')}-${part('month')}-${part('day')}`;
    }

    return {
        formatMoney,
        formatMoneyAmount,
        currencySymbol,
        currencyTokens,
        minorToMajorString,
        parseMajorToMinor,
        formatNumber,
        formatPercent,
        formatBps,
        formatDateTime,
        formatDate,
        formatTime,
        formatRelative,
        formatFileSize,
        formatDuration,
        todayInBusinessTz,
    };
}

let current: FormatContext = DEFAULT_FORMAT_CONTEXT;

/** Replaces parts of the context behind the module-level functions below. */
export function setFormatContext(context: Partial<FormatContext>): void {
    current = { ...current, ...context };
}

const bound = createFormat(() => current);

export const {
    formatMoney,
    formatMoneyAmount,
    currencySymbol,
    currencyTokens,
    formatNumber,
    formatPercent,
    formatBps,
    formatDateTime,
    formatDate,
    formatTime,
    formatRelative,
    formatFileSize,
    formatDuration,
    todayInBusinessTz,
} = bound;
