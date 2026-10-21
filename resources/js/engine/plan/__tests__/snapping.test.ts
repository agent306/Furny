import { describe, expect, it } from 'vitest';
import { dist, normDeg, type Vec2 } from '../../geometry/vec2';
import { mulberry32 } from '../../testing/random';
import type { UnitSystem } from '../../units/types';
import { derivePlanGeometry } from '../derive';
import type { FootprintProvider } from '../footprint';
import type { PlanDocument } from '../schema';
import {
    SNAP_KINDS,
    buildSnapIndex,
    defaultSnapSettings,
    gridStepFor,
    rawStepFor,
    snapPoint,
    type SnapIndex,
    type SnapInput,
    type SnapKind,
    type SnapResult,
    type SnapSettings,
} from '../snapping';
import { emptyPlan, makeGridPlan, makeRectPlan } from '../testing/fixtures';
import { buildHdb3Room } from '../testing/referencePlans';

const noFootprints: FootprintProvider = () => null;

/** Plan whose walls are the given segments; nodes are shared by coordinates. */
function segmentsPlan(
    segments: ReadonlyArray<readonly [number, number, number, number]>,
): {
    doc: PlanDocument;
    nodeAt: (x: number, y: number) => string;
    walls: string[];
} {
    const doc = emptyPlan();
    const nodes = new Map<string, string>();
    let nodeCount = 0;
    let wallCount = 0;
    const nodeAt = (x: number, y: number): string => {
        const key = `${x},${y}`;
        let id = nodes.get(key);
        if (id === undefined) {
            nodeCount += 1;
            id = `n_${String(nodeCount).padStart(10, '0')}`;
            nodes.set(key, id);
            doc.nodes[id] = { id, x, y };
        }
        return id;
    };
    const walls: string[] = [];
    for (const [x1, y1, x2, y2] of segments) {
        wallCount += 1;
        const id = `w_${String(wallCount).padStart(10, '0')}`;
        doc.walls[id] = {
            id,
            a: nodeAt(x1, y1),
            b: nodeAt(x2, y2),
            thickness: 115,
            height: 2700,
            kind: 'interior',
            justification: 'center',
            material: 'brick',
            colorHex: null,
        };
        walls.push(id);
    }
    return { doc, nodeAt, walls };
}

/** Plan of orphan nodes only (alignment sources without walls). */
function nodesPlan(points: ReadonlyArray<readonly [number, number]>): {
    doc: PlanDocument;
    ids: string[];
} {
    const doc = emptyPlan();
    const ids = points.map(([x, y], i) => {
        const id = `n_${String(i + 1).padStart(10, '0')}`;
        doc.nodes[id] = { id, x, y };
        return id;
    });
    return { doc, ids };
}

/** Adds orphan nodes to an existing plan. */
function withNodes(
    doc: PlanDocument,
    points: ReadonlyArray<readonly [number, number]>,
): PlanDocument {
    points.forEach(([x, y], i) => {
        const id = `n_${String(900 + i).padStart(10, '0')}`;
        doc.nodes[id] = { id, x, y };
    });
    return doc;
}

const indexOf = (
    doc: PlanDocument,
    footprints: FootprintProvider = noFootprints,
): SnapIndex => buildSnapIndex(doc, derivePlanGeometry(doc), footprints);

function input(patch: Partial<SnapInput> & { cursor: Vec2 }): SnapInput {
    return {
        zoom: 0.1,
        pointerType: 'mouse',
        origin: null,
        previousDir: null,
        exclude: new Set<string>(),
        settings: defaultSnapSettings('metric'),
        modifiers: { shift: false, alt: false },
        ...patch,
    };
}

const snap = (
    index: SnapIndex,
    patch: Partial<SnapInput> & { cursor: Vec2 },
): SnapResult => snapPoint(input(patch), index);

const pt = (x: number, y: number): Vec2 => ({ x, y });

describe('SNAP_KINDS and defaultSnapSettings', () => {
    it('lists the twelve kinds of 04 5.1', () => {
        expect([...SNAP_KINDS]).toEqual([
            'endpoint',
            'intersection',
            'midpoint',
            'perpendicular',
            'guide_intersection',
            'on_wall',
            'on_face',
            'extension',
            'alignment',
            'angle',
            'grid',
            'none',
        ]);
    });

    it('enables everything with a visible grid and a 15 degree step', () => {
        const s = defaultSnapSettings('imperial');
        expect(s.enabled).toBe(true);
        expect(s.gridVisible).toBe(true);
        expect(s.angleStepDeg).toBe(15);
        expect(s.unitSystem).toBe('imperial');
        expect(Object.keys(s.kinds).sort()).toEqual(
            SNAP_KINDS.filter((k) => k !== 'none').sort(),
        );
        expect(Object.values(s.kinds).every((v) => v)).toBe(true);
    });
});

describe('gridStepFor', () => {
    it('picks 500 mm at zoom 0.1 (04 5.11)', () => {
        expect(gridStepFor(0.1, 'metric')).toEqual({ step: 500, major: 2500 });
    });

    it.each<[UnitSystem, number, number, number]>([
        ['metric', 0.01, 5000, 25000],
        ['metric', 0.1, 500, 2500],
        ['metric', 1, 50, 250],
        ['imperial', 0.01, 3048, 6096],
        ['imperial', 0.1, 304.8, 1524],
        ['imperial', 1, 25.4, 304.8],
    ])('%s at zoom %s -> step %s, major %s', (system, zoom, step, major) => {
        expect(gridStepFor(zoom, system)).toEqual({ step, major });
    });

    it('applies the major multipliers of 5.6 to every step of both sequences', () => {
        const metric: Array<[number, number, number]> = [
            [0.0016, 10000, 100000],
            [0.016, 1000, 10000],
            [0.16, 100, 1000],
            [1.6, 10, 100],
            [0.0032, 5000, 25000],
            [0.032, 500, 2500],
            [0.32, 50, 250],
        ];
        for (const [zoom, step, major] of metric) {
            expect(gridStepFor(zoom, 'metric')).toEqual({ step, major });
        }
        const imperial: Array<[number, number, number]> = [
            [0.00106, 15240, 30480],
            [0.0053, 3048, 6096],
            [0.0106, 1524, 7620],
            [0.1, 304.8, 1524],
            [0.106, 152.4, 304.8],
            [0.63, 25.4, 304.8],
        ];
        for (const [zoom, step, major] of imperial) {
            expect(gridStepFor(zoom, 'imperial')).toEqual({ step, major });
        }
    });

    it('falls back to the largest step when the plan is zoomed far out', () => {
        expect(gridStepFor(0.00001, 'metric')).toEqual({
            step: 10000,
            major: 100000,
        });
        expect(gridStepFor(0.00001, 'imperial')).toEqual({
            step: 15240,
            major: 30480,
        });
    });
});

describe('rawStepFor', () => {
    it.each([
        [0.1, 10],
        [1, 1],
        [10, 1],
        [0.5, 5],
        [0.04, 100],
        [0.01, 100],
    ])('zoom %s -> %s mm', (zoom, step) => {
        expect(rawStepFor(zoom)).toBe(step);
    });
});

