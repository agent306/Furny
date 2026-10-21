/**
 * `diffFurniture` (07 §10): the change list between two furniture documents,
 * for the proposal review. Both sides are generated, put through the BOM and
 * priced against the SAME catalog, so price differences are design changes
 * only. Pure and deterministic. Params are English where the spec says so
 * (07 §10.1 item 3): lengths end in `Mm`, money in `Minor`.
 */
import { bomOptionsFor, computeBom } from '../bom/bom';
import { priceBom } from '../bom/pricing';
import type { Bom } from '../bom/types';
import type { CatalogSnapshot, MaterialRole } from '../catalog/snapshot';
import { cmpId } from '../compare';
import { layoutSections, type SectionLabel } from './carcass/layout';
import { indexCatalog } from './catalogIndex';
import { generateFurniture } from './generate';
import { migrateFurniture } from './migrate';
import { partNameEn } from './partNames';
import {
    MATERIAL_ROLES,
    type Content,
    type Front,
    type FurnitureDocument,
    type Section,
} from './schema';
import type { Part } from './types';

/** In kind rank order (07 §10.3). */
export const CHANGE_KINDS = [
    'price_changed',
    'dims_changed',
    'material_changed',
    'construction_changed',
    'front_added',
    'front_removed',
    'front_changed',
    'section_changed',
    'content_changed',
    'part_added',
    'part_removed',
    'part_changed',
    'hardware_added',
    'hardware_removed',
    'hardware_qty_changed',
    'notes_changed',
] as const;
export type ChangeKind = (typeof CHANGE_KINDS)[number];

/** Every `messageKey` the diff emits (07 §10.2), for the translation coverage check. */
export const CHANGE_MESSAGE_KEYS = [
    'changes.price_changed',
    'changes.dims_changed',
    'changes.material_changed',
    'changes.edge_band_changed',
    'changes.finish_changed',
    'changes.construction_changed',
    'changes.section_layout',
    'changes.section_size',
    'changes.section_added',
    'changes.section_removed',
    'changes.content_changed',
    'changes.front_added',
    'changes.front_removed',
    'changes.front_changed',
    'changes.part_added',
    'changes.part_removed',
    'changes.part_changed',
    'changes.parts_added_many',
    'changes.parts_removed_many',
    'changes.parts_changed_many',
    'changes.hardware_added',
    'changes.hardware_removed',
    'changes.hardware_qty_changed',
    'changes.notes_changed',
] as const;

/** 03 §3.4. */
export interface ChangeItem {
    kind: ChangeKind;
    /** i18n key, e.g. `changes.hardware_added`. */
    messageKey: string;
    params: Record<string, string | number>;
    /** Section/front id, part key, hardware code, role or field path. */
    entityId: string | null;
    before: unknown;
    after: unknown;
    significance: 'major' | 'minor';
}

/** More part changes of one kind than this collapse into one item (07 §10.2). */
const MAX_LISTED_PARTS = 10;
const PRICE_MAJOR_PCT = 2;

const ROLE_NAMES_EN: Record<MaterialRole, string> = {
    carcass: 'Carcass',
    back: 'Back',
    shelf: 'Shelf',
    front: 'Front',
    top: 'Top',
    drawer_box: 'Drawer box',
    drawer_bottom: 'Drawer bottom',
    plinth: 'Plinth',
    leg: 'Leg',
};
const MAJOR_MATERIAL_ROLES = new Set<MaterialRole>([
    'carcass',
    'front',
    'top',
    'shelf',
    'plinth',
]);

const FRONT_KIND_EN: Record<Front['kind'], string> = {
    hinged: 'Door',
    sliding: 'Sliding door',
    flap_up: 'Flap up',
    flap_down: 'Flap down',
};
const FRONT_FIELDS_EN: Array<[keyof Front, string]> = [
    ['kind', 'kind'],
    ['covers', 'covers'],
    ['leaves', 'leaves'],
    ['hingeSide', 'hinge side'],
    ['overlay', 'overlay'],
    ['glass', 'glass'],
    ['handleCode', 'handle'],
    ['hingeCode', 'hinge'],
    ['slidingTrackCode', 'sliding track'],
];
const MAJOR_FRONT_FIELDS = new Set<keyof Front>(['kind', 'covers', 'glass']);

