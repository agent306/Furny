/**
 * Placement conflicts (04 §5.9): non-blocking warnings the editor highlights
 * for furniture and fixtures that sit in walls, collide with each other, block
 * a door swing or stand in front of a glazed opening. The door swing sectors
 * double as the editor's clearance zones (05 §10.6).
 */
import { intersection, intersectionArea } from '../geometry/clip';
import {
    area,
    ensureCW,
    ringBBox,
    signedArea,
    type PolygonWithHoles,
    type Ring,
} from '../geometry/polygon';
import { EPS } from '../geometry/tolerance';
import { add, scale, sub, type Vec2 } from '../geometry/vec2';
import { cmpId } from '../compare';
import type { DerivedOpening, DerivedPlan, DerivedWall } from './derive';
import { FIXTURE_LIBRARY } from './fixtures';
import {
    fixtureFootprint,
    placementFootprint,
    type FootprintProvider,
} from './footprint';
import type { Opening, PlanDocument } from './schema';

export const CONFLICT_KINDS = [
    'overlaps_wall',
    'overlaps_item',
    'blocks_door',
    'blocks_window',
] as const;
export type ConflictKind = (typeof CONFLICT_KINDS)[number];

export interface PlacementConflict {
    kind: ConflictKind;
    /** Placement or fixture id. */
    entityId: string;
    /** Wall, placement, fixture or opening id. */
    otherId: string;
    messageKey: `engine.plan.conflict.${ConflictKind}`;
    params: Record<string, string | number>;
}

/** Footprint intersections up to this area (mm²) are contact or rounding noise. */
const MIN_OVERLAP_AREA = 2500;
/** Two items conflict only when their height ranges overlap by more than this (mm). */
const MIN_VERTICAL_OVERLAP = 10;
/** How far a window's clear zone reaches beyond each wall face (mm). */
const WINDOW_CLEARANCE = 300;
/** A swing sector is a 90° arc approximated by this many segments. */
const SWING_SEGMENTS = 16;

const SWING_TYPES: ReadonlySet<Opening['type']> = new Set([
    'single_swing',
    'double_swing',
    'main_entrance',
    'french_window',
]);
const TWO_LEAF_TYPES: ReadonlySet<Opening['type']> = new Set([
    'double_swing',
    'french_window',
]);

const z = (n: number): number => (n === 0 ? 0 : n);
const clean = (p: Vec2): Vec2 => ({ x: z(p.x), y: z(p.y) });

/** Quarter-circle sector, CW, centre first then the 17 arc points. */
function sector(
    hinge: Vec2,
    closedDir: Vec2,
    openDir: Vec2,
    radius: number,
): Vec2[] {
    const arc: Vec2[] = [];
    for (let i = 0; i <= SWING_SEGMENTS; i += 1) {
        const phi = (i / SWING_SEGMENTS) * (Math.PI / 2);
        const along = scale(closedDir, Math.cos(phi) * radius);
        const across = scale(openDir, Math.sin(phi) * radius);
        arc.push(clean(add(hinge, add(along, across))));
    }
    const ring = [clean(hinge), ...arc];
    // Keep the hinge first; flip the arc when the sweep runs counter-clockwise.
    return signedArea(ring) >= 0 ? ring : [clean(hinge), ...arc.reverse()];
}

/**
 * One leaf of a door: where it is hinged and which way it lies closed and
 * open. The swing sectors here and the leaf and arc symbols of the plan
 * drawing (`drawing/openings.ts`) are both built from these frames, so the
 * symbol always matches the clearance zone.
 */
export interface DoorLeafFrame {
    /** Hinge point on the swing face. */
    hinge: Vec2;
    /** Unit vector along the wall from the hinge towards the leaf's other end. */
    closedDir: Vec2;
    /** Unit vector the open leaf points along (`swingSign * normal`). */
    openDir: Vec2;
    /** Leaf length (the clear width, or half of it for two-leaf doors). */
    radius: number;
}

