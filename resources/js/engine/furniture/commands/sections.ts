/**
 * Section tree commands (07 §9): `splitSection`, `setChildSize`,
 * `insertChild`, `removeChild`, `mergeSections` and `setContent`, plus the
 * helpers that walk the tree and keep fronts and drawers consistent with it
 * (`syncBehindDoor`, `rewireFronts`).
 *
 * Rulings carried by this file (ledgered for the spec 19 reconciliation):
 * - `removeChild` down to one child: the parent keeps its id and size and
 *   takes over the child's content, or its split and children. Fronts that
 *   covered the child's id now cover the parent's, so the door of the section
 *   that stays is not lost (07 §9 only says what happens to deleted ids).
 * - `setChildSize` has an optional `drag` flag: the elevation drag merges
 *   under `drag:{parentId}`, any other edit under `size:{parentId}:{index}`
 *   (07 §9 lists both keys and the params do not say which applies).
 * - Sizes are held to `fixed` 1-6000 mm and `flex` 0.01-1000 (`out_of_range`).
 */
import type { Draft } from 'mutative';
import { z } from 'zod';
import { coveringFront } from '../carcass/envelope';
import {
    ContentSchema,
    type Front,
    type FurnitureDocument,
    type Section,
} from '../schema';
import {
    MAX_MM,
    assign,
    carcassOf,
    checkCarcass,
    checkRange,
    defineFurnitureCommand,
    message,
    mm,
    notFound,
    pushDeleted,
    snapshot,
} from './helpers';
import type { EngineMessage } from '../../plan/types';

// ---- tree helpers ---------------------------------------------------------------------------

/** The section with `id` under `root` (pre-order), or `undefined`. */
export function findSection(root: Section, id: string): Section | undefined {
    if (root.id === id) return root;
    for (const child of root.children) {
        const hit = findSection(child.section, id);
        if (hit !== undefined) return hit;
    }
    return undefined;
}

/** Ids of `section` and everything under it, pre-order. */
export function subtreeIds(section: Section): string[] {
    return [
        section.id,
        ...section.children.flatMap((child) => subtreeIds(child.section)),
    ];
}

/** The first leaf in pre-order. */
function firstLeaf(section: Section): Section {
    let leaf = section;
    while (leaf.children.length > 0) leaf = leaf.children[0]!.section;
    return leaf;
}

/**
 * Sets `behindDoor` of every drawers leaf to whether a front covers it,
 * directly or through an ancestor section (07 §9; the same test as
 * `coveringFront`). Run after every command that can change fronts or
 * contents.
 */
export function syncBehindDoor(doc: Pick<FurnitureDocument, 'carcass'>): void {
    const carcass = doc.carcass;
    if (carcass === null) return;
    const covered = new Set(carcass.fronts.flatMap((front) => front.covers));
    const visit = (section: Section, inherited: boolean): void => {
        const isCovered = inherited || covered.has(section.id);
        if (section.children.length > 0) {
            for (const child of section.children) {
                visit(child.section, isCovered);
            }
            return;
        }
        if (section.content?.type === 'drawers') {
            section.content.behindDoor = isCovered;
        }
    };
    visit(carcass.interior, false);
}

/**
 * Rewrites the `covers` of `fronts` after sections left the tree: ids in
 * `removed` are dropped, ids in `renamed` are replaced (duplicates collapse),
 * and a front left with no `covers` is deleted. Returns the deleted ids.
 */
export function rewireFronts(
    fronts: Front[],
    removed: ReadonlySet<string>,
    renamed: ReadonlyMap<string, string>,
): string[] {
    const deleted: string[] = [];
    for (let at = fronts.length - 1; at >= 0; at -= 1) {
        const front = fronts[at]!;
        if (!front.covers.some((id) => removed.has(id) || renamed.has(id))) {
            continue;
        }
        const covers = [
            ...new Set(
                front.covers
                    .filter((id) => !removed.has(id))
                    .map((id) => renamed.get(id) ?? id),
            ),
        ];
        if (covers.length === 0) {
            deleted.unshift(front.id);
            fronts.splice(at, 1);
        } else {
            assign(front, 'covers', covers);
        }
    }
    return deleted;
}

// ---- shared params and checks ---------------------------------------------------------------

const SizeSchema = z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('fixed'), mm: z.number() }),
    z.object({ mode: z.literal('flex'), weight: z.number() }),
]);
type SizeParam = z.infer<typeof SizeSchema>;

const FIXED_RANGE = [1, MAX_MM] as const;
const FLEX_RANGE = [0.01, 1000] as const;

function checkSize(size: SizeParam): EngineMessage | null {
    return size.mode === 'fixed'
        ? checkRange('size.mm', mm(size.mm), ...FIXED_RANGE)
        : checkRange('size.weight', size.weight, ...FLEX_RANGE);
}

const cleanSize = (size: SizeParam) =>
    size.mode === 'fixed'
        ? ({ mode: 'fixed', mm: mm(size.mm) } as const)
        : ({ mode: 'flex', weight: size.weight } as const);

