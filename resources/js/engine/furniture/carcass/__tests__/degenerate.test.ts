import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../../testing/random';
import { seedCatalog } from '../../../testing/seedCatalog';
import { generateFurniture } from '../../generate';
import type { Content, Section, SectionChild } from '../../schema';
import {
    boxDocument,
    fixed,
    flex,
    frontOn,
    leafSection,
    splitSection,
} from '../../testing/docs';

/**
 * Squeezed layouts (Task 33 M6): trees whose children find little or no room
 * must still generate, with no negative size in any part, front or section.
 */
const CONTENTS: Content[] = [
    { type: 'empty' },
    { type: 'shelves', count: 3, adjustable: true, frontSetback: 20 },
    { type: 'shelves', count: 2, adjustable: false, frontSetback: 20 },
    {
        type: 'drawers',
        count: 2,
        frontHeights: 'equal',
        slideCode: null,
        behindDoor: false,
    },
    {
        type: 'drawers',
        count: 2,
        frontHeights: 'equal',
        slideCode: 'SLD-UM-500',
        behindDoor: true,
    },
    { type: 'hanging_rod', topClearance: 60, rodCode: null },
    { type: 'pull_out_basket', count: 2, basketCode: null },
];

const pad = (n: number): string => String(n).padStart(10, '0');

describe('squeezed section trees', () => {
    it('generates no negative size from 300 random small trees', () => {
        const rnd = mulberry32(42);
        const pick = <T>(list: readonly T[]): T =>
            list[Math.floor(rnd() * list.length)] as T;
        const catalog = seedCatalog();
        const negatives: string[] = [];

        for (let iter = 0; iter < 300; iter++) {
            let nextId = 1;
            const leaves: string[] = [];
            const build = (depth: number): Section => {
                const id = `s_${pad(++nextId)}`;
                if (depth > 2 || rnd() < 0.4) {
                    leaves.push(id);
                    return leafSection(id, pick(CONTENTS));
                }
                const n = 2 + Math.floor(rnd() * 5);
                const children = Array.from(
                    { length: n },
                    (): [SectionChild['size'], Section] => [
                        rnd() < 0.3
                            ? fixed(Math.floor(rnd() * 300))
                            : flex(1 + Math.floor(rnd() * 3)),
                        build(depth + 1),
                    ],
                );
                return splitSection(
                    id,
                    rnd() < 0.5 ? 'columns' : 'rows',
                    children,
                );
            };
            const interior = { ...build(0), id: 's_0000000001' };
            const fronts = leaves
                .filter(() => rnd() < 0.3)
                .map((leaf, k) =>
                    frontOn(`fr_${pad(k + 1)}`, [leaf], {
                        overlay: pick(['full', 'half', 'inset'] as const),
                    }),
                );
            const doc = boxDocument({
                width: 150 + Math.floor(rnd() * 500),
                height: 100 + Math.floor(rnd() * 900),
                depth: 300 + Math.floor(rnd() * 400),
                interior,
                fronts,
            });

            const model = generateFurniture(doc, catalog);
            for (const part of model.parts) {
                const box =
                    part.geometry.kind === 'box' ? part.geometry.box.size : [];
                if ([part.length, part.width, ...box].some((s) => s < 0)) {
                    negatives.push(`${iter} ${part.key}`);
                }
            }
            for (const front of model.fronts) {
                if (front.rect.w < 0 || front.rect.h < 0) {
                    negatives.push(`${iter} ${front.id}`);
                }
            }
            for (const section of model.sections) {
                if (section.box.size.some((s) => s < 0)) {
                    negatives.push(`${iter} ${section.id}`);
                }
            }
        }
        expect(negatives).toEqual([]);
    });

    it('a shelf in a leaf without width is shelves_dont_fit, not a negative part', () => {
        const columns = Array.from(
            { length: 20 },
            (_, k): [SectionChild['size'], Section] => [
                flex(),
                leafSection(`s_${pad(k + 2)}`, CONTENTS[1]),
            ],
        );
        const model = generateFurniture(
            boxDocument({
                width: 300,
                height: 720,
                depth: 560,
                interior: splitSection('s_0000000001', 'columns', columns),
            }),
            seedCatalog(),
        );
        expect(
            model.issues.filter((i) => i.code === 'furniture.shelves_dont_fit'),
        ).toHaveLength(20);
        expect(model.parts.some((p) => p.key.includes('.shelf.'))).toBe(false);
    });
});
