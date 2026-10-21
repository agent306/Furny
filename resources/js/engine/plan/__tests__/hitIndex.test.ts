import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../../geometry/vec2';
import { buildPlanDrawing } from '../drawing';
import { derivePlanGeometry } from '../derive';
import {
    buildHitIndex,
    hitTest,
    hitTestRect,
    type Hit,
    type HitLayerMask,
} from '../hitIndex';
import type { PlanDocument } from '../schema';
import {
    addFixture,
    addOpening,
    addRoomMeta,
    textsOf,
} from '../testing/drawingHelpers';
import { testDrawingOptions } from '../testing/drawingOptions';
import { makeRectPlan } from '../testing/fixtures';
import { buildBrochure2Bhk, buildHdb3Room } from '../testing/referencePlans';

// makeRectPlan(5000, 4000, 230): walls w1 top (0,0)-(5000,0), w2 right, w3
// bottom, w4 left, nodes n1..n4 at the corners. Wall outlines reach 115 mm
// beyond the centre lines; the net room is x 115..4885, y 115..3885.
const W_TOP = 'w_0000000001';
const W_LEFT = 'w_0000000004';
const N1 = 'n_0000000001';
const ZOOM = 0.1; // mouse tolerance 80 mm, touch 160 mm
const opts = testDrawingOptions();

interface World {
    doc: PlanDocument;
    index: ReturnType<typeof buildHitIndex>;
    drawing: ReturnType<typeof buildPlanDrawing>;
}

function world(doc: PlanDocument): World {
    const geom = derivePlanGeometry(doc);
    const drawing = buildPlanDrawing(doc, geom, opts);
    return {
        doc,
        drawing,
        index: buildHitIndex(doc, geom, drawing, opts.footprints),
    };
}

const at = (
    w: World,
    p: Vec2,
    pointer: 'mouse' | 'pen' | 'touch' = 'mouse',
    layers: HitLayerMask = {},
    zoom = ZOOM,
): Hit[] => hitTest(w.index, p, zoom, pointer, layers);

const kinds = (hits: Hit[]): string[] => hits.map((h) => h.kind);

function addPlacement(
    doc: PlanDocument,
    id: string,
    designId: string,
    x: number,
    y: number,
    over: { rotation?: number; elevation?: number } = {},
): void {
    doc.placements[id] = {
        id,
        designId,
        x,
        y,
        rotation: over.rotation ?? 0,
        elevation: over.elevation ?? 0,
        mirrored: false,
        wallAttachment: null,
    };
}

function roomPlan(): World & { roomId: string } {
    const doc = makeRectPlan(5000, 4000, 230);
    const roomId = addRoomMeta(doc, { x: 2500, y: 2000 }, { name: 'Living' });
    return { ...world(doc), roomId };
}

