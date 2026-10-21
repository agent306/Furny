import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mutateCatalog, seedCatalog } from '../../../testing/seedCatalog';
import { createGenContext } from '../../context';
import { FurnitureDocumentSchema, type Front } from '../../schema';
import type { FurnitureDocument, Section } from '../../schema';
import {
    BOX_ROOT_ID,
    assign,
    boxDocument,
    countertopBox,
    drawerTestBox,
} from '../../testing/docs';
import {
    computeEnvelope,
    coveringFront,
    hasExternalDrawers,
    type Envelope,
} from '../envelope';

const FIXTURE = new URL(
    '../../../../../../database/fixtures/furniture/wardrobe-3door.json',
    import.meta.url,
);
const wardrobe = (): FurnitureDocument =>
    FurnitureDocumentSchema.parse(JSON.parse(readFileSync(FIXTURE, 'utf8')));

const catalog = seedCatalog();
const run = (doc: FurnitureDocument) => {
    const ctx = createGenContext(doc, catalog);
    return { ctx, env: computeEnvelope(ctx) };
};
const envOf = (doc: FurnitureDocument): Envelope => {
    const { env } = run(doc);
    if (!env) throw new Error('no envelope');
    return env;
};

const front = (over: Partial<Front> = {}): Front => ({
    id: 'fr_0000000001',
    kind: 'hinged',
    covers: [BOX_ROOT_ID],
    leaves: 1,
    hingeSide: 'left',
    overlay: 'full',
    glass: false,
    handleCode: 'inherit',
    hingeCode: 'auto',
    slidingTrackCode: null,
    ...over,
});

describe('test documents', () => {
    it('are valid against the schema and use materials the seed has', () => {
        for (const doc of [drawerTestBox(), countertopBox(), wardrobe()]) {
            expect(FurnitureDocumentSchema.safeParse(doc).success).toBe(true);
        }
        expect(catalog.materials.some((m) => m.code === 'PB25-WHITE')).toBe(
            true,
        );
    });
});

