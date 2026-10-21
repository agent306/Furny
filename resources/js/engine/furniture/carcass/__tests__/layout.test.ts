import { describe, expect, it } from 'vitest';
import * as engine from '../../../index';
import { seedCatalog } from '../../../testing/seedCatalog';
import { createGenContext } from '../../context';
import type { Section, SectionChild } from '../../schema';
import {
    assign,
    boxDocument,
    fixed,
    flex,
    leafSection,
    splitSection,
    wardrobeFixture,
} from '../../testing/docs';
import { boxOfPart, partOf, runCarcass } from '../../testing/carcassRun';
import { computeEnvelope } from '../envelope';
import { makePart } from '../../parts';
import type { GenContext, Part } from '../../types';
import {
    allocate,
    layoutFromEnvelope,
    layoutSections,
    recordEndJoints,
    type SectionLabel,
} from '../layout';

const catalog = seedCatalog();
const B = 'EB08-WHITE';

/** English rendering of the label data, as the editor's layout tree shows it (07 §3.7 rule 6). */
function render(label: SectionLabel): string {
    const own =
        label.key === 'sections.interior'
            ? 'Interior'
            : label.key === 'sections.column'
              ? `Column ${label.params.n}`
              : `Row ${label.params.n}`;
    const parent = label.parentLabel;
    return parent && parent.key !== 'sections.interior'
        ? `${render(parent)} › ${own}`
        : own;
}

type Size = SectionChild['size'];
const sizeOf = (sizes: Size[]) => sizes.map((size) => ({ size }));

describe('allocate (07 §3.7 rule 3)', () => {
    it('splits equal flex children, the leftover going +1 mm each in order', () => {
        expect(allocate(sizeOf([flex(), flex(), flex()]), 1000)).toEqual({
            sizes: [334, 333, 333],
            overBy: null,
            adjusted: false,
        });
        expect(allocate(sizeOf([flex(), flex(), flex()]), 1001).sizes).toEqual([
            334, 334, 333,
        ]);
    });

    it('weights the flex children: wardrobe columns 582 / 1164', () => {
        expect(allocate(sizeOf([flex(1), flex(2)]), 1746).sizes).toEqual([
            582, 1164,
        ]);
        // 333.33 / 666.67 floored, the leftover millimetre goes to the first
        expect(allocate(sizeOf([flex(1), flex(2)]), 1000).sizes).toEqual([
            334, 666,
        ]);
    });

    it('gives fixed children their mm and shares the rest among the flex ones', () => {
        expect(allocate(sizeOf([fixed(350), flex()]), 1946)).toEqual({
            sizes: [350, 1596],
            overBy: null,
            adjusted: false,
        });
        expect(
            allocate(sizeOf([fixed(100), flex(), flex()]), 1001).sizes,
        ).toEqual([100, 451, 450]);
    });

    it('hands the leftover to the first flex child, skipping fixed ones', () => {
        expect(
            allocate(sizeOf([fixed(10), flex(), flex(), flex()]), 1001).sizes,
        ).toEqual([10, 331, 330, 330]);
        expect(
            allocate(sizeOf([flex(), fixed(10), flex(), flex()]), 1001).sizes,
        ).toEqual([331, 10, 330, 330]);
    });

    it('fixed sizes that exceed the space are an error with a proportional fallback', () => {
        expect(allocate(sizeOf([fixed(600), fixed(500)]), 1000)).toEqual({
            sizes: [545, 454],
            overBy: 100,
            adjusted: false,
        });
        // flex weights count as weights next to the fixed mm
        const mixed = allocate(sizeOf([fixed(800), fixed(300), flex()]), 1000);
        expect(mixed.overBy).toBe(100);
        expect(mixed.sizes).toEqual([726, 272, 0]);
    });

    it('flex-only children without room get 0 and no fixed-size error (Task 33 M6)', () => {
        expect(allocate(sizeOf([flex(), flex(), flex()]), -78)).toEqual({
            sizes: [0, 0, 0],
            overBy: null,
            adjusted: false,
        });
        expect(allocate(sizeOf([flex(1), flex(2)]), 0)).toEqual({
            sizes: [0, 0],
            overBy: null,
            adjusted: false,
        });
    });

    it('never gives a negative size when the fixed sizes and the dividers exceed the space', () => {
        expect(allocate(sizeOf([fixed(100), flex()]), -50)).toEqual({
            sizes: [0, 0],
            overBy: 150,
            adjusted: false,
        });
    });

    it('all-fixed children: the last one absorbs the remainder', () => {
        expect(allocate(sizeOf([fixed(400), fixed(500)]), 1000)).toEqual({
            sizes: [400, 600],
            overBy: null,
            adjusted: true,
        });
        expect(allocate(sizeOf([fixed(400), fixed(600)]), 1000)).toEqual({
            sizes: [400, 600],
            overBy: null,
            adjusted: false,
        });
        expect(allocate(sizeOf([fixed(300)]), 1000)).toEqual({
            sizes: [1000],
            overBy: null,
            adjusted: true,
        });
    });

    it('a flex child present means nothing is adjusted', () => {
        expect(allocate(sizeOf([fixed(400), flex()]), 1000).adjusted).toBe(
            false,
        );
    });

    it('survives degenerate input', () => {
        expect(allocate([], 1000)).toEqual({
            sizes: [],
            overBy: null,
            adjusted: false,
        });
        // zero total weight: equal shares instead of NaN, never negative
        expect(allocate(sizeOf([fixed(0), fixed(0)]), -10)).toEqual({
            sizes: [0, 0],
            overBy: 10,
            adjusted: false,
        });
    });
});