describe('buildSnapIndex', () => {
    it('leaves every class null for an empty plan', () => {
        const index = indexOf(emptyPlan());
        expect(index.nodes).toBeNull();
        expect(index.centerlines).toBeNull();
        expect(index.faces).toBeNull();
        expect(index.footprints).toBeNull();
        expect(index.keyPoints).toBeNull();
    });

    it('indexes nodes, centre lines, faces and key points of a room', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        const index = indexOf(doc);
        expect(index.nodes!.items).toHaveLength(4);
        expect(index.centerlines!.items).toHaveLength(4);
        expect(index.faces!.items).toHaveLength(8);
        expect(index.keyPoints!.items).toHaveLength(4);
        expect(index.keyPoints!.items.every((k) => k.kind === 'wall_mid')).toBe(
            true,
        );
        expect(index.footprints).toBeNull();
    });

    it('adds two jamb centre points per opening', () => {
        const doc = buildHdb3Room();
        const index = indexOf(doc);
        const walls = Object.keys(doc.walls).length;
        const openings = Object.keys(doc.openings).length;
        const jambs = index.keyPoints!.items.filter((k) => k.kind === 'jamb');
        expect(jambs).toHaveLength(openings * 2);
        expect(index.keyPoints!.items).toHaveLength(walls + openings * 2);
    });

    it('indexes placement and fixture footprints of known designs', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        doc.placements['f_0000000001'] = {
            id: 'f_0000000001',
            designId: 'wardrobe',
            x: 1000,
            y: 200,
            rotation: 0,
            elevation: 0,
            mirrored: false,
            wallAttachment: null,
        };
        doc.placements['f_0000000002'] = {
            ...doc.placements['f_0000000001']!,
            id: 'f_0000000002',
            designId: 'unknown',
        };
        doc.fixtures['x_0000000001'] = {
            id: 'x_0000000001',
            libraryKey: 'kitchen_counter',
            x: 3000,
            y: 2000,
            rotation: 90,
            width: 1800,
            depth: 600,
            height: 900,
            elevation: 0,
            label: null,
        };
        const index = indexOf(doc, (id) =>
            id === 'wardrobe'
                ? { width: 1200, depth: 600, height: 2100 }
                : null,
        );
        const items = index.footprints!.items;
        expect(items.map((i) => i.id)).toEqual([
            'f_0000000001',
            'x_0000000001',
        ]);
        expect(items[0]!.footprint.corners[0]).toEqual(pt(400, 200));
        expect(items[0]!.height).toBe(2100);
        expect(items[1]!.footprint.rotation).toBe(90);
    });
});

describe('snapPoint tolerances (04 5.3, 5.11)', () => {
    const { doc, nodeAt } = segmentsPlan([[0, 0, 4000, 0]]);
    const index = indexOf(doc);
    const a = nodeAt(0, 0);

    it('snaps a mouse cursor 70 mm from a node but not 90 mm at zoom 0.1', () => {
        const near = snap(index, { cursor: pt(-70, 0) });
        expect(near.kind).toBe('endpoint');
        expect(near.nodeId).toBe(a);
        expect(near.point).toEqual(pt(0, 0));
        expect(near.markers).toEqual([{ kind: 'endpoint', at: pt(0, 0) }]);
        const far = snap(index, { cursor: pt(-90, 0) });
        expect(far.kind).not.toBe('endpoint');
        expect(far.nodeId).toBeNull();
    });

    it('uses 160 mm for touch at zoom 0.1', () => {
        expect(
            snap(index, { cursor: pt(-150, 0), pointerType: 'touch' }).kind,
        ).toBe('endpoint');
        expect(
            snap(index, { cursor: pt(-170, 0), pointerType: 'touch' }).kind,
        ).not.toBe('endpoint');
        expect(snap(index, { cursor: pt(-150, 0) }).kind).not.toBe('endpoint');
    });

    it('treats a pen like a mouse', () => {
        expect(
            snap(index, { cursor: pt(-70, 0), pointerType: 'pen' }).kind,
        ).toBe('endpoint');
        expect(
            snap(index, { cursor: pt(-90, 0), pointerType: 'pen' }).kind,
        ).not.toBe('endpoint');
    });

    it('scales the tolerance with the zoom (8 px)', () => {
        expect(snap(index, { cursor: pt(-7, 0), zoom: 1 }).kind).toBe(
            'endpoint',
        );
        expect(snap(index, { cursor: pt(-9, 0), zoom: 1 }).kind).not.toBe(
            'endpoint',
        );
    });

    it('skips a kind that is switched off', () => {
        const settings = defaultSnapSettings('metric');
        settings.kinds.endpoint = false;
        const r = snap(index, { cursor: pt(-30, 0), settings });
        expect(r.kind).not.toBe('endpoint');
        expect(r.nodeId).toBeNull();
    });
});

describe('snapPoint priorities (04 5.4)', () => {
    it('prefers the endpoint over the midpoint of a very short wall', () => {
        const { doc, nodeAt, walls } = segmentsPlan([[0, 0, 100, 0]]);
        const r = snap(indexOf(doc), { cursor: pt(40, 10) });
        expect(r.kind).toBe('endpoint');
        expect(r.nodeId).toBe(nodeAt(0, 0));
        expect(r.wallId).toBeNull();
        expect(walls).toHaveLength(1);
    });

    it('prefers the midpoint over on_wall', () => {
        const { doc, walls } = segmentsPlan([[0, 0, 4000, 0]]);
        const index = indexOf(doc);
        const r = snap(index, { cursor: pt(2030, 20) });
        expect(r.kind).toBe('midpoint');
        expect(r.point).toEqual(pt(2000, 0));
        expect(r.wallId).toBe(walls[0]);
        expect(r.u).toBe(2000);
        expect(r.markers).toEqual([{ kind: 'midpoint', at: pt(2000, 0) }]);

        const settings = defaultSnapSettings('metric');
        settings.kinds.midpoint = false;
        const onWall = snap(index, { cursor: pt(2030, 20), settings });
        expect(onWall.kind).toBe('on_wall');
        expect(onWall.point).toEqual(pt(2030, 0));
        expect(onWall.wallId).toBe(walls[0]);
        expect(onWall.u).toBe(2030);
        expect(onWall.markers).toEqual([]);
        expect(onWall.guides).toEqual([]);
    });

    it('reports the crossing of two walls that share no node', () => {
        const { doc, walls } = segmentsPlan([
            [0, 2000, 4000, 2000],
            [1500, -1000, 1500, 3000],
        ]);
        const index = indexOf(doc);
        const r = snap(index, { cursor: pt(1520, 1990) });
        expect(r.kind).toBe('intersection');
        expect(r.point).toEqual(pt(1500, 2000));
        expect(r.nodeId).toBeNull();
        expect(r.markers).toEqual([
            { kind: 'intersection', at: pt(1500, 2000) },
        ]);
        // excluding one of the walls removes the crossing
        const r2 = snap(index, {
            cursor: pt(1520, 1990),
            exclude: new Set([walls[0]!]),
        });
        expect(r2.kind).not.toBe('intersection');
    });

    it('does not report an intersection for walls that meet at a node', () => {
        const { doc, nodeAt } = segmentsPlan([
            [0, 0, 4000, 0],
            [0, 0, 0, 3000],
        ]);
        const r = snap(indexOf(doc), { cursor: pt(20, 20) });
        expect(r.kind).toBe('endpoint');
        expect(r.nodeId).toBe(nodeAt(0, 0));
    });

    it('skips the dragged node, its walls and their key points via exclude', () => {
        const { doc, nodeAt, walls } = segmentsPlan([[0, 0, 4000, 0]]);
        const index = indexOf(doc);
        const withNode = snap(index, {
            cursor: pt(-30, 0),
            exclude: new Set([nodeAt(0, 0)]),
        });
        expect(withNode.nodeId).toBeNull();
        expect(withNode.kind).not.toBe('endpoint');
        const withWall = snap(index, {
            cursor: pt(2030, 20),
            exclude: new Set([walls[0]!]),
        });
        expect(withWall.kind).not.toBe('midpoint');
        expect(withWall.kind).not.toBe('on_wall');
        expect(withWall.wallId).toBeNull();
    });
});

