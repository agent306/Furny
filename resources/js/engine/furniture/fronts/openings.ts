/**
 * Front openings and edge classification (07 §4.1).
 *
 * An opening is the interior rectangle (front elevation, x/y) that a front
 * closes: the bounding rectangle of the sections a `Front` covers, or the
 * box of a leaf holding external drawers (keyed by its section id, I4). Each
 * opening edge is classified by what it lies on (the carcass, a divider
 * another opening also closes, or a divider with nothing on its other side);
 * the class and panel thickness give the cover of the front edge.
 */
import type { Issue } from '../../plan/types';
import { coveringFront, type Envelope } from '../carcass/envelope';
import type { Divider, SectionLayout } from '../carcass/layout';
import { DOOR_GAP, FULL_OVERLAY_EDGE_GAP, INSET_GAP } from '../constants';
import { furnitureIssue } from '../context';
import type { Front, FurnitureDocument, Section } from '../schema';
import type { Box3, GenContext } from '../types';

export type EdgeName = 'left' | 'right' | 'top' | 'bottom';
export type EdgeClass = 'outer' | 'shared' | 'divider_open';
export type Overlay = Front['overlay'];

export interface OpeningEdge {
    cls: EdgeClass;
    /** Thickness of the panel the edge lies on (`t_c` for the carcass). */
    tp: number;
    /**
     * A fixed cover that replaces the overlay rule of `coverFor`: the top
     * edge of a desk cabinet stops 2 mm under the table top (cover -2,
     * 07 §3.13). Carcass openings never set it.
     */
    cover?: number;
}

/** A rectangle in the front elevation (local x/y, y up). */
export interface Rect {
    x0: number;
    x1: number;
    y0: number;
    y1: number;
}

export interface OpeningRect extends Rect {
    edges: Record<EdgeName, OpeningEdge>;
}

export const EDGE_NAMES: readonly EdgeName[] = [
    'left',
    'right',
    'top',
    'bottom',
];

/** Faces closer than this are the same plane (as for the joints, 07 §3.8). */
const FACE_TOLERANCE = 0.5;
/** Overlaps must exceed float noise. */
const OVERLAP_EPSILON = 1e-6;
/** Area comparisons of `front_not_rectangle` (mm²). */
const AREA_TOLERANCE = 0.5;

const OPPOSITE: Record<EdgeName, EdgeName> = {
    left: 'right',
    right: 'left',
    top: 'bottom',
    bottom: 'top',
};

const isVertical = (edge: EdgeName): boolean =>
    edge === 'left' || edge === 'right';

/** Coordinate of an edge of a rectangle. */
function edgeAt(rect: Rect, edge: EdgeName): number {
    switch (edge) {
        case 'left':
            return rect.x0;
        case 'right':
            return rect.x1;
        case 'bottom':
            return rect.y0;
        case 'top':
            return rect.y1;
    }
}

/** The extent of an edge along its own direction. */
const spanOf = (rect: Rect, edge: EdgeName): [number, number] =>
    isVertical(edge) ? [rect.y0, rect.y1] : [rect.x0, rect.x1];

const overlap = (a: [number, number], b: [number, number]): number =>
    Math.min(a[1], b[1]) - Math.max(a[0], b[0]);

const rectOfBox = (box: Box3): Rect => ({
    x0: box.min[0],
    x1: box.min[0] + box.size[0],
    y0: box.min[1],
    y1: box.min[1] + box.size[1],
});

const area = (r: Rect): number => (r.x1 - r.x0) * (r.y1 - r.y0);

function boundingRect(rects: readonly Rect[]): Rect | null {
    if (rects.length === 0) return null;
    return {
        x0: Math.min(...rects.map((r) => r.x0)),
        x1: Math.max(...rects.map((r) => r.x1)),
        y0: Math.min(...rects.map((r) => r.y0)),
        y1: Math.max(...rects.map((r) => r.y1)),
    };
}

const isLeaf = (s: Section): boolean =>
    s.split === 'none' || s.children.length === 0;

/** Every section by id, and the leaf ids under (and including) each section. */
function indexSections(root: Section): {
    byId: Map<string, Section>;
    leavesUnder: Map<string, string[]>;
} {
    const byId = new Map<string, Section>();
    const leavesUnder = new Map<string, string[]>();
    const visit = (s: Section): string[] => {
        byId.set(s.id, s);
        const leaves = isLeaf(s)
            ? [s.id]
            : s.children.flatMap((c) => visit(c.section));
        leavesUnder.set(s.id, leaves);
        return leaves;
    };
    visit(root);
    return { byId, leavesUnder };
}