describe('layout of the wardrobe fixture (07 §12.2)', () => {
    const doc = wardrobeFixture();
    const { ctx, layout } = runCarcass(doc);

    it('columns are 582 / 1164 and the rows of the second column 350 / 1596', () => {
        const box = (id: string) => layout.byId.get(id)?.box;
        expect(box('s_0000000001')).toEqual({
            min: [18, 118, 13],
            size: [1764, 1964, 569],
        });
        expect(box('s_0000000002')).toEqual({
            min: [18, 118, 13],
            size: [582, 1964, 569],
        });
        expect(box('s_0000000003')).toEqual({
            min: [618, 118, 13],
            size: [1164, 1964, 569],
        });
        expect(box('s_0000000004')).toEqual({
            min: [618, 1732, 13],
            size: [1164, 350, 569],
        });
        expect(box('s_0000000005')).toEqual({
            min: [618, 118, 13],
            size: [1164, 1596, 569],
        });
    });

    it('records pre-order, parents, indices and leaf flags', () => {
        expect(layout.preorder).toEqual([
            's_0000000001',
            's_0000000002',
            's_0000000003',
            's_0000000004',
            's_0000000005',
        ]);
        const info = (id: string) => {
            const i = layout.byId.get(id);
            return i && [i.leaf, i.parentId, i.index];
        };
        expect(info('s_0000000001')).toEqual([false, null, 0]);
        expect(info('s_0000000002')).toEqual([true, 's_0000000001', 1]);
        expect(info('s_0000000003')).toEqual([false, 's_0000000001', 2]);
        expect(info('s_0000000004')).toEqual([true, 's_0000000003', 1]);
        expect(info('s_0000000005')).toEqual([true, 's_0000000003', 2]);
        expect(layout.byId.size).toBe(5);
    });

    it('labels read Interior, Column 1 and Column 2 › Row 1', () => {
        const label = (id: string) => {
            const l = layout.byId.get(id)?.label;
            return l && render(l);
        };
        expect(label('s_0000000001')).toBe('Interior');
        expect(label('s_0000000002')).toBe('Column 1');
        expect(label('s_0000000003')).toBe('Column 2');
        expect(label('s_0000000004')).toBe('Column 2 › Row 1');
        expect(label('s_0000000005')).toBe('Column 2 › Row 2');
        expect(layout.byId.get('s_0000000004')?.label).toEqual({
            key: 'sections.row',
            params: { n: 1 },
            parentLabel: {
                key: 'sections.column',
                params: { n: 2 },
                parentLabel: {
                    key: 'sections.interior',
                    params: {},
                    parentLabel: null,
                },
            },
        });
    });

    it('lists the dividers: partition 1 of the root, fixed shelf 1 of the second column', () => {
        expect(layout.dividers).toEqual([
            {
                key: 'section.s_0000000001.partition.1',
                kind: 'partition',
                sectionId: 's_0000000001',
                index: 1,
                box: { min: [600, 118, 13], size: [18, 1964, 569] },
            },
            {
                key: 'section.s_0000000003.fixed_shelf.1',
                kind: 'fixed_shelf',
                sectionId: 's_0000000003',
                index: 1,
                box: { min: [618, 1714, 13], size: [1164, 18, 569] },
            },
        ]);
    });

    it('fills ctx.sections with the leaves in pre-order', () => {
        expect(ctx.sections).toEqual([
            {
                id: 's_0000000002',
                box: { min: [18, 118, 13], size: [582, 1964, 569] },
            },
            {
                id: 's_0000000004',
                box: { min: [618, 1732, 13], size: [1164, 350, 569] },
            },
            {
                id: 's_0000000005',
                box: { min: [618, 118, 13], size: [1164, 1596, 569] },
            },
        ]);
    });

    it('partition 1: 1964 x 569, front banded, hidden, x [600, 618]', () => {
        const p = partOf(ctx, 'section.s_0000000001.partition.1');
        expect([p.length, p.width, p.thickness]).toEqual([1964, 569, 18]);
        expect(p.edges).toEqual({ L1: B, L2: null, W1: null, W2: null });
        expect(p.visibleFaces).toBe(0);
        expect(p.role).toBe('carcass');
        expect(p.nameKey).toBe('parts.partition');
        expect(p.nameParams).toEqual({ n: 1 });
        expect(boxOfPart(p)).toEqual({
            min: [600, 118, 13],
            size: [18, 1964, 569],
        });
        expect(ctx.edgeMap.get(p.key)).toEqual({
            L1: 'front',
            L2: 'back',
            W1: 'top',
            W2: 'bottom',
        });
    });

    it('fixed shelf 1: 1164 x 569, front banded, hidden, y [1714, 1732]', () => {
        const s = partOf(ctx, 'section.s_0000000003.fixed_shelf.1');
        expect([s.length, s.width, s.thickness]).toEqual([1164, 569, 18]);
        expect(s.edges).toEqual({ L1: B, L2: null, W1: null, W2: null });
        expect(s.visibleFaces).toBe(0);
        expect(s.role).toBe('shelf');
        expect(s.nameKey).toBe('parts.fixed_shelf');
        expect(s.nameParams).toEqual({ n: 1 });
        expect(boxOfPart(s)).toEqual({
            min: [618, 1714, 13],
            size: [1164, 18, 569],
        });
    });

    it('records the four divider joints after the carcass ones, each once', () => {
        expect(ctx.joints.slice(4)).toEqual([
            {
                member: 'section.s_0000000001.partition.1',
                other: 'carcass.bottom',
                length: 569,
            },
            {
                member: 'section.s_0000000001.partition.1',
                other: 'carcass.top',
                length: 569,
            },
            {
                member: 'section.s_0000000003.fixed_shelf.1',
                other: 'section.s_0000000001.partition.1',
                length: 569,
            },
            {
                member: 'section.s_0000000003.fixed_shelf.1',
                other: 'carcass.side.right',
                length: 569,
            },
        ]);
        expect(ctx.joints).toHaveLength(8);
    });

    it("layout issues: none (the back split is the back generator's info)", () => {
        expect(
            ctx.issues.filter((i) => i.code !== 'furniture.back_split'),
        ).toEqual([]);
    });
});

