import { usePage } from '@inertiajs/vue3';
import { computed } from 'vue';
import type { ComputedRef } from 'vue';

/** Used before the server shares `business` (15 §8: `?? 'IN'`). */
export const FALLBACK_COUNTRY = 'IN';

/** `business.defaultCountryCode`, upper case, e.g. `IN`. */
export function useBusinessCountry(): ComputedRef<string> {
    const page = usePage();

    return computed(() => {
        const { business } = page.props;

        return (business?.defaultCountryCode ?? FALLBACK_COUNTRY).toUpperCase();
    });
}
