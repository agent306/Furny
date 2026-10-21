import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';

const reload = vi.hoisted(() => vi.fn());

vi.mock('@inertiajs/vue3', async (importOriginal) => {
    const { page: testPage } = await import('@/test/inertiaPage');

    return {
        ...(await importOriginal<typeof import('@inertiajs/vue3')>()),
        usePage: () => testPage,
        router: { on: () => () => undefined, reload, flushAll: vi.fn() },
    };
});
// The shipped nav has one item; the filter needs a richer one (15 §7.2).
vi.mock('@/lib/adminNav', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/adminNav')>()),
    adminNav: [
        {
            key: 'main',
            items: [
                {
                    key: 'dashboard',
                    labelKey: 'common.nav.dashboard',
                    href: '/admin',
                    icon: 'layout-dashboard',
                    exact: true,
                },
            ],
        },
        {
            key: 'orders',
            labelKey: 'notifications.title',
            items: [
                {
                    key: 'board',
                    labelKey: 'common.nav.home',
                    href: '/admin/orders',
                    icon: 'package',
                    anyOf: ['orders.view'],
                    counter: 'submitted',
                },
            ],
        },
        {
            key: 'catalog',
            labelKey: 'common.theme.label',
            items: [
                {
                    key: 'materials',
                    labelKey: 'common.footer.terms',
                    href: '/admin/catalog/materials',
                    icon: 'hammer',
                    anyOf: ['catalog.manage'],
                },
            ],
        },
        {
            key: 'administration',
            items: [
                {
                    key: 'settings',
                    labelKey: 'common.footer.privacy',
                    href: '/admin/settings',
                    icon: 'wrench',
                    anyOf: ['settings.manage', 'settings.manage_restricted'],
                },
            ],
        },
    ],
}));

import AdminLayout from '@/layouts/AdminLayout.vue';
import { page, resetPage } from '@/test/inertiaPage';
import type { TestUser } from '@/test/inertiaPage';
import { PHONE, resetViewport, setViewport } from '@/test/viewport';

enableAutoUnmount(afterEach);

const staff = (extra: Partial<TestUser> = {}): TestUser => ({
    type: 'staff',
    name: 'Ravi Kumar',
    email: 'ravi@example.test',
    avatarUrl: null,
    roles: ['estimator'],
    permissions: [],
    abilities: [],
    ...extra,
});

function mountLayout(slot = '<h1>Orders</h1>') {
    return mount(AdminLayout, {
        slots: { default: slot },
        attachTo: document.body,
    });
}

function labels(wrapper: ReturnType<typeof mountLayout>): string[] {
    return wrapper
        .findAll('[data-sidebar="content"] [data-sidebar="menu-button"] span')
        .map((span) => span.text());
}

beforeEach(() => {
    reload.mockClear();
    resetViewport();
    resetPage({
        app: { name: 'Furny', logoUrl: null },
        auth: { user: staff() },
    });
    page.url = '/admin';
});

afterEach(() => {
    document.cookie = 'sidebar_state=; max-age=0; path=/';
});

describe('AdminLayout nav (15 §7.2)', () => {
    it('renders only the items whose permission the user has', () => {
        page.props.auth = { user: staff({ permissions: ['orders.view'] }) };

        expect(labels(mountLayout())).toEqual(['Dashboard', 'Home']);
    });

    it('hides a group whose items are all hidden, label included', () => {
        page.props.auth = { user: staff({ permissions: ['orders.view'] }) };
        const wrapper = mountLayout();

        const groupLabels = wrapper
            .findAll('[data-slot="sidebar-group-label"]')
            .map((el) => el.text());

        expect(groupLabels).toEqual(['Notifications']);
    });

    it('shows an item for any one of its permissions or owner gates', () => {
        page.props.auth = {
            user: staff({
                roles: ['owner'],
                abilities: ['settings.manage_restricted'],
            }),
        };

        expect(labels(mountLayout())).toEqual(['Dashboard', 'Privacy']);
    });

    it('shows everything to a user with every permission', () => {
        page.props.auth = {
            user: staff({
                permissions: [
                    'orders.view',
                    'catalog.manage',
                    'settings.manage',
                ],
            }),
        };

        expect(labels(mountLayout())).toEqual([
            'Dashboard',
            'Home',
            'Terms',
            'Privacy',
        ]);
    });

    it('marks the current page with aria-current and no other', () => {
        const wrapper = mountLayout();
        const links = wrapper.findAll(
            '[data-sidebar="content"] [data-sidebar="menu-button"][aria-current]',
        );

        expect(links).toHaveLength(1);
        expect(links[0]?.attributes('aria-current')).toBe('page');
        expect(links[0]?.text()).toBe('Dashboard');
    });

    it('shows the staff counter on its item and asks for it when it was not sent', async () => {
        page.props.auth = { user: staff({ permissions: ['orders.view'] }) };
        mountLayout();

        expect(reload).toHaveBeenCalledWith({ only: ['staffCounters'] });

        page.props.staffCounters = { submitted: 4, toCall: 1 };
        await nextTick();

        expect(
            document.body
                .querySelector('[data-slot="sidebar-menu-badge"]')
                ?.textContent?.trim(),
        ).toBe('4');
    });

    it('does not reload staffCounters when no visible item needs them or they are present', () => {
        mountLayout();
        expect(reload).not.toHaveBeenCalled();

        page.props.auth = { user: staff({ permissions: ['orders.view'] }) };
        page.props.staffCounters = { submitted: 0, toCall: 0 };
        mountLayout();
        expect(reload).not.toHaveBeenCalled();
    });

    it('shows the signed-in user with a translated role badge in the sidebar footer', () => {
        const footer = mountLayout().get('[data-test="sidebar-user"]');

        expect(footer.text()).toContain('Ravi Kumar');
        expect(footer.text()).toContain('Estimator');
    });
});

