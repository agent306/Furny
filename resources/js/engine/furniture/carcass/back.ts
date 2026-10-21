/**
 * Back panel (07 §3.4) and its automatic split into sheet-sized pieces
 * (07 §3.4.1): seams prefer the centre of a partition or fixed shelf behind
 * which the joint is supported; otherwise they are spread evenly and reported.
 */
import {
    BACK_GROOVE_DEPTH,
    BACK_GROOVE_CLEARANCE,
    BACK_GROOVE_OFFSET,
} from '../constants';
import { makePart } from '../parts';
import { fitsSheet } from '../sheetFit';
import type { GenContext, Part, PartGrain } from '../types';
import type { Envelope } from './envelope';
import type { Divider, SectionLayout } from './layout';

/** A seam is only supported by a divider at least this far from the previous seam. */
const MIN_PIECE = 100;
/** Dividers "cover" a span within this distance. */
const COVER_TOLERANCE = 0.5;

interface Seam {
    at: number;
    supported: boolean;
}

/** A vertical strip of the back, cut into pieces bottom to top at `seams`. */
interface Strip {
    x0: number;
    x1: number;
    seams: Seam[];
}

/**
 * Seams over `[from, to]` so that no piece exceeds `maxSpan` (greedy, 07
 * §3.4.1 step 3): the largest support in `[s + 100, s + maxSpan]` when there
 * is one, else an even split of the rest. Nothing for a span that cannot fit.
 */
function greedySeams(
    from: number,
    to: number,
    maxSpan: number,
    supports: readonly number[],
): Seam[] {
    const out: Seam[] = [];
    if (maxSpan <= 0) return out;
    let s = from;
    while (to - s > maxSpan) {
        const support = supports.filter(
            (c) => c >= s + MIN_PIECE && c <= s + maxSpan,
        );
        const best = support.length > 0 ? Math.max(...support) : undefined;
        const at =
            best ?? s + Math.ceil((to - s) / Math.ceil((to - s) / maxSpan));
        out.push({ at, supported: best !== undefined });
        s = at;
    }
    return out;
}

const centre = (d: Divider, axis: 0 | 1): number =>
    (d.box.min[axis] ?? 0) + (d.box.size[axis] ?? 0) / 2;

