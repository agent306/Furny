/**
 * Long panel split (spec 19 R40-1, modelled on the back split of 07 §3.4.1):
 * a horizontal run that does not fit one sheet is cut into pieces at seams,
 * over a support where there is one, else evenly; each seam is a joint.
 */
import { describe, expect, it } from 'vitest';
import type { Issue } from '../../plan/types';
import { mutateCatalog, seedCatalog } from '../../testing/seedCatalog';
import { testIds } from '../../testing/ids';
import { indexCatalog } from '../catalogIndex';
import { createGenContext } from '../context';
import { generateFurniture } from '../generate';
import {
    MIN_SEAM_PIECE,
    greedySeams,
    splitLongPanels,
    supportsOf,
} from '../panelSplit';
import { makePart } from '../parts';
import type { FurnitureDocument } from '../schema';
import { getTemplate } from '../templates/index';
import {
    assign,
    boxDocument,
    diningTable,
    flex,
    leafSection,
    splitSection,
} from '../testing/docs';
import { partOverlaps } from '../testing/overlaps';
import type { Box3, FurnitureModel, Part } from '../types';
import { validateFurniture } from '../validate';

const catalog = seedCatalog();
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
const keysLike = (model: FurnitureModel, prefix: string) =>
    model.parts.map((p) => p.key).filter((k) => k.startsWith(prefix));
const issuesOf = (issues: Issue[], code: string) =>
    issues.filter((i) => i.code === code);
const xRange = (box: Box3) => [box.min[0], box.min[0] + box.size[0]];
const errorsOf = (doc: FurnitureDocument) =>
    validateFurniture(doc, catalog).filter((i) => i.severity === 'error');

/** Twice the signed area of an [x, z] ring. */
const area2 = (ring: Array<[number, number]>): number =>
    ring.reduce((sum, [x0, z0], i) => {
        const [x1, z1] = ring[(i + 1) % ring.length] ?? [0, 0];
        return sum + (x0 * z1 - x1 * z0);
    }, 0);

describe('greedySeams (07 §3.4.1 step 3, shared with the back split)', () => {
    it('takes the largest support within reach, else splits the rest evenly', () => {
        expect(greedySeams(18, 3582, 2420, [1203, 2397])).toStrictEqual([
            { at: 2397, supported: true },
        ]);
        expect(greedySeams(18, 4982, 2420, [])).toStrictEqual([
            { at: 1673, supported: false },
            { at: 3328, supported: false },
        ]);
        expect(greedySeams(0, 2000, 2420, [])).toStrictEqual([]);
    });
});