/** The carcass checks plus the section `id` that must exist; `found` is that section. */
function lookup(
    doc: Pick<FurnitureDocument, 'carcass'>,
    id: string,
): { error: EngineMessage } | { section: Section } {
    const missing = checkCarcass(doc);
    if (missing !== null) return { error: missing };
    const section = findSection(doc.carcass!.interior, id);
    return section === undefined ? { error: notFound(id) } : { section };
}

/** A divided section `id`, or the refusal (`not_found`, `not_split`). */
function lookupParent(
    doc: Pick<FurnitureDocument, 'carcass'>,
    id: string,
): { error: EngineMessage } | { section: Section } {
    const found = lookup(doc, id);
    if ('error' in found) return found;
    return found.section.split === 'none'
        ? { error: message('not_split', { id }) }
        : found;
}

/** A leaf `id`, or the refusal (`not_found`, `not_leaf`). */
function lookupLeaf(
    doc: Pick<FurnitureDocument, 'carcass'>,
    id: string,
): { error: EngineMessage } | { section: Section } {
    const found = lookup(doc, id);
    if ('error' in found) return found;
    return found.section.split === 'none'
        ? found
        : { error: message('not_leaf', { id }) };
}

/** The section of an id `validate` found; the carcass and section are checked before `run`. */
function sectionOf(d: Draft<FurnitureDocument>, id: string): Section {
    return findSection(carcassOf(d).interior, id)!;
}

// ---- splitSection ---------------------------------------------------------------------------

const SplitSectionSchema = z.object({
    sectionId: z.string(),
    direction: z.enum(['columns', 'rows']),
    count: z.number().int(),
});
type SplitSectionParams = z.infer<typeof SplitSectionSchema>;

export interface SplitSectionResult {
    /** The new child sections, in order; the first holds the old content. */
    childIds: string[];
}

const SPLIT_COUNT = [2, 8] as const;

const splitSection = defineFurnitureCommand<
    SplitSectionParams,
    SplitSectionResult
>({
    type: 'furniture.splitSection',
    labelKey: 'engine.furniture.command.label.split_section',
    paramsSchema: SplitSectionSchema,
    validate(doc, p) {
        const found = lookupLeaf(doc, p.sectionId);
        if ('error' in found) return found.error;
        return checkRange('count', p.count, ...SPLIT_COUNT);
    },
    run(d, p, ctx, out) {
        const section = sectionOf(d, p.sectionId);
        const content = snapshot(section.content);
        const children = Array.from({ length: p.count }, (_, at) => ({
            size: { mode: 'flex' as const, weight: 1 },
            section: {
                id: ctx.newId('s'),
                split: 'none' as const,
                children: [],
                content:
                    at === 0 && content !== null
                        ? content
                        : { type: 'empty' as const },
            },
        }));
        section.split = p.direction;
        section.content = null;
        section.children = children;
        syncBehindDoor(d);
        out.result = { childIds: children.map((c) => c.section.id) };
    },
});

// ---- setChildSize ---------------------------------------------------------------------------

const SetChildSizeSchema = z.object({
    parentId: z.string(),
    index: z.number().int(),
    size: SizeSchema,
    /** The change comes from dragging a divider in the elevation view. */
    drag: z.boolean().optional(),
});
type SetChildSizeParams = z.infer<typeof SetChildSizeSchema>;

const setChildSize = defineFurnitureCommand<SetChildSizeParams>({
    type: 'furniture.setChildSize',
    labelKey: 'engine.furniture.command.label.set_child_size',
    paramsSchema: SetChildSizeSchema,
    validate(doc, p) {
        const found = lookupParent(doc, p.parentId);
        if ('error' in found) return found.error;
        return (
            checkRange(
                'index',
                p.index,
                0,
                found.section.children.length - 1,
            ) ?? checkSize(p.size)
        );
    },
    run(d, p) {
        const child = sectionOf(d, p.parentId).children[p.index]!;
        const next = cleanSize(p.size);
        if (child.size.mode === 'fixed' && next.mode === 'fixed') {
            child.size.mm = next.mm;
        } else if (child.size.mode === 'flex' && next.mode === 'flex') {
            child.size.weight = next.weight;
        } else {
            child.size = next;
        }
    },
    mergeKey: (p) =>
        p.drag === true
            ? `drag:${p.parentId}`
            : `size:${p.parentId}:${p.index}`,
});

// ---- insertChild ----------------------------------------------------------------------------

const InsertChildSchema = z.object({
    parentId: z.string(),
    index: z.number().int(),
    size: SizeSchema.optional(),
});
type InsertChildParams = z.infer<typeof InsertChildSchema>;

const insertChild = defineFurnitureCommand<
    InsertChildParams,
    { sectionId: string }
>({
    type: 'furniture.insertChild',
    labelKey: 'engine.furniture.command.label.insert_child',
    paramsSchema: InsertChildSchema,
    validate(doc, p) {
        const found = lookupParent(doc, p.parentId);
        if ('error' in found) return found.error;
        return (
            checkRange('index', p.index, 0, found.section.children.length) ??
            (p.size === undefined ? null : checkSize(p.size))
        );
    },
    run(d, p, ctx, out) {
        const id = ctx.newId('s');
        sectionOf(d, p.parentId).children.splice(p.index, 0, {
            size:
                p.size === undefined
                    ? { mode: 'flex', weight: 1 }
                    : cleanSize(p.size),
            section: {
                id,
                split: 'none',
                children: [],
                content: { type: 'empty' },
            },
        });
        out.result = { sectionId: id };
    },
});

