import { describe, expect, it, vi } from 'vitest';
import { ROOM_TYPES } from '../../roomTypes';
import { derivePlanGeometry } from '../../derive';
import { FIXTURE_LIBRARY } from '../../fixtures';
import type { PlanDocument } from '../../schema';
import { emptyPlan, makeRectPlan } from '../../testing/fixtures';
import {
    addFixture,
    addOpening,
    addRoomMeta,
    arcsOf,
    linesOf,
    polysOf,
    textsOf,
} from '../../testing/drawingHelpers';
import { testDrawingOptions } from '../../testing/drawingOptions';
import { r2, rAngle } from '../shared';
import {
    autoDimensions,
    buildPlanDrawing,
    drawDimension,
    drawFixture,
    drawOpening,
    drawRoom,
    roomTypeToColorKey,
} from '..';

const TOP = 'w_0000000001';
const opts = testDrawingOptions();

function openingOn(
    doc: PlanDocument,
    patch: Parameters<typeof addOpening>[2],
    options = opts,
) {
    const id = addOpening(doc, TOP, patch);
    const geom = derivePlanGeometry(doc);
    return drawOpening(
        geom.openings[id]!,
        doc.openings[id]!,
        geom.walls[TOP]!,
        options,
    );
}

describe('roomTypeToColorKey (15 §3.4)', () => {
    // 15 §3.4, row by row.
    const TABLE: Array<[string[], string]> = [
        [['living', 'dining'], 'room-living'],
        [['bedroom', 'master_bedroom', 'dress'], 'room-bedroom'],
        [['kitchen'], 'room-kitchen'],
        [['bathroom', 'toilet'], 'room-bath'],
        [['balcony', 'deck'], 'room-outdoor'],
        [['utility', 'store', 'garage', 'ots'], 'room-utility'],
        [['study'], 'room-study'],
        [['pooja'], 'room-pooja'],
        [['foyer', 'corridor'], 'room-circulation'],
        [['other'], 'room-other'],
    ];

    it('covers exactly the 19 room types of the table', () => {
        const listed = TABLE.flatMap(([types]) => types);
        expect(listed).toHaveLength(19);
        expect([...listed].sort()).toEqual([...ROOM_TYPES].sort());
    });

    it.each(TABLE.flatMap(([types, key]) => types.map((t) => [t, key])))(
        'maps %s to %s',
        (type, key) => {
            expect(
                roomTypeToColorKey(type as (typeof ROOM_TYPES)[number]),
            ).toBe(key);
        },
    );
});

describe('output rounding', () => {
    it('never returns -0', () => {
        expect(Object.is(r2(-0.001), 0)).toBe(true);
        expect(Object.is(r2(-0), 0)).toBe(true);
        expect(Object.is(rAngle(-0.00001), 0)).toBe(true);
        expect(r2(1.006)).toBe(1.01);
        expect(r2(-2.346)).toBe(-2.35);
    });

    it('keeps -0 out of a drawn item', () => {
        const doc = emptyPlan();
        const id = addFixture(doc, { x: 0, y: 0, width: 400, depth: 400 });
        const g = drawFixture(doc.fixtures[id]!, opts);
        const bad = JSON.stringify(g, (_k, v: unknown) =>
            Object.is(v, -0) ? '-0' : v,
        );
        expect(bad).not.toContain('-0');
    });
});

describe('dimension text rotation', () => {
    const rotationFor = (b: { x: number; y: number }): number =>
        textsOf(
            drawDimension(
                {
                    id: 'd_0000000001',
                    a: { x: 0, y: 0 },
                    b,
                    offset: 300,
                    attachedTo: null,
                },
                opts,
            ),
        )[0]!.rotationDeg;

    it('rounds the angle before normalising it into (-90, 90]', () => {
        // 90.004 and 270.004 degrees round to 90 and 270; neither may become -90.
        expect(rotationFor({ x: -70, y: 1_000_000 })).toBe(90);
        expect(rotationFor({ x: 70, y: -1_000_000 })).toBe(90);
        // And the neighbours across the boundary.
        expect(rotationFor({ x: -100_000, y: 1_000_000 })).toBe(-84.29);
        expect(rotationFor({ x: 100_000, y: -1_000_000 })).toBe(-84.29);
    });
});

