import { mount } from '@vue/test-utils';
import { expect, it } from 'vitest';
import RequiredMark from '@/components/common/RequiredMark.vue';

it('is a visual asterisk that assistive technology skips', () => {
    const wrapper = mount(RequiredMark);

    expect(wrapper.text()).toBe('*');
    expect(wrapper.attributes('aria-hidden')).toBe('true');
});
