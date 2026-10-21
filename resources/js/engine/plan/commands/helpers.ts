/**
 * Wall-graph editing primitives shared by the plan commands (04 §6.5). They
 * work on the `mutative` draft a command runs in, read node positions from
 * that draft (never from the cached geometry, which is stale after the first
 * edit), take every new id from `ctx.newId`, and write every coordinate
 * rounded to integer millimetres (never as -0). A refusal is a `CommandAbort`
 * carrying an `engine.plan.command.*` message.
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
function pointAlong(d: Doc, wall: Wall, offset: number): Vec2 {
    const { a, b } = segmentOf(d, wall);
    const length = dist(a, b);
    return length < 1e-9 ? a : add(a, scale(sub(b, a), offset / length));
}

const sortedIds = (record: object): string[] => Object.keys(record).sort(cmpId);

/** The openings of one wall by offset, ties by id. */
function openingsOf(d: Doc, wallId: string): Draft<Opening>[] {
    return Object.values(d.openings)
        .filter((o) => o.wallId === wallId)
        .sort((p, q) => p.offset - q.offset || cmpId(p.id, q.id));
}

const pairKey = (a: string, b: string): string =>
    cmpId(a, b) <= 0 ? `${a}|${b}` : `${b}|${a}`;

function pushDeleted(out: Out, ...ids: string[]): void {
    for (const id of ids) {
        if (!out.deletedIds.includes(id)) out.deletedIds.push(id);
    }
}

/**
 * The integer offset nearest to `offset` at which an opening of `width`
 * lies inside a wall of `length`, or `null` when no integer offset does.
 */
