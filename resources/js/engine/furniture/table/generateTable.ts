/**
 * Table family (07 §3.13): the top (layers and outline), the base
 * (`four_legs`, `panel_ends`, `trestle`, `pedestal`, `cabinet_ends`), the
 * under-top drawers and the table hardware (`table.*` lines; nothing from
 * the mounting rules of §6.8).
 *
 * Coordinates are furniture local space (07 §1.1): the top covers
 * `x ∈ [0, W]`, `z ∈ [0, D]`; the base stands in the footprint
 * `[bx0, bx0 + Wb] x [bz0, bz0 + Db]` under the top (`y ∈ [0, Hb]`).
 */
import type { MaterialRole } from '../../catalog/snapshot';
import {
    boxSizes,
    drawerBox,
    drawerIssueRef,
    drawersFor,
    selectSlide,
    type LeafBoxes,
} from '../carcass/drawers';
import { shelvesFor } from '../carcass/contents';
import type { SectionBoxInfo } from '../carcass/layout';
import {
    DRAWER_REAR_CLEARANCE,
    LOWER_SHELF_ELEVATION,
    MODESTY_MAX_HEIGHT,
    TABLE_DRAWER_FRONT_HEIGHT,
    TABLE_DRAWER_MAX_WIDTH,
    TABLE_DRAWER_SPACING,
    TABLE_STRETCHER_ELEVATION,
    TABLE_STRETCHER_HEIGHT,
    TRESTLE_BEAM_HEIGHT,
    fl,
} from '../constants';
import { solidLeaf } from '../fronts/leaf';
import { frontRect, type OpeningRect } from '../fronts/openings';
import { makePart } from '../parts';
import { legFitsHeight, screwPacks } from '../rules/carcassHardware';
import { connectorsForJoints } from '../rules/connectors';
import {
    addHardwareLine,
    handleCount,
    handleOrientation,
    handlesFor,
    hingesFor,
} from '../rules/hardware';
import { leafWeightKg } from '../rules/weight';
import type { Content, TableSpec } from '../schema';
import type {
    Axis,
    Box3,
    GenContext,
    Part,
    PartGeometry,
    PhysEdge,
} from '../types';
import { circleOutline, ellipseOutline, roundedRectOutline } from './outlines';

type DrawersSpec = NonNullable<TableSpec['storage']['drawers']>;
type DrawerSide = DrawersSpec['side'];

/** Leg section when a hardware leg's specs do not give one (07 §3.13). */
const DEFAULT_LEG_SECTION = 50;
/** A pedestal column is at least this wide inside, its base plate at least this wide. */
const PEDESTAL_MIN_COLUMN = 150;
const PEDESTAL_MIN_BASE = 400;
const PEDESTAL_COLUMN_SHARE = 0.25;
const PEDESTAL_BASE_SHARE = 0.6;
/** The top plate overhangs the column by 50 mm per side. */
const PEDESTAL_TOP_PLATE_EXTRA = 100;
/** Pedestal bases suit tables up to this size. */
const PEDESTAL_MAX_SIZE = 1200;
/** Longer bases warn `table_span_long`. */
const MAX_TABLE_SPAN = 2400;
/** Narrower knee space warns `knee_space_narrow`. */
const MIN_KNEE_WIDTH = 550;
/** Modesty panel set in from the rear edge; lower shelf of panel ends stops this short at the front. */
const PANEL_ENDS_REAR_INSET = 20;
/** Under-top drawers without legs: depth available is the base depth less this. */
const DRAWER_DEPTH_ALLOWANCE = 40;
/** Under-top drawer slot height over the front height. */
const DRAWER_SLOT_EXTRA = 20;
/** Desk cabinet fronts stop 2 mm under the table top (top edge cover -2). */
const CABINET_TOP_COVER = -2;
/** Dowels per joint end of aprons and stretchers, and for the lower shelf. */
const DOWELS_PER_END = 2;
const LOWER_SHELF_DOWELS = 8;
/** Trestle beam connectors (07 §3.13): cams at the beam ends, dowels. */
const TRESTLE_CAMS = 4;
const TRESTLE_DOWELS = 8;
const TABLE_CORNER_BRACKETS = 4;
const TABLE_LEGS = 4;

const NO_EDGES: PhysEdge[] = [];
const FOUR_EDGES: PhysEdge[] = ['front', 'back', 'left', 'right'];

/** Everything the base generators share (07 §3.13 symbols). */
interface Frame {
    T: TableSpec;
    W: number;
    H: number;
    D: number;
    /** Top board thickness, layer count and total top thickness. */
    tTop: number;
    k: number;
    Tt: number;
    /** Height under the top. */
    Hb: number;
    /** Base footprint and its origin. */
    Wb: number;
    Db: number;
    bx0: number;
    bz0: number;
    /** Leg section `s` and the leg, carcass, shelf, front, back board thicknesses. */
    s: number;
    tLeg: number;
    tc: number;
    ts: number;
    tf: number;
    tb: number;
    /** The default handle of table drawers and doors; null when the catalog has none. */
    handleCode: () => string | null;
}

/** A box from its ranges. */
type Range = readonly [number, number];

