import { flushPromises, mount } from '@vue/test-utils';
import type { VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const post = vi.hoisted(() => vi.fn());

vi.mock('@inertiajs/vue3', async (importOriginal) => {
    const { page: testPage } = await import('@/test/inertiaPage');

    return {
        ...(await importOriginal<typeof import('@inertiajs/vue3')>()),
        usePage: () => testPage,
        router: { post },
    };
});

import PhoneVerifyDialog from '@/components/account/PhoneVerifyDialog.vue';
import { page, resetPage } from '@/test/inertiaPage';

let mounted: VueWrapper | null = null;

const NUMBER = '+919876543210';

type Visit = {
    onStart?: () => void;
    onFinish?: () => void;
    onSuccess?: (visited: unknown) => void;
    onError?: (errors: Record<string, string>) => void;
};

/** The answer of the server to the next visit: `succeed` or fail with these errors. */
function answerWith(
    result: 'success' | Record<string, string>,
    flash: typeof page.flash = {},
): void {
    post.mockImplementation((_url: string, _data: unknown, options: Visit) => {
        options.onStart?.();
        queueMicrotask(() => {
            page.flash = flash;

            if (result === 'success') {
                page.props.errors = {};
                options.onSuccess?.(page);
            } else {
                page.props.errors = result;
                options.onError?.(result);
            }

            options.onFinish?.();
        });
    });
}

function dialog(props: Record<string, unknown> = {}) {
    mounted = mount(PhoneVerifyDialog, {
        props: { open: true, initialPhone: NUMBER, ...props },
        attachTo: document.body,
    });

    return mounted;
}

const q = <T extends Element>(selector: string): T | null =>
    document.body.querySelector<T>(selector);
const button = (name: string): HTMLButtonElement | null =>
    q<HTMLButtonElement>(`[data-test="${name}"]`);

async function type(code: string): Promise<void> {
    const input = q<HTMLInputElement>('input[name="code"]');

    if (input === null) {
        throw new Error('The code field is not there.');
    }

    input.value = code;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await flushPromises();
}

beforeEach(() => {
    vi.useFakeTimers();
    post.mockReset();
    resetPage({
        auth: { user: { type: 'customer' } },
        features: { whatsapp: true, sms: true },
        errors: {},
    });
});

afterEach(() => {
    mounted?.unmount();
    mounted = null;
    vi.useRealTimers();
    document.body.innerHTML = '';
});

describe('PhoneVerifyDialog (10 §13.2.3)', () => {
    it('opens on the phone step, with the number it was given', async () => {
        dialog();
        await flushPromises();

        expect(q('[role="dialog"]')?.textContent).toContain(
            'Verify your phone number',
        );
        expect(q('[data-test="phone-step"]')).not.toBeNull();
        expect(q('[data-test="code-step"]')).toBeNull();
        expect(q<HTMLInputElement>('input[type="tel"]')?.value).toContain(
            '98765',
        );
    });

    it('sends the code to the number and moves to the code step after a successful send', async () => {
        answerWith('success', {
            channel: 'whatsapp',
            maskedPhone: '+91******3210',
        });
        dialog();
        await flushPromises();

        button('send-code-button')?.click();
        await flushPromises();

        expect(post).toHaveBeenCalledWith(
            '/account/phone/otp',
            { phone: NUMBER },
            expect.objectContaining({ preserveScroll: true }),
        );
        expect(q('[data-test="phone-step"]')).toBeNull();
        expect(q('[data-test="code-step"]')).not.toBeNull();
        expect(q('[data-test="sent-via"]')?.textContent).toContain(
            'Sent via WhatsApp.',
        );
        expect(q('[data-test="sent-via"]')?.textContent).toContain(
            '+91******3210',
        );
    });

    it("stays on the phone step with the server's message when the send is refused", async () => {
        answerWith({
            phone: "That doesn't look like a phone number. Check it and try again.",
            code: 'phone_invalid',
        });
        dialog();
        await flushPromises();

        button('send-code-button')?.click();
        await flushPromises();

        expect(q('[data-test="code-step"]')).toBeNull();
        expect(q('#dialog-phone-error')?.textContent).toBe(
            "That doesn't look like a phone number. Check it and try again.",
        );
        expect(q('input[type="tel"]')?.getAttribute('aria-invalid')).toBe(
            'true',
        );
    });

    it('cannot send without a number', async () => {
        dialog({ initialPhone: null });
        await flushPromises();

        expect(button('send-code-button')?.disabled).toBe(true);
    });

    it('submits the code by itself at six digits and emits verified, closing the dialog', async () => {
        answerWith('success', { channel: 'sms', maskedPhone: '+91******3210' });
        const wrapper = dialog();
        await flushPromises();
        button('send-code-button')?.click();
        await flushPromises();
        post.mockClear();
        answerWith('success');

        await type('12345');
        expect(post).not.toHaveBeenCalled();

        await type('123456');
        await flushPromises();

        expect(post).toHaveBeenCalledWith(
            '/account/phone/verify',
            { code: '123456' },
            expect.objectContaining({ preserveScroll: true }),
        );
        expect(wrapper.emitted('verified')).toHaveLength(1);
        expect(wrapper.emitted('update:open')?.at(-1)).toEqual([false]);
    });

    it('does not emit verified when the code is refused, and shows why under the code', async () => {
        answerWith('success', { channel: 'sms', maskedPhone: '+91******3210' });
        const wrapper = dialog();
        await flushPromises();
        button('send-code-button')?.click();
        await flushPromises();
        answerWith({
            code: "That code isn't right. 4 attempts left.",
            reason: 'otp_invalid',
        });

        await type('123456');
        await flushPromises();

        expect(wrapper.emitted('verified')).toBeUndefined();
        expect(q('#dialog-code-error')?.textContent).toBe(
            "That code isn't right. 4 attempts left.",
        );
        expect(q<HTMLInputElement>('input[name="code"]')?.value).toBe('');
    });

    it('shows a number somebody else has as the message under the code', async () => {
        answerWith('success', { channel: 'sms', maskedPhone: '+91******3210' });
        const wrapper = dialog();
        await flushPromises();
        button('send-code-button')?.click();
        await flushPromises();
        answerWith({
            code: "That phone number can't be used with your account.",
            reason: 'phone_unavailable',
        });

        await type('123456');
        await flushPromises();

        expect(wrapper.emitted('verified')).toBeUndefined();
        expect(q('#dialog-code-error')?.textContent).toBe(
            "That phone number can't be used with your account.",
        );
    });

    it('does not take a throttled try for a verified number: the dialog stays and says why', async () => {
        answerWith('success', { channel: 'sms', maskedPhone: '+91******3210' });
        const wrapper = dialog();
        await flushPromises();
        button('send-code-button')?.click();
        await flushPromises();
        answerWith({ rate_limited: '42' });

        await type('123456');
        await flushPromises();

        expect(wrapper.emitted('verified')).toBeUndefined();
        expect(wrapper.emitted('update:open')).toBeUndefined();
        expect(q('[data-test="code-step"]')).not.toBeNull();
        expect(q('#dialog-wait')?.textContent).toBe(
            'Too many attempts. Try again in 42 seconds.',
        );
    });

    it('does not take a refusal that came back as a toast for a success either', async () => {
        answerWith('success', { channel: 'sms', maskedPhone: '+91******3210' });
        const wrapper = dialog();
        await flushPromises();
        button('send-code-button')?.click();
        await flushPromises();
        // A redirect with an error flash and no errors: Inertia calls it a success.
        answerWith('success', {
            error: 'Too many attempts. Try again in 60 seconds.',
        });

        await type('123456');
        await flushPromises();

        expect(wrapper.emitted('verified')).toBeUndefined();
        expect(wrapper.emitted('update:open')).toBeUndefined();
        expect(q('[data-test="code-step"]')).not.toBeNull();
    });

    it('does not move to the code step when the send came back as a toast', async () => {
        answerWith('success', {
            error: 'Too many attempts. Try again in 60 seconds.',
        });
        dialog();
        await flushPromises();

        button('send-code-button')?.click();
        await flushPromises();

        expect(q('[data-test="phone-step"]')).not.toBeNull();
        expect(q('[data-test="code-step"]')).toBeNull();
    });

    it('holds the resend button for 60 seconds after a send', async () => {
        answerWith('success', { channel: 'sms', maskedPhone: '+91******3210' });
        dialog();
        await flushPromises();
        button('send-code-button')?.click();
        await flushPromises();

        expect(button('resend-button')?.disabled).toBe(true);
        expect(q('[data-test="resend-wait"]')?.textContent).toBe(
            'You can ask for a new code in 60 seconds.',
        );

        await vi.advanceTimersByTimeAsync(59_000);
        expect(button('resend-button')?.disabled).toBe(true);

        await vi.advanceTimersByTimeAsync(1000);
        expect(button('resend-button')?.disabled).toBe(false);
        expect(q('[data-test="resend-wait"]')).toBeNull();

        post.mockClear();
        answerWith('success', { channel: 'sms', maskedPhone: '+91******3210' });
        button('resend-button')?.click();
        await flushPromises();

        expect(post).toHaveBeenCalledWith(
            '/account/phone/otp',
            { phone: NUMBER },
            expect.anything(),
        );
        expect(button('resend-button')?.disabled).toBe(true);
    });

    it('goes back to the number to change it', async () => {
        answerWith('success', { channel: 'sms', maskedPhone: '+91******3210' });
        dialog();
        await flushPromises();
        button('send-code-button')?.click();
        await flushPromises();

        button('change-number')?.click();
        await flushPromises();

        expect(q('[data-test="phone-step"]')).not.toBeNull();
        expect(q('[data-test="code-step"]')).toBeNull();
    });

    it('starts over each time it is opened', async () => {
        answerWith('success', { channel: 'sms', maskedPhone: '+91******3210' });
        const wrapper = dialog();
        await flushPromises();
        button('send-code-button')?.click();
        await flushPromises();
        expect(q('[data-test="code-step"]')).not.toBeNull();

        await wrapper.setProps({ open: false });
        await wrapper.setProps({ open: true });
        await flushPromises();

        expect(q('[data-test="phone-step"]')).not.toBeNull();
    });

    it('asks to close through update:open', async () => {
        const wrapper = dialog();
        await flushPromises();

        const cancel = [...document.body.querySelectorAll('button')].find(
            (b) => b.textContent?.trim() === 'Cancel',
        );
        cancel?.click();
        await flushPromises();

        expect(wrapper.emitted('update:open')?.at(-1)).toEqual([false]);
    });

    it('is not closed while a send is on its way', async () => {
        post.mockImplementation(
            (_url: string, _data: unknown, options: Visit) =>
                options.onStart?.(),
        );
        const wrapper = dialog();
        await flushPromises();
        button('send-code-button')?.click();
        await flushPromises();

        const cancel = [...document.body.querySelectorAll('button')].find(
            (b) => b.textContent?.trim() === 'Cancel',
        );
        cancel?.click();
        await flushPromises();

        expect(wrapper.emitted('update:open')).toBeUndefined();
    });
});
