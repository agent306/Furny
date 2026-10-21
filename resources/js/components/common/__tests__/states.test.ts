import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import ErrorState from '@/components/common/ErrorState.vue';
import FormSection from '@/components/common/FormSection.vue';
import InputError from '@/components/common/InputError.vue';
import LoadingState from '@/components/common/LoadingState.vue';
import ScreenTooSmall from '@/components/common/ScreenTooSmall.vue';

describe('ErrorState', () => {
    it('defaults the title to errors.load_failed and announces itself', () => {
        const wrapper = mount(ErrorState);

        expect(wrapper.get('h2').text()).toBe("We couldn't load this.");
        expect(wrapper.attributes('role')).toBe('alert');
        expect(wrapper.find('button').exists()).toBe(false);
    });

    it('shows a custom title, description and status code', () => {
        const wrapper = mount(ErrorState, {
            props: {
                title: 'No access',
                description: 'Ask the owner.',
                status: 403,
            },
        });

        expect(wrapper.get('h2').text()).toBe('No access');
        expect(wrapper.text()).toContain('Ask the owner.');
        expect(wrapper.text()).toContain('Error 403');
    });

    it('retry button calls retry once per click', async () => {
        const retry = vi.fn();
        const wrapper = mount(ErrorState, { props: { retry } });
        const button = wrapper.get('button');

        expect(button.text()).toBe('Retry');

        await button.trigger('click');

        expect(retry).toHaveBeenCalledOnce();
    });
});

describe('LoadingState', () => {
    it.each(['list', 'cards', 'detail', 'table'] as const)(
        '%s is a busy status region with skeletons and a screen-reader label',
        (variant) => {
            const wrapper = mount(LoadingState, { props: { variant } });

            expect(wrapper.attributes('role')).toBe('status');
            expect(wrapper.attributes('aria-busy')).toBe('true');
            expect(wrapper.attributes('data-variant')).toBe(variant);
            expect(
                wrapper.findAll('[data-slot="skeleton"]').length,
            ).toBeGreaterThan(1);
            expect(wrapper.get('.sr-only').text()).toBe('Loading');
        },
    );

    it('rows controls how many placeholders are drawn', () => {
        const count = (rows?: number): number =>
            mount(LoadingState, { props: { variant: 'list', rows } }).findAll(
                '[data-row]',
            ).length;

        expect(count()).toBe(3);
        expect(count(5)).toBe(5);
        expect(count(1)).toBe(1);
        expect(count(0)).toBe(1);
    });
});

describe('ScreenTooSmall', () => {
    it('explains itself and offers a way back', () => {
        const wrapper = mount(ScreenTooSmall, {
            props: { backHref: '/orders' },
        });

        expect(wrapper.text()).toContain('This screen needs a larger display');
        expect(wrapper.text()).toContain(
            'Open it on a tablet or computer to continue.',
        );
        expect(wrapper.get('a').attributes('href')).toBe('/orders');
        expect(wrapper.get('a').text()).toBe('Back');
    });

    it('has no link without backHref', () => {
        expect(mount(ScreenTooSmall).find('a').exists()).toBe(false);
    });
});

describe('InputError', () => {
    it('renders the message with the given id, for aria-describedby', () => {
        const wrapper = mount(InputError, {
            props: { id: 'email-error', message: 'Required.' },
        });
        const text = wrapper.get('#email-error');

        expect(text.text()).toBe('Required.');
        expect(text.classes()).toContain('text-danger');
        expect(text.attributes('role')).toBeUndefined();
    });

    it('renders nothing without a message', () => {
        expect(mount(InputError, { props: { id: 'x' } }).html()).toBe(
            '<!--v-if-->',
        );
    });
});

describe('FormSection', () => {
    it('labels its region with the title and shows description and fields', () => {
        const wrapper = mount(FormSection, {
            props: { title: 'Profile', description: 'Your public details.' },
            slots: { default: '<input id="name">' },
        });
        const section = wrapper.get('section');
        const heading = wrapper.get('h2');

        expect(heading.text()).toBe('Profile');
        expect(section.attributes('aria-labelledby')).toBe(
            heading.attributes('id'),
        );
        expect(wrapper.text()).toContain('Your public details.');
        expect(wrapper.find('#name').exists()).toBe(true);
        expect(section.classes().join(' ')).toContain('lg:grid-cols-3');
    });
});