const span3 = ([x0, x1]: Range, [y0, y1]: Range, [z0, z1]: Range): Box3 => ({
    min: [x0, y0, z0],
    size: [x1 - x0, y1 - y0, z1 - z0],
});

interface TablePanel {
    key: string;
    nameKey: string;
    nameParams?: Record<string, string | number>;
    role: MaterialRole;
    box: Box3;
    thin: Axis;
    grain: Axis | null;
    banded?: PhysEdge[];
    faces: 0 | 1 | 2;
    geometry?: PartGeometry;
}

/**
 * Pushes a table panel in the role's material and returns it; a box with a
 * size of zero or less (a base squeezed by its own parts) makes no part.
 */
function panel(ctx: GenContext, spec: TablePanel): Part | undefined {
    if (spec.box.size.some((size) => fl(size) <= 0)) return undefined;
    const part = makePart(
        {
            key: spec.key,
            nameKey: spec.nameKey,
            nameParams: spec.nameParams,
            role: spec.role,
            materialCode: ctx.doc.materials[spec.role].materialCode,
            box: spec.box,
            thicknessAxis: spec.thin,
            grainAxis: spec.grain,
            banded: spec.banded ?? NO_EDGES,
            visibleFaces: spec.faces,
            geometry: spec.geometry,
        },
        ctx,
    );
    ctx.parts.push(part);
    return part;
}

/** Records a joint of `member` (drilled) to `other`, when both parts exist. */
function joint(
    ctx: GenContext,
    member: Part | undefined,
    other: Part | string | undefined,
    length: number,
): void {
    const otherKey = typeof other === 'string' ? other : other?.key;
    if (!member || otherKey === undefined) return;
    ctx.joints.push({ member: member.key, other: otherKey, length });
}

/** Adds a `table.*` connector line of the role default (07 §3.13). */
function connectorLine(
    ctx: GenContext,
    kind: 'cam' | 'dowel' | 'corner',
    qty: number,
    joints: number,
): void {
    if (qty <= 0) return;
    addHardwareLine(ctx, {
        key: `table.connectors.${kind}`,
        roleKey:
            kind === 'corner'
                ? 'connector.table_corner'
                : kind === 'cam'
                  ? 'connector.cam'
                  : 'connector.dowel',
        qty,
        reasonKey:
            kind === 'corner'
                ? 'hardware.reason.table_corner_brackets'
                : kind === 'cam'
                  ? 'hardware.reason.cam_locks'
                  : 'hardware.reason.dowels',
        reasonParams: kind === 'corner' ? {} : { joints },
        frontId: null,
        sectionId: null,
    });
}

const num = (v: unknown): number | undefined =>
    typeof v === 'number' ? v : undefined;

/**
 * The frame of the table, or null after the error
 * `furniture.envelope_too_small` when nothing fits under the top. Reports the
 * top issues (`round_top_not_square`, `corner_radius_too_large`,
 * `table_top_thickness_rounded`) first.
 */
function tableFrame(ctx: GenContext, T: TableSpec): Frame | null {
    const { width: W, height: H, depth: D } = ctx.doc.dims;
    const tTop = ctx.t('top');
    const top = T.top;

    if (top.shape === 'round' && W !== D) {
        ctx.issue('furniture.round_top_not_square', 'error', {}, ['table.top']);
    }
    if (
        top.shape === 'rounded_rectangle' &&
        top.cornerRadius > Math.min(W, D) / 2
    ) {
        ctx.issue('furniture.corner_radius_too_large', 'error', {}, [
            'table.top',
        ]);
    }
    let k = 1;
    if (top.thickness !== 'material') {
        k = Math.max(1, Math.round(top.thickness / tTop));
        if (k * tTop !== top.thickness) {
            ctx.issue('furniture.table_top_thickness_rounded', 'info', {}, [
                'table.top',
            ]);
        }
    }
    const Tt = k * tTop;

    const o = top.overhang;
    const inscribed =
        (top.shape === 'round' || top.shape === 'oval') &&
        T.base.type !== 'pedestal';
    const Wb = inscribed ? fl((W - 2 * o) / Math.SQRT2) : W - 2 * o;
    const Db = inscribed ? fl((D - 2 * o) / Math.SQRT2) : D - 2 * o;
    const Hb = H - Tt;
    if (Wb <= 0 || Db <= 0 || Hb <= 0) {
        ctx.issue('furniture.envelope_too_small', 'error');
        return null;
    }

    let s = T.base.legSection;
    if (T.base.legSource === 'hardware') {
        const code =
            T.base.legCode ?? ctx.idx.defaultHardware('leg.table')?.code;
        const leg = code === undefined ? undefined : ctx.idx.hardware(code);
        s = num(leg?.specs.sectionMm) ?? DEFAULT_LEG_SECTION;
    }

    let handle: { code: string | null } | undefined;
    const handleCode = (): string | null => {
        if (!handle) {
            handle = {
                code: ctx.idx.defaultHardware('handle.default')?.code ?? null,
            };
            if (handle.code === null) {
                ctx.issue('furniture.no_default_hardware', 'warning', {
                    roleKey: 'handle.default',
                });
            }
        }
        return handle.code;
    };

    return {
        T,
        W,
        H,
        D,
        tTop,
        k,
        Tt,
        Hb,
        Wb,
        Db,
        bx0: (W - Wb) / 2,
        bz0: (D - Db) / 2,
        s,
        tLeg: ctx.t('leg'),
        tc: ctx.t('carcass'),
        ts: ctx.t('shelf'),
        tf: ctx.t('front'),
        tb: ctx.t('back'),
        handleCode,
    };
}

