import { describe, expect, it } from 'vitest';
import { mutateCatalog, seedCatalog } from '../../../testing/seedCatalog';
import { createGenContext } from '../../context';
import type { Content } from '../../schema';
import {
    boxOfPart,
    hardwareOf,
    partOf,
    runCarcass,
    runWithDrawers,
} from '../../testing/carcassRun';
import {
    BOX_ROOT_ID,
    assign,
    boxDocument,
    drawerTestBox,
    flex,
    frontOn,
    insetBox,
    leafSection,
    splitSection,
    templateWardrobe,
} from '../../testing/docs';
import type { GenContext, Part } from '../../types';
import { drawerFrontRects, drawersFor, selectSlide } from '../drawers';

type Drawers = Extract<Content, { type: 'drawers' }>;

const catalog = seedCatalog();
const ROOT = BOX_ROOT_ID;
const FR1 = 'fr_0000000001';
const B = 'EB08-WHITE';
const P = (j: number, section = ROOT) => `section.${section}.drawer.${j}`;

const drawers = (over: Partial<Drawers> = {}): Drawers => ({
    type: 'drawers',
    count: 3,
    frontHeights: 'equal',
    slideCode: null,
    behindDoor: false,
    ...over,
});

/** 600 x 720 x 560 (07 §12.3) with root drawers `over`. */
const externalBox = (
    over: Partial<Drawers> = {},
    dims: { width?: number; height?: number; depth?: number } = {},
) =>
    boxDocument({
        width: dims.width ?? 600,
        height: dims.height ?? 720,
        depth: dims.depth ?? 560,
        content: drawers(over),
    });

/** Root drawers behind a full-overlay hinged door over the root. */
const behindBox = (over: Partial<Drawers> = {}) =>
    boxDocument({
        width: 600,
        height: 720,
        depth: 560,
        content: drawers({ behindDoor: true, ...over }),
        fronts: [frontOn(FR1, [ROOT])],
    });

const issuesOf = (ctx: GenContext, code: string) =>
    ctx.issues.filter((i) => i.code === code);

const partsOf = (ctx: GenContext, prefix: string): Part[] =>
    ctx.parts.filter((p) => p.key.startsWith(prefix));

/** Compares a part's box with `min` / `size`, allowing float noise. */
function expectBox(
    part: Part,
    min: [number, number, number],
    size: [number, number, number],
): void {
    const box = boxOfPart(part);
    if (!box) throw new Error(`no box for ${part.key}`);
    for (let i = 0; i < 3; i++) {
        expect(box.min[i]).toBeCloseTo(min[i] as number, 6);
        expect(box.size[i]).toBeCloseTo(size[i] as number, 6);
    }
}

