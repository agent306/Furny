import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { seedCatalog } from '../../../testing/seedCatalog';
import { createGenContext } from '../../context';
import { FurnitureDocumentSchema, type FurnitureDocument } from '../../schema';
import type { GenContext, Part } from '../../types';
import {
    assign,
    boxDocument,
    countertopBox,
    drawerTestBox,
} from '../../testing/docs';
import { countertopPart } from '../countertop';
import { computeEnvelope } from '../envelope';
import { carcassPanels } from '../panels';
import { plinthParts } from '../plinth';

const FIXTURE = new URL(
    '../../../../../../database/fixtures/furniture/wardrobe-3door.json',
    import.meta.url,
);
const wardrobe = (
    patch: (doc: FurnitureDocument) => void = () => {},
): FurnitureDocument => {
    const doc = FurnitureDocumentSchema.parse(
        JSON.parse(readFileSync(FIXTURE, 'utf8')),
    );
    patch(doc);
    return doc;
};

const catalog = seedCatalog();

/** Runs the envelope and the three generators, as the pipeline will. */
function generate(doc: FurnitureDocument): GenContext {
    const ctx = createGenContext(doc, catalog);
    const env = computeEnvelope(ctx);
    if (env) {
        carcassPanels(ctx, env);
        plinthParts(ctx, env);
        countertopPart(ctx, env);
    }
    return ctx;
}

const part = (ctx: GenContext, key: string): Part => {
    const found = ctx.parts.find((p) => p.key === key);
    if (!found) throw new Error(`no part ${key}`);
    return found;
};
const keys = (ctx: GenContext): string[] => ctx.parts.map((p) => p.key).sort();
const box = (p: Part) => (p.geometry.kind === 'box' ? p.geometry.box : null);
const B = 'EB08-WHITE';

