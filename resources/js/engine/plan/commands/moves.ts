/**
 * Move commands (04 §6.6): `moveNode`, `moveWall` and `setWallLength`.
 *
 * They are drag commands. A drag sends many `finalize: false` steps that only
 * move nodes and re-fit the openings of the walls that follow (cheap: no
 * search of the wall graph beyond the walls at the moved nodes), then one
 * `finalize: true` that does the topology work: merging into a node or a wall
 * under the drop point and splitting crossed walls. `moveNode` and `moveWall`
 * merge with `replace` mode (the bus re-runs each step on the pre-drag
 * document), so the whole drag, finalize included, is one history entry.
 *
 * Rulings carried by this file (logged in spec 19):
 * - `moveNode` with `finalize` snaps to ONE target: the nearest other node
 *   within `NODE_MERGE_TOL` of the drop point, else the nearest non-incident
 *   wall whose centre line is that close (a T node splits it; a drop that
 *   projects within `MIN_WALL_LENGTH` of the wall's end snaps to that end
 *   node, as `resolveEndpoint` does). The moved node is then placed ON the
 *   target and merged into it, so `mergedInto` is the target's id (the new T
 *   node for a split). The 04 §6.6 exception to the minimum length is read as
 *   "the wall to the merge target"; any other incident wall must still be
 *   `MIN_WALL_LENGTH` long to the position the node ends at.
 * - A wall to the merge target is merged away with its openings; it is not
 *   re-fitted first.
 * - `moveWall` slides an end along its single other wall only when that wall
 *   is not parallel and the slide is not near-parallel (`10·|distance| +
 *   1000`). At an end with no other wall, or with two or more (a T, a cross),
 *   the end is translated by `n·distance` and the walls there stretch (04 §6.6
 *   is explicit; tested with three walls at one end).
 * - `moveWall` rounds `distance` to whole millimetres and every new node
 *   position to whole millimetres.
 * - `moveWall` has no node merge on finalize (04 §6.6 only asks for
 *   `splitIntersections`).
 * - `moveWall` refuses (`wall_too_short`) when a neighbour would turn round
 *   (its new direction against the old one has a dot product <= 0), even if
 *   it would still be `MIN_WALL_LENGTH` long.
 * - `setWallLength` never merges its own wall away: a moved end that would
 *   snap onto the fixed end, or onto a node under `MIN_WALL_LENGTH` from it,
 *   is refused `wall_too_short`. A length that would put the moved end
 *   outside the coordinate range is `out_of_range` on `length`.
 * - `setWallLength.movedNodeId` is the node that was moved; with the finalize
 *   merge it may no longer exist.
 * - Pre-existing opening overlaps do not block a move (Task 22 ruling,
 *   `reclampOpenings`).
 */
import { z } from 'zod';
import type { Draft } from 'mutative';
import { CommandAbort, type CommandOutput } from '../../commands/types';
import { cmpId } from '../../compare';
import {
    closestPointOnSeg,
    lineIntersection,
    type Seg,
} from '../../geometry/segment';
import {
    MAX_COORD,
    MIN_WALL_LENGTH,
    NODE_MERGE_TOL,
} from '../../geometry/tolerance';
import {
    add,
    dist,
    dot,
    len,
    normalize,
    perpLeft,
    roundPoint,
    scale,
    sub,
    type Vec2,
} from '../../geometry/vec2';
import type { PlanDocument, Wall } from '../schema';
import type { EngineMessage } from '../types';
import { PointParamSchema, definePlanCommand } from './define';
import {
    mergeNodeInto,
    reclampOpenings,
    splitIntersections,
    splitWallAt,
    wallLength,
} from './helpers';
import type { PlanCommandContext } from './pipeline';
import { MAX_SPAN, checkRange, has, message, mm, notFound } from './validators';

type Doc = Draft<PlanDocument>;
type Graph = Pick<PlanDocument, 'nodes' | 'walls'>;
type Ids = Pick<PlanCommandContext, 'newId'>;

// ---- params schemas -------------------------------------------------------------------------

const MoveNodeSchema = z.object({
    nodeId: z.string(),
    to: PointParamSchema,
    finalize: z.boolean(),
});
type MoveNodeParams = z.infer<typeof MoveNodeSchema>;