/**
 * Leaf frames of one door: one for a single-leaf door (hinged at
 * `o.hinge`), two for `double_swing` and `french_window` (hinged at both
 * jambs). Valid for any opening type; the caller decides which types swing.
 */
export function doorLeafFrames(
    o: Opening,
    d: DerivedOpening,
    wall: DerivedWall,
): DoorLeafFrame[] {
    const width = d.u1 - d.u0;
    const openDir = scale(wall.normal, d.swingSign);
    const faceOf = (jamb: { left: Vec2; right: Vec2 }): Vec2 =>
        d.swingSign === 1 ? jamb.left : jamb.right;
    const fromStart = faceOf(d.jambStart);
    const fromEnd = faceOf(d.jambEnd);
    if (TWO_LEAF_TYPES.has(o.type)) {
        const half = width / 2;
        return [
            { hinge: fromStart, closedDir: wall.dir, openDir, radius: half },
            {
                hinge: fromEnd,
                closedDir: scale(wall.dir, -1),
                openDir,
                radius: half,
            },
        ];
    }
    return o.hinge === 'start'
        ? [{ hinge: fromStart, closedDir: wall.dir, openDir, radius: width }]
        : [
              {
                  hinge: fromEnd,
                  closedDir: scale(wall.dir, -1),
                  openDir,
                  radius: width,
              },
          ];
}

/** Swing sectors of one door (one polygon per leaf). */
function leafSectors(
    o: Opening,
    d: DerivedOpening,
    wall: DerivedWall,
): Vec2[][] {
    return doorLeafFrames(o, d, wall).map((f) =>
        sector(f.hinge, f.closedDir, f.openDir, f.radius),
    );
}

/**
 * Swing sectors of every hinged door (`single_swing`, `main_entrance`,
 * `double_swing`, `french_window`), sorted by opening id; a two-leaf opening
 * yields one polygon per leaf. Each polygon is CW with 18 points: the hinge
 * on the swing face followed by 17 arc points.
 */
export function doorSwingSectors(
    doc: PlanDocument,
    geom: DerivedPlan,
): Array<{ openingId: string; polygon: Vec2[] }> {
    const out: Array<{ openingId: string; polygon: Vec2[] }> = [];
    for (const id of Object.keys(doc.openings).sort(cmpId)) {
        const o = doc.openings[id]!;
        if (!SWING_TYPES.has(o.type)) continue;
        const derived = geom.openings[id];
        const wall = geom.walls[o.wallId];
        if (!derived || !wall || derived.u1 - derived.u0 <= EPS) continue;
        for (const polygon of leafSectors(o, derived, wall)) {
            out.push({ openingId: id, polygon });
        }
    }
    return out;
}

interface BBox {
    min: Vec2;
    max: Vec2;
}

const bboxOverlap = (a: BBox, b: BBox): boolean =>
    a.min.x < b.max.x &&
    b.min.x < a.max.x &&
    a.min.y < b.max.y &&
    b.min.y < a.max.y;

/** A placement or fixture footprint with its vertical interval. */
interface Item {
    id: string;
    poly: PolygonWithHoles[];
    bbox: BBox;
    bottom: number;
    top: number;
}

function makeItem(
    id: string,
    corners: Ring,
    elevation: number,
    height: number,
): Item {
    return {
        id,
        poly: [{ outer: corners, holes: [] }],
        bbox: ringBBox(corners),
        bottom: elevation,
        top: elevation + height,
    };
}

/** Footprints of all placements (known designs) and conflict-capable fixtures, by id. */
function collectItems(
    doc: PlanDocument,
    footprints: FootprintProvider,
): Item[] {
    const items: Item[] = [];
    for (const p of Object.values(doc.placements)) {
        const size = footprints(p.designId);
        if (size === null) continue;
        items.push(
            makeItem(
                p.id,
                placementFootprint(p, size).corners,
                p.elevation,
                size.height,
            ),
        );
    }
    for (const f of Object.values(doc.fixtures)) {
        if (FIXTURE_LIBRARY[f.libraryKey].noConflict) continue;
        items.push(
            makeItem(f.id, fixtureFootprint(f).corners, f.elevation, f.height),
        );
    }
    return items.sort((a, b) => cmpId(a.id, b.id));
}