describe('carcassPanels', () => {
    const ctx = generate(wardrobe());

    it('left side: 2000 x 582, front and top banded, one visible face', () => {
        const side = part(ctx, 'carcass.side.left');
        expect([side.length, side.width, side.thickness]).toEqual([
            2000, 582, 18,
        ]);
        expect(side.edges).toEqual({ L1: B, L2: null, W1: B, W2: null });
        expect(side.visibleFaces).toBe(1);
        expect(side.nameKey).toBe('parts.side_left');
        expect(side.role).toBe('carcass');
        expect(box(side)).toEqual({ min: [0, 100, 0], size: [18, 2000, 582] });
        const right = part(ctx, 'carcass.side.right');
        expect(box(right)).toEqual({
            min: [1782, 100, 0],
            size: [18, 2000, 582],
        });
        expect(right.edges).toEqual(side.edges);
        expect(right.nameKey).toBe('parts.side_right');
    });

    it('top and bottom: 1764 x 582, front only, hidden', () => {
        for (const key of ['carcass.top', 'carcass.bottom']) {
            const p = part(ctx, key);
            expect([p.length, p.width]).toEqual([1764, 582]);
            expect(p.edges).toEqual({ L1: B, L2: null, W1: null, W2: null });
            expect(p.visibleFaces).toBe(0);
        }
        expect(box(part(ctx, 'carcass.top'))).toEqual({
            min: [18, 2082, 0],
            size: [1764, 18, 582],
        });
        expect(box(part(ctx, 'carcass.bottom'))).toEqual({
            min: [18, 100, 0],
            size: [1764, 18, 582],
        });
    });

    it('records the four joints, each as long as the panel depth', () => {
        expect(ctx.joints).toEqual([
            { member: 'carcass.top', other: 'carcass.side.left', length: 582 },
            { member: 'carcass.top', other: 'carcass.side.right', length: 582 },
            {
                member: 'carcass.bottom',
                other: 'carcass.side.left',
                length: 582,
            },
            {
                member: 'carcass.bottom',
                other: 'carcass.side.right',
                length: 582,
            },
        ]);
    });

    it('registers the edge meaning of each panel', () => {
        expect(ctx.edgeMap.get('carcass.side.left')).toEqual({
            L1: 'front',
            L2: 'back',
            W1: 'top',
            W2: 'bottom',
        });
        expect(ctx.edgeMap.get('carcass.top')).toEqual({
            L1: 'front',
            L2: 'back',
            W1: 'left',
            W2: 'right',
        });
    });

    it('wall mounting also bands the side bottoms', () => {
        const wall = generate(
            boxDocument({
                width: 600,
                height: 720,
                depth: 560,
                carcass: { mounting: 'wall' },
            }),
        );
        expect(part(wall, 'carcass.side.left').edges).toEqual({
            L1: B,
            L2: null,
            W1: B,
            W2: B,
        });
    });

    it('over_sides: the top spans the width and is banded left/right and visible', () => {
        const over = generate(
            boxDocument({
                width: 600,
                height: 720,
                depth: 560,
                carcass: {
                    construction: {
                        top: 'over_sides',
                        bottom: 'between_sides',
                    },
                },
            }),
        );
        const top = part(over, 'carcass.top');
        expect([top.length, top.width]).toEqual([600, 560]);
        expect(top.edges).toEqual({ L1: B, L2: null, W1: B, W2: B });
        expect(top.visibleFaces).toBe(1);
        // the sides stop under the top: 720 - 18 high, top edge not banded
        const side = part(over, 'carcass.side.left');
        expect(side.length).toBe(702);
        expect(side.edges).toEqual({ L1: B, L2: null, W1: null, W2: null });
        expect(part(over, 'carcass.bottom').length).toBe(564);
    });

    it('over_sides bottom: sides sit on the bottom, which spans the width', () => {
        const over = generate(
            boxDocument({
                width: 600,
                height: 720,
                depth: 560,
                carcass: {
                    construction: {
                        top: 'between_sides',
                        bottom: 'over_sides',
                    },
                },
            }),
        );
        const bottom = part(over, 'carcass.bottom');
        expect([bottom.length, bottom.width]).toEqual([600, 560]);
        expect(bottom.edges).toEqual({ L1: B, L2: null, W1: B, W2: B });
        expect(bottom.visibleFaces).toBe(0);
        const side = part(over, 'carcass.side.left');
        expect(box(side)?.min[1]).toBe(18);
        expect(side.length).toBe(702);
    });

    it('a countertop hides the top: no side-top banding and no visible top face', () => {
        const ctx2 = generate(
            boxDocument({
                ...{ width: 600, height: 850, depth: 560 },
                carcass: {
                    construction: {
                        top: 'over_sides',
                        bottom: 'between_sides',
                    },
                    countertop: {
                        enabled: true,
                        overhangFront: 0,
                        overhangLeft: 0,
                        overhangRight: 0,
                    },
                },
            }),
        );
        expect(part(ctx2, 'carcass.top').visibleFaces).toBe(0);
        const between = generate(countertopBox());
        expect(part(between, 'carcass.side.left').edges).toEqual({
            L1: 'EB08-WHITE',
            L2: null,
            W1: null,
            W2: null,
        });
    });

    it('a nailed back moves the panels rear z to the back thickness', () => {
        const nailed = generate(
            boxDocument({
                width: 600,
                height: 720,
                depth: 560,
                carcass: { back: { type: 'nailed' } },
            }),
        );
        const side = part(nailed, 'carcass.side.left');
        expect(side.width).toBe(557);
        expect(box(side)?.min[2]).toBe(3);
        expect(nailed.joints.every((j) => j.length === 557)).toBe(true);
    });

    it('an envelope that is too small yields the error only', () => {
        const small = generate(
            boxDocument({ width: 100, height: 720, depth: 560 }),
        );
        expect(small.parts).toEqual([]);
        expect(small.joints).toEqual([]);
        expect(small.issues.map((i) => i.code)).toEqual([
            'furniture.envelope_too_small',
        ]);
    });

    it('drawer test box: 542 deep panels', () => {
        const drawer = generate(drawerTestBox());
        expect(part(drawer, 'carcass.side.left').width).toBe(542);
        expect(part(drawer, 'carcass.top').length).toBe(564);
        expect(keys(drawer)).toEqual([
            'carcass.bottom',
            'carcass.side.left',
            'carcass.side.right',
            'carcass.top',
        ]);
    });
});

