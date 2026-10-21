/**
 * Long panel split (spec 19, ruling R40-1, modelled on the back split of
 * 07 §3.4.1). A horizontal run that does not fit one sheet of its material is
 * cut across its length (x) into pieces `<key>.1`, `<key>.2`, ... with the
 * greedy seam rule of §3.4.1: a seam goes over the centre of a support where
 * one is in reach, else the rest is split evenly. Each seam is a joint (07
 * §6.9). Issues: info `furniture.panel_split { partKey, count }` and, per seam
 * with nothing under or over it, warning
 * `furniture.panel_seam_unsupported { partKey, position }`.
 *
 * Sides and other vertical parts are never split; a piece that still fails
 * the sheet (or a part that cannot be split) is left to
 * `furniture.part_exceeds_sheet`.
 */
import { fl } from './constants';
import { makePart } from './parts';
import type { EdgeId } from './schema';
import { fitsSheet } from './sheetFit';
import type {
    Axis,
    Box3,
    GenContext,
    Part,
    PartGeometry,
    PartGrain,
    PhysEdge,
} from './types';

/** A seam is only supported by a candidate at least this far from the previous seam. */
const MIN_PIECE = 100;
/** Faces within this distance touch. */
const TOUCH_TOLERANCE = 0.5;
/** A support runs across at least this share of the panel's depth. */
const MIN_SUPPORT_SHARE = 0.5;

export interface Seam {
    at: number;
    supported: boolean;
}

/**
 * Seams over `[from, to]` so that no piece exceeds `maxSpan` (greedy, 07
 * §3.4.1 step 3): the largest support in `[s + 100, s + maxSpan]` when there
 * is one, else an even split of the rest. Nothing for a span that cannot fit.
 */
export function greedySeams(
    from: number,
    to: number,
    maxSpan: number,
    supports: readonly number[],
): Seam[] {
    const out: Seam[] = [];
    if (maxSpan <= 0) return out;
    let s = from;
    while (to - s > maxSpan) {
        const support = supports.filter(
            (c) => c >= s + MIN_PIECE && c <= s + maxSpan,
        );
        const best = support.length > 0 ? Math.max(...support) : undefined;
        const at =
            best ?? s + Math.ceil((to - s) / Math.ceil((to - s) / maxSpan));
        out.push({ at, supported: best !== undefined });
        s = at;
    }
    return out;
}

/** The horizontal runs that may be split (R40-1): carcass and table family. */
const SPLITTABLE: readonly RegExp[] = [
    /^carcass\.(top|bottom)$/,
    /^section\.[^.]+\.fixed_shelf\.\d+$/,
    /^plinth\.(front|back)$/,
    /^countertop$/,
    /^table\.top(\.layer\.\d+)?$/,
    /^table\.apron\.(front|back)$/,
    /^table\.stretcher\.(center|back)$/,
    /^table\.shelf$/,
];

const AXES: readonly Axis[] = ['x', 'y', 'z'];
const AXIS_INDEX: Record<Axis, 0 | 1 | 2> = { x: 0, y: 1, z: 2 };
const AXIS_OF_EDGE: Record<PhysEdge, Axis> = {
    left: 'x',
    right: 'x',
    bottom: 'y',
    top: 'y',
    back: 'z',
    front: 'z',
};
const EDGE_IDS: readonly EdgeId[] = ['L1', 'L2', 'W1', 'W2'];

const lo = (box: Box3, i: 0 | 1 | 2): number => box.min[i];
const hi = (box: Box3, i: 0 | 1 | 2): number => box.min[i] + box.size[i];

/** Axis-aligned bounds of a part's geometry. */
function boundsOf(geometry: PartGeometry): Box3 {
    if (geometry.kind === 'box') return geometry.box;
    const xs = geometry.outline.map(([x]) => x);
    const zs = geometry.outline.map(([, z]) => z);
    const x0 = Math.min(...xs);
    const z0 = Math.min(...zs);
    return {
        min: [x0, geometry.y, z0],
        size: [Math.max(...xs) - x0, geometry.thickness, Math.max(...zs) - z0],
    };
}

/** How `part` was laid out: thin, length and width axes and its intended grain axis. */
function axesOf(ctx: GenContext, part: Part) {
    const edges = ctx.edgeMap.get(part.key);
    if (!edges) return null;
    const lengthAxis = AXIS_OF_EDGE[edges.W1];
    const widthAxis = AXIS_OF_EDGE[edges.L1];
    const thin = AXES.find((a) => a !== lengthAxis && a !== widthAxis);
    if (!thin) return null;
    const grainAxis =
        part.grain === 'length'
            ? lengthAxis
            : part.grain === 'width'
              ? widthAxis
              : null;
    return { edges, thin, grainAxis };
}

