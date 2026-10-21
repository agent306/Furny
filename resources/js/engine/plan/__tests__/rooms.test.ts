import { describe, expect, it } from 'vitest';
import { cyrb53 } from '../../geometry/hash';
import { area, signedArea } from '../../geometry/polygon';
import { MIN_ROOM_NET_AREA } from '../../geometry/tolerance';
import { derivePlanGeometry, type DerivedPlan } from '../derive';
import { associateRoomMetas, detectRooms, faceKeyFor } from '../rooms';
import type { PlanDocument, RoomMeta } from '../schema';
import {
    emptyPlan,
    makeGridPlan,
    makeLPlan,
    makeRectPlan,
} from '../testing/fixtures';
import { buildWallGraph } from '../walls';

type NodeSpec = readonly [number, number];
/** `[nodeIndexA, nodeIndexB, thickness]` with node indices into the node list. */
type WallSpec = readonly [number, number, number?];

function build(nodes: NodeSpec[], walls: WallSpec[]): PlanDocument {
    const doc = emptyPlan();
    nodes.forEach(([x, y], i) => {
        doc.nodes[`n${i}`] = { id: `n${i}`, x, y };
    });
    walls.forEach(([a, b, t = 115], i) => {
        doc.walls[`w${i}`] = {
            id: `w${i}`,
            a: `n${a}`,
            b: `n${b}`,
            thickness: t,
            height: 2700,
            kind: 'interior',
            justification: 'center',
            material: 'brick',
            colorHex: null,
        };
    });
    return doc;
}

function addMeta(
    doc: PlanDocument,
    id: string,
    x: number,
    y: number,
    extra: Partial<RoomMeta> = {},
): void {
    doc.rooms[id] = {
        id,
        anchor: { x, y },
        name: id,
        type: 'bedroom',
        floorFinish: 'tile',
        floorColorHex: null,
        labelOffset: null,
        showArea: true,
        ...extra,
    };
}

const RECT: NodeSpec[] = [
    [0, 0],
    [4000, 0],
    [4000, 4000],
    [0, 4000],
];
const RECT_WALLS: WallSpec[] = [
    [0, 1, 230],
    [1, 2, 230],
    [2, 3, 230],
    [3, 0, 230],
];

function wallsUnionArea(plan: DerivedPlan): number {
    return plan.wallsUnion.reduce((s, p) => s + area(p), 0);
}

describe('faceKeyFor', () => {
    it('hashes the sorted unique ids', () => {
        expect(faceKeyFor(['b', 'a', 'b'])).toBe(
            `fk_${cyrb53('a|b').toString(36)}`,
        );
        expect(faceKeyFor(['a', 'b'])).toBe(faceKeyFor(['b', 'a']));
    });
});

