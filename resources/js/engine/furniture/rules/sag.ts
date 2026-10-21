/**
 * Shelf sag (07 §7.2): the span above which a shelf of a given board type
 * and thickness warns (`furniture.shelf_sag`) or warns critically
 * (`furniture.shelf_sag_critical`), for an evenly loaded shelf.
 */
import { cmpId } from '../../compare';
import type { Content, FurnitureDocument } from '../schema';
import type { GenContext, Part } from '../types';

export interface SagRow {
    thickness: number;
    /** Span (mm) above which the shelf warns. */
    warn: number;
    /** Span (mm) above which the warning is critical. */
    critical: number;
}

export interface SagLimits {
    warn: number;
    critical: number;
}

const rows = (
    ...values: Array<[thickness: number, warn: number, critical: number]>
): SagRow[] =>
    values.map(([thickness, warn, critical]) => ({
        thickness,
        warn,
        critical,
    }));

/** The table of 07 §7.2, thicknesses ascending per board type. */
export const SAG_TABLE: Readonly<Record<string, readonly SagRow[]>> = {
    particle_board: rows([16, 600, 800], [18, 800, 1000], [25, 1000, 1250]),
    mdf: rows([16, 650, 850], [18, 850, 1050], [25, 1050, 1300]),
    plywood: rows(
        [12, 600, 800],
        [15, 800, 1000],
        [18, 1000, 1200],
        [25, 1200, 1500],
    ),
    blockboard: rows([18, 1000, 1250], [25, 1200, 1500]),
    solid_wood: rows([18, 900, 1100], [25, 1200, 1500]),
    glass: rows([5, 500, 700], [8, 700, 900], [10, 800, 1000]),
    hdf: rows([3, 300, 400], [6, 400, 500]),
};

/** Board types without rows: `44 x t` and `55 x t`. */
const OTHER_WARN_PER_MM = 44;
const OTHER_CRITICAL_PER_MM = 55;
/** Clamped shelves (fixed, or loose but not adjustable): both limits x 1.5. */
const CLAMPED_FACTOR = 1.5;

/**
 * Span limits for a shelf of `boardType` and `thickness` mm (07 §7.2): the
 * row with the largest thickness at or below `thickness`, or the smallest
 * row scaled by `thickness / t_row` when the shelf is thinner than every
 * row; `44 x t` / `55 x t` for a board type without rows. A `clamped`
 * shelf (cammed or doweled at both ends) gets 1.5 times both limits.
 */
export function sagLimits(
    boardType: string,
    thickness: number,
    clamped: boolean,
): SagLimits {
    const table = Object.hasOwn(SAG_TABLE, boardType)
        ? SAG_TABLE[boardType]
        : undefined;
    const smallest = table?.[0];
    let base: SagLimits;
    if (!table || !smallest) {
        base = {
            warn: OTHER_WARN_PER_MM * thickness,
            critical: OTHER_CRITICAL_PER_MM * thickness,
        };
    } else {
        const row = table.findLast((r) => r.thickness <= thickness);
        base = row
            ? { warn: row.warn, critical: row.critical }
            : {
                  warn: (smallest.warn * thickness) / smallest.thickness,
                  critical:
                      (smallest.critical * thickness) / smallest.thickness,
              };
    }
    const factor = clamped ? CLAMPED_FACTOR : 1;
    return { warn: base.warn * factor, critical: base.critical * factor };
}

type ShelvesContent = Extract<Content, { type: 'shelves' }>;

/** The shelves content of section `id` in the carcass tree. */
function sectionShelves(
    doc: FurnitureDocument,
    id: string,
): ShelvesContent | undefined {
    const visit = (
        section: NonNullable<FurnitureDocument['carcass']>['interior'],
    ): ShelvesContent | undefined => {
        if (section.id === id) {
            return section.content?.type === 'shelves'
                ? section.content
                : undefined;
        }
        for (const child of section.children) {
            const found = visit(child.section);
            if (found) return found;
        }
        return undefined;
    };
    return doc.carcass ? visit(doc.carcass.interior) : undefined;
}

const LOOSE_SHELF = /^section\.([^.]+)\.shelf\.\d+$/;
const FIXED_SHELF = /^section\.[^.]+\.fixed_shelf\.\d+$/;
const TABLE_LOWER_SHELF = 'table.shelf';
const TABLE_CABINET_SHELF = /^table\.cabinet\.shelf\.\d+$/;

/**
 * Whether the part is a shelf for the sag rule, and if so whether it is
 * clamped at both ends: `null` for any other part. Loose shelves are clamped
 * unless adjustable; fixed shelves between rows and the table lower shelf
 * always are.
 */
function shelfClamping(doc: FurnitureDocument, key: string): boolean | null {
    if (FIXED_SHELF.test(key) || key === TABLE_LOWER_SHELF) return true;
    const loose = LOOSE_SHELF.exec(key);
    if (loose) {
        const content = sectionShelves(doc, loose[1] ?? '');
        return content ? !content.adjustable : false;
    }
    if (TABLE_CABINET_SHELF.test(key)) {
        const content = doc.table?.storage.endCabinets?.content;
        return content?.type === 'shelves' ? !content.adjustable : false;
    }
    return null;
}

/** Span of a shelf: its extent along x, which is the part length for a shelf wider than deep. */
function spanOf(part: Part): number {
    return part.geometry.kind === 'box'
        ? Math.floor(part.geometry.box.size[0] + 1e-6)
        : part.length;
}

/**
 * Warnings `furniture.shelf_sag` / `furniture.shelf_sag_critical`
 * (`{ partKey, span, limit }`, entity: the part key) for every loose shelf,
 * fixed shelf, table lower shelf and table cabinet shelf whose span is above
 * the limits of its board type and thickness (07 §7.2). Shelves in key order.
 */
export function shelfSagIssues(ctx: GenContext): void {
    const shelves = [...ctx.parts].sort((a, b) => cmpId(a.key, b.key));
    for (const part of shelves) {
        const clamped = shelfClamping(ctx.doc, part.key);
        if (clamped === null) continue;
        const material =
            ctx.idx.material(part.materialCode) ?? ctx.mat('shelf');
        const limits = sagLimits(material.boardType, part.thickness, clamped);
        const span = spanOf(part);
        if (span > limits.critical) {
            ctx.issue(
                'furniture.shelf_sag_critical',
                'warning',
                { partKey: part.key, span, limit: limits.critical },
                [part.key],
            );
        } else if (span > limits.warn) {
            ctx.issue(
                'furniture.shelf_sag',
                'warning',
                { partKey: part.key, span, limit: limits.warn },
                [part.key],
            );
        }
    }
}
