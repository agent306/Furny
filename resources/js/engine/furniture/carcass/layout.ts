/**
 * Section layout (07 §3.7) and divider parts (07 §3.8): the interior is split
 * recursively into boxes; every split of `n` children needs `n - 1` dividers
 * (partitions between columns, fixed shelves between rows).
 *
 * Joints of dividers (and of non-adjustable shelves, `contents.ts`) are found
 * geometrically, once the parts exist: see `recordEndJoints`.
 */
import type { CatalogSnapshot } from '../../catalog/snapshot';
import { fl } from '../constants';
import { createGenContext } from '../context';
import { makePart } from '../parts';
import type { FurnitureDocument, Section, SectionChild } from '../schema';
import type { Axis, Box3, GenContext, Part } from '../types';
import { computeEnvelope, type Envelope } from './envelope';

export interface SectionLabel {
    key: 'sections.interior' | 'sections.column' | 'sections.row';
    params: { n?: number };
    /** The enclosing section's label; `null` for the root. */
    parentLabel: SectionLabel | null;
}

export interface SectionBoxInfo {
    id: string;
    box: Box3;
    leaf: boolean;
    parentId: string | null;
    /** 1-based position among the siblings (the `n` of the label); 0 for the root. */
    index: number;
    label: SectionLabel;
}

export interface Divider {
    /** `section.{S}.partition.{i}` or `section.{S}.fixed_shelf.{i}`. */
    key: string;
    kind: 'partition' | 'fixed_shelf';
    /** The divided section `S` that owns the divider. */
    sectionId: string;
    /** 1-based, left to right (partitions) or top to bottom (fixed shelves). */
    index: number;
    box: Box3;
}

export interface SectionLayout {
    byId: Map<string, SectionBoxInfo>;
    /** Section ids in pre-order. */
    preorder: string[];
    /** Each divided section's dividers, before those of its children. */
    dividers: Divider[];
}

export interface Allocation {
    sizes: number[];
    /** `furniture.fixed_sizes_exceed`: millimetres by which the fixed sizes overshoot. */
    overBy: number | null;
    /** `furniture.fixed_sizes_adjusted`: no flex child, and the last one's stored size changed. */
    adjusted: boolean;
}

const AXIS_INDEX: Record<Axis, number> = { x: 0, y: 1, z: 2 };

/** Two faces count as the same plane within this distance (07 §3.8). */
const FACE_TOLERANCE = 0.5;
/** Contact areas must overlap by more than float noise. */
const OVERLAP_EPSILON = 1e-6;

const sum = (values: readonly number[]): number =>
    values.reduce((total, v) => total + v, 0);

/**
 * Sizes of the children of one split along an axis of `avail` millimetres
 * (07 §3.7 rule 3).
 *
 * Fixed sizes that overshoot `avail` are an error, and every child then gets
 * a proportional share (fixed mm and flex weights both used as weights) so
 * the result can still be rendered. Otherwise flex children share the rest by
 * weight, floored, and the leftover millimetres go +1 each to the flex
 * children in order. With no flex child at all the last one absorbs the rest.
 */
export function allocate(
    children: ReadonlyArray<Pick<SectionChild, 'size'>>,
    avail: number,
): Allocation {
    const sizes = children.map((c) => c.size);
    const n = sizes.length;
    if (n === 0) return { sizes: [], overBy: null, adjusted: false };

    const fixedSum = sum(sizes.map((s) => (s.mode === 'fixed' ? s.mm : 0)));
    const rem = avail - fixedSum;

    if (rem < 0) {
        const weights = sizes.map((s) =>
            s.mode === 'fixed' ? s.mm : s.weight,
        );
        const total = sum(weights);
        return {
            sizes: weights.map((w) =>
                fl(total > 0 ? (avail * w) / total : avail / n),
            ),
            overBy: -rem,
            adjusted: false,
        };
    }

    if (!sizes.some((s) => s.mode === 'flex')) {
        const out = sizes.map((s) => (s.mode === 'fixed' ? s.mm : 0));
        out[n - 1] = (out[n - 1] ?? 0) + rem;
        return { sizes: out, overBy: null, adjusted: rem !== 0 };
    }

    const weightTotal = sum(
        sizes.map((s) => (s.mode === 'flex' ? s.weight : 0)),
    );
    const out = sizes.map((s) =>
        s.mode === 'fixed' ? s.mm : fl((rem * s.weight) / weightTotal),
    );
    let leftover = rem - sum(out) + fixedSum;
    for (let i = 0; i < n && leftover > 0; i++) {
        if (sizes[i]?.mode === 'flex') {
            out[i] = (out[i] ?? 0) + 1;
            leftover -= 1;
        }
    }
    return { sizes: out, overBy: null, adjusted: false };
}

