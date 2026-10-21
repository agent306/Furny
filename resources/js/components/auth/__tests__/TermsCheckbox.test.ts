import { mount } from '@vue/test-utils';
import { expect, it } from 'vitest';
import TermsCheckbox from '@/components/auth/TermsCheckbox.vue';

it('is the required terms box, with both documents linked in a new tab', () => {
    const wrapper = mount(TermsCheckbox);

    expect(wrapper.get('#terms').attributes('role')).toBe('checkbox');
    expect(wrapper.get('label[for="terms"]').text()).toBe(
        'I accept the Terms of service and the Privacy policy*',
    );
    expect(wrapper.get('a[href="/terms"]').attributes('target')).toBe('_blank');
    expect(wrapper.get('a[href="/privacy"]').attributes('rel')).toBe(
        'noopener noreferrer',
    );
    expect(wrapper.find('#terms-error').exists()).toBe(false);
});

it('marks itself invalid and described by the error', () => {
    const wrapper = mount(TermsCheckbox, {
        props: { error: 'Accept the terms to create an account.' },
    });

    expect(wrapper.get('#terms').attributes('aria-invalid')).toBe('true');
    expect(wrapper.get('#terms').attributes('aria-describedby')).toBe(
        'terms-error',
    );
    expect(wrapper.get('#terms-error').text()).toBe(
        'Accept the terms to create an account.',
    );
});
