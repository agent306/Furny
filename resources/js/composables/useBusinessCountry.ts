import { usePage } from '@inertiajs/vue3';
import { computed } from 'vue';
import type { ComputedRef } from 'vue';

/**
 * The shared prop this composable reads (15 §8): `business.defaultCountryCode`.
 * Declared locally until Task 20 types the shared props.
 */
type BusinessCountryProps = {
    business?: { defaultCountryCode?: string | null };
};

/** Used before the server shares `business` (15 §8: `?? 'IN'`). */
export const FALLBACK_COUNTRY = 'IN';

/** `business.defaultCountryCode`, upper case, e.g. `IN`. */
export function useBusinessCountry(): ComputedRef<string> {
    const page = usePage();

    return computed(() => {
        const { business } = page.props as BusinessCountryProps;

        return (business?.defaultCountryCode ?? FALLBACK_COUNTRY).toUpperCase();
    });
}