/**
 * Convex polygon `[x, z]` ring clipped to `x0 <= x <= x1` (Sutherland-Hodgman
 * against the two vertical lines), orientation kept.
 */
function clipRingX(
    ring: ReadonlyArray<[number, number]>,
    x0: number,
    x1: number,
): Array<[number, number]> {
    const clip = (
        input: ReadonlyArray<[number, number]>,
        inside: (x: number) => boolean,
        edge: number,
    ): Array<[number, number]> => {
        const out: Array<[number, number]> = [];
        input.forEach((current, i) => {
            const prev =
                input[(i + input.length - 1) % input.length] ?? current;
            const crossing = (): [number, number] => {
                const t = (edge - prev[0]) / (current[0] - prev[0]);
                return [edge, prev[1] + t * (current[1] - prev[1])];
            };
            if (inside(current[0])) {
                if (!inside(prev[0])) out.push(crossing());
                out.push(current);
            } else if (inside(prev[0])) {
                out.push(crossing());
            }
        });
        // A vertex on a clip line comes out twice; keep one.
        return out.filter((point, i) => {
            const next = out[(i + 1) % out.length];
            return (
                out.length === 1 ||
                next === undefined ||
                point[0] !== next[0] ||
                point[1] !== next[1]
            );
        });
    };
    return clip(
        clip(ring, (x) => x >= x0, x0),
        (x) => x <= x1,
        x1,
    );
}

/**
 * The longest piece (along x) of a panel `cross` deep (along `crossAxis`)
 * that fits one sheet, or 0 when none does.
 */
function maxPieceLength(
    ctx: GenContext,
    part: Part,
    cross: number,
    crossAxis: Axis,
    grainAxis: Axis | null,
): number {
    const material = ctx.idx.material(part.materialCode) ?? ctx.mat(part.role);
    const trim = ctx.idx.snapshot.pricing.sheetTrimMm;
    const usable = [
        material.sheetLengthMm - 2 * trim,
        material.sheetWidthMm - 2 * trim,
    ].sort((a, b) => b - a);
    for (const v of usable) {
        const lengthAxis: Axis = v >= cross ? 'x' : crossAxis;
        const widthAxis: Axis = lengthAxis === 'x' ? crossAxis : 'x';
        const grain: PartGrain = !material.hasGrain
            ? 'none'
            : grainAxis === lengthAxis
              ? 'length'
              : grainAxis === widthAxis
                ? 'width'
                : 'none';
        if (fitsSheet(v, cross, material, grain, trim)) return v;
    }
    return 0;
}

/**
 * x-centres of the parts that carry a seam of `part`: parts touching one of
 * its faces (along `thin`), centred strictly inside its x-range, and running
 * across at least half of its depth (along `cross`) - partitions under a top,
 * plinth returns behind a plinth board, side aprons and end panels under a
 * table top. Parts as long along x as across are not supports.
 */
function supportsOf(
    ctx: GenContext,
    part: Part,
    box: Box3,
    thin: Axis,
    cross: Axis,
): number[] {
    const t = AXIS_INDEX[thin];
    const d = AXIS_INDEX[cross];
    const depth = box.size[d];
    const out: number[] = [];
    for (const other of ctx.parts) {
        if (other === part || other.geometry.kind !== 'box') continue;
        const ob = other.geometry.box;
        const touches =
            Math.abs(hi(ob, t) - lo(box, t)) <= TOUCH_TOLERANCE ||
            Math.abs(lo(ob, t) - hi(box, t)) <= TOUCH_TOLERANCE;
        if (!touches) continue;
        const centre = lo(ob, 0) + ob.size[0] / 2;
        if (centre <= lo(box, 0) || centre >= hi(box, 0)) continue;
        if (ob.size[0] >= ob.size[d]) continue;
        const across =
            Math.min(hi(ob, d), hi(box, d)) - Math.max(lo(ob, d), lo(box, d));
        if (across >= MIN_SUPPORT_SHARE * depth) out.push(centre);
    }
    return out.sort((a, b) => a - b);
}

