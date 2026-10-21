/**
 * Table top outlines (07 §3.13 top geometry): closed rings of `[x, z]` pairs
 * in the table's plan, `x ∈ [0, W]`, `z ∈ [0, D]` (furniture local space,
 * z toward the front). The rings are clockwise in the top view, where z
 * points down the screen: the shoelace sum over `[x, z]` is positive. The
 * first point is the one at angle 0 (the +x end), and the angle grows toward
 * +z. The last point does not repeat the first.
 */

/** Rounding of the ring coordinates: absorbs trigonometric noise, keeps rings deterministic. */
const PRECISION = 1e6;
const round = (v: number): number => Math.round(v * PRECISION) / PRECISION;

const samePoint = (a: [number, number], b: [number, number]): boolean =>
    a[0] === b[0] && a[1] === b[1];

/** `segments` points of the ellipse centred at (cx, cz) with radii rx, rz. */
function ellipseRing(
    cx: number,
    cz: number,
    rx: number,
    rz: number,
    segments: number,
): Array<[number, number]> {
    return Array.from({ length: segments }, (_, i) => {
        const angle = (2 * Math.PI * i) / segments;
        return [
            round(cx + rx * Math.cos(angle)),
            round(cz + rz * Math.sin(angle)),
        ];
    });
}

/**
 * A `W x D` rectangle with corners rounded to radius `r`, each corner arc
 * made of `segmentsPerCorner` segments (`segmentsPerCorner + 1` points per
 * corner, so `4 x (segmentsPerCorner + 1)` points; fewer at
 * `r = min(W, D) / 2`, where the corners meet and shared points appear
 * once). Starts at the front right corner (`[W, D − r]`). `r <= 0` gives
 * the 4 corners of the rectangle.
 */
export function roundedRectOutline(
    W: number,
    D: number,
    r: number,
    segmentsPerCorner = 8,
): Array<[number, number]> {
    if (r <= 0) {
        return [
            [W, D],
            [0, D],
            [0, 0],
            [W, 0],
        ];
    }
    const centres: Array<[number, number]> = [
        [W - r, D - r],
        [r, D - r],
        [r, r],
        [W - r, r],
    ];
    const ring = centres.flatMap(([cx, cz], corner) =>
        Array.from(
            { length: segmentsPerCorner + 1 },
            (_, i): [number, number] => {
                const angle = (Math.PI / 2) * (corner + i / segmentsPerCorner);
                return [
                    round(cx + r * Math.cos(angle)),
                    round(cz + r * Math.sin(angle)),
                ];
            },
        ),
    );
    // At r = W/2 or D/2 neighbouring corners meet: drop the repeated points.
    return ring.filter((point, i) => {
        const next = ring[(i + 1) % ring.length];
        return !(next && samePoint(point, next));
    });
}

/** A circle of diameter `d` in the `d x d` square, `segments` points. */
export function circleOutline(
    d: number,
    segments = 64,
): Array<[number, number]> {
    return ellipseRing(d / 2, d / 2, d / 2, d / 2, segments);
}

/** An ellipse filling the `W x D` rectangle, `segments` points. */
export function ellipseOutline(
    W: number,
    D: number,
    segments = 64,
): Array<[number, number]> {
    return ellipseRing(W / 2, D / 2, W / 2, D / 2, segments);
}
