/**
 * Point snapping (04 §5.1-§5.6, §5.10-§5.11): the spatial index over a derived
 * plan, `snapPoint` and the grid.
 *
 * Plan space is x right, y down (04 §2.1). `snapPoint` runs on every pointer
 * move, so it only touches the index items near the cursor. Results are
 * integer millimetres, never `-0`, and depend on nothing but the inputs: item
 * arrays are sorted by entity id, hits are visited in index order, and ties go
 * to the earlier candidate.
 */
import Flatbush from 'flatbush';
import { EPS, ANGLE_TOL, ANGLE_TOL_DEG, roundMm } from '../geometry/tolerance';
import { distPointLine, intersectSegments } from '../geometry/segment';
import {
    add,
    angleOf,
    cross,
    dist,
    dot,
    len,
    lerp,
    normDeg,
    normalize,
    perpLeft,
    scale,
    sub,
    type Vec2,
} from '../geometry/vec2';
import type { UnitSystem } from '../units/types';
import type { DerivedPlan } from './derive';
import {
    fixtureFootprint,
    placementFootprint,
    type Footprint,
    type FootprintProvider,
} from './footprint';
import type { PlanDocument } from './schema';

export const SNAP_KINDS = [
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
] as const;
export type SnapKind = (typeof SNAP_KINDS)[number];

export interface SnapSettings {
    /** Global toggle (S key); `false` leaves only raw rounding. */
    enabled: boolean;
    kinds: Record<Exclude<SnapKind, 'none'>, boolean>;
    /** Grid snapping only happens while the grid is visible. */
    gridVisible: boolean;
    /** Soft angle snapping step, default 15. */
    angleStepDeg: 15 | 45 | 90;
    /** Selects the grid sequence (§5.6). */
    unitSystem: UnitSystem;
}

/** `shift` = hard 45° lock from the origin; `alt` = disable snapping. */
export interface SnapModifiers {
    shift: boolean;
    alt: boolean;
}

export interface SnapInput {
    /** Model mm (float), already converted from screen. */
    cursor: Vec2;
    /** Screen px per mm. */
    zoom: number;
    pointerType: 'mouse' | 'pen' | 'touch';
    /** Start point of the segment being drawn or measured. */
    origin: Vec2 | null;
    /** Direction of the previous chain segment (relative angle rays). */
    previousDir: Vec2 | null;
    /** Entity ids ignored: the dragged node, its walls, the wall being drawn. */
    exclude: ReadonlySet<string>;
    settings: SnapSettings;
    modifiers: SnapModifiers;
    /**
     * `on_face` candidates exist only for tools that ask for faces
     * (Dimension, Measure; 04 §5.4 prio 6). Default `false`.
     */
    includeFaces?: boolean;
}

/** Infinite guides are clipped to the segment `a`-`b`. */
export interface SnapGuide {
    kind:
        | 'extension'
        | 'alignment'
        | 'angle'
        | 'perpendicular'
        | 'parallel'
        | 'face';
    a: Vec2;
    b: Vec2;
}

export interface SnapMarker {
    kind: Exclude<SnapKind, 'none' | 'on_wall' | 'grid'>;
    at: Vec2;
}

export interface SnapResult {
    /** Integer mm. */
    point: Vec2;
    kind: SnapKind;
    /** Endpoint snaps. */
    nodeId: string | null;
    /** `on_wall`, `midpoint`, `perpendicular`. */
    wallId: string | null;
    /** Centre-line parameter (mm from node a) when `wallId` is set. */
    u: number | null;
    guides: SnapGuide[];
    markers: SnapMarker[];
    /** Integer mm. */
    lengthFromOrigin: number | null;
    /** Counter-clockwise on screen from east, `[0, 360)`, 0.01° (04 §2.1-10). */
    displayAngleDeg: number | null;
}

// ---------------------------------------------------------------------------
// Index (04 §5.2)
// ---------------------------------------------------------------------------

export interface SnapNodeItem {
    id: string;
    at: Vec2;
}

/** A valid wall's centre line with the derived values the snapper needs. */
export interface SnapWallItem {
    wallId: string;
    a: Vec2;
    b: Vec2;
    nodeA: string;
    nodeB: string;
    /** Centre-line length. */
    length: number;
    /** Unit direction a to b. */
    dir: Vec2;
}

export interface SnapFaceItem {
    wallId: string;
    side: 'left' | 'right';
    a: Vec2;
    b: Vec2;
}

export interface SnapFootprintItem {
    id: string;
    source: 'placement' | 'fixture';
    footprint: Footprint;
    elevation: number;
    height: number;
}

