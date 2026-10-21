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
    frontRect,
    openingsOf,
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
import type { GenContext, Part, PhysEdge } from '../types';
import { boundingVerticals, contentDepth } from './contents';
import { coveringFront, type Envelope } from './envelope';
import type { SectionBoxInfo, SectionLayout } from './layout';

type DrawersContent = Extract<Content, { type: 'drawers' }>;
type DrawerStyle = Envelope['drawerStyle'];

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

/** What a drawer issue names: its section (param and entity) and drawer keys (entities). */
export interface DrawerIssueRef {
    params: Record<string, string>;
    entityIds: string[];
}

/**
 * The `sectionId` param and entity of a drawer issue (both absent without a
 * section, e.g. on a table), followed by the drawer `keys` as entities, so
 * that issues of different drawers stay distinct after deduplication.
 */
export function drawerIssueRef(
    sectionId: string | undefined,
    ...keys: string[]
): DrawerIssueRef {
    return sectionId === undefined
        ? { params: {}, entityIds: keys }
        : { params: { sectionId }, entityIds: [sectionId, ...keys] };
}

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
    /** Named by the issues as an entity after the section: the drawer key, e.g. `table.drawer.1`. */
    drawerKey?: string;
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
    const { maxLen } = request;
    const issues: Issue[] = [];
    const { params: sectionParams, entityIds } = drawerIssueRef(
        request.sectionId,
        ...(request.drawerKey === undefined ? [] : [request.drawerKey]),
    );
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
    const { params, entityIds } = drawerIssueRef(sectionId);
    ctx.issue('furniture.drawer_heights_invalid', 'warning', params, entityIds);
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
 * front rectangle of `opening` with the drawer overlay `style` (the
 * envelope's `drawerStyle`), divided into `content.count` fronts with a 2 mm
 * gap. Fractional; the parts and the model rects are floored. Reports
 * `drawer_heights_invalid`: a warning for a list of the wrong length (then
 * equal), an error for a given last front below 80.
 */
export function drawerFrontRects(
    ctx: GenContext,
    opening: OpeningRect,
    content: DrawersContent,
    style: DrawerStyle,
    sectionId?: string,
): Rect[] {
    const block = frontRect(opening, style);
    const n = content.count;
    const given = givenHeights(ctx, content, sectionId);
    const heights = divide(block.y1 - block.y0, n, DRAWER_FRONT_GAP, given);
    if (given && (heights[n - 1] ?? 0) < MIN_DRAWER_FRONT_HEIGHT) {
        const { params, entityIds } = drawerIssueRef(sectionId);
        ctx.issue(
            'furniture.drawer_heights_invalid',
            'error',
            params,
            entityIds,
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

/** The box geometry shared by every drawer of one leaf (07 §3.12 box table). */
export interface LeafBoxes {
    /** The carcass section of the drawers; absent on a table (no `sectionId` in issues and lines). */
    sectionId: string | undefined;
    behind: boolean;
    slide: CatalogHardware | null;
    undermount: boolean;
    /** Slide length `Ls`. */
    slideLength: number;
    /** Outer width `Wb`, inner width `Win`, length `Lb`, bottom offset `bo`. */
    Wb: number;
    Win: number;
    Lb: number;
    bo: number;
    /** Box x min and front z. */
    bx0: number;
    zf: number;
    tdb: number;
    tbt: number;
    /** False when no box can be made (no slide length, or no inner width / length). */
    canBuild: boolean;
    /** Side panels, partitions or runners that take the slide screws. */
    verticals: Array<Part | undefined>;
}

/**
 * Widths and length of the boxes (07 §3.12 box table) for slide `slide` of
 * length `Ls` in an opening `Wo` wide; warns `drawer_side_too_thick` (naming
 * `ref`) when the box sides are too thick for an undermount slide.
 */
export function boxSizes(
    ctx: GenContext,
    slide: CatalogHardware | null,
    Ls: number,
    Wo: number,
    ref: DrawerIssueRef,
): Pick<LeafBoxes, 'undermount' | 'Wb' | 'Win' | 'Lb' | 'bo'> {
    const tdb = ctx.t('drawer_box');
    const specs = slide?.specs ?? {};
    if (specs.type === 'undermount') {
        // An undermount type implies a slide, so Ls > 0 here.
        if (
            tdb > (num(specs.maxSideThicknessMm) ?? DEFAULT_MAX_SIDE_THICKNESS)
        ) {
            ctx.issue(
                'furniture.drawer_side_too_thick',
                'warning',
                ref.params,
                ref.entityIds,
            );
        }
        const Win =
            Wo -
            (num(specs.innerWidthDeductionMm) ?? DEFAULT_INNER_WIDTH_DEDUCTION);
        return {
            undermount: true,
            Win,
            Wb: Win + 2 * tdb,
            Lb: Ls - (num(specs.lengthDeductionMm) ?? DEFAULT_LENGTH_DEDUCTION),
            bo: num(specs.bottomRecessMm) ?? DEFAULT_BOTTOM_RECESS,
        };
    }
    const Wb = fl(
        Wo - 2 * (num(specs.clearancePerSideMm) ?? DEFAULT_CLEARANCE_PER_SIDE),
    );
    return {
        undermount: false,
        Wb,
        Win: Wb - 2 * tdb,
        Lb: Ls,
        bo: DRAWER_BOTTOM_OFFSET_SIDE_MOUNT,
    };
}

/**
 * The narrowest opening `Wo` (whole mm) whose box keeps an inner width of at
 * least 1 mm with `slide` (07 §3.12 box table): side mount
 * `fl(Wo − 2 × clearance) − 2·t_db >= 1`, undermount
 * `Wo − innerWidthDeduction >= 1`. Without a slide the side-mount defaults apply.
 */
export function minDrawerOpening(
    ctx: GenContext,
    slide: CatalogHardware | null,
): number {
    const specs = slide?.specs ?? {};
    if (specs.type === 'undermount') {
        return (
            (num(specs.innerWidthDeductionMm) ??
                DEFAULT_INNER_WIDTH_DEDUCTION) + 1
        );
    }
    const clearance =
        num(specs.clearancePerSideMm) ?? DEFAULT_CLEARANCE_PER_SIDE;
    return Math.ceil(2 * clearance + 2 * ctx.t('drawer_box') + 1 - 1e-6);
}

/**
 * Drawer `j` (1 = top) of a leaf in the slot `[slotY0, slotY1]`: the box
 * (sides, back, bottom, and an inner front behind a door) keyed `{prefix}.…`,
 * its slides `{prefix}.slides` and the slide screws in the bounding verticals.
 * A box lower than 60 mm is error `drawer_too_low` (naming the section and
 * the drawer `prefix`) and is not built.
 */
export function drawerBox(
    ctx: GenContext,
    boxes: LeafBoxes,
    prefix: string,
    j: number,
    [slotY0, slotY1]: [number, number],
): void {
    if (!boxes.canBuild) return;
    const { sectionId, tdb, tbt, Wb, Win, Lb, bo, bx0, zf } = boxes;
    const slotH = slotY1 - slotY0;
    const Hb =
        fl((slotH - DRAWER_BOX_VERTICAL_CLEARANCE) / DRAWER_BOX_HEIGHT_STEP) *
        DRAWER_BOX_HEIGHT_STEP;
    if (Hb < DRAWER_MIN_BOX_HEIGHT) {
        const ref = drawerIssueRef(sectionId, prefix);
        ctx.issue(
            'furniture.drawer_too_low',
            'error',
            { ...ref.params, drawer: j },
            ref.entityIds,
        );
        return;
    }

    const by0 = slotY0 + fl((slotH - Hb) / 2);
    const zRear = zf - Lb;
    const boxMaterial = ctx.doc.materials.drawer_box.materialCode;
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
    const grooveRoom = DRAWER_BOTTOM_GROOVE_DEPTH - 1;
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
                materialCode: ctx.doc.materials.drawer_bottom.materialCode,
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
    if (boxes.behind) {
        ctx.parts.push(
            makePart(
                {
                    key: `${prefix}.front`,
                    nameKey: 'parts.drawer_inner_front',
                    nameParams: { n: j },
                    role: 'drawer_box',
                    materialCode: boxMaterial,
                    box: { min: [bx0, by0, zf], size: [Wb, Hb, tdb] },
                    thicknessAxis: 'z',
                    grainAxis: 'x',
                    banded: ALL_EDGES,
                    visibleFaces: 0,
                },
                ctx,
            ),
        );
    }
    if (boxes.slide) {
        addHardwareLine(ctx, {
            key: `${prefix}.slides`,
            roleKey: boxes.undermount ? 'slide.undermount' : DEFAULT_SLIDE_ROLE,
            code: boxes.slide.code,
            qty: 1,
            reasonKey: 'hardware.reason.slides_for_drawer',
            reasonParams: { length: boxes.slideLength },
            frontId: null,
            sectionId: sectionId ?? null,
        });
    }
    for (const vertical of boxes.verticals) {
        if (vertical) vertical.operations.slideScrewSets += 1;
    }
}

/**
 * The front of external drawer `j` over `rect` (07 §4.4): a solid leaf in
 * the drawer overlay's z range, its model front and its handles (`handleCode`,
 * horizontal by default).
 */
function externalDrawerFront(
    ctx: GenContext,
    env: Pick<Envelope, 'Dc' | 'drawerStyle'>,
    rect: Rect,
    prefix: string,
    j: number,
    sectionId: string | undefined,
    handleCode: string | null,
): void {
    const fw = fl(rect.x1 - rect.x0);
    const fh = fl(rect.y1 - rect.y0);
    if (fw <= 0 || fh <= 0) return;
    const [z0, z1] = leafZ(env, ctx.t('front'), env.drawerStyle);
    const key = `${prefix}.front`;
    const front = solidLeaf(
        ctx,
        key,
        { ...rect, z0, z1 },
        { nameKey: 'parts.drawer_front', nameParams: { n: j }, grainAxis: 'x' },
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
            sectionId: sectionId ?? null,
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
}

/** How `drawersFor` keys and equips the drawers of a leaf. */
export interface DrawerLeafOptions {
    /** Key prefix of parts and hardware; default `section.{S}.drawer`. */
    keyPrefix?: string;
    /**
     * Opening of external drawers. Default: the leaf's opening from
     * `openingsOf` (carcass documents only); a table cabinet passes its own.
     */
    opening?: OpeningRect;
    /** Handle code of external fronts; default `carcass.handles.code`. */
    handleCode?: string | null;
    /**
     * False when the leaf is no carcass section (a desk cabinet, 07 §3.13):
     * issues and hardware lines then name no section. Default true.
     */
    inSection?: boolean;
}

/**
 * Drawers of one leaf (07 §3.12): fronts (external) or inner fronts (behind a
 * door), the box of every drawer with its slides, slide screws and handles.
 * Parts and hardware are keyed `{keyPrefix}.{j}.…`, `j` = 1 for the top
 * drawer; the default prefix is `section.{S}.drawer` (`S` = the leaf id).
 *
 * External drawers take `options.opening`, or else their opening from
 * `openingsOf` (the openings of the generation, computed once), which holds
 * every external drawer leaf of a carcass. Without either (no layout, or
 * no carcass spec) it throws: a table cabinet must pass its opening.
 */
export function drawersFor(
    ctx: GenContext,
    env: Pick<Envelope, 'Dc' | 'drawerStyle' | 'interior'>,
    layout: SectionLayout | null,
    leaf: SectionBoxInfo,
    content: DrawersContent,
    options: DrawerLeafOptions = {},
): void {
    const keyPrefix = options.keyPrefix ?? `section.${leaf.id}.drawer`;
    const sectionId = options.inSection === false ? undefined : leaf.id;
    const handleCode =
        options.handleCode !== undefined
            ? options.handleCode
            : (ctx.doc.carcass?.handles.code ?? null);
    const cover = coveringFront(ctx.doc, leaf.id);
    const behind = content.behindDoor || cover !== undefined;
    if (cover && !content.behindDoor) {
        ctx.issue(
            'furniture.drawers_forced_behind_door',
            'warning',
            { sectionId: leaf.id },
            [leaf.id],
        );
    }

    const tdb = ctx.t('drawer_box');
    const [x0, y0, zBack] = leaf.box.min;
    const [w, h, depth] = leaf.box.size;
    const y1 = y0 + h;

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
            options.opening ??
            (layout ? openingsOf(ctx, env, layout).get(leaf.id) : undefined);
        if (!opening) {
            throw new Error(
                `drawersFor: no opening for the external drawers of ${leaf.id}`,
            );
        }
        rects = drawerFrontRects(
            ctx,
            opening,
            content,
            env.drawerStyle,
            sectionId,
        );
        slots = rects.map((r) => [Math.max(r.y0, y0), Math.min(r.y1, y1)]);
    }

    // Depth and slide: `cd` includes the inset reduction, also for inset external fronts.
    const cd =
        contentDepth(ctx, { interior: leaf.box }, leaf.id) -
        (!behind && env.drawerStyle === 'inset' ? ctx.t('front') : 0);
    const insetReduction = depth - cd;
    const available = cd - (behind ? BEHIND_DOOR_DEPTH_CLEARANCE : 0);
    const selection = selectSlide(ctx, {
        slideCode: content.slideCode,
        maxLen: available - DRAWER_REAR_CLEARANCE - (behind ? tdb : 0),
        sectionId,
        availableDepth: available,
    });
    ctx.issues.push(...selection.issues);
    const Ls = selection.boxLength;

    const packers =
        behind && cover && PACKED_COVERS.has(cover.kind)
            ? 2 * BEHIND_DOOR_SIDE_PACKER
            : 0;
    const sizes = boxSizes(
        ctx,
        selection.slide,
        Ls,
        w - packers,
        drawerIssueRef(sectionId),
    );
    const verticals = boundingVerticals(ctx, leaf);
    const boxes: LeafBoxes = {
        sectionId,
        behind,
        slide: selection.slide,
        slideLength: Ls,
        ...sizes,
        bx0: x0 + (w - sizes.Wb) / 2,
        zf:
            zBack +
            depth -
            insetReduction -
            (behind ? BEHIND_DOOR_DEPTH_CLEARANCE + tdb : 0),
        tdb,
        tbt: ctx.t('drawer_bottom'),
        canBuild: Ls > 0 && sizes.Win > 0 && sizes.Lb > 0,
        verticals: [verticals.left, verticals.right],
    };

    slots.forEach((slot, index) => {
        const j = index + 1;
        const prefix = `${keyPrefix}.${j}`;
        drawerBox(ctx, boxes, prefix, j, slot);
        const rect = rects[index];
        if (!behind && rect) {
            externalDrawerFront(
                ctx,
                env,
                rect,
                prefix,
                j,
                sectionId,
                handleCode,
            );
        }
    });
}