describe('external drawers: 07 §12.3 (600 x 720 x 560, three equal drawers)', () => {
    const { ctx, env, openings } = runWithDrawers(drawerTestBox());
    const opening = openings.get(ROOT);

    it('has the §12.3 envelope: fz 18, Dc 542, interior depth 529', () => {
        expect(env.fz).toBe(18);
        expect(env.Dc).toBe(542);
        expect(env.interior.size[2]).toBe(529);
    });

    it('divides the front block x [1.5, 598.5] y [1.5, 718.5] into three fronts', () => {
        if (!opening) throw new Error('no opening');
        const rects = drawerFrontRects(ctx, opening, drawers(), ROOT);
        expect(rects).toHaveLength(3);
        for (const r of rects) {
            expect(r.x0).toBe(1.5);
            expect(r.x1).toBe(598.5);
        }
        // hf = (717 - 4) / 3 = 237.67; y1 of front j = 718.5 - (j - 1)(hf + 2).
        const hf = (717 - 4) / 3;
        rects.forEach((r, i) => {
            expect(r.y1).toBeCloseTo(718.5 - i * (hf + 2), 9);
            expect(r.y0).toBeCloseTo(718.5 - i * (hf + 2) - hf, 9);
        });
    });

    it('makes three 597 x 237 fronts at y = 480, 241, 1', () => {
        expect(ctx.fronts).toEqual(
            [480, 241, 1].map((y, i) => ({
                id: `${P(i + 1)}.front`,
                frontId: null,
                kind: 'drawer',
                rect: { x: 1, y, w: 597, h: 237 },
                partKey: `${P(i + 1)}.front`,
            })),
        );
        for (const j of [1, 2, 3]) {
            const front = partOf(ctx, `${P(j)}.front`);
            expect(front).toMatchObject({
                nameKey: 'parts.drawer_front',
                nameParams: { n: j },
                role: 'front',
                materialCode: 'PB18-WHITE',
                thickness: 18,
                length: 597,
                width: 237,
                edges: { L1: B, L2: B, W1: B, W2: B },
                visibleFaces: 2,
            });
        }
        // Full overlay: in front of the carcass front plane (Dc = 542).
        expectBox(
            partOf(ctx, `${P(1)}.front`),
            [1.5, 480.8333333, 542],
            [597, 237.6666667, 18],
        );
    });

    it('selects SLD-BB-500 (side-mount family bb45) without a depth warning', () => {
        for (const j of [1, 2, 3]) {
            expect(hardwareOf(ctx, `${P(j)}.slides`)).toEqual({
                key: `${P(j)}.slides`,
                code: 'SLD-BB-500',
                qty: 1,
                reasonKey: 'hardware.reason.slides_for_drawer',
                reasonParams: { length: 500 },
                frontId: null,
                sectionId: ROOT,
                source: 'generated',
                overridden: false,
            });
        }
        expect(issuesOf(ctx, 'furniture.drawer_depth_unused')).toEqual([]);
        expect(ctx.issues.map((i) => i.code)).toEqual([]);
    });

    it('gives slots of 221.17 / 237.67 / 221.17 and box heights 180 / 190 / 180', () => {
        const heights = [1, 2, 3].map(
            (j) => partOf(ctx, `${P(j)}.side.left`).width,
        );
        expect(heights).toEqual([180, 190, 180]);
    });

    it('builds drawer 1 sides: 500 x 180 in PLY12-BWR, banded on top only', () => {
        for (const side of ['left', 'right']) {
            expect(partOf(ctx, `${P(1)}.side.${side}`)).toMatchObject({
                nameKey: 'parts.drawer_side',
                role: 'drawer_box',
                materialCode: 'PLY12-BWR',
                thickness: 12,
                length: 500,
                width: 180,
                grain: 'none',
                visibleFaces: 0,
                // The seed PLY12-BWR has no default band: banding stays empty.
                edges: { L1: null, L2: null, W1: null, W2: null },
            });
        }
        // The banded physical edge is `top`, which is L1 of a side.
        expect(ctx.edgeMap.get(`${P(1)}.side.left`)?.L1).toBe('top');
    });

    it('gives the drawer_box role band to the top edge L1', () => {
        const banded = mutateCatalog(catalog, (draft) => {
            for (const m of draft.materials) {
                if (m.code === 'PLY12-BWR') m.defaultEdgeBandCode = B;
            }
        });
        const run = runWithDrawers(drawerTestBox(), banded).ctx;
        for (const key of [
            `${P(1)}.side.left`,
            `${P(1)}.side.right`,
            `${P(1)}.back`,
        ]) {
            expect(partOf(run, key).edges).toEqual({
                L1: B,
                L2: null,
                W1: null,
                W2: null,
            });
            expect(run.edgeMap.get(key)?.L1).toBe('top');
        }
        // The bottom stays unbanded whatever the drawer_box band is.
        expect(partOf(run, `${P(1)}.bottom`).edges).toEqual({
            L1: null,
            L2: null,
            W1: null,
            W2: null,
        });
    });

    it('builds the back 514 x 167 (180 - 10 - 3) and the bottom 524 x 500', () => {
        expect(partOf(ctx, `${P(1)}.back`)).toMatchObject({
            nameKey: 'parts.drawer_back',
            role: 'drawer_box',
            materialCode: 'PLY12-BWR',
            length: 514,
            width: 167,
            visibleFaces: 0,
        });
        expect(partOf(ctx, `${P(1)}.bottom`)).toMatchObject({
            nameKey: 'parts.drawer_bottom',
            role: 'drawer_bottom',
            materialCode: 'HDF3-WHITE',
            thickness: 3,
            length: 524,
            width: 500,
            grain: 'none',
            visibleFaces: 0,
            edges: { L1: null, L2: null, W1: null, W2: null },
        });
    });

    it('places the drawer 1 box: Wb 538 centred, z [42, 542], y from 500.83', () => {
        // bx0 = 18 + (564 - 538) / 2 = 31; slot 1 = [480.83, 702] -> by0 = 480.83 + 20.
        const by0 = 480.8333333 + 20;
        expectBox(
            partOf(ctx, `${P(1)}.side.left`),
            [31, by0, 42],
            [12, 180, 500],
        );
        expectBox(
            partOf(ctx, `${P(1)}.side.right`),
            [557, by0, 42],
            [12, 180, 500],
        );
        // Back: between the sides, on top of the bottom (bo 10 + 3), rear end.
        expectBox(
            partOf(ctx, `${P(1)}.back`),
            [43, by0 + 13, 42],
            [514, 167, 12],
        );
        // Bottom: 5 mm into each side groove, bo 10 above the box bottom.
        expectBox(
            partOf(ctx, `${P(1)}.bottom`),
            [38, by0 + 10, 42],
            [524, 3, 500],
        );
    });

    it('adds one HDL-BAR-160 per 597 mm drawer front and drills its holes', () => {
        for (const j of [1, 2, 3]) {
            expect(hardwareOf(ctx, `${P(j)}.handle`)).toMatchObject({
                code: 'HDL-BAR-160',
                qty: 1,
                reasonKey: 'hardware.reason.handle_for_drawer',
                frontId: null,
                sectionId: ROOT,
            });
            expect(partOf(ctx, `${P(j)}.front`).operations.handleHoles).toBe(2);
        }
    });

    it('adds one slide screw set per drawer to both bounding sides', () => {
        for (const side of ['left', 'right']) {
            expect(
                partOf(ctx, `carcass.side.${side}`).operations.slideScrewSets,
            ).toBe(3);
        }
        // The box parts themselves carry no slide screws.
        expect(partOf(ctx, `${P(1)}.side.left`).operations.slideScrewSets).toBe(
            0,
        );
    });

    it('creates the parts of a drawer in a fixed order', () => {
        expect(partsOf(ctx, P(2)).map((p) => p.key)).toEqual([
            `${P(2)}.side.left`,
            `${P(2)}.side.right`,
            `${P(2)}.back`,
            `${P(2)}.bottom`,
            `${P(2)}.front`,
        ]);
        expect(
            ctx.parts.filter((p) => p.key.includes('.drawer.')),
        ).toHaveLength(15);
    });
});

describe('undermount slides (07 §12.3 variant)', () => {
    const { ctx } = runWithDrawers(externalBox({ slideCode: 'SLD-UM-500' }));

    it('keeps SLD-UM-500 (500 <= 519) without a resize notice', () => {
        expect(hardwareOf(ctx, `${P(1)}.slides`)).toMatchObject({
            code: 'SLD-UM-500',
            qty: 1,
            reasonParams: { length: 500 },
        });
        expect(issuesOf(ctx, 'furniture.slide_resized')).toEqual([]);
        expect(issuesOf(ctx, 'furniture.drawer_depth_unused')).toEqual([]);
    });

    it('gives Win 522, Wb 546, Lb 490, bottom 532 x 490, back 522 x 164', () => {
        expect(partOf(ctx, `${P(1)}.side.left`)).toMatchObject({
            length: 490,
            width: 180,
        });
        expect(partOf(ctx, `${P(1)}.back`)).toMatchObject({
            length: 522,
            width: 164,
        });
        expect(partOf(ctx, `${P(1)}.bottom`)).toMatchObject({
            length: 532,
            width: 490,
        });
        // Wb = 546: sides at x = 18 + (564 - 546) / 2 = 27 and 561.
        expect(boxOfPart(partOf(ctx, `${P(1)}.side.left`))?.min[0]).toBe(27);
        expect(boxOfPart(partOf(ctx, `${P(1)}.side.right`))?.min[0]).toBe(
            27 + 546 - 12,
        );
        // The box ends at the front, Lb 490: z [52, 542].
        expect(boxOfPart(partOf(ctx, `${P(1)}.side.left`))?.min[2]).toBe(52);
    });

    it('recesses the bottom 13 mm (spec bottomRecessMm)', () => {
        const side = partOf(ctx, `${P(1)}.side.left`);
        const bottom = partOf(ctx, `${P(1)}.bottom`);
        const gap =
            (boxOfPart(bottom)?.min[1] as number) -
            (boxOfPart(side)?.min[1] as number);
        expect(gap).toBeCloseTo(13, 9);
    });

    it('warns drawer_side_too_thick when the sides exceed the slide limit (16 mm)', () => {
        const withThickness = (thickness: number) => {
            const thick = mutateCatalog(catalog, (draft) => {
                for (const m of draft.materials) {
                    if (m.code === 'PLY12-BWR') m.thicknessMm = thickness;
                }
            });
            return runWithDrawers(
                externalBox({ slideCode: 'SLD-UM-500' }),
                thick,
            ).ctx;
        };
        expect(
            issuesOf(withThickness(16), 'furniture.drawer_side_too_thick'),
        ).toEqual([]);
        expect(
            issuesOf(withThickness(17), 'furniture.drawer_side_too_thick'),
        ).toMatchObject([
            {
                severity: 'warning',
                params: { sectionId: ROOT },
                entityIds: [ROOT],
            },
        ]);
    });

    it('derives Wb from the side thickness: 18 mm sides give Wb 558', () => {
        const doc = externalBox({ slideCode: 'SLD-UM-500' });
        doc.materials.drawer_box = assign('PLY18-BWR');
        const { ctx } = runWithDrawers(doc);
        // Win = 522, Wb = 522 + 36 = 558: sides at x = 18 + (564 - 558) / 2 = 21 and 561.
        expect(boxOfPart(partOf(ctx, `${P(1)}.side.left`))?.min[0]).toBe(21);
        expect(boxOfPart(partOf(ctx, `${P(1)}.side.right`))?.min[0]).toBe(
            21 + 558 - 18,
        );
        expect(partOf(ctx, `${P(1)}.back`).length).toBe(522);
    });

    it('never warns about thick sides for side-mount slides', () => {
        const thick = mutateCatalog(catalog, (draft) => {
            for (const m of draft.materials) {
                if (m.code === 'PLY12-BWR') m.thicknessMm = 18;
            }
        });
        const run = runWithDrawers(externalBox(), thick).ctx;
        expect(issuesOf(run, 'furniture.drawer_side_too_thick')).toEqual([]);
    });
});