export interface SnapKeyPointItem {
    kind: 'wall_mid' | 'jamb';
    at: Vec2;
    wallId: string;
    /** Set for `jamb`. */
    openingId: string | null;
}

/** A Flatbush tree with the items it indexes, aligned by insertion order. */
export interface SnapItemIndex<T> {
    tree: Flatbush;
    items: T[];
}

/** An item class is `null` when it has no items (Flatbush needs at least one). */
export interface SnapIndex {
    nodes: SnapItemIndex<SnapNodeItem> | null;
    centerlines: SnapItemIndex<SnapWallItem> | null;
    faces: SnapItemIndex<SnapFaceItem> | null;
    footprints: SnapItemIndex<SnapFootprintItem> | null;
    keyPoints: SnapItemIndex<SnapKeyPointItem> | null;
    wallById: ReadonlyMap<string, SnapWallItem>;
    /** Incident valid walls of every node, sorted by wall id. */
    wallsAtNode: ReadonlyMap<string, readonly string[]>;
}

type Box = readonly [number, number, number, number];

function buildClass<T>(
    items: T[],
    boxOf: (item: T) => Box,
): SnapItemIndex<T> | null {
    if (items.length === 0) return null;
    const tree = new Flatbush(items.length);
    for (const item of items) {
        const [x0, y0, x1, y1] = boxOf(item);
        tree.add(x0, y0, x1, y1);
    }
    tree.finish();
    return { tree, items };
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Normalises `-0` so equal results compare equal and serialise alike. */
const z = (n: number): number => (n === 0 ? 0 : n);

const segBox = (a: Vec2, b: Vec2): Box => [
    Math.min(a.x, b.x),
    Math.min(a.y, b.y),
    Math.max(a.x, b.x),
    Math.max(a.y, b.y),
];

const ringBox = (corners: readonly Vec2[]): Box => {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const c of corners) {
        x0 = Math.min(x0, c.x);
        y0 = Math.min(y0, c.y);
        x1 = Math.max(x1, c.x);
        y1 = Math.max(y1, c.y);
    }
    return [x0, y0, x1, y1];
};

/**
 * Builds the snap index of `geom` (rebuilt, never updated, whenever the
 * geometry changes). `footprints` resolves the size of furniture designs;
 * placements of unknown designs are not indexed.
 */
export function buildSnapIndex(
    doc: PlanDocument,
    geom: DerivedPlan,
    footprints: FootprintProvider,
): SnapIndex {
    const nodeItems: SnapNodeItem[] = Object.keys(doc.nodes)
        .sort(cmp)
        .map((id) => ({
            id,
            at: { x: doc.nodes[id]!.x, y: doc.nodes[id]!.y },
        }));

    const wallItems: SnapWallItem[] = [];
    const faceItems: SnapFaceItem[] = [];
    const keyItems: SnapKeyPointItem[] = [];
    const wallById = new Map<string, SnapWallItem>();
    for (const id of Object.keys(geom.walls).sort(cmp)) {
        const derived = geom.walls[id]!;
        const wall = doc.walls[id];
        if (!wall) continue;
        const [a, b] = derived.centerline;
        const item: SnapWallItem = {
            wallId: id,
            a,
            b,
            nodeA: wall.a,
            nodeB: wall.b,
            length: derived.length,
            dir: derived.dir,
        };
        wallItems.push(item);
        wallById.set(id, item);
        faceItems.push(
            {
                wallId: id,
                side: 'left',
                a: derived.leftFace[0],
                b: derived.leftFace[1],
            },
            {
                wallId: id,
                side: 'right',
                a: derived.rightFace[0],
                b: derived.rightFace[1],
            },
        );
        keyItems.push({
            kind: 'wall_mid',
            at: lerp(a, b, 0.5),
            wallId: id,
            openingId: null,
        });
    }
    for (const id of Object.keys(geom.openings).sort(cmp)) {
        const o = geom.openings[id]!;
        keyItems.push(
            {
                kind: 'jamb',
                at: lerp(o.jambStart.left, o.jambStart.right, 0.5),
                wallId: o.wallId,
                openingId: id,
            },
            {
                kind: 'jamb',
                at: lerp(o.jambEnd.left, o.jambEnd.right, 0.5),
                wallId: o.wallId,
                openingId: id,
            },
        );
    }

    const footprintItems: SnapFootprintItem[] = [];
    for (const p of Object.values(doc.placements)) {
        const size = footprints(p.designId);
        if (size === null) continue;
        footprintItems.push({
            id: p.id,
            source: 'placement',
            footprint: placementFootprint(p, size),
            elevation: p.elevation,
            height: size.height,
        });
    }
    for (const f of Object.values(doc.fixtures)) {
        footprintItems.push({
            id: f.id,
            source: 'fixture',
            footprint: fixtureFootprint(f),
            elevation: f.elevation,
            height: f.height,
        });
    }
    footprintItems.sort((p, q) => cmp(p.id, q.id));

    const wallsAtNode = new Map<string, readonly string[]>();
    for (const id of Object.keys(geom.nodes).sort(cmp)) {
        wallsAtNode.set(id, geom.nodes[id]!.wallIds);
    }

    return {
        nodes: buildClass(nodeItems, (n) => [n.at.x, n.at.y, n.at.x, n.at.y]),
        centerlines: buildClass(wallItems, (w) => segBox(w.a, w.b)),
        faces: buildClass(faceItems, (f) => segBox(f.a, f.b)),
        footprints: buildClass(footprintItems, (f) =>
            ringBox(f.footprint.corners),
        ),
        keyPoints: buildClass(keyItems, (k) => [
            k.at.x,
            k.at.y,
            k.at.x,
            k.at.y,
        ]),
        wallById,
        wallsAtNode,
    };
}

