import { create } from 'mutative';
import { describe, expect, it } from 'vitest';
import { pointInPolygon, signedDistToPolygon } from '../../geometry/polygon';
import { ANCHOR_MIN_CLEARANCE } from '../../geometry/tolerance';
import { testIds } from '../../testing/ids';
import { derivePlanGeometry, type DerivedPlan } from '../derive';
import { reconcileRoomMetas } from '../reconcile';
import type { PlanDocument, RoomMeta, Wall } from '../schema';
import { emptyPlan } from '../testing/fixtures';

/**
 * A `width` x `height` strip of rooms: exterior walls around it and one
 * interior wall at every x in `cuts`. Every wall is 115 mm thick, so the net
 * face of a room is its centre-line face shrunk by 57.5 mm on each side.
 */
interface Strip {
    doc: PlanDocument;
    /** Interior wall id by cut x. */
    cutWall: Record<number, string>;
    /** Node id by `x,y`. */
    node: Record<string, string>;
}

function strip(width: number, height: number, cuts: number[]): Strip {
    const newId = testIds();
    const doc = emptyPlan();
    const node: Record<string, string> = {};
    const addNode = (x: number, y: number): string => {
        const id = newId('n');
        doc.nodes[id] = { id, x, y };
        node[`${x},${y}`] = id;
        return id;
    };
    const addWall = (a: string, b: string, kind: Wall['kind']): string => {
        const id = newId('w');
        doc.walls[id] = {
            id,
            a,
            b,
            thickness: 115,
            height: 2700,
            kind,
            justification: 'center',
            material: 'brick',
            colorHex: null,
        };
        return id;
    };
    const xs = [0, ...cuts, width];
    const top = xs.map((x) => addNode(x, 0));
    const bottom = xs.map((x) => addNode(x, height));
    for (let i = 0; i + 1 < xs.length; i += 1) {
        addWall(top[i]!, top[i + 1]!, 'exterior');
        addWall(bottom[i]!, bottom[i + 1]!, 'exterior');
    }
    addWall(top[0]!, bottom[0]!, 'exterior');
    addWall(top.at(-1)!, bottom.at(-1)!, 'exterior');
    const cutWall: Record<number, string> = {};
    cuts.forEach((x, i) => {
        cutWall[x] = addWall(top[i + 1]!, bottom[i + 1]!, 'interior');
    });
    return { doc, cutWall, node };
}

const rId = testIds();
function meta(x: number, y: number, patch: Partial<RoomMeta> = {}): RoomMeta {
    const id = rId('r');
    return {
        id,
        anchor: { x, y },
        name: id,
        type: 'bedroom',
        floorFinish: 'tile',
        floorColorHex: null,
        labelOffset: null,
        showArea: true,
        ...patch,
    };
}

/** `doc` with `metas` added (keyed by id). */
function withMetas(doc: PlanDocument, ...metas: RoomMeta[]): PlanDocument {
    return create(doc, (d) => {
        for (const m of metas) d.rooms[m.id] = m;
    });
}

/** `doc` edited by `edit`. */
function edit(
    doc: PlanDocument,
    recipe: (d: PlanDocument) => void,
): PlanDocument {
    return create(doc, (d) => {
        recipe(d as PlanDocument);
    });
}

interface Run {
    doc: PlanDocument;
    result: ReturnType<typeof reconcileRoomMetas>;
    next: DerivedPlan;
    patchCount: number;
}

/** Derives both documents and reconciles the metas of `after` against `before`. */
function run(before: PlanDocument, after: PlanDocument): Run {
    const prevGeom = derivePlanGeometry(before);
    const nextGeom = derivePlanGeometry(after);
    let result!: ReturnType<typeof reconcileRoomMetas>;
    const [doc, patches] = create(
        after,
        (d) => {
            result = reconcileRoomMetas(d, prevGeom, nextGeom);
        },
        { enablePatches: true },
    );
    return {
        doc,
        result,
        next: derivePlanGeometry(doc),
        patchCount: patches.length,
    };
}

