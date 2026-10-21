/**
 * `validatePlan` (03 §1.1, 04 §0.1): the invariants of a plan.
 * Errors block saving, warnings do not. `plan.placement_design_missing` is
 * checked server-side only and never emitted here.
 *
 * Works on unparsed documents too: structural schema ranges are checked here
 * (thickness, height, width, sill, coordinates, background scale), and every
 * reference (nodes, walls) is resolved defensively. Issue text keys follow the
 * editor's `plan_editor.issues.<rule>` (05 §10.4, preflight C6); the engine
 * never produces sentences.
 */
import Flatbush from 'flatbush';
import { intersectSegments } from '../geometry/segment';
import {
    EPS,
    MAX_COORD,
    MIN_WALL_LENGTH,
    roundMm,
} from '../geometry/tolerance';
import { dist, type Vec2 } from '../geometry/vec2';
import { derivePlanGeometry, type DerivedPlan } from './derive';
import { isAnchorInsideRoom } from './rooms';
import type { PlanDocument } from './schema';
import type { Issue } from './types';

export const PLAN_ISSUE_CODES = [
    'plan.node_missing',
    'plan.wall_degenerate',
    'plan.wall_duplicate',
    'plan.orphan_node',
    'plan.opening_wall_missing',
    'plan.opening_out_of_bounds',
    'plan.opening_overlap',
    'plan.opening_too_tall',
    'plan.walls_intersect',
    'plan.room_anchor_outside',
    'plan.too_large',
    'plan.value_out_of_range',
] as const;

export type PlanIssueCode = (typeof PLAN_ISSUE_CODES)[number];

/** Limits of 03 §1.1 `plan.too_large`. */
const MAX_WALLS = 2000;
const MAX_OPENINGS = 1000;
const MAX_PLACEMENTS = 500;
const MAX_FIXTURES = 1000;
const MAX_JSON_BYTES = 2_097_152;

const MESSAGE_KEY_PREFIX = 'plan_editor.issues.';
/** Float noise allowance for the opening bounds test (mm). */
const BOUNDS_TOL = 1e-6;
const CACHE_SIZE = 4;
/** mm; collinear walls overlapping by no more than this are not reported. */
const MIN_OVERLAP = 1;

const cmpId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const sortedIds = (record: Record<string, unknown>): string[] =>
    Object.keys(record).sort(cmpId);
/** Rounds to integer mm and normalises `-0`. */
const mm = (v: number): number => roundMm(v) + 0;
/** Like `mm`, but `0` for NaN and infinities so params stay finite numbers. */
const finiteMm = (v: number): number => (Number.isFinite(v) ? mm(v) : 0);

function issue(
    code: PlanIssueCode,
    severity: Issue['severity'],
    params: Issue['params'],
    entityIds: string[],
): Issue {
    return {
        code,
        severity,
        messageKey: MESSAGE_KEY_PREFIX + code.slice('plan.'.length),
        params,
        entityIds,
    };
}

/** UTF-8 byte length of a JS string (lone surrogates count as 3 bytes). */
function utf8ByteLength(text: string): number {
    let bytes = 0;
    for (let i = 0; i < text.length; i += 1) {
        const c = text.charCodeAt(i);
        if (c < 0x80) bytes += 1;
        else if (c < 0x800) bytes += 2;
        else if (c >= 0xd800 && c <= 0xdbff) {
            const next = text.charCodeAt(i + 1);
            if (next >= 0xdc00 && next <= 0xdfff) {
                bytes += 4;
                i += 1;
            } else bytes += 3;
        } else bytes += 3;
    }
    return bytes;
}

/** A wall whose two nodes exist, as a centre-line segment. */
interface Placed {
    id: string;
    a: string;
    b: string;
    p: Vec2;
    q: Vec2;
    length: number;
}

function placeWalls(doc: PlanDocument): Map<string, Placed> {
    const placed = new Map<string, Placed>();
    for (const id of sortedIds(doc.walls)) {
        const wall = doc.walls[id]!;
        const na = doc.nodes[wall.a];
        const nb = doc.nodes[wall.b];
        if (!na || !nb) continue;
        const p = { x: na.x, y: na.y };
        const q = { x: nb.x, y: nb.y };
        placed.set(id, { id, a: wall.a, b: wall.b, p, q, length: dist(p, q) });
    }
    return placed;
}