describe('plinthParts', () => {
    const ctx = generate(wardrobe());

    it('front 1800 x 100: setback bands the ends; back is bare', () => {
        const f = part(ctx, 'plinth.front');
        expect([f.length, f.width, f.thickness]).toEqual([1800, 100, 18]);
        expect(f.edges).toEqual({ L1: null, L2: null, W1: B, W2: B });
        expect(f.visibleFaces).toBe(1);
        expect(f.role).toBe('plinth');
        expect(box(f)).toEqual({ min: [0, 0, 544], size: [1800, 100, 18] });
        const b = part(ctx, 'plinth.back');
        expect([b.length, b.width]).toEqual([1800, 100]);
        expect(b.edges).toEqual({ L1: null, L2: null, W1: null, W2: null });
        expect(b.visibleFaces).toBe(0);
        expect(box(b)).toEqual({ min: [0, 0, 0], size: [1800, 100, 18] });
    });

    it('three 526 x 100 returns at x = 0, 891, 1782', () => {
        const returns = ctx.parts.filter((p) =>
            p.key.startsWith('plinth.return.'),
        );
        expect(returns.map((r) => r.key)).toEqual([
            'plinth.return.1',
            'plinth.return.2',
            'plinth.return.3',
        ]);
        for (const r of returns) {
            expect([r.length, r.width]).toEqual([526, 100]);
            expect(r.edges).toEqual({ L1: null, L2: null, W1: null, W2: null });
            expect(r.visibleFaces).toBe(0);
            expect(r.nameKey).toBe('parts.plinth_return');
        }
        expect(returns.map((r) => box(r)?.min[0])).toEqual([0, 891, 1782]);
        expect(box(part(ctx, 'plinth.return.1'))).toEqual({
            min: [0, 0, 18],
            size: [18, 100, 526],
        });
        expect(returns.map((r) => r.nameParams)).toEqual([
            { n: 1 },
            { n: 2 },
            { n: 3 },
        ]);
        expect(ctx.issues).toEqual([]);
    });

    it('zero setback leaves the front kickboard unbanded', () => {
        const flush = generate(
            wardrobe((d) => {
                if (d.carcass) d.carcass.plinth.setback = 0;
            }),
        );
        expect(part(flush, 'plinth.front').edges).toEqual({
            L1: null,
            L2: null,
            W1: null,
            W2: null,
        });
        expect(part(flush, 'plinth.return.1').length).toBe(546);
    });

    it.each([
        [1000, 2],
        [1001, 3],
        [2000, 3],
        [2001, 4],
    ])('Wc %i gives %i returns', (width, count) => {
        const c = generate(
            wardrobe((d) => {
                d.dims.width = width;
            }),
        );
        expect(
            c.parts.filter((p) => p.key.startsWith('plinth.return.')),
        ).toHaveLength(count);
    });

    it('a plinth too shallow for returns warns and omits them', () => {
        // Dc 582 - setback 500 - 36 = 46 < 50
        const shallow = generate(
            wardrobe((d) => {
                if (d.carcass) d.carcass.plinth.setback = 500;
            }),
        );
        expect(keys(shallow).filter((k) => k.startsWith('plinth.'))).toEqual([
            'plinth.back',
            'plinth.front',
        ]);
        expect(shallow.issues).toEqual([
            {
                code: 'furniture.plinth_too_shallow',
                severity: 'warning',
                messageKey: 'engine.furniture.issue.plinth_too_shallow',
                params: {},
                entityIds: [],
            },
        ]);
    });

    it('exactly 50 mm of return depth still gets returns', () => {
        const edge = generate(
            wardrobe((d) => {
                if (d.carcass) d.carcass.plinth.setback = 496;
            }),
        );
        expect(part(edge, 'plinth.return.1').width).toBe(50);
        expect(edge.issues).toEqual([]);
    });

    it('legs: only a set-back kickboard front, no back and no returns', () => {
        const legs = generate(countertopBox());
        expect(keys(legs).filter((k) => k.startsWith('plinth.'))).toEqual([
            'plinth.front',
        ]);
        const f = part(legs, 'plinth.front');
        expect([f.length, f.width]).toEqual([600, 100]);
        expect(f.edges).toEqual({
            L1: null,
            L2: null,
            W1: 'EB08-WHITE',
            W2: 'EB08-WHITE',
        });
        // Dc 540 - setback 50 - 18
        expect(box(f)?.min).toEqual([0, 0, 472]);
        const noSetback = generate(
            boxDocument({
                width: 600,
                height: 720,
                depth: 560,
                carcass: {
                    plinth: {
                        type: 'legs',
                        height: 100,
                        setback: 0,
                        legCode: null,
                    },
                },
            }),
        );
        expect(keys(noSetback).filter((k) => k.startsWith('plinth.'))).toEqual(
            [],
        );
    });

    it('wall mounting: no plinth parts, plinth_ignored info', () => {
        const wall = generate(
            wardrobe((d) => {
                if (d.carcass) d.carcass.mounting = 'wall';
            }),
        );
        expect(keys(wall).filter((k) => k.startsWith('plinth.'))).toEqual([]);
        expect(wall.issues.map((i) => [i.code, i.severity])).toEqual([
            ['furniture.plinth_ignored', 'info'],
        ]);
    });

    it('no plinth: nothing', () => {
        expect(
            keys(generate(drawerTestBox())).filter((k) =>
                k.startsWith('plinth.'),
            ),
        ).toEqual([]);
    });
});

