/**
 * Test-only driver for the carcass generators of Tasks 32-33, in the order of
 * the pipeline (07 §3.1 step 3): envelope, panels, layout and dividers,
 * contents per leaf in pre-order, back, plinth, countertop.
 */
import type { CatalogSnapshot } from '../../catalog/snapshot';
import { seedCatalog } from '../../testing/seedCatalog';
import { backPanels } from '../carcass/back';
import { basketsFor, rodFor, shelvesFor } from '../carcass/contents';
import { countertopPart } from '../carcass/countertop';
import { computeEnvelope, type Envelope } from '../carcass/envelope';
import {
    dividerParts,
    layoutFromEnvelope,
    type SectionLayout,
} from '../carcass/layout';
import { carcassPanels } from '../carcass/panels';
import { plinthParts } from '../carcass/plinth';
import { createGenContext } from '../context';
import type { Content, FurnitureDocument, Section } from '../schema';
import type { GenContext, Part } from '../types';

export interface CarcassRun {
    ctx: GenContext;
    env: Envelope;
    layout: SectionLayout;
}

/** Runs the carcass generators; throws when the envelope is too small. */
export function runCarcass(
    doc: FurnitureDocument,
    catalog: CatalogSnapshot = seedCatalog(),
): CarcassRun {
    const ctx = createGenContext(doc, catalog);
    const env = computeEnvelope(ctx);
    if (!env) throw new Error('no envelope');
    carcassPanels(ctx, env);
    const layout = layoutFromEnvelope(ctx, env);
    dividerParts(ctx, layout);
    for (const id of layout.preorder) {
        const info = layout.byId.get(id);
        const content = findContent(doc, id);
        if (!info?.leaf || !content) continue;
        if (content.type === 'shelves') shelvesFor(ctx, info, content);
        else if (content.type === 'hanging_rod') rodFor(ctx, info, content);
        else if (content.type === 'pull_out_basket') {
            basketsFor(ctx, info, content);
        }
    }
    backPanels(ctx, env, layout);
    plinthParts(ctx, env);
    countertopPart(ctx, env);
    return { ctx, env, layout };
}

/** Content of section `id`; `undefined` when the section does not exist. */
function findContent(
    doc: FurnitureDocument,
    id: string,
): Content | null | undefined {
    const visit = (s: Section): Content | null | undefined => {
        if (s.id === id) return s.content;
        for (const child of s.children) {
            const found = visit(child.section);
            if (found !== undefined) return found;
        }
        return undefined;
    };
    return doc.carcass ? visit(doc.carcass.interior) : undefined;
}

export const partOf = (ctx: GenContext, key: string): Part => {
    const found = ctx.parts.find((p) => p.key === key);
    if (!found) throw new Error(`no part ${key}`);
    return found;
};

export const boxOfPart = (p: Part) =>
    p.geometry.kind === 'box' ? p.geometry.box : null;
