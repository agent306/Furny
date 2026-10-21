/**
 * Base `cabinet_ends` (07 §3.13): a panel end on the left and a desk cabinet
 * on the right, with its content (drawers, shelves and a door, or empty).
 */
import { shelvesFor } from '../carcass/contents';
import { drawersFor } from '../carcass/drawers';
import type { SectionBoxInfo } from '../carcass/layout';
import { fl } from '../constants';
import { solidLeaf } from '../fronts/leaf';
import { frontRect, type OpeningRect } from '../fronts/openings';
import { handleOrientation, handlesFor, hingesFor } from '../rules/hardware';
import { leafWeightKg } from '../rules/weight';
import type { Content } from '../schema';
import type { Box3, GenContext } from '../types';
import { endPanel, modestyPanel, panelEnds } from './bases';
import { joint, panel, span3, type Frame } from './frame';

/** Narrower knee space warns `knee_space_narrow`. */
const MIN_KNEE_WIDTH = 550;
/** Desk cabinet fronts stop 2 mm under the table top (top edge cover -2). */
const CABINET_TOP_COVER = -2;

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
export function cabinetEnds(ctx: GenContext, f: Frame): number {
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