describe('snapPoint perpendicular', () => {
    const { doc, walls } = segmentsPlan([[0, 0, 4000, 0]]);
    const index = indexOf(doc);

    it('snaps to the foot of the perpendicular from the origin', () => {
        const origin = pt(1000, 2000);
        const r = snap(index, { cursor: pt(1020, -30), origin });
        expect(r.kind).toBe('perpendicular');
        expect(r.point).toEqual(pt(1000, 0));
        expect(r.wallId).toBe(walls[0]);
        expect(r.u).toBe(1000);
        expect(r.guides).toEqual([
            { kind: 'perpendicular', a: origin, b: pt(1000, 0) },
        ]);
        expect(r.markers).toEqual([{ kind: 'perpendicular', at: pt(1000, 0) }]);
        expect(r.lengthFromOrigin).toBe(2000);
        expect(r.displayAngleDeg).toBe(90);
    });

    it('needs the foot to lie inside the wall', () => {
        // the foot (4050, 0) is 50 mm beyond the end of the wall at x = 4000
        const origin = pt(4050, 2000);
        const cursor = pt(4040, -20);
        expect(snap(index, { cursor, origin }).kind).toBe('endpoint');
        const settings = defaultSnapSettings('metric');
        settings.kinds.endpoint = false;
        const r = snap(index, { cursor, origin, settings });
        expect(r.kind).not.toBe('perpendicular');
        expect(r.wallId).toBeNull();
        // and the same offset inside the wall does snap
        const inside = snap(index, {
            cursor: pt(3950, -20),
            origin: pt(3960, 2000),
            settings,
        });
        expect(inside.kind).toBe('perpendicular');
        expect(inside.point).toEqual(pt(3960, 0));
    });

    it('needs an origin', () => {
        const r = snap(index, { cursor: pt(1020, -30) });
        expect(r.kind).not.toBe('perpendicular');
    });
});

describe('snapPoint guide lines', () => {
    it('extends a wall along its own line, beating a coincident alignment', () => {
        const { doc, nodeAt } = segmentsPlan([[0, 0, 4000, 0]]);
        const r = snap(indexOf(doc), { cursor: pt(4400, 30) });
        expect(r.kind).toBe('extension');
        expect(r.point).toEqual(pt(4400, 0));
        expect(r.wallId).toBeNull();
        expect(r.guides).toEqual([
            { kind: 'extension', a: pt(4000, 0), b: pt(4400, 0) },
        ]);
        expect(r.markers).toEqual([]);
        expect(nodeAt(4000, 0)).toBeTruthy();
    });

    it('extends a slanted wall within max(600 mm, 60 px) of its end only', () => {
        const { doc } = segmentsPlan([[0, 0, 4000, 1000]]);
        const index = indexOf(doc);
        const len = Math.hypot(4000, 1000);
        const d = pt(4000 / len, 1000 / len);
        const n = pt(d.y, -d.x);
        const at = (beyond: number, off: number): Vec2 =>
            pt(
                4000 + d.x * beyond + n.x * off,
                1000 + d.y * beyond + n.y * off,
            );
        const near = snap(index, { cursor: at(400, 30) });
        expect(near.kind).toBe('extension');
        const on = at(400, 0);
        expect(near.point.x).toBe(Math.round(on.x));
        expect(near.point.y).toBe(Math.round(on.y));
        const far = snap(index, { cursor: at(700, 30) });
        expect(far.kind).not.toBe('extension');
    });

    it('does not extend through the wall interior', () => {
        const { doc } = segmentsPlan([[0, 0, 4000, 1000]]);
        const r = snap(indexOf(doc), { cursor: pt(1000, 250 + 30) });
        expect(r.kind).toBe('on_wall');
    });

    it('aligns with the vertical line through a node within 400 px', () => {
        const { doc } = segmentsPlan([[0, 0, 4000, 0]]);
        const index = indexOf(doc);
        const r = snap(index, { cursor: pt(30, 2000) });
        expect(r.kind).toBe('alignment');
        expect(r.point).toEqual(pt(0, 2000));
        expect(r.guides).toEqual([
            { kind: 'alignment', a: pt(0, 0), b: pt(0, 2000) },
        ]);
        expect(snap(index, { cursor: pt(30, 3900) }).kind).toBe('alignment');
        expect(snap(index, { cursor: pt(30, 4100) }).kind).not.toBe(
            'alignment',
        );
    });

    it('aligns with the horizontal line through a node too', () => {
        const { doc } = segmentsPlan([
            [0, 0, 0, 3000],
            [5000, 1000, 5000, 3000],
        ]);
        const r = snap(indexOf(doc), { cursor: pt(2500, 1020) });
        expect(r.kind).toBe('alignment');
        expect(r.point).toEqual(pt(2500, 1000));
        expect(r.guides[0]).toEqual({
            kind: 'alignment',
            a: pt(5000, 1000),
            b: pt(2500, 1000),
        });
    });

    it('intersects an extension with an alignment (guide_intersection)', () => {
        const { doc } = segmentsPlan([
            [0, 0, 4000, 0],
            [4400, 3000, 4400, 6000],
        ]);
        const r = snap(indexOf(doc), { cursor: pt(4420, -20) });
        expect(r.kind).toBe('guide_intersection');
        expect(r.point).toEqual(pt(4400, 0));
        expect(r.guides).toEqual([
            { kind: 'extension', a: pt(4000, 0), b: pt(4400, 0) },
            { kind: 'alignment', a: pt(4400, 3000), b: pt(4400, 0) },
        ]);
        expect(r.markers).toEqual([
            { kind: 'guide_intersection', at: pt(4400, 0) },
        ]);
    });

    it('intersects an angle ray with an alignment line', () => {
        const { doc } = nodesPlan([[3000, 5000]]);
        const origin = pt(0, 0);
        // the 45 degree ray meets the vertical line x = 3000 at (3000, 3000)
        const r = snap(indexOf(doc), { cursor: pt(3020, 3010), origin });
        expect(r.kind).toBe('guide_intersection');
        expect(r.point).toEqual(pt(3000, 3000));
        expect(r.guides.map((g) => g.kind).sort()).toEqual([
            'alignment',
            'angle',
        ]);
    });
});

describe('snapPoint on faces', () => {
    const { doc } = segmentsPlan([[0, 0, 4000, 0]]);
    const index = indexOf(doc);

    it('snaps to a wall face only when the tool asks for faces', () => {
        const without = snap(index, { cursor: pt(1000, 100) });
        expect(without.kind).not.toBe('on_face');
        const r = snap(index, { cursor: pt(1000, 100), includeFaces: true });
        expect(r.kind).toBe('on_face');
        expect(r.point).toEqual(pt(1000, 58));
        expect(r.guides).toHaveLength(1);
        expect(r.guides[0]!.kind).toBe('face');
        expect(r.guides[0]!.a.y).toBe(57.5);
        expect(r.guides[0]!.b.y).toBe(57.5);
    });

    it('respects the on_face switch', () => {
        const settings = defaultSnapSettings('metric');
        settings.kinds.on_face = false;
        const r = snap(index, {
            cursor: pt(1000, 100),
            includeFaces: true,
            settings,
        });
        expect(r.kind).not.toBe('on_face');
    });
});

