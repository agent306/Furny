import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@inertiajs/vue3', async (importOriginal) => {
    const { page: testPage } = await import('@/test/inertiaPage');
    const { defineComponent: define } = await import('vue');

    return {
        ...(await importOriginal<typeof import('@inertiajs/vue3')>()),
        usePage: () => testPage,
        Head: define({
            name: 'Head',
            props: { title: String },
            render: () => null,
        }),
    };
});

import { Head } from '@inertiajs/vue3';
import AdminDashboard from '@/pages/Admin/Dashboard.vue';
import CustomerDashboard from '@/pages/Customer/Dashboard.vue';
import ErrorPage from '@/pages/Error.vue';
import Privacy from '@/pages/Legal/Privacy.vue';
import Terms from '@/pages/Legal/Terms.vue';
import Welcome from '@/pages/Welcome.vue';
import en from '@/lang/generated/en.json';
import AuthLayout from '@/layouts/AuthLayout.vue';
import { page, resetPage } from '@/test/inertiaPage';

enableAutoUnmount(afterEach);

beforeEach(() => {
    resetPage({
        app: { name: 'Furny', logoUrl: null },
        auth: { user: null },
        business: {
            name: 'Acme Woodworks',
            locale: 'en-IN',
            timezone: 'Asia/Kolkata',
        },
    });
});

describe('Welcome (10 §4.1)', () => {
    it('shows the tagline as the h1, the three rows and both buttons', () => {
        const wrapper = mount(Welcome, { props: { canRegister: true } });

        expect(wrapper.findAll('h1')).toHaveLength(1);
        expect(wrapper.get('h1').text()).toBe(
            'Design furniture that fits your home perfectly.',
        );
        expect(wrapper.findAll('li').map((li) => li.text())).toEqual([
            'Upload your floor plan or draw it',
            'Design custom furniture in 2D and 3D',
            'Get a quote and follow production to delivery',
        ]);
        expect(wrapper.get('a[href="/register"]').text()).toBe(
            'Create account',
        );
        expect(wrapper.get('a[href="/login"]').text()).toBe('Log in');
        expect(
            wrapper
                .findAll('li svg')
                .every((icon) => icon.attributes('aria-hidden') === 'true'),
        ).toBe(true);
    });

    it('hides Create account when registration is closed', () => {
        const wrapper = mount(Welcome, { props: { canRegister: false } });

        expect(wrapper.find('a[href="/register"]').exists()).toBe(false);
        expect(wrapper.find('a[href="/login"]').exists()).toBe(true);
    });

    it('stacks full-width buttons on a phone', () => {
        const wrapper = mount(Welcome, { props: { canRegister: true } });

        expect(wrapper.get('a[href="/register"]').classes()).toContain(
            'w-full',
        );
        expect(wrapper.get('a[href="/login"]').classes()).toContain('w-full');
    });

    it('declares the wide AuthLayout as its own layout', () => {
        const options = Welcome as unknown as { layout?: unknown };

        expect(options.layout).toEqual([AuthLayout, { variant: 'wide' }]);
    });

    it('sets a document title', () => {
        expect(
            mount(Welcome, { props: { canRegister: true } })
                .findComponent(Head)
                .props('title'),
        ).toBe('Welcome');
    });
});

describe('Legal pages (10 §4.9)', () => {
    it.each([
        ['Terms', Terms, 'Terms of service', 'legal.terms.body'],
        ['Privacy', Privacy, 'Privacy policy', 'legal.privacy.body'],
    ] as const)(
        '%s renders its title, the update date and one paragraph per block',
        (_name, component, title, key) => {
            const wrapper = mount(component, {
                props: {
                    businessName: 'Acme Woodworks',
                    updatedOn: '2026-10-20',
                },
            });
            const blocks =
                (en as Record<string, string>)[key]?.split(/\n{2,}/) ?? [];

            expect(wrapper.findAll('h1')).toHaveLength(1);
            expect(wrapper.get('h1').text()).toBe(title);
            expect(wrapper.text()).toContain('Last updated 20 October 2026');
            expect(wrapper.findAll('article > p').length).toBe(blocks.length);
            expect(wrapper.text()).toContain('Acme Woodworks');
            expect(wrapper.text()).not.toContain('{business}');
            expect(wrapper.findComponent(Head).props('title')).toBe(title);
        },
    );

    it('escapes the business name: it is text, never markup', () => {
        const hostile =
            '<img src=x onerror="window.__pwned=1"><b>Evil</b> & Sons';
        const wrapper = mount(Terms, {
            props: { businessName: hostile, updatedOn: '2026-10-20' },
        });

        expect(wrapper.find('img').exists()).toBe(false);
        expect(wrapper.find('b').exists()).toBe(false);
        expect(wrapper.text()).toContain(hostile);
        expect(wrapper.html()).toContain('&lt;img');
    });

    it('renders no markup from the body either, paragraphs are plain text', () => {
        const wrapper = mount(Privacy, {
            props: { businessName: 'Acme', updatedOn: '2026-10-20' },
        });

        expect(
            wrapper
                .find('article')
                .element.querySelectorAll('a, b, i, script, img').length,
        ).toBe(0);
    });
});

