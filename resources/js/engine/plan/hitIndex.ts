/**
 * The hit index (04 §5.12): pointer hit-testing and rectangle selection over
 * a derived plan and its drawing. One Flatbush per hit class (the snap index
 * patterns, 04 §5.2), rebuilt whenever the geometry or the drawing changes.
 *
 * Hit classes in priority order: opening, node, dimension, text label, room
 * label, placement/fixture, wall, room, background. `hitTest` returns the hits
 * of every class, best first, so the first element is the one the editor acts
 * on and the rest feed Alt+click cycling. Within a class hits sort by their
 * own rule (below), then by id, so equal inputs give equal output.
 *
 * Text boxes are estimated like the room label fit rule (05 §4.6): width
 * `chars x 0.56 x size`, height `size`, at the size the drawing was built with.
 * Auto dimensions are not hit targets (their id is the wall id); the editor
 * handles inline length editing from the drawing items itself.
 */
import {
    distToRing,
    pointInPolygon,
    pointInRing,
    signedArea,
} from '../geometry/polygon';
import { closestPointOnSeg } from '../geometry/segment';
import { EPS } from '../geometry/tolerance';
import { dist, rot, type Vec2 } from '../geometry/vec2';
import type { DerivedPlan } from './derive';
import { MISSING_SIZE } from './drawing/items';
import type { DrawGroup, DrawItem, PlanDrawing } from './drawing/types';
import {
    fixtureFootprint,
    placementFootprint,
    type FootprintProvider,
} from './footprint';
import type { PlanDocument } from './schema';
import {
    buildClass,
    query,
    ringBox,
    segBox,
    type SnapItemIndex,
} from './snapIndex';
import {
    cmp,
    snapTolerance,
    z,
    type Box,
    type SnapPointerType,
} from './snapShared';

export type HitKind =
    | 'handle'
    | 'opening'
    | 'node'
    | 'dimension'
    | 'label'
    | 'room_label'
    | 'placement'
    | 'fixture'
    | 'wall'
    | 'room'
    | 'background';

export interface Hit {
    kind: HitKind;
    /**
     * Entity id; a room without a RoomMeta is `face:{faceKey}` and the
     * background is `'background'` (05 §3.2).
     */
    id: string;
    /** Screen px from the pointer to the entity's shape; 0 when the point is inside. */
    distancePx: number;
}

/**
 * Hit kinds the caller has hidden: `false` excludes a kind, a missing key
 * includes it. The background is the exception: it is hit only when the
 * mask sets `background: true` (the Background tool is active). `handle` is
 * tested by the editor, never here.
 */
export type HitLayerMask = Readonly<Partial<Record<HitKind, boolean>>>;

/** Width of a text glyph row as a share of its size (05 §4.6). */
const TEXT_WIDTH_EM = 0.56;
/** The label of a room sits within this distance of its label point (drawing rounds to 0.01). */
const LABEL_MATCH = 0.05;

type Shape =
    | { k: 'ring'; pts: Vec2[] }
    | { k: 'poly'; outer: Vec2[]; holes: Vec2[][] }
    | { k: 'seg'; a: Vec2; b: Vec2 }
    | { k: 'point'; p: Vec2 };

interface Entry {
    id: string;
    kind: HitKind;
    shapes: Shape[];
    box: Box;
    /** `elevation + height` of a placement or fixture. */
    top: number;
    /** Net area of a room. */
    area: number;
    /** Centre line of a wall. */
    centre: readonly [Vec2, Vec2] | null;
}

type ClassKey =
    | 'opening'
    | 'node'
    | 'dimension'
    | 'label'
    | 'room_label'
    | 'body'
    | 'wall'
    | 'room';

const CLASS_ORDER: readonly ClassKey[] = [
    'opening',
    'node',
    'dimension',
    'label',
    'room_label',
    'body',
    'wall',
    'room',
];

/** Classes hit within the pointer tolerance; the others only inside their shape. */
const TOLERANT: ReadonlySet<ClassKey> = new Set([
    'opening',
    'node',
    'dimension',
    'body',
    'wall',
]);

interface BackgroundRect {
    center: Vec2;
    width: number;
    height: number;
    rotationRad: number;
}

export interface HitIndex {
    readonly classes: Readonly<Record<ClassKey, SnapItemIndex<Entry> | null>>;
    /** `null` when there is no visible, unlocked background. */
    readonly background: BackgroundRect | null;
}

const none: Entry = {
    id: '',
    kind: 'handle',
    shapes: [],
    box: [0, 0, 0, 0],
    top: 0,
    area: 0,
    centre: null,
};

function shapeBox(s: Shape): Box {
    switch (s.k) {
        case 'ring':
            return ringBox(s.pts);
        case 'poly':
            return ringBox(s.outer);
        case 'seg':
            return segBox(s.a, s.b);
        case 'point':
            return [s.p.x, s.p.y, s.p.x, s.p.y];
    }
}

