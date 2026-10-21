import { describe, expect, it } from 'vitest';
import { seedCatalog } from '../../../testing/seedCatalog';
import { layoutSections } from '../../carcass/layout';
import type { Front, FurnitureDocument } from '../../schema';
import { runCarcass } from '../../testing/carcassRun';
import {
    BOX_ROOT_ID,
    boxDocument,
    fixed,
    flex,
    frontOn,
    leafSection,
    splitSection,
    wardrobeFixture,
} from '../../testing/docs';
import {
    computeOpenings,
    coverFor,
    frontCoverageIssues,
    frontRect,
    type OpeningRect,
} from '../openings';

const catalog = seedCatalog();
const FR1 = 'fr_0000000001';
const FR2 = 'fr_0000000002';

function openingsOf(doc: FurnitureDocument): Map<string, OpeningRect> {
    const { ctx, env, layout } = runCarcass(doc, catalog);
    return computeOpenings(ctx, env, layout);
}

function openingOf(doc: FurnitureDocument, id: string): OpeningRect {
    const opening = openingsOf(doc).get(id);
    if (!opening) throw new Error(`no opening ${id}`);
    return opening;
}

const outer = { cls: 'outer', tp: 18 } as const;
const onDivider = (cls: 'shared' | 'divider_open') => ({ cls, tp: 18 });

/** 1200 x 720 x 560 box: two columns; drawers in column 1, empty column 2. */
function drawersAndDoorBox(fronts: Front[]): FurnitureDocument {
    return boxDocument({
        width: 1200,
        height: 720,
        depth: 560,
        interior: splitSection(BOX_ROOT_ID, 'columns', [
            [
                flex(),
                leafSection('s_0000000002', {
                    type: 'drawers',
                    count: 2,
                    frontHeights: 'equal',
                    slideCode: null,
                    behindDoor: false,
                }),
            ],
            [flex(), leafSection('s_0000000003')],
        ]),
        fronts,
    });
}

/** 1200 x 1500 x 560 box: column 1 a leaf, column 2 rows [fixed 600 | flex]. */
function columnAndRowsBox(fronts: Front[]): FurnitureDocument {
    return boxDocument({
        width: 1200,
        height: 1500,
        depth: 560,
        interior: splitSection(BOX_ROOT_ID, 'columns', [
            [flex(), leafSection('s_0000000002')],
            [
                flex(),
                splitSection('s_0000000003', 'rows', [
                    [fixed(600), leafSection('s_0000000004')],
                    [flex(), leafSection('s_0000000005')],
                ]),
            ],
        ]),
        fronts,
    });
}

describe('coverFor (07 §4.1 cover table)', () => {
    it.each([
        ['full', 'outer', 18, 16.5],
        ['full', 'shared', 18, 8],
        ['full', 'divider_open', 18, 16.5],
        ['half', 'outer', 18, 8],
        ['half', 'shared', 18, 8],
        ['half', 'divider_open', 18, 8],
        ['inset', 'outer', 18, -2],
        ['inset', 'shared', 18, -2],
        ['inset', 'divider_open', 18, -2],
        ['full', 'outer', 16, 14.5],
        ['full', 'shared', 25, 11.5],
    ] as const)('%s / %s / tp %d -> %d', (overlay, cls, tp, expected) => {
        expect(coverFor(overlay, cls, tp)).toBe(expected);
    });
});

