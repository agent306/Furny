import { describe, expect, it } from 'vitest';
import { signedArea } from '../../geometry/polygon';
import { sideOf, type Vec2 } from '../../geometry/vec2';
import {
    CONFLICT_KINDS,
    computePlacementConflicts,
    doorSwingSectors,
    type PlacementConflict,
} from '../conflicts';
import { derivePlanGeometry } from '../derive';
import { FIXTURE_LIBRARY } from '../fixtures';
import type { FootprintProvider, FootprintSize } from '../footprint';
import type {
    Fixture,
    FurniturePlacement,
    Opening,
    PlanDocument,
} from '../schema';
import { makeRectPlan } from '../testing/fixtures';
import { buildHdb3Room } from '../testing/referencePlans';

// makeRectPlan(5000, 4000, 230): top wall w1 runs (0,0)->(5000,0) with its
// normal pointing up the screen, so the room lies on its right (-n) side.
// Wall faces are at y = -115 (outside) and y = 115 (room side).
const TOP = 'w_0000000001';

const SIZES: Record<string, FootprintSize> = {
    wide: { width: 1200, depth: 600, height: 750 },
    door900: { width: 900, depth: 600, height: 750 },
    tall: { width: 1200, depth: 600, height: 1000 },
    wallCabinet: { width: 1800, depth: 350, height: 700 },
    sofa: { width: 2000, depth: 900, height: 850 },
    small: { width: 50, depth: 50, height: 750 },
};
const provider: FootprintProvider = (id) => SIZES[id] ?? null;

let counter = 0;
function place(
    doc: PlanDocument,
    designId: string,
    x: number,
    y: number,
    patch: Partial<FurniturePlacement> = {},
): string {
    counter += 1;
    const id = patch.id ?? `f_${String(counter).padStart(10, '0')}`;
    doc.placements[id] = {
        id,
        designId,
        x,
        y,
        rotation: 0,
        elevation: 0,
        mirrored: false,
        wallAttachment: null,
        ...patch,
    };
    return id;
}

function fix(doc: PlanDocument, patch: Partial<Fixture> = {}): string {
    counter += 1;
    const id = patch.id ?? `x_${String(counter).padStart(10, '0')}`;
    doc.fixtures[id] = {
        id,
        libraryKey: 'kitchen_counter',
        x: 2500,
        y: 2000,
        rotation: 0,
        width: 1800,
        depth: 600,
        height: 900,
        elevation: 0,
        label: null,
        ...patch,
    };
    return id;
}

function open(doc: PlanDocument, patch: Partial<Opening>): string {
    counter += 1;
    const id = patch.id ?? `o_${String(counter).padStart(10, '0')}`;
    doc.openings[id] = {
        id,
        wallId: TOP,
        kind: 'door',
        type: 'single_swing',
        offset: 2500,
        width: 900,
        height: 2100,
        sillHeight: 0,
        hinge: 'start',
        swing: 'right',
        label: null,
        ...patch,
    };
    return id;
}

function run(doc: PlanDocument): PlacementConflict[] {
    return computePlacementConflicts(doc, derivePlanGeometry(doc), provider);
}

const kinds = (cs: PlacementConflict[]): string[] => cs.map((c) => c.kind);

describe('CONFLICT_KINDS', () => {
    it('lists the four conflict kinds', () => {
        expect([...CONFLICT_KINDS].sort()).toEqual([
            'blocks_door',
            'blocks_window',
            'overlaps_item',
            'overlaps_wall',
        ]);
    });
});

