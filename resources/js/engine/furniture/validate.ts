/**
 * `validateFurniture` (07 §7): the structural checks of 03 §2.4 on the raw
 * document, then the issues of `generateFurniture`, deduplicated. Also the
 * issue code catalogue (07 §7.3) and the codes that block saving (07 §7.1).
 */
import type { CatalogSnapshot } from '../catalog/snapshot';
import { cmpId } from '../compare';
import type { Issue } from '../plan/types';
import { layoutSections, type SectionLayout } from './carcass/layout';
import { fl } from './constants';
import { furnitureIssue } from './context';
import { frontCoverageIssues } from './fronts/openings';
import { generateFurniture } from './generate';
import type { FurnitureDocument, Section } from './schema';

/**
 * Every issue code of 07 §7.3, in table order (`part_exceeds_sheet_back` is
 * the reserved last one), then the spec 19 additions.
 */
export const FURNITURE_ISSUE_CODES = [
    'furniture.dims_range',
    'furniture.family_mismatch',
    'furniture.section_tree_invalid',
    'furniture.section_too_small',
    'furniture.fixed_sizes_exceed',
    'furniture.front_not_rectangle',
    'furniture.front_overlap',
    'furniture.unknown_code',
    'furniture.too_many_parts',
    'furniture.envelope_too_small',
    'furniture.part_exceeds_sheet',
    'furniture.drawer_no_slide',
    'furniture.drawer_too_low',
    'furniture.drawer_heights_invalid',
    'furniture.front_too_small',
    'furniture.hinged_leaves_unsupported',
    'furniture.sliding_front_partial',
    'furniture.sliding_front_multiple',
    'furniture.sliding_leaves_unsupported',
    'furniture.glass_door_too_small',
    'furniture.no_glass_material',
    'furniture.shelves_dont_fit',
    'furniture.override_invalid',
    'furniture.round_top_not_square',
    'furniture.corner_radius_too_large',
    'furniture.cabinet_content_unsupported',
    'furniture.table_drawer_side_unsupported',
    'furniture.archived_code',
    'furniture.shelf_sag',
    'furniture.shelf_sag_critical',
    'furniture.door_wide',
    'furniture.door_tall',
    'furniture.door_heavy',
    'furniture.flap_heavy',
    'furniture.flap_leaves_ignored',
    'furniture.sliding_leaf_narrow',
    'furniture.sliding_leaf_heavy',
    'furniture.drawer_depth_unused',
    'furniture.drawers_forced_behind_door',
    'furniture.drawer_side_too_thick',
    'furniture.rod_section_shallow',
    'furniture.rod_section_short',
    'furniture.rod_span_long',
    'furniture.basket_size_mismatch',
    'furniture.baskets_dont_fit',
    'furniture.loft_no_access',
    'furniture.back_seam_unsupported',
    'furniture.plinth_too_shallow',
    'furniture.countertop_overhang_large',
    'furniture.leg_height_mismatch',
    'furniture.knee_space_narrow',
    'furniture.table_span_long',
    'furniture.pedestal_unstable',
    'furniture.no_default_hardware',
    'furniture.thin_carcass',
    'furniture.back_too_thick_for_groove',
    'furniture.drawer_bottom_thick',
    'furniture.weight_estimate',
    'furniture.back_split',
    'furniture.slide_resized',
    'furniture.fixed_sizes_adjusted',
    'furniture.plinth_ignored',
    'furniture.anti_tip_added',
    'furniture.handle_replaced_by_knob',
    'furniture.leg_section_mismatch',
    'furniture.table_top_thickness_rounded',
    'furniture.drawer_box_thickness',
    'furniture.override_orphaned',
    'furniture.part_exceeds_sheet_back',
    // Spec 19 additions (Task 38 fix round 2), after the 07 §7.3 table:
    // warning { available, required }: under-top drawers do not fit their bay.
    'furniture.table_drawers_dont_fit',
    // info { requested, applied }: apron inset clamped to s - t_c.
    'furniture.apron_inset_clamped',
    // Task 40, ruling R40-1 (long horizontal runs split at seams, like the
    // back of 07 §3.4.1): info { partKey, count } and, per seam with no
    // support, warning { partKey, position }.
    'furniture.panel_split',
    'furniture.panel_seam_unsupported',
] as const;

export type FurnitureIssueCode = (typeof FURNITURE_ISSUE_CODES)[number];

/**
 * The codes of 03 §2.4: only these make an autosave fail (422). Every other
 * error still blocks order submission and proposals (07 §7.1).
 */
export const SAVE_BLOCKING_CODES: ReadonlySet<string> = new Set<string>([
    'furniture.dims_range',
    'furniture.family_mismatch',
    'furniture.section_tree_invalid',
    'furniture.section_too_small',
    'furniture.fixed_sizes_exceed',
    'furniture.front_not_rectangle',
    'furniture.front_overlap',
    'furniture.unknown_code',
    'furniture.too_many_parts',
]);

