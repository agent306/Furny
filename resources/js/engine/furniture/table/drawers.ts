/**
 * Under-top table drawers (07 §3.13): a row of drawers under the top, each
 * with a front, runners and a box per §3.12. Side drawers (left / right on
 * four legs) are built facing +z and turned into place.
 */
import {
    boxSizes,
    drawerBox,
    drawerIssueRef,
    selectSlide,
    type LeafBoxes,
} from '../carcass/drawers';
import {
    DRAWER_REAR_CLEARANCE,
    TABLE_DRAWER_FRONT_HEIGHT,
    TABLE_DRAWER_MAX_WIDTH,
    TABLE_DRAWER_SPACING,
    fl,
} from '../constants';
import { solidLeaf } from '../fronts/leaf';
import { handleCount, handleOrientation, handlesFor } from '../rules/hardware';
import type { Box3, GenContext, Part, PhysEdge } from '../types';
import {
    drawerSideOf,
    panel,
    span3,
    type DrawersSpec,
    type DrawerSide,
    type Frame,
} from './frame';

/** Under-top drawers without legs: depth available is the base depth less this. */
const DRAWER_DEPTH_ALLOWANCE = 40;
/** Under-top drawer slot height over the front height. */
const DRAWER_SLOT_EXTRA = 20;

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
    /**
     * The drawer bay along the face: the clear span between the inner faces
     * of what bounds the drawers at their height and depth (legs, side
     * aprons, end panels, the cabinet side). The outer runners stand
     * against these faces, inside the bay.
     */
    bay: [number, number];
    /** z of the face plane (the fronts' outer face). */
    plane: number;
    /** Depth available behind the face plane. */
    depthAvail: number;
}

/**
 * The drawer row of the base, or null when the base has no room for
 * under-top drawers. On four legs the bay is bounded by the legs (section
 * `s`, solid or hardware) and by the aprons across the drawer side (their
 * inner face at `inset + t_c`), whichever reaches further in; on panel ends
 * by the end panels; on cabinet ends by the left end and the cabinet.
 */
function drawerRow(
    f: Frame,
    side: DrawerSide,
    cabinetX0: number,
): DrawerRow | null {
    const { T, Wb, Db, bx0, bz0, s, tc } = f;
    const inset = T.base.apron.inset;
    // From the base's outer face to the inner face bounding the bay.
    const reach = Math.max(s, T.base.apron.enabled ? inset + tc : 0);
    switch (T.base.type) {
        case 'four_legs':
            if (side === 'front') {
                return {
                    side,
                    bay: [bx0 + reach, bx0 + Wb - reach],
                    plane: bz0 + Db - inset,
                    depthAvail: Db - 2 * inset - tc,
                };
            }
            return side === 'left'
                ? {
                      side,
                      bay: [bz0 + reach, bz0 + Db - reach],
                      plane: -(bx0 + inset),
                      depthAvail: Wb / 2 - s,
                  }
                : {
                      side,
                      bay: [-(bz0 + Db - reach), -(bz0 + reach)],
                      plane: bx0 + Wb - inset,
                      depthAvail: Wb / 2 - s,
                  };
        case 'panel_ends':
        case 'cabinet_ends':
            if (side !== 'front') return null;
            return {
                side,
                bay: [
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
 * slot, the box per 07 §3.12 (`Wo = ws`, slot `fh + 20`), its slides and
 * handle. The box stands behind the front, so its available depth is
 * `depthAvail − t_f` (the runners still span `depthAvail`).
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

    const available = A - tf;
    const selection = selectSlide(ctx, {
        slideCode: drawers.slideCode,
        maxLen: available - DRAWER_REAR_CLEARANCE,
        availableDepth: available,
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
    if (Ls > 0 && sizes.Lb <= 0) {
        // A slide too short for the box: the closest code is the slide one.
        const ref = drawerIssueRef(undefined, prefix);
        ctx.issue(
            'furniture.drawer_no_slide',
            'error',
            { ...ref.params, availableDepth: available },
            ref.entityIds,
        );
    }
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
 * Under-top drawers (07 §3.13): `count` drawers centred in the bay less one
 * runner on each side, with `TABLE_DRAWER_SPACING` between them (at least
 * the two runners between neighbours), each at most `TABLE_DRAWER_MAX_WIDTH`
 * wide. A side the base does not support is error
 * `furniture.table_drawer_side_unsupported` and builds nothing.
 */
export function underTopDrawers(
    ctx: GenContext,
    f: Frame,
    cabinetX0: number,
): void {
    const drawers = f.T.storage.drawers;
    const side = drawerSideOf(f.T);
    if (!drawers || side === null) return;
    const row = drawerRow(f, side, cabinetX0);
    if (!row) {
        ctx.issue('furniture.table_drawer_side_unsupported', 'error');
        return;
    }
    const k = drawers.count;
    const spacing = Math.max(TABLE_DRAWER_SPACING, 2 * f.tc);
    const from = row.bay[0] + f.tc;
    const span = row.bay[1] - f.tc - from;
    const ws = Math.min(
        TABLE_DRAWER_MAX_WIDTH,
        fl((span - (k - 1) * spacing) / k),
    );
    // Too narrow for any drawer: 07 §7.3 has no code for it (reported, not invented).
    if (ws <= 0) return;
    const total = k * ws + (k - 1) * spacing;
    const start = from + (span - total) / 2;
    for (let j = 1; j <= k; j++) {
        const x0 = start + (j - 1) * (ws + spacing);
        underTopDrawer(ctx, f, row, drawers, j, x0, ws);
    }
}
