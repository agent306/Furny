import { flushPromises, mount } from '@vue/test-utils';
import type { VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import ReasonDialog from '@/components/common/ReasonDialog.vue';

const reasons = [
    { value: 'too_expensive', label: 'Too expensive' },
    { value: 'changed_mind', label: 'Changed my mind' },
];

let wrapper: VueWrapper | null = null;

function show(props: Record<string, unknown> = {}): VueWrapper {
    wrapper = mount(ReasonDialog, {
        attachTo: document.body,
        props: {
            open: true,
            title: 'Decline quote',
            noteLabel: 'Anything else?',
            noteRequired: false,
            confirmLabel: 'Decline',
            ...props,
        },
    });

    return wrapper;
}

const byText = (text: string): HTMLButtonElement | undefined =>
    [...document.body.querySelectorAll('button')].find(
        (button) => button.textContent?.trim() === text,
    );
const note = (): HTMLTextAreaElement =>
    document.body.querySelector('textarea') as HTMLTextAreaElement;

async function writeNote(value: string): Promise<void> {
    note().value = value;
    note().dispatchEvent(new Event('input', { bubbles: true }));
    await flushPromises();
}

async function submit(): Promise<void> {
    document.body
        .querySelector('form')
        ?.dispatchEvent(
            new Event('submit', { bubbles: true, cancelable: true }),
        );
    await flushPromises();
}

afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = '';
});

describe('ReasonDialog', () => {
    it('is a labelled dialog with the note field and a labelled textarea', async () => {
        show({ description: 'Tell us why.' });
        await flushPromises();

        const dialog = document.body.querySelector('[role="dialog"]');
        expect(dialog).not.toBeNull();
        expect(dialog?.textContent).toContain('Decline quote');
        expect(dialog?.textContent).toContain('Tell us why.');
        expect(
            document.querySelector(`label[for="${note().id}"]`)?.textContent,
        ).toBe('Anything else?');
        expect(note().getAttribute('maxlength')).toBe('2000');
    });

    it('does not use the library close button (it is not translated)', async () => {
        show();
        await flushPromises();

        expect(
            document.body.querySelector('[data-slot="dialog-close"]'),
        ).toBeNull();
        expect(byText('Cancel')).toBeDefined();
    });

    it('renders the reasons as a radio group', async () => {
        show({ reasons });
        await flushPromises();

        const radios = document.body.querySelectorAll('[role="radio"]');
        expect(radios).toHaveLength(2);
        expect(document.body.textContent).toContain('Too expensive');
    });

    it('requires a reason when reasons are given', async () => {
        const view = show({ reasons });
        await flushPromises();

        await submit();

        expect(document.body.textContent).toContain('Choose a reason.');
        expect(view.emitted('submit')).toBeUndefined();
    });

    it('requires a note when noteRequired, and treats blanks as empty', async () => {
        const view = show({ noteRequired: true });
        await flushPromises();

        await submit();
        expect(document.body.textContent).toContain(
            'Please add a short explanation.',
        );

        await writeNote('   \n ');
        await submit();
        expect(document.body.textContent).toContain(
            'Please add a short explanation.',
        );
        expect(view.emitted('submit')).toBeUndefined();
    });

    it('moves focus to the first radio when the reason is missing (even if the note is too)', async () => {
        show({ reasons, noteRequired: true });
        await flushPromises();

        await submit();

        const first = document.body.querySelectorAll('[role="radio"]')[0];
        expect(document.activeElement).toBe(first);
        expect(note().getAttribute('aria-invalid')).toBe('true');
    });

    it('moves focus to the invalid textarea when only the note is missing', async () => {
        show({ reasons, noteRequired: true });
        await flushPromises();

        document.body
            .querySelectorAll<HTMLElement>('[role="radio"]')[0]
            ?.click();
        await flushPromises();
        await submit();

        expect(document.activeElement).toBe(note());
        expect(note().getAttribute('aria-invalid')).toBe('true');
    });

    it('moves focus to the textarea when there are no reasons and the note is missing', async () => {
        show({ noteRequired: true });
        await flushPromises();

        await submit();

        expect(document.activeElement).toBe(note());
    });

    it('does not steal focus on a valid submit', async () => {
        show({ noteRequired: false });
        await flushPromises();
        (document.body.querySelector('button') as HTMLElement).focus();
        const before = document.activeElement;

        await submit();

        expect(document.activeElement).toBe(before);
    });

    it('emits { reason, note } when valid', async () => {
        const view = show({ reasons, noteRequired: true });
        await flushPromises();

        document.body
            .querySelectorAll<HTMLElement>('[role="radio"]')[1]
            ?.click();
        await flushPromises();
        await writeNote('  Found a cheaper option.  ');
        await submit();

        expect(view.emitted('submit')).toEqual([
            [{ reason: 'changed_mind', note: 'Found a cheaper option.' }],
        ]);
        expect(document.body.textContent).not.toContain('Choose a reason.');
    });

    it('emits only { note } when there are no reasons and the note is optional', async () => {
        const view = show();
        await flushPromises();

        await submit();

        expect(view.emitted('submit')).toEqual([[{ note: '' }]]);
    });

    it('shows server errors for the reason and the note', async () => {
        show({
            reasons,
            errors: { reason: 'The reason is invalid.', note: 'Too long.' },
        });
        await flushPromises();

        expect(document.body.textContent).toContain('The reason is invalid.');
        expect(document.body.textContent).toContain('Too long.');
        expect(note().getAttribute('aria-invalid')).toBe('true');
        expect(
            document.getElementById(
                note().getAttribute('aria-describedby') ?? '',
            )?.textContent,
        ).toBe('Too long.');
    });

    it('disables the buttons while processing', async () => {
        show({ processing: true });
        await flushPromises();

        expect(byText('Decline')?.disabled).toBe(true);
        expect(byText('Cancel')?.disabled).toBe(true);
    });

    it('colours the confirm button by tone', async () => {
        show({ tone: 'destructive' });
        await flushPromises();

        expect(byText('Decline')?.className).toContain('bg-destructive');
    });

    it('starts clean every time it opens', async () => {
        const view = show({ reasons, noteRequired: true });
        await flushPromises();
        await writeNote('draft text');
        await submit();
        expect(document.body.textContent).toContain('Choose a reason.');

        await view.setProps({ open: false });
        await flushPromises();
        await view.setProps({ open: true });
        await flushPromises();

        expect(note().value).toBe('');
        expect(document.body.textContent).not.toContain('Choose a reason.');
    });

    it('cancel emits update:open(false)', async () => {
        const view = show();
        await flushPromises();

        byText('Cancel')?.click();
        await flushPromises();

        expect(view.emitted('update:open')).toEqual([[false]]);
    });
});
