import { describe, expect, it } from 'vitest';
import type { Issue } from '../../../plan/types';
import { mutateCatalog, seedCatalog } from '../../../testing/seedCatalog';
import { withThickness, withoutDefault } from '../../testing/catalogs';
import { createGenContext } from '../../context';
import { generateFurniture } from '../../generate';
import type { Content, FurnitureDocument } from '../../schema';
import {
    diningTable,
    studyDesk,
    tableDocument,
    diningTableSpec,
} from '../../testing/docs';
import type { Box3, FurnitureModel, Part } from '../../types';
import { validateFurniture } from '../../validate';
import { partOverlaps } from '../../testing/overlaps';
import { tableParts } from '../generateTable';
import { circleOutline, ellipseOutline, roundedRectOutline } from '../outlines';

const catalog = seedCatalog();
const EB_TOP = 'EB10-WHITE-28';
const EB = 'EB08-WHITE';

const run = (doc: FurnitureDocument, cat = catalog): FurnitureModel =>
    generateFurniture(doc, cat);
const partOf = (model: FurnitureModel, key: string): Part => {
    const part = model.parts.find((p) => p.key === key);
    if (!part) throw new Error(`no part ${key}`);
    return part;
};
const boxOf = (model: FurnitureModel, key: string): Box3 => {
    const g = partOf(model, key).geometry;
    if (g.kind !== 'box') throw new Error(`${key} is not a box`);
    return g.box;
};
const lineOf = (model: FurnitureModel, key: string) =>
    model.hardware.find((h) => h.key === key);
const issuesOf = (model: { issues: Issue[] }, code: string) =>
    model.issues.filter((i) => i.code === code);
const keys = (model: FurnitureModel) => model.parts.map((p) => p.key);
const hardwareKeys = (model: FurnitureModel) =>
    model.hardware.map((h) => h.key);
const edgesOf = (model: FurnitureModel, key: string) =>
    partOf(model, key).edges;
const nonInfo = (issues: readonly Issue[]) =>
    issues.filter((i) => i.severity !== 'info').map((i) => i.code);

/** Twice the signed area of a [x, z] ring: positive = clockwise in the top view (z toward the front). */
const shoelace = (ring: Array<[number, number]>): number =>
    ring.reduce((sum, [x0, z0], i) => {
        const [x1, z1] = ring[(i + 1) % ring.length] ?? [0, 0];
        return sum + (x0 * z1 - x1 * z0);
    }, 0);

type Drawers = Extract<Content, { type: 'drawers' }>;
const cabinetDrawers = (over: Partial<Drawers> = {}): Content => ({
    type: 'drawers',
    count: 3,
    frontHeights: 'equal',
    slideCode: null,
    behindDoor: false,
    ...over,
});

const withCount = (
    count: number,
    side: 'front' | 'left' | 'right',
): NonNullable<FurnitureDocument['table']>['storage']['drawers'] => ({
    count,
    side,
    slideCode: null,
});

/** 07 §2.4.17 console table generation: overhang 20, solid legs 50, apron 100 inset 10. */
const consoleTable = (W: number, D: number, drawers: number) =>
    tableDocument(
        { width: W, height: 800, depth: D },
        {
            top: {
                shape: 'rectangle',
                thickness: 'material',
                cornerRadius: 0,
                overhang: 20,
            },
            base: {
                type: 'four_legs',
                legSource: 'solid',
                legCode: null,
                legSection: 50,
                apron: { enabled: true, height: 100, inset: 10 },
                stretcher: false,
            },
            storage: {
                drawers: drawers > 0 ? withCount(drawers, 'front') : null,
                lowerShelf: false,
                endCabinets: null,
            },
        },
        'console_table',
    );

describe('outlines (CW [x, z] pairs)', () => {
    it('roundedRectOutline: 4 corners of 8 segments, 36 points inside W x D, clockwise', () => {
        const ring = roundedRectOutline(1800, 900, 100);
        expect(ring).toHaveLength(36);
        expect(ring[0]).toEqual([1800, 800]);
        expect(ring[8]?.[0]).toBeCloseTo(1700, 9);
        expect(ring[8]?.[1]).toBeCloseTo(900, 9);
        expect(ring[9]?.[0]).toBeCloseTo(100, 9);
        expect(ring[9]?.[1]).toBeCloseTo(900, 9);
        for (const [x, z] of ring) {
            expect(x).toBeGreaterThanOrEqual(0);
            expect(x).toBeLessThanOrEqual(1800);
            expect(z).toBeGreaterThanOrEqual(0);
            expect(z).toBeLessThanOrEqual(900);
        }
        // every point of the first corner lies on its arc (centre 1700, 800)
        for (const [x, z] of ring.slice(0, 9)) {
            expect(Math.hypot(x - 1700, z - 800)).toBeCloseTo(100, 5);
        }
        expect(shoelace(ring)).toBeGreaterThan(0);
        // area: rectangle minus the four corner gaps (polygonal arcs)
        // each corner square loses r^2 minus the fan of 8 triangles under the arc
        const corner = 100 * 100 * (1 - 4 * Math.sin(Math.PI / 16));
        expect(shoelace(ring) / 2).toBeCloseTo(1800 * 900 - 4 * corner, 1);
    });

    it('roundedRectOutline repeats no point where the corners meet (r = min(W, D)/2)', () => {
        const repeats = (ring: Array<[number, number]>) =>
            ring.filter((p, i) => {
                const next = ring[(i + 1) % ring.length];
                return next?.[0] === p[0] && next[1] === p[1];
            });
        const square = roundedRectOutline(900, 900, 450);
        expect(square).toHaveLength(32);
        expect(repeats(square)).toEqual([]);
        expect(square[0]).toEqual([900, 450]);
        const long = roundedRectOutline(1800, 900, 450);
        expect(long).toHaveLength(34);
        expect(repeats(long)).toEqual([]);
        expect(shoelace(long)).toBeGreaterThan(0);
        expect(roundedRectOutline(1800, 900, 449)).toHaveLength(36);
    });

    it('roundedRectOutline takes the segments per corner and degrades to a rectangle at r = 0', () => {
        expect(roundedRectOutline(1000, 500, 50, 4)).toHaveLength(20);
        expect(roundedRectOutline(1000, 500, 0)).toEqual([
            [1000, 500],
            [0, 500],
            [0, 0],
            [1000, 0],
        ]);
    });

    it('circleOutline: 64 points on the circle of diameter d, starting at +x, clockwise', () => {
        const ring = circleOutline(1000);
        expect(ring).toHaveLength(64);
        expect(ring[0]).toEqual([1000, 500]);
        expect(ring[16]?.[0]).toBeCloseTo(500, 9);
        expect(ring[16]?.[1]).toBeCloseTo(1000, 9);
        for (const [x, z] of ring) {
            expect(Math.hypot(x - 500, z - 500)).toBeCloseTo(500, 5);
        }
        expect(shoelace(ring)).toBeGreaterThan(0);
        expect(circleOutline(600, 12)).toHaveLength(12);
    });

    it('ellipseOutline: 64 points on the W x D ellipse, clockwise', () => {
        const ring = ellipseOutline(1200, 800);
        expect(ring).toHaveLength(64);
        expect(ring[0]).toEqual([1200, 400]);
        for (const [x, z] of ring) {
            expect(((x - 600) / 600) ** 2 + ((z - 400) / 400) ** 2).toBeCloseTo(
                1,
                5,
            );
        }
        expect(shoelace(ring)).toBeGreaterThan(0);
    });
});

