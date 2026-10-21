import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';

vi.mock('@inertiajs/vue3', async (importOriginal) => {
    const { page: testPage } = await import('@/test/inertiaPage');

    return {
        ...(await importOriginal<typeof import('@inertiajs/vue3')>()),
        usePage: () => testPage,
    };
});

import ThemeToggle from '@/components/app/ThemeToggle.vue';
import { TooltipProvider } from '@/components/ui/tooltip';
import UserMenu from '@/components/app/UserMenu.vue';
import { page, resetPage } from '@/test/inertiaPage';

enableAutoUnmount(afterEach);

// AppShell provides the tooltip context the toggle's tooltip needs.
function mountToggle() {
    return mount(
        defineComponent({
            render: () => h(TooltipProvider, null, () => h(ThemeToggle)),
        }),
        { attachTo: document.body },
    );
}

async function open(trigger: {
    trigger: (event: string, options?: object) => Promise<void>;
}): Promise<void> {
    await trigger.trigger('keydown', { key: 'Enter' });
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, 30));
}

beforeEach(() => {
    resetPage({
        app: { name: 'Furny', logoUrl: null },
        auth: {
            user: {
                type: 'customer',
                name: 'Asha Rao',
                email: 'asha@example.test',
                avatarUrl: null,
            },
        },
    });
    localStorage.clear();
    document.cookie = 'appearance=; max-age=0; path=/';
    document.documentElement.classList.remove('dark');
});

describe('UserMenu (15 §9.31)', () => {
    it('is an avatar button named Account menu, 44 px below desktop', () => {
        const trigger = mount(UserMenu, { attachTo: document.body }).get(
            '[data-test="user-menu"]',
        );

        expect(trigger.attributes('aria-label')).toBe('Account menu');
        expect(trigger.classes()).toContain('size-11');
        expect(trigger.get('[role="img"]').attributes('aria-label')).toBe(
            'Asha Rao',
        );
    });

    it('renders nothing for a guest', () => {
        page.props.auth = { user: null };

        expect(mount(UserMenu).find('[data-test="user-menu"]').exists()).toBe(
            false,
        );
    });

    it('shows who is signed in, a theme submenu and a log out button that posts', async () => {
        const wrapper = mount(UserMenu, { attachTo: document.body });

        await open(wrapper.get('[data-test="user-menu"]'));

        const content = document.body.querySelector(
            '[data-slot="dropdown-menu-content"]',
        );

        expect(content?.textContent).toContain('Asha Rao');
        expect(content?.textContent).toContain('asha@example.test');
        expect(
            content?.querySelector('[data-test="theme-submenu"]')?.textContent,
        ).toContain('Theme');

        const logout = content?.querySelector('[data-test="logout-button"]');

        expect(logout?.tagName).toBe('BUTTON');
        expect(logout?.textContent?.trim()).toBe('Log out');
    });
});

describe('ThemeToggle (15 §9.31, §11)', () => {
    it('lists Light, Dark and System with the current one selected', async () => {
        const wrapper = mountToggle();

        await open(wrapper.get('[data-test="theme-toggle"]'));

        const items = [
            ...document.body.querySelectorAll('[role="menuitemradio"]'),
        ];

        expect(items.map((item) => item.textContent?.trim())).toEqual([
            'Light',
            'Dark',
            'System',
        ]);
        expect(
            items
                .find((item) => item.getAttribute('aria-checked') === 'true')
                ?.textContent?.trim(),
        ).toBe('System');
    });

    it('applies the chosen appearance and remembers it', async () => {
        const wrapper = mountToggle();

        await open(wrapper.get('[data-test="theme-toggle"]'));
        document.body
            .querySelector<HTMLElement>('[data-test="theme-dark"]')
            ?.click();
        await flushPromises();

        expect(document.documentElement.classList.contains('dark')).toBe(true);
        expect(localStorage.getItem('fs:appearance')).toBe('dark');
        expect(document.cookie).toContain('appearance=dark');
    });

    it('names the button and is 44 px below desktop', () => {
        const trigger = mountToggle().get('[data-test="theme-toggle"]');

        expect(trigger.attributes('aria-label')).toBe('Theme');
        expect(trigger.classes()).toContain('max-lg:size-11');
    });
});
