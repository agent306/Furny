/**
 * Code check (07 §3.1 step 2): every catalog code a furniture document
 * references, and the issues for those the catalog does not know (error
 * `furniture.unknown_code`) or has archived (warning `furniture.archived_code`).
 *
 * Two kinds of reference are checked that no field names directly:
 *   - the default edge band of a role's material (`defaultEdgeBandCode`),
 *     which banded parts use when the role has no explicit band (07 §5.1);
 *   - an explicit `slideCode` that names a catalog item that is not a drawer
 *     slide: the slide selection ignores it, so it is reported as an
 *     unknown hardware code too (07 §3.12).
 *
 * Generation goes on regardless: an unknown material is replaced by the role
 * default for generation only (`GenContext.mat`), unknown hardware codes are
 * kept on their lines.
 */
import { cmpId } from '../compare';
import type { Issue } from '../plan/types';
import type { CatalogIndex } from './catalogIndex';
import { furnitureIssue } from './context';
import {
    EDGE_IDS,
    MATERIAL_ROLES,
    type Content,
    type EdgeId,
    type FurnitureDocument,
    type MaterialRole,
    type Section,
} from './schema';

export type CodeKind = 'material' | 'edge_band' | 'finish' | 'hardware';

export interface CodeRef {
    code: string;
    kind: CodeKind;
}

/** Values that stand for "no code" or a rule-selected code, not for a catalog row. */
const PLACEHOLDERS = new Set(['inherit', 'auto']);

/** Hardware codes named by a section content. */
function contentCodes(content: Content | null): Array<string | null> {
    switch (content?.type) {
        case 'drawers':
            return [content.slideCode];
        case 'hanging_rod':
            return [content.rodCode];
        case 'pull_out_basket':
            return [content.basketCode];
        default:
            return [];
    }
}

function sectionContents(section: Section): Array<Content | null> {
    return [
        section.content,
        ...section.children.flatMap((c) => sectionContents(c.section)),
    ];
}

/** Explicit slide codes of the drawers in the document, in document order. */
function slideCodes(doc: FurnitureDocument): string[] {
    const table = doc.table;
    const contents: Array<Content | null> = [
        ...(doc.carcass ? sectionContents(doc.carcass.interior) : []),
        ...(table ? [table.storage.endCabinets?.content ?? null] : []),
    ];
    return [
        table?.storage.drawers?.slideCode ?? null,
        ...contents.map((c) => (c?.type === 'drawers' ? c.slideCode : null)),
    ].filter((code): code is string => code !== null);
}

const edgeCodes = (
    edges: Partial<Record<EdgeId, string | null>>,
): Array<string | null> => EDGE_IDS.map((id) => edges[id] ?? null);

/**
 * Every catalog code the document references, each `kind` + `code` once, in
 * document order: material assignments (by role), carcass (plinth legs,
 * handles, fronts, section contents in pre-order), table, then overrides
 * (part overrides by key, extra parts, hardware overrides by key, extra
 * hardware). `'inherit'`, `'auto'` and null are not codes.
 */
export function referencedCodes(doc: FurnitureDocument): CodeRef[] {
    const out: CodeRef[] = [];
    const seen = new Set<string>();
    const add = (kind: CodeKind, code: string | null | undefined): void => {
        if (code === null || code === undefined || PLACEHOLDERS.has(code)) {
            return;
        }
        const id = `${kind}\u0000${code}`;
        if (seen.has(id)) return;
        seen.add(id);
        out.push({ code, kind });
    };
    const addAll = (kind: CodeKind, codes: Array<string | null>): void => {
        for (const code of codes) add(kind, code);
    };

    for (const role of MATERIAL_ROLES) {
        const assignment = doc.materials[role];
        add('material', assignment.materialCode);
        add('edge_band', assignment.edgeBandCode);
        add('finish', assignment.finishCode);
    }

    const carcass = doc.carcass;
    if (carcass) {
        add('hardware', carcass.plinth.legCode);
        add('hardware', carcass.handles.code);
        for (const front of carcass.fronts) {
            add('hardware', front.handleCode);
            add('hardware', front.hingeCode);
            add('hardware', front.slidingTrackCode);
        }
        for (const content of sectionContents(carcass.interior)) {
            addAll('hardware', contentCodes(content));
        }
    }

    const table = doc.table;
    if (table) {
        add('hardware', table.base.legCode);
        add('hardware', table.storage.drawers?.slideCode);
        addAll(
            'hardware',
            contentCodes(table.storage.endCabinets?.content ?? null),
        );
    }

    const { overrides } = doc;
    for (const key of Object.keys(overrides.parts).sort(cmpId)) {
        const override = overrides.parts[key];
        add('material', override?.materialCode);
        addAll('edge_band', edgeCodes(override?.edges ?? {}));
    }
    for (const extra of overrides.extraParts) {
        add('material', extra.materialCode);
        addAll('edge_band', edgeCodes(extra.edges));
    }
    for (const key of Object.keys(overrides.hardware).sort(cmpId)) {
        add('hardware', overrides.hardware[key]?.code);
    }
    for (const extra of overrides.extraHardware) add('hardware', extra.code);
    return out;
}

