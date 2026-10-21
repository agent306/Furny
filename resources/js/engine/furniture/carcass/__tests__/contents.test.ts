import { describe, expect, it } from 'vitest';
import type { CatalogSnapshot } from '../../../catalog/snapshot';
import { mutateCatalog, seedCatalog } from '../../../testing/seedCatalog';
import { createGenContext } from '../../context';
import type { Content, Front } from '../../schema';
import type { GenContext, Part } from '../../types';
import {
    boxDocument,
    flex,
    leafSection,
    splitSection,
    wardrobeFixture,
} from '../../testing/docs';
import { boxOfPart, partOf, runCarcass } from '../../testing/carcassRun';
import { computeEnvelope } from '../envelope';
import { layoutFromEnvelope } from '../layout';
import { carcassPanels } from '../panels';
import { makePart } from '../../parts';
import { contentDepth, shelvesFor } from '../contents';

const catalog = seedCatalog();
const B = 'EB08-WHITE';
const ROOT = 's_0000000001';

type Shelves = Extract<Content, { type: 'shelves' }>;
const shelves = (over: Partial<Shelves> = {}): Content => ({
    type: 'shelves',
    count: 3,
    adjustable: true,
    frontSetback: 20,
    ...over,
});
const rod = (rodCode: string | null = null): Content => ({
    type: 'hanging_rod',
    topClearance: 60,
    rodCode,
});
const baskets = (count: number, basketCode: string | null = null): Content => ({
    type: 'pull_out_basket',
    count,
    basketCode,
});

/** A box whose leaf is `leafW x leafH x leafCd` inside (t = 18, grooved back, no fronts). */
function leafBox(
    content: Content,
    leaf: { w?: number; h?: number; cd?: number } = {},
    fronts: Front[] = [],
) {
    const { w = 564, h = 684, cd = 547 } = leaf;
    return boxDocument({
        width: w + 36,
        height: h + 36,
        depth: cd + 13,
        content,
        fronts,
    });
}

const front = (over: Partial<Front> = {}): Front => ({
    id: 'fr_0000000001',
    kind: 'hinged',
    covers: [ROOT],
    leaves: 1,
    hingeSide: 'left',
    overlay: 'full',
    glass: false,
    handleCode: 'inherit',
    hingeCode: 'auto',
    slidingTrackCode: null,
    ...over,
});

/** Issue codes of the content generators (the back split info is not theirs). */
const codes = (ctx: { issues: Array<{ code: string }> }): string[] =>
    ctx.issues.map((i) => i.code).filter((c) => c !== 'furniture.back_split');

/** z size of a part's box: the shelf depth. */
const depthOf = (ctx: Parameters<typeof partOf>[0], key: string) =>
    boxOfPart(partOf(ctx, key))?.size[2];

const hw = (ctx: Pick<GenContext, 'hardware'>, key: string) =>
    ctx.hardware.find((h) => h.key === key);

/** The seed catalog where the hardware rows `codes` are no longer role defaults. */
const withoutDefault = (...codes: string[]): CatalogSnapshot =>
    mutateCatalog(catalog, (draft) => {
        for (const h of draft.hardware) {
            if (codes.includes(h.code)) h.isDefaultFor = [];
        }
    });

