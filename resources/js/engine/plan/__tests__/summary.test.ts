import { describe, expect, it } from 'vitest';
import { derivePlanGeometry } from '../derive';
import { faceKeyFor } from '../rooms';
import { planSummary } from '../summary';
import { emptyPlan, makeGridPlan, makeRectPlan } from '../testing/fixtures';

describe('planSummary', () => {
    it('summarises a rectangular plan', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        const faceKey = faceKeyFor(Object.keys(doc.walls));
        expect(planSummary(doc)).toEqual({
            wallCount: 4,
            roomCount: 1,
            rooms: [{ id: faceKey, name: null, areaMm2: 17_982_900 }],
            totalAreaMm2: 17_982_900,
            bbox: { min: { x: -115, y: -115 }, max: { x: 5115, y: 4115 } },
        });
    });

    it('uses the meta id and name for a named room', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        doc.rooms['r_0000000001'] = {
            id: 'r_0000000001',
            anchor: { x: 2500, y: 2000 },
            name: 'Hall',
            type: 'living',
            floorFinish: 'tile',
            floorColorHex: null,
            labelOffset: null,
            showArea: true,
        };
        const summary = planSummary(doc);
        expect(summary.rooms).toEqual([
            { id: 'r_0000000001', name: 'Hall', areaMm2: 17_982_900 },
        ]);
    });

    it('describes an empty plan', () => {
        expect(planSummary(emptyPlan())).toEqual({
            wallCount: 0,
            roomCount: 0,
            rooms: [],
            totalAreaMm2: 0,
            bbox: null,
        });
    });

    it('totals the room areas and lists rooms in face-key order', () => {
        const doc = makeGridPlan(3, 2);
        const summary = planSummary(doc);
        expect(summary.wallCount).toBe(Object.keys(doc.walls).length);
        expect(summary.roomCount).toBe(6);
        expect(summary.rooms.map((r) => r.id)).toEqual(
            [...summary.rooms.map((r) => r.id)].sort(),
        );
        expect(summary.totalAreaMm2).toBe(
            summary.rooms.reduce((sum, r) => sum + r.areaMm2, 0),
        );
        expect(Number.isInteger(summary.totalAreaMm2)).toBe(true);
    });

    it('accepts precomputed geometry and returns the same result', () => {
        const doc = makeGridPlan(2, 2);
        expect(planSummary(doc, derivePlanGeometry(doc))).toEqual(
            planSummary(doc),
        );
    });

    it('has null bbox when no wall is drawable', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        for (const wall of Object.values(doc.walls)) wall.b = wall.a;
        const summary = planSummary(doc);
        expect(summary.wallCount).toBe(4);
        expect(summary.roomCount).toBe(0);
        expect(summary.bbox).toBeNull();
    });
});
