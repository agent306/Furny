import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@inertiajs/vue3', async (importOriginal) => {
    const { page: testPage } = await import('@/test/inertiaPage');
    const { defineComponent: define } = await import('vue');

    return {
        ...(await importOriginal<typeof import('@inertiajs/vue3')>()),
        usePage: () => testPage,
        Head: define({
            name: 'Head',
            props: { title: String },
            render: () => null,
        }),
    };
});

import PhoneComplete from '@/pages/Auth/PhoneComplete.vue';
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

function complete() {
    return mount(PhoneComplete, {
        props: {
            maskedPhone: '+91******3210',
            features,
            turnstileSiteKey: null,
        },
        attachTo: document.body,
    });
}

beforeEach(() => {
    resetPage({ auth: { user: null }, features, errors: {} });
});

describe('PhoneComplete (10 §4.4)', () => {
    it('names the verified number and asks for the name and the terms', () => {
        const wrapper = complete();

        expect(wrapper.findAll('h1')).toHaveLength(1);
        expect(wrapper.get('h1').text()).toBe('Almost there');
        expect(wrapper.text()).toContain(
            'Your number +91******3210 is verified. What should we call you?',
        );
        expect(wrapper.get('label[for="name"]').text()).toBe('Full name *');
        expect(
            wrapper.get('input[name="name"]').attributes('required'),
        ).toBeDefined();
        expect(wrapper.get('#terms').attributes('role')).toBe('checkbox');
    });

    it('posts to the complete route', () => {
        const form = complete().get('form');

        expect(form.attributes('action')).toBe('/auth/otp/complete');
        expect(form.attributes('method')).toBe('post');
    });

    it('counts a throttled sign-up down on the page', () => {
        page.props.errors = { rate_limited: '20' };
        const wrapper = complete();

        expect(wrapper.find('[data-test="throttle-notice"]').exists()).toBe(
            true,
        );
        expect(
            wrapper.get('[data-test="complete-button"]').attributes('disabled'),
        ).toBeDefined();
    });
});
