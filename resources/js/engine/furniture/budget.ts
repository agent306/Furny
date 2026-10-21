/**
 * The work budget of furniture generation (03 §2.4, 07 §7.1): a document
 * outside the size limits, or with more parts than `MAX_PARTS`, can never be
 * saved, so generation refuses it before doing any size-dependent work. Both
 * checks only count (iteratively), so a hostile document costs O(its size).
 */
import { MAX_PARTS } from './constants';
import { furnitureIssue } from './context';
import type { FurnitureDocument, Section } from './schema';
import type { Issue } from '../plan/types';

/** Overall size limits of 03 §2.4, in the order they are reported. */
export const DIMENSION_RANGES = [
    ['width', 150, 6000],
    ['height', 100, 3000],
    ['depth', 100, 1200],
] as const;

export function dimsIssues(doc: FurnitureDocument): Issue[] {
    return DIMENSION_RANGES.flatMap(([dimension, min, max]) => {
        const value = doc.dims[dimension];
        return value < min || value > max
            ? [
                  furnitureIssue('furniture.dims_range', 'error', {
                      dimension,
                      min,
                      max,
                  }),
              ]
            : [];
    });
}

/**
 * A tree with `l` leaves has at most `2l - 1` nodes when every divided
 * section has two or more children (03 §2.4), so more nodes than this means
 * more than `MAX_PARTS` leaves or a malformed chain. Also bounds the depth.
 */
const MAX_SECTION_NODES = 2 * MAX_PARTS;

/** Leaves and nodes of the tree, counting stops once either bound is passed. */
function sectionCounts(root: Section): { leaves: number; nodes: number } {
    let leaves = 0;
    let nodes = 0;
    const stack = [root];
    while (
        stack.length > 0 &&
        leaves <= MAX_PARTS &&
        nodes <= MAX_SECTION_NODES
    ) {
        const section = stack.pop()!;
        nodes += 1;
        if (section.split === 'none') leaves += 1;
        for (const child of section.children) stack.push(child.section);
    }
    return { leaves, nodes };
}

/**
 * Generation only refuses a dimension this many times over its maximum.
 * Between 1x and this factor the document is still generated, so the model
 * rules can be checked slightly outside the saveable range (07 §3.9 pedestal
 * at 1300 mm); `validateFurniture` reports `dims_range` for those anyway.
 */
const GENERATION_FACTOR = 2;

/**
 * The save-blocking issues that stop generation: `furniture.dims_range` for
 * every dimension out of range once one is over `GENERATION_FACTOR` times its
 * maximum, else `furniture.too_many_parts` `{ count }`
 * when leaf sections, fronts or extra parts alone exceed `MAX_PARTS`.
 * Empty for every document that generation can handle in bounded time.
 */
export function budgetIssues(doc: FurnitureDocument): Issue[] {
    if (
        DIMENSION_RANGES.some(
            ([name, , max]) => doc.dims[name] > GENERATION_FACTOR * max,
        )
    ) {
        return dimsIssues(doc);
    }
    const carcass = doc.carcass;
    const { leaves, nodes } = carcass
        ? sectionCounts(carcass.interior)
        : { leaves: 0, nodes: 0 };
    const count = Math.max(
        leaves,
        nodes > MAX_SECTION_NODES ? nodes : 0,
        carcass?.fronts.length ?? 0,
        doc.overrides.extraParts.length,
    );
    return count > MAX_PARTS
        ? [furnitureIssue('furniture.too_many_parts', 'error', { count })]
        : [];
}
