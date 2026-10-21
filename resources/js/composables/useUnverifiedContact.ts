import { usePage } from '@inertiajs/vue3';
import { computed } from 'vue';
import type { ComputedRef } from 'vue';

/**
 * 10 §1.1: the customer has neither a verified email nor a verified phone, so the app shows the verify-contact banner
 * and disables what needs one. Strictly `false` on both: a user whose flags are not known is not accused.
 */
export function useUnverifiedContact(): {
    unverified: ComputedRef<boolean>;
} {
    const page = usePage();

    return {
        unverified: computed(() => {
            const user = page.props.auth?.user;

            return (
                user?.type === 'customer' &&
                user.emailVerified === false &&
                user.phoneVerified === false
            );
        }),
    };
}
