import { router } from '@inertiajs/vue3';
import { nextTick, onScopeDispose, ref } from 'vue';
import type { Ref } from 'vue';

/** The heading a page navigation lands on, else `#main` itself (15 §14.4). */
export function focusMainHeading(root: Document = document): boolean {
    // `#main h1` on every page; the editor's title h1 sits in its top bar.
    const target =
        root.querySelector<HTMLElement>('#main h1, h1[data-main-heading]') ??
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

const keyOf = (page: { component: string; url: string }): string =>
    `${page.component}|${pathOf(page.url)}`;

// Module level on purpose: a navigation can swap the layout (login -> dashboard),
// which unmounts one AppShell and mounts another. The new shell must still know
// where the user came from, or it would think the page never moved.
let last: string | null = null;

/** Forgets the remembered page (tests). */
export function resetRouteFocus(): void {
    last = null;
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
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;

    // The first shell of a page load starts from the page it was mounted on.
    last ??= keyOf(current());

    const stop = router.on('navigate', (event) => {
        const { page, type } = event.detail;
        const key = keyOf(page);
        const moved = key !== last;

        last = key;

        if (type === 'initial' || !moved) {
            return;
        }

        // Emptying first makes a repeated identical title a change again, so a
        // screen reader announces consecutive same-titled pages.
        announcement.value = '';
        clearTimeout(timer);

        void nextTick(() => {
            if (disposed) {
                return;
            }

            focusMainHeading();
            // `<Head>` writes the title in its own tick.
            timer = setTimeout(() => {
                announcement.value = document.title;
            }, 50);
        });
    });

    onScopeDispose(() => {
        disposed = true;
        stop();
        clearTimeout(timer);
    });

    return announcement;
}
