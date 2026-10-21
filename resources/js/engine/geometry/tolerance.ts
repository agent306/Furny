/** Tolerances and constants shared by the geometry engine (04 §0.3). */

/** mm; points closer than this are the same point. */
export const EPS = 0.5;
/** Directions within this many degrees are parallel/collinear. */
export const ANGLE_TOL_DEG = 0.5;
/** `ANGLE_TOL_DEG` in radians. */
export const ANGLE_TOL = (ANGLE_TOL_DEG * Math.PI) / 180;
/** mm; command-level snap radius for new endpoints. */
export const NODE_MERGE_TOL = 5;
/** mm; shorter walls are degenerate (03 §1.1 `plan.wall_degenerate`). */
export const MIN_WALL_LENGTH = 10;
/** Miter length / half thickness before a corner is bevelled. */
export const MITER_LIMIT = 4;
/** mm to integer µm before calling Clipper. */
export const CLIPPER_SCALE = 1000;
/** mm²; smaller faces are slivers, not rooms. */
export const MIN_ROOM_NET_AREA = 40_000;
/** mm; minimum distance of a RoomMeta anchor from its face boundary. */
export const ANCHOR_MIN_CLEARANCE = 100;
/** mm; coordinate range of a plan document (03 §1.1). */
export const MAX_COORD = 1_000_000;

/** Round half away from zero (04 §0.2). May return -0 for tiny negatives. */
export function roundMm(v: number): number {
    return Math.sign(v) * Math.round(Math.abs(v));
}
