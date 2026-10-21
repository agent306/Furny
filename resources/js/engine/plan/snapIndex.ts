/**
 * The snap index (04 §5.2): one Flatbush per item class over a derived plan,
 * rebuilt (never updated) whenever the geometry changes. Item arrays are
 * sorted by entity id so builds, and everything searched in them, are
 * deterministic.
 */
import Flatbush from 'flatbush';
import { lerp, type Vec2 } from '../geometry/vec2';
import type { DerivedPlan } from './derive';
import {
    fixtureFootprint,
    placementFootprint,
    type Footprint,
    type FootprintProvider,
} from './footprint';
import type { PlanDocument } from './schema';
import { cmp, type Box } from './snapShared';

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
export function query<T>(
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
