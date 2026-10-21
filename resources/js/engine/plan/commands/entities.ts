/**
 * Selection-wide commands (04 §6.6): `translateEntities`, `nudgeEntities` and
 * `deleteEntities` (`insertFragment` is in `fragment.ts`). They take a mixed
 * selection of ids and recognise each id by its prefix (`n_`, `w_`, `o_`,
 * `r_`, `f_`, `x_`, `d_`, `t_`) or as `'background'`.
 *
 * Rulings carried by this file (ledgered for the spec 19 reconciliation):
 * - Every id of a selection must name an existing entity, else `not_found`;
 *   `'background'` without a background is `not_found` too. A locked
 *   background in a translated selection stays where it is (no refusal).
 * - `translateEntities` accepts opening and RoomMeta ids but moves them only
 *   the 04 §6.6 way: openings with their walls, anchors when every wall of
 *   their face moves. Attached dimensions follow their wall in post-process.
 * - A placement attached to a wall that has a moved node follows that wall
 *   in post-process (selected or not), as it does for every wall edit. A
 *   selected attached placement whose wall does not move is translated and
 *   detached.
 * - A stretched wall (one moved node) under `MIN_WALL_LENGTH` is refused
 *   `wall_too_short`; a moved point outside `+-MAX_COORD` is `out_of_range`
 *   on `position.x` / `position.y`; `dx`, `dy` are whole millimetres within
 *   `+-MAX_SPAN`.
 * - `finalize` (and every nudge) places each moved node that lies within
 *   `NODE_MERGE_TOL` of an unmoved node on that node (the nearest; ties by
 *   id) and merges it into it, re-fits the openings of the walls whose
 *   length changed, then runs `splitIntersections` on every remaining wall
 *   at a moved node.
 * - `hash(ids)` of the merge keys is cyrb53 of the sorted ids joined by
 *   `,` after dropping duplicates (04 §6.6 does not dedupe): a selection is
 *   a set, so `[a, b, a]` and `[a, b]` drag as one.
 * - `deleteEntities` deletes the walls of selected nodes as `deleteNode`
 *   does, together with the selected walls, in one `deleteWalls` pass.
 */
import { z } from 'zod';
import type { Draft } from 'mutative';
import { CommandAbort, type CommandOutput } from '../../commands/types';
import { cmpId } from '../../compare';
import { cyrb53 } from '../../geometry/hash';
import { MIN_WALL_LENGTH, NODE_MERGE_TOL } from '../../geometry/tolerance';
import { dist, type Vec2 } from '../../geometry/vec2';
import type { DerivedPlan } from '../derive';
import type { PlanDocument, Wall } from '../schema';
import { definePlanCommand } from './define';
import {
    mergeNodeInto,
    pushDeleted,
    reclampOpenings,
    splitIntersections,
    wallLength,
} from './helpers';
import type { PlanCommandContext } from './pipeline';
import {
    MAX_SPAN,
    type Planned,
    checkPoint,
    checkRange,
    has,
    hasError,
    message,
    mm,
    notFound,
    uniqueSorted,
} from './validators';
import { removeWalls } from './walls';

type Doc = Draft<PlanDocument>;
type Out = CommandOutput<unknown>;
type Point = { x: number; y: number };

// ---- params schemas -------------------------------------------------------------------------

const IdsSchema = z.array(z.string()).min(1);

const TranslateSchema = z.object({
    ids: IdsSchema,
    dx: z.number(),
    dy: z.number(),
    finalize: z.boolean(),
});
type TranslateParams = z.infer<typeof TranslateSchema>;

const NudgeSchema = z.object({
    ids: IdsSchema,
    dx: z.number(),
    dy: z.number(),
});
type NudgeParams = z.infer<typeof NudgeSchema>;

const DeleteEntitiesSchema = z.object({ ids: IdsSchema });
type DeleteEntitiesParams = z.infer<typeof DeleteEntitiesSchema>;

// ---- selections ---------------------------------------------------------------------------------

/** A selection split by entity kind, each list distinct and in id order. */
interface Selection {
    nodes: string[];
    walls: string[];
    openings: string[];
    rooms: string[];
    placements: string[];
    fixtures: string[];
    dimensions: string[];
    labels: string[];
    background: boolean;
}

type Kind = Exclude<keyof Selection, 'background'>;

const KIND_OF_PREFIX: Readonly<Record<string, Kind>> = {
    n_: 'nodes',
    w_: 'walls',
    o_: 'openings',
    r_: 'rooms',
    f_: 'placements',
    x_: 'fixtures',
    d_: 'dimensions',
    t_: 'labels',
};