describe('detectRooms', () => {
    it('finds one room in a rectangular plan', () => {
        const plan = derivePlanGeometry(makeRectPlan(5000, 4000, 230));
        expect(plan.rooms).toHaveLength(1);
        const r = plan.rooms[0]!;
        expect(r.areaMm2).toBeCloseTo(17_982_900, 0);
        expect(r.netRect!.width).toBeCloseTo(4770, 3);
        expect(r.netRect!.depth).toBeCloseTo(3770, 3);
        expect(r.perimeterMm).toBe(2 * (4770 + 3770));
        expect(r.polygon).toHaveLength(4);
        expect(signedArea(r.polygon)).toBeGreaterThan(0);
        expect(r.holes).toEqual([]);
        expect(r.metaId).toBeNull();
        expect(r.centroid.x).toBeCloseTo(2500, 3);
        expect(r.centroid.y).toBeCloseTo(2000, 3);
        expect(r.wallIds).toHaveLength(4);
        expect(r.wallIds).toEqual([...r.wallIds].sort());
        expect(r.faceKey).toBe(faceKeyFor(r.wallIds));
        expect(r.labelRadius).toBeGreaterThan(0);
        expect(plan.roomIndexByFaceKey[r.faceKey]).toBe(0);
    });

    it('is exposed as a pure function returning the same rooms', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        const plan = derivePlanGeometry(doc);
        const rooms = detectRooms(
            doc,
            buildWallGraph(doc),
            plan.wallsUnion,
            plan.walls,
        );
        expect(rooms.map((r) => r.faceKey)).toEqual(
            plan.rooms.map((r) => r.faceKey),
        );
        expect(rooms[0]!.areaMm2).toBe(plan.rooms[0]!.areaMm2);
    });

    it('finds the two rooms of the L plan, the larger one not a rectangle', () => {
        const plan = derivePlanGeometry(makeLPlan());
        expect(plan.rooms).toHaveLength(2);
        const areas = plan.rooms.map((r) => r.areaMm2).sort((a, b) => b - a);
        expect(Math.abs(areas[0]! - 27_717_538)).toBeLessThanOrEqual(1);
        expect(Math.abs(areas[1]! - 9_245_925)).toBeLessThanOrEqual(1);
        const large = plan.rooms.find((r) => r.areaMm2 === areas[0])!;
        const small = plan.rooms.find((r) => r.areaMm2 === areas[1])!;
        expect(large.netRect).toBeNull();
        expect(small.netRect).not.toBeNull();
    });

    it('conserves area on the 7 x 6 grid', () => {
        const plan = derivePlanGeometry(makeGridPlan(7, 6));
        expect(plan.rooms).toHaveLength(42);
        const net = plan.rooms.reduce((s, r) => s + r.areaMm2, 0);
        const outline = Math.abs(signedArea(plan.exteriorOutline!));
        expect(
            Math.abs(net + wallsUnionArea(plan) - outline) / outline,
        ).toBeLessThan(0.001);
        const keys = plan.rooms.map((r) => r.faceKey);
        expect(keys).toEqual([...keys].sort());
        expect(new Set(keys).size).toBe(42);
    });

    it('gives a free-standing box its own room and a hole to the outer room', () => {
        const doc = build(
            [
                [0, 0],
                [10000, 0],
                [10000, 8000],
                [0, 8000],
                [4000, 3000],
                [6000, 3000],
                [6000, 5000],
                [4000, 5000],
            ],
            [
                [0, 1, 230],
                [1, 2, 230],
                [2, 3, 230],
                [3, 0, 230],
                [4, 5],
                [5, 6],
                [6, 7],
                [7, 4],
            ],
        );
        const plan = derivePlanGeometry(doc);
        expect(plan.rooms).toHaveLength(2);
        const outer = plan.rooms.find((r) => r.holes.length === 1)!;
        const inner = plan.rooms.find((r) => r.holes.length === 0)!;
        expect(signedArea(outer.holes[0]!)).toBeLessThan(0);
        expect(inner.areaMm2).toBeCloseTo((2000 - 115) ** 2, 0);
        expect(outer.areaMm2).toBeCloseTo(
            (10000 - 230) * (8000 - 230) - (2000 + 115) ** 2,
            0,
        );
        expect(outer.wallIds).toHaveLength(8);
        // the hole walls are not part of the outer cycle, so the key is the outer 4
        expect(outer.faceKey).toBe(faceKeyFor(['w0', 'w1', 'w2', 'w3']));
        expect(inner.faceKey).toBe(faceKeyFor(['w4', 'w5', 'w6', 'w7']));
    });

    it('keeps one room for a dangling wall and notches its net polygon', () => {
        const doc = build([...RECT, [0, 2000], [1500, 2000]] as NodeSpec[], [
            ...RECT_WALLS,
            [4, 5],
        ]);
        // attach the dangling wall to the left wall by sharing its geometry:
        // node 4 lies on the wall (0,0)-(0,4000) and is split by the planar graph
        const plan = derivePlanGeometry(doc);
        expect(plan.rooms).toHaveLength(1);
        expect(plan.rooms[0]!.polygon.length).toBeGreaterThan(4);
        expect(plan.rooms[0]!.netRect).toBeNull();
        const full = (4000 - 230) ** 2;
        expect(plan.rooms[0]!.areaMm2).toBeLessThan(full);
    });

    it('splits a square cut by two walls without a centre node into four rooms', () => {
        const doc = build(
            [
                ...RECT,
                [2000, 0],
                [2000, 4000],
                [0, 2000],
                [4000, 2000],
            ] as NodeSpec[],
            [...RECT_WALLS, [4, 5], [6, 7]],
        );
        const plan = derivePlanGeometry(doc);
        expect(plan.rooms).toHaveLength(4);
        const keys = new Set(plan.rooms.map((r) => r.faceKey));
        expect(keys.size).toBe(4);
    });

    it('drops thin faces between near-parallel walls', () => {
        // two parallel 115 mm walls whose centre lines are 120 mm apart
        const doc = build(
            [
                ...RECT,
                [1000, 0],
                [1000, 4000],
                [1120, 0],
                [1120, 4000],
            ] as NodeSpec[],
            [...RECT_WALLS, [4, 5], [6, 7]],
        );
        const plan = derivePlanGeometry(doc);
        // the strip is 5 mm wide: its net area (about 18 850 mm²) is below the minimum
        expect(MIN_ROOM_NET_AREA).toBe(40_000);
        expect(plan.rooms).toHaveLength(2);
        for (const r of plan.rooms) {
            expect(r.areaMm2).toBeGreaterThanOrEqual(MIN_ROOM_NET_AREA);
        }
    });

    it('keeps the faceKey when a node moves or a thickness changes, not when a wall is split', () => {
        const base = makeRectPlan(5000, 4000, 230);
        const key = derivePlanGeometry(base).rooms[0]!.faceKey;

        const moved = structuredClone(base);
        const nid = Object.keys(moved.nodes)[2]!;
        moved.nodes[nid]!.x += 100;
        expect(derivePlanGeometry(moved).rooms[0]!.faceKey).toBe(key);

        const thick = structuredClone(base);
        thick.walls[Object.keys(thick.walls)[0]!]!.thickness = 300;
        expect(derivePlanGeometry(thick).rooms[0]!.faceKey).toBe(key);

        const split = structuredClone(base);
        const wid = Object.keys(split.walls)[0]!;
        const w = split.walls[wid]!;
        split.nodes.nsplit = { id: 'nsplit', x: 2500, y: 0 };
        split.walls.wsplit = { ...w, id: 'wsplit', a: 'nsplit' };
        w.b = 'nsplit';
        const splitRooms = derivePlanGeometry(split).rooms;
        expect(splitRooms).toHaveLength(1);
        expect(splitRooms[0]!.faceKey).not.toBe(key);
    });

    it('does not mutate the document', () => {
        const doc = makeGridPlan(3, 3);
        const copy = structuredClone(doc);
        derivePlanGeometry(doc);
        expect(doc).toEqual(copy);
    });

    it('is deterministic', () => {
        const doc = makeGridPlan(4, 3);
        expect(derivePlanGeometry(doc).rooms).toEqual(
            derivePlanGeometry(doc).rooms,
        );
    });

    it('never emits -0 in room geometry', () => {
        const plan = derivePlanGeometry(makeRectPlan(5000, 4000, 230));
        const r = plan.rooms[0]!;
        const pts = [...r.polygon, r.centroid, r.labelPoint];
        for (const p of pts) {
            expect(Object.is(p.x, -0)).toBe(false);
            expect(Object.is(p.y, -0)).toBe(false);
        }
    });
});