/** The outline of a non-rectangular top, or null for a rectangle (07 §3.13 top geometry). */
function topOutline(f: Frame): Array<[number, number]> | null {
    const { W, D } = f;
    const top = f.T.top;
    switch (top.shape) {
        case 'rectangle':
            return null;
        case 'rounded_rectangle':
            return roundedRectOutline(
                W,
                D,
                Math.min(top.cornerRadius, Math.min(W, D) / 2),
            );
        case 'round':
            // W != D is an error; the ellipse keeps the top inside W x D.
            return W === D ? circleOutline(W) : ellipseOutline(W, D);
        case 'oval':
            return ellipseOutline(W, D);
    }
}

/** `table.top` and `table.top.layer.{m}`, `m = 2..k`, from the top down. */
function topParts(ctx: GenContext, f: Frame): void {
    const outline = topOutline(f);
    for (let m = 1; m <= f.k; m++) {
        const y0 = f.H - m * f.tTop;
        panel(ctx, {
            key: m === 1 ? 'table.top' : `table.top.layer.${m}`,
            nameKey: m === 1 ? 'parts.table_top' : 'parts.table_top_layer',
            nameParams: m === 1 ? undefined : { n: m },
            role: 'top',
            box: span3([0, f.W], [y0, y0 + f.tTop], [0, f.D]),
            thin: 'y',
            grain: 'x',
            banded: FOUR_EDGES,
            faces: m === 1 ? 1 : 0,
            geometry: outline
                ? {
                      kind: 'extruded',
                      outline,
                      plane: 'xz',
                      y: y0,
                      thickness: f.tTop,
                  }
                : undefined,
        });
    }
}

/** The side of the under-top drawers, when there are any (count > 0). */
function drawerSideOf(T: TableSpec): DrawerSide | null {
    const drawers = T.storage.drawers;
    return drawers && drawers.count > 0 ? drawers.side : null;
}

/** Base `four_legs` (07 §3.13): legs, aprons, stretchers, lower shelf and their hardware. */
function fourLegs(ctx: GenContext, f: Frame): void {
    const { T, Hb, Wb, Db, bx0, bz0, s, tLeg, tc, ts } = f;
    const base = T.base;
    const xL: [number, number] = [bx0, bx0 + s];
    const xR: [number, number] = [bx0 + Wb - s, bx0 + Wb];

    if (base.legSource === 'solid') {
        if (tLeg !== s) ctx.issue('furniture.leg_section_mismatch', 'info');
        const zF: [number, number] = [bz0 + Db - tLeg, bz0 + Db];
        const zB: [number, number] = [bz0, bz0 + tLeg];
        for (const [key, x, z] of [
            ['fl', xL, zF],
            ['fr', xR, zF],
            ['bl', xL, zB],
            ['br', xR, zB],
        ] as const) {
            panel(ctx, {
                key: `table.leg.${key}`,
                nameKey: 'parts.table_leg',
                role: 'leg',
                box: span3(x, [0, Hb], z),
                thin: 'z',
                grain: 'y',
                faces: 2,
            });
        }
    } else {
        const key = 'table.legs';
        const code = addHardwareLine(ctx, {
            key,
            roleKey: 'leg.table',
            code: base.legCode,
            qty: TABLE_LEGS,
            reasonKey: 'hardware.reason.table_legs',
            frontId: null,
            sectionId: null,
        });
        const leg = code === undefined ? undefined : ctx.idx.hardware(code);
        if (leg && !legFitsHeight(leg, Hb)) {
            ctx.issue(
                'furniture.leg_height_mismatch',
                'warning',
                { code: leg.code },
                [key],
            );
        }
    }

    let dowels = 0;
    const drawerSide = drawerSideOf(T);
    if (base.apron.enabled) {
        const ah = base.apron.height;
        const inset = base.apron.inset;
        const y: [number, number] = [Hb - ah, Hb];
        const alongX: [number, number] = [bx0 + s, bx0 + Wb - s];
        const alongZ: [number, number] = [bz0 + s, bz0 + Db - s];
        const aprons = [
            ['front', alongX, y, [bz0 + Db - inset - tc, bz0 + Db - inset]],
            ['back', alongX, y, [bz0 + inset, bz0 + inset + tc]],
            ['left', [bx0 + inset, bx0 + inset + tc], y, alongZ],
            ['right', [bx0 + Wb - inset - tc, bx0 + Wb - inset], y, alongZ],
        ] as const;
        for (const [side, x, ys, z] of aprons) {
            if (side === drawerSide) continue;
            const alongWidth = side === 'front' || side === 'back';
            const part = panel(ctx, {
                key: `table.apron.${side}`,
                nameKey: 'parts.apron',
                role: 'carcass',
                box: span3(x, ys, z),
                thin: alongWidth ? 'z' : 'x',
                grain: alongWidth ? 'x' : 'z',
                banded: ['bottom'],
                faces: 1,
            });
            if (part) dowels += 2 * DOWELS_PER_END;
        }
        connectorLine(ctx, 'corner', TABLE_CORNER_BRACKETS, 0);
    }

    if (base.stretcher) {
        const y: [number, number] = [
            TABLE_STRETCHER_ELEVATION,
            TABLE_STRETCHER_ELEVATION + TABLE_STRETCHER_HEIGHT,
        ];
        const centred = (c: number): [number, number] => [
            c - tLeg / 2,
            c + tLeg / 2,
        ];
        const alongZ: [number, number] = [bz0 + s, bz0 + Db - s];
        const stretchers = [
            ['left', centred(bx0 + s / 2), alongZ, 'x'],
            ['right', centred(bx0 + Wb - s / 2), alongZ, 'x'],
            ['center', [bx0 + s, bx0 + Wb - s], centred(bz0 + Db / 2), 'z'],
        ] as const;
        for (const [side, x, z, thin] of stretchers) {
            const part = panel(ctx, {
                key: `table.stretcher.${side}`,
                nameKey: 'parts.stretcher',
                role: 'leg',
                box: span3(x, y, z),
                thin,
                grain: thin === 'x' ? 'z' : 'x',
                faces: 2,
            });
            if (part) dowels += 2 * DOWELS_PER_END;
        }
    }

    if (T.storage.lowerShelf) {
        const shelf = panel(ctx, {
            key: 'table.shelf',
            nameKey: 'parts.lower_shelf',
            role: 'shelf',
            box: span3(
                [bx0 + s, bx0 + Wb - s],
                [LOWER_SHELF_ELEVATION, LOWER_SHELF_ELEVATION + ts],
                [bz0 + s, bz0 + Db - s],
            ),
            thin: 'y',
            grain: 'x',
            banded: ['front', 'back'],
            faces: 2,
        });
        if (shelf) dowels += LOWER_SHELF_DOWELS;
    }

    connectorLine(ctx, 'dowel', dowels, dowels / DOWELS_PER_END);
    if (Wb > MAX_TABLE_SPAN) ctx.issue('furniture.table_span_long', 'warning');
}

