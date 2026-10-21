/**
 * Leaf bodies (07 §4.2-§4.6): a solid leaf, or for `glass: true` a frame of
 * two stiles and two rails holding a glass panel (07 §4.5). The frame keys
 * extend the leaf key (`front.{F}.leaf.{k}.stile.left`, ...); the solid leaf
 * key is then not generated. Shared by the hinged, flap, sliding and drawer
 * front generators.
 */
import {
    GLASS_CLEARANCE,
    GLASS_FRAME_WIDTH,
    GLASS_REBATE_DEPTH,
} from '../constants';
import { makePart } from '../parts';
import type { PartKey } from '../schema';
import type { Axis, Box3, GenContext, Part, PhysEdge } from '../types';
import type { EdgeName } from './openings';

/** How far the glass panel reaches under the frame on each side (60 - (8 - 1) = 53). */
const GLASS_INSET = GLASS_FRAME_WIDTH - (GLASS_REBATE_DEPTH - GLASS_CLEARANCE);

const ALL_EDGES: PhysEdge[] = ['left', 'right', 'top', 'bottom'];

/** The placement of one leaf: front elevation rectangle and z range (fractional). */
export interface LeafBox {
    x0: number;
    x1: number;
    y0: number;
    y1: number;
    z0: number;
    z1: number;
}

/** How a solid leaf is described: name and grain direction. */
export interface LeafSpec {
    nameKey: string;
    nameParams?: Record<string, string | number>;
    grainAxis: Axis;
}

/** The parts of one leaf, already pushed to `ctx.parts`. */
export interface LeafBody {
    parts: Part[];
    /** The model front's `partKey`: the leaf, or its left stile. */
    partKey: PartKey;
    /** The part along an edge of the leaf: hinge cups and handle holes go there. */
    edgePart(edge: EdgeName): Part;
}

const boxOf = (b: LeafBox): Box3 => ({
    min: [b.x0, b.y0, b.z0],
    size: [b.x1 - b.x0, b.y1 - b.y0, b.z1 - b.z0],
});

/** A solid leaf `key`: role front, thin z, banded all four, 2 visible faces. */
export function solidLeaf(
    ctx: GenContext,
    key: PartKey,
    box: LeafBox,
    spec: LeafSpec,
): LeafBody {
    const part = makePart(
        {
            key,
            nameKey: spec.nameKey,
            nameParams: spec.nameParams,
            role: 'front',
            materialCode: ctx.doc.materials.front.materialCode,
            box: boxOf(box),
            thicknessAxis: 'z',
            grainAxis: spec.grainAxis,
            banded: ALL_EDGES,
            visibleFaces: 2,
        },
        ctx,
    );
    ctx.parts.push(part);
    return { parts: [part], partKey: key, edgePart: () => part };
}

/**
 * A glass frame leaf under the prefix `key` (07 §4.5): stiles `60 x lh`
 * (grain y), rails `(lw - 120) x 60` (grain x), both like a solid leaf, and
 * the glass `(lw - 106) x (lh - 106)` in the catalog glass, unbanded and
 * centred in the leaf depth. Use after `glassFeasible`.
 */
export function glassLeaf(
    ctx: GenContext,
    key: PartKey,
    box: LeafBox,
): LeafBody {
    const glass = ctx.idx.glassMaterial();
    const fw = GLASS_FRAME_WIDTH;
    const frame = (
        suffix: string,
        nameKey: string,
        b: LeafBox,
        grainAxis: Axis,
    ): Part =>
        makePart(
            {
                key: `${key}.${suffix}`,
                nameKey,
                role: 'front',
                materialCode: ctx.doc.materials.front.materialCode,
                box: boxOf(b),
                thicknessAxis: 'z',
                grainAxis,
                banded: ALL_EDGES,
                visibleFaces: 2,
            },
            ctx,
        );
    const stileLeft = frame(
        'stile.left',
        'parts.glass_stile',
        { ...box, x1: box.x0 + fw },
        'y',
    );
    const stileRight = frame(
        'stile.right',
        'parts.glass_stile',
        { ...box, x0: box.x1 - fw },
        'y',
    );
    const rails = { ...box, x0: box.x0 + fw, x1: box.x1 - fw };
    const railTop = frame(
        'rail.top',
        'parts.glass_rail',
        { ...rails, y0: box.y1 - fw },
        'x',
    );
    const railBottom = frame(
        'rail.bottom',
        'parts.glass_rail',
        { ...rails, y1: box.y0 + fw },
        'x',
    );

    const parts = [stileLeft, stileRight, railTop, railBottom];
    if (glass) {
        const tg = Math.round(glass.thicknessMm);
        const zc = (box.z0 + box.z1) / 2;
        parts.push(
            makePart(
                {
                    key: `${key}.glass`,
                    nameKey: 'parts.glass_panel',
                    role: 'front',
                    materialCode: glass.code,
                    box: boxOf({
                        x0: box.x0 + GLASS_INSET,
                        x1: box.x1 - GLASS_INSET,
                        y0: box.y0 + GLASS_INSET,
                        y1: box.y1 - GLASS_INSET,
                        z0: zc - tg / 2,
                        z1: zc + tg / 2,
                    }),
                    thicknessAxis: 'z',
                    grainAxis: null,
                    banded: [],
                    visibleFaces: 0,
                },
                ctx,
            ),
        );
    }
    ctx.parts.push(...parts);

    const byEdge: Record<EdgeName, Part> = {
        left: stileLeft,
        right: stileRight,
        top: railTop,
        bottom: railBottom,
    };
    return {
        parts,
        partKey: stileLeft.key,
        edgePart: (edge) => byEdge[edge],
    };
}

/** The leaf `key`: a glass frame when `glass`, else solid. */
export function leafBody(
    ctx: GenContext,
    key: PartKey,
    box: LeafBox,
    spec: LeafSpec,
    glass: boolean,
): LeafBody {
    return glass ? glassLeaf(ctx, key, box) : solidLeaf(ctx, key, box, spec);
}