function nodeMissing(doc: PlanDocument): Issue[] {
    const out: Issue[] = [];
    for (const id of sortedIds(doc.walls)) {
        const wall = doc.walls[id]!;
        const ends: Array<['a' | 'b', string]> = [['a', wall.a]];
        if (wall.b !== wall.a) ends.push(['b', wall.b]);
        for (const [end, nodeId] of ends) {
            if (doc.nodes[nodeId]) continue;
            out.push(
                issue(
                    'plan.node_missing',
                    'error',
                    { wallId: id, nodeId, end },
                    [id],
                ),
            );
        }
    }
    return out;
}

function wallDegenerate(placed: Map<string, Placed>): Issue[] {
    const out: Issue[] = [];
    for (const w of placed.values()) {
        if (w.a !== w.b && w.length >= MIN_WALL_LENGTH) continue;
        out.push(
            issue(
                'plan.wall_degenerate',
                'error',
                { wallId: w.id, length: w.a === w.b ? 0 : finiteMm(w.length) },
                [w.id],
            ),
        );
    }
    return out;
}

function wallDuplicate(doc: PlanDocument): Issue[] {
    const groups = new Map<string, string[]>();
    for (const id of sortedIds(doc.walls)) {
        const { a, b } = doc.walls[id]!;
        if (a === b) continue;
        const key = a < b ? `${a}|${b}` : `${b}|${a}`;
        const group = groups.get(key);
        if (group) group.push(id);
        else groups.set(key, [id]);
    }
    const out: Issue[] = [];
    for (const [key, ids] of [...groups].sort((x, y) => cmpId(x[0], y[0]))) {
        if (ids.length < 2) continue;
        const [nodeA, nodeB] = key.split('|') as [string, string];
        out.push(
            issue(
                'plan.wall_duplicate',
                'error',
                { nodeA, nodeB, count: ids.length },
                ids,
            ),
        );
    }
    return out;
}

function orphanNodes(doc: PlanDocument): Issue[] {
    const used = referencedNodeIds(doc);
    return sortedIds(doc.nodes)
        .filter((id) => !used.has(id))
        .map((id) =>
            issue('plan.orphan_node', 'warning', { nodeId: id }, [id]),
        );
}

function referencedNodeIds(doc: PlanDocument): Set<string> {
    const used = new Set<string>();
    for (const wall of Object.values(doc.walls)) {
        used.add(wall.a);
        used.add(wall.b);
    }
    return used;
}

/** Dangling `wallId` references: openings, placement and dimension attachments. */
function wallReferences(doc: PlanDocument): Issue[] {
    const out: Issue[] = [];
    const check = (entityId: string, wallId: string, field: string): void => {
        if (doc.walls[wallId]) return;
        out.push(
            issue('plan.opening_wall_missing', 'error', { wallId, field }, [
                entityId,
            ]),
        );
    };
    for (const id of sortedIds(doc.openings)) {
        check(id, doc.openings[id]!.wallId, 'opening.wallId');
    }
    for (const id of sortedIds(doc.placements)) {
        const attachment = doc.placements[id]!.wallAttachment;
        if (attachment)
            check(id, attachment.wallId, 'placement.wallAttachment.wallId');
    }
    for (const id of sortedIds(doc.annotations.dimensions)) {
        const attached = doc.annotations.dimensions[id]!.attachedTo;
        if (attached) check(id, attached.wallId, 'dimension.attachedTo.wallId');
    }
    return out;
}

function openingsByWall(doc: PlanDocument): Map<string, string[]> {
    const byWall = new Map<string, string[]>();
    for (const id of sortedIds(doc.openings)) {
        const wallId = doc.openings[id]!.wallId;
        const list = byWall.get(wallId);
        if (list) list.push(id);
        else byWall.set(wallId, [id]);
    }
    return byWall;
}

