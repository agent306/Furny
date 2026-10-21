import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page, resetPage } from '@/test/inertiaPage';

vi.mock('@inertiajs/vue3', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@inertiajs/vue3')>()),
    usePage: () => page,
}));

import StatusBadge from '@/components/orders/StatusBadge.vue';
import StatusPill from '@/components/orders/StatusPill.vue';
import en from '@/lang/generated/en.json';
import { ORDER_STATE_ICON } from '@/lib/statusTones';
import type { OrderStateKey } from '@/types/domain';

const messages = en as Record<string, string>;

// 15 §9.3: state → Badge variant → distinguishing class of that variant.
const VARIANT_CLASS = {
    neutral: 'bg-muted',
    info: 'bg-info-subtle',
    success: 'bg-success-subtle',
    warning: 'bg-warning-subtle',
    danger: 'bg-danger-subtle',
    primary: 'bg-primary/10',
} as const;

const STATES: [OrderStateKey, keyof typeof VARIANT_CLASS][] = [
    ['draft', 'neutral'],
    ['submitted', 'info'],
    ['in_review', 'info'],
    ['changes_proposed', 'warning'],
    ['quoted', 'warning'],
    ['negotiating', 'info'],
    ['accepted', 'primary'],
    ['confirmed', 'success'],
    ['in_production', 'primary'],
    ['completed', 'warning'],
    ['rework', 'warning'],
    ['ready_for_delivery', 'success'],
    ['delivered', 'success'],
    ['closed', 'neutral'],
    ['cancelled', 'danger'],
    ['on_hold', 'warning'],
];

beforeEach(() => resetPage());

describe('StatusBadge', () => {
    it.each(STATES)('%s renders the %s variant', (state, tone) => {
        const badge = mount(StatusBadge, {
            props: { state, audience: 'staff' },
        }).get('[data-slot="badge"]');

        expect(badge.classes()).toContain(VARIANT_CLASS[tone]);
        expect(badge.attributes('data-tone')).toBe(tone);
    });

    it('covers all 16 states', () => {
        expect(STATES).toHaveLength(16);
        expect(new Set(STATES.map(([state]) => state)).size).toBe(16);
    });

    it('staff see the staff label (09 §1), with no aria-label override', () => {
        const wrapper = mount(StatusBadge, {
            props: { state: 'quoted', audience: 'staff' },
        });

        expect(wrapper.text()).toBe('Quote sent');
        expect(wrapper.text()).toBe(messages['orders.states.quoted']);
        expect(
            wrapper.get('[data-slot="badge"]').attributes('aria-label'),
        ).toBeUndefined();
    });

    it('customers see the short label and hear the full sentence', () => {
        const badge = mount(StatusBadge, {
            props: { state: 'quoted', audience: 'customer' },
        }).get('[data-slot="badge"]');

        expect(badge.text()).toBe('Quote ready');
        expect(badge.text()).toBe(
            messages['orders.states_customer_short.quoted'],
        );
        expect(badge.attributes('aria-label')).toBe(
            messages['orders.states_customer.quoted'],
        );
        expect(badge.attributes('aria-label')).toBe(
            'Action needed: review your quote',
        );
        expect(badge.attributes('role')).toBe('img');
    });

    it.each(STATES)(
        '%s shows its icon next to the text, never colour alone',
        (state) => {
            const wrapper = mount(StatusBadge, {
                props: { state, audience: 'staff' },
            });
            const icon = wrapper.get('svg');

            expect(icon.attributes('aria-hidden')).toBe('true');
            expect(icon.attributes('data-icon')).toBe(ORDER_STATE_ICON[state]);
            expect(wrapper.text().length).toBeGreaterThan(0);
        },
    );

    it('showDot=false drops the marker but keeps the text', () => {
        const wrapper = mount(StatusBadge, {
            props: { state: 'delivered', audience: 'staff', showDot: false },
        });

        expect(wrapper.find('svg').exists()).toBe(false);
        expect(wrapper.text()).toBe('Delivered');
    });

    it('sm and md sizes differ', () => {
        const small = mount(StatusBadge, {
            props: { state: 'draft', audience: 'staff', size: 'sm' },
        }).get('[data-slot="badge"]');
        const medium = mount(StatusBadge, {
            props: { state: 'draft', audience: 'staff', size: 'md' },
        }).get('[data-slot="badge"]');

        expect(small.classes()).not.toEqual(medium.classes());
    });

    it('defaults the audience from auth.user.type', () => {
        resetPage({ auth: { user: { type: 'staff' } } });
        expect(mount(StatusBadge, { props: { state: 'quoted' } }).text()).toBe(
            'Quote sent',
        );

        resetPage({ auth: { user: { type: 'customer' } } });
        const customer = mount(StatusBadge, { props: { state: 'quoted' } });
        expect(customer.text()).toBe('Quote ready');
        expect(
            customer.get('[data-slot="badge"]').attributes('aria-label'),
        ).toBe('Action needed: review your quote');
    });

    it('treats a guest as a customer (the safer, plainer wording)', () => {
        resetPage({ auth: { user: null } });

        expect(mount(StatusBadge, { props: { state: 'quoted' } }).text()).toBe(
            'Quote ready',
        );
    });
});

describe('StatusPill', () => {
    it('renders the label with the tone variant', () => {
        const badge = mount(StatusPill, {
            props: { tone: 'danger', label: 'Failed' },
        }).get('[data-slot="badge"]');

        expect(badge.text()).toBe('Failed');
        expect(badge.classes()).toContain('bg-danger-subtle');
        expect(badge.find('svg').exists()).toBe(false);
    });

    it('adds a registry icon when asked', () => {
        const badge = mount(StatusPill, {
            props: { tone: 'warning', label: 'Open', icon: 'alert-triangle' },
        }).get('[data-slot="badge"]');

        expect(badge.get('svg').attributes('aria-hidden')).toBe('true');
        expect(badge.text()).toBe('Open');
    });
});
