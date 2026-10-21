import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page, resetPage } from '@/test/inertiaPage';

vi.mock('@inertiajs/vue3', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@inertiajs/vue3')>()),
    usePage: () => page,
}));

import AttachmentList from '@/components/media/AttachmentList.vue';

beforeEach(() => resetPage());

describe('AttachmentList (15 §9.31)', () => {
    it('lists each file with its size and a download link to its media URL', () => {
        const wrapper = mount(AttachmentList, {
            props: {
                files: [
                    {
                        id: 'm1',
                        name: 'Quote.pdf',
                        mimeType: 'application/pdf',
                        size: 1536,
                        url: '/media/m1',
                        thumbUrl: null,
                        largeUrl: null,
                        width: null,
                        height: null,
                    },
                ],
            },
        });
        const link = wrapper.get('a');

        expect(link.attributes()).toMatchObject({
            href: '/media/m1',
            download: '',
            'aria-label': 'Download Quote.pdf',
        });
        expect(link.text()).toContain('Quote.pdf');
        expect(link.text()).toContain('1.5 KB');
        expect(link.classes()).toContain('min-h-11');
    });
});
