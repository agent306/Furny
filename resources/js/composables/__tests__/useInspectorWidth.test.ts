import { beforeEach, describe, expect, it } from 'vitest';
import {
    clampInspectorWidth,
    INSPECTOR_DEFAULT,
    INSPECTOR_WIDTH_KEY,
    useInspectorWidth,
} from '@/composables/useInspectorWidth';

beforeEach(() => localStorage.clear());

describe('useInspectorWidth (15 §7.3)', () => {
    it('clamps to 280-420 px and rounds', () => {
        expect(clampInspectorWidth(100)).toBe(280);
        expect(clampInspectorWidth(999)).toBe(420);
        expect(clampInspectorWidth(300.4)).toBe(300);
        expect(clampInspectorWidth(Number.NaN)).toBe(INSPECTOR_DEFAULT);
        expect(clampInspectorWidth(Number.POSITIVE_INFINITY)).toBe(
            INSPECTOR_DEFAULT,
        );
    });

    it('persists under fs:ui:inspector-width', () => {
        const { width, setWidth } = useInspectorWidth();

        setWidth(360);

        expect(width.value).toBe(360);
        expect(localStorage.getItem('fs:ui:inspector-width')).toBe('360');
        expect(INSPECTOR_WIDTH_KEY).toBe('fs:ui:inspector-width');
        expect(useInspectorWidth().width.value).toBe(360);
    });

    it('ignores a garbage stored value', () => {
        localStorage.setItem(INSPECTOR_WIDTH_KEY, 'wide');

        expect(useInspectorWidth().width.value).toBe(INSPECTOR_DEFAULT);
    });
});