describe('hitTest priority (04 §5.12)', () => {
    it('returns nothing far from every entity', () => {
        const w = world(makeRectPlan(5000, 4000, 230));
        expect(at(w, { x: 20000, y: 20000 })).toEqual([]);
    });

    it('prefers a point inside an opening cut over the wall', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        const o = addOpening(doc, W_TOP, { offset: 2500, width: 900 });
        const w = world(doc);
        const hits = at(w, { x: 2500, y: 0 });
        expect(hits[0]).toMatchObject({
            kind: 'opening',
            id: o,
            distancePx: 0,
        });
        expect(kinds(hits)).toContain('wall');
        expect(kinds(hits).indexOf('opening')).toBeLessThan(
            kinds(hits).indexOf('wall'),
        );
    });

    it('expands the opening cut by the tolerance', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        const o = addOpening(doc, W_TOP, { offset: 2500, width: 900 });
        const w = world(doc);
        // the cut ends at x = 2950 (+0.5 mm beyond each face, across only)
        const near = at(w, { x: 3000, y: 0 });
        expect(near[0]).toMatchObject({ kind: 'opening', id: o });
        expect(near[0]!.distancePx).toBeCloseTo(5, 5);
        expect(at(w, { x: 3100, y: 0 })[0]).toMatchObject({
            kind: 'wall',
            id: W_TOP,
        });
    });

    it('lets a node within tolerance win over the wall', () => {
        const w = world(makeRectPlan(5000, 4000, 230));
        const hits = at(w, { x: 30, y: 30 });
        expect(hits[0]).toMatchObject({ kind: 'node', id: N1 });
        expect(hits[0]!.distancePx).toBeCloseTo(Math.hypot(30, 30) * ZOOM, 1);
        expect(kinds(hits)).toContain('wall');
        // 300 mm along the wall the node is out of reach
        expect(at(w, { x: 300, y: 0 })[0]).toMatchObject({ kind: 'wall' });
    });

    it('uses the larger touch tolerance', () => {
        const w = world(makeRectPlan(5000, 4000, 230));
        const p = { x: 120, y: 0 }; // 120 mm: beyond 80 (mouse), within 160 (touch)
        expect(at(w, p, 'mouse')[0]!.kind).toBe('wall');
        expect(at(w, p, 'pen')[0]!.kind).toBe('wall');
        expect(at(w, p, 'touch')[0]).toMatchObject({ kind: 'node', id: N1 });
    });

    it('converts the tolerance by the zoom', () => {
        const w = world(makeRectPlan(5000, 4000, 230));
        const p = { x: 120, y: 0 };
        expect(at(w, p, 'mouse', {}, 0.1)[0]!.kind).toBe('wall');
        expect(at(w, p, 'mouse', {}, 0.05)[0]!.kind).toBe('node'); // 160 mm
    });

    it('hits a wall inside its outline or within tolerance of it', () => {
        const w = world(makeRectPlan(5000, 4000, 230));
        const inside = at(w, { x: 1000, y: 100 });
        expect(inside[0]).toMatchObject({
            kind: 'wall',
            id: W_TOP,
            distancePx: 0,
        });
        const edge = at(w, { x: 1000, y: 165 }); // 50 mm off the outline
        expect(edge[0]).toMatchObject({ kind: 'wall', id: W_TOP });
        expect(edge[0]!.distancePx).toBeCloseTo(5, 5);
        expect(at(w, { x: 1000, y: 300 })[0]!.kind).not.toBe('wall');
    });

    it('breaks wall ties inside a joint by the distance to the centre line', () => {
        const w = world(makeRectPlan(5000, 4000, 230));
        // inside both outlines near the corner, nearer the left wall's centre line
        const hits = at(w, { x: 20, y: 90 }, 'mouse', { node: false });
        expect(hits.map((h) => h.id).slice(0, 2)).toEqual([W_LEFT, W_TOP]);
    });

    it('hits a room only inside its net polygon, after everything else', () => {
        const r = roomPlan();
        const inRoom = at(r, { x: 3500, y: 2800 });
        expect(inRoom).toEqual([{ kind: 'room', id: r.roomId, distancePx: 0 }]);
        // inside the wall thickness is not inside the net polygon
        expect(kinds(at(r, { x: 1000, y: 100 }))).toEqual(['wall']);
    });

    it('identifies a room without a RoomMeta as face:{faceKey}', () => {
        const w = world(makeRectPlan(5000, 4000, 230));
        const [hit] = at(w, { x: 3500, y: 2800 });
        expect(hit!.kind).toBe('room');
        expect(hit!.id).toMatch(/^face:/);
        const geom = derivePlanGeometry(w.doc);
        expect(hit!.id).toBe(`face:${geom.rooms[0]!.faceKey}`);
    });

    it('skips rooms inside a hole of the net polygon', () => {
        const doc = makeRectPlan(8000, 8000, 230);
        // an island room: inner square of walls inside the outer one
        const ids = [
            ['n_a000000001', 3000, 3000],
            ['n_a000000002', 5000, 3000],
            ['n_a000000003', 5000, 5000],
            ['n_a000000004', 3000, 5000],
        ] as const;
        for (const [id, x, y] of ids) doc.nodes[id] = { id, x, y };
        ids.forEach(([id], i) => {
            const b = ids[(i + 1) % 4]![0];
            const wid = `w_a00000000${i + 1}`;
            doc.walls[wid] = {
                id: wid,
                a: id,
                b,
                thickness: 115,
                height: 2600,
                kind: 'interior',
                justification: 'center',
                material: 'brick',
                colorHex: null,
            };
        });
        const w = world(doc);
        const outer = at(w, { x: 1500, y: 1500 });
        const inner = at(w, { x: 4000, y: 4000 });
        expect(outer).toHaveLength(1);
        expect(inner).toHaveLength(1);
        expect(outer[0]!.id).not.toBe(inner[0]!.id);
        const geom = derivePlanGeometry(doc);
        expect(geom.rooms).toHaveLength(2);
    });

    it('hits a placement inside or within tolerance of its footprint, above the wall', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        // back edge on the wall centre line: the footprint overlaps the wall
        addPlacement(doc, 'f_0000000001', 'sofa', 1000, 0);
        const w = world(doc);
        const hits = at(w, { x: 1000, y: 50 });
        expect(kinds(hits)).toEqual(['placement', 'wall']);
        expect(hits[0]).toMatchObject({ id: 'f_0000000001', distancePx: 0 });
    });

    it('treats a footprint edge within tolerance as a hit, with its distance', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        addPlacement(doc, 'f_0000000001', 'sofa', 2000, 1000); // x 1500..2500, y 1000..1500
        const w = world(doc);
        const near = at(w, { x: 2000, y: 1550 });
        expect(near[0]).toMatchObject({
            kind: 'placement',
            id: 'f_0000000001',
        });
        expect(near[0]!.distancePx).toBeCloseTo(5, 5);
        expect(kinds(at(w, { x: 2000, y: 1650 }))).not.toContain('placement');
    });

    it('ranks stacked placements by elevation + height, then by later id', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        addPlacement(doc, 'f_0000000001', 'sofa', 2000, 1000); // top 750
        addPlacement(doc, 'f_0000000002', 'sofa', 2000, 1000); // top 750, later id
        addPlacement(doc, 'f_0000000003', 'wardrobe', 2000, 1000); // top 2100
        addPlacement(doc, 'f_0000000004', 'sofa', 2000, 1000, {
            elevation: 1500,
        }); // top 2250
        const w = world(doc);
        const ids = at(w, { x: 2000, y: 1200 })
            .filter((h) => h.kind === 'placement')
            .map((h) => h.id);
        expect(ids).toEqual([
            'f_0000000004',
            'f_0000000003',
            'f_0000000002',
            'f_0000000001',
        ]);
    });

    it('ranks inside hits before edge hits, and mixes fixtures with placements', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        addPlacement(doc, 'f_0000000001', 'sofa', 2000, 1000); // y 1000..1500
        const x = addFixture(doc, {
            x: 2000,
            y: 1900,
            width: 1000,
            depth: 700,
            height: 2000,
        }); // y 1550..2250
        const w = world(doc);
        const order = (y: number): Array<[string, string]> =>
            at(w, { x: 2000, y })
                .filter((h) => h.kind === 'placement' || h.kind === 'fixture')
                .map((h) => [h.kind, h.id]);
        // inside the fixture, 70 mm below the sofa: inside wins over the nearer-edge rule
        expect(order(1570)).toEqual([
            ['fixture', x],
            ['placement', 'f_0000000001'],
        ]);
        // between them: both are edge hits, the nearer (sofa, 20 mm) first
        expect(order(1520)).toEqual([
            ['placement', 'f_0000000001'],
            ['fixture', x],
        ]);
        expect(order(1535)).toEqual([
            ['fixture', x],
            ['placement', 'f_0000000001'],
        ]);
    });

    it('hits a placement of an unknown design as the 600 mm square it is drawn as', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        addPlacement(doc, 'f_0000000001', 'no_such_design', 2000, 1000);
        const w = world(doc);
        expect(at(w, { x: 2000, y: 1300 })[0]).toMatchObject({
            kind: 'placement',
            id: 'f_0000000001',
        });
        expect(kinds(at(w, { x: 2000, y: 1700 }))).not.toContain('placement');
    });

    it('puts a text label above placements, and a room label above a label', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        addPlacement(doc, 'f_0000000001', 'sofa', 1400, 900);
        doc.annotations.labels['t_0000000001'] = {
            id: 't_0000000001',
            position: { x: 1000, y: 1000 },
            text: 'Hello',
            fontSize: 300,
            rotation: 0,
        };
        const w = world(doc);
        // label box: x 1000..1840, y 850..1150
        expect(
            at(w, { x: 1200, y: 1000 })
                .slice(0, 2)
                .map((h) => h.kind),
        ).toEqual(['label', 'placement']);
        expect(at(w, { x: 1200, y: 1000 })[0]!.id).toBe('t_0000000001');
        expect(kinds(at(w, { x: 1200, y: 1200 }))).not.toContain('label');
    });

    it('hits a rotated label box', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        doc.annotations.labels['t_0000000001'] = {
            id: 't_0000000001',
            position: { x: 2000, y: 2000 },
            text: 'Vertical',
            fontSize: 300,
            rotation: 90,
        };
        const w = world(doc);
        // rotated 90 deg clockwise: the text runs down from (2000, 2000)
        expect(at(w, { x: 2000, y: 2500 })[0]).toMatchObject({ kind: 'label' });
        expect(kinds(at(w, { x: 2500, y: 2000 }))).not.toContain('label');
    });

    it('hits the room label box above placements', () => {
        const r = roomPlan();
        const group = r.drawing.layers.TEXT.find(
            (g) => g.entityKind === 'room',
        )!;
        const name = textsOf(group, 'room_name')[0]!;
        const p = { x: name.at.x, y: name.at.y + name.dyEm * name.sizeMm };
        addPlacement(r.doc, 'f_0000000001', 'wardrobe', p.x, p.y - 100);
        const w = world(r.doc);
        const hits = at(w, p);
        expect(hits[0]).toMatchObject({ kind: 'room_label', id: r.roomId });
        expect(kinds(hits)).toEqual(['room_label', 'placement', 'room']);
    });

    it('hits a user dimension on its line and on its text, above labels', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        doc.annotations.dimensions['d_0000000001'] = {
            id: 'd_0000000001',
            a: { x: 1000, y: 1000 },
            b: { x: 3000, y: 1000 },
            offset: 300,
            attachedTo: null,
        };
        doc.annotations.labels['t_0000000001'] = {
            id: 't_0000000001',
            position: { x: 1000, y: 1200 },
            text: 'Hello',
            fontSize: 300,
            rotation: 0,
        };
        const w = world(doc);
        const group = w.drawing.layers.DIMS.find(
            (g) => g.entityKind === 'dimension',
        )!;
        const line = group.items.find(
            (i) => i.t === 'line' && i.style === 'dim_line',
        )!;
        if (line.t !== 'line') throw new Error('unreachable');
        const mid = {
            x: (line.a.x + line.b.x) / 2,
            y: (line.a.y + line.b.y) / 2,
        };
        expect(at(w, { x: mid.x - 700, y: mid.y + 30 })[0]).toMatchObject({
            kind: 'dimension',
            id: 'd_0000000001',
        });
        const txt = group.items.find((i) => i.t === 'text')!;
        if (txt.t !== 'text') throw new Error('unreachable');
        expect(at(w, { x: txt.at.x, y: txt.at.y - 40 })[0]).toMatchObject({
            kind: 'dimension',
        });
        // the label sits at 1000..1840 x 1050..1350: the dimension line is 300 below a-b, i.e. y 1300 or 700
        expect(kinds(at(w, { x: 2500, y: 3000 }))).not.toContain('dimension');
    });

    it('does not offer auto dimensions as dimension hits', () => {
        const w = world(makeRectPlan(5000, 4000, 230));
        // auto dimension lines run 515 mm outside the wall
        expect(kinds(at(w, { x: 2500, y: -515 }))).not.toContain('dimension');
    });

    it('orders hits by class, never by distance across classes', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        addOpening(doc, W_TOP, { offset: 600, width: 900 });
        addPlacement(doc, 'f_0000000001', 'sofa', 100, 20);
        const w = world(doc);
        const order = [
            'opening',
            'node',
            'dimension',
            'label',
            'room_label',
            'placement',
            'fixture',
            'wall',
            'room',
        ];
        const ranks = kinds(at(w, { x: 60, y: 40 })).map((k) =>
            order.indexOf(k),
        );
        expect(ranks.length).toBeGreaterThan(2);
        expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    });

    it('tolerates a zero-width opening', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        addOpening(doc, W_TOP, { offset: 2500, width: 0 });
        const w = world(doc);
        expect(kinds(at(w, { x: 2500, y: 0 }))).not.toContain('opening');
    });

    it('rejects a non-positive zoom', () => {
        const w = world(makeRectPlan(5000, 4000, 230));
        expect(() => at(w, { x: 0, y: 0 }, 'mouse', {}, 0)).toThrow(RangeError);
    });
});