describe('computeEnvelope', () => {
    it('wardrobe fixture (07 §12.2)', () => {
        const { ctx, env } = run(wardrobe());
        expect(env).toEqual({
            x0: 0,
            y0: 100,
            Wc: 1800,
            Hc: 2000,
            Dc: 582,
            fz: 18,
            plinthH: 100,
            ctT: 0,
            zp: 0,
            zBackFront: 13,
            slidingZone: 0,
            drawerStyle: 'full',
            interior: { min: [18, 118, 13], size: [1764, 1964, 569] },
        });
        // x [18,1782] y [118,2082] z [13,582]
        expect(ctx.issues).toEqual([]);
        expect(ctx.parts).toEqual([]);
    });

    it('drawer test box (07 §12.3): external drawers need a front zone', () => {
        const env = envOf(drawerTestBox());
        expect(env.fz).toBe(18);
        expect(env.Dc).toBe(542);
        expect(env.drawerStyle).toBe('full');
        expect(env.interior).toEqual({
            min: [18, 18, 13],
            size: [564, 684, 529],
        });
    });

    it('countertop box: no fronts, so no front zone; the top takes its own thickness', () => {
        const env = envOf(countertopBox());
        expect(env).toMatchObject({
            x0: 0,
            y0: 100,
            fz: 0,
            ctT: 25,
            plinthH: 100,
            Wc: 600,
            Hc: 725,
            Dc: 540,
        });
    });

    it('left and right overhangs shift x0 and narrow Wc', () => {
        const env = envOf(
            countertopBox({ overhangLeft: 30, overhangRight: 10 }),
        );
        expect(env.x0).toBe(30);
        expect(env.Wc).toBe(560);
    });

    it('back type sets zp and zBackFront', () => {
        const at = (type: 'none' | 'nailed' | 'grooved' | 'inset') =>
            envOf(
                boxDocument({
                    width: 600,
                    height: 720,
                    depth: 560,
                    carcass: { back: { type } },
                }),
            );
        expect([at('none').zp, at('none').zBackFront]).toEqual([0, 0]);
        expect([at('nailed').zp, at('nailed').zBackFront]).toEqual([3, 3]);
        expect([at('grooved').zp, at('grooved').zBackFront]).toEqual([0, 13]);
        expect([at('inset').zp, at('inset').zBackFront]).toEqual([0, 3]);
    });

    it('fz and drawerStyle follow the fronts', () => {
        const box = (fronts: Front[]) =>
            envOf(boxDocument({ width: 600, height: 720, depth: 560, fronts }));
        expect(box([front()]).fz).toBe(18);
        expect(box([front({ overlay: 'half' })]).fz).toBe(18);
        const inset = box([front({ overlay: 'inset' })]);
        expect(inset.fz).toBe(0);
        expect(inset.drawerStyle).toBe('inset');
        // one non-inset front is enough for the full style
        expect(
            box([
                front({ overlay: 'inset' }),
                front({ id: 'fr_0000000002', covers: ['s_0000000009'] }),
            ]).drawerStyle,
        ).toBe('full');
    });

    it('sliding fronts reserve a zone instead of a front zone', () => {
        const env = envOf(
            boxDocument({
                width: 1200,
                height: 720,
                depth: 560,
                fronts: [front({ kind: 'sliding', leaves: 2 })],
            }),
        );
        expect(env.fz).toBe(0);
        expect(env.slidingZone).toBe(60); // 2 x (18 + 12)
        expect(env.Dc).toBe(560);
        expect(env.interior.size[2]).toBe(560 - 60 - 13);
    });

    it('inset style: uncovered external drawers need no front zone', () => {
        const doc = drawerTestBox();
        if (!doc.carcass) throw new Error('no carcass');
        doc.carcass.fronts = [
            front({ overlay: 'inset', covers: ['s_0000000099'] }),
        ];
        expect(envOf(doc).fz).toBe(0);
    });

    it('wall mounting ignores a plinth and says so', () => {
        const doc = boxDocument({
            width: 600,
            height: 720,
            depth: 560,
            carcass: {
                mounting: 'wall',
                plinth: {
                    type: 'plinth',
                    height: 100,
                    setback: 20,
                    legCode: null,
                },
            },
        });
        const { ctx, env } = run(doc);
        expect(env?.plinthH).toBe(0);
        expect(env?.y0).toBe(0);
        expect(env?.Hc).toBe(720);
        expect(ctx.issues).toEqual([
            {
                code: 'furniture.plinth_ignored',
                severity: 'info',
                messageKey: 'engine.furniture.issue.plinth_ignored',
                params: {},
                entityIds: [],
            },
        ]);
    });

    it('a plinth that leaves no carcass height is envelope_too_small', () => {
        const doc = boxDocument({
            width: 150,
            height: 100,
            depth: 560,
            carcass: {
                plinth: {
                    type: 'plinth',
                    height: 100,
                    setback: 0,
                    legCode: null,
                },
            },
        });
        const { ctx, env } = run(doc);
        expect(env).toBeNull();
        expect(ctx.parts).toEqual([]);
        expect(ctx.issues).toHaveLength(1);
        expect(ctx.issues[0]).toMatchObject({
            code: 'furniture.envelope_too_small',
            severity: 'error',
            messageKey: 'engine.furniture.issue.envelope_too_small',
        });
    });

    it.each([
        ['width', 149, 500, 500],
        ['height', 500, 99, 500],
        ['depth', 500, 500, 99],
    ])('%s below the minimum is envelope_too_small', (_n, w, h, d) => {
        const { env, ctx } = run(
            boxDocument({ width: w, height: h, depth: d }),
        );
        expect(env).toBeNull();
        expect(ctx.issues.map((i) => i.code)).toEqual([
            'furniture.envelope_too_small',
        ]);
    });

    it('accepts exactly the minimum sizes', () => {
        // depth 100 with the 18 mm front zone of drawers would be 82; use no fronts
        expect(
            run(boxDocument({ width: 150, height: 100, depth: 100 })).env,
        ).not.toBeNull();
    });

    it('a non-positive interior is envelope_too_small even when the box is big enough', () => {
        // 50 mm boards leave an interior of 100 - 2 x 50 = 0 mm high
        const thick = mutateCatalog(catalog, (draft) => {
            const m = draft.materials.find((x) => x.code === 'PB18-WHITE');
            if (m) m.thicknessMm = 50;
        });
        const ctx = createGenContext(
            boxDocument({ width: 600, height: 100, depth: 560 }),
            thick,
        );
        expect(computeEnvelope(ctx)).toBeNull();
        expect(ctx.issues.map((i) => i.code)).toEqual([
            'furniture.envelope_too_small',
        ]);
    });

    it('throws for a document without a carcass', () => {
        const doc = { ...wardrobe(), family: 'table' as const, carcass: null };
        expect(() => computeEnvelope(createGenContext(doc, catalog))).toThrow(
            /carcass/,
        );
    });
});