describe('wall overlap', () => {
    it('ignores a placement flush against the wall face', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        place(doc, 'wide', 2500, 115);
        expect(run(doc)).toEqual([]);
    });

    it('tolerates a few millimetres of overlap (at most 2500 mm2)', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        place(doc, 'wide', 2500, 113);
        expect(run(doc)).toEqual([]);
    });

    it('flags a placement 200 mm into the wall', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        const id = place(doc, 'wide', 2500, -85);
        expect(run(doc)).toEqual([
            {
                kind: 'overlaps_wall',
                entityId: id,
                otherId: TOP,
                messageKey: 'engine.plan.conflict.overlaps_wall',
                params: { areaMm2: 240000 },
            },
        ]);
    });

    it('lets a placement stand in a door opening that cuts the wall', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        open(doc, { type: 'sliding' });
        place(doc, 'small', 2500, -85);
        expect(run(doc)).toEqual([]);
    });

    it('checks fixtures too', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        const id = fix(doc, { x: 2500, y: 100, depth: 600, width: 1800 });
        expect(run(doc).map((c) => [c.kind, c.entityId, c.otherId])).toEqual([
            ['overlaps_wall', id, TOP],
        ]);
    });

    it('ignores elevation for ordinary walls but not for half walls', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        const id = place(doc, 'wide', 2500, -85, { elevation: 1400 });
        expect(kinds(run(doc))).toEqual(['overlaps_wall']);

        doc.walls[TOP]!.kind = 'half';
        doc.walls[TOP]!.height = 1000;
        expect(kinds(run(doc))).toEqual([]);
        doc.placements[id]!.elevation = 900;
        expect(kinds(run(doc))).toEqual(['overlaps_wall']);
    });
});

describe('item overlap', () => {
    it('flags two overlapping items once per pair', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        const a = place(doc, 'sofa', 2500, 1500);
        const b = place(doc, 'sofa', 2500, 2000);
        const result = run(doc);
        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({
            kind: 'overlaps_item',
            entityId: a,
            otherId: b,
            messageKey: 'engine.plan.conflict.overlaps_item',
        });
        expect(result[0]!.params.areaMm2).toBe(2000 * 400);
    });

    it('ignores flush contact', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        place(doc, 'sofa', 2500, 1500); // y 1500..2400
        place(doc, 'sofa', 2500, 2400); // flush front-to-back
        expect(run(doc)).toEqual([]);
    });

    it('ignores overlaps of at most 2500 mm2 and flags larger ones', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        place(doc, 'sofa', 2500, 1500);
        const other = place(doc, 'door900', 2500, 2398); // 2 mm x 900 mm = 1800 mm2
        expect(run(doc)).toEqual([]);
        doc.placements[other]!.y = 2396; // 4 mm x 900 mm = 3600 mm2
        expect(kinds(run(doc))).toEqual(['overlaps_item']);
    });

    it('ignores items whose vertical intervals are disjoint (wall cabinet above a counter)', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        fix(doc, { x: 2500, y: 2000, width: 1800, depth: 600, height: 900 });
        place(doc, 'wallCabinet', 2500, 1850, { elevation: 1400 });
        expect(run(doc)).toEqual([]);
    });

    it('flags them once the vertical intervals overlap by more than 10 mm', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        const worktop = fix(doc, {
            x: 2500,
            y: 2000,
            width: 1800,
            depth: 600,
            height: 900,
        });
        const cabinet = place(doc, 'wallCabinet', 2500, 1850, {
            elevation: 890,
        });
        expect(run(doc)).toEqual([]); // overlap of exactly 10 mm
        doc.placements[cabinet]!.elevation = 880;
        // placement ids (f_) sort before fixture ids (x_)
        expect(run(doc).map((c) => [c.kind, c.entityId, c.otherId])).toEqual([
            ['overlaps_item', cabinet, worktop],
        ]);
    });

    it('never conflicts for fixtures flagged noConflict (a rug under a sofa)', () => {
        expect(FIXTURE_LIBRARY.rug.noConflict).toBe(true);
        const doc = makeRectPlan(5000, 4000, 230);
        fix(doc, {
            libraryKey: 'rug',
            x: 2500,
            y: 2000,
            width: 3000,
            depth: 2000,
            height: 10,
        });
        place(doc, 'sofa', 2500, 1700);
        expect(run(doc)).toEqual([]);
    });

    it('never lets a noConflict fixture block a door or sit in a wall', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        open(doc, {});
        fix(doc, {
            libraryKey: 'rug',
            x: 2500,
            y: 115,
            width: 3000,
            depth: 2000,
            height: 10,
        });
        expect(run(doc)).toEqual([]);
    });
});

