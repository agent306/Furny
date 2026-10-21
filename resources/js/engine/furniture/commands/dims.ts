/**
 * `furniture.setDims` (07 §9): overall size, clamped to the ranges of 03 §2.4
 * (width 150-6000, height 100-3000, depth 100-1200). A round table keeps
 * `depth = width`.
 */
import { z } from 'zod';
import { DIMENSION_RANGES } from '../validate';
import { defineFurnitureCommand, mm } from './helpers';

const SetDimsSchema = z.object({
    width: z.number().optional(),
    height: z.number().optional(),
    depth: z.number().optional(),
});
type SetDimsParams = z.infer<typeof SetDimsSchema>;

const RANGE = Object.fromEntries(
    DIMENSION_RANGES.map(([name, min, max]) => [name, { min, max }]),
) as Record<'width' | 'height' | 'depth', { min: number; max: number }>;

const clamp = (value: number, min: number, max: number): number =>
    Math.min(max, Math.max(min, mm(value)));

/**
 * A round top is as wide as it is deep, so its diameter must fit both ranges:
 * 150 (the width minimum) to 1200 (the depth maximum). Rulings (ledgered for
 * the spec 19 reconciliation): the width leads when both are given, and the
 * depth alone sets the diameter when no width is given.
 */
const DIAMETER = { min: RANGE.width.min, max: RANGE.depth.max };

const setDims = defineFurnitureCommand<SetDimsParams>({
    type: 'furniture.setDims',
    labelKey: 'engine.furniture.command.label.set_dims',
    paramsSchema: SetDimsSchema,
    validate: () => null,
    run(d, p) {
        if (p.height !== undefined) {
            d.dims.height = clamp(p.height, RANGE.height.min, RANGE.height.max);
        }
        if (d.table?.top.shape === 'round') {
            const wanted = p.width ?? p.depth;
            if (wanted === undefined) return;
            const diameter = clamp(wanted, DIAMETER.min, DIAMETER.max);
            d.dims.width = diameter;
            d.dims.depth = diameter;
            return;
        }
        if (p.width !== undefined) {
            d.dims.width = clamp(p.width, RANGE.width.min, RANGE.width.max);
        }
        if (p.depth !== undefined) {
            d.dims.depth = clamp(p.depth, RANGE.depth.min, RANGE.depth.max);
        }
    },
    mergeKey: () => 'dims',
});

/** The size command, registered in `FURNITURE_COMMANDS` (07 §9). */
export const DIMS_COMMANDS = { 'furniture.setDims': setDims };