/** English labels of the construction paths (`changes.fields.{path}`). */
export const CHANGE_FIELD_LABELS_EN: Record<string, string> = {
    templateKey: 'Template',
    family: 'Family',
    'construction.top': 'Top construction',
    'construction.bottom': 'Bottom construction',
    mounting: 'Mounting',
    'plinth.type': 'Plinth type',
    'plinth.height': 'Plinth height',
    'plinth.setback': 'Plinth setback',
    'plinth.legCode': 'Plinth legs',
    'back.type': 'Back type',
    countertop: 'Countertop',
    'countertop.enabled': 'Countertop',
    'countertop.overhangFront': 'Countertop front overhang',
    'countertop.overhangLeft': 'Countertop left overhang',
    'countertop.overhangRight': 'Countertop right overhang',
    'handles.code': 'Handle',
    'handles.orientation': 'Handle orientation',
    'handles.placement': 'Handle placement',
    'table.top.shape': 'Top shape',
    'table.top.thickness': 'Top thickness',
    'table.top.cornerRadius': 'Top corner radius',
    'table.top.overhang': 'Top overhang',
    'table.base.type': 'Base type',
    'table.base.legSource': 'Leg source',
    'table.base.legCode': 'Legs',
    'table.base.legSection': 'Leg section',
    'table.base.apron.enabled': 'Apron',
    'table.base.apron.height': 'Apron height',
    'table.base.apron.inset': 'Apron inset',
    'table.base.stretcher': 'Stretcher',
    'table.storage.drawers': 'Table drawers',
    'table.storage.drawers.count': 'Table drawer count',
    'table.storage.drawers.side': 'Table drawer side',
    'table.storage.drawers.slideCode': 'Table drawer slides',
    'table.storage.lowerShelf': 'Lower shelf',
    'table.storage.endCabinets': 'End cabinets',
    'table.storage.endCabinets.width': 'End cabinet width',
};
const LENGTH_PATHS = new Set([
    'plinth.height',
    'plinth.setback',
    'countertop.overhangFront',
    'countertop.overhangLeft',
    'countertop.overhangRight',
    'table.top.thickness',
    'table.top.cornerRadius',
    'table.top.overhang',
    'table.base.legSection',
    'table.base.apron.height',
    'table.base.apron.inset',
    'table.storage.endCabinets.width',
]);
const MAJOR_PATHS = new Set([
    'mounting',
    'back.type',
    'plinth.type',
    'table.base.type',
    'table.top.shape',
    'templateKey',
]);

const isRecord = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && !Array.isArray(v);

/** Key-order independent deep equality for JSON values. */
function deepEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (Array.isArray(a) && Array.isArray(b)) {
        return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
    }
    if (isRecord(a) && isRecord(b)) {
        const keys = Object.keys(a);
        return (
            keys.length === Object.keys(b).length &&
            keys.every((k) => Object.hasOwn(b, k) && deepEqual(a[k], b[k]))
        );
    }
    return false;
}

function item(
    kind: ChangeKind,
    messageKey: string,
    params: ChangeItem['params'],
    entityId: string | null,
    before: unknown,
    after: unknown,
    significance: ChangeItem['significance'],
): ChangeItem {
    return {
        kind,
        messageKey,
        params,
        entityId,
        before: before ?? null,
        after: after ?? null,
        significance,
    };
}

// --- Section labels ---------------------------------------------------------