/** Splits `part` (at `index` in `ctx.parts`) when it is too long for a sheet; returns the piece count. */
function splitPart(ctx: GenContext, part: Part, index: number): number {
    const material = ctx.idx.material(part.materialCode) ?? ctx.mat(part.role);
    const trim = ctx.idx.snapshot.pricing.sheetTrimMm;
    if (material.boardType === 'glass') return 1;
    if (fitsSheet(part.length, part.width, material, part.grain, trim))
        return 1;
    const axes = axesOf(ctx, part);
    if (!axes || axes.thin === 'x') return 1;
    const cross: Axis = axes.thin === 'y' ? 'z' : 'y';
    const box = boundsOf(part.geometry);
    const maxSpan = maxPieceLength(
        ctx,
        part,
        fl(box.size[AXIS_INDEX[cross]]),
        cross,
        axes.grainAxis,
    );
    const x0 = lo(box, 0);
    const x1 = hi(box, 0);
    const seams = greedySeams(
        x0,
        x1,
        maxSpan,
        supportsOf(ctx, part, box, axes.thin, cross),
    );
    if (seams.length === 0) return 1;

    const banded = new Set<PhysEdge>(
        EDGE_IDS.filter((id) => part.edges[id] !== null).map(
            (id) => axes.edges[id],
        ),
    );
    const bandCode = EDGE_IDS.map((id) => part.edges[id]).find(
        (code) => code !== null,
    );
    const cuts = [x0, ...seams.map((s) => s.at), x1];
    const pieces: Part[] = [];
    for (let k = 0; k + 1 < cuts.length; k++) {
        const a = cuts[k] ?? x0;
        const b = cuts[k + 1] ?? x1;
        let geometry: PartGeometry | undefined;
        let pieceBox: Box3 = {
            min: [a, box.min[1], box.min[2]],
            size: [b - a, box.size[1], box.size[2]],
        };
        if (part.geometry.kind === 'extruded') {
            const outline = clipRingX(part.geometry.outline, a, b);
            geometry = { ...part.geometry, outline };
            pieceBox = boundsOf(geometry);
        }
        const piece = makePart(
            {
                key: `${part.key}.${k + 1}`,
                nameKey: part.nameKey,
                nameParams: { ...part.nameParams, piece: k + 1 },
                role: part.role,
                materialCode: part.materialCode,
                box: pieceBox,
                thicknessAxis: axes.thin,
                grainAxis: axes.grainAxis,
                banded: [...banded].filter(
                    (edge) =>
                        !(edge === 'left' && k > 0) &&
                        !(edge === 'right' && k + 2 < cuts.length),
                ),
                bandCode: bandCode ?? null,
                visibleFaces: part.visibleFaces as 0 | 1 | 2,
                operations: k === 0 ? part.operations : undefined,
                geometry,
            },
            ctx,
        );
        pieces.push(piece);
    }
    ctx.parts.splice(index, 1, ...pieces);
    ctx.edgeMap.delete(part.key);

    // Joints of the panel go to the piece over the other part's centre.
    const pieceAt = (x: number): Part => {
        const k = seams.findIndex((seam) => x <= seam.at);
        return pieces[k === -1 ? pieces.length - 1 : k] as Part;
    };
    const centreOf = (key: string): number | undefined => {
        const other = ctx.parts.find((p) => p.key === key);
        if (!other) return undefined;
        const b = boundsOf(other.geometry);
        return lo(b, 0) + b.size[0] / 2;
    };
    for (const joint of ctx.joints) {
        if (joint.member === part.key) {
            joint.member = pieceAt(centreOf(joint.other) ?? x0).key;
        } else if (joint.other === part.key) {
            joint.other = pieceAt(centreOf(joint.member) ?? x0).key;
        }
    }

    const keys = pieces.map((p) => p.key);
    ctx.issue(
        'furniture.panel_split',
        'info',
        { partKey: part.key, count: pieces.length },
        keys,
    );
    seams.forEach((seam, k) => {
        const left = pieces[k] as Part;
        const right = pieces[k + 1] as Part;
        ctx.joints.push({
            member: left.key,
            other: right.key,
            length: fl(chordAt(left, seam.at, cross)),
        });
        if (!seam.supported) {
            ctx.issue(
                'furniture.panel_seam_unsupported',
                'warning',
                { partKey: part.key, position: seam.at },
                [left.key, right.key],
            );
        }
    });
    return pieces.length;
}

/** Length of the seam edge of `piece` at `x` (its depth there). */
function chordAt(piece: Part, x: number, cross: Axis): number {
    const g = piece.geometry;
    if (g.kind === 'box') return g.box.size[AXIS_INDEX[cross]];
    const zs = g.outline
        .filter(([px]) => Math.abs(px - x) <= TOUCH_TOLERANCE)
        .map(([, z]) => z);
    return zs.length > 0 ? Math.max(...zs) - Math.min(...zs) : 0;
}

/**
 * Splits every long horizontal run of the model (R40-1). Run after all parts
 * and joints exist and before the connectors (07 §6.9) are counted.
 */
export function splitLongPanels(ctx: GenContext): void {
    for (let i = 0; i < ctx.parts.length; i++) {
        const part = ctx.parts[i] as Part;
        if (!SPLITTABLE.some((re) => re.test(part.key))) continue;
        i += splitPart(ctx, part, i) - 1;
    }
}