/** Warnings rendered in the danger colour and listed first (07 §7.1). */
export const CRITICAL_WARNING_CODES: readonly string[] = [
    'furniture.shelf_sag_critical',
    'furniture.door_heavy',
    'furniture.sliding_leaf_heavy',
    'furniture.part_exceeds_sheet_back',
];

/** Whether `issues` contain a code that makes saving fail. */
export function isSaveBlocking(issues: readonly Issue[]): boolean {
    return issues.some((issue) => SAVE_BLOCKING_CODES.has(issue.code));
}

/** Overall size limits of 03 §2.4, in the order they are reported. */
const DIMENSION_RANGES = [
    ['width', 150, 6000],
    ['height', 100, 3000],
    ['depth', 100, 1200],
] as const;

/** A leaf narrower or lower than this (net) is `section_too_small` (03 §2.4). */
const MIN_LEAF_WIDTH = 100;
const MIN_LEAF_HEIGHT = 80;

function dimsIssues(doc: FurnitureDocument): Issue[] {
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

/** `carcass` non-null iff the family is carcass, `table` iff table: one issue. */
function familyIssues(doc: FurnitureDocument): Issue[] {
    const carcassOk = (doc.carcass !== null) === (doc.family === 'carcass');
    const tableOk = (doc.table !== null) === (doc.family === 'table');
    return carcassOk && tableOk
        ? []
        : [furnitureIssue('furniture.family_mismatch', 'error')];
}

/**
 * Section tree consistency: unique ids; a leaf (`split 'none'`) has no
 * children and content; a divided section has at least two children and no
 * content. One issue per offending section id.
 */
function treeIssues(doc: FurnitureDocument): Issue[] {
    if (!doc.carcass) return [];
    const seen = new Set<string>();
    const flagged = new Set<string>();
    const issues: Issue[] = [];
    const flag = (id: string): void => {
        if (flagged.has(id)) return;
        flagged.add(id);
        issues.push(
            furnitureIssue(
                'furniture.section_tree_invalid',
                'error',
                { sectionId: id },
                [id],
            ),
        );
    };
    const visit = (section: Section): void => {
        if (seen.has(section.id)) flag(section.id);
        seen.add(section.id);
        const leaf = section.split === 'none';
        const consistent = leaf
            ? section.children.length === 0 && section.content !== null
            : section.children.length >= 2 && section.content === null;
        if (!consistent) flag(section.id);
        for (const child of section.children) visit(child.section);
    };
    visit(doc.carcass.interior);
    return issues;
}

/** `section_too_small` for every laid-out leaf below the minimum net size. */
function sizeIssues(layout: SectionLayout): Issue[] {
    const issues: Issue[] = [];
    for (const id of layout.preorder) {
        const info = layout.byId.get(id);
        if (!info?.leaf) continue;
        const width = fl(info.box.size[0]);
        const height = fl(info.box.size[1]);
        if (width < MIN_LEAF_WIDTH || height < MIN_LEAF_HEIGHT) {
            issues.push(
                furnitureIssue(
                    'furniture.section_too_small',
                    'error',
                    { sectionId: id, width, height },
                    [id],
                ),
            );
        }
    }
    return issues;
}

/** The checks of 03 §2.4 that need only the document (and the layout of its sections). */
function structuralIssues(
    doc: FurnitureDocument,
    catalog: CatalogSnapshot,
): Issue[] {
    const issues = [
        ...dimsIssues(doc),
        ...familyIssues(doc),
        ...treeIssues(doc),
    ];
    if (doc.carcass) {
        // An envelope too small gives an empty layout: no leaf sizes to check,
        // but fronts that share a leaf overlap whatever the size.
        const layout = layoutSections(doc, catalog);
        issues.push(...sizeIssues(layout), ...frontCoverageIssues(doc, layout));
    }
    return issues;
}

/** Stable text of an issue's params, for issues that name no entity. */
const paramsKey = (params: Issue['params']): string =>
    JSON.stringify(
        Object.keys(params)
            .sort(cmpId)
            .map((key) => [key, params[key]]),
    );

/**
 * Removes repeated issues (07 §7.1): same `code` and same entities, in any
 * order. The first of a group stays, even when the copies differ in params.
 * Issues without entities (the code issues, `weight_estimate`, …) have
 * nothing else to tell them apart, so their params count as well: two
 * different unknown codes are two issues.
 */
export function dedupeIssues(issues: readonly Issue[]): Issue[] {
    const seen = new Set<string>();
    return issues.filter((issue) => {
        const entities = [...issue.entityIds].sort(cmpId);
        const key = [
            issue.code,
            entities.join('\u0000'),
            entities.length === 0 ? paramsKey(issue.params) : '',
        ].join('\u0001');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/**
 * Every issue of `doc` against `catalog` (07 §7.1): the structural checks of
 * 03 §2.4, which run on the raw document even when generation stops early,
 * followed by `generateFurniture(doc, catalog).issues`, deduplicated. The
 * document must be schema-valid.
 */
export function validateFurniture(
    doc: FurnitureDocument,
    catalog: CatalogSnapshot,
): Issue[] {
    return dedupeIssues([
        ...structuralIssues(doc, catalog),
        ...generateFurniture(doc, catalog).issues,
    ]);
}
