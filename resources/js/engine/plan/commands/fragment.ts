/**
 * `insertFragment` (04 §6.6): pastes a `PlanFragment`, the subset of a plan
 * the editor copies (05 §7.14), with new ids and offset by `(dx, dy)`.
 *
 * Rulings carried by this file (ledgered for the spec 19 reconciliation):
 * - Each pasted node is resolved the way `addWall` resolves an endpoint
 *   (`resolveEndpoint`): onto an existing node within `NODE_MERGE_TOL`, else a
 *   T node splitting a wall, else a new node. So a pasted wall joins what it
 *   touches and `idMap` maps such a node to the existing node's id. A
 *   fragment node no pasted wall uses is not pasted.
 * - As with `addWall`, only the parts of a wall that no existing wall covers
 *   are pasted. A fragment wall that would add no wall at all (covered end
 *   to end, or both ends resolving to one node) is found by a dry run on a
 *   copy first and skipped untouched: nothing is split or created for it,
 *   and it has no `idMap` entry. A pasted wall cut into several walls maps
 *   to its first piece.
 * - A pasted opening goes on the pasted wall piece that holds its centre.
 *   It is dropped with the `fragment_opening_dropped` warning when there is
 *   none, when it does not fit there (more than `NODE_MERGE_TOL` of clamp
 *   needed) or when it would overlap an opening already on that piece. A
 *   dropped opening has no `idMap` entry.
 * - Pieces always run the way their fragment wall does (`insertWallSegment`
 *   lays them `from -> to` and a split keeps a wall's direction; a piece is
 *   never folded into another pasted wall, which would have to overlap it),
 *   so hinges, swings, placement sides and dimension faces are kept as they
 *   are.
 * - Placement and dimension attachments to a fragment wall move to the
 *   pasted piece nearest them; attachments to any other wall are cleared.
 */
import { z } from 'zod';
import { create, current, type Draft } from 'mutative';
import { CommandAbort, type CommandOutput } from '../../commands/types';
import { cmpId } from '../../compare';
import {
    closestPointOnSeg,
    intersectSegments,
    projectParam,
    type Seg,
} from '../../geometry/segment';
import { MIN_WALL_LENGTH, NODE_MERGE_TOL } from '../../geometry/tolerance';
import { add, dist, dot, scale, sub, type Vec2 } from '../../geometry/vec2';
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
    overlaps,
    resolveEndpoint,
    type EndpointRef,
    type WallProps,
} from './helpers';
import type { PlanCommandContext } from './pipeline';
import {
    MAX_SPAN,
    assertWallCapacity,
    checkPoint,
    checkRange,
    has,
    message,
    mm,
    notFound,
} from './validators';

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

// ---- validation -------------------------------------------------------------------------------

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

// ---- the walls ----------------------------------------------------------------------------------

const pointOf = (doc: Pick<PlanDocument, 'nodes'>, id: string): Vec2 => {
    const node = doc.nodes[id]!;
    return { x: node.x, y: node.y };
};

const hasEnds = (doc: Pick<PlanDocument, 'nodes'>, wall: Wall): boolean =>
    has(doc.nodes, wall.a) && has(doc.nodes, wall.b);

/** A wall's properties, copied. */
const wallProps = (wall: Wall): WallProps => ({
    thickness: wall.thickness,
    height: wall.height,
    kind: wall.kind,
    justification: wall.justification,
    material: wall.material,
    colorHex: wall.colorHex,
});

/** Ids for a dry run, which only ever writes to a throwaway copy. */
function scratchIds(): PlanCommandContext['newId'] {
    let n = 0;
    return (prefix) => `${prefix}_~dryrun${(n += 1)}`;
}

/**
 * Whether pasting the wall `from -> to` would add a wall, tried on a copy of
 * the draft: `false` when it is covered or both ends resolve to one node
 * (`wall_duplicate`). Any other refusal is left for the real run to report.
 */
export function addsWall(
    d: Doc,
    from: EndpointRef,
    to: EndpointRef,
    props: WallProps,
): boolean {
    const ctx = { newId: scratchIds() };
    const sink: Out = { result: undefined, warnings: [], deletedIds: [] };
    try {
        create(current(d), (copy) => {
            const a = resolveEndpoint(copy as Doc, from, ctx, sink);
            const b = resolveEndpoint(copy as Doc, to, ctx, sink);
            if (a === b) throw new CommandAbort(message('wall_duplicate'));
            insertWallSegment(copy as Doc, a, b, props, ctx, sink);
        });
    } catch (error) {
        if (error instanceof CommandAbort) {
            return error.reason.code !== 'wall_duplicate';
        }
        throw error;
    }
    return true;
}

/**
 * The most a resolved endpoint can lie from the point it came from
 * (`resolveEndpoint`): an existing node or a T node is within
 * `NODE_MERGE_TOL`; a wall's end node is chosen when the point is within
 * `NODE_MERGE_TOL` of the wall and projects within `MIN_WALL_LENGTH` of that
 * end, so up to `hypot(MIN_WALL_LENGTH, NODE_MERGE_TOL)`; a new node is
 * rounded (under 1 mm). The 1 mm covers rounding and float noise.
 */
