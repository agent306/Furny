import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const repo = (path: string): string =>
    fileURLToPath(new URL(`../../../${path}`, import.meta.url));

/** Test-only readers of the committed `database/fixtures` documents (raw JSON, as PHP sends them). */
export const loadPlan = (name: string): Record<string, unknown> =>
    JSON.parse(
        readFileSync(repo(`database/fixtures/plans/${name}.json`), 'utf8'),
    );

export const loadFurniture = (name: string): Record<string, unknown> =>
    JSON.parse(
        readFileSync(repo(`database/fixtures/furniture/${name}.json`), 'utf8'),
    );

/** Reads `a.b.0.c` out of parsed JSON (test-only; avoids `any` on responses). */
export function get(value: unknown, path: string): unknown {
    return path
        .split('.')
        .reduce<unknown>(
            (node, key) =>
                typeof node === 'object' && node !== null
                    ? (node as Record<string, unknown>)[key]
                    : undefined,
            value,
        );
}

/** Writes `a.b.c = v` into parsed JSON (test-only). */
export function set(value: unknown, path: string, to: unknown): void {
    const keys = path.split('.');
    const last = keys.pop()!;
    const parent = keys.reduce<unknown>(
        (node, key) => (node as Record<string, unknown>)[key],
        value,
    ) as Record<string, unknown>;
    parent[last] = to;
}