describe('countertopPart', () => {
    it('600 x 560 board banded front, left and right, one visible face', () => {
        const ctx = generate(countertopBox());
        const ct = part(ctx, 'countertop');
        expect([ct.length, ct.width, ct.thickness]).toEqual([600, 560, 25]);
        expect(ct.role).toBe('top');
        expect(ct.materialCode).toBe('PB25-WHITE');
        // L1 front, W1 left, W2 right
        expect(ct.edges).toEqual({
            L1: 'EB10-WHITE-28',
            L2: null,
            W1: 'EB10-WHITE-28',
            W2: 'EB10-WHITE-28',
        });
        expect(ct.visibleFaces).toBe(1);
        expect(ct.nameKey).toBe('parts.countertop');
        expect(box(ct)).toEqual({ min: [0, 825, 0], size: [600, 25, 560] });
        expect(ctx.issues).toEqual([]);
        // the carcass keeps its own top
        expect(part(ctx, 'carcass.top').length).toBe(564);
    });

    it('spans the full width including side overhangs', () => {
        const ctx = generate(
            countertopBox({ overhangLeft: 30, overhangRight: 20 }),
        );
        expect(box(part(ctx, 'countertop'))).toEqual({
            min: [0, 825, 0],
            size: [600, 25, 560],
        });
        expect(part(ctx, 'carcass.side.left')).toBeDefined();
        expect(box(part(ctx, 'carcass.side.left'))?.min[0]).toBe(30);
    });

    it('is absent without a countertop or when it is disabled', () => {
        expect(keys(generate(drawerTestBox()))).not.toContain('countertop');
        const off = countertopBox();
        if (off.carcass?.countertop) off.carcass.countertop.enabled = false;
        const ctx = generate(off);
        expect(keys(ctx)).not.toContain('countertop');
        expect(ctx.issues).toEqual([]);
    });

    it.each([
        ['overhangFront', 301],
        ['overhangLeft', 301],
        ['overhangRight', 301],
    ])('%s %i warns that brackets are needed', (field, value) => {
        const ctx = generate(countertopBox({ [field]: value }));
        expect(ctx.issues).toEqual([
            {
                code: 'furniture.countertop_overhang_large',
                severity: 'warning',
                messageKey: 'engine.furniture.issue.countertop_overhang_large',
                params: {},
                entityIds: [],
            },
        ]);
    });

    it('an overhang of exactly 300 does not warn', () => {
        expect(generate(countertopBox({ overhangFront: 300 })).issues).toEqual(
            [],
        );
    });
});