const MoveWallSchema = z.object({
    wallId: z.string(),
    distance: z.number(),
    finalize: z.boolean(),
});
type MoveWallParams = z.infer<typeof MoveWallSchema>;

const SetWallLengthSchema = z.object({
    wallId: z.string(),
    length: z.number(),
    anchor: z.enum(['a', 'b', 'auto']),
});
type SetWallLengthParams = z.infer<typeof SetWallLengthSchema>;

// ---- shared helpers -----------------------------------------------------------------------------

/** `roundPoint` without a negative zero. */
function roundedPoint(p: Vec2): Vec2 {
    const r = roundPoint(p);
    return { x: r.x + 0, y: r.y + 0 };
}

const pointOf = (graph: Pick<PlanDocument, 'nodes'>, id: string): Vec2 => {
    const node = graph.nodes[id]!;
    return { x: node.x, y: node.y };
};

/** The walls at a node, by id. */
function wallsAt(graph: Pick<PlanDocument, 'walls'>, nodeId: string): Wall[] {
    return Object.values(graph.walls)
        .filter((w) => w.a === nodeId || w.b === nodeId)
        .sort((p, q) => cmpId(p.id, q.id));
}

/** `not_found` for the first end of `wall` that is not a node of the graph. */
function missingEnd(
    graph: Pick<PlanDocument, 'nodes'>,
    wall: Wall,
): EngineMessage | null {
    for (const id of [wall.a, wall.b]) {
        if (!has(graph.nodes, id)) return notFound(id);
    }
    return null;
}

/** `wall_too_short` when `length` (a float) is under the minimum. */
function checkLength(wallId: string, length: number): EngineMessage | null {
    return length < MIN_WALL_LENGTH
        ? message('wall_too_short', { wallId, length: mm(length) })
        : null;
}

// ---- moveNode: the snap target -------------------------------------------------------------------

type SnapTarget =
    | { kind: 'node'; nodeId: string; at: Vec2 }
    | { kind: 'wall'; wallId: string; at: Vec2 };

/**
 * What a finalized node drop at `to` merges into (04 §6.6 `moveNode`): the
 * nearest other node within `NODE_MERGE_TOL`; else the nearest wall (not one
 * at the node) whose centre line is within `NODE_MERGE_TOL`, as a split point
 * or, near an end of that wall, as the end node. `at` is where the moved node
 * ends up. `null` when there is nothing to snap to.
 */
function findSnapTarget(
    graph: Graph,
    nodeId: string,
    to: Vec2,
): SnapTarget | null {
    let node: { id: string; distance: number } | null = null;
    for (const other of Object.values(graph.nodes)) {
        if (other.id === nodeId) continue;
        const distance = dist(to, other);
        if (distance > NODE_MERGE_TOL) continue;
        if (
            node === null ||
            distance < node.distance ||
            (distance === node.distance && cmpId(other.id, node.id) < 0)
        ) {
            node = { id: other.id, distance };
        }
    }
    if (node !== null) {
        return { kind: 'node', nodeId: node.id, at: pointOf(graph, node.id) };
    }

    let wall: { wall: Wall; seg: Seg; distance: number } | null = null;
    for (const w of Object.values(graph.walls)) {
        if (w.a === nodeId || w.b === nodeId) continue;
        if (!has(graph.nodes, w.a) || !has(graph.nodes, w.b)) continue;
        const seg = { a: pointOf(graph, w.a), b: pointOf(graph, w.b) };
        const { dist: distance } = closestPointOnSeg(to, seg);
        if (distance > NODE_MERGE_TOL) continue;
        if (
            wall === null ||
            distance < wall.distance ||
            (distance === wall.distance && cmpId(w.id, wall.wall.id) < 0)
        ) {
            wall = { wall: w, seg, distance };
        }
    }
    if (wall === null) return null;

    const { a, b } = wall.seg;
    const length = dist(a, b);
    const u = length < 1e-9 ? 0 : dot(sub(to, a), sub(b, a)) / length;
    // the same bounds as `splitWallAt`: nearer an end than that is the end node
    if (u <= MIN_WALL_LENGTH || u >= length - MIN_WALL_LENGTH) {
        const end = u <= length - u ? wall.wall.a : wall.wall.b;
        return { kind: 'node', nodeId: end, at: pointOf(graph, end) };
    }
    return {
        kind: 'wall',
        wallId: wall.wall.id,
        at: roundedPoint(add(a, scale(sub(b, a), u / length))),
    };
}

