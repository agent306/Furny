/**
 * Small helpers shared by the snapping modules (`grid.ts`, `snapIndex.ts`,
 * `snapping.ts`, `snapOpening.ts`, `snapFootprint.ts`).
 */

/** Normalises `-0` so equal results compare equal and serialise alike. */
export const z = (n: number): number => (n === 0 ? 0 : n);

/** `[minX, minY, maxX, maxY]`. */
export type Box = readonly [number, number, number, number];

export type SnapPointerType = 'mouse' | 'pen' | 'touch';

const TOL_PX: Record<SnapPointerType, number> = {
    mouse: 8,
    pen: 8,
    touch: 16,
};

/** Base snap tolerance in mm for a pointer at `zoom` px per mm (04 §5.3). */
export function snapTolerance(
    pointerType: SnapPointerType,
    zoom: number,
): number {
    return TOL_PX[pointerType] / zoom;
}

/** Alignment lines come from items within this many screen px of the cursor (04 §5.4). */
export const ALIGNMENT_RADIUS_PX = 400;
