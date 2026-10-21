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
import { signedArea } from '../geometry/polygon';
import { EPS } from '../geometry/tolerance';
import { rot, type Vec2 } from '../geometry/vec2';
import { cmpId } from '../compare';
import type { DerivedPlan } from './derive';
import { MISSING_SIZE } from './drawing/items';
import type { DrawGroup, DrawItem, PlanDrawing } from './drawing/types';
import {
    fixtureFootprint,
    placementFootprint,
    type FootprintProvider,
} from './footprint';
import type { PlanDocument } from './schema';
import { buildClass, ringBox, segBox, type SnapItemIndex } from './snapIndex';
import { type Box } from './snapShared';

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

export type Shape =
    | { k: 'ring'; pts: Vec2[] }
    | { k: 'poly'; outer: Vec2[]; holes: Vec2[][] }
    | { k: 'seg'; a: Vec2; b: Vec2 }
    | { k: 'point'; p: Vec2 };

export interface Entry {
    id: string;
    kind: HitKind;
    shapes: Shape[];
    box: Box;
    /** `elevation + height` of a placement or fixture. */
    top: number;
    /** Net area of a room. */
    area: number;
    /** Position in the document's record (insertion) order; later = added more recently. */
    seq: number;
    /** Centre line of a wall. */
    centre: readonly [Vec2, Vec2] | null;
}

export type ClassKey =
    | 'opening'
    | 'node'
    | 'dimension'
    | 'label'
    | 'room_label'
    | 'body'
    | 'wall'
    | 'room';

export const CLASS_ORDER: readonly ClassKey[] = [
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
export const TOLERANT: ReadonlySet<ClassKey> = new Set([
    'opening',
    'node',
    'dimension',
    'body',
    'wall',
]);

export interface BackgroundRect {
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
    seq: 0,
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
    extra: Partial<Pick<Entry, 'top' | 'area' | 'seq' | 'centre'>> = {},
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

/** The y of a text box top relative to its anchor, by baseline; unknown values throw. */
function baselineOffset(baseline: string, height: number): number {
    switch (baseline) {
        case 'top':
            return 0;
        case 'middle':
            return -height / 2;
        case 'bottom':
            return -height;
        default:
            throw new Error(
                `buildHitIndex: unknown text baseline ${JSON.stringify(baseline)}`,
            );
    }
}

/** The estimated oriented box of a text item as a CW ring; `null` for empty text. */
function textRing(item: Extract<DrawItem, { t: 'text' }>): Shape | null {
    const chars = [...item.text].length;
    if (chars === 0 || item.sizeMm <= 0) return null;
    const w = chars * TEXT_WIDTH_EM * item.sizeMm;
    const h = item.sizeMm;
    const x0 =
        item.anchor === 'start' ? 0 : item.anchor === 'middle' ? -w / 2 : -w;
    const y0 = baselineOffset(item.baseline, h) + item.dyEm * item.sizeMm;
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
        Object.keys(rec).sort(cmpId);

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
    const roomItems = new Map<string, DrawItem[]>();
    for (const g of groupsOf(drawing, 'TEXT', 'room')) {
        const key = g.entityId ?? '';
        const items = roomItems.get(key);
        if (items) items.push(...g.items);
        else roomItems.set(key, [...g.items]);
    }
    const roomLabels: Entry[] = [];
    const rooms: Entry[] = [];
    for (const room of geom.rooms) {
        const id = room.metaId ?? `face:${room.faceKey}`;
        const items = (roomItems.get(room.metaId ?? '') ?? []).filter(
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

    // Bodies keep the document's record order: for stacked bodies of equal
    // height the later one in that order is the more recently added.
    const bodies: Entry[] = [];
    for (const id of Object.keys(doc.placements)) {
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
                    seq: bodies.length,
                },
            ),
        );
    }
    for (const id of Object.keys(doc.fixtures)) {
        const f = doc.fixtures[id]!;
        bodies.push(
            entry(
                id,
                'fixture',
                [{ k: 'ring', pts: fixtureFootprint(f).corners }],
                {
                    top: f.elevation + f.height,
                    seq: bodies.length,
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
