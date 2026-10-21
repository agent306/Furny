/** `planSummary` (04 §4.8; engine CLI `plan-summary`). */
import { roundMm } from '../geometry/tolerance';
import type { Vec2 } from '../geometry/vec2';
import { derivePlanGeometry, type DerivedPlan } from './derive';
import type { PlanDocument, Point } from './schema';

export interface PlanSummary {
    wallCount: number;
    roomCount: number;
    /** `id` = meta id, or the face key of an unnamed room; `name` = meta name or `null`. */
    rooms: Array<{ id: string; name: string | null; areaMm2: number }>;
    /** Sum of the net room areas ("carpet area"). */
    totalAreaMm2: number;
    /** Integer mm; `null` for a plan without drawable walls. */
    bbox: { min: Point; max: Point } | null;
}

/** Integer mm with `-0` normalised. */
const whole = (v: number): number => roundMm(v) + 0;
const wholePoint = (p: Vec2): Point => ({ x: whole(p.x), y: whole(p.y) });

/**
 * Counts, net room areas (whole mm², listed in face-key order) and the plan
 * bounding box. `geom` must be the derived plan of `doc`; it is derived on
 * demand when omitted.
 */
export function planSummary(
    doc: PlanDocument,
    geom?: DerivedPlan,
): PlanSummary {
    const derived = geom ?? derivePlanGeometry(doc);
    const rooms = derived.rooms.map((room) => ({
        id: room.metaId ?? room.faceKey,
        name:
            room.metaId === null
                ? null
                : (doc.rooms[room.metaId]?.name ?? null),
        areaMm2: whole(room.areaMm2),
    }));
    const drawable = Object.keys(derived.walls).length > 0;
    return {
        wallCount: Object.keys(doc.walls).length,
        roomCount: rooms.length,
        rooms,
        totalAreaMm2: rooms.reduce((sum, room) => sum + room.areaMm2, 0),
        bbox: drawable
            ? {
                  min: wholePoint(derived.bbox.min),
                  max: wholePoint(derived.bbox.max),
              }
            : null,
    };
}
