/**
 * Generation context (07 §3.1): the mutable state one `generateFurniture` run
 * threads through the carcass, front, table and hardware generators.
 */
import type { CatalogMaterial, CatalogSnapshot } from '../catalog/snapshot';
import { EngineInputError } from '../errors';
import type { Issue } from '../plan/types';
import { indexCatalog, type CatalogIndex } from './catalogIndex';
import type { FurnitureDocument } from './schema';
import type { GenContext } from './types';

/** Furniture issues are `furniture.<name>`; the key drops the domain prefix, like the plan ones. */
const ISSUE_KEY_PREFIX = 'engine.furniture.issue.';

/**
 * A furniture issue (03 §3.1) with its `messageKey` derived from `code`;
 * for pure checks that run without a generation context.
 */
export function furnitureIssue(
    code: string,
    severity: Issue['severity'],
    params: Issue['params'] = {},
    entityIds: string[] = [],
): Issue {
    return {
        code,
        severity,
        messageKey: ISSUE_KEY_PREFIX + code.replace(/^furniture\./, ''),
        params,
        entityIds,
    };
}

const isIndex = (c: CatalogSnapshot | CatalogIndex): c is CatalogIndex =>
    'snapshot' in c && typeof (c as CatalogIndex).material === 'function';

/**
 * Fresh context for one generation run. `catalog` is the snapshot (indexed and
 * memoised here) or an index already built from it.
 */
export function createGenContext(
    doc: FurnitureDocument,
    catalog: CatalogSnapshot | CatalogIndex,
): GenContext {
    const idx = isIndex(catalog) ? catalog : indexCatalog(catalog);

    const ctx: GenContext = {
        doc,
        idx,
        parts: [],
        hardware: [],
        fronts: [],
        sections: [],
        issues: [],
        edgeMap: new Map(),
        joints: [],
        mat(role): CatalogMaterial {
            const found =
                idx.material(doc.materials[role].materialCode) ??
                idx.defaultMaterialFor(role);
            if (!found) {
                throw new EngineInputError(
                    'invalid_input',
                    `Catalog has no usable material for role "${role}"`,
                    { role },
                );
            }
            return found;
        },
        t: (role) => Math.round(ctx.mat(role).thicknessMm),
        roleBand: (role) =>
            doc.materials[role].edgeBandCode ??
            ctx.mat(role).defaultEdgeBandCode ??
            null,
        issue(code, severity, params = {}, entityIds = []): Issue {
            const issue = furnitureIssue(code, severity, params, entityIds);
            ctx.issues.push(issue);
            return issue;
        },
        addHardware(line) {
            ctx.hardware.push(line);
        },
    };
    return ctx;
}
