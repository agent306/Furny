import { describe, expect, it } from 'vitest';
import { ringBBox, signedArea } from '../../../geometry/polygon';
import { formatArea, formatLength } from '../../../units/format';
import { derivePlanGeometry } from '../../derive';
import { FIXTURE_LIBRARY } from '../../fixtures';
import { fixtureFootprint } from '../../footprint';
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
import {
    autoDimensions,
    drawDimension,
    drawFixture,
    drawLabel,
    drawOpening,
    drawPlacement,
    drawRoom,
    drawWall,
    LAYER_ORDER,
    STYLE_KEYS,
} from '..';

// makeRectPlan(5000, 4000, 230): the top wall w1 runs (0,0) -> (5000,0) with
// its normal pointing up the screen (y < 0, the outside); the room lies on its
// right (-n) side. Wall faces are at y = -115 (outside) and y = 115 (room).
const TOP = 'w_0000000001';
const RIGHT = 'w_0000000002';

const opts = testDrawingOptions();

function openingGroup(
    patch: Parameters<typeof addOpening>[2] = {},
    options = opts,
) {
    const doc = makeRectPlan(5000, 4000, 230);
    const id = addOpening(doc, TOP, patch);
    const geom = derivePlanGeometry(doc);
    const group = drawOpening(
        geom.openings[id]!,
        doc.openings[id]!,
        geom.walls[TOP]!,
        options,
    );
    return { doc, geom, group };
}

/** A document with one wall (id w_0000000001) of thickness `t`. */
function singleWall(
    [ax, ay, bx, by]: readonly [number, number, number, number],
    t = 115,
): PlanDocument {
    const doc = emptyPlan();
    doc.nodes['n_0000000001'] = { id: 'n_0000000001', x: ax, y: ay };
    doc.nodes['n_0000000002'] = { id: 'n_0000000002', x: bx, y: by };
    doc.walls[TOP] = {
        id: TOP,
        a: 'n_0000000001',
        b: 'n_0000000002',
        thickness: t,
        height: 2700,
        kind: 'interior',
        justification: 'center',
        material: 'brick',
        colorHex: null,
    };
    return doc;
}

const near = (actual: number, expected: number): void =>
    expect(Math.abs(actual - expected)).toBeLessThanOrEqual(0.01);

const arcPoint = (
    arc: { c: { x: number; y: number }; r: number },
    deg: number,
): { x: number; y: number } => ({
    x: arc.c.x + arc.r * Math.cos((deg * Math.PI) / 180),
    y: arc.c.y + arc.r * Math.sin((deg * Math.PI) / 180),
});

describe('layers and style keys', () => {
    it('lists the layers in paint order', () => {
        expect([...LAYER_ORDER]).toEqual([
            'BACKGROUND',
            'ROOMS',
            'FIXTURES',
            'FURNITURE',
            'WALLS',
            'OPENINGS',
            'DIMS',
            'TEXT',
        ]);
    });

    it('lists every style key once', () => {
        expect(new Set(STYLE_KEYS).size).toBe(STYLE_KEYS.length);
        expect(STYLE_KEYS).toContain('furniture_missing');
        expect(STYLE_KEYS).toContain('wall_outline');
    });
});

describe('drawWall', () => {
    const wallStyle = (
        patch: Partial<PlanDocument['walls'][string]>,
    ): string => {
        const doc = makeRectPlan(5000, 4000, 230);
        Object.assign(doc.walls[RIGHT]!, patch);
        const geom = derivePlanGeometry(doc);
        const g = drawWall(geom.walls[RIGHT]!, doc.walls[RIGHT]!, opts);
        const styles = new Set(polysOf(g).map((p) => p.style));
        expect(styles.size).toBe(1);
        return [...styles][0]!;
    };

    it('picks the style from the wall kind and material', () => {
        expect(wallStyle({ kind: 'exterior' })).toBe('wall_exterior');
        expect(wallStyle({ kind: 'interior' })).toBe('wall');
        expect(wallStyle({ kind: 'partition' })).toBe('wall');
        expect(wallStyle({ kind: 'half' })).toBe('wall_half');
        expect(wallStyle({ material: 'glass' })).toBe('wall_glass');
        expect(wallStyle({ kind: 'interior', material: 'glass' })).toBe(
            'wall_glass',
        );
    });

    it('draws one closed polygon per poché part, with holes kept', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        addOpening(doc, TOP, { kind: 'window', type: 'fixed' });
        const geom = derivePlanGeometry(doc);
        const w = geom.walls[TOP]!;
        expect(w.pocheParts.length).toBeGreaterThan(1);
        const g = drawWall(w, doc.walls[TOP]!, opts);
        expect(g).toMatchObject({ entityId: TOP, entityKind: 'wall' });
        const polys = polysOf(g);
        expect(polys).toHaveLength(w.pocheParts.length);
        polys.forEach((p, i) => {
            expect(p.closed).toBe(true);
            expect(p.pts).toHaveLength(w.pocheParts[i]!.outer.length);
            expect(signedArea(p.pts)).toBeGreaterThan(0);
        });
    });
});

