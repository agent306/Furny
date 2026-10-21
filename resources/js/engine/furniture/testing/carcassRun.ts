/**
 * Test-only driver for the carcass, front and drawer generators of Tasks 32-35,
 * in the order of the pipeline (07 §3.1 step 3): envelope, panels, layout and
 * dividers, openings and front leaves (only with `fronts: true`), contents per
 * leaf in pre-order (drawers only with `drawers: true`), back, plinth,
 * countertop.
 */
import type { CatalogSnapshot } from '../../catalog/snapshot';
import { seedCatalog } from '../../testing/seedCatalog';
import { backPanels } from '../carcass/back';
import { basketsFor, rodFor, shelvesFor } from '../carcass/contents';
import { countertopPart } from '../carcass/countertop';
import { drawersFor } from '../carcass/drawers';
import { computeEnvelope, type Envelope } from '../carcass/envelope';
import {
    dividerParts,
    layoutFromEnvelope,
    type SectionLayout,
} from '../carcass/layout';
import { carcassPanels } from '../carcass/panels';
import { plinthParts } from '../carcass/plinth';
import { createGenContext } from '../context';
import { frontParts } from '../fronts/fronts';
import type { OpeningRect } from '../fronts/openings';
import type { Content, FurnitureDocument, Section } from '../schema';
import type { GenContext, Part } from '../types';

export interface CarcassRun {
    ctx: GenContext;
    env: Envelope;
    layout: SectionLayout;
    /** Openings by front / drawer-leaf id; empty unless the fronts ran. */
    openings: Map<string, OpeningRect>;
}

/**
 * Runs the carcass generators, and the front generators too with
 * `fronts: true`; throws when the envelope is too small.
 */
export function runCarcass(
    doc: FurnitureDocument,
    catalog: CatalogSnapshot = seedCatalog(),
    options: { fronts?: boolean; drawers?: boolean } = {},
): CarcassRun {
    const ctx = createGenContext(doc, catalog);
    const env = computeEnvelope(ctx);
    if (!env) throw new Error('no envelope');
    carcassPanels(ctx, env);
    const layout = layoutFromEnvelope(ctx, env);
    dividerParts(ctx, layout);
    const openings = options.fronts
        ? frontParts(ctx, env, layout)
        : new Map<string, OpeningRect>();
    for (const id of layout.preorder) {
        const info = layout.byId.get(id);
        const content = findContent(doc, id);
        if (!info?.leaf || !content) continue;
        if (content.type === 'shelves') shelvesFor(ctx, info, content);
        else if (content.type === 'hanging_rod') rodFor(ctx, info, content);
        else if (content.type === 'pull_out_basket') {
            basketsFor(ctx, info, content);
        } else if (content.type === 'drawers' && options.drawers) {
            drawersFor(ctx, env, layout, info, content);
        }
    }
    backPanels(ctx, env, layout);
    plinthParts(ctx, env);
    countertopPart(ctx, env);
    return { ctx, env, layout, openings };
}

/** `runCarcass` with the fronts. */
export const runWithFronts = (
    doc: FurnitureDocument,
    catalog: CatalogSnapshot = seedCatalog(),
): CarcassRun => runCarcass(doc, catalog, { fronts: true });

/** `runCarcass` with the fronts and the drawers. */
export const runWithDrawers = (
    doc: FurnitureDocument,
    catalog: CatalogSnapshot = seedCatalog(),
): CarcassRun => runCarcass(doc, catalog, { fronts: true, drawers: true });

export const hardwareOf = (ctx: GenContext, key: string) =>
    ctx.hardware.find((h) => h.key === key);

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
