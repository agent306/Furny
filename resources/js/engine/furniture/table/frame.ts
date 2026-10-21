/**
 * The table frame (07 §3.13 symbols) and the helpers every table generator
 * shares: boxes from ranges, panels in the role material, joints.
 */
import type { MaterialRole } from '../../catalog/snapshot';
import { fl } from '../constants';
import { makePart } from '../parts';
import type { TableSpec } from '../schema';
import type {
    Axis,
    Box3,
    GenContext,
    Part,
    PartGeometry,
    PhysEdge,
} from '../types';

export type DrawersSpec = NonNullable<TableSpec['storage']['drawers']>;
export type DrawerSide = DrawersSpec['side'];

/** Leg section when a hardware leg's specs do not give one (07 §3.13). */
const DEFAULT_LEG_SECTION = 50;

export const NO_EDGES: PhysEdge[] = [];
export const FOUR_EDGES: PhysEdge[] = ['front', 'back', 'left', 'right'];

/** Everything the base generators share (07 §3.13 symbols). */
export interface Frame {
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
    /**
     * Apron inset from the base faces: `apron.inset`, clamped to
     * `max(0, s − t_c)` on four legs so the aprons never cross (spec 19).
     */
    apronInset: number;
    tLeg: number;
    tc: number;
    ts: number;
    tf: number;
    tb: number;
    /** The default handle of table drawers and doors; null when the catalog has none. */
    handleCode: () => string | null;
}

/** A [min, max] range along one axis. */
export type Range = readonly [number, number];

/** A box from its ranges. */
export const span3 = (
    [x0, x1]: Range,
    [y0, y1]: Range,
    [z0, z1]: Range,
): Box3 => ({
    min: [x0, y0, z0],
    size: [x1 - x0, y1 - y0, z1 - z0],
});

export interface TablePanel {
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
export function panel(ctx: GenContext, spec: TablePanel): Part | undefined {
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
export function joint(
    ctx: GenContext,
    member: Part | undefined,
    other: Part | string | undefined,
    length: number,
): void {
    const otherKey = typeof other === 'string' ? other : other?.key;
    if (!member || otherKey === undefined) return;
    ctx.joints.push({ member: member.key, other: otherKey, length });
}

const num = (v: unknown): number | undefined =>
    typeof v === 'number' ? v : undefined;

/**
 * The frame of the table, or null after the error
 * `furniture.envelope_too_small` when nothing fits under the top. Reports the
 * top issues (`round_top_not_square`, `corner_radius_too_large`,
 * `table_top_thickness_rounded`) first.
 */
export function tableFrame(ctx: GenContext, T: TableSpec): Frame | null {
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

    const tc = ctx.t('carcass');
    const apron = T.base.apron;
    let apronInset = apron.inset;
    if (T.base.type === 'four_legs' && apron.enabled && apron.inset + tc > s) {
        apronInset = Math.max(0, s - tc);
        ctx.issue('furniture.apron_inset_clamped', 'info', {
            requested: apron.inset,
            applied: apronInset,
        });
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
        apronInset,
        tLeg: ctx.t('leg'),
        tc,
        ts: ctx.t('shelf'),
        tf: ctx.t('front'),
        tb: ctx.t('back'),
        handleCode,
    };
}

/** The side of the under-top drawers, when there are any (count > 0). */
export function drawerSideOf(T: TableSpec): DrawerSide | null {
    const drawers = T.storage.drawers;
    return drawers && drawers.count > 0 ? drawers.side : null;
}