describe('snapPoint angle snapping and the origin readout', () => {
    const empty = indexOf(emptyPlan());

    it('snaps to the 0 degree ray on an empty plan (04 5.11)', () => {
        const r = snap(empty, { cursor: pt(3000, 40), origin: pt(0, 0) });
        expect(r.kind).toBe('angle');
        expect(r.point).toEqual(pt(3000, 0));
        expect(r.displayAngleDeg).toBe(0);
        expect(r.lengthFromOrigin).toBe(3000);
        expect(r.guides).toEqual([
            { kind: 'angle', a: pt(0, 0), b: pt(3000, 0) },
        ]);
        expect(r.nodeId).toBeNull();
        expect(r.wallId).toBeNull();
        expect(r.u).toBeNull();
    });

    it('reports counter-clockwise display angles on the y-down screen', () => {
        const up = snap(empty, { cursor: pt(10, -3000), origin: pt(0, 0) });
        expect(up.point).toEqual(pt(0, -3000));
        expect(up.displayAngleDeg).toBe(90);
        const down = snap(empty, { cursor: pt(10, 3000), origin: pt(0, 0) });
        expect(down.point).toEqual(pt(0, 3000));
        expect(down.displayAngleDeg).toBe(270);
        const left = snap(empty, { cursor: pt(-3000, 5), origin: pt(0, 0) });
        expect(left.displayAngleDeg).toBe(180);
        // 15 degrees counter-clockwise on screen is up and to the right
        const r = 3000;
        const rad = (15 * Math.PI) / 180;
        const up15 = snap(empty, {
            cursor: pt(r * Math.cos(rad), -r * Math.sin(rad) + 10),
            origin: pt(0, 0),
        });
        expect(up15.kind).toBe('angle');
        expect(up15.displayAngleDeg).toBe(15);
        // the cursor is projected onto the ray: 10 mm below it removes 10 sin(15) of length
        const t = r - 10 * Math.sin(rad);
        expect(up15.point.x).toBe(Math.round(t * Math.cos(rad)));
        expect(up15.point.y).toBe(-Math.round(t * Math.sin(rad)));
    });

    it('honours the configured step', () => {
        const settings = defaultSnapSettings('metric');
        settings.angleStepDeg = 90;
        settings.gridVisible = false;
        // a 15 degree ray is no longer offered
        const r15 = snap(empty, {
            cursor: pt(2898, 776),
            origin: pt(0, 0),
            settings,
        });
        expect(r15.kind).toBe('none');
        const r90 = snap(empty, {
            cursor: pt(40, 2900),
            origin: pt(0, 0),
            settings,
        });
        expect(r90.kind).toBe('angle');
        expect(r90.point).toEqual(pt(0, 2900));
        expect(r90.displayAngleDeg).toBe(270);
    });

    it('offers no angle snap closer than 20 px to the origin', () => {
        const settings = defaultSnapSettings('metric');
        settings.gridVisible = false;
        const r = snap(empty, {
            cursor: pt(150, 10),
            origin: pt(0, 0),
            settings,
        });
        expect(r.kind).toBe('none');
        expect(r.point).toEqual(pt(150, 10));
        expect(r.lengthFromOrigin).toBe(150);
    });

    it('adds rays parallel and perpendicular to the previous direction', () => {
        const rad = (20 * Math.PI) / 180;
        const dir = pt(Math.cos(rad), Math.sin(rad));
        const along = (t: number, off = 0): Vec2 =>
            pt(dir.x * t + dir.y * off, dir.y * t - dir.x * off);
        const parallel = snap(empty, {
            cursor: along(3000, 20),
            origin: pt(0, 0),
            previousDir: dir,
        });
        expect(parallel.kind).toBe('angle');
        expect(parallel.guides.map((g) => g.kind)).toEqual(['parallel']);
        expect(parallel.displayAngleDeg).toBe(340);
        const perp = snap(empty, {
            cursor: pt(-dir.y * 3000 + 5, dir.x * 3000),
            origin: pt(0, 0),
            previousDir: dir,
        });
        expect(perp.kind).toBe('angle');
        expect(perp.guides.map((g) => g.kind)).toEqual(['perpendicular']);
        const without = snap(empty, {
            cursor: along(3000, 20),
            origin: pt(0, 0),
        });
        expect(without.guides).toEqual([]);
        expect(without.kind).toBe('grid');
    });

    it('does not duplicate a relative ray that coincides with a step ray', () => {
        const r = snap(empty, {
            cursor: pt(3000, 40),
            origin: pt(0, 0),
            previousDir: pt(1, 0),
        });
        expect(r.guides.map((g) => g.kind)).toEqual(['angle']);
    });
});

describe('snapPoint shift (hard 45 degree lock)', () => {
    const empty = indexOf(emptyPlan());

    it('projects onto the nearest 45 degree ray (04 5.11)', () => {
        const r = snap(empty, {
            cursor: pt(1000, 900),
            origin: pt(0, 0),
            modifiers: { shift: true, alt: false },
        });
        expect(r.point).toEqual(pt(950, 950));
        expect(r.kind).toBe('angle');
        expect(r.displayAngleDeg).toBe(315);
        expect(r.lengthFromOrigin).toBe(1344);
        expect(r.guides).toEqual([
            { kind: 'angle', a: pt(0, 0), b: pt(950, 950) },
        ]);
    });

    it('locks to the axis nearest the cursor', () => {
        const r = snap(empty, {
            cursor: pt(-2000, -300),
            origin: pt(100, 100),
            modifiers: { shift: true, alt: false },
        });
        expect(r.point).toEqual(pt(-2000, 100));
        expect(r.displayAngleDeg).toBe(180);
    });

    it('survives a cursor on the origin', () => {
        const r = snap(empty, {
            cursor: pt(100, 100),
            origin: pt(100, 100),
            modifiers: { shift: true, alt: false },
        });
        expect(r.point).toEqual(pt(100, 100));
        expect(r.lengthFromOrigin).toBe(0);
    });

    it('does not use the grid while locked', () => {
        const settings = defaultSnapSettings('metric');
        settings.gridVisible = true;
        const r = snap(empty, {
            cursor: pt(1000, 900),
            origin: pt(0, 0),
            modifiers: { shift: true, alt: false },
            settings,
        });
        expect(r.point).toEqual(pt(950, 950));
    });

    it('still snaps to a node that lies on the ray', () => {
        const { doc, nodeAt } = segmentsPlan([[2000, 2000, 2000, 5000]]);
        const r = snap(indexOf(doc), {
            cursor: pt(2010, 1990),
            origin: pt(0, 0),
            modifiers: { shift: true, alt: false },
        });
        expect(r.kind).toBe('endpoint');
        expect(r.nodeId).toBe(nodeAt(2000, 2000));
        expect(r.point).toEqual(pt(2000, 2000));
        expect(r.guides.map((g) => g.kind)).toEqual(['angle']);
    });

    it('ignores a node that is off the ray', () => {
        const { doc } = segmentsPlan([[2000, 2060, 5000, 2060]]);
        const r = snap(indexOf(doc), {
            cursor: pt(2000, 2030),
            origin: pt(0, 0),
            modifiers: { shift: true, alt: false },
        });
        expect(r.nodeId).toBeNull();
        expect(r.kind).not.toBe('endpoint');
    });

    it('turns on_wall into the ray crossing the wall line', () => {
        const { doc, walls } = segmentsPlan([[3000, 0, 3500, 5000]]);
        const r = snap(indexOf(doc), {
            cursor: pt(3350, 3300),
            origin: pt(0, 0),
            modifiers: { shift: true, alt: false },
        });
        expect(r.kind).toBe('on_wall');
        expect(r.point).toEqual(pt(3333, 3333));
        expect(r.wallId).toBe(walls[0]);
        expect(r.u).toBeCloseTo((2 / 3) * Math.hypot(500, 5000), 6);
        expect(r.guides.map((g) => g.kind)).toEqual(['angle']);
    });

    it('meets a guide line on the ray as a guide_intersection', () => {
        const { doc } = nodesPlan([[3000, 5000]]);
        const r = snap(indexOf(doc), {
            cursor: pt(3020, 2990),
            origin: pt(0, 0),
            modifiers: { shift: true, alt: false },
        });
        expect(r.kind).toBe('guide_intersection');
        expect(r.point).toEqual(pt(3000, 3000));
        expect(r.guides).toEqual([
            { kind: 'angle', a: pt(0, 0), b: pt(3000, 3000) },
            { kind: 'alignment', a: pt(3000, 5000), b: pt(3000, 3000) },
        ]);
        expect(r.markers).toEqual([
            { kind: 'guide_intersection', at: pt(3000, 3000) },
        ]);
    });

    it('does nothing without an origin', () => {
        const r = snap(empty, {
            cursor: pt(1000, 900),
            modifiers: { shift: true, alt: false },
        });
        expect(r.kind).toBe('grid');
        expect(r.point).toEqual(pt(1000, 1000));
    });
});