const roomOf = (geom: DerivedPlan, metaId: string) =>
    geom.rooms[geom.roomIndexByMetaId[metaId] ?? -1];

describe('reconcileRoomMetas', () => {
    it('keeps every metaId when a node moves (same faces)', () => {
        const s = strip(9000, 4000, [4500]);
        const a = meta(2000, 2000);
        const b = meta(7000, 2000);
        const before = withMetas(s.doc, a, b);
        const after = edit(before, (d) => {
            d.nodes[s.node['4500,0']!]!.x = 5000;
            d.nodes[s.node['4500,4000']!]!.x = 5000;
        });
        const r = run(before, after);
        expect(r.result).toEqual({ deletedMetaIds: [], movedAnchors: [] });
        expect(r.patchCount).toBe(0);
        expect(r.doc.rooms).toEqual(before.rooms);
        expect(roomOf(r.next, a.id)).toBeDefined();
        expect(roomOf(r.next, b.id)).toBeDefined();
    });

    it('keeps the larger room meta when the wall between two rooms goes', () => {
        const s = strip(9000, 4000, [3000]);
        // the small room has the smaller id: area, not id, decides
        const small = meta(1500, 2000);
        const large = meta(6000, 2000);
        expect(small.id < large.id).toBe(true);
        const before = withMetas(s.doc, small, large);
        const after = edit(before, (d) => {
            delete d.walls[s.cutWall[3000]!];
        });
        const r = run(before, after);
        expect(r.result.deletedMetaIds).toEqual([small.id]);
        expect(r.result.movedAnchors).toEqual([]);
        expect(Object.keys(r.doc.rooms)).toEqual([large.id]);
        expect(r.next.rooms).toHaveLength(1);
        expect(r.next.rooms[0]!.metaId).toBe(large.id);
    });

    it('breaks an equal-area merge by the smallest id', () => {
        const s = strip(9000, 4000, [4500]);
        const first = meta(2000, 2000);
        const second = meta(7000, 2000);
        const before = withMetas(s.doc, second, first);
        const after = edit(before, (d) => {
            delete d.walls[s.cutWall[4500]!];
        });
        const r = run(before, after);
        expect(r.result.deletedMetaIds).toEqual([second.id]);
        expect(Object.keys(r.doc.rooms)).toEqual([first.id]);
    });

    it('gives a split room name to the part that holds its anchor', () => {
        // the anchor sits in the smaller part: containing wins over overlap
        const named = meta(1500, 2000);
        const before = withMetas(strip(9000, 4000, []).doc, named);
        const after = withMetas(strip(9000, 4000, [3000]).doc, named);
        const r = run(before, after);
        expect(r.result).toEqual({ deletedMetaIds: [], movedAnchors: [] });
        expect(r.patchCount).toBe(0);
        expect(r.next.rooms).toHaveLength(2);
        const named2 = r.next.rooms.filter((room) => room.metaId !== null);
        expect(named2.map((room) => room.metaId)).toEqual([named.id]);
        expect(named2[0]!.centroid.x).toBeLessThan(3000);
        // the other part displays as unnamed
        expect(
            r.next.rooms.filter((room) => room.metaId === null),
        ).toHaveLength(1);
    });

    it('with no part containing the anchor, the largest overlap takes the meta', () => {
        // anchor on the new wall's line, inside neither part
        const named = meta(3000, 2000);
        const before = withMetas(strip(9000, 4000, []).doc, named);
        const after = withMetas(strip(9000, 4000, [3000]).doc, named);
        const r = run(before, after);
        const target = roomOf(r.next, named.id)!;
        expect(target).toBeDefined();
        // the 6000-wide part overlaps the old room most
        expect(target.centroid.x).toBeGreaterThan(3000);
        expect(r.result.movedAnchors).toEqual([named.id]);
        expect(
            pointInPolygon(r.doc.rooms[named.id]!.anchor, target.facePolygon),
        ).toBe('inside');
    });

    it('moves an anchor that a wall move left outside its room to the new label point', () => {
        const s = strip(9000, 4000, [4500]);
        const a = meta(4000, 2000);
        const b = meta(7000, 2000);
        const before = withMetas(s.doc, a, b);
        const after = edit(before, (d) => {
            d.nodes[s.node['4500,0']!]!.x = 3000;
            d.nodes[s.node['4500,4000']!]!.x = 3000;
        });
        const r = run(before, after);
        expect(r.result.movedAnchors).toEqual([a.id]);
        expect(r.result.deletedMetaIds).toEqual([]);
        const left = r.next.rooms.find((room) => room.centroid.x < 3000)!;
        expect(left.metaId).toBe(a.id);
        const moved = r.doc.rooms[a.id]!.anchor;
        expect(Number.isInteger(moved.x) && Number.isInteger(moved.y)).toBe(
            true,
        );
        expect(
            Math.abs(moved.x - left.labelPoint.x) <= 0.5 &&
                Math.abs(moved.y - left.labelPoint.y) <= 0.5,
        ).toBe(true);
        expect(r.doc.rooms[b.id]).toBe(before.rooms[b.id]);
    });

    it('moves an anchor that sits closer than ANCHOR_MIN_CLEARANCE to the net boundary', () => {
        const s = strip(9000, 4000, []);
        // inside the centre-line face, 42.5 mm from the net edge
        const near = meta(100, 2000);
        const before = withMetas(s.doc, near);
        const after = edit(before, (d) => {
            d.nodes[s.node['9000,0']!]!.y = 1;
        });
        const r = run(before, after);
        expect(r.result.movedAnchors).toEqual([near.id]);
        const room = roomOf(r.next, near.id)!;
        const clearance = signedDistToPolygon(r.doc.rooms[near.id]!.anchor, {
            outer: room.polygon,
            holes: room.holes,
        });
        expect(clearance).toBeGreaterThanOrEqual(ANCHOR_MIN_CLEARANCE);
    });

    it('leaves a well placed anchor alone', () => {
        const s = strip(9000, 4000, []);
        const m = meta(4500, 2000);
        const before = withMetas(s.doc, m);
        const after = edit(before, (d) => {
            d.nodes[s.node['9000,0']!]!.y = 1;
        });
        const r = run(before, after);
        expect(r.result.movedAnchors).toEqual([]);
        expect(r.doc.rooms[m.id]).toBe(before.rooms[m.id]);
    });

    it('keeps an orphaned meta untouched and re-attaches it when the face closes again', () => {
        const s = strip(9000, 4000, []);
        const m = meta(4500, 2000);
        const closed = withMetas(s.doc, m);
        const topWall = Object.values(closed.walls).find(
            (w) => closed.nodes[w.a]!.y === 0 && closed.nodes[w.b]!.y === 0,
        )!;
        const open = edit(closed, (d) => {
            delete d.walls[topWall.id];
        });

        const opened = run(closed, open);
        expect(opened.next.rooms).toHaveLength(0);
        expect(opened.result).toEqual({ deletedMetaIds: [], movedAnchors: [] });
        expect(opened.patchCount).toBe(0);
        expect(opened.doc.rooms[m.id]).toBe(open.rooms[m.id]);

        const redrawn = edit(opened.doc, (d) => {
            d.walls[topWall.id] = { ...topWall };
        });
        const again = run(opened.doc, redrawn);
        expect(again.result).toEqual({ deletedMetaIds: [], movedAnchors: [] });
        expect(again.next.rooms).toHaveLength(1);
        expect(again.next.rooms[0]!.metaId).toBe(m.id);
        expect(again.doc.rooms[m.id]!.anchor).toEqual({ x: 4500, y: 2000 });
    });

    it('prefers a meta with a previous room over an orphan that lands in the same face', () => {
        const s = strip(9000, 4000, [4500]);
        const orphan = meta(2000, 2000);
        const placed = meta(7000, 2000);
        expect(orphan.id < placed.id).toBe(true);
        const topLeft = Object.values(s.doc.walls).find(
            (w) => w.a === s.node['0,0'] && w.b === s.node['4500,0'],
        )!;
        // before: the left room is open, so its meta is an orphan
        const before = withMetas(
            edit(s.doc, (d) => {
                delete d.walls[topLeft.id];
            }),
            orphan,
            placed,
        );
        expect(derivePlanGeometry(before).rooms.map((r) => r.metaId)).toEqual([
            placed.id,
        ]);
        // one command closes it and removes the wall between: one face, two claimants
        const after = edit(before, (d) => {
            d.walls[topLeft.id] = { ...topLeft };
            delete d.walls[s.cutWall[4500]!];
        });
        const r = run(before, after);
        expect(r.result.deletedMetaIds).toEqual([orphan.id]);
        expect(Object.keys(r.doc.rooms)).toEqual([placed.id]);
        expect(r.next.rooms).toHaveLength(1);
        expect(r.next.rooms[0]!.metaId).toBe(placed.id);
    });

    it('resets labelOffset to null when the label falls outside the net polygon', () => {
        const s = strip(9000, 4000, []);
        const far = meta(4500, 2000, { labelOffset: { x: 6000, y: 0 } });
        const near = meta(4500, 1000, { labelOffset: { x: 100, y: 100 } });
        const before = withMetas(s.doc, far);
        const r = run(
            before,
            edit(before, (d) => {
                d.nodes[s.node['9000,0']!]!.y = 1;
            }),
        );
        expect(r.doc.rooms[far.id]!.labelOffset).toBeNull();
        expect(r.result.movedAnchors).toEqual([]);

        const before2 = withMetas(s.doc, near);
        const r2 = run(
            before2,
            edit(before2, (d) => {
                d.nodes[s.node['9000,0']!]!.y = 1;
            }),
        );
        expect(r2.doc.rooms[near.id]!.labelOffset).toEqual({ x: 100, y: 100 });
    });

    it('does nothing for a plan without metas', () => {
        const s = strip(9000, 4000, [4500]);
        const r = run(
            s.doc,
            edit(s.doc, (d) => {
                delete d.walls[s.cutWall[4500]!];
            }),
        );
        expect(r.result).toEqual({ deletedMetaIds: [], movedAnchors: [] });
        expect(r.patchCount).toBe(0);
    });

    it('excludes holes from the anchor test (an island meta is not claimed by the surrounding room)', () => {
        const s = strip(9000, 6000, []);
        const corners: Array<[number, number]> = [
            [3000, 2000],
            [6000, 2000],
            [6000, 4000],
            [3000, 4000],
        ];
        const nodeIds = corners.map(
            (_, i) => `n_island${String(i).padStart(2, '0')}00`,
        );
        const wallIds = corners.map(
            (_, i) => `w_island${String(i).padStart(2, '0')}00`,
        );
        const island = (walls: number): PlanDocument =>
            edit(s.doc, (d) => {
                corners.forEach(([x, y], i) => {
                    d.nodes[nodeIds[i]!] = { id: nodeIds[i]!, x, y };
                });
                for (let i = 0; i < walls; i += 1) {
                    d.walls[wallIds[i]!] = {
                        id: wallIds[i]!,
                        a: nodeIds[i]!,
                        b: nodeIds[(i + 1) % corners.length]!,
                        thickness: 115,
                        height: 2700,
                        kind: 'interior',
                        justification: 'center',
                        material: 'brick',
                        colorHex: null,
                    };
                }
            });
        const outer = meta(1000, 1000);
        const inner = meta(4500, 3000);
        expect(outer.id < inner.id).toBe(true);
        // open island: one face holds both anchors, the outer meta wins
        const before = withMetas(island(3), outer, inner);
        expect(derivePlanGeometry(before).rooms).toHaveLength(1);
        // closing the island makes the surrounding room a face with a hole
        const after = edit(before, (d) => {
            d.walls[wallIds[3]!] = { ...island(4).walls[wallIds[3]!]! };
        });
        const r = run(before, after);
        expect(r.result).toEqual({ deletedMetaIds: [], movedAnchors: [] });
        expect(r.next.rooms).toHaveLength(2);
        expect(r.next.rooms.map((room) => room.metaId).sort()).toEqual(
            [outer.id, inner.id].sort(),
        );
    });
});