/** Items of `cls` whose box meets the query box, in index (insertion) order. */
function query<T>(
    cls: SnapItemIndex<T> | null,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
): T[] {
    if (cls === null) return [];
    const hits = cls.tree.search(x0, y0, x1, y1).sort((p, q) => p - q);
    return hits.map((i) => cls.items[i]!);
}

// ---------------------------------------------------------------------------
// Settings, grid and rounding (04 §5.3, §5.6)
// ---------------------------------------------------------------------------

export function defaultSnapSettings(system: UnitSystem): SnapSettings {
    return {
        enabled: true,
        kinds: {
            endpoint: true,
            intersection: true,
            midpoint: true,
            perpendicular: true,
            guide_intersection: true,
            on_wall: true,
            on_face: true,
            extension: true,
            alignment: true,
            angle: true,
            grid: true,
        },
        gridVisible: true,
        angleStepDeg: 15,
        unitSystem: system,
    };
}

const RAW_STEPS = [1, 5, 10, 50, 100] as const;
/** Positions finer than this many screen px are meaningless (§5.3). */
const RAW_STEP_MAX_PX = 4;

/** Rounding step in mm used when nothing snaps (§5.3). */
export function rawStepFor(zoom: number): number {
    let step = 1;
    for (const s of RAW_STEPS) {
        if (s * zoom <= RAW_STEP_MAX_PX) step = s;
    }
    return step;
}

interface GridLevel {
    step: number;
    major: number;
}

// Major spacings are literals so they carry no multiplication noise
// (e.g. 25.4 x 12 = 304.8 exactly as printed).
const METRIC_GRID: readonly GridLevel[] = [
    { step: 10, major: 100 },
    { step: 50, major: 250 },
    { step: 100, major: 1000 },
    { step: 500, major: 2500 },
    { step: 1000, major: 10000 },
    { step: 5000, major: 25000 },
    { step: 10000, major: 100000 },
];
const IMPERIAL_GRID: readonly GridLevel[] = [
    { step: 25.4, major: 304.8 },
    { step: 152.4, major: 304.8 },
    { step: 304.8, major: 1524 },
    { step: 1524, major: 7620 },
    { step: 3048, major: 6096 },
    { step: 15240, major: 30480 },
];
/** The grid is drawn no denser than this many screen px per step. */
const GRID_MIN_PX = 16;

/** The smallest grid step that is at least 16 px wide, and its major spacing (mm). */
export function gridStepFor(
    zoom: number,
    system: UnitSystem,
): { step: number; major: number } {
    const sequence = system === 'metric' ? METRIC_GRID : IMPERIAL_GRID;
    const level =
        sequence.find((l) => l.step * zoom >= GRID_MIN_PX) ??
        sequence[sequence.length - 1]!;
    return { step: level.step, major: level.major };
}

// ---------------------------------------------------------------------------
// snapPoint (04 §5.4, §5.5)
// ---------------------------------------------------------------------------

const TOL_PX = { mouse: 8, pen: 8, touch: 16 } as const;
/** Angle snapping needs the cursor at least this far (px) from the origin. */
const ANGLE_MIN_PX = 20;
/** Extension lines reach this far (mm) beyond a wall end, at least. */
const EXTENSION_REACH_MM = 600;
const EXTENSION_REACH_PX = 60;
/** Alignment lines come from nodes within this many px of the cursor. */
const ALIGNMENT_RADIUS_PX = 400;
/** A later candidate must be closer by more than this (mm) to win a tie. */
const TIE_EPS = 1e-6;
const SIN_ANGLE_TOL = Math.sin(ANGLE_TOL);

