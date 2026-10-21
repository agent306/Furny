/** Wall symbols (04 §8.2): poché polygons and the single wall outline. */
import { difference } from '../../geometry/clip';
import { signedArea, type PolygonWithHoles } from '../../geometry/polygon';
import type { Vec2 } from '../../geometry/vec2';
import type { DerivedWall } from '../derive';
import type { Wall } from '../schema';
import { poly } from './shared';
import type { DrawGroup, DrawingOptions, StyleKey } from './types';

/** Cuts of at most this area (mm²) are zero-width openings: nothing to subtract. */
const MIN_CUT_AREA = 1;

function wallStyle(wall: Wall): StyleKey {
    if (wall.material === 'glass') return 'wall_glass';
    if (wall.kind === 'exterior') return 'wall_exterior';
    if (wall.kind === 'half') return 'wall_half';
    return 'wall';
}

/** One closed polygon per poché part (the wall body minus its opening cuts). */
export function drawWall(
    w: DerivedWall,
    wall: Wall,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- uniform draw* signature (04 §8.1)
    _opts: DrawingOptions,
): DrawGroup {
    const style = wallStyle(wall);
    return {
        entityId: wall.id,
        entityKind: 'wall',
        items: w.pocheParts.map((part) =>
            poly(part.outer, style, { holes: part.holes }),
        ),
    };
}

/**
 * The outline stroke of the whole plan, built from the union of the wall
 * outlines so internal joints stay invisible. The opening cut rectangles (the
 * ones that cut the poché, 04 §3.7) are subtracted, so the stroke leaves a
 * clean gap at every opening (05 §4.4). Drawn after the fills.
 */
export function drawWallOutline(
    wallsUnion: PolygonWithHoles[],
    cuts: Vec2[][] = [],
): DrawGroup {
    const solid = cuts.filter((c) => signedArea(c) > MIN_CUT_AREA);
    const parts =
        solid.length === 0 || wallsUnion.length === 0
            ? wallsUnion
            : difference(
                  wallsUnion,
                  solid.map((outer) => ({ outer, holes: [] })),
              );
    return {
        entityId: null,
        entityKind: 'wall',
        items: parts.map((part) =>
            poly(part.outer, 'wall_outline', { holes: part.holes }),
        ),
    };
}
