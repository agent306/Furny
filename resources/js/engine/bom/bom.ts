/**
 * `computeBom` (08 §3): the bill of materials of a furniture model — cut list
 * rows, materials and sheet estimates, edge banding, finishing, operations
 * and hardware. Pure and deterministic; nesting (§3.9) arrives with Task 43.
 */
import { MATERIAL_ROLES, type CatalogSnapshot } from '../catalog/snapshot';
import { cmpId } from '../compare';
import { indexCatalog } from '../furniture/catalogIndex';
import { partNameEn } from '../furniture/partNames';
import type { FurnitureDocument } from '../furniture/schema';
import type { FurnitureModel, Part } from '../furniture/types';
import type { Issue } from '../plan/types';
import { ENGINE_VERSION } from '../version';
import { cutSize } from './cutSizes';
import { edgeBandLengths } from './edgeBanding';
import { ceilDivBig, product, toSafeNumber } from './intMath';
import { rowIdentity, rowKeyOfIdentity } from './rowKey';
import type {
    Bom,
    BomMaterial,
    BomOperations,
    ComputeBomOptions,
    CutListRow,
} from './types';

/** Row names list at most this many unique part names, then `+{n} more`. */
const MAX_ROW_NAMES = 3;

const OPERATION_KEYS = [
    'hingeCups',
    'shelfPinHoles',
    'dowels',
    'camLocks',
    'slideScrewSets',
    'handleHoles',
] as const satisfies ReadonlyArray<keyof BomOperations>;

/** Options from the document: the finish code of every material role. */
export function bomOptionsFor(
    doc: FurnitureDocument,
    nesting: boolean,
): ComputeBomOptions {
    const finishByRole = Object.fromEntries(
        MATERIAL_ROLES.map((role) => [role, doc.materials[role].finishCode]),
    ) as ComputeBomOptions['finishByRole'];
    return { nesting, finishByRole };
}

/** Groups `items` by `key`, keeping first-seen order inside each group. */
function groupBy<T>(items: readonly T[], key: (item: T) => string) {
    const groups = new Map<string, T[]>();
    for (const item of items) {
        const k = key(item);
        const group = groups.get(k);
        if (group) group.push(item);
        else groups.set(k, [item]);
    }
    return groups;
}

/**
 * Row key per identity: `r` + 8 hex digits of FNV-1a; when different
 * identities share a hash, the ones sorting later get `-2`, `-3`, ….
 */
function rowKeysFor(identities: readonly string[]): Map<string, string> {
    const byHash = groupBy([...identities].sort(cmpId), rowKeyOfIdentity);
    const out = new Map<string, string>();
    for (const [key, group] of byHash) {
        group.forEach((identity, i) => {
            out.set(identity, i === 0 ? key : `${key}-${i + 1}`);
        });
    }
    return out;
}

/** Unique English names in key order; beyond three, `+{n} more`. */
function rowName(parts: readonly Part[]): string {
    const names = [
        ...new Set(parts.map((p) => partNameEn(p.nameKey, p.nameParams))),
    ];
    const shown = names.slice(0, MAX_ROW_NAMES).join(' / ');
    const more = names.length - MAX_ROW_NAMES;
    return more > 0 ? `${shown} +${more} more` : shown;
}

function compareRows(a: CutListRow, b: CutListRow): number {
    return (
        cmpId(a.materialCode, b.materialCode) ||
        b.thickness - a.thickness ||
        b.length - a.length ||
        b.width - a.width ||
        cmpId(a.rowKey, b.rowKey)
    );
}

/** 08 §3.4: identical parts merged into rows, in saw order. */
function cutListRows(
    parts: readonly Part[],
    catalog: CatalogSnapshot,
): CutListRow[] {
    const sorted = [...parts].sort((a, b) => cmpId(a.key, b.key));
    const groups = groupBy(sorted, rowIdentity);
    const keys = rowKeysFor([...groups.keys()]);
    const rows: CutListRow[] = [];
    for (const [identity, group] of groups) {
        const first = group[0]!;
        rows.push({
            rowKey: keys.get(identity)!,
            partKeys: [...new Set(group.map((p) => p.key))],
            name: rowName(group),
            nameKey: first.nameKey,
            nameParams: { ...first.nameParams },
            materialCode: first.materialCode,
            thickness: first.thickness,
            length: first.length,
            width: first.width,
            ...cutSize(first, catalog, catalog.pricing.edgePremillMm),
            qty: group.reduce((sum, p) => sum + p.qty, 0),
            grain: first.grain,
            edges: { ...first.edges },
        });
    }
    return rows.sort(compareRows);
}