describe('dining table defaults: four legs (07 §2.4.15, §3.13)', () => {
    const model = run(diningTable());

    it('generates the top, four solid legs and four aprons', () => {
        expect(keys(model)).toEqual([
            'table.apron.back',
            'table.apron.front',
            'table.apron.left',
            'table.apron.right',
            'table.leg.bl',
            'table.leg.br',
            'table.leg.fl',
            'table.leg.fr',
            'table.top',
        ]);
    });

    it('top: 1800 x 900 at y [725, 750] (Tt 25), banded all four, 1 visible face', () => {
        const top = partOf(model, 'table.top');
        expect(top).toMatchObject({
            nameKey: 'parts.table_top',
            role: 'top',
            materialCode: 'PB25-WHITE',
            thickness: 25,
            length: 1800,
            width: 900,
            visibleFaces: 1,
            edges: { L1: EB_TOP, L2: EB_TOP, W1: EB_TOP, W2: EB_TOP },
        });
        expect(boxOf(model, 'table.top')).toEqual({
            min: [0, 725, 0],
            size: [1800, 25, 900],
        });
    });

    it('legs: s 50 x t_leg 50 at the corners of the 1700 x 800 base, Hb 725 tall', () => {
        expect(boxOf(model, 'table.leg.fl')).toEqual({
            min: [50, 0, 800],
            size: [50, 725, 50],
        });
        expect(boxOf(model, 'table.leg.fr')).toEqual({
            min: [1700, 0, 800],
            size: [50, 725, 50],
        });
        expect(boxOf(model, 'table.leg.bl').min).toEqual([50, 0, 50]);
        expect(boxOf(model, 'table.leg.br').min).toEqual([1700, 0, 50]);
        expect(partOf(model, 'table.leg.fl')).toMatchObject({
            nameKey: 'parts.table_leg',
            role: 'leg',
            materialCode: 'SW50-RUBBER',
            length: 725,
            width: 50,
            thickness: 50,
            grain: 'length',
            visibleFaces: 2,
            edges: { L1: null, L2: null, W1: null, W2: null },
        });
    });

    it('aprons: 1600 x 90 front/back and 700 x 90 sides, inset 15, banded bottom only', () => {
        expect(boxOf(model, 'table.apron.front')).toEqual({
            min: [100, 635, 817],
            size: [1600, 90, 18],
        });
        expect(boxOf(model, 'table.apron.back')).toEqual({
            min: [100, 635, 65],
            size: [1600, 90, 18],
        });
        expect(boxOf(model, 'table.apron.left')).toEqual({
            min: [65, 635, 100],
            size: [18, 90, 700],
        });
        expect(boxOf(model, 'table.apron.right')).toEqual({
            min: [1717, 635, 100],
            size: [18, 90, 700],
        });
        expect(partOf(model, 'table.apron.front')).toMatchObject({
            nameKey: 'parts.apron',
            role: 'carcass',
            length: 1600,
            width: 90,
            visibleFaces: 1,
            // thin z, length x, width y: L1 = top, L2 = bottom
            edges: { L1: null, L2: EB, W1: null, W2: null },
        });
        expect(partOf(model, 'table.apron.left')).toMatchObject({
            length: 700,
            width: 90,
            visibleFaces: 1,
            edges: { L1: null, L2: EB, W1: null, W2: null },
        });
    });

    it('hardware: 4 corner brackets, 16 dowels, 1 screw pack, no legs', () => {
        expect(hardwareKeys(model).sort()).toEqual([
            'table.connectors.corner',
            'table.connectors.dowel',
            'table.screws',
        ]);
        expect(lineOf(model, 'table.connectors.corner')).toMatchObject({
            code: 'CON-TBL-CORNER',
            qty: 4,
            reasonKey: 'hardware.reason.table_corner_brackets',
        });
        expect(lineOf(model, 'table.connectors.dowel')).toMatchObject({
            code: 'CON-DOWEL-8',
            qty: 16,
            reasonKey: 'hardware.reason.dowels',
        });
        expect(lineOf(model, 'table.screws')).toMatchObject({
            code: 'SCR-PACK',
            qty: 1,
        });
    });

    it('validates with the weight estimate only', () => {
        expect(
            validateFurniture(diningTable(), catalog).map((i) => i.code),
        ).toEqual(['furniture.weight_estimate']);
    });

    it('tableParts is the table step of the pipeline (no parts for a carcass context)', () => {
        const ctx = createGenContext(diningTable(), catalog);
        tableParts(ctx);
        expect(ctx.parts.map((p) => p.key).sort()).toEqual(keys(model));
    });
});

describe('four legs: hardware legs and leg checks', () => {
    const hardware = (
        H = 750,
        patch: (d: ReturnType<typeof diningTable>) => void = () => {},
    ) =>
        run(
            diningTable((d) => {
                d.dims.height = H;
                d.table.base.legSource = 'hardware';
                patch(d);
            }),
        );

    it('buys 4 table legs (LEG-TBL-710) instead of solid legs; s = the leg section 60', () => {
        const model = hardware();
        expect(lineOf(model, 'table.legs')).toMatchObject({
            code: 'LEG-TBL-710',
            qty: 4,
            reasonKey: 'hardware.reason.table_legs',
        });
        expect(keys(model).filter((k) => k.startsWith('table.leg.'))).toEqual(
            [],
        );
        expect(boxOf(model, 'table.apron.front')).toMatchObject({
            min: [110, 635, 817],
            size: [1580, 90, 18],
        });
        expect(boxOf(model, 'table.apron.left')).toMatchObject({
            min: [65, 635, 110],
            size: [18, 90, 680],
        });
    });

    it('checks the leg height against Hb: 710 +- 15 suits 695..725', () => {
        const mismatch = (H: number) =>
            issuesOf(hardware(H), 'furniture.leg_height_mismatch');
        expect(mismatch(750)).toEqual([]); // Hb 725
        expect(mismatch(720)).toEqual([]); // Hb 695
        expect(mismatch(751)).toHaveLength(1);
        expect(mismatch(719)).toHaveLength(1);
        expect(mismatch(785)[0]).toMatchObject({
            severity: 'warning',
            params: { code: 'LEG-TBL-710' },
            entityIds: ['table.legs'],
        });
    });

    it('uses an explicit leg code and its section', () => {
        const model = hardware(750, (d) => {
            d.table.base.legCode = 'LEG-CAB-ADJ';
        });
        expect(lineOf(model, 'table.legs')?.code).toBe('LEG-CAB-ADJ');
        expect(boxOf(model, 'table.apron.front').min[0]).toBe(90);
        // 100..160 range does not suit Hb 725
        expect(issuesOf(model, 'furniture.leg_height_mismatch')).toHaveLength(
            1,
        );
    });

    it('warns no_default_hardware without a default table leg (section 50)', () => {
        const model = run(
            diningTable((d) => {
                d.table.base.legSource = 'hardware';
            }),
            withoutDefault('leg.table'),
        );
        expect(lineOf(model, 'table.legs')).toBeUndefined();
        expect(issuesOf(model, 'furniture.no_default_hardware')).toMatchObject([
            { params: { roleKey: 'leg.table' } },
        ]);
        expect(boxOf(model, 'table.apron.front').min[0]).toBe(100);
    });

    it('solid legs with a section other than the leg board: info leg_section_mismatch, legs t_leg x s', () => {
        const model = run(
            diningTable((d) => {
                d.table.base.legSection = 60;
            }),
        );
        expect(issuesOf(model, 'furniture.leg_section_mismatch')).toMatchObject(
            [{ severity: 'info' }],
        );
        expect(boxOf(model, 'table.leg.fr')).toEqual({
            min: [1690, 0, 800],
            size: [60, 725, 50],
        });
        expect(
            issuesOf(run(diningTable()), 'furniture.leg_section_mismatch'),
        ).toEqual([]);
    });

    it('warns table_span_long above a 2400 base width', () => {
        const span = (W: number) =>
            issuesOf(
                run(
                    diningTable((d) => {
                        d.dims.width = W;
                    }),
                ),
                'furniture.table_span_long',
            );
        expect(span(2500)).toEqual([]); // Wb 2400
        expect(span(2501)).toMatchObject([{ severity: 'warning' }]);
    });

    it('apron disabled: no aprons, no corner brackets, no dowels', () => {
        const model = run(
            diningTable((d) => {
                d.table.base.apron.enabled = false;
            }),
        );
        expect(keys(model).filter((k) => k.includes('apron'))).toEqual([]);
        expect(hardwareKeys(model)).toEqual(['table.screws']);
    });
});

describe('four legs: stretchers and lower shelf', () => {
    it('stretcher: left/right/center at y [150, 210], +12 dowels', () => {
        const model = run(
            diningTable((d) => {
                d.table.base.stretcher = true;
            }),
        );
        expect(boxOf(model, 'table.stretcher.left')).toEqual({
            min: [50, 150, 100],
            size: [50, 60, 700],
        });
        expect(boxOf(model, 'table.stretcher.right')).toEqual({
            min: [1700, 150, 100],
            size: [50, 60, 700],
        });
        expect(boxOf(model, 'table.stretcher.center')).toEqual({
            min: [100, 150, 425],
            size: [1600, 60, 50],
        });
        expect(partOf(model, 'table.stretcher.left')).toMatchObject({
            nameKey: 'parts.stretcher',
            role: 'leg',
            length: 700,
            width: 60,
            grain: 'length',
            visibleFaces: 2,
            edges: { L1: null, L2: null, W1: null, W2: null },
        });
        expect(lineOf(model, 'table.connectors.dowel')?.qty).toBe(28);
    });

    it('lowerShelf: table.shelf at y [100, 118] banded front and back, +8 dowels', () => {
        const model = run(
            diningTable((d) => {
                d.table.storage.lowerShelf = true;
            }),
        );
        expect(boxOf(model, 'table.shelf')).toEqual({
            min: [100, 100, 100],
            size: [1600, 18, 700],
        });
        expect(partOf(model, 'table.shelf')).toMatchObject({
            nameKey: 'parts.lower_shelf',
            role: 'shelf',
            visibleFaces: 2,
            edges: { L1: EB, L2: EB, W1: null, W2: null },
        });
        expect(lineOf(model, 'table.connectors.dowel')?.qty).toBe(24);
    });

    it('sag rule reads the table.shelf key as a clamped shelf (Task 37 key)', () => {
        // PB18 clamped: warn 1200, critical 1500; span 1600
        const model = run(
            diningTable((d) => {
                d.table.storage.lowerShelf = true;
            }),
        );
        expect(issuesOf(model, 'furniture.shelf_sag_critical')).toMatchObject([
            {
                params: { partKey: 'table.shelf', span: 1600, limit: 1500 },
                entityIds: ['table.shelf'],
            },
        ]);
        const narrower = run(
            diningTable((d) => {
                d.dims.width = 1400; // span 1200: at the clamped warn limit
                d.table.storage.lowerShelf = true;
            }),
        );
        expect(
            narrower.issues.filter((i) =>
                i.code.startsWith('furniture.shelf_sag'),
            ),
        ).toEqual([]);
    });
});