const verticalOverlap = (item: Item, bottom: number, top: number): number =>
    Math.min(item.top, top) - Math.max(item.bottom, bottom);

function conflict(
    kind: ConflictKind,
    entityId: string,
    otherId: string,
    areaMm2: number,
): PlacementConflict {
    return {
        kind,
        entityId,
        otherId,
        messageKey: `engine.plan.conflict.${kind}`,
        params: { areaMm2: Math.round(areaMm2) },
    };
}

/** Rectangle of a window's cut, reaching `WINDOW_CLEARANCE` beyond each face. */
function windowZone(d: DerivedOpening, wall: DerivedWall): Ring {
    const A = wall.centerline[0];
    const reach = scale(wall.normal, wall.thickness / 2 + WINDOW_CLEARANCE);
    const p0 = add(A, scale(wall.dir, d.u0));
    const p1 = add(A, scale(wall.dir, d.u1));
    return ensureCW([
        add(p0, reach),
        add(p1, reach),
        sub(p1, reach),
        sub(p0, reach),
    ]);
}

/** A wall as the conflict check sees it: full outline plus its openings' cuts. */
interface SolidWall {
    wall: DerivedWall;
    bbox: BBox;
    outline: PolygonWithHoles[];
    openings: Array<{ cut: PolygonWithHoles[]; sill: number; head: number }>;
}

function solidWalls(doc: PlanDocument, geom: DerivedPlan): SolidWall[] {
    return Object.keys(geom.walls)
        .sort(cmpId)
        .map((id) => {
            const wall = geom.walls[id]!;
            const openings = wall.openings.flatMap(({ id: openingId }) => {
                const o = doc.openings[openingId];
                const d = geom.openings[openingId];
                if (!o || !d) return [];
                return [
                    {
                        cut: [{ outer: d.cut, holes: [] }],
                        sill: o.sillHeight,
                        head: o.sillHeight + o.height,
                    },
                ];
            });
            return {
                wall,
                bbox: ringBBox(wall.outline),
                outline: [{ outer: wall.outline, holes: [] }],
                openings,
            };
        });
}

/**
 * Area (mm²) of `item` that stands in solid wall. An opening exempts its
 * span of the wall only where the item's height range lies within the
 * opening's, so a cabinet under a window sill still counts as in the wall.
 */
function solidOverlapArea(item: Item, sw: SolidWall): number {
    const inWall = intersection(item.poly, sw.outline);
    let total = 0;
    for (const p of inWall) total += area(p);
    if (total <= MIN_OVERLAP_AREA) return total;
    for (const o of sw.openings) {
        if (item.bottom < o.sill || item.top > o.head) continue;
        total -= intersectionArea(inWall, o.cut);
    }
    return total;
}

function wallConflicts(
    items: Item[],
    doc: PlanDocument,
    geom: DerivedPlan,
    out: PlacementConflict[],
): void {
    const walls = solidWalls(doc, geom);
    for (const item of items) {
        for (const sw of walls) {
            if (!bboxOverlap(item.bbox, sw.bbox)) continue;
            // A half wall is cleared by an item raised to its top.
            if (sw.wall.kind === 'half' && item.bottom >= sw.wall.height) {
                continue;
            }
            const a = solidOverlapArea(item, sw);
            if (a > MIN_OVERLAP_AREA) {
                out.push(conflict('overlaps_wall', item.id, sw.wall.id, a));
            }
        }
    }
}

