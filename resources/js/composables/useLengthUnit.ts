import { usePage } from '@inertiajs/vue3';
import { computed } from 'vue';
import type { ComputedRef } from 'vue';
import type { LengthUnitKey } from '@/lib/lengthAdapter';

/**
 * The shared prop this composable reads (15 §8): `auth.user.lengthUnit`.
 * Declared locally until Task 20 types the shared props.
 */
type LengthUnitProps = {
    auth?: { user?: { lengthUnit?: LengthUnitKey | null } | null };
};

/** The viewing user's length unit; `mm` for guests and before props arrive. */
export function useLengthUnit(): ComputedRef<LengthUnitKey> {
    const page = usePage();

    return computed(() => {
        const { auth } = page.props as LengthUnitProps;

        return auth?.user?.lengthUnit ?? 'mm';
    });
}
