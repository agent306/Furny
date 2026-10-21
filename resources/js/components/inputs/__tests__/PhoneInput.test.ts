import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page, resetPage } from '@/test/inertiaPage';

vi.mock('@inertiajs/vue3', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@inertiajs/vue3')>()),
    usePage: () => page,
}));

import PhoneInput from '@/components/inputs/PhoneInput.vue';
import { DENSITY_KEY } from '@/composables/useControlSize';

beforeEach(() =>
    resetPage({
        business: {
            locale: 'en-IN',
            currency: 'INR',
            timezone: 'Asia/Kolkata',
            defaultCountryCode: 'IN',
        },
    }),
);

afterEach(() => {
    document.body.innerHTML = '';
});

type Wrapper = ReturnType<typeof mountInput>;

function mountInput(props: Record<string, unknown> = {}, attrs = {}) {
    return mount(PhoneInput, {
        props: { modelValue: null, defaultCountry: 'IN', ...props },
        attrs,
        attachTo: document.body,
    });
}

function updates(wrapper: Wrapper): unknown[] {
    return (wrapper.emitted('update:modelValue') ?? []).map(([v]) => v);
}

function lastEmitted(wrapper: Wrapper): unknown {
    return updates(wrapper).at(-1);
}

function country(wrapper: Wrapper): string | undefined {
    return wrapper
        .get('[data-slot="phone-country"]')
        .attributes('data-country');
}

async function type(wrapper: Wrapper, text: string, finish = true) {
    const input = wrapper.get<HTMLInputElement>('input[type="tel"]');

    await input.trigger('focus');
    await input.setValue(text);

    if (finish) {
        await input.trigger('blur');
    }
}

