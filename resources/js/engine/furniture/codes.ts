/**
 * Code check (07 §3.1 step 2): every catalog code a furniture document
 * references, and the issues for those the catalog does not know (error
 * `furniture.unknown_code`) or has archived (warning `furniture.archived_code`).
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
 * `furniture.unknown_code` (error, `{ code, kind }`) for every referenced
 * code missing from the catalog and `furniture.archived_code` (warning,
 * `{ code }`) for every inactive one, in `referencedCodes` order. Pure.
 */
export function codeIssues(doc: FurnitureDocument, idx: CatalogIndex): Issue[] {
    const issues: Issue[] = [];
    for (const ref of referencedCodes(doc)) {
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
    }
    return issues;
}
