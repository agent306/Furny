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
export {
    MM2_PER_FT2,
    MM_PER_FOOT,
    MM_PER_INCH,
    PARSE_LENGTH_ERROR_CODES,
    coerceUnitPrefs,
} from './units/types';
export type {
    FormatLengthOptions,
    LengthUnit,
    ParseLengthContext,
    ParseLengthError,
    ParseLengthErrorCode,
    ParseLengthResult,
    UnitPrefs,
    UnitSystem,
} from './units/types';
export { parseLength } from './units/parse';
export { formatAngle, formatArea, formatLength } from './units/format';
export {
    difference,
    intersection,
    intersectionArea,
    offset,
    union,
} from './geometry/clip';
export type { OffsetJoin } from './geometry/clip';
export { triangulate } from './geometry/triangulate';
export type { TriangleMesh } from './geometry/triangulate';
export { cyrb53 } from './geometry/hash';
export { buildPlanarGraph, nestFaces, walkFaces } from './geometry/planarFaces';
export type {
    FaceCycle,
    PlanarEdge,
    PlanarGraph,
    RawFace,
} from './geometry/planarFaces';
export { polylabel } from './geometry/polylabel';
export { ROOM_TYPES } from './plan/roomTypes';
export type { RoomType } from './plan/roomTypes';
export { ROOM_NAMES, suggestRoomType } from './plan/roomNames';
export { FIXTURE_KEYS, FIXTURE_LIBRARY } from './plan/fixtures';
export type {
    Fixture2DItem,
    FixtureCategory,
    FixtureDef,
    FixtureKey,
    FixtureMaterialKey,
    FixturePrimitive,
} from './plan/fixtures';
export { EngineInputError } from './errors';
export type { EngineInputErrorCode } from './errors';
export { IssueSchema } from './plan/types';
export type { DeriveIssue, EngineMessage, Issue, Result } from './plan/types';
export {
    BackgroundImageSchema,
    DOOR_TYPES,
    DimensionAnnotationSchema,
    DoorTypeSchema,
    FLOOR_FINISHES,
    FixtureSchema,
    FurniturePlacementSchema,
    OpeningSchema,
    PlanDocumentSchema,
    PlanMetaSchema,
    PointSchema,
    RoomMetaSchema,
    TextLabelSchema,
    ViewStateSchema,
    WALL_KINDS,
    WALL_MATERIALS,
    WINDOW_TYPES,
    WallNodeSchema,
    WallSchema,
    WindowTypeSchema,
} from './plan/schema';
export type {
    BackgroundImage,
    DimensionAnnotation,
    DoorType,
    Fixture,
    FurniturePlacement,
    Opening,
    PlanDocument,
    PlanMeta,
    Point,
    RoomMeta,
    TextLabel,
    ViewState,
    Wall,
    WallNode,
    WindowType,
} from './plan/schema';
export {
    PLAN_MIGRATIONS,
    PLAN_SCHEMA_VERSION,
    migratePlan,
} from './plan/migrate';
export {
    DERIVE_ISSUE_CODES,
    buildWallGraph,
    buildWallOutline,
    computeAllWallEnds,
    computeNodeJoins,
} from './plan/walls';
export type {
    DeriveIssueCode,
    OutlineFallbackReason,
    WallEnd,
    WallGraph,
    WallInfo,
} from './plan/walls';
export { createPlanDeriver, derivePlanGeometry } from './plan/derive';
export {
    analyzeRooms,
    associateRoomMetas,
    computeRoomNet,
    detectRooms,
    faceKeyFor,
} from './plan/rooms';
export type { RoomAnalysis, RoomNet, WallRoomSides } from './plan/rooms';
export type {
    DerivedOpening,
    DerivedPlan,
    DerivedRoom,
    DerivedWall,
    DeriverStats,
    PlanDeriver,
} from './plan/derive';