/** `Column 2 › Row 1`; the root's "Interior" only stands alone (07 §3.7). */
function labelText(label: SectionLabel): string {
    const names: string[] = [];
    for (let l: SectionLabel | null = label; l; l = l.parentLabel) {
        if (l.key === 'sections.interior') {
            if (names.length === 0) names.push('Interior');
        } else {
            names.unshift(
                `${l.key === 'sections.column' ? 'Column' : 'Row'} ${l.params.n ?? ''}`.trim(),
            );
        }
    }
    return names.join(' › ');
}

/** Section id → English label; empty for table documents. */
function sectionLabels(
    doc: FurnitureDocument,
    catalog: CatalogSnapshot,
): Map<string, string> {
    const out = new Map<string, string>();
    if (!doc.carcass) return out;
    for (const [id, info] of layoutSections(doc, catalog).byId) {
        out.set(id, labelText(info.label));
    }
    return out;
}

interface SectionNode {
    section: Section;
    parentId: string | null;
}

function sectionNodes(root: Section): Map<string, SectionNode> {
    const out = new Map<string, SectionNode>();
    const visit = (section: Section, parentId: string | null): void => {
        out.set(section.id, { section, parentId });
        for (const child of section.children) visit(child.section, section.id);
    };
    visit(root, null);
    return out;
}

const sectionJson = (s: Section) => ({
    id: s.id,
    split: s.split,
    content: s.content,
});

const isLeaf = (s: Section): boolean =>
    s.split === 'none' || s.children.length === 0;

function contentSummary(content: Content | null): string {
    switch (content?.type) {
        case 'shelves':
            return `${content.count} ${content.adjustable ? 'adjustable shelves' : 'shelves'}`;
        case 'drawers':
            return `${content.count} drawers`;
        case 'hanging_rod':
            return 'hanging rod';
        case 'pull_out_basket':
            return `${content.count} pull-out baskets`;
        default:
            return 'empty';
    }
}

// --- Rule groups ------------------------------------------------------------

function priceChange(before: number, after: number): ChangeItem[] {
    if (before === after) return [];
    const delta = Math.abs(after - before);
    const base = Math.max(1, before);
    return [
        item(
            'price_changed',
            'changes.price_changed',
            {
                beforeMinor: before,
                afterMinor: after,
                deltaMinor: delta,
                // one decimal, integer arithmetic
                deltaPct: Math.round((delta * 1000) / base) / 10,
                direction: after > before ? 'up' : 'down',
            },
            null,
            before,
            after,
            delta * 100 > base * PRICE_MAJOR_PCT ? 'major' : 'minor',
        ),
    ];
}

function dimsChanges(a: FurnitureDocument, b: FurnitureDocument) {
    return (['width', 'height', 'depth'] as const).flatMap((dimension) =>
        a.dims[dimension] === b.dims[dimension]
            ? []
            : [
                  item(
                      'dims_changed',
                      'changes.dims_changed',
                      {
                          dimension,
                          beforeMm: a.dims[dimension],
                          afterMm: b.dims[dimension],
                      },
                      null,
                      a.dims[dimension],
                      b.dims[dimension],
                      'major',
                  ),
              ],
    );
}