describe('drawOpening: doors', () => {
    it('draws a single swing door as a leaf line and a 90 degree arc', () => {
        const { group } = openingGroup();
        // u0 = 2050, hinge at the start jamb on the swing (room) face y = 115.
        const leaves = linesOf(group, 'door_leaf');
        expect(leaves).toHaveLength(1);
        expect(leaves[0]!.a).toEqual({ x: 2050, y: 115 });
        expect(leaves[0]!.b).toEqual({ x: 2050, y: 1015 }); // length = width
        const arcs = arcsOf(group, 'door_swing');
        expect(arcs).toHaveLength(1);
        const arc = arcs[0]!;
        expect(arc.c).toEqual({ x: 2050, y: 115 });
        expect(arc.r).toBe(900);
        expect(arc.endDeg - arc.startDeg).toBe(90);
        // One endpoint on the swing face line (far jamb), one at the leaf end.
        const [p0, p1] = [
            arcPoint(arc, arc.startDeg),
            arcPoint(arc, arc.endDeg),
        ];
        near(p0.x, 2950);
        near(p0.y, 115);
        near(p1.x, 2050);
        near(p1.y, 1015);
    });

    it('mirrors the geometry for a leaf hinged at the end swinging left', () => {
        const { group } = openingGroup({ hinge: 'end', swing: 'left' });
        // u1 = 2950, swing face = left face y = -115, leaf goes up the screen.
        const leaf = linesOf(group, 'door_leaf')[0]!;
        expect(leaf.a).toEqual({ x: 2950, y: -115 });
        expect(leaf.b).toEqual({ x: 2950, y: -1015 });
        const arc = arcsOf(group)[0]!;
        expect(arc.c).toEqual(leaf.a);
        expect(arc.endDeg - arc.startDeg).toBe(90);
        const ends = [arcPoint(arc, arc.startDeg), arcPoint(arc, arc.endDeg)];
        const onFace = ends.find((p) => Math.abs(p.y + 115) < 0.01)!;
        near(onFace.x, 2050);
        const atLeaf = ends.find((p) => Math.abs(p.y + 1015) < 0.01)!;
        near(atLeaf.x, 2950);
    });

    it('keeps arc angles start in [0, 360) and the sweep clockwise', () => {
        for (const swing of ['left', 'right'] as const) {
            for (const hinge of ['start', 'end'] as const) {
                const arc = arcsOf(openingGroup({ swing, hinge }).group)[0]!;
                expect(arc.startDeg).toBeGreaterThanOrEqual(0);
                expect(arc.startDeg).toBeLessThan(360);
                expect(arc.endDeg).toBe(arc.startDeg + 90);
            }
        }
    });

    it('omits arcs at lod 1 and when door swings are off, keeping the leaf', () => {
        for (const o of [
            testDrawingOptions({ lod: 1 }),
            testDrawingOptions({ lod: 2 }),
            testDrawingOptions({
                include: { ...opts.include, doorSwings: false },
            }),
        ]) {
            const { group } = openingGroup({}, o);
            expect(arcsOf(group)).toHaveLength(0);
            expect(linesOf(group, 'door_leaf')).toHaveLength(1);
        }
    });

    it('draws a double swing door as two half-width leaves meeting at the centre', () => {
        const { group } = openingGroup({ type: 'double_swing' });
        const leaves = linesOf(group, 'door_leaf');
        expect(leaves).toHaveLength(2);
        expect(leaves.map((l) => l.a)).toEqual([
            { x: 2050, y: 115 },
            { x: 2950, y: 115 },
        ]);
        expect(leaves.map((l) => l.b)).toEqual([
            { x: 2050, y: 565 },
            { x: 2950, y: 565 },
        ]);
        const arcs = arcsOf(group, 'door_swing');
        expect(arcs).toHaveLength(2);
        expect(arcs.map((a) => a.r)).toEqual([450, 450]);
        // Both arcs pass through the opening centre on the swing face.
        for (const arc of arcs) {
            const ends = [
                arcPoint(arc, arc.startDeg),
                arcPoint(arc, arc.endDeg),
            ];
            expect(
                ends.some(
                    (p) =>
                        Math.abs(p.x - 2500) < 0.01 &&
                        Math.abs(p.y - 115) < 0.01,
                ),
            ).toBe(true);
        }
    });

    it('draws the main entrance with the heavy leaf and a threshold', () => {
        const { group } = openingGroup({ type: 'main_entrance' });
        expect(linesOf(group, 'door_leaf')).toHaveLength(0);
        expect(linesOf(group, 'door_main_leaf')).toHaveLength(1);
        expect(arcsOf(group, 'door_swing')).toHaveLength(1);
        const threshold = linesOf(group, 'threshold');
        expect(threshold).toEqual([
            {
                t: 'line',
                a: { x: 2050, y: 0 },
                b: { x: 2950, y: 0 },
                style: 'threshold',
            },
        ]);
    });

    it('draws a sliding door as two panels of 0.55 width and depth 30', () => {
        const { group } = openingGroup({ type: 'sliding' });
        const panels = polysOf(group, 'sliding_panel');
        expect(panels).toHaveLength(2);
        const boxes = panels.map((p) => ringBBox(p.pts));
        for (const [i, b] of boxes.entries()) {
            near(b.max.x - b.min.x, 495);
            near(b.max.y - b.min.y, 30);
            expect(signedArea(panels[i]!.pts)).toBeGreaterThan(0);
            expect(panels[i]!.closed).toBe(true);
        }
        // t/6 = 38.33 either side of the centre line, one from each jamb.
        const byX = [...boxes].sort((a, b) => a.min.x - b.min.x);
        near(byX[0]!.min.x, 2050);
        near(byX[1]!.max.x, 2950);
        near(
            (byX[0]!.min.y + byX[0]!.max.y) / 2,
            -(byX[1]!.min.y + byX[1]!.max.y) / 2,
        );
        near(Math.abs((byX[0]!.min.y + byX[0]!.max.y) / 2), 230 / 6);
        expect(arcsOf(group)).toHaveLength(0);
    });

    it('draws a pocket door as a dashed panel of full width inside the wall', () => {
        const { group } = openingGroup({ type: 'pocket' });
        const panels = polysOf(group, 'sliding_panel');
        expect(panels).toHaveLength(1);
        expect(panels[0]!.dashed).toBe(true);
        const b = ringBBox(panels[0]!.pts);
        // Hinge at the start jamb (x = 2050); the panel runs back into the wall.
        near(b.min.x, 1150);
        near(b.max.x, 2050);
        near(b.max.y - b.min.y, 30);
    });

    it('draws a bifold door as a V of two half-width leaves at 30 degrees', () => {
        const { group } = openingGroup({ type: 'bifold' });
        const leaves = linesOf(group, 'door_leaf');
        expect(leaves).toHaveLength(2);
        const [first, second] = leaves as [
            (typeof leaves)[0],
            (typeof leaves)[0],
        ];
        expect(first.a).toEqual({ x: 2050, y: 115 });
        near(first.b.x, 2050 + 450 * Math.cos(Math.PI / 6));
        near(first.b.y, 115 + 225);
        expect(second.a).toEqual(first.b);
        near(second.b.x, 2050 + 900 * Math.cos(Math.PI / 6));
        near(second.b.y, 115);
        expect(arcsOf(group)).toHaveLength(0);
    });

    it('draws nothing for a zero-width opening', () => {
        for (const type of [
            'single_swing',
            'double_swing',
            'sliding',
        ] as const) {
            const { group } = openingGroup({ type, width: 0 });
            expect(group.items).toEqual([]);
        }
        const window = openingGroup({
            kind: 'window',
            type: 'casement',
            width: 0,
        });
        expect(window.group.items).toEqual([]);
    });
});

