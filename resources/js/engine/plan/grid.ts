/**
 * Grid and raw rounding (04 §5.3, §5.6).
 */
import { roundMm } from '../geometry/tolerance';
import type { Vec2 } from '../geometry/vec2';
import type { UnitSystem } from '../units/types';

/** Normalises `-0` so equal results compare equal and serialise alike. */
const z = (n: number): number => (n === 0 ? 0 : n);

const RAW_STEPS = [1, 5, 10, 50, 100] as const;
/** Positions finer than this many screen px are meaningless (§5.3). */
const RAW_STEP_MAX_PX = 4;

/** Rounding step in mm used when nothing snaps (§5.3). */
export function rawStepFor(zoom: number): number {
    let step = 1;
    for (const s of RAW_STEPS) {
        if (s * zoom <= RAW_STEP_MAX_PX) step = s;
    }
    return step;
}

interface GridLevel {
    step: number;
    major: number;
}

// Major spacings are literals so they carry no multiplication noise
// (e.g. 25.4 x 12 = 304.8 exactly as printed).
const METRIC_GRID: readonly GridLevel[] = [
    { step: 10, major: 100 },
    { step: 50, major: 250 },
    { step: 100, major: 1000 },
    { step: 500, major: 2500 },
    { step: 1000, major: 10000 },
    { step: 5000, major: 25000 },
    { step: 10000, major: 100000 },
];
const IMPERIAL_GRID: readonly GridLevel[] = [
    { step: 25.4, major: 304.8 },
    { step: 152.4, major: 304.8 },
    { step: 304.8, major: 1524 },
    { step: 1524, major: 7620 },
    { step: 3048, major: 6096 },
    { step: 15240, major: 30480 },
];
/** The grid is drawn no denser than this many screen px per step. */
const GRID_MIN_PX = 16;

/** The smallest grid step that is at least 16 px wide, and its major spacing (mm). */
export function gridStepFor(
    zoom: number,
    system: UnitSystem,
): { step: number; major: number } {
    const sequence = system === 'metric' ? METRIC_GRID : IMPERIAL_GRID;
    const level =
        sequence.find((l) => l.step * zoom >= GRID_MIN_PX) ??
        sequence[sequence.length - 1]!;
    return { step: level.step, major: level.major };
}

/** `cursor` rounded to the raw step of `rawStepFor(zoom)`. */
export function rawPoint(cursor: Vec2, zoom: number): Vec2 {
    const step = rawStepFor(zoom);
    return {
        x: z(roundMm(cursor.x / step) * step),
        y: z(roundMm(cursor.y / step) * step),
    };
}

/** The grid intersection nearest to `cursor`, anchored at the plan origin. */
export function gridPoint(
    cursor: Vec2,
    zoom: number,
    system: UnitSystem,
): Vec2 {
    const { step } = gridStepFor(zoom, system);
    return {
        x: roundMm(cursor.x / step) * step,
        y: roundMm(cursor.y / step) * step,
    };
}
