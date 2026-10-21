import { describe, expect, it } from 'vitest';
import * as engine from '../../index';
import type { Vec2 } from '../../geometry/vec2';
import { derivePlanGeometry, type DerivedPlan } from '../derive';
import type { Opening, PlanDocument } from '../schema';
import {
    snapOpeningPosition,
    type OpeningSnapInput,
    type OpeningSnapResult,
} from '../snapOpening';
import { emptyPlan } from '../testing/fixtures';

const WALL = 'w_0000000001';
const WALL_2 = 'w_0000000002';

/** Adds a wall `(x1, y1) -> (x2, y2)` with its own two nodes. */
function addWall(
    doc: PlanDocument,
    id: string,
    [x1, y1, x2, y2]: readonly [number, number, number, number],
    thickness = 230,
): void {
    const a = `n_${id.slice(2)}a`;
    const b = `n_${id.slice(2)}b`;
    doc.nodes[a] = { id: a, x: x1, y: y1 };
    doc.nodes[b] = { id: b, x: x2, y: y2 };
    doc.walls[id] = {
        id,
        a,
        b,
        thickness,
        height: 2700,
        kind: 'interior',
        justification: 'center',
        material: 'brick',
        colorHex: null,
    };
}

function addDoor(
    doc: PlanDocument,
    id: string,
    wallId: string,
    offset: number,
    width = 900,
): Opening {
    const o: Opening = {
        id,
        wallId,
        kind: 'door',
        type: 'single_swing',
        offset,
        width,
        height: 2100,
        sillHeight: 0,
        hinge: 'start',
        swing: 'left',
        label: null,
    };
    doc.openings[id] = o;
    return o;
}

/** A single horizontal 4000 mm wall, t 230: left (+n) is up on screen. */
function horizontalWall(): PlanDocument {
    const doc = emptyPlan();
    addWall(doc, WALL, [0, 0, 4000, 0]);
    return doc;
}

function snap(
    doc: PlanDocument,
    patch: Partial<OpeningSnapInput> & { cursor: Vec2 },
    geom: DerivedPlan = derivePlanGeometry(doc),
): OpeningSnapResult {
    return snapOpeningPosition({
        zoom: 0.1,
        pointerType: 'mouse',
        width: 900,
        openingId: null,
        preferredWallId: null,
        geom,
        doc,
        modifiers: { shift: false, alt: false },
        ...patch,
    });
}

const pt = (x: number, y: number): Vec2 => ({ x, y });

describe('snapOpeningPosition: wall under the cursor', () => {
    it('finds the wall whose outline contains the cursor', () => {
        const r = snap(horizontalWall(), { cursor: pt(1234, 100) });
        expect(r.wallId).toBe(WALL);
    });

    it('finds the nearest centre line within 2*tol + thickness/2', () => {
        // tol 80 -> 160 + 115 = 275 from the centre line.
        const doc = horizontalWall();
        expect(snap(doc, { cursor: pt(1234, 270) }).wallId).toBe(WALL);
        expect(snap(doc, { cursor: pt(1234, 280) }).wallId).toBeNull();
    });

    it('widens the reach for a touch pointer', () => {
        const doc = horizontalWall();
        // touch tol 160 -> 320 + 115 = 435
        expect(
            snap(doc, { cursor: pt(1234, 400), pointerType: 'touch' }).wallId,
        ).toBe(WALL);
        expect(snap(doc, { cursor: pt(1234, 400) }).wallId).toBeNull();
    });

    it('reports no wall as an invalid, reasonless position', () => {
        const r = snap(horizontalWall(), { cursor: pt(2000, 900) });
        expect(r).toEqual({
            wallId: null,
            offset: 0,
            valid: false,
            swing: 'left',
            hinge: 'start',
            guides: [],
            reasonKey: null,
        });
    });

    it('returns no wall on an empty plan', () => {
        const r = snap(emptyPlan(), { cursor: pt(0, 0) });
        expect(r.wallId).toBeNull();
        expect(r.valid).toBe(false);
    });

    it('prefers the preferred wall while it still qualifies (sticky drag)', () => {
        const doc = emptyPlan();
        addWall(doc, WALL, [0, 0, 4000, 0]);
        addWall(doc, WALL_2, [0, 300, 4000, 300]);
        // y = 100 lies inside wall 1's outline; wall 2 is 200 away (< 275).
        expect(snap(doc, { cursor: pt(2000, 100) }).wallId).toBe(WALL);
        expect(
            snap(doc, { cursor: pt(2000, 100), preferredWallId: WALL_2 })
                .wallId,
        ).toBe(WALL_2);
        // y = -100: wall 2 is 400 away, outside its reach: not sticky any more.
        expect(
            snap(doc, { cursor: pt(2000, -100), preferredWallId: WALL_2 })
                .wallId,
        ).toBe(WALL);
    });

    it('ignores an unknown preferred wall', () => {
        const r = snap(horizontalWall(), {
            cursor: pt(2000, 0),
            preferredWallId: 'w_nothere00',
        });
        expect(r.wallId).toBe(WALL);
    });

    it('picks the nearer centre line when several walls qualify', () => {
        const doc = emptyPlan();
        addWall(doc, WALL, [0, 0, 4000, 0]);
        addWall(doc, WALL_2, [0, 300, 4000, 300]);
        // Between the walls, outside both outlines (-115..115, 185..415).
        expect(snap(doc, { cursor: pt(2000, 160) }).wallId).toBe(WALL_2);
        expect(snap(doc, { cursor: pt(2000, 140) }).wallId).toBe(WALL);
    });
});