/** The record a kind of entity lives in. */
function recordOf(doc: PlanDocument, kind: Kind): object {
    switch (kind) {
        case 'dimensions':
            return doc.annotations.dimensions;
        case 'labels':
            return doc.annotations.labels;
        default:
            return doc[kind];
    }
}

/** The selection by kind, or `not_found` for the first id naming nothing. */
function partition(
    doc: PlanDocument,
    ids: readonly string[],
): Planned<Selection> {
    const sel: Selection = {
        nodes: [],
        walls: [],
        openings: [],
        rooms: [],
        placements: [],
        fixtures: [],
        dimensions: [],
        labels: [],
        background: false,
    };
    for (const id of uniqueSorted(ids)) {
        if (id === 'background') {
            if (doc.background === null) return { error: notFound(id) };
            sel.background = true;
            continue;
        }
        const kind = KIND_OF_PREFIX[id.slice(0, 2)];
        if (kind === undefined || !has(recordOf(doc, kind), id)) {
            return { error: notFound(id) };
        }
        sel[kind].push(id);
    }
    return sel;
}

/** `hash(ids)` of 04 §6.6: cyrb53 of the sorted distinct ids joined by `,`. */
const hashIds = (ids: readonly string[]): number =>
    cyrb53(uniqueSorted(ids).join(','));

const pointOf = (doc: Pick<PlanDocument, 'nodes'>, id: string): Vec2 => {
    const node = doc.nodes[id]!;
    return { x: node.x, y: node.y };
};

const hasEnds = (doc: Pick<PlanDocument, 'nodes'>, wall: Wall): boolean =>
    has(doc.nodes, wall.a) && has(doc.nodes, wall.b);

// ---- translate: the plan -------------------------------------------------------------------------

/** What a translation moves, all lists in id order. */
interface TranslatePlan {
    dx: number;
    dy: number;
    nodes: ReadonlySet<string>;
    /** Placements moved by `(dx, dy)`; those in `detach` lose their wall. */
    placements: string[];
    detach: ReadonlySet<string>;
    fixtures: string[];
    labels: string[];
    /** Unattached dimensions. */
    dimensions: string[];
    /** RoomMetas whose whole face moves. */
    anchors: string[];
    background: boolean;
}

function planTranslate(
    doc: PlanDocument,
    geometry: DerivedPlan,
    p: { ids: string[]; dx: number; dy: number },
): Planned<TranslatePlan> {
    const sel = partition(doc, p.ids);
    if (hasError(sel)) return sel;
    const dx = mm(p.dx);
    const dy = mm(p.dy);
    const range =
        checkRange('dx', dx, -MAX_SPAN, MAX_SPAN) ??
        checkRange('dy', dy, -MAX_SPAN, MAX_SPAN);
    if (range !== null) return { error: range };
    const moved = (q: Point): Point => ({ x: q.x + dx, y: q.y + dy });

    const nodes = new Set(sel.nodes);
    for (const id of sel.walls) {
        const wall = doc.walls[id]!;
        for (const end of [wall.a, wall.b]) {
            if (has(doc.nodes, end)) nodes.add(end);
        }
    }
    const points: Point[] = [...nodes].map((id) => moved(doc.nodes[id]!));

    // walls with one moved end stretch
    for (const wall of Object.values(doc.walls)) {
        if (nodes.has(wall.a) === nodes.has(wall.b) || !hasEnds(doc, wall)) {
            continue;
        }
        const a = nodes.has(wall.a)
            ? moved(pointOf(doc, wall.a))
            : pointOf(doc, wall.a);
        const b = nodes.has(wall.b)
            ? moved(pointOf(doc, wall.b))
            : pointOf(doc, wall.b);
        const length = dist(a, b);
        if (length < MIN_WALL_LENGTH) {
            return {
                error: message('wall_too_short', {
                    wallId: wall.id,
                    length: mm(length),
                }),
            };
        }
    }

    const placements: string[] = [];
    const detach = new Set<string>();
    for (const id of sel.placements) {
        const placement = doc.placements[id]!;
        const attachment = placement.wallAttachment;
        const wall =
            attachment === null ? undefined : doc.walls[attachment.wallId];
        // it follows its wall in post-process
        if (wall !== undefined && (nodes.has(wall.a) || nodes.has(wall.b))) {
            continue;
        }
        placements.push(id);
        if (attachment !== null) detach.add(id);
        points.push(moved(placement));
    }
    for (const id of sel.fixtures) points.push(moved(doc.fixtures[id]!));
    for (const id of sel.labels) {
        points.push(moved(doc.annotations.labels[id]!.position));
    }
    const dimensions = sel.dimensions.filter(
        (id) => doc.annotations.dimensions[id]!.attachedTo === null,
    );
    for (const id of dimensions) {
        const dim = doc.annotations.dimensions[id]!;
        points.push(moved(dim.a), moved(dim.b));
    }

    const anchors: string[] = [];
    for (const room of geometry.rooms) {
        const metaId = room.metaId;
        if (metaId === null || !has(doc.rooms, metaId)) continue;
        const whole =
            room.wallIds.length > 0 &&
            room.wallIds.every((id) => {
                const wall = doc.walls[id];
                return (
                    wall !== undefined && nodes.has(wall.a) && nodes.has(wall.b)
                );
            });
        if (!whole) continue;
        anchors.push(metaId);
        points.push(moved(doc.rooms[metaId]!.anchor));
    }

    const background =
        sel.background && doc.background !== null && !doc.background.locked;
    if (background) points.push(moved(doc.background!.position));

    for (const point of points) {
        const refusal = checkPoint('position', point);
        if (refusal !== null) return { error: refusal };
    }
    return {
        dx,
        dy,
        nodes,
        placements,
        detach,
        fixtures: sel.fixtures,
        labels: sel.labels,
        dimensions,
        anchors: uniqueSorted(anchors),
        background,
    };
}

