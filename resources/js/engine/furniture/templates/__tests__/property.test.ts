/**
 * Template property test (07 §2.1 rule 3, §12.5): for every template, the
 * defaults plus 50 random parameter sets inside the declared field ranges
 * (seeded `mulberry32(42)` per template) generate a document that
 * - validates against the seed catalog with no `error` issue,
 * - has at most 400 parts,
 * - has every part `length >= width > 0`,
 * - has every rendered part inside the bounding box (+-1 mm),
 * - has no two part boxes intersecting (Task 38 helper; the grooved back may
 *   sit in the groove of the sides, top and bottom only, R40-4).
 * A failing set is reported with its parameters.
 */
import { describe, expect, it } from 'vitest';
import { testIds } from '../../../testing/ids';
import { mulberry32 } from '../../../testing/random';
import { seedCatalog } from '../../../testing/seedCatalog';
import { indexCatalog } from '../../catalogIndex';
import { MAX_PARTS } from '../../constants';
import { generateFurniture } from '../../generate';
import { TEMPLATE_KEYS, type FurnitureDocument } from '../../schema';
import { partOverlaps, sameDrawerBox } from '../../testing/overlaps';
import type { Part } from '../../types';
import { validateFurniture } from '../../validate';
import { getTemplate } from '../index';
import type { ParamField, TemplateDefinition } from '../types';

const snapshot = seedCatalog();
const catalog = indexCatalog(snapshot);

const RANDOM_SETS = 50;
const SEED = 42;
/** Share of `allowAuto` ints drawn as `'auto'`. */
const AUTO_SHARE = 0.25;
/** Parts may stick out of the bounding box by this much (rounding). */
const BBOX_TOLERANCE = 1;

const pick = <T>(rand: () => number, values: readonly T[]): T =>
    values[Math.floor(rand() * values.length)] as T;

/** One value inside the field's declared range. */
function randomValue(field: ParamField, rand: () => number): unknown {
    switch (field.kind) {
        case 'length': {
            const steps = Math.floor((field.max - field.min) / field.step);
            return field.min + Math.floor(rand() * (steps + 1)) * field.step;
        }
        case 'int':
            if (field.allowAuto && rand() < AUTO_SHARE) return 'auto';
            return field.min + Math.floor(rand() * (field.max - field.min + 1));
        case 'select':
            return pick(rand, field.options).value;
        case 'boolean':
            return rand() < 0.5;
    }
}

function randomParams(
    template: TemplateDefinition,
    rand: () => number,
): Record<string, unknown> {
    const params: Record<string, unknown> = { ...template.defaults };
    for (const field of template.fields) {
        params[field.key] = randomValue(field, rand);
    }
    return params;
}

/** Axis-aligned extent of a part's rendered geometry. */
function extentOf(part: Part): { min: number[]; max: number[] } {
    const g = part.geometry;
    if (g.kind === 'box') {
        return {
            min: [...g.box.min],
            max: g.box.min.map((m, i) => m + (g.box.size[i] ?? 0)),
        };
    }
    const xs = g.outline.map(([x]) => x);
    const zs = g.outline.map(([, z]) => z);
    return {
        min: [Math.min(...xs), g.y, Math.min(...zs)],
        max: [Math.max(...xs), g.y + g.thickness, Math.max(...zs)],
    };
}

/** The grooved back's tongue sits in the sides, top and bottom (07 §3.4). */
const TONGUE_PARTNER = /^carcass\.(side\.(left|right)|top|bottom)(\.\d+)?$/;
const isBack = (part: Part): boolean =>
    /^carcass\.back(\.\d+)?$/.test(part.key);

/** Every way `doc` breaks the §12.5 properties, as readable lines. */
function problemsOf(doc: FurnitureDocument): string[] {
    const problems: string[] = [];
    for (const issue of validateFurniture(doc, snapshot)) {
        if (issue.severity === 'error') {
            problems.push(`${issue.code} ${JSON.stringify(issue.params)}`);
        }
    }

    const model = generateFurniture(doc, snapshot);
    const count = model.parts.reduce((total, p) => total + p.qty, 0);
    if (count > MAX_PARTS) problems.push(`${count} parts`);

    const size = model.bbox.size;
    for (const part of model.parts) {
        if (!(part.length >= part.width && part.width > 0)) {
            problems.push(`${part.key} is ${part.length} x ${part.width}`);
        }
        const { min, max } = extentOf(part);
        const outside = [0, 1, 2].some(
            (i) =>
                (min[i] ?? 0) < -BBOX_TOLERANCE ||
                (max[i] ?? 0) > (size[i] ?? 0) + BBOX_TOLERANCE,
        );
        if (outside) {
            problems.push(
                `${part.key} [${min.join(', ')}]..[${max.join(', ')}] is outside the bbox`,
            );
        }
    }

    const grooved = doc.carcass?.back.type === 'grooved';
    const inGroove = (a: Part, b: Part): boolean =>
        grooved &&
        ((isBack(a) && TONGUE_PARTNER.test(b.key)) ||
            (isBack(b) && TONGUE_PARTNER.test(a.key)));
    problems.push(
        ...partOverlaps(model.parts, {
            ignore: (a, b) => sameDrawerBox(a, b) || inGroove(a, b),
        }).map((overlap) => `overlap ${overlap}`),
    );
    return problems;
}

interface Failure {
    params: Record<string, unknown>;
    problems: string[];
}

function failuresOf(
    template: TemplateDefinition,
    sets: Array<Record<string, unknown>>,
): Failure[] {
    const failures: Failure[] = [];
    for (const params of sets) {
        // The sets must be valid parameters: the schema ranges equal the fields.
        const parsed = template.paramsSchema.safeParse(params);
        if (!parsed.success) {
            failures.push({ params, problems: ['paramsSchema rejects'] });
            continue;
        }
        const doc = template.generate(parsed.data, {
            catalog,
            newId: testIds(),
        });
        const problems = problemsOf(doc);
        if (problems.length > 0) failures.push({ params, problems });
    }
    return failures;
}

describe('template property test (07 §12.5)', () => {
    it('covers all 19 templates', () => {
        expect(TEMPLATE_KEYS.map((key) => getTemplate(key).key)).toStrictEqual([
            ...TEMPLATE_KEYS,
        ]);
    });

    describe.each(TEMPLATE_KEYS)('%s', (key) => {
        it('defaults: no error, <= 400 parts, sizes, inside the bbox, no overlap', () => {
            const template = getTemplate(key);
            const failures = failuresOf(template, [{ ...template.defaults }]);
            expect(failures, JSON.stringify(failures)).toStrictEqual([]);
        });

        it(`${RANDOM_SETS} random in-range parameter sets (mulberry32(${SEED}))`, () => {
            const template = getTemplate(key);
            const rand = mulberry32(SEED);
            const sets = Array.from({ length: RANDOM_SETS }, () =>
                randomParams(template, rand),
            );
            const failures = failuresOf(template, sets);
            expect(failures, JSON.stringify(failures, null, 1)).toStrictEqual(
                [],
            );
        });
    });
});