describe('hitTest layer mask and background', () => {
    it('leaves hidden layers out of the result', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        addPlacement(doc, 'f_0000000001', 'sofa', 2000, 1000);
        addFixture(doc, { x: 2000, y: 1200 });
        const w = world(doc);
        const p = { x: 2000, y: 1200 };
        expect(kinds(at(w, p))).toContain('placement');
        expect(kinds(at(w, p, 'mouse', { placement: false }))).not.toContain(
            'placement',
        );
        expect(kinds(at(w, p, 'mouse', { placement: false }))).toContain(
            'fixture',
        );
        expect(
            kinds(
                at(w, p, 'mouse', {
                    room: false,
                    placement: false,
                    fixture: false,
                }),
            ),
        ).toEqual([]);
    });

    const bg = (
        over: Partial<NonNullable<PlanDocument['background']>> = {},
    ) => {
        const doc = makeRectPlan(5000, 4000, 230);
        doc.background = {
            importId: null,
            mediaUuid: 'abc',
            pixelWidth: 1000,
            pixelHeight: 500,
            mmPerPixel: 10,
            position: { x: 20000, y: 20000 },
            rotation: 0,
            opacity: 1,
            visible: true,
            locked: false,
            ...over,
        };
        return world(doc);
    };

    it('hits the background only when the Background tool asks for it', () => {
        const w = bg();
        const p = { x: 25000, y: 22500 }; // inside 20000..30000 x 20000..25000
        expect(at(w, p)).toEqual([]);
        expect(at(w, p, 'mouse', { background: true })).toEqual([
            { kind: 'background', id: 'background', distancePx: 0 },
        ]);
        expect(
            at(w, { x: 31000, y: 22500 }, 'mouse', { background: true }),
        ).toEqual([]);
    });

    it('ignores a locked or hidden background', () => {
        const p = { x: 25000, y: 22500 };
        expect(
            at(bg({ locked: true }), p, 'mouse', { background: true }),
        ).toEqual([]);
        expect(
            at(bg({ visible: false }), p, 'mouse', { background: true }),
        ).toEqual([]);
    });

    it('rotates the background about its centre', () => {
        const w = bg({ rotation: 90 });
        // centre (25000, 22500); a 10000 x 5000 image turned 90 deg is 5000 wide, 10000 tall
        const mask = { background: true } as const;
        expect(at(w, { x: 25000, y: 18000 }, 'mouse', mask)).toHaveLength(1);
        expect(at(w, { x: 29000, y: 22500 }, 'mouse', mask)).toHaveLength(0);
    });
});