describe('short user dimensions', () => {
    const dim = (offset: number) =>
        drawDimension(
            {
                id: 'd_0000000001',
                a: { x: 0, y: 0 },
                b: { x: 1000, y: 0 },
                offset,
                attachedTo: null,
            },
            opts,
        );

    it('skips the extension lines when the offset is under 100 mm', () => {
        for (const offset of [0, 50, -50, 99]) {
            const g = dim(offset);
            expect(linesOf(g, 'dim_ext')).toEqual([]);
            expect(linesOf(g, 'dim_line')).toHaveLength(1);
            expect(linesOf(g, 'dim_tick')).toHaveLength(2);
            expect(textsOf(g)).toHaveLength(1);
        }
    });

    it('draws them from 100 mm off at an offset of exactly 100', () => {
        const ext = linesOf(dim(100), 'dim_ext');
        expect(ext).toHaveLength(2);
        expect(ext[0]).toMatchObject({
            a: { x: 0, y: -100 },
            b: { x: 0, y: -200 },
        });
    });
});

describe('openings hinged at the end', () => {
    it('slides a pocket door into the wall beyond the end jamb', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        const g = openingOn(doc, { type: 'pocket', hinge: 'end' });
        const panel = polysOf(g, 'sliding_panel')[0]!;
        const xs = panel.pts.map((p) => p.x);
        expect(Math.min(...xs)).toBe(2950);
        expect(Math.max(...xs)).toBe(3850);
        expect(panel.dashed).toBe(true);
    });

    it('folds a bifold door from the end jamb back along the opening', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        const g = openingOn(doc, { type: 'bifold', hinge: 'end' });
        const [first, second] = linesOf(g, 'door_leaf');
        expect(first!.a).toEqual({ x: 2950, y: 115 });
        expect(first!.b.x).toBeCloseTo(2950 - 450 * Math.cos(Math.PI / 6), 2);
        expect(first!.b.y).toBeCloseTo(115 + 225, 2);
        expect(second!.a).toEqual(first!.b);
        expect(second!.b.x).toBeCloseTo(2950 - 900 * Math.cos(Math.PI / 6), 2);
        expect(second!.b.y).toBe(115);
    });
});

describe('bay window on a right-hand exterior', () => {
    it('projects towards -n through the right face', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        const w = doc.walls[TOP]!;
        [w.a, w.b] = [w.b, w.a]; // direction (-1, 0): the outside is on the right
        const id = addOpening(doc, TOP, {
            kind: 'window',
            type: 'bay',
            width: 1000,
        });
        const geom = derivePlanGeometry(doc);
        expect(geom.walls[TOP]!.exteriorSide).toBe('right');
        const g = drawOpening(
            geom.openings[id]!,
            doc.openings[id]!,
            geom.walls[TOP]!,
            opts,
        );
        // Offsets run from x = 5000 leftwards: the window spans x 3000 to 2000.
        expect(polysOf(g, 'window_frame')[0]!.pts).toEqual([
            { x: 3000, y: -115 },
            { x: 2600, y: -515 },
            { x: 2400, y: -515 },
            { x: 2000, y: -115 },
        ]);
        expect(linesOf(g, 'window_glass')).toEqual([
            {
                t: 'line',
                a: { x: 2600, y: -515 },
                b: { x: 2400, y: -515 },
                style: 'window_glass',
            },
        ]);
    });
});

describe('automatic dimension chain extension lines', () => {
    it('continues the first row at the wall ends and spans the face for interior stops', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        addOpening(doc, TOP, { offset: 1000, width: 900 });
        const geom = derivePlanGeometry(doc);
        const g = autoDimensions(geom.walls[TOP]!, doc.walls[TOP]!, opts);
        const ext = linesOf(g, 'dim_ext');
        const at = (x: number) =>
            ext
                .filter((e) => e.a.x === x)
                .map((e) => [e.a.y, e.b.y])
                .sort((p, q) => q[0]! - p[0]!);
        // Row 1 at y = -515, chain row at -865; face at -115.
        expect(at(0)).toEqual([
            [-215, -615],
            [-615, -965],
        ]);
        expect(at(5000)).toEqual([
            [-215, -615],
            [-615, -965],
        ]);
        expect(at(550)).toEqual([[-215, -965]]);
        expect(at(1450)).toEqual([[-215, -965]]);
        expect(ext).toHaveLength(2 * 2 + 2);
    });
});

