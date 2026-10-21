import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import PhotoGallery from '@/components/media/PhotoGallery.vue';
import type { MediaData } from '@/types';

function photos(count: number): MediaData[] {
    return Array.from({ length: count }, (_, index) => ({
        id: `m${index + 1}`,
        name: index % 2 === 0 ? `Door ${index + 1}` : '',
        mimeType: 'image/jpeg',
        size: 1000,
        url: `/media/m${index + 1}`,
        thumbUrl: `/media/m${index + 1}?conversion=thumb`,
        largeUrl: `/media/m${index + 1}?conversion=large`,
        width: 800,
        height: 600,
    }));
}

describe('PhotoGallery (15 §9.13)', () => {
    it('shows every thumbnail, lazily, with an alt text', () => {
        const wrapper = mount(PhotoGallery, { props: { photos: photos(3) } });
        const images = wrapper.findAll('img');

        expect(images).toHaveLength(3);
        expect(images[0]?.attributes()).toMatchObject({
            src: '/media/m1?conversion=thumb',
            alt: 'Door 1',
            loading: 'lazy',
            decoding: 'async',
        });
        expect(images[1]?.attributes('alt')).toBe('Photo 2');
    });

    it('shows a +6 tile when max is 4 and there are 10 photos', () => {
        const wrapper = mount(PhotoGallery, {
            props: { photos: photos(10), max: 4 },
        });

        expect(wrapper.findAll('img')).toHaveLength(4);
        expect(wrapper.get('[data-slot="gallery-more"]').text()).toContain(
            '+6',
        );
    });

    it('has no more tile when everything fits', () => {
        const wrapper = mount(PhotoGallery, {
            props: { photos: photos(4), max: 4 },
        });

        expect(wrapper.find('[data-slot="gallery-more"]').exists()).toBe(false);
    });

    it('opens the lightbox on the photo that was clicked', async () => {
        const wrapper = mount(PhotoGallery, {
            props: { photos: photos(5) },
            attachTo: document.body,
        });

        await wrapper
            .findAll('button[data-slot="gallery-thumb"]')[2]
            ?.trigger('click');

        expect(document.body.textContent).toContain('3 / 5');
        wrapper.unmount();
    });

    it('opens the lightbox at the first hidden photo from the more tile', async () => {
        const wrapper = mount(PhotoGallery, {
            props: { photos: photos(10), max: 4 },
            attachTo: document.body,
        });

        await wrapper.get('[data-slot="gallery-more"]').trigger('click');

        expect(document.body.textContent).toContain('5 / 10');
        wrapper.unmount();
    });
});
