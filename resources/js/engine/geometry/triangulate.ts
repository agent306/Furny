/** earcut wrapper (04 §2.7). The only module that imports `earcut`. */
import earcut from 'earcut';
import type { PolygonWithHoles, Ring } from './polygon';

export interface TriangleMesh {
    /** Flat `x, y` pairs in mm, outer ring first, then each hole. */
    positions: Float64Array;
    /** Triangle vertex indices (vertex numbers, not coordinate offsets). */
    indices: Uint32Array;
}

/**
 * Triangulates a polygon with holes. Every triangle is clockwise in plan
 * space (positive signed area, 04 §2.1-6).
 */
export function triangulate(p: PolygonWithHoles): TriangleMesh {
    const rings: Ring[] = [p.outer, ...p.holes.filter((h) => h.length >= 3)];
    if (p.outer.length < 3) {
        return { positions: new Float64Array(0), indices: new Uint32Array(0) };
    }

    const flat: number[] = [];
    const holeIndices: number[] = [];
    let vertexCount = 0;
    rings.forEach((ring, k) => {
        if (k > 0) holeIndices.push(vertexCount);
        for (const pt of ring) {
            flat.push(pt.x + 0, pt.y + 0);
            vertexCount++;
        }
    });

    const tris = earcut(flat, holeIndices, 2);
    const indices = new Uint32Array(tris.length);
    for (let t = 0; t + 2 < tris.length; t += 3) {
        const a = tris[t]!;
        let b = tris[t + 1]!;
        let c = tris[t + 2]!;
        const twiceArea =
            flat[2 * a]! * flat[2 * b + 1]! -
            flat[2 * b]! * flat[2 * a + 1]! +
            (flat[2 * b]! * flat[2 * c + 1]! -
                flat[2 * c]! * flat[2 * b + 1]!) +
            (flat[2 * c]! * flat[2 * a + 1]! - flat[2 * a]! * flat[2 * c + 1]!);
        if (twiceArea < 0) [b, c] = [c, b];
        indices[t] = a;
        indices[t + 1] = b;
        indices[t + 2] = c;
    }
    return { positions: Float64Array.from(flat), indices };
}
