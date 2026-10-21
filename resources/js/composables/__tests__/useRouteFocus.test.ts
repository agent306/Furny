import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick } from 'vue';

const events = vi.hoisted(() => ({
    handlers: {} as Record<string, (event: unknown) => void>,
}));

vi.mock('@inertiajs/vue3', () => ({
    router: {
        on: (event: string, handler: (event: unknown) => void) => {
            events.handlers[event] = handler;

            return () => undefined;
        },
    },
}));

import { resetRouteFocus, useRouteFocus } from '@/composables/useRouteFocus';

beforeEach(() => {
    events.handlers = {};
    resetRouteFocus();
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
});

describe('useRouteFocus (15 §14 items 4-5)', () => {
    it('cancels the pending announcement when its scope is disposed', async () => {
        const scope = effectScope();
        const announcement = scope.run(() =>
            useRouteFocus(() => ({ component: 'A', url: '/a' })),
        );

        events.handlers.navigate?.({
            detail: { page: { component: 'B', url: '/b' }, type: 'visit' },
        });
        await nextTick();

        expect(vi.getTimerCount()).toBe(1);

        scope.stop();

        expect(vi.getTimerCount()).toBe(0);

        await vi.advanceTimersByTimeAsync(100);

        expect(announcement?.value).toBe('');
    });

    it('does not schedule anything when the scope was disposed before the tick ran', async () => {
        const scope = effectScope();
        scope.run(() => useRouteFocus(() => ({ component: 'A', url: '/a' })));

        events.handlers.navigate?.({
            detail: { page: { component: 'B', url: '/b' }, type: 'visit' },
        });
        scope.stop();
        await nextTick();

        expect(vi.getTimerCount()).toBe(0);
    });
});
