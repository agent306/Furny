import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';

vi.mock('@inertiajs/vue3', async (importOriginal) => {
    const { page: testPage } = await import('@/test/inertiaPage');

    return {
        ...(await importOriginal<typeof import('@inertiajs/vue3')>()),
        usePage: () => testPage,
    };
});

import NotificationBell from '@/components/app/NotificationBell.vue';
import { page, resetPage } from '@/test/inertiaPage';

beforeEach(() => resetPage({ unreadNotifications: 0 }));
afterEach(() => {
    document.body.innerHTML = '';
});

function bell(count: number | undefined) {
    page.props = count === undefined ? {} : { unreadNotifications: count };

    return mount(NotificationBell, { attachTo: document.body });
}

describe('NotificationBell (15 §9.17, 12 §8.4)', () => {
    it('caps the visible count at 99+ and keeps the real count in the aria-label', () => {
        const wrapper = bell(150);
        const trigger = wrapper.get('[data-test="notification-bell"]');

        expect(wrapper.get('[data-test="notification-count"]').text()).toBe(
            '99+',
        );
        expect(trigger.attributes('aria-label')).toContain('150');
        expect(trigger.attributes('aria-label')).toBe(
            'Notifications, 150 unread',
        );
    });

    it.each([
        [1, '1'],
        [99, '99'],
        [100, '99+'],
    ])('shows %i as %s', (count, text) => {
        expect(bell(count).get('[data-test="notification-count"]').text()).toBe(
            text,
        );
    });

    it('shows no badge and a plain label without unread notifications', () => {
        const wrapper = bell(0);

        expect(wrapper.find('[data-test="notification-count"]').exists()).toBe(
            false,
        );
        expect(
            wrapper
                .get('[data-test="notification-bell"]')
                .attributes('aria-label'),
        ).toBe('Notifications');
    });

    it('treats a missing prop (guest, partial page) as zero', () => {
        const wrapper = bell(undefined);

        expect(wrapper.find('[data-test="notification-count"]').exists()).toBe(
            false,
        );
    });

    it('follows the shared prop when it changes', async () => {
        const wrapper = bell(2);

        page.props = { unreadNotifications: 7 };
        await nextTick();

        expect(wrapper.get('[data-test="notification-count"]').text()).toBe(
            '7',
        );
    });

    it('keeps the badge out of the accessibility tree, the label carries the count', () => {
        expect(
            bell(5)
                .get('[data-test="notification-count"]')
                .attributes('aria-hidden'),
        ).toBe('true');
    });

    it('opens a dropdown with the empty state', async () => {
        const wrapper = bell(0);

        await wrapper
            .get('[data-test="notification-bell"]')
            .trigger('keydown', { key: 'Enter' });
        await flushPromises();
        await new Promise((resolve) => setTimeout(resolve, 30));

        expect(
            document.body
                .querySelector('[data-test="notifications-empty"]')
                ?.textContent?.trim(),
        ).toBe("You're all caught up.");
    });
});
