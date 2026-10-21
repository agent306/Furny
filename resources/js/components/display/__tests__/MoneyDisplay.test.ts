import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page, resetPage } from '@/test/inertiaPage';

vi.mock('@inertiajs/vue3', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@inertiajs/vue3')>()),
    usePage: () => page,
}));

import MoneyDisplay from '@/components/display/MoneyDisplay.vue';

beforeEach(() =>
    resetPage({
        business: {
            locale: 'en-IN',
            currency: 'INR',
            timezone: 'Asia/Kolkata',
        },
    }),
);

describe('MoneyDisplay', () => {
    it('formats minor units with the business locale, tabular figures', () => {
        const wrapper = mount(MoneyDisplay, { props: { minor: 1234567890 } });

        expect(wrapper.text()).toBe('₹1,23,45,678.90');
        expect(wrapper.classes()).toContain('tabular-nums');
    });

    it('null renders an em dash', () => {
        const wrapper = mount(MoneyDisplay, { props: { minor: null } });

        expect(wrapper.text()).toBe('—');
        expect(wrapper.text()).not.toContain('₹');
    });

    it('zero is a real amount, not a dash', () => {
        expect(mount(MoneyDisplay, { props: { minor: 0 } }).text()).toBe(
            '₹0.00',
        );
    });

    it('approx prefixes ≈ and names it for screen readers', () => {
        const wrapper = mount(MoneyDisplay, {
            props: { minor: 1234567, approx: true },
        });

        expect(wrapper.text()).toBe('≈₹12,345.67');

        const marker = wrapper.get('[aria-label]');
        expect(marker.text()).toBe('≈');
        expect(marker.attributes('aria-label')).toBe('approximately');
        expect(marker.attributes('role')).toBe('img');
    });

    it('does not label the amount itself, so screen readers still read the number', () => {
        const wrapper = mount(MoneyDisplay, {
            props: { minor: 1234567, approx: true },
        });

        expect(wrapper.attributes('aria-label')).toBeUndefined();
    });

    it('approx on null still shows only a dash', () => {
        expect(
            mount(MoneyDisplay, {
                props: { minor: null, approx: true },
            }).text(),
        ).toBe('—');
    });

    it('takes another currency', () => {
        expect(
            mount(MoneyDisplay, {
                props: { minor: 1234567, currency: 'USD' },
            }).text(),
        ).toBe('$12,345.67');
    });

    it('signDisplay', () => {
        expect(
            mount(MoneyDisplay, {
                props: { minor: 500, signDisplay: 'always' },
            }).text(),
        ).toBe('+₹5.00');
        expect(
            mount(MoneyDisplay, {
                props: { minor: -500, signDisplay: 'auto' },
            }).text(),
        ).toBe('-₹5.00');
    });

    it('muted and strike change the styling', () => {
        const wrapper = mount(MoneyDisplay, {
            props: { minor: 500, muted: true, strike: true },
        });

        expect(wrapper.classes()).toContain('text-muted-foreground');
        expect(wrapper.classes()).toContain('line-through');
    });

    it('sizes map to type scale classes', () => {
        const sizes = (['sm', 'md', 'lg', 'xl'] as const).map((size) =>
            mount(MoneyDisplay, { props: { minor: 1, size } })
                .classes()
                .join(' '),
        );

        expect(new Set(sizes).size).toBe(4);
    });
});