// ---- moveNode: validate and run -------------------------------------------------------------------

/**
 * The refusal of `moveNode` (04 §6.6): the node exists, the target is inside
 * the coordinate range and every wall at the node stays `MIN_WALL_LENGTH`
 * long. A finalized move first resolves the snap target, since the walls to
 * the merge target are merged away and the rest are measured to where the
 * node ends up.
 */
function checkNodeMove(
    doc: Graph,
    nodeId: string,
    to: Vec2,
    finalize: boolean,
): EngineMessage | null {
    if (!has(doc.nodes, nodeId)) return notFound(nodeId);
    const x = mm(to.x);
    const y = mm(to.y);
    const range =
        checkRange('to.x', x, -MAX_COORD, MAX_COORD) ??
        checkRange('to.y', y, -MAX_COORD, MAX_COORD);
    if (range !== null) return range;

    const target = finalize ? findSnapTarget(doc, nodeId, { x, y }) : null;
    const end = target === null ? { x, y } : target.at;
    for (const wall of wallsAt(doc, nodeId)) {
        const far = wall.a === nodeId ? wall.b : wall.a;
        if (!has(doc.nodes, far)) return notFound(far);
        if (target?.kind === 'node' && far === target.nodeId) continue;
        const short = checkLength(wall.id, dist(pointOf(doc, far), end));
        if (short !== null) return short;
    }
    return null;
}

/**
 * Moves a node (04 §6.6 `moveNode`) and returns the id it merged into, or
 * `null`. Without `finalize` it only sets the position and re-fits the
 * openings of the walls at the node.
 */
function moveNodeTo(
    d: Doc,
    nodeId: string,
    to: Vec2,
    finalize: boolean,
    ctx: Ids,
    out: CommandOutput<unknown>,
): string | null {
    const wanted = roundedPoint(to);
    const target = finalize ? findSnapTarget(d, nodeId, wanted) : null;
    let into: string | null = null;
    let end = wanted;
    if (target?.kind === 'node') {
        into = target.nodeId;
        end = target.at;
    } else if (target?.kind === 'wall') {
        // the wall is not one at the node, so the split leaves those alone
        into = splitWallAt(d, target.wallId, wanted, ctx, out);
        end = pointOf(d, into);
    }

    const incident = wallsAt(d, nodeId).map((w) => ({
        id: w.id,
        end: (w.a === nodeId ? 'a' : 'b') as 'a' | 'b',
        far: w.a === nodeId ? w.b : w.a,
        oldLength: wallLength(d, w.id),
    }));
    const node = d.nodes[nodeId]!;
    if (node.x !== end.x) node.x = end.x;
    if (node.y !== end.y) node.y = end.y;
    for (const w of incident) {
        // a wall to the merge target is merged away, with its openings
        if (into !== null && w.far === into) continue;
        reclampOpenings(d, w.id, w.end, w.oldLength);
    }
    if (into === null) {
        if (finalize) {
            for (const w of incident) splitIntersections(d, w.id, ctx, out);
        }
        return null;
    }
    mergeNodeInto(d, nodeId, into, ctx, out);
    for (const w of incident) {
        if (has(d.walls, w.id)) splitIntersections(d, w.id, ctx, out);
    }
    return into;
}

export interface MoveNodeResult {
    /** The node the moved node was merged into (it is gone), or `null`. */
    mergedInto: string | null;
}

const moveNode = definePlanCommand<MoveNodeParams, MoveNodeResult>({
    type: 'moveNode',
    labelKey: 'engine.plan.command.label.move_node',
    paramsSchema: MoveNodeSchema,
    validate: (doc, p) => checkNodeMove(doc, p.nodeId, p.to, p.finalize),
    run(d, p, ctx, out) {
        out.result = {
            mergedInto: moveNodeTo(d, p.nodeId, p.to, p.finalize, ctx, out),
        };
    },
    mergeKey: (p) => `moveNode:${p.nodeId}`,
    mergeMode: 'replace',
    touchesGeometry: true,
});

