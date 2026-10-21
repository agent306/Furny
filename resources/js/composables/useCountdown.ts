import { onScopeDispose, ref, watch } from 'vue';
import type { Ref } from 'vue';

/**
 * A wait counted down once a second (13 §4.4: "resend in 60 s"). `seconds` is read again whenever it changes, and
 * `restart()` starts the wait over from a number of seconds, for a wait that begins on an event (a code was sent).
 */
export function useCountdown(seconds: () => number = () => 0): {
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

    watch(seconds, restart, { immediate: true });

    onScopeDispose(stop);

    return { remaining, restart };
}