type PointKind = 'endpoint' | 'intersection' | 'midpoint' | 'perpendicular';
type MarkerKind = SnapMarker['kind'];

/** A guide whose far end is the final snapped point unless `b` is given. */
interface GuideSpec {
    kind: SnapGuide['kind'];
    a: Vec2;
    b: Vec2 | null;
}

/** A snap outcome before rounding. */
interface Resolved {
    prio: number;
    kind: SnapKind;
    at: Vec2;
    dist: number;
    nodeId: string | null;
    wallId: string | null;
    u: number | null;
    guides: GuideSpec[];
    marker: MarkerKind | null;
}

interface LineCand {
    prio: 6 | 7 | 8;
    kind: 'on_wall' | 'on_face' | 'extension' | 'alignment' | 'angle';
    /** Distance from the cursor to the line (to the segment for walls and faces). */
    dist: number;
    /** A point on the line; the anchor of its guide. */
    p: Vec2;
    /** Unit direction. */
    d: Vec2;
    /** Half-line from `p` along `d` (angle rays). */
    ray: boolean;
    /** Segment length from `p` along `d` (walls, faces); `null` for lines and rays. */
    segLength: number | null;
    guide: GuideSpec | null;
    wallId: string | null;
}

interface Ctx {
    input: SnapInput;
    index: SnapIndex;
    /** The cursor, or its projection on the locked ray. */
    c: Vec2;
    tol: number;
    exclude: ReadonlySet<string>;
}

/** Counts as the earlier candidate unless `d` is better by more than the tie slack. */
const better = (d: number, than: number): boolean => d < than - TIE_EPS;

function pickBest(list: Resolved[]): Resolved | null {
    let best: Resolved | null = null;
    for (const r of list) {
        if (best === null || r.prio < best.prio) best = r;
        else if (r.prio === best.prio && better(r.dist, best.dist)) best = r;
    }
    return best;
}

function pointResolved(
    prio: number,
    kind: PointKind,
    at: Vec2,
    c: Vec2,
    extra: Partial<Resolved> = {},
): Resolved {
    return {
        prio,
        kind,
        at,
        dist: dist(at, c),
        nodeId: null,
        wallId: null,
        u: null,
        guides: [],
        marker: kind,
        ...extra,
    };
}

/** Point candidates, priorities 1-4 (§5.4). */
function pointCandidates(ctx: Ctx): Resolved[] {
    const { input, index, c, tol, exclude } = ctx;
    const kinds = input.settings.kinds;
    const out: Resolved[] = [];
    const box: Box = [c.x - tol, c.y - tol, c.x + tol, c.y + tol];

    if (kinds.endpoint) {
        for (const n of query(index.nodes, ...box)) {
            if (exclude.has(n.id) || dist(n.at, c) > tol) continue;
            out.push(pointResolved(1, 'endpoint', n.at, c, { nodeId: n.id }));
        }
    }

    const walls = query(index.centerlines, ...box).filter(
        (w) => !exclude.has(w.wallId),
    );

    if (kinds.intersection) {
        for (let i = 0; i < walls.length; i += 1) {
            for (let j = i + 1; j < walls.length; j += 1) {
                const w1 = walls[i]!;
                const w2 = walls[j]!;
                if (
                    w1.nodeA === w2.nodeA ||
                    w1.nodeA === w2.nodeB ||
                    w1.nodeB === w2.nodeA ||
                    w1.nodeB === w2.nodeB
                ) {
                    continue;
                }
                const hit = intersectSegments(w1, w2);
                if (hit.kind !== 'point' || dist(hit.point, c) > tol) continue;
                out.push(pointResolved(2, 'intersection', hit.point, c));
            }
        }
    }

    if (kinds.midpoint) {
        for (const k of query(index.keyPoints, ...box)) {
            if (k.kind !== 'wall_mid' || exclude.has(k.wallId)) continue;
            if (dist(k.at, c) > tol) continue;
            const wall = index.wallById.get(k.wallId)!;
            out.push(
                pointResolved(3, 'midpoint', k.at, c, {
                    wallId: k.wallId,
                    u: wall.length / 2,
                }),
            );
        }
    }

    const origin = input.origin;
    if (kinds.perpendicular && origin !== null) {
        for (const w of walls) {
            const t = dot(sub(origin, w.a), w.dir);
            if (t < 0 || t > w.length) continue;
            const foot = add(w.a, scale(w.dir, t));
            if (dist(foot, origin) < EPS || dist(foot, c) > tol) continue;
            out.push(
                pointResolved(4, 'perpendicular', foot, c, {
                    wallId: w.wallId,
                    u: t,
                    guides: [{ kind: 'perpendicular', a: origin, b: null }],
                }),
            );
        }
    }
    return out;
}