// ---- moveWall ----------------------------------------------------------------------------------------

/**
 * Where the ends of a wall go when it moves by `distance` along its `+n`
 * (04 §6.6 `moveWall`): each end slides along its single other wall when
 * that wall is not parallel and the slide is not near-parallel, else it
 * translates. Keys are node ids; positions are whole millimetres.
 */
function wallMoveTargets(
    graph: Graph,
    wall: Wall,
    distance: number,
): Map<string, Vec2> | EngineMessage {
    const missing = missingEnd(graph, wall);
    if (missing !== null) return missing;
    const a = pointOf(graph, wall.a);
    const b = pointOf(graph, wall.b);
    const dir = normalize(sub(b, a));
    const shift = scale(perpLeft(dir), distance);
    const limit = 10 * Math.abs(distance) + 1000;

    const moves = new Map<string, Vec2>();
    for (const nodeId of [wall.a, wall.b]) {
        const at = pointOf(graph, nodeId);
        const translated = add(at, shift);
        const others = wallsAt(graph, nodeId).filter((w) => w.id !== wall.id);
        let end = translated;
        if (others.length === 1) {
            const other = others[0]!;
            const far = other.a === nodeId ? other.b : other.a;
            if (!has(graph.nodes, far)) return notFound(far);
            const slid = lineIntersection(
                translated,
                dir,
                at,
                sub(pointOf(graph, far), at),
            );
            if (slid !== null && dist(slid, at) <= limit) end = slid;
        }
        moves.set(nodeId, roundedPoint(end));
    }
    return moves;
}

/** The walls at the ends of `wall`, `wall` first, then by id. */
function touchedWalls(graph: Pick<PlanDocument, 'walls'>, wall: Wall): Wall[] {
    const seen = new Map<string, Wall>();
    for (const nodeId of [wall.a, wall.b]) {
        for (const w of wallsAt(graph, nodeId)) seen.set(w.id, w);
    }
    seen.delete(wall.id);
    return [wall, ...[...seen.values()].sort((p, q) => cmpId(p.id, q.id))];
}

function checkWallMove(doc: Graph, p: MoveWallParams): EngineMessage | null {
    const wall = doc.walls[p.wallId];
    if (wall === undefined) return notFound(p.wallId);
    const distance = mm(p.distance);
    const range = checkRange('distance', distance, -MAX_SPAN, MAX_SPAN);
    if (range !== null) return range;
    const moves = wallMoveTargets(doc, wall, distance);
    if (!(moves instanceof Map)) return moves;
    for (const [, at] of moves) {
        const bounded =
            checkRange('position.x', at.x, -MAX_COORD, MAX_COORD) ??
            checkRange('position.y', at.y, -MAX_COORD, MAX_COORD);
        if (bounded !== null) return bounded;
    }
    for (const w of touchedWalls(doc, wall)) {
        const missing = missingEnd(doc, w);
        if (missing !== null) return missing;
        const was = sub(pointOf(doc, w.b), pointOf(doc, w.a));
        const now = sub(
            moves.get(w.b) ?? pointOf(doc, w.b),
            moves.get(w.a) ?? pointOf(doc, w.a),
        );
        // a neighbour that would turn round is refused whatever its length
        if (w.id !== wall.id && dot(now, was) <= 0) {
            return message('wall_too_short', {
                wallId: w.id,
                length: mm(len(now)),
            });
        }
        const short = checkLength(w.id, len(now));
        if (short !== null) return short;
    }
    return null;
}