describe('drawOpening: windows and openings', () => {
    const win = (type: string, extra = {}) =>
        openingGroup({
            kind: 'window',
            type: type as never,
            width: 1000,
            height: 1200,
            sillHeight: 900,
            ...extra,
        }).group;

    it('draws frame lines on both faces and a plain gap as two jambs', () => {
        const frame = linesOf(win('casement'), 'window_frame');
        expect(frame).toHaveLength(2);
        expect(frame.map((l) => l.a.y).sort((a, b) => a - b)).toEqual([
            -115, 115,
        ]);
        for (const l of frame) {
            expect([l.a.x, l.b.x].sort((a, b) => a - b)).toEqual([2000, 3000]);
        }

        const { group } = openingGroup({ kind: 'opening', type: 'opening' });
        const jambs = linesOf(group, 'opening_jamb');
        expect(jambs).toHaveLength(2);
        expect(group.items).toHaveLength(2);
        expect(jambs.map((j) => j.a.x).sort((a, b) => a - b)).toEqual([
            2050, 2950,
        ]);
        for (const j of jambs) {
            expect([j.a.y, j.b.y].sort((a, b) => a - b)).toEqual([-115, 115]);
        }
    });

    it('draws a casement with two glass lines at plus and minus 20 mm', () => {
        const glass = linesOf(win('casement'), 'window_glass');
        expect(glass).toHaveLength(2);
        expect(glass.map((l) => l.a.y).sort((a, b) => a - b)).toEqual([
            -20, 20,
        ]);
        for (const l of glass) {
            expect(l.a.y).toBe(l.b.y);
            expect([l.a.x, l.b.x].sort((a, b) => a - b)).toEqual([2000, 3000]);
        }
    });

    it('adds one diagonal for a ventilator', () => {
        const glass = linesOf(win('ventilator'), 'window_glass');
        expect(glass).toHaveLength(3);
        expect(glass.filter((l) => l.a.y !== l.b.y)).toHaveLength(1);
    });

    it('draws sliding windows as two overlapping 0.55 width glass lines', () => {
        const glass = linesOf(win('sliding_window'), 'window_glass');
        expect(glass).toHaveLength(2);
        for (const l of glass) {
            near(Math.abs(l.b.x - l.a.x), 550);
            near(Math.abs(l.a.y), 230 / 6);
        }
        expect(glass[0]!.a.y).toBe(-glass[1]!.a.y);
        const xs = glass.flatMap((l) => [l.a.x, l.b.x]);
        expect(Math.min(...xs)).toBe(2000);
        expect(Math.max(...xs)).toBe(3000);
    });

    it('draws a fixed window with one glass line on the centre line', () => {
        const glass = linesOf(win('fixed'), 'window_glass');
        expect(glass).toHaveLength(1);
        expect(glass[0]).toMatchObject({
            a: { x: 2000, y: 0 },
            b: { x: 3000, y: 0 },
        });
    });

    it('draws a french window as a casement plus double swing leaves and arcs', () => {
        const group = win('french_window', { swing: 'right' });
        expect(linesOf(group, 'window_glass')).toHaveLength(2);
        const leaves = linesOf(group, 'door_leaf');
        expect(leaves).toHaveLength(2);
        for (const l of leaves) {
            near(Math.hypot(l.b.x - l.a.x, l.b.y - l.a.y), 500);
        }
        expect(arcsOf(group, 'door_swing')).toHaveLength(2);
    });

    it('projects a bay window 400 mm to the exterior side with 45 degree sides', () => {
        const group = win('bay');
        // The top wall's outside is up the screen (-y).
        const frame = polysOf(group, 'window_frame');
        expect(frame).toHaveLength(1);
        expect(frame[0]!.closed).toBe(false);
        expect(frame[0]!.pts).toEqual([
            { x: 2000, y: -115 },
            { x: 2400, y: -515 },
            { x: 2600, y: -515 },
            { x: 3000, y: -115 },
        ]);
        const glass = linesOf(group, 'window_glass');
        expect(glass).toEqual([
            {
                t: 'line',
                a: { x: 2400, y: -515 },
                b: { x: 2600, y: -515 },
                style: 'window_glass',
            },
        ]);
    });

    it('drops glass lines at lod 2 but keeps the frame', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        const id = addOpening(doc, TOP, { kind: 'window', type: 'casement' });
        const geom = derivePlanGeometry(doc);
        const g = drawOpening(
            geom.openings[id]!,
            doc.openings[id]!,
            geom.walls[TOP]!,
            testDrawingOptions({ lod: 2 }),
        );
        expect(linesOf(g, 'window_glass')).toHaveLength(0);
        expect(linesOf(g, 'window_frame')).toHaveLength(2);
    });
});

