import { create } from 'mutative';
import { describe, expect, it } from 'vitest';
import { pointInPolygon, signedDistToPolygon } from '../../geometry/polygon';
import { ANCHOR_MIN_CLEARANCE } from '../../geometry/tolerance';
import { derivePlanGeometry, type DerivedPlan } from '../derive';
import { reconcileRoomMetas } from '../reconcile';
import type { PlanDocument, RoomMeta } from '../schema';
import { emptyPlan } from '../testing/fixtures';
import { metaFactory, strip } from '../testing/strip';

const meta = metaFactory();

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
function run(
    before: PlanDocument,
    after: PlanDocument,
    affected?: ReadonlySet<string>,
): Run {
    const prevGeom = derivePlanGeometry(before);
    const nextGeom = derivePlanGeometry(after);
    let result!: ReturnType<typeof reconcileRoomMetas>;
    const [doc, patches] = create(
        after,
        (d) => {
            result = reconcileRoomMetas(d, prevGeom, nextGeom, affected);
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
        // nothing is closed yet (open island, top wall missing): both are orphans
        const topWall = s.doc.walls[s.sides.top[0]!]!;
        const before = withMetas(
            edit(island(3), (d) => {
                delete d.walls[topWall.id];
            }),
            outer,
            inner,
        );
        expect(derivePlanGeometry(before).rooms).toHaveLength(0);
        // one command closes the room and the island: a face with a hole
        const after = edit(before, (d) => {
            d.walls[topWall.id] = { ...topWall };
            d.walls[wallIds[3]!] = { ...island(4).walls[wallIds[3]!]! };
        });
        const r = run(before, after);
        expect(r.result).toEqual({ deletedMetaIds: [], movedAnchors: [] });
        expect(r.next.rooms).toHaveLength(2);
        expect(r.next.rooms.map((room) => room.metaId).sort()).toEqual(
            [outer.id, inner.id].sort(),
        );
    });

    describe('scope (affected faces)', () => {
        /** Three rooms side by side; B and C carry anchors that item 6 would move. */
        function threeRooms() {
            const s = strip(9000, 4000, [3000, 6000]);
            const a = meta(1500, 2000);
            // 42.5 mm from the net edge: too close
            const b = meta(3100, 2000);
            // an offset label far outside the net polygon
            const c = meta(7500, 2000, { labelOffset: { x: 5000, y: 0 } });
            const before = withMetas(s.doc, a, b, c);
            const after = edit(before, (d) => {
                d.nodes[s.node['0,0']!]!.y = 1;
            });
            return { s, a, b, c, before, after };
        }
        const keyOf = (doc: PlanDocument, metaId: string): string => {
            const geom = derivePlanGeometry(doc);
            return roomOf(geom, metaId)!.faceKey;
        };

        it('with the 3-argument form every face is affected', () => {
            const { b, c, before, after } = threeRooms();
            const r = run(before, after);
            expect(r.result.movedAnchors).toEqual([b.id]);
            expect(r.doc.rooms[c.id]!.labelOffset).toBeNull();
        });

        it('leaves metas in unaffected faces byte-identical', () => {
            const { a, b, c, before, after } = threeRooms();
            const r = run(before, after, new Set([keyOf(before, a.id)]));
            expect(r.result).toEqual({ deletedMetaIds: [], movedAnchors: [] });
            expect(r.doc.rooms[b.id]).toBe(before.rooms[b.id]);
            expect(r.doc.rooms[c.id]).toBe(before.rooms[c.id]);
        });

        it('still maintains the metas of an affected face', () => {
            const { b, c, before, after } = threeRooms();
            const r = run(
                before,
                after,
                new Set([keyOf(before, b.id), keyOf(before, c.id)]),
            );
            expect(r.result.movedAnchors).toEqual([b.id]);
            expect(r.doc.rooms[c.id]!.labelOffset).toBeNull();
        });

        it('never deletes a derive-level duplicate (a meta that lost its room to a smaller id)', () => {
            const s = strip(9000, 4000, []);
            const one = meta(1500, 2000);
            const two = meta(4500, 2000);
            const three = meta(7500, 2000);
            const before = withMetas(s.doc, one, two, three);
            const after = edit(before, (d) => {
                d.nodes[s.node['9000,0']!]!.y = 1;
            });
            expect(derivePlanGeometry(before).rooms[0]!.metaId).toBe(one.id);
            const r = run(before, after);
            expect(r.result.deletedMetaIds).toEqual([]);
            expect(Object.keys(r.doc.rooms).sort()).toEqual(
                [one.id, two.id, three.id].sort(),
            );
            expect(r.doc.rooms[two.id]).toBe(before.rooms[two.id]);
            expect(r.doc.rooms[three.id]).toBe(before.rooms[three.id]);
        });
    });

    describe('following a vanished face', () => {
        /** After-document with other ids, so no faceKey survives. */
        const reId = () => {
            let n = 0;
            return (prefix: string) =>
                `${prefix}_z${String((n += 1)).padStart(9, '0')}`;
        };

        it('orphans a meta whose best overlap is below 20% of the smaller face', () => {
            const named = meta(1000, 2000);
            const before = withMetas(strip(6000, 4000, []).doc, named);
            // the new room starts at x=5000: 1000 of 6000 overlap = 16.7%
            const after = withMetas(
                strip(6000, 4000, [], { originX: 5000, newId: reId() }).doc,
                named,
            );
            const r = run(before, after);
            expect(r.result).toEqual({ deletedMetaIds: [], movedAnchors: [] });
            expect(r.patchCount).toBe(0);
            expect(r.next.rooms.every((room) => room.metaId === null)).toBe(
                true,
            );
        });

        it('follows an overlap of at least 20% (the anchor ends up inside)', () => {
            const named = meta(1000, 2000);
            const before = withMetas(strip(6000, 4000, []).doc, named);
            // 1500 of 6000 overlap = 25%
            const after = withMetas(
                strip(6000, 4000, [], { originX: 4500, newId: reId() }).doc,
                named,
            );
            const r = run(before, after);
            expect(r.result.movedAnchors).toEqual([named.id]);
            expect(r.next.rooms[0]!.metaId).toBe(named.id);
        });

        it.each([false, true])(
            'breaks an equal overlap by the smaller faceKey (mirrored: %s)',
            (mirrored) => {
                // the anchor sits on the new wall: in neither half
                const named = meta(4500, 2000);
                const before = withMetas(strip(9000, 4000, []).doc, named);
                const ids = reId();
                const next = strip(9000, 4000, [4500], { newId: ids });
                // mirrored: the ids of the two halves swap places
                const after = withMetas(
                    mirrored
                        ? edit(next.doc, (d) => {
                              for (const n of Object.values(d.nodes)) {
                                  n.x = 9000 - n.x;
                              }
                          })
                        : next.doc,
                    named,
                );
                const nextGeom = derivePlanGeometry(after);
                expect(nextGeom.rooms).toHaveLength(2);
                const smaller = nextGeom.rooms
                    .map((room) => room.faceKey)
                    .sort()[0]!;
                const r = run(before, after);
                expect(roomOf(r.next, named.id)!.faceKey).toBe(smaller);
            },
        );
    });

    it('moves an anchor that sits in the thick-wall band even when 100 mm or more from the net edge', () => {
        // 600 mm walls: the net edge is 300 mm in from the centre line
        const s = strip(9000, 4000, [], { thickness: 600 });
        const inBand = meta(150, 2000);
        const before = withMetas(s.doc, inBand);
        const after = edit(before, (d) => {
            d.nodes[s.node['9000,0']!]!.y = 1;
        });
        const r = run(before, after);
        expect(r.result.movedAnchors).toEqual([inBand.id]);
        const room = roomOf(r.next, inBand.id)!;
        expect(
            signedDistToPolygon(r.doc.rooms[inBand.id]!.anchor, {
                outer: room.polygon,
                holes: room.holes,
            }),
        ).toBeGreaterThanOrEqual(ANCHOR_MIN_CLEARANCE);
    });

    it('writes a moved anchor without a negative zero', () => {
        // a trapezoid whose label point is (-0.27, -28.17): x rounds to -0
        const pts: Array<[number, number]> = [
            [-2000, -1500],
            [2000, -1500],
            [1060, 1500],
            [-1060, 1500],
        ];
        const doc = emptyPlan();
        const ids = pts.map((_, i) => `n_trap${i}`);
        pts.forEach(([x, y], i) => {
            doc.nodes[ids[i]!] = { id: ids[i]!, x, y };
        });
        ids.forEach((a, i) => {
            const id = `w_trap${i}`;
            doc.walls[id] = {
                id,
                a,
                b: ids[(i + 1) % ids.length]!,
                thickness: 115,
                height: 2700,
                kind: 'exterior',
                justification: 'center',
                material: 'brick',
                colorHex: null,
            };
        });
        const m = meta(0, 1400); // 42.5 mm from the net edge: moved
        const withMeta = withMetas(doc, m);
        const pole = derivePlanGeometry(doc).rooms[0]!.labelPoint;
        expect(pole.x).toBeLessThan(0);
        expect(pole.x).toBeGreaterThan(-0.5);
        const r = run(withMeta, withMeta);
        expect(r.result.movedAnchors).toEqual([m.id]);
        const { x, y } = r.doc.rooms[m.id]!.anchor;
        expect(Object.is(x, 0)).toBe(true);
        expect(y).toBe(-28);
    });
});
