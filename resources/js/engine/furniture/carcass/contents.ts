/**
 * Leaf contents that are not drawers (07 §3.9-§3.11): loose shelves, the
 * hanging rod and pull-out baskets. Run after the dividers, because shelf
 * pins drill into the neighbouring verticals and fixed shelves join them.
 */
import type { HardwareRoleKey } from '../../catalog/specs';
import {
    HANGING_MIN_DEPTH,
    HANGING_MIN_HEIGHT,
    ROD_MAX_SPAN,
    SHELF_PIN_MARGIN,
    SHELF_SIDE_CLEARANCE,
    SYSTEM32_PITCH,
    fl,
} from '../constants';
import { makePart } from '../parts';
import type { Content } from '../schema';
import type { GenContext, Part } from '../types';
import { coveringFront, type Envelope } from './envelope';
import { recordEndJoints, type SectionBoxInfo } from './layout';

type ContentOf<T extends Content['type']> = Extract<Content, { type: T }>;

/** Height one pull-out basket needs. */
const BASKET_HEIGHT = 150;
/** Interior depth a basket needs when its specs do not say. */
const BASKET_MIN_DEPTH = 450;
/** Contact between a shelf face and a vertical within this distance (like the joints). */
const FACE_TOLERANCE = 0.5;

/** Depth lost behind an inset front covering the section (07 §3.9). */
function insetReduction(ctx: GenContext, sectionId: string): number {
    return coveringFront(ctx.doc, sectionId)?.overlay === 'inset'
        ? ctx.t('front')
        : 0;
}

/**
 * Content depth `cd` of a leaf: the interior depth, less the front thickness
 * when an inset front covers the leaf (directly or via an ancestor).
 */
export function contentDepth(
    ctx: GenContext,
    env: Pick<Envelope, 'interior'>,
    sectionId: string,
): number {
    return env.interior.size[2] - insetReduction(ctx, sectionId);
}

/** `contentDepth` of a leaf: every leaf spans the interior's depth. */
const leafDepth = (ctx: GenContext, leaf: SectionBoxInfo): number =>
    contentDepth(ctx, { interior: leaf.box }, leaf.id);

/**
 * Adds a hardware line for `roleKey`'s catalog default, or `code` when given.
 * Without any code the line is omitted and `furniture.no_default_hardware`
 * names the hardware key (07 §1.5).
 */
function addLine(
    ctx: GenContext,
    leaf: SectionBoxInfo,
    roleKey: HardwareRoleKey,
    code: string | null,
    line: {
        name: string;
        qty: number;
        reasonKey: string;
        reasonParams?: Record<string, string | number>;
    },
): void {
    const key = `section.${leaf.id}.${line.name}`;
    const resolved = code ?? ctx.idx.defaultHardware(roleKey)?.code;
    if (resolved === undefined) {
        ctx.issue('furniture.no_default_hardware', 'warning', { roleKey }, [
            key,
        ]);
        return;
    }
    ctx.addHardware({
        key,
        code: resolved,
        qty: line.qty,
        reasonKey: line.reasonKey,
        reasonParams: line.reasonParams ?? {},
        frontId: null,
        sectionId: leaf.id,
        source: 'generated',
        overridden: false,
    });
}

/**
 * The vertical panels (sides, partitions) whose faces bound the leaf on the
 * left and on the right: the part touching `x0` / `x1` and overlapping the
 * leaf in y and z.
 */
export function boundingVerticals(
    ctx: GenContext,
    leaf: SectionBoxInfo,
): { left: Part | undefined; right: Part | undefined } {
    const [x0, y0, z0] = leaf.box.min;
    const [w, h, d] = leaf.box.size;
    const touching = (
        part: Part,
        atX: number,
        side: 'max' | 'min',
    ): boolean => {
        if (!/^carcass\.side\.|\.partition\.\d+$/.test(part.key)) return false;
        const g = part.geometry;
        if (g.kind !== 'box') return false;
        const face =
            side === 'max' ? g.box.min[0] + g.box.size[0] : g.box.min[0];
        const overlaps = (
            lo: number,
            size: number,
            from: number,
            len: number,
        ) => Math.min(lo + size, from + len) - Math.max(lo, from) > 0;
        return (
            Math.abs(face - atX) <= FACE_TOLERANCE &&
            overlaps(g.box.min[1], g.box.size[1], y0, h) &&
            overlaps(g.box.min[2], g.box.size[2], z0, d)
        );
    };
    return {
        left: ctx.parts.find((p) => touching(p, x0, 'max')),
        right: ctx.parts.find((p) => touching(p, x0 + w, 'min')),
    };
}

/**
 * Loose shelves (07 §3.9): `count` shelves evenly spaced in the leaf, from
 * the top. Adjustable ones rest on pins (4 per shelf, System 32 holes in the
 * bounding verticals); fixed ones are joined to the verticals instead.
 */
