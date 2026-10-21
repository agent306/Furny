/**
 * Footprint snapping (04 §5.8): a furniture or fixture footprint dragged
 * across the plan attaches to wall faces (taking the face's rotation), aligns
 * with neighbouring footprints and otherwise falls back to the grid.
 *
 * Plan space is x right, y down (04 §2.1). Results are integer millimetres
 * (rotation 0.01 degree), never `-0`, and depend on nothing but the inputs:
 * faces and footprints come from the sorted index, and ties go to the earlier
 * candidate. `exclude` is matched against footprint ids and wall ids only; a
 * node id there has no effect (placements have no nodes).
 */
import { roundMm } from '../geometry/tolerance';
import {
    add,
    dist,
    dot,
    frontVector,
    normDeg,
    rotationFromFront,
    scale,
    sub,
    type Vec2,
} from '../geometry/vec2';
import type { DerivedPlan } from './derive';
import { gridPoint, rawPoint, rawStepFor } from './grid';
import { query, type SnapIndex, type SnapFootprintItem } from './snapIndex';
import {
    ALIGNMENT_RADIUS_PX,
    SLACK,
    snapTolerance,
    TIE_EPS,
    z,
    type SnapPointerType,
} from './snapShared';
import type {
    SnapGuide,
    SnapMarker,
    SnapModifiers,
    SnapSettings,
} from './snapping';

export interface FootprintSnapInput {
    /** Where the back centre would be without snapping (pointer + grab offset). */
    cursorBackCenter: Vec2;
    /** Clockwise degrees. */
    rotation: number;
    width: number;
    depth: number;
    /** Carried for callers; the §5.8 algorithm does not use the vertical range. */
    elevation: number;
    height: number;
    /** Screen px per mm. */
    zoom: number;
    pointerType: SnapPointerType;
    modifiers: SnapModifiers;
    /** Footprint ids (the dragged item) and wall ids to ignore. */
    exclude: ReadonlySet<string>;
    settings: SnapSettings;
    /** `true` while rotating with a handle; `false` while moving. */
    keepRotation: boolean;
}

export interface FootprintSnapResult {
    /** Integer mm. */
    backCenter: Vec2;
    /** Clockwise degrees in `[0, 360)`, 0.01 degree precision. */
    rotation: number;
    wallAttachment: { wallId: string; side: 'left' | 'right' } | null;
    guides: SnapGuide[];
    markers: SnapMarker[];
}

/** With `keepRotation`, a face qualifies within this many degrees (04 §5.8-2). */
const KEEP_ROTATION_TOL_DEG = 1;
/** Neighbours align when their rotation is a multiple of 90 degrees off (±). */
const ALIGN_ROTATION_TOL_DEG = 0.5;

/** `deg` normalised into `[0, 360)` and rounded to 0.01 degree. */
function cleanRotation(deg: number): number {
    return z(normDeg(Math.round(normDeg(deg) * 100) / 100));
}

/** Smallest absolute difference of two angles, in degrees. */
function angleGap(a: number, b: number): number {
    const d = normDeg(a - b);
    return Math.min(d, 360 - d);
}

/** Right-hand axis of a footprint with front vector `f` (04 §5.8). */
const rightOf = (f: Vec2): Vec2 => ({ x: f.y, y: -f.x });

const cleanPoint = (p: Vec2): Vec2 => ({ x: z(p.x), y: z(p.y) });

interface FaceHit {
    wallId: string;
    side: 'left' | 'right';
    rotation: number;
    p0: Vec2;
    p1: Vec2;
    dir: Vec2;
    length: number;
    /** Distance from the cursor to the face line. */
    dist: number;
    /** Cursor projection on the face, mm from `p0`. */
    t: number;
}

/** The qualifying wall face nearest to the cursor (04 §5.8-2), if any. */
function findFace(
    input: FootprintSnapInput,
    index: SnapIndex,
    geom: DerivedPlan,
    faceTol: number,
): FaceHit | null {
    const c = input.cursorBackCenter;
    const slack = input.width / 2;
    const r = faceTol + slack;
    let best: FaceHit | null = null;
    for (const f of query(index.faces, c.x - r, c.y - r, c.x + r, c.y + r)) {
        if (input.exclude.has(f.wallId)) continue;
        const wall = geom.walls[f.wallId];
        if (wall === undefined) continue;
        // Faces run from the a end to the b end, whatever the stored order.
        const forward = dot(sub(f.b, f.a), wall.dir) >= 0;
        const p0 = forward ? f.a : f.b;
        const p1 = forward ? f.b : f.a;
        const length = dist(p0, p1);
        if (length < 1e-9) continue;
        const dir = scale(sub(p1, p0), 1 / length);
        const rel = sub(c, p0);
        const distance = Math.abs(dot(rel, wall.normal));
        const t = dot(rel, dir);
        if (distance > faceTol || t < -slack || t > length + slack) continue;
        const front = f.side === 'left' ? wall.normal : scale(wall.normal, -1);
        const rotation = cleanRotation(rotationFromFront(front));
        if (
            input.keepRotation &&
            angleGap(input.rotation, rotation) > KEEP_ROTATION_TOL_DEG
        ) {
            continue;
        }
        if (best === null || distance < best.dist - TIE_EPS) {
            best = {
                wallId: f.wallId,
                side: f.side,
                rotation,
                p0,
                p1,
                dir,
                length,
                dist: distance,
                t,
            };
        }
    }
    return best;
}