describe('drawRoom', () => {
    function roomGroup(
        patch: Parameters<typeof addRoomMeta>[2] = {},
        options = opts,
    ) {
        const doc = makeRectPlan(5000, 4000, 230);
        const metaId = addRoomMeta(doc, { x: 2500, y: 2000 }, patch);
        const geom = derivePlanGeometry(doc);
        const room = geom.rooms[0]!;
        return {
            room,
            metaId,
            group: drawRoom(room, doc.rooms[metaId]!, options),
        };
    }

    it('fills the net polygon with the room type colour', () => {
        const { room, group, metaId } = roomGroup();
        expect(group).toMatchObject({ entityId: metaId, entityKind: 'room' });
        const fill = polysOf(group, 'room_fill');
        expect(fill).toHaveLength(1);
        expect(fill[0]!.closed).toBe(true);
        expect(fill[0]!.pts).toHaveLength(room.polygon.length);
        expect(fill[0]!.fill).toMatch(/^#[0-9a-f]{6}$/);
        const other = roomGroup({ type: 'bedroom' }).group;
        expect(polysOf(other)[0]!.fill).not.toBe(fill[0]!.fill);
    });

    it('stacks name, area and size at -0.6 / +0.6 / +1.8 em', () => {
        const { room, group } = roomGroup();
        const texts = textsOf(group);
        expect(texts.map((t) => t.style)).toEqual([
            'room_name',
            'room_area',
            'room_dims',
        ]);
        expect(texts.map((t) => t.dyEm)).toEqual([-0.6, 0.6, 1.8]);
        expect(texts.map((t) => t.text)).toEqual([
            'Living',
            formatArea(room.areaMm2, opts.units),
            `${formatLength(room.netRect!.width, opts.units, { style: 'summary' })} × ${formatLength(room.netRect!.depth, opts.units, { style: 'summary' })}`,
        ]);
        for (const t of texts) {
            expect(t.at).toEqual({
                x: Math.round(room.labelPoint.x * 100) / 100,
                y: Math.round(room.labelPoint.y * 100) / 100,
            });
            expect(t).toMatchObject({
                anchor: 'middle',
                baseline: 'middle',
                rotationDeg: 0,
            });
        }
        expect(texts.map((t) => t.sizeMm)).toEqual([200, 160, 160]);
    });

    it('uses 0 for a single line and compact slots for two', () => {
        const noExtras = testDrawingOptions({
            include: { ...opts.include, roomAreas: false, roomDims: false },
        });
        expect(
            textsOf(roomGroup({}, noExtras).group).map((t) => t.dyEm),
        ).toEqual([0]);
        const nameArea = testDrawingOptions({
            include: { ...opts.include, roomDims: false },
        });
        expect(
            textsOf(roomGroup({}, nameArea).group).map((t) => t.dyEm),
        ).toEqual([-0.6, 0.6]);
    });

    it('honours showArea and falls back to the unnamed string', () => {
        const hidden = textsOf(roomGroup({ showArea: false }).group);
        expect(hidden.map((t) => t.style)).toEqual(['room_name', 'room_dims']);
        const unnamed = textsOf(roomGroup({ name: '' }).group);
        expect(unnamed[0]!.text).toBe('Room');
        const custom = testDrawingOptions({
            strings: { unnamedRoom: 'Raum', missingDesign: 'x' },
        });
        expect(textsOf(roomGroup({ name: '' }, custom).group)[0]!.text).toBe(
            'Raum',
        );
    });

    it('draws a room without a meta as an unnamed room of type other', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        const geom = derivePlanGeometry(doc);
        const g = drawRoom(geom.rooms[0]!, null, opts);
        expect(g.entityId).toBeNull();
        expect(textsOf(g)[0]!.text).toBe('Room');
        expect(textsOf(g).map((t) => t.style)).toContain('room_area');
    });

    it('hides the size line at lod 1 and the area at lod 2', () => {
        const styles = (lod: 0 | 1 | 2) =>
            textsOf(roomGroup({}, testDrawingOptions({ lod })).group).map(
                (t) => t.style,
            );
        expect(styles(1)).toEqual(['room_name', 'room_area']);
        expect(styles(2)).toEqual(['room_name']);
    });
});

