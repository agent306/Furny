import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { h } from 'vue';
import { page, resetPage } from '@/test/inertiaPage';

vi.mock('@inertiajs/vue3', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@inertiajs/vue3')>()),
    usePage: () => page,
}));

import AddressFields from '@/components/inputs/AddressFields.vue';
import { DENSITY_KEY } from '@/composables/useControlSize';
import type { AddressFormData } from '@/types/forms';

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

const empty: AddressFormData = {
    label: '',
    line1: '',
    line2: '',
    city: '',
    region: '',
    postalCode: '',
    countryCode: 'IN',
};

type Wrapper = ReturnType<typeof mountFields>;

function mountFields(props: Record<string, unknown> = {}) {
    return mount(AddressFields, {
        props: { modelValue: empty, ...props },
        attachTo: document.body,
    });
}

function field(wrapper: Wrapper, key: string) {
    return wrapper.get(`[data-field="${key}"]`);
}

async function openCountries(wrapper: Wrapper) {
    await field(wrapper, 'countryCode')
        .get('[role="combobox"]')
        .trigger('keydown', { key: 'ArrowDown' });
    await flushPromises();
}

function lastEmitted(wrapper: Wrapper): AddressFormData | undefined {
    return (wrapper.emitted('update:modelValue') ?? []).at(-1)?.[0] as
        AddressFormData | undefined;
}