describe('top shapes and thickness (07 §3.13 top)', () => {
    const shaped = (patch: (d: ReturnType<typeof diningTable>) => void) =>
        run(diningTable(patch));

    it('round with W != D: error round_top_not_square', () => {
        const model = shaped((d) => {
            d.table.top.shape = 'round';
        });
        expect(issuesOf(model, 'furniture.round_top_not_square')).toMatchObject(
            [{ severity: 'error', entityIds: ['table.top'] }],
        );
        // drawn as the W x D ellipse, so the top stays inside the bbox
        expect(partOf(model, 'table.top').geometry).toMatchObject({
            kind: 'extruded',
            outline: ellipseOutline(1800, 900),
        });
    });

    it('clamps the outline radius to min(W, D)/2 when the radius is too large', () => {
        const model = shaped((d) => {
            d.table.top.shape = 'rounded_rectangle';
            d.table.top.cornerRadius = 5000;
        });
        const g = partOf(model, 'table.top').geometry;
        expect(g).toMatchObject({
            outline: roundedRectOutline(1800, 900, 450),
        });
        for (const [x, z] of g.kind === 'extruded' ? g.outline : []) {
            expect(x).toBeGreaterThanOrEqual(0);
            expect(x).toBeLessThanOrEqual(1800);
            expect(z).toBeGreaterThanOrEqual(0);
            expect(z).toBeLessThanOrEqual(900);
        }
    });

    it('rounded rectangle r 100: extruded outline of 4 x 8 corner segments', () => {
        const model = shaped((d) => {
            d.table.top.shape = 'rounded_rectangle';
            d.table.top.cornerRadius = 100;
        });
        const top = partOf(model, 'table.top');
        expect(top.geometry).toMatchObject({
            kind: 'extruded',
            plane: 'xz',
            y: 725,
            thickness: 25,
        });
        expect(top.geometry).toEqual({
            kind: 'extruded',
            plane: 'xz',
            y: 725,
            thickness: 25,
            outline: roundedRectOutline(1800, 900, 100),
        });
        // nesting uses the bounding rectangle
        expect(top).toMatchObject({ length: 1800, width: 900 });
        expect(issuesOf(model, 'furniture.corner_radius_too_large')).toEqual(
            [],
        );
    });

    it('corner radius above min(W, D)/2: error corner_radius_too_large', () => {
        const radius = (r: number) =>
            issuesOf(
                shaped((d) => {
                    d.table.top.shape = 'rounded_rectangle';
                    d.table.top.cornerRadius = r;
                }),
                'furniture.corner_radius_too_large',
            );
        expect(radius(450)).toEqual([]);
        expect(radius(451)).toMatchObject([{ severity: 'error' }]);
        // a rectangle ignores the radius
        expect(
            issuesOf(
                shaped((d) => {
                    d.table.top.cornerRadius = 5000;
                }),
                'furniture.corner_radius_too_large',
            ),
        ).toEqual([]);
    });

    it('round 1000: 64-segment circle, legs in the inscribed square (Wb = fl(900 / sqrt 2) = 636)', () => {
        const model = shaped((d) => {
            d.dims.width = 1000;
            d.dims.depth = 1000;
            d.table.top.shape = 'round';
        });
        const top = partOf(model, 'table.top');
        expect(top.geometry).toMatchObject({
            kind: 'extruded',
            outline: circleOutline(1000),
        });
        expect(
            top.geometry.kind === 'extruded' && top.geometry.outline,
        ).toHaveLength(64);
        // bx0 = bz0 = (1000 - 636) / 2 = 182
        expect(boxOf(model, 'table.leg.fl')).toEqual({
            min: [182, 0, 768],
            size: [50, 725, 50],
        });
        expect(boxOf(model, 'table.leg.br').min).toEqual([768, 0, 182]);
        expect(issuesOf(model, 'furniture.round_top_not_square')).toEqual([]);
    });

    it('oval: 64-segment ellipse W x D, legs in the inscribed rectangle', () => {
        const model = shaped((d) => {
            d.table.top.shape = 'oval';
        });
        expect(partOf(model, 'table.top').geometry).toMatchObject({
            outline: ellipseOutline(1800, 900),
        });
        // Wb = fl(1700 / sqrt 2) = 1202, bx0 = 299; Db = fl(800 / sqrt 2) = 565, bz0 = 167.5
        expect(boxOf(model, 'table.leg.fl')).toEqual({
            min: [299, 0, 682.5],
            size: [50, 725, 50],
        });
    });

    it('thickness 50 with 25 mm board: 2 layers, Hb 700', () => {
        const model = shaped((d) => {
            d.table.top.thickness = 50;
        });
        expect(boxOf(model, 'table.top')).toEqual({
            min: [0, 725, 0],
            size: [1800, 25, 900],
        });
        expect(boxOf(model, 'table.top.layer.2')).toEqual({
            min: [0, 700, 0],
            size: [1800, 25, 900],
        });
        expect(partOf(model, 'table.top.layer.2')).toMatchObject({
            nameKey: 'parts.table_top_layer',
            nameParams: { n: 2 },
            role: 'top',
            visibleFaces: 0,
            edges: { L1: EB_TOP, L2: EB_TOP, W1: EB_TOP, W2: EB_TOP },
        });
        expect(boxOf(model, 'table.leg.fl').size[1]).toBe(700);
        expect(
            issuesOf(model, 'furniture.table_top_thickness_rounded'),
        ).toEqual([]);
    });

    it('thickness 40: rounded to 2 layers with info table_top_thickness_rounded', () => {
        const model = shaped((d) => {
            d.table.top.thickness = 40;
        });
        expect(keys(model)).toContain('table.top.layer.2');
        expect(keys(model)).not.toContain('table.top.layer.3');
        expect(
            issuesOf(model, 'furniture.table_top_thickness_rounded'),
        ).toMatchObject([{ severity: 'info' }]);
    });

    it('thickness 10: at least one layer, rounded', () => {
        const model = shaped((d) => {
            d.table.top.thickness = 10;
        });
        expect(keys(model).filter((k) => k.startsWith('table.top'))).toEqual([
            'table.top',
        ]);
        expect(
            issuesOf(model, 'furniture.table_top_thickness_rounded'),
        ).toHaveLength(1);
        expect(
            issuesOf(
                shaped((d) => {
                    d.table.top.thickness = 25;
                }),
                'furniture.table_top_thickness_rounded',
            ),
        ).toEqual([]);
    });

    it('extruded layers share the outline at their own height', () => {
        const model = shaped((d) => {
            d.table.top.shape = 'oval';
            d.table.top.thickness = 50;
        });
        expect(partOf(model, 'table.top.layer.2').geometry).toMatchObject({
            kind: 'extruded',
            y: 700,
            thickness: 25,
            outline: ellipseOutline(1800, 900),
        });
    });
});