describe('drawPlacement', () => {
    const placement = (patch = {}) => ({
        id: 'f_0000000001',
        designId: 'sofa',
        x: 1000,
        y: 1000,
        rotation: 0,
        elevation: 0,
        mirrored: false,
        wallAttachment: null,
        ...patch,
    });

    it('draws the footprint, the front edge, the arrow and the name', () => {
        const g = drawPlacement(placement(), opts);
        expect(g).toMatchObject({
            entityId: 'f_0000000001',
            entityKind: 'placement',
        });
        const body = polysOf(g, 'furniture');
        expect(body).toHaveLength(1);
        expect(body[0]!.pts).toEqual([
            { x: 500, y: 1000 },
            { x: 1500, y: 1000 },
            { x: 1500, y: 1500 },
            { x: 500, y: 1500 },
        ]);
        expect(linesOf(g, 'furniture_front')).toEqual([
            {
                t: 'line',
                a: { x: 500, y: 1500 },
                b: { x: 1500, y: 1500 },
                style: 'furniture_front',
            },
        ]);
        const arrow = polysOf(g, 'furniture_front');
        expect(arrow).toHaveLength(1);
        expect(arrow[0]!.pts).toEqual([
            { x: 925, y: 1500 },
            { x: 1075, y: 1500 },
            { x: 1000, y: 1600 },
        ]);
        expect(signedArea(arrow[0]!.pts)).toBe(7500);
        const names = textsOf(g, 'furniture_label');
        expect(names).toHaveLength(1);
        expect(names[0]).toMatchObject({
            text: 'Sofa',
            at: { x: 1000, y: 1250 },
            sizeMm: 140,
            rotationDeg: 0,
            anchor: 'middle',
            baseline: 'middle',
            dyEm: 0,
        });
    });

    it('points the arrow along the front for a rotated placement', () => {
        const g = drawPlacement(placement({ rotation: 90 }), opts);
        // Front faces -x: footprint x 500..1000, front edge at x = 500.
        const arrow = polysOf(g, 'furniture_front')[0]!;
        expect(Math.min(...arrow.pts.map((p) => p.x))).toBe(400);
        expect(
            arrow.pts.every((p) => p.y >= 925 - 1e-9 && p.y <= 1075 + 1e-9),
        ).toBe(true);
    });

    it('hides the name at lod 1', () => {
        const g = drawPlacement(placement(), testDrawingOptions({ lod: 1 }));
        expect(textsOf(g)).toHaveLength(0);
        expect(polysOf(g, 'furniture')).toHaveLength(1);
    });

    it('draws an unknown design as a 600 mm missing square with its message', () => {
        const g = drawPlacement(placement({ designId: 'gone' }), opts);
        const sq = polysOf(g, 'furniture_missing');
        expect(sq).toHaveLength(1);
        expect(sq[0]!.pts).toEqual([
            { x: 700, y: 1000 },
            { x: 1300, y: 1000 },
            { x: 1300, y: 1600 },
            { x: 700, y: 1600 },
        ]);
        expect(polysOf(g, 'furniture')).toHaveLength(0);
        expect(textsOf(g).map((t) => t.text)).toEqual(['Missing design']);
        expect(textsOf(g)[0]!.at).toEqual({ x: 1000, y: 1300 });
    });
});

