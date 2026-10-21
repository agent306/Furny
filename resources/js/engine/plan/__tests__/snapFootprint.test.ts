import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../../geometry/vec2';
import { mulberry32 } from '../../testing/random';
import { derivePlanGeometry } from '../derive';
import {
    rotationFromFront,
    type FootprintProvider,
    type FootprintSize,
} from '../footprint';
import type { Fixture, FurniturePlacement, PlanDocument } from '../schema';
import { snapFootprint } from '../snapFootprint';
import type { FootprintSnapInput, FootprintSnapResult } from '../snapFootprint';
import { buildSnapIndex } from '../snapIndex';
import { defaultSnapSettings } from '../snapping';
import { emptyPlan } from '../testing/fixtures';

const WALL = 'w_0000000001';

const sizes: Record<string, FootprintSize> = {
    a: { width: 1200, depth: 600, height: 750 },
    b: { width: 800, depth: 400, height: 750 },
};
const provider: FootprintProvider = (id) => sizes[id] ?? null;

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

function placement(
    id: string,
    x: number,
    y: number,
    rotation = 0,
    designId = 'a',
): FurniturePlacement {
    return {
        id,
        designId,
        x,
        y,
        rotation,
        elevation: 0,
        mirrored: false,
        wallAttachment: null,
    };
}

/** A single horizontal 4000 mm wall, t 230: left face y = -115, right face y = 115. */
function wallPlan(): PlanDocument {
    const doc = emptyPlan();
    addWall(doc, WALL, [0, 0, 4000, 0]);
    return doc;
}

function snap(
    doc: PlanDocument,
    patch: Partial<FootprintSnapInput> & { cursorBackCenter: Vec2 },
): FootprintSnapResult {
    const geom = derivePlanGeometry(doc);
    const index = buildSnapIndex(doc, geom, provider);
    return snapFootprint(
        {
            rotation: 0,
            width: 1200,
            depth: 600,
            elevation: 0,
            height: 750,
            zoom: 0.1,
            pointerType: 'mouse',
            modifiers: { shift: false, alt: false },
            exclude: new Set<string>(),
            settings: defaultSnapSettings('metric'),
            keepRotation: false,
            ...patch,
        },
        index,
        geom,
    );
}

const pt = (x: number, y: number): Vec2 => ({ x, y });
const LEFT_ROTATION = rotationFromFront({ x: 0, y: -1 }); // +n of the wall