function materialChanges(
    a: FurnitureDocument,
    b: FurnitureDocument,
    parts: Iterable<Part>,
    idx: ReturnType<typeof indexCatalog>,
): ChangeItem[] {
    const used = new Set<MaterialRole>();
    for (const p of parts) used.add(p.role);
    const out: ChangeItem[] = [];
    for (const role of MATERIAL_ROLES) {
        if (!used.has(role)) continue;
        const ma = a.materials[role];
        const mb = b.materials[role];
        const roleName = ROLE_NAMES_EN[role];
        if (ma.materialCode !== mb.materialCode) {
            const name = (code: string) => idx.material(code)?.name ?? code;
            out.push(
                item(
                    'material_changed',
                    'changes.material_changed',
                    {
                        role: roleName,
                        before: name(ma.materialCode),
                        after: name(mb.materialCode),
                    },
                    role,
                    ma.materialCode,
                    mb.materialCode,
                    MAJOR_MATERIAL_ROLES.has(role) ? 'major' : 'minor',
                ),
            );
        }
        if (ma.edgeBandCode !== mb.edgeBandCode) {
            const name = (code: string | null) =>
                code === null ? 'Default' : (idx.edgeBand(code)?.name ?? code);
            out.push(
                item(
                    'material_changed',
                    'changes.edge_band_changed',
                    {
                        role: roleName,
                        before: name(ma.edgeBandCode),
                        after: name(mb.edgeBandCode),
                    },
                    role,
                    ma.edgeBandCode,
                    mb.edgeBandCode,
                    'minor',
                ),
            );
        }
        if (ma.finishCode !== mb.finishCode) {
            const name = (code: string | null) =>
                code === null ? 'None' : (idx.finish(code)?.name ?? code);
            out.push(
                item(
                    'material_changed',
                    'changes.finish_changed',
                    {
                        role: roleName,
                        before: name(ma.finishCode),
                        after: name(mb.finishCode),
                    },
                    role,
                    ma.finishCode,
                    mb.finishCode,
                    'major',
                ),
            );
        }
    }
    return out;
}

/** Leaf paths of a value; a null object field is a leaf, its subtree otherwise. */
function flatten(
    value: unknown,
    prefix: string,
    skip: (path: string) => boolean,
    leaves: Map<string, unknown>,
    objects: Map<string, unknown>,
): void {
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
        const path = prefix === '' ? key : `${prefix}.${key}`;
        if (skip(path)) continue;
        if (isRecord(v)) {
            objects.set(path, v);
            flatten(v, path, skip, leaves, objects);
        } else {
            leaves.set(path, v);
        }
    }
}

function constructionLeaves(doc: FurnitureDocument) {
    const leaves = new Map<string, unknown>([
        ['templateKey', doc.templateKey],
        ['family', doc.family],
    ]);
    const objects = new Map<string, unknown>();
    if (doc.carcass) {
        flatten(
            doc.carcass,
            '',
            (p) => p === 'interior' || p === 'fronts',
            leaves,
            objects,
        );
    }
    if (doc.table) {
        flatten(
            doc.table,
            'table',
            (p) => p === 'table.storage.endCabinets.content',
            leaves,
            objects,
        );
    }
    return { leaves, objects };
}

const show = (v: unknown): string =>
    v === null || v === undefined ? 'None' : String(v);

function constructionChanges(
    a: FurnitureDocument,
    b: FurnitureDocument,
): ChangeItem[] {
    const fa = constructionLeaves(a);
    const fb = constructionLeaves(b);
    const paths = new Set<string>();
    // Both sides have the leaf, or a null on one side became a subtree on the other.
    const nullToTree = (
        p: string,
        x: ReturnType<typeof constructionLeaves>,
        y: ReturnType<typeof constructionLeaves>,
    ) => x.leaves.get(p) === null && y.objects.has(p);
    for (const p of fa.leaves.keys()) {
        if (fb.leaves.has(p) || nullToTree(p, fa, fb)) paths.add(p);
    }
    for (const p of fb.leaves.keys()) {
        if (nullToTree(p, fb, fa)) paths.add(p);
    }
    const out: ChangeItem[] = [];
    for (const path of [...paths].sort(cmpId)) {
        const before = fa.leaves.has(path)
            ? fa.leaves.get(path)
            : fa.objects.get(path);
        const after = fb.leaves.has(path)
            ? fb.leaves.get(path)
            : fb.objects.get(path);
        if (deepEqual(before, after)) continue;
        const field = CHANGE_FIELD_LABELS_EN[path] ?? path;
        const asLength =
            LENGTH_PATHS.has(path) &&
            typeof before === 'number' &&
            typeof after === 'number';
        out.push(
            item(
                'construction_changed',
                'changes.construction_changed',
                asLength
                    ? { field, beforeMm: before, afterMm: after }
                    : {
                          field,
                          before: isRecord(before) ? 'Set' : show(before),
                          after: isRecord(after) ? 'Set' : show(after),
                      },
                path,
                before,
                after,
                MAJOR_PATHS.has(path) ? 'major' : 'minor',
            ),
        );
    }
    return out;
}

