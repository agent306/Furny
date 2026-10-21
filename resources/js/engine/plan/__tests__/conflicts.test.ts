import { describe, expect, it } from 'vitest';
import { intersectionArea } from '../../geometry/clip';
import { pointInPolygon, signedArea } from '../../geometry/polygon';
import { sideOf, type Vec2 } from '../../geometry/vec2';
import {
    CONFLICT_KINDS,
    computePlacementConflicts,
    doorSwingSectors,
    type PlacementConflict,
} from '../conflicts';
import { mulberry32 } from '../../testing/random';
import { derivePlanGeometry } from '../derive';
import { FIXTURE_LIBRARY } from '../fixtures';
import {
    placementFootprint,
    type FootprintProvider,
    type FootprintSize,
} from '../footprint';
import type {
    Fixture,
    FurniturePlacement,
    Opening,
    PlanDocument,
} from '../schema';
import { emptyPlan, makeRectPlan } from '../testing/fixtures';
import { buildBrochure2Bhk, buildHdb3Room } from '../testing/referencePlans';

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
    cabinet: { width: 800, depth: 600, height: 900 },
    wallCab: { width: 800, depth: 350, height: 700 },
    inWindow: { width: 800, depth: 350, height: 800 },
    doorFit: { width: 800, depth: 600, height: 750 },
    tallDoor: { width: 800, depth: 600, height: 2200 },
    slab: { width: 3000, depth: 900, height: 750 },
    strip2500: { width: 2500, depth: 1, height: 750 },
    strip2501: { width: 2501, depth: 1, height: 750 },
    stripTall2500: { width: 2500, depth: 1, height: 1000 },
    stripTall2501: { width: 2501, depth: 1, height: 1000 },
    h900: { width: 800, depth: 600, height: 900 },
    h901: { width: 800, depth: 600, height: 901 },
    pair: { width: 700, depth: 600, height: 750 },
    headExact: { width: 800, depth: 600, height: 2100 },
    headPlus1: { width: 800, depth: 600, height: 2101 },
    windowFit: { width: 800, depth: 350, height: 1200 },
    windowOver: { width: 800, depth: 350, height: 1201 },
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