describe('snapOpeningPosition: offset targets (04 §5.7-3)', () => {
    it('snaps to the wall centre with a face guide', () => {
        const r = snap(horizontalWall(), { cursor: pt(1990, 30) });
        expect(r.offset).toBe(2000);
        expect(r.valid).toBe(true);
        expect(r.reasonKey).toBeNull();
        expect(r.guides).toHaveLength(1);
        const g = r.guides[0]!;
        expect(g.kind).toBe('face');
        // A line across the wall thickness at the centre.
        expect(g.a.x).toBeCloseTo(2000, 6);
        expect(g.b.x).toBeCloseTo(2000, 6);
        expect(Math.abs(g.a.y - g.b.y)).toBeCloseTo(230, 6);
    });

    it('snaps to the start return: opening edge 100 mm from the inner corner', () => {
        const doc = horizontalWall();
        const geom = derivePlanGeometry(doc);
        const safe0 = geom.walls[WALL]!.safeU[0];
        const r = snap(doc, { cursor: pt(530, 0) }, geom);
        expect(r.offset).toBe(safe0 + 100 + 450);
        expect(r.offset).toBe(550);
        expect(r.guides.map((g) => g.kind)).toEqual(['face']);
        // The guide marks the opening edge (u0 = safeU[0] + 100).
        expect(r.guides[0]!.a.x).toBeCloseTo(safe0 + 100, 6);
    });

    it('snaps to the end return: opening edge 100 mm from the far inner corner', () => {
        const doc = horizontalWall();
        const geom = derivePlanGeometry(doc);
        const safe1 = geom.walls[WALL]!.safeU[1];
        const r = snap(doc, { cursor: pt(3470, 0) }, geom);
        expect(r.offset).toBe(safe1 - 100 - 450);
        expect(r.offset).toBe(3450);
        expect(r.guides[0]!.a.x).toBeCloseTo(safe1 - 100, 6);
    });

    it('uses the safe range of a joined wall, not the centre-line ends', () => {
        // A closed room: the wall's inner corner is thickness/2 inside the node.
        const doc = emptyPlan();
        const ring: Array<[number, number]> = [
            [0, 0],
            [4000, 0],
            [4000, 3000],
            [0, 3000],
        ];
        ring.forEach(([x, y], i) => {
            doc.nodes[`n_000000000${i}`] = { id: `n_000000000${i}`, x, y };
        });
        ring.forEach((_, i) => {
            const id = `w_000000000${i + 1}`;
            doc.walls[id] = {
                id,
                a: `n_000000000${i}`,
                b: `n_000000000${(i + 1) % 4}`,
                thickness: 230,
                height: 2700,
                kind: 'exterior',
                justification: 'center',
                material: 'brick',
                colorHex: null,
            };
        });
        const geom = derivePlanGeometry(doc);
        const safe0 = geom.walls['w_0000000001']!.safeU[0];
        expect(safe0).toBeGreaterThan(0);
        const r = snap(doc, { cursor: pt(safe0 + 540, 0) }, geom);
        expect(r.wallId).toBe('w_0000000001');
        expect(r.offset).toBe(Math.round(safe0 + 100 + 450));
    });

    it('prefers the closest target and the centre on ties of nothing', () => {
        // Cursor 1960: centre is 40 away, nothing else is near.
        expect(snap(horizontalWall(), { cursor: pt(1960, 0) }).offset).toBe(
            2000,
        );
    });

    it('does not snap beyond tol (80 mm for a mouse at 0.1 px/mm)', () => {
        const r = snap(horizontalWall(), { cursor: pt(1910, 0) });
        expect(r.offset).toBe(1910);
        expect(r.guides).toEqual([]);
    });

    it('snaps from further away with a touch pointer', () => {
        const doc = horizontalWall();
        expect(
            snap(doc, { cursor: pt(1900, 0), pointerType: 'touch' }).offset,
        ).toBe(2000);
        expect(snap(doc, { cursor: pt(1900, 0) }).offset).toBe(1900);
    });

    it('rounds a free position to 10 mm', () => {
        const doc = horizontalWall();
        expect(snap(doc, { cursor: pt(1234, 0) }).offset).toBe(1230);
        expect(snap(doc, { cursor: pt(1236, 0) }).offset).toBe(1240);
        expect(snap(doc, { cursor: pt(1235, 0) }).offset).toBe(1240);
    });

    it('rounds to 1 mm with Alt and takes no targets', () => {
        const doc = horizontalWall();
        const alt = { shift: false, alt: true };
        const free = snap(doc, { cursor: pt(1234.4, 0), modifiers: alt });
        expect(free.offset).toBe(1234);
        const nearCentre = snap(doc, { cursor: pt(1990, 0), modifiers: alt });
        expect(nearCentre.offset).toBe(1990);
        expect(nearCentre.guides).toEqual([]);
    });

    it('clamps to [width/2, length - width/2] at the ends', () => {
        const doc = horizontalWall();
        // Cursor inside the outline, beyond the clamp range but not near a return.
        expect(snap(doc, { cursor: pt(120, 0) }).offset).toBe(450);
        expect(snap(doc, { cursor: pt(3900, 0) }).offset).toBe(3550);
        expect(snap(doc, { cursor: pt(120, 0), width: 400 }).offset).toBe(200);
    });

    it('stays an integer with an odd width', () => {
        const r = snap(horizontalWall(), {
            cursor: pt(60, 0),
            width: 901,
            modifiers: { shift: false, alt: true },
        });
        expect(Number.isInteger(r.offset)).toBe(true);
        expect(r.offset).toBeGreaterThanOrEqual(450.5);
        expect(r.valid).toBe(true);
    });

    it('never returns -0', () => {
        const r = snap(horizontalWall(), { cursor: pt(2000, -0) });
        expect(Object.is(r.offset, -0)).toBe(false);
        for (const g of r.guides) {
            for (const v of [g.a.x, g.a.y, g.b.x, g.b.y]) {
                expect(Object.is(v, -0)).toBe(false);
            }
        }
    });
});

