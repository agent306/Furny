/**
 * Wall-graph editing primitives shared by the plan commands (04 §6.5). They
 * work on the `mutative` draft a command runs in, read node positions from
 * that draft (never from the cached geometry, which is stale after the first
 * edit), take every new id from `ctx.newId`, and write every coordinate
 * rounded to integer millimetres (never as -0). A refusal is a `CommandAbort`
 * carrying an `engine.plan.command.*` message.
 *
 * Rulings carried by these helpers (logged in spec 19):
 * - After a split, dimensions attached to the original wall stay attached to
 *   it, so they follow the head part (`a -> N`) only; 04 §6.5 says "stay
 *   attached" and nothing re-attaches them to the tail.
 * - A wall a new segment crosses is never left unsplit: where the crossing is
 *   folded into a nearby node (see `dedupeCuts`) the wall is split at that
 *   node if it lies within `NODE_MERGE_TOL` of the wall, else the command
 *   aborts `wall_too_short` (`walls_intersect` is a plan issue, not one of
 *   the 22 command codes).
 * - No wall shorter than `MIN_WALL_LENGTH` is made: cuts, crossings and
 *   splits keep at least that distance from the ends they meet.
 * - A split piece that joins two nodes another wall already joins (a wall
 *   split where a collinear wall overlaps it) is folded into that wall
 *   (controller ruling, ledgered for the spec 19 reconciliation): the
 *   existing wall keeps its id and properties and takes the piece's
 *   openings, placements and dimensions; an opening that would overlap one
 *   already there refuses the split with `opening_overlap`.
 */
import type { Draft } from 'mutative';
import { CommandAbort, type CommandOutput } from '../../commands/types';
import { cmpId } from '../../compare';
import {
    closestPointOnSeg,
    intersectSegments,
    projectParam,
    type Seg,
} from '../../geometry/segment';
import {
    MIN_WALL_LENGTH,
    NODE_MERGE_TOL,
    roundMm,
} from '../../geometry/tolerance';
import {
    add,
    dist,
    dot,
    roundPoint,
    scale,
    sub,
    type Vec2,
} from '../../geometry/vec2';
import type { Opening, PlanDocument, Wall } from '../schema';
import {
    planCommandMessage,
    type PlanCommandContext,
    type PlanCommandErrorCode,
} from './pipeline';

/** A wall end given as an existing node or as a free point (04 §6.5). */
export type EndpointRef = { nodeId: string } | { point: Vec2 };

/** Everything a new wall carries besides its id and its nodes. */
export type WallProps = Omit<Wall, 'id' | 'a' | 'b'>;

type Doc = Draft<PlanDocument>;
type Ids = Pick<PlanCommandContext, 'newId'>;
type Out = CommandOutput<unknown>;

/** Float slack when testing integer offsets against a wall length (mm). */
const SLACK = 1e-6;

// ---- small utilities ---------------------------------------------------------

/** `roundMm` without a negative zero. */
const mm = (v: number): number => roundMm(v) + 0;

/** `roundPoint` without a negative zero. */
function roundedPoint(p: Vec2): Vec2 {
    const r = roundPoint(p);
    return { x: r.x + 0, y: r.y + 0 };
}

function fail(
    code: PlanCommandErrorCode,
    params: Record<string, string | number> = {},
): never {
    throw new CommandAbort(planCommandMessage(code, params));
}

function nodePoint(d: Doc, id: string): Vec2 {
    if (!Object.hasOwn(d.nodes, id)) fail('not_found', { id });
    const node = d.nodes[id]!;
    return { x: node.x, y: node.y };
}

function wallOf(d: Doc, id: string): Draft<Wall> {
    if (!Object.hasOwn(d.walls, id)) fail('not_found', { id });
    return d.walls[id]!;
}

function segmentOf(d: Doc, wall: Wall): Seg {
    return { a: nodePoint(d, wall.a), b: nodePoint(d, wall.b) };
}

/** A wall's properties, copied (never the draft proxy itself). */
function propsOf(wall: WallProps): WallProps {
    return {
        thickness: wall.thickness,
        height: wall.height,
        kind: wall.kind,
        justification: wall.justification,
        material: wall.material,
        colorHex: wall.colorHex,
    };
}

/** The point `offset` along a wall from its `a` end. */
export function pointAlong(d: Doc, wall: Wall, offset: number): Vec2 {
    const { a, b } = segmentOf(d, wall);
    const length = dist(a, b);
    return length < 1e-9 ? a : add(a, scale(sub(b, a), offset / length));
}

