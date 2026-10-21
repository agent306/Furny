import { beforeEach, describe, expect, it, vi } from 'vitest';

const construct = vi.hoisted(() => vi.fn());

vi.mock('intl-messageformat', async (importOriginal) => {
    const original =
        await importOriginal<typeof import('intl-messageformat')>();

    class CountingIntlMessageFormat extends original.IntlMessageFormat {
        constructor(
            ...args: ConstructorParameters<typeof original.IntlMessageFormat>
        ) {
            construct(...args);
            super(...args);
        }
    }

    return {
        ...original,
        IntlMessageFormat: CountingIntlMessageFormat,
        default: CountingIntlMessageFormat,
    };
});

// The test setup file already loaded the real module; load it again so that it
// binds to the counting IntlMessageFormat above.
vi.resetModules();
const { createI18n } = await import('@/lib/i18n');

const messages = {
    'a.b': 'Hello {name}',
    'a.items': '{count, plural, one {# item} other {# items}}',
    'a.plain': 'Plain text',
    'a.when': 'On {at, date, medium} at {at, time, short}',
    'a.status': '{status, select, open {Open for {name}} other {Closed}}',
    'a.broken': '{count, plural, one {#}',
};

function setup(options: { timeZone?: string; numberLocale?: string } = {}) {
    return createI18n({ locale: 'en', messages, ...options });
}

describe('t()', () => {
    beforeEach(() => {
        construct.mockClear();
        vi.restoreAllMocks();
    });

    it('substitutes simple arguments', () => {
        expect(setup().t('a.b', { name: 'Asha' })).toBe('Hello Asha');
    });

    it('renders a missing simple argument as an empty string and warns', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        expect(setup().t('a.b')).toBe('Hello ');
        expect(warn).toHaveBeenCalled();
    });

    it('pluralises with the number sign', () => {
        const { t } = setup();

        expect(t('a.items', { count: 1 })).toBe('1 item');
        expect(t('a.items', { count: 2 })).toBe('2 items');
    });

    it('resolves select branches and only warns for arguments that are rendered', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { t } = setup();

        expect(t('a.status', { status: 'open', name: 'Asha' })).toBe(
            'Open for Asha',
        );
        expect(t('a.status', { status: 'x' })).toBe('Closed');
        expect(warn).not.toHaveBeenCalled();
    });

    it('returns the key and warns when the key is missing', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        expect(setup().t('a.missing')).toBe('a.missing');
        expect(warn).toHaveBeenCalled();
    });

    it('never throws on a message that is not valid ICU', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});

        expect(setup().t('a.broken', { count: 1 })).toBe('a.broken');
    });

    it('never throws when a plural argument is missing', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});

        expect(() => setup().t('a.items')).not.toThrow();
    });

    it('constructs IntlMessageFormat once per key', () => {
        const { t } = setup();

        t('a.b', { name: 'Asha' });
        t('a.b', { name: 'Ravi' });
        t('a.plain');
        t('a.plain');

        expect(construct).toHaveBeenCalledTimes(2);
    });

    it('formats dates in the configured time zone', () => {
        const at = new Date('2026-03-01T23:30:00Z');

        expect(
            setup({ timeZone: 'Asia/Kolkata' }).t('a.when', { at }),
        ).toContain('Mar 2, 2026');
        expect(setup({ timeZone: 'UTC' }).t('a.when', { at })).toContain(
            'Mar 1, 2026',
        );
    });
});

describe('has()', () => {
    it('reports whether a key exists', () => {
        const { has } = setup();

        expect(has('a.b')).toBe(true);
        expect(has('a.nope')).toBe(false);
    });
});