describe('selectSlide (07 §3.12 steps 1-5, §12.4)', () => {
    const ctx = createGenContext(drawerTestBox(), catalog);
    const select = (
        slideCode: string | null,
        maxLen: number,
        extra: { family?: string } = {},
    ) => selectSlide(ctx, { slideCode, maxLen, sectionId: ROOT, ...extra });
    const codes = (r: ReturnType<typeof select>) => r.issues.map((i) => i.code);

    it('picks the longest slide of the default family that fits', () => {
        const r = select(null, 519);
        expect(r.slide?.code).toBe('SLD-BB-500');
        expect(r.boxLength).toBe(500);
        expect(r.issues).toEqual([]);
        expect(select(null, 549).slide?.code).toBe('SLD-BB-500');
        expect(select(null, 550).slide?.code).toBe('SLD-BB-550');
        expect(select(null, 599).slide?.code).toBe('SLD-BB-550');
        expect(select(null, 600).slide?.code).toBe('SLD-BB-600');
        expect(select(null, 5000).slide?.code).toBe('SLD-BB-600');
        expect(select(null, 250).slide?.code).toBe('SLD-BB-250');
    });

    it('keeps an explicit SLD-BB-350 and warns about the 169 mm left unused', () => {
        const r = select('SLD-BB-350', 519);
        expect(r.slide?.code).toBe('SLD-BB-350');
        expect(r.boxLength).toBe(350);
        expect(r.issues).toMatchObject([
            {
                code: 'furniture.drawer_depth_unused',
                severity: 'warning',
                messageKey: 'engine.furniture.issue.drawer_depth_unused',
                params: { sectionId: ROOT, unused: 169 },
                entityIds: [ROOT],
            },
        ]);
    });

    it('warns about unused depth only above 100 mm', () => {
        expect(codes(select('SLD-BB-350', 450))).toEqual([]);
        expect(select('SLD-BB-350', 451).issues).toMatchObject([
            { params: { unused: 101 } },
        ]);
    });

    it('reports drawer_no_slide for maxLen 240 and returns no slide', () => {
        const r = selectSlide(ctx, {
            slideCode: null,
            maxLen: 240,
            sectionId: ROOT,
            availableDepth: 250,
        });
        expect(r.slide).toBeNull();
        expect(r.boxLength).toBe(0);
        expect(r.issues).toMatchObject([
            {
                code: 'furniture.drawer_no_slide',
                severity: 'error',
                params: { sectionId: ROOT, availableDepth: 250 },
                entityIds: [ROOT],
            },
        ]);
        expect(select('SLD-BB-600', 249).slide).toBeNull();
    });

    it('resizes SLD-UM-500 to SLD-UM-450 for maxLen 480 with an info notice', () => {
        const r = select('SLD-UM-500', 480);
        expect(r.slide?.code).toBe('SLD-UM-450');
        expect(r.boxLength).toBe(450);
        expect(r.issues).toMatchObject([
            {
                code: 'furniture.slide_resized',
                severity: 'info',
                params: { from: 'SLD-UM-500', to: 'SLD-UM-450' },
            },
        ]);
    });

    it('keeps SLD-UM-500 exactly at maxLen 500', () => {
        const r = select('SLD-UM-500', 500);
        expect(r.slide?.code).toBe('SLD-UM-500');
        expect(codes(r)).toEqual([]);
    });

    it('does not announce a resize when no slide was requested', () => {
        // The default SLD-BB-450 is replaced by the longer SLD-BB-500 silently.
        expect(codes(select(null, 519))).toEqual([]);
    });

    it('searches the family given explicitly when no code is set', () => {
        const r = select(null, 480, { family: 'um' });
        expect(r.slide?.code).toBe('SLD-UM-450');
        expect(codes(r)).toEqual([]);
    });

    it('omits the section params when no section is given', () => {
        const r = selectSlide(ctx, { slideCode: 'SLD-BB-350', maxLen: 519 });
        expect(r.issues[0]?.params).toEqual({ unused: 169 });
        expect(r.issues[0]?.entityIds).toEqual([]);
    });

    it('uses an archived explicit slide while it fits, but never picks one', () => {
        const archived = mutateCatalog(catalog, (draft) => {
            for (const h of draft.hardware) {
                if (h.code === 'SLD-BB-500') h.isActive = false;
            }
        });
        const c = createGenContext(drawerTestBox(), archived);
        expect(
            selectSlide(c, { slideCode: 'SLD-BB-500', maxLen: 519 }).slide
                ?.code,
        ).toBe('SLD-BB-500');
        expect(
            selectSlide(c, { slideCode: null, maxLen: 519 }).slide?.code,
        ).toBe('SLD-BB-450');
        // Too long for the room: the family search skips the archived row.
        expect(
            selectSlide(c, { slideCode: 'SLD-BB-550', maxLen: 519 }).slide
                ?.code,
        ).toBe('SLD-BB-450');
    });

    it('keeps an archived explicit slide whose length equals maxLen', () => {
        const archived = mutateCatalog(catalog, (draft) => {
            for (const h of draft.hardware) {
                if (h.code === 'SLD-BB-500') h.isActive = false;
            }
        });
        const c = createGenContext(drawerTestBox(), archived);
        const r = selectSlide(c, { slideCode: 'SLD-BB-500', maxLen: 500 });
        expect(r.slide?.code).toBe('SLD-BB-500');
        expect(r.issues).toEqual([]);
        expect(
            selectSlide(c, { slideCode: 'SLD-BB-500', maxLen: 499 }).slide
                ?.code,
        ).toBe('SLD-BB-450');
    });

    it('takes the lowest code among slides of the same length', () => {
        const twins = mutateCatalog(catalog, (draft) => {
            const original = draft.hardware.find(
                (h) => h.code === 'SLD-BB-500',
            );
            if (!original) throw new Error('no SLD-BB-500');
            for (const code of ['SLD-AA-500', 'SLD-CC-500']) {
                draft.hardware.push({ ...original, id: code, code });
            }
        });
        const c = createGenContext(drawerTestBox(), twins);
        expect(
            selectSlide(c, { slideCode: null, maxLen: 519 }).slide?.code,
        ).toBe('SLD-AA-500');
    });

    it('falls back to the default slide for an unknown code', () => {
        const r = select('NOPE', 519);
        expect(r.slide?.code).toBe('SLD-BB-500');
        expect(codes(r)).toEqual([]);
    });

    it('falls back to the default slide when the code is not a drawer slide', () => {
        expect(select('HDL-BAR-160', 519).slide?.code).toBe('SLD-BB-500');
    });

    it('warns no_default_hardware and sizes the box in 50 mm steps without a default', () => {
        const none = mutateCatalog(catalog, (draft) => {
            for (const h of draft.hardware) {
                h.isDefaultFor = h.isDefaultFor.filter(
                    (k) => k !== 'slide.side_mount',
                );
            }
        });
        const c = createGenContext(drawerTestBox(), none);
        const r = selectSlide(c, { slideCode: null, maxLen: 519 });
        expect(r.slide).toBeNull();
        expect(r.boxLength).toBe(500);
        expect(r.issues).toMatchObject([
            {
                code: 'furniture.no_default_hardware',
                severity: 'warning',
                params: { roleKey: 'slide.side_mount' },
            },
        ]);
        expect(selectSlide(c, { slideCode: null, maxLen: 549 }).boxLength).toBe(
            500,
        );
        expect(selectSlide(c, { slideCode: null, maxLen: 550 }).boxLength).toBe(
            550,
        );
    });

    it('reports drawer_no_slide when even the stepped box would be empty', () => {
        const none = mutateCatalog(catalog, (draft) => {
            for (const h of draft.hardware) {
                h.isDefaultFor = h.isDefaultFor.filter(
                    (k) => k !== 'slide.side_mount',
                );
            }
        });
        const c = createGenContext(drawerTestBox(), none);
        const r = selectSlide(c, { slideCode: null, maxLen: 49 });
        expect(r.boxLength).toBe(0);
        expect(r.issues.map((i) => i.code)).toEqual([
            'furniture.no_default_hardware',
            'furniture.drawer_no_slide',
        ]);
    });
});

