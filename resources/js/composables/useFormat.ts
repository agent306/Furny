import { usePage } from '@inertiajs/vue3';
import { createFormat, DEFAULT_FORMAT_CONTEXT } from '@/lib/format';
import type { FormatContext, Formatters } from '@/lib/format';

/**
 * The format context (business locale and currency, user time zone) read from
 * the page props on every call, so it follows prop changes.
 */
export function useFormatContext(): () => FormatContext {
    const page = usePage();

    return (): FormatContext => {
        // Both are always shared (15 §8); `?.` only tolerates a page without props yet.
        const { auth, business } = page.props;
        const businessTimeZone =
            business?.timezone ?? DEFAULT_FORMAT_CONTEXT.businessTimeZone;

        return {
            locale: business?.locale ?? DEFAULT_FORMAT_CONTEXT.locale,
            currency: business?.currency ?? DEFAULT_FORMAT_CONTEXT.currency,
            timeZone: auth?.user?.timezone ?? businessTimeZone,
            businessTimeZone,
        };
    };
}

/**
 * `lib/format` bound to the business locale and currency and the user's time
 * zone (falling back to the business zone) from the page props. The functions
 * read the props on every call, so they follow prop changes.
 */
export function useFormat(): Formatters {
    return createFormat(useFormatContext());
}