const sortedIds = (record: object): string[] => Object.keys(record).sort(cmpId);

/** The openings of one wall by offset, ties by id. */
export function openingsOf(d: Doc, wallId: string): Draft<Opening>[] {
    return Object.values(d.openings)
        .filter((o) => o.wallId === wallId)
        .sort((p, q) => p.offset - q.offset || cmpId(p.id, q.id));
}

const pairKey = (a: string, b: string): string =>
    cmpId(a, b) <= 0 ? `${a}|${b}` : `${b}|${a}`;

export function pushDeleted(out: Out, ...ids: string[]): void {
    for (const id of ids) {
        if (!out.deletedIds.includes(id)) out.deletedIds.push(id);
    }
}

/**
 * The integer offset nearest to `offset` at which an opening of `width`
 * lies inside a wall of `length`, or `null` when no integer offset does.
 */
export function fitOffset(
    offset: number,
    width: number,
    length: number,
): number | null {
    const lo = Math.ceil(width / 2 - SLACK);
    const hi = Math.floor(length - width / 2 + SLACK);
    if (lo > hi) return null;
    return Math.min(hi, Math.max(lo, mm(offset)));
}

/** Deletes a wall and the openings on it; the ids go to `out.deletedIds`. */
export function deleteWall(d: Doc, wallId: string, out: Out): void {
    const openings = openingsOf(d, wallId).map((o) => o.id);
    delete d.walls[wallId];
    for (const id of openings) delete d.openings[id];
    pushDeleted(out, wallId, ...openings.sort(cmpId));
}

// ---- wallLength ------------------------------------------------------------

/** Centre-line length of a wall in the draft (float mm). */
export function wallLength(d: Doc, wallId: string): number {
    const { a, b } = segmentOf(d, wallOf(d, wallId));
    return dist(a, b);
}

// ---- splitting ---------------------------------------------------------------

/**
 * Splits `wallId` at the existing node `nodeId` (which lies on the wall): the
 * wall keeps its id and becomes `a -> node`, a new wall `node -> b` copies its
 * properties. Openings and attached placements beyond the cut move to the new
 * wall. Returns the new wall's id.
 */
function splitAtNode(
    d: Doc,
    wallId: string,
    nodeId: string,
    ctx: Ids,
    out: Out,
): void {
    const wall = wallOf(d, wallId);
    const a = nodePoint(d, wall.a);
    const b = nodePoint(d, wall.b);
    const n = nodePoint(d, nodeId);
    const length = dist(a, b);
    const cut = dist(a, n);
    const openings = openingsOf(d, wallId);
    for (const o of openings) {
        if (
            o.offset - o.width / 2 < cut - SLACK &&
            o.offset + o.width / 2 > cut + SLACK
        ) {
            fail('split_through_opening', { wallId, openingId: o.id });
        }
    }

    const tailId = ctx.newId('w');
    d.walls[tailId] = {
        ...propsOf(wall),
        id: tailId,
        a: nodeId,
        b: wall.b,
    };
    wall.b = nodeId;

    const tailLength = dist(n, b);
    for (const o of openings) {
        if (o.offset < cut) continue;
        o.wallId = tailId;
        o.offset =
            fitOffset(o.offset - cut, o.width, tailLength) ??
            mm(o.offset - cut);
    }
    if (length >= 1e-9) {
        const dir = scale(sub(b, a), 1 / length);
        for (const id of sortedIds(d.placements)) {
            const p = d.placements[id]!;
            if (p.wallAttachment?.wallId !== wallId) continue;
            if (dot(sub({ x: p.x, y: p.y }, a), dir) > cut) {
                p.wallAttachment.wallId = tailId;
            }
        }
    }
    // a piece that joins two nodes another wall already joins goes into it
    for (const piece of [wallId, tailId]) {
        if (!Object.hasOwn(d.walls, piece)) continue;
        const { a: pa, b: pb } = d.walls[piece]!;
        const existing = wallJoining(d, pa, pb, piece);
        if (existing !== null) {
            foldWall(d, piece, existing, out, { conflict: 'refuse' });
        }
    }
}

/** The wall (smallest id) joining nodes `p` and `q` other than `except`, or `null`. */
function wallJoining(
    d: Doc,
    p: string,
    q: string,
    except: string | null = null,
): string | null {
    for (const id of sortedIds(d.walls)) {
        if (id === except) continue;
        const w = d.walls[id]!;
        if ((w.a === p && w.b === q) || (w.a === q && w.b === p)) return id;
    }
    return null;
}

