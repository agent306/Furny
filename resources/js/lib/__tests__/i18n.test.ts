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
    'a.bareDate': '{at, date}',
    'a.dateSkeleton': '{at, date, ::yyyyMMMd}',
    'a.timeSkeleton': '{at, time, ::hm}',
    'a.broken': '{count, plural, one {#}',
    'a.rich':
        'Read the <terms>Terms of {site}</terms> and <privacy>Privacy</privacy>.',
    'a.richOnly': '<b>Bold</b>',
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

    describe('parts() for a message with tags', () => {
        it('splits the text from the tagged runs, in order', () => {
            expect(setup().parts('a.rich', { site: 'Furny' })).toEqual([
                'Read the ',
                { tag: 'terms', text: 'Terms of Furny' },
                ' and ',
                { tag: 'privacy', text: 'Privacy' },
                '.',
            ]);
        });

        it('is one tagged part for a message that is only a tag', () => {
            expect(setup().parts('a.richOnly')).toEqual([
                { tag: 'b', text: 'Bold' },
            ]);
        });

        it('is the text for a message without tags', () => {
            expect(setup().parts('a.b', { name: 'Asha' })).toEqual([
                'Hello Asha',
            ]);
        });

        it('is the key, with a warning, for a key that is missing', () => {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

            expect(setup().parts('a.missing')).toEqual(['a.missing']);
            expect(warn).toHaveBeenCalled();
        });

        it('never throws on a message that is not valid ICU', () => {
            vi.spyOn(console, 'warn').mockImplementation(() => {});

            expect(setup().parts('a.broken', { count: 1 })).toEqual([
                'a.broken',
            ]);
        });
    });

    describe('in the configured time zone', () => {
        // 23:30 UTC on 1 March is 05:00 on 2 March in Asia/Kolkata.
        const at = new Date('2026-03-01T23:30:00Z');
        const kolkata = () => setup({ timeZone: 'Asia/Kolkata' });

        it('formats named date and time styles', () => {
            const out = kolkata().t('a.when', { at });

            expect(out).toContain('Mar 2, 2026');
            expect(out).toContain('5:00');
        });

        it('formats a bare date argument', () => {
            expect(kolkata().t('a.bareDate', { at })).toContain('3/2/2026');
        });

        it('formats date and time skeletons', () => {
            const { t } = kolkata();

            expect(t('a.dateSkeleton', { at })).toContain('Mar 2, 2026');
            expect(t('a.timeSkeleton', { at })).toContain('5:00');
        });

        it('keeps UTC when the time zone is UTC', () => {
            const { t } = setup({ timeZone: 'UTC' });

            expect(t('a.bareDate', { at })).toContain('3/1/2026');
            expect(t('a.dateSkeleton', { at })).toContain('Mar 1, 2026');
            expect(t('a.timeSkeleton', { at })).toContain('11:30');
        });
    });
});

describe('has()', () => {
    it('reports whether a key exists', () => {
        const { has } = setup();

        expect(has('a.b')).toBe(true);
        expect(has('a.nope')).toBe(false);
    });
});