/** Signed distance of `p` along segment-or-line `(a, d)`, clamped for segments. */
function lineProjection(
    c: Vec2,
    cand: Pick<LineCand, 'p' | 'd' | 'segLength' | 'ray'>,
): number {
    const s = dot(sub(c, cand.p), cand.d);
    if (cand.segLength !== null)
        return Math.min(cand.segLength, Math.max(0, s));
    if (cand.ray) return Math.max(0, s);
    return s;
}

/** Wall and face candidates, priority 6. */
function surfaceCandidates(ctx: Ctx): LineCand[] {
    const { input, index, c, tol, exclude } = ctx;
    const kinds = input.settings.kinds;
    const out: LineCand[] = [];
    const box: Box = [c.x - tol, c.y - tol, c.x + tol, c.y + tol];

    if (kinds.on_wall) {
        for (const w of query(index.centerlines, ...box)) {
            if (exclude.has(w.wallId)) continue;
            const cand: LineCand = {
                prio: 6,
                kind: 'on_wall',
                dist: 0,
                p: w.a,
                d: w.dir,
                ray: false,
                segLength: w.length,
                guide: null,
                wallId: w.wallId,
            };
            cand.dist = dist(
                c,
                add(w.a, scale(w.dir, lineProjection(c, cand))),
            );
            if (cand.dist <= tol) out.push(cand);
        }
    }
    if (kinds.on_face && input.includeFaces === true) {
        for (const f of query(index.faces, ...box)) {
            if (exclude.has(f.wallId)) continue;
            const length = dist(f.a, f.b);
            if (length < 1e-9) continue;
            const cand: LineCand = {
                prio: 6,
                kind: 'on_face',
                dist: 0,
                p: f.a,
                d: scale(sub(f.b, f.a), 1 / length),
                ray: false,
                segLength: length,
                guide: { kind: 'face', a: f.a, b: f.b },
                wallId: f.wallId,
            };
            cand.dist = dist(
                c,
                add(f.a, scale(cand.d, lineProjection(c, cand))),
            );
            if (cand.dist <= tol) out.push(cand);
        }
    }
    return out;
}

/** Wall extension lines (priority 7, §5.4). */
function extensionCandidates(ctx: Ctx): LineCand[] {
    const { input, index, c, tol, exclude } = ctx;
    if (!input.settings.kinds.extension) return [];
    const reach = Math.max(EXTENSION_REACH_MM, EXTENSION_REACH_PX / input.zoom);
    const r = reach + tol;
    const out: LineCand[] = [];
    const seen = new Set<string>();
    for (const n of query(index.nodes, c.x - r, c.y - r, c.x + r, c.y + r)) {
        for (const wallId of index.wallsAtNode.get(n.id) ?? []) {
            if (seen.has(wallId) || exclude.has(wallId)) continue;
            seen.add(wallId);
            const w = index.wallById.get(wallId);
            if (w === undefined) continue;
            const s = dot(sub(c, w.a), w.dir);
            // Only the part beyond an end is an extension; inside, it is the wall itself.
            if (s >= -EPS && s <= w.length + EPS) continue;
            const beyondStart = s < 0;
            const overshoot = beyondStart ? -s : s - w.length;
            const anchorId = beyondStart ? w.nodeA : w.nodeB;
            if (overshoot > reach || exclude.has(anchorId)) continue;
            const off = Math.abs(cross(w.dir, sub(c, w.a)));
            if (off > tol) continue;
            out.push({
                prio: 7,
                kind: 'extension',
                dist: off,
                p: beyondStart ? w.a : w.b,
                d: w.dir,
                ray: false,
                segLength: null,
                guide: {
                    kind: 'extension',
                    a: beyondStart ? w.a : w.b,
                    b: null,
                },
                wallId: null,
            });
        }
    }
    return out;
}