describe('shelvesFor (07 §3.9) in the wardrobe', () => {
    const { ctx } = runCarcass(wardrobeFixture());
    const key = (i: number) => `section.s_0000000002.shelf.${i}`;

    it('makes four shelves 580 x 549, front banded, hidden', () => {
        const keys = ctx.parts
            .filter((p) => p.key.includes('.shelf.'))
            .map((p) => p.key);
        expect(keys).toEqual([1, 2, 3, 4].map(key));
        for (const i of [1, 2, 3, 4]) {
            const s = partOf(ctx, key(i));
            expect([s.length, s.width, s.thickness]).toEqual([580, 549, 18]);
            expect(s.edges).toEqual({ L1: B, L2: null, W1: null, W2: null });
            expect(s.visibleFaces).toBe(0);
            expect(s.role).toBe('shelf');
            expect(s.nameKey).toBe('parts.shelf');
            expect(s.nameParams).toEqual({ n: i });
            expect(s.operations.shelfPinHoles).toBe(0);
        }
    });

    it('places them evenly from the top: gap (1964 - 4 x 18) / 5 = 378.4', () => {
        const ys = [1, 2, 3, 4].map((i) => boxOfPart(partOf(ctx, key(i))));
        const g = 378.4;
        ys.forEach((b, idx) => {
            const i = idx + 1;
            const top = 2082 - i * g - (i - 1) * 18;
            expect(b?.min[1]).toBeCloseTo(top - 18, 6);
            expect(b?.size[1]).toBe(18);
            expect(b?.min[0]).toBe(19); // adjustable: 1 mm clearance per side
            expect(b?.size[0]).toBe(580);
            expect(b?.min[2]).toBe(13);
            expect(b?.size[2]).toBe(549); // 569 - setback 20
        });
    });

    it('adds 4 shelf pins per shelf and 116 pin holes on each bounding vertical', () => {
        expect(hw(ctx, 'section.s_0000000002.shelf_supports')).toEqual({
            key: 'section.s_0000000002.shelf_supports',
            code: 'SHF-PIN-5',
            qty: 16,
            reasonKey: 'hardware.reason.shelf_supports',
            reasonParams: { shelves: 4 },
            frontId: null,
            sectionId: 's_0000000002',
            source: 'generated',
            overridden: false,
        });
        expect(partOf(ctx, 'carcass.side.left').operations.shelfPinHoles).toBe(
            116,
        );
        expect(
            partOf(ctx, 'section.s_0000000001.partition.1').operations
                .shelfPinHoles,
        ).toBe(116);
        expect(partOf(ctx, 'carcass.side.right').operations.shelfPinHoles).toBe(
            0,
        );
    });

    it('adjustable shelves record no joints', () => {
        expect(ctx.joints).toHaveLength(8);
    });
});