describe('dividers in a nested layout', () => {
    // rows [top: columns [a | b], bottom] in a 1000 x 720 x 560 box
    const rowsDoc = (shelf = 'PB18-WHITE') =>
        boxDocument({
            width: 1000,
            height: 720,
            depth: 560,
            materials: { shelf: assign(shelf) },
            interior: splitSection('s_0000000001', 'rows', [
                [
                    flex(),
                    splitSection('s_0000000002', 'columns', [
                        [flex(), leafSection('s_0000000003')],
                        [flex(), leafSection('s_0000000004')],
                    ]),
                ],
                [flex(), leafSection('s_0000000005')],
            ]),
        });

    it('a partition inside a row meets the fixed shelf below and the top above', () => {
        const { ctx, layout } = runCarcass(rowsDoc());
        expect(layout.byId.get('s_0000000002')?.box).toEqual({
            min: [18, 369, 13],
            size: [964, 333, 547],
        });
        expect(layout.dividers.map((d) => d.key)).toEqual([
            'section.s_0000000001.fixed_shelf.1',
            'section.s_0000000002.partition.1',
        ]);
        expect(
            ctx.joints.filter((j) => j.member.includes('partition')),
        ).toEqual([
            {
                member: 'section.s_0000000002.partition.1',
                other: 'section.s_0000000001.fixed_shelf.1',
                length: 547,
            },
            {
                member: 'section.s_0000000002.partition.1',
                other: 'carcass.top',
                length: 547,
            },
        ]);
        expect(
            ctx.joints.filter((j) => j.member.includes('fixed_shelf')),
        ).toEqual([
            {
                member: 'section.s_0000000001.fixed_shelf.1',
                other: 'carcass.side.left',
                length: 547,
            },
            {
                member: 'section.s_0000000001.fixed_shelf.1',
                other: 'carcass.side.right',
                length: 547,
            },
        ]);
        expect(
            render(layout.byId.get('s_0000000004')?.label as SectionLabel),
        ).toBe('Row 1 › Column 2');
    });

    it('rows use the shelf thickness, columns the carcass thickness', () => {
        const { ctx, layout } = runCarcass(rowsDoc('PB25-WHITE'));
        const shelf = layout.dividers.find((d) => d.kind === 'fixed_shelf');
        expect(shelf?.box.size[1]).toBe(25);
        const partition = layout.dividers.find((d) => d.kind === 'partition');
        expect(partition?.box.size[0]).toBe(18);
        // avail = 684 - 25 = 659 -> 330 / 329 (the leftover goes to the first)
        expect(layout.byId.get('s_0000000002')?.box.size[1]).toBe(330);
        expect(layout.byId.get('s_0000000005')?.box.size[1]).toBe(329);
        expect(
            partOf(ctx, 'section.s_0000000001.fixed_shelf.1').thickness,
        ).toBe(25);
    });

    it('a single child gets all the space and no divider', () => {
        const doc = boxDocument({
            width: 600,
            height: 720,
            depth: 560,
            interior: splitSection('s_0000000001', 'columns', [
                [fixed(100), leafSection('s_0000000002')],
            ]),
        });
        const { ctx, layout } = runCarcass(doc);
        expect(layout.dividers).toEqual([]);
        expect(layout.byId.get('s_0000000002')?.box.size[0]).toBe(564);
        expect(ctx.parts.filter((p) => p.key.startsWith('section.'))).toEqual(
            [],
        );
    });

    it('oak boards follow the divider grain: the long side of a partition or fixed shelf', () => {
        const oak = wardrobeFixture((d) => {
            d.materials.carcass = assign('PB18-OAK');
            d.materials.shelf = assign('PB18-OAK');
        });
        const { ctx } = runCarcass(oak);
        // 1964 x 569 with the grain vertical; 1164 x 569 with the grain along x
        expect(partOf(ctx, 'section.s_0000000001.partition.1').grain).toBe(
            'length',
        );
        expect(partOf(ctx, 'section.s_0000000003.fixed_shelf.1').grain).toBe(
            'length',
        );
        // a partition shorter than it is deep: the grain runs along its width
        const low = rowsDoc();
        low.materials.carcass = assign('PB18-OAK');
        expect(
            partOf(runCarcass(low).ctx, 'section.s_0000000002.partition.1')
                .grain,
        ).toBe('width');
    });

    it('two columns split in rows: one full-height partition, the shelves end on it', () => {
        // two columns, each split in rows: only the full-height partition exists
        const doc = boxDocument({
            width: 1000,
            height: 720,
            depth: 560,
            interior: splitSection('s_0000000001', 'columns', [
                [
                    flex(),
                    splitSection('s_0000000002', 'rows', [
                        [flex(), leafSection('s_0000000003')],
                        [flex(), leafSection('s_0000000004')],
                    ]),
                ],
                [
                    flex(),
                    splitSection('s_0000000005', 'rows', [
                        [flex(), leafSection('s_0000000006')],
                        [flex(), leafSection('s_0000000007')],
                    ]),
                ],
            ]),
        });
        const { ctx } = runCarcass(doc);
        const joints = (key: string) =>
            ctx.joints.filter((j) => j.member === key).map((j) => j.other);
        expect(joints('section.s_0000000001.partition.1')).toEqual([
            'carcass.bottom',
            'carcass.top',
        ]);
        // the left shelf ends on the left side and the partition
        expect(joints('section.s_0000000002.fixed_shelf.1')).toEqual([
            'carcass.side.left',
            'section.s_0000000001.partition.1',
        ]);
        expect(joints('section.s_0000000005.fixed_shelf.1')).toEqual([
            'section.s_0000000001.partition.1',
            'carcass.side.right',
        ]);
    });
});