const emptyLayout = (): SectionLayout => ({
    byId: new Map(),
    preorder: [],
    dividers: [],
});

const copyBox = (box: Box3): Box3 => ({
    min: [...box.min],
    size: [...box.size],
});

/**
 * Lays the sections out in the envelope's interior. Reports
 * `furniture.fixed_sizes_exceed` / `furniture.fixed_sizes_adjusted` on `ctx`
 * and records the leaves in `ctx.sections` (sizes floored), in pre-order.
 */
export function layoutFromEnvelope(
    ctx: GenContext,
    env: Envelope,
): SectionLayout {
    const layout = emptyLayout();
    const carcass = ctx.doc.carcass;
    if (!carcass) return layout;
    const tc = ctx.t('carcass');
    const ts = ctx.t('shelf');

    const visit = (
        section: Section,
        box: Box3,
        parentId: string | null,
        index: number,
        label: SectionLabel,
    ): void => {
        const children = section.children;
        const leaf = section.split === 'none' || children.length === 0;
        layout.byId.set(section.id, {
            id: section.id,
            box: copyBox(box),
            leaf,
            parentId,
            index,
            label,
        });
        layout.preorder.push(section.id);
        if (leaf) {
            ctx.sections.push({
                id: section.id,
                box: {
                    min: [...box.min],
                    size: box.size.map(fl) as Box3['size'],
                },
            });
            return;
        }

        const columns = section.split === 'columns';
        const n = children.length;
        const td = columns ? tc : ts;
        const [x, y, z] = box.min;
        const [sx, sy, sz] = box.size;
        const { sizes, overBy, adjusted } = allocate(
            children,
            (columns ? sx : sy) - (n - 1) * td,
        );
        if (overBy !== null) {
            ctx.issue(
                'furniture.fixed_sizes_exceed',
                'error',
                { sectionId: section.id, overBy },
                [section.id],
            );
        } else if (adjusted) {
            ctx.issue(
                'furniture.fixed_sizes_adjusted',
                'info',
                { sectionId: section.id },
                [section.id],
            );
        }

        // Columns run left to right from x; rows top to bottom from the top edge.
        const childBoxes: Box3[] = [];
        let cursor = columns ? x : y + sy;
        sizes.forEach((size, k) => {
            const i = k + 1;
            const childBox: Box3 = columns
                ? { min: [cursor, y, z], size: [size, sy, sz] }
                : { min: [x, cursor - size, z], size: [sx, size, sz] };
            childBoxes.push(childBox);
            if (i < n) {
                layout.dividers.push(
                    columns
                        ? {
                              key: `section.${section.id}.partition.${i}`,
                              kind: 'partition',
                              sectionId: section.id,
                              index: i,
                              box: {
                                  min: [cursor + size, y, z],
                                  size: [td, sy, sz],
                              },
                          }
                        : {
                              key: `section.${section.id}.fixed_shelf.${i}`,
                              kind: 'fixed_shelf',
                              sectionId: section.id,
                              index: i,
                              box: {
                                  min: [x, cursor - size - td, z],
                                  size: [sx, td, sz],
                              },
                          },
                );
            }
            cursor += columns ? size + td : -(size + td);
        });

        children.forEach((child, k) => {
            const childBox = childBoxes[k];
            if (!childBox) return;
            visit(child.section, childBox, section.id, k + 1, {
                key: columns ? 'sections.column' : 'sections.row',
                params: { n: k + 1 },
                parentLabel: label,
            });
        });
    };

    visit(carcass.interior, env.interior, null, 0, {
        key: 'sections.interior',
        params: {},
        parentLabel: null,
    });
    return layout;
}