describe('under-top drawers on four legs', () => {
    const withDrawers = (
        count: number,
        side: 'front' | 'left' | 'right' = 'front',
    ) =>
        run(
            diningTable((d) => {
                d.table.storage.drawers = { count, side, slideCode: null };
            }),
        );

    it('one front drawer: 600 x 90 front flush with the apron plane, no front apron', () => {
        const model = withDrawers(1);
        expect(keys(model)).not.toContain('table.apron.front');
        expect(keys(model)).toContain('table.apron.back');
        // span 1600 from x 100; ws 600 centred: x [600, 1200]
        expect(boxOf(model, 'table.drawer.1.front')).toEqual({
            min: [600, 635, 817],
            size: [600, 90, 18],
        });
        expect(partOf(model, 'table.drawer.1.front')).toMatchObject({
            nameKey: 'parts.drawer_front',
            role: 'front',
            visibleFaces: 2,
            edges: { L1: EB, L2: EB, W1: EB, W2: EB },
        });
        expect(model.fronts).toEqual([
            {
                id: 'table.drawer.1.front',
                frontId: null,
                kind: 'drawer',
                rect: { x: 600, y: 635, w: 600, h: 90 },
                partKey: 'table.drawer.1.front',
            },
        ]);
    });

    it('runners hang under the top beside the slot: depthAvail x (fh + 20)', () => {
        const model = withDrawers(1);
        // depthAvail = 800 - 2 x 15 - 18 = 752, from the apron plane z 835
        expect(boxOf(model, 'table.drawer.1.runner.left')).toEqual({
            min: [582, 615, 83],
            size: [18, 110, 752],
        });
        expect(boxOf(model, 'table.drawer.1.runner.right')).toEqual({
            min: [1200, 615, 83],
            size: [18, 110, 752],
        });
        expect(partOf(model, 'table.drawer.1.runner.left')).toMatchObject({
            nameKey: 'parts.drawer_runner',
            role: 'carcass',
            length: 752,
            width: 110,
            operations: { slideScrewSets: 1 },
        });
    });

    it('box per 07 §3.12: Wo 600, slot 110 -> box 70, slide by A - t_f - 10 = 724 -> 600', () => {
        const model = withDrawers(1);
        expect(lineOf(model, 'table.drawer.1.slides')).toMatchObject({
            code: 'SLD-BB-600',
            qty: 1,
            sectionId: null,
            frontId: null,
        });
        // Wb = fl(600 - 25.4) = 574, x0 = 600 + 13 = 613; zf = 835 - 18 = 817
        expect(boxOf(model, 'table.drawer.1.side.left')).toEqual({
            min: [613, 635, 217],
            size: [12, 70, 600],
        });
        expect(partOf(model, 'table.drawer.1.back').length).toBe(550);
        expect(issuesOf(model, 'furniture.drawer_depth_unused')).toMatchObject([
            { params: { unused: 124 }, entityIds: ['table.drawer.1'] },
        ]);
    });

    it('handle: the default handle (handle.default), 1 per front up to 600 wide', () => {
        const model = withDrawers(1);
        expect(lineOf(model, 'table.drawer.1.handle')).toMatchObject({
            code: 'HDL-BAR-160',
            qty: 1,
            reasonKey: 'hardware.reason.handle_for_drawer',
        });
        expect(
            partOf(model, 'table.drawer.1.front').operations.handleHoles,
        ).toBe(2);
    });

    it('three drawers fill the bay less the outer runners: ws = fl((1600 - 36 - 100) / 3) = 488', () => {
        const model = withDrawers(3);
        expect(
            [1, 2, 3].map(
                (j) => boxOf(model, `table.drawer.${j}.front`).min[0],
            ),
        ).toEqual([118, 656, 1194]);
        expect(partOf(model, 'table.drawer.2.front').length).toBe(488);
        // the outer runners stand against the inner faces of the legs (x 100, 1700)
        expect(boxOf(model, 'table.drawer.1.runner.left').min[0]).toBe(100);
        expect(boxOf(model, 'table.drawer.3.runner.right')).toMatchObject({
            min: [1682, 615, 83],
        });
        expect(partOverlaps(model.parts)).toEqual([]);
        // dowels: 3 aprons x 4
        expect(lineOf(model, 'table.connectors.dowel')?.qty).toBe(12);
        expect(lineOf(model, 'table.connectors.corner')?.qty).toBe(4);
    });

    it('clamps the apron inset to s - t_c when inset + t_c > s, so the aprons never cross', () => {
        // LEG-CAB-ADJ has a 40 mm section: inset 30 + 18 > 40 -> inset 22
        const model = run(
            diningTable((d) => {
                d.table.base.legSource = 'hardware';
                d.table.base.legCode = 'LEG-CAB-ADJ';
                d.table.base.apron.inset = 30;
                d.table.storage.drawers = withCount(3, 'front');
            }),
        );
        expect(issuesOf(model, 'furniture.apron_inset_clamped')).toEqual([
            {
                code: 'furniture.apron_inset_clamped',
                severity: 'info',
                messageKey: 'engine.furniture.issue.apron_inset_clamped',
                params: { requested: 30, applied: 22 },
                entityIds: [],
            },
        ]);
        expect(boxOf(model, 'table.apron.left')).toMatchObject({
            min: [72, 635, 90],
        });
        expect(boxOf(model, 'table.apron.back').min[2]).toBe(72);
        // the drawers sit in the clamped apron plane: 850 - 22
        expect(boxOf(model, 'table.drawer.1.front').min[2]).toBe(810);
        expect(
            boxOf(model, 'table.drawer.1.runner.left').min[0],
        ).toBeGreaterThanOrEqual(90);
        expect(partOverlaps(model.parts)).toEqual([]);
        // inset + t_c = s exactly is kept
        const exact = run(
            diningTable((d) => {
                d.table.base.legSource = 'hardware';
                d.table.base.legCode = 'LEG-CAB-ADJ';
                d.table.base.apron.inset = 22;
            }),
        );
        expect(issuesOf(exact, 'furniture.apron_inset_clamped')).toEqual([]);
        expect(
            issuesOf(run(diningTable()), 'furniture.apron_inset_clamped'),
        ).toEqual([]);
    });

    it('legs thinner than the apron board: inset 0, the bay starts at the apron face', () => {
        const model = run(
            diningTable((d) => {
                d.table.base.legSection = 10;
                d.table.base.apron.inset = 5;
                d.table.storage.drawers = withCount(3, 'front');
            }),
        );
        expect(issuesOf(model, 'furniture.apron_inset_clamped')).toMatchObject([
            { params: { requested: 5, applied: 0 } },
        ]);
        // left apron x [50, 68] reaches past the 10 mm leg
        expect(
            boxOf(model, 'table.drawer.1.runner.left').min[0],
        ).toBeGreaterThanOrEqual(68);
    });

    it('warns table_drawers_dont_fit when the bay cannot take the drawers, and builds none', () => {
        // W 200: Wb 100 = the two legs, bay 0
        const none = run(
            diningTable((d) => {
                d.dims.width = 200;
                d.table.storage.drawers = withCount(1, 'front');
            }),
        );
        // required: 2 runners + one box of fl(Wo - 25.4) - 24 >= 1 -> Wo 51
        expect(issuesOf(none, 'furniture.table_drawers_dont_fit')).toEqual([
            {
                code: 'furniture.table_drawers_dont_fit',
                severity: 'warning',
                messageKey: 'engine.furniture.issue.table_drawers_dont_fit',
                params: { available: 0, required: 87 },
                entityIds: [],
            },
        ]);
        expect(keys(none).filter((k) => k.includes('drawer'))).toEqual([]);
        // legs wider than the table leave a negative bay: reported as 0
        const crossed = run(
            diningTable((d) => {
                d.dims.width = 120;
                d.table.storage.drawers = withCount(1, 'front');
            }),
        );
        expect(
            issuesOf(crossed, 'furniture.table_drawers_dont_fit'),
        ).toMatchObject([{ params: { available: 0, required: 87 } }]);
        // a bay with room for the front but not for a box with inner width
        const narrow = (W: number, count: number) =>
            run(
                diningTable((d) => {
                    d.dims.width = W;
                    d.table.storage.drawers = withCount(count, 'front');
                }),
            );
        // W 286: bay 86 -> ws 50 < 51
        expect(
            issuesOf(narrow(286, 1), 'furniture.table_drawers_dont_fit'),
        ).toMatchObject([{ params: { available: 86, required: 87 } }]);
        expect(
            keys(narrow(286, 1)).filter((k) => k.includes('drawer')),
        ).toEqual([]);
        // W 287: bay 87 -> ws 51 builds a box 1 mm wide inside
        expect(
            issuesOf(narrow(287, 1), 'furniture.table_drawers_dont_fit'),
        ).toEqual([]);
        expect(partOf(narrow(287, 1), 'table.drawer.1.back').width).toBe(1);
        // 3 drawers need 2 x 18 + 3 x 51 + 2 x 50 = 289
        expect(
            issuesOf(narrow(488, 3), 'furniture.table_drawers_dont_fit'),
        ).toMatchObject([{ params: { available: 288, required: 289 } }]);
        expect(
            issuesOf(narrow(489, 3), 'furniture.table_drawers_dont_fit'),
        ).toEqual([]);
    });

    it('measures the undermount minimum by its inner width deduction (42 + 1)', () => {
        const model = (W: number) =>
            run(
                diningTable((d) => {
                    d.dims.width = W;
                    d.table.storage.drawers = {
                        count: 1,
                        side: 'front',
                        slideCode: 'SLD-UM-450',
                    };
                }),
            );
        expect(
            issuesOf(model(278), 'furniture.table_drawers_dont_fit'),
        ).toMatchObject([{ params: { available: 78, required: 79 } }]);
        expect(
            issuesOf(model(279), 'furniture.table_drawers_dont_fit'),
        ).toEqual([]);
    });

    it('keeps neighbouring runners apart when 2 t_c exceeds the 50 mm spacing', () => {
        // 30 mm carcass board: drawers 60 apart
        const model = run(
            diningTable((d) => {
                d.table.storage.drawers = withCount(3, 'front');
            }),
            withThickness('PB18-WHITE', 30),
        );
        const x0 = (j: number) =>
            boxOf(model, `table.drawer.${j}.front`).min[0];
        const ws = partOf(model, 'table.drawer.1.front').length;
        expect(x0(2) - x0(1) - ws).toBe(60);
        expect(partOverlaps(model.parts)).toEqual([]);
    });

    it('two drawers cap at 600 and stay centred', () => {
        const model = withDrawers(2);
        expect(
            [1, 2].map((j) => boxOf(model, `table.drawer.${j}.front`).min[0]),
        ).toEqual([275, 925]);
    });

    it('left drawer: front in the left apron plane, box running along +x', () => {
        const model = withDrawers(1, 'left');
        expect(keys(model)).not.toContain('table.apron.left');
        expect(keys(model)).toContain('table.apron.front');
        // span z [100, 800], ws 600 centred: z [150, 750]; plane x = 65
        expect(boxOf(model, 'table.drawer.1.front')).toEqual({
            min: [65, 635, 150],
            size: [18, 90, 600],
        });
        expect(partOf(model, 'table.drawer.1.front')).toMatchObject({
            length: 600,
            width: 90,
            edges: { L1: EB, L2: EB, W1: EB, W2: EB },
        });
        // A = 1700 / 2 - 50 = 800 -> maxLen 790 -> 600; box x [83, 683]
        expect(lineOf(model, 'table.drawer.1.slides')?.code).toBe('SLD-BB-600');
        expect(boxOf(model, 'table.drawer.1.side.left')).toEqual({
            min: [83, 635, 163],
            size: [600, 70, 12],
        });
        expect(boxOf(model, 'table.drawer.1.side.right').min[2]).toBe(725);
        expect(boxOf(model, 'table.drawer.1.runner.left')).toEqual({
            min: [65, 615, 132],
            size: [800, 110, 18],
        });
        // the side keeps its finished size and band on top
        expect(partOf(model, 'table.drawer.1.side.left')).toMatchObject({
            length: 600,
            width: 70,
        });
        expect(model.fronts).toEqual([]);
    });

    it('right drawer: mirrored in the right apron plane', () => {
        const model = withDrawers(1, 'right');
        expect(keys(model)).not.toContain('table.apron.right');
        // plane x = 1750 - 15 = 1735
        expect(boxOf(model, 'table.drawer.1.front')).toEqual({
            min: [1717, 635, 150],
            size: [18, 90, 600],
        });
        expect(boxOf(model, 'table.drawer.1.side.left')).toEqual({
            min: [1117, 635, 725],
            size: [600, 70, 12],
        });
    });

    it('side drawers keep the physical meaning of their edges (edgeMap turned with them)', () => {
        const edgesFor = (side: 'left' | 'right') => {
            const ctx = createGenContext(
                diningTable((d) => {
                    d.table.storage.drawers = withCount(1, side);
                }),
                catalog,
            );
            tableParts(ctx);
            return {
                front: ctx.edgeMap.get('table.drawer.1.front'),
                sideLeft: ctx.edgeMap.get('table.drawer.1.side.left'),
            };
        };
        // built facing +z: the front's W1/W2 are its left/right ends, the box
        // side's W1/W2 its front/back ends
        expect(edgesFor('left')).toEqual({
            front: { L1: 'top', L2: 'bottom', W1: 'back', W2: 'front' },
            sideLeft: { L1: 'top', L2: 'bottom', W1: 'left', W2: 'right' },
        });
        expect(edgesFor('right')).toEqual({
            front: { L1: 'top', L2: 'bottom', W1: 'front', W2: 'back' },
            sideLeft: { L1: 'top', L2: 'bottom', W1: 'right', W2: 'left' },
        });
    });

    it('an override resizes a turned drawer part along its real axes', () => {
        const resized = (side: 'left' | 'right') =>
            run(
                diningTable((d) => {
                    d.table.storage.drawers = withCount(1, side);
                    d.overrides.parts['table.drawer.1.side.left'] = {
                        lengthDelta: -50,
                        widthDelta: -10,
                    };
                    d.overrides.parts['table.drawer.1.front'] = {
                        lengthDelta: -100,
                    };
                }),
            );
        const left = resized('left');
        // the box side runs along x (600 -> 550) and is 70 high (-> 60)
        expect(boxOf(left, 'table.drawer.1.side.left')).toEqual({
            min: [83, 635, 163],
            size: [550, 60, 12],
        });
        expect(partOf(left, 'table.drawer.1.side.left')).toMatchObject({
            length: 550,
            width: 60,
        });
        // the front runs along z (600 -> 500)
        expect(boxOf(left, 'table.drawer.1.front').size).toEqual([18, 90, 500]);
        expect(
            boxOf(resized('right'), 'table.drawer.1.side.left').size,
        ).toEqual([550, 60, 12]);
    });

    it('a slide too short for its box: error drawer_no_slide, no box (m5)', () => {
        const shortBox = mutateCatalog(catalog, (draft) => {
            for (const h of draft.hardware) {
                if (h.code === 'SLD-UM-350') h.specs.lengthDeductionMm = 400;
            }
        });
        const model = run(
            diningTable((d) => {
                d.table.storage.drawers = {
                    count: 1,
                    side: 'front',
                    slideCode: 'SLD-UM-350',
                };
            }),
            shortBox,
        );
        expect(issuesOf(model, 'furniture.drawer_no_slide')).toMatchObject([
            {
                severity: 'error',
                params: { availableDepth: 734 },
                entityIds: ['table.drawer.1'],
            },
        ]);
        expect(
            keys(model).filter((k) =>
                /^table\.drawer\.1\.(side|back|bottom)/.test(k),
            ),
        ).toEqual([]);
    });

    it('count 0 is no drawers', () => {
        expect(keys(withDrawers(0))).toEqual(keys(run(diningTable())));
    });

    it('without an apron the front is TABLE_DRAWER_FRONT_HEIGHT (120) high', () => {
        const model = run(
            diningTable((d) => {
                d.table.base.apron.enabled = false;
                d.table.storage.drawers = {
                    count: 1,
                    side: 'front',
                    slideCode: null,
                };
            }),
        );
        expect(boxOf(model, 'table.drawer.1.front')).toMatchObject({
            min: [600, 605, 817],
            size: [600, 120, 18],
        });
    });

    it('four short drawers stay four distinct issues through validation (Task 37 M2)', () => {
        const doc = diningTable((d) => {
            d.table.base.apron.height = 50; // slot 70 -> box 30 < 60
            d.table.storage.drawers = {
                count: 3,
                side: 'front',
                slideCode: null,
            };
        });
        const issues = validateFurniture(doc, catalog).filter(
            (i) => i.code === 'furniture.drawer_too_low',
        );
        expect(issues.map((i) => i.entityIds)).toEqual([
            ['table.drawer.1'],
            ['table.drawer.2'],
            ['table.drawer.3'],
        ]);
    });
});