/** Horizontal and vertical lines through nearby nodes (priority 7, §5.4). */
function alignmentCandidates(ctx: Ctx): LineCand[] {
    const { input, index, c, tol, exclude } = ctx;
    if (!input.settings.kinds.alignment) return [];
    const radius = ALIGNMENT_RADIUS_PX / input.zoom;
    const out: LineCand[] = [];
    // Equal lines keep the node closest to the cursor.
    const byLine = new Map<string, { cand: LineCand; node: number }>();
    const addLine = (key: string, node: SnapNodeItem, cand: LineCand): void => {
        const d = dist(node.at, c);
        const known = byLine.get(key);
        if (known === undefined) {
            byLine.set(key, { cand, node: d });
            out.push(cand);
        } else if (better(d, known.node)) {
            const at = out.indexOf(known.cand);
            out[at] = cand;
            byLine.set(key, { cand, node: d });
        }
    };
    const line = (node: SnapNodeItem, vertical: boolean): LineCand => ({
        prio: 7,
        kind: 'alignment',
        dist: vertical ? Math.abs(c.x - node.at.x) : Math.abs(c.y - node.at.y),
        p: node.at,
        d: vertical ? { x: 0, y: 1 } : { x: 1, y: 0 },
        ray: false,
        segLength: null,
        guide: { kind: 'alignment', a: node.at, b: null },
        wallId: null,
    });
    for (const n of query(
        index.nodes,
        c.x - tol,
        c.y - radius,
        c.x + tol,
        c.y + radius,
    )) {
        if (exclude.has(n.id) || Math.abs(c.x - n.at.x) > tol) continue;
        if (dist(n.at, c) > radius) continue;
        addLine(`v${n.at.x}`, n, line(n, true));
    }
    for (const n of query(
        index.nodes,
        c.x - radius,
        c.y - tol,
        c.x + radius,
        c.y + tol,
    )) {
        if (exclude.has(n.id) || Math.abs(c.y - n.at.y) > tol) continue;
        if (dist(n.at, c) > radius) continue;
        addLine(`h${n.at.y}`, n, line(n, false));
    }
    return out;
}

const isStepMultiple = (displayDeg: number, step: number): boolean => {
    const r = normDeg(displayDeg) % step;
    return Math.min(r, step - r) <= ANGLE_TOL_DEG;
};

const cleanDir = (d: Vec2): Vec2 => ({
    x: Math.abs(d.x) < 1e-12 ? 0 : d.x,
    y: Math.abs(d.y) < 1e-12 ? 0 : d.y,
});

/** Rays from the origin (priority 8, §5.4). */
function angleCandidates(ctx: Ctx): LineCand[] {
    const { input, c, tol } = ctx;
    const origin = input.origin;
    if (!input.settings.kinds.angle || origin === null) return [];
    if (dist(c, origin) < ANGLE_MIN_PX / input.zoom) return [];
    const step = input.settings.angleStepDeg;
    const rays: Array<{ d: Vec2; guide: SnapGuide['kind'] }> = [];
    for (let deg = 0; deg < 360; deg += step) {
        const rad = (deg * Math.PI) / 180;
        rays.push({
            d: cleanDir({ x: Math.cos(rad), y: -Math.sin(rad) }),
            guide: 'angle',
        });
    }
    const prev =
        input.previousDir === null ? null : normalize(input.previousDir);
    if (prev !== null && len(prev) > 0) {
        const perp = perpLeft(prev);
        const relative: Array<{ d: Vec2; guide: SnapGuide['kind'] }> = [
            { d: prev, guide: 'parallel' },
            { d: scale(prev, -1), guide: 'parallel' },
            { d: perp, guide: 'perpendicular' },
            { d: scale(perp, -1), guide: 'perpendicular' },
        ];
        for (const r of relative) {
            const display = (-angleOf(r.d) * 180) / Math.PI;
            if (!isStepMultiple(display, step)) rays.push(r);
        }
    }
    const out: LineCand[] = [];
    const rel = sub(c, origin);
    for (const r of rays) {
        if (dot(rel, r.d) < 0) continue;
        const off = Math.abs(cross(r.d, rel));
        if (off > tol) continue;
        out.push({
            prio: 8,
            kind: 'angle',
            dist: off,
            p: origin,
            d: r.d,
            ray: true,
            segLength: null,
            guide: { kind: r.guide, a: origin, b: null },
            wallId: null,
        });
    }
    return out;
}

/** Resolves a single line candidate to the projection of the cursor on it. */
function resolveLine(cand: LineCand, c: Vec2): Resolved {
    const s = lineProjection(c, cand);
    return resolveLineAt(cand, add(cand.p, scale(cand.d, s)), s, c);
}

function resolveLineAt(cand: LineCand, at: Vec2, s: number, c: Vec2): Resolved {
    const onSegment = cand.kind === 'on_wall' || cand.kind === 'on_face';
    return {
        prio: cand.prio,
        kind: cand.kind,
        at,
        dist: dist(at, c),
        nodeId: null,
        wallId: onSegment ? cand.wallId : null,
        u: cand.kind === 'on_wall' ? s : null,
        guides: cand.guide === null ? [] : [cand.guide],
        marker: null,
    };
}

/** Line-line intersection as distances along both lines; `null` when parallel. */
function crossLines(
    p: LineCand,
    q: LineCand,
): { s: number; t: number; at: Vec2 } | null {
    const denom = cross(p.d, q.d);
    if (Math.abs(denom) <= SIN_ANGLE_TOL) return null;
    const diff = sub(q.p, p.p);
    const s = cross(diff, q.d) / denom;
    const t = cross(diff, p.d) / denom;
    return { s, t, at: add(p.p, scale(p.d, s)) };
}