describe('Error page (10 §4.10)', () => {
    const MESSAGES = {
        403: "You don't have access to this page.",
        404: "We couldn't find that page.",
        405: "That action isn't available here.",
        419: 'Your session expired. Please reload.',
        429: 'Too many requests. Please wait a moment.',
        500: 'Something went wrong on our side.',
        503: "We're doing maintenance. Back shortly.",
    } as const;

    it.each(Object.entries(MESSAGES))(
        'shows the message for %s',
        (status, message) => {
            const wrapper = mount(ErrorPage, {
                props: { status: Number(status) as 403 },
            });

            expect(wrapper.get('h2').text()).toBe(message);
            expect(wrapper.get('h1').text()).toBe(`Error ${status}`);
            expect(wrapper.findAll('h1')).toHaveLength(1);
        },
    );

    it('has a translation for every status (the keys are built from the status)', () => {
        for (const status of [403, 404, 405, 419, 429, 500, 503]) {
            expect(en, String(status)).toHaveProperty(`errors.pages.${status}`);
        }
    });

    it('uses the icon of the status', () => {
        const icon = (status: 403 | 404 | 405 | 419 | 429 | 500 | 503) =>
            mount(ErrorPage, { props: { status } })
                .get('[class*="bg-brand-wood-subtle"] svg')
                .classes();

        expect(icon(403)).toContain('lucide-lock');
        expect(icon(404)).toContain('lucide-map-pin-off');
        expect(icon(405)).toContain('lucide-lock');
        expect(icon(419)).toContain('lucide-refresh-cw');
        expect(icon(429)).toContain('lucide-hourglass');
        expect(icon(500)).toContain('lucide-triangle-alert');
        expect(icon(503)).toContain('lucide-wrench');
    });

    it.each([419, 500, 503] as const)('offers Reload for %s', (status) => {
        expect(mount(ErrorPage, { props: { status } }).text()).toContain(
            'Reload',
        );
    });

    it.each([403, 404, 429] as const)(
        'does not offer Reload for %s',
        (status) => {
            expect(
                mount(ErrorPage, { props: { status } }).text(),
            ).not.toContain('Reload');
        },
    );

    it('reloads the document', async () => {
        const reload = vi.fn();
        const wrapper = mount(ErrorPage, { props: { status: 419 } });

        // After the mount: the links read `window.location` while they render.
        vi.stubGlobal('location', { reload });

        try {
            await wrapper
                .findAll('button')
                .find((b) => b.text() === 'Reload')
                ?.trigger('click');

            expect(reload).toHaveBeenCalledTimes(1);
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('sends a guest home, a customer and staff to their dashboard', () => {
        const link = () =>
            mount(ErrorPage, { props: { status: 404 } }).get('a');

        expect(link().attributes('href')).toBe('/');
        expect(link().text()).toBe('Go to the home page');

        page.props.auth = { user: { type: 'customer' } };
        expect(link().attributes('href')).toBe('/dashboard');
        expect(link().text()).toBe('Go to dashboard');

        page.props.auth = { user: { type: 'staff' } };
        expect(link().attributes('href')).toBe('/admin');
    });
});

describe('placeholder dashboards', () => {
    it('customer: one h1 greeting by name, the empty state is not a heading level 1', () => {
        page.props.auth = { user: { type: 'customer', name: 'Asha Rao' } };
        const wrapper = mount(CustomerDashboard);

        expect(wrapper.findAll('h1')).toHaveLength(1);
        expect(wrapper.get('h1').text()).toBe('Hello, Asha Rao');
        expect(wrapper.get('h2').text()).toBe("Let's start with your home");
        expect(wrapper.findComponent(Head).props('title')).toBe('Dashboard');
    });

    it('admin: one h1', () => {
        page.props.auth = { user: { type: 'staff', name: 'Ravi' } };
        const wrapper = mount(AdminDashboard);

        expect(wrapper.findAll('h1')).toHaveLength(1);
        expect(wrapper.get('h1').text()).toBe('Dashboard');
    });

    it('escapes the customer name in the greeting', () => {
        page.props.auth = { user: { type: 'customer', name: '<i>Asha</i>' } };
        const wrapper = mount(CustomerDashboard);

        expect(wrapper.find('h1 i').exists()).toBe(false);
        expect(wrapper.get('h1').text()).toBe('Hello, <i>Asha</i>');
    });
});

describe('every page renders exactly one h1 (15 §14 item 4)', () => {
    it('is true for each page of this task', () => {
        page.props.auth = { user: { type: 'customer', name: 'A' } };

        const pages = [
            mount(Welcome, { props: { canRegister: true } }),
            mount(Terms, {
                props: { businessName: 'A', updatedOn: '2026-10-20' },
            }),
            mount(Privacy, {
                props: { businessName: 'A', updatedOn: '2026-10-20' },
            }),
            mount(ErrorPage, { props: { status: 404 } }),
            mount(CustomerDashboard),
            mount(AdminDashboard),
        ];

        for (const wrapper of pages) {
            expect(wrapper.findAll('h1')).toHaveLength(1);
            expect(wrapper.get('h1').attributes('tabindex')).toBe('-1');
        }
    });
});
