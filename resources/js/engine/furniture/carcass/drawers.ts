/**
 * Drawers (07 §3.12, §4.4, §6.5): slot division, front rectangles, slide
 * selection and the drawer box parts with their slides and handles.
 *
 * A leaf with `drawers` content is either external (no door over it: the
 * drawers get their own fronts, §4.4) or behind a door (the drawers get an
 * inner front in `drawer_box` material and no handle).
 */
import type { CatalogHardware } from '../../catalog/snapshot';
import type { Issue } from '../../plan/types';
import {
    BEHIND_DOOR_DEPTH_CLEARANCE,
    BEHIND_DOOR_SIDE_PACKER,
    DRAWER_BOTTOM_GROOVE_DEPTH,
    DRAWER_BOTTOM_OFFSET_SIDE_MOUNT,
    DRAWER_BOX_HEIGHT_STEP,
    DRAWER_BOX_VERTICAL_CLEARANCE,
    DRAWER_FRONT_GAP,
    DRAWER_MIN_BOX_HEIGHT,
    DRAWER_REAR_CLEARANCE,
    DRAWER_UNUSED_DEPTH_WARN,
    fl,
} from '../constants';
import { furnitureIssue } from '../context';
import { leafZ } from '../fronts/hinged';
import { solidLeaf } from '../fronts/leaf';
import {
    computeOpenings,
    frontRect,
    type OpeningRect,
    type Rect,
} from '../fronts/openings';
import { makePart } from '../parts';
import {
    addHardwareLine,
    handleCount,
    handleOrientation,
    handlesFor,
} from '../rules/hardware';
import type { Content } from '../schema';
import type { GenContext, PhysEdge } from '../types';
import { boundingVerticals, contentDepth } from './contents';
import { coveringFront, drawerStyleOf, type Envelope } from './envelope';
import type { SectionBoxInfo, SectionLayout } from './layout';

type DrawersContent = Extract<Content, { type: 'drawers' }>;

/** A drawer front below this height is an error `drawer_heights_invalid` (07 §4.4). */
const MIN_DRAWER_FRONT_HEIGHT = 80;
/** Without a slide the box length is the available length in steps of this. */
const SLIDE_LENGTH_STEP = 50;
/** Side-mount slide spec defaults (07 §3.12 box table). */
const DEFAULT_CLEARANCE_PER_SIDE = 12.7;
/** Undermount slide spec defaults (07 §3.12 box table). */
const DEFAULT_INNER_WIDTH_DEDUCTION = 42;
const DEFAULT_LENGTH_DEDUCTION = 10;
const DEFAULT_BOTTOM_RECESS = 13;
const DEFAULT_MAX_SIDE_THICKNESS = 16;
/** Hardware role of the default slide used to find the slide family (07 §3.12 step 1). */
const DEFAULT_SLIDE_ROLE = 'slide.side_mount';
/** Covers that need packers beside the drawers (07 §3.12 `Wo`). */
const PACKED_COVERS = new Set(['hinged', 'flap_up', 'flap_down']);
const ALL_EDGES: PhysEdge[] = ['left', 'right', 'top', 'bottom'];

const num = (v: unknown): number | undefined =>
    typeof v === 'number' ? v : undefined;
const sum = (values: readonly number[]): number =>
    values.reduce((total, v) => total + v, 0);

/** What `selectSlide` needs to know about the room for the slide. */
export interface SlideRequest {
    /** `Content.slideCode`: an explicit slide, or null for the family default. */
    slideCode: string | null;
    /** Longest slide that fits: `A - DRAWER_REAR_CLEARANCE - (behind ? t_db : 0)`. */
    maxLen: number;
    /** Slide family to search instead of the family of the requested slide. */
    family?: string;
    /** Named by the issues (`sectionId` param and entity). */
    sectionId?: string;
    /** Reported by `drawer_no_slide` as `availableDepth`. */
    availableDepth?: number;
}

export interface SlideSelection {
    /** The chosen slide; null when none fits or the catalog has no default. */
    slide: CatalogHardware | null;
    /** Slide length `Ls`; 0 when no box can be made. Without a slide: `maxLen` in 50 mm steps. */
    boxLength: number;
    /** Not recorded anywhere: the caller pushes them. */
    issues: Issue[];
}

