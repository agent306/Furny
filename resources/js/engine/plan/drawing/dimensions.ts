/**
 * Dimension symbols (04 §8.2): the automatic wall dimensions and the user
 * dimension annotations share one row builder, so they look alike.
 */
import { EPS } from '../../geometry/tolerance';
import {
    add,
    dist,
    normalize,
    perpLeft,
    scale,
    type Vec2,
} from '../../geometry/vec2';
import { formatLength } from '../../units/format';
import type { DerivedWall } from '../derive';
import type { DimensionAnnotation, Wall } from '../schema';
import { degOf, line, r2, text } from './shared';
import type { DrawGroup, DrawItem, DrawingOptions } from './types';

/** Walls shorter than this get no automatic dimensions (mm). */
const MIN_AUTO_LENGTH = 300;
/** Automatic dimension line distance beyond the wall face (mm). */
const AUTO_OFFSET = 400;
/** Extra distance of the second (chain) row (mm). */
const CHAIN_OFFSET = 350;
/** Extension lines start this far off the measured edge and overshoot the line by it (mm). */
const EXT_GAP = 100;
/** Length of a 45 degree tick (mm). */
const TICK_LENGTH = 150;

/** Rotation in `[0, 360)` brought into (-90, 90] so text is never upside down. */
function uprightDeg(deg: number): number {
    if (deg > 270) return deg - 360;
    if (deg > 90) return deg - 180;
    return deg;
}

interface Row {
    /** Point of the reference line at `u = 0`. */
    origin: Vec2;
    /** Unit direction of the reference line. */
    dir: Vec2;
    /** Unit vector from the reference line towards the dimension line. */
    side: Vec2;
    /** Distance of the dimension line from the reference line. */
    offset: number;
    /** Positions along `dir` where a tick and an extension line stand; at least two. */
    stops: number[];
    /** Distance from the reference line at which the extension line at stop `i` starts. */
    gapAt(i: number): number;
}

function drawRow(
    row: Row,
    opts: DrawingOptions,
    withText: boolean,
): DrawItem[] {
    const { origin, dir, side, offset, stops } = row;
    const onLine = (u: number): Vec2 =>
        add(add(origin, scale(dir, u)), scale(side, offset));
    const first = stops[0]!;
    const last = stops[stops.length - 1]!;
    const items: DrawItem[] = [];

    stops.forEach((u, i) => {
        // A dimension line closer than the gap has no room for an extension line.
        if (offset < EXT_GAP) return;
        const base = add(origin, scale(dir, u));
        items.push(
            line(
                add(base, scale(side, row.gapAt(i))),
                add(base, scale(side, offset + EXT_GAP)),
                'dim_ext',
            ),
        );
    });
    items.push(line(onLine(first), onLine(last), 'dim_line'));

    const tick = scale(normalize(add(dir, side)), TICK_LENGTH / 2);
    for (const u of stops) {
        const c = onLine(u);
        items.push(line(add(c, scale(tick, -1)), add(c, tick), 'dim_tick'));
    }

    if (withText) {
        // Round first: 90.004 degrees must land on 90, not on -89.996 (-90).
        const rotationDeg = uprightDeg(r2(degOf(dir)));
        for (let i = 0; i + 1 < stops.length; i += 1) {
            const a = stops[i]!;
            const b = stops[i + 1]!;
            items.push(
                text(
                    onLine((a + b) / 2),
                    formatLength(b - a, opts.units),
                    opts.textSizeMm('dim_text'),
                    'dim_text',
                    { dyEm: -0.25, rotationDeg, baseline: 'bottom' },
                ),
            );
        }
    }
    return items;
}

/**
 * Stops of the opening chain: `0`, the edges of the openings in wall order,
 * then the wall length. Overlapping openings are merged and zero-length
 * segments dropped, so the segments always add up to `length`.
 */
function chainStops(w: DerivedWall): number[] {
    const stops = [0];
    const push = (u: number): void => {
        if (u - stops[stops.length - 1]! > EPS) stops.push(u);
    };
    for (const o of w.openings) {
        push(Math.min(o.u0, w.length));
        push(Math.min(o.u1, w.length));
    }
    if (w.length - stops[stops.length - 1]! > EPS) stops.push(w.length);
    else if (stops.length > 1) stops[stops.length - 1] = w.length;
    return stops;
}

/**
 * Automatic dimensions of one wall: the overall centre-line length and, when
 * the wall has openings, a chain row. Hidden from LOD 1 (05 §4.7).
 */
export function autoDimensions(
    w: DerivedWall,
    wall: Wall,
    opts: DrawingOptions,
): DrawGroup {
    const group: DrawGroup = {
        entityId: wall.id,
        entityKind: 'auto_dimension',
        items: [],
    };
    if (w.length < MIN_AUTO_LENGTH || opts.lod >= 1) return group;

    const side = scale(w.normal, w.exteriorSide === 'right' ? -1 : 1);
    const faceGap = wall.thickness / 2;
    const offset = faceGap + AUTO_OFFSET;
    const base = { origin: w.centerline[0], dir: w.dir, side };

    group.items.push(
        ...drawRow(
            {
                ...base,
                offset,
                stops: [0, w.length],
                gapAt: () => faceGap + EXT_GAP,
            },
            opts,
            true,
        ),
    );

    const stops = chainStops(w);
    if (w.openings.length > 0 && stops.length > 2) {
        group.items.push(
            ...drawRow(
                {
                    ...base,
                    offset: offset + CHAIN_OFFSET,
                    stops,
                    // The wall ends continue the first row's extension lines.
                    gapAt: (i) =>
                        i === 0 || i === stops.length - 1
                            ? offset + EXT_GAP
                            : faceGap + EXT_GAP,
                },
                opts,
                true,
            ),
        );
    }
    return group;
}

/**
 * A user dimension: the line stands `offset` mm from `a`-`b`, on the left of
 * `a` to `b` for a positive offset (04 §8.2). Texts are dropped at LOD 2.
 */
export function drawDimension(
    d: DimensionAnnotation,
    opts: DrawingOptions,
): DrawGroup {
    const group: DrawGroup = {
        entityId: d.id,
        entityKind: 'dimension',
        items: [],
    };
    const length = dist(d.a, d.b);
    if (length <= EPS) return group;
    const dir = normalize({ x: d.b.x - d.a.x, y: d.b.y - d.a.y });
    group.items = drawRow(
        {
            origin: d.a,
            dir,
            side: scale(perpLeft(dir), d.offset < 0 ? -1 : 1),
            offset: Math.abs(d.offset),
            stops: [0, length],
            gapAt: () => EXT_GAP,
        },
        opts,
        opts.lod < 2,
    );
    return group;
}