describe('drawFixture', () => {
    it('maps the symbol through the fixture footprint', () => {
        const doc = emptyPlan();
        const id = addFixture(doc, {
            libraryKey: 'wardrobe_generic',
            x: 3000,
            y: 2000,
            rotation: 90,
            width: 1200,
            depth: 600,
        });
        const f = doc.fixtures[id]!;
        const g = drawFixture(f, opts);
        expect(g).toMatchObject({ entityId: id, entityKind: 'fixture' });
        const outline = polysOf(g, 'fixture')[0]!;
        const corners = fixtureFootprint(f).corners;
        expect(outline.pts).toHaveLength(4);
        outline.pts.forEach((p, i) => {
            near(p.x, corners[i]!.x);
            near(p.y, corners[i]!.y);
        });
        expect(signedArea(outline.pts)).toBeGreaterThan(0);
    });

    it('draws detail items in fixture_detail, dashed ones dashed', () => {
        const doc = emptyPlan();
        const id = addFixture(doc, {
            libraryKey: 'wardrobe_generic',
            width: 1200,
            depth: 600,
            x: 1000,
            y: 1000,
        });
        const g = drawFixture(doc.fixtures[id]!, opts);
        const items = FIXTURE_LIBRARY.wardrobe_generic.symbol2d(1200, 600);
        expect(g.items).toHaveLength(items.length);
        const details = g.items.filter(
            (i) => 'style' in i && i.style === 'fixture_detail',
        );
        expect(details).toHaveLength(items.filter((i) => i.detail).length);
        const dashed = linesOf(g, 'fixture_detail').filter((l) => l.dashed);
        expect(dashed).toHaveLength(1);
        expect(
            g.items.filter((i) => 'style' in i && i.style === 'fixture'),
        ).toHaveLength(1);
    });

    it('turns ellipses into 24-point polygons', () => {
        const doc = emptyPlan();
        const id = addFixture(doc, { libraryKey: 'shower' });
        const g = drawFixture(doc.fixtures[id]!, opts);
        // Shower drain: E(0, 0.5, 0.04, 0.04) on a 900 x 900 footprint at (1000, 1000).
        const drain = polysOf(g, 'fixture_detail').filter(
            (p) => p.pts.length === 24,
        );
        expect(drain).toHaveLength(1);
        const ring = drain[0]!;
        expect(ring.closed).toBe(true);
        expect(signedArea(ring.pts)).toBeGreaterThan(0);
        for (const p of ring.pts) {
            near(Math.hypot(p.x - 1000, p.y - 1000), 36);
        }
        near(ring.pts[0]!.x, 1036);
        near(ring.pts[0]!.y, 1000);
    });

    it('honours a dashed ellipse and drops detail at lod 1', () => {
        const doc = emptyPlan();
        const heater = addFixture(doc, {
            libraryKey: 'water_heater',
            width: 450,
            depth: 450,
            x: 1000,
            y: 1000,
        });
        const g = drawFixture(doc.fixtures[heater]!, opts);
        const ring = polysOf(g, 'fixture')[0]!;
        expect(ring.pts).toHaveLength(24);
        expect(ring.dashed).toBe(true);

        const shower = addFixture(doc, { libraryKey: 'shower' });
        const coarse = drawFixture(
            doc.fixtures[shower]!,
            testDrawingOptions({ lod: 1 }),
        );
        expect(polysOf(coarse, 'fixture_detail')).toHaveLength(0);
        expect(linesOf(coarse, 'fixture_detail')).toHaveLength(0);
        expect(polysOf(coarse, 'fixture')).toHaveLength(1);
    });

    it('applies a rect fill override to the polygon', () => {
        const doc = emptyPlan();
        const id = addFixture(doc, {
            libraryKey: 'column',
            width: 400,
            depth: 400,
        });
        const g = drawFixture(doc.fixtures[id]!, opts);
        expect(polysOf(g, 'fixture')[0]!.fill).toBe('#3B3B3B');
        expect(polysOf(g, 'fixture')[0]!.dashed).toBeUndefined();
    });
});

describe('drawLabel', () => {
    it('draws model-sized text at the label position', () => {
        const g = drawLabel(
            {
                id: 't_0000000001',
                position: { x: 100, y: 200 },
                text: 'Bay <1>',
                fontSize: 250,
                rotation: 30,
            },
            opts,
        );
        expect(g).toMatchObject({
            entityId: 't_0000000001',
            entityKind: 'label',
        });
        expect(g.items).toEqual([
            {
                t: 'text',
                at: { x: 100, y: 200 },
                text: 'Bay <1>',
                sizeMm: 250,
                dyEm: 0,
                rotationDeg: 30,
                anchor: 'start',
                baseline: 'middle',
                style: 'label',
            },
        ]);
    });
});