describe('snapPoint without a snap (04 5.1, 5.5-1, 5.5-7)', () => {
    const { doc } = segmentsPlan([[0, 0, 4000, 0]]);
    const index = indexOf(doc);

    it('alt gives the raw rounding even next to a node', () => {
        const r = snap(index, {
            cursor: pt(-3.4, 2.6),
            modifiers: { shift: false, alt: true },
        });
        expect(r.kind).toBe('none');
        expect(r.point).toEqual(pt(0, 0));
        expect(r.guides).toEqual([]);
        expect(r.markers).toEqual([]);
        expect(r.nodeId).toBeNull();
        const far = snap(index, {
            cursor: pt(1234.4, 5678.6),
            modifiers: { shift: false, alt: true },
        });
        expect(far.point).toEqual(pt(1230, 5680));
        expect(far.kind).toBe('none');
    });

    it('alt still fills the origin readout', () => {
        const r = snap(index, {
            cursor: pt(1234, 1234),
            origin: pt(0, 0),
            modifiers: { shift: true, alt: true },
        });
        expect(r.kind).toBe('none');
        expect(r.point).toEqual(pt(1230, 1230));
        expect(r.lengthFromOrigin).toBe(1739);
        expect(r.displayAngleDeg).toBe(315);
        expect(r.guides).toEqual([]);
    });

    it('a disabled snap setting behaves like alt', () => {
        const settings = defaultSnapSettings('metric');
        settings.enabled = false;
        const r = snap(index, { cursor: pt(-30, 4), settings });
        expect(r.kind).toBe('none');
        expect(r.point).toEqual(pt(-30, 0));
    });

    it('raw rounding follows the zoom', () => {
        const settings = defaultSnapSettings('metric');
        settings.gridVisible = false;
        const cursor = pt(2503, 2507);
        expect(
            snap(index, { cursor, settings, zoom: 1, origin: null }).point,
        ).toEqual(pt(2503, 2507));
        const r = snap(index, { cursor: pt(1234, 5678), settings, zoom: 0.5 });
        expect(r.kind).toBe('none');
        expect(r.point).toEqual(pt(1235, 5680));
    });

    it('snaps to the grid when nothing else does, anchored at the origin', () => {
        const r = snap(index, { cursor: pt(1234, 5678) });
        expect(r.kind).toBe('grid');
        expect(r.point).toEqual(pt(1000, 5500));
        const neg = snap(index, { cursor: pt(-1234, -5678) });
        expect(neg.point).toEqual(pt(-1000, -5500));
        const half = snap(index, { cursor: pt(-250, 250) });
        expect(half.point).toEqual(pt(-500, 500));
    });

    it('rounds imperial grid points to integer mm', () => {
        const settings = defaultSnapSettings('imperial');
        const r = snap(index, { cursor: pt(100, 100), settings, zoom: 1 });
        expect(r.kind).toBe('grid');
        expect(r.point).toEqual(pt(102, 102)); // 4 x 25.4 = 101.6
    });

    it('does not use the grid when it is hidden', () => {
        const settings = defaultSnapSettings('metric');
        settings.gridVisible = false;
        const r = snap(index, { cursor: pt(1234, 5678), settings });
        expect(r.kind).toBe('none');
        expect(r.point).toEqual(pt(1230, 5680));
    });

    it('never returns negative zero', () => {
        const r = snap(index, {
            cursor: pt(-0.2, 0.2),
            modifiers: { shift: false, alt: true },
        });
        expect(Object.is(r.point.x, 0)).toBe(true);
        expect(Object.is(r.point.y, 0)).toBe(true);
        const g = snap(index, { cursor: pt(-30, 30) });
        expect(Object.is(g.point.x, 0)).toBe(true);
    });
});

describe('snapPoint results are integer and deterministic', () => {
    it('returns integer points, lengths and stable output on the HDB plan', () => {
        const doc = buildHdb3Room();
        const geom = derivePlanGeometry(doc);
        const a = buildSnapIndex(doc, geom, noFootprints);
        const b = buildSnapIndex(doc, geom, noFootprints);
        const random = mulberry32(7);
        for (let i = 0; i < 400; i += 1) {
            const patch: Partial<SnapInput> & { cursor: Vec2 } = {
                cursor: pt(random() * 12000 - 500, random() * 9000 - 500),
                zoom: [0.02, 0.1, 0.5, 2][i % 4]!,
                pointerType: i % 3 === 0 ? 'touch' : 'mouse',
                origin:
                    i % 2 === 0 ? pt(random() * 9000, random() * 7000) : null,
                modifiers: { shift: i % 5 === 0, alt: false },
                includeFaces: i % 7 === 0,
            };
            const r1 = snap(a, patch);
            const r2 = snap(b, patch);
            expect(r2).toEqual(r1);
            expect(Number.isInteger(r1.point.x)).toBe(true);
            expect(Number.isInteger(r1.point.y)).toBe(true);
            expect(Object.is(r1.point.x, -0)).toBe(false);
            expect(Object.is(r1.point.y, -0)).toBe(false);
            if (patch.origin) {
                expect(Number.isInteger(r1.lengthFromOrigin)).toBe(true);
                const deg = r1.displayAngleDeg!;
                expect(deg).toBeGreaterThanOrEqual(0);
                expect(deg).toBeLessThan(360);
                expect(deg).toBe(normDeg(deg));
            } else {
                expect(r1.lengthFromOrigin).toBeNull();
                expect(r1.displayAngleDeg).toBeNull();
            }
            for (const m of r1.markers) {
                expect(Number.isInteger(m.at.x)).toBe(true);
            }
        }
    });

    it('snaps every node of the HDB plan to itself', () => {
        const doc = buildHdb3Room();
        const index = indexOf(doc);
        for (const node of Object.values(doc.nodes)) {
            const r = snap(index, {
                cursor: pt(node.x + 3, node.y - 2),
                zoom: 0.2,
            });
            expect(r.kind).toBe('endpoint');
            expect(r.point).toEqual(pt(node.x, node.y));
        }
    });
});