describe('layout issues', () => {
    const colsDoc = (a: Size, b: Size) =>
        boxDocument({
            width: 1000,
            height: 720,
            depth: 560,
            interior: splitSection('s_0000000001', 'columns', [
                [a, leafSection('s_0000000002')],
                [b, leafSection('s_0000000003')],
            ]),
        });

    it('fixed sizes that exceed the space: error, proportional boxes', () => {
        const { ctx, layout } = runCarcass(colsDoc(fixed(600), fixed(500)));
        expect(ctx.issues).toEqual([
            {
                code: 'furniture.fixed_sizes_exceed',
                severity: 'error',
                messageKey: 'engine.furniture.issue.fixed_sizes_exceed',
                params: { sectionId: 's_0000000001', overBy: 154 },
                entityIds: ['s_0000000001'],
            },
        ]);
        // avail 946: fl(946 x 600/1100) = 516, fl(946 x 500/1100) = 430
        expect(layout.byId.get('s_0000000002')?.box.size[0]).toBe(516);
        expect(layout.byId.get('s_0000000003')?.box.size[0]).toBe(430);
    });

    it('all-fixed children that do not add up: info, the last one adjusts', () => {
        const { ctx, layout } = runCarcass(colsDoc(fixed(300), fixed(400)));
        expect(ctx.issues).toEqual([
            {
                code: 'furniture.fixed_sizes_adjusted',
                severity: 'info',
                messageKey: 'engine.furniture.issue.fixed_sizes_adjusted',
                params: { sectionId: 's_0000000001' },
                entityIds: ['s_0000000001'],
            },
        ]);
        expect(layout.byId.get('s_0000000003')?.box.size[0]).toBe(646);
    });

    it('all-fixed children that add up exactly: no issue', () => {
        const { ctx } = runCarcass(colsDoc(fixed(300), fixed(646)));
        expect(ctx.issues).toEqual([]);
    });
});