type FaceSnap = 'corner' | 'centre';

interface FacePlacement {
    hit: FaceHit;
    /** Back centre clamped onto the face, before any target snap (float). */
    free: Vec2;
    /** Back centre after the target snap, or `free` when none applied (float). */
    at: Vec2;
    /** Which target `at` sits on, if any. */
    snap: FaceSnap | null;
    /** The face is at least as long as the footprint is wide. */
    fits: boolean;
    /** Valid `t` range: `[w/2, L-w/2]` when `fits`, else the whole face `[0, L]`. */
    bounds: [number, number];
    marker: SnapMarker | null;
}

/**
 * Clamps and target-snaps the position along the face (04 §5.8-2). Every
 * target is measured against the clamped cursor position, so the nearest
 * target within `tol` wins (ties go to the earlier of corner at the face
 * start, corner at the face end, face centre).
 */
function placeOnFace(hit: FaceHit, width: number, tol: number): FacePlacement {
    const fits = hit.length >= width;
    const lo = width / 2;
    const hi = hit.length - width / 2;
    const bounds: [number, number] = fits ? [lo, hi] : [0, hit.length];
    const t0 = Math.min(bounds[1], Math.max(bounds[0], hit.t));
    const targets: Array<{ t: number; corner: Vec2 | null }> = fits
        ? [
              { t: lo, corner: hit.p0 },
              { t: hi, corner: hit.p1 },
              { t: hit.length / 2, corner: null },
          ]
        : [{ t: hit.length / 2, corner: null }];
    let chosen: { t: number; corner: Vec2 | null } | null = null;
    let bestGap = Infinity;
    for (const target of targets) {
        const gap = Math.abs(t0 - target.t);
        if (gap <= tol && gap < bestGap - TIE_EPS) {
            bestGap = gap;
            chosen = target;
        }
    }
    const free = add(hit.p0, scale(hit.dir, t0));
    return {
        hit,
        free,
        at: chosen === null ? free : add(hit.p0, scale(hit.dir, chosen.t)),
        snap:
            chosen === null
                ? null
                : chosen.corner === null
                  ? 'centre'
                  : 'corner',
        fits,
        bounds,
        marker:
            chosen === null || chosen.corner === null
                ? null
                : { kind: 'endpoint', at: cleanPoint(chosen.corner) },
    };
}

/** `at` moved along the face so that its `t` lies within the face bounds. */
function clampToFace(at: Vec2, face: FacePlacement): Vec2 {
    const t = dot(sub(at, face.hit.p0), face.hit.dir);
    const clamped = Math.min(face.bounds[1], Math.max(face.bounds[0], t));
    return add(at, scale(face.hit.dir, clamped - t));
}

/** `at` moved along `axis` to the nearest multiple of `step` (anchored at the plan origin). */
function roundAlong(at: Vec2, axis: Vec2, step: number): Vec2 {
    const s = dot(at, axis);
    return add(at, scale(axis, Math.round(s / step) * step - s));
}

/** One aligned axis: how far to move and the neighbour that was aligned to. */
interface AxisSnap {
    delta: number;
    /** Aligned coordinate on this axis. */
    value: number;
    /** Extent of the neighbour on the other axis, for the guide. */
    other: [number, number];
}

interface Frame {
    r: Vec2;
    f: Vec2;
}

/** Extent of `corners` along `axis`. */
function extent(corners: readonly Vec2[], axis: Vec2): [number, number] {
    let lo = Infinity;
    let hi = -Infinity;
    for (const c of corners) {
        const v = dot(c, axis);
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
    }
    return [lo, hi];
}

/** Our four corners with the back centre at `at`. */
function cornersAt(
    at: Vec2,
    frame: Frame,
    width: number,
    depth: number,
): Vec2[] {
    const half = scale(frame.r, width / 2);
    const back = [sub(at, half), add(at, half)];
    const reach = scale(frame.f, depth);
    return [...back, ...back.map((p) => add(p, reach))];
}

