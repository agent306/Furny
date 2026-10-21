import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, ref } from 'vue';
import { useCountdown } from '@/composables/useCountdown';

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

function countdown(seconds?: () => number) {
    const scope = effectScope();
    const result = scope.run(() => useCountdown(seconds));

    if (result === undefined) {
        throw new Error('The scope did not run.');
    }

    return { ...result, scope };
}

describe('useCountdown (13 §4.4)', () => {
    it('starts at zero and counts nothing without a wait', async () => {
        const { remaining } = countdown();

        expect(remaining.value).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('counts the wait it is given down to zero, once a second, and then stops', async () => {
        const { remaining } = countdown(() => 3);

        expect(remaining.value).toBe(3);

        await vi.advanceTimersByTimeAsync(1000);
        expect(remaining.value).toBe(2);

        await vi.advanceTimersByTimeAsync(2000);
        expect(remaining.value).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('starts over when the wait changes', async () => {
        const seconds = ref(60);
        const { remaining } = countdown(() => seconds.value);

        await vi.advanceTimersByTimeAsync(10_000);
        expect(remaining.value).toBe(50);

        seconds.value = 20;
        await vi.advanceTimersByTimeAsync(0);
        expect(remaining.value).toBe(20);
    });

    it('can be restarted for a wait that begins on an event', async () => {
        const { remaining, restart } = countdown();

        restart(60);
        await vi.advanceTimersByTimeAsync(5000);
        expect(remaining.value).toBe(55);

        restart(0);
        expect(remaining.value).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('rounds a fractional wait up and ignores nonsense', () => {
        const { remaining, restart } = countdown();

        restart(1.2);
        expect(remaining.value).toBe(2);

        restart(Number.NaN);
        expect(remaining.value).toBe(0);

        restart(-5);
        expect(remaining.value).toBe(0);
    });

    it('stops its timer with its scope', () => {
        const { scope } = countdown(() => 30);

        expect(vi.getTimerCount()).toBe(1);

        scope.stop();

        expect(vi.getTimerCount()).toBe(0);
    });
});