const moveWall = definePlanCommand<MoveWallParams>({
    type: 'moveWall',
    labelKey: 'engine.plan.command.label.move_wall',
    paramsSchema: MoveWallSchema,
    validate: (doc, p) => checkWallMove(doc, p),
    run(d, p, ctx, out) {
        const wall = d.walls[p.wallId]!;
        const moves = wallMoveTargets(d, wall, mm(p.distance));
        if (!(moves instanceof Map)) throw new CommandAbort(moves);
        const touched = touchedWalls(d, wall).map((w) => ({
            id: w.id,
            oldLength: wallLength(d, w.id),
            // which ends move; the moved wall keeps its offsets
            end: (w.id === p.wallId
                ? 'both'
                : moves.has(w.a) && moves.has(w.b)
                  ? 'both'
                  : moves.has(w.a)
                    ? 'a'
                    : 'b') as 'a' | 'b' | 'both',
        }));
        for (const [nodeId, at] of moves) {
            const node = d.nodes[nodeId]!;
            if (node.x !== at.x) node.x = at.x;
            if (node.y !== at.y) node.y = at.y;
        }
        for (const w of touched) reclampOpenings(d, w.id, w.end, w.oldLength);
        if (p.finalize) {
            for (const w of touched) {
                if (has(d.walls, w.id)) splitIntersections(d, w.id, ctx, out);
            }
        }
    },
    mergeKey: (p) => `moveWall:${p.wallId}`,
    mergeMode: 'replace',
    touchesGeometry: true,
});

// ---- setWallLength ----------------------------------------------------------------------------------

/** The node `setWallLength` moves and where it goes, or the refusal. */
function lengthTarget(
    doc: Graph,
    p: SetWallLengthParams,
): { movingId: string; fixedId: string; to: Vec2 } | { error: EngineMessage } {
    const wall = doc.walls[p.wallId];
    if (wall === undefined) return { error: notFound(p.wallId) };
    const missing = missingEnd(doc, wall);
    if (missing !== null) return { error: missing };
    const length = mm(p.length);
    const range = checkRange('length', length, MIN_WALL_LENGTH, MAX_SPAN);
    if (range !== null) return { error: range };

    const degree = (id: string): number => wallsAt(doc, id).length;
    const moveB =
        p.anchor === 'a' ||
        (p.anchor === 'auto' && (degree(wall.b) === 1 || degree(wall.a) !== 1));
    const fixedId = moveB ? wall.a : wall.b;
    const movingId = moveB ? wall.b : wall.a;
    const fixed = pointOf(doc, fixedId);
    const way = sub(pointOf(doc, movingId), fixed);
    if (dist(way, { x: 0, y: 0 }) < 1e-9) {
        return {
            error: message('wall_too_short', { wallId: wall.id, length: 0 }),
        };
    }
    const unit = normalize(way);
    // the longest wall that keeps the moved end inside the coordinate range
    let longest = MAX_SPAN;
    for (const [from, step] of [
        [fixed.x, unit.x],
        [fixed.y, unit.y],
    ] as const) {
        if (Math.abs(step) < 1e-9) continue;
        longest = Math.min(
            longest,
            Math.floor(((step > 0 ? MAX_COORD : -MAX_COORD) - from) / step),
        );
    }
    const reach = checkRange('length', length, MIN_WALL_LENGTH, longest);
    if (reach !== null) return { error: reach };
    return {
        movingId,
        fixedId,
        to: roundedPoint(add(fixed, scale(unit, length))),
    };
}

export interface SetWallLengthResult {
    /** The node that was moved; it is gone if it merged into another. */
    movedNodeId: string;
}

const setWallLength = definePlanCommand<
    SetWallLengthParams,
    SetWallLengthResult
>({
    type: 'setWallLength',
    labelKey: 'engine.plan.command.label.set_wall_length',
    paramsSchema: SetWallLengthSchema,
    validate(doc, p) {
        const target = lengthTarget(doc, p);
        if ('error' in target) return target.error;
        // The wall is never merged away: a moved end that would snap onto
        // (or next to) its fixed end leaves it under the minimum length.
        const snap = findSnapTarget(doc, target.movingId, target.to);
        if (snap !== null) {
            const short = checkLength(
                p.wallId,
                dist(pointOf(doc, target.fixedId), snap.at),
            );
            if (short !== null) return short;
        }
        return checkNodeMove(doc, target.movingId, target.to, true);
    },
    run(d, p, ctx, out) {
        const target = lengthTarget(d, p);
        if ('error' in target) throw new CommandAbort(target.error);
        moveNodeTo(d, target.movingId, target.to, true, ctx, out);
        out.result = { movedNodeId: target.movingId };
    },
    touchesGeometry: true,
});

/** The move commands, registered in `PLAN_COMMANDS` (04 §6.6). */
export const MOVE_COMMANDS = { moveNode, moveWall, setWallLength };