// ---- translate: the run --------------------------------------------------------------------------

/** Shifts a point in place; an unchanged coordinate makes no patch. */
function shiftPoint(target: Point, dx: number, dy: number): void {
    if (dx !== 0) target.x = mm(target.x + dx);
    if (dy !== 0) target.y = mm(target.y + dy);
}

/**
 * The unmoved node each moved node lands on (within `NODE_MERGE_TOL`; the
 * nearest, ties by id), keyed by moved node, in id order.
 */
function mergeTargets(d: Doc, moved: ReadonlySet<string>): Map<string, string> {
    const targets = new Map<string, string>();
    const fixed = Object.keys(d.nodes)
        .filter((id) => !moved.has(id))
        .sort(cmpId);
    for (const id of [...moved].sort(cmpId)) {
        const at = pointOf(d, id);
        let best: { id: string; distance: number } | null = null;
        for (const other of fixed) {
            const distance = dist(at, pointOf(d, other));
            if (
                distance <= NODE_MERGE_TOL &&
                (best === null || distance < best.distance)
            ) {
                best = { id: other, distance };
            }
        }
        if (best !== null) targets.set(id, best.id);
    }
    return targets;
}

/** Runs a translation planned by `planTranslate` (04 §6.6 `translateEntities`). */
function translate(
    d: Doc,
    plan: TranslatePlan,
    finalize: boolean,
    ctx: Pick<PlanCommandContext, 'newId'>,
    out: Out,
): void {
    const { dx, dy, nodes } = plan;
    const incident = Object.keys(d.walls)
        .sort(cmpId)
        .flatMap((id) => {
            const wall = d.walls[id]!;
            const a = nodes.has(wall.a);
            const b = nodes.has(wall.b);
            if ((!a && !b) || !hasEnds(d, wall)) return [];
            const end: 'a' | 'b' | 'both' = a && b ? 'both' : a ? 'a' : 'b';
            return [{ id, end, oldLength: wallLength(d, id) }];
        });

    for (const id of [...nodes].sort(cmpId)) shiftPoint(d.nodes[id]!, dx, dy);
    const targets = finalize
        ? mergeTargets(d, nodes)
        : new Map<string, string>();
    for (const [src, dst] of targets) {
        const node = d.nodes[src]!;
        const at = pointOf(d, dst);
        if (node.x !== at.x) node.x = at.x;
        if (node.y !== at.y) node.y = at.y;
    }
    for (const w of incident) {
        const length = wallLength(d, w.id);
        if (Math.abs(length - w.oldLength) < 1e-9) continue;
        if (length < MIN_WALL_LENGTH) {
            throw new CommandAbort(
                message('wall_too_short', { wallId: w.id, length: mm(length) }),
            );
        }
        reclampOpenings(d, w.id, w.end, w.oldLength);
    }

    for (const id of plan.placements) {
        const placement = d.placements[id]!;
        shiftPoint(placement, dx, dy);
        if (plan.detach.has(id)) placement.wallAttachment = null;
    }
    for (const id of plan.fixtures) shiftPoint(d.fixtures[id]!, dx, dy);
    for (const id of plan.labels) {
        shiftPoint(d.annotations.labels[id]!.position, dx, dy);
    }
    for (const id of plan.dimensions) {
        const dim = d.annotations.dimensions[id]!;
        shiftPoint(dim.a, dx, dy);
        shiftPoint(dim.b, dx, dy);
    }
    for (const id of plan.anchors) shiftPoint(d.rooms[id]!.anchor, dx, dy);
    if (plan.background) shiftPoint(d.background!.position, dx, dy);

    if (!finalize) return;
    for (const [src, dst] of targets) mergeNodeInto(d, src, dst, ctx, out);
    for (const w of incident) {
        if (has(d.walls, w.id)) splitIntersections(d, w.id, ctx, out);
    }
}

