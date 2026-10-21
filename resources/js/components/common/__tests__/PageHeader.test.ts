import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import PageHeader from '@/components/common/PageHeader.vue';

describe('PageHeader', () => {
    it('renders exactly one h1, focusable for route changes (15 §14.4)', () => {
        const wrapper = mount(PageHeader, { props: { title: 'Orders' } });
        const headings = wrapper.findAll('h1');

        expect(headings).toHaveLength(1);
        expect(headings[0]?.text()).toBe('Orders');
        expect(headings[0]?.attributes('tabindex')).toBe('-1');
        expect(wrapper.findAll('h1, h2, h3')).toHaveLength(1);
    });

    it('renders the description and the badge with its tone', () => {
        const wrapper = mount(PageHeader, {
            props: {
                title: 'Order',
                description: 'Placed yesterday',
                badge: { label: 'Waiting', tone: 'warning' },
            },
        });

        expect(wrapper.text()).toContain('Placed yesterday');

        const badge = wrapper.get('[data-slot="badge"]');
        expect(badge.text()).toBe('Waiting');
        expect(badge.classes()).toContain('bg-warning-subtle');
    });

    it('shows a labelled back link only when backHref is given', () => {
        const without = mount(PageHeader, { props: { title: 'Orders' } });
        expect(without.find('a').exists()).toBe(false);

        const wrapper = mount(PageHeader, {
            props: { title: 'Order', backHref: '/orders' },
        });
        const back = wrapper.get('a');

        expect(back.attributes('href')).toBe('/orders');
        expect(back.attributes('aria-label')).toBe('Back');
        expect(back.get('svg').attributes('aria-hidden')).toBe('true');
    });

    it('renders the meta and actions slots', () => {
        const wrapper = mount(PageHeader, {
            props: { title: 'Order' },
            slots: {
                meta: '<span data-test="meta">meta</span>',
                actions: '<button data-test="action">Go</button>',
            },
        });

        expect(wrapper.find('[data-test="meta"]').exists()).toBe(true);
        expect(wrapper.find('[data-test="action"]').exists()).toBe(true);
    });

    it('renders neither slot wrapper when the slots are empty', () => {
        const wrapper = mount(PageHeader, { props: { title: 'Order' } });

        expect(wrapper.find('[data-slot="page-header-actions"]').exists()).toBe(
            false,
        );
        expect(wrapper.find('[data-slot="page-header-meta"]').exists()).toBe(
            false,
        );
    });
});