describe('snapOpeningPosition: validity (04 §5.7-2, 5)', () => {
    it('is invalid with opening_no_fit when the opening is wider than the wall', () => {
        const r = snap(horizontalWall(), {
            cursor: pt(2000, 0),
            width: 4100,
        });
        expect(r.wallId).toBe(WALL);
        expect(r.valid).toBe(false);
        expect(r.reasonKey).toBe('engine.plan.snap.opening_no_fit');
        expect(r.offset).toBe(2000);
        expect(r.guides).toEqual([]);
    });

    it('fits an opening exactly as wide as the wall', () => {
        const r = snap(horizontalWall(), {
            cursor: pt(2000, 0),
            width: 4000,
        });
        expect(r.valid).toBe(true);
        expect(r.offset).toBe(2000);
    });

    it('is invalid with opening_overlap over an existing door', () => {
        const doc = horizontalWall();
        addDoor(doc, 'o_0000000001', WALL, 1000); // u 550..1450
        const r = snap(doc, { cursor: pt(1500, 0) }); // 1050..1950
        expect(r.valid).toBe(false);
        expect(r.reasonKey).toBe('engine.plan.snap.opening_overlap');
        expect(r.offset).toBe(1500);
    });

    it('allows touching openings (gap 0)', () => {
        const doc = horizontalWall();
        addDoor(doc, 'o_0000000001', WALL, 1000); // ends at 1450
        const r = snap(doc, { cursor: pt(1900, 0) }); // starts at 1450
        expect(r.offset).toBe(1900);
        expect(r.valid).toBe(true);
        expect(r.reasonKey).toBeNull();
    });

    it('ignores the opening being moved (openingId)', () => {
        const doc = horizontalWall();
        addDoor(doc, 'o_0000000001', WALL, 1000);
        expect(snap(doc, { cursor: pt(1100, 0) }).valid).toBe(false);
        const own = snap(doc, {
            cursor: pt(1100, 0),
            openingId: 'o_0000000001',
        });
        expect(own.valid).toBe(true);
        expect(own.reasonKey).toBeNull();
    });

    it('ignores openings of other walls', () => {
        const doc = emptyPlan();
        addWall(doc, WALL, [0, 0, 4000, 0]);
        addWall(doc, WALL_2, [0, 2000, 4000, 2000]);
        addDoor(doc, 'o_0000000001', WALL_2, 1000);
        expect(snap(doc, { cursor: pt(1000, 0) }).valid).toBe(true);
    });

    it('reports opening_no_fit before opening_overlap', () => {
        const doc = horizontalWall();
        addDoor(doc, 'o_0000000001', WALL, 1000);
        const r = snap(doc, { cursor: pt(1000, 0), width: 4100 });
        expect(r.reasonKey).toBe('engine.plan.snap.opening_no_fit');
    });
});