/** A panel end (`table.end.{side}`) of `panel_ends` / `cabinet_ends`, joined to the top. */
function endPanel(
    ctx: GenContext,
    f: Frame,
    side: 'left' | 'right',
): Part | undefined {
    const { Hb, Wb, Db, bx0, bz0, tc } = f;
    const x: [number, number] =
        side === 'left' ? [bx0, bx0 + tc] : [bx0 + Wb - tc, bx0 + Wb];
    const end = panel(ctx, {
        key: `table.end.${side}`,
        nameKey: 'parts.end_panel',
        role: 'carcass',
        box: span3(x, [0, Hb], [bz0, bz0 + Db]),
        thin: 'x',
        grain: 'y',
        banded: ['front', 'back'],
        faces: 2,
    });
    joint(ctx, end, 'table.top', Db);
    return end;
}

/**
 * The modesty panel `table.stretcher.back` between `x0` and `x1`, joined to
 * the panels at both of its ends.
 */
function modestyPanel(
    ctx: GenContext,
    f: Frame,
    [x0, x1]: [number, number],
    ends: Array<Part | undefined>,
): void {
    const { Hb, bz0, tc } = f;
    const mh = Math.min(MODESTY_MAX_HEIGHT, fl(Hb / 2));
    const z0 = bz0 + PANEL_ENDS_REAR_INSET;
    const modesty = panel(ctx, {
        key: 'table.stretcher.back',
        nameKey: 'parts.modesty_panel',
        role: 'carcass',
        box: span3([x0, x1], [Hb - mh, Hb], [z0, z0 + tc]),
        thin: 'z',
        grain: 'x',
        banded: ['bottom'],
        faces: 1,
    });
    for (const end of ends) joint(ctx, modesty, end, mh);
}

/** Base `panel_ends` (07 §3.13): two ends, the modesty panel, the lower shelf. */
function panelEnds(ctx: GenContext, f: Frame): void {
    const { T, Wb, Db, bx0, bz0, tc, ts } = f;
    const left = endPanel(ctx, f, 'left');
    const right = endPanel(ctx, f, 'right');
    const between: [number, number] = [bx0 + tc, bx0 + Wb - tc];
    if (T.base.stretcher) modestyPanel(ctx, f, between, [left, right]);
    if (T.storage.lowerShelf) {
        const depth = Db - PANEL_ENDS_REAR_INSET;
        const shelf = panel(ctx, {
            key: 'table.shelf',
            nameKey: 'parts.lower_shelf',
            role: 'shelf',
            box: span3(
                between,
                [LOWER_SHELF_ELEVATION, LOWER_SHELF_ELEVATION + ts],
                [bz0, bz0 + depth],
            ),
            thin: 'y',
            grain: 'x',
            banded: ['front'],
            faces: 2,
        });
        joint(ctx, shelf, left, depth);
        joint(ctx, shelf, right, depth);
    }
}