describe('carcass top and bottom', () => {
    const wide = (over: Partial<Parameters<typeof boxDocument>[0]> = {}) =>
        boxDocument({ width: 5000, height: 720, depth: 560, ...over });
    const narrowTop = boxOf(
        run(boxDocument({ width: 600, height: 720, depth: 560 })),
        'carcass.top',
    );

    it('5000 wide, no partition: three even pieces with unsupported seams', () => {
        const model = run(wide());
        expect(keysLike(model, 'carcass.top')).toStrictEqual([
            'carcass.top.1',
            'carcass.top.2',
            'carcass.top.3',
        ]);
        expect(
            ['carcass.top.1', 'carcass.top.2', 'carcass.top.3'].map((k) =>
                xRange(boxOf(model, k)),
            ),
        ).toStrictEqual([
            [18, 1673],
            [1673, 3328],
            [3328, 4982],
        ]);
        // same height and depth as an unsplit top
        const piece = boxOf(model, 'carcass.top.2');
        expect([
            piece.min[1],
            piece.min[2],
            piece.size[1],
            piece.size[2],
        ]).toStrictEqual([
            narrowTop.min[1],
            narrowTop.min[2],
            narrowTop.size[1],
            narrowTop.size[2],
        ]);
        expect(partOf(model, 'carcass.top.2')).toMatchObject({
            nameKey: 'parts.top',
            nameParams: { piece: 2 },
            length: 1655,
            width: narrowTop.size[2],
        });
        expect(issuesOf(model.issues, 'furniture.panel_split')).toStrictEqual([
            {
                code: 'furniture.panel_split',
                severity: 'info',
                messageKey: 'engine.furniture.issue.panel_split',
                params: { partKey: 'carcass.top', count: 3 },
                entityIds: ['carcass.top.1', 'carcass.top.2', 'carcass.top.3'],
            },
            {
                code: 'furniture.panel_split',
                severity: 'info',
                messageKey: 'engine.furniture.issue.panel_split',
                params: { partKey: 'carcass.bottom', count: 3 },
                entityIds: [
                    'carcass.bottom.1',
                    'carcass.bottom.2',
                    'carcass.bottom.3',
                ],
            },
        ]);
        expect(
            issuesOf(model.issues, 'furniture.panel_seam_unsupported')
                .filter((i) => i.params['partKey'] === 'carcass.top')
                .map((i) => [i.severity, i.params['position'], i.entityIds]),
        ).toStrictEqual([
            ['warning', 1673, ['carcass.top.1', 'carcass.top.2']],
            ['warning', 3328, ['carcass.top.2', 'carcass.top.3']],
        ]);
        expect(errorsOf(wide())).toStrictEqual([]);
        expect(
            partOverlaps(model.parts, {
                ignore: (a, b) => /back/.test(a.key + b.key),
            }),
        ).toStrictEqual([]);
    });

    it('each seam is a joint with connectors; side joints move to the end pieces', () => {
        const model = run(wide());
        const top1 = partOf(model, 'carcass.top.1');
        const top2 = partOf(model, 'carcass.top.2');
        const top3 = partOf(model, 'carcass.top.3');
        // top.1: side.left joint + seam to top.2, 560 - zp deep: 2 cams each
        expect(top1.operations.camLocks).toBe(4);
        expect(top2.operations.camLocks).toBe(2);
        expect(top3.operations.camLocks).toBe(2);
        const narrow = run(
            boxDocument({ width: 600, height: 720, depth: 560 }),
        );
        const cams = (m: FurnitureModel) =>
            m.hardware.find((h) => h.key === 'carcass.connectors.cam')?.qty;
        // 4 more joints (2 seams in the top, 2 in the bottom) of 2 cams
        expect(cams(model)).toBe((cams(narrow) ?? 0) + 8);
    });

    it('over_sides: the outer pieces keep their end band, the seam edges are not banded', () => {
        const model = run(
            wide({
                carcass: {
                    construction: { top: 'over_sides', bottom: 'over_sides' },
                },
            }),
        );
        const banded = (key: string) =>
            Object.values(partOf(model, key).edges).filter((c) => c !== null)
                .length;
        // piece 1: front + left, piece 2: front, piece 3: front + right
        expect(
            ['carcass.top.1', 'carcass.top.2', 'carcass.top.3'].map(banded),
        ).toStrictEqual([2, 1, 2]);
        expect(xRange(boxOf(model, 'carcass.top.1'))[0]).toBe(0);
        expect(xRange(boxOf(model, 'carcass.top.3'))[1]).toBe(5000);
    });

    it('seams go over partitions: a 3600 three-column box has one supported seam', () => {
        const doc = boxDocument({
            width: 3600,
            height: 720,
            depth: 560,
            interior: splitSection('s_0000000001', 'columns', [
                [flex(), leafSection('s_0000000002')],
                [flex(), leafSection('s_0000000003')],
                [flex(), leafSection('s_0000000004')],
            ]),
        });
        const model = run(doc);
        expect(
            ['carcass.top.1', 'carcass.top.2'].map((k) =>
                xRange(boxOf(model, k)),
            ),
        ).toStrictEqual([
            [18, 2397],
            [2397, 3582],
        ]);
        expect(keysLike(model, 'carcass.top')).toHaveLength(2);
        expect(
            issuesOf(model.issues, 'furniture.panel_seam_unsupported'),
        ).toStrictEqual([]);
        expect(errorsOf(doc)).toStrictEqual([]);
    });

    it('a panel that still exceeds the sheet across its depth stays whole and is an error', () => {
        const small = mutateCatalog(catalog, (draft) => {
            for (const m of draft.materials) {
                // usable 480 x 480: no piece of a ~550 deep top fits
                if (m.code === 'PB18-WHITE') {
                    m.sheetLengthMm = 500;
                    m.sheetWidthMm = 500;
                }
            }
        });
        const model = run(wide(), small);
        expect(keysLike(model, 'carcass.top')).toStrictEqual(['carcass.top']);
        expect(
            issuesOf(model.issues, 'furniture.part_exceeds_sheet').map(
                (i) => i.params['partKey'],
            ),
        ).toContain('carcass.top');
        expect(issuesOf(model.issues, 'furniture.panel_split')).toStrictEqual(
            [],
        );
    });

    it('narrow carcasses are not split', () => {
        const model = run(
            boxDocument({ width: 2400, height: 720, depth: 560 }),
        );
        expect(keysLike(model, 'carcass.top')).toStrictEqual(['carcass.top']);
        expect(issuesOf(model.issues, 'furniture.panel_split')).toStrictEqual(
            [],
        );
    });
});