// Gaps found in the review of the first version of these generators.
describe('grain, offsets, role thicknesses and guards', () => {
    const oak = assign('PB18-OAK');

    it('grain follows the board: oak sides, top, bottom and plinth parts run lengthwise', () => {
        const ctx = generate(
            wardrobe((d) => {
                d.materials.carcass = oak;
                d.materials.plinth = oak;
            }),
        );
        for (const key of [
            'carcass.side.left',
            'carcass.side.right',
            'carcass.top',
            'carcass.bottom',
            'plinth.front',
            'plinth.back',
            'plinth.return.1',
            'plinth.return.3',
        ]) {
            expect([key, part(ctx, key).grain]).toEqual([key, 'length']);
        }
        // the same parts in a board without grain have none
        expect(part(generate(wardrobe()), 'carcass.side.left').grain).toBe(
            'none',
        );
    });

    it('grain follows the board: an oak countertop grain runs along x', () => {
        const doc = countertopBox();
        doc.materials.top = oak;
        expect(part(generate(doc), 'countertop').grain).toBe('length');
        // deeper than wide: the grain (along x) is then the width
        const deep = boxDocument({
            width: 500,
            height: 850,
            depth: 600,
            carcass: {
                countertop: {
                    enabled: true,
                    overhangFront: 0,
                    overhangLeft: 0,
                    overhangRight: 0,
                },
            },
            materials: { top: oak },
        });
        expect(part(generate(deep), 'countertop').grain).toBe('width');
    });

    it('a left overhang shifts the plinth: front, back and returns start at x0', () => {
        const ctx = generate(
            boxDocument({
                width: 1100,
                height: 850,
                depth: 560,
                carcass: {
                    plinth: {
                        type: 'plinth',
                        height: 100,
                        setback: 20,
                        legCode: null,
                    },
                    countertop: {
                        enabled: true,
                        overhangFront: 0,
                        overhangLeft: 30,
                        overhangRight: 20,
                    },
                },
                materials: { top: assign('PB25-WHITE') },
            }),
        );
        // Wc = 1100 - 30 - 20 = 1050
        expect(box(part(ctx, 'plinth.front'))).toEqual({
            min: [30, 0, 522],
            size: [1050, 100, 18],
        });
        expect(box(part(ctx, 'plinth.back'))?.min[0]).toBe(30);
        const returns = ctx.parts.filter((p) =>
            p.key.startsWith('plinth.return.'),
        );
        expect(returns.map((r) => box(r)?.min[0])).toEqual([30, 546, 1062]);
    });

    it('role thicknesses: a 25 mm front and a 12 mm plinth on an 18 mm carcass', () => {
        const ctx = generate(
            boxDocument({
                width: 600,
                height: 720,
                depth: 560,
                carcass: {
                    plinth: {
                        type: 'plinth',
                        height: 100,
                        setback: 20,
                        legCode: null,
                    },
                },
                fronts: [
                    {
                        id: 'fr_0000000001',
                        kind: 'hinged',
                        covers: ['s_0000000001'],
                        leaves: 1,
                        hingeSide: 'left',
                        overlay: 'full',
                        glass: false,
                        handleCode: 'inherit',
                        hingeCode: 'auto',
                        slidingTrackCode: null,
                    },
                ],
                materials: {
                    front: assign('PB25-WHITE'),
                    plinth: assign('PLY12-BWR'),
                },
            }),
        );
        // fz = 25 (front board), Dc = 535
        expect(part(ctx, 'carcass.side.left').width).toBe(535);
        const f = part(ctx, 'plinth.front');
        expect(f.thickness).toBe(12);
        expect(box(f)).toEqual({ min: [0, 0, 503], size: [600, 100, 12] });
        expect(box(part(ctx, 'plinth.back'))?.size[2]).toBe(12);
        // return depth = 535 - 20 - 2 x 12
        const r = part(ctx, 'plinth.return.1');
        expect(box(r)).toEqual({ min: [0, 0, 12], size: [12, 100, 491] });
        expect(r.width).toBe(100);
    });

    it('a wall unit with the bottom over the sides does not band the side bottoms', () => {
        const ctx = generate(
            boxDocument({
                width: 600,
                height: 720,
                depth: 560,
                carcass: {
                    mounting: 'wall',
                    construction: {
                        top: 'between_sides',
                        bottom: 'over_sides',
                    },
                },
            }),
        );
        expect(part(ctx, 'carcass.side.left').edges).toEqual({
            L1: B,
            L2: null,
            W1: B,
            W2: null,
        });
    });

    it('a plinth of height 0 makes no parts and no issue', () => {
        for (const type of ['plinth', 'legs'] as const) {
            const ctx = generate(
                boxDocument({
                    width: 600,
                    height: 720,
                    depth: 560,
                    carcass: {
                        plinth: { type, height: 0, setback: 50, legCode: null },
                    },
                }),
            );
            expect(keys(ctx).filter((k) => k.startsWith('plinth.'))).toEqual(
                [],
            );
            expect(ctx.issues).toEqual([]);
        }
    });
});