/** Pushes `carcass.back` or, when it exceeds a sheet, `carcass.back.{n}` pieces. */
export function backPanels(
    ctx: GenContext,
    env: Envelope,
    layout: SectionLayout,
): void {
    const carcass = ctx.doc.carcass;
    if (!carcass || carcass.back.type === 'none') return;

    const tb = ctx.t('back');
    const [ix0 = 0, iy0 = 0] = env.interior.min;
    const ix1 = ix0 + (env.interior.size[0] ?? 0);
    const iy1 = iy0 + (env.interior.size[1] ?? 0);
    const g = BACK_GROOVE_DEPTH - BACK_GROOVE_CLEARANCE;

    let bx0: number;
    let bx1: number;
    let by0: number;
    let by1: number;
    let z0 = 0;
    switch (carcass.back.type) {
        case 'nailed':
            [bx0, bx1] = [env.x0, env.x0 + env.Wc];
            [by0, by1] = [env.y0, env.y0 + env.Hc];
            break;
        case 'grooved':
            [bx0, bx1] = [ix0 - g, ix1 + g];
            [by0, by1] = [iy0 - g, iy1 + g];
            z0 = BACK_GROOVE_OFFSET;
            break;
        case 'inset':
            [bx0, bx1] = [ix0, ix1];
            [by0, by1] = [iy0, iy1];
            break;
    }

    const material = ctx.mat('back');
    const trim = ctx.idx.snapshot.pricing.sheetTrimMm;
    const usableLength = material.sheetLengthMm - 2 * trim;
    const usableWidth = material.sheetWidthMm - 2 * trim;
    // A grained back is locked: its vertical grain must run along the sheet.
    const locked = material.hasGrain;

    const bw = bx1 - bx0;
    const bh = by1 - by0;
    // makePart's rule: the longer side is the length; a square one follows the grain (y).
    const grainOf = (w: number, h: number): PartGrain =>
        w > h ? 'width' : 'length';

    // Vertical seams cut strips; horizontal seams cut each strip into pieces.
    const verticalSeams: Seam[] = [];
    const strips: Strip[] = [];
    if (fitsSheet(bw, bh, material, grainOf(bw, bh), trim)) {
        strips.push({ x0: bx0, x1: bx1, seams: [] });
    } else {
        const maxStrip =
            !locked && bh <= usableWidth ? usableLength : usableWidth;
        const fullHeight = layout.dividers.filter(
            (d) =>
                d.kind === 'partition' &&
                (d.box.min[1] ?? 0) <= iy0 + COVER_TOLERANCE &&
                (d.box.min[1] ?? 0) + (d.box.size[1] ?? 0) >=
                    iy1 - COVER_TOLERANCE,
        );
        verticalSeams.push(
            ...greedySeams(
                bx0,
                bx1,
                maxStrip,
                fullHeight.map((d) => centre(d, 0)),
            ),
        );
        const edges = [bx0, ...verticalSeams.map((c) => c.at), bx1];
        // A fixed shelf supports a strip when it spans the strip's own column,
        // so the cover test uses the column's inner faces rather than the
        // strip edges: a side's inner face (the back runs into its groove) or,
        // at a supported seam, the face of the partition the seam sits on.
        const partitionAt = (seam: Seam | undefined): Divider | undefined =>
            seam?.supported
                ? fullHeight.find((d) => centre(d, 0) === seam.at)
                : undefined;
        for (let k = 0; k + 1 < edges.length; k++) {
            const x0 = edges[k] ?? bx0;
            const x1 = edges[k + 1] ?? bx1;
            const left = partitionAt(verticalSeams[k - 1]);
            const right = partitionAt(verticalSeams[k]);
            const from =
                (left
                    ? (left.box.min[0] ?? 0) + (left.box.size[0] ?? 0)
                    : Math.max(x0, ix0)) + COVER_TOLERANCE;
            const to =
                (right ? (right.box.min[0] ?? 0) : Math.min(x1, ix1)) -
                COVER_TOLERANCE;
            const supports = layout.dividers
                .filter(
                    (d) =>
                        d.kind === 'fixed_shelf' &&
                        (d.box.min[0] ?? 0) <= from &&
                        (d.box.min[0] ?? 0) + (d.box.size[0] ?? 0) >= to,
                )
                .map((d) => centre(d, 1));
            strips.push({
                x0,
                x1,
                seams:
                    bh > usableLength
                        ? greedySeams(by0, by1, usableLength, supports)
                        : [],
            });
        }
    }

    const count = strips.reduce(
        (total, strip) => total + strip.seams.length + 1,
        0,
    );
    const split = count > 1;
    const made: Part[] = [];
    const firstOfStrip: string[] = [];
    const seamIssues: Array<{ seam: Seam; axis: 'x' | 'y'; keys: string[] }> =
        [];
    strips.forEach((strip) => {
        const ys = [by0, ...strip.seams.map((s) => s.at), by1];
        for (let j = 0; j + 1 < ys.length; j++) {
            const n = made.length + 1;
            const part = makePart(
                {
                    key: split ? `carcass.back.${n}` : 'carcass.back',
                    nameKey: 'parts.back',
                    nameParams: split ? { n } : {},
                    role: 'back',
                    materialCode: ctx.doc.materials.back.materialCode,
                    box: {
                        min: [strip.x0, ys[j] ?? by0, z0],
                        size: [
                            strip.x1 - strip.x0,
                            (ys[j + 1] ?? by1) - (ys[j] ?? by0),
                            tb,
                        ],
                    },
                    thicknessAxis: 'z',
                    grainAxis: 'y',
                    banded: [],
                    visibleFaces: 0,
                },
                ctx,
            );
            made.push(part);
            if (j === 0) firstOfStrip.push(part.key);
            const seam = strip.seams[j - 1];
            if (seam) {
                seamIssues.push({
                    seam,
                    axis: 'y',
                    keys: [made[made.length - 2]?.key ?? '', part.key],
                });
            }
        }
    });
    ctx.parts.push(...made);

    if (split) ctx.issue('furniture.back_split', 'info', { count });
    const vertical = verticalSeams.map((seam, k) => ({
        seam,
        axis: 'x' as const,
        keys: [firstOfStrip[k] ?? '', firstOfStrip[k + 1] ?? ''],
    }));
    for (const { seam, axis, keys } of [...vertical, ...seamIssues]) {
        if (seam.supported) continue;
        ctx.issue(
            'furniture.back_seam_unsupported',
            'warning',
            { axis, position: seam.at },
            keys,
        );
    }

    for (const piece of made) {
        if (
            !fitsSheet(piece.length, piece.width, material, piece.grain, trim)
        ) {
            ctx.issue(
                'furniture.part_exceeds_sheet_back',
                'warning',
                {
                    partKey: piece.key,
                    length: piece.length,
                    width: piece.width,
                },
                [piece.key],
            );
        }
    }
}
