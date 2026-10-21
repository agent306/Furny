import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';

const toast = vi.hoisted(() => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
}));
const events = vi.hoisted(() => ({
    handlers: {} as Record<string, (event: unknown) => void>,
    stop: vi.fn(),
}));

vi.mock('vue-sonner', async (importOriginal) => ({
    ...(await importOriginal<typeof import('vue-sonner')>()),
    toast,
}));
vi.mock('@inertiajs/vue3', async (importOriginal) => {
    const { page: testPage } = await import('@/test/inertiaPage');

    return {
        ...(await importOriginal<typeof import('@inertiajs/vue3')>()),
        usePage: () => testPage,
        router: {
            on: (event: string, handler: (event: unknown) => void) => {
                events.handlers[event] = handler;

                return events.stop;
            },
            flushAll: vi.fn(),
        },
    };
});

import { resetRouteFocus } from '@/composables/useRouteFocus';
import AuthLayout from '@/layouts/AuthLayout.vue';
import CustomerLayout from '@/layouts/CustomerLayout.vue';
import { page, resetPage } from '@/test/inertiaPage';

enableAutoUnmount(afterEach);

beforeEach(() => {
    events.handlers = {};
    events.stop.mockClear();
    resetRouteFocus();
    for (const fn of Object.values(toast)) {
        fn.mockClear();
    }
    resetPage({
        app: { name: 'Furny', logoUrl: null },
        auth: { user: { type: 'customer', name: 'Asha Rao' } },
        business: { name: 'Acme' },
    });
});

// An Inertia visit that swaps the layout (login -> dashboard): the response
// carries a flash, the old shell unmounts, a new one mounts, and Inertia then
// announces the flash with its `flash` event.
describe('flash on a visit that swaps the layout', () => {
    it('shows exactly one toast: the new shell reads it on mount and the event repeats it', async () => {
        page.component = 'Auth/Login';
        page.url = '/login';
        const login = mount(AuthLayout, { slots: { default: '<p>form</p>' } });

        login.unmount();

        const flash = { success: 'Welcome back.' };

        page.component = 'Customer/Dashboard';
        page.url = '/dashboard';
        page.flash = flash;
        mount(CustomerLayout, { slots: { default: '<p>home</p>' } });
        await nextTick();

        // Only the mounted shell listens; the unmounted one removed its listeners.
        events.handlers.flash?.({ detail: { flash: page.flash } });

        expect(toast.success).toHaveBeenCalledTimes(1);
        expect(toast.success).toHaveBeenCalledWith('Welcome back.', {
            duration: 4000,
        });
        expect(events.stop).toHaveBeenCalled();
    });

    it('shows exactly one toast when the event arrives before the new shell reads the page', async () => {
        const flash = { error: 'Not allowed.' };

        page.flash = flash;
        mount(AuthLayout, { slots: { default: '<p>form</p>' } });
        events.handlers.flash?.({ detail: { flash } });
        await nextTick();

        expect(toast.error).toHaveBeenCalledTimes(1);
    });

    it('does not show a flash from the previous page on the next one', async () => {
        page.flash = { success: 'First.' };
        const first = mount(CustomerLayout, { slots: { default: '<p>a</p>' } });

        await nextTick();
        first.unmount();

        // The next response has no flash (the history keeps none, the server sent none).
        page.flash = {};
        mount(AuthLayout, { slots: { default: '<p>b</p>' } });
        await nextTick();

        expect(toast.success).toHaveBeenCalledTimes(1);
    });
});