describe('panel ends', () => {
    const panelDesk = (
        patch: (d: ReturnType<typeof studyDesk>) => void = () => {},
    ) =>
        run(
            studyDesk((d) => {
                d.table.base.type = 'panel_ends';
                d.table.storage.endCabinets = null;
                patch(d);
            }),
        );

    it('two ends banded front and back, the modesty panel banded bottom', () => {
        const model = panelDesk();
        expect(keys(model)).toEqual([
            'table.end.left',
            'table.end.right',
            'table.stretcher.back',
            'table.top',
        ]);
        expect(boxOf(model, 'table.end.left')).toEqual({
            min: [0, 0, 0],
            size: [18, 725, 600],
        });
        expect(boxOf(model, 'table.end.right').min).toEqual([1182, 0, 0]);
        expect(partOf(model, 'table.end.left')).toMatchObject({
            nameKey: 'parts.end_panel',
            role: 'carcass',
            length: 725,
            width: 600,
            visibleFaces: 2,
            // thin x, length y, width z: L1 = front, L2 = back
            edges: { L1: EB, L2: EB, W1: null, W2: null },
        });
        // mh = min(400, fl(725 / 2)) = 362
        expect(boxOf(model, 'table.stretcher.back')).toEqual({
            min: [18, 363, 20],
            size: [1164, 362, 18],
        });
        expect(partOf(model, 'table.stretcher.back')).toMatchObject({
            nameKey: 'parts.modesty_panel',
            visibleFaces: 1,
            edges: { L1: null, L2: EB, W1: null, W2: null },
        });
    });

    it('joints: ends to the top, modesty to each end; one cam and one dowel line', () => {
        const model = panelDesk();
        expect(lineOf(model, 'table.connectors.cam')).toMatchObject({
            code: 'CON-CAM-15',
            qty: 8,
            reasonParams: { joints: 4 },
        });
        expect(lineOf(model, 'table.connectors.dowel')?.qty).toBe(8);
        expect(partOf(model, 'table.end.left').operations).toMatchObject({
            camLocks: 2,
            dowels: 2,
        });
        expect(partOf(model, 'table.stretcher.back').operations.camLocks).toBe(
            4,
        );
        expect(hardwareKeys(model).sort()).toEqual([
            'table.connectors.cam',
            'table.connectors.dowel',
            'table.screws',
        ]);
    });

    it('caps the modesty height at MODESTY_MAX_HEIGHT (Hb 975)', () => {
        const model = panelDesk((d) => {
            d.dims.height = 1000;
        });
        expect(boxOf(model, 'table.stretcher.back').size[1]).toBe(400);
    });

    it('lower shelf: banded front only, joined to the ends', () => {
        const model = panelDesk((d) => {
            d.table.storage.lowerShelf = true;
        });
        expect(boxOf(model, 'table.shelf')).toEqual({
            min: [18, 100, 0],
            size: [1164, 18, 580],
        });
        expect(edgesOf(model, 'table.shelf')).toEqual({
            L1: EB,
            L2: null,
            W1: null,
            W2: null,
        });
        expect(lineOf(model, 'table.connectors.cam')?.qty).toBe(12);
    });

    it('front drawer: span between the ends, fh 120, A = Db - 40', () => {
        const model = panelDesk((d) => {
            d.table.storage.drawers = {
                count: 1,
                side: 'front',
                slideCode: null,
            };
        });
        expect(boxOf(model, 'table.drawer.1.front')).toEqual({
            min: [300, 605, 582],
            size: [600, 120, 18],
        });
        expect(boxOf(model, 'table.drawer.1.runner.left')).toEqual({
            min: [282, 585, 40],
            size: [18, 140, 560],
        });
        // A = 600 - 40 = 560, less the front: 542 -> maxLen 532 -> 500
        expect(lineOf(model, 'table.drawer.1.slides')?.code).toBe('SLD-BB-500');
        expect(boxOf(model, 'table.drawer.1.side.left').min[2]).toBe(82);
        expect(partOverlaps(model.parts)).toEqual([]);
    });

    it('a side drawer is an error and builds nothing', () => {
        const model = panelDesk((d) => {
            d.table.storage.drawers = {
                count: 1,
                side: 'left',
                slideCode: null,
            };
        });
        expect(
            issuesOf(model, 'furniture.table_drawer_side_unsupported'),
        ).toMatchObject([{ severity: 'error', params: {}, entityIds: [] }]);
        expect(keys(model).filter((k) => k.includes('drawer'))).toEqual([]);
    });
});