describe('plinth front and back', () => {
    it('3000 wide: seams over the plinth returns (supported); the top is split evenly', () => {
        const doc = boxDocument({
            width: 3000,
            height: 820,
            depth: 560,
            carcass: {
                plinth: {
                    type: 'plinth',
                    height: 100,
                    setback: 20,
                    legCode: null,
                },
            },
        });
        const model = run(doc);
        // returns at x 0, 994, 1988, 2982 (centres 9, 1003, 1997, 2991)
        for (const key of ['plinth.front', 'plinth.back']) {
            expect(
                [`${key}.1`, `${key}.2`].map((k) => xRange(boxOf(model, k))),
            ).toStrictEqual([
                [0, 1997],
                [1997, 3000],
            ]);
        }
        // the bottom rests on the returns too; the top has no support
        expect(
            ['carcass.bottom.1', 'carcass.bottom.2'].map((k) =>
                xRange(boxOf(model, k)),
            ),
        ).toStrictEqual([
            [18, 1997],
            [1997, 2982],
        ]);
        expect(
            issuesOf(model.issues, 'furniture.panel_seam_unsupported').map(
                (i) => [i.params['partKey'], i.params['position']],
            ),
        ).toStrictEqual([['carcass.top', 1500]]);
        expect(errorsOf(doc)).toStrictEqual([]);
    });
});