const SNAP = Math.hypot(MIN_WALL_LENGTH, NODE_MERGE_TOL) + 1;
/** Largest sine of the angle `intersectSegments` still calls parallel (`ANGLE_TOL` is 0.5 degrees), rounded up. */
const PARALLEL_SLOPE = 0.01;

/** Distance between two segments: 0 when they touch or cross. */
function segmentGap(p: Seg, q: Seg): number {
    if (intersectSegments(p, q, 0).kind !== 'none') return 0;
    return Math.min(
        closestPointOnSeg(p.a, q).dist,
        closestPointOnSeg(p.b, q).dist,
        closestPointOnSeg(q.a, p).dist,
        closestPointOnSeg(q.b, p).dist,
    );
}

/**
 * Whether pasting `seg` might add no wall (`wall_duplicate`), so `addsWall`
 * must try it. `false` is a proof that it adds a wall. The dry run resolves
 * both ends to nodes `ra`, `rb`, each within `SNAP` of its point, then calls
 * `insertWallSegment(ra, rb)`, which finds no wall to make only when
 * - `ra === rb`: then the points are within `2 * SNAP` of each other; or
 * - every part of `ra -> rb` is covered or already joined. That needs an
 *   existing wall W (or a piece of one) either
 *   (a) joining two nodes that lie on `ra -> rb` (within `NODE_MERGE_TOL` of
 *       it): a part of W is then within `NODE_MERGE_TOL` of `ra -> rb`; or
 *   (b) overlapping `ra -> rb` collinearly (`intersectSegments`): W is
 *       parallel within `ANGLE_TOL` and starts within `NODE_MERGE_TOL` of the
 *       line, so over the stretch that overlaps it W is at most
 *       `NODE_MERGE_TOL + PARALLEL_SLOPE * |W|` from `ra -> rb`.
 *   `ra -> rb` and `seg` differ by at most `SNAP` at every point, so in both
 *   cases W is within `NODE_MERGE_TOL + SNAP + PARALLEL_SLOPE * |W|` of `seg`.
 * A paste clear of those bounds skips the dry run, which copies the plan.
 */
export function mayAddNoWall(d: Doc, seg: Seg): boolean {
    if (dist(seg.a, seg.b) <= 2 * SNAP) return true;
    return Object.values(d.walls).some((wall) => {
        if (!hasEnds(d, wall)) return false;
        const other = { a: pointOf(d, wall.a), b: pointOf(d, wall.b) };
        const reach =
            NODE_MERGE_TOL + SNAP + PARALLEL_SLOPE * dist(other.a, other.b);
        return segmentGap(seg, other) <= reach;
    });
}

/** A pasted fragment wall: where it lands and what existing walls covered of it. */
interface Line {
    seg: Seg;
    /** Parameter spans of `seg` that walls already covered before it was pasted. */
    covered: Array<[number, number]>;
}

/** The parameter spans of `seg` that walls of the draft cover (collinear overlaps). */
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
    return spans;
}

/** A wall the paste made, lying along a pasted fragment wall. */
interface Piece {
    id: string;
    seg: Seg;
    length: number;
}

/**
 * The walls made by this paste that lie along a pasted fragment wall, in id
 * order: not in `before`, both ends within `NODE_MERGE_TOL` of it, and not on
 * a part existing walls covered (where a wall split by the paste may lie).
 */
function piecesAlong(d: Doc, line: Line, before: ReadonlySet<string>): Piece[] {
    const { seg } = line;
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
        pieces.push({ id, seg: piece, length });
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
    const refOf = (id: string): EndpointRef =>
        has(idMap, id)
            ? { nodeId: idMap[id]! }
            : { point: shift(f.nodes[id]!) };
    const lines = new Map<string, Line>();
    for (const wall of sortedValues(f.walls)) {
        const props = wallProps(wall);
        const seg = { a: shift(f.nodes[wall.a]!), b: shift(f.nodes[wall.b]!) };
        if (
            mayAddNoWall(d, seg) &&
            !addsWall(d, refOf(wall.a), refOf(wall.b), props)
        ) {
            continue;
        }
        lines.set(wall.id, { seg, covered: coveredSpans(d, seg) });
        for (const end of [wall.a, wall.b]) {
            idMap[end] ??= resolveEndpoint(d, refOf(end), ctx, out);
        }
        const { wallIds } = insertWallSegment(
            d,
            idMap[wall.a]!,
            idMap[wall.b]!,
            props,
            ctx,
            out,
        );
        idMap[wall.id] = wallIds[0]!;
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
        d.openings[id] = {
            ...o,
            id,
            wallId: placed.piece.id,
            offset: placed.offset,
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
                    : { wallId: piece.id, side: attachment.side },
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
                    : { ...attached, wallId: piece.id },
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

/** `insertFragment`, registered in `PLAN_COMMANDS` (04 §6.6). */
export const FRAGMENT_COMMANDS = { insertFragment };
