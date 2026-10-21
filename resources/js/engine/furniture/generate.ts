/**
 * `generateFurniture` (07 §3.1): the pipeline that turns a furniture document
 * into its model (parts, fronts, hardware, sections, issues). Pure,
 * synchronous and deterministic.
 */
import type { CatalogSnapshot } from '../catalog/snapshot';
import { cmpId } from '../compare';
import { budgetIssues } from './budget';
import { backPanels } from './carcass/back';
import { basketsFor, rodFor, shelvesFor } from './carcass/contents';
import { countertopPart } from './carcass/countertop';
import { drawersFor } from './carcass/drawers';
import { computeEnvelope, type Envelope } from './carcass/envelope';
import {
    dividerParts,
    layoutFromEnvelope,
    type SectionLayout,
} from './carcass/layout';
import { carcassPanels } from './carcass/panels';
import { plinthParts } from './carcass/plinth';
import { indexCatalog } from './catalogIndex';
import { codeIssues } from './codes';
import { createGenContext } from './context';
import { frontParts } from './fronts/fronts';
import { applyOverrides } from './overrides';
import { splitLongPanels } from './panelSplit';
import {
    cabinetLegs,
    mountingHardware,
    screwPacks,
} from './rules/carcassHardware';
import { connectorsForJoints } from './rules/connectors';
import { modelRules } from './rules/model';
import { leafWeightKg, roundKg } from './rules/weight';
import type {
    Content,
    FurnitureDocument,
    MaterialRole,
    Section,
} from './schema';
import { tableParts } from './table/generateTable';
import type { FurnitureModel, GenContext, ModelFront } from './types';

/** The content of every section of `root`, by id. */
function contentsById(root: Section): Map<string, Content | null> {
    const out = new Map<string, Content | null>();
    const visit = (section: Section): void => {
        out.set(section.id, section.content);
        for (const child of section.children) visit(child.section);
    };
    visit(root);
    return out;
}

/** Step 3.5: the contents of every leaf, leaves in pre-order. */
function leafContents(
    ctx: GenContext,
    env: Envelope,
    layout: SectionLayout,
    root: Section,
): void {
    const contents = contentsById(root);
    for (const id of layout.preorder) {
        const info = layout.byId.get(id);
        const content = contents.get(id);
        if (!info?.leaf || !content) continue;
        switch (content.type) {
            case 'shelves':
                shelvesFor(ctx, info, content);
                break;
            case 'hanging_rod':
                rodFor(ctx, info, content);
                break;
            case 'pull_out_basket':
                basketsFor(ctx, info, content);
                break;
            case 'drawers':
                drawersFor(ctx, env, layout, info, content);
                break;
            case 'empty':
                break;
        }
    }
}

/**
 * Step 3, carcass family. Stops after the envelope when it is too small
 * (`furniture.envelope_too_small`, no parts) and then returns false.
 */
function generateCarcass(ctx: GenContext, root: Section): boolean {
    const env = computeEnvelope(ctx);
    if (!env) return false;
    carcassPanels(ctx, env);
    const layout = layoutFromEnvelope(ctx, env);
    dividerParts(ctx, layout);
    frontParts(ctx, env, layout);
    leafContents(ctx, env, layout, root);
    backPanels(ctx, env, layout);
    plinthParts(ctx, env);
    countertopPart(ctx, env);
    cabinetLegs(ctx, env);
    mountingHardware(ctx, env);
    splitLongPanels(ctx);
    connectorsForJoints(ctx, 'carcass');
    screwPacks(ctx, 'carcass');
    return true;
}

/** Info `furniture.weight_estimate`: all parts x qty, 1 decimal (07 §6.1). */
function weightEstimate(ctx: GenContext): void {
    ctx.issue('furniture.weight_estimate', 'info', {
        kg: roundKg(leafWeightKg(ctx.parts, ctx.idx)),
    });
}

const byFrontPosition = (a: ModelFront, b: ModelFront): number =>
    a.rect.x - b.rect.x || b.rect.y - a.rect.y || cmpId(a.id, b.id);

/**
 * The model of `doc` against `catalog` (07 §3.1). Never throws on document
 * content: problems become issues. The document must be schema-valid
 * (callers parse it with zod first).
 */
export function generateFurniture(
    doc: FurnitureDocument,
    catalog: CatalogSnapshot,
): FurnitureModel {
    // 0. Work budget: a document that cannot be saved is not generated.
    const over = budgetIssues(doc);
    if (over.length > 0) {
        const { width, height, depth } = doc.dims;
        return {
            parts: [],
            hardware: [],
            fronts: [],
            sections: [],
            bbox: { min: [0, 0, 0], size: [width, height, depth] },
            issues: over,
        };
    }
    // 1. Context.
    const idx = indexCatalog(catalog);
    const ctx = createGenContext(doc, idx);
    // 3. Carcass family, 4. table family (a family without its spec is
    // reported by validateFurniture and generates nothing).
    const generated =
        doc.family === 'carcass'
            ? doc.carcass !== null && generateCarcass(ctx, doc.carcass.interior)
            : tableParts(ctx);
    // 2. Code check, listed first. Pure, so it runs once the parts are known:
    // a role's default edge band is checked only when some part has the
    // role. Unknown materials fall back to the role default in `ctx.mat`.
    const bandRoles = new Set<MaterialRole>(ctx.parts.map((p) => p.role));
    ctx.issues.unshift(...codeIssues(doc, idx, { bandRoles }));
    // 5. Overrides; without a model they would all be orphaned, so not reported.
    applyOverrides(ctx, { reportOrphans: generated });
    // 6. Model-level rules.
    weightEstimate(ctx);
    modelRules(ctx);
    // 7. Order and bounding box.
    const { width, height, depth } = doc.dims;
    return {
        parts: [...ctx.parts].sort((a, b) => cmpId(a.key, b.key)),
        hardware: [...ctx.hardware].sort((a, b) => cmpId(a.key, b.key)),
        fronts: [...ctx.fronts].sort(byFrontPosition),
        sections: ctx.sections,
        bbox: { min: [0, 0, 0], size: [width, height, depth] },
        issues: ctx.issues,
    };
}