describe('table top and aprons', () => {
    it('3000 dining table: top in two even pieces, aprons split too, no error', () => {
        const doc = diningTable((d) => {
            d.dims.width = 3000;
        });
        const model = run(doc);
        expect(
            ['table.top.1', 'table.top.2'].map((k) => xRange(boxOf(model, k))),
        ).toStrictEqual([
            [0, 1500],
            [1500, 3000],
        ]);
        // banded front, back and the outer end only
        expect(
            ['table.top.1', 'table.top.2'].map(
                (k) =>
                    Object.values(partOf(model, k).edges).filter(
                        (c) => c !== null,
                    ).length,
            ),
        ).toStrictEqual([3, 3]);
        // front/back aprons x [100, 2900] = 2800 > 2420
        expect(
            ['table.apron.front.1', 'table.apron.front.2'].map((k) =>
                xRange(boxOf(model, k)),
            ),
        ).toStrictEqual([
            [100, 1500],
            [1500, 2900],
        ]);
        expect(errorsOf(doc)).toStrictEqual([]);
        expect(partOverlaps(model.parts)).toStrictEqual([]);
        // the seams are joints: table connectors include their cams
        expect(
            model.hardware.find((h) => h.key === 'table.connectors.cam')?.qty,
        ).toBeGreaterThan(0);
    });

    it('an oval top is cut along its outline over the right apron: the pieces tile the ellipse', () => {
        const doc = diningTable((d) => {
            d.dims.width = 3000;
            d.dims.depth = 1200;
            d.table.top.shape = 'oval';
        });
        const whole = run(
            diningTable((d) => {
                d.dims.width = 3000;
                d.dims.depth = 1200;
                d.table.top.shape = 'oval';
            }),
            mutateCatalog(catalog, (draft) => {
                for (const m of draft.materials) {
                    if (m.code === 'PB25-WHITE') m.sheetLengthMm = 4000;
                }
            }),
        );
        const wholeTop = partOf(whole, 'table.top').geometry;
        if (wholeTop.kind !== 'extruded') throw new Error('not extruded');
        const model = run(doc);
        const pieces = keysLike(model, 'table.top').map((k) =>
            partOf(model, k),
        );
        expect(pieces.map((p) => p.key)).toStrictEqual([
            'table.top.1',
            'table.top.2',
        ]);
        let total = 0;
        pieces.forEach((piece, i) => {
            const g = piece.geometry;
            if (g.kind !== 'extruded') throw new Error('not extruded');
            const xs = g.outline.map(([x]) => x);
            // inscribed base 2050 wide from x 475: right apron centre 2501
            expect([Math.min(...xs), Math.max(...xs)]).toStrictEqual(
                i === 0 ? [0, 2501] : [2501, 3000],
            );
            total += area2(g.outline);
        });
        expect(pieces.map((p) => p.length)).toStrictEqual([2501, 891]); // the 64-gon's chord at x 2501
        expect(pieces.map((p) => p.width)).toStrictEqual([1200, 499]);
        expect(total).toBeCloseTo(area2(wholeTop.outline), 6);
        expect(
            issuesOf(model.issues, 'furniture.panel_seam_unsupported').filter(
                (i) => i.params['partKey'] === 'table.top',
            ),
        ).toStrictEqual([]);
        expect(errorsOf(doc)).toStrictEqual([]);
    });
});

// --- Fix round 1 ------------------------------------------------------------------

/** x-sizes of the pieces of every panel split in `model`. */
const pieceLengths = (model: FurnitureModel): Record<string, number[]> =>
    Object.fromEntries(
        issuesOf(model.issues, 'furniture.panel_split').map((issue) => [
            issue.params['partKey'],
            issue.entityIds.map((key) => {
                const g = partOf(model, key).geometry;
                if (g.kind === 'box') return g.box.size[0];
                const xs = g.outline.map(([x]) => x);
                return Math.max(...xs) - Math.min(...xs);
            }),
        ]),
    );
const shortest = (model: FurnitureModel): number =>
    Math.min(...Object.values(pieceLengths(model)).flat());

const dining = (over: Record<string, unknown>) => {
    const t = getTemplate('dining_table');
    return t.generate(
        { ...t.defaults, ...over },
        { catalog: indexCatalog(catalog), newId: testIds() },
    );
};