describe('AdminLayout regions', () => {
    it('renders #main once, the top bar and a skip link; the layout adds no h1', () => {
        const wrapper = mountLayout('<p>content</p>');

        expect(wrapper.findAll('main#main')).toHaveLength(1);
        expect(wrapper.find('[data-test="admin-header"]').exists()).toBe(true);
        expect(wrapper.get('[data-test="skip-link"]').attributes('href')).toBe(
            '#main',
        );
        expect(wrapper.findAll('h1')).toHaveLength(0);
    });

    it('renders the slot inside #main', () => {
        expect(mountLayout().get('main#main').text()).toContain('Orders');
    });

    it('shows breadcrumbs from the layout props, the last one as plain text', () => {
        const wrapper = mount(AdminLayout, {
            props: {
                breadcrumbs: [
                    { title: 'Orders', href: '/admin/orders' },
                    { title: 'ORD-1' },
                ],
            },
            slots: { default: '<p>x</p>' },
            attachTo: document.body,
        });
        const crumbs = wrapper.get('[data-slot="breadcrumb"]');

        expect(crumbs.get('a').attributes('href')).toBe('/admin/orders');
        expect(crumbs.get('[aria-current="page"]').text()).toBe('ORD-1');
        expect(wrapper.get('[data-test="phone-title"]').text()).toBe('ORD-1');
    });

    it('shows a dismissible health banner above #main', async () => {
        page.props.healthBanners = [
            { key: 'otp', messageKey: 'common.offline.banner' },
            { key: 'sms', messageKey: 'common.copied' },
        ];
        const wrapper = mountLayout();
        const banners = wrapper.findAll('[data-test="health-banner"]');

        expect(banners).toHaveLength(2);
        expect(banners[0]?.text()).toContain("You're offline");

        await banners[0]?.get('button').trigger('click');

        expect(wrapper.findAll('[data-test="health-banner"]')).toHaveLength(1);
        expect(wrapper.get('[data-test="health-banner"]').text()).toContain(
            'Copied',
        );
    });

    it('is an offcanvas sheet on a phone: the nav is not in the page until opened', () => {
        setViewport(PHONE);
        const wrapper = mountLayout();

        expect(wrapper.find('[data-test="admin-sidebar"]').exists()).toBe(
            false,
        );
        expect(wrapper.find('[data-slot="sidebar-trigger"]').exists()).toBe(
            true,
        );
    });
});

describe('AdminLayout sidebar cookie round trip (15 §7.2)', () => {
    const state = (wrapper: ReturnType<typeof mountLayout>) =>
        wrapper.get('[data-slot="sidebar"]').attributes('data-state');

    it('starts expanded without a cookie and after sidebar_state=true', () => {
        expect(state(mountLayout())).toBe('expanded');

        document.cookie = 'sidebar_state=true; path=/';

        expect(state(mountLayout())).toBe('expanded');
    });

    it('starts collapsed when sidebar_state=false', () => {
        document.cookie = 'sidebar_state=false; path=/';

        expect(state(mountLayout())).toBe('collapsed');
    });

    it('writes the cookie on toggle and the next mount reads it back', async () => {
        const first = mountLayout();

        await first.get('[data-slot="sidebar-trigger"]').trigger('click');

        expect(state(first)).toBe('collapsed');
        expect(document.cookie).toContain('sidebar_state=false');

        first.unmount();

        expect(state(mountLayout())).toBe('collapsed');
    });

    it('toggles with Ctrl+B and writes the cookie each way', async () => {
        const wrapper = mountLayout();

        window.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'b', ctrlKey: true }),
        );
        await nextTick();

        expect(state(wrapper)).toBe('collapsed');
        expect(document.cookie).toContain('sidebar_state=false');

        window.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'b', ctrlKey: true }),
        );
        await nextTick();

        expect(state(wrapper)).toBe('expanded');
        expect(document.cookie).toContain('sidebar_state=true');
    });
});
