/**
 * Test-only solid check: part boxes may touch but never intersect.
 * Not exported from the engine index.
 */
import type { Box3, Part } from '../types';

/** Intersections up to this depth (mm) on any one axis count as touching. */
export const OVERLAP_TOLERANCE = 0.5;

/** The parts of one drawer box: the bottom sits in grooves of the sides, front and back. */
const DRAWER_BOX_PART =
    /^(.*\.drawer\.\d+)\.(side\.left|side\.right|back|bottom)$/;

/** True for two parts of the same drawer box, which interlock by construction (07 §3.12). */
export function sameDrawerBox(a: Part, b: Part): boolean {
    const ma = DRAWER_BOX_PART.exec(a.key);
    const mb = DRAWER_BOX_PART.exec(b.key);
    return ma !== null && mb !== null && ma[1] === mb[1];
}

/** A part's box; an extruded part (a shaped top) by its outline's bounding box. */
function boxOf(part: Part): Box3 {
    const g = part.geometry;
    if (g.kind === 'box') return g.box;
    const xs = g.outline.map(([x]) => x);
    const zs = g.outline.map(([, z]) => z);
    const x0 = Math.min(...xs);
    const z0 = Math.min(...zs);
    return {
        min: [x0, g.y, z0],
        size: [Math.max(...xs) - x0, g.thickness, Math.max(...zs) - z0],
    };
}

/** Depth of the intersection of two boxes along each axis (negative: apart). */
function intersection(a: Box3, b: Box3): [number, number, number] {
    const along = (i: 0 | 1 | 2): number =>
        Math.min(a.min[i] + a.size[i], b.min[i] + b.size[i]) -
        Math.max(a.min[i], b.min[i]);
    return [along(0), along(1), along(2)];
}

/**
 * Every pair of box parts that intersect by more than `tolerance` on all
 * three axes, as `"keyA x keyB: dx x dy x dz"`, in part order. Extruded parts
 * (shaped tops) count by their outline's bounding box; pairs `ignore`
 * accepts (default: parts of one drawer box) are skipped.
 */
export function partOverlaps(
    parts: readonly Part[],
    options: {
        tolerance?: number;
        ignore?: (a: Part, b: Part) => boolean;
    } = {},
): string[] {
    const tolerance = options.tolerance ?? OVERLAP_TOLERANCE;
    const ignore = options.ignore ?? sameDrawerBox;
    const out: string[] = [];
    parts.forEach((a, i) => {
        const ba = boxOf(a);
        for (const b of parts.slice(i + 1)) {
            if (ignore(a, b)) continue;
            const bb = boxOf(b);
            const depth = intersection(ba, bb);
            if (depth.every((d) => d > tolerance)) {
                const size = depth.map((d) => Math.round(d * 10) / 10);
                out.push(`${a.key} x ${b.key}: ${size.join(' x ')}`);
            }
        }
    });
    return out;
}