/**
 * Folds wall `dropId` into wall `keepId`, which joins the same two nodes:
 * the kept wall keeps its id and properties and takes the dropped wall's
 * openings (their centres re-projected; hinge and swing flipped when the two
 * run opposite ways), placements and dimensions (sides and faces flipped
 * likewise); then the dropped wall is deleted. An opening that does not fit
 * or overlaps one already there is deleted (`conflict: 'delete'`, the
 * `mergeNodeInto` rule) or refused (`conflict: 'refuse'`, `opening_overlap`;
 * an opening that is already out of bounds is clamped where it can be and
 * otherwise kept as it is). `centres` gives opening centres measured before
 * the caller moved a node.
 */
function foldWall(
    d: Doc,
    dropId: string,
    keepId: string,
    out: Out,
    opts: { conflict: 'delete' | 'refuse'; centres?: Map<string, Vec2> },
): void {
    const keeper = d.walls[keepId]!;
    const loser = d.walls[dropId]!;
    const keeperSeg = segmentOf(d, keeper);
    const keeperLength = dist(keeperSeg.a, keeperSeg.b);
    const keeperDir =
        keeperLength < 1e-9
            ? { x: 1, y: 0 }
            : scale(sub(keeperSeg.b, keeperSeg.a), 1 / keeperLength);
    const reversed = loser.a !== keeper.a;
    const flip = (side: 'left' | 'right'): 'left' | 'right' =>
        reversed ? (side === 'left' ? 'right' : 'left') : side;
    for (const o of openingsOf(d, dropId)) {
        const centre =
            opts.centres?.get(o.id) ?? pointAlong(d, loser, o.offset);
        const projected = mm(dot(sub(centre, keeperSeg.a), keeperDir));
        const fitted = fitOffset(projected, o.width, keeperLength);
        const offset =
            opts.conflict === 'refuse' ? (fitted ?? projected) : projected;
        const inside = fitted === offset;
        const blocking = openingsOf(d, keepId).find((other) =>
            overlaps(offset, o.width, other.offset, other.width),
        );
        if (opts.conflict === 'refuse' && blocking !== undefined) {
            const [first, second] =
                cmpId(o.id, blocking.id) <= 0
                    ? [o.id, blocking.id]
                    : [blocking.id, o.id];
            fail('opening_overlap', {
                wallId: keepId,
                openingId: first,
                otherId: second,
            });
        }
        if (opts.conflict === 'delete' && (!inside || blocking !== undefined)) {
            delete d.openings[o.id];
            pushDeleted(out, o.id);
            continue;
        }
        o.wallId = keepId;
        o.offset = offset;
        if (reversed) {
            o.hinge = o.hinge === 'start' ? 'end' : 'start';
            o.swing = o.swing === 'left' ? 'right' : 'left';
        }
    }
    // what hung on the dropped wall follows the kept one
    for (const placement of Object.values(d.placements)) {
        const attachment = placement.wallAttachment;
        if (attachment?.wallId !== dropId) continue;
        attachment.wallId = keepId;
        attachment.side = flip(attachment.side);
    }
    for (const dimension of Object.values(d.annotations.dimensions)) {
        const attached = dimension.attachedTo;
        if (attached?.wallId !== dropId) continue;
        attached.wallId = keepId;
        if (attached.face !== 'center') attached.face = flip(attached.face);
    }
    deleteWall(d, dropId, out);
}

/**
 * Splits `wallId` where `point` projects onto its centre line (04 §6.5):
 * returns the new node's id. A cut strictly inside an opening aborts with
 * `split_through_opening`; a point projecting outside the open interval
 * `(MIN_WALL_LENGTH, length - MIN_WALL_LENGTH)` aborts `wall_too_short`.
 *
 * With `inclusive` the interval is closed, so a cut exactly `MIN_WALL_LENGTH`
 * from an end is allowed (the `splitWall` command's range, 04 §6.6); the
 * rounded node must then still leave both parts at least `MIN_WALL_LENGTH`
 * long, else the call aborts `wall_too_short`.
 */