describe('drawers and slide selection in a cabinet (07 §12.4)', () => {
    it('reports drawer_no_slide with the available depth and builds no box parts', () => {
        // Interior depth 250 = 281 - 18 - 13: maxLen 240.
        const { ctx } = runWithDrawers(externalBox({}, { depth: 281 }));
        expect(issuesOf(ctx, 'furniture.drawer_no_slide')).toMatchObject([
            {
                severity: 'error',
                params: { sectionId: ROOT, availableDepth: 250 },
                entityIds: [ROOT],
            },
        ]);
        // Fronts and handles remain; sides, backs and bottoms do not.
        expect(
            ctx.parts
                .filter((p) => p.key.includes('.drawer.'))
                .map((p) => p.key),
        ).toEqual([`${P(1)}.front`, `${P(2)}.front`, `${P(3)}.front`]);
        expect(ctx.hardware.filter((h) => h.key.endsWith('.slides'))).toEqual(
            [],
        );
        expect(partOf(ctx, 'carcass.side.left').operations.slideScrewSets).toBe(
            0,
        );
    });

    it('resizes an explicit SLD-UM-500 to SLD-UM-450 when 480 mm is all there is', () => {
        // Depth 521 -> interior 490 -> maxLen 480.
        const { ctx } = runWithDrawers(
            externalBox({ slideCode: 'SLD-UM-500' }, { depth: 521 }),
        );
        expect(issuesOf(ctx, 'furniture.slide_resized')).toMatchObject([
            {
                severity: 'info',
                params: { from: 'SLD-UM-500', to: 'SLD-UM-450' },
            },
        ]);
        expect(hardwareOf(ctx, `${P(1)}.slides`)?.code).toBe('SLD-UM-450');
        // Lb = 450 - 10.
        expect(partOf(ctx, `${P(1)}.side.left`).length).toBe(440);
    });

    it('keeps SLD-BB-350 and warns drawer_depth_unused {169}', () => {
        const { ctx } = runWithDrawers(
            externalBox({ slideCode: 'SLD-BB-350' }),
        );
        expect(hardwareOf(ctx, `${P(1)}.slides`)?.code).toBe('SLD-BB-350');
        expect(issuesOf(ctx, 'furniture.drawer_depth_unused')).toMatchObject([
            { severity: 'warning', params: { sectionId: ROOT, unused: 169 } },
        ]);
        expect(partOf(ctx, `${P(1)}.side.left`).length).toBe(350);
    });

    it('reports the slide issues once per drawers leaf, not per drawer', () => {
        const { ctx } = runWithDrawers(
            externalBox({ slideCode: 'SLD-BB-350' }),
        );
        expect(issuesOf(ctx, 'furniture.drawer_depth_unused')).toHaveLength(1);
    });

    it('builds the boxes without slides when the catalog has no default slide', () => {
        const none = mutateCatalog(catalog, (draft) => {
            for (const h of draft.hardware) {
                h.isDefaultFor = h.isDefaultFor.filter(
                    (k) => k !== 'slide.side_mount',
                );
            }
        });
        const { ctx } = runWithDrawers(drawerTestBox(), none);
        expect(issuesOf(ctx, 'furniture.no_default_hardware')).toMatchObject([
            { severity: 'warning', params: { roleKey: 'slide.side_mount' } },
        ]);
        expect(ctx.hardware.filter((h) => h.key.endsWith('.slides'))).toEqual(
            [],
        );
        // Ls = fl(519 / 50) x 50 = 500 and the side-mount defaults apply.
        expect(partOf(ctx, `${P(1)}.side.left`).length).toBe(500);
        expect(partOf(ctx, `${P(1)}.back`).length).toBe(514);
    });
});

