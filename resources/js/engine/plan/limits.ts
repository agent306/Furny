/**
 * Plan size and value limits (03 §1.1, 04 §6.6 intro), defined once for
 * `validatePlan` and the plan commands. A leaf module with no imports, so
 * both can use it without an import cycle.
 */

/** `plan.too_large`: most walls in a plan. */
export const MAX_WALLS = 2000;
/** `plan.too_large`: most openings in a plan. */
export const MAX_OPENINGS = 1000;
/** `plan.too_large`: most furniture placements in a plan. */
export const MAX_PLACEMENTS = 500;
/** `plan.too_large`: most fixtures in a plan. */
export const MAX_FIXTURES = 1000;
/** `plan.too_large`: JSON size of a plan, bytes. */
export const MAX_JSON_BYTES = 2_097_152;

/** `[min, max]` of a wall's thickness, mm. */
export const WALL_THICKNESS_RANGE = [50, 1000] as const;
/** `[min, max]` of a wall's height, mm. */
export const WALL_HEIGHT_RANGE = [300, 10_000] as const;
/** `[min, max]` of an opening's width, mm. */
export const OPENING_WIDTH_RANGE = [300, 6000] as const;
/** `[min, max]` of an opening's height, mm (its upper limit is the wall height above the sill). */
export const OPENING_HEIGHT_RANGE = [300, 10_000] as const;
/** `[min, max]` of an opening's sill height, mm. */
export const OPENING_SILL_RANGE = [0, 3000] as const;
/** `[min, max]` of a fixture's width and depth, mm. */
export const FIXTURE_SIZE_RANGE = [50, 20_000] as const;
/** `[min, max]` of a fixture's height, mm. */
export const FIXTURE_HEIGHT_RANGE = [0, 10_000] as const;
/** `[min, max]` of a placement's or fixture's elevation, mm. */
export const ELEVATION_RANGE = [0, 10_000] as const;
/** `[min, max]` of a text label's font size, mm. */
export const LABEL_FONT_SIZE_RANGE = [50, 5000] as const;
/** `[min, max]` characters (code points) of a text label after trimming. */
export const LABEL_TEXT_RANGE = [1, 200] as const;
/** `[min, max]` characters (code points) of a room name after trimming. */
export const ROOM_NAME_RANGE = [0, 80] as const;
/** Largest `|offset|` of a dimension, mm. */
export const DIMENSION_OFFSET_MAX = 50_000;
/** Shortest dimension, mm. */
export const DIMENSION_MIN_LENGTH = 10;