describe('every piece is at least MIN_SEAM_PIECE (300) long (fix round 1)', () => {
    it('greedySeams skips a support that would leave a short tail, then splits evenly', () => {
        expect(MIN_SEAM_PIECE).toBe(300);
        // supports at the panel ends (side aprons at 74 / 2726)
        expect(greedySeams(0, 2800, 2780, [74, 2726], 300, 300)).toStrictEqual([
            { at: 1400, supported: false },
        ]);
        // the next-best support that leaves 300 on both sides is taken
        expect(
            greedySeams(0, 2800, 2780, [74, 2400, 2726], 300, 300),
        ).toStrictEqual([{ at: 2400, supported: true }]);
        // the back split keeps 07 §3.4.1 (no tail guard)
        expect(greedySeams(0, 2800, 2780, [74, 2726])).toStrictEqual([
            { at: 2726, supported: true },
        ]);
    });

    it('dining four_legs 2790-2850 (rectangle, rounded): no sliver of the top', () => {
        for (let width = 2790; width <= 2850; width += 10) {
            for (const shape of ['rectangle', 'rounded_rectangle']) {
                const model = run(dining({ width, shape }));
                expect(pieceLengths(model)['table.top']).toHaveLength(2);
                expect([width, shape, shortest(model)]).toStrictEqual([
                    width,
                    shape,
                    expect.any(Number),
                ]);
                expect(shortest(model)).toBeGreaterThanOrEqual(MIN_SEAM_PIECE);
            }
        }
        expect(
            pieceLengths(run(dining({ width: 2800 })))['table.top'],
        ).toStrictEqual([1400, 1400]);
    });

    it('trestle 2790-3000: two even top pieces, no 100 mm ends', () => {
        for (let width = 2790; width <= 3000; width += 10) {
            const model = run(dining({ width, base: 'trestle' }));
            expect([width, shortest(model) >= MIN_SEAM_PIECE]).toStrictEqual([
                width,
                true,
            ]);
            expect([
                width,
                pieceLengths(model)['table.top']?.length,
            ]).toStrictEqual([width, 2]);
        }
        expect(
            pieceLengths(run(dining({ width: 2950, base: 'trestle' })))[
                'table.top'
            ],
        ).toStrictEqual([1475, 1475]);
    });

    it('plinth boards 2421-2429 wide: the seam skips the end return', () => {
        for (let width = 2421; width <= 2429; width++) {
            const model = run(
                boxDocument({
                    width,
                    height: 820,
                    depth: 560,
                    carcass: {
                        plinth: {
                            type: 'plinth',
                            height: 100,
                            setback: 20,
                            legCode: null,
                        },
                    },
                }),
            );
            const lengths = pieceLengths(model);
            expect(lengths['plinth.front']).toHaveLength(2);
            expect([width, shortest(model) >= MIN_SEAM_PIECE]).toStrictEqual([
                width,
                true,
            ]);
        }
    });
});

describe('panel overrides apply before the split (fix round 1)', () => {
    const box = (width: number) =>
        boxDocument({ width, height: 720, depth: 560 });
    const withTop = (width: number, override: object) => {
        const doc = box(width);
        doc.overrides.parts['carcass.top'] = override;
        return doc;
    };

    it('a material override decides the split by its own sheet', () => {
        // 2564 mm: over PB18 (2420) but within PB25 (2780): not split
        const fits = run(withTop(2600, { materialCode: 'PB25-WHITE' }));
        expect(keysLike(fits, 'carcass.top')).toStrictEqual(['carcass.top']);
        expect(partOf(fits, 'carcass.top')).toMatchObject({
            materialCode: 'PB25-WHITE',
            thickness: 25,
            overridden: true,
        });
        expect(
            issuesOf(fits.issues, 'furniture.override_orphaned'),
        ).toStrictEqual([]);
        // 2964 mm exceeds PB25 too: pieces in PB25, marked overridden
        const split = run(withTop(3000, { materialCode: 'PB25-WHITE' }));
        expect(keysLike(split, 'carcass.top')).toStrictEqual([
            'carcass.top.1',
            'carcass.top.2',
        ]);
        for (const key of ['carcass.top.1', 'carcass.top.2']) {
            expect(partOf(split, key)).toMatchObject({
                materialCode: 'PB25-WHITE',
                thickness: 25,
                overridden: true,
            });
        }
        expect(
            issuesOf(split.issues, 'furniture.override_orphaned'),
        ).toStrictEqual([]);
        // the bottom, not overridden, splits in PB18 as before
        expect(partOf(split, 'carcass.bottom.1').overridden).toBe(false);
    });

    it('a removed panel is never split', () => {
        const model = run(withTop(3000, { removed: true }));
        expect(keysLike(model, 'carcass.top')).toStrictEqual([]);
        expect(
            issuesOf(model.issues, 'furniture.panel_split').map(
                (i) => i.params['partKey'],
            ),
        ).toStrictEqual(['carcass.bottom']);
        expect(
            issuesOf(model.issues, 'furniture.override_orphaned'),
        ).toStrictEqual([]);
    });

    it('a lengthDelta that takes the top over the sheet splits it', () => {
        expect(keysLike(run(box(2400)), 'carcass.top')).toStrictEqual([
            'carcass.top',
        ]);
        const model = run(withTop(2400, { lengthDelta: 100 }));
        expect(keysLike(model, 'carcass.top')).toStrictEqual([
            'carcass.top.1',
            'carcass.top.2',
        ]);
        // 2364 + 100 = 2464 from x 18, split evenly
        expect(
            ['carcass.top.1', 'carcass.top.2'].map((k) =>
                xRange(boxOf(model, k)),
            ),
        ).toStrictEqual([
            [18, 1250],
            [1250, 2482],
        ]);
    });

    it('an edge override keeps its codes on the pieces but the seam edges', () => {
        const doc = withTop(3000, {
            edges: { L1: 'EB08-WHITE', L2: 'EB08-WHITE' },
        });
        const model = run(doc);
        for (const key of ['carcass.top.1', 'carcass.top.2']) {
            const edges = partOf(model, key).edges;
            expect([edges.L1, edges.L2]).toStrictEqual([
                'EB08-WHITE',
                'EB08-WHITE',
            ]);
        }
    });

    it('overrides on piece keys are not supported: orphaned', () => {
        const doc = box(3000);
        doc.overrides.parts['carcass.top.1'] = { materialCode: 'PB25-WHITE' };
        const model = run(doc);
        expect(partOf(model, 'carcass.top.1').materialCode).toBe('PB18-WHITE');
        expect(
            issuesOf(model.issues, 'furniture.override_orphaned').map(
                (i) => i.params['key'],
            ),
        ).toStrictEqual(['carcass.top.1']);
    });
});