// ---- removeChild ----------------------------------------------------------------------------

const RemoveChildSchema = z.object({
    parentId: z.string(),
    index: z.number().int(),
});
type RemoveChildParams = z.infer<typeof RemoveChildSchema>;

const removeChild = defineFurnitureCommand<RemoveChildParams>({
    type: 'furniture.removeChild',
    labelKey: 'engine.furniture.command.label.remove_child',
    paramsSchema: RemoveChildSchema,
    validate(doc, p) {
        const found = lookupParent(doc, p.parentId);
        if ('error' in found) return found.error;
        return checkRange(
            'index',
            p.index,
            0,
            found.section.children.length - 1,
        );
    },
    run(d, p, _ctx, out) {
        const carcass = carcassOf(d);
        const parent = sectionOf(d, p.parentId);
        const removed = subtreeIds(parent.children[p.index]!.section);
        parent.children.splice(p.index, 1);
        pushDeleted(out, ...removed);

        // One child left: the parent takes its place (07 §9).
        const renamed = new Map<string, string>();
        const only =
            parent.children.length === 1
                ? parent.children[0]!.section
                : undefined;
        if (only !== undefined) {
            renamed.set(only.id, parent.id);
            pushDeleted(out, only.id);
            if (only.children.length > 0) {
                const children = snapshot(only.children);
                parent.split = only.split;
                parent.children = children;
                parent.content = null;
            } else {
                const content = snapshot(only.content);
                parent.split = 'none';
                parent.children = [];
                parent.content = content;
            }
        }

        pushDeleted(
            out,
            ...rewireFronts(carcass.fronts, new Set(removed), renamed),
        );
        syncBehindDoor(d);
    },
});

// ---- mergeSections --------------------------------------------------------------------------

const MergeSectionsSchema = z.object({ sectionId: z.string() });
type MergeSectionsParams = z.infer<typeof MergeSectionsSchema>;

const mergeSections = defineFurnitureCommand<MergeSectionsParams>({
    type: 'furniture.mergeSections',
    labelKey: 'engine.furniture.command.label.merge_sections',
    paramsSchema: MergeSectionsSchema,
    validate: (doc, p) => {
        const found = lookupParent(doc, p.sectionId);
        return 'error' in found ? found.error : null;
    },
    run(d, p, _ctx, out) {
        const carcass = carcassOf(d);
        const section = sectionOf(d, p.sectionId);
        const removed = subtreeIds(section).slice(1);
        const content = snapshot(firstLeaf(section).content) ?? {
            type: 'empty' as const,
        };
        section.split = 'none';
        section.children = [];
        section.content = content;
        pushDeleted(out, ...removed);

        const renamed = new Map(removed.map((id) => [id, section.id]));
        pushDeleted(out, ...rewireFronts(carcass.fronts, new Set(), renamed));
        // Two fronts on one section: the later one goes (07 §9).
        const covering = carcass.fronts
            .filter((f) => f.covers.includes(section.id))
            .map((f) => f.id);
        for (const id of covering.slice(1)) {
            carcass.fronts.splice(
                carcass.fronts.findIndex((f) => f.id === id),
                1,
            );
            pushDeleted(out, id);
        }
        syncBehindDoor(d);
    },
});

// ---- setContent -----------------------------------------------------------------------------

const SetContentSchema = z.object({
    sectionId: z.string(),
    content: ContentSchema,
});
type SetContentParams = z.infer<typeof SetContentSchema>;

const setContent = defineFurnitureCommand<SetContentParams>({
    type: 'furniture.setContent',
    labelKey: 'engine.furniture.command.label.set_content',
    paramsSchema: SetContentSchema,
    validate: (doc, p) => {
        const found = lookupLeaf(doc, p.sectionId);
        return 'error' in found ? found.error : null;
    },
    run(d, p) {
        // behindDoor is decided by the fronts, not by the caller (07 §9);
        // writing the decided value at once keeps an unchanged content a no-op.
        const content =
            p.content.type === 'drawers'
                ? {
                      ...p.content,
                      behindDoor: coveringFront(d, p.sectionId) !== undefined,
                  }
                : p.content;
        assign(sectionOf(d, p.sectionId), 'content', content);
        syncBehindDoor(d);
    },
    mergeKey: (p) => `content:${p.sectionId}`,
});

/** The section tree commands, registered in `FURNITURE_COMMANDS` (07 §9). */
export const SECTION_COMMANDS = {
    'furniture.splitSection': splitSection,
    'furniture.setChildSize': setChildSize,
    'furniture.insertChild': insertChild,
    'furniture.removeChild': removeChild,
    'furniture.mergeSections': mergeSections,
    'furniture.setContent': setContent,
};