describe('door swing', () => {
    it('flags a 900 mm placement inside the sector of a single-swing door', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        const door = open(doc, {});
        const id = place(doc, 'door900', 2500, 400);
        const result = run(doc);
        expect(result.map((c) => [c.kind, c.entityId, c.otherId])).toEqual([
            ['blocks_door', id, door],
        ]);
        expect(result[0]!.messageKey).toBe('engine.plan.conflict.blocks_door');
    });

    it('ignores items outside the swept quarter circle', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        open(doc, {}); // hinge at x = 2050, leaf sweeps x 2050..2950
        place(doc, 'door900', 3900, 400);
        place(doc, 'door900', 1000, 400);
        expect(run(doc)).toEqual([]);
    });

    it('ignores items on the other side of the wall from the swing', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        open(doc, {}); // swings to the room (down the screen)
        place(doc, 'door900', 2500, -1500, { rotation: 180 });
        expect(run(doc)).toEqual([]);
    });

    it('ignores items at or above the door head', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        open(doc, {});
        place(doc, 'door900', 2500, 400, { elevation: 2100 });
        expect(run(doc)).toEqual([]);
        const doc2 = makeRectPlan(5000, 4000, 230);
        open(doc2, {});
        place(doc2, 'door900', 2500, 400, { elevation: 2099 });
        expect(kinds(run(doc2))).toEqual(['blocks_door']);
    });

    it('does not flag sliding doors', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        open(doc, { type: 'sliding' });
        place(doc, 'door900', 2500, 400);
        expect(run(doc)).toEqual([]);
    });
});

describe('window', () => {
    const window = (doc: PlanDocument): string =>
        open(doc, {
            kind: 'window',
            type: 'casement',
            offset: 2500,
            width: 1500,
            height: 1200,
            sillHeight: 900,
        });

    it('flags an item in front of a window when the heights overlap', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        const win = window(doc);
        const id = place(doc, 'tall', 2500, 115); // up to 1000 mm, sill at 900
        const result = run(doc);
        expect(result.map((c) => [c.kind, c.entityId, c.otherId])).toEqual([
            ['blocks_window', id, win],
        ]);
        expect(result[0]!.messageKey).toBe(
            'engine.plan.conflict.blocks_window',
        );
    });

    it('ignores an item lower than the sill', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        window(doc);
        place(doc, 'wide', 2500, 115); // 750 mm tall
        expect(run(doc)).toEqual([]);
    });

    it('ignores an item at least 300 mm clear of the wall face', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        window(doc);
        place(doc, 'tall', 2500, 115 + 300); // clear zone ends at y = 415
        expect(run(doc)).toEqual([]);
    });

    it('flags an item that reaches into the 300 mm clear zone', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        window(doc);
        place(doc, 'tall', 2500, 115 + 290);
        expect(kinds(run(doc))).toEqual(['blocks_window']);
    });

    it('ignores an item beside the window', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        window(doc); // x 1750..3250
        place(doc, 'tall', 4200, 115);
        expect(run(doc)).toEqual([]);
    });
});

describe('providers and ordering', () => {
    it('skips placements whose design is unknown', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        place(doc, 'gone', 2500, -85);
        expect(run(doc)).toEqual([]);
    });

    it('does not mutate the document', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        place(doc, 'wide', 2500, -85);
        const before = JSON.stringify(doc);
        run(doc);
        expect(JSON.stringify(doc)).toBe(before);
    });

    it('sorts by (kind, entityId, otherId) whatever the insertion order', () => {
        const build = (reverse: boolean): PlanDocument => {
            const doc = makeRectPlan(5000, 4000, 230);
            const steps: Array<() => void> = [
                () => open(doc, { id: 'o_0000000001' }),
                () => place(doc, 'door900', 2500, 400, { id: 'f_0000000001' }),
                () => place(doc, 'wide', 800, -85, { id: 'f_0000000002' }),
                () => place(doc, 'sofa', 3500, 2500, { id: 'f_0000000003' }),
                () => place(doc, 'sofa', 3500, 2900, { id: 'f_0000000004' }),
                () =>
                    fix(doc, {
                        id: 'x_0000000002',
                        x: 1000,
                        y: 3000,
                        width: 1000,
                    }),
                () =>
                    fix(doc, {
                        id: 'x_0000000001',
                        x: 1100,
                        y: 3000,
                        width: 1000,
                    }),
            ];
            for (const step of reverse ? steps.reverse() : steps) step();
            return doc;
        };
        const forward = run(build(false));
        expect(run(build(true))).toEqual(forward);
        expect(forward.map((c) => [c.kind, c.entityId, c.otherId])).toEqual([
            ['blocks_door', 'f_0000000001', 'o_0000000001'],
            ['overlaps_item', 'f_0000000003', 'f_0000000004'],
            ['overlaps_item', 'x_0000000001', 'x_0000000002'],
            ['overlaps_wall', 'f_0000000002', TOP],
        ]);
    });
});