describe('hitTestRect (04 §5.12)', () => {
    const base = (): World & { roomId: string; door: string } => {
        const doc = makeRectPlan(5000, 4000, 230);
        const door = addOpening(doc, W_TOP, { offset: 2500, width: 900 });
        const roomId = addRoomMeta(
            doc,
            { x: 2500, y: 2000 },
            { name: 'Living' },
        );
        addPlacement(doc, 'f_0000000001', 'sofa', 2000, 1000);
        addFixture(doc, { x: 4000, y: 3000 });
        doc.annotations.labels['t_0000000001'] = {
            id: 't_0000000001',
            position: { x: 1000, y: 2500 },
            text: 'Hello',
            fontSize: 300,
            rotation: 0,
        };
        return { ...world(doc), roomId, door };
    };
    const rect = (
        w: World,
        x0: number,
        y0: number,
        x1: number,
        y1: number,
        mode: 'window' | 'crossing',
    ) => hitTestRect(w.index, { x: x0, y: y0 }, { x: x1, y: y1 }, mode);

    it('window mode selects every entity fully inside, rooms included', () => {
        const w = base();
        const ids = rect(w, -300, -300, 5300, 4300, 'window');
        expect(ids).toEqual(
            [
                ...Object.keys(w.doc.nodes),
                ...Object.keys(w.doc.walls),
                w.door,
                w.roomId,
                'f_0000000001',
                ...Object.keys(w.doc.fixtures),
                't_0000000001',
            ].sort(),
        );
    });

    it('window mode leaves out entities that stick out of the rectangle', () => {
        const w = base();
        const ids = rect(w, -300, -300, 2000, 4300, 'window');
        expect(ids).toContain(N1);
        expect(ids).toContain(W_LEFT);
        expect(ids).not.toContain(W_TOP); // reaches x = 5115
        expect(ids).not.toContain(w.roomId);
        expect(ids).not.toContain('f_0000000001'); // x 1500..2500
        expect(ids).toContain('t_0000000001');
    });

    it('window mode does not select a wall by touching it', () => {
        const w = base();
        expect(rect(w, 1000, -50, 1100, 50, 'window')).toEqual([]);
    });

    it('crossing mode selects walls by outline, openings and bodies by geometry', () => {
        const w = base();
        const ids = rect(w, 1000, -50, 1100, 50, 'crossing');
        expect(ids).toEqual([W_TOP]);
        // a rectangle lying wholly inside the outline, away from the centre line
        expect(rect(w, 1000, 60, 1100, 100, 'crossing')).toEqual([W_TOP]);
        // crossing the opening cut and the wall
        expect(rect(w, 2400, -50, 2600, 50, 'crossing')).toEqual(
            [w.door, W_TOP].sort(),
        );
        // clipping a corner of the sofa footprint
        expect(rect(w, 2450, 1450, 2800, 1800, 'crossing')).toEqual([
            'f_0000000001',
        ]);
    });

    it('crossing mode never selects rooms', () => {
        const w = base();
        expect(rect(w, 600, 600, 700, 700, 'crossing')).toEqual([]);
        expect(rect(w, 100, 100, 4900, 3900, 'crossing')).not.toContain(
            w.roomId,
        );
        // ...even when the rectangle swallows the whole plan
        const all = rect(w, -300, -300, 5300, 4300, 'crossing');
        expect(all).not.toContain(w.roomId);
        expect(all).toContain(W_TOP);
    });

    it('crossing mode selects a wall the rectangle only encloses part of, by its outline', () => {
        const w = base();
        const ids = rect(w, -50, 1000, 50, 1100, 'crossing');
        expect(ids).toEqual([W_LEFT]);
    });

    it('selects nodes inside the rectangle in both modes', () => {
        const w = base();
        expect(rect(w, -50, -50, 50, 50, 'window')).toEqual([N1]);
        expect(rect(w, -50, -50, 50, 50, 'crossing')).toEqual(
            [N1, W_LEFT, W_TOP].sort(),
        );
    });

    it('accepts the corners in either order', () => {
        const w = base();
        expect(rect(w, 5300, 4300, -300, -300, 'window')).toEqual(
            rect(w, -300, -300, 5300, 4300, 'window'),
        );
    });

    it('returns sorted unique ids', () => {
        const w = base();
        const ids = rect(w, -300, -300, 5300, 4300, 'crossing');
        expect(ids).toEqual([...new Set(ids)].sort());
    });

    it('selects user dimensions by their line and text', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        doc.annotations.dimensions['d_0000000001'] = {
            id: 'd_0000000001',
            a: { x: 1000, y: 1000 },
            b: { x: 3000, y: 1000 },
            offset: 300,
            attachedTo: null,
        };
        const w = world(doc);
        const group = w.drawing.layers.DIMS.find(
            (g) => g.entityKind === 'dimension',
        )!;
        const line = group.items.find(
            (i) => i.t === 'line' && i.style === 'dim_line',
        );
        if (line?.t !== 'line') throw new Error('no dimension line');
        const { a, b } = line;
        const whole = [
            { x: a.x - 100, y: a.y - 600 },
            { x: b.x + 100, y: a.y + 600 },
        ] as const;
        const corner = [
            { x: a.x - 100, y: a.y - 100 },
            { x: a.x + 100, y: a.y + 100 },
        ] as const;
        const ids = (m: 'window' | 'crossing', r: typeof whole): string[] =>
            hitTestRect(w.index, r[0], r[1], m);
        expect(ids('window', whole)).toEqual(['d_0000000001']);
        expect(ids('window', corner)).toEqual([]);
        expect(ids('crossing', corner)).toEqual(['d_0000000001']);
    });
});