describe('AddressFields', () => {
    it('renders the seven fields with their labels', () => {
        const wrapper = mountFields();

        expect(
            [
                'label',
                'line1',
                'line2',
                'city',
                'region',
                'postalCode',
                'countryCode',
            ].map((key) => field(wrapper, key).get('label').text()),
        ).toEqual([
            'Label',
            'Address line 1 *',
            'Address line 2',
            'City *',
            'State / region',
            'Postal code',
            'Country *',
        ]);
    });

    it('labels every control for its input (for / id)', () => {
        const wrapper = mountFields();

        for (const key of [
            'label',
            'line1',
            'line2',
            'city',
            'region',
            'postalCode',
        ]) {
            const label = field(wrapper, key).get('label');
            const input = field(wrapper, key).get('input');

            expect(label.attributes('for')).toBe(input.attributes('id'));
            expect(input.attributes('id')).toBeTruthy();
        }

        const country = field(wrapper, 'countryCode');

        expect(country.get('label').attributes('for')).toBe(
            country.get('[role="combobox"]').attributes('id'),
        );
    });

    it('max lengths follow 02 §1.2', () => {
        const wrapper = mountFields();
        const max = (key: string) =>
            field(wrapper, key).get('input').attributes('maxlength');

        expect(max('label')).toBe('60');
        expect(max('line1')).toBe('200');
        expect(max('line2')).toBe('200');
        expect(max('city')).toBe('100');
        expect(max('region')).toBe('100');
        expect(max('postalCode')).toBe('20');
    });

    it('label has the placeholder "Home"', () => {
        expect(
            field(mountFields(), 'label')
                .get('input')
                .attributes('placeholder'),
        ).toBe('Home');
    });

    it('marks line1, city and country as required', () => {
        const wrapper = mountFields();
        const required = (key: string) =>
            field(wrapper, key).get('input').attributes('aria-required');

        expect(required('line1')).toBe('true');
        expect(required('city')).toBe('true');
        expect(required('label')).toBeUndefined();
        expect(required('region')).toBeUndefined();
        expect(
            field(wrapper, 'countryCode')
                .get('[role="combobox"]')
                .attributes('aria-required'),
        ).toBe('true');
    });

    it('hints the browser with autocomplete tokens', () => {
        const wrapper = mountFields();
        const token = (key: string) =>
            field(wrapper, key).get('input').attributes('autocomplete');

        expect(token('line1')).toBe('address-line1');
        expect(token('line2')).toBe('address-line2');
        expect(token('city')).toBe('address-level2');
        expect(token('region')).toBe('address-level1');
        expect(token('postalCode')).toBe('postal-code');
    });

    describe('editing', () => {
        it('typing emits a new object with that field changed', async () => {
            const wrapper = mountFields();

            await field(wrapper, 'line1')
                .get('input')
                .setValue('12 Park Street');

            expect(lastEmitted(wrapper)).toEqual({
                ...empty,
                line1: '12 Park Street',
            });
            expect(wrapper.props('modelValue')).toEqual(empty);
        });

        it('shows the incoming values, null as empty', () => {
            const wrapper = mountFields({
                modelValue: {
                    ...empty,
                    label: 'Home',
                    line1: '12 Park Street',
                    line2: null,
                    city: 'Kolkata',
                    region: null,
                    postalCode: '700016',
                },
            });
            const value = (key: string) =>
                field(wrapper, key).get('input').element.value;

            expect(value('label')).toBe('Home');
            expect(value('line1')).toBe('12 Park Street');
            expect(value('line2')).toBe('');
            expect(value('city')).toBe('Kolkata');
            expect(value('region')).toBe('');
            expect(value('postalCode')).toBe('700016');
        });
    });

    describe('country', () => {
        it('an empty country shows business.defaultCountryCode without writing it into the model', async () => {
            resetPage({ business: { defaultCountryCode: 'AE' } });

            const wrapper = mountFields({
                modelValue: { ...empty, countryCode: '' },
            });

            await flushPromises();

            expect(
                field(wrapper, 'countryCode').get('[role="combobox"]').text(),
            ).toContain('United Arab Emirates');
            // The form must not go dirty on mount.
            expect(wrapper.emitted('update:modelValue')).toBeUndefined();
        });

        it('shows IN when the business shares no country', async () => {
            resetPage({});

            const wrapper = mountFields({
                modelValue: { ...empty, countryCode: '' },
            });

            await flushPromises();

            expect(
                field(wrapper, 'countryCode').get('[role="combobox"]').text(),
            ).toContain('India');
            expect(wrapper.emitted('update:modelValue')).toBeUndefined();
        });

        it('typing in another field while the country is empty still leaves it to the parent', async () => {
            const wrapper = mountFields({
                modelValue: { ...empty, countryCode: '' },
            });

            await field(wrapper, 'city').get('input').setValue('Pune');

            expect(lastEmitted(wrapper)).toEqual({
                ...empty,
                countryCode: '',
                city: 'Pune',
            });
        });

        it('tells the browser it is a country (autocomplete="country" on the form control)', () => {
            // Reka renders its native <select> only inside a <form>.
            const InForm = () =>
                h('form', null, [h(AddressFields, { modelValue: empty })]);

            mount(InForm, { attachTo: document.body });

            expect(
                document.body
                    .querySelector('select[autocomplete="country"]')
                    ?.getAttribute('autocomplete'),
            ).toBe('country');
        });

        it('keeps a country that is already set', async () => {
            const wrapper = mountFields({
                modelValue: { ...empty, countryCode: 'SG' },
            });

            await flushPromises();

            expect(wrapper.emitted('update:modelValue')).toBeUndefined();
            expect(
                field(wrapper, 'countryCode').get('[role="combobox"]').text(),
            ).toContain('Singapore');
        });

        it('choosing a country emits it', async () => {
            const wrapper = mountFields();

            await openCountries(wrapper);

            const option = [
                ...document.body.querySelectorAll<HTMLElement>(
                    '[role="option"]',
                ),
            ].find((item) => item.textContent?.includes('Germany'));

            expect(option).toBeDefined();

            // Reka selects on pointerup for a mouse.
            option?.dispatchEvent(
                new PointerEvent('pointerup', {
                    pointerType: 'mouse',
                    bubbles: true,
                }),
            );
            await flushPromises();

            expect(lastEmitted(wrapper)?.countryCode).toBe('DE');
        });

        it('lists the business country first, then IN AE SG GB US', async () => {
            resetPage({ business: { defaultCountryCode: 'DE' } });

            const wrapper = mountFields({
                modelValue: { ...empty, countryCode: 'DE' },
            });

            await openCountries(wrapper);

            const names = [
                ...document.body.querySelectorAll<HTMLElement>(
                    '[role="option"]',
                ),
            ]
                .slice(0, 6)
                .map((item) => item.textContent?.trim());

            expect(names).toEqual([
                'Germany',
                'India',
                'United Arab Emirates',
                'Singapore',
                'United Kingdom',
                'United States',
            ]);
        });
    });

    describe('errors (errorPrefix)', () => {
        const errors = {
            'siteAddress.line1': 'The address line 1 field is required.',
            'siteAddress.city': 'The city field is required.',
            'siteAddress.postalCode': 'The postal code is too long.',
            'siteAddress.countryCode': 'Choose a country.',
            'siteAddress.label': 'The label is too long.',
            'siteAddress.line2': 'Line 2 is too long.',
            'siteAddress.region': 'Region is too long.',
            'other.line1': 'Not mine.',
            line1: 'No prefix.',
        };

        it('renders each message under its own field and no other', () => {
            const wrapper = mountFields({
                errors,
                errorPrefix: 'siteAddress.',
            });

            expect(field(wrapper, 'line1').text()).toContain(
                'The address line 1 field is required.',
            );
            expect(field(wrapper, 'city').text()).toContain(
                'The city field is required.',
            );
            expect(field(wrapper, 'postalCode').text()).toContain(
                'The postal code is too long.',
            );
            expect(field(wrapper, 'countryCode').text()).toContain(
                'Choose a country.',
            );
            expect(field(wrapper, 'label').text()).toContain(
                'The label is too long.',
            );
            expect(field(wrapper, 'line2').text()).toContain(
                'Line 2 is too long.',
            );
            expect(field(wrapper, 'region').text()).toContain(
                'Region is too long.',
            );
            expect(field(wrapper, 'city').text()).not.toContain(
                'required.line1',
            );
            expect(wrapper.text()).not.toContain('Not mine.');
            expect(wrapper.text()).not.toContain('No prefix.');
        });

        it('without a prefix the keys are the bare field names', () => {
            const wrapper = mountFields({ errors });

            expect(field(wrapper, 'line1').text()).toContain('No prefix.');
            expect(field(wrapper, 'city').text()).not.toContain('The city');
        });

        it('links each message to its control and marks it invalid', () => {
            const wrapper = mountFields({
                errors,
                errorPrefix: 'siteAddress.',
            });

            for (const key of ['line1', 'city', 'postalCode', 'label']) {
                const input = field(wrapper, key).get('input');
                const id = input.attributes('aria-describedby') ?? '';

                expect(input.attributes('aria-invalid')).toBe('true');
                expect(field(wrapper, key).get(`[id="${id}"]`).text()).toBe(
                    errors[`siteAddress.${key}` as keyof typeof errors],
                );
            }

            const country = field(wrapper, 'countryCode').get(
                '[role="combobox"]',
            );

            expect(country.attributes('aria-invalid')).toBe('true');
            expect(
                field(wrapper, 'countryCode')
                    .get(`[id="${country.attributes('aria-describedby')}"]`)
                    .text(),
            ).toBe('Choose a country.');
        });

        it('fields without an error are not marked invalid', () => {
            const clean = mountFields({
                errors: { 'siteAddress.line1': 'x' },
                errorPrefix: 'siteAddress.',
            });

            expect(
                field(clean, 'city').get('input').attributes('aria-invalid'),
            ).toBeUndefined();
            expect(
                field(clean, 'city')
                    .get('input')
                    .attributes('aria-describedby'),
            ).toBeUndefined();
        });

        it('two instances in one page never share an id', () => {
            const Both = () => [
                h(AddressFields, { modelValue: empty }),
                h(AddressFields, { modelValue: empty }),
            ];

            mount(Both, { attachTo: document.body });

            const ids = [
                ...document.body.querySelectorAll(
                    'input[id], [role="combobox"][id]',
                ),
            ].map((element) => element.id);

            expect(ids).toHaveLength(14);
            expect(new Set(ids).size).toBe(14);
        });
    });

    describe('disabled and sizes', () => {
        it('disabled disables every control', () => {
            const wrapper = mountFields({ disabled: true });

            for (const input of wrapper.findAll('input')) {
                expect(input.attributes('disabled')).toBeDefined();
            }

            expect(
                field(wrapper, 'countryCode')
                    .get('[role="combobox"]')
                    .attributes('disabled'),
            ).toBeDefined();
        });

        it('controls are 44 px (h-11) in comfortable density, h-9 in compact', () => {
            const comfortable = mountFields();

            for (const input of comfortable.findAll('input')) {
                expect(input.classes()).toContain('h-11');
            }

            expect(
                field(comfortable, 'countryCode')
                    .get('[role="combobox"]')
                    .attributes('data-size'),
            ).toBe('lg');

            const compact = mount(AddressFields, {
                props: { modelValue: empty },
                global: { provide: { [DENSITY_KEY]: 'compact' } },
            });

            for (const input of compact.findAll('input')) {
                expect(input.classes()).toContain('h-9');
            }
        });
    });
});