function fitOffset(
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
function deleteWall(d: Doc, wallId: string, out: Out): void {
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
function splitAtNode(d: Doc, wallId: string, nodeId: string, ctx: Ids): string {
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
    return tailId;
}

/**
 * Splits `wallId` where `point` projects onto its centre line (04 §6.5):
 * returns the new node's id. A cut strictly inside an opening aborts with
 * `split_through_opening`. The caller passes a point inside the wall.
 */
export function splitWallAt(
    d: Doc,
    wallId: string,
    point: Vec2,
    ctx: Ids,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- uniform helper signature (04 §6.5)
    _out: Out,
): string {
    const wall = wallOf(d, wallId);
    const { a, b } = segmentOf(d, wall);
    const length = dist(a, b);
    const u =
        length < 1e-9
            ? 0
            : Math.min(
                  length,
                  Math.max(0, dot(sub(point, a), sub(b, a)) / length),
              );
    const at = roundedPoint(
        length < 1e-9 ? a : add(a, scale(sub(b, a), u / length)),
    );
    const nodeId = ctx.newId('n');
    d.nodes[nodeId] = { id: nodeId, x: at.x, y: at.y };
    splitAtNode(d, wallId, nodeId, ctx);
    return nodeId;
}

/**
 * Ends of a wall, resolved to a node (04 §6.5): an existing node id; else the
 * nearest node within `NODE_MERGE_TOL`; else a T-node on the nearest wall
 * whose centre line is within tolerance (not too close to its ends); else a
 * new node at the rounded point.
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

    let onWall: { id: string; distance: number; at: Vec2 } | null = null;
    for (const id of sortedIds(d.walls)) {
        const seg = segmentOf(d, d.walls[id]!);
        const length = dist(seg.a, seg.b);
        const hit = closestPointOnSeg(point, seg);
        const u = hit.t * length;
        if (
            hit.dist <= NODE_MERGE_TOL &&
            u >= NODE_MERGE_TOL &&
            u <= length - NODE_MERGE_TOL &&
            (onWall === null || hit.dist < onWall.distance)
        ) {
            onWall = { id, distance: hit.dist, at: hit.point };
        }
    }
    if (onWall !== null) return splitWallAt(d, onWall.id, onWall.at, ctx, out);

    const id = ctx.newId('n');
    const at = roundedPoint(point);
    d.nodes[id] = { id, x: at.x, y: at.y };
    return id;
}

// ---- insertWallSegment -------------------------------------------------------

/** A point where the new segment gets cut (04 §6.5 `insertWallSegment` step 2). */
interface SplitPoint {
    /** Parameter on the segment, 0 at `from`. */
    t: number;
    /** 0: the segment's own end; 1: an existing node; 2: a wall to split. */
    rank: 0 | 1 | 2;
    /** The node (rank 0 and 1; set after the split for rank 2). */
    nodeId: string | null;
    /** The wall to split and where (rank 2). */
    wallId?: string;
    point?: Vec2;
}

const splitOrder = (p: SplitPoint, q: SplitPoint): number =>
    p.t - q.t ||
    p.rank - q.rank ||
    cmpId(p.nodeId ?? p.wallId ?? '', q.nodeId ?? q.wallId ?? '');

/**
 * Sorts split points along the segment and drops those closer than
 * `NODE_MERGE_TOL` to the previous one; the stronger kind (end, existing node,
 * wall split) wins.
 */
function dedupeSplitPoints(points: SplitPoint[], length: number): SplitPoint[] {
    const kept: SplitPoint[] = [];
    for (const point of [...points].sort(splitOrder)) {
        const last = kept.at(-1);
        if (
            last !== undefined &&
            (point.t - last.t) * length < NODE_MERGE_TOL
        ) {
            if (point.rank < last.rank) kept[kept.length - 1] = point;
            continue;
        }
        kept.push(point);
    }
    return kept;
}

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

    const points: SplitPoint[] = [
        { t: 0, rank: 0, nodeId: fromNodeId },
        { t: 1, rank: 0, nodeId: toNodeId },
    ];
    const covered: Array<[number, number]> = [];

    // existing nodes near the interior
    for (const id of sortedIds(d.nodes)) {
        if (id === fromNodeId || id === toNodeId) continue;
        const p = nodePoint(d, id);
        const t = projectParam(p, seg);
        if (t <= 0 || t >= 1) continue;
        if (closestPointOnSeg(p, seg).dist <= NODE_MERGE_TOL) {
            points.push({ t, rank: 1, nodeId: id });
        }
    }

    // crossing and collinear walls
    for (const id of sortedIds(d.walls)) {
        const wall = d.walls[id]!;
        if (
            !Object.hasOwn(d.nodes, wall.a) ||
            !Object.hasOwn(d.nodes, wall.b)
        ) {
            continue;
        }
        const wallSeg = segmentOf(d, wall);
        const hit = intersectSegments(seg, wallSeg, NODE_MERGE_TOL);
        if (hit.kind === 'overlap') {
            covered.push([hit.t0, hit.t1]);
            for (const nodeId of [wall.a, wall.b]) {
                if (nodeId === fromNodeId || nodeId === toNodeId) continue;
                const t = projectParam(nodePoint(d, nodeId), seg);
                if (t > 0 && t < 1) points.push({ t, rank: 1, nodeId });
            }
            continue;
        }
        if (hit.kind !== 'point') continue;
        if (hit.t <= 0 || hit.t >= 1 || hit.u <= 0 || hit.u >= 1) continue;
        const near = [wall.a, wall.b].find(
            (nodeId) => dist(hit.point, nodePoint(d, nodeId)) <= NODE_MERGE_TOL,
        );
        if (near === undefined) {
            points.push({
                t: hit.t,
                rank: 2,
                nodeId: null,
                wallId: id,
                point: hit.point,
            });
            continue;
        }
        const t = projectParam(nodePoint(d, near), seg);
        if (t > 0 && t < 1 && near !== fromNodeId && near !== toNodeId) {
            points.push({ t, rank: 1, nodeId: near });
        }
    }

    const cuts = dedupeSplitPoints(points, length);
    for (const cut of cuts) {
        if (cut.rank === 2) {
            cut.nodeId = splitWallAt(d, cut.wallId!, cut.point!, ctx, out);
        }
    }

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
        if (dist(nodePoint(d, a), nodePoint(d, b)) < MIN_WALL_LENGTH) continue;
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

interface CutEvent {
    t: number;
    rank: 1 | 2;
    nodeId: string | null;
    /** The crossing wall to split first (rank 2). */
    otherId?: string;
    point?: Vec2;
}

/**
 * Splits `wallId` and the walls it properly crosses at the crossings (nodes
 * within `NODE_MERGE_TOL` are reused), and splits it at every node within
 * `NODE_MERGE_TOL` of its interior (04 §6.5). Walls are cut in order along
 * the wall, so the new ids are deterministic.
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
    if (length < 1e-9) return;

    const events: CutEvent[] = [];
    for (const id of sortedIds(d.nodes)) {
        if (id === wall.a || id === wall.b) continue;
        const p = nodePoint(d, id);
        const t = projectParam(p, seg);
        if (
            t > 0 &&
            t < 1 &&
            closestPointOnSeg(p, seg).dist <= NODE_MERGE_TOL
        ) {
            events.push({ t, rank: 1, nodeId: id });
        }
    }
    for (const id of sortedIds(d.walls)) {
        if (id === wallId) continue;
        const other = d.walls[id]!;
        if (
            !Object.hasOwn(d.nodes, other.a) ||
            !Object.hasOwn(d.nodes, other.b)
        ) {
            continue;
        }
        const hit = intersectSegments(seg, segmentOf(d, other), NODE_MERGE_TOL);
        if (hit.kind !== 'point') continue;
        if (hit.t <= 0 || hit.t >= 1 || hit.u <= 0 || hit.u >= 1) continue;
        const near = [other.a, other.b].find(
            (nodeId) => dist(hit.point, nodePoint(d, nodeId)) <= NODE_MERGE_TOL,
        );
        if (near === undefined) {
            events.push({
                t: hit.t,
                rank: 2,
                nodeId: null,
                otherId: id,
                point: hit.point,
            });
        } else if (near !== wall.a && near !== wall.b) {
            const t = projectParam(nodePoint(d, near), seg);
            if (t > 0 && t < 1) events.push({ t, rank: 1, nodeId: near });
        }
    }

    const order = (p: CutEvent, q: CutEvent): number =>
        p.t - q.t ||
        p.rank - q.rank ||
        cmpId(p.nodeId ?? p.otherId ?? '', q.nodeId ?? q.otherId ?? '');
    const cuts: CutEvent[] = [];
    for (const event of events.sort(order)) {
        const last = cuts.at(-1);
        const tooClose = (t: number): boolean =>
            t * length < NODE_MERGE_TOL || (1 - t) * length < NODE_MERGE_TOL;
        if (tooClose(event.t)) continue;
        if (
            last !== undefined &&
            (event.t - last.t) * length < NODE_MERGE_TOL
        ) {
            if (event.rank < last.rank) cuts[cuts.length - 1] = event;
            continue;
        }
        cuts.push(event);
    }

    // The wall keeps its id and always ends at the next cut; the rest of it
    // moves to the new wall each time, so the next cut splits that tail.
    let tail = wallId;
    for (const cut of cuts) {
        const nodeId =
            cut.rank === 2
                ? splitWallAt(d, cut.otherId!, cut.point!, ctx, out)
                : cut.nodeId!;
        tail = splitAtNode(d, tail, nodeId, ctx);
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
        const keeper = d.walls[ids[0]!]!;
        const keeperSeg = segmentOf(d, keeper);
        const keeperLength = dist(keeperSeg.a, keeperSeg.b);
        const keeperDir =
            keeperLength < 1e-9
                ? { x: 1, y: 0 }
                : scale(sub(keeperSeg.b, keeperSeg.a), 1 / keeperLength);
        for (const loserId of ids.slice(1)) {
            const loser = d.walls[loserId]!;
            const reversed = loser.a !== keeper.a;
            for (const o of openingsOf(d, loserId)) {
                const centre =
                    centres.get(o.id) ?? pointAlong(d, loser, o.offset);
                const offset = mm(dot(sub(centre, keeperSeg.a), keeperDir));
                const inside =
                    fitOffset(offset, o.width, keeperLength) === offset;
                const clear = openingsOf(d, keeper.id).every(
                    (other) =>
                        2 * offset + o.width <=
                            2 * other.offset - other.width ||
                        2 * offset - o.width >= 2 * other.offset + other.width,
                );
                if (!inside || !clear) {
                    delete d.openings[o.id];
                    pushDeleted(out, o.id);
                    continue;
                }
                o.wallId = keeper.id;
                o.offset = offset;
                if (reversed) {
                    o.hinge = o.hinge === 'start' ? 'end' : 'start';
                    o.swing = o.swing === 'left' ? 'right' : 'left';
                }
            }
            deleteWall(d, loserId, out);
        }
    }

    delete d.nodes[srcNodeId];
    pushDeleted(out, srcNodeId);
}

// ---- reclampOpenings ---------------------------------------------------------------

/**
 * Re-fits the openings of a wall whose length changed (04 §6.5): after node
 * `a` moved an opening keeps its distance to `b`, otherwise it keeps its
 * offset; then it is clamped into the wall. Aborts `opening_no_fit` when an
 * opening is wider than the wall and `opening_overlap` when two openings
 * collide after clamping.
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

    fitted.sort(
        (p, q) => p.offset - q.offset || cmpId(p.opening.id, q.opening.id),
    );
    for (let i = 1; i < fitted.length; i += 1) {
        const prev = fitted[i - 1]!;
        const next = fitted[i]!;
        if (
            2 * prev.offset + prev.opening.width >
            2 * next.offset - next.opening.width
        ) {
            fail('opening_overlap', {
                wallId,
                openingId: prev.opening.id,
                otherId: next.opening.id,
            });
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
export function nextOpeningLabel(d: Doc, kind: 'door' | 'window'): string {
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
