import { create } from 'mutative';
import { describe, expect, it } from 'vitest';
import { createPlanDeriver, derivePlanGeometry } from '../derive';
import type { PlanDocument, RoomMeta } from '../schema';
import { makeGridPlan, makeRectPlan } from '../testing/fixtures';

/** Deep equality with a tolerance on numbers; `docRef` is compared by identity. */
function expectGeomClose(actual: unknown, expected: unknown, path = ''): void {
    if (typeof expected === 'number') {
        expect(typeof actual, path).toBe('number');
        expect(Math.abs((actual as number) - expected), path).toBeLessThan(
            1e-6,
        );
        return;
    }
    if (Array.isArray(expected)) {
        expect(Array.isArray(actual), path).toBe(true);
        const a = actual as unknown[];
        expect(a.length, path).toBe(expected.length);
        expected.forEach((e, i) => expectGeomClose(a[i], e, `${path}[${i}]`));
        return;
    }
    if (expected !== null && typeof expected === 'object') {
        expect(actual, path).not.toBeNull();
        expect(typeof actual, path).toBe('object');
        const a = actual as Record<string, unknown>;
        const e = expected as Record<string, unknown>;
        expect(Object.keys(a).sort(), path).toEqual(Object.keys(e).sort());
        for (const k of Object.keys(e)) {
            if (k === 'docRef') expect(a[k], path).toBe(e[k]);
            else expectGeomClose(a[k], e[k], `${path}.${k}`);
        }
        return;
    }
    expect(actual, path).toBe(expected);
}

const nodeAt = (doc: PlanDocument, x: number, y: number): string =>
    Object.values(doc.nodes).find((n) => n.x === x && n.y === y)!.id;

function meta(id: string, x: number, y: number): RoomMeta {
    return {
        id,
        anchor: { x, y },
        name: id,
        type: 'bedroom',
        floorFinish: 'tile',
        floorColorHex: null,
        labelOffset: null,
        showArea: true,
    };
}

