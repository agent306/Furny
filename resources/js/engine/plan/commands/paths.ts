/**
 * Patch path -> changed entity id (04 §6.3), the `pathToEntityId` of the plan
 * command bus.
 */

const ENTITY_COLLECTIONS: ReadonlySet<string> = new Set([
    'nodes',
    'walls',
    'openings',
    'rooms',
    'placements',
    'fixtures',
]);
const ANNOTATION_COLLECTIONS: ReadonlySet<string> = new Set([
    'dimensions',
    'labels',
]);

/**
 * `['walls', id, ...]` -> `id`; `['annotations', 'labels' | 'dimensions', id]`
 * -> `id`; `['background', ...]` -> `'background'`; `['meta', ...]` ->
 * `'meta'`; `['view', ...]` -> `null` (ignored); a path that replaces a whole
 * collection (or the document) -> `'*'`. Anything else unknown at the top
 * level is `'*'` too, so a change is never silently ignored.
 */
export function planPathToEntityId(path: (string | number)[]): string | null {
    const [head, second, third] = path;
    if (head === 'view') return null;
    if (head === 'background' || head === 'meta') return head;
    if (typeof head === 'string' && ENTITY_COLLECTIONS.has(head)) {
        return second === undefined ? '*' : String(second);
    }
    if (head === 'annotations') {
        if (
            typeof second === 'string' &&
            ANNOTATION_COLLECTIONS.has(second) &&
            third !== undefined
        ) {
            return String(third);
        }
        return '*';
    }
    return '*';
}