export function splitWallAt(
    d: Doc,
    wallId: string,
    point: Vec2,
    ctx: Ids,
    out: Out,
    opts: { inclusive?: boolean } = {},
): string {
    const wall = wallOf(d, wallId);
    const { a, b } = segmentOf(d, wall);
    const length = dist(a, b);
    const u = length < 1e-9 ? 0 : dot(sub(point, a), sub(b, a)) / length;
    // never a zero-length wall or a node on top of an end
    const inside = opts.inclusive
        ? u >= MIN_WALL_LENGTH - SLACK && u <= length - MIN_WALL_LENGTH + SLACK
        : u > MIN_WALL_LENGTH && u < length - MIN_WALL_LENGTH;
    if (!inside) fail('wall_too_short', { wallId, length: mm(length) });
    const at = roundedPoint(add(a, scale(sub(b, a), u / length)));
    if (
        opts.inclusive &&
        (dist(a, at) < MIN_WALL_LENGTH - SLACK ||
            dist(at, b) < MIN_WALL_LENGTH - SLACK)
    ) {
        fail('wall_too_short', { wallId, length: mm(length) });
    }
    const nodeId = ctx.newId('n');
    d.nodes[nodeId] = { id: nodeId, x: at.x, y: at.y };
    splitAtNode(d, wallId, nodeId, ctx, out);
    return nodeId;
}

/**
 * Ends of a wall, resolved to a node (04 §6.5): an existing node id; else the
 * nearest node within `NODE_MERGE_TOL`; else, on the nearest wall whose centre
 * line is within tolerance, the wall's end node when the click projects within
 * `MIN_WALL_LENGTH` of that end, or a T-node splitting the wall; else a new
 * node at the rounded point.
 */
export function resolveEndpoint(
    d: Doc,
    ref: EndpointRef,
    ctx: Ids,
    out: Out,
): string {
    if ('nodeId' in ref) {
        nodePoint(d, ref.nodeId);
        return ref.nodeId;
    }
    const { point } = ref;

    let nearest: { id: string; distance: number } | null = null;
    for (const id of sortedIds(d.nodes)) {
        const distance = dist(point, nodePoint(d, id));
        if (
            distance <= NODE_MERGE_TOL &&
            (nearest === null || distance < nearest.distance)
        ) {
            nearest = { id, distance };
        }
    }
    if (nearest !== null) return nearest.id;

    // The nearest wall whose centre line is within tolerance. Near one of its
    // ends (within MIN_WALL_LENGTH along the wall) the click means that end
    // node; a split there would leave a stub.
    let onWall: {
        wall: Draft<Wall>;
        distance: number;
        at: Vec2;
        u: number;
        length: number;
    } | null = null;
    for (const id of sortedIds(d.walls)) {
        const wall = d.walls[id]!;
        if (
            !Object.hasOwn(d.nodes, wall.a) ||
            !Object.hasOwn(d.nodes, wall.b)
        ) {
            continue; // a dangling wall is not a snap target
        }
        const seg = segmentOf(d, wall);
        const length = dist(seg.a, seg.b);
        const hit = closestPointOnSeg(point, seg);
        if (
            hit.dist <= NODE_MERGE_TOL &&
            (onWall === null || hit.dist < onWall.distance)
        ) {
            onWall = {
                wall,
                distance: hit.dist,
                at: hit.point,
                u: hit.t * length,
                length,
            };
        }
    }
    if (onWall !== null) {
        const toB = onWall.length - onWall.u;
        if (onWall.u <= MIN_WALL_LENGTH || toB <= MIN_WALL_LENGTH) {
            return onWall.u <= toB ? onWall.wall.a : onWall.wall.b;
        }
        return splitWallAt(d, onWall.wall.id, onWall.at, ctx, out);
    }

    const id = ctx.newId('n');
    const at = roundedPoint(point);
    d.nodes[id] = { id, x: at.x, y: at.y };
    return id;
}

// ---- cutting a segment at the graph --------------------------------------------

/**
 * Cuts closer than this to a neighbouring cut (or to the segment's ends) are
 * folded into it, so no wall shorter than `MIN_WALL_LENGTH` is made.
 */
const STUB = Math.max(NODE_MERGE_TOL, MIN_WALL_LENGTH);

/** A point where a segment gets cut (04 §6.5 `insertWallSegment` step 2). */
interface Cut {
    /** Parameter on the segment, 0 at its first end. */
    t: number;
    /** 0: the segment's own end; 1: an existing node; 2: a wall to split. */
    rank: 0 | 1 | 2;
    /** The node (rank 0 and 1; set after the split for rank 2). */
    nodeId: string | null;
    /** The walls this cut stands for where they cross the segment. */
    viaWalls?: string[];
    /** Where that wall is split (rank 2). */
    point?: Vec2;
}