describe('doorSwingSectors', () => {
    const sectorsOf = (
        doc: PlanDocument,
    ): Array<{ openingId: string; polygon: Vec2[] }> =>
        doorSwingSectors(doc, derivePlanGeometry(doc));

    const at = (p: Vec2, x: number, y: number): boolean =>
        Math.abs(p.x - x) < 1e-6 && Math.abs(p.y - y) < 1e-6;

    it('returns one 18-point CW polygon per single-swing door', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        const id = open(doc, {});
        const sectors = sectorsOf(doc);
        expect(sectors).toHaveLength(1);
        expect(sectors[0]!.openingId).toBe(id);
        expect(sectors[0]!.polygon).toHaveLength(18);
        expect(signedArea(sectors[0]!.polygon)).toBeGreaterThan(0);
        // 16-gon inscribed in a quarter circle of radius 900
        const expected = 0.5 * 900 * 900 * 16 * Math.sin(Math.PI / 32);
        expect(signedArea(sectors[0]!.polygon)).toBeCloseTo(expected, 3);
    });

    it.each([
        ['start', 'left', [2050, -115], [2950, -115], [2050, -1015]],
        ['start', 'right', [2050, 115], [2950, 115], [2050, 1015]],
        ['end', 'left', [2950, -115], [2050, -115], [2950, -1015]],
        ['end', 'right', [2950, 115], [2050, 115], [2950, 1015]],
    ] as const)(
        'hinge %s swing %s centres on the hinge jamb at the swing face',
        (hinge, swing, centre, closed, opened) => {
            const doc = makeRectPlan(5000, 4000, 230);
            open(doc, { hinge, swing });
            const polygon = sectorsOf(doc)[0]!.polygon;
            expect(at(polygon[0]!, centre[0], centre[1])).toBe(true);
            const arcEnds = [polygon[1]!, polygon[17]!];
            expect(arcEnds.some((p) => at(p, closed[0], closed[1]))).toBe(true);
            expect(arcEnds.some((p) => at(p, opened[0], opened[1]))).toBe(true);
            for (const p of polygon.slice(1)) {
                expect(
                    Math.hypot(p.x - centre[0], p.y - centre[1]),
                ).toBeCloseTo(900, 6);
            }
        },
    );

    it('treats main_entrance like single_swing', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        open(doc, { type: 'main_entrance', width: 1000 });
        const sectors = sectorsOf(doc);
        expect(sectors).toHaveLength(1);
        expect(sectors[0]!.polygon).toHaveLength(18);
    });

    it('gives a double_swing door two half-width leaves hinged at both jambs', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        const id = open(doc, { type: 'double_swing', swing: 'left' });
        const sectors = sectorsOf(doc);
        expect(sectors.map((s) => s.openingId)).toEqual([id, id]);
        for (const s of sectors) {
            expect(s.polygon).toHaveLength(18);
            expect(signedArea(s.polygon)).toBeGreaterThan(0);
        }
        expect(at(sectors[0]!.polygon[0]!, 2050, -115)).toBe(true);
        expect(at(sectors[1]!.polygon[0]!, 2950, -115)).toBe(true);
        for (const s of sectors) {
            for (const p of s.polygon.slice(1)) {
                expect(
                    Math.hypot(p.x - s.polygon[0]!.x, p.y - s.polygon[0]!.y),
                ).toBeCloseTo(450, 6);
            }
        }
    });

    it('gives a french window two half-width leaves (04 5.9-3)', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        open(doc, {
            kind: 'window',
            type: 'french_window',
            width: 1200,
            sillHeight: 0,
        });
        expect(sectorsOf(doc)).toHaveLength(2);
    });

    it('has no sector for openings without a swing', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        const types = ['sliding', 'pocket', 'bifold'] as const;
        types.forEach((type, i) =>
            open(doc, { type, offset: 800 + i * 1000, width: 700 }),
        );
        open(doc, { kind: 'opening', type: 'opening', offset: 4500 });
        open(doc, {
            kind: 'window',
            type: 'casement',
            offset: 3900,
            width: 600,
            sillHeight: 900,
            height: 1200,
        });
        expect(sectorsOf(doc)).toEqual([]);
    });

    it('skips an opening that is not on a valid wall', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        open(doc, { wallId: 'w_missing' });
        expect(sectorsOf(doc)).toEqual([]);
    });

    it('orders sectors by opening id', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        counter = 500;
        const b = open(doc, { offset: 3800 });
        counter = 400;
        const a = open(doc, { offset: 1200 });
        expect(sectorsOf(doc).map((s) => s.openingId)).toEqual([a, b]);
    });
});