describe('drawer front division (07 §4.4)', () => {
    const openingOf = (doc = drawerTestBox()) => {
        const run = runCarcass(doc, catalog, { fronts: true });
        const opening = run.openings.get(ROOT);
        if (!opening) throw new Error('no opening');
        return { ...run, opening };
    };

    it('uses the given heights for all but the last front, which takes the rest', () => {
        const { ctx, opening } = openingOf();
        const rects = drawerFrontRects(
            ctx,
            opening,
            drawers({ frontHeights: [200, 250, 0] }),
            ROOT,
        );
        // Last = 717 - 450 - 2 x 2 = 263.
        expect(rects.map((r) => [r.y0, r.y1])).toEqual([
            [518.5, 718.5],
            [266.5, 516.5],
            [1.5, 264.5],
        ]);
        expect(ctx.issues).toEqual([]);
    });

    it('turns a rect list into model fronts and parts through the whole step', () => {
        const { ctx } = runWithDrawers(
            externalBox({ frontHeights: [200, 250, 0] }),
        );
        expect(ctx.fronts.map((f) => [f.rect.y, f.rect.h])).toEqual([
            [518, 200],
            [266, 250],
            [1, 263],
        ]);
        expect(partOf(ctx, `${P(3)}.front`)).toMatchObject({
            length: 597,
            width: 263,
        });
    });

    it('errors drawer_heights_invalid when the last front would be below 80 (73)', () => {
        const { ctx } = runWithDrawers(
            externalBox({ frontHeights: [320, 320, 1] }),
        );
        expect(issuesOf(ctx, 'furniture.drawer_heights_invalid')).toMatchObject(
            [
                {
                    severity: 'error',
                    params: { sectionId: ROOT },
                    entityIds: [ROOT],
                },
            ],
        );
        // 717 - 640 - 4 = 73 high; its slot (56.5 mm) is too low for a box.
        expect(partOf(ctx, `${P(3)}.front`).width).toBe(73);
        expect(
            issuesOf(ctx, 'furniture.drawer_too_low').map((i) => i.params),
        ).toEqual([{ sectionId: ROOT, drawer: 3 }]);
    });

    it('accepts a last front of exactly 80', () => {
        // 717 - 633 - 4 = 80.
        const { ctx } = runWithDrawers(
            externalBox({ frontHeights: [320, 313, 0] }),
        );
        expect(issuesOf(ctx, 'furniture.drawer_heights_invalid')).toEqual([]);
    });

    it('treats a list of the wrong length as equal and warns', () => {
        const { ctx } = runWithDrawers(
            externalBox({ frontHeights: [300, 300] }),
        );
        expect(issuesOf(ctx, 'furniture.drawer_heights_invalid')).toMatchObject(
            [
                {
                    severity: 'warning',
                    params: { sectionId: ROOT },
                    entityIds: [ROOT],
                },
            ],
        );
        expect(ctx.fronts.map((f) => f.rect.y)).toEqual([480, 241, 1]);
        expect(ctx.fronts.map((f) => f.rect.h)).toEqual([237, 237, 237]);
        expect(partOf(ctx, `${P(1)}.side.left`).width).toBe(180);
    });

    it('treats a list longer than the drawer count as invalid too', () => {
        const { ctx } = runWithDrawers(
            externalBox({ frontHeights: [200, 200, 200, 200] }),
        );
        expect(issuesOf(ctx, 'furniture.drawer_heights_invalid')).toMatchObject(
            [{ severity: 'warning' }],
        );
        expect(ctx.fronts.map((f) => f.rect.h)).toEqual([237, 237, 237]);
    });

    it('overlays the fronts as inset when every front of the cabinet is inset', () => {
        // Column 1 drawers, column 2 an inset door: no front zone, fronts in the opening.
        const doc = boxDocument({
            width: 1200,
            height: 720,
            depth: 560,
            interior: splitSection(ROOT, 'columns', [
                [flex(), leafSection('s_0000000002', drawers({ count: 2 }))],
                [flex(), leafSection('s_0000000003')],
            ]),
            fronts: [frontOn(FR1, ['s_0000000003'], { overlay: 'inset' })],
        });
        const { ctx, env } = runWithDrawers(doc);
        expect(env.drawerStyle).toBe('inset');
        expect(env.fz).toBe(0);
        // Opening x [18, 591], y [18, 702]; inset cover -2 on every edge.
        expect(
            ctx.fronts.filter((f) => f.kind === 'drawer').map((f) => f.rect),
        ).toEqual([
            { x: 20, y: 361, w: 569, h: 339 },
            { x: 20, y: 20, w: 569, h: 339 },
        ]);
        // Inset fronts sit inside the carcass front plane: z [542, 560].
        expectBox(
            partOf(ctx, `${P(1, 's_0000000002')}.front`),
            [20, 361, 542],
            [569, 339, 18],
        );
        // The inset front takes 18 mm of depth: A = 547 - 18 = 529 -> SLD-BB-500.
        expect(hardwareOf(ctx, `${P(1, 's_0000000002')}.slides`)?.code).toBe(
            'SLD-BB-500',
        );
        // The box ends behind the inset front.
        expect(
            boxOfPart(partOf(ctx, `${P(1, 's_0000000002')}.side.left`))?.min[2],
        ).toBe(42);
    });

    it('uses the edge classes of the opening: shared with a neighbouring door', () => {
        const doc = boxDocument({
            width: 1200,
            height: 720,
            depth: 560,
            interior: splitSection(ROOT, 'columns', [
                [flex(), leafSection('s_0000000002', drawers({ count: 2 }))],
                [flex(), leafSection('s_0000000003')],
            ]),
            fronts: [frontOn(FR1, ['s_0000000003'])],
        });
        const { ctx } = runWithDrawers(doc);
        const drawerFronts = ctx.fronts.filter((f) => f.kind === 'drawer');
        // Left outer (cover 16.5) -> x 1.5; right shared (cover 8) -> 599; the door starts at 601.
        expect(drawerFronts[0]?.rect).toMatchObject({ x: 1, w: 597 });
        const door = ctx.fronts.find((f) => f.kind === 'door');
        expect(door?.rect.x).toBe(601);
        // hf = (717 - 2) / 2 = 357.5: front 1 spans y [361, 718.5].
        expectBox(
            partOf(ctx, `${P(1, 's_0000000002')}.front`),
            [1.5, 361, 542],
            [597.5, 357.5, 18],
        );
    });

    it('splits a single drawer over the whole block', () => {
        const { ctx } = runWithDrawers(externalBox({ count: 1 }));
        expect(ctx.fronts.map((f) => f.rect)).toEqual([
            { x: 1, y: 1, w: 597, h: 717 },
        ]);
    });
});