/** A crossing wall whose own cut was folded into `into`: it is split there. */
interface Folded {
    wallId: string;
    into: Cut;
}

const cutOrder = (p: Cut, q: Cut): number =>
    p.t - q.t ||
    p.rank - q.rank ||
    cmpId(p.nodeId ?? p.viaWalls?.[0] ?? '', q.nodeId ?? q.viaWalls?.[0] ?? '');

/**
 * Sorts the cuts along the segment and folds those closer than `STUB` to the
 * previous one into it; the stronger kind (end, existing node, wall split)
 * wins. A folded cut that stood for a crossing wall is reported, so the wall
 * is still split (at the surviving cut) and never left crossing unsplit.
 */
function dedupeCuts(
    points: Cut[],
    length: number,
): { kept: Cut[]; folded: Folded[] } {
    const kept: Cut[] = [];
    const folded: Folded[] = [];
    const fold = (lose: Cut, win: Cut): void => {
        for (const f of folded) if (f.into === lose) f.into = win;
        if (lose.viaWalls === undefined) return;
        if (lose.nodeId !== null && lose.nodeId === win.nodeId) {
            // the same node twice (a plain node and a crossing's node): the
            // walls it stands for stay with the survivor
            win.viaWalls = [
                ...new Set([...(win.viaWalls ?? []), ...lose.viaWalls]),
            ];
            return;
        }
        for (const wallId of lose.viaWalls) folded.push({ wallId, into: win });
    };
    for (const point of [...points].sort(cutOrder)) {
        kept.push(point);
        while (kept.length >= 2) {
            const q = kept[kept.length - 1]!;
            const p = kept[kept.length - 2]!;
            if ((q.t - p.t) * length >= STUB) break;
            const [win, lose] = q.rank < p.rank ? [q, p] : [p, q];
            fold(lose, win);
            kept.splice(kept.length - 2, 2, win);
        }
    }
    return { kept, folded };
}

/** What a segment meets in the graph, as cuts (before folding). */
function collectCuts(
    d: Doc,
    seg: Seg,
    ends: { a: string; b: string },
    selfWall: string | null,
    withCoverage: boolean,
): { points: Cut[]; covered: Array<[number, number]> } {
    const points: Cut[] = [
        { t: 0, rank: 0, nodeId: ends.a },
        { t: 1, rank: 0, nodeId: ends.b },
    ];
    const covered: Array<[number, number]> = [];

    // existing nodes near the interior
    for (const id of sortedIds(d.nodes)) {
        if (id === ends.a || id === ends.b) continue;
        const p = nodePoint(d, id);
        const t = projectParam(p, seg);
        if (t <= 0 || t >= 1) continue;
        if (closestPointOnSeg(p, seg).dist <= NODE_MERGE_TOL) {
            points.push({ t, rank: 1, nodeId: id });
        }
    }

    // crossing and (for a new wall) collinear walls
    for (const id of sortedIds(d.walls)) {
        if (id === selfWall) continue;
        const wall = d.walls[id]!;
        if (
            !Object.hasOwn(d.nodes, wall.a) ||
            !Object.hasOwn(d.nodes, wall.b)
        ) {
            continue; // a dangling wall cannot be crossed
        }
        const hit = intersectSegments(seg, segmentOf(d, wall), NODE_MERGE_TOL);
        if (hit.kind === 'overlap') {
            if (withCoverage) covered.push([hit.t0, hit.t1]);
            continue;
        }
        if (hit.kind !== 'point') continue;
        if (hit.t <= 0 || hit.t >= 1 || hit.u <= 0 || hit.u >= 1) continue;
        // A crossing within STUB of one of the wall's own nodes goes through
        // that node, so the wall is not cut into a stub.
        let near: { id: string; distance: number } | null = null;
        for (const nodeId of [wall.a, wall.b]) {
            const distance = dist(hit.point, nodePoint(d, nodeId));
            if (
                distance <= STUB &&
                (near === null || distance < near.distance)
            ) {
                near = { id: nodeId, distance };
            }
        }
        if (near === null) {
            points.push({
                t: hit.t,
                rank: 2,
                nodeId: null,
                viaWalls: [id],
                point: hit.point,
            });
        } else if (near.id !== ends.a && near.id !== ends.b) {
            const t = Math.min(
                1,
                Math.max(0, projectParam(nodePoint(d, near.id), seg)),
            );
            points.push({ t, rank: 1, nodeId: near.id, viaWalls: [id] });
        }
    }
    return { points, covered };
}