describe('trestle', () => {
    const model = run(
        diningTable((d) => {
            d.table.base.type = 'trestle';
            d.table.base.apron.enabled = false;
        }),
    );

    it('builds upright, foot and cleat per side and the centre stretcher', () => {
        expect(keys(model)).toEqual([
            'table.stretcher.center',
            'table.top',
            'table.trestle.left.cleat',
            'table.trestle.left.foot',
            'table.trestle.left.upright',
            'table.trestle.right.cleat',
            'table.trestle.right.foot',
            'table.trestle.right.upright',
        ]);
        // cx = 100 (left), 1700 (right)
        expect(boxOf(model, 'table.trestle.left.upright')).toEqual({
            min: [75, 80, 400],
            size: [50, 565, 100],
        });
        expect(boxOf(model, 'table.trestle.left.foot')).toEqual({
            min: [75, 0, 50],
            size: [50, 80, 800],
        });
        expect(boxOf(model, 'table.trestle.right.cleat')).toEqual({
            min: [1675, 645, 50],
            size: [50, 80, 800],
        });
        expect(boxOf(model, 'table.stretcher.center')).toEqual({
            min: [125, 322.5, 425],
            size: [1550, 80, 50],
        });
        expect(partOf(model, 'table.trestle.left.upright')).toMatchObject({
            nameKey: 'parts.trestle_upright',
            role: 'leg',
            grain: 'length',
            visibleFaces: 2,
            edges: { L1: null, L2: null, W1: null, W2: null },
        });
        expect(partOf(model, 'table.trestle.left.foot')).toMatchObject({
            nameKey: 'parts.trestle_foot',
            length: 800,
            width: 80,
            grain: 'length',
        });
        expect(partOf(model, 'table.trestle.left.cleat').nameKey).toBe(
            'parts.trestle_cleat',
        );
    });

    it('hardware: 4 cams and 8 dowels', () => {
        expect(lineOf(model, 'table.connectors.cam')).toMatchObject({
            code: 'CON-CAM-15',
            qty: 4,
        });
        expect(lineOf(model, 'table.connectors.dowel')?.qty).toBe(8);
        expect(hardwareKeys(model).sort()).toEqual([
            'table.connectors.cam',
            'table.connectors.dowel',
            'table.screws',
        ]);
    });

    it('no carcass parts: no thin_carcass for a thin carcass board (Task 37 branch)', () => {
        const thin = withThickness('PB18-WHITE', 12);
        const trestle = run(
            diningTable((d) => {
                d.table.base.type = 'trestle';
            }),
            thin,
        );
        expect(issuesOf(trestle, 'furniture.thin_carcass')).toEqual([]);
        expect(
            issuesOf(run(diningTable(), thin), 'furniture.thin_carcass'),
        ).toHaveLength(1);
    });

    it('under-top drawers are not supported', () => {
        const drawers = run(
            diningTable((d) => {
                d.table.base.type = 'trestle';
                d.table.storage.drawers = {
                    count: 1,
                    side: 'front',
                    slideCode: null,
                };
            }),
        );
        expect(
            issuesOf(drawers, 'furniture.table_drawer_side_unsupported'),
        ).toHaveLength(1);
        expect(keys(drawers).filter((k) => k.includes('drawer'))).toEqual([]);
    });
});

describe('pedestal', () => {
    const pedestal = (size: number) =>
        run(
            diningTable((d) => {
                d.dims.width = size;
                d.dims.depth = size;
                d.table.top.shape = 'round';
                d.table.base.type = 'pedestal';
                d.table.base.apron.enabled = false;
            }),
        );

    it('round 1300: column c = 300 around the centre, base 780, top plate 436', () => {
        const model = pedestal(1300);
        expect(keys(model)).toEqual([
            'table.pedestal.base',
            'table.pedestal.side.1',
            'table.pedestal.side.2',
            'table.pedestal.side.3',
            'table.pedestal.side.4',
            'table.pedestal.top',
            'table.top',
        ]);
        expect(boxOf(model, 'table.pedestal.side.1')).toEqual({
            min: [482, 18, 800],
            size: [336, 689, 18],
        });
        expect(boxOf(model, 'table.pedestal.side.3')).toEqual({
            min: [482, 18, 482],
            size: [336, 689, 18],
        });
        expect(boxOf(model, 'table.pedestal.side.2')).toEqual({
            min: [482, 18, 500],
            size: [18, 689, 300],
        });
        expect(boxOf(model, 'table.pedestal.side.4').min).toEqual([
            800, 18, 500,
        ]);
        expect(boxOf(model, 'table.pedestal.base')).toEqual({
            min: [260, 0, 260],
            size: [780, 18, 780],
        });
        expect(boxOf(model, 'table.pedestal.top')).toEqual({
            min: [432, 707, 432],
            size: [436, 18, 436],
        });
        expect(partOf(model, 'table.pedestal.side.1')).toMatchObject({
            nameKey: 'parts.pedestal_side',
            role: 'carcass',
            visibleFaces: 2,
            edges: { L1: null, L2: null, W1: null, W2: null },
        });
        expect(partOf(model, 'table.pedestal.base')).toMatchObject({
            nameKey: 'parts.pedestal_plate',
            visibleFaces: 0,
            edges: { L1: EB, L2: EB, W1: EB, W2: EB },
        });
        // 07 §5.2 bands only the base plate
        expect(partOf(model, 'table.pedestal.top')).toMatchObject({
            nameKey: 'parts.pedestal_plate',
            visibleFaces: 0,
            edges: { L1: null, L2: null, W1: null, W2: null },
        });
    });

    it('warns pedestal_unstable above 1200', () => {
        expect(
            issuesOf(pedestal(1300), 'furniture.pedestal_unstable'),
        ).toMatchObject([{ severity: 'warning' }]);
        expect(issuesOf(pedestal(1200), 'furniture.pedestal_unstable')).toEqual(
            [],
        );
    });

    it('small tables: column at least 150, base at least 400', () => {
        const model = pedestal(700);
        // Wb 600 -> c = max(150, 150); base max(400, 420) = 420
        expect(boxOf(model, 'table.pedestal.side.2').size[2]).toBe(150);
        expect(boxOf(model, 'table.pedestal.base').size[0]).toBe(420);
        expect(
            boxOf(
                run(
                    diningTable((d) => {
                        d.dims.width = 600;
                        d.dims.depth = 600;
                        d.table.top.shape = 'round';
                        d.table.base.type = 'pedestal';
                    }),
                ),
                'table.pedestal.base',
            ).size[0],
        ).toBe(400);
    });
});

