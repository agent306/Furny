import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@inertiajs/vue3', async (importOriginal) => {
    const { page: testPage } = await import('@/test/inertiaPage');

    return {
        ...(await importOriginal<typeof import('@inertiajs/vue3')>()),
        usePage: () => testPage,
        router: { on: () => () => undefined, flushAll: vi.fn() },
    };
});

import AuthLayout from '@/layouts/AuthLayout.vue';
import { page, resetPage } from '@/test/inertiaPage';

enableAutoUnmount(afterEach);

beforeEach(() => {
    resetPage({
        app: { name: 'Furny', logoUrl: null },
        business: {
            name: 'Acme Woodworks',
            phoneE164: '+919800011122',
            email: 'hello@acme.test',
            workingHours: 'Mon-Sat 9-6',
        },
    });
});

function layout(
    props: Record<string, unknown> = {},
    slots: Record<string, string> = {},
) {
    return mount(AuthLayout, {
        props,
        slots: { default: '<form data-test="form">fields</form>', ...slots },
        attachTo: document.body,
    });
}

describe('AuthLayout (15 §7.4)', () => {
    it('is a max-w-md card by default and max-w-2xl for the wide variant', () => {
        const card = layout().get('[data-slot="card"]');

        expect(card.classes()).toContain('max-w-md');
        expect(card.classes()).not.toContain('max-w-2xl');

        const wide = layout({ variant: 'wide' }).get('[data-slot="card"]');

        expect(wide.classes()).toContain('max-w-2xl');
        expect(wide.classes()).not.toContain('max-w-md');
    });

    it('renders the title as the one h1 and the description, from layout props', () => {
        const wrapper = layout({
            title: 'Log in',
            description: 'Welcome back',
        });

        expect(wrapper.findAll('h1')).toHaveLength(1);
        expect(wrapper.get('h1').text()).toBe('Log in');
        expect(wrapper.text()).toContain('Welcome back');
    });

    it('renders no heading when the page brings its own', () => {
        expect(layout().findAll('h1')).toHaveLength(0);
    });

    it('shows the app name as the logo, or the business logo image when there is one', () => {
        expect(layout().get('[data-slot="card"] a').text()).toBe('Furny');

        page.props.app = { name: 'Furny', logoUrl: '/storage/logo.png' };
        const image = layout().get('[data-slot="card"] a img');

        expect(image.attributes('src')).toBe('/storage/logo.png');
        expect(image.attributes('alt')).toBe('Furny');
        expect(image.classes()).toContain('max-h-8');
    });

    it('renders the form slot and the footer slot', () => {
        const wrapper = layout(
            {},
            { footer: '<a data-test="alt">New here?</a>' },
        );

        expect(wrapper.find('[data-test="form"]').exists()).toBe(true);
        expect(wrapper.get('[data-slot="card"] [data-test="alt"]').text()).toBe(
            'New here?',
        );
        expect(
            layout().find('[data-slot="card"] .text-center.text-sm').exists(),
        ).toBe(false);
    });

    it('has #main, a skip link and the page footer with business details and legal links', () => {
        const wrapper = layout();
        const contact = wrapper.get('[data-test="business-contact"]');

        expect(wrapper.findAll('main#main')).toHaveLength(1);
        expect(wrapper.get('[data-test="skip-link"]').attributes('href')).toBe(
            '#main',
        );
        expect(wrapper.get('footer').text()).toContain('Acme Woodworks');
        expect(contact.text()).toContain('Mon-Sat 9-6');
        expect(contact.find('a[href="tel:+919800011122"]').exists()).toBe(true);
        expect(contact.find('a[href="mailto:hello@acme.test"]').exists()).toBe(
            true,
        );
        expect(wrapper.get('footer a[href="/terms"]').text()).toBe('Terms');
        expect(wrapper.get('footer a[href="/privacy"]').text()).toBe('Privacy');
    });

    it('escapes the business name instead of rendering it as markup', () => {
        page.props.business = { name: '<img src=x onerror=alert(1)>' };
        const wrapper = layout();

        expect(wrapper.find('footer img').exists()).toBe(false);
        expect(wrapper.get('footer').text()).toContain(
            '<img src=x onerror=alert(1)>',
        );
    });

    it('is full width without border or shadow on a phone', () => {
        const classes = layout().get('[data-slot="card"]').classes();

        expect(classes).toContain('max-sm:border-0');
        expect(classes).toContain('max-sm:shadow-none');
    });
});
