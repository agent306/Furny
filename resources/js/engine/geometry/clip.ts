/**
 * Clipper2 wrapper (04 §2.6). The only module that imports `clipper2-ts`.
 *
 * Coordinates are scaled by `CLIPPER_SCALE` to integer `Path64`s, run with
 * `FillRule.NonZero` and scaled back. Outputs: outer rings CW (`signedArea > 0`),
 * holes CCW, rings under 1 mm² dropped, `-0` normalised to `0`.
 */
import {
    Clipper64,
    ClipperOffset,
    ClipType,
    EndType,
    FillRule,
    JoinType,
    PathType,
    PolyTree64,
    type Path64,
    type Paths64,
    type PolyPath64,
} from 'clipper2-ts';
import {
    area,
    ensureCCW,
    ensureCW,
    signedArea,
    type PolygonWithHoles,
    type Ring,
} from './polygon';
import { CLIPPER_SCALE, MITER_LIMIT } from './tolerance';

/** mm²; smaller rings are slivers and are dropped. */
const MIN_RING_AREA = 1;

export type OffsetJoin = 'miter' | 'square' | 'round';

const JOIN_TYPES: Record<OffsetJoin, JoinType> = {
    miter: JoinType.Miter,
    square: JoinType.Square,
    round: JoinType.Round,
};

function toPath(r: Ring): Path64 {
    return r.map((p) => ({
        x: Math.round(p.x * CLIPPER_SCALE),
        y: Math.round(p.y * CLIPPER_SCALE),
    }));
}

/**
 * Outer rings CW and holes CCW, so `NonZero` treats holes as holes.
 * Rings with fewer than three vertices are skipped.
 */
function toPaths(polys: PolygonWithHoles[]): Paths64 {
    const paths: Paths64 = [];
    for (const p of polys) {
        if (p.outer.length < 3) continue;
        paths.push(toPath(ensureCW(p.outer)));
        for (const h of p.holes) {
            if (h.length >= 3) paths.push(toPath(ensureCCW(h)));
        }
    }
    return paths;
}

/** Scales back to mm; `+ 0` turns `-0` into `0`. */
function fromPath(path: Path64): Ring {
    return path.map((p) => ({
        x: p.x / CLIPPER_SCALE + 0,
        y: p.y / CLIPPER_SCALE + 0,
    }));
}

function isSignificant(r: Ring): boolean {
    return r.length >= 3 && Math.abs(signedArea(r)) >= MIN_RING_AREA;
}

/**
 * Walks a Clipper tree: a non-hole node is an outer ring and its children are
 * its holes; the children of a hole are islands, i.e. outers again.
 */
function collectPolygons(
    node: PolyPath64,
    out: PolygonWithHoles[],
): PolygonWithHoles[] {
    for (let i = 0; i < node.count; i++) {
        const outerNode = node.child(i);
        const outer = fromPath(outerNode.polygon ?? []);
        const holes: Ring[] = [];
        const islands: PolyPath64[] = [];
        for (let j = 0; j < outerNode.count; j++) {
            const holeNode = outerNode.child(j);
            const hole = fromPath(holeNode.polygon ?? []);
            if (isSignificant(hole)) holes.push(ensureCCW(hole));
            islands.push(holeNode);
        }
        if (isSignificant(outer)) {
            out.push({ outer: ensureCW(outer), holes });
            for (const hole of islands) collectPolygons(hole, out);
        }
    }
    return out;
}

function run(
    clipType: ClipType,
    subject: PolygonWithHoles[],
    clip: PolygonWithHoles[],
): PolygonWithHoles[] {
    const subjectPaths = toPaths(subject);
    if (subjectPaths.length === 0) return [];
    const c = new Clipper64();
    c.addPaths(subjectPaths, PathType.Subject);
    const clipPaths = toPaths(clip);
    if (clipPaths.length > 0) c.addPaths(clipPaths, PathType.Clip);
    const tree = new PolyTree64();
    c.execute(clipType, FillRule.NonZero, tree);
    return collectPolygons(tree, []);
}

/** Union of all polygons (overlapping or touching ones merge). */
export function union(polys: PolygonWithHoles[]): PolygonWithHoles[] {
    return run(ClipType.Union, polys, []);
}

/** `subject − clip`. */
export function difference(
    subject: PolygonWithHoles[],
    clip: PolygonWithHoles[],
): PolygonWithHoles[] {
    return run(ClipType.Difference, subject, clip);
}

/** `a ∩ b`. */
export function intersection(
    a: PolygonWithHoles[],
    b: PolygonWithHoles[],
): PolygonWithHoles[] {
    if (b.length === 0) return [];
    return run(ClipType.Intersection, a, b);
}

/**
 * Offsets every polygon by `delta` mm (positive grows outers and shrinks
 * holes, negative the reverse). `miterLimit` is only used by `'miter'`.
 */
export function offset(
    polys: PolygonWithHoles[],
    delta: number,
    join: OffsetJoin,
    miterLimit: number = MITER_LIMIT,
): PolygonWithHoles[] {
    const paths = toPaths(polys);
    if (paths.length === 0) return [];
    const co = new ClipperOffset(miterLimit);
    co.addPaths(paths, JOIN_TYPES[join], EndType.Polygon);
    const tree = new PolyTree64();
    co.execute(delta * CLIPPER_SCALE, tree);
    return collectPolygons(tree, []);
}

/** Total area (mm²) of `a ∩ b`. */
export function intersectionArea(
    a: PolygonWithHoles[],
    b: PolygonWithHoles[],
): number {
    let sum = 0;
    for (const p of intersection(a, b)) sum += area(p);
    return sum;
}
