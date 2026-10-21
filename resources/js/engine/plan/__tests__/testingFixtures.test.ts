import { describe, expect, it } from 'vitest';
import { intersectSegments } from '../../geometry/segment';
import { PlanDocumentSchema, type PlanDocument } from '../schema';
import {
    emptyPlan,
    makeDirtyPlan,
    makeGridPlan,
    makeLPlan,
    makeRectPlan,
} from '../testing/fixtures';

function wallPoints(doc: PlanDocument, wallId: string) {
    const wall = doc.walls[wallId];
    if (!wall) throw new Error(`no wall ${wallId}`);
    const a = doc.nodes[wall.a];
    const b = doc.nodes[wall.b];
    if (!a || !b) throw new Error(`wall ${wallId} has a missing node`);
    return { wall, a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y } };
}

function wallLength(doc: PlanDocument, wallId: string): number {
    const { a, b } = wallPoints(doc, wallId);
    return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Wall endpoints as "x,y>x,y" strings in wall id order. */
function describeWalls(doc: PlanDocument): string[] {
    return Object.keys(doc.walls)
        .sort()
        .map((id) => {
            const { a, b } = wallPoints(doc, id);
            return `${a.x},${a.y}>${b.x},${b.y}`;
        });
}

describe('emptyPlan', () => {
    it('has no entities and the default meta', () => {
        const doc = emptyPlan();
        expect(doc.meta).toEqual({
            defaultWallHeight: 2700,
            defaultWallThickness: 115,
            floorThickness: 150,
            northAngle: null,
            createdWith: 'editor',
        });
        expect(Object.keys(doc.walls)).toEqual([]);
        expect(doc.background).toBeNull();
        expect(doc.view).toEqual({
            mode2d: null,
            mode3d: null,
            lastMode: '2d',
        });
    });

    it('overrides meta fields', () => {
        expect(
            emptyPlan({ createdWith: 'import', northAngle: 90 }).meta,
        ).toMatchObject({
            createdWith: 'import',
            northAngle: 90,
            defaultWallHeight: 2700,
        });
    });
});

describe('makeRectPlan', () => {
    it('builds 4 nodes and 4 exterior walls in cyclic order', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        expect(Object.values(doc.nodes).map((n) => [n.x, n.y])).toEqual([
            [0, 0],
            [5000, 0],
            [5000, 4000],
            [0, 4000],
        ]);
        expect(describeWalls(doc)).toEqual([
            '0,0>5000,0',
            '5000,0>5000,4000',
            '5000,4000>0,4000',
            '0,4000>0,0',
        ]);
        for (const wall of Object.values(doc.walls)) {
            expect(wall).toMatchObject({
                thickness: 230,
                kind: 'exterior',
                height: 2700,
            });
        }
        expect(doc.meta.createdWith).toBe('editor');
    });

    it('is deterministic and uses prefixed ids', () => {
        expect(makeRectPlan(1000, 1000, 115)).toEqual(
            makeRectPlan(1000, 1000, 115),
        );
        expect(Object.keys(makeRectPlan(1000, 1000, 115).nodes)[0]).toBe(
            'n_0000000001',
        );
    });
});

