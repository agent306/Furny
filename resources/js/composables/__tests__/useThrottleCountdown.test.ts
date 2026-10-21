import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, reactive } from 'vue';
import { useThrottleCountdown } from '@/composables/useThrottleCountdown';

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

function countdown(errors: Record<string, string | undefined> | undefined) {
    const state = reactive<{ errors: typeof errors }>({ errors });
    const scope = effectScope();
    const result = scope.run(() => useThrottleCountdown(() => state.errors));

    if (result === undefined) {
        throw new Error('The scope did not run.');
    }

    return { ...result, state, scope };
}

describe('useThrottleCountdown (10 §4)', () => {
    it('counts the seconds of the rate_limited error down to zero', async () => {
        const { remaining } = countdown({ rate_limited: '3' });

        expect(remaining.value).toBe(3);

        await vi.advanceTimersByTimeAsync(1000);
        expect(remaining.value).toBe(2);

        await vi.advanceTimersByTimeAsync(2000);
        expect(remaining.value).toBe(0);

        await vi.advanceTimersByTimeAsync(5000);
        expect(remaining.value).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
    });

    it.each([
        ['no errors', undefined],
        ['other errors', { email: 'These credentials do not match.' }],
        ['text', { rate_limited: 'soon' }],
        ['zero', { rate_limited: '0' }],
        ['a negative number', { rate_limited: '-5' }],
    ])('does not count for %s', (_name, errors) => {
        const { remaining } = countdown(errors);

        expect(remaining.value).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('starts again for the next refusal, even with the same number', async () => {
        const { remaining, state } = countdown({ rate_limited: '5' });

        await vi.advanceTimersByTimeAsync(3000);
        expect(remaining.value).toBe(2);

        state.errors = { rate_limited: '5' };
        await Promise.resolve();

        expect(remaining.value).toBe(5);
        expect(vi.getTimerCount()).toBe(1);
    });

    it('stops when the errors go away', async () => {
        const { remaining, state } = countdown({ rate_limited: '5' });

        state.errors = {};
        await Promise.resolve();

        expect(remaining.value).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('clears its timer with its scope', () => {
        const { scope } = countdown({ rate_limited: '5' });

        expect(vi.getTimerCount()).toBe(1);

        scope.stop();

        expect(vi.getTimerCount()).toBe(0);
    });

    it('caps an absurd wait at a day', () => {
        const { remaining } = countdown({ rate_limited: '99999999' });

        expect(remaining.value).toBe(86_400);
    });
});