const lengthOf = (slide: CatalogHardware): number =>
    num(slide.specs.lengthMm) ?? Infinity;

/**
 * Slide selection (07 §3.12 steps 1-5, §12.4). An explicit code that fits
 * `maxLen` is kept; otherwise the longest active slide of the same family
 * that fits is taken (ties: lowest code), announcing `slide_resized` when an
 * explicit code was replaced. An unknown code, or one that is not a drawer
 * slide, is treated like no code (`validateFurniture` reports it).
 */
export function selectSlide(
    ctx: GenContext,
    request: SlideRequest,
): SlideSelection {
    const { maxLen, sectionId } = request;
    const issues: Issue[] = [];
    const entityIds = sectionId === undefined ? [] : [sectionId];
    const sectionParams: Record<string, string> =
        sectionId === undefined ? {} : { sectionId };
    const noSlide = (): SlideSelection => {
        issues.push(
            furnitureIssue(
                'furniture.drawer_no_slide',
                'error',
                {
                    ...sectionParams,
                    ...(request.availableDepth === undefined
                        ? {}
                        : { availableDepth: request.availableDepth }),
                },
                entityIds,
            ),
        );
        return { slide: null, boxLength: 0, issues };
    };

    const explicit =
        request.slideCode === null
            ? undefined
            : ctx.idx.hardware(request.slideCode);
    const named = explicit?.category === 'drawer_slide' ? explicit : undefined;
    const requested =
        named ??
        (request.family === undefined
            ? ctx.idx.defaultHardware(DEFAULT_SLIDE_ROLE)
            : undefined);

    if (!requested && request.family === undefined) {
        issues.push(
            furnitureIssue(
                'furniture.no_default_hardware',
                'warning',
                { roleKey: DEFAULT_SLIDE_ROLE },
                entityIds,
            ),
        );
        const boxLength = fl(maxLen / SLIDE_LENGTH_STEP) * SLIDE_LENGTH_STEP;
        return boxLength > 0 ? { slide: null, boxLength, issues } : noSlide();
    }

    let chosen: CatalogHardware | undefined;
    if (named && lengthOf(named) <= maxLen) {
        chosen = named;
    } else {
        const rawFamily = request.family ?? requested?.specs.family;
        const family = typeof rawFamily === 'string' ? rawFamily : undefined;
        const fitting =
            family === undefined
                ? []
                : ctx.idx
                      .hardwareFamily('drawer_slide', family)
                      .filter((slide) => lengthOf(slide) <= maxLen);
        // Sorted by length then code: the first of the longest has the lowest code.
        chosen = fitting.reduce<CatalogHardware | undefined>(
            (best, slide) =>
                best === undefined || lengthOf(slide) > lengthOf(best)
                    ? slide
                    : best,
            undefined,
        );
    }
    if (!chosen) return noSlide();

    if (named && chosen.code !== named.code) {
        issues.push(
            furnitureIssue(
                'furniture.slide_resized',
                'info',
                { from: named.code, to: chosen.code },
                entityIds,
            ),
        );
    }
    const unused = maxLen - lengthOf(chosen);
    if (unused > DRAWER_UNUSED_DEPTH_WARN) {
        issues.push(
            furnitureIssue(
                'furniture.drawer_depth_unused',
                'warning',
                { ...sectionParams, unused },
                entityIds,
            ),
        );
    }
    return { slide: chosen, boxLength: lengthOf(chosen), issues };
}

/**
 * The given `frontHeights` list when it has one entry per drawer; a list of
 * another length is `drawer_heights_invalid` (warning) and counts as
 * `'equal'`, like `'equal'` itself: null.
 */
function givenHeights(
    ctx: GenContext,
    content: DrawersContent,
    sectionId: string | undefined,
): number[] | null {
    const heights = content.frontHeights;
    if (heights === 'equal') return null;
    if (heights.length === content.count) return heights;
    ctx.issue(
        'furniture.drawer_heights_invalid',
        'warning',
        sectionId === undefined ? {} : { sectionId },
        sectionId === undefined ? [] : [sectionId],
    );
    return null;
}

