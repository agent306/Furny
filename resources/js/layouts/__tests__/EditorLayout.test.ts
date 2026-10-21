import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import { nextTick } from 'vue';

vi.mock('@inertiajs/vue3', async (importOriginal) => {
    const { page: testPage } = await import('@/test/inertiaPage');

    return {
        ...(await importOriginal<typeof import('@inertiajs/vue3')>()),
        usePage: () => testPage,
        router: { on: () => () => undefined, flushAll: vi.fn() },
    };
});

import { INSPECTOR_WIDTH_KEY } from '@/composables/useInspectorWidth';
import EditorLayout from '@/layouts/EditorLayout.vue';
import { resetPage } from '@/test/inertiaPage';
import {
    DESKTOP,
    PHONE,
    resetViewport,
    setViewport,
    TABLET,
} from '@/test/viewport';

enableAutoUnmount(afterEach);

const SLOTS = {
    toolrail: '<button data-test="tool">Tool</button>',
    canvas: '<div data-test="canvas-content">canvas</div>',
    inspector: '<div data-test="inspector-content">props</div>',
    'topbar-center': '<span data-test="mode-toggle">2D</span>',
    'topbar-end': '<button data-test="action">Save</button>',
    statusbar: '<span data-test="status">ready</span>',
};

function mountEditor(props: Record<string, unknown> = {}) {
    return mount(EditorLayout, {
        props: { title: 'Living room', backHref: '/plans', ...props },
        slots: SLOTS,
        attachTo: document.body,
    });
}

beforeEach(() => {
    resetViewport();
    resetPage({ app: { name: 'Furny', logoUrl: null } });
    localStorage.clear();
});

describe('EditorLayout (15 §7.3)', () => {
    it('hides #toolrail and #inspector on a 375 px phone, keeping back, title and the centre slot', () => {
        setViewport(PHONE);
        const wrapper = mountEditor();

        expect(wrapper.find('#toolrail').exists()).toBe(false);
        expect(wrapper.find('#inspector').exists()).toBe(false);
        expect(wrapper.find('[data-test="tool"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="inspector-content"]').exists()).toBe(
            false,
        );
        expect(wrapper.find('#topbar-end').exists()).toBe(false);
        expect(
            wrapper.find('#topbar [aria-label="Back"]').attributes('href'),
        ).toBe('/plans');
        expect(wrapper.get('h1').text()).toBe('Living room');
        expect(wrapper.find('[data-test="mode-toggle"]').exists()).toBe(true);
        expect(wrapper.find('[data-test="canvas-content"]').exists()).toBe(
            true,
        );
    });

    it('shows every region on desktop', () => {
        setViewport(DESKTOP);
        const wrapper = mountEditor();

        for (const id of [
            '#topbar',
            '#topbar-start',
            '#topbar-center',
            '#topbar-end',
            '#toolrail',
            '#canvas',
            '#inspector',
            '#statusbar',
        ]) {
            expect(wrapper.find(id).exists(), id).toBe(true);
        }

        expect(wrapper.get('#toolrail').classes()).toContain('w-12');
        expect(wrapper.get('#topbar').classes()).toContain('h-12');
        expect(wrapper.get('#statusbar').classes()).toContain('h-7');
        expect(wrapper.get('#statusbar').classes()).toContain('text-xs');
        expect(
            wrapper.find('#inspector [data-test="inspector-content"]').exists(),
        ).toBe(true);
        expect(wrapper.find('[data-test="action"]').exists()).toBe(true);
    });

    it('is a full-viewport shell without page scroll', () => {
        const wrapper = mountEditor();
        const shell = wrapper.get('#topbar').element.parentElement;

        expect(shell?.className).toContain('h-dvh');
        expect(shell?.className).toContain('overflow-hidden');
        expect(wrapper.findAll('main#main')).toHaveLength(1);
        expect(wrapper.get('[data-test="skip-link"]').attributes('href')).toBe(
            '#main',
        );
    });

    it('keeps the toolrail and drops the inspector aside on a tablet (it is a sheet there)', () => {
        setViewport(TABLET);
        const wrapper = mountEditor();

        expect(wrapper.find('#toolrail').exists()).toBe(true);
        expect(wrapper.find('aside#inspector').exists()).toBe(false);
        expect(wrapper.find('[data-test="inspector-content"]').exists()).toBe(
            false,
        );
    });

    it('opens the tablet inspector sheet through v-model:inspector-open', async () => {
        setViewport(TABLET);
        mountEditor({ inspectorOpen: true });
        await nextTick();
        await new Promise((resolve) => setTimeout(resolve, 20));

        expect(
            document.body.querySelector('[data-test="inspector-content"]'),
        ).not.toBeNull();
    });

    it('is not a persistent layout: the title is the one h1', () => {
        expect(mountEditor().findAll('h1')).toHaveLength(1);
    });

    it('shows a View only badge when read-only', () => {
        expect(mountEditor().find('[data-test="read-only"]').exists()).toBe(
            false,
        );
        expect(
            mountEditor({ readOnly: true })
                .get('[data-test="read-only"]')
                .text(),
        ).toBe('View only');
    });

    it('renders no save status without one, and the indicator with it', () => {
        expect(mountEditor().find('[data-status]').exists()).toBe(false);

        const wrapper = mountEditor({ saveStatus: 'dirty' });

        expect(wrapper.get('[data-status="dirty"]').text()).toBe(
            'Unsaved changes',
        );
    });

    it('emits save-status-click when the indicator is clicked, and counts problems', async () => {
        const wrapper = mountEditor({
            saveStatus: 'invalid',
            saveStatusCount: 2,
        });
        const indicator = wrapper.get('[data-status="invalid"]');

        expect(indicator.text()).toBe('Fix 2 problems to save');

        await indicator.trigger('click');

        expect(wrapper.emitted('save-status-click')).toHaveLength(1);
    });

    it('puts the topbar-start slot beside the title', () => {
        const wrapper = mount(EditorLayout, {
            props: { title: 'T', backHref: '/x' },
            slots: { 'topbar-start': '<span data-test="extra">x</span>' },
        });

        expect(wrapper.find('#topbar-start [data-test="extra"]').exists()).toBe(
            true,
        );
    });

    it('shows the banner region only when it has content', () => {
        expect(mountEditor().find('#banner').exists()).toBe(false);

        const wrapper = mount(EditorLayout, {
            props: { title: 'T', backHref: '/x' },
            slots: { banner: '<p>Proposal mode</p>' },
        });

        expect(wrapper.get('#banner').text()).toBe('Proposal mode');
    });
});