describe('snapFootprint: wall faces (04 §5.8-2)', () => {
    it('attaches to the left face with rotationFromFront(+n), clamped inside the face', () => {
        const r = snap(wallPlan(), { cursorBackCenter: pt(1500, -100) });
        expect(LEFT_ROTATION).toBe(180);
        expect(r.wallAttachment).toEqual({ wallId: WALL, side: 'left' });
        expect(r.rotation).toBe(LEFT_ROTATION);
        expect(r.backCenter).toEqual(pt(1500, -115));
        expect(r.guides.map((g) => g.kind)).toEqual(['face']);
        expect(r.guides[0]).toEqual({
            kind: 'face',
            a: pt(0, -115),
            b: pt(4000, -115),
        });
        expect(r.markers).toEqual([]);
    });

    it('attaches to the right face facing -n', () => {
        const r = snap(wallPlan(), { cursorBackCenter: pt(1500, 100) });
        expect(r.wallAttachment).toEqual({ wallId: WALL, side: 'right' });
        expect(r.rotation).toBe(0);
        expect(r.backCenter).toEqual(pt(1500, 115));
    });

    it('clamps the back centre to width/2 from each face end', () => {
        const doc = wallPlan();
        const start = snap(doc, { cursorBackCenter: pt(100, -100) });
        // Flush to the corner: t = width/2 = 600 from the face start.
        expect(start.backCenter).toEqual(pt(600, -115));
        const end = snap(doc, { cursorBackCenter: pt(3950, -100) });
        expect(end.backCenter).toEqual(pt(3400, -115));
    });

    it('flush-to-corner snaps at t = width/2 with an endpoint marker on the corner', () => {
        const doc = wallPlan();
        const nearStart = snap(doc, { cursorBackCenter: pt(660, -100) });
        expect(nearStart.backCenter).toEqual(pt(600, -115));
        expect(nearStart.markers).toEqual([
            { kind: 'endpoint', at: pt(0, -115) },
        ]);
        const nearEnd = snap(doc, { cursorBackCenter: pt(3340, -100) });
        expect(nearEnd.backCenter).toEqual(pt(3400, -115));
        expect(nearEnd.markers).toEqual([
            { kind: 'endpoint', at: pt(4000, -115) },
        ]);
    });

    it('snaps to the face centre within tol', () => {
        const r = snap(wallPlan(), { cursorBackCenter: pt(2050, -100) });
        expect(r.backCenter).toEqual(pt(2000, -115));
        expect(r.markers).toEqual([]);
        const off = snap(wallPlan(), { cursorBackCenter: pt(2090, -100) });
        expect(off.backCenter.x).toBe(2090);
    });

    it('does not snap to a corner target beyond tol', () => {
        const r = snap(wallPlan(), { cursorBackCenter: pt(700, -100) });
        expect(r.backCenter).toEqual(pt(700, -115));
        expect(r.markers).toEqual([]);
    });

    describe('target choice on a face barely longer than the footprint', () => {
        // Face 1300, width 1200: corners at t = 600 and 700, centre at 650.
        const shortWall = (): PlanDocument => {
            const doc = emptyPlan();
            addWall(doc, WALL, [0, 0, 1300, 0]);
            return doc;
        };
        const at = (x: number): FootprintSnapResult =>
            snap(shortWall(), { cursorBackCenter: pt(x, -100) });

        it('takes the centre, without a corner marker, when the cursor is on it', () => {
            const r = at(650);
            expect(r.backCenter).toEqual(pt(650, -115));
            expect(r.markers).toEqual([]);
        });

        it('takes the nearer target on either side of the corner/centre midpoints', () => {
            expect(at(624).backCenter.x).toBe(600);
            expect(at(624).markers).toEqual([
                { kind: 'endpoint', at: pt(0, -115) },
            ]);
            expect(at(626).backCenter.x).toBe(650);
            expect(at(626).markers).toEqual([]);
            expect(at(674).backCenter.x).toBe(650);
            expect(at(674).markers).toEqual([]);
            expect(at(676).backCenter.x).toBe(700);
            expect(at(676).markers).toEqual([
                { kind: 'endpoint', at: pt(1300, -115) },
            ]);
        });
    });

    it('rounds the free along-face coordinate to the raw step, not 1 mm', () => {
        const doc = wallPlan();
        // rawStepFor(0.1) = 10
        expect(
            snap(doc, { cursorBackCenter: pt(1504, -100) }).backCenter,
        ).toEqual(pt(1500, -115));
        expect(
            snap(doc, { cursorBackCenter: pt(1506, -100) }).backCenter,
        ).toEqual(pt(1510, -115));
        // rawStepFor(0.02) = 100
        expect(
            snap(doc, { cursorBackCenter: pt(1540, -100), zoom: 0.02 })
                .backCenter,
        ).toEqual(pt(1500, -115));
    });

    it('keeps the rounded along-face coordinate inside a face shorter than the footprint', () => {
        const doc = emptyPlan();
        addWall(doc, WALL, [0, 0, 798, 0]);
        // 797 rounds to 800 at the raw step of 10, past the face end (798).
        const r = snap(doc, {
            cursorBackCenter: pt(797, -100),
            width: 1200,
        });
        expect(r.backCenter.x).toBe(798);
    });

    it('attaches within 2*tol of the face and not beyond', () => {
        const doc = wallPlan();
        // 2*tol = 160 mm: 150 from the left face (y = -115) attaches.
        expect(
            snap(doc, { cursorBackCenter: pt(1500, -265) }).wallAttachment,
        ).not.toBeNull();
        expect(
            snap(doc, { cursorBackCenter: pt(1500, -285) }).wallAttachment,
        ).toBeNull();
    });

    it('doubles the reach for a touch pointer', () => {
        const doc = wallPlan();
        expect(
            snap(doc, {
                cursorBackCenter: pt(1500, -400),
                pointerType: 'touch',
            }).wallAttachment,
        ).not.toBeNull();
        expect(
            snap(doc, { cursorBackCenter: pt(1500, -400) }).wallAttachment,
        ).toBeNull();
    });

    it('picks the face with the smallest distance', () => {
        const doc = wallPlan();
        expect(
            snap(doc, { cursorBackCenter: pt(1500, -20) }).wallAttachment?.side,
        ).toBe('left');
        expect(
            snap(doc, { cursorBackCenter: pt(1500, 20) }).wallAttachment?.side,
        ).toBe('right');
    });

    it('requires the projection to lie within the face plus width/2 slack', () => {
        const doc = wallPlan();
        expect(
            snap(doc, { cursorBackCenter: pt(-500, -100) }).wallAttachment,
        ).not.toBeNull();
        expect(
            snap(doc, { cursorBackCenter: pt(-700, -100) }).wallAttachment,
        ).toBeNull();
    });

    it('attaches to a vertical wall with the matching rotation', () => {
        const doc = emptyPlan();
        addWall(doc, WALL, [0, 0, 0, 4000]); // d = (0, 1), n = (1, 0)
        const left = snap(doc, { cursorBackCenter: pt(100, 1500) });
        expect(left.wallAttachment).toEqual({ wallId: WALL, side: 'left' });
        expect(left.rotation).toBe(rotationFromFront({ x: 1, y: 0 }));
        expect(left.rotation).toBe(270);
        expect(left.backCenter).toEqual(pt(115, 1500));
        const right = snap(doc, { cursorBackCenter: pt(-100, 1500) });
        expect(right.wallAttachment?.side).toBe('right');
        expect(right.rotation).toBe(90);
        expect(right.backCenter).toEqual(pt(-115, 1500));
    });

    it('rotates to a diagonal wall with 0.01 degree precision', () => {
        const doc = emptyPlan();
        addWall(doc, WALL, [0, 0, 3000, 4000]);
        const r = snap(doc, { cursorBackCenter: pt(1500 + 100, 2000 - 70) });
        expect(r.wallAttachment).not.toBeNull();
        expect(r.rotation).toBeGreaterThanOrEqual(0);
        expect(r.rotation).toBeLessThan(360);
        expect(
            Math.abs(r.rotation * 100 - Math.round(r.rotation * 100)),
        ).toBeLessThan(1e-6);
        // The cursor is on the +n side of the centre line, so the left face.
        expect(r.wallAttachment?.side).toBe('left');
        expect(
            Math.abs(r.rotation - rotationFromFront({ x: 0.8, y: -0.6 })),
        ).toBeLessThan(0.01);
    });

    it('skips walls listed in exclude', () => {
        const r = snap(wallPlan(), {
            cursorBackCenter: pt(1500, -100),
            exclude: new Set([WALL]),
        });
        expect(r.wallAttachment).toBeNull();
    });

    it('attaches whatever the on_face toggle says (that kind is the Dimension snap)', () => {
        const settings = defaultSnapSettings('metric');
        settings.kinds.on_face = false;
        const r = snap(wallPlan(), {
            cursorBackCenter: pt(1500, -100),
            settings,
        });
        expect(r.wallAttachment).toEqual({ wallId: WALL, side: 'left' });
    });

    it('is not fooled by a face shorter than the footprint', () => {
        const doc = emptyPlan();
        addWall(doc, WALL, [0, 0, 800, 0]);
        const r = snap(doc, { cursorBackCenter: pt(300, -100), width: 1200 });
        expect(r.wallAttachment).not.toBeNull();
        expect(r.backCenter.x).toBeGreaterThanOrEqual(0);
        expect(r.backCenter.x).toBeLessThanOrEqual(800);
    });

    it('does not let an alignment push the footprint off a face shorter than itself', () => {
        const doc = emptyPlan();
        addWall(doc, WALL, [0, 0, 800, 0]);
        // Spans x -930..270: our left edge (190 at t = 790) aligns +80, to
        // t = 870, which is past the face end and so is clamped to 800.
        doc.placements['f_0000000001'] = placement(
            'f_0000000001',
            -330,
            -115,
            180,
        );
        const r = snap(doc, { cursorBackCenter: pt(790, -100), width: 1200 });
        expect(r.wallAttachment).not.toBeNull();
        expect(r.backCenter.x).toBe(800);
    });
});