interface Contest {
    higher: Exclude<SnapKind, 'none'>;
    lower: SnapKind;
    doc: PlanDocument;
    patch: Partial<SnapInput> & { cursor: Vec2 };
    /** The loser's point is closer to the cursor than the winner's. */
    closer: boolean;
}

const WALL_2000: Array<[number, number, number, number]> = [
    [0, 2000, 4000, 2000],
];

// Every row puts both kinds in contention: switching the higher kind off must
// hand the result to the lower one, which sits closer to the cursor.
const CONTESTS: Contest[] = [
    {
        higher: 'endpoint',
        lower: 'intersection',
        doc: segmentsPlan([
            ...WALL_2000,
            [1500, -1000, 1500, 3000],
            [1560, 2000, 1560, 4000],
        ]).doc,
        patch: { cursor: pt(1510, 2000) },
        closer: true,
    },
    {
        higher: 'intersection',
        lower: 'midpoint',
        doc: segmentsPlan([...WALL_2000, [1950, -1000, 1950, 3000]]).doc,
        patch: { cursor: pt(2010, 2000) },
        closer: true,
    },
    {
        higher: 'midpoint',
        lower: 'perpendicular',
        doc: segmentsPlan(WALL_2000).doc,
        patch: { cursor: pt(2050, 2005), origin: pt(2060, 5000) },
        closer: true,
    },
    {
        higher: 'perpendicular',
        lower: 'guide_intersection',
        doc: withNodes(segmentsPlan(WALL_2000).doc, [[1030, 4500]]),
        patch: { cursor: pt(1035, 2003), origin: pt(1000, 5000) },
        closer: true,
    },
    {
        higher: 'guide_intersection',
        lower: 'on_wall',
        doc: withNodes(segmentsPlan(WALL_2000).doc, [[1030, 4500]]),
        patch: { cursor: pt(1035, 2000) },
        closer: true,
    },
    {
        higher: 'on_wall',
        lower: 'alignment',
        doc: withNodes(segmentsPlan(WALL_2000).doc, [[3000, 2030]]),
        patch: { cursor: pt(1000, 2025) },
        closer: true,
    },
    {
        higher: 'on_wall',
        lower: 'extension',
        doc: segmentsPlan([...WALL_2000, [0, 2040, 500, 2040]]).doc,
        patch: { cursor: pt(1000, 2025) },
        closer: true,
    },
    {
        higher: 'alignment',
        lower: 'angle',
        doc: nodesPlan([[5000, 60]]).doc,
        patch: { cursor: pt(2000, 25), origin: pt(0, 0) },
        closer: true,
    },
    {
        higher: 'extension',
        lower: 'angle',
        doc: segmentsPlan([[4000, 100, 6000, 300]]).doc,
        patch: { cursor: pt(3600, 15), origin: pt(0, 0) },
        closer: true,
    },
    {
        higher: 'angle',
        lower: 'grid',
        doc: emptyPlan(),
        patch: { cursor: pt(3100, 40), origin: pt(0, 0) },
        closer: false,
    },
    {
        higher: 'grid',
        lower: 'none',
        doc: emptyPlan(),
        patch: { cursor: pt(1234, 5678) },
        closer: false,
    },
    {
        higher: 'on_face',
        lower: 'grid',
        doc: segmentsPlan([[0, 0, 4000, 0]]).doc,
        patch: { cursor: pt(1000, 100), includeFaces: true },
        closer: false,
    },
];

function withoutKind(kind: Exclude<SnapKind, 'none'>): SnapSettings {
    const settings = defaultSnapSettings('metric');
    settings.kinds[kind] = false;
    return settings;
}

describe('snapPoint priority chain (04 5.4)', () => {
    it.each(CONTESTS)('$higher beats $lower', (c) => {
        const index = indexOf(c.doc);
        const on = snap(index, c.patch);
        expect(on.kind).toBe(c.higher);
        const off = snap(index, {
            ...c.patch,
            settings: withoutKind(c.higher),
        });
        expect(off.kind).toBe(c.lower);
        if (c.closer) {
            expect(dist(off.point, c.patch.cursor)).toBeLessThan(
                dist(on.point, c.patch.cursor),
            );
        }
    });

    it('covers the chain from endpoint down to grid', () => {
        const chain = CONTESTS.map((c) => `${c.higher}>${c.lower}`);
        expect(chain).toEqual([
            'endpoint>intersection',
            'intersection>midpoint',
            'midpoint>perpendicular',
            'perpendicular>guide_intersection',
            'guide_intersection>on_wall',
            'on_wall>alignment',
            'on_wall>extension',
            'alignment>angle',
            'extension>angle',
            'angle>grid',
            'grid>none',
            'on_face>grid',
        ]);
    });

    it.each(SNAP_KINDS.filter((k) => k !== 'none'))(
        'the %s switch removes that kind',
        (kind) => {
            const c = CONTESTS.find((x) => x.higher === kind);
            expect(c).toBeDefined();
            const index = indexOf(c!.doc);
            expect(snap(index, c!.patch).kind).toBe(kind);
            const off = snap(index, {
                ...c!.patch,
                settings: withoutKind(kind),
            });
            expect(off.kind).not.toBe(kind);
            expect(off.guides.some((g) => g.kind === (kind as string))).toBe(
                false,
            );
            expect(off.markers.some((m) => m.kind === kind)).toBe(false);
        },
    );

    it('prefers the closer of two candidates of the same priority', () => {
        const { doc, ids } = nodesPlan([
            [0, 0],
            [100, 0],
        ]);
        const index = indexOf(doc);
        expect(snap(index, { cursor: pt(70, 10) }).nodeId).toBe(ids[1]);
        expect(snap(index, { cursor: pt(30, 10) }).nodeId).toBe(ids[0]);
    });

    it('picks the closest of several guide_intersections', () => {
        const { doc } = nodesPlan([
            [0, 3000],
            [100, 3000],
            [3000, 0],
            [3000, 60],
        ]);
        const index = indexOf(doc);
        const last = snap(index, { cursor: pt(60, 40) });
        expect(last.kind).toBe('guide_intersection');
        expect(last.point).toEqual(pt(100, 60));
        const first = snap(index, { cursor: pt(20, 10) });
        expect(first.kind).toBe('guide_intersection');
        expect(first.point).toEqual(pt(0, 0));
    });
});

