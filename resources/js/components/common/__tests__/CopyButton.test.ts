import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('vue-sonner', () => ({ toast }));

import CopyButton from '@/components/common/CopyButton.vue';

const writeText = vi.fn();

beforeEach(() => {
    writeText.mockReset().mockResolvedValue(undefined);
    toast.success.mockReset();
    toast.error.mockReset();
    Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText },
    });
});

afterEach(() => {
    vi.useRealTimers();
});

describe('CopyButton', () => {
    it('is an icon button named by its label (default: Copy)', () => {
        const wrapper = mount(CopyButton, { props: { value: 'ORD-1' } });
        const button = wrapper.get('button');

        expect(button.attributes('type')).toBe('button');
        expect(button.attributes('aria-label')).toBe('Copy');
        expect(button.attributes('title')).toBe('Copy');
        expect(button.get('svg').attributes('aria-hidden')).toBe('true');
    });

    it('uses the given label', () => {
        const wrapper = mount(CopyButton, {
            props: { value: 'ORD-1', label: 'Copy order number' },
        });

        expect(wrapper.get('button').attributes('aria-label')).toBe(
            'Copy order number',
        );
    });

    it('copies the value and toasts "Copied"', async () => {
        const wrapper = mount(CopyButton, {
            props: { value: 'ORD-2026-00042' },
        });

        await wrapper.get('button').trigger('click');
        await flushPromises();

        expect(writeText).toHaveBeenCalledWith('ORD-2026-00042');
        expect(toast.success).toHaveBeenCalledWith('Copied');
        expect(toast.error).not.toHaveBeenCalled();
    });

    it('shows a check for two seconds, then goes back to the copy icon', async () => {
        vi.useFakeTimers();
        const wrapper = mount(CopyButton, { props: { value: 'x' } });

        await wrapper.get('button').trigger('click');
        await flushPromises();

        expect(wrapper.get('svg').attributes('data-icon')).toBe('check');

        vi.advanceTimersByTime(2000);
        await flushPromises();

        expect(wrapper.get('svg').attributes('data-icon')).toBe('copy');
    });

    it('toasts an error when the clipboard refuses', async () => {
        writeText.mockRejectedValue(new Error('denied'));
        const wrapper = mount(CopyButton, { props: { value: 'x' } });

        await wrapper.get('button').trigger('click');
        await flushPromises();

        expect(toast.error).toHaveBeenCalledWith(
            'Could not copy. Please copy it by hand.',
        );
        expect(toast.success).not.toHaveBeenCalled();
        expect(wrapper.get('svg').attributes('data-icon')).toBe('copy');
    });

    it('toasts an error when there is no clipboard API', async () => {
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: undefined,
        });
        const wrapper = mount(CopyButton, { props: { value: 'x' } });

        await wrapper.get('button').trigger('click');
        await flushPromises();

        expect(toast.error).toHaveBeenCalledOnce();
    });
});