describe('snapFootprint: keepRotation', () => {
    it('does not attach with a 30 degree mismatch', () => {
        const r = snap(wallPlan(), {
            cursorBackCenter: pt(1500, -100),
            rotation: 30,
            keepRotation: true,
        });
        expect(r.wallAttachment).toBeNull();
        expect(r.rotation).toBe(30);
        expect(r.guides).toEqual([]);
    });

    it('attaches when the rotation is within 1 degree and aligns it', () => {
        const near = snap(wallPlan(), {
            cursorBackCenter: pt(1500, -100),
            rotation: 180.8,
            keepRotation: true,
        });
        expect(near.wallAttachment?.side).toBe('left');
        expect(near.rotation).toBe(180);
        const wrap = snap(wallPlan(), {
            cursorBackCenter: pt(1500, 100),
            rotation: 359.5,
            keepRotation: true,
        });
        expect(wrap.wallAttachment?.side).toBe('right');
        expect(wrap.rotation).toBe(0);
        const far = snap(wallPlan(), {
            cursorBackCenter: pt(1500, -100),
            rotation: 181.5,
            keepRotation: true,
        });
        expect(far.wallAttachment).toBeNull();
    });

    it('attaches to the face the rotation matches, not just the nearest', () => {
        // Cursor nearer the left face, but the footprint faces -n: right face.
        const r = snap(wallPlan(), {
            cursorBackCenter: pt(1500, -20),
            rotation: 0,
            keepRotation: true,
        });
        expect(r.wallAttachment?.side).toBe('right');
        expect(r.backCenter).toEqual(pt(1500, 115));
    });

    it('rotates freely onto a face when not keeping the rotation', () => {
        const r = snap(wallPlan(), {
            cursorBackCenter: pt(1500, -100),
            rotation: 30,
            keepRotation: false,
        });
        expect(r.wallAttachment?.side).toBe('left');
        expect(r.rotation).toBe(180);
    });

    it('normalises and rounds the kept rotation', () => {
        const r = snap(emptyPlan(), {
            cursorBackCenter: pt(0, 0),
            rotation: 365.004,
            keepRotation: true,
        });
        expect(r.rotation).toBe(5);
        const wrapped = snap(emptyPlan(), {
            cursorBackCenter: pt(0, 0),
            rotation: 359.999,
        });
        expect(wrapped.rotation).toBe(0);
    });
});