describe('autoDimensions', () => {
    const topGroup = (options = opts) => {
        const doc = makeRectPlan(5000, 4000, 230);
        const geom = derivePlanGeometry(doc);
        return autoDimensions(geom.walls[TOP]!, doc.walls[TOP]!, options);
    };

    it('draws one overall row at thickness/2 + 400 on the exterior side', () => {
        const g = topGroup();
        expect(g).toMatchObject({
            entityId: TOP,
            entityKind: 'auto_dimension',
        });
        const lines = linesOf(g, 'dim_line');
        expect(lines).toEqual([
            {
                t: 'line',
                a: { x: 0, y: -515 },
                b: { x: 5000, y: -515 },
                style: 'dim_line',
            },
        ]);
        const texts = textsOf(g, 'dim_text');
        expect(texts).toEqual([
            {
                t: 'text',
                at: { x: 2500, y: -515 },
                text: formatLength(5000, opts.units),
                sizeMm: 150,
                dyEm: -0.25,
                rotationDeg: 0,
                anchor: 'middle',
                baseline: 'bottom',
                style: 'dim_text',
            },
        ]);
    });

    it('draws 45 degree ticks of 150 mm and extension lines', () => {
        const g = topGroup();
        const ticks = linesOf(g, 'dim_tick');
        expect(ticks).toHaveLength(2);
        for (const tick of ticks) {
            near(Math.hypot(tick.b.x - tick.a.x, tick.b.y - tick.a.y), 150);
            near(Math.abs(tick.b.x - tick.a.x), Math.abs(tick.b.y - tick.a.y));
            const mid = {
                x: (tick.a.x + tick.b.x) / 2,
                y: (tick.a.y + tick.b.y) / 2,
            };
            near(mid.y, -515);
            expect([0, 5000].some((x) => Math.abs(mid.x - x) < 0.01)).toBe(
                true,
            );
        }
        const ext = linesOf(g, 'dim_ext');
        expect(ext).toHaveLength(2);
        // From 100 mm off the face (-115) to 100 mm beyond the dimension line.
        for (const e of ext) {
            expect(e.a.y).toBe(-215);
            expect(e.b.y).toBe(-615);
            expect(e.a.x).toBe(e.b.x);
        }
        expect(ext.map((e) => e.a.x).sort((a, b) => a - b)).toEqual([0, 5000]);
    });

    it('adds a chain row of opening segments that sums to the wall length', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        addOpening(doc, TOP, { offset: 1000, width: 900 });
        addOpening(doc, TOP, {
            kind: 'window',
            type: 'casement',
            offset: 3500,
            width: 1200,
        });
        const geom = derivePlanGeometry(doc);
        const g = autoDimensions(geom.walls[TOP]!, doc.walls[TOP]!, opts);
        const row1 = textsOf(g).filter((t) => t.at.y === -515);
        const row2 = textsOf(g).filter((t) => t.at.y === -865);
        expect(row1).toHaveLength(1);
        expect(row2.map((t) => t.text)).toEqual([
            '550 mm',
            '900 mm',
            '1450 mm',
            '1200 mm',
            '900 mm',
        ]);
        expect(row2.reduce((s, t) => s + parseFloat(t.text), 0)).toBe(5000);
        expect(row2.map((t) => t.at.x)).toEqual([275, 1000, 2175, 3500, 4550]);
        expect(linesOf(g, 'dim_line').map((l) => l.a.y)).toEqual([-515, -865]);
        // Boundaries: 0, 550, 1450, 2900, 4100, 5000.
        const chainTicks = linesOf(g, 'dim_tick').filter(
            (t) => Math.abs((t.a.y + t.b.y) / 2 + 865) < 0.01,
        );
        expect(chainTicks).toHaveLength(6);
    });

    it('skips zero-length chain segments and overlapping openings', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        addOpening(doc, TOP, { offset: 450, width: 900 }); // u0 = 0
        addOpening(doc, TOP, { offset: 800, width: 900 }); // overlaps the first
        const geom = derivePlanGeometry(doc);
        const g = autoDimensions(geom.walls[TOP]!, doc.walls[TOP]!, opts);
        const row2 = textsOf(g).filter((t) => t.at.y === -865);
        expect(row2.reduce((s, t) => s + parseFloat(t.text), 0)).toBe(5000);
        expect(row2.every((t) => parseFloat(t.text) > 0)).toBe(true);
    });

    it('measures on the right side when that is the exterior side', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        // Swap the end nodes: the room is now on the left, the outside right.
        const w = doc.walls[TOP]!;
        [w.a, w.b] = [w.b, w.a];
        const geom = derivePlanGeometry(doc);
        expect(geom.walls[TOP]!.exteriorSide).toBe('right');
        const g = autoDimensions(geom.walls[TOP]!, doc.walls[TOP]!, opts);
        const line = linesOf(g, 'dim_line')[0]!;
        expect(line.a).toEqual({ x: 5000, y: -515 });
        expect(line.b).toEqual({ x: 0, y: -515 });
    });

    it('defaults to the left side when no side is exterior', () => {
        const doc = singleWall([0, 0, 2000, 0]);
        const geom = derivePlanGeometry(doc);
        expect(geom.walls[TOP]!.exteriorSide).toBeNull();
        const g = autoDimensions(geom.walls[TOP]!, doc.walls[TOP]!, opts);
        // t = 115: offset 57.5 + 400 = 457.5 on +n (up the screen).
        expect(linesOf(g, 'dim_line')[0]!.a).toEqual({ x: 0, y: -457.5 });
    });

    it('draws nothing for walls shorter than 300 mm', () => {
        const short = singleWall([0, 0, 299, 0]);
        const geomShort = derivePlanGeometry(short);
        expect(
            autoDimensions(geomShort.walls[TOP]!, short.walls[TOP]!, opts)
                .items,
        ).toEqual([]);
        const ok = singleWall([0, 0, 300, 0]);
        const geomOk = derivePlanGeometry(ok);
        expect(
            autoDimensions(geomOk.walls[TOP]!, ok.walls[TOP]!, opts).items
                .length,
        ).toBeGreaterThan(0);
    });

    it('normalises the text rotation into (-90, 90] for every direction', () => {
        const cases: Array<[[number, number, number, number], number]> = [
            [[0, 0, 1000, 0], 0],
            [[1000, 0, 0, 0], 0],
            [[0, 0, 0, 1000], 90],
            [[0, 1000, 0, 0], 90],
            [[0, 0, 1000, 1000], 45],
            [[1000, 1000, 0, 0], 45],
            [[0, 1000, 1000, 0], -45],
            [[1000, 0, 0, 1000], -45],
        ];
        for (const [coords, expected] of cases) {
            const doc = singleWall(coords);
            const geom = derivePlanGeometry(doc);
            const g = autoDimensions(geom.walls[TOP]!, doc.walls[TOP]!, opts);
            const rot = textsOf(g)[0]!.rotationDeg;
            expect(rot).toBe(expected);
            expect(rot).toBeGreaterThan(-90);
            expect(rot).toBeLessThanOrEqual(90);
            expect(Object.is(rot, -0)).toBe(false);
        }
    });

    it('formats with the document unit system', () => {
        const imperial = testDrawingOptions({
            units: { system: 'imperial', unit: 'ftin', locale: 'en' },
        });
        const g = topGroup(imperial);
        expect(textsOf(g)[0]!.text).toBe(formatLength(5000, imperial.units));
        expect(textsOf(g)[0]!.text).toContain("'");
    });

    it('is hidden at lod 1', () => {
        expect(topGroup(testDrawingOptions({ lod: 1 })).items).toEqual([]);
    });
});

