import type { ComputedRef, MaybeRef } from 'vue';
import { computed, inject, unref } from 'vue';

export type Density = 'comfortable' | 'compact';
export type ControlSize = 'lg' | 'default';

/** `AppShell` calls `provide(DENSITY_KEY, density)` (15 §3.3). */
export const DENSITY_KEY = 'density';

/**
 * Control size for `Button`/`Input` (`:size="controlSize"`): `lg` (h-11) in
 * comfortable density (customer app, and admin below 768 px), `default` (h-9)
 * in compact density. Without an `AppShell` the touch-friendly `lg` applies.
 */
export function useControlSize(): ComputedRef<ControlSize> {
    const density = inject<MaybeRef<Density>>(DENSITY_KEY, 'comfortable');

    return computed(() => (unref(density) === 'compact' ? 'default' : 'lg'));
}
