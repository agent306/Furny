import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page, resetPage } from '@/test/inertiaPage';

vi.mock('@inertiajs/vue3', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@inertiajs/vue3')>()),
    usePage: () => page,
}));

import FileDropzone from '@/components/media/FileDropzone.vue';
import { UploadError } from '@/lib/upload';
import type { UploadedFileRef } from '@/lib/upload';

const upload = vi.hoisted(() => ({ run: vi.fn() }));

vi.mock('@/lib/upload', async (importOriginal) => {
    const original = await importOriginal<typeof import('@/lib/upload')>();

    return { ...original, uploadWithIntent: upload.run };
});

function dropzone(props: Record<string, unknown> = {}) {
    return mount(FileDropzone, {
        props: {
            purpose: 'message_attachment',
            accept: ['image/png', 'application/pdf'],
            maxSizeBytes: 1_048_576,
            maxFiles: 2,
            modelValue: [],
            ...props,
        },
        attachTo: document.body,
    });
}

function pick(wrapper: ReturnType<typeof dropzone>, files: File[]) {
    const input = wrapper.get('input[type="file"]');
    Object.defineProperty(input.element, 'files', {
        value: files,
        configurable: true,
    });

    return input.trigger('change');
}

function file(name: string, type: string, bytes = 10): File {
    return new File([new Uint8Array(bytes)], name, { type });
}

function ref(name: string): UploadedFileRef {
    return {
        uploadId: `id-${name}`,
        name,
        size: 10,
        mime: 'image/png',
        previewUrl: null,
    };
}

beforeEach(() => {
    resetPage();
    upload.run.mockReset();
    upload.run.mockImplementation((picked: File) =>
        Promise.resolve(ref(picked.name)),
    );
});

afterEach(() => {
    document.body.innerHTML = '';
});

describe('FileDropzone (15 §9.10)', () => {
    it('refuses a file of the wrong type before any request', async () => {
        const wrapper = dropzone();

        await pick(wrapper, [file('notes.txt', 'text/plain')]);

        expect(wrapper.text()).toContain(
            "notes.txt: this file type isn't allowed.",
        );
        expect(upload.run).not.toHaveBeenCalled();
    });

    it('takes the type of a file without one from its extension', async () => {
        const wrapper = dropzone();

        await pick(wrapper, [file('plan.PDF', '')]);
        await flushPromises();

        expect(upload.run).toHaveBeenCalledTimes(1);
    });

    it('refuses a file that is too large', async () => {
        const wrapper = dropzone();

        await pick(wrapper, [file('big.png', 'image/png', 2_000_000)]);

        expect(wrapper.text()).toContain('big.png is larger than 1 MB.');
        expect(upload.run).not.toHaveBeenCalled();
    });

    it('refuses the files beyond the limit and takes the others', async () => {
        const wrapper = dropzone();

        await pick(wrapper, [
            file('a.png', 'image/png'),
            file('b.png', 'image/png'),
            file('c.png', 'image/png'),
        ]);
        await flushPromises();

        expect(wrapper.text()).toContain('You can attach up to 2 files.');
        expect(upload.run).toHaveBeenCalledTimes(2);
    });

    it('says when an upload is running, and when it is over', async () => {
        let finish: (value: UploadedFileRef) => void = () => undefined;
        upload.run.mockImplementation(
            () =>
                new Promise<UploadedFileRef>((resolve) => {
                    finish = resolve;
                }),
        );
        const wrapper = dropzone();

        await pick(wrapper, [file('a.png', 'image/png')]);
        await flushPromises();
        finish(ref('a.png'));
        await flushPromises();

        expect(wrapper.emitted('uploading')).toEqual([[true], [false]]);
        expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([
            [ref('a.png')],
        ]);
    });

    it('shows the reason an upload failed and lets the person try again', async () => {
        upload.run.mockRejectedValueOnce(
            new UploadError('upload_image_too_large'),
        );
        const wrapper = dropzone();

        await pick(wrapper, [file('a.png', 'image/png')]);
        await flushPromises();

        expect(wrapper.text()).toContain('too many pixels');

        await wrapper.get('[data-slot="upload-retry"]').trigger('click');
        await flushPromises();

        expect(upload.run).toHaveBeenCalledTimes(2);
        expect(wrapper.text()).toContain('Ready');
    });

    it('drops a file from the value when it is removed', async () => {
        const wrapper = dropzone();

        await pick(wrapper, [file('a.png', 'image/png')]);
        await flushPromises();
        await wrapper.get('button[aria-label="Remove a.png"]').trigger('click');

        expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([[]]);
        expect(wrapper.text()).not.toContain('a.png');
    });

    it('is one button, and Enter opens the picker', async () => {
        const open = vi
            .spyOn(HTMLInputElement.prototype, 'click')
            .mockImplementation(() => undefined);
        const wrapper = dropzone();
        const area = wrapper.get('[data-slot="dropzone-area"]');

        expect(area.element.tagName).toBe('BUTTON');
        await area.trigger('keydown', { key: 'Enter' });

        expect(open).toHaveBeenCalledTimes(1);
        open.mockRestore();
    });

    it('takes files dropped on it, unless disabled', async () => {
        const wrapper = dropzone();
        const area = wrapper.get('[data-slot="dropzone-area"]');

        await area.trigger('drop', {
            dataTransfer: { files: [file('a.png', 'image/png')] },
        });
        await flushPromises();
        expect(upload.run).toHaveBeenCalledTimes(1);

        await wrapper.setProps({ disabled: true });
        await area.trigger('drop', {
            dataTransfer: { files: [file('b.png', 'image/png')] },
        });
        expect(upload.run).toHaveBeenCalledTimes(1);
    });
});
