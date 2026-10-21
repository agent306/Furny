import { describe, expect, it } from 'vitest';
import { emptyPlan, makeCrossingPlan } from '../testing/fixtures';
import { planSummary } from '../summary';
import { validatePlan } from '../validate';

const codes = (doc: Parameters<typeof validatePlan>[0]): string[] =>
    validatePlan(doc).map((i) => i.code);

describe('validatePlan work budget for crossing walls', () => {
    it('caps the walls_intersect list at 200 under the bound', () => {
        // 20 horizontal x 20 vertical = 400 crossings: more than the issue cap
        const issues = validatePlan(makeCrossingPlan(40));
        expect(
            issues.filter((i) => i.code === 'plan.walls_intersect'),
        ).toHaveLength(200);
        expect(codes(makeCrossingPlan(40))).not.toContain('plan.too_large');
    });

    it('lists all crossings when there are fewer than the cap', () => {
        const issues = validatePlan(makeCrossingPlan(20));
        expect(
            issues.filter((i) => i.code === 'plan.walls_intersect'),
        ).toHaveLength(100);
    });

    it('keeps the issues of the first walls by id when it caps', () => {
        const issues = validatePlan(makeCrossingPlan(40)).filter(
            (i) => i.code === 'plan.walls_intersect',
        );
        const first = issues[0]!.entityIds;
        expect(first).toEqual(['w_0000000001', 'w_0000000002']);
    });

    it('refuses 2000 mutually crossing walls quickly, with a too_large error', () => {
        const plan = makeCrossingPlan(2000);
        const start = performance.now();
        const issues = validatePlan(plan);
        expect(performance.now() - start).toBeLessThan(2000);
        expect(
            issues.filter((i) => i.code === 'plan.walls_intersect'),
        ).toHaveLength(200);
        expect(issues.filter((i) => i.code === 'plan.too_large')).toEqual([
            expect.objectContaining({
                severity: 'error',
                params: { kind: 'crossings', count: 2001, max: 2000 },
            }),
        ]);
    });

    it('does not derive the geometry of a plan over the bound in planSummary', () => {
        const plan = makeCrossingPlan(2000);
        const start = performance.now();
        const summary = planSummary(plan);
        expect(performance.now() - start).toBeLessThan(2000);
        expect(summary).toMatchObject({
            wallCount: 2000,
            roomCount: 0,
            totalAreaMm2: 0,
            bbox: null,
        });
    });

    it('still summarises a plan under the bound', () => {
        expect(planSummary(makeCrossingPlan(20)).bbox).not.toBeNull();
        expect(planSummary(emptyPlan()).wallCount).toBe(0);
    });
});