describe('layoutSections (public)', () => {
    it('returns the same layout as the pipeline, without needing a context', () => {
        const doc = wardrobeFixture();
        const layout = layoutSections(doc, catalog);
        expect(layout.preorder).toHaveLength(5);
        expect(layout.byId.get('s_0000000003')?.box).toEqual({
            min: [618, 118, 13],
            size: [1164, 1964, 569],
        });
        expect(layout.dividers.map((d) => d.key)).toEqual([
            'section.s_0000000001.partition.1',
            'section.s_0000000003.fixed_shelf.1',
        ]);
    });

    it('is exported from the engine index', () => {
        expect(engine.layoutSections).toBe(layoutSections);
    });

    it('is empty when the envelope is too small', () => {
        const doc = boxDocument({ width: 100, height: 720, depth: 560 });
        const layout = layoutSections(doc, catalog);
        expect(layout.byId.size).toBe(0);
        expect(layout.preorder).toEqual([]);
        expect(layout.dividers).toEqual([]);
    });

    it('throws for a document without a carcass', () => {
        const doc = { ...wardrobeFixture(), family: 'table' as const };
        doc.carcass = null;
        expect(() => layoutSections(doc, catalog)).toThrow(/carcass/);
    });

    it('layoutFromEnvelope on an undivided interior is one leaf', () => {
        const ctx = createGenContext(
            boxDocument({ width: 600, height: 720, depth: 560 }),
            catalog,
        );
        const env = computeEnvelope(ctx);
        if (!env) throw new Error('no envelope');
        const layout = layoutFromEnvelope(ctx, env);
        expect(layout.preorder).toEqual(['s_0000000001']);
        expect(layout.byId.get('s_0000000001')).toMatchObject({
            leaf: true,
            parentId: null,
            index: 0,
        });
    });

    it('treats a section with children but split none as a leaf', () => {
        const odd: Section = {
            ...leafSection('s_0000000001'),
            children: [{ size: flex(), section: leafSection('s_0000000002') }],
        };
        const layout = layoutSections(
            boxDocument({
                width: 600,
                height: 720,
                depth: 560,
                interior: odd,
            }),
            catalog,
        );
        expect(layout.preorder).toEqual(['s_0000000001']);
    });
});