function placementRing(doc: PlanDocument, id: string): Vec2[] {
    return placementFootprint(
        doc.placements[id]!,
        provider(doc.placements[id]!.designId)!,
    ).corners;
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

    it('lets an item that fits under the door head stand in a door opening', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        const door = open(doc, { type: 'sliding' }); // x 2050..2950, 0..2100
        const id = place(doc, 'doorFit', 2500, -85); // x 2100..2900, 200 mm into the wall
        expect(run(doc)).toEqual([]);
        delete doc.openings[door];
        expect(run(doc).map((c) => [c.kind, c.entityId, c.otherId])).toEqual([
            ['overlaps_wall', id, TOP],
        ]);
    });

    it('counts the part of an item outside the opening span as solid', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        open(doc, { type: 'sliding' }); // x 2050..2950
        const id = place(doc, 'doorFit', 2800, -85); // x 2400..3200: 250 mm beyond the jamb
        const result = run(doc);
        expect(result.map((c) => [c.kind, c.entityId, c.otherId])).toEqual([
            ['overlaps_wall', id, TOP],
        ]);
        expect(result[0]!.params.areaMm2).toBe(250 * 200);
    });

    it('treats the opening as solid for an item taller than the door head', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        open(doc, { type: 'sliding' }); // head at 2100
        place(doc, 'tallDoor', 2500, -85); // 0..2200
        expect(kinds(run(doc))).toEqual(['overlaps_wall']);
    });

    it('exempts an item whose top is exactly at the door head and flags one 1 mm above', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        open(doc, { type: 'sliding' }); // head at 2100
        const id = place(doc, 'headExact', 2500, -85); // 0..2100
        expect(run(doc)).toEqual([]);
        doc.placements[id]!.designId = 'headPlus1'; // 0..2101
        expect(run(doc).map((c) => [c.kind, c.entityId, c.otherId])).toEqual([
            ['overlaps_wall', id, TOP],
        ]);
    });

    it('exempts an item whose top is exactly at the window head and flags one 1 mm above', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        open(doc, {
            kind: 'window',
            type: 'casement',
            width: 1500,
            height: 1200,
            sillHeight: 900,
        }); // 900..2100
        const id = place(doc, 'windowFit', 2500, -85, { elevation: 900 }); // 900..2100
        expect(run(doc).filter((c) => c.kind === 'overlaps_wall')).toEqual([]);
        doc.placements[id]!.designId = 'windowOver'; // 900..2101
        expect(
            run(doc).filter((c) => c.kind === 'overlaps_wall'),
        ).toMatchObject([{ entityId: id, otherId: TOP }]);
    });

    it('flags a floor cabinet pushed into the wall under a window sill', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        open(doc, {
            kind: 'window',
            type: 'casement',
            width: 1500,
            height: 1200,
            sillHeight: 900,
        });
        const id = place(doc, 'cabinet', 2500, -85); // 0..900, sill at 900
        expect(run(doc).map((c) => [c.kind, c.entityId, c.otherId])).toEqual([
            ['overlaps_wall', id, TOP],
        ]);
    });

    it('flags a wall cabinet that reaches above the window head', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        open(doc, {
            kind: 'window',
            type: 'casement',
            width: 1500,
            height: 1200,
            sillHeight: 900,
        });
        const id = place(doc, 'wallCab', 2500, -85, { elevation: 1500 }); // 1500..2200 vs 900..2100
        expect(
            run(doc).filter((c) => c.kind === 'overlaps_wall'),
        ).toMatchObject([{ entityId: id, otherId: TOP }]);
    });

    it('lets an item whose height range lies within the window range through', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        open(doc, {
            kind: 'window',
            type: 'casement',
            width: 1500,
            height: 1200,
            sillHeight: 900,
        });
        place(doc, 'inWindow', 2500, -85, { elevation: 1000 }); // 1000..1800
        expect(run(doc).filter((c) => c.kind === 'overlaps_wall')).toEqual([]);
    });

    it('lists every wall an item overlaps at a corner in wall-id order', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        const id = place(doc, 'wide', 300, 0); // x -300..900, y 0..600
        expect(run(doc).map((c) => [c.kind, c.entityId, c.otherId])).toEqual([
            ['overlaps_wall', id, 'w_0000000001'],
            ['overlaps_wall', id, 'w_0000000004'],
        ]);
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
        doc.placements[id]!.elevation = 999;
        expect(kinds(run(doc))).toEqual(['overlaps_wall']);
        doc.placements[id]!.elevation = 1000; // exactly at the wall top
        expect(kinds(run(doc))).toEqual([]);
    });

    it('draws the line at exactly 2500 mm2 (2500 passes, 2501 conflicts)', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        const id = place(doc, 'strip2500', 2500, -1); // 2500 x 1 inside the wall
        expect(run(doc)).toEqual([]);
        doc.placements[id]!.designId = 'strip2501';
        const result = run(doc);
        expect(kinds(result)).toEqual(['overlaps_wall']);
        expect(result[0]!.params.areaMm2).toBe(2501);
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

    it('draws the line at exactly 2500 mm2 (2500 passes, 2501 conflicts)', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        place(doc, 'slab', 2500, 1500); // x 1000..4000, y 1500..2400
        const strip = place(doc, 'strip2500', 2500, 2399); // inside the slab
        expect(run(doc)).toEqual([]);
        doc.placements[strip]!.designId = 'strip2501';
        expect(kinds(run(doc))).toEqual(['overlaps_item']);
    });

    it('orders the partners of one item by id even when the sweep meets them in another order', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        // sweep order by left edge: x_...1 (500), x_...3 (1000), x_...2 (2600)
        const big = { x: 2500, y: 2000, width: 4000, depth: 2000 };
        fix(doc, { id: 'x_0000000001', ...big });
        fix(doc, { id: 'x_0000000002', x: 3000, y: 2000, width: 800 });
        fix(doc, { id: 'x_0000000003', x: 1400, y: 2000, width: 800 });
        expect(run(doc).map((c) => [c.kind, c.entityId, c.otherId])).toEqual([
            ['overlaps_item', 'x_0000000001', 'x_0000000002'],
            ['overlaps_item', 'x_0000000001', 'x_0000000003'],
        ]);
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

    it.each([
        ['right leaf', 2750],
        ['left leaf', 2250],
    ])(
        'reports the larger leaf of a double door (%s dominates)',
        (_label, x) => {
            const doc = makeRectPlan(5000, 4000, 230);
            const door = open(doc, { type: 'double_swing' }); // leaves 2050..2500 and 2500..2950
            const id = place(doc, 'pair', x, 300);
            const geom = derivePlanGeometry(doc);
            const sectors = doorSwingSectors(doc, geom);
            const ring = placementRing(doc, id);
            const areas = sectors.map((s) =>
                intersectionArea(
                    [{ outer: ring, holes: [] }],
                    [{ outer: s.polygon, holes: [] }],
                ),
            );
            expect(Math.min(...areas)).toBeGreaterThan(2500);
            expect(Math.max(...areas) - Math.min(...areas)).toBeGreaterThan(
                5000,
            );
            const result = run(doc);
            expect(result.map((c) => [c.kind, c.entityId, c.otherId])).toEqual([
                ['blocks_door', id, door],
            ]);
            expect(result[0]!.params.areaMm2).toBe(
                Math.round(Math.max(...areas)),
            );
        },
    );

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

    it('does not count touching vertical ranges (item top at the sill)', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        window(doc); // sill 900
        const id = place(doc, 'h900', 2500, 115);
        expect(run(doc)).toEqual([]);
        doc.placements[id]!.designId = 'h901';
        expect(kinds(run(doc))).toEqual(['blocks_window']);
    });

    it('draws the line at exactly 2500 mm2 of the clear zone', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        open(doc, {
            kind: 'window',
            type: 'casement',
            width: 3000, // x 1000..4000; the clear zone reaches y = 415
            height: 1200,
            sillHeight: 900,
        });
        // a strip 1 mm deep that sticks 1 mm into the zone: area = width
        const id = place(doc, 'stripTall2500', 2500, 414);
        expect(run(doc)).toEqual([]);
        doc.placements[id]!.designId = 'stripTall2501';
        expect(kinds(run(doc))).toEqual(['blocks_window']);
    });

    it('raises blocks_window for a french window as well', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        const win = open(doc, {
            kind: 'window',
            type: 'french_window',
            offset: 2500,
            width: 1200,
            height: 2100,
            sillHeight: 0,
            hinge: 'start',
            swing: 'left', // swings outside; the room side stays clear of sectors
        });
        const id = place(doc, 'wide', 2500, 115);
        expect(run(doc).map((c) => [c.kind, c.entityId, c.otherId])).toEqual([
            ['blocks_window', id, win],
        ]);
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
        // leaf 1 hinges at u0 and sweeps toward the middle; leaf 2 mirrors it
        const pinned = [
            { hinge: [2050, -115], closed: [2500, -115], open: [2050, -565] },
            { hinge: [2950, -115], closed: [2500, -115], open: [2950, -565] },
        ] as const;
        sectors.forEach((s, i) => {
            const leaf = pinned[i]!;
            const poly = s.polygon;
            expect(at(poly[0]!, leaf.hinge[0], leaf.hinge[1])).toBe(true);
            const ends = [poly[1]!, poly[17]!];
            expect(
                ends.some((p) => at(p, leaf.closed[0], leaf.closed[1])),
            ).toBe(true);
            expect(ends.some((p) => at(p, leaf.open[0], leaf.open[1]))).toBe(
                true,
            );
            // the leaf stays within its own half of the opening
            const [lo, hi] = i === 0 ? [2050, 2500] : [2500, 2950];
            for (const p of poly) {
                expect(p.x).toBeGreaterThanOrEqual(lo - 1e-6);
                expect(p.x).toBeLessThanOrEqual(hi + 1e-6);
            }
            for (const p of poly.slice(1)) {
                expect(
                    Math.hypot(p.x - poly[0]!.x, p.y - poly[0]!.y),
                ).toBeCloseTo(450, 6);
            }
        });
    });

    describe('on a wall at 30 degrees', () => {
        // wall (0,0)->(4330,2500): length 5000, d = (cos30, sin30), n = (d.y, -d.x)
        const L = Math.hypot(4330, 2500);
        const d = { x: 4330 / L, y: 2500 / L };
        const n = { x: d.y, y: -d.x };
        const wallDoc = (opening: Partial<Opening>): PlanDocument => {
            const doc = emptyPlan();
            doc.nodes['n_0000000001'] = { id: 'n_0000000001', x: 0, y: 0 };
            doc.nodes['n_0000000002'] = {
                id: 'n_0000000002',
                x: 4330,
                y: 2500,
            };
            doc.walls[TOP] = {
                id: TOP,
                a: 'n_0000000001',
                b: 'n_0000000002',
                thickness: 230,
                height: 2600,
                kind: 'exterior',
                justification: 'center',
                material: 'brick',
                colorHex: null,
            };
            open(doc, opening);
            return doc;
        };
        const point = (u: number, across: number): Vec2 => ({
            x: u * d.x + across * n.x,
            y: u * d.y + across * n.y,
        });
        const close = (p: Vec2, q: Vec2): void => {
            expect(p.x).toBeCloseTo(q.x, 6);
            expect(p.y).toBeCloseTo(q.y, 6);
        };
        const u0 = 2500 - 450;
        const u1 = 2500 + 450;

        it.each([
            ['start', 'left', u0, 1],
            ['start', 'right', u0, -1],
            ['end', 'left', u1, 1],
            ['end', 'right', u1, -1],
        ] as const)(
            'hinge %s swing %s sweeps from the wall to the normal',
            (hinge, swing, hingeU, sign) => {
                const doc = wallDoc({
                    offset: 2500,
                    hinge,
                    swing,
                });
                const polygon = sectorsOf(doc)[0]!.polygon;
                const toward = hinge === 'start' ? 1 : -1;
                const centre = point(hingeU, sign * 115);
                close(polygon[0]!, centre);
                const closedEnd = point(hingeU + toward * 900, sign * 115);
                const openEnd = point(hingeU, sign * (115 + 900));
                const ends = [polygon[1]!, polygon[17]!];
                expect(
                    ends.some(
                        (p) =>
                            Math.hypot(p.x - closedEnd.x, p.y - closedEnd.y) <
                            1e-6,
                    ),
                ).toBe(true);
                expect(
                    ends.some(
                        (p) =>
                            Math.hypot(p.x - openEnd.x, p.y - openEnd.y) < 1e-6,
                    ),
                ).toBe(true);
                expect(signedArea(polygon)).toBeGreaterThan(0);
            },
        );

        it.each([
            ['left', 1],
            ['right', -1],
        ] as const)(
            'pins both leaves of a double_swing door on the 30 degree wall (swing %s)',
            (swing, sign) => {
                const doc = wallDoc({
                    type: 'double_swing',
                    offset: 2500,
                    swing,
                });
                const sectors = sectorsOf(doc);
                expect(sectors).toHaveLength(2);
                const leaves = [
                    // leaf 1 hinges at u0, closes at the door centre
                    { hingeU: u0, closedU: 2500 },
                    // leaf 2 hinges at u1, closes at the door centre
                    { hingeU: u1, closedU: 2500 },
                ];
                sectors.forEach((s, i) => {
                    const leaf = leaves[i]!;
                    const hinge = point(leaf.hingeU, sign * 115);
                    const closedEnd = point(leaf.closedU, sign * 115);
                    const openEnd = point(leaf.hingeU, sign * (115 + 450));
                    close(s.polygon[0]!, hinge);
                    const ends = [s.polygon[1]!, s.polygon[17]!];
                    const near = (p: Vec2, q: Vec2): boolean =>
                        Math.hypot(p.x - q.x, p.y - q.y) < 1e-6;
                    expect(ends.some((p) => near(p, closedEnd))).toBe(true);
                    expect(ends.some((p) => near(p, openEnd))).toBe(true);
                    expect(signedArea(s.polygon)).toBeGreaterThan(0);
                });
            },
        );
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

describe.each([
    ['HDB 3-room', buildHdb3Room, 8],
    ['brochure 2BHK', buildBrochure2Bhk, 7],
])('%s reference plan door swings', (_name, build, doorCount) => {
    const doc = build();
    const geom = derivePlanGeometry(doc);
    const swingDoors = Object.values(doc.openings)
        .filter((o) => o.type === 'single_swing' || o.type === 'main_entrance')
        .map((o) => o.id)
        .sort();

    it('has one sector per swing door, on the side the door opens into', () => {
        expect(swingDoors).toHaveLength(doorCount);
        const sectors = doorSwingSectors(doc, geom);
        expect(sectors.map((s) => s.openingId)).toEqual(swingDoors);

        for (const sector of sectors) {
            const opening = doc.openings[sector.openingId]!;
            const derived = geom.openings[sector.openingId]!;
            const [a, b] = geom.walls[opening.wallId]!.centerline;
            expect(sector.polygon).toHaveLength(18);
            expect(signedArea(sector.polygon)).toBeGreaterThan(0);
            // swing 'left' is the +normal half-plane (04 2.1-3)
            for (const p of sector.polygon) {
                expect(sideOf(a, b, p)).toBe(derived.swingSign);
            }
        }
    });

    it('opens every swing door into a room, with the whole sector inside it', () => {
        for (const sector of doorSwingSectors(doc, geom)) {
            const opening = doc.openings[sector.openingId]!;
            const derived = geom.openings[sector.openingId]!;
            const wall = geom.walls[opening.wallId]!;
            const key =
                derived.swingSign === 1 ? wall.leftRoomKey : wall.rightRoomKey;
            expect(key, `${sector.openingId} swings outside`).not.toBeNull();
            const room = geom.rooms[geom.roomIndexByFaceKey[key!]!]!;
            for (const p of sector.polygon) {
                expect(
                    pointInPolygon(
                        p,
                        { outer: room.polygon, holes: room.holes },
                        1,
                    ),
                    `${sector.openingId} point ${p.x},${p.y}`,
                ).not.toBe('outside');
            }
        }
    });

    it('raises no conflict for an empty plan', () => {
        expect(computePlacementConflicts(doc, geom, () => null)).toEqual([]);
    });
});

describe('scale', () => {
    it('handles 1000 random placements in the HDB plan quickly and deterministically', () => {
        const doc = buildHdb3Room();
        const geom = derivePlanGeometry(doc);
        const random = mulberry32(2026);
        const designs = Object.keys(SIZES);
        for (let i = 0; i < 1000; i += 1) {
            place(
                doc,
                designs[Math.floor(random() * designs.length)]!,
                Math.round(random() * 11000),
                Math.round(random() * 8000),
                {
                    id: `f_${String(i + 1).padStart(10, '0')}`,
                    rotation: Math.floor(random() * 4) * 90,
                    elevation: Math.floor(random() * 3) * 700,
                },
            );
        }
        const started = performance.now();
        const first = computePlacementConflicts(doc, geom, provider);
        const elapsed = performance.now() - started;
        expect(first.length).toBeGreaterThan(100);
        expect(new Set(first.map((c) => c.kind)).size).toBe(4);
        expect(computePlacementConflicts(doc, geom, provider)).toEqual(first);
        // generous bound: about 20x the measured time on CI hardware
        expect(elapsed).toBeLessThan(2000);
    });
});