/** Base `trestle` (07 §3.13): upright, foot and cleat per side, the centre beam. */
function trestle(ctx: GenContext, f: Frame): void {
    const { Hb, Wb, Db, bx0, bz0, s, tLeg } = f;
    const beam = TRESTLE_BEAM_HEIGHT;
    const zc = bz0 + Db / 2;
    for (const side of ['left', 'right'] as const) {
        const cx = side === 'left' ? bx0 + s : bx0 + Wb - s;
        const x: [number, number] = [cx - tLeg / 2, cx + tLeg / 2];
        const pieces = [
            ['upright', [beam, Hb - beam], [zc - s, zc + s], 'y'],
            ['foot', [0, beam], [bz0, bz0 + Db], 'z'],
            ['cleat', [Hb - beam, Hb], [bz0, bz0 + Db], 'z'],
        ] as const;
        for (const [piece, y, z, grain] of pieces) {
            panel(ctx, {
                key: `table.trestle.${side}.${piece}`,
                nameKey: `parts.trestle_${piece}`,
                role: 'leg',
                box: span3(x, y, z),
                thin: 'x',
                grain,
                faces: 2,
            });
        }
    }
    panel(ctx, {
        key: 'table.stretcher.center',
        nameKey: 'parts.stretcher',
        role: 'leg',
        box: span3(
            [bx0 + s + tLeg / 2, bx0 + Wb - s - tLeg / 2],
            [Hb / 2 - beam / 2, Hb / 2 + beam / 2],
            [zc - tLeg / 2, zc + tLeg / 2],
        ),
        thin: 'z',
        grain: 'x',
        faces: 2,
    });
    connectorLine(ctx, 'cam', TRESTLE_CAMS, TRESTLE_CAMS / 2);
    connectorLine(ctx, 'dowel', TRESTLE_DOWELS, TRESTLE_DOWELS / 2);
}

/** Base `pedestal` (07 §3.13): a four-sided column on a base plate under a top plate. */
function pedestal(ctx: GenContext, f: Frame): void {
    const { W, D, Hb, Wb, Db, tc } = f;
    const c = Math.max(
        PEDESTAL_MIN_COLUMN,
        fl(PEDESTAL_COLUMN_SHARE * Math.min(Wb, Db)),
    );
    const cx = W / 2;
    const cz = D / 2;
    const y: [number, number] = [tc, Hb - tc];
    const outer: [number, number] = [cx - c / 2 - tc, cx + c / 2 + tc];
    const inner: [number, number] = [cz - c / 2, cz + c / 2];
    const sides = [
        [1, outer, [cz + c / 2, cz + c / 2 + tc], 'z'],
        [2, [cx - c / 2 - tc, cx - c / 2], inner, 'x'],
        [3, outer, [cz - c / 2 - tc, cz - c / 2], 'z'],
        [4, [cx + c / 2, cx + c / 2 + tc], inner, 'x'],
    ] as const;
    for (const [n, x, z, thin] of sides) {
        panel(ctx, {
            key: `table.pedestal.side.${n}`,
            nameKey: 'parts.pedestal_side',
            role: 'carcass',
            box: span3(x, y, z),
            thin,
            grain: 'y',
            faces: 2,
        });
    }
    const square = (size: number, ys: [number, number]): Box3 =>
        span3([cx - size / 2, cx + size / 2], ys, [
            cz - size / 2,
            cz + size / 2,
        ]);
    const b = Math.max(
        PEDESTAL_MIN_BASE,
        fl(PEDESTAL_BASE_SHARE * Math.min(W, D)),
    );
    panel(ctx, {
        key: 'table.pedestal.base',
        nameKey: 'parts.pedestal_plate',
        role: 'carcass',
        box: square(b, [0, tc]),
        thin: 'y',
        grain: 'x',
        banded: FOUR_EDGES,
        faces: 0,
    });
    panel(ctx, {
        key: 'table.pedestal.top',
        nameKey: 'parts.pedestal_plate',
        role: 'carcass',
        box: square(c + 2 * tc + PEDESTAL_TOP_PLATE_EXTRA, [Hb - tc, Hb]),
        thin: 'y',
        grain: 'x',
        faces: 0,
    });
    if (Math.max(W, D) > PEDESTAL_MAX_SIZE) {
        ctx.issue('furniture.pedestal_unstable', 'warning');
    }
}

/** The desk cabinet's interior as a leaf for the carcass content generators. */
const cabinetLeaf = (interior: Box3): SectionBoxInfo => ({
    id: 'table.cabinet',
    box: interior,
    leaf: true,
    parentId: null,
    index: 0,
    label: { key: 'sections.interior', params: {}, parentLabel: null },
});

/**
 * The single door of a desk cabinet with shelves (07 §3.13): full overlay
 * over `opening`, hinged on the right, its hinges, plates and handle.
 */