describe('snapFootprint: raw, grid and disabled (04 §5.8-1, 4)', () => {
    it('snaps to the grid when nothing is near and the grid is visible', () => {
        const r = snap(emptyPlan(), { cursorBackCenter: pt(1530, -1020) });
        // gridStepFor(0.1, metric) = 500
        expect(r.backCenter).toEqual(pt(1500, -1000));
        expect(r.wallAttachment).toBeNull();
        expect(r.guides).toEqual([]);
        expect(r.markers).toEqual([]);
    });

    it('rounds with the raw step when the grid is hidden', () => {
        const settings = defaultSnapSettings('metric');
        settings.gridVisible = false;
        const r = snap(emptyPlan(), {
            cursorBackCenter: pt(1534, -1026),
            settings,
        });
        // rawStepFor(0.1) = 10
        expect(r.backCenter).toEqual(pt(1530, -1030));
    });

    it('uses the raw step when the grid kind is off', () => {
        const settings = defaultSnapSettings('metric');
        settings.kinds.grid = false;
        const r = snap(emptyPlan(), {
            cursorBackCenter: pt(1534, -1026),
            settings,
        });
        expect(r.backCenter).toEqual(pt(1530, -1030));
    });

    it('rounds only, keeps the rotation and does not attach with Alt', () => {
        const r = snap(wallPlan(), {
            cursorBackCenter: pt(1534, -100),
            rotation: 30,
            modifiers: { shift: false, alt: true },
        });
        expect(r.backCenter).toEqual(pt(1530, -100));
        expect(r.rotation).toBe(30);
        expect(r.wallAttachment).toBeNull();
        expect(r.guides).toEqual([]);
    });

    it('does the same when snapping is disabled', () => {
        const settings = defaultSnapSettings('metric');
        settings.enabled = false;
        const r = snap(wallPlan(), {
            cursorBackCenter: pt(1534, -100),
            settings,
        });
        expect(r.backCenter).toEqual(pt(1530, -100));
        expect(r.wallAttachment).toBeNull();
    });

    it('returns integer mm and no -0', () => {
        const r = snap(wallPlan(), { cursorBackCenter: pt(0.2, -0.3) });
        for (const v of [r.backCenter.x, r.backCenter.y, r.rotation]) {
            expect(Number.isInteger(v * 100)).toBe(true);
            expect(Object.is(v, -0)).toBe(false);
        }
        expect(Number.isInteger(r.backCenter.x)).toBe(true);
        expect(Number.isInteger(r.backCenter.y)).toBe(true);
    });
});

