import { describe, expect, it } from 'vitest';
import { countryOptions, flagEmoji, isCountryCode } from '@/lib/countries';

describe('flagEmoji', () => {
    it('builds the flag from regional indicator letters', () => {
        expect(flagEmoji('IN')).toBe('🇮🇳');
        expect(flagEmoji('us')).toBe('🇺🇸');
    });
});

describe('isCountryCode', () => {
    it('knows the codes libphonenumber has metadata for', () => {
        expect(isCountryCode('IN')).toBe(true);
        expect(isCountryCode('XX')).toBe(false);
        expect(isCountryCode('in')).toBe(false);
        expect(isCountryCode('')).toBe(false);
    });
});

describe('countryOptions', () => {
    const options = countryOptions('en', 'IN');
    const codes = options.map((option) => option.code);

    it('lists the business country first, then IN, AE, SG, GB, US', () => {
        expect(codes.slice(0, 5)).toEqual(['IN', 'AE', 'SG', 'GB', 'US']);
        expect(
            countryOptions('en', 'DE')
                .slice(0, 6)
                .map((option) => option.code),
        ).toEqual(['DE', 'IN', 'AE', 'SG', 'GB', 'US']);
    });

    it('has every country once', () => {
        expect(new Set(codes).size).toBe(codes.length);
        expect(codes.length).toBeGreaterThan(200);
    });

    it('sorts the rest by name', () => {
        const rest = options.slice(5).map((option) => option.name);
        const sorted = [...rest].sort((a, b) => a.localeCompare(b, 'en'));

        expect(rest).toEqual(sorted);
    });

    it('carries name, flag and calling code', () => {
        const us = options.find((option) => option.code === 'US');

        expect(us).toEqual({
            code: 'US',
            name: 'United States',
            flag: '🇺🇸',
            callingCode: '1',
        });
        expect(
            options.find((option) => option.code === 'IN')?.callingCode,
        ).toBe('91');
    });

    it('ignores an unknown business country', () => {
        expect(
            countryOptions('en', 'ZZ')
                .slice(0, 2)
                .map((option) => option.code),
        ).toEqual(['IN', 'AE']);
    });

    it('falls back to English names for a locale Intl rejects', () => {
        expect(
            countryOptions('not a locale', 'IN').find(
                (option) => option.code === 'DE',
            )?.name,
        ).toBe('Germany');
    });
});