function openingBounds(
    doc: PlanDocument,
    placed: Map<string, Placed>,
): Issue[] {
    const out: Issue[] = [];
    for (const id of sortedIds(doc.openings)) {
        const o = doc.openings[id]!;
        const wall = placed.get(o.wallId);
        if (!wall || !Number.isFinite(wall.length)) continue;
        const half = o.width / 2;
        if (
            o.offset >= half - BOUNDS_TOL &&
            o.offset <= wall.length - half + BOUNDS_TOL
        )
            continue;
        out.push(
            issue(
                'plan.opening_out_of_bounds',
                'error',
                {
                    wallId: o.wallId,
                    offset: o.offset,
                    width: o.width,
                    wallLength: mm(wall.length),
                },
                [id],
            ),
        );
    }
    return out;
}

function openingOverlap(doc: PlanDocument): Issue[] {
    const out: Issue[] = [];
    for (const [wallId, ids] of openingsByWall(doc)) {
        if (!doc.walls[wallId] || ids.length < 2) continue;
        // Doubled coordinates keep half-millimetre edges integral.
        const spans = ids
            .map((id) => {
                const o = doc.openings[id]!;
                return {
                    id,
                    start: 2 * o.offset - o.width,
                    end: 2 * o.offset + o.width,
                };
            })
            .sort((p, q) => p.start - q.start || cmpId(p.id, q.id));
        const pairs: Array<{ ids: [string, string]; overlap: number }> = [];
        for (let i = 0; i < spans.length; i += 1) {
            const s = spans[i]!;
            for (let j = i + 1; j < spans.length; j += 1) {
                const t = spans[j]!;
                if (t.start >= s.end) break;
                const overlap = (Math.min(s.end, t.end) - t.start) / 2;
                pairs.push({
                    ids: s.id < t.id ? [s.id, t.id] : [t.id, s.id],
                    overlap,
                });
            }
        }
        pairs.sort(
            (p, q) => cmpId(p.ids[0], q.ids[0]) || cmpId(p.ids[1], q.ids[1]),
        );
        for (const { ids: pair, overlap } of pairs) {
            out.push(
                issue(
                    'plan.opening_overlap',
                    'error',
                    { wallId, overlap },
                    pair,
                ),
            );
        }
    }
    return out.sort(
        (p, q) =>
            cmpId(p.entityIds[0]!, q.entityIds[0]!) ||
            cmpId(p.entityIds[1]!, q.entityIds[1]!),
    );
}

function openingTooTall(doc: PlanDocument): Issue[] {
    const out: Issue[] = [];
    for (const id of sortedIds(doc.openings)) {
        const o = doc.openings[id]!;
        const wall = doc.walls[o.wallId];
        if (!wall || o.sillHeight + o.height <= wall.height) continue;
        out.push(
            issue(
                'plan.opening_too_tall',
                'error',
                {
                    wallId: o.wallId,
                    sillHeight: o.sillHeight,
                    height: o.height,
                    wallHeight: wall.height,
                },
                [id],
            ),
        );
    }
    return out;
}

/**
 * Walls that cross without sharing a node (04 §6.4: a `point` intersection
 * strictly inside both walls; params `{ x, y }`) and walls that overlap along
 * a common line for more than `MIN_OVERLAP` mm (params `{ overlapMm }`), also
 * when they share a node and run the same way from it. Not reported: walls
 * meeting at a shared node (there a `point` hit lies on an end of both walls,
 * so it is never interior), T-junctions (an endpoint on the other wall's
 * interior), collinear walls running opposite ways from a shared node, and
 * the same unordered node pair (that is `wall_duplicate`).
 */