describe('drawer heights and slots (07 §3.12)', () => {
    /** Drawers behind nothing (behindDoor) in a leaf `slot` mm high per drawer. */
    const slotBox = (leafHeight: number, over: Partial<Drawers> = {}) =>
        boxDocument({
            width: 600,
            height: leafHeight + 36,
            depth: 560,
            content: drawers({ behindDoor: true, count: 2, ...over }),
        });

    it('reports drawer_too_low for a 95 mm slot and builds no box for it', () => {
        const { ctx } = runWithDrawers(slotBox(190));
        expect(
            issuesOf(ctx, 'furniture.drawer_too_low').map((i) => i.params),
        ).toEqual([
            { sectionId: ROOT, drawer: 1 },
            { sectionId: ROOT, drawer: 2 },
        ]);
        expect(issuesOf(ctx, 'furniture.drawer_too_low')[0]).toMatchObject({
            severity: 'error',
            entityIds: [ROOT],
        });
        expect(partsOf(ctx, 'section.')).toEqual([]);
        expect(ctx.hardware).toEqual([]);
    });

    it('builds a 60 mm box in a 100 mm slot', () => {
        const { ctx } = runWithDrawers(slotBox(200));
        expect(issuesOf(ctx, 'furniture.drawer_too_low')).toEqual([]);
        expect(partOf(ctx, `${P(1)}.side.left`).width).toBe(60);
        // Back: 60 - 10 - 3 = 47.
        expect(partOf(ctx, `${P(1)}.back`).width).toBe(47);
        expect(
            issuesOf(
                runWithDrawers(slotBox(198)).ctx,
                'furniture.drawer_too_low',
            ),
        ).toHaveLength(2);
    });

    it('floors the box height to the 10 mm step', () => {
        // Slot 109 -> (109 - 40) / 10 = 6.9 -> 60; slot 110 -> 7 -> 70.
        expect(
            partOf(runWithDrawers(slotBox(218)).ctx, `${P(1)}.side.left`).width,
        ).toBe(60);
        expect(
            partOf(runWithDrawers(slotBox(220)).ctx, `${P(1)}.side.left`).width,
        ).toBe(70);
    });

    it('divides a leaf behind a door equally, without gaps, and centres each box', () => {
        const { ctx } = runWithDrawers(behindBox());
        // Slots of 228 from the top: [474, 702], [246, 474], [18, 246]; Hb 180.
        const ys = [1, 2, 3].map(
            (j) => boxOfPart(partOf(ctx, `${P(j)}.side.left`))?.min[1],
        );
        expect(ys).toEqual([498, 270, 42]);
        expect(
            [1, 2, 3].map((j) => partOf(ctx, `${P(j)}.side.left`).width),
        ).toEqual([180, 180, 180]);
    });

    it('gives custom heights to all but the last drawer behind a door, the rest to the last', () => {
        const { ctx } = runWithDrawers(
            slotBox(300, { frontHeights: [100, 0] }),
        );
        // Leaf y [18, 318]: slot 1 = [218, 318] (Hb 60), slot 2 = [18, 218] (Hb 160).
        expect(partOf(ctx, `${P(1)}.side.left`).width).toBe(60);
        expect(partOf(ctx, `${P(2)}.side.left`).width).toBe(160);
        expect(boxOfPart(partOf(ctx, `${P(1)}.side.left`))?.min[1]).toBe(238);
        expect(boxOfPart(partOf(ctx, `${P(2)}.side.left`))?.min[1]).toBe(38);
    });

    it('treats a wrong-length list behind a door as equal with a warning', () => {
        const { ctx } = runWithDrawers(slotBox(300, { frontHeights: [100] }));
        expect(issuesOf(ctx, 'furniture.drawer_heights_invalid')).toMatchObject(
            [{ severity: 'warning', params: { sectionId: ROOT } }],
        );
        expect(partOf(ctx, `${P(1)}.side.left`).width).toBe(110);
    });
});

describe('drawers behind a door (07 §3.12)', () => {
    const { ctx } = runWithDrawers(behindBox());

    it('chooses slides for A = 529 - 20 - 12: SLD-BB-450 (maxLen 487)', () => {
        expect(hardwareOf(ctx, `${P(1)}.slides`)).toMatchObject({
            code: 'SLD-BB-450',
            reasonParams: { length: 450 },
        });
        expect(issuesOf(ctx, 'furniture.drawer_depth_unused')).toEqual([]);
    });

    it('reduces Wo by 2 x 20 for a hinged cover: Wb 498, Win 474', () => {
        expect(partOf(ctx, `${P(1)}.side.left`).length).toBe(450);
        expect(partOf(ctx, `${P(1)}.back`)).toMatchObject({
            length: 474,
            width: 167,
        });
        expect(boxOfPart(partOf(ctx, `${P(1)}.side.left`))?.min[0]).toBe(51);
    });

    it('ends the box 20 + 12 mm behind the carcass front: inner front z [510, 522]', () => {
        expect(boxOfPart(partOf(ctx, `${P(1)}.side.left`))?.min[2]).toBe(60);
        const inner = partOf(ctx, `${P(1)}.front`);
        expectBox(inner, [51, 498, 510], [498, 180, 12]);
    });

    it('makes the inner front a drawer_box part, banded on all four edges', () => {
        const banded = mutateCatalog(catalog, (draft) => {
            for (const m of draft.materials) {
                if (m.code === 'PLY12-BWR') m.defaultEdgeBandCode = B;
            }
        });
        const run = runWithDrawers(behindBox(), banded).ctx;
        expect(partOf(run, `${P(2)}.front`)).toMatchObject({
            nameKey: 'parts.drawer_inner_front',
            nameParams: { n: 2 },
            role: 'drawer_box',
            materialCode: 'PLY12-BWR',
            thickness: 12,
            length: 498,
            width: 180,
            edges: { L1: B, L2: B, W1: B, W2: B },
            visibleFaces: 0,
        });
    });

    it('adds no handle, no model front and no handle holes', () => {
        expect(ctx.hardware.filter((h) => h.key.endsWith('.handle'))).toEqual(
            [],
        );
        expect(ctx.fronts.filter((f) => f.kind === 'drawer')).toEqual([]);
        expect(partOf(ctx, `${P(1)}.front`).operations.handleHoles).toBe(0);
    });

    it('warns nothing when the flag already says behindDoor', () => {
        expect(issuesOf(ctx, 'furniture.drawers_forced_behind_door')).toEqual(
            [],
        );
    });

    it('keeps the full opening width when no door covers the drawers', () => {
        // Wo = 564: Wb = 538, Win = 514.
        const bare = runWithDrawers(
            boxDocument({
                width: 600,
                height: 720,
                depth: 560,
                content: drawers({ behindDoor: true }),
            }),
        ).ctx;
        expect(partOf(bare, `${P(1)}.back`).length).toBe(514);
        expect(partOf(bare, `${P(1)}.front`).length).toBe(538);
    });

    describe('packers by the kind of the cover (1200 wide, Wo = 1164)', () => {
        const backLength = (
            kind: 'hinged' | 'flap_up' | 'flap_down' | 'sliding',
        ) => {
            const over =
                kind === 'sliding'
                    ? {
                          kind,
                          leaves: 2,
                          hingeCode: null,
                          slidingTrackCode: 'auto',
                      }
                    : { kind };
            const { ctx } = runWithDrawers(
                boxDocument({
                    width: 1200,
                    height: 720,
                    depth: 560,
                    content: drawers({ behindDoor: true }),
                    fronts: [frontOn(FR1, [ROOT], over)],
                }),
            );
            return partOf(ctx, `${P(1)}.back`).length;
        };

        it.each(['hinged', 'flap_up', 'flap_down'] as const)(
            'packs behind a %s cover: Wo 1124, Wb 1098, Win 1074',
            (kind) => {
                expect(backLength(kind)).toBe(1074);
            },
        );

        it('does not pack behind a sliding cover: Wb 1138, Win 1114', () => {
            expect(backLength('sliding')).toBe(1114);
        });
    });

    it('applies the inset reduction behind an inset door', () => {
        // Interior depth 547; cd = 529; A = 509; maxLen = 487; z1 = 560.
        const { ctx: inset } = runWithDrawers(
            insetBox(drawers({ behindDoor: true })),
        );
        expect(hardwareOf(inset, `${P(1)}.slides`)?.code).toBe('SLD-BB-450');
        // zf = 560 - 18 - 20 - 12 = 510.
        expect(boxOfPart(partOf(inset, `${P(1)}.front`))?.min[2]).toBe(510);
    });

    it('reduces the depth by 20 + t_db even without a covering door', () => {
        // No cover: fz 0, Dc 560, interior 547, A = 527, maxLen = 505.
        const run = runWithDrawers(
            boxDocument({
                width: 600,
                height: 720,
                depth: 560,
                content: drawers({ behindDoor: true }),
            }),
        ).ctx;
        expect(hardwareOf(run, `${P(1)}.slides`)?.code).toBe('SLD-BB-500');
        expect(issuesOf(run, 'furniture.drawer_depth_unused')).toEqual([]);
        // zf = 560 - 20 - 12 = 528: the box ends there, inner front [528, 540].
        expect(boxOfPart(partOf(run, `${P(1)}.front`))?.min[2]).toBe(528);
    });
});