function cabinetDoor(
    ctx: GenContext,
    f: Frame,
    opening: OpeningRect,
    frontZ: number,
): void {
    const key = 'table.cabinet.door';
    const rect = frontRect(opening, 'full');
    const lw = rect.x1 - rect.x0;
    const lh = rect.y1 - rect.y0;
    if (fl(lw) <= 0 || fl(lh) <= 0) return;
    const body = solidLeaf(
        ctx,
        key,
        { ...rect, z0: frontZ, z1: frontZ + f.tf },
        { nameKey: 'parts.door', nameParams: { leaf: 1 }, grainAxis: 'y' },
    );
    const part = body.edgePart('right');
    hingesFor(
        ctx,
        { id: key, hingeCode: 'auto', overlay: 'full' },
        [
            {
                part,
                edgeLength: fl(lh),
                weightKg: leafWeightKg(body.parts, ctx.idx),
                edgeClass: 'outer',
            },
        ],
        { base: key, frontId: null },
    );
    handlesFor(
        ctx,
        {
            key: `${key}.handle`,
            frontId: null,
            sectionId: null,
            reasonKey: 'hardware.reason.handles_for_front',
            entityId: key,
        },
        f.handleCode(),
        [{ part: body.edgePart('left'), w: fl(lw), h: fl(lh), count: 1 }],
        handleOrientation(ctx, 'door'),
    );
    ctx.fronts.push({
        id: key,
        frontId: null,
        kind: 'door',
        rect: { x: fl(rect.x0), y: fl(rect.y0), w: fl(lw), h: fl(lh) },
        hingeSide: 'right',
        partKey: body.partKey,
    });
}

/** The content of the desk cabinet (drawers, shelves with a door, empty). */
function cabinetContent(
    ctx: GenContext,
    f: Frame,
    content: Content,
    interior: Box3,
    frontZ: number,
): void {
    const [x0, y0] = interior.min;
    const outer = { cls: 'outer' as const, tp: f.tc };
    const opening: OpeningRect = {
        x0,
        x1: x0 + interior.size[0],
        y0,
        y1: y0 + interior.size[1],
        edges: {
            left: outer,
            right: outer,
            bottom: outer,
            top: { ...outer, cover: CABINET_TOP_COVER },
        },
    };
    const leaf = cabinetLeaf(interior);
    switch (content.type) {
        case 'drawers':
            drawersFor(
                ctx,
                { Dc: frontZ, drawerStyle: 'full', interior },
                null,
                leaf,
                content,
                {
                    keyPrefix: 'table.cabinet.drawer',
                    opening,
                    handleCode: f.handleCode(),
                    inSection: false,
                },
            );
            return;
        case 'shelves':
            shelvesFor(ctx, leaf, content, {
                keyPrefix: 'table.cabinet',
                inSection: false,
            });
            cabinetDoor(ctx, f, opening, frontZ);
            return;
        case 'empty':
            return;
        default:
            ctx.issue('furniture.cabinet_content_unsupported', 'error');
    }
}

/**
 * Base `cabinet_ends` (07 §3.13): a panel end on the left and a cabinet on
 * the right whose top is the table top; the modesty panel between them.
 * Returns the cabinet's left x (`cx0`), the end of the knee space. Without
 * `endCabinets` the base is built as `panel_ends`.
 */
function cabinetEnds(ctx: GenContext, f: Frame): number {
    const { T, Hb, Wb, Db, bx0, bz0, tc, tf, tb } = f;
    const cabinet = T.storage.endCabinets;
    if (!cabinet) {
        panelEnds(ctx, f);
        return bx0 + Wb - tc;
    }
    const end = endPanel(ctx, f, 'left');
    const cw = cabinet.width;
    const cx0 = bx0 + Wb - cw;
    const cx1 = bx0 + Wb;
    const Dk = Db - tf;
    const z: [number, number] = [bz0, bz0 + Dk];
    const between: [number, number] = [cx0 + tc, cx1 - tc];

    const side = (name: 'left' | 'right', x: number) =>
        panel(ctx, {
            key: `table.cabinet.side.${name}`,
            nameKey: name === 'left' ? 'parts.side_left' : 'parts.side_right',
            role: 'carcass',
            box: span3([x, x + tc], [0, Hb], z),
            thin: 'x',
            grain: 'y',
            banded: ['front'],
            faces: 1,
        });
    const left = side('left', cx0);
    const right = side('right', cx1 - tc);
    const bottom = panel(ctx, {
        key: 'table.cabinet.bottom',
        nameKey: 'parts.bottom',
        role: 'carcass',
        box: span3(between, [0, tc], [bz0 + tb, bz0 + Dk]),
        thin: 'y',
        grain: 'x',
        banded: ['front'],
        faces: 0,
    });
    panel(ctx, {
        key: 'table.cabinet.back',
        nameKey: 'parts.back',
        role: 'back',
        box: span3(between, [tc, Hb], [bz0, bz0 + tb]),
        thin: 'z',
        grain: 'y',
        faces: 0,
    });
    for (const cabinetSide of [left, right]) {
        joint(ctx, cabinetSide, bottom, Dk);
        joint(ctx, cabinetSide, 'table.top', Dk);
    }

    const interior = span3(between, [tc, Hb], [bz0 + tb, bz0 + Dk]);
    cabinetContent(ctx, f, cabinet.content, interior, bz0 + Dk);

    const knee = Wb - cw - tc;
    if (knee < MIN_KNEE_WIDTH) {
        ctx.issue('furniture.knee_space_narrow', 'warning', { width: knee });
    }
    if (T.base.stretcher) modestyPanel(ctx, f, [bx0 + tc, cx0], [end, left]);
    return cx0;
}

