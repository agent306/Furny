/**
 * `buildPlanDrawing` (04 §8.1): runs the per-entity draw functions over a
 * document and its derived geometry and collects the groups by layer.
 *
 * The result is deterministic: entities are visited in id order, the groups
 * of each layer are stable-sorted by entity id (the groups without an id,
 * such as the wall outline, come last), and groups without items are
 * dropped. Text items go to the TEXT layer, except dimension text, which
 * stays with its dimension on DIMS.
 */
import { ringBBox } from '../../geometry/polygon';
import type { Vec2 } from '../../geometry/vec2';
import { cmpId } from '../../compare';
import type { DerivedPlan } from '../derive';
import type { PlanDocument } from '../schema';
import { drawDimension, autoDimensions } from './dimensions';
import { drawFixture, drawLabel, drawPlacement } from './items';
import { drawOpening } from './openings';
import { drawRoom } from './rooms';
import { r2 } from './shared';
import {
    LAYER_ORDER,
    type DrawGroup,
    type DrawItem,
    type DrawingOptions,
    type LayerName,
    type PlanDrawing,
} from './types';
import { drawWall, drawWallOutline } from './walls';

const sortedIds = (record: Record<string, unknown>): string[] =>
    Object.keys(record).sort(cmpId);

const layerOfText = (item: DrawItem): LayerName | null =>
    item.t === 'text' && item.style !== 'dim_text' ? 'TEXT' : null;

type Layers = Record<LayerName, DrawGroup[]>;

function emptyLayers(): Layers {
    return {
        BACKGROUND: [],
        ROOMS: [],
        FIXTURES: [],
        FURNITURE: [],
        WALLS: [],
        OPENINGS: [],
        DIMS: [],
        TEXT: [],
    };
}

/** Adds `group` to `layer`, moving its text items to the TEXT layer. */
function add(layers: Layers, layer: LayerName, group: DrawGroup): void {
    const own: DrawItem[] = [];
    const texts: DrawItem[] = [];
    for (const item of group.items) {
        (layerOfText(item) === 'TEXT' ? texts : own).push(item);
    }
    if (own.length > 0) layers[layer].push({ ...group, items: own });
    if (texts.length > 0) layers.TEXT.push({ ...group, items: texts });
}

function itemPoints(item: DrawItem): Vec2[] {
    switch (item.t) {
        case 'poly':
            return item.pts;
        case 'line':
            return [item.a, item.b];
        case 'text':
            return [item.at];
        case 'circle':
            return [
                { x: item.c.x - item.r, y: item.c.y - item.r },
                { x: item.c.x + item.r, y: item.c.y + item.r },
            ];
        case 'arc': {
            // End points plus every axis extreme inside the sweep.
            const at = (deg: number): Vec2 => ({
                x: item.c.x + item.r * Math.cos((deg * Math.PI) / 180),
                y: item.c.y + item.r * Math.sin((deg * Math.PI) / 180),
            });
            const pts = [at(item.startDeg), at(item.endDeg)];
            for (
                let k = Math.ceil(item.startDeg / 90);
                k * 90 < item.endDeg;
                k += 1
            ) {
                pts.push(at(k * 90));
            }
            return pts;
        }
        case 'image':
            return [];
    }
}

function boundsOf(layers: Layers): PlanDrawing['bbox'] {
    const pts: Vec2[] = [];
    for (const layer of LAYER_ORDER) {
        if (layer === 'BACKGROUND') continue;
        for (const group of layers[layer]) {
            for (const item of group.items) pts.push(...itemPoints(item));
        }
    }
    if (pts.length === 0) return null;
    const { min, max } = ringBBox(pts);
    return {
        min: { x: r2(min.x), y: r2(min.y) },
        max: { x: r2(max.x), y: r2(max.y) },
    };
}

/** Stable sort by entity id; groups without an id go last. */
function sortGroups(groups: DrawGroup[]): DrawGroup[] {
    const key = (g: DrawGroup): string => g.entityId ?? '￿';
    return groups
        .map((g, i) => ({ g, i }))
        .sort((p, q) => cmpId(key(p.g), key(q.g)) || p.i - q.i)
        .map(({ g }) => g);
}

export function buildPlanDrawing(
    doc: PlanDocument,
    geom: DerivedPlan,
    opts: DrawingOptions,
): PlanDrawing {
    const layers = emptyLayers();
    const { include } = opts;

    const bg = doc.background;
    if (include.background !== null && bg !== null && bg.visible) {
        layers.BACKGROUND.push({
            entityId: null,
            entityKind: 'background',
            items: [
                {
                    t: 'image',
                    href: include.background.href,
                    at: { x: r2(bg.position.x), y: r2(bg.position.y) },
                    width: r2(bg.pixelWidth * bg.mmPerPixel),
                    height: r2(bg.pixelHeight * bg.mmPerPixel),
                    rotationDeg: r2(bg.rotation),
                    opacity: bg.opacity,
                },
            ],
        });
    }

    if (include.rooms) {
        for (const room of geom.rooms) {
            const meta =
                room.metaId === null ? null : (doc.rooms[room.metaId] ?? null);
            add(layers, 'ROOMS', drawRoom(room, meta, opts));
        }
    }
    if (include.fixtures) {
        for (const id of sortedIds(doc.fixtures)) {
            add(layers, 'FIXTURES', drawFixture(doc.fixtures[id]!, opts));
        }
    }
    if (include.furniture) {
        for (const id of sortedIds(doc.placements)) {
            add(layers, 'FURNITURE', drawPlacement(doc.placements[id]!, opts));
        }
    }

    for (const id of sortedIds(doc.walls)) {
        const derived = geom.walls[id];
        if (derived)
            add(layers, 'WALLS', drawWall(derived, doc.walls[id]!, opts));
    }
    const cuts = sortedIds(geom.openings).map((id) => geom.openings[id]!.cut);
    add(layers, 'WALLS', drawWallOutline(geom.wallsUnion, cuts));

    for (const id of sortedIds(doc.openings)) {
        const opening = doc.openings[id]!;
        const derived = geom.openings[id];
        const wall = geom.walls[opening.wallId];
        if (derived && wall) {
            add(layers, 'OPENINGS', drawOpening(derived, opening, wall, opts));
        }
    }

    if (include.autoDimensions) {
        for (const id of sortedIds(doc.walls)) {
            const derived = geom.walls[id];
            if (derived) {
                add(
                    layers,
                    'DIMS',
                    autoDimensions(derived, doc.walls[id]!, opts),
                );
            }
        }
    }
    if (include.userDimensions) {
        for (const id of sortedIds(doc.annotations.dimensions)) {
            add(
                layers,
                'DIMS',
                drawDimension(doc.annotations.dimensions[id]!, opts),
            );
        }
    }
    if (include.labels) {
        for (const id of sortedIds(doc.annotations.labels)) {
            add(layers, 'TEXT', drawLabel(doc.annotations.labels[id]!, opts));
        }
    }

    for (const layer of LAYER_ORDER) layers[layer] = sortGroups(layers[layer]);
    return { bbox: boundsOf(layers), layers };
}
