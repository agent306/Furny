import { ref } from 'vue';
import type { Ref } from 'vue';

/** `localStorage` key of the editor inspector width (15 §7.3). */
export const INSPECTOR_WIDTH_KEY = 'fs:ui:inspector-width';
export const INSPECTOR_MIN = 280;
export const INSPECTOR_MAX = 420;
export const INSPECTOR_DEFAULT = 320;

export type UseInspectorWidthReturn = {
    width: Ref<number>;
    /** Clamps to 280-420 px and remembers the width. */
    setWidth: (value: number) => void;
};

export function clampInspectorWidth(value: number): number {
    if (!Number.isFinite(value)) {
        return INSPECTOR_DEFAULT;
    }

    return Math.min(INSPECTOR_MAX, Math.max(INSPECTOR_MIN, Math.round(value)));
}

function read(): number {
    try {
        const stored = localStorage.getItem(INSPECTOR_WIDTH_KEY);

        return stored === null
            ? INSPECTOR_DEFAULT
            : clampInspectorWidth(Number(stored));
    } catch {
        // Blocked storage: the default applies and nothing is remembered.
        return INSPECTOR_DEFAULT;
    }
}

/** The resizable inspector's width, persisted per device (storage access is guarded). */
export function useInspectorWidth(): UseInspectorWidthReturn {
    const width = ref(read());

    function setWidth(value: number): void {
        width.value = clampInspectorWidth(value);

        try {
            localStorage.setItem(INSPECTOR_WIDTH_KEY, String(width.value));
        } catch {
            // Private mode or blocked storage: the width lasts for this page only.
        }
    }

    return { width, setWidth };
}
