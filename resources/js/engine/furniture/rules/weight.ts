/**
 * Part weights (07 §6.1): density x finished length x width x thickness.
 * Hardware is ignored.
 */
import type { BoardType } from '../../catalog/snapshot';
import type { CatalogIndex } from '../catalogIndex';
import type { Part } from '../types';

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

/**
 * Weight in kg of one piece of `part` (its `qty` is not applied). A material
 * code missing from the catalog weighs nothing: generation replaces unknown
 * codes, so this only happens for hand-built parts.
 */
export function partWeightKg(
    part: Pick<Part, 'materialCode' | 'length' | 'width' | 'thickness'>,
    idx: CatalogIndex,
): number {
    const material = idx.material(part.materialCode);
    if (!material) return 0;
    return (
        (idx.densityOf(material) * part.length * part.width * part.thickness) /
        1e9
    );
}

/**
 * Weight in kg of a set of parts, e.g. one leaf (glass doors: the frame and
 * the glass panel), each part counted `qty` times.
 */
export function leafWeightKg(
    parts: ReadonlyArray<
        Pick<Part, 'materialCode' | 'length' | 'width' | 'thickness' | 'qty'>
    >,
    idx: CatalogIndex,
): number {
    return parts.reduce(
        (kg, part) => kg + partWeightKg(part, idx) * part.qty,
        0,
    );
}

/** A weight for issue params: kg with one decimal (07 §6.1). */
export const roundKg = (kg: number): number => Math.round(kg * 10) / 10;