describe('makeLPlan', () => {
    const doc = makeLPlan();

    it('has the specified nodes and walls', () => {
        expect(Object.values(doc.nodes).map((n) => [n.x, n.y])).toEqual([
            [0, 0],
            [5000, 0],
            [8000, 0],
            [8000, 3500],
            [5000, 3500],
            [5000, 6000],
            [0, 6000],
        ]);
        expect(describeWalls(doc)).toEqual([
            '0,0>5000,0',
            '5000,0>8000,0',
            '8000,0>8000,3500',
            '8000,3500>5000,3500',
            '5000,3500>5000,6000',
            '5000,6000>0,6000',
            '0,6000>0,0',
            '5000,0>5000,3500',
        ]);
        const walls = Object.values(doc.walls);
        expect(
            walls.filter((w) => w.kind === 'exterior' && w.thickness === 230),
        ).toHaveLength(7);
        expect(
            walls.filter((w) => w.kind === 'interior' && w.thickness === 115),
        ).toHaveLength(1);
    });

    it('has two doors and two windows with the specified placement', () => {
        const rows = Object.values(doc.openings).map((o) => {
            const { a, b } = wallPoints(doc, o.wallId);
            return [
                o.kind,
                o.type,
                `${a.x},${a.y}>${b.x},${b.y}`,
                o.offset,
                o.width,
            ];
        });
        expect(rows).toEqual([
            ['door', 'single_swing', '5000,0>5000,3500', 1750, 900],
            ['door', 'main_entrance', '5000,6000>0,6000', 2500, 1000],
            ['window', 'casement', '0,0>5000,0', 2500, 1500],
            ['window', 'casement', '8000,0>8000,3500', 1750, 1200],
        ]);
        for (const o of Object.values(doc.openings)) {
            if (o.kind === 'window')
                expect(o).toMatchObject({ sillHeight: 900, height: 1200 });
            else expect(o).toMatchObject({ sillHeight: 0, height: 2100 });
            const half = o.width / 2;
            expect(o.offset - half).toBeGreaterThanOrEqual(0);
            expect(o.offset + half).toBeLessThanOrEqual(
                wallLength(doc, o.wallId),
            );
        }
    });
});

describe('makeGridPlan', () => {
    it('(7, 6) has 97 walls, 40 openings and 8 x 7 nodes', () => {
        const doc = makeGridPlan(7, 6);
        expect(Object.keys(doc.nodes)).toHaveLength(56);
        expect(Object.keys(doc.walls)).toHaveLength(97);
        expect(Object.keys(doc.openings)).toHaveLength(40);
    });

    it('(22, 22) has 1012 walls', () => {
        expect(Object.keys(makeGridPlan(22, 22).walls)).toHaveLength(1012);
    });

    it('(3, 3) has 24 walls and a door on each of its 12 interior walls', () => {
        const doc = makeGridPlan(3, 3);
        expect(Object.keys(doc.walls)).toHaveLength(24);
        expect(Object.keys(doc.openings)).toHaveLength(12);
    });

    it('orders nodes row by row and creates horizontal walls before vertical ones', () => {
        const doc = makeGridPlan(2, 1, 1000);
        expect(Object.values(doc.nodes).map((n) => [n.x, n.y])).toEqual([
            [0, 0],
            [1000, 0],
            [2000, 0],
            [0, 1000],
            [1000, 1000],
            [2000, 1000],
        ]);
        expect(describeWalls(doc)).toEqual([
            '0,0>1000,0',
            '1000,0>2000,0',
            '0,1000>1000,1000',
            '1000,1000>2000,1000',
            '0,0>0,1000',
            '1000,0>1000,1000',
            '2000,0>2000,1000',
        ]);
    });

    it('uses exterior 230 on the boundary, interior 115 elsewhere', () => {
        const doc = makeGridPlan(7, 6);
        const walls = Object.values(doc.walls);
        expect(walls.filter((w) => w.kind === 'exterior')).toHaveLength(26);
        expect(
            walls
                .filter((w) => w.kind === 'exterior')
                .every((w) => w.thickness === 230),
        ).toBe(true);
        const interior = walls.filter((w) => w.kind === 'interior');
        expect(interior).toHaveLength(71);
        expect(interior.every((w) => w.thickness === 115)).toBe(true);
    });

    it('puts a centred 900 x 2100 single_swing door on the first 40 interior walls by id', () => {
        const doc = makeGridPlan(7, 6, 3000);
        const interiorIds = Object.values(doc.walls)
            .filter((w) => w.kind === 'interior')
            .map((w) => w.id)
            .sort();
        const doorWallIds = Object.values(doc.openings)
            .map((o) => o.wallId)
            .sort();
        expect(doorWallIds).toEqual(interiorIds.slice(0, 40));
        for (const o of Object.values(doc.openings)) {
            expect(o).toMatchObject({
                kind: 'door',
                type: 'single_swing',
                width: 900,
                height: 2100,
                sillHeight: 0,
                offset: 1500,
            });
        }
    });

    it('honours a custom cell size', () => {
        const doc = makeGridPlan(2, 2, 4000);
        expect(Math.max(...Object.values(doc.nodes).map((n) => n.x))).toBe(
            8000,
        );
        expect(
            Object.values(doc.openings).every((o) => o.offset === 2000),
        ).toBe(true);
    });
});

