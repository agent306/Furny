import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import EmptyState from '@/components/common/EmptyState.vue';
import GrainMotif from '@/components/common/GrainMotif.vue';

describe('EmptyState', () => {
    it('renders icon, title and description', () => {
        const wrapper = mount(EmptyState, {
            props: {
                icon: 'package',
                title: 'No orders yet',
                description: 'Orders appear here.',
            },
        });

        expect(wrapper.get('h2').text()).toBe('No orders yet');
        expect(wrapper.text()).toContain('Orders appear here.');
        expect(wrapper.get('svg').attributes('aria-hidden')).toBe('true');
    });

    it('size="lg" renders the grain motif by default', () => {
        const wrapper = mount(EmptyState, {
            props: { icon: 'package', title: 'Nothing', size: 'lg' },
        });

        expect(wrapper.findComponent(GrainMotif).exists()).toBe(true);
    });

    it('sm and md have no motif by default; illustration can force either way', () => {
        const props = { icon: 'package', title: 'Nothing' } as const;

        expect(
            mount(EmptyState, { props }).findComponent(GrainMotif).exists(),
        ).toBe(false);
        expect(
            mount(EmptyState, { props: { ...props, size: 'sm' } })
                .findComponent(GrainMotif)
                .exists(),
        ).toBe(false);
        expect(
            mount(EmptyState, {
                props: { ...props, size: 'md', illustration: 'grain' },
            })
                .findComponent(GrainMotif)
                .exists(),
        ).toBe(true);
        expect(
            mount(EmptyState, {
                props: { ...props, size: 'lg', illustration: 'none' },
            })
                .findComponent(GrainMotif)
                .exists(),
        ).toBe(false);
    });

    it('renders the actions slot only when given', () => {
        const none = mount(EmptyState, {
            props: { icon: 'package', title: 'x' },
        });
        expect(none.find('[data-slot="empty-state-actions"]').exists()).toBe(
            false,
        );

        const wrapper = mount(EmptyState, {
            props: { icon: 'package', title: 'x' },
            slots: { actions: '<button data-test="new">New</button>' },
        });
        expect(
            wrapper
                .get('[data-slot="empty-state-actions"]')
                .find('[data-test="new"]')
                .exists(),
        ).toBe(true);
    });
});

describe('GrainMotif', () => {
    it('is a decorative 240 x 120 svg of 5 to 7 strokes in the wood token', () => {
        const svg = mount(GrainMotif).get('svg');
        const strokes = svg.findAll('[data-stroke]');

        expect(svg.attributes('aria-hidden')).toBe('true');
        expect(svg.attributes('viewBox')).toBe('0 0 240 120');
        expect(strokes.length).toBeGreaterThanOrEqual(5);
        expect(strokes.length).toBeLessThanOrEqual(7);
        expect(svg.html()).toContain('var(--brand-wood)');
    });
});