function entry(
    id: string,
    kind: HitKind,
    shapes: Shape[],
    extra: Partial<Pick<Entry, 'top' | 'area' | 'centre'>> = {},
): Entry {
    let box: [number, number, number, number] = [
        Infinity,
        Infinity,
        -Infinity,
        -Infinity,
    ];
    for (const s of shapes) {
        const b = shapeBox(s);
        box = [
            Math.min(box[0], b[0]),
            Math.min(box[1], b[1]),
            Math.max(box[2], b[2]),
            Math.max(box[3], b[3]),
        ];
    }
    return { ...none, id, kind, shapes, box, ...extra };
}

/** The estimated oriented box of a text item as a CW ring; `null` for empty text. */
function textRing(item: Extract<DrawItem, { t: 'text' }>): Shape | null {
    const chars = [...item.text].length;
    if (chars === 0 || item.sizeMm <= 0) return null;
    const w = chars * TEXT_WIDTH_EM * item.sizeMm;
    const h = item.sizeMm;
    const x0 =
        item.anchor === 'start' ? 0 : item.anchor === 'middle' ? -w / 2 : -w;
    const y0 =
        (item.baseline === 'top'
            ? 0
            : item.baseline === 'middle'
              ? -h / 2
              : -h) +
        item.dyEm * item.sizeMm;
    const rad = (item.rotationDeg * Math.PI) / 180;
    const corner = (x: number, y: number): Vec2 => {
        const r = rot({ x, y }, rad);
        return { x: item.at.x + r.x, y: item.at.y + r.y };
    };
    return {
        k: 'ring',
        pts: [
            corner(x0, y0),
            corner(x0 + w, y0),
            corner(x0 + w, y0 + h),
            corner(x0, y0 + h),
        ],
    };
}

const textShapes = (items: readonly DrawItem[]): Shape[] =>
    items.flatMap((i) => {
        const s = i.t === 'text' ? textRing(i) : null;
        return s === null ? [] : [s];
    });

function groupsOf(
    drawing: PlanDrawing,
    layer: 'DIMS' | 'TEXT',
    kind: DrawGroup['entityKind'],
): DrawGroup[] {
    return drawing.layers[layer].filter((g) => g.entityKind === kind);
}

/**
 * Builds the hit index of `doc`. `footprints` resolves the size of furniture
 * designs; a placement of an unknown design is hit as the square the drawing
 * shows in its place.
 */