describe('makeDirtyPlan', () => {
    const doc = makeDirtyPlan();

    it('is schema-valid', () => {
        expect(PlanDocumentSchema.safeParse(doc).success).toBe(true);
    });

    it('contains the rect plan unchanged plus the dirt', () => {
        const rect = makeRectPlan(5000, 4000, 230);
        for (const [id, wall] of Object.entries(rect.walls)) {
            expect(doc.walls[id]).toEqual(wall);
        }
        expect(Object.keys(doc.walls)).toHaveLength(4 + 2 + 1 + 2);
        expect(Object.keys(doc.nodes)).toHaveLength(4 + 4 + 2 + 1 + 4);
    });

    it('(a) has two walls crossing without a shared node', () => {
        const interior = Object.keys(doc.walls).filter(
            (id) => doc.walls[id]?.thickness === 115,
        );
        const crossing = interior.slice(0, 2).map((id) => wallPoints(doc, id));
        const [first, second] = crossing;
        if (!first || !second) throw new Error('missing walls');
        expect(
            new Set([first.wall.a, first.wall.b, second.wall.a, second.wall.b])
                .size,
        ).toBe(4);
        const hit = intersectSegments(
            { a: first.a, b: first.b },
            { a: second.a, b: second.b },
        );
        expect(hit.kind).toBe('point');
    });

    it('(b) has a wall collinear with and overlapping half of the top wall', () => {
        const [topId] = Object.keys(doc.walls);
        const interior = Object.keys(doc.walls).filter(
            (id) => doc.walls[id]?.thickness === 115,
        );
        const top = wallPoints(doc, topId ?? '');
        const half = wallPoints(doc, interior[2] ?? '');
        const hit = intersectSegments(
            { a: top.a, b: top.b },
            { a: half.a, b: half.b },
        );
        expect(hit.kind).toBe('overlap');
        expect(wallLength(doc, interior[2] ?? '')).toBe(
            wallLength(doc, topId ?? '') / 2,
        );
    });

    it('(c) has exactly one orphan node', () => {
        const used = new Set(
            Object.values(doc.walls).flatMap((w) => [w.a, w.b]),
        );
        expect(
            Object.keys(doc.nodes).filter((id) => !used.has(id)),
        ).toHaveLength(1);
    });

    it('(d) has a window ending 200 mm past its wall end', () => {
        const openings = Object.values(doc.openings);
        expect(openings).toHaveLength(1);
        const [window] = openings;
        if (!window) throw new Error('no window');
        expect(window.kind).toBe('window');
        expect(
            window.offset + window.width / 2 - wallLength(doc, window.wallId),
        ).toBe(200);
    });

    it('(e) has two distinct nodes at identical coordinates, each used by its own wall', () => {
        const byPos = new Map<string, string[]>();
        for (const n of Object.values(doc.nodes)) {
            const key = `${n.x},${n.y}`;
            byPos.set(key, [...(byPos.get(key) ?? []), n.id]);
        }
        const twins = [...byPos.values()].filter((ids) => ids.length === 2);
        expect(twins).toHaveLength(1);
        for (const id of twins[0] ?? []) {
            const walls = Object.values(doc.walls).filter(
                (w) => w.a === id || w.b === id,
            );
            expect(walls).toHaveLength(1);
        }
    });
});