function sectionChanges(
    a: FurnitureDocument,
    b: FurnitureDocument,
    labelOf: (id: string, preferB: boolean) => string,
): ChangeItem[] {
    if (!a.carcass || !b.carcass) return [];
    const na = sectionNodes(a.carcass.interior);
    const nb = sectionNodes(b.carcass.interior);
    const out: ChangeItem[] = [];
    const ids = [...new Set([...na.keys(), ...nb.keys()])].sort(cmpId);

    for (const id of ids) {
        const x = na.get(id);
        const y = nb.get(id);
        if (x && y) {
            const sa = x.section;
            const sb = y.section;
            const idsA = sa.children.map((c) => c.section.id);
            const idsB = sb.children.map((c) => c.section.id);
            let what: 'layout' | 'size' | null = null;
            if (sa.split !== sb.split || !deepEqual(idsA, idsB)) {
                what = 'layout';
            } else if (
                sa.children.some(
                    (c, i) => !deepEqual(c.size, sb.children[i]?.size),
                )
            ) {
                what = 'size';
            }
            if (what) {
                out.push(
                    item(
                        'section_changed',
                        `changes.section_${what}`,
                        { section: labelOf(id, true) },
                        id,
                        sectionJson(sa),
                        sectionJson(sb),
                        'minor',
                    ),
                );
            }
            continue;
        }
        // Top-most only: the parent exists on the other side too (or this is a root).
        const node = (x ?? y) as SectionNode;
        const other = x ? nb : na;
        if (node.parentId !== null && !other.has(node.parentId)) continue;
        const what = x ? 'removed' : 'added';
        out.push(
            item(
                'section_changed',
                `changes.section_${what}`,
                { section: labelOf(id, !x) },
                id,
                x ? sectionJson(node.section) : null,
                y ? sectionJson(node.section) : null,
                'minor',
            ),
        );
    }
    return out;
}

const normContent = (c: Content | null): Content => c ?? { type: 'empty' };

function contentChanges(
    a: FurnitureDocument,
    b: FurnitureDocument,
    labelOf: (id: string, preferB: boolean) => string,
): ChangeItem[] {
    if (!a.carcass || !b.carcass) return [];
    const na = sectionNodes(a.carcass.interior);
    const nb = sectionNodes(b.carcass.interior);
    const out: ChangeItem[] = [];
    for (const id of [...na.keys()].sort(cmpId)) {
        const x = na.get(id)?.section;
        const y = nb.get(id)?.section;
        if (!x || !y || !isLeaf(x) || !isLeaf(y)) continue;
        if (deepEqual(normContent(x.content), normContent(y.content))) continue;
        out.push(
            item(
                'content_changed',
                'changes.content_changed',
                {
                    section: labelOf(id, true),
                    before: contentSummary(x.content),
                    after: contentSummary(y.content),
                },
                id,
                x.content,
                y.content,
                'minor',
            ),
        );
    }
    return out;
}