describe('snapFootprint: furniture alignment (04 §5.8-3)', () => {
    /** Neighbour at x 1400..2600, y 3000..3600, rotation 0. */
    const neighbour = (): PlanDocument => {
        const doc = emptyPlan();
        doc.placements['f_0000000001'] = placement('f_0000000001', 2000, 3000);
        return doc;
    };

    it('snaps our left edge to the right edge of a neighbour and emits an alignment guide', () => {
        // Our width 1000: left edge = 3140 - 500 = 2640, neighbour's right = 2600.
        const r = snap(neighbour(), {
            cursorBackCenter: pt(3140, 3500),
            width: 1000,
        });
        expect(r.backCenter).toEqual(pt(3100, 3500));
        expect(r.wallAttachment).toBeNull();
        expect(r.guides).toHaveLength(1);
        const g = r.guides[0]!;
        expect(g.kind).toBe('alignment');
        // A vertical line at x = 2600 spanning both footprints (y 3000..4100).
        expect(g.a.x).toBeCloseTo(2600, 6);
        expect(g.b.x).toBeCloseTo(2600, 6);
        expect(Math.min(g.a.y, g.b.y)).toBeCloseTo(3000, 6);
        expect(Math.max(g.a.y, g.b.y)).toBeCloseTo(4100, 6);
    });

    it('snaps the other way: our right edge to their left edge', () => {
        const r = snap(neighbour(), {
            cursorBackCenter: pt(900 - 35, 3500),
            width: 1000,
        });
        // Our right edge = 865 + 500 = 1365, their left = 1400.
        expect(r.backCenter).toEqual(pt(900, 3500));
    });

    it('aligns back with back, front with front and flushes back to front', () => {
        const back = snap(neighbour(), {
            cursorBackCenter: pt(5000, 3030),
            width: 1000,
            depth: 700,
        });
        expect(back.backCenter).toEqual(pt(5000, 3000));
        // Our front = 3040 + 580 = 3620 vs their front 3600 (back is 40 off).
        const front = snap(neighbour(), {
            cursorBackCenter: pt(5000, 3040),
            width: 1000,
            depth: 580,
        });
        expect(front.backCenter).toEqual(pt(5000, 3020));
        // Our back 3640 vs their front 3600: flush.
        const flush = snap(neighbour(), {
            cursorBackCenter: pt(5000, 3640),
            width: 1000,
        });
        expect(flush.backCenter).toEqual(pt(5000, 3600));
    });

    it('aligns centre lines', () => {
        // Their centre x = 2000; ours = 2030.
        const r = snap(neighbour(), {
            cursorBackCenter: pt(2030, 5000),
            width: 700,
        });
        expect(r.backCenter.x).toBe(2000);
        expect(r.guides[0]!.kind).toBe('alignment');
    });

    it('snaps both axes independently', () => {
        const r = snap(neighbour(), {
            cursorBackCenter: pt(3140, 3030),
            width: 1000,
        });
        expect(r.backCenter).toEqual(pt(3100, 3000));
        expect(r.guides.map((g) => g.kind)).toEqual(['alignment', 'alignment']);
    });

    it('does not snap beyond tol', () => {
        const r = snap(neighbour(), {
            cursorBackCenter: pt(3200, 3500),
            width: 1000,
        });
        // Left edge 2700 is 100 off: nothing aligns, so the grid applies.
        expect(r.guides).toEqual([]);
        expect(r.backCenter).toEqual(pt(3000, 3500));
    });

    it('aligns footprints whose rotations differ by a multiple of 90 degrees', () => {
        // Rotation 90: front = (-1, 0), spans x Bx-600..Bx, y By-500..By+500.
        const r = snap(neighbour(), {
            cursorBackCenter: pt(3240, 3500),
            rotation: 90,
            width: 1000,
        });
        // Left plan edge Bx - 600 = 2640 -> their right edge 2600.
        expect(r.backCenter.x).toBe(3200);
        expect(r.rotation).toBe(90);
        expect(r.guides[0]!.kind).toBe('alignment');
    });

    it('ignores neighbours rotated off the grid of 90 degrees', () => {
        const doc = emptyPlan();
        doc.placements['f_0000000001'] = placement(
            'f_0000000001',
            2000,
            3000,
            30,
        );
        const r = snap(doc, { cursorBackCenter: pt(3140, 3500), width: 1000 });
        expect(r.guides).toEqual([]);
        const quarter = emptyPlan();
        quarter.placements['f_0000000001'] = placement(
            'f_0000000001',
            2000,
            3000,
            0.4,
        );
        const near = snap(quarter, {
            cursorBackCenter: pt(3140, 3500),
            width: 1000,
        });
        expect(near.guides.length).toBeGreaterThan(0);
    });

    it('ignores excluded footprints (the dragged item itself)', () => {
        const r = snap(neighbour(), {
            cursorBackCenter: pt(3140, 3500),
            width: 1000,
            exclude: new Set(['f_0000000001']),
        });
        expect(r.guides).toEqual([]);
    });

    it('aligns with fixtures too', () => {
        const doc = emptyPlan();
        const f: Fixture = {
            id: 'x_0000000001',
            libraryKey: 'sofa_3',
            x: 2000,
            y: 3300,
            rotation: 0,
            width: 1200,
            depth: 600,
            height: 850,
            elevation: 0,
            label: null,
        };
        doc.fixtures[f.id] = f;
        const r = snap(doc, { cursorBackCenter: pt(3140, 3500), width: 1000 });
        expect(r.backCenter).toEqual(pt(3100, 3500));
    });

    it('honours the alignment toggle', () => {
        const settings = defaultSnapSettings('metric');
        settings.kinds.alignment = false;
        const r = snap(neighbour(), {
            cursorBackCenter: pt(3140, 3500),
            width: 1000,
            settings,
        });
        expect(r.guides).toEqual([]);
    });

    it('skips the grid once an axis aligned', () => {
        // Without the neighbour the grid would pull y to 3500.
        const r = snap(neighbour(), {
            cursorBackCenter: pt(3140, 3480),
            width: 1000,
        });
        expect(r.backCenter).toEqual(pt(3100, 3480));
    });

    it('rounds the free axis of a single-axis alignment to the raw step', () => {
        const doc = neighbour();
        const r = snap(doc, { cursorBackCenter: pt(3140, 3504), width: 1000 });
        expect(r.backCenter).toEqual(pt(3100, 3500));
        const swapped = snap(doc, {
            cursorBackCenter: pt(5004, 3030),
            width: 1000,
            depth: 700,
        });
        // Back aligns to 3000, x is free: raw step 10.
        expect(swapped.backCenter).toEqual(pt(5000, 3000));
    });

    it('does not align with a neighbour rotated 3 degrees off', () => {
        const doc = emptyPlan();
        doc.placements['f_0000000001'] = placement(
            'f_0000000001',
            2000,
            3000,
            3,
        );
        const r = snap(doc, { cursorBackCenter: pt(3140, 3500), width: 1000 });
        expect(r.guides).toEqual([]);
    });

    it('only adjusts the coordinate along the face when a wall face was chosen', () => {
        const doc = wallPlan();
        // Neighbour against the same face: x 900..2100.
        doc.placements['f_0000000001'] = placement(
            'f_0000000001',
            1500,
            -115,
            180,
        );
        const r = snap(doc, {
            cursorBackCenter: pt(2560, -100),
            width: 800,
        });
        // Our left edge 2160 meets their right edge 2100: x -> 2500.
        expect(r.wallAttachment).toEqual({ wallId: WALL, side: 'left' });
        expect(r.rotation).toBe(180);
        expect(r.backCenter).toEqual(pt(2500, -115));
        expect(r.guides.map((g) => g.kind)).toEqual(['face', 'alignment']);
    });

    it('never moves the footprint off the wall face when aligning', () => {
        const doc = wallPlan();
        // A neighbour deeper in the room whose back is 40 mm off our back line.
        doc.placements['f_0000000001'] = placement(
            'f_0000000001',
            1500,
            -155,
            180,
        );
        const r = snap(doc, { cursorBackCenter: pt(1500, -100), width: 800 });
        expect(r.backCenter.y).toBe(-115);
    });

    it('prefers the corner-flush snap over an alignment along the face', () => {
        const doc = wallPlan();
        // Spans x 130..1330, so our left edge (50 at the cursor) would align
        // 80 mm to the right; the corner-flush snap (t = 600) is stronger.
        doc.placements['f_0000000001'] = placement(
            'f_0000000001',
            730,
            -115,
            180,
        );
        const r = snap(doc, { cursorBackCenter: pt(650, -100) });
        expect(r.backCenter.x).toBe(600);
        expect(r.markers).toEqual([{ kind: 'endpoint', at: pt(0, -115) }]);
        expect(r.guides.map((g) => g.kind)).toEqual(['face']);
    });
});

