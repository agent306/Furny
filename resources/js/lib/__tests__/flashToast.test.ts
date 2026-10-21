import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reactive } from 'vue';

const toast = vi.hoisted(() => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
}));

vi.mock('vue-sonner', () => ({ toast }));

import { createFlashBridge, FLASH_DURATION_MS } from '@/lib/flashToast';

beforeEach(() => {
    for (const fn of Object.values(toast)) {
        fn.mockClear();
    }
});

describe('flash bridge (15 §10.3)', () => {
    it('toasts each present message with the matching type and duration', () => {
        const bridge = createFlashBridge();

        const shown = bridge.show({
            success: 'Saved.',
            error: 'Nope.',
            info: 'FYI.',
            warning: 'Careful.',
        });

        expect(shown).toBe(4);
        expect(toast.success).toHaveBeenCalledWith('Saved.', {
            duration: 4000,
        });
        expect(toast.info).toHaveBeenCalledWith('FYI.', { duration: 4000 });
        expect(toast.warning).toHaveBeenCalledWith('Careful.', {
            duration: 6000,
        });
        expect(toast.error).toHaveBeenCalledWith('Nope.', { duration: 8000 });
        expect(FLASH_DURATION_MS).toEqual({
            success: 4000,
            info: 4000,
            warning: 6000,
            error: 8000,
        });
    });

    it('skips null, empty and non-string messages', () => {
        const bridge = createFlashBridge();

        expect(
            bridge.show({
                success: null as unknown as string,
                error: '',
                info: undefined,
            }),
        ).toBe(0);
        expect(bridge.show(null)).toBe(0);
        expect(bridge.show(undefined)).toBe(0);
        expect(
            bridge.show({ success: 42 } as unknown as { success: string }),
        ).toBe(0);
        expect(toast.success).not.toHaveBeenCalled();
    });

    it('shows one visit once, however often it is offered', () => {
        const bridge = createFlashBridge();
        const visit = { success: 'Saved.' };

        expect(bridge.show(visit)).toBe(1);
        expect(bridge.show(visit)).toBe(0);
        expect(toast.success).toHaveBeenCalledTimes(1);
    });

    it('recognises a reactive proxy of the same visit', () => {
        const bridge = createFlashBridge();
        const raw = { success: 'Saved.' };
        const proxy = reactive(raw);

        expect(bridge.show(proxy)).toBe(1);
        expect(bridge.show(raw)).toBe(0);
        expect(bridge.show(proxy)).toBe(0);
    });

    it('shows the same message again for a new visit', () => {
        const bridge = createFlashBridge();

        bridge.show({ success: 'Saved.' });
        bridge.show({ success: 'Saved.' });

        expect(toast.success).toHaveBeenCalledTimes(2);
    });

    it('dedupes by id across different objects', () => {
        const bridge = createFlashBridge();

        expect(bridge.show({ id: 'v-1', success: 'Saved.' })).toBe(1);
        expect(bridge.show({ id: 'v-1', success: 'Saved.' })).toBe(0);
        expect(bridge.show({ id: 'v-2', success: 'Saved.' })).toBe(1);
        expect(bridge.show({ id: '', success: 'Saved.' })).toBe(1);
    });

    it('hands the message over as a plain string, never markup', () => {
        const bridge = createFlashBridge();
        const hostile = '<img src=x onerror="alert(1)"><b>bold</b>';

        bridge.show({ error: hostile });

        expect(toast.error).toHaveBeenCalledTimes(1);
        expect(toast.error.mock.calls[0]?.[0]).toBe(hostile);
        expect(typeof toast.error.mock.calls[0]?.[0]).toBe('string');
    });
});