export function buildHitIndex(
    doc: PlanDocument,
    geom: DerivedPlan,
    drawing: PlanDrawing,
    footprints: FootprintProvider,
): HitIndex {
    const sorted = (rec: Record<string, unknown>): string[] =>
        Object.keys(rec).sort(cmp);

    const openings: Entry[] = [];
    for (const id of sorted(geom.openings)) {
        const o = geom.openings[id]!;
        // A zero-width opening has no cut to hit (04 §3.6-1).
        if (o.u1 - o.u0 <= EPS || signedArea(o.cut) <= 0) continue;
        openings.push(entry(id, 'opening', [{ k: 'ring', pts: o.cut }]));
    }

    const nodes = sorted(doc.nodes).map((id) =>
        entry(id, 'node', [
            { k: 'point', p: { x: doc.nodes[id]!.x, y: doc.nodes[id]!.y } },
        ]),
    );

    const dimensions: Entry[] = [];
    for (const g of groupsOf(drawing, 'DIMS', 'dimension')) {
        if (g.entityId === null) continue;
        const shapes: Shape[] = g.items.flatMap((i): Shape[] =>
            i.t === 'line' && i.style === 'dim_line'
                ? [{ k: 'seg', a: i.a, b: i.b }]
                : [],
        );
        shapes.push(...textShapes(g.items));
        if (shapes.length > 0)
            dimensions.push(entry(g.entityId, 'dimension', shapes));
    }

    const labels: Entry[] = [];
    for (const g of groupsOf(drawing, 'TEXT', 'label')) {
        const shapes = textShapes(g.items);
        if (g.entityId !== null && shapes.length > 0) {
            labels.push(entry(g.entityId, 'label', shapes));
        }
    }

    // Room labels: the text items of the room's drawing group at its label point.
    const roomGroups = new Map<string, DrawGroup[]>();
    for (const g of groupsOf(drawing, 'TEXT', 'room')) {
        const key = g.entityId ?? '';
        roomGroups.set(key, [...(roomGroups.get(key) ?? []), g]);
    }
    const roomLabels: Entry[] = [];
    const rooms: Entry[] = [];
    for (const room of geom.rooms) {
        const id = room.metaId ?? `face:${room.faceKey}`;
        const items = (roomGroups.get(room.metaId ?? '') ?? [])
            .flatMap((g) => g.items)
            .filter(
                (i) =>
                    i.t === 'text' &&
                    Math.abs(i.at.x - room.labelPoint.x) <= LABEL_MATCH &&
                    Math.abs(i.at.y - room.labelPoint.y) <= LABEL_MATCH,
            );
        const shapes = textShapes(items);
        if (shapes.length > 0) roomLabels.push(entry(id, 'room_label', shapes));
        rooms.push(
            entry(
                id,
                'room',
                [{ k: 'poly', outer: room.polygon, holes: room.holes }],
                {
                    area: room.areaMm2,
                },
            ),
        );
    }

    const bodies: Entry[] = [];
    for (const id of sorted(doc.placements)) {
        const p = doc.placements[id]!;
        const size = footprints(p.designId) ?? {
            width: MISSING_SIZE,
            depth: MISSING_SIZE,
            height: 0,
        };
        bodies.push(
            entry(
                id,
                'placement',
                [{ k: 'ring', pts: placementFootprint(p, size).corners }],
                {
                    top: p.elevation + size.height,
                },
            ),
        );
    }
    for (const id of sorted(doc.fixtures)) {
        const f = doc.fixtures[id]!;
        bodies.push(
            entry(
                id,
                'fixture',
                [{ k: 'ring', pts: fixtureFootprint(f).corners }],
                {
                    top: f.elevation + f.height,
                },
            ),
        );
    }

    const walls = sorted(geom.walls).map((id) => {
        const w = geom.walls[id]!;
        return entry(id, 'wall', [{ k: 'ring', pts: w.outline }], {
            centre: w.centerline,
        });
    });

    const bg = doc.background;
    const width = bg ? bg.pixelWidth * bg.mmPerPixel : 0;
    const height = bg ? bg.pixelHeight * bg.mmPerPixel : 0;
    const background: BackgroundRect | null =
        bg && bg.visible && !bg.locked && width > 0 && height > 0
            ? {
                  center: {
                      x: bg.position.x + width / 2,
                      y: bg.position.y + height / 2,
                  },
                  width,
                  height,
                  rotationRad: (bg.rotation * Math.PI) / 180,
              }
            : null;

    const cls = (items: Entry[]): SnapItemIndex<Entry> | null =>
        buildClass(items, (e) => e.box);
    return {
        classes: {
            opening: cls(openings),
            node: cls(nodes),
            dimension: cls(dimensions),
            label: cls(labels),
            room_label: cls(roomLabels),
            body: cls(bodies),
            wall: cls(walls),
            room: cls(rooms),
        },
        background,
    };
}

function ringDistance(p: Vec2, pts: Vec2[]): number {
    return pointInRing(p, pts) === 'outside' ? distToRing(p, pts) : 0;
}

/** Distance from `p` to a shape; 0 inside a ring or polygon. */
function shapeDistance(p: Vec2, s: Shape): number {
    switch (s.k) {
        case 'ring':
            return ringDistance(p, s.pts);
        case 'poly':
            return pointInPolygon(p, { outer: s.outer, holes: s.holes }) ===
                'outside'
                ? Math.min(
                      distToRing(p, s.outer),
                      ...s.holes.map((h) => distToRing(p, h)),
                  )
                : 0;
        case 'seg':
            return closestPointOnSeg(p, { a: s.a, b: s.b }).dist;
        case 'point':
            return dist(p, s.p);
    }
}

const entryDistance = (e: Entry, p: Vec2): number =>
    Math.min(...e.shapes.map((s) => shapeDistance(p, s)));

interface Found {
    entry: Entry;
    /** mm */
    d: number;
}

/** Comparison of two hits of one class (best first). */
function compareWithin(cls: ClassKey, a: Found, b: Found, p: Vec2): number {
    const byId = cmp(a.entry.id, b.entry.id);
    switch (cls) {
        case 'body': {
            // Inside hits first; stacked ones by the higher top, then the later id.
            const edge = Number(a.d > 0) - Number(b.d > 0);
            if (edge !== 0) return edge;
            if (a.d !== b.d) return a.d - b.d;
            return b.entry.top - a.entry.top || cmp(b.entry.id, a.entry.id);
        }
        case 'wall': {
            if (a.d !== b.d) return a.d - b.d;
            const ca = a.entry.centre!;
            const cb = b.entry.centre!;
            return (
                closestPointOnSeg(p, { a: ca[0], b: ca[1] }).dist -
                    closestPointOnSeg(p, { a: cb[0], b: cb[1] }).dist || byId
            );
        }
        case 'room':
            return a.entry.area - b.entry.area || byId;
        default:
            return a.d - b.d || byId;
    }
}

