import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const post = vi.hoisted(() => vi.fn());
const reload = vi.hoisted(() => vi.fn());

vi.mock('@inertiajs/vue3', async (importOriginal) => {
    const { page: testPage } = await import('@/test/inertiaPage');
    const { defineComponent: define } = await import('vue');

    return {
        ...(await importOriginal<typeof import('@inertiajs/vue3')>()),
        usePage: () => testPage,
        router: { post, reload },
        Head: define({
            name: 'Head',
            props: { title: String },
            render: () => null,
        }),
    };
});

import PhoneVerify from '@/pages/Auth/PhoneVerify.vue';
import { page, resetPage } from '@/test/inertiaPage';
import type { FeatureFlags } from '@/types/inertia';

enableAutoUnmount(afterEach);

const features: FeatureFlags = {
    payments: false,
    whatsapp: true,
    sms: true,
    web_push: true,
    google_login: true,
    dxf_import: true,
    walkthrough_camera: true,
    captcha: false,
};

function verifyPage(props: Record<string, unknown> = {}) {
    return mount(PhoneVerify, {
        props: {
            channel: 'sms',
            maskedPhone: '+91******3210',
            resendAvailableIn: 60,
            channels: ['sms'],
            features,
            turnstileSiteKey: null,
            ...props,
        },
        attachTo: document.body,
    });
}

