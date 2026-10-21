/**
 * Opening symbols (04 §8.2): door leaves and swing arcs, windows and gaps.
 * Leaf and arc geometry comes from `doorLeafFrames`, the helper behind the
 * door swing sectors of `conflicts.ts`, so a drawn arc always matches its
 * clearance sector.
 */
import { EPS } from '../../geometry/tolerance';
import { add, scale, type Vec2 } from '../../geometry/vec2';
import { doorLeafFrames } from '../conflicts';
import type { DerivedOpening, DerivedWall } from '../derive';
import type { Opening } from '../schema';
import { line, poly, quarterArc } from './shared';
import type { DrawGroup, DrawItem, DrawingOptions, StyleKey } from './types';

/** Share of the opening width covered by one sliding panel or sliding glass line. */
const SLIDE_COVER = 0.55;
/** Depth of a sliding or pocket panel (mm). */
const PANEL_DEPTH = 30;
/** Half the spacing of the two casement glass lines (mm). */
const GLASS_OFFSET = 20;
/** How far a bay window projects (mm). */
const BAY_PROJECTION = 400;
/** Bifold leaves lie at this angle to the wall line. */
const BIFOLD_ANGLE = Math.PI / 6;

/** Point at along-wall position `u` and lateral offset `v` (towards +n). */
interface Frame {
    at(u: number, v?: number): Vec2;
}

function frameOf(w: DerivedWall): Frame {
    const origin = w.centerline[0];
    return {
        at: (u, v = 0) => add(add(origin, scale(w.dir, u)), scale(w.normal, v)),
    };
}

function rect(
    f: Frame,
    u0: number,
    u1: number,
    centre: number,
    depth: number,
): Vec2[] {
    const h = depth / 2;
    return [
        f.at(u0, centre - h),
        f.at(u1, centre - h),
        f.at(u1, centre + h),
        f.at(u0, centre + h),
    ];
}

/** Leaf lines (in `style`) and optional swing arcs of a hinged door or a french_window. */
function swingLeaves(
    o: DerivedOpening,
    opening: Opening,
    w: DerivedWall,
    style: StyleKey,
    showArcs: boolean,
): DrawItem[] {
    const items: DrawItem[] = [];
    for (const leaf of doorLeafFrames(opening, o, w)) {
        items.push(
            line(
                leaf.hinge,
                add(leaf.hinge, scale(leaf.openDir, leaf.radius)),
                style,
            ),
        );
        if (showArcs) {
            items.push(
                quarterArc(
                    leaf.hinge,
                    leaf.closedDir,
                    leaf.openDir,
                    leaf.radius,
                    'door_swing',
                ),
            );
        }
    }
    return items;
}

function doorItems(
    o: DerivedOpening,
    opening: Opening,
    w: DerivedWall,
    f: Frame,
    opts: DrawingOptions,
): DrawItem[] {
    const width = o.u1 - o.u0;
    const showArcs = opts.include.doorSwings && opts.lod === 0;
    const leafStyle =
        opening.type === 'main_entrance' ? 'door_main_leaf' : 'door_leaf';
    const items: DrawItem[] = [];

    switch (opening.type) {
        case 'single_swing':
        case 'main_entrance':
        case 'double_swing': {
            items.push(...swingLeaves(o, opening, w, leafStyle, showArcs));
            if (opening.type === 'main_entrance') {
                items.push(line(f.at(o.u0), f.at(o.u1), 'threshold'));
            }
            return items;
        }
        case 'sliding': {
            const cover = SLIDE_COVER * width;
            const lateral = w.thickness / 6;
            items.push(
                poly(
                    rect(f, o.u0, o.u0 + cover, lateral, PANEL_DEPTH),
                    'sliding_panel',
                    { cw: true },
                ),
                poly(
                    rect(f, o.u1 - cover, o.u1, -lateral, PANEL_DEPTH),
                    'sliding_panel',
                    { cw: true },
                ),
            );
            return items;
        }
        case 'pocket': {
            // The panel slides into the wall beyond the hinge jamb.
            const [from, to] =
                opening.hinge === 'start'
                    ? [o.u0 - width, o.u0]
                    : [o.u1, o.u1 + width];
            items.push(
                poly(rect(f, from, to, 0, PANEL_DEPTH), 'sliding_panel', {
                    cw: true,
                    dashed: true,
                }),
            );
            return items;
        }
        case 'bifold': {
            const leaf = doorLeafFrames(opening, o, w)[0]!;
            const half = width / 2;
            const along = scale(leaf.closedDir, half * Math.cos(BIFOLD_ANGLE));
            const out = scale(leaf.openDir, half * Math.sin(BIFOLD_ANGLE));
            const fold = add(add(leaf.hinge, along), out);
            items.push(
                line(leaf.hinge, fold, 'door_leaf'),
                line(fold, add(add(leaf.hinge, along), along), 'door_leaf'),
            );
            return items;
        }
        default:
            // A door whose type is not a door type: show it as a plain gap.
            return jambLines(o);
    }
}