/**
 * Splits the crossed walls: those with a wall-split cut get their new node,
 * and those whose cut was folded are split at the node they were folded into
 * (it must lie within `NODE_MERGE_TOL` of the wall and leave both parts at
 * least `MIN_WALL_LENGTH` long, else `wall_too_short`). Cuts are processed
 * along the segment, so the new ids are deterministic.
 */
function splitCrossedWalls(
    d: Doc,
    kept: Cut[],
    folded: Folded[],
    ctx: Ids,
    out: Out,
): void {
    for (const cut of kept) {
        if (cut.rank === 2) {
            cut.nodeId = splitWallAt(
                d,
                cut.viaWalls![0]!,
                cut.point!,
                ctx,
                out,
            );
        }
    }
    const order = new Map(kept.map((c, i) => [c, i]));
    for (const { wallId, into } of [...folded].sort(
        (p, q) => (order.get(p.into) ?? 0) - (order.get(q.into) ?? 0),
    )) {
        // folded into another wall by an earlier split: that split went
        // through the node this one wanted
        if (!Object.hasOwn(d.walls, wallId)) continue;
        const wall = d.walls[wallId]!;
        if (wall.a === into.nodeId || wall.b === into.nodeId) continue;
        const seg = segmentOf(d, wall);
        const length = dist(seg.a, seg.b);
        const hit = closestPointOnSeg(nodePoint(d, into.nodeId!), seg);
        const u = hit.t * length;
        if (
            hit.dist > NODE_MERGE_TOL ||
            u < MIN_WALL_LENGTH ||
            length - u < MIN_WALL_LENGTH
        ) {
            fail('wall_too_short', { wallId, length: mm(length) });
        }
        splitAtNode(d, wallId, into.nodeId!, ctx, out);
    }
}

/**
 * Rounding can put a wall-split node closer than `MIN_WALL_LENGTH` to its
 * neighbouring cut although the unrounded cuts were far enough apart. The new
 * node is then merged into the neighbour (the segment's end first), so the
 * segment goes through that node: no stub wall and no orphaned end. Existing
 * nodes are never merged away. `cuts` loses the merged cuts.
 */
function settleRoundedCuts(d: Doc, cuts: Cut[], ctx: Ids, out: Out): void {
    for (let k = 0; k + 1 < cuts.length;) {
        const p = cuts[k]!;
        const q = cuts[k + 1]!;
        const close =
            dist(nodePoint(d, p.nodeId!), nodePoint(d, q.nodeId!)) <
            MIN_WALL_LENGTH;
        const [win, lose] = q.rank < p.rank ? [q, p] : [p, q];
        if (!close || lose.rank !== 2 || win.nodeId === lose.nodeId) {
            k += 1;
            continue;
        }
        const stray = lose.nodeId!;
        // the walls that end at the stray node change length with the merge
        const moved = sortedIds(d.walls).flatMap((id) => {
            const w = d.walls[id]!;
            if (w.a !== stray && w.b !== stray) return [];
            return [
                {
                    id,
                    end: w.a === stray ? 'a' : 'b',
                    length: wallLength(d, id),
                },
            ] as const;
        });
        mergeNodeInto(d, stray, win.nodeId!, ctx, out);
        // the stray node only ever existed inside this command
        const listed = out.deletedIds.indexOf(stray);
        if (listed >= 0) out.deletedIds.splice(listed, 1);
        for (const wall of moved) {
            if (Object.hasOwn(d.walls, wall.id)) {
                reclampOpenings(d, wall.id, wall.end, wall.length);
            }
        }
        cuts.splice(cuts.indexOf(lose), 1);
        k = Math.max(0, k - 1);
    }
}

// ---- insertWallSegment -------------------------------------------------------

/**
 * Draws the wall `from -> to` into the graph (04 §6.5): the segment is cut at
 * every node near its interior and at every crossing wall (crossed walls are
 * split too), the parts a collinear wall already covers are left out, and one
 * new wall is made for every remaining part. Returns the new wall ids ordered
 * from `from` to `to`. Aborts `wall_too_short` under `MIN_WALL_LENGTH` and
 * `wall_duplicate` when nothing was left to create.
 */