function lookup(
    idx: CatalogIndex,
    ref: CodeRef,
): { isActive: boolean } | undefined {
    switch (ref.kind) {
        case 'material':
            return idx.material(ref.code);
        case 'edge_band':
            return idx.edgeBand(ref.code);
        case 'finish':
            return idx.finish(ref.code);
        case 'hardware':
            return idx.hardware(ref.code);
    }
}

/**
 * Default edge band codes the document's roles fall back on (07 §5.1): the
 * `defaultEdgeBandCode` of the material of each role in `roles` without an
 * explicit band, where an unknown material counts as its role default, as in
 * generation. In role order, each code once.
 */
function derivedEdgeBands(
    doc: FurnitureDocument,
    idx: CatalogIndex,
    roles: ReadonlySet<MaterialRole> | undefined,
): string[] {
    const codes: string[] = [];
    for (const role of MATERIAL_ROLES) {
        if (roles && !roles.has(role)) continue;
        const assignment = doc.materials[role];
        if (assignment.edgeBandCode !== null) continue;
        const material =
            idx.material(assignment.materialCode) ??
            idx.defaultMaterialFor(role);
        const code = material?.defaultEdgeBandCode;
        if (code && !codes.includes(code)) codes.push(code);
    }
    return codes;
}

/** Options of `codeIssues`. */
export interface CodeIssueOptions {
    /**
     * Roles whose default edge band is checked (the roles of the generated
     * parts: a band no part can use is not reported). Default: every role.
     */
    bandRoles?: ReadonlySet<MaterialRole>;
}

/**
 * `furniture.unknown_code` (error, `{ code, kind }`) for every referenced
 * code missing from the catalog and `furniture.archived_code` (warning,
 * `{ code }`) for every inactive one, in `referencedCodes` order; then the
 * same for default edge bands (of `options.bandRoles`) no explicit reference
 * names, and `unknown_code` (kind `hardware`) for each explicit slide code
 * that is a catalog item but no drawer slide. Each code is reported once.
 * Pure.
 */
export function codeIssues(
    doc: FurnitureDocument,
    idx: CatalogIndex,
    options: CodeIssueOptions = {},
): Issue[] {
    const issues: Issue[] = [];
    const refs = referencedCodes(doc);
    const report = (ref: CodeRef): void => {
        const row = lookup(idx, ref);
        if (!row) {
            issues.push(
                furnitureIssue('furniture.unknown_code', 'error', {
                    code: ref.code,
                    kind: ref.kind,
                }),
            );
        } else if (!row.isActive) {
            issues.push(
                furnitureIssue('furniture.archived_code', 'warning', {
                    code: ref.code,
                }),
            );
        }
    };

    for (const ref of refs) report(ref);

    const named = new Set(
        refs.filter((r) => r.kind === 'edge_band').map((r) => r.code),
    );
    for (const code of derivedEdgeBands(doc, idx, options.bandRoles)) {
        if (!named.has(code)) report({ code, kind: 'edge_band' });
    }

    // Unknown slide codes were reported above; this is the wrong-kind case.
    const misused = new Set<string>();
    for (const code of slideCodes(doc)) {
        const row = idx.hardware(code);
        if (!row || row.category === 'drawer_slide' || misused.has(code)) {
            continue;
        }
        misused.add(code);
        issues.push(
            furnitureIssue('furniture.unknown_code', 'error', {
                code,
                kind: 'hardware',
            }),
        );
    }
    return issues;
}
