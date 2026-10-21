export { ENGINE_VERSION } from './version';
export { isEntityId, newId } from './ids';
export type { IdPrefix } from './ids';
export {
    ANCHOR_MIN_CLEARANCE,
    ANGLE_TOL,
    ANGLE_TOL_DEG,
    CLIPPER_SCALE,
    EPS,
    MAX_COORD,
    MIN_ROOM_NET_AREA,
    MIN_WALL_LENGTH,
    MITER_LIMIT,
    NODE_MERGE_TOL,
    roundMm,
} from './geometry/tolerance';
export {
    applyBps,
    ceilDiv,
    costFromHundredths,
    costFromMilli,
    grossUp,
    multiplyMinor,
    netFromGross,
    roundHalfUpDiv,
    roundUpToStep,
} from './money';
export {
    add,
    angleOf,
    cross,
    dist,
    dist2,
    dot,
    frontVector,
    isParallel,
    len,
    lerp,
    nearlyEqual,
    normalize,
    normDeg,
    orient,
    perpLeft,
    rot,
    rotationFromFront,
    roundPoint,
    scale,
    sideOf,
    sub,
    v,
} from './geometry/vec2';
export type { Vec2 } from './geometry/vec2';
export {
    closestPointOnSeg,
    distPointLine,
    intersectSegments,
    lineIntersection,
    projectParam,
    segLength,
} from './geometry/segment';
export type { Seg, SegIntersection } from './geometry/segment';
export {
    area,
    distToRing,
    ensureCCW,
    ensureCW,
    isAxisRectangle,
    perimeter,
    pointInPolygon,
    pointInRing,
    polygonCentroid,
    ringBBox,
    signedArea,
    signedDistToPolygon,
    simplifyCollinear,
} from './geometry/polygon';
export type { PolygonWithHoles, Ring } from './geometry/polygon';
