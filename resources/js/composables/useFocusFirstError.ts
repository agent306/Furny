import { nextTick } from 'vue';

/**
 * 15 §10.1, §14.8: after a failed submit, focus moves to the first field that is marked invalid. The marks
 * (`aria-invalid="true"`) are rendered from the errors of the response, so the move waits for the next render.
 *
 *   <Form @error="focusFirstError">
 */
export function useFocusFirstError(
    root: () => ParentNode | null = () => document,
): { focusFirstError: () => Promise<void> } {
    async function focusFirstError(): Promise<void> {
        await nextTick();

        root()?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
    }

    return { focusFirstError };
}