/** Maps a box and the physical edges of a drawer built facing the front to its side. */
interface DrawerFrame {
    box(b: Box3): Box3;
    edge: Record<PhysEdge, PhysEdge>;
}

/**
 * Side drawers are built in a frame where they face +z (virtual x = along
 * the face, virtual z = toward the face), then turned about y: on the left
 * `(x, y, z) = (-vz, vy, vx)`, on the right `(vz, vy, -vx)`.
 */
const SIDE_FRAMES: Record<'left' | 'right', DrawerFrame> = {
    left: {
        box: ({ min: [x, y, z], size: [sx, sy, sz] }) => ({
            min: [-(z + sz), y, x],
            size: [sz, sy, sx],
        }),
        edge: {
            left: 'back',
            right: 'front',
            front: 'left',
            back: 'right',
            top: 'top',
            bottom: 'bottom',
        },
    },
    right: {
        box: ({ min: [x, y, z], size: [sx, sy, sz] }) => ({
            min: [z, y, -(x + sx)],
            size: [sz, sy, sx],
        }),
        edge: {
            left: 'front',
            right: 'back',
            front: 'right',
            back: 'left',
            top: 'top',
            bottom: 'bottom',
        },
    },
};

/** Turns parts built in a side drawer's frame into place (geometry and edge meaning). */
function turnParts(
    ctx: GenContext,
    parts: readonly Part[],
    frame: DrawerFrame,
): void {
    for (const part of parts) {
        if (part.geometry.kind === 'box') {
            part.geometry = { kind: 'box', box: frame.box(part.geometry.box) };
        }
        const edges = ctx.edgeMap.get(part.key);
        if (edges) {
            ctx.edgeMap.set(part.key, {
                L1: frame.edge[edges.L1],
                L2: frame.edge[edges.L2],
                W1: frame.edge[edges.W1],
                W2: frame.edge[edges.W2],
            });
        }
    }
}

/** Where the under-top drawers go, in their own frame (facing +z). */
interface DrawerRow {
    side: DrawerSide;
    /** Along the face. */
    span: [number, number];
    /** z of the face plane (the fronts' outer face). */
    plane: number;
    /** Depth available behind the face plane. */
    depthAvail: number;
}

/** The drawer row of the base, or null when the base has no room for under-top drawers. */
function drawerRow(
    f: Frame,
    side: DrawerSide,
    cabinetX0: number,
): DrawerRow | null {
    const { T, Wb, Db, bx0, bz0, s, tc } = f;
    const inset = T.base.apron.inset;
    switch (T.base.type) {
        case 'four_legs':
            if (side === 'front') {
                return {
                    side,
                    span: [bx0 + s, bx0 + Wb - s],
                    plane: bz0 + Db - inset,
                    depthAvail: Db - 2 * inset - tc,
                };
            }
            return side === 'left'
                ? {
                      side,
                      span: [bz0 + s, bz0 + Db - s],
                      plane: -(bx0 + inset),
                      depthAvail: Wb / 2 - s,
                  }
                : {
                      side,
                      span: [-(bz0 + Db - s), -(bz0 + s)],
                      plane: bx0 + Wb - inset,
                      depthAvail: Wb / 2 - s,
                  };
        case 'panel_ends':
        case 'cabinet_ends':
            if (side !== 'front') return null;
            return {
                side,
                span: [
                    bx0 + tc,
                    T.base.type === 'panel_ends' ? bx0 + Wb - tc : cabinetX0,
                ],
                plane: bz0 + Db,
                depthAvail: Db - DRAWER_DEPTH_ALLOWANCE,
            };
        default:
            return null;
    }
}

/**
 * Under-top drawer `j` in the slot `[x0, x0 + ws]` of `row`: the front
 * (flush with the face plane), the runners hung under the top beside the
 * slot, the box per 07 §3.12 (`Wo = ws`, slot `fh + 20`, `A = depthAvail`),
 * its slides and handle.
 */