describe('snapPoint guide lines crossing a wall interior (04 5.4, 5.5-5)', () => {
    const slanted = (): PlanDocument =>
        withNodes(segmentsPlan([[0, 0, 5000, 1000]]).doc, [[1500, 3000]]);
    const length = Math.hypot(1500, 300);

    it('crosses an alignment line with the wall as a guide_intersection', () => {
        const { doc, walls } = segmentsPlan([[0, 0, 5000, 1000]]);
        const index = indexOf(withNodes(doc, [[1500, 3000]]));
        const r = snap(index, { cursor: pt(1540, 320) });
        expect(r.kind).toBe('guide_intersection');
        expect(r.point).toEqual(pt(1500, 300));
        expect(r.wallId).toBe(walls[0]);
        expect(r.u).toBeCloseTo(length, 6);
        expect(r.guides).toEqual([
            { kind: 'alignment', a: pt(1500, 3000), b: pt(1500, 300) },
        ]);
        expect(r.markers).toEqual([
            { kind: 'guide_intersection', at: pt(1500, 300) },
        ]);
    });

    it('still finds the crossing through the extension line alone', () => {
        const index = indexOf(slanted());
        const r = snap(index, {
            cursor: pt(1540, 320),
            settings: withoutKind('on_wall'),
        });
        expect(r.kind).toBe('guide_intersection');
        expect(r.point).toEqual(pt(1500, 300));
        expect(r.wallId).toBeNull();
        expect(r.guides).toEqual([
            { kind: 'extension', a: pt(0, 0), b: pt(1500, 300) },
            { kind: 'alignment', a: pt(1500, 3000), b: pt(1500, 300) },
        ]);
    });

    it('still finds the crossing through the wall alone', () => {
        const r = snap(indexOf(slanted()), {
            cursor: pt(1540, 320),
            settings: withoutKind('extension'),
        });
        expect(r.kind).toBe('guide_intersection');
        expect(r.point).toEqual(pt(1500, 300));
    });

    it('does not let a lone interior extension override on_wall', () => {
        const index = indexOf(slanted());
        const r = snap(index, { cursor: pt(3040, 600) });
        expect(r.kind).toBe('on_wall');
        expect(r.guides).toEqual([]);
    });

    it('is switched off with the guide_intersection toggle', () => {
        const r = snap(indexOf(slanted()), {
            cursor: pt(1540, 320),
            settings: withoutKind('guide_intersection'),
        });
        expect(r.kind).toBe('on_wall');
        expect(r.point).toEqual(pt(1542, 308));
    });

    describe.each([
        ['without shift', false],
        ['with shift', true],
    ])('an angle ray meeting the wall %s', (_label, shift) => {
        it('snaps to the crossing as on_wall with the angle guide', () => {
            const { doc, walls } = segmentsPlan([[0, 0, 5000, 1000]]);
            const r = snap(indexOf(doc), {
                cursor: pt(520, 110),
                origin: pt(500, -2000),
                modifiers: { shift, alt: false },
            });
            expect(r.kind).toBe('on_wall');
            expect(r.point).toEqual(pt(500, 100));
            expect(r.wallId).toBe(walls[0]);
            expect(r.u).toBeCloseTo(Math.hypot(500, 100), 6);
            expect(r.guides).toEqual([
                { kind: 'angle', a: pt(500, -2000), b: pt(500, 100) },
            ]);
            expect(r.displayAngleDeg).toBe(270);
        });

        it('meets the extension line as a guide_intersection without on_wall', () => {
            const { doc } = segmentsPlan([[0, 0, 5000, 1000]]);
            const r = snap(indexOf(doc), {
                cursor: pt(520, 110),
                origin: pt(500, -2000),
                modifiers: { shift, alt: false },
                settings: withoutKind('on_wall'),
            });
            expect(r.kind).toBe('guide_intersection');
            expect(r.point).toEqual(pt(500, 100));
            expect(r.guides.map((g) => g.kind).sort()).toEqual([
                'angle',
                'extension',
            ]);
        });
    });
});

describe('snapPoint guide_intersection switch under shift', () => {
    const { doc } = nodesPlan([[3000, 5000]]);
    const index = indexOf(doc);

    it('crosses the ray with an alignment line only while the switch is on', () => {
        const patch = {
            cursor: pt(3020, 2990),
            origin: pt(0, 0),
            modifiers: { shift: true, alt: false },
        };
        expect(snap(index, patch).kind).toBe('guide_intersection');
        const off = snap(index, {
            ...patch,
            settings: withoutKind('guide_intersection'),
        });
        expect(off.kind).toBe('angle');
        expect(off.point).toEqual(pt(3005, 3005));
        expect(off.guides.map((g) => g.kind)).toEqual(['angle']);
        expect(off.markers).toEqual([]);
    });

    it('is honoured without shift as well', () => {
        const patch = { cursor: pt(3020, 3010), origin: pt(0, 0) };
        expect(snap(index, patch).kind).toBe('guide_intersection');
        const off = snap(index, {
            ...patch,
            settings: withoutKind('guide_intersection'),
        });
        expect(off.kind).toBe('alignment');
        expect(off.point).toEqual(pt(3000, 3010));
    });
});

describe('snapPoint exclude', () => {
    it('drops an excluded node as an alignment source', () => {
        const { doc, ids } = nodesPlan([[0, 3000]]);
        const index = indexOf(doc);
        expect(snap(index, { cursor: pt(30, 2000) }).kind).toBe('alignment');
        const r = snap(index, {
            cursor: pt(30, 2000),
            exclude: new Set([ids[0]!]),
        });
        expect(r.kind).not.toBe('alignment');
        expect(r.guides).toEqual([]);
    });

    it('drops an excluded wall as an extension source', () => {
        const { doc, walls } = segmentsPlan([[0, 0, 4000, 0]]);
        const index = indexOf(doc);
        const settings = defaultSnapSettings('metric');
        settings.kinds.alignment = false;
        const cursor = pt(4400, 30);
        expect(snap(index, { cursor, settings }).kind).toBe('extension');
        const r = snap(index, {
            cursor,
            settings,
            exclude: new Set([walls[0]!]),
        });
        expect(r.kind).not.toBe('extension');
        expect(r.guides).toEqual([]);
    });

    it('drops an excluded anchor node as an extension source', () => {
        const { doc, nodeAt } = segmentsPlan([[0, 0, 4000, 0]]);
        const index = indexOf(doc);
        const settings = defaultSnapSettings('metric');
        settings.kinds.alignment = false;
        const r = snap(index, {
            cursor: pt(4400, 30),
            settings,
            exclude: new Set([nodeAt(4000, 0)]),
        });
        expect(r.kind).not.toBe('extension');
    });

    it('treats the walls of an excluded node as excluded (dragging a node)', () => {
        const { doc, nodeAt, walls } = segmentsPlan([
            [0, 0, 4000, 0],
            [4000, 0, 4000, 3000],
            [0, 2000, 2000, 2000],
        ]);
        const index = indexOf(doc);
        const exclude = new Set([nodeAt(4000, 0)]);
        const ownMid = snap(index, { cursor: pt(2000, 20), exclude });
        expect(ownMid.kind).not.toBe('midpoint');
        expect(ownMid.kind).not.toBe('on_wall');
        expect(ownMid.wallId).toBeNull();
        const otherOwn = snap(index, { cursor: pt(4020, 1500), exclude });
        expect(otherOwn.wallId).toBeNull();
        expect(otherOwn.kind).not.toBe('midpoint');
        // untouched geometry still snaps, including the far node of a dragged wall
        const free = snap(index, { cursor: pt(1000, 2020), exclude });
        expect(free.kind).toBe('midpoint');
        expect(free.wallId).toBe(walls[2]);
        const far = snap(index, { cursor: pt(-20, 0), exclude });
        expect(far.kind).toBe('endpoint');
        expect(far.nodeId).toBe(nodeAt(0, 0));
        // the caller's set is not modified
        expect([...exclude]).toEqual([nodeAt(4000, 0)]);
    });
});