const onLine = (cand: LineCand, s: number): boolean => {
    if (cand.ray) return s >= -EPS;
    if (cand.segLength !== null) return s >= -EPS && s <= cand.segLength + EPS;
    return true;
};

/** Guide-line intersections of priority 7-8 lines near the cursor (§5.5-5). */
function guideIntersections(ctx: Ctx, lines: LineCand[]): Resolved[] {
    const out: Resolved[] = [];
    const guideLines = lines.filter((l) => l.prio >= 7);
    for (let i = 0; i < guideLines.length; i += 1) {
        for (let j = i + 1; j < guideLines.length; j += 1) {
            const p = guideLines[i]!;
            const q = guideLines[j]!;
            const hit = crossLines(p, q);
            if (hit === null || !onLine(p, hit.s) || !onLine(q, hit.t))
                continue;
            const d = dist(hit.at, ctx.c);
            if (d > ctx.tol) continue;
            out.push({
                prio: 5,
                kind: 'guide_intersection',
                at: hit.at,
                dist: d,
                nodeId: null,
                wallId: null,
                u: null,
                guides: [p.guide!, q.guide!],
                marker: 'guide_intersection',
            });
        }
    }
    return out;
}

/** The ray of the shift lock (§5.5-2). */
interface Lock {
    origin: Vec2;
    d: Vec2;
}

const DIAGONAL = Math.SQRT1_2;
const LOCK_DIRECTIONS: readonly Vec2[] = [
    { x: 1, y: 0 },
    { x: DIAGONAL, y: DIAGONAL },
    { x: 0, y: 1 },
    { x: -DIAGONAL, y: DIAGONAL },
    { x: -1, y: 0 },
    { x: -DIAGONAL, y: -DIAGONAL },
    { x: 0, y: -1 },
    { x: DIAGONAL, y: -DIAGONAL },
];

function lockFor(origin: Vec2, cursor: Vec2): { lock: Lock; projected: Vec2 } {
    const rel = sub(cursor, origin);
    const k = len(rel) < 1e-9 ? 0 : Math.round(angleOf(rel) / (Math.PI / 4));
    const d = LOCK_DIRECTIONS[((k % 8) + 8) % 8]!;
    return {
        lock: { origin, d },
        projected: add(origin, scale(d, Math.max(0, dot(rel, d)))),
    };
}

const onLock = (lock: Lock, p: Vec2): boolean =>
    distPointLine(p, lock.origin, add(lock.origin, lock.d)) <= EPS &&
    dot(sub(p, lock.origin), lock.d) >= -EPS;

const projectOnLock = (lock: Lock, p: Vec2): Vec2 =>
    add(
        lock.origin,
        scale(lock.d, Math.max(0, dot(sub(p, lock.origin), lock.d))),
    );

/** Line candidates seen from the locked ray: where the ray meets each of them. */
function lockedCandidates(ctx: Ctx, lock: Lock, lines: LineCand[]): Resolved[] {
    const ray: LineCand = {
        prio: 8,
        kind: 'angle',
        dist: 0,
        p: lock.origin,
        d: lock.d,
        ray: true,
        segLength: null,
        guide: { kind: 'angle', a: lock.origin, b: null },
        wallId: null,
    };
    const out: Resolved[] = [];
    for (const cand of lines) {
        if (cand.kind === 'angle') continue;
        const hit = crossLines(cand, ray);
        if (hit === null || !onLine(cand, hit.s) || hit.t < -EPS) continue;
        const d = dist(hit.at, ctx.c);
        if (d > ctx.tol) continue;
        if (cand.kind === 'on_wall' || cand.kind === 'on_face') {
            out.push(resolveLineAt(cand, hit.at, hit.s, ctx.c));
        } else {
            out.push({
                prio: 5,
                kind: 'guide_intersection',
                at: hit.at,
                dist: d,
                nodeId: null,
                wallId: null,
                u: null,
                guides: [cand.guide!],
                marker: 'guide_intersection',
            });
        }
    }
    return out;
}

function rawPoint(cursor: Vec2, zoom: number): Vec2 {
    const step = rawStepFor(zoom);
    return {
        x: z(roundMm(cursor.x / step) * step),
        y: z(roundMm(cursor.y / step) * step),
    };
}

function gridPoint(cursor: Vec2, zoom: number, system: UnitSystem): Vec2 {
    const { step } = gridStepFor(zoom, system);
    return {
        x: roundMm(cursor.x / step) * step,
        y: roundMm(cursor.y / step) * step,
    };
}