/** Sort-and-sweep on `bbox.min.x`; the smaller id is reported as `entityId`. */
function itemConflicts(items: Item[], out: PlacementConflict[]): void {
    const byX = [...items].sort(
        (a, b) => a.bbox.min.x - b.bbox.min.x || cmpId(a.id, b.id),
    );
    for (let i = 0; i < byX.length; i += 1) {
        const a = byX[i]!;
        for (let j = i + 1; j < byX.length; j += 1) {
            const b = byX[j]!;
            if (b.bbox.min.x >= a.bbox.max.x) break;
            if (!bboxOverlap(a.bbox, b.bbox)) continue;
            if (verticalOverlap(a, b.bottom, b.top) <= MIN_VERTICAL_OVERLAP) {
                continue;
            }
            const overlap = intersectionArea(a.poly, b.poly);
            if (overlap > MIN_OVERLAP_AREA) {
                const [first, second] = cmpId(a.id, b.id) < 0 ? [a, b] : [b, a];
                out.push(
                    conflict('overlaps_item', first.id, second.id, overlap),
                );
            }
        }
    }
}

function doorConflicts(
    items: Item[],
    doc: PlanDocument,
    geom: DerivedPlan,
    out: PlacementConflict[],
): void {
    const zones = doorSwingSectors(doc, geom).map((s) => ({
        openingId: s.openingId,
        height: doc.openings[s.openingId]!.height,
        poly: [{ outer: s.polygon, holes: [] }],
        bbox: ringBBox(s.polygon),
    }));
    for (const item of items) {
        const worst = new Map<string, number>();
        for (const zone of zones) {
            if (item.bottom >= zone.height) continue;
            if (!bboxOverlap(item.bbox, zone.bbox)) continue;
            const a = intersectionArea(item.poly, zone.poly);
            if (a > MIN_OVERLAP_AREA) {
                worst.set(
                    zone.openingId,
                    Math.max(worst.get(zone.openingId) ?? 0, a),
                );
            }
        }
        for (const [openingId, a] of worst) {
            out.push(conflict('blocks_door', item.id, openingId, a));
        }
    }
}

function windowConflicts(
    items: Item[],
    doc: PlanDocument,
    geom: DerivedPlan,
    out: PlacementConflict[],
): void {
    const zones: Array<{
        openingId: string;
        sill: number;
        head: number;
        poly: PolygonWithHoles[];
        bbox: BBox;
    }> = [];
    for (const id of Object.keys(doc.openings).sort(cmpId)) {
        const o = doc.openings[id]!;
        if (o.kind !== 'window') continue;
        const derived = geom.openings[id];
        const wall = geom.walls[o.wallId];
        if (!derived || !wall || derived.u1 - derived.u0 <= EPS) continue;
        const ring = windowZone(derived, wall);
        zones.push({
            openingId: id,
            sill: o.sillHeight,
            head: o.sillHeight + o.height,
            poly: [{ outer: ring, holes: [] }],
            bbox: ringBBox(ring),
        });
    }
    for (const item of items) {
        for (const zone of zones) {
            if (!bboxOverlap(item.bbox, zone.bbox)) continue;
            if (verticalOverlap(item, zone.sill, zone.head) <= 0) continue;
            const a = intersectionArea(item.poly, zone.poly);
            if (a > MIN_OVERLAP_AREA) {
                out.push(conflict('blocks_window', item.id, zone.openingId, a));
            }
        }
    }
}

/**
 * Non-blocking placement warnings (04 §5.9), sorted by
 * `(kind, entityId, otherId)`. Placements whose design is unknown to
 * `footprints` are skipped, and fixtures flagged `noConflict` (rug, sink, hob)
 * neither raise nor receive conflicts. An item pair is reported once, with the
 * smaller id as `entityId`.
 */
export function computePlacementConflicts(
    doc: PlanDocument,
    geom: DerivedPlan,
    footprints: FootprintProvider,
): PlacementConflict[] {
    const items = collectItems(doc, footprints);
    const out: PlacementConflict[] = [];
    wallConflicts(items, doc, geom, out);
    itemConflicts(items, out);
    doorConflicts(items, doc, geom, out);
    windowConflicts(items, doc, geom, out);
    return out.sort(
        (a, b) =>
            cmpId(a.kind, b.kind) ||
            cmpId(a.entityId, b.entityId) ||
            cmpId(a.otherId, b.otherId),
    );
}
