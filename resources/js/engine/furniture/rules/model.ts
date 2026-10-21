/**
 * Model-level validation rules (07 §3.1 step 6, §7.3): checks that need the
 * generated parts, run after the overrides. Pure; they only record issues on
 * the context.
 *
 * Sag (`rules/sag.ts`), `part_exceeds_sheet`, `too_many_parts`,
 * `loft_no_access` and the thickness guidance of 07 §1.4 (`thin_carcass`,
 * `back_too_thick_for_groove`, `drawer_bottom_thick`, `drawer_box_thickness`).
 */
import { cmpId } from '../../compare';
import { MAX_PARTS } from '../constants';
import type { FurnitureDocument, Section } from '../schema';
import { fitsSheet } from '../sheetFit';
import type { GenContext } from '../types';
import { shelfSagIssues } from './sag';

/** A carcass material thinner than this is `thin_carcass` (07 §1.4). */
const MIN_CARCASS_THICKNESS = 15;
/** A grooved back thicker than this is `back_too_thick_for_groove`. */
const MAX_GROOVED_BACK_THICKNESS = 8;
/** A drawer bottom thicker than this is `drawer_bottom_thick`. */
const MAX_DRAWER_BOTTOM_THICKNESS = 8;
/** Drawer box sides and back outside this range are info `drawer_box_thickness`. */
const MIN_DRAWER_BOX_THICKNESS = 12;
const MAX_DRAWER_BOX_THICKNESS = 16;

function sectionIds(root: Section): Set<string> {
    const ids = new Set<string>();
    const visit = (section: Section): void => {
        ids.add(section.id);
        for (const child of section.children) visit(child.section);
    };
    visit(root);
    return ids;
}

/** `furniture.part_exceeds_sheet` for every generated or extra part but backs and glass. */
function sheetFitIssues(ctx: GenContext): void {
    const trim = ctx.idx.snapshot.pricing.sheetTrimMm;
    const parts = [...ctx.parts].sort((a, b) => cmpId(a.key, b.key));
    for (const part of parts) {
        // Backs are split to fit, or reported as part_exceeds_sheet_back.
        if (part.role === 'back' && part.source === 'generated') continue;
        const material =
            ctx.idx.material(part.materialCode) ?? ctx.mat(part.role);
        if (material.boardType === 'glass') continue;
        if (fitsSheet(part.length, part.width, material, part.grain, trim)) {
            continue;
        }
        ctx.issue(
            'furniture.part_exceeds_sheet',
            'error',
            {
                partKey: part.key,
                length: part.length,
                width: part.width,
                sheetLength: material.sheetLengthMm,
                sheetWidth: material.sheetWidthMm,
                materialCode: material.code,
            },
            [part.key],
        );
    }
}

/** Error `furniture.too_many_parts` `{ count }`: more than 400 parts, qty counted. */
function partCountIssue(ctx: GenContext): void {
    const count = ctx.parts.reduce((total, p) => total + p.qty, 0);
    if (count > MAX_PARTS)
        ctx.issue('furniture.too_many_parts', 'error', { count });
}

/** Warning `furniture.loft_no_access`: a loft where no front covers any section. */
function loftIssue(doc: FurnitureDocument, ctx: GenContext): void {
    const carcass = doc.carcass;
    if (carcass?.mounting !== 'loft') return;
    const ids = sectionIds(carcass.interior);
    if (!carcass.fronts.some((f) => f.covers.some((id) => ids.has(id)))) {
        ctx.issue('furniture.loft_no_access', 'warning');
    }
}

/** The thickness guidance of 07 §1.4, once for the whole design. */
function thicknessIssues(doc: FurnitureDocument, ctx: GenContext): void {
    const hasRole = (role: string): boolean =>
        ctx.parts.some((p) => p.role === role);
    if (
        (doc.family === 'carcass' || hasRole('carcass')) &&
        ctx.t('carcass') < MIN_CARCASS_THICKNESS
    ) {
        ctx.issue('furniture.thin_carcass', 'warning');
    }
    if (
        doc.carcass?.back.type === 'grooved' &&
        ctx.t('back') > MAX_GROOVED_BACK_THICKNESS
    ) {
        ctx.issue('furniture.back_too_thick_for_groove', 'warning');
    }
    if (
        ctx.parts.some(
            (p) =>
                p.role === 'drawer_bottom' &&
                p.thickness > MAX_DRAWER_BOTTOM_THICKNESS,
        )
    ) {
        ctx.issue('furniture.drawer_bottom_thick', 'warning');
    }
    if (
        ctx.parts.some(
            (p) =>
                p.role === 'drawer_box' &&
                (p.thickness < MIN_DRAWER_BOX_THICKNESS ||
                    p.thickness > MAX_DRAWER_BOX_THICKNESS),
        )
    ) {
        ctx.issue('furniture.drawer_box_thickness', 'info');
    }
}

/** Step 6 of `generateFurniture`: the model-level rules of 07 §7.3. */
export function modelRules(ctx: GenContext): void {
    shelfSagIssues(ctx);
    sheetFitIssues(ctx);
    partCountIssue(ctx);
    loftIssue(ctx.doc, ctx);
    thicknessIssues(ctx.doc, ctx);
}