describe('snapPoint reach and tolerance guards', () => {
    const { doc } = segmentsPlan([[0, 0, 4000, 0]]);
    const index = indexOf(doc);

    it('reaches 600 mm past a wall end at zoom 1', () => {
        expect(snap(index, { cursor: pt(4590, 5), zoom: 1 }).kind).toBe(
            'extension',
        );
        expect(snap(index, { cursor: pt(4610, 5), zoom: 1 }).kind).not.toBe(
            'extension',
        );
    });

    it('reaches 60 px (1200 mm) past a wall end at zoom 0.05', () => {
        expect(snap(index, { cursor: pt(5190, 20), zoom: 0.05 }).kind).toBe(
            'extension',
        );
        const far = snap(index, { cursor: pt(5210, 20), zoom: 0.05 });
        expect(far.kind).not.toBe('extension');
        expect(far.kind).toBe('alignment');
    });

    it('does not report a wall crossing that is outside the tolerance', () => {
        // two shallow walls cross at (5000, 50); both bounding boxes reach the cursor
        const crossing = segmentsPlan([
            [0, 0, 10000, 100],
            [0, 100, 10000, 0],
        ]).doc;
        const walls = indexOf(crossing);
        const far = snap(walls, { cursor: pt(6000, 50) });
        expect(far.kind).toBe('on_wall');
        const near = snap(walls, { cursor: pt(5030, 40) });
        expect(near.kind).toBe('intersection');
        expect(near.point).toEqual(pt(5000, 50));
    });
});

describe('snapPoint alignment and angle details', () => {
    it('keeps the node nearest the cursor when several share a line', () => {
        for (const points of [
            [
                [0, 3000],
                [0, 1000],
            ],
            [
                [0, 1000],
                [0, 3000],
            ],
        ] as const) {
            const { doc } = nodesPlan(points);
            const r = snap(indexOf(doc), { cursor: pt(30, 1200) });
            expect(r.kind).toBe('alignment');
            expect(r.point).toEqual(pt(0, 1200));
            expect(r.guides).toEqual([
                { kind: 'alignment', a: pt(0, 1000), b: pt(0, 1200) },
            ]);
        }
    });

    const empty = indexOf(emptyPlan());
    const rad = (deg: number): number => (deg * Math.PI) / 180;

    it('offers the parallel ray in the reverse direction too', () => {
        const dir = pt(Math.cos(rad(20)), Math.sin(rad(20)));
        const r = snap(empty, {
            cursor: pt(-dir.x * 3000 + dir.y * 20, -dir.y * 3000 - dir.x * 20),
            origin: pt(0, 0),
            previousDir: dir,
        });
        expect(r.kind).toBe('angle');
        expect(r.guides.map((g) => g.kind)).toEqual(['parallel']);
        expect(r.displayAngleDeg).toBe(160);
    });

    it('skips a relative ray that coincides with a step ray', () => {
        // 0.3 degrees off the 0 degree step ray: within the angle tolerance
        const dir = pt(Math.cos(rad(0.3)), Math.sin(rad(0.3)));
        const r = snap(empty, {
            cursor: pt(dir.x * 3000, dir.y * 3000),
            origin: pt(0, 0),
            previousDir: dir,
        });
        expect(r.kind).toBe('angle');
        expect(r.guides.map((g) => g.kind)).toEqual(['angle']);
        expect(r.point).toEqual(pt(3000, 0));
    });

    it('keeps a relative ray that is clearly off the step rays', () => {
        const dir = pt(Math.cos(rad(2)), Math.sin(rad(2)));
        const r = snap(empty, {
            cursor: pt(dir.x * 3000, dir.y * 3000),
            origin: pt(0, 0),
            previousDir: dir,
        });
        expect(r.guides.map((g) => g.kind)).toEqual(['parallel']);
    });
});

describe('snapPoint on_face and wall parameters', () => {
    it('sets the centre-line parameter of an on_face result', () => {
        const { doc, walls } = segmentsPlan([[0, 0, 4000, 0]]);
        const r = snap(indexOf(doc), {
            cursor: pt(1000, 100),
            includeFaces: true,
        });
        expect(r.kind).toBe('on_face');
        expect(r.wallId).toBe(walls[0]);
        expect(r.u).toBe(1000);
    });
});

describe('buildSnapIndex determinism', () => {
    function shuffled(doc: PlanDocument, seed: number): PlanDocument {
        const random = mulberry32(seed);
        const reorder = <T>(record: Record<string, T>): Record<string, T> => {
            const keys = Object.keys(record);
            for (let i = keys.length - 1; i > 0; i -= 1) {
                const j = Math.floor(random() * (i + 1));
                [keys[i], keys[j]] = [keys[j]!, keys[i]!];
            }
            return Object.fromEntries(keys.map((k) => [k, record[k]!]));
        };
        return {
            ...doc,
            nodes: reorder(doc.nodes),
            walls: reorder(doc.walls),
            openings: reorder(doc.openings),
        };
    }

    it('gives the same results from a doc with shuffled entity order', () => {
        const doc = buildHdb3Room();
        const a = indexOf(doc);
        const b = indexOf(shuffled(doc, 5));
        expect(b.nodes!.items).toEqual(a.nodes!.items);
        expect(b.centerlines!.items).toEqual(a.centerlines!.items);
        expect(b.keyPoints!.items).toEqual(a.keyPoints!.items);
        const random = mulberry32(3);
        for (let i = 0; i < 300; i += 1) {
            const patch = {
                cursor: pt(random() * 12000 - 500, random() * 9000 - 500),
                zoom: [0.05, 0.1, 0.4][i % 3]!,
                origin:
                    i % 2 === 0 ? pt(random() * 9000, random() * 7000) : null,
                modifiers: { shift: i % 4 === 0, alt: false },
                includeFaces: i % 5 === 0,
            };
            expect(snap(b, patch)).toEqual(snap(a, patch));
        }
    });
});

describe('snapPoint performance (04 5.5)', () => {
    function measure(doc: PlanDocument, seed: number): number {
        const geom = derivePlanGeometry(doc);
        const index = buildSnapIndex(doc, geom, noFootprints);
        const { min, max } = geom.bbox;
        const random = mulberry32(seed);
        const calls: SnapInput[] = [];
        for (let i = 0; i < 1000; i += 1) {
            calls.push(
                input({
                    cursor: pt(
                        min.x + random() * (max.x - min.x),
                        min.y + random() * (max.y - min.y),
                    ),
                    zoom: [0.05, 0.1, 0.3][i % 3]!,
                    origin:
                        i % 2 === 0
                            ? pt(
                                  min.x + random() * (max.x - min.x),
                                  min.y + random() * (max.y - min.y),
                              )
                            : null,
                    modifiers: { shift: i % 10 === 0, alt: false },
                }),
            );
        }
        for (const c of calls.slice(0, 100)) snapPoint(c, index); // warm up
        const start = performance.now();
        for (const c of calls) snapPoint(c, index);
        return (performance.now() - start) / calls.length;
    }

    it('averages under 0.5 ms per call on the HDB plan and a 22 x 22 grid plan', () => {
        const hdb = measure(buildHdb3Room(), 11);
        const grid = measure(makeGridPlan(22, 22), 12);
        if (process.env.SNAP_PERF_LOG) {
            process.stdout.write(
                `snapPoint avg ms/call: hdb=${hdb.toFixed(4)} grid22=${grid.toFixed(4)}\n`,
            );
        }
        expect(hdb).toBeLessThan(0.5);
        expect(grid).toBeLessThan(0.5);
    });
});