describe('PhoneInput', () => {
    describe('E.164 output (default country IN)', () => {
        it.each([
            '09876 543 210',
            '+91-98765-43210',
            '98765 43210',
            '9876543210',
            '(+91) 98765 43210',
            '+91 98765 43210',
        ])('%s emits +919876543210', async (text) => {
            const wrapper = mountInput();

            await type(wrapper, text);

            expect(lastEmitted(wrapper)).toBe('+919876543210');
            expect(country(wrapper)).toBe('IN');
        });

        it('pasting +1 415 555 0100 switches the country to US', async () => {
            const wrapper = mountInput();

            await type(wrapper, '+1 415 555 0100');

            expect(lastEmitted(wrapper)).toBe('+14155550100');
            expect(country(wrapper)).toBe('US');
            expect(wrapper.get('[data-slot="phone-country"]').text()).toContain(
                '+1',
            );
        });

        it('switches the country as soon as the pasted number is complete, before blur', async () => {
            const wrapper = mountInput();

            await type(wrapper, '+44 20 7946 0958', false);

            expect(country(wrapper)).toBe('GB');
            expect(lastEmitted(wrapper)).toBe('+442079460958');
        });

        it('emits live while typing, not only on blur', async () => {
            const wrapper = mountInput();

            await type(wrapper, '98765 43210', false);

            expect(lastEmitted(wrapper)).toBe('+919876543210');
        });

        it('a number valid in another region is read in the selected one', async () => {
            const wrapper = mountInput({ defaultCountry: 'US' });

            await type(wrapper, '(415) 555-0100');

            expect(lastEmitted(wrapper)).toBe('+14155550100');
            expect(country(wrapper)).toBe('US');
        });
    });

    describe('invalid input', () => {
        it('12ab emits null and shows phone.errors.invalid', async () => {
            const wrapper = mountInput();

            await type(wrapper, '12ab');

            expect(lastEmitted(wrapper)).toBeNull();
            expect(wrapper.text()).toContain('Enter a valid phone number.');
            expect(
                wrapper
                    .get<HTMLInputElement>('input[type="tel"]')
                    .attributes('aria-invalid'),
            ).toBe('true');
        });

        it.each([
            '12',
            '98765 4321',
            '+9',
            'abcdefghij',
            '98765-43210x',
            '++919876543210',
        ])('%s is invalid', async (text) => {
            const wrapper = mountInput();

            await type(wrapper, text);

            expect(lastEmitted(wrapper)).toBeNull();
            expect(wrapper.text()).toContain('Enter a valid phone number.');
        });

        it('keeps what was typed so it can be fixed', async () => {
            const wrapper = mountInput();

            await type(wrapper, '12ab');

            expect(
                wrapper.get<HTMLInputElement>('input[type="tel"]').element
                    .value,
            ).toBe('12ab');
        });

        it('links the error with aria-describedby', async () => {
            const wrapper = mountInput({}, { 'aria-describedby': 'hint' });

            await type(wrapper, '12ab');

            const ids = (
                wrapper
                    .get<HTMLInputElement>('input[type="tel"]')
                    .attributes('aria-describedby') ?? ''
            ).split(' ');

            expect(ids[0]).toBe('hint');
            expect(wrapper.get(`[id="${ids[1]}"]`).text()).toBe(
                'Enter a valid phone number.',
            );
        });

        it('shows no error while typing, and clears one once valid', async () => {
            const wrapper = mountInput();

            await type(wrapper, '9876', false);
            expect(wrapper.text()).not.toContain('Enter a valid phone number.');

            await type(wrapper, '12ab');
            expect(wrapper.text()).toContain('Enter a valid phone number.');

            await wrapper
                .get<HTMLInputElement>('input[type="tel"]')
                .setValue('98765 43210');
            expect(wrapper.text()).not.toContain('Enter a valid phone number.');
        });

        it('empty is null without an error', async () => {
            const wrapper = mountInput({ modelValue: '+919876543210' });

            await type(wrapper, '');

            expect(lastEmitted(wrapper)).toBeNull();
            expect(wrapper.text()).not.toContain('Enter a valid phone number.');
        });

        it('the invalid prop marks the field invalid', () => {
            const wrapper = mountInput({ invalid: true });

            expect(
                wrapper
                    .get<HTMLInputElement>('input[type="tel"]')
                    .attributes('aria-invalid'),
            ).toBe('true');
        });
    });

    describe('display', () => {
        it('shows the national format once blurred', async () => {
            const wrapper = mountInput();

            await type(wrapper, '9876543210');

            expect(
                wrapper.get<HTMLInputElement>('input[type="tel"]').element
                    .value,
            ).toBe('098765 43210');
        });

        it('Enter formats like blur', async () => {
            const wrapper = mountInput();
            const input = wrapper.get<HTMLInputElement>('input[type="tel"]');

            await input.trigger('focus');
            await input.setValue('+91-98765-43210');
            await input.trigger('keydown', { key: 'Enter' });

            expect(input.element.value).toBe('098765 43210');
        });

        it('reads an incoming E.164 value into country and national text', () => {
            const india = mountInput({ modelValue: '+919876543210' });

            expect(country(india)).toBe('IN');
            expect(
                india.get<HTMLInputElement>('input[type="tel"]').element.value,
            ).toBe('098765 43210');

            const us = mountInput({ modelValue: '+14155550100' });

            expect(country(us)).toBe('US');
            expect(
                us.get<HTMLInputElement>('input[type="tel"]').element.value,
            ).toBe('(415) 555-0100');
        });

        it('follows an outside change, and an outside null clears the field', async () => {
            const wrapper = mountInput({ modelValue: '+919876543210' });

            await wrapper.setProps({ modelValue: '+442079460958' });

            expect(country(wrapper)).toBe('GB');
            expect(
                wrapper.get<HTMLInputElement>('input[type="tel"]').element
                    .value,
            ).toBe('020 7946 0958');

            await wrapper.setProps({ modelValue: null });

            expect(
                wrapper.get<HTMLInputElement>('input[type="tel"]').element
                    .value,
            ).toBe('');
        });

        it('does not rewrite what is being typed when its own emit comes back', async () => {
            const wrapper = mountInput();
            const input = wrapper.get<HTMLInputElement>('input[type="tel"]');

            await input.trigger('focus');
            await input.setValue('98765 43210');
            await wrapper.setProps({ modelValue: '+919876543210' });

            expect(input.element.value).toBe('98765 43210');
        });

        it('uses the default country prop, else the business country', () => {
            expect(country(mountInput({ defaultCountry: 'AE' }))).toBe('AE');

            resetPage({ business: { defaultCountryCode: 'SG' } });
            expect(country(mountInput({ defaultCountry: undefined }))).toBe(
                'SG',
            );

            resetPage({});
            expect(country(mountInput({ defaultCountry: undefined }))).toBe(
                'IN',
            );
        });

        it('falls back to IN for a country it has no metadata for', () => {
            expect(country(mountInput({ defaultCountry: 'ZZ' }))).toBe('IN');
        });
    });

    describe('attributes', () => {
        it('input is type tel with the tel keypad and tel-national autofill', () => {
            const input =
                mountInput().get<HTMLInputElement>('input[type="tel"]');

            expect(input.attributes('inputmode')).toBe('tel');
            expect(input.attributes('autocomplete')).toBe('tel-national');
        });

        it('passes id and aria-label to the number input, class to the wrapper', () => {
            const wrapper = mountInput(
                {},
                { id: 'phone', 'aria-label': 'Phone', class: 'max-w-sm' },
            );

            expect(
                wrapper
                    .get<HTMLInputElement>('input[type="tel"]')
                    .attributes('id'),
            ).toBe('phone');
            expect(
                wrapper
                    .get<HTMLInputElement>('input[type="tel"]')
                    .attributes('aria-label'),
            ).toBe('Phone');
            expect(wrapper.classes()).toContain('max-w-sm');
        });

        it('disabled disables the selector and the input', () => {
            const wrapper = mountInput({ disabled: true });

            expect(
                wrapper
                    .get<HTMLInputElement>('input[type="tel"]')
                    .attributes('disabled'),
            ).toBeDefined();
            expect(
                wrapper
                    .get('[data-slot="phone-country"]')
                    .attributes('disabled'),
            ).toBeDefined();
        });

        it('has 44 px targets (h-11) in comfortable density, h-9 in compact', () => {
            const comfortable = mountInput();

            expect(
                comfortable
                    .get<HTMLInputElement>('input[type="tel"]')
                    .classes(),
            ).toContain('h-11');
            expect(
                comfortable.get('[data-slot="phone-country"]').classes(),
            ).toContain('h-11');

            const compact = mount(PhoneInput, {
                props: { modelValue: null },
                global: { provide: { [DENSITY_KEY]: 'compact' } },
            });

            expect(
                compact.get<HTMLInputElement>('input[type="tel"]').classes(),
            ).toContain('h-9');
            expect(
                compact.get('[data-slot="phone-country"]').classes(),
            ).toContain('h-9');
        });

        it('the selector is a labelled combobox naming the country', () => {
            const trigger = mountInput().get('[data-slot="phone-country"]');

            expect(trigger.attributes('role')).toBe('combobox');
            expect(trigger.attributes('aria-expanded')).toBe('false');
            expect(trigger.attributes('aria-label')).toBe('Country: India +91');
            expect(trigger.text()).toContain('+91');
        });
    });

    describe('country selector', () => {
        async function open(wrapper: Wrapper) {
            await wrapper.get('[data-slot="phone-country"]').trigger('click');
            await flushPromises();
        }

        function items(): HTMLElement[] {
            return [
                ...document.body.querySelectorAll<HTMLElement>(
                    '[data-slot="command-item"]',
                ),
            ];
        }

        it('opens a searchable list: business country first, then IN AE SG GB US', async () => {
            const wrapper = mountInput({ defaultCountry: 'IN' });

            await open(wrapper);

            expect(
                wrapper
                    .get('[data-slot="phone-country"]')
                    .attributes('aria-expanded'),
            ).toBe('true');
            expect(
                items()
                    .slice(0, 5)
                    .map((item) => item.textContent?.replace(/\s/g, '')),
            ).toEqual([
                '🇮🇳India+91',
                '🇦🇪UnitedArabEmirates+971',
                '🇸🇬Singapore+65',
                '🇬🇧UnitedKingdom+44',
                '🇺🇸UnitedStates+1',
            ]);
            expect(items().length).toBeGreaterThan(200);
            expect(
                document.body.querySelector('[data-slot="command-input"]'),
            ).not.toBeNull();
        });

        it('puts the business country first when it is not a priority country', async () => {
            resetPage({ business: { defaultCountryCode: 'DE' } });

            const wrapper = mountInput({ defaultCountry: undefined });

            await open(wrapper);

            expect(items()[0]?.textContent).toContain('Germany');
            expect(items()[1]?.textContent).toContain('India');
        });

        it('filters by name or calling code', async () => {
            const wrapper = mountInput();

            await open(wrapper);

            const search = document.body.querySelector<HTMLInputElement>(
                '[data-slot="command-input"]',
            );

            expect(search).not.toBeNull();

            if (search) {
                search.value = 'united';
                search.dispatchEvent(new Event('input', { bubbles: true }));
            }

            await flushPromises();

            expect(items().map((item) => item.textContent)).toEqual(
                expect.arrayContaining([
                    expect.stringContaining('United Kingdom'),
                    expect.stringContaining('United States'),
                ]),
            );
            expect(items().length).toBeLessThan(10);
        });

        it('choosing a country sets it, re-reads the typed number and closes', async () => {
            const wrapper = mountInput();

            await type(wrapper, '4155550100', false);
            await open(wrapper);

            const us = items().find((item) =>
                item.textContent?.includes('United States'),
            );

            us?.click();
            await flushPromises();

            expect(country(wrapper)).toBe('US');
            expect(lastEmitted(wrapper)).toBe('+14155550100');
            expect(
                wrapper
                    .get('[data-slot="phone-country"]')
                    .attributes('aria-expanded'),
            ).toBe('false');
            expect(
                wrapper.get<HTMLInputElement>('input[type="tel"]').element
                    .value,
            ).toBe('(415) 555-0100');
        });

        it('a number that is not valid in the chosen country becomes an error', async () => {
            const wrapper = mountInput();

            await type(wrapper, '98765 43210');
            await open(wrapper);

            items()
                .find((item) => item.textContent?.includes('United States'))
                ?.click();
            await flushPromises();

            expect(lastEmitted(wrapper)).toBeNull();
            expect(wrapper.text()).toContain('Enter a valid phone number.');
        });

        it('choosing a country with nothing typed just switches it', async () => {
            const wrapper = mountInput();

            await open(wrapper);

            items()
                .find((item) => item.textContent?.includes('Singapore'))
                ?.click();
            await flushPromises();

            expect(country(wrapper)).toBe('SG');
            expect(wrapper.text()).not.toContain('Enter a valid phone number.');
            expect(wrapper.get('[data-slot="phone-country"]').text()).toContain(
                '+65',
            );
        });

        it('list items are 44 px tall on small screens', async () => {
            const wrapper = mountInput();

            await open(wrapper);

            expect(items()[0]?.className).toContain('min-h-11');
        });
    });
});
