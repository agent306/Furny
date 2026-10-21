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
export { isAnchorInsideRoom } from './plan/rooms';
export {
    PLAN_ISSUE_CODES,
    planErrorKeys,
    removeOrphanNodes,
    validatePlan,
} from './plan/validate';
export type { PlanIssueCode } from './plan/validate';
export { planSummary } from './plan/summary';
export type { PlanSummary } from './plan/summary';
export { fixtureFootprint, placementFootprint } from './plan/footprint';
export type {
    Footprint,
    FootprintProvider,
    FootprintSize,
} from './plan/footprint';
export {
    CONFLICT_KINDS,
    computePlacementConflicts,
    doorSwingSectors,
} from './plan/conflicts';
export type { ConflictKind, PlacementConflict } from './plan/conflicts';
export {
    SNAP_KINDS,
    buildSnapIndex,
    defaultSnapSettings,
    gridStepFor,
    OPENING_SNAP_REASONS,
    rawStepFor,
    snapFootprint,
    snapOpeningPosition,
    snapPoint,
} from './plan/snapping';
export type {
    FootprintSnapInput,
    FootprintSnapResult,
    OpeningSnapInput,
    OpeningSnapReason,
    OpeningSnapResult,
    SnapFaceItem,
    SnapFootprintItem,
    SnapGuide,
    SnapIndex,
    SnapItemIndex,
    SnapInput,
    SnapKeyPointItem,
    SnapKind,
    SnapMarker,
    SnapModifiers,
    SnapNodeItem,
    SnapResult,
    SnapSettings,
    SnapWallItem,
} from './plan/snapping';
export {
    LAYER_ORDER,
    STYLE_KEYS,
    autoDimensions,
    buildPlanDrawing,
    drawDimension,
    drawFixture,
    drawLabel,
    drawOpening,
    drawPlacement,
    drawRoom,
    drawWall,
    drawWallOutline,
    roomTypeToColorKey,
    svgFromDrawing,
} from './plan/drawing';
export type {
    DrawGroup,
    DrawItem,
    DrawingOptions,
    LayerName,
    PlanDrawing,
    RoomColorKey,
    StyleKey,
    SvgExportOptions,
    SvgStyle,
} from './plan/drawing';
export { buildHitIndex } from './plan/hitIndex';
export type { Hit, HitIndex, HitKind, HitLayerMask } from './plan/hitIndex';
export { hitTest, hitTestRect } from './plan/hitTest';
export {
    createCommandBus,
    defaultPipeline,
    shouldAutoFreeze,
} from './commands/bus';
export { CommandAbort, CommandFailedError } from './commands/types';
export type {
    AnyCommandDef,
    BusEvent,
    CommandBus,
    CommandBusConfig,
    CommandDef,
    CommandOutput,
    ExecuteOptions,
    ExecuteResult,
    HistoryEntry,
    ParamsOf,
    Pipeline,
    PipelineOutput,
    ResultOf,
} from './commands/types';
export { reconcileRoomMetas } from './plan/reconcile';
export type { ReconcileResult } from './plan/reconcile';
export { planPathToEntityId } from './plan/commands/paths';
export {
    PLAN_COMMAND_ERROR_CODES,
    PLAN_COMMAND_KEY_PREFIX,
    defaultPlanDefaults,
    executePlanCommand,
    planCommandMessage,
    planPipeline,
} from './plan/commands/pipeline';
export type {
    PlanCommandContext,
    PlanCommandErrorCode,
    PlanDefaults,
} from './plan/commands/pipeline';
export { postProcess } from './plan/commands/postprocess';
export type { PostProcessInfo } from './plan/commands/postprocess';
export { definePlanCommand } from './plan/commands/define';
export { PLAN_COMMANDS, createPlanBus } from './plan/commands/registry';
export type { PlanBusConfig, PlanCommandType } from './plan/commands/registry';
export {
    insertWallSegment,
    mergeNodeInto,
    nextOpeningLabel,
    reclampOpenings,
    resolveEndpoint,
    splitIntersections,
    splitWallAt,
    wallLength,
} from './plan/commands/helpers';
export type { EndpointRef, WallProps } from './plan/commands/helpers';
export {
    BOARD_TYPES,
    CatalogEdgeBandSchema,
    CatalogFinishSchema,
    CatalogHardwareSchema,
    CatalogLabourRateSchema,
    CatalogMaterialSchema,
    CatalogSnapshotSchema,
    CatalogTaxRateSchema,
    FINISH_TYPES,
    HARDWARE_CATEGORIES,
    HARDWARE_UNITS,
    LABOUR_KEYS,
    LABOUR_UNITS,
    MATERIAL_ROLES,
    PricingSettingsSchema,
    SHEET_BILLING_MODES,
    SURFACES,
} from './catalog/snapshot';
export type {
    BoardType,
    CatalogEdgeBand,
    CatalogFinish,
    CatalogHardware,
    CatalogLabourRate,
    CatalogMaterial,
    CatalogSnapshot,
    CatalogTaxRate,
    FinishType,
    HardwareCategory,
    HardwareUnit,
    LabourKey,
    LabourUnit,
    MaterialRole,
    PricingSettings,
    SheetBillingMode,
    Surface,
} from './catalog/snapshot';
export {
    HARDWARE_ROLE_KEYS,
    HARDWARE_SPEC_SCHEMAS,
    parseHardwareSpecs,
} from './catalog/specs';
export type {
    HardwareRoleKey,
    HardwareSpecs,
    HardwareSpecsOf,
} from './catalog/specs';
export { indexCatalog } from './furniture/catalogIndex';
export type { CatalogIndex } from './furniture/catalogIndex';
export { DEFAULT_DENSITY } from './furniture/rules/weight';
export {
    CarcassSpecSchema,
    ContentSchema,
    EDGE_IDS,
    EdgeIdSchema,
    ExtraHardwareSchema,
    ExtraPartSchema,
    FRONT_KINDS,
    FrontSchema,
    FurnitureDocumentSchema,
    HardwareOverrideSchema,
    MaterialAssignmentSchema,
    MaterialAssignmentsSchema,
    OverridesSchema,
    PartOverrideSchema,
    SectionChildSchema,
    SectionSchema,
    TEMPLATE_KEYS,
    TableSpecSchema,
    TemplateKeySchema,
} from './furniture/schema';
export type {
    CarcassSpec,
    Content,
    EdgeId,
    ExtraHardware,
    ExtraPart,
    Front,
    FurnitureDocument,
    HardwareKey,
    HardwareOverride,
    MaterialAssignments,
    Overrides,
    PartKey,
    PartOverride,
    Section,
    SectionChild,
    TableSpec,
    TemplateKey,
} from './furniture/schema';
export {
    FURNITURE_MIGRATIONS,
    FURNITURE_SCHEMA_VERSION,
    migrateFurniture,
} from './furniture/migrate';
export {
    ANTI_TIP_MIN_HEIGHT,
    BACK_GROOVE_CLEARANCE,
    BACK_GROOVE_DEPTH,
    BACK_GROOVE_OFFSET,
    BEHIND_DOOR_DEPTH_CLEARANCE,
    BEHIND_DOOR_SIDE_PACKER,
    CAM_SPACING,
    DEFAULT_ROD_TOP_CLEARANCE,
    DEFAULT_SHELF_FRONT_SETBACK,
    DOOR_GAP,
    DRAWER_BOTTOM_GROOVE_DEPTH,
    DRAWER_BOTTOM_OFFSET_SIDE_MOUNT,
    DRAWER_BOX_HEIGHT_STEP,
    DRAWER_BOX_VERTICAL_CLEARANCE,
    DRAWER_FRONT_GAP,
    DRAWER_MIN_BOX_HEIGHT,
    DRAWER_REAR_CLEARANCE,
    DRAWER_UNUSED_DEPTH_WARN,
    FULL_OVERLAY_EDGE_GAP,
    GLASS_CLEARANCE,
    GLASS_FRAME_WIDTH,
    GLASS_REBATE_DEPTH,
    HANDLE_EDGE_OFFSET,
    HANGING_MIN_DEPTH,
    HANGING_MIN_HEIGHT,
    HINGE_BORING_DISTANCE,
    HINGE_CUP_DIAMETER,
    HINGE_END_OFFSET,
    INSET_GAP,
    LEG_COLUMN_SPACING,
    LEG_EDGE_INSET,
    LOWER_SHELF_ELEVATION,
    MAX_DOOR_HEIGHT,
    MAX_DOOR_WIDTH,
    MAX_PARTS,
    MAX_SLIDING_LEAF_WIDTH,
    MIN_SLIDING_LEAF_WIDTH,
    MODESTY_MAX_HEIGHT,
    PLINTH_RETURN_SPACING,
    ROD_MAX_SPAN,
    SCREW_PACK_PARTS,
    SHELF_PIN_MARGIN,
    SHELF_SIDE_CLEARANCE,
    SLIDING_HEIGHT_DEDUCTION,
    SLIDING_OVERLAP,
    SLIDING_TRACK_PITCH_EXTRA,
    SYSTEM32_FRONT_OFFSET,
    SYSTEM32_PITCH,
    TABLE_DRAWER_FRONT_HEIGHT,
    TABLE_DRAWER_MAX_WIDTH,
    TABLE_DRAWER_SPACING,
    TABLE_STRETCHER_ELEVATION,
    TABLE_STRETCHER_HEIGHT,
    TALL_HANDLE_HEIGHT,
    TRESTLE_BEAM_HEIGHT,
    fl,
} from './furniture/constants';
export type {
    Axis,
    Box3,
    FurnitureModel,
    GenContext,
    HardwareLine,
    Joint,
    ModelFront,
    PanelSpec,
    Part,
    PartGeometry,
    PartGrain,
    PartOperations,
    PhysEdge,
} from './furniture/types';
export { createGenContext } from './furniture/context';
export { layoutSections } from './furniture/carcass/layout';
export type {
    Divider,
    SectionBoxInfo,
    SectionLabel,
    SectionLayout,
} from './furniture/carcass/layout';
export { makePart, mapEdges, mapGrain } from './furniture/parts';
export { PART_NAMES_EN, partNameEn } from './furniture/partNames';
export {
    clamp,
    columnsFromDoors,
    commonCarcass,
    effectiveParams,
    emptyOverrides,
    hingedFront,
    interiorHeight,
    leaf,
    reidentify,
    resolveDefaultMaterials,
    shelfCount,
    split,
} from './furniture/templates/common';
export type { SectionBuilders } from './furniture/templates/common';
export type {
    Condition,
    ParamField,
    TemplateCategory,
    TemplateContext,
    TemplateDefinition,
} from './furniture/templates/types';
export {
    TEMPLATES,
    getTemplate,
    templateDefaultDocument,
} from './furniture/templates/index';
export {
    wardrobeDoorCount,
    wardrobeHinged,
    wardrobeHingedParamsSchema,
} from './furniture/templates/wardrobe_hinged';
export type { WardrobeHingedParams } from './furniture/templates/wardrobe_hinged';
