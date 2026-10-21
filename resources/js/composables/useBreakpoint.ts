import { breakpointsTailwind, useBreakpoints } from '@vueuse/core';
import type { ComputedRef } from 'vue';
import { computed } from 'vue';

export type UseBreakpointReturn = {
    /** < 768 px: view, approve, chat; editors are view-only. */
    isPhone: ComputedRef<boolean>;
    /** 768-1023 px: full editing, sidebars collapse to sheets. */
    isTablet: ComputedRef<boolean>;
    /** >= 1024 px: persistent sidebars and inspectors. */
    isDesktop: ComputedRef<boolean>;
    /** Capability check for editors (15 §6); never sniff the user agent. */
    canEdit: ComputedRef<boolean>;
};

/** Product breakpoints of 15 §6, on top of the Tailwind defaults. */
export function useBreakpoint(): UseBreakpointReturn {
    const breakpoints = useBreakpoints(breakpointsTailwind);
    const fromTablet = breakpoints.greaterOrEqual('md');
    const fromDesktop = breakpoints.greaterOrEqual('lg');

    return {
        isPhone: computed(() => !fromTablet.value),
        isTablet: computed(() => fromTablet.value && !fromDesktop.value),
        isDesktop: computed(() => fromDesktop.value),
        canEdit: computed(() => fromTablet.value),
    };
}