// ---- translateEntities / nudgeEntities -----------------------------------------------------------

const translateEntities = definePlanCommand<TranslateParams>({
    type: 'translateEntities',
    labelKey: 'engine.plan.command.label.translate_entities',
    paramsSchema: TranslateSchema,
    validate(doc, p, ctx) {
        const plan = planTranslate(doc, ctx.geometry, p);
        return hasError(plan) ? plan.error : null;
    },
    run(d, p, ctx, out) {
        const plan = planTranslate(d, ctx.geometry, p);
        if (hasError(plan)) throw new CommandAbort(plan.error);
        translate(d, plan, p.finalize, ctx, out);
    },
    mergeKey: (p) => `translate:${hashIds(p.ids)}`,
    mergeMode: 'replace',
    touchesGeometry: true,
});

const nudgeEntities = definePlanCommand<NudgeParams>({
    type: 'nudgeEntities',
    labelKey: 'engine.plan.command.label.nudge_entities',
    paramsSchema: NudgeSchema,
    validate(doc, p, ctx) {
        const plan = planTranslate(doc, ctx.geometry, p);
        return hasError(plan) ? plan.error : null;
    },
    run(d, p, ctx, out) {
        const plan = planTranslate(d, ctx.geometry, p);
        if (hasError(plan)) throw new CommandAbort(plan.error);
        translate(d, plan, true, ctx, out);
    },
    mergeKey: (p) => `nudge:${hashIds(p.ids)}`,
    mergeMode: 'compose',
    touchesGeometry: true,
});

// ---- deleteEntities -------------------------------------------------------------------------------

export interface DeleteEntitiesResult {
    /**
     * Every id the command deleted, cascades and post-process included; the
     * very array of `ExecuteResult.deletedIds` (see `deleteWalls`).
     */
    deletedIds: string[];
}

const deleteEntities = definePlanCommand<
    DeleteEntitiesParams,
    DeleteEntitiesResult
>({
    type: 'deleteEntities',
    labelKey: 'engine.plan.command.label.delete_entities',
    paramsSchema: DeleteEntitiesSchema,
    validate(doc, p) {
        const sel = partition(doc, p.ids);
        return hasError(sel) ? sel.error : null;
    },
    run(d, p, _ctx, out) {
        const sel = partition(d, p.ids);
        if (hasError(sel)) throw new CommandAbort(sel.error);

        // walls first, so their cascades are not deleted twice
        const walls = new Set(sel.walls);
        const nodes = new Set(sel.nodes);
        for (const wall of Object.values(d.walls)) {
            if (nodes.has(wall.a) || nodes.has(wall.b)) walls.add(wall.id);
        }
        removeWalls(d, uniqueSorted([...walls]), sel.nodes, out);

        const remove = (record: Record<string, unknown>, ids: string[]) => {
            for (const id of ids) {
                if (!has(record, id)) continue;
                delete record[id];
                pushDeleted(out, id);
            }
        };
        remove(d.openings, sel.openings);
        remove(d.rooms, sel.rooms);
        remove(d.placements, sel.placements);
        remove(d.fixtures, sel.fixtures);
        remove(d.annotations.dimensions, sel.dimensions);
        remove(d.annotations.labels, sel.labels);
        if (sel.background && d.background !== null) {
            d.background = null;
            pushDeleted(out, 'background');
        }
        out.result = { deletedIds: out.deletedIds };
    },
    touchesGeometry: true,
});

/** The selection-wide commands, registered in `PLAN_COMMANDS` (04 §6.6). */
export const ENTITY_COMMANDS = {
    translateEntities,
    nudgeEntities,
    deleteEntities,
};
