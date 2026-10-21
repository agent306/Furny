/**
 * Robustness on a dirty import (review focus 1): `makeDirtyPlan()` holds
 * crossing walls without a shared node, a wall overlapping another, an
 * orphan node, a window past the end of its wall and two nodes at the same
 * point. It must derive, and the everyday commands must work on it without
 * adding a `validatePlan` error, so an imported plan stays editable.
 */
import { describe, expect, it } from 'vitest';
import type { ExecuteResult } from '../../../commands/types';
import { testIds } from '../../../testing/ids';
import { derivePlanGeometry } from '../../derive';
import type { PlanDocument } from '../../schema';
import { makeDirtyPlan } from '../../testing/fixtures';
import { ok, planBus } from '../../testing/graph';
import { planErrorKeys, validatePlan } from '../../validate';

function dirty() {
    const ids = testIds();
    const doc = makeDirtyPlan(ids);
    return { doc, bus: planBus(doc, ids) };
}

const nodeAt = (doc: PlanDocument, x: number, y: number): string =>
    Object.values(doc.nodes).find((n) => n.x === x && n.y === y)!.id;

/** The wall joining the nodes at two points. */
function wallBetween(
    doc: PlanDocument,
    p: [number, number],
    q: [number, number],
): string {
    const a = nodeAt(doc, ...p);
    const b = nodeAt(doc, ...q);
    return Object.values(doc.walls).find(
        (w) => (w.a === a && w.b === b) || (w.a === b && w.b === a),
    )!.id;
}

const errorKeys = (doc: PlanDocument) => planErrorKeys(validatePlan(doc));

/** Every number under `value` (the document reference excluded). */
function numbersIn(value: unknown, out: number[] = []): number[] {
    if (typeof value === 'number') out.push(value);
    else if (Array.isArray(value)) value.forEach((v) => numbersIn(v, out));
    else if (value !== null && typeof value === 'object') {
        for (const [key, v] of Object.entries(value)) {
            if (key !== 'docRef') numbersIn(v, out);
        }
    }
    return out;
}

/** Runs a command, which must succeed and leave no error the plan did not have. */
function expectClean(
    bus: ReturnType<typeof planBus>,
    run: () => ExecuteResult<unknown>,
) {
    const before = errorKeys(bus.getDoc());
    const result = ok(run());
    const added = [...errorKeys(bus.getDoc())].filter((k) => !before.has(k));
    expect(added).toEqual([]);
    return result;
}