describe('recordEndJoints contact rules (07 §3.8)', () => {
    const ctxOf = () =>
        createGenContext(
            boxDocument({ width: 600, height: 720, depth: 560 }),
            catalog,
        );
    /** A member 18 x 100 x 500 at the origin; its top end is the plane y = 100. */
    const member = (ctx: GenContext): Part => {
        const part = makePart(
            {
                key: 'm',
                nameKey: 'parts.partition',
                role: 'carcass',
                materialCode: 'PB18-WHITE',
                box: { min: [0, 0, 0], size: [18, 100, 500] },
                thicknessAxis: 'x',
                grainAxis: 'y',
                banded: [],
                visibleFaces: 0,
            },
            ctx,
        );
        ctx.parts.push(part);
        return part;
    };
    /** A panel lying above `y`, spanning x and z as given. */
    const above = (
        ctx: GenContext,
        y: number,
        x: [number, number],
        z: [number, number],
    ): void => {
        ctx.parts.push(
            makePart(
                {
                    key: 'o',
                    nameKey: 'parts.top',
                    role: 'carcass',
                    materialCode: 'PB18-WHITE',
                    box: {
                        min: [x[0], y, z[0]],
                        size: [x[1] - x[0], 18, z[1] - z[0]],
                    },
                    thicknessAxis: 'y',
                    grainAxis: 'x',
                    banded: [],
                    visibleFaces: 0,
                },
                ctx,
            ),
        );
    };
    const joints = (y: number, x: [number, number], z: [number, number]) => {
        const ctx = ctxOf();
        const m = member(ctx);
        above(ctx, y, x, z);
        recordEndJoints(ctx, m, 'y');
        return ctx.joints;
    };

    it('records the contact with the shared edge as its length', () => {
        expect(joints(100, [0, 100], [0, 500])).toEqual([
            { member: 'm', other: 'o', length: 500 },
        ]);
        // partial overlap in z: the shared edge is 300 mm
        expect(joints(100, [0, 100], [200, 900])).toEqual([
            { member: 'm', other: 'o', length: 300 },
        ]);
    });

    it('contacts that touch only at a corner or along an edge are no joint', () => {
        // starts where the member ends in x: z overlaps, x does not
        expect(joints(100, [18, 100], [0, 500])).toEqual([]);
        // starts where the member ends in z: x overlaps, z does not
        expect(joints(100, [0, 100], [500, 900])).toEqual([]);
        // both: only the corner line touches
        expect(joints(100, [18, 100], [500, 900])).toEqual([]);
    });

    it('faces match within 0.5 mm: 0.4 mm apart is a joint, 0.6 mm is not', () => {
        expect(joints(100.4, [0, 100], [0, 500])).toHaveLength(1);
        expect(joints(99.6, [0, 100], [0, 500])).toHaveLength(1);
        expect(joints(100.6, [0, 100], [0, 500])).toEqual([]);
        expect(joints(99.4, [0, 100], [0, 500])).toEqual([]);
    });

    it('a panel overlapping the member body is not on the far side of the end', () => {
        expect(joints(50, [0, 100], [0, 500])).toEqual([]);
    });

    it('records each pair once', () => {
        const ctx = ctxOf();
        const m = member(ctx);
        above(ctx, 100, [0, 100], [0, 500]);
        recordEndJoints(ctx, m, 'y');
        recordEndJoints(ctx, m, 'y');
        expect(ctx.joints).toHaveLength(1);
    });
});

describe('ctx.sections rounding', () => {
    it('floors the leaf sizes and keeps the minimum', () => {
        const ctx = createGenContext(
            boxDocument({ width: 600, height: 720, depth: 560 }),
            catalog,
        );
        const env = computeEnvelope(ctx);
        if (!env) throw new Error('no envelope');
        const layout = layoutFromEnvelope(ctx, {
            ...env,
            interior: { min: [18, 18, 13], size: [564.7, 684.9, 547.5] },
        });
        expect(ctx.sections).toEqual([
            {
                id: 's_0000000001',
                box: { min: [18, 18, 13], size: [564, 684, 547] },
            },
        ]);
        // the layout keeps the exact box
        expect(layout.byId.get('s_0000000001')?.box.size).toEqual([
            564.7, 684.9, 547.5,
        ]);
    });
});