describe('room fill holes', () => {
    it('carries the hole of a room around a column', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        // A free-standing 800 mm column wall loop in the middle.
        const corners: Array<[number, number]> = [
            [2100, 1600],
            [2900, 1600],
            [2900, 2400],
            [2100, 2400],
        ];
        const ids = corners.map(([x, y], i) => {
            const id = `n_c${String(i).padStart(9, '0')}`;
            doc.nodes[id] = { id, x, y };
            return id;
        });
        ids.forEach((a, i) => {
            const id = `w_c${String(i).padStart(9, '0')}`;
            doc.walls[id] = {
                id,
                a,
                b: ids[(i + 1) % 4]!,
                thickness: 115,
                height: 2700,
                kind: 'interior',
                justification: 'center',
                material: 'brick',
                colorHex: null,
            };
        });
        addRoomMeta(doc, { x: 600, y: 600 });
        const geom = derivePlanGeometry(doc);
        const room = geom.rooms.find((r) => r.holes.length > 0)!;
        expect(room).toBeDefined();
        const fill = polysOf(drawRoom(room, null, opts), 'room_fill')[0]!;
        expect(fill.holes).toHaveLength(room.holes.length);
        expect(fill.holes![0]).toHaveLength(room.holes[0]!.length);
        // A holed room has no w x d size line (netRect is null).
        expect(
            textsOf(drawRoom(room, null, opts)).map((t) => t.style),
        ).not.toContain('room_dims');
    });
});

describe('open fixture polylines', () => {
    it('draws a polyline with closed false as an open poly', () => {
        const spy = vi
            .spyOn(FIXTURE_LIBRARY.shower, 'symbol2d')
            .mockReturnValue([
                {
                    t: 'polyline',
                    pts: [
                        [-0.5, 0],
                        [0, 0.5],
                        [0.5, 0],
                    ],
                    closed: false,
                    detail: true,
                },
                {
                    t: 'polyline',
                    pts: [
                        [-0.5, 0],
                        [0, 0.5],
                        [0.5, 0],
                    ],
                    closed: true,
                },
            ]);
        try {
            const doc = emptyPlan();
            const id = addFixture(doc, { libraryKey: 'shower' });
            const g = drawFixture(doc.fixtures[id]!, opts);
            const [open, closed] = polysOf(g);
            expect(open).toMatchObject({
                closed: false,
                style: 'fixture_detail',
            });
            expect(closed).toMatchObject({ closed: true, style: 'fixture' });
            expect(open!.pts).toHaveLength(3);
        } finally {
            spy.mockRestore();
        }
    });
});

describe('bbox arc extremes', () => {
    it('includes the axis extreme inside an arc sweep, beyond its end points', () => {
        // A door on a 45 degree wall sweeps 45 to 135 degrees: the lowest
        // point of the arc (90 degrees) lies below both end points.
        const doc = emptyPlan();
        doc.nodes['n_0000000001'] = { id: 'n_0000000001', x: 0, y: 0 };
        doc.nodes['n_0000000002'] = { id: 'n_0000000002', x: 1000, y: 1000 };
        doc.walls[TOP] = {
            id: TOP,
            a: 'n_0000000001',
            b: 'n_0000000002',
            thickness: 115,
            height: 2700,
            kind: 'interior',
            justification: 'center',
            material: 'brick',
            colorHex: null,
        };
        addOpening(doc, TOP, { offset: 1000, width: 800 });
        const o = testDrawingOptions({
            include: { ...opts.include, autoDimensions: false },
        });
        const drawing = buildPlanDrawing(doc, derivePlanGeometry(doc), o);
        const arc = drawing.layers.OPENINGS.flatMap((g) => arcsOf(g))[0]!;
        expect(arc.startDeg).toBeCloseTo(45, 2);
        expect(arc.endDeg).toBeCloseTo(135, 2);
        const lowest = arc.c.y + arc.r;
        const endsLowest = Math.max(
            arc.c.y + arc.r * Math.sin((arc.startDeg * Math.PI) / 180),
            arc.c.y + arc.r * Math.sin((arc.endDeg * Math.PI) / 180),
        );
        expect(lowest).toBeGreaterThan(endsLowest + 100);
        // Nothing else reaches that far down, so the arc alone sets the bound.
        const wall = derivePlanGeometry(doc).bbox;
        expect(lowest).toBeGreaterThan(wall.max.y);
        expect(drawing.bbox!.max.y).toBeCloseTo(lowest, 1);
    });
});