describe('dirty import (makeDirtyPlan)', () => {
    it('starts with the out-of-bounds window as an error', () => {
        const { doc } = dirty();
        expect([...errorKeys(doc)].map((k) => k.split('|')[0])).toEqual([
            'plan.opening_out_of_bounds',
        ]);
    });

    it('derives without throwing, with every coordinate finite', () => {
        const { doc } = dirty();
        const geom = derivePlanGeometry(doc);
        expect(geom.rooms.length).toBeGreaterThan(0);
        const numbers = numbersIn(geom);
        expect(numbers.length).toBeGreaterThan(0);
        expect(numbers.filter((v) => !Number.isFinite(v))).toEqual([]);
    });

    it('moveNode: dragging the bottom-right corner out and dropping it works', () => {
        const { doc, bus } = dirty();
        const corner = nodeAt(doc, 5000, 4000);
        expectClean(bus, () =>
            bus.execute(
                'moveNode',
                { nodeId: corner, to: { x: 5200, y: 4100 }, finalize: true },
                { merge: true },
            ),
        );
        expect(bus.getDoc().nodes[corner]).toMatchObject({ x: 5200, y: 4100 });
    });

    it('moveNode: moving an end of the crossing walls splits them at their crossing', () => {
        const { doc, bus } = dirty();
        const end = nodeAt(doc, 1000, 1000);
        const before = Object.keys(doc.walls).length;
        expectClean(bus, () =>
            bus.execute('moveNode', {
                nodeId: end,
                to: { x: 900, y: 1000 },
                finalize: true,
            }),
        );
        expect(Object.keys(bus.getDoc().walls).length).toBe(before + 2);
    });

    it('moveNode: dropping a corner of the overlapped top wall folds the duplicate piece into the overlapping wall', () => {
        for (const [x, y, to] of [
            [0, 0, { x: -300, y: 0 }],
            [5000, 0, { x: 5300, y: 0 }],
        ] as const) {
            const { doc, bus } = dirty();
            const overlapping = wallBetween(doc, [1250, 0], [3750, 0]);
            const corner = nodeAt(doc, x, y);
            expectClean(bus, () =>
                bus.execute('moveNode', {
                    nodeId: corner,
                    to,
                    finalize: true,
                }),
            );
            const after = bus.getDoc();
            // the top wall now runs corner - 1250 - 3750 - corner, its middle
            // piece being the wall that overlapped it
            const c1 = nodeAt(doc, 1250, 0);
            const c2 = nodeAt(doc, 3750, 0);
            const middle = Object.values(after.walls).filter(
                (w) => (w.a === c1 && w.b === c2) || (w.a === c2 && w.b === c1),
            );
            expect(middle.map((w) => w.id)).toEqual([overlapping]);
            expect(bus.undo()).toBe(true);
            expect(bus.getDoc()).toEqual(doc);
        }
    });

    it('moveWall: moving the left and the right wall (neighbours of the overlapped top wall) works', () => {
        for (const [p, q] of [
            [
                [0, 4000],
                [0, 0],
            ],
            [
                [5000, 0],
                [5000, 4000],
            ],
        ] as const) {
            const { doc, bus } = dirty();
            const wallId = wallBetween(doc, [...p], [...q]);
            expectClean(bus, () =>
                bus.execute('moveWall', {
                    wallId,
                    distance: 100,
                    finalize: true,
                }),
            );
            expect(bus.undo()).toBe(true);
            expect(bus.getDoc()).toEqual(doc);
        }
    });

    it('addWall: a wall across the room through the crossing works', () => {
        const { bus } = dirty();
        expectClean(bus, () =>
            bus.execute('addWall', {
                from: { point: { x: 0, y: 2000 } },
                to: { point: { x: 5000, y: 2000 } },
            }),
        );
    });

    it('deleteWalls: deleting the overlapping wall and one crossing wall works', () => {
        const { doc, bus } = dirty();
        const overlapping = wallBetween(doc, [1250, 0], [3750, 0]);
        const crossing = wallBetween(doc, [1000, 1000], [4000, 3000]);
        expectClean(bus, () =>
            bus.execute('deleteWalls', { wallIds: [overlapping, crossing] }),
        );
        expect(bus.getDoc().walls[overlapping]).toBeUndefined();
    });

    it('addOpening: a door on the bottom wall works', () => {
        const { doc, bus } = dirty();
        const bottom = wallBetween(doc, [5000, 4000], [0, 4000]);
        expectClean(bus, () =>
            bus.execute('addOpening', {
                wallId: bottom,
                kind: 'door',
                offset: 2500,
            }),
        );
    });

    it('setRoomMeta: naming a room works', () => {
        const { doc, bus } = dirty();
        const rooms = derivePlanGeometry(doc).rooms;
        const largest = [...rooms].sort((p, q) => q.areaMm2 - p.areaMm2)[0]!;
        const r = expectClean(bus, () =>
            bus.execute('setRoomMeta', {
                faceKey: largest.faceKey,
                props: { name: 'Living' },
            }),
        );
        const { metaId } = r.result as { metaId: string };
        expect(bus.getDoc().rooms[metaId]!.name).toBe('Living');
    });

    it('moveOpening fixes the window that sticks out of its wall', () => {
        const { doc, bus } = dirty();
        const window = Object.values(doc.openings).find(
            (o) => o.kind === 'window',
        )!;
        ok(
            bus.execute('moveOpening', {
                openingId: window.id,
                offset: 2000,
            }),
        );
        expect(errorKeys(bus.getDoc()).size).toBe(0);
    });
});