const roundPointClean = (p: Vec2): Vec2 => ({
    x: z(roundMm(p.x)),
    y: z(roundMm(p.y)),
});

/**
 * Length and display angle of `point` seen from `origin`. The angle is taken
 * towards `exactPoint` (the snap before integer rounding) so that a point on
 * a 15 degree ray reads 15 and not 15.01 once rounded far from the origin.
 */
function readout(
    point: Vec2,
    origin: Vec2 | null,
    exactPoint: Vec2 = point,
): { lengthFromOrigin: number | null; displayAngleDeg: number | null } {
    if (origin === null)
        return { lengthFromOrigin: null, displayAngleDeg: null };
    const deg = normDeg((-angleOf(sub(exactPoint, origin)) * 180) / Math.PI);
    return {
        lengthFromOrigin: z(Math.round(len(sub(point, origin)))),
        displayAngleDeg: z(normDeg(Math.round(deg * 100) / 100)),
    };
}

function emptyResult(point: Vec2, origin: Vec2 | null): SnapResult {
    return {
        point,
        kind: 'none',
        nodeId: null,
        wallId: null,
        u: null,
        guides: [],
        markers: [],
        ...readout(point, origin),
    };
}

/**
 * Snaps a cursor position (04 §5.5). The algorithm:
 *
 * 1. disabled or Alt: raw rounding;
 * 2. Shift with an origin: project onto the nearest 45° ray and only accept
 *    candidates on it;
 * 3.-4. point candidates (endpoint, intersection, midpoint, perpendicular);
 * 5. intersections of guide lines (extension, alignment, angle);
 * 6. the best single wall, face or guide line;
 * 7. the grid, else raw rounding;
 * 8.-9. integer rounding and the origin readout.
 */
export function snapPoint(input: SnapInput, index: SnapIndex): SnapResult {
    const { settings, modifiers, origin, cursor, zoom } = input;
    if (!settings.enabled || modifiers.alt) {
        return emptyResult(rawPoint(cursor, zoom), origin);
    }

    const tol = TOL_PX[input.pointerType] / zoom;
    let lock: Lock | null = null;
    let c = cursor;
    if (modifiers.shift && origin !== null) {
        const locked = lockFor(origin, cursor);
        lock = locked.lock;
        c = locked.projected;
    }
    const ctx: Ctx = { input, index, c, tol, exclude: input.exclude };

    let best: Resolved | null = null;

    let points = pointCandidates(ctx);
    if (lock !== null) {
        const l = lock;
        points = points
            .filter((p) => onLock(l, p.at))
            .map((p) => ({ ...p, at: projectOnLock(l, p.at) }));
    }
    best = pickBest(points);

    if (best === null) {
        const lines = [
            ...surfaceCandidates(ctx),
            ...extensionCandidates(ctx),
            ...alignmentCandidates(ctx),
            ...(lock === null ? angleCandidates(ctx) : []),
        ];
        if (lock !== null) {
            best = pickBest(lockedCandidates(ctx, lock, lines));
        } else {
            best = pickBest(
                settings.kinds.guide_intersection
                    ? guideIntersections(ctx, lines)
                    : [],
            );
            if (best === null) {
                best = pickBest(lines.map((l) => resolveLine(l, c)));
            }
        }
    }

    if (
        best === null &&
        lock === null &&
        settings.gridVisible &&
        settings.kinds.grid
    ) {
        best = {
            prio: 9,
            kind: 'grid',
            at: gridPoint(cursor, zoom, settings.unitSystem),
            dist: 0,
            nodeId: null,
            wallId: null,
            u: null,
            guides: [],
            marker: null,
        };
    }

    if (best === null && lock === null) {
        return emptyResult(rawPoint(cursor, zoom), origin);
    }

    const chosen: Resolved = best ?? {
        prio: 8,
        kind: 'angle',
        at: c,
        dist: 0,
        nodeId: null,
        wallId: null,
        u: null,
        guides: [],
        marker: null,
    };
    const guides = [...chosen.guides];
    if (lock !== null && !guides.some((g) => g.kind === 'angle')) {
        guides.unshift({ kind: 'angle', a: lock.origin, b: null });
    }
    const point = roundPointClean(chosen.at);
    return {
        point,
        kind: chosen.kind,
        nodeId: chosen.nodeId,
        wallId: chosen.wallId,
        u: chosen.u,
        guides: guides.map((g) => ({ kind: g.kind, a: g.a, b: g.b ?? point })),
        markers:
            chosen.marker === null ? [] : [{ kind: chosen.marker, at: point }],
        ...readout(point, origin, chosen.at),
    };
}
