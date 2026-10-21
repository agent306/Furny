/**
 * Selection-wide commands (04 §6.6): `translateEntities`, `nudgeEntities`,
 * `insertFragment` and `deleteEntities`. They take a mixed selection of ids
 * and recognise each id by its prefix (`n_`, `w_`, `o_`, `r_`, `f_`, `x_`,
 * `d_`, `t_`) or as `'background'`.
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
 * - `insertFragment` resolves each pasted node the way `addWall` resolves an
 *   endpoint (`resolveEndpoint`): onto an existing node within
 *   `NODE_MERGE_TOL`, else a T node splitting a wall, else a new node. So a
 *   pasted wall joins what it touches and `idMap` maps such a node to the
 *   existing node's id. A fragment node no pasted wall uses is not pasted.
 *   As with `addWall`, only the parts of a wall no existing wall covers are
 *   pasted; a fragment wall that existing walls cover end to end (or whose
 *   ends resolve to one node) is not pasted at all, the walls under it are
 *   not split, and it has no `idMap` entry. A pasted wall cut into several
 *   walls maps to its first piece.
 * - A pasted opening goes on the pasted wall piece that holds its centre;
 *   it is dropped with the `fragment_opening_dropped` warning when there is
 *   none, when it does not fit there (more than `NODE_MERGE_TOL` of clamp
 *   needed) or when it would overlap an opening already on that piece. A
 *   dropped opening has no `idMap` entry.
 * - Placement and dimension attachments to a fragment wall move to the
 *   pasted piece nearest them (sides swapped if the piece runs the other
 *   way); attachments to any other wall are cleared.
 * - `deleteEntities` deletes the walls of selected nodes as `deleteNode`
 *   does, together with the selected walls, in one `deleteWalls` pass.
 */
