/**
 * Phase 2 of the plan command pipeline (04 §6.4): follow-up edits that keep
 * the rest of the document consistent with the new wall geometry. They run
 * in the same history entry as the command and touch only entities related
 * to what the command changed.
 */
import type { Draft } from 'mutative';
import { roundMm } from '../../geometry/tolerance';
import {
    add,
    dist,
    dot,
    normDeg,
    rotationFromFront,
    scale,
    sub,
    type Vec2,
} from '../../geometry/vec2';
import type { CommandOutput } from '../../commands/types';
import type { DerivedPlan, DerivedRoom, DerivedWall } from '../derive';
import type { FootprintProvider } from '../footprint';
import { reconcileRoomMetas } from '../reconcile';
import { isAnchorInsideRoom } from '../rooms';
import type { PlanDocument } from '../schema';

export interface PostProcessInfo {
    /** The phase-1 result: the document the phase-2 draft starts from. */
    doc: PlanDocument;
    /** The document before the command. */
    prevDoc: PlanDocument;
    /** Geometry of `prevDoc`. */
    prevGeom: DerivedPlan;
    /** Geometry of `doc`. */
    geom: DerivedPlan;
    /** Used for the width of an attached placement. */
    footprints: FootprintProvider;
    /** Entity ids changed in phase 1 (`'*'` = everything). */
    changed: ReadonlySet<string>;
}

interface Related {
    /** Walls the command changed or that touch a changed node. */
    walls: ReadonlySet<string>;
    /** `walls` plus the walls that share a node with them (one hop). */
    reach: ReadonlySet<string>;
    nodes: ReadonlySet<string>;
}

const has = (record: object, id: string): boolean => Object.hasOwn(record, id);

/**
 * The walls the command changed or that touch a changed node, and their
 * nodes. Walls and nodes the command removed count too (read from `prevDoc`),
 * so the nodes a deleted wall leaves behind are found. `reach` adds one hop:
 * a neighbour's faces and joins change with a wall's thickness, presence or
 * ends, so what hangs on a neighbour has to be recomputed too.
 */
function relatedEntities(info: PostProcessInfo): Related {
    const { doc, prevDoc, changed } = info;
    const walls = new Set<string>();
    const nodes = new Set<string>();
    if (changed.has('*')) {
        for (const d of [doc, prevDoc]) {
            Object.keys(d.walls).forEach((id) => walls.add(id));
            Object.keys(d.nodes).forEach((id) => nodes.add(id));
        }
        return { walls, reach: walls, nodes };
    }
    for (const id of changed) {
        if (has(doc.walls, id) || has(prevDoc.walls, id)) walls.add(id);
        if (has(doc.nodes, id) || has(prevDoc.nodes, id)) nodes.add(id);
    }
    for (const wall of Object.values(doc.walls)) {
        if (nodes.has(wall.a) || nodes.has(wall.b)) walls.add(wall.id);
    }
    for (const id of walls) {
        for (const d of [doc, prevDoc]) {
            const wall = d.walls[id];
            if (wall === undefined) continue;
            nodes.add(wall.a);
            nodes.add(wall.b);
        }
    }
    const reach = new Set(walls);
    for (const wall of Object.values(doc.walls)) {
        if (nodes.has(wall.a) || nodes.has(wall.b)) reach.add(wall.id);
    }
    return { walls, reach, nodes };
}

/**
 * The faceKeys of the rooms the command affected (04 §4.4 b scope): a face
 * that exists in only one of the two geometries, a face bounded by a related
 * wall, and the faces of a RoomMeta the command itself changed. `undefined`
 * (everything) when the command replaced a whole collection.
 */
function affectedFaceKeys(
    info: PostProcessInfo,
    related: Related,
): ReadonlySet<string> | undefined {
    const { doc, prevDoc, prevGeom, geom, changed } = info;
    if (changed.has('*')) return undefined;
    const keys = new Set<string>();
    const prevKeys = new Set(prevGeom.rooms.map((r) => r.faceKey));
    const nextKeys = new Set(geom.rooms.map((r) => r.faceKey));
    const mark = (rooms: DerivedRoom[], other: Set<string>): void => {
        for (const room of rooms) {
            if (
                !other.has(room.faceKey) ||
                room.wallIds.some((id) => related.walls.has(id))
            ) {
                keys.add(room.faceKey);
            }
        }
    };
    mark(prevGeom.rooms, nextKeys);
    mark(geom.rooms, prevKeys);
    for (const id of changed) {
        if (!has(doc.rooms, id) && !has(prevDoc.rooms, id)) continue;
        const owned = prevGeom.rooms.find((r) => r.metaId === id);
        if (owned !== undefined) keys.add(owned.faceKey);
        const meta = doc.rooms[id];
        if (meta === undefined) continue;
        for (const room of geom.rooms) {
            if (isAnchorInsideRoom(meta.anchor, room)) keys.add(room.faceKey);
        }
    }
    return keys;
}

/** `roundMm` without a negative zero. */
const mm = (v: number): number => roundMm(v) + 0;

/** Rotation as stored on a placement: `[0, 360)`, rounded to 0.01 degree. */
export function storedRotation(deg: number): number {
    const rounded = Math.round(normDeg(deg) * 100) / 100;
    return rounded >= 360 ? 0 : rounded + 0;
}

/** Rotations closer than this (degrees, wrapped at 360) are the same rotation. */
const ROTATION_NOISE_DEG = 1e-6;