function frontChanges(
    a: FurnitureDocument,
    b: FurnitureDocument,
    labelOf: (id: string, preferB: boolean) => string,
): ChangeItem[] {
    const fa = new Map((a.carcass?.fronts ?? []).map((f) => [f.id, f]));
    const fb = new Map((b.carcass?.fronts ?? []).map((f) => [f.id, f]));
    const sections = (f: Front, preferB: boolean) =>
        f.covers.map((id) => labelOf(id, preferB)).join(', ');
    const out: ChangeItem[] = [];
    for (const id of [...new Set([...fa.keys(), ...fb.keys()])].sort(cmpId)) {
        const x = fa.get(id);
        const y = fb.get(id);
        if (x && y) {
            const changed = FRONT_FIELDS_EN.filter(([field]) =>
                field === 'covers'
                    ? !deepEqual(
                          [...x.covers].sort(cmpId),
                          [...y.covers].sort(cmpId),
                      )
                    : x[field] !== y[field],
            );
            if (changed.length === 0) continue;
            out.push(
                item(
                    'front_changed',
                    'changes.front_changed',
                    {
                        front: `${FRONT_KIND_EN[y.kind]} over ${sections(y, true)}`,
                        fields: changed.map(([, name]) => name).join(', '),
                    },
                    id,
                    x,
                    y,
                    changed.some(([field]) => MAJOR_FRONT_FIELDS.has(field))
                        ? 'major'
                        : 'minor',
                ),
            );
            continue;
        }
        const f = (x ?? y) as Front;
        out.push(
            item(
                x ? 'front_removed' : 'front_added',
                x ? 'changes.front_removed' : 'changes.front_added',
                { kind: FRONT_KIND_EN[f.kind], sections: sections(f, !x) },
                id,
                x ?? null,
                y ?? null,
                'major',
            ),
        );
    }
    return out;
}

const partSnapshot = (p: Part) => ({
    length: p.length,
    width: p.width,
    thickness: p.thickness,
    materialCode: p.materialCode,
    edges: p.edges,
    grain: p.grain,
});

const PART_FIELDS_EN: Array<[keyof ReturnType<typeof partSnapshot>, string]> = [
    ['materialCode', 'material'],
    ['thickness', 'thickness'],
    ['length', 'length'],
    ['width', 'width'],
    ['edges', 'edges'],
    ['grain', 'grain'],
];

function partChanges(a: Part[], b: Part[]): ChangeItem[] {
    const pa = new Map(a.map((p) => [p.key, p]));
    const pb = new Map(b.map((p) => [p.key, p]));
    const keys = (pred: (k: string) => boolean) =>
        [...new Set([...pa.keys(), ...pb.keys()])].filter(pred).sort(cmpId);
    const name = (p: Part) => partNameEn(p.nameKey, p.nameParams);

    const added = keys((k) => !pa.has(k)).map((k) => {
        const p = pb.get(k) as Part;
        return item(
            'part_added',
            'changes.part_added',
            { name: name(p), lengthMm: p.length, widthMm: p.width },
            k,
            null,
            partSnapshot(p),
            'minor',
        );
    });
    const removed = keys((k) => !pb.has(k)).map((k) => {
        const p = pa.get(k) as Part;
        return item(
            'part_removed',
            'changes.part_removed',
            { name: name(p) },
            k,
            partSnapshot(p),
            null,
            'minor',
        );
    });
    const changed = keys((k) => pa.has(k) && pb.has(k)).flatMap((k) => {
        const x = partSnapshot(pa.get(k) as Part);
        const y = partSnapshot(pb.get(k) as Part);
        const fields = PART_FIELDS_EN.filter(
            ([f]) => !deepEqual(x[f], y[f]),
        ).map(([, label]) => label);
        return fields.length === 0
            ? []
            : [
                  item(
                      'part_changed',
                      'changes.part_changed',
                      {
                          name: name(pb.get(k) as Part),
                          fields: fields.join(', '),
                      },
                      k,
                      x,
                      y,
                      'minor',
                  ),
              ];
    });

    const collapse = (
        list: ChangeItem[],
        kind: ChangeKind,
        messageKey: string,
    ): ChangeItem[] =>
        list.length > MAX_LISTED_PARTS
            ? [
                  item(
                      kind,
                      messageKey,
                      { count: list.length },
                      null,
                      null,
                      null,
                      'minor',
                  ),
              ]
            : list;
    return [
        ...collapse(added, 'part_added', 'changes.parts_added_many'),
        ...collapse(removed, 'part_removed', 'changes.parts_removed_many'),
        ...collapse(changed, 'part_changed', 'changes.parts_changed_many'),
    ];
}

