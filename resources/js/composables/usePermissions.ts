import { usePage } from '@inertiajs/vue3';
import { computed } from 'vue';

/**
 * The part of `auth.user` this composable reads (13 §7.4, 15 §8). Declared
 * locally until Task 20 types the shared props; lists may be absent before
 * the server shares them.
 */
type PermissionUser = {
    type?: 'customer' | 'staff';
    roles?: string[];
    permissions?: string[];
    abilities?: string[];
};

export type UsePermissionsReturn = {
    /** `name` is a permission or an owner-gate ability the user passes. */
    can: (nameOrGate: string) => boolean;
    canAny: (...names: string[]) => boolean;
    /** Reactive getter: read it, do not destructure it, inside templates/computeds. */
    readonly isStaff: boolean;
    hasRole: (role: string) => boolean;
};

/**
 * Client-side display checks only (15 §8, 13 §7.4): they hide or disable UI.
 * They are NOT authorisation; every request is authorised on the server by
 * policies and gates, and a name that merely appears in `abilities` grants
 * nothing there.
 */
export function usePermissions(): UsePermissionsReturn {
    const page = usePage();
    const user = computed(
        () =>
            (page.props as { auth?: { user?: PermissionUser | null } }).auth
                ?.user ?? null,
    );
    const granted = computed(
        () =>
            new Set([
                ...(user.value?.permissions ?? []),
                ...(user.value?.abilities ?? []),
            ]),
    );

    return {
        can: (nameOrGate) => granted.value.has(nameOrGate),
        canAny: (...names) => names.some((name) => granted.value.has(name)),
        get isStaff() {
            return user.value?.type === 'staff';
        },
        hasRole: (role) => user.value?.roles?.includes(role) ?? false,
    };
}
