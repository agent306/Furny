import { computed, getCurrentInstance, onBeforeUnmount, shallowRef } from 'vue';
import type { ComputedRef } from 'vue';

export type ConfirmTone = 'default' | 'destructive' | 'warning';

/** Already-translated strings; the dialog renders them as given. */
export type ConfirmOptions = {
    title: string;
    description?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    tone?: ConfirmTone;
    /** The user must type exactly this (case-sensitive, untrimmed). */
    requireText?: string;
    checkboxLabel?: string;
};

export type UseConfirmReturn = {
    /** Resolves `true` on Confirm, `false` on Cancel, Esc, or when no dialog can answer. */
    confirm: (options: ConfirmOptions) => Promise<boolean>;
};

export type UseConfirmStateReturn = {
    open: ComputedRef<boolean>;
    /** Options of the active dialog, kept after it closes so it does not blank mid-animation. */
    options: ComputedRef<ConfirmOptions | null>;
    /** Identifies the active dialog; pass it back to `settle`. */
    id: ComputedRef<number>;
    /** Answers dialog `id`. Ignored if it is no longer the active one. */
    settle: (id: number, confirmed: boolean) => void;
};

type Entry = {
    id: number;
    options: ConfirmOptions;
    resolve: (confirmed: boolean) => void;
};

// One global dialog (`ConfirmHost`, mounted once by AppShell), so state is
// module-level. Policy for concurrent calls: they QUEUE, first in first out,
// and one dialog is on screen at a time; each promise settles when its own
// dialog is answered. A call with no host mounted, and every pending call when
// the last host unmounts, settles `false` (the safe answer: nothing is
// confirmed), so a promise is never left pending.
let nextId = 1;
let hosts = 0;
const queue: Entry[] = [];
const active = shallowRef<Entry | null>(null);
const shown = shallowRef<{ id: number; options: ConfirmOptions } | null>(null);

function show(entry: Entry | null): void {
    active.value = entry;

    if (entry !== null) {
        shown.value = { id: entry.id, options: entry.options };
    }
}

function settle(id: number, confirmed: boolean): void {
    const entry = active.value;

    if (entry === null || entry.id !== id) {
        return;
    }

    show(queue.shift() ?? null);
    entry.resolve(confirmed);
}

function settleAll(): void {
    const pending = [...(active.value ? [active.value] : []), ...queue];

    queue.length = 0;
    show(null);

    for (const entry of pending) {
        entry.resolve(false);
    }
}

function confirm(options: ConfirmOptions): Promise<boolean> {
    if (hosts === 0) {
        if (import.meta.env.DEV) {
            console.warn(
                '[useConfirm] confirm() was called but no <ConfirmHost> is mounted; answering false.',
            );
        }

        return Promise.resolve(false);
    }

    return new Promise<boolean>((resolve) => {
        const entry: Entry = { id: nextId++, options, resolve };

        if (active.value === null) {
            show(entry);
        } else {
            queue.push(entry);
        }
    });
}

/** Marks a dialog host as present. Returns the (idempotent) unregister function. */
export function registerConfirmHost(): () => void {
    let registered = true;

    hosts += 1;

    return () => {
        if (!registered) {
            return;
        }

        registered = false;
        hosts -= 1;

        if (hosts === 0) {
            settleAll();
        }
    };
}

/** What `ConfirmHost` binds to. */
export function useConfirmState(): UseConfirmStateReturn {
    return {
        open: computed(() => active.value !== null),
        options: computed(() => shown.value?.options ?? null),
        id: computed(() => shown.value?.id ?? 0),
        settle,
    };
}

/** Registers the calling component as the dialog host until it unmounts. */
export function useConfirmHost(): UseConfirmStateReturn {
    const unregister = registerConfirmHost();

    if (getCurrentInstance() !== null) {
        onBeforeUnmount(unregister);
    }

    return useConfirmState();
}

export function useConfirm(): UseConfirmReturn {
    return { confirm };
}

/** Test helper: drops all state between tests. */
export function resetConfirmForTests(): void {
    hosts = 0;
    settleAll();
    shown.value = null;
}