import { z } from 'zod';
import type { Draft } from 'mutative';
import { CommandAbort, type CommandOutput } from '../../commands/types';
import { cmpId } from '../../compare';
import { cyrb53 } from '../../geometry/hash';
import {
    closestPointOnSeg,
    intersectSegments,
    projectParam,
    type Seg,
} from '../../geometry/segment';
import { MIN_WALL_LENGTH, NODE_MERGE_TOL } from '../../geometry/tolerance';
import { add, dist, dot, scale, sub, type Vec2 } from '../../geometry/vec2';
import type { DerivedPlan } from '../derive';
import {
    MAX_FIXTURES,
    MAX_OPENINGS,
    MAX_PLACEMENTS,
    MAX_WALLS,
} from '../limits';
import { PlanDocumentSchema } from '../schema';
import type { Opening, PlanDocument, Wall } from '../schema';
import type { EngineMessage } from '../types';
import { definePlanCommand } from './define';
import {
    fitOffset,
    insertWallSegment,
    mergeNodeInto,
    overlaps,
    pushDeleted,
    reclampOpenings,
    resolveEndpoint,
    splitIntersections,
    wallLength,
    type WallProps,
} from './helpers';
import type { PlanCommandContext } from './pipeline';
import {
    MAX_SPAN,
    type Planned,
    assertWallCapacity,
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

// ---- PlanFragment ---------------------------------------------------------------------------

/**
 * What the editor copies (04 §6.6 `insertFragment`, 05 §7.14): a subset of a
 * plan with the original ids.
 */
export type PlanFragment = Pick<
    PlanDocument,
    'nodes' | 'walls' | 'openings' | 'placements' | 'fixtures'
> & {
    dimensions: PlanDocument['annotations']['dimensions'];
    labels: PlanDocument['annotations']['labels'];
    rooms: PlanDocument['rooms'];
};

const docShape = PlanDocumentSchema.shape;

/** The document's own record schemas: entity shape and key = id. */
const PlanFragmentSchema = z.object({
    nodes: docShape.nodes,
    walls: docShape.walls,
    openings: docShape.openings,
    placements: docShape.placements,
    fixtures: docShape.fixtures,
    dimensions: docShape.annotations.shape.dimensions,
    labels: docShape.annotations.shape.labels,
    rooms: docShape.rooms,
});

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

interface InsertFragmentParams {
    fragment: PlanFragment;
    dx: number;
    dy: number;
}
const InsertFragmentSchema: z.ZodType<InsertFragmentParams> = z.object({
    fragment: PlanFragmentSchema,
    dx: z.number(),
    dy: z.number(),
});

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

// ---- insertFragment: validation ------------------------------------------------------------------

/** `too_large` when `adding` more `kind` entities would not fit in `record`. */
function checkRoomFor(
    record: object,
    adding: number,
    kind: string,
    max: number,
): EngineMessage | null {
    const count = Object.keys(record).length;
    return adding > 0 && count + adding > max
        ? message('too_large', { kind, count, max })
        : null;
}

function checkFragment(
    doc: PlanDocument,
    p: InsertFragmentParams,
): EngineMessage | null {
    const f = p.fragment;
    const dx = mm(p.dx);
    const dy = mm(p.dy);
    const range =
        checkRange('dx', dx, -MAX_SPAN, MAX_SPAN) ??
        checkRange('dy', dy, -MAX_SPAN, MAX_SPAN);
    if (range !== null) return range;
    for (const wall of Object.values(f.walls)) {
        for (const end of [wall.a, wall.b]) {
            if (!has(f.nodes, end)) return notFound(end);
        }
    }
    const points: Point[] = [
        ...Object.values(f.nodes),
        ...Object.values(f.placements),
        ...Object.values(f.fixtures),
        ...Object.values(f.labels).map((t) => t.position),
        ...Object.values(f.dimensions).flatMap((dim) => [dim.a, dim.b]),
        ...Object.values(f.rooms).map((m) => m.anchor),
    ];
    for (const point of points) {
        const refusal = checkPoint('position', {
            x: point.x + dx,
            y: point.y + dy,
        });
        if (refusal !== null) return refusal;
    }
    const count = (record: object): number => Object.keys(record).length;
    return (
        checkRoomFor(doc.walls, count(f.walls), 'walls', MAX_WALLS) ??
        checkRoomFor(
            doc.openings,
            count(f.openings),
            'openings',
            MAX_OPENINGS,
        ) ??
        checkRoomFor(
            doc.placements,
            count(f.placements),
            'placements',
            MAX_PLACEMENTS,
        ) ??
        checkRoomFor(doc.fixtures, count(f.fixtures), 'fixtures', MAX_FIXTURES)
    );
}

// ---- insertFragment: the walls -------------------------------------------------------------------

/** A wall's properties, copied. */
const wallProps = (wall: Wall): WallProps => ({
    thickness: wall.thickness,
    height: wall.height,
    kind: wall.kind,
    justification: wall.justification,
    material: wall.material,
    colorHex: wall.colorHex,
});

/** A pasted fragment wall: where it lands and what existing walls covered of it. */
interface Line {
    seg: Seg;
    /** Parameter spans of `seg` that walls already covered before it was pasted. */
    covered: Array<[number, number]>;
}

/** The parameter spans of `seg` that walls of the draft cover (collinear overlaps), in order. */
function coveredSpans(d: Doc, seg: Seg): Array<[number, number]> {
    const spans: Array<[number, number]> = [];
    for (const wall of Object.values(d.walls)) {
        if (!hasEnds(d, wall)) continue;
        const hit = intersectSegments(
            seg,
            { a: pointOf(d, wall.a), b: pointOf(d, wall.b) },
            NODE_MERGE_TOL,
        );
        if (hit.kind === 'overlap') spans.push([hit.t0, hit.t1]);
    }
    return spans.sort((p, q) => p[0] - q[0]);
}

/** Whether `spans` cover a segment of `length` end to end, leaving no gap of `MIN_WALL_LENGTH`. */
function coversAll(spans: Array<[number, number]>, length: number): boolean {
    if (length < MIN_WALL_LENGTH) return false;
    let reach = 0;
    for (const [t0, t1] of spans) {
        if ((t0 - reach) * length >= MIN_WALL_LENGTH) return false;
        reach = Math.max(reach, t1);
    }
    return (1 - reach) * length < MIN_WALL_LENGTH;
}

/** A wall the paste made, lying along a pasted fragment wall. */
interface Piece {
    id: string;
    seg: Seg;
    length: number;
    /** Runs against the fragment wall's `a -> b`. */
    reversed: boolean;
}

/**
 * The walls made by this paste that lie along a pasted fragment wall, in id
 * order: not in `before`, both ends within `NODE_MERGE_TOL` of it, and not on
 * a part existing walls covered (where a wall split by the paste may lie).
 */
function piecesAlong(d: Doc, line: Line, before: ReadonlySet<string>): Piece[] {
    const { seg } = line;
    const dir = sub(seg.b, seg.a);
    const pieces: Piece[] = [];
    for (const id of Object.keys(d.walls).sort(cmpId)) {
        if (before.has(id)) continue;
        const wall = d.walls[id]!;
        if (!hasEnds(d, wall)) continue;
        const piece = { a: pointOf(d, wall.a), b: pointOf(d, wall.b) };
        if (
            closestPointOnSeg(piece.a, seg).dist > NODE_MERGE_TOL ||
            closestPointOnSeg(piece.b, seg).dist > NODE_MERGE_TOL
        ) {
            continue;
        }
        const mid = projectParam(scale(add(piece.a, piece.b), 0.5), seg);
        if (line.covered.some(([t0, t1]) => mid >= t0 && mid <= t1)) continue;
        const length = dist(piece.a, piece.b);
        if (length < 1e-9) continue;
        pieces.push({
            id,
            seg: piece,
            length,
            reversed: dot(sub(piece.b, piece.a), dir) < 0,
        });
    }
    return pieces;
}

/** Distance along a piece from its `a` end to the projection of `point`. */
const along = (piece: Piece, point: Vec2): number =>
    dot(
        sub(point, piece.seg.a),
        scale(sub(piece.seg.b, piece.seg.a), 1 / piece.length),
    );

/**
 * Where a pasted opening goes: the piece holding its centre, at the offset of
 * the centre, when it fits there (at most `NODE_MERGE_TOL` of clamp) and
 * overlaps no opening already on that piece; else `null`.
 */
function placeOpening(
    d: Doc,
    o: Opening,
    seg: Seg,
    pieces: readonly Piece[],
): { piece: Piece; offset: number } | null {
    const length = dist(seg.a, seg.b);
    if (length < 1e-9) return null;
    const centre = add(seg.a, scale(sub(seg.b, seg.a), o.offset / length));
    for (const piece of pieces) {
        const u = along(piece, centre);
        if (u < 0 || u > piece.length) continue;
        const offset = fitOffset(u, o.width, piece.length);
        if (offset === null || Math.abs(offset - u) > NODE_MERGE_TOL) {
            continue;
        }
        const clear = Object.values(d.openings).every(
            (other) =>
                other.wallId !== piece.id ||
                !overlaps(offset, o.width, other.offset, other.width),
        );
        return clear ? { piece, offset } : null;
    }
    return null;
}

/** The piece nearest `point` (ties by id), or `null` when there is none. */
function nearestPiece(pieces: readonly Piece[], point: Vec2): Piece | null {
    let best: { piece: Piece; distance: number } | null = null;
    for (const piece of pieces) {
        const distance = closestPointOnSeg(point, piece.seg).dist;
        if (best === null || distance < best.distance) {
            best = { piece, distance };
        }
    }
    return best?.piece ?? null;
}

const flipSide = (side: 'left' | 'right'): 'left' | 'right' =>
    side === 'left' ? 'right' : 'left';

// ---- insertFragment -------------------------------------------------------------------------------

export interface InsertFragmentResult {
    /** Fragment id -> id in the document (see the header for the gaps). */
    idMap: Record<string, string>;
}

const sortedValues = <T extends { id: string }>(
    record: Record<string, T>,
): T[] => Object.values(record).sort((p, q) => cmpId(p.id, q.id));

function pasteFragment(
    d: Doc,
    p: InsertFragmentParams,
    ctx: PlanCommandContext,
    out: Out,
): Record<string, string> {
    const f = p.fragment;
    const dx = mm(p.dx);
    const dy = mm(p.dy);
    const shift = (q: Point): Point => ({ x: mm(q.x + dx), y: mm(q.y + dy) });
    const idMap: Record<string, string> = {};
    const before = new Set(Object.keys(d.walls));

    // walls, resolving their nodes on first use
    const nodeOf = (id: string): string =>
        (idMap[id] ??= resolveEndpoint(
            d,
            { point: shift(f.nodes[id]!) },
            ctx,
            out,
        ));
    const lines = new Map<string, Line>();
    for (const wall of sortedValues(f.walls)) {
        const seg = { a: shift(f.nodes[wall.a]!), b: shift(f.nodes[wall.b]!) };
        const covered = coveredSpans(d, seg);
        if (coversAll(covered, dist(seg.a, seg.b))) continue;
        const from = nodeOf(wall.a);
        const to = nodeOf(wall.b);
        if (from === to) continue;
        lines.set(wall.id, { seg, covered });
        try {
            const { wallIds } = insertWallSegment(
                d,
                from,
                to,
                wallProps(wall),
                ctx,
                out,
            );
            idMap[wall.id] = wallIds[0]!;
        } catch (error) {
            // already built where it lands: nothing to paste
            if (
                !(error instanceof CommandAbort) ||
                error.reason.code !== 'wall_duplicate'
            ) {
                throw error;
            }
        }
    }
    assertWallCapacity(d);
    const pieceCache = new Map<string, Piece[]>();
    const piecesOf = (wallId: string): Piece[] => {
        const line = lines.get(wallId);
        if (line === undefined) return [];
        let pieces = pieceCache.get(wallId);
        if (pieces === undefined) {
            pieces = piecesAlong(d, line, before);
            pieceCache.set(wallId, pieces);
        }
        return pieces;
    };

    for (const o of sortedValues(f.openings)) {
        const line = lines.get(o.wallId);
        const placed =
            line === undefined
                ? null
                : placeOpening(d, o, line.seg, piecesOf(o.wallId));
        if (placed === null) {
            out.warnings.push(
                message('fragment_opening_dropped', { openingId: o.id }),
            );
            continue;
        }
        const id = ctx.newId('o');
        const { reversed } = placed.piece;
        d.openings[id] = {
            ...o,
            id,
            wallId: placed.piece.id,
            offset: placed.offset,
            hinge: reversed ? (o.hinge === 'start' ? 'end' : 'start') : o.hinge,
            swing: reversed ? flipSide(o.swing) : o.swing,
        };
        idMap[o.id] = id;
    }

    for (const meta of sortedValues(f.rooms)) {
        const id = ctx.newId('r');
        d.rooms[id] = {
            ...meta,
            id,
            anchor: shift(meta.anchor),
            labelOffset:
                meta.labelOffset === null ? null : { ...meta.labelOffset },
        };
        idMap[meta.id] = id;
    }
    for (const placement of sortedValues(f.placements)) {
        const id = ctx.newId('f');
        const at = shift(placement);
        const attachment = placement.wallAttachment;
        const piece =
            attachment === null
                ? null
                : nearestPiece(piecesOf(attachment.wallId), at);
        d.placements[id] = {
            ...placement,
            id,
            x: at.x,
            y: at.y,
            wallAttachment:
                attachment === null || piece === null
                    ? null
                    : {
                          wallId: piece.id,
                          side: piece.reversed
                              ? flipSide(attachment.side)
                              : attachment.side,
                      },
        };
        idMap[placement.id] = id;
    }
    for (const fixture of sortedValues(f.fixtures)) {
        const id = ctx.newId('x');
        const at = shift(fixture);
        d.fixtures[id] = { ...fixture, id, x: at.x, y: at.y };
        idMap[fixture.id] = id;
    }
    for (const dim of sortedValues(f.dimensions)) {
        const id = ctx.newId('d');
        const a = shift(dim.a);
        const b = shift(dim.b);
        const attached = dim.attachedTo;
        const piece =
            attached === null
                ? null
                : nearestPiece(
                      piecesOf(attached.wallId),
                      scale(add(a, b), 0.5),
                  );
        d.annotations.dimensions[id] = {
            ...dim,
            id,
            a,
            b,
            attachedTo:
                attached === null || piece === null
                    ? null
                    : {
                          kind: 'wall',
                          wallId: piece.id,
                          face:
                              piece.reversed && attached.face !== 'center'
                                  ? flipSide(attached.face)
                                  : attached.face,
                      },
        };
        idMap[dim.id] = id;
    }
    for (const label of sortedValues(f.labels)) {
        const id = ctx.newId('t');
        d.annotations.labels[id] = {
            ...label,
            id,
            position: shift(label.position),
        };
        idMap[label.id] = id;
    }
    return idMap;
}

const insertFragment = definePlanCommand<
    InsertFragmentParams,
    InsertFragmentResult
>({
    type: 'insertFragment',
    labelKey: 'engine.plan.command.label.insert_fragment',
    paramsSchema: InsertFragmentSchema,
    validate: (doc, p) => checkFragment(doc, p),
    run(d, p, ctx, out) {
        out.result = { idMap: pasteFragment(d, p, ctx, out) };
    },
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
    insertFragment,
    deleteEntities,
};