describe('computeEnvelope: front thickness and sliding mixes', () => {
    const thick = { front: assign('PB25-WHITE') };

    it('a 25 mm front board gives a 25 mm front zone', () => {
        const env = envOf(
            boxDocument({
                width: 600,
                height: 720,
                depth: 560,
                fronts: [front()],
                materials: thick,
            }),
        );
        expect(env.fz).toBe(25);
        expect(env.Dc).toBe(535);
    });

    it('a 25 mm front board widens the sliding zone to 2 x (25 + 12)', () => {
        const env = envOf(
            boxDocument({
                width: 1200,
                height: 720,
                depth: 560,
                fronts: [front({ kind: 'sliding', leaves: 2 })],
                materials: thick,
            }),
        );
        expect(env.slidingZone).toBe(74);
        expect(env.fz).toBe(0);
        expect(env.interior.size[2]).toBe(560 - 74 - 13);
    });

    it('sliding doors beside an overlay front still leave no front zone', () => {
        const env = envOf(
            boxDocument({
                width: 1200,
                height: 720,
                depth: 560,
                fronts: [
                    front({ kind: 'sliding', leaves: 2 }),
                    front({ id: 'fr_0000000002', covers: ['s_0000000009'] }),
                ],
            }),
        );
        expect(env.fz).toBe(0);
        expect(env.slidingZone).toBe(60);
        expect(env.Dc).toBe(560);
        expect(env.drawerStyle).toBe('full');
    });
});

describe('coveringFront and hasExternalDrawers', () => {
    const drawers = (behindDoor: boolean) =>
        ({
            type: 'drawers',
            count: 2,
            frontHeights: 'equal',
            slideCode: null,
            behindDoor,
        }) as const;
    const split = (): Section => ({
        id: 's_0000000001',
        split: 'columns',
        content: null,
        children: [
            {
                size: { mode: 'flex', weight: 1 },
                section: {
                    id: 's_0000000002',
                    split: 'rows',
                    content: null,
                    children: [
                        {
                            size: { mode: 'flex', weight: 1 },
                            section: {
                                id: 's_0000000003',
                                split: 'none',
                                children: [],
                                content: drawers(false),
                            },
                        },
                    ],
                },
            },
            {
                size: { mode: 'flex', weight: 1 },
                section: {
                    id: 's_0000000004',
                    split: 'none',
                    children: [],
                    content: { type: 'empty' },
                },
            },
        ],
    });
    const docWith = (
        fronts: Front[],
        interior = split(),
    ): FurnitureDocument => {
        const doc = boxDocument({
            width: 1200,
            height: 720,
            depth: 560,
            fronts,
        });
        if (!doc.carcass) throw new Error('no carcass');
        doc.carcass.interior = interior;
        return doc;
    };

    it('coveringFront matches the section itself or any ancestor', () => {
        const direct = front({ covers: ['s_0000000003'] });
        const viaColumn = front({ covers: ['s_0000000002'] });
        const viaRoot = front({ covers: ['s_0000000001'] });
        const other = front({ covers: ['s_0000000004'] });
        expect(coveringFront(docWith([direct]), 's_0000000003')?.id).toBe(
            direct.id,
        );
        expect(coveringFront(docWith([viaColumn]), 's_0000000003')?.id).toBe(
            viaColumn.id,
        );
        expect(coveringFront(docWith([viaRoot]), 's_0000000003')?.id).toBe(
            viaRoot.id,
        );
        expect(coveringFront(docWith([other]), 's_0000000003')).toBeUndefined();
        expect(coveringFront(docWith([]), 's_0000000003')).toBeUndefined();
    });

    it('coveringFront falls back to the section id for an unknown section', () => {
        const f = front({ covers: ['s_0000000077'] });
        expect(coveringFront(docWith([f]), 's_0000000077')?.id).toBe(f.id);
    });

    it('hasExternalDrawers is true for uncovered drawers without a door', () => {
        expect(hasExternalDrawers(docWith([]))).toBe(true);
    });

    it('hasExternalDrawers is false when a front covers the leaf or an ancestor', () => {
        expect(
            hasExternalDrawers(docWith([front({ covers: ['s_0000000003'] })])),
        ).toBe(false);
        expect(
            hasExternalDrawers(docWith([front({ covers: ['s_0000000002'] })])),
        ).toBe(false);
        expect(
            hasExternalDrawers(docWith([front({ covers: ['s_0000000004'] })])),
        ).toBe(true);
    });

    it('hasExternalDrawers is false for drawers behind a door, other content, or no carcass', () => {
        const behind = split();
        const leafSection = behind.children[0]?.section.children[0]?.section;
        if (!leafSection) throw new Error('no leaf');
        leafSection.content = drawers(true);
        expect(hasExternalDrawers(docWith([], behind))).toBe(false);
        expect(
            hasExternalDrawers(
                boxDocument({ width: 600, height: 720, depth: 560 }),
            ),
        ).toBe(false);
        expect(
            hasExternalDrawers({
                ...wardrobe(),
                family: 'table',
                carcass: null,
            }),
        ).toBe(false);
    });
});