describe('shelvesFor', () => {
    it('18 shelves do not fit a 300 mm leaf: error and nothing generated', () => {
        const { ctx } = runCarcass(leafBox(shelves({ count: 18 }), { h: 300 }));
        expect(ctx.issues).toEqual([
            {
                code: 'furniture.shelves_dont_fit',
                severity: 'error',
                messageKey: 'engine.furniture.issue.shelves_dont_fit',
                params: { sectionId: ROOT },
                entityIds: [ROOT],
            },
        ]);
        expect(ctx.parts.filter((p) => p.key.includes('.shelf.'))).toEqual([]);
        expect(ctx.hardware.filter((h) => h.key.includes('shelf'))).toEqual([]);
        expect(partOf(ctx, 'carcass.side.left').operations.shelfPinHoles).toBe(
            0,
        );
    });

    it('shelves that exactly fill the leaf (gap 0) are accepted', () => {
        // 16 x 18 = 288 = leaf height; 17 shelves are one too many
        const fits = runCarcass(leafBox(shelves({ count: 16 }), { h: 288 }));
        expect(codes(fits.ctx)).toEqual([]);
        expect(
            fits.ctx.parts.filter((p) => p.key.includes('.shelf.')),
        ).toHaveLength(16);
        const over = runCarcass(leafBox(shelves({ count: 17 }), { h: 288 }));
        expect(codes(over.ctx)).toEqual(['furniture.shelves_dont_fit']);
    });

    it('an adjustable shelf in a 2 mm leaf would be 0 wide: does not fit; 3 mm gives a 1 mm shelf (Task 37 M4)', () => {
        const narrow = (w: number) => {
            const { ctx, layout } = runCarcass(leafBox(shelves({ count: 1 })));
            const root = layout.byId.get(ROOT);
            if (!root) throw new Error('no leaf');
            const before = ctx.issues.length;
            shelvesFor(
                ctx,
                {
                    ...root,
                    box: {
                        min: root.box.min,
                        size: [w, root.box.size[1], root.box.size[2]],
                    },
                },
                shelves({ count: 1, adjustable: true }) as Shelves,
                { keyPrefix: 'test' },
            );
            return {
                codes: ctx.issues.slice(before).map((i) => i.code),
                shelf: ctx.parts.find((p) => p.key === 'test.shelf.1'),
            };
        };
        expect(narrow(2)).toEqual({
            codes: ['furniture.shelves_dont_fit'],
            shelf: undefined,
        });
        expect(narrow(3).codes).toEqual([]);
        expect(narrow(3).shelf?.width).toBe(1);
    });

    it('a shelf is never deeper than the content: depth <= 0 does not fit', () => {
        const { ctx } = runCarcass(
            leafBox(shelves({ frontSetback: 547 }), { cd: 547 }),
        );
        expect(codes(ctx)).toEqual(['furniture.shelves_dont_fit']);
    });

    it('non-adjustable shelves span the leaf and record 2 joints each', () => {
        const { ctx } = runCarcass(
            wardrobeFixture((d) => {
                const col = d.carcass?.interior.children[0]?.section;
                if (col?.content?.type === 'shelves')
                    col.content.adjustable = false;
            }),
        );
        const s = partOf(ctx, 'section.s_0000000002.shelf.1');
        expect([s.length, s.width]).toEqual([582, 549]);
        expect(boxOfPart(s)?.min[0]).toBe(18);
        expect(hw(ctx, 'section.s_0000000002.shelf_supports')).toBeUndefined();
        expect(partOf(ctx, 'carcass.side.left').operations.shelfPinHoles).toBe(
            0,
        );
        const mine = ctx.joints.filter((j) => j.member.includes('.shelf.'));
        expect(mine).toHaveLength(8);
        expect(mine.slice(0, 2)).toEqual([
            {
                member: 'section.s_0000000002.shelf.1',
                other: 'carcass.side.left',
                length: 549,
            },
            {
                member: 'section.s_0000000002.shelf.1',
                other: 'section.s_0000000001.partition.1',
                length: 549,
            },
        ]);
        expect(ctx.joints).toHaveLength(16);
    });

    it('fixed shelves join only what they overlap: not a partition in another row', () => {
        // both rows split in two equal columns, so the partitions line up at
        // the same x; the shelf in the lower left column ends on the lower one
        const doc = boxDocument({
            width: 1000,
            height: 720,
            depth: 560,
            interior: splitSection(ROOT, 'rows', [
                [
                    flex(),
                    splitSection('s_0000000002', 'columns', [
                        [flex(), leafSection('s_0000000003')],
                        [flex(), leafSection('s_0000000004')],
                    ]),
                ],
                [
                    flex(),
                    splitSection('s_0000000005', 'columns', [
                        [
                            flex(),
                            leafSection(
                                's_0000000006',
                                shelves({ count: 1, adjustable: false }),
                            ),
                        ],
                        [flex(), leafSection('s_0000000007')],
                    ]),
                ],
            ]),
        });
        const { ctx } = runCarcass(doc);
        expect(
            ctx.joints
                .filter((j) => j.member === 'section.s_0000000006.shelf.1')
                .map((j) => j.other),
        ).toEqual(['carcass.side.left', 'section.s_0000000005.partition.1']);
    });

    it('pins go to the partition of the leaf row, not one at the same x in another row', () => {
        // both rows split in two equal columns: the partitions line up at x = 491
        const doc = boxDocument({
            width: 1000,
            height: 720,
            depth: 560,
            interior: splitSection(ROOT, 'rows', [
                [
                    flex(),
                    splitSection('s_0000000002', 'columns', [
                        [flex(), leafSection('s_0000000003')],
                        [flex(), leafSection('s_0000000004')],
                    ]),
                ],
                [
                    flex(),
                    splitSection('s_0000000005', 'columns', [
                        [flex(), leafSection('s_0000000006', shelves())],
                        [flex(), leafSection('s_0000000007', shelves())],
                    ]),
                ],
            ]),
        });
        const { ctx } = runCarcass(doc);
        // leaf height 333: pr = fl((333 - 128) / 32) + 1 = 7 -> 14 per leaf side
        const pins = (key: string) => partOf(ctx, key).operations.shelfPinHoles;
        expect(pins('section.s_0000000002.partition.1')).toBe(0);
        expect(pins('section.s_0000000005.partition.1')).toBe(28);
        expect(pins('carcass.side.left')).toBe(14);
        expect(pins('carcass.side.right')).toBe(14);
    });

    it('a vertical that touches the leaf side but not the leaf in y or z is no bounding vertical', () => {
        const ctx = createGenContext(leafBox(shelves({ count: 1 })), catalog);
        const env = computeEnvelope(ctx);
        if (!env) throw new Error('no envelope');
        carcassPanels(ctx, env);
        const layout = layoutFromEnvelope(ctx, env);
        const leaf = layout.byId.get(ROOT);
        if (!leaf) throw new Error('no leaf');
        // decoys listed first, so an unchecked search would pick them
        const decoy = (key: string, min: [number, number, number]): Part =>
            makePart(
                {
                    key,
                    nameKey: 'parts.partition',
                    role: 'carcass',
                    materialCode: 'PB18-WHITE',
                    box: { min, size: [18, 100, 100] },
                    thicknessAxis: 'x',
                    grainAxis: 'y',
                    banded: [],
                    visibleFaces: 0,
                },
                ctx,
            );
        // right face at x = 18 (the leaf's left side): one above the leaf, one in front of it
        const above = decoy('section.d.partition.1', [0, 800, 13]);
        const front = decoy('section.d.partition.2', [0, 100, 700]);
        ctx.parts.unshift(front);
        ctx.parts.unshift(above);
        shelvesFor(ctx, leaf, {
            type: 'shelves',
            count: 1,
            adjustable: true,
            frontSetback: 20,
        });
        expect(above.operations.shelfPinHoles).toBe(0);
        expect(front.operations.shelfPinHoles).toBe(0);
        expect(partOf(ctx, 'carcass.side.left').operations.shelfPinHoles).toBe(
            2 * 18,
        );
    });

    it('pin holes per row: none below 128 mm, 1 pair at exactly 128 mm', () => {
        const pins = (h: number) =>
            partOf(
                runCarcass(leafBox(shelves({ count: 1 }), { h })).ctx,
                'carcass.side.left',
            ).operations.shelfPinHoles;
        expect(pins(127)).toBe(0);
        expect(pins(128)).toBe(2);
        expect(pins(159)).toBe(2);
        expect(pins(160)).toBe(4);
        // the 4 pins per shelf are still bought below the margin
        const small = runCarcass(leafBox(shelves({ count: 1 }), { h: 100 }));
        expect(hw(small.ctx, `section.${ROOT}.shelf_supports`)?.qty).toBe(4);
    });

    it('pin holes add up on a partition shared by two shelved columns', () => {
        const doc = boxDocument({
            width: 1000,
            height: 720,
            depth: 560,
            interior: splitSection(ROOT, 'columns', [
                [flex(), leafSection('s_0000000002', shelves())],
                [flex(), leafSection('s_0000000003', shelves())],
            ]),
        });
        const { ctx } = runCarcass(doc);
        // h = 684: pr = fl((684 - 128) / 32) + 1 = 18 -> 36 per leaf side
        const pins = (key: string) => partOf(ctx, key).operations.shelfPinHoles;
        expect(pins('carcass.side.left')).toBe(36);
        expect(pins(`section.${ROOT}.partition.1`)).toBe(72);
        expect(pins('carcass.side.right')).toBe(36);
    });

    it('the content depth loses the front thickness behind an inset front, also via an ancestor', () => {
        const insetDoc = (covers: string) =>
            boxDocument({
                width: 600,
                height: 720,
                depth: 560,
                interior: splitSection(ROOT, 'columns', [
                    [flex(), leafSection('s_0000000002', shelves())],
                    [flex(), leafSection('s_0000000003', shelves())],
                ]),
                fronts: [front({ overlay: 'inset', covers: [covers] })],
            });
        // Dc 560 (inset: no front zone), interior z 547, shelf depth 547 - 20
        const direct = runCarcass(insetDoc('s_0000000002')).ctx;
        expect(depthOf(direct, 'section.s_0000000002.shelf.1')).toBe(509);
        expect(depthOf(direct, 'section.s_0000000003.shelf.1')).toBe(527);
        const viaRoot = runCarcass(insetDoc(ROOT)).ctx;
        expect(depthOf(viaRoot, 'section.s_0000000003.shelf.1')).toBe(509);
        const full = runCarcass(
            boxDocument({
                width: 600,
                height: 720,
                depth: 578,
                content: shelves(),
                fronts: [front()],
            }),
        ).ctx;
        expect(depthOf(full, `section.${ROOT}.shelf.1`)).toBe(527);
    });

    it('the front setback shortens the shelf', () => {
        const { ctx } = runCarcass(leafBox(shelves({ frontSetback: 0 })));
        expect(depthOf(ctx, `section.${ROOT}.shelf.1`)).toBe(547);
    });

    it('a missing shelf support default is omitted with a warning', () => {
        const { ctx } = runCarcass(
            leafBox(shelves()),
            withoutDefault('SHF-PIN-5'),
        );
        expect(hw(ctx, `section.${ROOT}.shelf_supports`)).toBeUndefined();
        expect(ctx.parts.filter((p) => p.key.includes('.shelf.'))).toHaveLength(
            3,
        );
        expect(ctx.issues).toEqual([
            {
                code: 'furniture.no_default_hardware',
                severity: 'warning',
                messageKey: 'engine.furniture.issue.no_default_hardware',
                params: { roleKey: 'shelf_support.default' },
                entityIds: [`section.${ROOT}.shelf_supports`],
            },
        ]);
    });
});