describe('panelSplit branches (fix round 1)', () => {
    it('glass is never split (and never part_exceeds_sheet)', () => {
        const doc = boxDocument({ width: 3000, height: 720, depth: 560 });
        doc.overrides.parts['carcass.top'] = { materialCode: 'GLASS5-CLEAR' };
        const model = run(doc);
        expect(keysLike(model, 'carcass.top')).toStrictEqual(['carcass.top']);
        expect(errorsOf(doc)).toStrictEqual([]);
    });

    it('supports: touching, at least half the depth, running along the depth', () => {
        const doc = boxDocument({ width: 3000, height: 720, depth: 560 });
        const ctx = createGenContext(doc, catalog);
        const panelAt = (
            key: string,
            min: [number, number, number],
            size: [number, number, number],
            thin: 'x' | 'y',
        ) => {
            const part = makePart(
                {
                    key,
                    nameKey: 'parts.partition',
                    role: 'carcass',
                    materialCode: 'PB18-WHITE',
                    box: { min, size },
                    thicknessAxis: thin,
                    grainAxis: null,
                    banded: [],
                    visibleFaces: 0,
                },
                ctx,
            );
            ctx.parts.push(part);
            return part;
        };
        const top = panelAt('carcass.top', [0, 700, 0], [3000, 18, 560], 'y');
        panelAt('a', [1000, 0, 0], [18, 700, 560], 'x'); // full depth
        panelAt('b', [1500, 0, 0], [18, 700, 250], 'x'); // 250 < 280 (45%)
        panelAt('c', [1700, 0, 0], [600, 700, 300], 'x'); // wider than deep
        panelAt('d', [2200, 0, 0], [18, 700, 280], 'x'); // exactly half
        panelAt('e', [2500, 0, 0], [18, 690, 560], 'x'); // 10 mm short
        expect(
            supportsOf(
                ctx,
                top,
                { min: [0, 700, 0], size: [3000, 18, 560] },
                'y',
                'z',
            ),
        ).toStrictEqual([1009, 2209]);
    });

    it('operations stay on piece 1', () => {
        const doc = boxDocument({ width: 5000, height: 720, depth: 560 });
        const ctx = createGenContext(doc, catalog);
        ctx.parts.push(
            makePart(
                {
                    key: 'carcass.top',
                    nameKey: 'parts.top',
                    role: 'carcass',
                    materialCode: 'PB18-WHITE',
                    box: { min: [0, 700, 0], size: [5000, 18, 560] },
                    thicknessAxis: 'y',
                    grainAxis: 'x',
                    banded: [],
                    visibleFaces: 0,
                    operations: { shelfPinHoles: 4 },
                },
                ctx,
            ),
        );
        splitLongPanels(ctx);
        expect(
            ctx.parts.map((p) => [p.key, p.operations.shelfPinHoles]),
        ).toStrictEqual([
            ['carcass.top.1', 4],
            ['carcass.top.2', 0],
            ['carcass.top.3', 0],
        ]);
    });

    it('a grained board keeps its grain along the pieces', () => {
        const model = run(
            boxDocument({
                width: 5000,
                height: 720,
                depth: 560,
                materials: { carcass: assign('PB18-OAK') },
            }),
        );
        expect(
            keysLike(model, 'carcass.top').map((k) => partOf(model, k).grain),
        ).toStrictEqual(['length', 'length', 'length']);
    });

    it('fixed shelves, the countertop, the table lower shelf and top layers split too', () => {
        const rows = run(
            boxDocument({
                width: 5000,
                height: 720,
                depth: 560,
                interior: splitSection('s_0000000001', 'rows', [
                    [flex(), leafSection('s_0000000002')],
                    [flex(), leafSection('s_0000000003')],
                ]),
            }),
        );
        expect(
            keysLike(rows, 'section.s_0000000001.fixed_shelf.1'),
        ).toStrictEqual([
            'section.s_0000000001.fixed_shelf.1.1',
            'section.s_0000000001.fixed_shelf.1.2',
            'section.s_0000000001.fixed_shelf.1.3',
        ]);
        expect(
            partOf(rows, 'section.s_0000000001.fixed_shelf.1.2').nameParams,
        ).toStrictEqual({ n: 1, piece: 2 });

        const counter = run(
            boxDocument({
                width: 3000,
                height: 850,
                depth: 560,
                carcass: {
                    countertop: {
                        enabled: true,
                        overhangFront: 20,
                        overhangLeft: 0,
                        overhangRight: 0,
                    },
                },
                materials: { top: assign('PB25-WHITE') },
            }),
        );
        expect(keysLike(counter, 'countertop')).toStrictEqual([
            'countertop.1',
            'countertop.2',
        ]);

        const table = diningTable((d) => {
            d.dims.width = 3000;
            d.table.storage.lowerShelf = true;
            d.table.top.thickness = 50;
        });
        const model = run(table);
        expect(keysLike(model, 'table.shelf')).toStrictEqual([
            'table.shelf.1',
            'table.shelf.2',
        ]);
        expect(keysLike(model, 'table.top.layer.2')).toStrictEqual([
            'table.top.layer.2.1',
            'table.top.layer.2.2',
        ]);
        expect(errorsOf(table)).toStrictEqual([]);
    });

    it('a seam over a partition joins the partition to both pieces', () => {
        const doc = boxDocument({
            width: 3600,
            height: 720,
            depth: 560,
            interior: splitSection('s_0000000001', 'columns', [
                [flex(), leafSection('s_0000000002')],
                [flex(), leafSection('s_0000000003')],
                [flex(), leafSection('s_0000000004')],
            ]),
        });
        const model = run(doc);
        // the seam sits on partition 2 (centre 2397): it joins top.1, top.2,
        // bottom.1 and bottom.2; partition 1 only top.1 and bottom.1
        const cams = (n: number) =>
            partOf(model, `section.s_0000000001.partition.${n}`).operations
                .camLocks;
        expect(cams(2)).toBe(2 * cams(1));
    });
});
