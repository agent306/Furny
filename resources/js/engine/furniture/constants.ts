/**
 * Generation constants (07 §1.3), the single source for gaps and clearances.
 * All values are millimetres unless stated; names and values match the spec
 * table one to one.
 */

/** Full overlay: leaf edge stops 1.5 mm short of the carcass outer face. */
export const FULL_OVERLAY_EDGE_GAP = 1.5;

/** Gap between two adjacent leaves / fronts. */
export const DOOR_GAP = 2;

/** Inset fronts: gap to the opening on every edge. */
export const INSET_GAP = 2;

/** Vertical gap between stacked drawer fronts in one section. */
export const DRAWER_FRONT_GAP = 2;

/** Per-leaf share of the opening width. */
export const MAX_DOOR_WIDTH = 600;

/** Above this a door needs a straightener (warning). */
export const MAX_DOOR_HEIGHT = 2400;

/** First/last hinge centre from leaf ends. */
export const HINGE_END_OFFSET = 100;

/** Cup edge distance from leaf edge (allowed 3-6). */
export const HINGE_BORING_DISTANCE = 4;

/** Hinge cup diameter. */
export const HINGE_CUP_DIAMETER = 35;

/** Shelf-pin and hinge-plate rows from the front edge. */
export const SYSTEM32_FRONT_OFFSET = 37;

/** System32 pitch. */
export const SYSTEM32_PITCH = 32;

/** First/last shelf-pin hole from the section bottom/top. */
export const SHELF_PIN_MARGIN = 64;

/** Adjustable shelf clearance per side. */
export const SHELF_SIDE_CLEARANCE = 1;

/** Default shelf front setback. */
export const DEFAULT_SHELF_FRONT_SETBACK = 20;

/** Grooved back: rear edge of panels to rear face of back. */
export const BACK_GROOVE_OFFSET = 10;

/** Groove depth in sides/top/bottom. */
export const BACK_GROOVE_DEPTH = 8;

/** Back stops short of the groove bottom. */
export const BACK_GROOVE_CLEARANCE = 1;

/** One extra plinth return per started 1000 mm beyond the first. */
export const PLINTH_RETURN_SPACING = 1000;

/** Exposed cabinet legs: centre inset from carcass edges. */
export const LEG_EDGE_INSET = 30;

/** Cabinet leg columns: max(2, ceil(W_c / 800) + 1). */
export const LEG_COLUMN_SPACING = 800;

/** Track pitch = t_f + 12. */
export const SLIDING_TRACK_PITCH_EXTRA = 12;

/** Overlap between adjacent sliding leaves. */
export const SLIDING_OVERLAP = 30;

/** Leaf height = opening height - 40. */
export const SLIDING_HEIGHT_DEDUCTION = 40;

/** Sliding leaves auto: max(2, ceil(W_open / 1000)). */
export const MAX_SLIDING_LEAF_WIDTH = 1000;

/** Below this: warning. */
export const MIN_SLIDING_LEAF_WIDTH = 450;

/** Stile/rail width of glass frame doors. */
export const GLASS_FRAME_WIDTH = 60;

/** Glass sits this deep into the frame on each side. */
export const GLASS_REBATE_DEPTH = 8;

/** Per side. */
export const GLASS_CLEARANCE = 1;

/** Slide nominal length <= available depth - 10. */
export const DRAWER_REAR_CLEARANCE = 10;

/** Available depth - 10 - slide length above this: warning. */
export const DRAWER_UNUSED_DEPTH_WARN = 100;

/** Box height = slot height - 40, floored to the height step. */
export const DRAWER_BOX_VERTICAL_CLEARANCE = 40;

/** Drawer box height step. */
export const DRAWER_BOX_HEIGHT_STEP = 10;

/** Below this: error furniture.drawer_too_low. */
export const DRAWER_MIN_BOX_HEIGHT = 60;

/** Drawer bottom groove depth. */
export const DRAWER_BOTTOM_GROOVE_DEPTH = 6;

/** Groove from the bottom edge of box sides. */
export const DRAWER_BOTTOM_OFFSET_SIDE_MOUNT = 10;

/** Drawers behind doors: available depth reduced by this. */
export const BEHIND_DOOR_DEPTH_CLEARANCE = 20;

/** Drawers behind hinged doors: opening width reduced by 2 x this. */
export const BEHIND_DOOR_SIDE_PACKER = 20;

/** Hanging rod section interior depth below this: warning. */
export const HANGING_MIN_DEPTH = 530;

/** Hanging rod section height below this: warning. */
export const HANGING_MIN_HEIGHT = 900;

/** Rod section width above this: warning furniture.rod_span_long. */
export const ROD_MAX_SPAN = 1200;

/** Default rod top clearance. */
export const DEFAULT_ROD_TOP_CLEARANCE = 60;

/** Cams per joint = max(2, ceil(jointLength / 320)). */
export const CAM_SPACING = 320;

/** Floor units this tall or taller get one anti-tip kit. */
export const ANTI_TIP_MIN_HEIGHT = 1500;

/** Screw packs = max(1, ceil(partCount / 30)). */
export const SCREW_PACK_PARTS = 30;

/** Handle offset from the leaf opening edge (3D only). */
export const HANDLE_EDGE_OFFSET = 40;

/** Tall floor units: handle centre height (3D only). */
export const TALL_HANDLE_HEIGHT = 1050;

/** Table stretcher height. */
export const TABLE_STRETCHER_HEIGHT = 60;

/** Stretcher bottom above floor. */
export const TABLE_STRETCHER_ELEVATION = 150;

/** Under-top drawer front height when there is no apron. */
export const TABLE_DRAWER_FRONT_HEIGHT = 120;

/** Between under-top drawers. */
export const TABLE_DRAWER_SPACING = 50;

/** Table drawer max width. */
export const TABLE_DRAWER_MAX_WIDTH = 600;

/** Trestle foot/cleat height. */
export const TRESTLE_BEAM_HEIGHT = 80;

/** Modesty max height. */
export const MODESTY_MAX_HEIGHT = 400;

/** Table lower shelf bottom above floor. */
export const LOWER_SHELF_ELEVATION = 100;

/** Maximum generated parts per design (03 §2.4). */
export const MAX_PARTS = 400;

/**
 * `Math.floor(v + 1e-6)`: a floor that is robust to binary floating point
 * (07 §1). Used whenever an exact rational value must become integer mm;
 * never use `Math.round` for part sizes.
 */
export const fl = (v: number): number => Math.floor(v + 1e-6);