function hardwareChanges(
    a: Bom['hardware'],
    b: Bom['hardware'],
    idx: ReturnType<typeof indexCatalog>,
): ChangeItem[] {
    const qa = new Map(a.map((h) => [h.code, h.qty]));
    const qb = new Map(b.map((h) => [h.code, h.qty]));
    const out: ChangeItem[] = [];
    for (const code of [...new Set([...qa.keys(), ...qb.keys()])].sort(cmpId)) {
        const before = qa.get(code);
        const after = qb.get(code);
        if (before === after) continue;
        const name = idx.hardware(code)?.name ?? code;
        if (before === undefined) {
            out.push(
                item(
                    'hardware_added',
                    'changes.hardware_added',
                    { qty: after as number, name },
                    code,
                    null,
                    after,
                    'minor',
                ),
            );
        } else if (after === undefined) {
            out.push(
                item(
                    'hardware_removed',
                    'changes.hardware_removed',
                    { qty: before, name },
                    code,
                    before,
                    null,
                    'minor',
                ),
            );
        } else {
            out.push(
                item(
                    'hardware_qty_changed',
                    'changes.hardware_qty_changed',
                    { name, before, after },
                    code,
                    before,
                    after,
                    'minor',
                ),
            );
        }
    }
    return out;
}

/** 07 §10.3: significance, kind rank, entityId (null first), messageKey. */
function compareItems(x: ChangeItem, y: ChangeItem): number {
    const sig = (i: ChangeItem) => (i.significance === 'major' ? 0 : 1);
    if (sig(x) !== sig(y)) return sig(x) - sig(y);
    const rank = CHANGE_KINDS.indexOf(x.kind) - CHANGE_KINDS.indexOf(y.kind);
    if (rank !== 0) return rank;
    if (x.entityId !== y.entityId) {
        if (x.entityId === null) return -1;
        if (y.entityId === null) return 1;
        return cmpId(x.entityId, y.entityId);
    }
    return cmpId(x.messageKey, y.messageKey);
}

/**
 * The changes between two furniture documents (07 §10.1): both are migrated,
 * generated, put through the BOM with nesting and priced for one unit without
 * installation against the same `catalog`. Identical documents give `[]`.
 */
export function diffFurniture(
    before: unknown,
    after: unknown,
    catalog: CatalogSnapshot,
): ChangeItem[] {
    const a = migrateFurniture(before);
    const b = migrateFurniture(after);
    const idx = indexCatalog(catalog);
    const side = (doc: FurnitureDocument) => {
        const model = generateFurniture(doc, catalog);
        const bom = computeBom(model, catalog, bomOptionsFor(doc, true));
        const price = priceBom(bom, catalog, catalog.pricing, {
            quantity: 1,
            includeInstallation: false,
        });
        return { model, bom, price };
    };
    const sa = side(a);
    const sb = side(b);

    const labelsA = sectionLabels(a, catalog);
    const labelsB = sectionLabels(b, catalog);
    const labelOf = (id: string, preferB: boolean): string =>
        (preferB
            ? (labelsB.get(id) ?? labelsA.get(id))
            : (labelsA.get(id) ?? labelsB.get(id))) ?? id;

    const items = [
        ...priceChange(sa.price.unitPriceMinor, sb.price.unitPriceMinor),
        ...dimsChanges(a, b),
        ...materialChanges(a, b, [...sa.model.parts, ...sb.model.parts], idx),
        ...constructionChanges(a, b),
        ...sectionChanges(a, b, labelOf),
        ...contentChanges(a, b, labelOf),
        ...frontChanges(a, b, labelOf),
        ...partChanges(sa.model.parts, sb.model.parts),
        ...hardwareChanges(sa.bom.hardware, sb.bom.hardware, idx),
        ...(a.notes !== b.notes
            ? [
                  item(
                      'notes_changed',
                      'changes.notes_changed',
                      {},
                      null,
                      a.notes,
                      b.notes,
                      'minor',
                  ),
              ]
            : []),
    ];
    // Array#sort is stable, so emission order settles full ties.
    return items.sort(compareItems);
}