describe('drawDimension', () => {
    const dim = (patch = {}) => ({
        id: 'd_0000000001',
        a: { x: 0, y: 0 },
        b: { x: 1000, y: 0 },
        offset: 300,
        attachedTo: null,
        ...patch,
    });

    it('offsets the line along the left perpendicular by the signed offset', () => {
        const g = drawDimension(dim(), opts);
        expect(g).toMatchObject({
            entityId: 'd_0000000001',
            entityKind: 'dimension',
        });
        expect(linesOf(g, 'dim_line')).toEqual([
            {
                t: 'line',
                a: { x: 0, y: -300 },
                b: { x: 1000, y: -300 },
                style: 'dim_line',
            },
        ]);
        expect(textsOf(g)[0]).toMatchObject({
            text: formatLength(1000, opts.units),
            at: { x: 500, y: -300 },
            dyEm: -0.25,
            baseline: 'bottom',
            anchor: 'middle',
        });
        const ext = linesOf(g, 'dim_ext');
        expect(ext).toHaveLength(2);
        expect(ext[0]).toMatchObject({
            a: { x: 0, y: -100 },
            b: { x: 0, y: -400 },
        });

        const flipped = drawDimension(dim({ offset: -300 }), opts);
        expect(linesOf(flipped, 'dim_line')[0]!.a).toEqual({ x: 0, y: 300 });
        expect(linesOf(flipped, 'dim_ext')[0]).toMatchObject({
            a: { x: 0, y: 100 },
            b: { x: 0, y: 400 },
        });
    });

    it('keeps the text upright when a runs right to left', () => {
        const g = drawDimension(
            dim({ a: { x: 1000, y: 0 }, b: { x: 0, y: 0 } }),
            opts,
        );
        expect(textsOf(g)[0]!.rotationDeg).toBe(0);
    });

    it('drops the text at lod 2', () => {
        const g = drawDimension(dim(), testDrawingOptions({ lod: 2 }));
        expect(textsOf(g)).toHaveLength(0);
        expect(linesOf(g, 'dim_line')).toHaveLength(1);
    });
});
