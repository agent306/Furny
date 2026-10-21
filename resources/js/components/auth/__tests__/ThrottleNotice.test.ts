import { mount } from '@vue/test-utils';
import { expect, it } from 'vitest';
import ThrottleNotice from '@/components/auth/ThrottleNotice.vue';

it('shows the wait, counted live for the eyes, announced once to assistive technology', async () => {
    const wrapper = mount(ThrottleNotice, { props: { seconds: 42 } });

    expect(wrapper.get('[aria-hidden="true"]').text()).toBe(
        'Too many attempts. Try again in 42 seconds.',
    );
    expect(wrapper.get('.sr-only').text()).toBe(
        'Too many attempts. Try again in 42 seconds.',
    );

    await wrapper.setProps({ seconds: 41 });

    expect(wrapper.get('[aria-hidden="true"]').text()).toBe(
        'Too many attempts. Try again in 41 seconds.',
    );
    expect(wrapper.get('.sr-only').text()).toBe(
        'Too many attempts. Try again in 42 seconds.',
    );
});

it('says "1 second" for the last second', () => {
    expect(
        mount(ThrottleNotice, { props: { seconds: 1 } })
            .get('[aria-hidden="true"]')
            .text(),
    ).toBe('Too many attempts. Try again in 1 second.');
});
