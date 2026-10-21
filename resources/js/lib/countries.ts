import { getCountries, getCountryCallingCode } from 'libphonenumber-js/min';
import type { CountryCode } from 'libphonenumber-js/min';

// Country lists for `PhoneInput` and `AddressFields` (15 §9.25, §9.26). The
// codes are the regions `libphonenumber-js/min` has metadata for, which is
// every ISO-3166-1 region with a calling code; names come from `Intl`.

export type { CountryCode };

export type CountryOption = {
    code: CountryCode;
    name: string;
    flag: string;
    /** Digits only, e.g. `91`. */
    callingCode: string;
};

/** After the business country (15 §9.25). */
export const PRIORITY_COUNTRIES: readonly CountryCode[] = [
    'IN',
    'AE',
    'SG',
    'GB',
    'US',
];

const known = new Set<string>(getCountries());

export function isCountryCode(value: string): value is CountryCode {
    return known.has(value);
}

/** `IN` → 🇮🇳, from the two regional-indicator letters. */
export function flagEmoji(code: string): string {
    return [...code.toUpperCase()]
        .map((letter) => String.fromCodePoint(0x1f1a5 + letter.charCodeAt(0)))
        .join('');
}

function validLocale(locale: string): string {
    try {
        return Intl.getCanonicalLocales(locale)[0] ?? 'en';
    } catch {
        return 'en';
    }
}

const cache = new Map<string, CountryOption[]>();

/**
 * Every country: the business country, then the priority list, then the rest
 * by name in `locale`. Cached per locale and business country.
 */
export function countryOptions(
    locale: string,
    businessCountry: string,
): CountryOption[] {
    const id = `${locale}|${businessCountry}`;
    const cached = cache.get(id);

    if (cached) {
        return cached;
    }

    const tag = validLocale(locale);
    const names = new Intl.DisplayNames([tag], { type: 'region' });
    const all = getCountries().map((code): CountryOption => ({
        code,
        name: names.of(code) ?? code,
        flag: flagEmoji(code),
        callingCode: getCountryCallingCode(code),
    }));
    const byCode = new Map(all.map((option) => [option.code, option]));
    const first = [businessCountry, ...PRIORITY_COUNTRIES]
        .filter(isCountryCode)
        .filter((code, index, codes) => codes.indexOf(code) === index);
    const priority = first.flatMap((code) => byCode.get(code) ?? []);
    const rest = all
        .filter((option) => !first.includes(option.code))
        .sort((a, b) => a.name.localeCompare(b.name, tag));
    const options = [...priority, ...rest];

    cache.set(id, options);

    return options;
}