describe('HDB reference plan', () => {
    it('has one sector per swing door, each on the side the door opens into', () => {
        const doc = buildHdb3Room();
        const geom = derivePlanGeometry(doc);
        const swingDoors = Object.values(doc.openings)
            .filter(
                (o) => o.type === 'single_swing' || o.type === 'main_entrance',
            )
            .map((o) => o.id)
            .sort();
        expect(swingDoors).toHaveLength(8);

        const sectors = doorSwingSectors(doc, geom);
        expect(sectors.map((s) => s.openingId)).toEqual(swingDoors);

        for (const sector of sectors) {
            const opening = doc.openings[sector.openingId]!;
            const derived = geom.openings[sector.openingId]!;
            const wall = geom.walls[opening.wallId]!;
            const [a, b] = wall.centerline;
            expect(sector.polygon).toHaveLength(18);
            expect(signedArea(sector.polygon)).toBeGreaterThan(0);
            // swing 'left' is the +normal half-plane (04 2.1-3)
            for (const p of sector.polygon) {
                expect(sideOf(a, b, p)).toBe(derived.swingSign);
            }
        }
    });

    it('opens into the room on the swing side whenever there is one', () => {
        const doc = buildHdb3Room();
        const geom = derivePlanGeometry(doc);
        let checked = 0;
        for (const sector of doorSwingSectors(doc, geom)) {
            const opening = doc.openings[sector.openingId]!;
            const derived = geom.openings[sector.openingId]!;
            const wall = geom.walls[opening.wallId]!;
            const key =
                derived.swingSign === 1 ? wall.leftRoomKey : wall.rightRoomKey;
            if (key === null) continue;
            const room = geom.rooms[geom.roomIndexByFaceKey[key]!]!;
            const hinge = sector.polygon[0]!;
            const swept = sector.polygon.slice(1);
            const mid = swept[Math.floor(swept.length / 2)]!;
            const probe = {
                x: (hinge.x + mid.x) / 2,
                y: (hinge.y + mid.y) / 2,
            };
            expect(
                pointInside(probe, room.polygon),
                `${sector.openingId} probe ${probe.x},${probe.y}`,
            ).toBe(true);
            checked += 1;
        }
        // the main entrance (swing left, hinge start) opens to the outside, which has no room
        expect(checked).toBe(7);
    });
});

function pointInside(pt: Vec2, ring: Vec2[]): boolean {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const pi = ring[i]!;
        const pj = ring[j]!;
        if (
            pi.y > pt.y !== pj.y > pt.y &&
            pt.x < ((pj.x - pi.x) * (pt.y - pi.y)) / (pj.y - pi.y) + pi.x
        ) {
            inside = !inside;
        }
    }
    return inside;
}
