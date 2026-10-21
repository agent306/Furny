import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { readdirSync, readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import { h, nextTick, Teleport } from 'vue';

vi.mock('@inertiajs/vue3', async (importOriginal) => {
    const { page: testPage } = await import('@/test/inertiaPage');

    return {
        ...(await importOriginal<typeof import('@inertiajs/vue3')>()),
        usePage: () => testPage,
        router: { on: () => () => undefined, flushAll: vi.fn() },
    };
});

import AppShell from '@/components/app/AppShell.vue';
import ConfirmHost from '@/components/common/ConfirmHost.vue';
import { focusMainHeading } from '@/composables/useRouteFocus';
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

// What Inertia renders for an editor page: the layout around the page component.
// A functional component: the page needs no state of its own here.
const Page = () => [
    h('p', { 'data-test': 'page' }, 'plan editor'),
    h(
        Teleport,
        { to: '#toolrail', defer: true },
        h('button', { 'data-test': 'tool' }, 'wall'),
    ),
    h(
        Teleport,
        { to: '#inspector', defer: true },
        h('p', { 'data-test': 'props' }, 'properties'),
    ),
    h(
        Teleport,
        { to: '#topbar-end', defer: true },
        h('button', { 'data-test': 'action' }, 'Done'),
    ),
];

function editorPage(layoutProps: Record<string, unknown> = {}) {
    return mount(EditorLayout, {
        props: { title: 'Living room', backHref: '/plans', ...layoutProps },
        slots: { default: () => h(Page) },
        attachTo: document.body,
    });
}

beforeEach(() => {
    resetViewport();
    resetPage({ app: { name: 'Furny', logoUrl: null } });
    localStorage.clear();
});

describe('EditorLayout (15 §7.3)', () => {
    it('hides #toolrail, #inspector and the top-bar actions on a 375 px phone, keeping back, title and the centre slot', () => {
        setViewport(PHONE);
        const wrapper = mountEditor();

        // The regions stay in the DOM (Teleport targets); they are hidden.
        for (const id of ['#toolrail', '#inspector', '#topbar-end']) {
            expect(wrapper.find(id).exists(), id).toBe(true);
            expect(wrapper.get(id).isVisible(), id).toBe(false);
        }

        expect(wrapper.get('[data-test="tool"]').isVisible()).toBe(false);
        expect(wrapper.get('[data-test="inspector-content"]').isVisible()).toBe(
            false,
        );
        expect(wrapper.get('[data-test="action"]').isVisible()).toBe(false);
        expect(wrapper.find('[data-test="inspector-handle"]').exists()).toBe(
            false,
        );
        expect(
            wrapper.find('#topbar [aria-label="Back"]').attributes('href'),
        ).toBe('/plans');
        expect(wrapper.get('h1').text()).toBe('Living room');
        expect(wrapper.get('[data-test="mode-toggle"]').isVisible()).toBe(true);
        expect(wrapper.get('[data-test="canvas-content"]').isVisible()).toBe(
            true,
        );
        expect(wrapper.get('[data-test="skip-link"]').attributes('href')).toBe(
            '#main',
        );
    });

    it('keeps the toolrail visible and the inspector closed on a tablet until it is opened', async () => {
        setViewport(TABLET);
        const wrapper = mountEditor();

        expect(wrapper.get('#toolrail').isVisible()).toBe(true);
        expect(wrapper.get('#inspector').isVisible()).toBe(false);
        expect(wrapper.find('[data-test="inspector-handle"]').exists()).toBe(
            false,
        );

        await wrapper.setProps({ inspectorOpen: true });

        expect(wrapper.get('#inspector').isVisible()).toBe(true);
        expect(wrapper.get('#inspector').classes()).toEqual(
            expect.arrayContaining(['absolute', 'right-0', 'w-80', 'z-20']),
        );
        expect(wrapper.get('[data-test="inspector-content"]').isVisible()).toBe(
            true,
        );
    });

    it('closes the tablet inspector with its button or Escape, through update:inspectorOpen', async () => {
        setViewport(TABLET);
        const wrapper = mountEditor({ inspectorOpen: true });

        await wrapper.get('[data-test="inspector-close"]').trigger('click');

        expect(wrapper.emitted('update:inspectorOpen')).toEqual([[false]]);

        const escaped = mountEditor({ inspectorOpen: true });

        await escaped.get('#inspector').trigger('keydown', { key: 'Escape' });

        expect(escaped.emitted('update:inspectorOpen')).toEqual([[false]]);
        expect(
            wrapper.get('[data-test="inspector-close"]').classes(),
        ).toContain('size-11');
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

    it("renders the title as the page's one h1 (the layout has no other heading)", () => {
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

describe('EditorLayout is a persistent layout (15 §7)', () => {
    beforeEach(() => setViewport(DESKTOP));

    // What Inertia renders for an editor page: the layout around the page component.
    it('mounts exactly one AppShell, ConfirmHost and Toaster around an editor page', () => {
        const wrapper = editorPage();

        expect(wrapper.findAllComponents(AppShell)).toHaveLength(1);
        expect(wrapper.findAllComponents(ConfirmHost)).toHaveLength(1);
        expect(wrapper.findAll('[data-test="skip-link"]')).toHaveLength(1);
        expect(wrapper.findAll('main#main')).toHaveLength(1);
    });

    it('renders the page into #canvas and lets it fill the other regions with a deferred Teleport', async () => {
        const wrapper = editorPage();

        await flushPromises();

        expect(wrapper.get('#canvas [data-test="page"]').text()).toBe(
            'plan editor',
        );
        expect(wrapper.get('#toolrail [data-test="tool"]').text()).toBe('wall');
        expect(wrapper.get('#inspector [data-test="props"]').text()).toBe(
            'properties',
        );
        expect(wrapper.get('#topbar-end [data-test="action"]').text()).toBe(
            'Done',
        );
    });

    it('takes its props and handlers from the layout props, as a page sets them', async () => {
        const onSaveStatusClick = vi.fn();
        const wrapper = editorPage({
            saveStatus: 'invalid',
            saveStatusCount: 2,
            readOnly: true,
            onSaveStatusClick,
        });

        await wrapper.get('[data-status="invalid"]').trigger('click');

        expect(onSaveStatusClick).toHaveBeenCalledTimes(1);
        expect(wrapper.find('[data-test="read-only"]').exists()).toBe(true);
    });

    it('no page wraps itself in the layout (source guard)', () => {
        const pages = (
            readdirSync('resources/js/pages', { recursive: true }) as string[]
        ).filter((file) => file.endsWith('.vue'));

        expect(pages.length).toBeGreaterThan(5);

        for (const file of pages) {
            expect(
                readFileSync(`resources/js/pages/${file}`, 'utf8'),
                file,
            ).not.toContain('EditorLayout');
        }
    });

    it('moves route focus to the title h1 in the top bar', () => {
        const wrapper = editorPage();

        expect(focusMainHeading()).toBe(true);
        expect(document.activeElement).toBe(wrapper.get('h1').element);
        expect(wrapper.get('h1').attributes('tabindex')).toBe('-1');
    });
});

describe('EditorLayout save status and offline banner', () => {
    it('keeps the save status in a polite live region even as a button', async () => {
        const wrapper = mountEditor({
            saveStatus: 'invalid',
            saveStatusCount: 2,
        });
        const region = wrapper.get('#topbar [aria-live="polite"]');

        expect(region.attributes('role')).toBe('status');
        expect(region.get('button[data-status="invalid"]').text()).toBe(
            'Fix 2 problems to save',
        );

        await wrapper.setProps({ saveStatus: 'saving' });

        expect(wrapper.get('#topbar [aria-live="polite"]').text()).toBe(
            'Saving…',
        );
    });

    it('shows the offline banner once, inside the full-viewport box, never above it', async () => {
        const online = vi
            .spyOn(navigator, 'onLine', 'get')
            .mockReturnValue(false);
        const wrapper = mountEditor();

        window.dispatchEvent(new Event('offline'));
        await nextTick();

        const banners = wrapper.findAll('[data-test="offline-banner"]');
        const box = wrapper.get('#topbar').element.parentElement;

        expect(banners).toHaveLength(1);
        expect(box?.className).toContain('h-dvh');
        expect(box?.contains(banners[0]?.element ?? null)).toBe(true);
        expect(banners[0]?.classes()).toContain('shrink-0');
        online.mockRestore();
    });
});

describe('EditorLayout Teleport targets exist at every breakpoint', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    beforeEach(() => warn.mockClear());

    it.each([
        ['phone', PHONE],
        ['tablet', TABLET],
        ['desktop', DESKTOP],
    ])(
        'renders the page into every region on a %s without Vue warnings',
        async (_name, width) => {
            setViewport(width);
            const wrapper = editorPage();

            await flushPromises();

            expect(wrapper.get('#toolrail [data-test="tool"]').text()).toBe(
                'wall',
            );
            expect(wrapper.get('#inspector [data-test="props"]').text()).toBe(
                'properties',
            );
            expect(wrapper.get('#topbar-end [data-test="action"]').text()).toBe(
                'Done',
            );
            expect(
                warn.mock.calls.filter((call) =>
                    String(call[0]).includes('Teleport'),
                ),
            ).toEqual([]);
        },
    );

    it('delivers the inspector content on a tablet even though the panel starts closed, and shows it once opened', async () => {
        setViewport(TABLET);
        const wrapper = editorPage();

        await flushPromises();

        const content = wrapper.get('#inspector [data-test="props"]');

        expect(content.isVisible()).toBe(false);

        await wrapper.setProps({ inspectorOpen: true });

        expect(wrapper.get('#inspector [data-test="props"]').element).toBe(
            content.element,
        );
        expect(content.isVisible()).toBe(true);
    });

    it('keeps the content on the same element when the viewport changes breakpoint', async () => {
        setViewport(DESKTOP);
        const wrapper = editorPage();

        await flushPromises();

        const inspector = wrapper.get('#inspector').element;

        setViewport(TABLET);
        window.dispatchEvent(new Event('resize'));
        await flushPromises();

        expect(wrapper.get('#inspector').element).toBe(inspector);
        expect(wrapper.find('#inspector [data-test="props"]').exists()).toBe(
            true,
        );
    });
});

describe('EditorLayout tablet inspector focus (15 §14 items 2-3)', () => {
    beforeEach(() => setViewport(TABLET));

    const toggle = (wrapper: ReturnType<typeof mountEditor>) =>
        wrapper.get('[data-test="action"]').element as HTMLElement;
    const escape = (target: Element, init: KeyboardEventInit = {}) =>
        target.dispatchEvent(
            new KeyboardEvent('keydown', {
                key: 'Escape',
                bubbles: true,
                cancelable: true,
                ...init,
            }),
        );

    it('moves focus into the panel, onto the close button, when it opens', async () => {
        const wrapper = mountEditor();

        toggle(wrapper).focus();
        await wrapper.setProps({ inspectorOpen: true });
        await flushPromises();

        expect(document.activeElement).toBe(
            wrapper.get('[data-test="inspector-close"]').element,
        );
    });

    it('closes on Escape while the focus is still on the toggle, and keeps the focus there', async () => {
        const wrapper = mountEditor();

        toggle(wrapper).focus();
        await wrapper.setProps({ inspectorOpen: true });
        await flushPromises();

        // The user moves back to the toggle (the panel is non-modal) and presses Escape.
        toggle(wrapper).focus();
        escape(toggle(wrapper));
        await flushPromises();

        expect(wrapper.emitted('update:inspectorOpen')).toEqual([[false]]);
        expect(wrapper.get('#inspector').isVisible()).toBe(false);
        expect(document.activeElement).toBe(toggle(wrapper));
    });

    it('returns the focus to what had it before the panel opened, on Escape inside and on the close button', async () => {
        const wrapper = mountEditor();

        toggle(wrapper).focus();
        await wrapper.setProps({ inspectorOpen: true });
        await flushPromises();

        escape(document.activeElement ?? document.body);
        await flushPromises();

        expect(document.activeElement).toBe(toggle(wrapper));

        await wrapper.setProps({ inspectorOpen: true });
        await flushPromises();
        await wrapper.get('[data-test="inspector-close"]').trigger('click');
        await flushPromises();

        expect(document.activeElement).toBe(toggle(wrapper));
    });

    it('leaves the panel open when an inner popover handled Escape (defaultPrevented)', async () => {
        const wrapper = mountEditor();

        toggle(wrapper).focus();
        await wrapper.setProps({ inspectorOpen: true });
        await flushPromises();

        const popover = document.createElement('div');

        popover.addEventListener('keydown', (event) => event.preventDefault());
        document.body.append(popover);
        escape(popover);
        await flushPromises();

        expect(wrapper.emitted('update:inspectorOpen')).toBeUndefined();
        expect(wrapper.get('#inspector').isVisible()).toBe(true);

        popover.remove();
    });

    it('listens to Escape only while the tablet panel is open', async () => {
        const wrapper = mountEditor();

        escape(document.body);
        await flushPromises();

        expect(wrapper.emitted('update:inspectorOpen')).toBeUndefined();

        await wrapper.setProps({ inspectorOpen: true });
        wrapper.unmount();
        escape(document.body);

        expect(wrapper.emitted('update:inspectorOpen')).toBeUndefined();
    });

    it('does nothing for the focus on desktop, where the inspector is always there', async () => {
        setViewport(DESKTOP);
        const wrapper = mountEditor({ inspectorOpen: true });

        toggle(wrapper).focus();
        escape(toggle(wrapper));
        await flushPromises();

        expect(wrapper.emitted('update:inspectorOpen')).toBeUndefined();
        expect(wrapper.get('#inspector').isVisible()).toBe(true);
    });
});
