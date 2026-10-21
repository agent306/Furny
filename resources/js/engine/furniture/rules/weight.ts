/**
 * Part weight inputs (07 §6.1). Only the density table lives here for now;
 * `partWeightKg` arrives with the hardware rules.
 */
import type { BoardType } from '../../catalog/snapshot';

/** Default density in kg/m³ per board type, used when a material has none (07 §6.1). */
export const DEFAULT_DENSITY: Record<BoardType, number> = {
    particle_board: 650,
    mdf: 750,
    hdf: 900,
    plywood: 600,
    blockboard: 550,
    solid_wood: 700,
    glass: 2500,
    acrylic: 1190,
    metal_sheet: 7850,
};