/** 08 §3.5 without nesting: net area and the sheet estimate per material. */
function materialTotals(
    parts: readonly Part[],
    catalog: CatalogSnapshot,
): BomMaterial[] {
    const idx = indexCatalog(catalog);
    const groups = groupBy(parts, (p) => p.materialCode);
    return [...groups.keys()].sort(cmpId).map((code) => {
        const group = groups.get(code)!;
        const netArea = group.reduce(
            (sum, p) => sum + product(p.length, p.width, p.qty),
            0n,
        );
        // An unknown material (already `furniture.unknown_code`) has no sheet.
        const material = idx.material(code);
        const sheetsEstimated = material
            ? ceilDivBig(
                  netArea *
                      product(1000 + Math.round(material.wasteFactor * 1000)),
                  product(material.sheetLengthMm, material.sheetWidthMm, 1000),
              )
            : 0;
        return {
            materialCode: code,
            partCount: group.reduce((sum, p) => sum + p.qty, 0),
            netAreaMm2: toSafeNumber(netArea),
            sheetsEstimated,
            sheetsNested: null,
            sheetsBilled: sheetsEstimated,
            utilization: null,
        };
    });
}

/** 08 §3.6: visible face area per finish code. */
function finishingTotals(
    parts: readonly Part[],
    finishByRole: ComputeBomOptions['finishByRole'],
): Bom['finishing'] {
    const areas = new Map<string, bigint>();
    for (const part of parts) {
        const code = finishByRole[part.role];
        if (!code || part.visibleFaces <= 0) continue;
        const area = product(
            part.length,
            part.width,
            part.visibleFaces,
            part.qty,
        );
        areas.set(code, (areas.get(code) ?? 0n) + area);
    }
    return [...areas.keys()]
        .sort(cmpId)
        .map((code) => ({
            finishCode: code,
            areaMm2: toSafeNumber(areas.get(code)!),
        }))
        .filter((row) => row.areaMm2 > 0);
}

/** 08 §3.7. */
function operationTotals(parts: readonly Part[]): BomOperations {
    const out = Object.fromEntries(
        OPERATION_KEYS.map((k) => [k, 0]),
    ) as unknown as BomOperations;
    for (const part of parts) {
        for (const k of OPERATION_KEYS) {
            out[k] += part.operations[k] * part.qty;
        }
    }
    return out;
}

/** 08 §3.8: merged by code, lines with qty ≤ 0 dropped, code asc. */
function hardwareTotals(model: FurnitureModel): Bom['hardware'] {
    const qty = new Map<string, number>();
    for (const line of model.hardware) {
        qty.set(line.code, (qty.get(line.code) ?? 0) + line.qty);
    }
    return [...qty.keys()]
        .sort(cmpId)
        .map((code) => ({ code, qty: qty.get(code)! }))
        .filter((line) => line.qty > 0);
}

const issueIdentity = (issue: Issue): string =>
    JSON.stringify([issue.code, issue.entityIds]);

/**
 * 08 §3.9: the model issues, then the BOM issues that are not already listed
 * (same `code` and `entityIds`).
 */
export function mergeIssues(
    modelIssues: readonly Issue[],
    bomIssues: readonly Issue[],
): Issue[] {
    const seen = new Set(modelIssues.map(issueIdentity));
    const out = [...modelIssues];
    for (const issue of bomIssues) {
        const id = issueIdentity(issue);
        if (seen.has(id)) continue;
        seen.add(id);
        out.push(issue);
    }
    return out;
}

/** The bill of materials of `model` against `catalog` (08 §3). */
export function computeBom(
    model: FurnitureModel,
    catalog: CatalogSnapshot,
    options: ComputeBomOptions,
): Bom {
    if (options.nesting) throw new Error('nesting not implemented');
    const { parts } = model;
    return {
        engineVersion: ENGINE_VERSION,
        catalogVersion: catalog.version,
        cutList: cutListRows(parts, catalog),
        materials: materialTotals(parts, catalog),
        edgeBanding: edgeBandLengths(parts, catalog),
        hardware: hardwareTotals(model),
        finishing: finishingTotals(parts, options.finishByRole),
        operations: operationTotals(parts),
        nesting: null,
        issues: mergeIssues(model.issues, []),
    };
}