beforeEach(() => {
    vi.useFakeTimers();
    post.mockReset();
    reload.mockReset();
    // A page whose code went by WhatsApp polls; unless a test says otherwise, nothing has changed.
    vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
            ok: true,
            json: () =>
                Promise.resolve({ channel: 'whatsapp', fallbackSent: false }),
        }),
    );
    resetPage({ auth: { user: null }, features, errors: {} });
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe('PhoneVerify (10 §4.4, 13 §4.4)', () => {
    it('has one h1, sets the title and tells the channel and the masked number', () => {
        const wrapper = verifyPage({ channel: 'whatsapp' });

        expect(wrapper.findAll('h1')).toHaveLength(1);
        expect(wrapper.get('h1').text()).toBe('Enter your code');
        expect(wrapper.get('[data-test="otp-sent"]').text()).toBe(
            'We sent a code to +91******3210 via WhatsApp.',
        );
        expect(
            verifyPage({ channel: 'sms' }).get('[data-test="otp-sent"]').text(),
        ).toBe('We sent a code to +91******3210 via SMS.');
    });

    it('has one code field for the phone to fill in', () => {
        const input = verifyPage().get('input[name="code"]');

        expect(input.attributes('inputmode')).toBe('numeric');
        expect(input.attributes('autocomplete')).toBe('one-time-code');
        expect(input.attributes('pattern')).toBe('[0-9]*');
        expect(input.attributes('maxlength')).toBe('6');
        expect(input.attributes('aria-required')).toBe('true');
    });

    it('submits by itself when the sixth digit is entered', async () => {
        const wrapper = verifyPage();

        await wrapper.get('input[name="code"]').setValue('12345');
        expect(post).not.toHaveBeenCalled();

        await wrapper.get('input[name="code"]').setValue('123456');

        expect(post).toHaveBeenCalledTimes(1);
        expect(post).toHaveBeenCalledWith(
            '/auth/otp/verify',
            { code: '123456' },
            expect.objectContaining({ preserveScroll: true }),
        );
    });

    it('does not submit twice while the first is on its way', async () => {
        const wrapper = verifyPage();
        post.mockImplementation((_url, _data, options) => options.onStart());

        await wrapper.get('input[name="code"]').setValue('123456');
        await wrapper.get('form').trigger('submit');

        expect(post).toHaveBeenCalledTimes(1);
    });

    it('submits a code entered by hand with the button too', async () => {
        const wrapper = verifyPage();
        const button = wrapper.get('[data-test="verify-button"]');

        expect(button.attributes('disabled')).toBeDefined();

        await wrapper.get('input[name="code"]').setValue('123456');
        post.mockClear();
        await wrapper.get('form').trigger('submit');

        expect(post).toHaveBeenCalledWith(
            '/auth/otp/verify',
            { code: '123456' },
            expect.anything(),
        );
    });

    it('clears a wrong code and shows the message of the server under the field, with focus on it', async () => {
        const wrapper = verifyPage();
        // The answer arrives after the code was rendered, as a response does.
        post.mockImplementation((_url, _data, options) =>
            queueMicrotask(() => {
                page.props.errors = {
                    code: "That code isn't right. 4 attempts left.",
                    reason: 'otp_invalid',
                    attemptsLeft: '4',
                };
                options.onError({});
            }),
        );

        await wrapper.get('input[name="code"]').setValue('123456');
        await flushPromises();

        const input = wrapper.get('input[name="code"]');
        expect((input.element as HTMLInputElement).value).toBe('');
        expect(input.attributes('aria-invalid')).toBe('true');
        expect(input.attributes('aria-describedby')).toBe('code-error');
        expect(wrapper.get('#code-error').text()).toBe(
            "That code isn't right. 4 attempts left.",
        );
        expect(document.activeElement).toBe(input.element);
    });

    it('does not take the machine code of a refused resend for a message about the code', () => {
        page.props.errors = {
            phone: 'Please wait a moment before asking for another code.',
            code: 'otp_cooldown',
            retryAfter: '30',
        };
        const wrapper = verifyPage();

        expect(wrapper.find('#code-error').exists()).toBe(false);
        expect(wrapper.get('#resend-error').text()).toBe(
            'Please wait a moment before asking for another code.',
        );
    });

    it('disables both resend buttons during the 60 second wait and enables them after', async () => {
        const wrapper = verifyPage({
            channel: 'whatsapp',
            channels: ['whatsapp', 'sms'],
        });
        const whatsapp = wrapper.get('[data-test="resend-whatsapp"]');
        const sms = wrapper.get('[data-test="resend-sms"]');

        expect(whatsapp.text()).toBe('Resend on WhatsApp');
        expect(sms.text()).toBe('Send by SMS');
        expect(whatsapp.attributes('disabled')).toBeDefined();
        expect(sms.attributes('disabled')).toBeDefined();
        expect(wrapper.get('[data-test="resend-wait"]').text()).toBe(
            'You can ask for a new code in 60 seconds.',
        );

        await vi.advanceTimersByTimeAsync(30_000);
        expect(wrapper.get('[data-test="resend-wait"]').text()).toBe(
            'You can ask for a new code in 30 seconds.',
        );
        expect(
            wrapper.get('[data-test="resend-sms"]').attributes('disabled'),
        ).toBeDefined();

        await vi.advanceTimersByTimeAsync(30_000);
        expect(wrapper.find('[data-test="resend-wait"]').exists()).toBe(false);
        expect(
            wrapper.get('[data-test="resend-whatsapp"]').attributes('disabled'),
        ).toBeUndefined();
        expect(
            wrapper.get('[data-test="resend-sms"]').attributes('disabled'),
        ).toBeUndefined();
    });

    it('starts without a wait when the server says the code can be asked for again', () => {
        const wrapper = verifyPage({ resendAvailableIn: 0 });

        expect(wrapper.find('[data-test="resend-wait"]').exists()).toBe(false);
        expect(
            wrapper.get('[data-test="resend-sms"]').attributes('disabled'),
        ).toBeUndefined();
    });

    it('offers only the channels that are available', () => {
        const wrapper = verifyPage({ resendAvailableIn: 0, channels: ['sms'] });

        expect(wrapper.find('[data-test="resend-whatsapp"]').exists()).toBe(
            false,
        );
        expect(wrapper.find('[data-test="resend-sms"]').exists()).toBe(true);
    });

    it('asks for the channel that was pressed', async () => {
        const wrapper = verifyPage({
            resendAvailableIn: 0,
            channels: ['whatsapp', 'sms'],
        });

        await wrapper.get('[data-test="resend-sms"]').trigger('click');

        expect(post).toHaveBeenCalledWith(
            '/auth/otp/resend',
            { channel: 'sms' },
            expect.objectContaining({ preserveScroll: true }),
        );
    });

    it('shows the wait of a throttled try as a countdown, not as a toast', async () => {
        page.props.errors = { rate_limited: '12' };
        const wrapper = verifyPage({ resendAvailableIn: 0 });

        expect(
            wrapper
                .get('[data-test="throttle-notice"] [aria-hidden="true"]')
                .text(),
        ).toBe('Too many attempts. Try again in 12 seconds.');
        expect(
            wrapper.get('[data-test="verify-button"]').attributes('disabled'),
        ).toBeDefined();
        expect(
            wrapper.get('[data-test="resend-sms"]').attributes('disabled'),
        ).toBeDefined();

        await vi.advanceTimersByTimeAsync(12_000);

        expect(wrapper.find('[data-test="throttle-notice"]').exists()).toBe(
            false,
        );
    });

    it('links back to change the number', () => {
        expect(
            verifyPage().get('[data-test="change-number"]').attributes('href'),
        ).toBe('/login/phone');
    });
});