/**
 * The section boxes and dividers of a carcass document, for callers outside
 * the generation pipeline (the editor needs the non-leaf boxes too). Empty
 * when the envelope is too small; throws for a document without a carcass.
 */
export function layoutSections(
    doc: FurnitureDocument,
    catalog: CatalogSnapshot,
): SectionLayout {
    const ctx = createGenContext(doc, catalog);
    const env = computeEnvelope(ctx);
    return env ? layoutFromEnvelope(ctx, env) : emptyLayout();
}

const boxOf = (part: Part): Box3 | null =>
    part.geometry.kind === 'box' ? part.geometry.box : null;

/**
 * Records the joints of `member` at its two ends along `endAxis` (07 §3.8):
 * every other part whose face lies in the plane of the end face, on the far
 * side of it (within 0.5 mm), and overlaps it with positive area. The joint
 * length is the longer side of the overlap, which is the shared edge. Each
 * `member` / `other` pair is recorded once.
 */
export function recordEndJoints(
    ctx: GenContext,
    member: Part,
    endAxis: Axis,
): void {
    const mb = boxOf(member);
    if (!mb) return;
    const a = AXIS_INDEX[endAxis];
    const across = [0, 1, 2].filter((i) => i !== a);

    for (const end of [0, 1] as const) {
        const face = (mb.min[a] ?? 0) + (end === 0 ? 0 : (mb.size[a] ?? 0));
        for (const other of ctx.parts) {
            if (other === member) continue;
            const ob = boxOf(other);
            if (!ob) continue;
            const otherFace =
                (ob.min[a] ?? 0) + (end === 0 ? (ob.size[a] ?? 0) : 0);
            if (Math.abs(otherFace - face) > FACE_TOLERANCE) continue;
            const overlaps = across.map(
                (i) =>
                    Math.min(
                        (mb.min[i] ?? 0) + (mb.size[i] ?? 0),
                        (ob.min[i] ?? 0) + (ob.size[i] ?? 0),
                    ) - Math.max(mb.min[i] ?? 0, ob.min[i] ?? 0),
            );
            if (overlaps.some((o) => o <= OVERLAP_EPSILON)) continue;
            if (
                ctx.joints.some(
                    (j) => j.member === member.key && j.other === other.key,
                )
            ) {
                continue;
            }
            ctx.joints.push({
                member: member.key,
                other: other.key,
                length: Math.max(...overlaps),
            });
        }
    }
}

/**
 * Pushes the partition and fixed shelf parts of `layout` (07 §3.8) and their
 * joints. Run after the carcass panels, so the horizontal panels at the ends
 * of the partitions exist.
 */
export function dividerParts(ctx: GenContext, layout: SectionLayout): void {
    const made: Array<{ part: Part; endAxis: Axis }> = [];
    for (const d of layout.dividers) {
        const partition = d.kind === 'partition';
        const role = partition ? 'carcass' : 'shelf';
        const part = makePart(
            {
                key: d.key,
                nameKey: partition ? 'parts.partition' : 'parts.fixed_shelf',
                nameParams: { n: d.index },
                role,
                materialCode: ctx.doc.materials[role].materialCode,
                box: d.box,
                thicknessAxis: partition ? 'x' : 'y',
                grainAxis: partition ? 'y' : 'x',
                banded: ['front'],
                visibleFaces: 0,
            },
            ctx,
        );
        ctx.parts.push(part);
        made.push({ part, endAxis: partition ? 'y' : 'x' });
    }
    // Joints need every divider in place: a partition may end on a fixed shelf.
    for (const { part, endAxis } of made) recordEndJoints(ctx, part, endAxis);
}
