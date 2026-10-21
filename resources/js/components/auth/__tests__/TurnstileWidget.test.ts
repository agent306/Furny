import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TurnstileOptions } from '@/lib/turnstile';

vi.mock('@inertiajs/vue3', async (importOriginal) => {
    const { page: testPage } = await import('@/test/inertiaPage');

    return {
        ...(await importOriginal<typeof import('@inertiajs/vue3')>()),
        usePage: () => testPage,
    };
});

const turnstile = vi.hoisted(() => ({
    render: vi.fn<(container: HTMLElement, options: unknown) => string>(),
    reset: vi.fn<(id: string) => void>(),
    remove: vi.fn<(id: string) => void>(),
}));
const loadTurnstile = vi.hoisted(() => vi.fn());

vi.mock('@/lib/turnstile', () => ({ loadTurnstile }));

import TurnstileWidget from '@/components/auth/TurnstileWidget.vue';
import { resetPage } from '@/test/inertiaPage';

function options(): TurnstileOptions {
    return turnstile.render.mock.calls[0]?.[1] as TurnstileOptions;
}

function widget(siteKey: string | null = 'site-key') {
    return mount(TurnstileWidget, {
        props: { siteKey, action: 'register' },
        attachTo: document.body,
    });
}

beforeEach(() => {
    turnstile.render.mockReset().mockReturnValue('widget-1');
    turnstile.reset.mockReset();
    turnstile.remove.mockReset();
    loadTurnstile.mockReset().mockResolvedValue(turnstile);
    window.turnstile = turnstile;
    resetPage({ features: { captcha: true } });
});

afterEach(() => {
    delete window.turnstile;
});

describe('TurnstileWidget (13 §3)', () => {
    it('renders nothing and loads nothing from Cloudflare while features.captcha is off', async () => {
        resetPage({ features: { captcha: false } });

        const wrapper = widget();
        await flushPromises();

        expect(wrapper.html()).toBe('<!--v-if-->');
        expect(loadTurnstile).not.toHaveBeenCalled();
        expect(turnstile.render).not.toHaveBeenCalled();
    });

    it.each([
        ['no site key', null],
        ['an empty site key', ''],
    ])('renders nothing with %s', async (_name, siteKey) => {
        const wrapper = widget(siteKey);
        await flushPromises();

        expect(wrapper.find('[data-test="turnstile"]').exists()).toBe(false);
        expect(loadTurnstile).not.toHaveBeenCalled();
    });

    it('renders the widget for the form it protects, with the hidden field the server reads', async () => {
        const wrapper = widget();
        await flushPromises();

        const input = wrapper.get('input[type="hidden"]');

        expect(input.attributes('name')).toBe('cf_turnstile_response');
        expect((input.element as HTMLInputElement).value).toBe('');
        expect(turnstile.render).toHaveBeenCalledTimes(1);
        expect(turnstile.render.mock.calls[0]?.[0]).toBeInstanceOf(
            HTMLDivElement,
        );
        expect(options()).toMatchObject({
            sitekey: 'site-key',
            action: 'register',
        });
    });

    it('puts the token in the hidden field and tells the parent, and clears it when it expires', async () => {
        const wrapper = widget();
        await flushPromises();

        options().callback('token-123');
        await wrapper.vm.$nextTick();

        expect(
            (wrapper.get('input[type="hidden"]').element as HTMLInputElement)
                .value,
        ).toBe('token-123');
        expect(wrapper.emitted('token')).toEqual([['token-123']]);

        options()['expired-callback']?.();
        await wrapper.vm.$nextTick();

        expect(
            (wrapper.get('input[type="hidden"]').element as HTMLInputElement)
                .value,
        ).toBe('');
        expect(wrapper.emitted('token')).toHaveLength(1);
    });

    it('asks for a new token on reset, because a token works once', async () => {
        const wrapper = widget();
        await flushPromises();
        options().callback('token-123');

        (wrapper.vm as unknown as { reset: () => void }).reset();
        await wrapper.vm.$nextTick();

        expect(turnstile.reset).toHaveBeenCalledWith('widget-1');
        expect(
            (wrapper.get('input[type="hidden"]').element as HTMLInputElement)
                .value,
        ).toBe('');
    });

    it('removes the widget when it goes away', async () => {
        const wrapper = widget();
        await flushPromises();

        wrapper.unmount();

        expect(turnstile.remove).toHaveBeenCalledWith('widget-1');
    });

    it('leaves the field empty, without an error, when the script cannot be loaded', async () => {
        loadTurnstile.mockReset().mockRejectedValue(new Error('blocked'));

        const wrapper = widget();
        await flushPromises();

        expect(
            (wrapper.get('input[type="hidden"]').element as HTMLInputElement)
                .value,
        ).toBe('');
        expect(turnstile.render).not.toHaveBeenCalled();

        wrapper.unmount();
        expect(turnstile.remove).not.toHaveBeenCalled();
    });
});