/** Edge-to-edge (same or opposite) and centre-to-centre pairs of two extents. */
function alignDeltas(
    ours: [number, number],
    theirs: [number, number],
): Array<{ delta: number; value: number }> {
    const mine = [ours[0], ours[1]];
    const other = [theirs[0], theirs[1]];
    const out: Array<{ delta: number; value: number }> = [];
    for (const o of mine) {
        for (const t of other) out.push({ delta: t - o, value: t });
    }
    const centre = (e: [number, number]): number => (e[0] + e[1]) / 2;
    out.push({
        delta: centre(theirs) - centre(ours),
        value: centre(theirs),
    });
    return out;
}

interface Alignment {
    /** Along our right axis (the face direction when attached). */
    r: AxisSnap | null;
    /** Along our front axis. */
    f: AxisSnap | null;
}

/**
 * Footprint alignment (04 §5.8-3): per axis, the smallest move within `tol`
 * that lines one of our edges or the centre up with a neighbour's. Only
 * neighbours whose rotation equals ours modulo 90 degrees count.
 */
function alignWithNeighbours(
    input: FootprintSnapInput,
    index: SnapIndex,
    at: Vec2,
    frame: Frame,
    rotation: number,
    tol: number,
    axes: { r: boolean; f: boolean },
    acceptR: (delta: number) => boolean,
): Alignment {
    const result: Alignment = { r: null, f: null };
    const ours = cornersAt(at, frame, input.width, input.depth);
    const radius = ALIGNMENT_RADIUS_PX / input.zoom;
    const xs = ours.map((p) => p.x);
    const ys = ours.map((p) => p.y);
    const near = query(
        index.footprints,
        Math.min(...xs) - radius,
        Math.min(...ys) - radius,
        Math.max(...xs) + radius,
        Math.max(...ys) + radius,
    );
    const ourR = extent(ours, frame.r);
    const ourF = extent(ours, frame.f);
    let bestR = Infinity;
    let bestF = Infinity;
    for (const item of near) {
        if (input.exclude.has(item.id)) continue;
        if (!isAligned(item, rotation)) continue;
        const corners = item.footprint.corners;
        const theirR = extent(corners, frame.r);
        const theirF = extent(corners, frame.f);
        if (axes.r) {
            for (const c of alignDeltas(ourR, theirR)) {
                const gap = Math.abs(c.delta);
                if (gap <= tol && gap < bestR - TIE_EPS && acceptR(c.delta)) {
                    bestR = gap;
                    result.r = {
                        delta: c.delta,
                        value: c.value,
                        other: theirF,
                    };
                }
            }
        }
        if (axes.f) {
            for (const c of alignDeltas(ourF, theirF)) {
                const gap = Math.abs(c.delta);
                if (gap <= tol && gap < bestF - TIE_EPS) {
                    bestF = gap;
                    result.f = {
                        delta: c.delta,
                        value: c.value,
                        other: theirR,
                    };
                }
            }
        }
    }
    return result;
}

/** The neighbour's rotation equals ours modulo 90 degrees (±0.5). */
function isAligned(item: SnapFootprintItem, rotation: number): boolean {
    const gap = normDeg(item.footprint.rotation - rotation) % 90;
    return Math.min(gap, 90 - gap) <= ALIGN_ROTATION_TOL_DEG;
}

/** Guides spanning our footprint at its final position and the aligned neighbours. */
function alignmentGuides(
    align: Alignment,
    at: Vec2,
    frame: Frame,
    width: number,
    depth: number,
): SnapGuide[] {
    const ours = cornersAt(at, frame, width, depth);
    const ourR = extent(ours, frame.r);
    const ourF = extent(ours, frame.f);
    const guides: SnapGuide[] = [];
    const line = (
        along: Vec2,
        across: Vec2,
        value: number,
        lo: number,
        hi: number,
    ): SnapGuide => ({
        kind: 'alignment',
        a: cleanPoint(add(scale(across, value), scale(along, lo))),
        b: cleanPoint(add(scale(across, value), scale(along, hi))),
    });
    if (align.r !== null) {
        const [lo, hi] = [
            Math.min(ourF[0], align.r.other[0]),
            Math.max(ourF[1], align.r.other[1]),
        ];
        guides.push(line(frame.f, frame.r, align.r.value, lo, hi));
    }
    if (align.f !== null) {
        const [lo, hi] = [
            Math.min(ourR[0], align.f.other[0]),
            Math.max(ourR[1], align.f.other[1]),
        ];
        guides.push(line(frame.r, frame.f, align.f.value, lo, hi));
    }
    return guides;
}