describe('snapFootprint: priority along a face', () => {
    const neighbourAt = (x: number): PlanDocument => {
        const doc = wallPlan();
        // Rotation 180, width 1200: spans x - 600 .. x + 600.
        doc.placements['f_0000000001'] = placement(
            'f_0000000001',
            x,
            -115,
            180,
        );
        return doc;
    };

    it('lets an alignment beat the face-centre snap', () => {
        // Cursor t = 2050 is 50 from the face centre (2000). Our left edge is
        // 1650; the neighbour's right edge is 1700: alignment moves t to 2100.
        const r = snap(neighbourAt(1100), {
            cursorBackCenter: pt(2050, -100),
            width: 800,
        });
        expect(r.backCenter).toEqual(pt(2100, -115));
        expect(r.guides.map((g) => g.kind)).toEqual(['face', 'alignment']);
        expect(r.markers).toEqual([]);
    });

    it('still takes the face centre when nothing aligns', () => {
        const r = snap(neighbourAt(-2000), {
            cursorBackCenter: pt(2050, -100),
            width: 800,
        });
        expect(r.backCenter).toEqual(pt(2000, -115));
        expect(r.guides.map((g) => g.kind)).toEqual(['face']);
    });

    it('keeps corner-flush above both alignment and centre', () => {
        const r = snap(neighbourAt(730), {
            cursorBackCenter: pt(650, -100),
        });
        expect(r.backCenter.x).toBe(600);
        expect(r.markers).toEqual([{ kind: 'endpoint', at: pt(0, -115) }]);
    });
});

