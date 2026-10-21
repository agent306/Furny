import { reactive } from 'vue';
import type {
    FeatureFlags,
    FlashMessages,
    HealthBanner,
} from '@/types/inertia';

/**
 * Reactive stand-in for `usePage()` in component tests. Mock it like so (the
 * `vi.mock` factory runs lazily, so it may close over the imported `page`):
 *
 *   vi.mock('@inertiajs/vue3', async (importOriginal) => ({
 *       ...(await importOriginal<typeof import('@inertiajs/vue3')>()),
 *       usePage: () => page,
 *   }));
 */
export type TestUser = {
    type: 'customer' | 'staff';
    name?: string;
    email?: string | null;
    avatarUrl?: string | null;
    timezone?: string;
    lengthUnit?: 'mm' | 'cm' | 'm' | 'ftin' | 'in';
    roles?: string[];
    permissions?: string[];
    abilities?: string[];
};

export type TestPageProps = {
    app?: { name: string; logoUrl: string | null; version?: string };
    auth?: { user: TestUser | null };
    business?: {
        name?: string;
        locale?: string;
        currency?: string;
        timezone?: string;
        defaultCountryCode?: string;
        phoneE164?: string | null;
        email?: string;
        workingHours?: string;
    };
    features?: Partial<FeatureFlags>;
    unreadNotifications?: number;
    staffCounters?: { submitted: number; toCall: number } | null;
    healthBanners?: HealthBanner[];
};

export const page = reactive<{
    props: TestPageProps;
    /** The native top-level flash of the page, not a prop. */
    flash: FlashMessages & { id?: string };
    component: string;
    url: string;
}>({ props: {}, flash: {}, component: 'Test', url: '/' });

export function resetPage(props: TestPageProps = {}): void {
    page.props = props;
    page.flash = {};
    page.component = 'Test';
    page.url = '/';
}