describe('createPlanDeriver', () => {
    it('returns the identical result for the same document', () => {
        const doc = makeGridPlan(7, 6);
        const deriver = createPlanDeriver();
        const first = deriver.derive(doc);
        expect(deriver.stats().fullHit).toBe(false);
        const second = deriver.derive(doc);
        expect(second).toBe(first);
        expect(deriver.stats()).toEqual({
            joins: 0,
            outlines: 0,
            roomNets: 0,
            fullHit: true,
        });
    });

    it('is a full hit when only placements or view change', () => {
        const doc = makeGridPlan(7, 6);
        const deriver = createPlanDeriver();
        const first = deriver.derive(doc);
        const next = create(doc, (d) => {
            d.view.lastMode = '3d';
            d.meta.northAngle = 15;
        });
        expect(next).not.toBe(doc);
        const second = deriver.derive(next);
        expect(deriver.stats().fullHit).toBe(true);
        expect(second.docRef).toBe(next);
        expect(first.docRef).toBe(doc);
        expect({ ...second, docRef: doc }).toEqual({ ...first });
        expect(second.walls).toBe(first.walls);
        expect(second.rooms).toBe(first.rooms);
    });

    it('recomputes only the association when only rooms change', () => {
        const doc = makeGridPlan(7, 6);
        const deriver = createPlanDeriver();
        const first = deriver.derive(doc);
        expect(first.rooms.every((r) => r.metaId === null)).toBe(true);

        const next = create(doc, (d) => {
            d.rooms['r_a'] = meta('r_a', 1500, 1500);
        });
        const second = deriver.derive(next);
        expect(deriver.stats()).toEqual({
            joins: 0,
            outlines: 0,
            roomNets: 0,
            fullHit: false,
        });
        expect(second.walls).toBe(first.walls);
        expect(second.wallsUnion).toBe(first.wallsUnion);
        expect(second.rooms.filter((r) => r.metaId === 'r_a')).toHaveLength(1);
        expect(second.roomIndexByMetaId['r_a']).toBeDefined();
        expectGeomClose(second, derivePlanGeometry(next));
    });

    it('recomputes only the neighbourhood of a moved node', () => {
        const doc = makeGridPlan(7, 6);
        const deriver = createPlanDeriver();
        deriver.derive(doc);
        const id = nodeAt(doc, 9000, 9000);
        const next = create(doc, (d) => {
            d.nodes[id]!.x += 400;
            d.nodes[id]!.y -= 250;
        });
        const result = deriver.derive(next);
        const stats = deriver.stats();
        expect(stats.fullHit).toBe(false);
        // the node and its four neighbours
        expect(stats.joins).toBeLessThanOrEqual(5);
        expect(stats.joins).toBeGreaterThan(0);
        // the rooms touching the node or one of its neighbours (12 of 42)
        expect(stats.roomNets).toBeGreaterThanOrEqual(4);
        expect(stats.roomNets).toBeLessThanOrEqual(16);
        expect(result.rooms).toHaveLength(42);
        expectGeomClose(result, derivePlanGeometry(next));
    });

    it('recomputes a single wall when an opening is added', () => {
        const doc = makeGridPlan(7, 6);
        const deriver = createPlanDeriver();
        const first = deriver.derive(doc);
        const wallId = Object.keys(doc.walls).sort()[5]!;
        const next = create(doc, (d) => {
            d.openings['o_new'] = {
                id: 'o_new',
                wallId,
                kind: 'window',
                type: 'fixed',
                offset: 1500,
                width: 1000,
                height: 1200,
                sillHeight: 900,
                hinge: 'start',
                swing: 'left',
                label: null,
            };
        });
        const second = deriver.derive(next);
        expect(deriver.stats()).toEqual({
            joins: 0,
            outlines: 1,
            roomNets: 0,
            fullHit: false,
        });
        expect(second.openings['o_new']).toBeDefined();
        expect(second.walls[wallId]!.openings.map((o) => o.id)).toContain(
            'o_new',
        );
        // outlines are untouched, so neighbours and the union are reused
        const other = Object.keys(doc.walls).sort()[6]!;
        expect(second.walls[other]!.outline).toBe(first.walls[other]!.outline);
        expect(second.wallsUnion).toBe(first.wallsUnion);
        expectGeomClose(second, derivePlanGeometry(next));
    });

    it('recomputes when a wall is removed and when a wall is retyped', () => {
        const doc = makeGridPlan(3, 3);
        const deriver = createPlanDeriver();
        deriver.derive(doc);
        const interior = Object.values(doc.walls).find(
            (w) => w.kind === 'interior',
        )!;
        const thicker = create(doc, (d) => {
            d.walls[interior.id]!.thickness = 200;
        });
        expectGeomClose(deriver.derive(thicker), derivePlanGeometry(thicker));
        expect(deriver.stats().outlines).toBeGreaterThan(0);
        const removed = create(thicker, (d) => {
            delete d.walls[interior.id];
        });
        const result = deriver.derive(removed);
        expect(result.rooms.length).toBeLessThan(9);
        expectGeomClose(result, derivePlanGeometry(removed));
    });

    it('clear() forces a full recompute', () => {
        const doc = makeGridPlan(4, 3);
        const deriver = createPlanDeriver();
        const first = deriver.derive(doc);
        deriver.clear();
        const second = deriver.derive(doc);
        const stats = deriver.stats();
        expect(second).not.toBe(first);
        expect(stats.fullHit).toBe(false);
        expect(stats.joins).toBe(Object.keys(first.nodes).length);
        expect(stats.outlines).toBe(Object.keys(first.walls).length);
        expect(stats.roomNets).toBe(first.rooms.length);
        expectGeomClose(second, first);
    });

    it('does not mix up documents that share nothing', () => {
        const deriver = createPlanDeriver();
        const a = makeRectPlan(5000, 4000, 230);
        const b = makeGridPlan(2, 2);
        expectGeomClose(deriver.derive(a), derivePlanGeometry(a));
        expectGeomClose(deriver.derive(b), derivePlanGeometry(b));
        expectGeomClose(deriver.derive(a), derivePlanGeometry(a));
    });
});