describe('snapFootprint: determinism (placement order)', () => {
    it('gives identical results whatever the insertion order of the placements', () => {
        const ids = [
            'f_0000000001',
            'f_0000000002',
            'f_0000000003',
            'f_0000000004',
        ];
        // Two neighbours share the same right edge (x = 2600) at equal distance:
        // the guide spans the first one in id order.
        const spots: Record<string, [number, number, string]> = {
            f_0000000001: [2000, 5000, 'a'],
            f_0000000002: [2000, 3000, 'a'],
            f_0000000003: [2300, 3800, 'b'],
            f_0000000004: [1000, 8000, 'a'],
        };
        const run = (order: string[]): FootprintSnapResult => {
            const doc = emptyPlan();
            for (const id of order) {
                const [x, y, design] = spots[id]!;
                doc.placements[id] = placement(id, x, y, 0, design);
            }
            const geom = derivePlanGeometry(doc);
            const index = buildSnapIndex(doc, geom, provider);
            expect(index.footprints!.items.map((i) => i.id)).toEqual(ids);
            return snapFootprint(
                {
                    cursorBackCenter: pt(3140, 4000),
                    rotation: 0,
                    width: 1000,
                    depth: 600,
                    elevation: 0,
                    height: 750,
                    zoom: 0.1,
                    pointerType: 'mouse',
                    modifiers: { shift: false, alt: false },
                    exclude: new Set<string>(),
                    settings: defaultSnapSettings('metric'),
                    keepRotation: false,
                },
                index,
                geom,
            );
        };
        const reference = run(ids);
        expect(reference.guides.length).toBeGreaterThan(0);
        const rand = mulberry32(17);
        for (let round = 0; round < 12; round += 1) {
            const shuffled = [...ids];
            for (let i = shuffled.length - 1; i > 0; i -= 1) {
                const j = Math.floor(rand() * (i + 1));
                [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
            }
            expect(run(shuffled)).toEqual(reference);
        }
    });

    it('does not mutate the index or the input', () => {
        const doc = wallPlan();
        const geom = derivePlanGeometry(doc);
        const index = buildSnapIndex(doc, geom, provider);
        const exclude = new Set<string>();
        const input: FootprintSnapInput = {
            cursorBackCenter: pt(1500, -100),
            rotation: 0,
            width: 1200,
            depth: 600,
            elevation: 0,
            height: 750,
            zoom: 0.1,
            pointerType: 'mouse',
            modifiers: { shift: false, alt: false },
            exclude,
            settings: defaultSnapSettings('metric'),
            keepRotation: false,
        };
        const before = JSON.stringify(input);
        const a = snapFootprint(input, index, geom);
        const b = snapFootprint(input, index, geom);
        expect(a).toEqual(b);
        expect(JSON.stringify(input)).toBe(before);
    });
});