/**
 * Heights of `n` stacked drawers sharing `total` with `gap` between them:
 * equal, or the given ones for all but the last, which takes the rest.
 */
function divide(
    total: number,
    n: number,
    gap: number,
    given: readonly number[] | null,
): number[] {
    const share = total - (n - 1) * gap;
    if (!given) return Array.from({ length: n }, () => share / n);
    const leading = given.slice(0, n - 1);
    return [...leading, share - sum(leading)];
}

/**
 * The drawer fronts of an external drawer leaf, top first (07 §4.4): the
 * front rectangle of `opening` with the cabinet's drawer overlay, divided
 * into `content.count` fronts with a 2 mm gap. Fractional; the parts and the
 * model rects are floored. Reports `drawer_heights_invalid`: a warning for a
 * list of the wrong length (then equal), an error for a last front below 80.
 */
export function drawerFrontRects(
    ctx: GenContext,
    opening: OpeningRect,
    content: DrawersContent,
    sectionId?: string,
): Rect[] {
    const block = frontRect(opening, drawerStyleOf(ctx.doc));
    const n = content.count;
    const given = givenHeights(ctx, content, sectionId);
    const heights = divide(block.y1 - block.y0, n, DRAWER_FRONT_GAP, given);
    if (given && (heights[n - 1] ?? 0) < MIN_DRAWER_FRONT_HEIGHT) {
        ctx.issue(
            'furniture.drawer_heights_invalid',
            'error',
            sectionId === undefined ? {} : { sectionId },
            sectionId === undefined ? [] : [sectionId],
        );
    }

    const rects: Rect[] = [];
    let y1 = block.y1;
    for (const height of heights) {
        rects.push({ x0: block.x0, x1: block.x1, y0: y1 - height, y1 });
        y1 -= height + DRAWER_FRONT_GAP;
    }
    return rects;
}

/** The whole leaf as an opening with carcass edges, when the openings hold none for it. */
function leafOpening(ctx: GenContext, leaf: SectionBoxInfo): OpeningRect {
    const [x0, y0] = leaf.box.min;
    const outer = { cls: 'outer', tp: ctx.t('carcass') } as const;
    return {
        x0,
        x1: x0 + leaf.box.size[0],
        y0,
        y1: y0 + leaf.box.size[1],
        edges: { left: outer, right: outer, top: outer, bottom: outer },
    };
}

/**
 * Drawers of one leaf (07 §3.12): fronts (external) or inner fronts (behind a
 * door), the box of every drawer with its slides, slide screws and handles.
 * Parts and hardware are keyed `{keyPrefix}.{j}.…`, `j` = 1 for the top
 * drawer; the default prefix is `section.{S}.drawer` (`S` = the leaf id).
 */
