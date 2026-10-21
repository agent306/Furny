import { reactive } from 'vue';

/**
 * Reactive stand-in for `usePage()` in component tests. Mock it like so (the
 * `vi.mock` factory runs lazily, so it may close over the imported `page`):
 *
 *   vi.mock('@inertiajs/vue3', async (importOriginal) => ({
 *       ...(await importOriginal<typeof import('@inertiajs/vue3')>()),
 *       usePage: () => page,
 *   }));
 */
export type TestPageProps = {
    auth?: { user: { type: 'customer' | 'staff'; timezone?: string } | null };
    business?: {
        locale?: string;
        currency?: string;
        timezone?: string;
    };
};

export const page = reactive<{ props: TestPageProps }>({ props: {} });

export function resetPage(props: TestPageProps = {}): void {
    page.props = props;
}