function wallsIntersect(placed: Map<string, Placed>): Issue[] {
    const walls = [...placed.values()].filter(
        (w) =>
            w.a !== w.b &&
            Number.isFinite(w.length) &&
            w.length >= MIN_WALL_LENGTH,
    );
    if (walls.length < 2) return [];
    const index = new Flatbush(walls.length);
    for (const w of walls) {
        index.add(
            Math.min(w.p.x, w.q.x) - EPS,
            Math.min(w.p.y, w.q.y) - EPS,
            Math.max(w.p.x, w.q.x) + EPS,
            Math.max(w.p.y, w.q.y) + EPS,
        );
    }
    index.finish();

    const interior = (param: number, length: number): boolean =>
        param * length > EPS && (1 - param) * length > EPS;
    const out: Issue[] = [];
    walls.forEach((w, i) => {
        const near = index.search(
            Math.min(w.p.x, w.q.x) - EPS,
            Math.min(w.p.y, w.q.y) - EPS,
            Math.max(w.p.x, w.q.x) + EPS,
            Math.max(w.p.y, w.q.y) + EPS,
        );
        for (const j of near) {
            if (j <= i) continue;
            const other = walls[j]!;
            // Same unordered node pair: reported as `wall_duplicate`.
            if (
                (w.a === other.a && w.b === other.b) ||
                (w.a === other.b && w.b === other.a)
            )
                continue;
            const hit = intersectSegments(
                { a: w.p, b: w.q },
                { a: other.p, b: other.q },
            );
            const ids: string[] = [w.id, other.id].sort(cmpId);
            if (hit.kind === 'overlap') {
                const overlap = (hit.t1 - hit.t0) * w.length;
                if (overlap > MIN_OVERLAP) {
                    out.push(
                        issue(
                            'plan.walls_intersect',
                            'warning',
                            { overlapMm: mm(overlap) },
                            ids,
                        ),
                    );
                }
                continue;
            }
            if (
                hit.kind !== 'point' ||
                !interior(hit.t, w.length) ||
                !interior(hit.u, other.length)
            )
                continue;
            out.push(
                issue(
                    'plan.walls_intersect',
                    'warning',
                    { x: mm(hit.point.x), y: mm(hit.point.y) },
                    ids,
                ),
            );
        }
    });
    return out.sort(
        (p, q) =>
            cmpId(p.entityIds[0]!, q.entityIds[0]!) ||
            cmpId(p.entityIds[1]!, q.entityIds[1]!),
    );
}

function roomAnchors(doc: PlanDocument, geom: DerivedPlan): Issue[] {
    const out: Issue[] = [];
    for (const id of sortedIds(doc.rooms)) {
        const { anchor } = doc.rooms[id]!;
        if (geom.rooms.some((room) => isAnchorInsideRoom(anchor, room)))
            continue;
        out.push(
            issue(
                'plan.room_anchor_outside',
                'warning',
                { x: anchor.x, y: anchor.y },
                [id],
            ),
        );
    }
    return out;
}

function tooLarge(doc: PlanDocument): Issue[] {
    const out: Issue[] = [];
    const check = (kind: string, count: number, max: number): void => {
        if (count > max)
            out.push(
                issue('plan.too_large', 'error', { kind, count, max }, []),
            );
    };
    check('walls', Object.keys(doc.walls).length, MAX_WALLS);
    check('openings', Object.keys(doc.openings).length, MAX_OPENINGS);
    check('placements', Object.keys(doc.placements).length, MAX_PLACEMENTS);
    check('fixtures', Object.keys(doc.fixtures).length, MAX_FIXTURES);
    const json = JSON.stringify(doc);
    // A UTF-16 unit is at most three UTF-8 bytes: skip the exact count when it cannot matter.
    if (json.length * 3 > MAX_JSON_BYTES) {
        check('json', utf8ByteLength(json), MAX_JSON_BYTES);
    }
    return out;
}

/** Range issues, and whether every coordinate in the document is finite and within +-MAX_COORD. */
function valuesInRange(doc: PlanDocument): {
    issues: Issue[];
    coordinatesOk: boolean;
} {
    const out: Issue[] = [];
    let coordinatesOk = true;
    const check = (
        entityId: string | null,
        field: string,
        value: unknown,
        min: number,
        max: number,
    ): void => {
        if (
            typeof value === 'number' &&
            Number.isFinite(value) &&
            value >= min &&
            value <= max
        )
            return;
        out.push(
            issue(
                'plan.value_out_of_range',
                'error',
                { field, min, max },
                entityId ? [entityId] : [],
            ),
        );
    };
    const coords = (
        id: string | null,
        field: string,
        point: { x: number; y: number },
    ): void => {
        const before = out.length;
        check(id, `${field}.x`, point.x, -MAX_COORD, MAX_COORD);
        check(id, `${field}.y`, point.y, -MAX_COORD, MAX_COORD);
        if (out.length > before) coordinatesOk = false;
    };

    for (const id of sortedIds(doc.nodes)) coords(id, 'node', doc.nodes[id]!);
    for (const id of sortedIds(doc.walls)) {
        const w = doc.walls[id]!;
        check(id, 'wall.thickness', w.thickness, 50, 1000);
        check(id, 'wall.height', w.height, 300, 10_000);
    }
    for (const id of sortedIds(doc.openings)) {
        const o = doc.openings[id]!;
        check(id, 'opening.width', o.width, 300, 6000);
        check(id, 'opening.sillHeight', o.sillHeight, 0, 3000);
    }
    for (const id of sortedIds(doc.rooms))
        coords(id, 'room.anchor', doc.rooms[id]!.anchor);
    for (const id of sortedIds(doc.placements))
        coords(id, 'placement', doc.placements[id]!);
    for (const id of sortedIds(doc.fixtures))
        coords(id, 'fixture', doc.fixtures[id]!);
    for (const id of sortedIds(doc.annotations.labels)) {
        coords(id, 'label.position', doc.annotations.labels[id]!.position);
    }
    for (const id of sortedIds(doc.annotations.dimensions)) {
        const d = doc.annotations.dimensions[id]!;
        coords(id, 'dimension.a', d.a);
        coords(id, 'dimension.b', d.b);
    }
    if (doc.background) {
        coords(null, 'background.position', doc.background.position);
        const scale = doc.background.mmPerPixel;
        if (!(Number.isFinite(scale) && scale > 0)) {
            out.push(
                issue(
                    'plan.value_out_of_range',
                    'error',
                    { field: 'background.mmPerPixel', min: 0 },
                    [],
                ),
            );
        }
    }
    return { issues: out, coordinatesOk };
}