const roundedPoint = (p: Vec2): Vec2 => ({
    x: z(roundMm(p.x)),
    y: z(roundMm(p.y)),
});

/**
 * Snaps a dragged footprint (04 §5.8):
 *
 * 1. Alt or snapping disabled: raw rounding, rotation kept, no attachment;
 * 2. wall faces within `2 x tol` (not gated by `kinds.on_face`, which is the
 *    Dimension/Measure snap): attach, take the face rotation, clamp the back
 *    centre inside the face and snap it to the nearest of the two corner-flush
 *    positions and the face centre;
 * 3. alignment with neighbouring footprints, per axis (along the face only
 *    when attached). Along a face the priority is corner-flush, then
 *    alignment, then the face centre;
 * 4. the grid when neither a face nor an alignment applied. Any coordinate
 *    left free rounds to the raw step.
 */
export function snapFootprint(
    input: FootprintSnapInput,
    index: SnapIndex,
    geom: DerivedPlan,
): FootprintSnapResult {
    const { settings, cursorBackCenter: c } = input;
    const kinds = settings.kinds;
    if (!settings.enabled || input.modifiers.alt) {
        return {
            backCenter: rawPoint(c, input.zoom),
            rotation: cleanRotation(input.rotation),
            wallAttachment: null,
            guides: [],
            markers: [],
        };
    }

    const tol = snapTolerance(input.pointerType, input.zoom);
    // Wall attach is not gated by `kinds.on_face`: that kind is the
    // Dimension/Measure snap. Alt or `enabled: false` (above) turn it off.
    const hit = findFace(input, index, geom, 2 * tol);
    const face = hit === null ? null : placeOnFace(hit, input.width, tol);

    const rotation =
        face === null ? cleanRotation(input.rotation) : face.hit.rotation;
    const front = frontVector(rotation);
    const frame: Frame = { f: front, r: rightOf(front) };
    // Alignment is measured from the position before a centre snap, so an
    // alignment in reach beats the face centre; a corner snap beats both.
    const base = face === null ? c : face.free;
    let at = face === null ? c : face.at;

    let alignment: Alignment = { r: null, f: null };
    if (kinds.alignment) {
        const alongFace = (delta: number): boolean => {
            if (face === null || !face.fits) return true;
            const t = dot(
                sub(add(base, scale(frame.r, delta)), face.hit.p0),
                face.hit.dir,
            );
            return t >= face.bounds[0] - SLACK && t <= face.bounds[1] + SLACK;
        };
        alignment = alignWithNeighbours(
            input,
            index,
            base,
            frame,
            rotation,
            tol,
            { r: face === null || face.snap !== 'corner', f: face === null },
            alongFace,
        );
        if (alignment.r !== null || alignment.f !== null) {
            at = add(
                base,
                add(
                    scale(frame.r, alignment.r?.delta ?? 0),
                    scale(frame.f, alignment.f?.delta ?? 0),
                ),
            );
            // A face shorter than the footprint cannot take the move whole.
            if (face !== null && !face.fits) at = clampToFace(at, face);
        }
    }
    const aligned = alignment.r !== null || alignment.f !== null;

    // Coordinates that nothing snapped round to the raw step (04 §5.3).
    const step = rawStepFor(input.zoom);
    if (face !== null) {
        if (face.snap === null && alignment.r === null) {
            at = clampToFace(roundAlong(at, face.hit.dir, step), face);
        }
    } else if (aligned) {
        if (alignment.r === null) at = roundAlong(at, frame.r, step);
        if (alignment.f === null) at = roundAlong(at, frame.f, step);
    }

    let backCenter: Vec2;
    if (face === null && !aligned) {
        backCenter =
            settings.gridVisible && kinds.grid
                ? gridPoint(c, input.zoom, settings.unitSystem)
                : rawPoint(c, input.zoom);
    } else {
        backCenter = roundedPoint(at);
    }

    const guides: SnapGuide[] = [];
    if (face !== null) {
        guides.push({
            kind: 'face',
            a: cleanPoint(face.hit.p0),
            b: cleanPoint(face.hit.p1),
        });
    }
    guides.push(
        ...alignmentGuides(alignment, at, frame, input.width, input.depth),
    );

    return {
        backCenter: { x: z(backCenter.x), y: z(backCenter.y) },
        rotation,
        wallAttachment:
            face === null
                ? null
                : { wallId: face.hit.wallId, side: face.hit.side },
        guides,
        markers: face?.marker == null ? [] : [face.marker],
    };
}
