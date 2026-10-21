import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page, resetPage } from '@/test/inertiaPage';

vi.mock('@inertiajs/vue3', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@inertiajs/vue3')>()),
    usePage: () => page,
}));

import CurrencyInput from '@/components/inputs/CurrencyInput.vue';
import { DENSITY_KEY } from '@/composables/useControlSize';

beforeEach(() =>
    resetPage({
        business: {
            locale: 'en-IN',
            currency: 'INR',
            timezone: 'Asia/Kolkata',
        },
    }),
);

function mountInput(props: Record<string, unknown> = {}, attrs = {}) {
    return mount(CurrencyInput, {
        props: { modelValue: null, ...props },
        attrs,
    });
}

function lastEmitted(wrapper: ReturnType<typeof mountInput>) {
    const events = wrapper.emitted('update:modelValue') ?? [];

    return events[events.length - 1]?.[0];
}

async function type(
    wrapper: ReturnType<typeof mountInput>,
    text: string,
    finish: 'blur' | 'enter' = 'blur',
) {
    const input = wrapper.get('input');

    await input.trigger('focus');
    await input.setValue(text);
    await input.trigger(finish === 'blur' ? 'blur' : 'keydown', {
        key: 'Enter',
    });
}

describe('CurrencyInput (INR, en-IN)', () => {
    it('shows the currency symbol as a prefix', () => {
        const wrapper = mountInput();

        expect(wrapper.get('[data-testid="currency-symbol"]').text()).toBe('₹');
    });

    it('12,345.67 + blur emits 1234567 and shows 12,345.67', async () => {
        const wrapper = mountInput();

        await type(wrapper, '12,345.67');

        expect(lastEmitted(wrapper)).toBe(1234567);
        expect(wrapper.get('input').element.value).toBe('12,345.67');
    });

    it('12345.6 emits 1234560 and pads to 12,345.60', async () => {
        const wrapper = mountInput();

        await type(wrapper, '12345.6');

        expect(lastEmitted(wrapper)).toBe(1234560);
        expect(wrapper.get('input').element.value).toBe('12,345.60');
    });

    it('accepts lakh grouping and groups the lakh way on blur', async () => {
        const wrapper = mountInput();

        await type(wrapper, '1,23,45,678.9');

        expect(lastEmitted(wrapper)).toBe(1234567890);
        expect(wrapper.get('input').element.value).toBe('1,23,45,678.90');
    });

    it('Enter commits but leaves the text alone while focused; blur then groups it', async () => {
        const wrapper = mountInput();
        const input = wrapper.get('input');

        await type(wrapper, '1234.5', 'enter');

        expect(lastEmitted(wrapper)).toBe(123450);
        expect(input.element.value).toBe('1234.5');

        await input.trigger('blur');

        expect(input.element.value).toBe('1,234.50');
    });

    it('Enter shows an error for bad text, without touching it', async () => {
        const wrapper = mountInput();

        await type(wrapper, 'abc', 'enter');

        expect(wrapper.text()).toContain('Enter an amount');
        expect(wrapper.get('input').element.value).toBe('abc');
    });

    it('emits live while typing, before blur', async () => {
        const wrapper = mountInput();

        await wrapper.get('input').setValue('12.5');

        expect(lastEmitted(wrapper)).toBe(1250);
        expect(wrapper.find('[role="alert"], p').exists()).toBe(false);
    });

    it('does not reformat the text under the caret while typing', async () => {
        const wrapper = mountInput({ modelValue: null });
        const input = wrapper.get('input');

        await input.trigger('focus');
        await input.setValue('1234');
        await wrapper.setProps({ modelValue: 123400 });

        expect(input.element.value).toBe('1234');
    });

    it('abc shows money.errors.invalid and emits null', async () => {
        const wrapper = mountInput({ modelValue: 1250 });

        await type(wrapper, 'abc');

        expect(lastEmitted(wrapper)).toBeNull();
        expect(wrapper.text()).toContain('Enter an amount like 12,500.00.');
        expect(wrapper.get('input').attributes('aria-invalid')).toBe('true');
        expect(wrapper.get('input').element.value).toBe('abc');
    });

    it('links the error to the input with aria-describedby', async () => {
        const wrapper = mountInput();

        await type(wrapper, 'abc');

        const input = wrapper.get('input');
        const describedBy = input.attributes('aria-describedby') ?? '';
        const error = wrapper.get(`[id="${describedBy}"]`);

        expect(error.text()).toBe('Enter an amount like 12,500.00.');
    });

    it('keeps a caller aria-describedby next to its own error id', async () => {
        const wrapper = mountInput({}, { 'aria-describedby': 'hint-1' });

        expect(wrapper.get('input').attributes('aria-describedby')).toBe(
            'hint-1',
        );

        await type(wrapper, 'abc');

        const ids = (
            wrapper.get('input').attributes('aria-describedby') ?? ''
        ).split(' ');

        expect(ids).toHaveLength(2);
        expect(ids).toContain('hint-1');
    });

    it('clears the error when the text becomes valid', async () => {
        const wrapper = mountInput();

        await type(wrapper, 'abc');
        await wrapper.get('input').setValue('12');

        expect(wrapper.text()).not.toContain('Enter an amount');
        expect(wrapper.get('input').attributes('aria-invalid')).toBeUndefined();
    });

    it('a field that is not valid text yet is not an error while typing', async () => {
        const wrapper = mountInput();

        await wrapper.get('input').setValue('12,');

        expect(wrapper.text()).not.toContain('Enter an amount');
    });

    it('more fraction digits than the currency has is invalid, never rounded', async () => {
        const wrapper = mountInput();

        await type(wrapper, '1.005');

        expect(lastEmitted(wrapper)).toBeNull();
        expect(wrapper.text()).toContain('Enter an amount');
    });

    it('-5 is invalid unless allowNegative', async () => {
        const wrapper = mountInput();

        await type(wrapper, '-5');

        expect(lastEmitted(wrapper)).toBeNull();
        expect(wrapper.text()).toContain('Enter an amount like 12,500.00.');
    });

    it('-5 with allowNegative emits -500 and shows -5.00', async () => {
        const wrapper = mountInput({ allowNegative: true });

        await type(wrapper, '-5');

        expect(lastEmitted(wrapper)).toBe(-500);
        expect(wrapper.get('input').element.value).toBe('-5.00');
    });

    it('empty text is null without an error', async () => {
        const wrapper = mountInput({ modelValue: 500 });

        await type(wrapper, '');

        expect(lastEmitted(wrapper)).toBeNull();
        expect(wrapper.text()).not.toContain('Enter an amount');
        expect(wrapper.get('input').attributes('aria-invalid')).toBeUndefined();
    });

    it('zero is a real amount', async () => {
        const wrapper = mountInput();

        await type(wrapper, '0');

        expect(lastEmitted(wrapper)).toBe(0);
        expect(wrapper.get('input').element.value).toBe('0.00');
    });

    it('keeps full precision at the largest safe amount', async () => {
        const wrapper = mountInput();

        await type(wrapper, '90071992547409.91');

        expect(lastEmitted(wrapper)).toBe(Number.MAX_SAFE_INTEGER);

        await type(wrapper, '90071992547409.92');

        expect(lastEmitted(wrapper)).toBeNull();
    });

    describe('pasted currency symbols and codes', () => {
        it.each([
            '₹ 12,345.67',
            '₹12,345.67',
            '12,345.67 ₹',
            '12,345.67₹',
            'INR 12,345.67',
            'INR12,345.67',
            '12,345.67 INR',
            'inr 12,345.67',
            '₹\u00a012,345.67',
            '\u00a0₹ 12,345.67\u202f',
            '  ₹   12,345.67  ',
        ])('%j is 1234567', async (text) => {
            const wrapper = mountInput();

            await type(wrapper, text);

            expect(lastEmitted(wrapper)).toBe(1234567);
            expect(wrapper.get('input').element.value).toBe('12,345.67');
            expect(
                wrapper.get('input').attributes('aria-invalid'),
            ).toBeUndefined();
        });

        it('keeps a sign in front of the symbol', async () => {
            const wrapper = mountInput({ allowNegative: true });

            await type(wrapper, '-₹ 5');
            expect(lastEmitted(wrapper)).toBe(-500);

            await type(wrapper, '₹ -5');
            expect(lastEmitted(wrapper)).toBe(-500);
        });

        it('only the configured currency is recognised', async () => {
            const wrapper = mountInput();

            await type(wrapper, 'USD 5');
            expect(lastEmitted(wrapper)).toBeNull();

            await type(wrapper, '€5');
            expect(lastEmitted(wrapper)).toBeNull();

            await type(wrapper, '₹₹5');
            expect(lastEmitted(wrapper)).toBeNull();

            await type(wrapper, '₹ 5 ₹');
            expect(lastEmitted(wrapper)).toBeNull();

            await type(wrapper, '₹');
            expect(lastEmitted(wrapper)).toBeNull();
        });

        it('follows the currency prop', async () => {
            const wrapper = mountInput({ currency: 'USD' });

            await type(wrapper, 'USD 5');
            expect(lastEmitted(wrapper)).toBe(500);

            await type(wrapper, '$5.25');
            expect(lastEmitted(wrapper)).toBe(525);
        });
    });

    describe('business locale separators', () => {
        it('de-DE: . groups and , is the decimal', async () => {
            resetPage({ business: { locale: 'de-DE', currency: 'EUR' } });

            const wrapper = mountInput();
            const input = wrapper.get('input');

            expect(wrapper.get('[data-testid="currency-symbol"]').text()).toBe(
                '€',
            );

            await type(wrapper, '1.234,56');
            expect(lastEmitted(wrapper)).toBe(123456);
            expect(input.element.value).toBe('1.234,56');

            await wrapper.setProps({ modelValue: 123456 });
            await input.trigger('focus');
            expect(input.element.value).toBe('1234,56');
            await input.trigger('blur');

            await type(wrapper, '1,234.56');
            expect(lastEmitted(wrapper)).toBeNull();
            expect(wrapper.text()).toContain('Enter an amount');

            await type(wrapper, '€ 1.234,56');
            expect(lastEmitted(wrapper)).toBe(123456);

            await type(wrapper, '1.234,56\u00a0€');
            expect(lastEmitted(wrapper)).toBe(123456);
        });

        it('fr-FR: a space, NBSP or narrow NBSP groups', async () => {
            resetPage({ business: { locale: 'fr-FR', currency: 'EUR' } });

            const wrapper = mountInput({ modelValue: 123456 });

            expect(wrapper.get('input').element.value).toBe('1\u202f234,56');

            for (const text of [
                '1 234,56',
                '1\u00a0234,56',
                '1\u202f234,56',
                '1 234,56 €',
            ]) {
                await type(wrapper, text);
                expect(lastEmitted(wrapper), text).toBe(123456);
            }
        });

        it('en-IN keeps lakh grouping', async () => {
            const wrapper = mountInput();

            await type(wrapper, '₹ 1,23,456.78');

            expect(lastEmitted(wrapper)).toBe(12345678);
            expect(wrapper.get('input').element.value).toBe('1,23,456.78');
        });

        it('a locale change re-draws the field', async () => {
            const wrapper = mountInput({ modelValue: 123456 });

            expect(wrapper.get('input').element.value).toBe('1,234.56');

            resetPage({ business: { locale: 'de-DE', currency: 'INR' } });
            await wrapper.vm.$nextTick();

            expect(wrapper.get('input').element.value).toBe('1.234,56');
        });
    });

    describe('min and max (minor units)', () => {
        it('rejects below min with the range message in formatted money', async () => {
            const wrapper = mountInput({ min: 100, max: 1000000 });

            await type(wrapper, '0.5');

            expect(lastEmitted(wrapper)).toBeNull();
            expect(wrapper.text()).toContain(
                'Must be between ₹1.00 and ₹10,000.00.',
            );
            expect(wrapper.get('input').attributes('aria-invalid')).toBe(
                'true',
            );
        });

        it('rejects above max', async () => {
            const wrapper = mountInput({ min: 100, max: 1000000 });

            await type(wrapper, '10000.01');

            expect(lastEmitted(wrapper)).toBeNull();
            expect(wrapper.text()).toContain('Must be between');
        });

        it('accepts the bounds themselves', async () => {
            const wrapper = mountInput({ min: 100, max: 1000000 });

            await type(wrapper, '1');
            expect(lastEmitted(wrapper)).toBe(100);

            await type(wrapper, '10,000');
            expect(lastEmitted(wrapper)).toBe(1000000);
        });

        it('one-sided bounds get their own message', async () => {
            const lower = mountInput({ min: 100 });
            await type(lower, '0.5');
            expect(lower.text()).toContain('Must be at least ₹1.00.');

            const upper = mountInput({ max: 100 });
            await type(upper, '2');
            expect(upper.text()).toContain('Must be at most ₹1.00.');
        });
    });

    describe('model to text', () => {
        it('shows the grouped amount for an incoming value', () => {
            expect(
                mountInput({ modelValue: 1234567 }).get('input').element.value,
            ).toBe('12,345.67');
        });

        it('null is an empty field', () => {
            expect(mountInput().get('input').element.value).toBe('');
        });

        it('follows an outside change while not editing', async () => {
            const wrapper = mountInput({ modelValue: 100 });

            await wrapper.setProps({ modelValue: 250000 });

            expect(wrapper.get('input').element.value).toBe('2,500.00');
        });

        it('focus drops the grouping for editing and selects the text', async () => {
            const wrapper = mountInput({ modelValue: 1234567 }, {});
            const input = wrapper.get('input');
            const select = vi.spyOn(input.element, 'select');

            await input.trigger('focus');

            expect(input.element.value).toBe('12345.67');
            expect(select).toHaveBeenCalled();

            await input.trigger('blur');

            expect(input.element.value).toBe('12,345.67');
        });
    });

    describe('currencies with 0 and 3 decimals', () => {
        it('JPY: whole yen only', async () => {
            const wrapper = mountInput({ currency: 'JPY' });

            expect(wrapper.get('[data-testid="currency-symbol"]').text()).toBe(
                'JP¥',
            );

            await type(wrapper, '1500');
            expect(lastEmitted(wrapper)).toBe(1500);
            expect(wrapper.get('input').element.value).toBe('1,500');

            await type(wrapper, '12.5');
            expect(lastEmitted(wrapper)).toBeNull();
            expect(wrapper.text()).toContain('Enter an amount');
        });

        it('BHD: three decimals', async () => {
            const wrapper = mountInput({ currency: 'BHD' });

            await type(wrapper, '1234.5');
            expect(lastEmitted(wrapper)).toBe(1234500);
            expect(wrapper.get('input').element.value).toBe('1,234.500');

            await type(wrapper, '0.005');
            expect(lastEmitted(wrapper)).toBe(5);

            await type(wrapper, '0.0005');
            expect(lastEmitted(wrapper)).toBeNull();
        });

        it('defaults to the business currency', () => {
            resetPage({
                business: { locale: 'en-IN', currency: 'USD' },
            });

            expect(
                mountInput().get('[data-testid="currency-symbol"]').text(),
            ).toBe('$');
        });
    });

    describe('input attributes', () => {
        it('uses the decimal keypad, or text when a minus sign is needed', () => {
            expect(mountInput().get('input').attributes('inputmode')).toBe(
                'decimal',
            );
            expect(
                mountInput({ allowNegative: true })
                    .get('input')
                    .attributes('inputmode'),
            ).toBe('text');
        });

        it('passes id, disabled and placeholder to the input', () => {
            const wrapper = mountInput(
                { placeholder: '0.00' },
                { id: 'price', disabled: true, 'aria-label': 'Price' },
            );
            const input = wrapper.get('input');

            expect(input.attributes('id')).toBe('price');
            expect(input.attributes('placeholder')).toBe('0.00');
            expect(input.attributes('aria-label')).toBe('Price');
            expect(input.attributes('disabled')).toBeDefined();
            expect(input.attributes('autocomplete')).toBe('off');
        });

        it('class lands on the wrapper, not the input', () => {
            const wrapper = mountInput({}, { class: 'w-40' });

            expect(wrapper.classes()).toContain('w-40');
            expect(wrapper.get('input').classes()).not.toContain('w-40');
        });

        it('invalid prop marks the field invalid', () => {
            expect(
                mountInput({ invalid: true })
                    .get('input')
                    .attributes('aria-invalid'),
            ).toBe('true');
        });
    });

    describe('touch targets (15 §14.6)', () => {
        it('is 44 px (h-11) in comfortable density, the default', () => {
            expect(mountInput().get('input').classes()).toContain('h-11');
        });

        it('is h-9 only when the shell says the density is compact', () => {
            const wrapper = mount(CurrencyInput, {
                props: { modelValue: null },
                global: { provide: { [DENSITY_KEY]: 'compact' } },
            });

            expect(wrapper.get('input').classes()).toContain('h-9');
        });
    });
});
