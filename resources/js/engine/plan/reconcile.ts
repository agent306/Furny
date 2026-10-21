/**
 * Room-meta reconciliation (04 §4.4 b): after a command changed the walls, the
 * RoomMetas follow their rooms. It runs inside the command's post-process
 * phase, so its document changes belong to the same history entry.
 */
import type { Draft } from 'mutative';
import { intersectionArea } from '../geometry/clip';
import {
    area,
    pointInPolygon,
    ringBBox,
    signedDistToPolygon,
    type PolygonWithHoles,
} from '../geometry/polygon';
import { polylabel } from '../geometry/polylabel';
import { ANCHOR_MIN_CLEARANCE } from '../geometry/tolerance';
import { roundPoint, type Vec2 } from '../geometry/vec2';
import type { DerivedPlan, DerivedRoom } from './derive';
import { isAnchorInsideRoom } from './rooms';
import type { PlanDocument } from './schema';

export interface ReconcileResult {
    /** Metas removed by the merge rule, sorted by id. */
    deletedMetaIds: string[];
    /** Metas whose anchor was moved into their room, sorted by id. */
    movedAnchors: string[];
}

/** A next face is a candidate when it shares this much of the smaller face (04 §4.4 b-3.2). */
const MIN_OVERLAP_RATIO = 0.2;
/** Overlap areas closer than this (mm²) count as equal. */
const AREA_TIE = 1;

const cmpId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

interface Target {
    room: DerivedRoom;
    /** Area of the meta's previous room; 0 for an orphan. */
    prevArea: number;
}

type BBox = { min: Vec2; max: Vec2 };

const bboxesOverlap = (a: BBox, b: BBox): boolean =>
    a.min.x <= b.max.x &&
    b.min.x <= a.max.x &&
    a.min.y <= b.max.y &&
    b.min.y <= a.max.y;

/**
 * Moves RoomMetas to the rooms of `nextGeom` that continue their rooms of
 * `prevGeom` (04 §4.4 b, items 1-7), mutating only `draft.rooms`:
 *
 * - a meta keeps its room when the `faceKey` survives, else it follows the
 *   overlapping face that holds its anchor, else the largest overlap;
 * - an orphan (no previous room) takes the face that holds its anchor and is
 *   otherwise left alone, so a deleted-and-redrawn wall keeps the room name;
 * - when several metas end up in one face the one whose previous room was
 *   largest keeps it (ties: smallest id) and the others are deleted;
 * - a meta's anchor is moved to the room's label point when it is outside the
 *   centre-line face (holes count as outside, via `isAnchorInsideRoom`) or
 *   closer than `ANCHOR_MIN_CLEARANCE` to the edge of the net polygon, and a
 *   `labelOffset` that would put the label outside the net polygon is cleared.
 *
 * `nextGeom` is derived from the document before this call, so its
 * `metaId`s describe the old anchors; derive again afterwards.
 */