function sameRotation(a: number, b: number): boolean {
    const d = normDeg(a - b);
    return Math.min(d, 360 - d) < ROTATION_NOISE_DEG;
}

/** Writes only the coordinates that differ, so an unchanged point makes no patch. */
function setPoint(target: { x: number; y: number }, to: Vec2): void {
    const x = mm(to.x);
    const y = mm(to.y);
    if (target.x !== x) target.x = x;
    if (target.y !== y) target.y = y;
}

function pushDeleted(out: CommandOutput<unknown>, ids: string[]): void {
    for (const id of ids) {
        if (!out.deletedIds.includes(id)) out.deletedIds.push(id);
    }
}

/** Step 1: nodes in the related set that no wall references any more. */
function deleteOrphanNodes(
    draft: Draft<PlanDocument>,
    info: PostProcessInfo,
    related: Related,
    out: CommandOutput<unknown>,
): void {
    const used = new Set<string>();
    for (const wall of Object.values(info.doc.walls)) {
        used.add(wall.a);
        used.add(wall.b);
    }
    const gone = [...related.nodes]
        .filter((id) => has(info.doc.nodes, id) && !used.has(id))
        .sort();
    for (const id of gone) delete draft.nodes[id];
    pushDeleted(out, gone);
}

/**
 * Step 2: dimensions attached to a related wall follow its face, or go with
 * the wall; so does a dimension the command changed.
 */
function followDimensions(
    draft: Draft<PlanDocument>,
    info: PostProcessInfo,
    related: Related,
    out: CommandOutput<unknown>,
): void {
    const gone: string[] = [];
    for (const dim of Object.values(info.doc.annotations.dimensions)) {
        const attached = dim.attachedTo;
        if (attached === null) continue;
        // a dimension the command itself wrote follows its wall too (addDimension, setDimension)
        if (!related.reach.has(attached.wallId) && !info.changed.has(dim.id)) {
            continue;
        }
        if (!has(info.doc.walls, attached.wallId)) {
            delete draft.annotations.dimensions[dim.id];
            gone.push(dim.id);
            continue;
        }
        const wall = info.geom.walls[attached.wallId];
        if (wall === undefined) continue; // not derivable (degenerate): leave as is
        const line =
            attached.face === 'left'
                ? wall.leftFace
                : attached.face === 'right'
                  ? wall.rightFace
                  : wall.centerline;
        const target = draft.annotations.dimensions[dim.id]!;
        setPoint(target.a, line[0]);
        setPoint(target.b, line[1]);
    }
    pushDeleted(out, gone.sort());
}

/** The face of `wall` a placement on `side` stands against, a to b. */
const faceOf = (wall: DerivedWall, side: 'left' | 'right'): [Vec2, Vec2] =>
    side === 'left' ? wall.leftFace : wall.rightFace;

/** Step 3: placements attached to a related wall follow its face. */
function followPlacements(
    draft: Draft<PlanDocument>,
    info: PostProcessInfo,
    related: Related,
): void {
    for (const p of Object.values(info.doc.placements)) {
        const attachment = p.wallAttachment;
        if (attachment === null || !related.reach.has(attachment.wallId)) {
            continue;
        }
        const target = draft.placements[p.id]!;
        if (!has(info.doc.walls, attachment.wallId)) {
            target.wallAttachment = null;
            continue;
        }
        const wall = info.geom.walls[attachment.wallId];
        if (wall === undefined) continue; // not derivable: leave as is
        const [p0, p1] = faceOf(wall, attachment.side);
        const length = dist(p0, p1);
        if (length < 1e-9) continue;
        const dir = scale(sub(p1, p0), 1 / length);

        // distance along the previous face, else along the new one
        const was = info.prevGeom.walls[attachment.wallId];
        const back = { x: p.x, y: p.y };
        let u = dot(sub(back, p0), dir);
        if (was !== undefined) {
            const [q0, q1] = faceOf(was, attachment.side);
            const prevLength = dist(q0, q1);
            if (prevLength >= 1e-9) {
                u = dot(sub(back, q0), scale(sub(q1, q0), 1 / prevLength));
            }
        }
        const width = info.footprints(p.designId)?.width ?? 0;
        const lo = width / 2;
        const hi = length - width / 2;
        u = hi < lo ? length / 2 : Math.min(Math.max(u, lo), hi);

        setPoint(target, add(p0, scale(dir, u)));
        const front =
            attachment.side === 'left' ? wall.normal : scale(wall.normal, -1);
        const rotation = storedRotation(rotationFromFront(front));
        if (!sameRotation(target.rotation, rotation)) {
            target.rotation = rotation;
        }
    }
}

/**
 * The four post-process steps of 04 §6.4, in order: delete orphaned nodes,
 * recompute attached dimensions, move attached placements, reconcile the
 * RoomMetas (04 §4.4 b). Deleted ids are appended to `out.deletedIds`.
 */
export function postProcess(
    draft: Draft<PlanDocument>,
    info: PostProcessInfo,
    out: CommandOutput<unknown>,
): void {
    const related = relatedEntities(info);
    deleteOrphanNodes(draft, info, related, out);
    followDimensions(draft, info, related, out);
    followPlacements(draft, info, related);
    const { deletedMetaIds } = reconcileRoomMetas(
        draft,
        info.prevGeom,
        info.geom,
        affectedFaceKeys(info, related),
    );
    pushDeleted(out, deletedMetaIds);
}