describe('the status poll (13 §4.2)', () => {
    function answer(body: unknown, ok = true) {
        const fetchMock = vi
            .fn()
            .mockResolvedValue({ ok, json: () => Promise.resolve(body) });
        vi.stubGlobal('fetch', fetchMock);

        return fetchMock;
    }

    it('polls every 5 seconds while the code went by WhatsApp', async () => {
        const fetchMock = answer({ channel: 'whatsapp', fallbackSent: false });
        verifyPage({ channel: 'whatsapp' });

        expect(fetchMock).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(5000);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0]?.[0]).toBe('/auth/otp/status');

        await vi.advanceTimersByTimeAsync(10_000);
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('does not poll when the code went by SMS', async () => {
        const fetchMock = answer({ channel: 'sms', fallbackSent: false });
        verifyPage({ channel: 'sms' });

        await vi.advanceTimersByTimeAsync(30_000);

        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('stops after two minutes', async () => {
        const fetchMock = answer({ channel: 'whatsapp', fallbackSent: false });
        verifyPage({ channel: 'whatsapp' });

        await vi.advanceTimersByTimeAsync(120_000);
        const calls = fetchMock.mock.calls.length;
        await vi.advanceTimersByTimeAsync(60_000);

        expect(calls).toBe(24);
        expect(fetchMock).toHaveBeenCalledTimes(24);
    });

    it('says so when the code was replaced by an SMS, reloads the page and stops', async () => {
        const fetchMock = answer({ channel: 'sms', fallbackSent: true });
        const wrapper = verifyPage({ channel: 'whatsapp' });

        expect(wrapper.find('[data-test="otp-fallback"]').exists()).toBe(false);

        await vi.advanceTimersByTimeAsync(5000);
        await flushPromises();

        expect(wrapper.get('[data-test="otp-fallback"]').text()).toBe(
            "We couldn't reach you on WhatsApp, so we sent an SMS instead.",
        );
        expect(reload).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(20_000);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('stops when the server no longer has the challenge', async () => {
        const fetchMock = answer({ code: 'no_challenge' }, false);
        verifyPage({ channel: 'whatsapp' });

        await vi.advanceTimersByTimeAsync(5000);
        await vi.advanceTimersByTimeAsync(20_000);

        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('keeps polling after a network error', async () => {
        const fetchMock = vi.fn().mockRejectedValue(new TypeError('offline'));
        vi.stubGlobal('fetch', fetchMock);
        verifyPage({ channel: 'whatsapp' });

        await vi.advanceTimersByTimeAsync(10_000);

        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('stops polling when the page goes away', async () => {
        const fetchMock = answer({ channel: 'whatsapp', fallbackSent: false });
        const wrapper = verifyPage({ channel: 'whatsapp' });

        wrapper.unmount();
        await vi.advanceTimersByTimeAsync(30_000);

        expect(fetchMock).not.toHaveBeenCalled();
    });
});