describe('wall sides', () => {
    it('marks the exterior side of every wall of a rect plan', () => {
        const plan = derivePlanGeometry(makeRectPlan(5000, 4000, 230));
        const key = plan.rooms[0]!.faceKey;
        for (const w of Object.values(plan.walls)) {
            const sides = [w.leftRoomKey, w.rightRoomKey];
            expect(sides.filter((k) => k === key)).toHaveLength(1);
            expect(sides.filter((k) => k === null)).toHaveLength(1);
            expect(w.exteriorSide).toBe(
                w.leftRoomKey === null ? 'left' : 'right',
            );
        }
        // the top wall runs west to east, so the room lies on its -n (right) side
        const top = Object.values(plan.walls).find(
            (w) => w.centerline[0].y === 0 && w.centerline[1].y === 0,
        )!;
        expect(top.rightRoomKey).toBe(key);
        expect(top.exteriorSide).toBe('left');
    });

    it('gives interior grid walls both room keys', () => {
        const plan = derivePlanGeometry(makeGridPlan(3, 3));
        const keys = new Set(plan.rooms.map((r) => r.faceKey));
        let interior = 0;
        let exterior = 0;
        for (const w of Object.values(plan.walls)) {
            if (w.kind === 'interior') {
                interior += 1;
                expect(keys.has(w.leftRoomKey!)).toBe(true);
                expect(keys.has(w.rightRoomKey!)).toBe(true);
                expect(w.leftRoomKey).not.toBe(w.rightRoomKey);
                expect(w.exteriorSide).toBeNull();
            } else {
                exterior += 1;
                expect(w.exteriorSide).not.toBeNull();
            }
        }
        expect(interior).toBe(12);
        expect(exterior).toBe(12);
    });

    it('uses the face of the longest sub-edge for a wall crossed without a node', () => {
        const doc = build(
            [
                ...RECT,
                [2000, 0],
                [2000, 4000],
                [0, 2000],
                [4000, 2000],
            ] as NodeSpec[],
            [...RECT_WALLS, [4, 5], [6, 7]],
        );
        const plan = derivePlanGeometry(doc);
        const keys = new Set(plan.rooms.map((r) => r.faceKey));
        const w4 = plan.walls.w4!;
        expect(keys.has(w4.leftRoomKey!)).toBe(true);
        expect(keys.has(w4.rightRoomKey!)).toBe(true);
    });
});