describe('drawers behind doors of a wardrobe (internalDrawers: 2)', () => {
    const doc = templateWardrobe({ internalDrawers: 2 });
    const { ctx } = runWithDrawers(doc);
    const S = 's_0000000004';

    it('turns the drawers into inner fronts without handles', () => {
        expect(partOf(ctx, `${P(1, S)}.front`)).toMatchObject({
            nameKey: 'parts.drawer_inner_front',
            nameParams: { n: 1 },
            role: 'drawer_box',
            materialCode: 'PLY12-BWR',
        });
        expect(partOf(ctx, `${P(2, S)}.front`).key).toBe(`${P(2, S)}.front`);
        expect(
            ctx.hardware.filter(
                (h) => h.key.includes('.drawer.') && h.key.endsWith('.handle'),
            ),
        ).toEqual([]);
    });

    it('packs the 582 mm column to Wo 542, Wb 516 and shortens the box to A = 549', () => {
        // Dc 582, interior depth 569, A = 549, maxLen = 527 -> SLD-BB-500.
        expect(hardwareOf(ctx, `${P(1, S)}.slides`)?.code).toBe('SLD-BB-500');
        expect(partOf(ctx, `${P(1, S)}.side.left`).length).toBe(500);
        expect(partOf(ctx, `${P(1, S)}.back`).length).toBe(492);
        expect(partOf(ctx, `${P(1, S)}.front`).length).toBe(516);
        // Leaf 360 high: slots of 180, Hb = 140.
        expect(partOf(ctx, `${P(1, S)}.side.left`).width).toBe(140);
    });

    it('puts the slide screws on the side and on the partition', () => {
        expect(partOf(ctx, 'carcass.side.left').operations.slideScrewSets).toBe(
            2,
        );
        expect(
            partOf(ctx, 'section.s_0000000001.partition.1').operations
                .slideScrewSets,
        ).toBe(2);
        expect(
            partOf(ctx, 'carcass.side.right').operations.slideScrewSets,
        ).toBe(0);
    });

    it('warns drawers_forced_behind_door when the flag says otherwise', () => {
        const forced = templateWardrobe({ internalDrawers: 2 });
        const column = forced.carcass?.interior.children[0]?.section;
        const content = column?.children[1]?.section.content;
        if (content?.type !== 'drawers') throw new Error('no drawers');
        content.behindDoor = false;
        const run = runWithDrawers(forced).ctx;
        expect(
            issuesOf(run, 'furniture.drawers_forced_behind_door'),
        ).toMatchObject([
            {
                severity: 'warning',
                params: { sectionId: S },
                entityIds: [S],
            },
        ]);
        // The drawers still get inner fronts and no handles.
        expect(partOf(run, `${P(1, S)}.front`).nameKey).toBe(
            'parts.drawer_inner_front',
        );
        expect(hardwareOf(run, `${P(1, S)}.handle`)).toBeUndefined();
    });
});

describe('drawer handles (07 §6.4)', () => {
    it('adds two handles to a drawer front wider than 600', () => {
        // Front 697 wide.
        const { ctx } = runWithDrawers(externalBox({}, { width: 700 }));
        expect(hardwareOf(ctx, `${P(1)}.handle`)?.qty).toBe(2);
        expect(partOf(ctx, `${P(1)}.front`).operations.handleHoles).toBe(4);
        // 600 wide front -> 603 box: one handle at the limit.
        const edge = runWithDrawers(externalBox({}, { width: 603 })).ctx;
        expect(hardwareOf(edge, `${P(1)}.handle`)?.qty).toBe(1);
        const over = runWithDrawers(externalBox({}, { width: 604 })).ctx;
        expect(hardwareOf(over, `${P(1)}.handle`)?.qty).toBe(2);
    });

    it('swaps a bar that does not fit the width for the knob, naming the front', () => {
        const doc = externalBox({ count: 1 }, { width: 300 });
        if (doc.carcass) doc.carcass.handles.code = 'HDL-BAR-320';
        const { ctx } = runWithDrawers(doc);
        expect(hardwareOf(ctx, `${P(1)}.handle`)).toMatchObject({
            code: 'KNB-ROUND-30',
            qty: 1,
        });
        expect(
            issuesOf(ctx, 'furniture.handle_replaced_by_knob'),
        ).toMatchObject([
            {
                severity: 'info',
                params: { frontId: `${P(1)}.front` },
                entityIds: [`${P(1)}.front`],
            },
        ]);
        expect(partOf(ctx, `${P(1)}.front`).operations.handleHoles).toBe(1);
    });

    it('adds no handle for handles.code null', () => {
        const doc = drawerTestBox();
        if (doc.carcass) doc.carcass.handles.code = null;
        const { ctx } = runWithDrawers(doc);
        expect(ctx.hardware.filter((h) => h.key.endsWith('.handle'))).toEqual(
            [],
        );
        expect(partOf(ctx, `${P(1)}.front`).operations.handleHoles).toBe(0);
    });

    it('honours a vertical handle orientation for the fit', () => {
        // Front 297 wide x 717 high: a vertical 320 bar needs 400 <= 717.
        const doc = externalBox({ count: 1 }, { width: 300 });
        if (doc.carcass) {
            doc.carcass.handles.code = 'HDL-BAR-320';
            doc.carcass.handles.orientation = 'vertical';
        }
        const { ctx } = runWithDrawers(doc);
        expect(hardwareOf(ctx, `${P(1)}.handle`)?.code).toBe('HDL-BAR-320');
    });
});

