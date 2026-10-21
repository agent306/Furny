import { describe, expect, it } from 'vitest';
import { seedCatalog } from '../../../testing/seedCatalog';
import { generateFurniture } from '../../generate';
import type { ExtraPart, FurnitureDocument } from '../../schema';
import { withThickness } from '../../testing/catalogs';
import {
    assign,
    boxDocument,
    drawerTestBox,
    frontOn,
    BOX_ROOT_ID,
    wardrobeFixture,
} from '../../testing/docs';
import type { FurnitureModel } from '../../types';

/**
 * The model-level rules of 07 §7.3 that `modelRules` adds to a generation:
 * sheet fit, loft access and the thickness guidance of 07 §1.4. (Sag and
 * `too_many_parts` have their own tests.)
 */
const catalog = seedCatalog();

const run = (doc: FurnitureDocument, cat = catalog): FurnitureModel =>
    generateFurniture(doc, cat);
const only = (model: FurnitureModel, code: string) =>
    model.issues.filter((i) => i.code === code);

const extraPart = (over: Partial<ExtraPart>): ExtraPart => ({
    id: 'p_0000000001',
    name: 'Extra',
    role: 'shelf',
    materialCode: 'PB18-WHITE',
    length: 300,
    width: 200,
    qty: 1,
    edges: { L1: null, L2: null, W1: null, W2: null },
    grain: 'none',
    note: null,
    placement: null,
    ...over,
});

describe('part_exceeds_sheet (07 §7.3, §3.4.1 fit)', () => {
    it('flags a side taller than a PB18 sheet, with the sheet dimensions', () => {
        // 2440 x 1220 sheet, 10 mm trim all round: 2420 x 1200 usable; sides are 2500 x 560
        const model = run(
            boxDocument({ width: 600, height: 2500, depth: 560 }),
        );
        const issues = only(model, 'furniture.part_exceeds_sheet');
        expect(issues.map((i) => i.entityIds)).toEqual([
            ['carcass.side.left'],
            ['carcass.side.right'],
        ]);
        const side = model.parts.find((p) => p.key === 'carcass.side.left');
        expect(issues[0]).toEqual({
            code: 'furniture.part_exceeds_sheet',
            severity: 'error',
            messageKey: 'engine.furniture.issue.part_exceeds_sheet',
            params: {
                partKey: 'carcass.side.left',
                length: 2500,
                width: side?.width,
                sheetLength: 2440,
                sheetWidth: 1220,
                materialCode: 'PB18-WHITE',
            },
            entityIds: ['carcass.side.left'],
        });
    });

    it('accepts parts that fit the trimmed sheet', () => {
        expect(
            only(
                run(boxDocument({ width: 600, height: 2420, depth: 560 })),
                'furniture.part_exceeds_sheet',
            ),
        ).toEqual([]);
        expect(
            only(run(wardrobeFixture()), 'furniture.part_exceeds_sheet'),
        ).toEqual([]);
    });

    it('never flags the back, which is split or reported as part_exceeds_sheet_back', () => {
        const doc = boxDocument({ width: 600, height: 720, depth: 560 });
        doc.overrides.parts['carcass.back'] = { lengthDelta: 3000 };
        const model = run(doc);
        const back = model.parts.find((p) => p.key === 'carcass.back');
        expect(back?.length).toBeGreaterThan(3000);
        expect(only(model, 'furniture.part_exceeds_sheet')).toEqual([]);
    });

    it('respects the grain of a grained material', () => {
        const extra = (grain: ExtraPart['grain'], materialCode: string) => {
            const doc = wardrobeFixture();
            doc.overrides.extraParts = [
                extraPart({ length: 1300, width: 600, grain, materialCode }),
            ];
            return only(run(doc), 'furniture.part_exceeds_sheet').map(
                (i) => i.entityIds[0],
            );
        };
        // PB18-OAK has a grain: the width grain puts the short side along the 2420 mm sheet length
        expect(extra('width', 'PB18-OAK')).toEqual(['extra.p_0000000001']);
        expect(extra('length', 'PB18-OAK')).toEqual([]);
        // PB18-WHITE has no grain: free rotation
        expect(extra('width', 'PB18-WHITE')).toEqual([]);
    });

    it('does not check glass', () => {
        const big = (materialCode: string) => {
            const doc = wardrobeFixture();
            doc.overrides.extraParts = [
                extraPart({
                    role: 'front',
                    materialCode,
                    length: 2600,
                    width: 1900,
                }),
            ];
            return only(run(doc), 'furniture.part_exceeds_sheet');
        };
        expect(big('GLASS5-CLEAR')).toEqual([]);
        expect(big('PB18-WHITE')).toHaveLength(1);
    });

    it('falls back to the role default material for an unknown code, without throwing', () => {
        const doc = wardrobeFixture();
        doc.overrides.extraParts = [
            extraPart({ materialCode: 'GONE-01', length: 2600, width: 100 }),
        ];
        expect(only(run(doc), 'furniture.part_exceeds_sheet')).toHaveLength(1);
    });
});

