/** Wall symbols (04 §8.2): poché polygons and the single wall outline. */
import type { PolygonWithHoles } from '../../geometry/polygon';
import type { DerivedWall } from '../derive';
import type { Wall } from '../schema';
import { poly } from './shared';
import type { DrawGroup, DrawingOptions, StyleKey } from './types';

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
 * outlines so internal joints stay invisible. Drawn after the fills.
 */
export function drawWallOutline(wallsUnion: PolygonWithHoles[]): DrawGroup {
    return {
        entityId: null,
        entityKind: 'wall',
        items: wallsUnion.map((part) =>
            poly(part.outer, 'wall_outline', { holes: part.holes }),
        ),
    };
}