describe('contentDepth', () => {
    it('is the interior depth, less the front thickness behind an inset front', () => {
        const ctx = createGenContext(wardrobeFixture(), catalog);
        const env = computeEnvelope(ctx);
        if (!env) throw new Error('no envelope');
        expect(contentDepth(ctx, env, 's_0000000002')).toBe(569);
        const inset = wardrobeFixture((d) => {
            const f = d.carcass?.fronts[0];
            if (f) f.overlay = 'inset';
        });
        const ictx = createGenContext(inset, catalog);
        const ienv = computeEnvelope(ictx);
        if (!ienv) throw new Error('no envelope');
        expect(contentDepth(ictx, ienv, 's_0000000002')).toBe(551);
        expect(contentDepth(ictx, ienv, 's_0000000003')).toBe(
            ienv.interior.size[2],
        );
    });
});

describe('rodFor (07 §3.10)', () => {
    it('the wardrobe rod: one oval rod and two supports, no warnings', () => {
        const { ctx } = runCarcass(wardrobeFixture());
        expect(hw(ctx, 'section.s_0000000005.rod')).toEqual({
            key: 'section.s_0000000005.rod',
            code: 'ROD-OVAL-1200',
            qty: 1,
            reasonKey: 'hardware.reason.hanging_rod',
            reasonParams: {},
            frontId: null,
            sectionId: 's_0000000005',
            source: 'generated',
            overridden: false,
        });
        expect(hw(ctx, 'section.s_0000000005.rod_supports')).toMatchObject({
            code: 'ROD-SUP',
            qty: 2,
            reasonKey: 'hardware.reason.rod_supports',
            sectionId: 's_0000000005',
        });
        expect(codes(ctx)).toEqual([]);
    });

    it('a 1300 mm wide section needs 2 pieces and warns about the span', () => {
        const { ctx } = runCarcass(leafBox(rod(), { w: 1300, h: 1000 }));
        expect(hw(ctx, `section.${ROOT}.rod`)?.qty).toBe(2);
        expect(hw(ctx, `section.${ROOT}.rod_supports`)?.qty).toBe(4);
        expect(ctx.issues[0]).toEqual({
            code: 'furniture.rod_span_long',
            severity: 'warning',
            messageKey: 'engine.furniture.issue.rod_span_long',
            params: { sectionId: ROOT },
            entityIds: [ROOT],
        });
        expect(codes(ctx)).toEqual(['furniture.rod_span_long']);
    });

    it('1200 mm is the longest single piece, 1201 mm needs two', () => {
        const at = runCarcass(leafBox(rod(), { w: 1200, h: 1000 })).ctx;
        expect(hw(at, `section.${ROOT}.rod`)?.qty).toBe(1);
        expect(codes(at)).toEqual([]);
        const over = runCarcass(leafBox(rod(), { w: 1201, h: 1000 })).ctx;
        expect(hw(over, `section.${ROOT}.rod`)?.qty).toBe(2);
        expect(codes(over)).toEqual(['furniture.rod_span_long']);
    });

    it('a shallow section warns with its depth; 530 mm is enough', () => {
        const { ctx } = runCarcass(leafBox(rod(), { cd: 500, h: 1000 }));
        expect(ctx.issues[0]).toEqual({
            code: 'furniture.rod_section_shallow',
            severity: 'warning',
            messageKey: 'engine.furniture.issue.rod_section_shallow',
            params: { sectionId: ROOT, depth: 500 },
            entityIds: [ROOT],
        });
        expect(codes(ctx)).toEqual(['furniture.rod_section_shallow']);
        expect(
            codes(runCarcass(leafBox(rod(), { cd: 530, h: 1000 })).ctx),
        ).toEqual([]);
        expect(
            codes(runCarcass(leafBox(rod(), { cd: 529, h: 1000 })).ctx),
        ).toEqual(['furniture.rod_section_shallow']);
    });

    it('a short section warns; 900 mm is enough', () => {
        const { ctx } = runCarcass(leafBox(rod(), { h: 850 }));
        expect(ctx.issues[0]).toEqual({
            code: 'furniture.rod_section_short',
            severity: 'warning',
            messageKey: 'engine.furniture.issue.rod_section_short',
            params: { sectionId: ROOT },
            entityIds: [ROOT],
        });
        expect(codes(runCarcass(leafBox(rod(), { h: 900 })).ctx)).toEqual([]);
        expect(codes(runCarcass(leafBox(rod(), { h: 899 })).ctx)).toEqual([
            'furniture.rod_section_short',
        ]);
    });

    it('an inset front takes its thickness from the rod depth', () => {
        // interior depth 547 - 18 = 529 < 530
        const { ctx } = runCarcass(
            leafBox(rod(), { h: 1000 }, [front({ overlay: 'inset' })]),
        );
        expect(ctx.issues[0]).toMatchObject({
            code: 'furniture.rod_section_shallow',
            params: { sectionId: ROOT, depth: 529 },
        });
    });

    it("the rod's maxLengthMm and an explicit rod code decide the pieces", () => {
        const base = catalog.hardware.find((h) => h.code === 'ROD-OVAL-1200');
        if (!base) throw new Error('seed has no rod');
        const custom = mutateCatalog(catalog, (draft) => {
            const row = draft.hardware.find((h) => h.code === base.code);
            if (row) row.specs = { ...base.specs, maxLengthMm: 600 };
            draft.hardware.push({
                ...base,
                id: 'test-rod',
                code: 'ROD-TEST',
                isDefaultFor: [],
                specs: { ...base.specs, maxLengthMm: 500 },
            });
        });
        // 964 wide: default rod 600 -> 2 pieces; ROD-TEST 500 -> 2; width 1100 -> 3
        const byDefault = runCarcass(
            leafBox(rod(), { w: 964, h: 1000 }),
            custom,
        );
        expect(hw(byDefault.ctx, `section.${ROOT}.rod`)).toMatchObject({
            code: 'ROD-OVAL-1200',
            qty: 2,
        });
        const explicit = runCarcass(
            leafBox(rod('ROD-TEST'), { w: 1100, h: 1000 }),
            custom,
        );
        expect(hw(explicit.ctx, `section.${ROOT}.rod`)).toMatchObject({
            code: 'ROD-TEST',
            qty: 3,
        });
        expect(hw(explicit.ctx, `section.${ROOT}.rod_supports`)?.qty).toBe(6);
    });

    it('a rod without maxLengthMm in its specs falls back to 1200 mm pieces', () => {
        const base = catalog.hardware.find((h) => h.code === 'ROD-OVAL-1200');
        if (!base) throw new Error('seed has no rod');
        const bare = mutateCatalog(catalog, (draft) => {
            const row = draft.hardware.find((h) => h.code === base.code);
            if (row) row.specs = { profile: 'oval' };
        });
        // 1100 wide: one piece with the 1200 fallback (two if it were 1000)
        const one = runCarcass(leafBox(rod(), { w: 1100, h: 1000 }), bare);
        expect(hw(one.ctx, `section.${ROOT}.rod`)?.qty).toBe(1);
        const two = runCarcass(leafBox(rod(), { w: 1300, h: 1000 }), bare);
        expect(hw(two.ctx, `section.${ROOT}.rod`)?.qty).toBe(2);
    });

    it('missing rod and support defaults are omitted with warnings', () => {
        const { ctx } = runCarcass(
            leafBox(rod(), { h: 1000 }),
            withoutDefault('ROD-OVAL-1200', 'ROD-SUP'),
        );
        expect(ctx.hardware).toEqual([]);
        expect(
            ctx.issues
                .filter((i) => i.code === 'furniture.no_default_hardware')
                .map((i) => i.params),
        ).toEqual([
            { roleKey: 'rod.default' },
            { roleKey: 'rod_support.default' },
        ]);
    });
});

