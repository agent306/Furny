import { onScopeDispose, ref, watch } from 'vue';
import type { Ref } from 'vue';

/** The longest wait the page counts down; a limiter never asks for more than a day. */
const MAX_SECONDS = 86_400;

/**
 * The wait after too many attempts (10 §4): the server answers a throttled auth form with the validation error
 * `rate_limited`, whose value is the number of seconds. This counts them down, once a second. `errors` is read
 * again for every response, so a new refusal starts a new countdown even with the same number.
 */
export function useThrottleCountdown(
    errors: () => Record<string, string | undefined> | undefined,
    key = 'rate_limited',
): { remaining: Ref<number> } {
    const remaining = ref(0);
    let timer: ReturnType<typeof setInterval> | null = null;

    function stop(): void {
        if (timer !== null) {
            clearInterval(timer);
            timer = null;
        }
    }

    watch(
        errors,
        (current) => {
            stop();

            const seconds = Number.parseInt(current?.[key] ?? '', 10);
            remaining.value =
                Number.isFinite(seconds) && seconds > 0
                    ? Math.min(seconds, MAX_SECONDS)
                    : 0;

            if (remaining.value > 0) {
                timer = setInterval(() => {
                    remaining.value -= 1;

                    if (remaining.value <= 0) {
                        remaining.value = 0;
                        stop();
                    }
                }, 1000);
            }
        },
        { immediate: true },
    );

    onScopeDispose(stop);

    return { remaining };
}