describe('associateRoomMetas', () => {
    it('attaches a meta whose anchor is inside', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        addMeta(doc, 'r_a', 2500, 2000);
        const plan = derivePlanGeometry(doc);
        expect(plan.rooms[0]!.metaId).toBe('r_a');
        expect(plan.roomIndexByMetaId).toEqual({ r_a: 0 });
        expect(
            plan.issues.filter((i) => i.code === 'room_meta_duplicate'),
        ).toEqual([]);
    });

    it('keeps the smallest id of two metas in one room and warns', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        addMeta(doc, 'r_b', 1000, 1000);
        addMeta(doc, 'r_a', 3000, 3000);
        const plan = derivePlanGeometry(doc);
        expect(plan.rooms[0]!.metaId).toBe('r_a');
        expect(plan.roomIndexByMetaId).toEqual({ r_a: 0 });
        const dup = plan.issues.filter((i) => i.code === 'room_meta_duplicate');
        expect(dup).toHaveLength(1);
        expect(dup[0]).toMatchObject({
            severity: 'warning',
            messageKey: 'engine.plan.derive.room_meta_duplicate',
            entityIds: ['r_b', 'r_a'],
        });
    });

    it('orphans a meta outside every face', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        addMeta(doc, 'r_out', 9000, 9000);
        const plan = derivePlanGeometry(doc);
        expect(plan.rooms[0]!.metaId).toBeNull();
        expect(plan.roomIndexByMetaId).toEqual({});
    });

    it('treats an island interior as its own room, not the outer room', () => {
        const doc = build(
            [
                [0, 0],
                [10000, 0],
                [10000, 8000],
                [0, 8000],
                [4000, 3000],
                [6000, 3000],
                [6000, 5000],
                [4000, 5000],
            ],
            [
                [0, 1, 230],
                [1, 2, 230],
                [2, 3, 230],
                [3, 0, 230],
                [4, 5],
                [5, 6],
                [6, 7],
                [7, 4],
            ],
        );
        addMeta(doc, 'r_in', 5000, 4000);
        addMeta(doc, 'r_out', 1000, 1000);
        const plan = derivePlanGeometry(doc);
        expect(
            plan.issues.filter((i) => i.code === 'room_meta_duplicate'),
        ).toEqual([]);
        const inner = plan.rooms.find((r) => r.metaId === 'r_in')!;
        expect(inner.holes).toHaveLength(0);
        expect(
            plan.rooms.find((r) => r.metaId === 'r_out')!.holes,
        ).toHaveLength(1);
    });

    it('places the label at the centroid plus labelOffset, else at the pole', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        addMeta(doc, 'r_a', 2500, 2000, { labelOffset: { x: 300, y: -200 } });
        const plan = derivePlanGeometry(doc);
        const r = plan.rooms[0]!;
        expect(r.labelPoint.x).toBeCloseTo(r.centroid.x + 300, 6);
        expect(r.labelPoint.y).toBeCloseTo(r.centroid.y - 200, 6);
        expect(r.labelRadius).toBeGreaterThan(0);

        const auto = derivePlanGeometry(makeRectPlan(5000, 4000, 230))
            .rooms[0]!;
        expect(auto.labelRadius).toBeGreaterThan(1800);
        expect(Math.abs(auto.labelPoint.x - 2500)).toBeLessThan(1000);
    });

    it('does not mutate its inputs and returns unassociated rooms unchanged', () => {
        const doc = makeGridPlan(2, 1);
        const plan = derivePlanGeometry(doc);
        const before = structuredClone(plan.rooms);
        const out = associateRoomMetas(plan.rooms, doc);
        expect(out.rooms[0]).toBe(plan.rooms[0]);
        expect(plan.rooms).toEqual(before);
    });
});
