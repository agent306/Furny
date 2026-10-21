/**
 * Wall commands (04 §6.6): `addWall`, `addWallChain`, `splitWall`,
 * `mergeCollinearWalls`, `deleteWalls`, `deleteNode` and `setWallProps`.
 *
 * They are thin layers over the wall-graph helpers (04 §6.5, `helpers.ts`):
 * `validate` does the cheap checks without touching the document (ids exist,
 * ranges, plan size), `run` mutates the draft only. Re-association of room
 * metas and the follow-up of attached furniture and dimensions happen in the
 * pipeline's post-process phase, in the same history entry.
 *
 * Params schemas check types only. Numeric ranges are checked by `validate`
 * so that an out-of-range value is `out_of_range` with `{ field, min, max }`
 * (04 §6.6) and not a generic `invalid_params`.
 *
 * Rulings carried by this file (logged in spec 19):
 * - A segment of an `addWallChain` that an existing wall already covers is
 *   skipped, so a room drawn against an existing room works. The chain fails
 *   with `wall_duplicate` only when no wall at all was created.
 * - `setWallProps` refuses `opening_too_tall` only when it lowers a wall below
 *   an opening; a wall that is already too low for one (a dirty import) can
 *   still be edited and raised.
 * - `mergeCollinearWalls` at a node that does not have exactly two walls is
 *   `not_collinear` (04 §6.6 has no code for the degree check).
 */
import { z } from 'zod';
import type { Draft } from 'mutative';
import { CommandAbort, type CommandOutput } from '../../commands/types';
import { cmpId } from '../../compare';
import { MIN_WALL_LENGTH } from '../../geometry/tolerance';
import {
    add,
    dist,
    dot,
    isParallel,
    scale,
    sub,
    type Vec2,
} from '../../geometry/vec2';
import { WALL_HEIGHT_RANGE, WALL_THICKNESS_RANGE } from '../limits';
import { WALL_KINDS, WALL_MATERIALS } from '../schema';
import type { PlanDocument, Wall } from '../schema';
import type { EngineMessage } from '../types';
import { PointParamSchema, definePlanCommand } from './define';
import {
    deleteWall,
    fitOffset,
    insertWallSegment,
    openingsOf,
    pointAlong,
    pushDeleted,
    resolveEndpoint,
    splitWallAt,
    type WallProps,
} from './helpers';
import type { PlanCommandContext } from './pipeline';
import {
    assertWallCapacity,
    checkCapacity,
    checkRange,
    checkRef,
    fail,
    has,
    message,
    mm,
    notFound,
    uniqueSorted,
} from './validators';

type Doc = Draft<PlanDocument>;
type Out = CommandOutput<unknown>;
type Graph = Pick<PlanDocument, 'nodes' | 'walls'>;

// ---- params schemas -------------------------------------------------------------------------

const EndpointRefSchema = z.union([
    z.object({ nodeId: z.string() }),
    z.object({ point: PointParamSchema }),
]);

/** The optional properties of a new wall. */
const NewWallFields = {
    thickness: z.number().optional(),
    height: z.number().optional(),
    kind: z.enum(WALL_KINDS).optional(),
    material: z.enum(WALL_MATERIALS).optional(),
};

const AddWallSchema = z.object({
    from: EndpointRefSchema,
    to: EndpointRefSchema,
    ...NewWallFields,
});
type AddWallParams = z.infer<typeof AddWallSchema>;

const AddWallChainSchema = z
    .object({
        points: z.array(EndpointRefSchema),
        closed: z.boolean(),
        ...NewWallFields,
    })
    .superRefine((p, ctx) => {
        const min = p.closed ? 3 : 2;
        if (p.points.length < min) {
            ctx.addIssue({
                code: 'too_small',
                origin: 'array',
                minimum: min,
                inclusive: true,
                path: ['points'],
                message: `a ${p.closed ? 'closed ' : ''}chain needs at least ${min} points`,
            });
        }
    });
type AddWallChainParams = z.infer<typeof AddWallChainSchema>;

const SplitWallSchema = z.object({ wallId: z.string(), at: z.number() });
type SplitWallParams = z.infer<typeof SplitWallSchema>;

const MergeCollinearSchema = z.object({ nodeId: z.string() });
type MergeCollinearParams = z.infer<typeof MergeCollinearSchema>;

const DeleteWallsSchema = z.object({ wallIds: z.array(z.string()).min(1) });
type DeleteWallsParams = z.infer<typeof DeleteWallsSchema>;

