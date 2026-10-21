import { onScopeDispose, ref, watch } from 'vue';
import type { Ref } from 'vue';

/**
 * A wait counted down once a second (13 §4.4: "resend in 60 s"). `seconds` is read again whenever it changes, and
 * `restart()` starts the wait over from a number of seconds, for a wait that begins on an event (a code was sent).
 * `key` names the event the wait belongs to: when it changes the wait starts over from `seconds()` even if that is
 * the same number as before (every resend answers 60).
 */
export function useCountdown(
    seconds: () => number = () => 0,
    key: () => unknown = () => null,
): {
    remaining: Ref<number>;
    restart: (from: number) => void;
} {
    const remaining = ref(0);
    let timer: ReturnType<typeof setInterval> | null = null;

    function stop(): void {
        if (timer !== null) {
            clearInterval(timer);
            timer = null;
        }
    }

    function restart(from: number): void {
        stop();
        remaining.value =
            Number.isFinite(from) && from > 0 ? Math.ceil(from) : 0;

        if (remaining.value > 0) {
            timer = setInterval(() => {
                remaining.value -= 1;

                if (remaining.value <= 0) {
                    remaining.value = 0;
                    stop();
                }
            }, 1000);
        }
    }

    watch(
        () => [seconds(), key()] as const,
        ([from]) => restart(from),
        {
            immediate: true,
        },
    );

    onScopeDispose(stop);

    return { remaining, restart };
}