export function insertWallSegment(
    d: Doc,
    fromNodeId: string,
    toNodeId: string,
    props: WallProps,
    ctx: Ids,
    out: Out,
): { wallIds: string[]; lastNodeId: string } {
    const seg: Seg = {
        a: nodePoint(d, fromNodeId),
        b: nodePoint(d, toNodeId),
    };
    const length = dist(seg.a, seg.b);
    if (length < MIN_WALL_LENGTH)
        fail('wall_too_short', { length: mm(length) });

    const { points, covered } = collectCuts(
        d,
        seg,
        { a: fromNodeId, b: toNodeId },
        null,
        true,
    );
    const { kept: cuts, folded } = dedupeCuts(points, length);
    splitCrossedWalls(d, cuts, folded, ctx, out);
    settleRoundedCuts(d, cuts, ctx, out);

    const joined = new Set(
        Object.values(d.walls).map((w) => pairKey(w.a, w.b)),
    );
    const wallIds: string[] = [];
    for (let k = 0; k + 1 < cuts.length; k += 1) {
        const from = cuts[k]!;
        const to = cuts[k + 1]!;
        const mid = (from.t + to.t) / 2;
        if (covered.some(([t0, t1]) => mid >= t0 && mid <= t1)) continue;
        const a = from.nodeId!;
        const b = to.nodeId!;
        if (joined.has(pairKey(a, b))) continue;
        const id = ctx.newId('w');
        d.walls[id] = { ...propsOf(props), id, a, b };
        joined.add(pairKey(a, b));
        wallIds.push(id);
    }
    if (wallIds.length === 0) fail('wall_duplicate');
    return { wallIds, lastNodeId: toNodeId };
}

// ---- splitIntersections --------------------------------------------------------

/**
 * Splits `wallId` and the walls it properly crosses at the crossings (nodes
 * within `NODE_MERGE_TOL` are reused), and splits it at every node within
 * `NODE_MERGE_TOL` of its interior (04 §6.5). Cuts closer than
 * `MIN_WALL_LENGTH` to each other or to the wall's ends are folded together
 * (see `dedupeCuts`). Walls are cut in order along the wall, so the new ids
 * are deterministic.
 */
export function splitIntersections(
    d: Doc,
    wallId: string,
    ctx: Ids,
    out: Out,
): void {
    const wall = wallOf(d, wallId);
    const seg = segmentOf(d, wall);
    const length = dist(seg.a, seg.b);
    if (length < MIN_WALL_LENGTH) return;

    const { points } = collectCuts(
        d,
        seg,
        { a: wall.a, b: wall.b },
        wallId,
        false,
    );
    const { kept, folded } = dedupeCuts(points, length);
    splitCrossedWalls(d, kept, folded, ctx, out);
    settleRoundedCuts(d, kept, ctx, out);

    // Cut along the wall from `a`: what is left to cut is always the wall
    // joining the last cut to the far end `b` (the new tail, or the wall a
    // duplicate tail was folded into, whichever way that one runs).
    const far = wall.b;
    let rest: string | null = wallId;
    for (const cut of kept) {
        if (cut.rank === 0) continue;
        if (rest === null) break;
        splitAtNode(d, rest, cut.nodeId!, ctx, out);
        rest = wallJoining(d, cut.nodeId!, far);
    }
}

// ---- mergeNodeInto -----------------------------------------------------------------

/**
 * Moves every wall end from `srcNodeId` to `dstNodeId` and deletes the source
 * (04 §6.5). Walls that become degenerate go with their openings; of two
 * walls that now join the same pair of nodes the one with the smaller id
 * stays and takes the other's openings that fit without overlapping (their
 * centres re-projected), the rest are deleted. Deleted ids are appended to
 * `out.deletedIds`.
 */