const DeleteNodeSchema = z.object({ nodeId: z.string() });
type DeleteNodeParams = z.infer<typeof DeleteNodeSchema>;

const SetWallPropsSchema = z.object({
    wallIds: z.array(z.string()).min(1),
    props: z.object({
        thickness: z.number().optional(),
        height: z.number().optional(),
        kind: z.enum(WALL_KINDS).optional(),
        material: z.enum(WALL_MATERIALS).optional(),
        colorHex: z
            .string()
            .regex(/^#[0-9a-fA-F]{6}$/)
            .nullable()
            .optional(),
    }),
});
type SetWallPropsParams = z.infer<typeof SetWallPropsSchema>;

// ---- shared validation ---------------------------------------------------------------------------

function checkSizes(
    p: { thickness?: number | undefined; height?: number | undefined },
    prefix = '',
): EngineMessage | null {
    return (
        (p.thickness === undefined
            ? null
            : checkRange(
                  `${prefix}thickness`,
                  mm(p.thickness),
                  ...WALL_THICKNESS_RANGE,
              )) ??
        (p.height === undefined
            ? null
            : checkRange(`${prefix}height`, mm(p.height), ...WALL_HEIGHT_RANGE))
    );
}

/** The properties of a new wall: the given ones over the document defaults (04 §6.6 `addWall`). */
function newWallProps(
    p: Pick<AddWallParams, 'thickness' | 'height' | 'kind' | 'material'>,
    ctx: PlanCommandContext,
): WallProps {
    const kind = p.kind ?? 'interior';
    const fallbackThickness =
        kind === 'exterior'
            ? ctx.defaults.exteriorThickness
            : ctx.defaults.interiorThickness;
    return {
        thickness: mm(p.thickness ?? fallbackThickness),
        height: mm(p.height ?? ctx.defaults.wallHeight),
        kind,
        justification: 'center',
        material: p.material ?? 'brick',
        colorHex: null,
    };
}

function checkWallIds(doc: PlanDocument, ids: readonly string[]) {
    for (const id of ids) if (!has(doc.walls, id)) return notFound(id);
    return null;
}

const pointOf = (doc: Pick<PlanDocument, 'nodes'>, id: string): Vec2 => {
    const node = doc.nodes[id]!;
    return { x: node.x, y: node.y };
};

// ---- addWall ---------------------------------------------------------------------------------------

export interface AddWallResult {
    wallIds: string[];
    startNodeId: string;
    endNodeId: string;
}

const addWall = definePlanCommand<AddWallParams, AddWallResult>({
    type: 'addWall',
    labelKey: 'engine.plan.command.label.add_wall',
    paramsSchema: AddWallSchema,
    validate(doc, p) {
        return (
            checkRef(doc, p.from, 'from') ??
            checkRef(doc, p.to, 'to') ??
            checkSizes(p) ??
            checkCapacity(doc, 1)
        );
    },
    run(d, p, ctx, out) {
        const from = resolveEndpoint(d, p.from, ctx, out);
        const to = resolveEndpoint(d, p.to, ctx, out);
        if (from === to) fail('wall_too_short', { length: 0 });
        const { wallIds } = insertWallSegment(
            d,
            from,
            to,
            newWallProps(p, ctx),
            ctx,
            out,
        );
        assertWallCapacity(d);
        out.result = { wallIds, startNodeId: from, endNodeId: to };
    },
    touchesGeometry: true,
});

// ---- addWallChain ----------------------------------------------------------------------------------

export interface AddWallChainResult {
    wallIds: string[];
    nodeIds: string[];
}

const addWallChain = definePlanCommand<AddWallChainParams, AddWallChainResult>({
    type: 'addWallChain',
    labelKey: 'engine.plan.command.label.add_wall_chain',
    paramsSchema: AddWallChainSchema,
    validate(doc, p) {
        for (const [i, ref] of p.points.entries()) {
            const error = checkRef(doc, ref, `points.${i}`);
            if (error !== null) return error;
        }
        return (
            checkSizes(p) ??
            checkCapacity(doc, p.closed ? p.points.length : p.points.length - 1)
        );
    },
    run(d, p, ctx, out) {
        const props = newWallProps(p, ctx);
        const nodeIds: string[] = [];
        const wallIds: string[] = [];
        const draw = (from: string, to: string): void => {
            if (from === to) fail('wall_too_short', { length: 0 });
            try {
                wallIds.push(
                    ...insertWallSegment(d, from, to, props, ctx, out).wallIds,
                );
            } catch (error) {
                // A part of the outline that is already built (a room drawn
                // against another) is not an error; see the header.
                if (
                    !(error instanceof CommandAbort) ||
                    error.reason.code !== 'wall_duplicate'
                ) {
                    throw error;
                }
            }
        };
        for (const ref of p.points) {
            nodeIds.push(resolveEndpoint(d, ref, ctx, out));
            if (nodeIds.length > 1) {
                draw(
                    nodeIds[nodeIds.length - 2]!,
                    nodeIds[nodeIds.length - 1]!,
                );
            }
        }
        if (p.closed) draw(nodeIds[nodeIds.length - 1]!, nodeIds[0]!);
        if (wallIds.length === 0) fail('wall_duplicate');
        assertWallCapacity(d);
        out.result = { wallIds, nodeIds };
    },
    touchesGeometry: true,
});

// ---- splitWall -------------------------------------------------------------------------------------

export interface SplitWallResult {
    nodeId: string;
    newWallId: string;
}

/** The centre-line length of a wall in a document, or the missing node's error. */
function lengthIn(doc: Graph, wall: Wall): number | EngineMessage {
    for (const id of [wall.a, wall.b])
        if (!has(doc.nodes, id)) return notFound(id);
    return dist(pointOf(doc, wall.a), pointOf(doc, wall.b));
}

const splitWall = definePlanCommand<SplitWallParams, SplitWallResult>({
    type: 'splitWall',
    labelKey: 'engine.plan.command.label.split_wall',
    paramsSchema: SplitWallSchema,
    validate(doc, p) {
        const wall = doc.walls[p.wallId];
        if (wall === undefined) return notFound(p.wallId);
        const length = lengthIn(doc, wall);
        if (typeof length !== 'number') return length;
        // an integer distance is in range exactly when it is <= floor(max)
        return (
            checkRange(
                'at',
                mm(p.at),
                MIN_WALL_LENGTH,
                Math.floor(length - MIN_WALL_LENGTH + 1e-9),
            ) ?? checkCapacity(doc, 1)
        );
    },
    run(d, p, ctx, out) {
        const wall = d.walls[p.wallId]!;
        const a = pointOf(d, wall.a);
        const b = pointOf(d, wall.b);
        const point = add(a, scale(sub(b, a), mm(p.at) / dist(a, b)));
        const nodeId = splitWallAt(d, p.wallId, point, ctx, out, {
            inclusive: true,
        });
        const tail = Object.values(d.walls).find(
            (w) => w.a === nodeId && w.id !== p.wallId,
        );
        out.result = { nodeId, newWallId: tail!.id };
    },
    touchesGeometry: true,
});

// ---- mergeCollinearWalls ---------------------------------------------------------------------------

export interface MergeCollinearResult {
    keptWallId: string;
    removedWallId: string;
}

const MERGE_PROPS = [
    'thickness',
    'height',
    'kind',
    'material',
    'colorHex',
] as const;

/**
 * The two walls `mergeCollinearWalls` would join at `nodeId`, or the reason it
 * cannot: the node has exactly two walls, running in opposite directions
 * (within `ANGLE_TOL`) with identical properties. The kept wall is the one
 * with the smaller id.
 */
function planMerge(
    doc: Graph,
    nodeId: string,
): { keep: Wall; remove: Wall } | { error: EngineMessage } {
    if (!has(doc.nodes, nodeId)) return { error: notFound(nodeId) };
    const walls = Object.values(doc.walls)
        .filter((w) => w.a === nodeId || w.b === nodeId)
        .sort((p, q) => cmpId(p.id, q.id));
    if (walls.length !== 2) {
        return {
            error: message('not_collinear', { nodeId, degree: walls.length }),
        };
    }
    const [keep, remove] = walls as [Wall, Wall];
    const at = pointOf(doc, nodeId);
    const out: Vec2[] = [];
    for (const wall of [keep, remove]) {
        const far = wall.a === nodeId ? wall.b : wall.a;
        if (!has(doc.nodes, far)) return { error: notFound(far) };
        out.push(sub(pointOf(doc, far), at));
    }
    const [d1, d2] = out as [Vec2, Vec2];
    if (
        dist(d1, { x: 0, y: 0 }) < 1e-9 ||
        dist(d2, { x: 0, y: 0 }) < 1e-9 ||
        dot(d1, d2) >= 0 ||
        !isParallel(d1, d2)
    ) {
        return { error: message('not_collinear', { nodeId }) };
    }
    for (const field of MERGE_PROPS) {
        if (keep[field] !== remove[field]) {
            return { error: message('props_differ', { nodeId, field }) };
        }
    }
    return { keep, remove };
}

/** Which side-dependent values flip when a wall is replaced by one running the other way. */
const flipSide = (side: 'left' | 'right'): 'left' | 'right' =>
    side === 'left' ? 'right' : 'left';

/**
 * Joins the two walls at `nodeId` into the one with the smaller id (04 §6.6).
 * Its end at the node moves to the far node of the other wall; the other
 * wall's openings, placements and dimensions are handed over to it and the
 * other wall is deleted. The node is left without walls for the post-process
 * to delete.
 */
function mergeAtNode(d: Doc, nodeId: string, out: Out): MergeCollinearResult {
    const plan = planMerge(d, nodeId);
    if ('error' in plan) throw new CommandAbort(plan.error);
    const kept = d.walls[plan.keep.id]!;
    const removed = d.walls[plan.remove.id]!;
    const keptDir = sub(pointOf(d, kept.b), pointOf(d, kept.a));
    const removedDir = sub(pointOf(d, removed.b), pointOf(d, removed.a));
    const reversed = dot(keptDir, removedDir) < 0;
    const far = removed.a === nodeId ? removed.b : removed.a;
    const removedLength = dist(pointOf(d, nodeId), pointOf(d, far));

    // where the openings of the removed wall are now
    const handed = openingsOf(d, removed.id).map(
        (o) => [o, pointAlong(d, removed, o.offset)] as const,
    );

    if (kept.a === nodeId) {
        kept.a = far;
        for (const o of openingsOf(d, kept.id)) {
            o.offset = mm(o.offset + removedLength);
        }
    } else {
        kept.b = far;
    }

    const a = pointOf(d, kept.a);
    const b = pointOf(d, kept.b);
    const keptLength = dist(a, b);
    const dir = scale(sub(b, a), 1 / keptLength);
    for (const [o, centre] of handed) {
        const offset = mm(dot(sub(centre, a), dir));
        o.wallId = kept.id;
        o.offset = fitOffset(offset, o.width, keptLength) ?? offset;
        if (reversed) {
            o.hinge = o.hinge === 'start' ? 'end' : 'start';
            o.swing = flipSide(o.swing);
        }
    }
    for (const id of Object.keys(d.placements).sort(cmpId)) {
        const attachment = d.placements[id]!.wallAttachment;
        if (attachment?.wallId !== removed.id) continue;
        attachment.wallId = kept.id;
        if (reversed) attachment.side = flipSide(attachment.side);
    }
    for (const id of Object.keys(d.annotations.dimensions).sort(cmpId)) {
        const attached = d.annotations.dimensions[id]!.attachedTo;
        if (attached?.wallId !== removed.id) continue;
        attached.wallId = kept.id;
        if (reversed && attached.face !== 'center') {
            attached.face = flipSide(attached.face);
        }
    }

    const result = { keptWallId: kept.id, removedWallId: removed.id };
    // The node is left without walls; the post-process deletes it (04 §6.4 step 1).
    deleteWall(d, removed.id, out);
    return result;
}

const mergeCollinearWalls = definePlanCommand<
    MergeCollinearParams,
    MergeCollinearResult
>({
    type: 'mergeCollinearWalls',
    labelKey: 'engine.plan.command.label.merge_collinear_walls',
    paramsSchema: MergeCollinearSchema,
    validate(doc, p) {
        const plan = planMerge(doc, p.nodeId);
        return 'error' in plan ? plan.error : null;
    },
    run(d, p, _ctx, out) {
        out.result = mergeAtNode(d, p.nodeId, out);
    },
    touchesGeometry: true,
});

// ---- deleteWalls / deleteNode ----------------------------------------------------------------------

export interface DeleteResult {
    /**
     * Every id the command deleted: walls, openings, nodes, merged-away walls,
     * and the dimensions and room metas the post-process deletes afterwards.
     * It is the very array of `ExecuteResult.deletedIds` (the post-process
     * appends to it after `run` returns), so it is complete once `execute`
     * has returned; do not mutate it.
     */
    deletedIds: string[];
}

const wallCount = (d: Graph, nodeId: string): number =>
    Object.values(d.walls).filter((w) => w.a === nodeId || w.b === nodeId)
        .length;

/**
 * Deletes walls (04 §6.6) together with their openings. Dimensions attached
 * to them are deleted and placements attached to them are detached by the
 * pipeline's post-process (04 §6.4 steps 2 and 3), in the same history entry.
 * Nodes that no wall uses any more are deleted too, including `extraNodes`.
 * Every remaining end node left with exactly two walls that
 * `mergeCollinearWalls` accepts is merged, so removing the branch of a T
 * leaves one straight wall.
 */
export function removeWalls(
    d: Doc,
    wallIds: readonly string[],
    extraNodes: readonly string[],
    out: Out,
): void {
    const ends = new Set(extraNodes);
    for (const id of wallIds) {
        ends.add(d.walls[id]!.a);
        ends.add(d.walls[id]!.b);
    }
    for (const id of wallIds) deleteWall(d, id, out);

    const nodes = [...ends].filter((id) => has(d.nodes, id)).sort(cmpId);
    for (const id of nodes) {
        if (wallCount(d, id) > 0) continue;
        delete d.nodes[id];
        pushDeleted(out, id);
    }
    for (const id of nodes) {
        if (!has(d.nodes, id) || wallCount(d, id) !== 2) continue;
        if ('keep' in planMerge(d, id)) mergeAtNode(d, id, out);
    }
}

const deleteWalls = definePlanCommand<DeleteWallsParams, DeleteResult>({
    type: 'deleteWalls',
    labelKey: 'engine.plan.command.label.delete_walls',
    paramsSchema: DeleteWallsSchema,
    validate: (doc, p) => checkWallIds(doc, p.wallIds),
    run(d, p, _ctx, out) {
        removeWalls(d, uniqueSorted(p.wallIds), [], out);
        out.result = { deletedIds: out.deletedIds };
    },
    touchesGeometry: true,
});

const deleteNode = definePlanCommand<DeleteNodeParams, DeleteResult>({
    type: 'deleteNode',
    labelKey: 'engine.plan.command.label.delete_node',
    paramsSchema: DeleteNodeSchema,
    validate: (doc, p) =>
        has(doc.nodes, p.nodeId) ? null : notFound(p.nodeId),
    run(d, p, _ctx, out) {
        const incident = Object.values(d.walls)
            .filter((w) => w.a === p.nodeId || w.b === p.nodeId)
            .map((w) => w.id)
            .sort(cmpId);
        removeWalls(d, incident, [p.nodeId], out);
        out.result = { deletedIds: out.deletedIds };
    },
    touchesGeometry: true,
});

// ---- setWallProps ----------------------------------------------------------------------------------

const setWallProps = definePlanCommand<SetWallPropsParams>({
    type: 'setWallProps',
    labelKey: 'engine.plan.command.label.set_wall_props',
    paramsSchema: SetWallPropsSchema,
    validate(doc, p) {
        const missing = checkWallIds(doc, p.wallIds);
        if (missing !== null) return missing;
        const sizes = checkSizes(p.props, 'props.');
        if (sizes !== null) return sizes;
        const height = p.props.height;
        if (height === undefined) return null;
        const newHeight = mm(height);
        for (const wallId of uniqueSorted(p.wallIds)) {
            if (newHeight >= doc.walls[wallId]!.height) continue;
            for (const o of Object.values(doc.openings)) {
                if (
                    o.wallId !== wallId ||
                    o.sillHeight + o.height <= newHeight
                ) {
                    continue;
                }
                return message('opening_too_tall', {
                    wallId,
                    openingId: o.id,
                });
            }
        }
        return null;
    },
    run(d, p) {
        const { thickness, height, kind, material, colorHex } = p.props;
        for (const id of uniqueSorted(p.wallIds)) {
            const wall = d.walls[id]!;
            if (thickness !== undefined && wall.thickness !== mm(thickness)) {
                wall.thickness = mm(thickness);
            }
            if (height !== undefined && wall.height !== mm(height)) {
                wall.height = mm(height);
            }
            if (kind !== undefined && wall.kind !== kind) wall.kind = kind;
            if (material !== undefined && wall.material !== material) {
                wall.material = material;
            }
            if (colorHex !== undefined) {
                const next = colorHex === null ? null : colorHex.toLowerCase();
                if (wall.colorHex !== next) wall.colorHex = next;
            }
        }
    },
    mergeKey: (p) => `wallProps:${uniqueSorted(p.wallIds).join(',')}`,
    mergeMode: 'replace',
    touchesGeometry: true,
});

/** The wall commands, registered in `PLAN_COMMANDS` (04 §6.6). */
export const WALL_COMMANDS = {
    addWall,
    addWallChain,
    splitWall,
    mergeCollinearWalls,
    deleteWalls,
    deleteNode,
    setWallProps,
};