export function drawersFor(
    ctx: GenContext,
    env: Pick<Envelope, 'Dc' | 'drawerStyle' | 'interior'>,
    layout: SectionLayout,
    leaf: SectionBoxInfo,
    content: DrawersContent,
    keyPrefix: string = `section.${leaf.id}.drawer`,
): void {
    if (content.count < 1) return;
    const sectionId = leaf.id;
    const cover = coveringFront(ctx.doc, sectionId);
    const behind = content.behindDoor || cover !== undefined;
    if (cover && !content.behindDoor) {
        ctx.issue(
            'furniture.drawers_forced_behind_door',
            'warning',
            { sectionId },
            [sectionId],
        );
    }

    const tf = ctx.t('front');
    const tdb = ctx.t('drawer_box');
    const tbt = ctx.t('drawer_bottom');
    const [x0, y0, zBack] = leaf.box.min;
    const [w, h, depth] = leaf.box.size;
    const y1 = y0 + h;
    const z1 = zBack + depth;

    // Slots: the vertical space of every drawer, top first.
    let slots: Array<[number, number]>;
    let rects: Rect[] = [];
    if (behind) {
        const given = givenHeights(ctx, content, sectionId);
        let top = y1;
        slots = divide(h, content.count, 0, given).map((height) => {
            const slot: [number, number] = [top - height, top];
            top -= height;
            return slot;
        });
    } else {
        const opening =
            computeOpenings(ctx, env, layout).get(sectionId) ??
            leafOpening(ctx, leaf);
        rects = drawerFrontRects(ctx, opening, content, sectionId);
        slots = rects.map((r) => [Math.max(r.y0, y0), Math.min(r.y1, y1)]);
    }

    // Depth and slide: `cd` includes the inset reduction, also for inset external fronts.
    const cd =
        contentDepth(ctx, { interior: leaf.box }, sectionId) -
        (!behind && env.drawerStyle === 'inset' ? tf : 0);
    const insetReduction = depth - cd;
    const available = cd - (behind ? BEHIND_DOOR_DEPTH_CLEARANCE : 0);
    const maxLen = available - DRAWER_REAR_CLEARANCE - (behind ? tdb : 0);
    const selection = selectSlide(ctx, {
        slideCode: content.slideCode,
        maxLen,
        sectionId,
        availableDepth: available,
    });
    ctx.issues.push(...selection.issues);
    const slide = selection.slide;
    const specs = slide?.specs ?? {};
    const undermount = specs.type === 'undermount';
    const Ls = selection.boxLength;

    // Box dimensions (07 §3.12 box table).
    const packers =
        behind && cover && PACKED_COVERS.has(cover.kind)
            ? 2 * BEHIND_DOOR_SIDE_PACKER
            : 0;
    const Wo = w - packers;
    let Wb: number;
    let Win: number;
    let Lb: number;
    let bo: number;
    if (undermount) {
        Win =
            Wo -
            (num(specs.innerWidthDeductionMm) ?? DEFAULT_INNER_WIDTH_DEDUCTION);
        Wb = Win + 2 * tdb;
        Lb = Ls - (num(specs.lengthDeductionMm) ?? DEFAULT_LENGTH_DEDUCTION);
        bo = num(specs.bottomRecessMm) ?? DEFAULT_BOTTOM_RECESS;
        if (
            Ls > 0 &&
            tdb > (num(specs.maxSideThicknessMm) ?? DEFAULT_MAX_SIDE_THICKNESS)
        ) {
            ctx.issue(
                'furniture.drawer_side_too_thick',
                'warning',
                { sectionId },
                [sectionId],
            );
        }
    } else {
        Wb = fl(
            Wo -
                2 *
                    (num(specs.clearancePerSideMm) ??
                        DEFAULT_CLEARANCE_PER_SIDE),
        );
        Win = Wb - 2 * tdb;
        Lb = Ls;
        bo = DRAWER_BOTTOM_OFFSET_SIDE_MOUNT;
    }
    const canBuild = Ls > 0 && Win > 0 && Lb > 0;

    const bx0 = x0 + (w - Wb) / 2;
    const zf =
        z1 - insetReduction - (behind ? BEHIND_DOOR_DEPTH_CLEARANCE + tdb : 0);
    const boxMaterial = ctx.doc.materials.drawer_box.materialCode;
    const verticals = boundingVerticals(ctx, leaf);
    const handleCode = ctx.doc.carcass?.handles.code ?? null;
    const grooveRoom = DRAWER_BOTTOM_GROOVE_DEPTH - 1;

    slots.forEach(([slotY0, slotY1], index) => {
        const j = index + 1;
        const prefix = `${keyPrefix}.${j}`;
        const slotH = slotY1 - slotY0;
        const Hb =
            fl(
                (slotH - DRAWER_BOX_VERTICAL_CLEARANCE) /
                    DRAWER_BOX_HEIGHT_STEP,
            ) * DRAWER_BOX_HEIGHT_STEP;

        let box = canBuild;
        if (canBuild && Hb < DRAWER_MIN_BOX_HEIGHT) {
            ctx.issue(
                'furniture.drawer_too_low',
                'error',
                { sectionId, drawer: j },
                [sectionId],
            );
            box = false;
        }

        if (box) {
            const by0 = slotY0 + fl((slotH - Hb) / 2);
            const zRear = zf - Lb;
            const side = (suffix: 'left' | 'right', x: number) =>
                makePart(
                    {
                        key: `${prefix}.side.${suffix}`,
                        nameKey: 'parts.drawer_side',
                        role: 'drawer_box',
                        materialCode: boxMaterial,
                        box: { min: [x, by0, zRear], size: [tdb, Hb, Lb] },
                        thicknessAxis: 'x',
                        grainAxis: 'z',
                        banded: ['top'],
                        visibleFaces: 0,
                    },
                    ctx,
                );
            ctx.parts.push(
                side('left', bx0),
                side('right', bx0 + Wb - tdb),
                makePart(
                    {
                        key: `${prefix}.back`,
                        nameKey: 'parts.drawer_back',
                        role: 'drawer_box',
                        materialCode: boxMaterial,
                        box: {
                            min: [bx0 + tdb, by0 + bo + tbt, zRear],
                            size: [Win, Hb - bo - tbt, tdb],
                        },
                        thicknessAxis: 'z',
                        grainAxis: 'x',
                        banded: ['top'],
                        visibleFaces: 0,
                    },
                    ctx,
                ),
                makePart(
                    {
                        key: `${prefix}.bottom`,
                        nameKey: 'parts.drawer_bottom',
                        role: 'drawer_bottom',
                        materialCode:
                            ctx.doc.materials.drawer_bottom.materialCode,
                        box: {
                            min: [bx0 + tdb - grooveRoom, by0 + bo, zRear],
                            size: [Win + 2 * grooveRoom, tbt, Lb],
                        },
                        thicknessAxis: 'y',
                        grainAxis: null,
                        banded: [],
                        visibleFaces: 0,
                    },
                    ctx,
                ),
            );
            if (behind) {
                ctx.parts.push(
                    makePart(
                        {
                            key: `${prefix}.front`,
                            nameKey: 'parts.drawer_inner_front',
                            nameParams: { n: j },
                            role: 'drawer_box',
                            materialCode: boxMaterial,
                            box: {
                                min: [bx0, by0, zf],
                                size: [Wb, Hb, tdb],
                            },
                            thicknessAxis: 'z',
                            grainAxis: 'x',
                            banded: ALL_EDGES,
                            visibleFaces: 0,
                        },
                        ctx,
                    ),
                );
            }
            if (slide) {
                addHardwareLine(ctx, {
                    key: `${prefix}.slides`,
                    roleKey: undermount
                        ? 'slide.undermount'
                        : DEFAULT_SLIDE_ROLE,
                    code: slide.code,
                    qty: 1,
                    reasonKey: 'hardware.reason.slides_for_drawer',
                    reasonParams: { length: Ls },
                    frontId: null,
                    sectionId,
                });
            }
            for (const vertical of [verticals.left, verticals.right]) {
                if (vertical) vertical.operations.slideScrewSets += 1;
            }
        }

        const rect = rects[index];
        if (behind || !rect) return;
        const fw = fl(rect.x1 - rect.x0);
        const fh = fl(rect.y1 - rect.y0);
        if (fw <= 0 || fh <= 0) return;
        const [zFront0, zFront1] = leafZ(env, tf, env.drawerStyle);
        const key = `${prefix}.front`;
        const front = solidLeaf(
            ctx,
            key,
            { ...rect, z0: zFront0, z1: zFront1 },
            {
                nameKey: 'parts.drawer_front',
                nameParams: { n: j },
                grainAxis: 'x',
            },
        );
        ctx.fronts.push({
            id: key,
            frontId: null,
            kind: 'drawer',
            rect: { x: fl(rect.x0), y: fl(rect.y0), w: fw, h: fh },
            partKey: key,
        });
        handlesFor(
            ctx,
            {
                key: `${prefix}.handle`,
                frontId: null,
                sectionId,
                reasonKey: 'hardware.reason.handle_for_drawer',
                entityId: key,
            },
            handleCode,
            [
                {
                    part: front.edgePart('top'),
                    w: fw,
                    h: fh,
                    count: handleCount('drawer', fw),
                },
            ],
            handleOrientation(ctx, 'drawer'),
        );
    });
}