export function mergeNodeInto(
    d: Doc,
    srcNodeId: string,
    dstNodeId: string,
    _ctx: Ids,
    out: Out,
): void {
    nodePoint(d, srcNodeId);
    nodePoint(d, dstNodeId);
    if (srcNodeId === dstNodeId) return;

    const touching = sortedIds(d.walls).filter((id) => {
        const w = d.walls[id]!;
        return w.a === srcNodeId || w.b === srcNodeId;
    });
    // Where each opening's centre is now, before its wall's ends move.
    const centres = new Map<string, Vec2>();
    for (const id of touching) {
        for (const o of openingsOf(d, id)) {
            centres.set(o.id, pointAlong(d, d.walls[id]!, o.offset));
        }
    }

    for (const id of touching) {
        const w = d.walls[id]!;
        if (w.a === srcNodeId) w.a = dstNodeId;
        if (w.b === srcNodeId) w.b = dstNodeId;
    }
    for (const id of touching) {
        const w = d.walls[id]!;
        if (w.a === w.b) deleteWall(d, id, out);
    }

    // walls that now join the same two nodes
    const moved = new Set(touching.filter((id) => Object.hasOwn(d.walls, id)));
    const groups = new Map<string, string[]>();
    for (const id of sortedIds(d.walls)) {
        const w = d.walls[id]!;
        if (w.a !== dstNodeId && w.b !== dstNodeId) continue;
        const key = pairKey(w.a, w.b);
        const group = groups.get(key);
        if (group === undefined) groups.set(key, [id]);
        else group.push(id);
    }
    for (const ids of groups.values()) {
        if (ids.length < 2 || !ids.some((id) => moved.has(id))) continue;
        for (const loserId of ids.slice(1)) {
            foldWall(d, loserId, ids[0]!, out, { conflict: 'delete', centres });
        }
    }

    delete d.nodes[srcNodeId];
    pushDeleted(out, srcNodeId);
}

// ---- reclampOpenings ---------------------------------------------------------------

/** Two openings overlap when their spans share more than a point (doubled coordinates keep half millimetres integral). */
export const overlaps = (
    o1: number,
    w1: number,
    o2: number,
    w2: number,
): boolean => 2 * o1 + w1 > 2 * o2 - w2 && 2 * o2 + w2 > 2 * o1 - w1;

/**
 * Re-fits the openings of a wall whose length changed (04 §6.5): after node
 * `a` moved an opening keeps its distance to `b`, otherwise it keeps its
 * offset; then it is clamped into the wall. Aborts `opening_no_fit` when an
 * opening is wider than the wall and `opening_overlap` when two openings
 * collide after clamping; collisions that were already there before the edit
 * are ignored.
 */
export function reclampOpenings(
    d: Doc,
    wallId: string,
    movedEnd: 'a' | 'b' | 'both' | 'none',
    oldLength: number,
): void {
    const length = wallLength(d, wallId);
    const fitted = openingsOf(d, wallId).map((o) => {
        const wanted =
            movedEnd === 'a' ? length - (oldLength - o.offset) : o.offset;
        const offset = fitOffset(wanted, o.width, length);
        if (o.width > length + SLACK || offset === null) {
            fail('opening_no_fit', {
                wallId,
                openingId: o.id,
                width: o.width,
                length: mm(length),
            });
        }
        return { opening: o, offset };
    });

    // Only collisions the clamp makes count: a pair that already overlapped
    // before the edit (a dirty import) does not block it.
    for (let i = 0; i < fitted.length; i += 1) {
        for (let j = i + 1; j < fitted.length; j += 1) {
            const p = fitted[i]!;
            const q = fitted[j]!;
            if (
                overlaps(
                    p.offset,
                    p.opening.width,
                    q.offset,
                    q.opening.width,
                ) &&
                !overlaps(
                    p.opening.offset,
                    p.opening.width,
                    q.opening.offset,
                    q.opening.width,
                )
            ) {
                const [first, second] =
                    cmpId(p.opening.id, q.opening.id) <= 0 ? [p, q] : [q, p];
                fail('opening_overlap', {
                    wallId,
                    openingId: first.opening.id,
                    otherId: second.opening.id,
                });
            }
        }
    }
    for (const { opening, offset } of fitted) {
        if (opening.offset !== offset) opening.offset = offset;
    }
}

// ---- nextOpeningLabel --------------------------------------------------------------

/**
 * The next free label, `D{n}` for doors and `W{n}` for windows, where `n` is
 * one more than the largest number in an existing `D{n}` / `W{n}` label.
 */
export function nextOpeningLabel(
    d: Pick<PlanDocument, 'openings'>,
    kind: 'door' | 'window',
): string {
    const letter = kind === 'door' ? 'D' : 'W';
    const pattern = new RegExp(`^${letter}(\\d+)$`);
    let largest = 0;
    for (const o of Object.values(d.openings)) {
        const match = o.label === null ? null : pattern.exec(o.label);
        if (match === null) continue;
        const n = Number(match[1]);
        if (Number.isSafeInteger(n) && n > largest) largest = n;
    }
    return `${letter}${largest + 1}`;
}