describe('computeOpenings (07 §4.1)', () => {
    it('classifies the wardrobe column 1 opening of the worked example', () => {
        expect(openingOf(wardrobeFixture(), FR1)).toEqual({
            x0: 18,
            x1: 600,
            y0: 118,
            y1: 2082,
            edges: {
                left: outer,
                right: onDivider('shared'),
                top: outer,
                bottom: outer,
            },
        });
    });

    it('gives column 2 the other face of the shared partition', () => {
        expect(openingOf(wardrobeFixture(), FR2)).toEqual({
            x0: 618,
            x1: 1782,
            y0: 118,
            y1: 2082,
            edges: {
                left: onDivider('shared'),
                right: outer,
                top: outer,
                bottom: outer,
            },
        });
    });

    it('turns the partition edge into divider_open when no front is on the other side', () => {
        const doc = wardrobeFixture((d) => {
            d.carcass?.fronts.splice(1, 1);
        });
        const opening = openingOf(doc, FR1);
        expect(opening.edges.right).toEqual(onDivider('divider_open'));
        expect(frontRect(opening, 'full').x1).toBe(616.5);
    });

    it('does not share a divider with a sliding opening', () => {
        const doc = wardrobeFixture((d) => {
            const f = d.carcass?.fronts[1];
            if (f) f.kind = 'sliding';
        });
        expect(openingOf(doc, FR1).edges.right).toEqual(
            onDivider('divider_open'),
        );
    });

    it('takes the bounding rectangle of all covered sections', () => {
        const doc = wardrobeFixture((d) => {
            const fronts = d.carcass?.fronts;
            if (!fronts?.[0]) return;
            fronts[0].covers = ['s_0000000002', 's_0000000003'];
            fronts.splice(1, 1);
        });
        const opening = openingOf(doc, FR1);
        expect([opening.x0, opening.x1, opening.y0, opening.y1]).toEqual([
            18, 1782, 118, 2082,
        ]);
        expect(opening.edges.left).toEqual(outer);
        expect(opening.edges.right).toEqual(outer);
    });

    it('classifies top/bottom edges on a fixed shelf (rows)', () => {
        const doc = columnAndRowsBox([
            frontOn(FR1, ['s_0000000004']),
            frontOn(FR2, ['s_0000000005']),
        ]);
        const top = openingOf(doc, FR1);
        const bottom = openingOf(doc, FR2);
        // Interior y [18, 1482]; row 1 = 600 from the top, fixed shelf [864, 882].
        expect([top.y0, top.y1, bottom.y0, bottom.y1]).toEqual([
            882, 1482, 18, 864,
        ]);
        expect(top.edges.bottom).toEqual(onDivider('shared'));
        expect(top.edges.top).toEqual(outer);
        expect(bottom.edges.top).toEqual(onDivider('shared'));
        expect(bottom.edges.bottom).toEqual(outer);
        // Both rows sit right of the root partition, with no front on column 1.
        expect(top.edges.left).toEqual(onDivider('divider_open'));
        expect(bottom.edges.right).toEqual(outer);
    });

    it('uses the divider thickness as tp', () => {
        const doc = columnAndRowsBox([
            frontOn(FR1, ['s_0000000004']),
            frontOn(FR2, ['s_0000000005']),
        ]);
        doc.materials.shelf = {
            materialCode: 'PB25-WHITE',
            edgeBandCode: null,
            finishCode: null,
        };
        expect(openingOf(doc, FR1).edges.bottom).toEqual({
            cls: 'shared',
            tp: 25,
        });
    });

    it('adds one opening per external drawer leaf, keyed by the section id (I4)', () => {
        const openings = openingsOf(
            drawersAndDoorBox([frontOn(FR1, ['s_0000000003'])]),
        );
        expect([...openings.keys()].sort()).toEqual([FR1, 's_0000000002']);
        const drawers = openings.get('s_0000000002');
        expect(drawers).toMatchObject({ x0: 18, x1: 591, y0: 18, y1: 702 });
        // The door and the drawer fronts meet across the partition.
        expect(drawers?.edges.right).toEqual(onDivider('shared'));
        expect(openings.get(FR1)?.edges.left).toEqual(onDivider('shared'));
    });

    it('gives no drawer opening to drawers behind a door', () => {
        const doc = drawersAndDoorBox([
            frontOn(FR1, ['s_0000000002']),
            frontOn(FR2, ['s_0000000003']),
        ]);
        expect([...openingsOf(doc).keys()].sort()).toEqual([FR1, FR2]);
    });

    it('skips fronts whose covers resolve to no section', () => {
        const doc = wardrobeFixture((d) => {
            const f = d.carcass?.fronts[1];
            if (f) f.covers = ['s_zzzzzzzzzz'];
        });
        const openings = openingsOf(doc);
        expect(openings.has(FR2)).toBe(false);
        expect(openings.get(FR1)?.edges.right).toEqual(
            onDivider('divider_open'),
        );
    });
});

describe('frontRect (07 §4.1)', () => {
    it('reproduces the worked example rectangle', () => {
        expect(frontRect(openingOf(wardrobeFixture(), FR1), 'full')).toEqual({
            x0: 1.5,
            x1: 608,
            y0: 101.5,
            y1: 2098.5,
        });
    });

    it('insets every edge by 2 mm for inset fronts', () => {
        expect(frontRect(openingOf(wardrobeFixture(), FR1), 'inset')).toEqual({
            x0: 20,
            x1: 598,
            y0: 120,
            y1: 2080,
        });
    });
});

describe('frontCoverageIssues (07 §4.1, for validateFurniture)', () => {
    const issuesOf = (doc: FurnitureDocument) =>
        frontCoverageIssues(doc, layoutSections(doc, catalog));

    it('finds nothing on the wardrobe fixture', () => {
        expect(issuesOf(wardrobeFixture())).toEqual([]);
    });

    it('flags an L-shaped cover as front_not_rectangle', () => {
        const doc = columnAndRowsBox([
            frontOn(FR1, ['s_0000000002', 's_0000000004']),
        ]);
        expect(issuesOf(doc)).toEqual([
            {
                code: 'furniture.front_not_rectangle',
                severity: 'error',
                messageKey: 'engine.furniture.issue.front_not_rectangle',
                params: { frontId: FR1 },
                entityIds: [FR1],
            },
        ]);
    });

    it('counts the dividers inside the rectangle (two rows of one column)', () => {
        const doc = columnAndRowsBox([
            frontOn(FR1, ['s_0000000004', 's_0000000005']),
        ]);
        expect(issuesOf(doc)).toEqual([]);
    });

    it('counts a leaf once when its ancestor is listed too', () => {
        const doc = columnAndRowsBox([
            frontOn(FR1, ['s_0000000003', 's_0000000004']),
        ]);
        expect(issuesOf(doc)).toEqual([]);
    });

    it('flags two fronts sharing a leaf (directly or via an ancestor) as front_overlap', () => {
        const doc = columnAndRowsBox([
            frontOn(FR1, ['s_0000000003']),
            frontOn(FR2, ['s_0000000005']),
        ]);
        expect(issuesOf(doc)).toEqual([
            {
                code: 'furniture.front_overlap',
                severity: 'error',
                messageKey: 'engine.furniture.issue.front_overlap',
                params: { frontIds: `${FR1},${FR2}` },
                entityIds: [FR1, FR2],
            },
        ]);
    });

    it('does not touch a generation context (pure)', () => {
        const doc = columnAndRowsBox([
            frontOn(FR1, ['s_0000000002', 's_0000000004']),
        ]);
        const layout = layoutSections(doc, catalog);
        const before = JSON.stringify(doc);
        frontCoverageIssues(doc, layout);
        expect(JSON.stringify(doc)).toBe(before);
    });
});
