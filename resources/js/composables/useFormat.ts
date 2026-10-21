import { usePage } from '@inertiajs/vue3';
import { createFormat, DEFAULT_FORMAT_CONTEXT } from '@/lib/format';
import type { FormatContext, Formatters } from '@/lib/format';

/**
 * The shared props this composable reads (15 §8): `business.*` and
 * `auth.user.timezone`. Declared locally until Task 20 types the shared
 * props; every field may be absent before the server shares them.
 */
type FormatProps = {
    auth?: { user?: { timezone?: string | null } | null };
    business?: {
        locale?: string | null;
        currency?: string | null;
        timezone?: string | null;
    };
};

/**
 * `lib/format` bound to the business locale and currency and the user's time
 * zone (falling back to the business zone) from the page props. The functions
 * read the props on every call, so they follow prop changes.
 */
export function useFormat(): Formatters {
    const page = usePage();

    return createFormat((): FormatContext => {
        const { auth, business } = page.props as FormatProps;
        const businessTimeZone =
            business?.timezone ?? DEFAULT_FORMAT_CONTEXT.businessTimeZone;

        return {
            locale: business?.locale ?? DEFAULT_FORMAT_CONTEXT.locale,
            currency: business?.currency ?? DEFAULT_FORMAT_CONTEXT.currency,
            timeZone: auth?.user?.timezone ?? businessTimeZone,
            businessTimeZone,
        };
    });
}