export function shelvesFor(
    ctx: GenContext,
    leaf: SectionBoxInfo,
    content: ContentOf<'shelves'>,
): void {
    const [x0, , z0] = leaf.box.min;
    const [w, h] = leaf.box.size;
    const y1 = leaf.box.min[1] + h;
    const ts = ctx.t('shelf');
    const n = content.count;
    const depth = leafDepth(ctx, leaf) - content.frontSetback;
    const gap = (h - n * ts) / (n + 1);
    const clearance = content.adjustable ? SHELF_SIDE_CLEARANCE : 0;

    // No shelf of zero or negative size: a leaf squeezed to nothing (flex
    // children without room) cannot hold one either.
    if (gap < 0 || depth <= 0 || w - 2 * clearance <= 0) {
        ctx.issue(
            'furniture.shelves_dont_fit',
            'error',
            { sectionId: leaf.id },
            [leaf.id],
        );
        return;
    }

    for (let i = 1; i <= n; i++) {
        const top = y1 - i * gap - (i - 1) * ts;
        const shelf = makePart(
            {
                key: `section.${leaf.id}.shelf.${i}`,
                nameKey: 'parts.shelf',
                nameParams: { n: i },
                role: 'shelf',
                materialCode: ctx.doc.materials.shelf.materialCode,
                box: {
                    min: [x0 + clearance, top - ts, z0],
                    size: [w - 2 * clearance, ts, depth],
                },
                thicknessAxis: 'y',
                grainAxis: 'x',
                banded: ['front'],
                visibleFaces: 0,
            },
            ctx,
        );
        ctx.parts.push(shelf);
        if (!content.adjustable) recordEndJoints(ctx, shelf, 'x');
    }

    if (!content.adjustable) return;
    addLine(ctx, leaf, 'shelf_support.default', null, {
        name: 'shelf_supports',
        qty: 4 * n,
        reasonKey: 'hardware.reason.shelf_supports',
        reasonParams: { shelves: n },
    });
    // Two rows of holes (front and back) in each bounding vertical.
    const rows =
        h >= 2 * SHELF_PIN_MARGIN
            ? fl((h - 2 * SHELF_PIN_MARGIN) / SYSTEM32_PITCH) + 1
            : 0;
    const { left, right } = boundingVerticals(ctx, leaf);
    for (const vertical of [left, right]) {
        if (vertical) vertical.operations.shelfPinHoles += 2 * rows;
    }
}

/**
 * Hanging rod (07 §3.10): rod pieces of at most the rod's `maxLengthMm`, two
 * supports per piece; warns when the space is too shallow, short or wide.
 */
export function rodFor(
    ctx: GenContext,
    leaf: SectionBoxInfo,
    content: ContentOf<'hanging_rod'>,
): void {
    const [w, h] = leaf.box.size;
    const cd = leafDepth(ctx, leaf);
    const code =
        content.rodCode ?? ctx.idx.defaultHardware('rod.default')?.code;
    const maxLength = ctx.idx.hardware(code ?? '')?.specs.maxLengthMm;
    const pieces = Math.ceil(
        w /
            (typeof maxLength === 'number' && maxLength > 0
                ? maxLength
                : ROD_MAX_SPAN),
    );

    addLine(ctx, leaf, 'rod.default', content.rodCode, {
        name: 'rod',
        qty: pieces,
        reasonKey: 'hardware.reason.hanging_rod',
    });
    addLine(ctx, leaf, 'rod_support.default', null, {
        name: 'rod_supports',
        qty: 2 * pieces,
        reasonKey: 'hardware.reason.rod_supports',
    });

    const warn = (code: string, params: Record<string, number> = {}) =>
        ctx.issue(code, 'warning', { sectionId: leaf.id, ...params }, [
            leaf.id,
        ]);
    if (cd < HANGING_MIN_DEPTH)
        warn('furniture.rod_section_shallow', { depth: cd });
    if (h < HANGING_MIN_HEIGHT) warn('furniture.rod_section_short');
    if (w > ROD_MAX_SPAN) warn('furniture.rod_span_long');
}

/**
 * Pull-out baskets (07 §3.11): hardware only. Warns when the leaf is outside
 * the basket's width range or shallower than it needs, and when `count`
 * baskets are taller than the leaf.
 */
export function basketsFor(
    ctx: GenContext,
    leaf: SectionBoxInfo,
    content: ContentOf<'pull_out_basket'>,
): void {
    if (content.count < 1) return;
    const [w, h] = leaf.box.size;
    const cd = leafDepth(ctx, leaf);
    addLine(ctx, leaf, 'basket.default', content.basketCode, {
        name: 'baskets',
        qty: content.count,
        reasonKey: 'hardware.reason.baskets',
    });

    const code =
        content.basketCode ?? ctx.idx.defaultHardware('basket.default')?.code;
    const specs = ctx.idx.hardware(code ?? '')?.specs ?? {};
    const num = (v: unknown): number | undefined =>
        typeof v === 'number' ? v : undefined;
    const minWidth = num(specs.minInnerWidthMm);
    const maxWidth = num(specs.maxInnerWidthMm);
    const minDepth = num(specs.minDepthMm) ?? BASKET_MIN_DEPTH;
    if (
        (minWidth !== undefined && w < minWidth) ||
        (maxWidth !== undefined && w > maxWidth) ||
        cd < minDepth
    ) {
        ctx.issue(
            'furniture.basket_size_mismatch',
            'warning',
            { sectionId: leaf.id },
            [leaf.id],
        );
    }
    if (content.count * BASKET_HEIGHT > h) {
        ctx.issue(
            'furniture.baskets_dont_fit',
            'warning',
            { sectionId: leaf.id },
            [leaf.id],
        );
    }
}