describe('snapOpeningPosition: swing and hinge (04 §5.7)', () => {
    it('swings to the cursor side of the centre line (left = +n)', () => {
        const doc = horizontalWall();
        // d = (1, 0), n = (0, -1): up on screen is left.
        expect(snap(doc, { cursor: pt(1234, -50) }).swing).toBe('left');
        expect(snap(doc, { cursor: pt(1234, 50) }).swing).toBe('right');
    });

    it('uses the wall normal, not the screen axes', () => {
        const doc = emptyPlan();
        addWall(doc, WALL, [0, 0, 0, 4000]); // d = (0, 1), n = (1, 0)
        expect(snap(doc, { cursor: pt(50, 1234) }).swing).toBe('left');
        expect(snap(doc, { cursor: pt(-50, 1234) }).swing).toBe('right');
    });

    it("hinges at 'start' when the cursor is before the offset, else 'end'", () => {
        const doc = horizontalWall();
        // 1234 rounds to 1230: the cursor is past the opening centre.
        expect(snap(doc, { cursor: pt(1234, 0) }).hinge).toBe('end');
        // 1226 rounds to 1230: the cursor is before it.
        expect(snap(doc, { cursor: pt(1226, 0) }).hinge).toBe('start');
        // Centre snap: 1990 < 2000, 2010 > 2000.
        expect(snap(doc, { cursor: pt(1990, 0) }).hinge).toBe('start');
        expect(snap(doc, { cursor: pt(2010, 0) }).hinge).toBe('end');
    });

    it('measures u along the wall direction of a diagonal wall', () => {
        const doc = emptyPlan();
        addWall(doc, WALL, [0, 0, 3000, 4000]); // length 5000, d = (0.6, 0.8)
        // u = 2000 -> point (1200, 1600); n = (0.8, -0.6) is left.
        const r = snap(doc, {
            cursor: pt(1200 + 0.8 * 40, 1600 - 0.6 * 40),
            width: 800,
        });
        expect(r.wallId).toBe(WALL);
        expect(r.offset).toBe(2000);
        expect(r.swing).toBe('left');
    });
});

describe('snapOpeningPosition: purity and determinism', () => {
    it('does not mutate its inputs and is repeatable', () => {
        const doc = horizontalWall();
        addDoor(doc, 'o_0000000001', WALL, 1000);
        const geom = derivePlanGeometry(doc);
        const before = JSON.stringify(doc);
        const a = snap(doc, { cursor: pt(1990, 30) }, geom);
        const b = snap(doc, { cursor: pt(1990, 30) }, geom);
        expect(a).toEqual(b);
        expect(JSON.stringify(doc)).toBe(before);
    });
});

describe('engine index exports', () => {
    it('exposes the opening and footprint snappers and the reason keys', () => {
        expect(engine.snapOpeningPosition).toBe(snapOpeningPosition);
        expect(typeof engine.snapFootprint).toBe('function');
        expect(engine.OPENING_SNAP_REASONS).toEqual([
            'engine.plan.snap.opening_no_fit',
            'engine.plan.snap.opening_overlap',
        ]);
    });
});