/** Bounding rectangle of the laid-out sections in `covers` (unknown ids ignored). */
function coveredRect(covers: readonly string[], layout: SectionLayout) {
    const rects: Rect[] = [];
    for (const id of covers) {
        const info = layout.byId.get(id);
        if (info) rects.push(rectOfBox(info.box));
    }
    return boundingRect(rects);
}

/**
 * Cover `cv` of a front edge beyond the opening edge (07 §4.1 table);
 * negative means inside the opening.
 */
export function coverFor(overlay: Overlay, cls: EdgeClass, tp: number): number {
    if (overlay === 'inset') return -INSET_GAP;
    if (overlay === 'full' && cls !== 'shared') {
        return tp - FULL_OVERLAY_EDGE_GAP;
    }
    return tp / 2 - DOOR_GAP / 2;
}

/** The front rectangle `[X0, X1] x [Y0, Y1]` of an opening (07 §4.1); an edge's fixed `cover` wins. */
export function frontRect(opening: OpeningRect, overlay: Overlay): Rect {
    const cv = (edge: EdgeName) => {
        const { cls, tp, cover } = opening.edges[edge];
        return cover ?? coverFor(overlay, cls, tp);
    };
    return {
        x0: opening.x0 - cv('left'),
        x1: opening.x1 + cv('right'),
        y0: opening.y0 - cv('bottom'),
        y1: opening.y1 + cv('top'),
    };
}

interface RawOpening {
    id: string;
    rect: Rect;
    sliding: boolean;
}

/** The divider whose face is at the opening edge, by largest overlap (07 §4.1 rule 2). */
function dividerAt(
    rect: Rect,
    edge: EdgeName,
    dividers: readonly Divider[],
): { divider: Divider; dRect: Rect } | null {
    const c = edgeAt(rect, edge);
    const kind = isVertical(edge) ? 'partition' : 'fixed_shelf';
    let best: { divider: Divider; dRect: Rect; overlap: number } | null = null;
    for (const divider of dividers) {
        if (divider.kind !== kind) continue;
        const dRect = rectOfBox(divider.box);
        // The face touching the opening is the divider's opposite edge.
        if (Math.abs(edgeAt(dRect, OPPOSITE[edge]) - c) > FACE_TOLERANCE) {
            continue;
        }
        const o = overlap(spanOf(dRect, edge), spanOf(rect, edge));
        if (o > OVERLAP_EPSILON && (!best || o > best.overlap)) {
            best = { divider, dRect, overlap: o };
        }
    }
    return best;
}

function classifyEdge(
    self: RawOpening,
    edge: EdgeName,
    all: readonly RawOpening[],
    interior: Rect,
    dividers: readonly Divider[],
    tc: number,
): OpeningEdge {
    const outer: OpeningEdge = { cls: 'outer', tp: tc };
    const c = edgeAt(self.rect, edge);
    if (Math.abs(c - edgeAt(interior, edge)) <= FACE_TOLERANCE) return outer;

    const found = dividerAt(self.rect, edge, dividers);
    if (!found) return outer;
    const { dRect } = found;
    const tp = isVertical(edge) ? dRect.x1 - dRect.x0 : dRect.y1 - dRect.y0;

    // Another (non-sliding) opening on the divider's other face, overlapping
    // the stretch of the divider this edge lies on.
    const otherFace = edgeAt(dRect, edge);
    const sharedSpan = spanOf(dRect, edge);
    const ownSpan = spanOf(self.rect, edge);
    const span: [number, number] = [
        Math.max(sharedSpan[0], ownSpan[0]),
        Math.min(sharedSpan[1], ownSpan[1]),
    ];
    const shared = all.some(
        (o) =>
            o !== self &&
            !o.sliding &&
            Math.abs(edgeAt(o.rect, OPPOSITE[edge]) - otherFace) <=
                FACE_TOLERANCE &&
            overlap(spanOf(o.rect, edge), span) > OVERLAP_EPSILON,
    );
    return { cls: shared ? 'shared' : 'divider_open', tp };
}

/**
 * Openings of every front (keyed by front id, in document order; fronts whose
 * covers name no laid-out section are skipped) and of every leaf with
 * external drawers (keyed by section id, in pre-order), edges classified.
 */
