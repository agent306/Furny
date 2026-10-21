/**
 * Table bases without storage (07 §3.13): `four_legs`, `panel_ends`,
 * `trestle` and `pedestal`, and the end and modesty panels that
 * `cabinet_ends` shares.
 */
import {
    LOWER_SHELF_ELEVATION,
    MODESTY_MAX_HEIGHT,
    TABLE_STRETCHER_ELEVATION,
    TABLE_STRETCHER_HEIGHT,
    TRESTLE_BEAM_HEIGHT,
    fl,
} from '../constants';
import { legFitsHeight } from '../rules/carcassHardware';
import { addHardwareLine } from '../rules/hardware';
import type { Box3, GenContext, Part } from '../types';
import {
    FOUR_EDGES,
    drawerSideOf,
    joint,
    panel,
    span3,
    type Frame,
} from './frame';
import { connectorLine } from './hardware';

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
/** Modesty panel set in from the rear edge; lower shelf of panel ends stops this short at the front. */
const PANEL_ENDS_REAR_INSET = 20;
/** Dowels per joint end of aprons and stretchers, and for the lower shelf. */
const DOWELS_PER_END = 2;
const LOWER_SHELF_DOWELS = 8;
/** Trestle beam connectors (07 §3.13): cams at the beam ends, dowels. */
const TRESTLE_CAMS = 4;
const TRESTLE_DOWELS = 8;
const TABLE_CORNER_BRACKETS = 4;
const TABLE_LEGS = 4;

/** Base `four_legs` (07 §3.13): legs, aprons, stretchers, lower shelf and their hardware. */
export function fourLegs(ctx: GenContext, f: Frame): void {
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
export function endPanel(
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
export function modestyPanel(
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
export function panelEnds(ctx: GenContext, f: Frame): void {
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
export function trestle(ctx: GenContext, f: Frame): void {
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
export function pedestal(ctx: GenContext, f: Frame): void {
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