describe('EditorLayout inspector width (15 §7.3)', () => {
    beforeEach(() => setViewport(DESKTOP));

    it('starts at 320 px and is a keyboard-operable separator between 280 and 420', () => {
        const wrapper = mountEditor();
        const handle = wrapper.get('[data-test="inspector-handle"]');

        expect(wrapper.get('#inspector').attributes('style')).toContain(
            'width: 320px',
        );
        expect(handle.attributes('role')).toBe('separator');
        expect(handle.attributes('tabindex')).toBe('0');
        expect(handle.attributes('aria-valuemin')).toBe('280');
        expect(handle.attributes('aria-valuemax')).toBe('420');
        expect(handle.attributes('aria-valuenow')).toBe('320');
    });

    it('resizes with the arrow keys, clamps, and remembers the width', async () => {
        const wrapper = mountEditor();
        const handle = wrapper.get('[data-test="inspector-handle"]');

        await handle.trigger('keydown', { key: 'ArrowLeft' });
        expect(wrapper.get('#inspector').attributes('style')).toContain(
            'width: 336px',
        );
        expect(localStorage.getItem(INSPECTOR_WIDTH_KEY)).toBe('336');

        for (let i = 0; i < 10; i++) {
            await handle.trigger('keydown', {
                key: 'ArrowLeft',
                shiftKey: true,
            });
        }

        expect(wrapper.get('#inspector').attributes('style')).toContain(
            'width: 420px',
        );

        for (let i = 0; i < 10; i++) {
            await handle.trigger('keydown', {
                key: 'ArrowRight',
                shiftKey: true,
            });
        }

        expect(wrapper.get('#inspector').attributes('style')).toContain(
            'width: 280px',
        );
    });

    it('restores the remembered width', () => {
        localStorage.setItem(INSPECTOR_WIDTH_KEY, '380');

        expect(mountEditor().get('#inspector').attributes('style')).toContain(
            'width: 380px',
        );
    });

    it('survives blocked storage', () => {
        const get = vi
            .spyOn(Storage.prototype, 'getItem')
            .mockImplementation(() => {
                throw new Error('blocked');
            });
        const set = vi
            .spyOn(Storage.prototype, 'setItem')
            .mockImplementation(() => {
                throw new Error('blocked');
            });

        const wrapper = mountEditor();

        expect(wrapper.get('#inspector').attributes('style')).toContain(
            'width: 320px',
        );

        wrapper
            .get('[data-test="inspector-handle"]')
            .trigger('keydown', { key: 'ArrowLeft' });

        get.mockRestore();
        set.mockRestore();
    });
});
