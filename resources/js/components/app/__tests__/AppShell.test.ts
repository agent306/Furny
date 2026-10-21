import { flushPromises, mount } from '@vue/test-utils';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, inject, nextTick } from 'vue';
import type { Ref } from 'vue';

const toast = vi.hoisted(() => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
}));
const navigate = vi.hoisted(() => ({
    handler: null as null | ((event: unknown) => void),
    stop: vi.fn(),
}));

vi.mock('vue-sonner', () => ({ toast }));
vi.mock('@/components/ui/sonner', async () => {
    const { defineComponent: define, h: render } = await import('vue');

    return {
        Toaster: define({
            name: 'ToasterStub',
            inheritAttrs: false,
            setup:
                (_props, { attrs }) =>
                () =>
                    render('div', { 'data-test': 'toaster', ...attrs }),
        }),
    };
});
vi.mock('@inertiajs/vue3', async (importOriginal) => {
    const { page: testPage } = await import('@/test/inertiaPage');

    return {
        ...(await importOriginal<typeof import('@inertiajs/vue3')>()),
        usePage: () => testPage,
        router: {
            on: (_event: string, handler: (event: unknown) => void) => {
                navigate.handler = handler;

                return navigate.stop;
            },
        },
    };
});

import AppShell from '@/components/app/AppShell.vue';
import ConfirmHost from '@/components/common/ConfirmHost.vue';
import OfflineBanner from '@/components/common/OfflineBanner.vue';
import { DENSITY_KEY } from '@/composables/useControlSize';
import type { Density } from '@/composables/useControlSize';
import { page, resetPage } from '@/test/inertiaPage';
import {
    DESKTOP,
    PHONE,
    resetViewport,
    setViewport,
    TABLET,
} from '@/test/viewport';

function mountShell(
    variant: 'customer' | 'admin' = 'customer',
    slot = '<main id="main"><h1>Page</h1></main>',
) {
    return mount(AppShell, {
        props: { variant },
        slots: { default: slot },
        attachTo: document.body,
    });
}

beforeEach(() => {
    resetPage({ app: { name: 'Furny', logoUrl: null } });
    for (const fn of Object.values(toast)) {
        fn.mockClear();
    }
    navigate.handler = null;
    navigate.stop.mockClear();
    resetViewport();
});

afterEach(() => {
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
});

describe('AppShell flash bridge (15 §10.3)', () => {
    it('toasts the flash of a visit once and not again on a re-render of the same visit', async () => {
        page.props = { flash: { success: 'Project saved.' } };
        mountShell();
        await nextTick();

        expect(toast.success).toHaveBeenCalledTimes(1);
        expect(toast.success).toHaveBeenCalledWith('Project saved.', {
            duration: 4000,
        });

        // A partial reload / unrelated prop change keeps the same flash object.
        page.props = { ...page.props, unreadNotifications: 3 };
        await nextTick();
        page.props.unreadNotifications = 4;
        await nextTick();

        expect(toast.success).toHaveBeenCalledTimes(1);
    });

    it('does not repeat the visit when the shell is remounted for the same page', async () => {
        const flash = { error: 'Something failed.' };
        page.props = { flash };
        const first = mountShell();
        await nextTick();
        first.unmount();

        mountShell();
        await nextTick();

        expect(toast.error).toHaveBeenCalledTimes(1);
    });

    it('toasts again for a new visit, even with the same text', async () => {
        page.props = { flash: { success: 'Saved.' } };
        mountShell();
        await nextTick();

        page.props = { flash: { success: 'Saved.' } };
        await nextTick();

        expect(toast.success).toHaveBeenCalledTimes(2);
    });

    it('shows warnings and errors with their own durations', async () => {
        page.props = { flash: { warning: 'Heads up.', error: 'Failed.' } };
        mountShell();
        await nextTick();

        expect(toast.warning).toHaveBeenCalledWith('Heads up.', {
            duration: 6000,
        });
        expect(toast.error).toHaveBeenCalledWith('Failed.', { duration: 8000 });
    });

    it('renders flash as text only: no markup reaches the DOM or a toast', async () => {
        const hostile =
            '<img src="x" onerror="window.__pwned = 1"><script>window.__pwned = 2</script>';
        page.props = { flash: { error: hostile } };
        const wrapper = mountShell();
        await nextTick();

        expect(toast.error.mock.calls[0]?.[0]).toBe(hostile);
        expect(wrapper.find('img').exists()).toBe(false);
        expect(wrapper.find('script').exists()).toBe(false);
        expect(wrapper.html()).not.toContain('onerror');
        expect(
            (window as unknown as { __pwned?: number }).__pwned,
        ).toBeUndefined();
    });

    it('never uses v-html or innerHTML for flash (source guard)', () => {
        for (const file of [
            'resources/js/components/app/AppShell.vue',
            'resources/js/lib/flashToast.ts',
        ]) {
            const source = readFileSync(file, 'utf8');

            expect(source, file).not.toMatch(
                /v-html|innerHTML|insertAdjacentHTML/,
            );
        }
    });
});

