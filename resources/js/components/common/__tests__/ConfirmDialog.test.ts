import { flushPromises, mount } from '@vue/test-utils';
import type { VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import ConfirmDialog from '@/components/common/ConfirmDialog.vue';

let wrapper: VueWrapper | null = null;

function show(props: Record<string, unknown> = {}): VueWrapper {
    wrapper = mount(ConfirmDialog, {
        attachTo: document.body,
        props: { open: true, title: 'Delete order?', ...props },
    });

    return wrapper;
}

const dialog = (): HTMLElement | null =>
    document.body.querySelector('[role="alertdialog"]');
const byText = (text: string): HTMLButtonElement | undefined =>
    [...document.body.querySelectorAll('button')].find(
        (button) => button.textContent?.trim() === text,
    );

async function type(value: string): Promise<void> {
    const input =
        document.body.querySelector<HTMLInputElement>('input[type="text"]');

    if (input === null) {
        throw new Error('no text input');
    }

    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await flushPromises();
}

afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = '';
});

describe('ConfirmDialog', () => {
    it('renders nothing while closed', async () => {
        show({ open: false });
        await flushPromises();

        expect(dialog()).toBeNull();
    });

    it('is an alertdialog labelled by its title and described by its description', async () => {
        show({ description: 'This cannot be undone.' });
        await flushPromises();

        const root = dialog();
        expect(root).not.toBeNull();
        expect(root?.textContent).toContain('Delete order?');
        expect(root?.textContent).toContain('This cannot be undone.');
        expect(
            document.getElementById(root?.getAttribute('aria-labelledby') ?? '')
                ?.textContent,
        ).toBe('Delete order?');
        expect(
            document.getElementById(
                root?.getAttribute('aria-describedby') ?? '',
            )?.textContent,
        ).toBe('This cannot be undone.');
    });

    it('defaults the button labels to common.actions.confirm / cancel', async () => {
        show();
        await flushPromises();

        expect(byText('Confirm')).toBeDefined();
        expect(byText('Cancel')).toBeDefined();
    });

    it('uses custom labels', async () => {
        show({ confirmLabel: 'Delete', cancelLabel: 'Keep' });
        await flushPromises();

        expect(byText('Delete')).toBeDefined();
        expect(byText('Keep')).toBeDefined();
    });

    it('emits confirm and leaves closing to the parent', async () => {
        const view = show();
        await flushPromises();

        byText('Confirm')?.click();
        await flushPromises();

        expect(view.emitted('confirm')).toHaveLength(1);
        expect(view.emitted('update:open')).toBeUndefined();
        expect(dialog()).not.toBeNull();
    });

    it('cancel emits update:open(false)', async () => {
        const view = show();
        await flushPromises();

        byText('Cancel')?.click();
        await flushPromises();

        expect(view.emitted('update:open')).toEqual([[false]]);
        expect(view.emitted('confirm')).toBeUndefined();
    });

    describe('requireText', () => {
        const NUMBER = 'ORD-2026-00042';

        it('keeps Confirm disabled until the exact text is typed', async () => {
            const view = show({ requireText: NUMBER });
            await flushPromises();

            expect(document.body.textContent).toContain(
                `Type ${NUMBER} to confirm.`,
            );
            expect(byText('Confirm')?.disabled).toBe(true);

            await type('ORD-2026-0004');
            expect(byText('Confirm')?.disabled).toBe(true);

            await type(NUMBER);
            expect(byText('Confirm')?.disabled).toBe(false);

            byText('Confirm')?.click();
            await flushPromises();
            expect(view.emitted('confirm')).toHaveLength(1);
        });

        it('compares case-sensitively and without trimming', async () => {
            show({ requireText: NUMBER });
            await flushPromises();

            for (const attempt of [
                NUMBER.toLowerCase(),
                `${NUMBER} `,
                ` ${NUMBER}`,
                `${NUMBER}\u00a0`,
            ]) {
                await type(attempt);
                expect(
                    byText('Confirm')?.disabled,
                    JSON.stringify(attempt),
                ).toBe(true);
            }

            await type(NUMBER);
            expect(byText('Confirm')?.disabled).toBe(false);
        });

        it('does not emit confirm when the disabled button is clicked', async () => {
            const view = show({ requireText: NUMBER });
            await flushPromises();

            byText('Confirm')?.click();
            await flushPromises();

            expect(view.emitted('confirm')).toBeUndefined();
        });

        it('forgets the typed text when reopened', async () => {
            const view = show({ requireText: NUMBER });
            await flushPromises();
            await type(NUMBER);
            expect(byText('Confirm')?.disabled).toBe(false);

            await view.setProps({ open: false });
            await flushPromises();
            await view.setProps({ open: true });
            await flushPromises();

            expect(byText('Confirm')?.disabled).toBe(true);
            expect(
                document.body.querySelector<HTMLInputElement>(
                    'input[type="text"]',
                )?.value,
            ).toBe('');
        });
    });

    describe('checkboxLabel', () => {
        it('needs the box ticked before Confirm enables', async () => {
            const view = show({ checkboxLabel: 'I understand' });
            await flushPromises();

            expect(document.body.textContent).toContain('I understand');
            expect(byText('Confirm')?.disabled).toBe(true);

            document.body
                .querySelector<HTMLElement>('[role="checkbox"]')
                ?.click();
            await flushPromises();

            expect(byText('Confirm')?.disabled).toBe(false);

            await view.setProps({ open: false });
            await flushPromises();
            await view.setProps({ open: true });
            await flushPromises();

            expect(byText('Confirm')?.disabled).toBe(true);
        });

        it('needs both the text and the box', async () => {
            show({ requireText: 'DELETE', checkboxLabel: 'I understand' });
            await flushPromises();

            await type('DELETE');
            expect(byText('Confirm')?.disabled).toBe(true);

            document.body
                .querySelector<HTMLElement>('[role="checkbox"]')
                ?.click();
            await flushPromises();
            expect(byText('Confirm')?.disabled).toBe(false);
        });
    });

    describe('processing', () => {
        it('disables both buttons and ignores attempts to close', async () => {
            const view = show({ processing: true });
            await flushPromises();

            expect(byText('Confirm')?.disabled).toBe(true);
            expect(byText('Cancel')?.disabled).toBe(true);

            document.dispatchEvent(
                new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
            );
            await flushPromises();

            expect(view.emitted('update:open')).toBeUndefined();
        });
    });

    describe('initial focus (15 §14.3)', () => {
        it('goes to Cancel for destructive tone', async () => {
            show({ tone: 'destructive' });
            await flushPromises();

            expect(document.activeElement).toBe(byText('Cancel'));
        });

        it('goes to Confirm otherwise', async () => {
            show({ tone: 'default' });
            await flushPromises();

            expect(document.activeElement).toBe(byText('Confirm'));
        });

        it('goes to the text field when text must be typed first', async () => {
            show({ requireText: 'ORD-1' });
            await flushPromises();

            expect(document.activeElement).toBe(
                document.body.querySelector('input[type="text"]'),
            );
        });

        it('goes to Cancel for destructive tone even with a required text', async () => {
            show({ tone: 'destructive', requireText: 'ORD-1' });
            await flushPromises();

            expect(document.activeElement).toBe(byText('Cancel'));
        });
    });

    it('colours the confirm button by tone', async () => {
        show({ tone: 'destructive' });
        await flushPromises();
        expect(byText('Confirm')?.className).toContain('bg-destructive');
    });
});