export function computeOpenings(
    ctx: GenContext,
    env: Pick<Envelope, 'interior'>,
    layout: SectionLayout,
): Map<string, OpeningRect> {
    const result = new Map<string, OpeningRect>();
    const carcass = ctx.doc.carcass;
    if (!carcass) return result;
    const { byId } = indexSections(carcass.interior);

    const raw: RawOpening[] = [];
    for (const front of carcass.fronts) {
        const rect = coveredRect(front.covers, layout);
        if (rect) {
            raw.push({ id: front.id, rect, sliding: front.kind === 'sliding' });
        }
    }
    for (const id of layout.preorder) {
        const info = layout.byId.get(id);
        const content = byId.get(id)?.content;
        if (
            info?.leaf &&
            content?.type === 'drawers' &&
            !content.behindDoor &&
            coveringFront(ctx.doc, id) === undefined
        ) {
            raw.push({ id, rect: rectOfBox(info.box), sliding: false });
        }
    }

    const interior = rectOfBox(env.interior);
    const tc = ctx.t('carcass');
    for (const opening of raw) {
        const edges = Object.fromEntries(
            EDGE_NAMES.map((edge) => [
                edge,
                classifyEdge(opening, edge, raw, interior, layout.dividers, tc),
            ]),
        ) as Record<EdgeName, OpeningEdge>;
        result.set(opening.id, { ...opening.rect, edges });
    }
    return result;
}

interface OpeningsMemo {
    doc: FurnitureDocument;
    env: Pick<Envelope, 'interior'>;
    layout: SectionLayout;
    openings: Map<string, OpeningRect>;
}

const openingsMemo = new WeakMap<GenContext, OpeningsMemo>();

/**
 * `computeOpenings`, computed once per generation: the front step and every
 * external drawer leaf share the result while the context's document, the
 * envelope and the layout stay the same. Read-only for callers.
 */
export function openingsOf(
    ctx: GenContext,
    env: Pick<Envelope, 'interior'>,
    layout: SectionLayout,
): Map<string, OpeningRect> {
    const memo = openingsMemo.get(ctx);
    if (
        memo &&
        memo.doc === ctx.doc &&
        memo.env === env &&
        memo.layout === layout
    ) {
        return memo.openings;
    }
    const openings = computeOpenings(ctx, env, layout);
    openingsMemo.set(ctx, { doc: ctx.doc, env, layout, openings });
    return openings;
}

/**
 * `furniture.front_not_rectangle` and `furniture.front_overlap` (07 §4.1) of
 * a laid-out document, as issues; pure (nothing is recorded anywhere), for
 * `validateFurniture`.
 *
 * A front is a rectangle when its bounding rectangle has the area of its
 * covered leaves (each counted once, even when an ancestor is listed too)
 * plus the dividers lying entirely inside it. Two fronts overlap when their
 * covered leaf sets intersect.
 */
export function frontCoverageIssues(
    doc: FurnitureDocument,
    layout: SectionLayout,
): Issue[] {
    const carcass = doc.carcass;
    if (!carcass) return [];
    const { leavesUnder } = indexSections(carcass.interior);
    const issues: Issue[] = [];

    const leafSets = carcass.fronts.map(
        (front) =>
            new Set(front.covers.flatMap((id) => leavesUnder.get(id) ?? [])),
    );

    carcass.fronts.forEach((front, i) => {
        const rect = coveredRect(front.covers, layout);
        if (!rect) return;
        let covered = 0;
        for (const id of leafSets[i] ?? []) {
            const info = layout.byId.get(id);
            if (info) covered += area(rectOfBox(info.box));
        }
        for (const divider of layout.dividers) {
            const d = rectOfBox(divider.box);
            if (
                d.x0 >= rect.x0 - FACE_TOLERANCE &&
                d.x1 <= rect.x1 + FACE_TOLERANCE &&
                d.y0 >= rect.y0 - FACE_TOLERANCE &&
                d.y1 <= rect.y1 + FACE_TOLERANCE
            ) {
                covered += area(d);
            }
        }
        if (Math.abs(area(rect) - covered) > AREA_TOLERANCE) {
            issues.push(
                furnitureIssue(
                    'furniture.front_not_rectangle',
                    'error',
                    { frontId: front.id },
                    [front.id],
                ),
            );
        }
    });

    carcass.fronts.forEach((a, i) => {
        carcass.fronts.forEach((b, j) => {
            if (j <= i) return;
            const setA = leafSets[i];
            const setB = leafSets[j];
            if (!setA || !setB || ![...setA].some((id) => setB.has(id))) {
                return;
            }
            issues.push(
                furnitureIssue(
                    'furniture.front_overlap',
                    'error',
                    { frontIds: `${a.id},${b.id}` },
                    [a.id, b.id],
                ),
            );
        });
    });
    return issues;
}