describe.each([
    ['hdb-3room', buildHdb3Room],
    ['brochure-2bhk', buildBrochure2Bhk],
])('hit index on %s', (_name, make) => {
    const doc = make();
    addPlacement(doc, 'f_0000000001', 'sofa', 3000, 3000);
    const w = world(doc);
    const geom = derivePlanGeometry(doc);

    it('hits every wall at its centre-line midpoint', () => {
        for (const wall of Object.values(geom.walls)) {
            const [a, b] = wall.centerline;
            const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
            const ids = at(w, mid, 'mouse', {}, 0.2).map((h) => h.id);
            const owner = new Set([wall.id, ...wall.openings.map((o) => o.id)]);
            expect(ids.some((id) => owner.has(id) || id.startsWith('n_'))).toBe(
                true,
            );
        }
    });

    it('hits every room at a point inside its net polygon', () => {
        for (const room of geom.rooms) {
            const hits = at(w, room.labelPoint);
            expect(hits.at(-1)).toMatchObject({
                kind: 'room',
                id: room.metaId ?? `face:${room.faceKey}`,
            });
        }
    });

    it('builds the same index from a shuffled document', () => {
        const rev = <T>(r: Record<string, T>): Record<string, T> =>
            Object.fromEntries(Object.entries(r).reverse());
        const shuffled: PlanDocument = {
            ...doc,
            nodes: rev(doc.nodes),
            walls: rev(doc.walls),
            openings: rev(doc.openings),
            rooms: rev(doc.rooms),
        };
        const s = world(shuffled);
        for (const room of geom.rooms) {
            expect(at(s, room.labelPoint)).toEqual(at(w, room.labelPoint));
        }
        expect(
            hitTestRect(
                s.index,
                { x: -1e5, y: -1e5 },
                { x: 1e5, y: 1e5 },
                'crossing',
            ),
        ).toEqual(
            hitTestRect(
                w.index,
                { x: -1e5, y: -1e5 },
                { x: 1e5, y: 1e5 },
                'crossing',
            ),
        );
    });
});