describe('basketsFor (07 §3.11)', () => {
    // 600 x 750 x 560 with a full-overlay door: leaf 564 x 714 x 529 (base_cabinet basket variant)
    const baseBasket = (count = 2, basketCode: string | null = null) =>
        boxDocument({
            width: 600,
            height: 750,
            depth: 560,
            content: baskets(count, basketCode),
            fronts: [front()],
        });

    it('two baskets in the 564 x 714 x 529 leaf: no warning', () => {
        const { ctx, layout } = runCarcass(baseBasket());
        expect(layout.byId.get(ROOT)?.box.size).toEqual([564, 714, 529]);
        expect(hw(ctx, `section.${ROOT}.baskets`)).toEqual({
            key: `section.${ROOT}.baskets`,
            code: 'BSK-PULL-600',
            qty: 2,
            reasonKey: 'hardware.reason.baskets',
            reasonParams: {},
            frontId: null,
            sectionId: ROOT,
            source: 'generated',
            overridden: false,
        });
        expect(codes(ctx)).toEqual([]);
        // hardware only: no parts for the baskets
        expect(ctx.parts.filter((p) => p.key.includes('basket'))).toEqual([]);
    });

    it('a 500 mm wide leaf does not suit the basket', () => {
        const { ctx } = runCarcass(leafBox(baskets(2), { w: 500, cd: 529 }));
        expect(ctx.issues[0]).toEqual({
            code: 'furniture.basket_size_mismatch',
            severity: 'warning',
            messageKey: 'engine.furniture.issue.basket_size_mismatch',
            params: { sectionId: ROOT },
            entityIds: [ROOT],
        });
        expect(codes(ctx)).toEqual(['furniture.basket_size_mismatch']);
        // the basket is still bought
        expect(hw(ctx, `section.${ROOT}.baskets`)?.qty).toBe(2);
    });

    it.each([
        [549, 1],
        [550, 0],
        [570, 0],
        [571, 1],
    ])('leaf width %i mm gives %i mismatch warnings', (w, n) => {
        const { ctx } = runCarcass(leafBox(baskets(1), { w }));
        expect(
            ctx.issues.filter(
                (i) => i.code === 'furniture.basket_size_mismatch',
            ),
        ).toHaveLength(n);
    });

    it.each([
        [449, 1],
        [450, 0],
    ])('content depth %i mm gives %i mismatch warnings', (cd, n) => {
        const { ctx } = runCarcass(leafBox(baskets(1), { w: 564, cd }));
        expect(
            ctx.issues.filter(
                (i) => i.code === 'furniture.basket_size_mismatch',
            ),
        ).toHaveLength(n);
    });

    it('width and depth both wrong still warn once', () => {
        const { ctx } = runCarcass(leafBox(baskets(1), { w: 400, cd: 300 }));
        expect(
            ctx.issues.filter(
                (i) => i.code === 'furniture.basket_size_mismatch',
            ),
        ).toHaveLength(1);
    });

    it('a basket without width limits only checks the depth (default 450)', () => {
        const base = catalog.hardware.find((h) => h.code === 'BSK-PULL-600');
        if (!base) throw new Error('seed has no basket');
        const free = mutateCatalog(catalog, (draft) => {
            draft.hardware.push({
                ...base,
                id: 'test-basket',
                code: 'BSK-TEST',
                isDefaultFor: [],
                specs: { kind: 'basket' },
            });
        });
        const ok = runCarcass(
            leafBox(baskets(1, 'BSK-TEST'), { w: 300, cd: 450 }),
            free,
        );
        expect(codes(ok.ctx)).toEqual([]);
        expect(hw(ok.ctx, `section.${ROOT}.baskets`)?.code).toBe('BSK-TEST');
        const shallow = runCarcass(
            leafBox(baskets(1, 'BSK-TEST'), { w: 300, cd: 449 }),
            free,
        );
        expect(codes(shallow.ctx)).toEqual(['furniture.basket_size_mismatch']);
    });

    it('5 baskets do not fit a 700 mm high leaf', () => {
        const { ctx } = runCarcass(leafBox(baskets(5), { h: 700 }));
        expect(ctx.issues[0]).toEqual({
            code: 'furniture.baskets_dont_fit',
            severity: 'warning',
            messageKey: 'engine.furniture.issue.baskets_dont_fit',
            params: { sectionId: ROOT },
            entityIds: [ROOT],
        });
        expect(hw(ctx, `section.${ROOT}.baskets`)?.qty).toBe(5);
    });

    it('count x 150 equal to the height still fits', () => {
        expect(codes(runCarcass(leafBox(baskets(5), { h: 750 })).ctx)).toEqual(
            [],
        );
        expect(codes(runCarcass(leafBox(baskets(5), { h: 749 })).ctx)).toEqual([
            'furniture.baskets_dont_fit',
        ]);
    });

    it('zero baskets make no hardware line and no warning', () => {
        const { ctx } = runCarcass(leafBox(baskets(0)));
        expect(ctx.hardware).toEqual([]);
        expect(codes(ctx)).toEqual([]);
    });

    it('a missing basket default is omitted with a warning', () => {
        const { ctx } = runCarcass(
            baseBasket(),
            withoutDefault('BSK-PULL-600'),
        );
        expect(ctx.hardware).toEqual([]);
        expect(ctx.issues.map((i) => [i.code, i.params])).toContainEqual([
            'furniture.no_default_hardware',
            { roleKey: 'basket.default' },
        ]);
    });
});
