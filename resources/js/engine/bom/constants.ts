/** BOM constants (08 §0, §3.3, §4.2). */

/** Trimming allowance per banded edge segment, mm. */
export const EDGE_ALLOWANCE_MM = 50;

/** Edge band waste on top of length + allowance, per mille (5 %). */
export const EDGE_WASTE_PERMILLE = 50;

/** Finish areas are priced in steps of this many mm² (0.01 m², 08 §4.2). */
export const FINISH_AREA_STEP_MM2 = 10_000;