function jambLines(o: DerivedOpening): DrawItem[] {
    return [
        line(o.jambStart.left, o.jambStart.right, 'opening_jamb'),
        line(o.jambEnd.left, o.jambEnd.right, 'opening_jamb'),
    ];
}

function windowItems(
    o: DerivedOpening,
    opening: Opening,
    w: DerivedWall,
    f: Frame,
    opts: DrawingOptions,
): DrawItem[] {
    const width = o.u1 - o.u0;
    const showGlass = opts.lod < 2;
    const items: DrawItem[] = [
        line(o.jambStart.left, o.jambEnd.left, 'window_frame'),
        line(o.jambStart.right, o.jambEnd.right, 'window_frame'),
    ];
    const glass = (a: Vec2, b: Vec2): void => {
        if (showGlass) items.push(line(a, b, 'window_glass'));
    };
    const casement = (): void => {
        glass(f.at(o.u0, GLASS_OFFSET), f.at(o.u1, GLASS_OFFSET));
        glass(f.at(o.u0, -GLASS_OFFSET), f.at(o.u1, -GLASS_OFFSET));
    };

    switch (opening.type) {
        case 'ventilator':
            casement();
            glass(f.at(o.u0, GLASS_OFFSET), f.at(o.u1, -GLASS_OFFSET));
            break;
        case 'sliding_window': {
            const cover = SLIDE_COVER * width;
            const lateral = w.thickness / 6;
            glass(f.at(o.u0, lateral), f.at(o.u0 + cover, lateral));
            glass(f.at(o.u1 - cover, -lateral), f.at(o.u1, -lateral));
            break;
        }
        case 'fixed':
            glass(f.at(o.u0), f.at(o.u1));
            break;
        case 'french_window': {
            casement();
            const showArcs = opts.include.doorSwings && opts.lod === 0;
            items.push(...swingLeaves(o, opening, w, 'door_leaf', showArcs));
            break;
        }
        case 'bay': {
            // Trapezoid on the exterior face (else +n) with 45 degree sides.
            const side = w.exteriorSide === 'right' ? -1 : 1;
            const inset = Math.min(BAY_PROJECTION, width / 2);
            const faceFrom = side === 1 ? o.jambStart.left : o.jambStart.right;
            const faceTo = side === 1 ? o.jambEnd.left : o.jambEnd.right;
            const lateral = side * (w.thickness / 2 + inset);
            const outerFrom = f.at(o.u0 + inset, lateral);
            const outerTo = f.at(o.u1 - inset, lateral);
            items.push(
                poly([faceFrom, outerFrom, outerTo, faceTo], 'window_frame', {
                    closed: false,
                }),
            );
            glass(outerFrom, outerTo);
            break;
        }
        default:
            // casement, and a window whose type is not a window type
            casement();
    }
    return items;
}

export function drawOpening(
    o: DerivedOpening,
    opening: Opening,
    w: DerivedWall,
    opts: DrawingOptions,
): DrawGroup {
    const group: DrawGroup = {
        entityId: opening.id,
        entityKind: 'opening',
        items: [],
    };
    // A clamped opening can have no width left (04 §3.6-1): nothing to draw.
    if (o.u1 - o.u0 <= EPS) return group;
    const f = frameOf(w);
    if (opening.kind === 'door') {
        group.items = doorItems(o, opening, w, f, opts);
    } else if (opening.kind === 'window') {
        group.items = windowItems(o, opening, w, f, opts);
    } else {
        group.items = jambLines(o);
    }
    return group;
}
