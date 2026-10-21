import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@inertiajs/vue3', async (importOriginal) => {
    const { page: testPage } = await import('@/test/inertiaPage');

    return {
        ...(await importOriginal<typeof import('@inertiajs/vue3')>()),
        usePage: () => testPage,
    };
});

import GoogleButton from '@/components/auth/GoogleButton.vue';
import en from '@/lang/generated/en.json';
import { resetPage } from '@/test/inertiaPage';

enableAutoUnmount(afterEach);

beforeEach(() => {
    resetPage({ auth: { user: null }, features: { google_login: true } });
});

describe('GoogleButton (10 §4.2, 13 §5.3)', () => {
    it('is a link to the Google redirect with the login intent', () => {
        const link = mount(GoogleButton).get('a[data-test="google-button"]');

        expect(link.attributes('href')).toBe(
            '/auth/google/redirect?intent=login',
        );
        expect(link.text()).toBe('Continue with Google');
    });

    it('carries the intent it is given', () => {
        const link = mount(GoogleButton, { props: { intent: 'link' } }).get(
            'a[data-test="google-button"]',
        );

        expect(link.attributes('href')).toBe(
            '/auth/google/redirect?intent=link',
        );
    });

    it('shows the terms caption with links to the terms and the privacy policy', () => {
        const caption = mount(GoogleButton).get('[data-test="google-caption"]');

        expect(caption.text()).toBe(
            'By continuing you accept the Terms of service and Privacy policy.',
        );
        expect(caption.get('a[href="/terms"]').attributes('target')).toBe(
            '_blank',
        );
        expect(caption.get('a[href="/privacy"]').attributes('rel')).toContain(
            'noopener',
        );
    });

    it('has its caption as one message with tags, which a translator can reorder', () => {
        const messages: Record<string, string> = en;

        expect(messages['auth_ui.google.caption']).toBe(
            'By continuing you accept the <terms>Terms of service</terms> and <privacy>Privacy policy</privacy>.',
        );
        expect(
            Object.keys(messages).filter((key) => /caption_/.test(key)),
        ).toEqual([]);
    });

    it('has no caption when it links an account instead of signing in', () => {
        const wrapper = mount(GoogleButton, { props: { intent: 'link' } });

        expect(wrapper.find('[data-test="google-caption"]').exists()).toBe(
            false,
        );
    });

    it('draws an "or" line above itself on request', () => {
        expect(
            mount(GoogleButton).find('[data-test="google-separator"]').exists(),
        ).toBe(false);

        const separator = mount(GoogleButton, {
            props: { separated: true },
        }).get('[data-test="google-separator"]');

        expect(separator.attributes('role')).toBe('separator');
        expect(separator.text()).toBe('or');
    });

    it('renders nothing while features.google_login is off', () => {
        resetPage({ auth: { user: null }, features: { google_login: false } });

        const wrapper = mount(GoogleButton, { props: { separated: true } });

        expect(wrapper.find('[data-test="google-sign-in"]').exists()).toBe(
            false,
        );
        expect(wrapper.find('a').exists()).toBe(false);
        expect(wrapper.text()).toBe('');
    });

    it('renders nothing when the flag is missing from the page', () => {
        resetPage({ auth: { user: null } });

        expect(mount(GoogleButton).find('a').exists()).toBe(false);
    });
});