describe('cabinet ends: study desk defaults (07 §2.4.14)', () => {
    const model = run(studyDesk());

    it('cabinet sides show one face like carcass sides; bottom and back none', () => {
        expect(
            [
                'table.cabinet.side.left',
                'table.cabinet.side.right',
                'table.cabinet.bottom',
                'table.cabinet.back',
            ].map((k) => partOf(model, k).visibleFaces),
        ).toEqual([1, 1, 0, 0]);
    });

    it('a panel end on the left and a 400 mm cabinet on the right', () => {
        expect(boxOf(model, 'table.end.left')).toEqual({
            min: [0, 0, 0],
            size: [18, 725, 600],
        });
        expect(edgesOf(model, 'table.end.left')).toEqual({
            L1: EB,
            L2: EB,
            W1: null,
            W2: null,
        });
        expect(keys(model)).not.toContain('table.end.right');
        // Dk = 600 - 18 = 582
        expect(boxOf(model, 'table.cabinet.side.left')).toEqual({
            min: [800, 0, 0],
            size: [18, 725, 582],
        });
        expect(partOf(model, 'table.cabinet.side.left')).toMatchObject({
            length: 725,
            width: 582,
            edges: { L1: EB, L2: null, W1: null, W2: null },
        });
        expect(boxOf(model, 'table.cabinet.side.right').min).toEqual([
            1182, 0, 0,
        ]);
        expect(boxOf(model, 'table.cabinet.bottom')).toEqual({
            min: [818, 0, 3],
            size: [364, 18, 579],
        });
        // thin y, length z (579), width x: W1 = front
        expect(edgesOf(model, 'table.cabinet.bottom')).toEqual({
            L1: null,
            L2: null,
            W1: EB,
            W2: null,
        });
        expect(boxOf(model, 'table.cabinet.back')).toEqual({
            min: [818, 18, 0],
            size: [364, 707, 3],
        });
        expect(partOf(model, 'table.cabinet.back')).toMatchObject({
            role: 'back',
            edges: { L1: null, L2: null, W1: null, W2: null },
        });
    });

    it('drawer fronts: 397 wide (X [801.5, 1198.5]), 2 mm under the top', () => {
        const fronts = [1, 2, 3].map((j) =>
            boxOf(model, `table.cabinet.drawer.${j}.front`),
        );
        for (const box of fronts) {
            expect(box.min[0]).toBe(801.5);
            expect(box.size[0]).toBe(397);
            // full overlay in front of the cabinet: z [582, 600]
            expect(box.min[2]).toBe(582);
        }
        expect((fronts[0]?.min[1] ?? 0) + (fronts[0]?.size[1] ?? 0)).toBe(723);
        expect(fronts[2]?.min[1]).toBeCloseTo(1.5, 9);
        expect(partOf(model, 'table.cabinet.drawer.1.front').length).toBe(397);
        expect(model.fronts.map((f) => f.id)).toEqual([
            'table.cabinet.drawer.1.front',
            'table.cabinet.drawer.2.front',
            'table.cabinet.drawer.3.front',
        ]);
    });

    it('slides SLD-BB-550 x 3 (interior depth 579), default handles', () => {
        for (const j of [1, 2, 3]) {
            expect(
                lineOf(model, `table.cabinet.drawer.${j}.slides`),
            ).toMatchObject({ code: 'SLD-BB-550', qty: 1, sectionId: null });
            expect(
                lineOf(model, `table.cabinet.drawer.${j}.handle`),
            ).toMatchObject({ code: 'HDL-BAR-160', qty: 1 });
        }
        expect(
            partOf(model, 'table.cabinet.side.left').operations.slideScrewSets,
        ).toBe(3);
        expect(
            partOf(model, 'table.cabinet.side.right').operations.slideScrewSets,
        ).toBe(3);
        expect(issuesOf(model, 'furniture.drawer_depth_unused')).toEqual([]);
    });

    it('modesty panel 782 x 362 between the end and the cabinet', () => {
        expect(boxOf(model, 'table.stretcher.back')).toEqual({
            min: [18, 363, 20],
            size: [782, 362, 18],
        });
    });

    it('joints: cabinet sides to bottom and top, end to top, modesty to end and cabinet', () => {
        // 7 joints, all <= 640 long: 2 cams each
        expect(lineOf(model, 'table.connectors.cam')).toMatchObject({
            qty: 14,
            reasonParams: { joints: 7 },
        });
        expect(lineOf(model, 'table.connectors.dowel')?.qty).toBe(14);
        expect(
            partOf(model, 'table.cabinet.side.left').operations.camLocks,
        ).toBe(4);
        expect(partOf(model, 'table.end.left').operations.camLocks).toBe(2);
    });

    it('no knee_space_narrow at 782; a 700 cabinet leaves 482', () => {
        expect(issuesOf(model, 'furniture.knee_space_narrow')).toEqual([]);
        const narrow = run(
            studyDesk((d) => {
                if (d.table.storage.endCabinets) {
                    d.table.storage.endCabinets.width = 700;
                }
            }),
        );
        expect(issuesOf(narrow, 'furniture.knee_space_narrow')).toMatchObject([
            { severity: 'warning', params: { width: 482 } },
        ]);
        const edge = run(
            studyDesk((d) => {
                if (d.table.storage.endCabinets) {
                    d.table.storage.endCabinets.width = 632; // knee 550
                }
            }),
        );
        expect(issuesOf(edge, 'furniture.knee_space_narrow')).toEqual([]);
    });

    it('generates no table legs and has no errors or warnings', () => {
        expect(lineOf(model, 'table.legs')).toBeUndefined();
        expect(nonInfo(validateFurniture(studyDesk(), catalog))).toEqual([]);
    });

    it('keeps an explicit slide code that fits', () => {
        const explicit = run(
            studyDesk((d) => {
                if (d.table.storage.endCabinets) {
                    d.table.storage.endCabinets.content = cabinetDrawers({
                        slideCode: 'SLD-BB-350',
                    });
                }
            }),
        );
        expect(lineOf(explicit, 'table.cabinet.drawer.1.slides')?.code).toBe(
            'SLD-BB-350',
        );
    });
});

describe('cabinet ends: other contents', () => {
    const withContent = (content: Content, width = 400) =>
        run(
            studyDesk((d) => {
                d.table.storage.endCabinets = { width, content };
            }),
        );

    it('shelves: table.cabinet.shelf.{i}, pins, and one right-hinged door 2 mm under the top', () => {
        const model = withContent({
            type: 'shelves',
            count: 2,
            adjustable: true,
            frontSetback: 20,
        });
        expect(boxOf(model, 'table.cabinet.shelf.1')).toMatchObject({
            min: [819, expect.any(Number), 3],
            size: [362, 18, 559],
        });
        expect(keys(model)).toContain('table.cabinet.shelf.2');
        expect(lineOf(model, 'table.cabinet.shelf_supports')).toMatchObject({
            code: 'SHF-PIN-5',
            qty: 8,
            sectionId: null,
        });
        expect(
            partOf(model, 'table.cabinet.side.left').operations.shelfPinHoles,
        ).toBeGreaterThan(0);
        expect(boxOf(model, 'table.cabinet.door')).toEqual({
            min: [801.5, 1.5, 582],
            size: [397, 721.5, 18],
        });
        expect(partOf(model, 'table.cabinet.door')).toMatchObject({
            nameKey: 'parts.door',
            role: 'front',
            length: 721,
            width: 397,
            operations: { hingeCups: 2, handleHoles: 2 },
        });
        expect(lineOf(model, 'table.cabinet.door.hinges')).toMatchObject({
            code: 'HNG-FO-SC',
            qty: 2,
            frontId: null,
        });
        expect(lineOf(model, 'table.cabinet.door.hinge_plates')).toMatchObject({
            code: 'HNG-PLATE-0',
            qty: 2,
        });
        expect(lineOf(model, 'table.cabinet.door.handle')).toMatchObject({
            code: 'HDL-BAR-160',
            qty: 1,
        });
        expect(model.fronts).toEqual([
            {
                id: 'table.cabinet.door',
                frontId: null,
                kind: 'door',
                rect: { x: 801, y: 1, w: 397, h: 721 },
                hingeSide: 'right',
                partKey: 'table.cabinet.door',
            },
        ]);
    });

    it('sag rule reads table.cabinet.shelf.N with the content adjustable flag (Task 37 key)', () => {
        const wide = (adjustable: boolean) =>
            withContent(
                { type: 'shelves', count: 1, adjustable, frontSetback: 20 },
                1000,
            );
        // shelf 1000 - 36 - 2 = 962 (adjustable): PB18 warn 800, critical 1000
        expect(issuesOf(wide(true), 'furniture.shelf_sag')).toMatchObject([
            {
                params: { partKey: 'table.cabinet.shelf.1', span: 962 },
            },
        ]);
        // fixed: 964 wide, clamped limits 1200 / 1500
        expect(
            wide(false).issues.filter((i) =>
                i.code.startsWith('furniture.shelf_sag'),
            ),
        ).toEqual([]);
    });

    it('fixed shelves are joined to the cabinet sides', () => {
        const model = withContent({
            type: 'shelves',
            count: 1,
            adjustable: false,
            frontSetback: 20,
        });
        expect(lineOf(model, 'table.cabinet.shelf_supports')).toBeUndefined();
        // 7 desk joints + 2 shelf ends
        expect(lineOf(model, 'table.connectors.cam')?.qty).toBe(18);
    });

    it('empty: an open cabinet', () => {
        const model = withContent({ type: 'empty' });
        expect(
            keys(model).filter((k) => k.startsWith('table.cabinet.')),
        ).toEqual([
            'table.cabinet.back',
            'table.cabinet.bottom',
            'table.cabinet.side.left',
            'table.cabinet.side.right',
        ]);
        expect(model.fronts).toEqual([]);
    });

    it('hanging rod: error cabinet_content_unsupported, cabinet kept empty', () => {
        const model = withContent({
            type: 'hanging_rod',
            topClearance: 60,
            rodCode: null,
        });
        expect(
            issuesOf(model, 'furniture.cabinet_content_unsupported'),
        ).toMatchObject([{ severity: 'error' }]);
        expect(keys(model)).toContain('table.cabinet.bottom');
        expect(hardwareKeys(model).some((k) => k.includes('rod'))).toBe(false);
    });

    it('under-top drawer spans the knee space: cx0 - (bx0 + t_c) = 782', () => {
        const model = run(
            studyDesk((d) => {
                d.table.storage.drawers = {
                    count: 1,
                    side: 'front',
                    slideCode: null,
                };
            }),
        );
        expect(boxOf(model, 'table.drawer.1.front')).toMatchObject({
            min: [109, 605, 582],
            size: [600, 120, 18],
        });
        const side = run(
            studyDesk((d) => {
                d.table.storage.drawers = {
                    count: 1,
                    side: 'right',
                    slideCode: null,
                };
            }),
        );
        expect(
            issuesOf(side, 'furniture.table_drawer_side_unsupported'),
        ).toHaveLength(1);
    });
});

