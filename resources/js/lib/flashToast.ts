import { toRaw } from 'vue';
import { toast } from 'vue-sonner';
import type { FlashMessages } from '@/types/inertia';

// The server → client toast bridge (15 §10.3). Flash messages arrive as the
// native top-level `flash` of an Inertia page (`Inertia::flash(...)`): already
// translated strings, rendered as TEXT. They are never turned into markup or a
// rich toast; vue-sonner prints a string title as text.

export type FlashType = keyof FlashMessages;

/** `id` is optional: a controller that wants cross-visit dedupe can send one. */
export type FlashPayload = FlashMessages & { id?: string | null };

/** Display time per type; errors stay longest (15 §10.3). The Toaster adds the close button. */
export const FLASH_DURATION_MS: Record<FlashType, number> = {
    success: 4000,
    info: 4000,
    warning: 6000,
    error: 8000,
};

const ORDER: readonly FlashType[] = ['error', 'warning', 'success', 'info'];
const MAX_REMEMBERED_IDS = 50;

export type FlashBridge = {
    /** Toasts the messages of a visit once; returns how many it showed. */
    show: (flash: FlashPayload | null | undefined) => number;
};

/**
 * Inertia announces each response's flash once (the `flash` router event) and
 * keeps the same object on the page, so remembering the object makes the mount
 * read and the event agree: "once per visit". An explicit `id` also dedupes
 * across objects.
 */
export function createFlashBridge(): FlashBridge {
    const shownObjects = new WeakSet<object>();
    const shownIds: string[] = [];

    return {
        show(flash) {
            if (flash === null || flash === undefined) {
                return 0;
            }

            const raw = toRaw(flash);

            if (shownObjects.has(raw)) {
                return 0;
            }

            shownObjects.add(raw);

            if (typeof raw.id === 'string' && raw.id !== '') {
                if (shownIds.includes(raw.id)) {
                    return 0;
                }

                shownIds.push(raw.id);

                if (shownIds.length > MAX_REMEMBERED_IDS) {
                    shownIds.shift();
                }
            }

            let shown = 0;

            for (const type of ORDER) {
                const message = raw[type];

                if (typeof message === 'string' && message !== '') {
                    toast[type](message, { duration: FLASH_DURATION_MS[type] });
                    shown++;
                }
            }

            return shown;
        },
    };
}

/** The bridge every `AppShell` shares, so a remounted shell does not repeat a visit's toasts. */
export const flashBridge: FlashBridge = createFlashBridge();