export function reconcileRoomMetas(
    draft: Draft<PlanDocument>,
    prevGeom: DerivedPlan,
    nextGeom: DerivedPlan,
): ReconcileResult {
    const result: ReconcileResult = { deletedMetaIds: [], movedAnchors: [] };
    const metaIds = Object.keys(draft.rooms).sort(cmpId);
    if (metaIds.length === 0) return result;

    const prevByMeta = new Map<string, DerivedRoom>();
    for (const room of prevGeom.rooms) {
        if (room.metaId !== null) prevByMeta.set(room.metaId, room);
    }
    const nextByKey = new Map<string, DerivedRoom>();
    for (const room of nextGeom.rooms) nextByKey.set(room.faceKey, room);

    const faceAreas = new Map<DerivedRoom, number>();
    const faceArea = (room: DerivedRoom): number => {
        let a = faceAreas.get(room);
        if (a === undefined) {
            a = area(room.facePolygon);
            faceAreas.set(room, a);
        }
        return a;
    };
    const boxes = new Map<DerivedRoom, BBox>();
    const boxOf = (room: DerivedRoom): BBox => {
        let b = boxes.get(room);
        if (b === undefined) {
            b = ringBBox(room.facePolygon.outer);
            boxes.set(room, b);
        }
        return b;
    };

    /** Item 3.2: the overlapping face that holds the anchor, else the largest overlap. */
    function follow(prev: DerivedRoom, anchor: Vec2): DerivedRoom | null {
        const prevBox = boxOf(prev);
        const found: Array<{ room: DerivedRoom; overlap: number }> = [];
        for (const next of nextGeom.rooms) {
            if (!bboxesOverlap(prevBox, boxOf(next))) continue;
            const overlap = intersectionArea(
                [prev.facePolygon],
                [next.facePolygon],
            );
            const smaller = Math.min(faceArea(prev), faceArea(next));
            if (overlap >= MIN_OVERLAP_RATIO * smaller) {
                found.push({ room: next, overlap });
            }
        }
        const holder = found.find((c) => isAnchorInsideRoom(anchor, c.room));
        if (holder !== undefined) return holder.room;
        let best: (typeof found)[number] | null = null;
        for (const c of found) {
            if (
                best === null ||
                c.overlap > best.overlap + AREA_TIE ||
                (Math.abs(c.overlap - best.overlap) <= AREA_TIE &&
                    cmpId(c.room.faceKey, best.room.faceKey) < 0)
            ) {
                best = c;
            }
        }
        return best?.room ?? null;
    }

    // Items 1-3: the target face of every meta.
    const targets = new Map<string, Target>();
    for (const id of metaIds) {
        const anchor = draft.rooms[id]!.anchor;
        const prev = prevByMeta.get(id);
        let room: DerivedRoom | null | undefined;
        if (prev === undefined) {
            room = nextGeom.rooms.find((r) => isAnchorInsideRoom(anchor, r));
        } else {
            room = nextByKey.get(prev.faceKey) ?? follow(prev, anchor);
        }
        if (room) {
            targets.set(id, {
                room,
                prevArea: prev === undefined ? 0 : prev.areaMm2,
            });
        }
    }

    // Item 4: one meta per face.
    const claimants = new Map<string, string[]>();
    for (const [id, t] of targets) {
        const list = claimants.get(t.room.faceKey);
        if (list) list.push(id);
        else claimants.set(t.room.faceKey, [id]);
    }
    for (const ids of claimants.values()) {
        if (ids.length < 2) continue;
        const ranked = ids.toSorted(
            (a, b) =>
                targets.get(b)!.prevArea - targets.get(a)!.prevArea ||
                cmpId(a, b),
        );
        for (const loser of ranked.slice(1)) {
            delete draft.rooms[loser];
            targets.delete(loser);
            result.deletedMetaIds.push(loser);
        }
    }
    result.deletedMetaIds.sort(cmpId);

    // Item 6: anchors and label offsets.
    for (const id of metaIds) {
        const target = targets.get(id);
        if (target === undefined) continue;
        const { room } = target;
        const meta = draft.rooms[id]!;
        const net: PolygonWithHoles = {
            outer: room.polygon,
            holes: room.holes,
        };
        const anchor = meta.anchor;
        const placed =
            isAnchorInsideRoom(anchor, room) &&
            signedDistToPolygon(anchor, net) >= ANCHOR_MIN_CLEARANCE;
        if (!placed) {
            const to = roundPoint(polylabel(net).point);
            if (to.x !== anchor.x || to.y !== anchor.y) {
                meta.anchor = to;
                result.movedAnchors.push(id);
            }
        }
        const offset = meta.labelOffset;
        if (offset !== null) {
            const label = {
                x: room.centroid.x + offset.x,
                y: room.centroid.y + offset.y,
            };
            if (pointInPolygon(label, net) !== 'inside') {
                meta.labelOffset = null;
            }
        }
    }
    return result;
}