describe('table family in generateFurniture', () => {
    const variants: Array<[string, FurnitureDocument]> = [
        ['dining', diningTable()],
        [
            'dining, stretcher, shelf, 3 drawers',
            diningTable((d) => {
                d.table.base.stretcher = true;
                d.table.storage.lowerShelf = true;
                d.table.storage.drawers = {
                    count: 3,
                    side: 'front',
                    slideCode: null,
                };
            }),
        ],
        [
            'trestle',
            diningTable((d) => {
                d.table.base.type = 'trestle';
            }),
        ],
        ['desk', studyDesk()],
        [
            'desk, shelves, drawer, panel ends shelf',
            studyDesk((d) => {
                d.table.storage.endCabinets = {
                    width: 400,
                    content: {
                        type: 'shelves',
                        count: 2,
                        adjustable: false,
                        frontSetback: 20,
                    },
                };
                d.table.storage.drawers = {
                    count: 1,
                    side: 'front',
                    slideCode: null,
                };
            }),
        ],
        [
            'panel ends, shelf, drawers',
            studyDesk((d) => {
                d.table.base.type = 'panel_ends';
                d.table.storage.lowerShelf = true;
                d.table.storage.drawers = {
                    count: 2,
                    side: 'front',
                    slideCode: null,
                };
            }),
        ],
        ['console 1200 x 800 x 400, 2 drawers', consoleTable(1200, 400, 2)],
        [
            // A = 658 - 30 - 18 = 610: a slide of A - 10 would reach the back apron
            'dining 1800 x 758, 1 front drawer',
            diningTable((d) => {
                d.dims.depth = 758;
                d.table.storage.drawers = withCount(1, 'front');
            }),
        ],
        ['console 600 x 350, 3 drawers', consoleTable(600, 350, 3)],
        ['console 1800 x 450, 3 drawers', consoleTable(1800, 450, 3)],
        [
            'dining, 3 front drawers',
            diningTable((d) => {
                d.table.storage.drawers = withCount(3, 'front');
            }),
        ],
        [
            'dining, 2 left drawers, stretcher',
            diningTable((d) => {
                d.table.base.stretcher = true;
                d.table.storage.drawers = withCount(2, 'left');
            }),
        ],
        [
            'dining, 3 right drawers, hardware legs',
            diningTable((d) => {
                d.table.base.legSource = 'hardware';
                d.table.storage.drawers = withCount(3, 'right');
            }),
        ],
        [
            'coffee table round 500, shelf',
            tableDocument(
                { width: 500, height: 420, depth: 500 },
                {
                    ...diningTableSpec(),
                    top: {
                        ...diningTableSpec().top,
                        shape: 'round',
                        overhang: 30,
                    },
                    base: {
                        ...diningTableSpec().base,
                        apron: { enabled: true, height: 70, inset: 10 },
                    },
                    storage: {
                        drawers: null,
                        lowerShelf: true,
                        endCabinets: null,
                    },
                },
                'coffee_table',
            ),
        ],
        [
            'pedestal round 1300',
            diningTable((d) => {
                d.dims.width = 1300;
                d.dims.depth = 1300;
                d.table.top.shape = 'round';
                d.table.base.type = 'pedestal';
            }),
        ],
        [
            'desk 800 x 450, panel ends, 1 drawer',
            studyDesk((d) => {
                d.dims.width = 800;
                d.dims.depth = 450;
                d.table.base.type = 'panel_ends';
                d.table.storage.endCabinets = null;
                d.table.storage.drawers = withCount(1, 'front');
            }),
        ],
        [
            'desk 800, cabinet 600, top drawer',
            studyDesk((d) => {
                d.dims.width = 800;
                if (d.table.storage.endCabinets) {
                    d.table.storage.endCabinets.width = 600;
                }
                d.table.storage.drawers = withCount(1, 'front');
            }),
        ],
        [
            'desk 800 x 450, cabinet 600 shelves, top drawer',
            studyDesk((d) => {
                d.dims.width = 800;
                d.dims.depth = 450;
                d.table.storage.endCabinets = {
                    width: 600,
                    content: {
                        type: 'shelves',
                        count: 2,
                        adjustable: true,
                        frontSetback: 20,
                    },
                };
                d.table.storage.drawers = withCount(1, 'front');
            }),
        ],
        [
            'desk 2400 x 780 x 800, cabinet 300, top drawers',
            studyDesk((d) => {
                d.dims = { width: 2400, height: 780, depth: 800 };
                if (d.table.storage.endCabinets) {
                    d.table.storage.endCabinets.width = 300;
                }
                d.table.storage.drawers = withCount(3, 'front');
            }),
        ],
    ];

    it.each(variants)(
        '%s: no two parts intersect (they may touch)',
        (_name, doc) => {
            expect(partOverlaps(run(doc).parts)).toEqual([]);
        },
    );

    it.each(variants)(
        '%s: every part and hardware key appears once (carry 1)',
        (_name, doc) => {
            const model = run(doc);
            expect(new Set(keys(model)).size).toBe(model.parts.length);
            expect(new Set(hardwareKeys(model)).size).toBe(
                model.hardware.length,
            );
        },
    );

    it.each(variants)(
        '%s: every part has a positive size inside the bbox',
        (_name, doc) => {
            const model = run(doc);
            for (const part of model.parts) {
                expect(part.length).toBeGreaterThanOrEqual(part.width);
                expect(part.width).toBeGreaterThan(0);
                const g = part.geometry;
                if (g.kind !== 'box') continue;
                for (const axis of [0, 1, 2] as const) {
                    expect(g.box.min[axis]).toBeGreaterThanOrEqual(-1);
                    expect(
                        g.box.min[axis] + g.box.size[axis],
                    ).toBeLessThanOrEqual(model.bbox.size[axis] + 1);
                }
            }
        },
    );

    it('applies part overrides to table parts and reports orphans', () => {
        const model = run(
            diningTable((d) => {
                d.overrides.parts['table.top'] = { grain: 'width' };
                d.overrides.parts['table.leg.zz'] = { removed: true };
            }),
        );
        expect(partOf(model, 'table.top')).toMatchObject({
            grain: 'width',
            overridden: true,
        });
        expect(
            issuesOf(model, 'furniture.override_orphaned').map((i) => i.params),
        ).toEqual([{ key: 'table.leg.zz' }]);
    });

    it('a table with a base footprint of zero generates nothing: envelope_too_small, no orphans', () => {
        const model = run(
            diningTable((d) => {
                d.dims.depth = 100; // Db = 0
                d.overrides.parts['table.top'] = { grain: 'width' };
            }),
        );
        expect(issuesOf(model, 'furniture.envelope_too_small')).toHaveLength(1);
        expect(model.parts).toEqual([]);
        expect(issuesOf(model, 'furniture.override_orphaned')).toEqual([]);
    });

    it('a table spec on a dining table that is too low for its top: envelope_too_small', () => {
        const model = run(
            tableDocument(
                { width: 1000, height: 100, depth: 800 },
                {
                    ...diningTableSpec(),
                    top: { ...diningTableSpec().top, thickness: 100 },
                },
            ),
        );
        expect(issuesOf(model, 'furniture.envelope_too_small')).toHaveLength(1);
    });
});