function runValidation(doc: PlanDocument, geom?: DerivedPlan): Issue[] {
    const placed = placeWalls(doc);
    const ranges = valuesInRange(doc);
    // Derivation is only attempted for coordinates it can be trusted with:
    // untrusted documents (CLI input) must not be able to stall validation.
    const derived =
        Object.keys(doc.rooms).length === 0
            ? null
            : (geom ?? (ranges.coordinatesOk ? derivePlanGeometry(doc) : null));
    return [
        ...nodeMissing(doc),
        ...wallDegenerate(placed),
        ...wallDuplicate(doc),
        ...orphanNodes(doc),
        ...wallReferences(doc),
        ...openingBounds(doc, placed),
        ...openingOverlap(doc),
        ...openingTooTall(doc),
        ...wallsIntersect(placed),
        ...(derived ? roomAnchors(doc, derived) : []),
        ...tooLarge(doc),
        ...ranges.issues,
    ];
}

/** Least recently used last. Holds the results for the last four documents. */
const cache: Array<{ doc: PlanDocument; issues: Issue[] }> = [];

/**
 * Validates a plan document (03 §1.1). Memoised by document identity (last 4
 * documents); `geom` is only used to avoid re-deriving when the caller has
 * the derived plan of this same input. Issues are ordered by rule, then id.
 * The returned array is frozen. Room anchors are judged against derived rooms,
 * so that check is skipped when a coordinate is non-finite or beyond +-MAX_COORD
 * (the range issues are still reported).
 */
export function validatePlan(doc: PlanDocument, geom?: DerivedPlan): Issue[] {
    const at = cache.findIndex((entry) => entry.doc === doc);
    if (at >= 0) {
        const [entry] = cache.splice(at, 1);
        cache.push(entry!);
        return entry!.issues;
    }
    const issues = Object.freeze(runValidation(doc, geom)) as Issue[];
    cache.push({ doc, issues });
    if (cache.length > CACHE_SIZE) cache.shift();
    return issues;
}

/**
 * Identity of every error: `code|sortedEntityIds` (04 §6.4 step 4). A command
 * that adds a key to this set introduced an error.
 */
export function planErrorKeys(issues: Issue[]): Set<string> {
    const keys = new Set<string>();
    for (const i of issues) {
        if (i.severity !== 'error') continue;
        keys.add(`${i.code}|${[...i.entityIds].sort(cmpId).join(',')}`);
    }
    return keys;
}

/** Removes the nodes no wall references (the auto-fix of `plan.orphan_node`). Returns `doc` itself when there are none. */
export function removeOrphanNodes(doc: PlanDocument): PlanDocument {
    const used = referencedNodeIds(doc);
    const kept = Object.entries(doc.nodes).filter(([id]) => used.has(id));
    if (kept.length === Object.keys(doc.nodes).length) return doc;
    return { ...doc, nodes: Object.fromEntries(kept) };
}
