import { flushPromises, mount } from '@vue/test-utils';
import type { VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const post = vi.hoisted(() => vi.fn());
const toastSuccess = vi.hoisted(() => vi.fn());

vi.mock('@inertiajs/vue3', async (importOriginal) => {
    const { page: testPage } = await import('@/test/inertiaPage');

    return {
        ...(await importOriginal<typeof import('@inertiajs/vue3')>()),
        usePage: () => testPage,
        router: { post },
    };
});

vi.mock('vue-sonner', async (importOriginal) => ({
    ...(await importOriginal<typeof import('vue-sonner')>()),
    toast: { success: toastSuccess },
}));

import VerifyContactBanner from '@/components/common/VerifyContactBanner.vue';
import { resetPage } from '@/test/inertiaPage';
import type { TestUser } from '@/test/inertiaPage';

let mounted: VueWrapper | null = null;

function banner(user: TestUser | null) {
    resetPage({ auth: { user }, features: { whatsapp: true, sms: true } });
    mounted = mount(VerifyContactBanner, { attachTo: document.body });

    return mounted;
}

const unverified: TestUser = {
    type: 'customer',
    email: 'asha@example.com',
    emailVerified: false,
    phoneVerified: false,
    phoneE164: null,
};

beforeEach(() => {
    post.mockReset();
    toastSuccess.mockReset();
});

afterEach(() => {
    mounted?.unmount();
    mounted = null;
    document.body.innerHTML = '';
});

describe('VerifyContactBanner (10 §1.1, 15 §9.31)', () => {
    it('asks a customer with neither contact verified to verify one', () => {
        const wrapper = banner(unverified);

        expect(
            wrapper.get('[data-test="verify-contact-banner"]').text(),
        ).toContain('Verify your email or phone to send orders and messages.');
        expect(wrapper.get('[data-test="resend-email"]').text()).toBe(
            'Resend email link',
        );
        expect(wrapper.get('[data-test="verify-phone"]').text()).toBe(
            'Verify phone',
        );
    });

    it.each([
        ['an email that is verified', { ...unverified, emailVerified: true }],
        ['a phone that is verified', { ...unverified, phoneVerified: true }],
        ['a staff member', { ...unverified, type: 'staff' as const }],
        ['flags that are not known', { type: 'customer' as const }],
    ])('is not shown for %s', (_name, user) => {
        expect(
            banner(user).find('[data-test="verify-contact-banner"]').exists(),
        ).toBe(false);
    });

    it('is not shown to a guest', () => {
        expect(
            banner(null).find('[data-test="verify-contact-banner"]').exists(),
        ).toBe(false);
    });

    it('offers no email link to a customer who has no email', () => {
        const wrapper = banner({
            ...unverified,
            email: null,
            phoneE164: '+919876543210',
        });

        expect(wrapper.find('[data-test="resend-email"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="verify-phone"]').exists()).toBe(true);
    });

    it('resends the link with the header that asks for a throttled wait as a toast', async () => {
        const wrapper = banner(unverified);

        await wrapper.get('[data-test="resend-email"]').trigger('click');

        expect(post).toHaveBeenCalledWith(
            '/email/verification-notification',
            {},
            expect.objectContaining({
                headers: { 'X-Throttle-Toast': '1' },
                preserveScroll: true,
            }),
        );
    });

    it('says the link was sent, but not when the answer was a refusal (the response toasts that)', async () => {
        const wrapper = banner(unverified);
        await wrapper.get('[data-test="resend-email"]').trigger('click');
        const options = post.mock.calls[0]?.[2] as {
            onSuccess: (page: unknown) => void;
        };

        options.onSuccess({ flash: {} });
        expect(toastSuccess).toHaveBeenCalledWith(
            'We sent a new verification link to your email.',
        );

        toastSuccess.mockClear();
        options.onSuccess({
            flash: { error: 'Too many attempts. Try again in 30 seconds.' },
        });
        expect(toastSuccess).not.toHaveBeenCalled();
    });

    it('disables the resend button while it is on its way', async () => {
        const wrapper = banner(unverified);
        post.mockImplementation(
            (_url: string, _data: unknown, options: { onStart: () => void }) =>
                options.onStart(),
        );

        await wrapper.get('[data-test="resend-email"]').trigger('click');

        expect(
            wrapper.get('[data-test="resend-email"]').attributes('disabled'),
        ).toBeDefined();
    });

    it('opens the phone dialog with the number the user has', async () => {
        const wrapper = banner({ ...unverified, phoneE164: '+919876543210' });

        expect(document.body.querySelector('[role="dialog"]')).toBeNull();

        await wrapper.get('[data-test="verify-phone"]').trigger('click');
        await flushPromises();

        const dialog = document.body.querySelector('[role="dialog"]');
        expect(dialog?.textContent).toContain('Verify your phone number');
        expect(
            document.body.querySelector<HTMLInputElement>('input[type="tel"]')
                ?.value,
        ).toContain('98765');
    });
});
