import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page, resetPage } from '@/test/inertiaPage';

vi.mock('@inertiajs/vue3', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@inertiajs/vue3')>()),
    usePage: () => page,
}));

import PercentInput from '@/components/inputs/PercentInput.vue';
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
    return mount(PercentInput, {
        props: { modelValue: 0, ...props },
        attrs,
    });
}

function lastEmitted(wrapper: ReturnType<typeof mountInput>) {
    const events = wrapper.emitted('update:modelValue') ?? [];

    return events[events.length - 1]?.[0];
}

async function type(wrapper: ReturnType<typeof mountInput>, text: string) {
    const input = wrapper.get('input');

    await input.trigger('focus');
    await input.setValue(text);
    await input.trigger('blur');
}

describe('PercentInput', () => {
    it('modelValue 1250 displays 12.50 with a % suffix', () => {
        const wrapper = mountInput({ modelValue: 1250 });

        expect(wrapper.get('input').element.value).toBe('12.50');
        expect(wrapper.get('[data-testid="percent-suffix"]').text()).toBe('%');
    });

    it('typing 35 emits 3500', async () => {
        const wrapper = mountInput({ modelValue: 1250 });

        await type(wrapper, '35');

        expect(lastEmitted(wrapper)).toBe(3500);
        expect(wrapper.get('input').element.value).toBe('35.00');
    });

    it.each([
        ['12.5', 1250],
        ['12.55', 1255],
        ['.5', 50],
        ['0', 0],
        ['100', 10000],
        ['1,000', 100000],
        ['35%', 3500],
        [' 35 % ', 3500],
        ['+7', 700],
    ])('%j is %i basis points, without float error', async (text, bps) => {
        const wrapper = mountInput();

        await type(wrapper, text);

        expect(lastEmitted(wrapper)).toBe(bps);
    });

    it('is exact where floats are not (0.07 and 4.35)', async () => {
        const wrapper = mountInput();

        await type(wrapper, '0.07');
        expect(lastEmitted(wrapper)).toBe(7);

        await type(wrapper, '4.35');
        expect(lastEmitted(wrapper)).toBe(435);
    });

    it('emits live while typing', async () => {
        const wrapper = mountInput();

        await wrapper.get('input').setValue('7.5');

        expect(lastEmitted(wrapper)).toBe(750);
    });

    describe('decimals', () => {
        it('defaults to 2', () => {
            expect(
                mountInput({ modelValue: 5 }).get('input').element.value,
            ).toBe('0.05');
        });

        it('1 shows one decimal and refuses finer input', async () => {
            const wrapper = mountInput({ modelValue: 1250, decimals: 1 });

            expect(wrapper.get('input').element.value).toBe('12.5');

            await type(wrapper, '12.55');
            expect(lastEmitted(wrapper)).toBeNull();
            expect(wrapper.text()).toContain('Enter a percentage like 12.5.');

            await type(wrapper, '12.6');
            expect(lastEmitted(wrapper)).toBe(1260);
        });

        it('0 is whole percents', async () => {
            const wrapper = mountInput({ modelValue: 1800, decimals: 0 });

            expect(wrapper.get('input').element.value).toBe('18');

            await type(wrapper, '12.5');
            expect(lastEmitted(wrapper)).toBeNull();

            await type(wrapper, '12');
            expect(lastEmitted(wrapper)).toBe(1200);
        });
    });

    describe('errors', () => {
        it('abc shows money.errors.invalid_percent and emits null', async () => {
            const wrapper = mountInput({ modelValue: 1250 });

            await type(wrapper, 'abc');

            expect(lastEmitted(wrapper)).toBeNull();
            expect(wrapper.text()).toContain('Enter a percentage like 12.5.');
            expect(wrapper.get('input').attributes('aria-invalid')).toBe(
                'true',
            );
        });

        it('links the error with aria-describedby', async () => {
            const wrapper = mountInput();

            await type(wrapper, 'abc');

            const id =
                wrapper.get('input').attributes('aria-describedby') ?? '';

            expect(wrapper.get(`[id="${id}"]`).text()).toBe(
                'Enter a percentage like 12.5.',
            );
        });

        it('shows no error while typing, and clears one once valid', async () => {
            const wrapper = mountInput();

            await wrapper.get('input').setValue('1..');
            expect(wrapper.text()).not.toContain('Enter a percentage');

            await type(wrapper, 'x');
            expect(wrapper.text()).toContain('Enter a percentage');

            await wrapper.get('input').setValue('5');
            expect(wrapper.text()).not.toContain('Enter a percentage');
        });

        it('negative needs a negative min', async () => {
            const wrapper = mountInput();

            await type(wrapper, '-5');

            expect(lastEmitted(wrapper)).toBeNull();
            expect(wrapper.text()).toContain('Must be at least 0%.');
        });

        it('a negative min allows negatives', async () => {
            const wrapper = mountInput({ min: -2000 });

            await type(wrapper, '-5');

            expect(lastEmitted(wrapper)).toBe(-500);
            expect(wrapper.get('input').element.value).toBe('-5.00');
            expect(wrapper.get('input').attributes('inputmode')).toBe('text');
        });

        it('min and max in basis points, shown as percentages', async () => {
            const wrapper = mountInput({ min: 100, max: 5000 });

            await type(wrapper, '0.5');
            expect(lastEmitted(wrapper)).toBeNull();
            expect(wrapper.text()).toContain('Must be between 1% and 50%.');

            await type(wrapper, '50.01');
            expect(lastEmitted(wrapper)).toBeNull();

            await type(wrapper, '50');
            expect(lastEmitted(wrapper)).toBe(5000);
            expect(wrapper.text()).not.toContain('Must be');
        });

        it('max alone', async () => {
            const wrapper = mountInput({ max: 10000 });

            await type(wrapper, '100.01');

            expect(wrapper.text()).toContain('Must be between 0% and 100%.');
        });

        it('empty text is null without an error', async () => {
            const wrapper = mountInput({ modelValue: 500 });

            await type(wrapper, '');

            expect(lastEmitted(wrapper)).toBeNull();
            expect(wrapper.text()).not.toContain('Enter a percentage');
        });
    });

    describe('model to text', () => {
        it('null is an empty field', () => {
            expect(
                mountInput({ modelValue: null }).get('input').element.value,
            ).toBe('');
        });

        it('follows an outside change while not focused', async () => {
            const wrapper = mountInput({ modelValue: 100 });

            await wrapper.setProps({ modelValue: 750 });

            expect(wrapper.get('input').element.value).toBe('7.50');
        });

        it('does not rewrite the text under the caret', async () => {
            const wrapper = mountInput();
            const input = wrapper.get('input');

            await input.trigger('focus');
            await input.setValue('7.');
            await wrapper.setProps({ modelValue: 700 });

            expect(input.element.value).toBe('7.');
        });

        it('selects the text on focus', async () => {
            const wrapper = mountInput({ modelValue: 1250 });
            const input = wrapper.get('input');
            const select = vi.spyOn(input.element, 'select');

            await input.trigger('focus');

            expect(select).toHaveBeenCalled();
        });
    });

    describe('attributes', () => {
        it('uses the decimal keypad and 44 px height by default', () => {
            const input = mountInput().get('input');

            expect(input.attributes('inputmode')).toBe('decimal');
            expect(input.attributes('autocomplete')).toBe('off');
            expect(input.classes()).toContain('h-11');
        });

        it('compact density gives h-9', () => {
            const wrapper = mount(PercentInput, {
                props: { modelValue: 0 },
                global: { provide: { [DENSITY_KEY]: 'compact' } },
            });

            expect(wrapper.get('input').classes()).toContain('h-9');
        });

        it('passes id and aria-label to the input and class to the wrapper', () => {
            const wrapper = mountInput(
                {},
                { id: 'tax', 'aria-label': 'Tax', class: 'w-32' },
            );

            expect(wrapper.get('input').attributes('id')).toBe('tax');
            expect(wrapper.get('input').attributes('aria-label')).toBe('Tax');
            expect(wrapper.classes()).toContain('w-32');
        });
    });
});