describe('loft_no_access (07 §7.3)', () => {
    const loft = (fronts = false) =>
        boxDocument({
            width: 900,
            height: 400,
            depth: 560,
            carcass: {
                mounting: 'loft',
                plinth: { type: 'none', height: 0, setback: 0, legCode: null },
            },
            fronts: fronts ? [frontOn('fr_0000000001', [BOX_ROOT_ID])] : [],
        });

    it('warns for a loft without a front', () => {
        expect(only(run(loft()), 'furniture.loft_no_access')).toEqual([
            {
                code: 'furniture.loft_no_access',
                severity: 'warning',
                messageKey: 'engine.furniture.issue.loft_no_access',
                params: {},
                entityIds: [],
            },
        ]);
    });

    it('is silent when a front covers a section', () => {
        expect(only(run(loft(true)), 'furniture.loft_no_access')).toEqual([]);
    });

    it('warns when the fronts cover no existing section', () => {
        const doc = loft();
        doc.carcass?.fronts.push(frontOn('fr_0000000001', ['s_9999999999']));
        expect(only(run(doc), 'furniture.loft_no_access')).toHaveLength(1);
    });

    it('applies to lofts only', () => {
        const floor = boxDocument({ width: 900, height: 400, depth: 560 });
        expect(only(run(floor), 'furniture.loft_no_access')).toEqual([]);
    });
});

describe('thin_carcass (07 §1.4)', () => {
    const issues = (thickness?: number, material = 'PB18-WHITE') => {
        const cat =
            thickness === undefined
                ? catalog
                : withThickness(material, thickness);
        return only(
            run(
                boxDocument({
                    width: 600,
                    height: 720,
                    depth: 560,
                    materials: { carcass: assign(material) },
                }),
                cat,
            ),
            'furniture.thin_carcass',
        );
    };

    it('warns for a 12 mm carcass material', () => {
        expect(issues(undefined, 'PLY12-BWR')).toEqual([
            {
                code: 'furniture.thin_carcass',
                severity: 'warning',
                messageKey: 'engine.furniture.issue.thin_carcass',
                params: {},
                entityIds: [],
            },
        ]);
    });

    it('warns below 15 mm and accepts 15 mm and up', () => {
        expect(issues(14)).toHaveLength(1);
        expect(issues(15)).toEqual([]);
        expect(issues(14.6)).toEqual([]); // t_c is the rounded thickness
        expect(issues()).toEqual([]);
    });

    it('is reported once, not per part', () => {
        expect(issues(12)).toHaveLength(1);
    });
});

describe('back_too_thick_for_groove (07 §1.4)', () => {
    const issues = (type: 'grooved' | 'nailed' | 'inset', thickness: number) =>
        only(
            run(
                boxDocument({
                    width: 600,
                    height: 720,
                    depth: 560,
                    carcass: { back: { type } },
                }),
                withThickness('HDF3-WHITE', thickness),
            ),
            'furniture.back_too_thick_for_groove',
        );

    it('warns for a grooved back thicker than 8 mm', () => {
        expect(issues('grooved', 9)).toEqual([
            {
                code: 'furniture.back_too_thick_for_groove',
                severity: 'warning',
                messageKey: 'engine.furniture.issue.back_too_thick_for_groove',
                params: {},
                entityIds: [],
            },
        ]);
    });

    it('accepts 8 mm, and thick backs that are not grooved', () => {
        expect(issues('grooved', 8)).toEqual([]);
        expect(issues('nailed', 9)).toEqual([]);
        expect(issues('inset', 18)).toEqual([]);
    });
});

describe('drawer bottom and box thickness (07 §1.4)', () => {
    const bottom = (thickness: number) =>
        only(
            run(drawerTestBox(), withThickness('HDF3-WHITE', thickness)),
            'furniture.drawer_bottom_thick',
        );

    it('warns for a drawer bottom thicker than 8 mm', () => {
        expect(bottom(9)).toEqual([
            {
                code: 'furniture.drawer_bottom_thick',
                severity: 'warning',
                messageKey: 'engine.furniture.issue.drawer_bottom_thick',
                params: {},
                entityIds: [],
            },
        ]);
        expect(bottom(8)).toEqual([]);
        expect(bottom(3)).toEqual([]);
    });

    it('is silent when the document builds no drawer', () => {
        const model = run(
            boxDocument({
                width: 600,
                height: 720,
                depth: 560,
                materials: { drawer_bottom: assign('PB18-WHITE') },
            }),
        );
        expect(only(model, 'furniture.drawer_bottom_thick')).toEqual([]);
    });

    const box = (thickness: number | undefined) =>
        only(
            run(
                drawerTestBox(),
                thickness === undefined
                    ? catalog
                    : withThickness('PLY12-BWR', thickness),
            ),
            'furniture.drawer_box_thickness',
        );

    it('informs when the box sides are outside 12-16 mm', () => {
        expect(box(11)).toEqual([
            {
                code: 'furniture.drawer_box_thickness',
                severity: 'info',
                messageKey: 'engine.furniture.issue.drawer_box_thickness',
                params: {},
                entityIds: [],
            },
        ]);
        expect(box(17)).toHaveLength(1);
        expect(box(12)).toEqual([]);
        expect(box(16)).toEqual([]);
        expect(box(undefined)).toEqual([]);
    });

    it('also informs for an 18 mm box material', () => {
        const doc = drawerTestBox();
        doc.materials.drawer_box = assign('PB18-WHITE');
        expect(only(run(doc), 'furniture.drawer_box_thickness')).toHaveLength(
            1,
        );
    });

    it('is silent when the document builds no drawer', () => {
        const model = run(
            boxDocument({
                width: 600,
                height: 720,
                depth: 560,
                materials: { drawer_box: assign('PB18-WHITE') },
            }),
        );
        expect(only(model, 'furniture.drawer_box_thickness')).toEqual([]);
    });
});