describe('slide screws on partitions and key prefixes', () => {
    it('puts the screws on the side and on the partition of a drawer column', () => {
        const doc = boxDocument({
            width: 1200,
            height: 720,
            depth: 560,
            interior: splitSection(ROOT, 'columns', [
                [flex(), leafSection('s_0000000002', drawers({ count: 2 }))],
                [flex(), leafSection('s_0000000003')],
            ]),
        });
        const { ctx } = runWithDrawers(doc);
        expect(partOf(ctx, 'carcass.side.left').operations.slideScrewSets).toBe(
            2,
        );
        expect(
            partOf(ctx, `section.${ROOT}.partition.1`).operations
                .slideScrewSets,
        ).toBe(2);
        expect(
            partOf(ctx, 'carcass.side.right').operations.slideScrewSets,
        ).toBe(0);
    });

    it('templates the section id into the default key prefix', () => {
        const doc = boxDocument({
            width: 1200,
            height: 720,
            depth: 560,
            interior: splitSection(ROOT, 'columns', [
                [flex(), leafSection('s_0000000002', drawers({ count: 1 }))],
                [flex(), leafSection('s_0000000003', drawers({ count: 1 }))],
            ]),
        });
        const { ctx } = runWithDrawers(doc);
        expect(
            ctx.parts
                .filter(
                    (p) =>
                        p.key.endsWith('.side.left') &&
                        p.key.includes('drawer'),
                )
                .map((p) => p.key),
        ).toEqual([
            'section.s_0000000002.drawer.1.side.left',
            'section.s_0000000003.drawer.1.side.left',
        ]);
        expect(
            hardwareOf(ctx, 'section.s_0000000003.drawer.1.slides')?.sectionId,
        ).toBe('s_0000000003');
    });

    it('uses an explicit key prefix for parts and hardware (table family)', () => {
        const run = runCarcass(drawerTestBox(), catalog, { fronts: true });
        const leaf = run.layout.byId.get(ROOT);
        if (!leaf) throw new Error('no leaf');
        drawersFor(
            run.ctx,
            run.env,
            run.layout,
            leaf,
            drawers({ count: 2 }),
            'table.drawer',
        );
        expect(
            run.ctx.parts
                .filter((p) => p.key.startsWith('table.drawer.'))
                .map((p) => p.key)
                .sort(),
        ).toEqual(
            [1, 2].flatMap((j) =>
                ['back', 'bottom', 'front', 'side.left', 'side.right'].map(
                    (s) => `table.drawer.${j}.${s}`,
                ),
            ),
        );
        expect(hardwareOf(run.ctx, 'table.drawer.1.slides')?.code).toBe(
            'SLD-BB-500',
        );
        expect(hardwareOf(run.ctx, 'table.drawer.2.handle')?.code).toBe(
            'HDL-BAR-160',
        );
        expect(run.ctx.fronts.map((f) => f.id)).toEqual([
            'table.drawer.1.front',
            'table.drawer.2.front',
        ]);
    });
});

describe('drawer grain (07 §5.3)', () => {
    const grained = mutateCatalog(catalog, (draft) => {
        for (const m of draft.materials) {
            if (['PLY12-BWR', 'HDF3-WHITE', 'PB18-OAK'].includes(m.code)) {
                m.hasGrain = true;
            }
        }
    });

    it('runs box sides along z, backs and fronts along x, and leaves the bottom grainless', () => {
        const doc = drawerTestBox();
        doc.materials.front = assign('PB18-OAK');
        const { ctx } = runWithDrawers(doc, grained);
        // Sides 500 (z) x 180 (y): the length follows the grain; back 514 (x) x 167.
        expect(partOf(ctx, `${P(1)}.side.left`).grain).toBe('length');
        expect(partOf(ctx, `${P(1)}.back`).grain).toBe('length');
        expect(partOf(ctx, `${P(1)}.bottom`).grain).toBe('none');
        // Drawer front 597 (x) x 237 (y): grain x is the length.
        expect(partOf(ctx, `${P(1)}.front`).grain).toBe('length');
    });

    it('lays the inner front of a drawer behind a door along x', () => {
        const { ctx } = runWithDrawers(behindBox(), grained);
        expect(partOf(ctx, `${P(1)}.front`).grain).toBe('length');
    });
});

describe('drawer materials', () => {
    it('uses the assigned drawer_box and drawer_bottom materials', () => {
        const doc = drawerTestBox();
        doc.materials.drawer_box = assign('PLY18-BWR');
        doc.materials.drawer_bottom = assign('HDF3-WHITE');
        const { ctx } = runWithDrawers(doc);
        expect(partOf(ctx, `${P(1)}.side.left`)).toMatchObject({
            materialCode: 'PLY18-BWR',
            thickness: 18,
        });
        // t_db 18: Wb = 538, Win = 502, back 502 wide.
        expect(partOf(ctx, `${P(1)}.back`).length).toBe(502);
        // Bottom: Win + 2 x 5 = 512.
        expect(partOf(ctx, `${P(1)}.bottom`).length).toBe(512);
    });
});

describe('determinism', () => {
    it('produces identical output for identical input', () => {
        const a = runWithDrawers(drawerTestBox()).ctx;
        const b = runWithDrawers(drawerTestBox()).ctx;
        expect(a.parts).toEqual(b.parts);
        expect(a.hardware).toEqual(b.hardware);
        expect(a.issues).toEqual(b.issues);
    });

    it('does not mutate the document', () => {
        const doc = drawerTestBox();
        const before = structuredClone(doc);
        runWithDrawers(doc);
        expect(doc).toEqual(before);
    });
});
