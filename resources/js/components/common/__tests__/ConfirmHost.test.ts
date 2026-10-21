import { flushPromises, mount } from '@vue/test-utils';
import type { VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import ConfirmHost from '@/components/common/ConfirmHost.vue';
import { resetConfirmForTests, useConfirm } from '@/composables/useConfirm';

let wrapper: VueWrapper | null = null;

const byText = (text: string): HTMLButtonElement | undefined =>
    [...document.body.querySelectorAll('button')].find(
        (button) => button.textContent?.trim() === text,
    );

afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = '';
    resetConfirmForTests();
});

describe('ConfirmHost + useConfirm', () => {
    it('confirm() resolves true on Confirm and closes the dialog', async () => {
        wrapper = mount(ConfirmHost, { attachTo: document.body });
        const answer = useConfirm().confirm({ title: 'Archive project?' });
        await flushPromises();

        expect(document.body.textContent).toContain('Archive project?');

        byText('Confirm')?.click();

        await expect(answer).resolves.toBe(true);
    });

    it('confirm() resolves false on Cancel', async () => {
        wrapper = mount(ConfirmHost, { attachTo: document.body });
        const answer = useConfirm().confirm({ title: 'Archive project?' });
        await flushPromises();

        byText('Cancel')?.click();

        await expect(answer).resolves.toBe(false);
    });

    it('confirm() resolves false on Escape', async () => {
        wrapper = mount(ConfirmHost, { attachTo: document.body });
        const answer = useConfirm().confirm({ title: 'Archive project?' });
        await flushPromises();

        document.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
        );

        await expect(answer).resolves.toBe(false);
    });

    it('shows queued confirmations one after the other', async () => {
        wrapper = mount(ConfirmHost, { attachTo: document.body });
        const { confirm } = useConfirm();
        const first = confirm({ title: 'First?' });
        const second = confirm({ title: 'Second?' });
        await flushPromises();

        expect(document.body.textContent).toContain('First?');
        expect(document.body.textContent).not.toContain('Second?');

        byText('Confirm')?.click();
        await first;
        await flushPromises();

        expect(document.body.textContent).toContain('Second?');

        byText('Cancel')?.click();
        await expect(second).resolves.toBe(false);
    });

    it('passes tone, labels and requireText through', async () => {
        wrapper = mount(ConfirmHost, { attachTo: document.body });
        void useConfirm().confirm({
            title: 'Cancel order?',
            confirmLabel: 'Cancel order',
            cancelLabel: 'Keep order',
            tone: 'destructive',
            requireText: 'ORD-1',
        });
        await flushPromises();

        expect(byText('Cancel order')?.disabled).toBe(true);
        expect(byText('Keep order')).toBeDefined();
    });

    it('answers pending confirmations false when the host unmounts', async () => {
        wrapper = mount(ConfirmHost, { attachTo: document.body });
        const answer = useConfirm().confirm({ title: 'Gone?' });
        await flushPromises();

        wrapper.unmount();
        wrapper = null;

        await expect(answer).resolves.toBe(false);
    });
});
