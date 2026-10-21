import { describe, expect, it } from 'vitest';
import { Z } from '@/lib/zIndex';

describe('Z scale (15 §3.3)', () => {
    it('has the documented values', () => {
        expect(Z).toEqual({
            editorLayerMin: 0,
            editorLayerMax: 9,
            sticky: 10,
            editorFloating: 20,
            header: 30,
            sidebar: 40,
            portal: 50,
            lightbox: 60,
            toast: 100,
        });
    });

    it('stacks from the canvas up to toasts', () => {
        const layers = Object.values(Z);

        expect(layers).toEqual([...layers].sort((a, b) => a - b));
    });
});
