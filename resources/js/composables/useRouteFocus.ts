import { router } from '@inertiajs/vue3';
import { nextTick, onScopeDispose, ref } from 'vue';
import type { Ref } from 'vue';

/** The heading a page navigation lands on, else `#main` itself (15 §14.4). */
export function focusMainHeading(root: Document = document): boolean {
    const target =
        root.querySelector<HTMLElement>('#main h1') ??
        root.getElementById('main');

    if (target === null) {
        return false;
    }

    // Any page's h1 can take focus, not only the `tabindex="-1"` PageHeader one.
    if (!target.hasAttribute('tabindex')) {
        target.setAttribute('tabindex', '-1');
    }

    target.focus({ preventScroll: true });

    return true;
}

function pathOf(url: string): string {
    try {
        return new URL(url, window.location.origin).pathname;
    } catch {
        return url;
    }
}

/**
 * After an Inertia navigation to another page, focus moves to the main heading
 * and the new document title is announced through a polite live region
 * (15 §14 items 4-5). Reloads and query changes of the same page (filters,
 * pagination, partial reloads) keep the focus where the user is working.
 *
 * @returns the text for the live region
 */
export function useRouteFocus(
    current: () => { component: string; url: string },
): Ref<string> {
    const announcement = ref('');
    const at = current();
    let last = `${at.component}|${pathOf(at.url)}`;

    const stop = router.on('navigate', (event) => {
        const { page, type } = event.detail;
        const key = `${page.component}|${pathOf(page.url)}`;
        const moved = key !== last;

        last = key;

        if (type === 'initial' || !moved) {
            return;
        }

        void nextTick(() => {
            focusMainHeading();
            // `<Head>` writes the title in its own tick.
            setTimeout(() => {
                announcement.value = document.title;
            }, 50);
        });
    });

    onScopeDispose(stop);

    return announcement;
}
