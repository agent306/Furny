import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { h } from 'vue';

vi.mock('@inertiajs/vue3', async (importOriginal) => {
    const { page: testPage } = await import('@/test/inertiaPage');

    return {
        ...(await importOriginal<typeof import('@inertiajs/vue3')>()),
        usePage: () => testPage,
        router: { on: () => () => undefined, flushAll: vi.fn() },
    };
});

import PageHeader from '@/components/common/PageHeader.vue';
import CustomerLayout from '@/layouts/CustomerLayout.vue';
import { page, resetPage } from '@/test/inertiaPage';

enableAutoUnmount(afterEach);

beforeEach(() => {
    resetPage({
        app: { name: 'Furny', logoUrl: null },
        auth: {
            user: {
                type: 'customer',
                name: 'Asha Rao',
                email: 'asha@example.test',
            },
        },
        business: { name: 'Acme Woodworks' },
        unreadNotifications: 2,
    });
    page.url = '/dashboard';
});

function layout(slots: Record<string, unknown> = {}) {
    return mount(CustomerLayout, {
        slots: { default: () => 'content', ...slots },
        attachTo: document.body,
    });
}

describe('CustomerLayout (15 §7.1)', () => {
    it('has a sticky h-16 header at z-30 with the logo, the bell and the account menu', () => {
        const header = layout().get('[data-test="customer-header"]');

        expect(header.classes()).toEqual(
            expect.arrayContaining([
                'sticky',
                'top-0',
                'h-16',
                'z-30',
                'border-b',
            ]),
        );
        expect(header.text()).toContain('Furny');
        expect(header.find('[data-test="notification-bell"]').exists()).toBe(
            true,
        );
        expect(header.find('[data-test="user-menu"]').exists()).toBe(true);
    });

    it('links the logo and the primary nav to the dashboard, the current page marked', () => {
        const wrapper = layout();
        const logo = wrapper.get('[data-test="customer-header"] a');
        const nav = wrapper.get('nav[aria-label="Main"]');
        const current = nav.get('a[aria-current="page"]');

        expect(logo.attributes('href')).toBe('/dashboard');
        expect(current.attributes('href')).toBe('/dashboard');
        expect(current.text()).toBe('Dashboard');
        expect(current.classes()).toContain('border-primary');
    });

    it('opens the same navigation in a left sheet from the tablet menu button', async () => {
        const wrapper = layout();
        const trigger = wrapper.get('[data-test="menu-trigger"]');

        expect(trigger.attributes('aria-label')).toBe('Open menu');
        expect(trigger.classes()).toEqual(
            expect.arrayContaining(['md:inline-flex', 'lg:hidden']),
        );

        await trigger.trigger('click');
        await flushPromises();

        const sheet = document.body.querySelector(
            '[data-slot="sheet-content"]',
        );

        expect(sheet?.className).toContain('w-72');
        expect(
            sheet?.querySelector('a[aria-current="page"]')?.textContent?.trim(),
        ).toBe('Dashboard');
    });

    it('does not mark the dashboard current on another page', () => {
        page.url = '/projects';

        expect(
            layout().find('nav[aria-label="Main"] a[aria-current]').exists(),
        ).toBe(false);
    });

    it('renders #main with the room for the tab bar on a phone and the slot inside', () => {
        const main = layout().get('main#main');

        expect(main.attributes('tabindex')).toBe('-1');
        expect(main.classes()).toEqual(
            expect.arrayContaining(['max-w-6xl', 'px-4', 'py-4', 'pb-24']),
        );
        expect(main.text()).toBe('content');
    });

    it('adds no h1 of its own: a page with a PageHeader has exactly one', () => {
        expect(layout().findAll('h1')).toHaveLength(0);

        const withPage = layout({
            default: () => h(PageHeader, { title: 'Dashboard' }),
        });

        expect(withPage.findAll('h1')).toHaveLength(1);
        expect(withPage.get('main#main h1').text()).toBe('Dashboard');
    });

    it('renders the banner slot above #main only when given', () => {
        expect(layout().find('#banner').exists()).toBe(false);
        expect(
            layout({ banner: () => 'Verify your email' })
                .get('#banner')
                .text(),
        ).toBe('Verify your email');
    });

    describe('the verify-contact banner (10 §1.1)', () => {
        const unverified = {
            type: 'customer' as const,
            name: 'Asha Rao',
            email: 'asha@example.test',
            emailVerified: false,
            phoneVerified: false,
        };

        it('is the content of #banner for a customer with neither contact verified, above the page banner', () => {
            page.props.auth = { user: unverified };
            const banner = layout({ banner: () => 'Page notice' }).get(
                '#banner',
            );

            expect(
                banner.get('[data-test="verify-contact-banner"]').text(),
            ).toContain(
                'Verify your email or phone to send orders and messages.',
            );
            expect(banner.text().indexOf('Verify your email')).toBeLessThan(
                banner.text().indexOf('Page notice'),
            );
        });

        it('opens #banner by itself when the page has none', () => {
            page.props.auth = { user: unverified };

            expect(layout().find('#banner').exists()).toBe(true);
        });

        it.each([
            [
                'an email that is verified',
                { ...unverified, emailVerified: true },
            ],
            [
                'a phone that is verified',
                { ...unverified, phoneVerified: true },
            ],
        ])('is not shown for %s', (_name, user) => {
            page.props.auth = { user };
            const wrapper = layout();

            expect(wrapper.find('#banner').exists()).toBe(false);
            expect(
                wrapper.find('[data-test="verify-contact-banner"]').exists(),
            ).toBe(false);
        });
    });

    it('shows the footer from tablet up: copyright, Terms and Privacy', () => {
        const footer = layout().get('footer');

        expect(footer.classes()).toContain('hidden');
        expect(footer.classes()).toContain('md:block');
        expect(footer.text()).toContain(
            `© ${new Date().getFullYear()} Acme Woodworks`,
        );
        expect(footer.find('a[href="/terms"]').exists()).toBe(true);
        expect(footer.find('a[href="/privacy"]').exists()).toBe(true);
    });

    it('has a skip link to #main', () => {
        expect(layout().get('[data-test="skip-link"]').attributes('href')).toBe(
            '#main',
        );
    });
});

describe('MobileTabBar in CustomerLayout (15 §7.1, §14 item 6)', () => {
    it('is a phone-only fixed bar at z-30, h-16 plus the safe-area inset', () => {
        const bar = layout().get('[data-test="mobile-tab-bar"]');

        expect(bar.classes()).toEqual(
            expect.arrayContaining([
                'fixed',
                'inset-x-0',
                'bottom-0',
                'z-30',
                'md:hidden',
                'pb-[env(safe-area-inset-bottom)]',
            ]),
        );
        expect(bar.get('ul').classes()).toContain('h-16');
        expect(bar.attributes('aria-label')).toBe('Primary');
    });

    it('gives every tab a 44 px minimum touch target with an icon and a label', () => {
        const link = layout().get('[data-test="mobile-tab-bar"] a');

        expect(link.classes()).toEqual(
            expect.arrayContaining(['min-h-11', 'min-w-11']),
        );
        expect(link.get('svg').attributes('aria-hidden')).toBe('true');
        expect(link.get('svg').classes()).toContain('size-6');
        expect(link.text()).toBe('Home');
        expect(link.attributes('href')).toBe('/dashboard');
    });

    it('marks the current tab', () => {
        const link = layout().get('[data-test="mobile-tab-bar"] a');

        expect(link.attributes('aria-current')).toBe('page');
        expect(link.classes()).toContain('text-primary');
    });
});
