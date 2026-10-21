import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { afterEach, describe, expect, it } from 'vitest';
import Lightbox from '@/components/media/Lightbox.vue';
import type { MediaData } from '@/types';

function photos(count: number): MediaData[] {
    return Array.from({ length: count }, (_, index) => ({
        id: `m${index + 1}`,
        name: `Door ${index + 1}`,
        mimeType: 'image/jpeg',
        size: 1000,
        url: `/media/m${index + 1}`,
        thumbUrl: null,
        largeUrl: index === 0 ? null : `/media/m${index + 1}?conversion=large`,
        width: null,
        height: null,
    }));
}

function lightbox(props: Record<string, unknown> = {}) {
    return mount(Lightbox, {
        props: { photos: photos(12), open: true, index: 2, ...props },
        attachTo: document.body,
    });
}

function press(key: string): void {
    const target = document.querySelector('[role="dialog"]') ?? document.body;
    target.dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
    );
}

afterEach(() => {
    document.body.innerHTML = '';
});

describe('Lightbox (15 §9.13)', () => {
    it('shows the large photo and the counter', async () => {
        const wrapper = lightbox();
        await nextTick();

        expect(document.body.textContent).toContain('3 / 12');
        expect(document.body.querySelector('img')?.getAttribute('src')).toBe(
            '/media/m3?conversion=large',
        );
        wrapper.unmount();
    });

    it('falls back to the photo itself when there is no large one', async () => {
        const wrapper = lightbox({ index: 0 });
        await nextTick();

        expect(document.body.querySelector('img')?.getAttribute('src')).toBe(
            '/media/m1',
        );
        wrapper.unmount();
    });

    it('moves with the arrow keys, Home and End', async () => {
        const wrapper = lightbox();
        await nextTick();

        press('ArrowRight');
        press('ArrowLeft');
        press('Home');
        press('End');

        expect(wrapper.emitted('update:index')).toEqual([[3], [1], [0], [11]]);
        wrapper.unmount();
    });

    it('stays on the first and the last photo', async () => {
        const first = lightbox({ index: 0 });
        await nextTick();
        press('ArrowLeft');
        expect(first.emitted('update:index')).toBeUndefined();
        first.unmount();

        const last = lightbox({ index: 11 });
        await nextTick();
        press('ArrowRight');
        expect(last.emitted('update:index')).toBeUndefined();
        last.unmount();
    });

    it('closes on Escape', async () => {
        const wrapper = lightbox();
        await nextTick();

        press('Escape');

        expect(wrapper.emitted('update:open')?.at(-1)).toEqual([false]);
        wrapper.unmount();
    });

    it('moves with the buttons and offers the download', async () => {
        const wrapper = lightbox();
        await nextTick();

        (
            document.querySelector(
                'button[aria-label="Next photo"]',
            ) as HTMLElement
        ).click();

        expect(wrapper.emitted('update:index')).toEqual([[3]]);
        expect(
            document.querySelector('a[download]')?.getAttribute('href'),
        ).toBe('/media/m3');
        wrapper.unmount();
    });

    it('returns the focus to the thumbnail it was opened from', async () => {
        const thumb = document.createElement('button');
        document.body.append(thumb);
        thumb.focus();
        const wrapper = lightbox({ open: false });

        await wrapper.setProps({ open: true });
        await nextTick();
        await wrapper.setProps({ open: false });
        await nextTick();
        await nextTick();

        expect(document.activeElement).toBe(thumb);
        wrapper.unmount();
    });
});
