import { onScopeDispose, ref, watch } from 'vue';
import type { Ref } from 'vue';
import { status } from '@/routes/auth/otp';

/** 13 §4.2: every 5 seconds, for at most 2 minutes, while the code went by WhatsApp. */
export const POLL_INTERVAL_MS = 5000;
export const POLL_MAX_MS = 120_000;

type OtpStatus = { channel: 'whatsapp' | 'sms'; fallbackSent: boolean };

function isStatus(value: unknown): value is OtpStatus {
    if (typeof value !== 'object' || value === null) {
        return false;
    }

    const candidate = value as Record<string, unknown>;

    return (
        (candidate.channel === 'whatsapp' || candidate.channel === 'sms') &&
        typeof candidate.fallbackSent === 'boolean'
    );
}

/**
 * Asks `auth.otp.status` whether the WhatsApp code was replaced by an SMS (13 §4.2, "Asynchronous WhatsApp failure").
 * Polling runs while `enabled()` is true and stops at the first fallback or after two minutes. `fallbackSent` latches
 * true once the server says so; `onFallback` is called then, with the channel the code now goes by.
 */
export function useOtpStatusPoll(
    enabled: () => boolean,
    onFallback: (channel: 'whatsapp' | 'sms') => void = () => undefined,
): { fallbackSent: Ref<boolean> } {
    const fallbackSent = ref(false);
    let timer: ReturnType<typeof setInterval> | null = null;
    let elapsed = 0;
    let inFlight = false;

    function stop(): void {
        if (timer !== null) {
            clearInterval(timer);
            timer = null;
        }
    }

    async function poll(): Promise<void> {
        elapsed += POLL_INTERVAL_MS;

        if (elapsed >= POLL_MAX_MS) {
            stop();
        }

        if (inFlight) {
            return;
        }

        inFlight = true;

        try {
            const response = await fetch(status.url(), {
                headers: { Accept: 'application/json' },
                credentials: 'same-origin',
            });

            if (!response.ok) {
                stop();

                return;
            }

            const body: unknown = await response.json();

            if (isStatus(body) && body.fallbackSent) {
                stop();
                fallbackSent.value = true;
                onFallback(body.channel);
            }
        } catch {
            // A poll that fails is tried again at the next tick; the page works without it.
        } finally {
            inFlight = false;
        }
    }

    watch(
        enabled,
        (on) => {
            stop();
            elapsed = 0;

            if (on) {
                timer = setInterval(() => void poll(), POLL_INTERVAL_MS);
            }
        },
        { immediate: true },
    );

    onScopeDispose(stop);

    return { fallbackSent };
}