function underTopDrawer(
    ctx: GenContext,
    f: Frame,
    row: DrawerRow,
    drawers: DrawersSpec,
    j: number,
    x0: number,
    ws: number,
): void {
    const { T, Hb, tf, tc } = f;
    const prefix = `table.drawer.${j}`;
    const fh = T.base.apron.enabled
        ? T.base.apron.height
        : TABLE_DRAWER_FRONT_HEIGHT;
    const slot: [number, number] = [Hb - fh - DRAWER_SLOT_EXTRA, Hb];
    const A = row.depthAvail;
    const x1 = x0 + ws;
    const before = ctx.parts.length;

    const front = solidLeaf(
        ctx,
        `${prefix}.front`,
        { x0, x1, y0: Hb - fh, y1: Hb, z0: row.plane - tf, z1: row.plane },
        { nameKey: 'parts.drawer_front', nameParams: { n: j }, grainAxis: 'x' },
    );
    const runner = (name: 'left' | 'right', x: number) =>
        panel(ctx, {
            key: `${prefix}.runner.${name}`,
            nameKey: 'parts.drawer_runner',
            role: 'carcass',
            box: span3([x, x + tc], slot, [row.plane - A, row.plane]),
            thin: 'x',
            grain: 'z',
            faces: 0,
        });
    const runners = [runner('left', x0 - tc), runner('right', x1)];

    const selection = selectSlide(ctx, {
        slideCode: drawers.slideCode,
        maxLen: A - DRAWER_REAR_CLEARANCE,
        availableDepth: A,
        drawerKey: prefix,
    });
    ctx.issues.push(...selection.issues);
    const Ls = selection.boxLength;
    const sizes = boxSizes(
        ctx,
        selection.slide,
        Ls,
        ws,
        drawerIssueRef(undefined, prefix),
    );
    const boxes: LeafBoxes = {
        sectionId: undefined,
        behind: false,
        slide: selection.slide,
        slideLength: Ls,
        ...sizes,
        bx0: x0 + (ws - sizes.Wb) / 2,
        zf: row.plane - tf,
        tdb: ctx.t('drawer_box'),
        tbt: ctx.t('drawer_bottom'),
        canBuild: Ls > 0 && sizes.Win > 0 && sizes.Lb > 0,
        verticals: runners,
    };
    drawerBox(ctx, boxes, prefix, j, slot);

    const fw = fl(ws);
    const frontKey = `${prefix}.front`;
    handlesFor(
        ctx,
        {
            key: `${prefix}.handle`,
            frontId: null,
            sectionId: null,
            reasonKey: 'hardware.reason.handle_for_drawer',
            entityId: frontKey,
        },
        f.handleCode(),
        [
            {
                part: front.edgePart('top'),
                w: fw,
                h: fl(fh),
                count: handleCount('drawer', fw),
            },
        ],
        handleOrientation(ctx, 'drawer'),
    );

    if (row.side === 'front') {
        ctx.fronts.push({
            id: frontKey,
            frontId: null,
            kind: 'drawer',
            rect: { x: fl(x0), y: fl(Hb - fh), w: fw, h: fl(fh) },
            partKey: frontKey,
        });
    } else {
        turnParts(ctx, ctx.parts.slice(before), SIDE_FRAMES[row.side]);
    }
}

/**
 * Under-top drawers (07 §3.13): `count` drawers centred in the row's span
 * with `TABLE_DRAWER_SPACING` between them, each at most
 * `TABLE_DRAWER_MAX_WIDTH` wide. A side the base does not support is error
 * `furniture.table_drawer_side_unsupported` and builds nothing.
 */
function underTopDrawers(ctx: GenContext, f: Frame, cabinetX0: number): void {
    const drawers = f.T.storage.drawers;
    const side = drawerSideOf(f.T);
    if (!drawers || side === null) return;
    const row = drawerRow(f, side, cabinetX0);
    if (!row) {
        ctx.issue('furniture.table_drawer_side_unsupported', 'error', {}, [
            'table.drawer',
        ]);
        return;
    }
    const k = drawers.count;
    const span = row.span[1] - row.span[0];
    const ws = Math.min(
        TABLE_DRAWER_MAX_WIDTH,
        fl((span - (k - 1) * TABLE_DRAWER_SPACING) / k),
    );
    if (ws <= 0) return;
    const total = k * ws + (k - 1) * TABLE_DRAWER_SPACING;
    const start = row.span[0] + (span - total) / 2;
    for (let j = 1; j <= k; j++) {
        const x0 = start + (j - 1) * (ws + TABLE_DRAWER_SPACING);
        underTopDrawer(ctx, f, row, drawers, j, x0, ws);
    }
}

/**
 * Step 3 of `generateFurniture` for the table family (07 §3.13): the top, the
 * base, the under-top drawers, then the connectors of the recorded joints
 * (merged into the base's `table.connectors.*` lines) and the screw packs.
 * Returns false when nothing could be generated (`furniture.envelope_too_small`:
 * no room under the top) or the document has no table spec.
 */
export function tableParts(ctx: GenContext): boolean {
    const T = ctx.doc.table;
    if (!T) return false;
    const f = tableFrame(ctx, T);
    if (!f) return false;

    topParts(ctx, f);
    let cabinetX0 = f.bx0 + f.Wb;
    switch (T.base.type) {
        case 'four_legs':
            fourLegs(ctx, f);
            break;
        case 'panel_ends':
            panelEnds(ctx, f);
            break;
        case 'trestle':
            trestle(ctx, f);
            break;
        case 'pedestal':
            pedestal(ctx, f);
            break;
        case 'cabinet_ends':
            cabinetX0 = cabinetEnds(ctx, f);
            break;
    }
    underTopDrawers(ctx, f, cabinetX0);
    connectorsForJoints(ctx, 'table');
    screwPacks(ctx, 'table');
    return true;
}