describe('AppShell toaster and density', () => {
    it('places the toaster bottom-right from 768 px and top-center below', () => {
        setViewport(TABLET);
        const tablet = mountShell();

        expect(tablet.get('[data-test="toaster"]').attributes('position')).toBe(
            'bottom-right',
        );

        setViewport(PHONE);
        const phone = mountShell();

        expect(phone.get('[data-test="toaster"]').attributes('position')).toBe(
            'top-center',
        );
    });

    it('configures a rich, closable toaster of three toasts with a translated close label', () => {
        const wrapper = mountShell();
        const toaster = wrapper.get('[data-test="toaster"]');

        expect(toaster.attributes('rich-colors')).toBeDefined();
        expect(toaster.attributes('close-button')).toBeDefined();
        expect(toaster.attributes('visible-toasts')).toBe('3');
        expect(toaster.attributes('container-aria-label')).toBe(
            'Notifications',
        );
    });

    function densityIn(variant: 'customer' | 'admin'): Density {
        let density: Density | null = null;
        const Probe = defineComponent({
            setup() {
                const injected = inject<Ref<Density>>(DENSITY_KEY);

                return () => {
                    density = injected?.value ?? null;

                    return h('span');
                };
            },
        });

        mount(AppShell, {
            props: { variant },
            slots: { default: () => h(Probe) },
        });

        return density ?? 'comfortable';
    }

    it('provides comfortable density to the customer app at every width', () => {
        for (const width of [PHONE, TABLET, DESKTOP]) {
            setViewport(width);

            expect(densityIn('customer')).toBe('comfortable');
        }
    });

    it('provides compact density to the admin only from 768 px', () => {
        setViewport(DESKTOP);
        expect(densityIn('admin')).toBe('compact');

        setViewport(TABLET);
        expect(densityIn('admin')).toBe('compact');

        setViewport(PHONE);
        expect(densityIn('admin')).toBe('comfortable');
    });
});

describe('AppShell regions', () => {
    it('renders a skip link to #main as the first focusable element', () => {
        const wrapper = mountShell();
        const link = wrapper.get('[data-test="skip-link"]');

        expect(link.attributes('href')).toBe('#main');
        expect(link.text()).toBe('Skip to content');
        expect(wrapper.element.parentElement?.querySelector('a, button')).toBe(
            link.element,
        );
        expect(wrapper.find('#main').exists()).toBe(true);
    });

    it('mounts the confirm host and the offline banner', () => {
        const wrapper = mountShell();

        expect(wrapper.findComponent(ConfirmHost).exists()).toBe(true);
        expect(wrapper.findComponent(OfflineBanner).exists()).toBe(true);
    });

    it('shows the offline banner only while the browser is offline', async () => {
        const online = vi
            .spyOn(navigator, 'onLine', 'get')
            .mockReturnValue(true);
        const wrapper = mountShell();

        expect(wrapper.find('[data-test="offline-banner"]').exists()).toBe(
            false,
        );

        online.mockReturnValue(false);
        window.dispatchEvent(new Event('offline'));
        await nextTick();

        const banner = wrapper.get('[data-test="offline-banner"]');

        expect(banner.attributes('role')).toBe('status');
        expect(banner.text()).toBe(
            "You're offline. Changes will be sent when you reconnect.",
        );

        online.mockReturnValue(true);
        window.dispatchEvent(new Event('online'));
        await nextTick();

        expect(wrapper.find('[data-test="offline-banner"]').exists()).toBe(
            false,
        );
        online.mockRestore();
    });
});

describe('AppShell focus after navigation (15 §14 item 4)', () => {
    function navigateTo(
        component: string,
        url: string,
        type: 'initial' | 'visit' | 'history' = 'visit',
    ): void {
        navigate.handler?.({ detail: { page: { component, url }, type } });
    }

    it('moves focus to the main heading and announces the title when the page changes', async () => {
        page.component = 'Customer/Dashboard';
        page.url = '/dashboard';
        const wrapper = mountShell(
            'customer',
            '<main id="main"><h1>Orders</h1></main>',
        );

        document.title = 'Orders · Furny';
        navigateTo('Customer/Orders/Index', '/orders');
        await flushPromises();

        const heading = wrapper.get('h1').element;

        expect(document.activeElement).toBe(heading);
        expect(heading.getAttribute('tabindex')).toBe('-1');

        await new Promise((resolve) => setTimeout(resolve, 80));
        await nextTick();

        expect(wrapper.get('[data-test="route-announcer"]').text()).toBe(
            'Orders · Furny',
        );
        expect(
            wrapper
                .get('[data-test="route-announcer"]')
                .attributes('aria-live'),
        ).toBe('polite');
    });

    it('falls back to #main when the page has no h1', async () => {
        page.component = 'A';
        page.url = '/a';
        mountShell('customer', '<main id="main"><p>No heading</p></main>');

        navigateTo('B', '/b');
        await flushPromises();

        expect(document.activeElement?.id).toBe('main');
    });

    it('leaves focus alone on the initial load, on a reload and on a query change of the same page', async () => {
        page.component = 'Customer/Orders/Index';
        page.url = '/orders';
        mountShell(
            'customer',
            '<main id="main"><h1>Orders</h1><input id="search"></main>',
        );
        const search = document.getElementById('search') as HTMLInputElement;

        search.focus();
        navigateTo('Customer/Orders/Index', '/orders', 'initial');
        navigateTo('Customer/Orders/Index', '/orders');
        navigateTo('Customer/Orders/Index', '/orders?search=oak');
        await flushPromises();

        expect(document.activeElement).toBe(search);
    });

    it('moves focus when only the path changes within the same component', async () => {
        page.component = 'Customer/Projects/Show';
        page.url = '/projects/1';
        const wrapper = mountShell(
            'customer',
            '<main id="main"><h1>Project</h1></main>',
        );

        navigateTo('Customer/Projects/Show', '/projects/2');
        await flushPromises();

        expect(document.activeElement).toBe(wrapper.get('h1').element);
    });

    it('stops listening when the shell unmounts', () => {
        const wrapper = mountShell();

        wrapper.unmount();

        expect(navigate.stop).toHaveBeenCalledTimes(1);
    });
});
