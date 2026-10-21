import type { IdPrefix } from '../ids';

/**
 * Deterministic id factory for tests: `{prefix}_0000000001`, counting up
 * independently per prefix. Test-only; not exported from the engine index.
 */
export function testIds(): (prefix: IdPrefix) => string {
    const counters = new Map<IdPrefix, number>();
    return (prefix) => {
        const next = (counters.get(prefix) ?? 0) + 1;
        counters.set(prefix, next);
        return `${prefix}_${String(next).padStart(10, '0')}`;
    };
}
