import { usePage } from '@inertiajs/vue3';
import { computed } from 'vue';
import type { ComputedRef } from 'vue';
import type { LengthUnitKey } from '@/lib/lengthAdapter';

/** The viewing user's length unit; `mm` for guests and before props arrive. */
export function useLengthUnit(): ComputedRef<LengthUnitKey> {
    const page = usePage();

    return computed(() => {
        return page.props.auth?.user?.lengthUnit ?? 'mm';
    });
}