function backgroundHit(bg: BackgroundRect, p: Vec2): boolean {
    const local = rot(
        { x: p.x - bg.center.x, y: p.y - bg.center.y },
        -bg.rotationRad,
    );
    return (
        Math.abs(local.x) <= bg.width / 2 && Math.abs(local.y) <= bg.height / 2
    );
}

/**
 * Entities under `p`, best first (04 §5.12 priority). `zoom` is screen px per
 * mm; the tolerance is 8 px (mouse, pen) or 16 px (touch) converted by it.
 */
export function hitTest(
    index: HitIndex,
    p: Vec2,
    zoom: number,
    pointerType: SnapPointerType,
    layers: HitLayerMask,
): Hit[] {
    if (!(zoom > 0))
        throw new RangeError(`hitTest: zoom must be positive (${zoom})`);
    const tol = snapTolerance(pointerType, zoom);
    const hits: Hit[] = [];
    for (const key of CLASS_ORDER) {
        const reach = TOLERANT.has(key) ? tol : 0;
        const found: Found[] = [];
        // The search box is at least the boundary slack of the inside tests.
        const r = Math.max(reach, EPS);
        for (const e of query(
            index.classes[key],
            p.x - r,
            p.y - r,
            p.x + r,
            p.y + r,
        )) {
            if (layers[e.kind] === false) continue;
            const d = entryDistance(e, p);
            if (d <= reach) found.push({ entry: e, d });
        }
        found.sort((a, b) => compareWithin(key, a, b, p));
        for (const { entry: e, d } of found) {
            hits.push({
                kind: e.kind,
                id: e.id,
                distancePx: z(Math.round(d * zoom * 100) / 100),
            });
        }
    }
    if (
        layers.background === true &&
        index.background &&
        backgroundHit(index.background, p)
    ) {
        hits.push({ kind: 'background', id: 'background', distancePx: 0 });
    }
    return hits;
}

/** Liang-Barsky: does the segment meet the closed rectangle? */
function segMeetsRect(a: Vec2, b: Vec2, min: Vec2, max: Vec2): boolean {
    let t0 = 0;
    let t1 = 1;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const clip = (pq: number, qq: number): boolean => {
        if (pq === 0) return qq >= 0;
        const t = qq / pq;
        if (pq < 0) {
            if (t > t1) return false;
            if (t > t0) t0 = t;
        } else {
            if (t < t0) return false;
            if (t < t1) t1 = t;
        }
        return true;
    };
    return (
        clip(-dx, a.x - min.x) &&
        clip(dx, max.x - a.x) &&
        clip(-dy, a.y - min.y) &&
        clip(dy, max.y - a.y)
    );
}

const inRect = (p: Vec2, min: Vec2, max: Vec2): boolean =>
    p.x >= min.x && p.x <= max.x && p.y >= min.y && p.y <= max.y;

function shapeMeetsRect(s: Shape, min: Vec2, max: Vec2): boolean {
    switch (s.k) {
        case 'point':
            return inRect(s.p, min, max);
        case 'seg':
            return segMeetsRect(s.a, s.b, min, max);
        case 'poly':
        case 'ring': {
            const pts = s.k === 'ring' ? s.pts : s.outer;
            if (pts.some((q) => inRect(q, min, max))) return true;
            if (
                pts.some((q, i) =>
                    segMeetsRect(q, pts[(i + 1) % pts.length]!, min, max),
                )
            ) {
                return true;
            }
            // The rectangle may lie wholly inside the shape.
            return pointInRing(min, pts) !== 'outside';
        }
    }
}

const boxInside = (b: Box, min: Vec2, max: Vec2): boolean =>
    b[0] >= min.x && b[1] >= min.y && b[2] <= max.x && b[3] <= max.y;

/**
 * Ids selected by a marquee rectangle (corners in any order). `window`: the
 * entities whose bounding box lies fully inside, rooms included. `crossing`:
 * every entity whose geometry meets the rectangle (walls by their outline,
 * openings by their cut), rooms excluded. Room labels are not selectable.
 * The result is sorted and unique.
 */
export function hitTestRect(
    index: HitIndex,
    min: Vec2,
    max: Vec2,
    mode: 'window' | 'crossing',
): string[] {
    const lo = { x: Math.min(min.x, max.x), y: Math.min(min.y, max.y) };
    const hi = { x: Math.max(min.x, max.x), y: Math.max(min.y, max.y) };
    const ids = new Set<string>();
    for (const key of CLASS_ORDER) {
        if (key === 'room_label') continue;
        if (key === 'room' && mode === 'crossing') continue;
        for (const e of query(index.classes[key], lo.x, lo.y, hi.x, hi.y)) {
            const picked =
                mode === 'window'
                    ? boxInside(e.box, lo, hi)
                    : e.shapes.some((s) => shapeMeetsRect(s, lo, hi));
            if (picked) ids.add(e.id);
        }
    }
    return [...ids].sort(cmp);
}
