/**
 * Long panel split (spec 19 R40-1, modelled on the back split of 07 §3.4.1):
 * a horizontal run that does not fit one sheet is cut into pieces at seams,
 * over a support where there is one, else evenly; each seam is a joint.
 */
import { describe, expect, it } from 'vitest';
import type { Issue } from '../../plan/types';
import { mutateCatalog, seedCatalog } from '../../testing/seedCatalog';
import { generateFurniture } from '../generate';
import { greedySeams } from '../panelSplit';
import type { FurnitureDocument } from '../schema';
import {
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
