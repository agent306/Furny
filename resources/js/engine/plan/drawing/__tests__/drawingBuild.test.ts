import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../../testing/random';
import { derivePlanGeometry } from '../../derive';
import { doorSwingSectors } from '../../conflicts';
import { FIXTURE_KEYS, FIXTURE_LIBRARY } from '../../fixtures';
import type { PlanDocument } from '../../schema';
import { emptyPlan, makeRectPlan } from '../../testing/fixtures';
import {
    addFixture,
    addOpening,
    addRoomMeta,
    arcsOf,
    numbersIn,
} from '../../testing/drawingHelpers';
import { testDrawingOptions } from '../../testing/drawingOptions';
import { buildBrochure2Bhk, buildHdb3Room } from '../../testing/referencePlans';
import {
    buildPlanDrawing,
    LAYER_ORDER,
    STYLE_KEYS,
    type DrawGroup,
    type DrawItem,
    type PlanDrawing,
} from '..';

const opts = testDrawingOptions();

/** The reference plan plus every entity kind the drawing knows. */
function richPlan(base: PlanDocument): PlanDocument {
    const doc = structuredClone(base);
    FIXTURE_KEYS.forEach((key, i) => {
        const def = FIXTURE_LIBRARY[key];
        addFixture(doc, {
            libraryKey: key,
            x: 500 + (i % 7) * 1500,
            y: 500 + Math.floor(i / 7) * 1500,
            rotation: (i * 37) % 360,
            width: def.width,
            depth: def.depth,
            height: def.height,
            elevation: def.elevation,
        });
    });
    const place = (n: number, designId: string, rotation: number): void => {
        const id = `f_${String(n).padStart(10, '0')}`;
        doc.placements[id] = {
            id,
            designId,
            x: 1000 * n,
            y: 2000,
            rotation,
            elevation: 0,
            mirrored: false,
            wallAttachment: null,
        };
    };
    place(1, 'sofa', 0);
    place(2, 'wardrobe', 33.5);
    place(3, 'no_such_design', 270);
    doc.annotations.dimensions['d_0000000001'] = {
        id: 'd_0000000001',
        a: { x: 0, y: 0 },
        b: { x: 3000, y: 1700 },
        offset: -400,
        attachedTo: null,
    };
    doc.annotations.labels['t_0000000001'] = {
        id: 't_0000000001',
        position: { x: 500, y: 500 },
        text: 'Note & <b>',
        fontSize: 250,
        rotation: 12.5,
    };
    doc.background = {
        importId: null,
        mediaUuid: 'abc',
        pixelWidth: 2000,
        pixelHeight: 1000,
        mmPerPixel: 5.5,
        position: { x: -100, y: -200 },
        rotation: 3,
        opacity: 0.5,
        visible: true,
        locked: false,
    };
    return doc;
}

function build(
    doc: PlanDocument,
    options = testDrawingOptions({
        include: { ...opts.include, background: { href: 'bg.png' } },
    }),
): PlanDrawing {
    return buildPlanDrawing(doc, derivePlanGeometry(doc), options);
}

const allGroups = (d: PlanDrawing): DrawGroup[] =>
    LAYER_ORDER.flatMap((l) => d.layers[l]);
const allItems = (d: PlanDrawing): DrawItem[] =>
    allGroups(d).flatMap((g) => g.items);

const REFERENCE_PLANS: Array<[string, () => PlanDocument]> = [
    ['hdb-3room', buildHdb3Room],
    ['brochure-2bhk', buildBrochure2Bhk],
];

describe.each(REFERENCE_PLANS)('buildPlanDrawing smoke: %s', (_name, make) => {
    for (const [label, doc] of [
        ['as built', make()],
        ['with every entity kind', richPlan(make())],
    ] as const) {
        describe(label, () => {
            const drawing = build(doc);

            it('builds with every layer present, in paint order', () => {
                expect(Object.keys(drawing.layers)).toEqual([...LAYER_ORDER]);
                for (const layer of LAYER_ORDER) {
                    expect(Array.isArray(drawing.layers[layer])).toBe(true);
                }
                expect(drawing.bbox).not.toBeNull();
            });

            it('contains only finite, non-negative-zero numbers on the 0.01 grid', () => {
                const bad = numbersIn(drawing).filter(
                    ({ n }) =>
                        !Number.isFinite(n) ||
                        Object.is(n, -0) ||
                        Math.abs(n * 100 - Math.round(n * 100)) > 1e-6,
                );
                // Angles keep four decimals, so only the arc angle fields may
                // leave the 0.01 grid.
                const offGrid = bad.filter(
                    ({ path, n }) =>
                        !Number.isFinite(n) ||
                        Object.is(n, -0) ||
                        !/\.(startDeg|endDeg)$/.test(path),
                );
                expect(offGrid).toEqual([]);
            });

            it('uses only known style keys', () => {
                const styles = new Set<string>(STYLE_KEYS);
                for (const item of allItems(drawing)) {
                    if ('style' in item)
                        expect(styles.has(item.style)).toBe(true);
                }
            });
        });
    }
});

describe('buildPlanDrawing layers', () => {
    const doc = richPlan(buildHdb3Room());
    const drawing = build(doc);

    it('routes items to their layers', () => {
        const kinds = (layer: (typeof LAYER_ORDER)[number]) =>
            new Set(drawing.layers[layer].map((g) => g.entityKind));
        expect(kinds('BACKGROUND')).toEqual(new Set(['background']));
        expect(kinds('ROOMS')).toEqual(new Set(['room']));
        expect(kinds('FIXTURES')).toEqual(new Set(['fixture']));
        expect(kinds('FURNITURE')).toEqual(new Set(['placement']));
        expect(kinds('WALLS')).toEqual(new Set(['wall']));
        expect(kinds('OPENINGS')).toEqual(new Set(['opening']));
        expect(kinds('DIMS')).toEqual(new Set(['dimension', 'auto_dimension']));
        expect(kinds('TEXT')).toEqual(new Set(['room', 'placement', 'label']));
    });

    it('keeps text out of the geometry layers and dimension text in DIMS', () => {
        for (const layer of LAYER_ORDER) {
            for (const item of drawing.layers[layer].flatMap((g) => g.items)) {
                if (item.t !== 'text') continue;
                expect(layer).toBe(item.style === 'dim_text' ? 'DIMS' : 'TEXT');
            }
        }
    });

    it('draws the wall outline once from wallsUnion, after the wall fills', () => {
        const geom = derivePlanGeometry(doc);
        const walls = drawing.layers.WALLS;
        const last = walls[walls.length - 1]!;
        expect(last).toMatchObject({ entityId: null, entityKind: 'wall' });
        expect(walls.filter((g) => g.entityId === null)).toHaveLength(1);
        expect(last.items).toHaveLength(geom.wallsUnion.length);
        last.items.forEach((item, i) => {
            const part = geom.wallsUnion[i]!;
            expect(item).toMatchObject({
                t: 'poly',
                style: 'wall_outline',
                closed: true,
            });
            if (item.t !== 'poly') return;
            expect(item.pts).toHaveLength(part.outer.length);
            expect(item.holes?.length ?? 0).toBe(part.holes.length);
        });
        expect(walls.slice(0, -1).every((g) => g.entityId !== null)).toBe(true);
    });

    it('draws one group per wall, opening, fixture and placement', () => {
        expect(drawing.layers.WALLS).toHaveLength(
            Object.keys(doc.walls).length + 1,
        );
        expect(drawing.layers.OPENINGS).toHaveLength(
            Object.keys(doc.openings).length,
        );
        expect(drawing.layers.FIXTURES).toHaveLength(
            Object.keys(doc.fixtures).length,
        );
        expect(drawing.layers.FURNITURE).toHaveLength(
            Object.keys(doc.placements).length,
        );
    });

    it('draws the background image at its natural size', () => {
        expect(drawing.layers.BACKGROUND).toEqual([
            {
                entityId: null,
                entityKind: 'background',
                items: [
                    {
                        t: 'image',
                        href: 'bg.png',
                        at: { x: -100, y: -200 },
                        width: 11000,
                        height: 5500,
                        rotationDeg: 3,
                        opacity: 0.5,
                    },
                ],
            },
        ]);
    });

    it('omits the background when hidden or not requested', () => {
        const hidden = structuredClone(doc);
        hidden.background!.visible = false;
        expect(build(hidden).layers.BACKGROUND).toEqual([]);
        expect(build(doc, opts).layers.BACKGROUND).toEqual([]);
    });
});

describe('buildPlanDrawing include flags', () => {
    const doc = richPlan(buildHdb3Room());
    const without = (patch: Partial<typeof opts.include>) =>
        build(
            doc,
            testDrawingOptions({ include: { ...opts.include, ...patch } }),
        );

    it('turns each content kind off', () => {
        const rooms = without({ rooms: false });
        expect(rooms.layers.ROOMS).toEqual([]);
        expect(rooms.layers.TEXT.some((g) => g.entityKind === 'room')).toBe(
            false,
        );
        expect(without({ furniture: false }).layers.FURNITURE).toEqual([]);
        expect(without({ fixtures: false }).layers.FIXTURES).toEqual([]);
        expect(
            without({ autoDimensions: false }).layers.DIMS.some(
                (g) => g.entityKind === 'auto_dimension',
            ),
        ).toBe(false);
        expect(
            without({ userDimensions: false }).layers.DIMS.some(
                (g) => g.entityKind === 'dimension',
            ),
        ).toBe(false);
        expect(
            without({ labels: false }).layers.TEXT.some(
                (g) => g.entityKind === 'label',
            ),
        ).toBe(false);
    });

    it('removes arcs, room areas and room sizes independently', () => {
        const arcs = (d: PlanDrawing) =>
            d.layers.OPENINGS.flatMap((g) => arcsOf(g)).length;
        expect(arcs(build(doc))).toBeGreaterThan(0);
        expect(arcs(without({ doorSwings: false }))).toBe(0);
        const roomText = (d: PlanDrawing, style: string) =>
            d.layers.TEXT.flatMap((g) => g.items).filter(
                (i) => i.t === 'text' && i.style === style,
            ).length;
        expect(roomText(without({ roomAreas: false }), 'room_area')).toBe(0);
        expect(roomText(without({ roomDims: false }), 'room_dims')).toBe(0);
        expect(roomText(build(doc), 'room_area')).toBeGreaterThan(0);
        expect(roomText(build(doc), 'room_dims')).toBeGreaterThan(0);
    });

    it('applies lod 1 and lod 2 across the whole drawing', () => {
        const lod1 = build(doc, testDrawingOptions({ lod: 1 }));
        expect(
            lod1.layers.DIMS.some((g) => g.entityKind === 'auto_dimension'),
        ).toBe(false);
        expect(lod1.layers.OPENINGS.flatMap((g) => arcsOf(g))).toEqual([]);
        expect(lod1.layers.OPENINGS.length).toBeGreaterThan(0);
        const lod2 = build(doc, testDrawingOptions({ lod: 2 }));
        expect(lod2.layers.WALLS.length).toBeGreaterThan(0);
    });

    it('drops groups that have no items', () => {
        for (const group of allGroups(build(doc))) {
            expect(group.items.length).toBeGreaterThan(0);
        }
    });
});

describe('buildPlanDrawing bbox', () => {
    it('is null for an empty plan and keeps every layer present', () => {
        const d = build(emptyPlan());
        expect(d.bbox).toBeNull();
        expect(Object.keys(d.layers)).toEqual([...LAYER_ORDER]);
        for (const layer of LAYER_ORDER) expect(d.layers[layer]).toEqual([]);
    });

    it('covers the wall outlines of a room, without the background', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        const withBg = structuredClone(doc);
        withBg.background = richPlan(emptyPlan()).background;
        const o = testDrawingOptions({
            include: {
                ...opts.include,
                autoDimensions: false,
                background: { href: 'x' },
            },
        });
        expect(build(doc, o).bbox).toEqual({
            min: { x: -115, y: -115 },
            max: { x: 5115, y: 4115 },
        });
        expect(build(withBg, o).bbox).toEqual(build(doc, o).bbox);
    });

    it('grows to include the automatic dimensions', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        const bbox = build(doc).bbox!;
        expect(bbox.min).toEqual({ x: -615, y: -615 });
        expect(bbox.max).toEqual({ x: 5615, y: 4615 });
    });

    it('does not grow for door arcs that stay inside the outline', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        addOpening(doc, 'w_0000000001', {});
        const o = testDrawingOptions({
            include: { ...opts.include, autoDimensions: false },
        });
        // The leaf and arc run 900 mm into the room from y = 115.
        expect(build(doc, o).bbox!.max).toEqual({ x: 5115, y: 4115 });
    });
});

describe('determinism', () => {
    function shuffled<T>(
        record: Record<string, T>,
        rng: () => number,
    ): Record<string, T> {
        const entries = Object.entries(record);
        for (let i = entries.length - 1; i > 0; i -= 1) {
            const j = Math.floor(rng() * (i + 1));
            [entries[i], entries[j]] = [entries[j]!, entries[i]!];
        }
        return Object.fromEntries(entries);
    }

    function shuffleDoc(doc: PlanDocument, seed: number): PlanDocument {
        const rng = mulberry32(seed);
        const out = structuredClone(doc);
        out.nodes = shuffled(out.nodes, rng);
        out.walls = shuffled(out.walls, rng);
        out.openings = shuffled(out.openings, rng);
        out.rooms = shuffled(out.rooms, rng);
        out.placements = shuffled(out.placements, rng);
        out.fixtures = shuffled(out.fixtures, rng);
        out.annotations.dimensions = shuffled(out.annotations.dimensions, rng);
        out.annotations.labels = shuffled(out.annotations.labels, rng);
        return out;
    }

    it.each(REFERENCE_PLANS)(
        'builds identical drawings from documents with shuffled record order: %s',
        (_name, make) => {
            const doc = richPlan(make());
            const first = build(doc);
            expect(build(doc)).toEqual(first);
            for (const seed of [1, 2, 3]) {
                expect(build(shuffleDoc(doc, seed))).toEqual(first);
            }
        },
    );

    it('sorts the groups of every layer by entity id', () => {
        const d = build(richPlan(buildBrochure2Bhk()));
        for (const layer of LAYER_ORDER) {
            const ids = d.layers[layer].map((g) => g.entityId ?? '￿');
            expect(ids).toEqual([...ids].sort());
        }
    });

    it('does not mutate the document or the geometry', () => {
        const doc = richPlan(buildHdb3Room());
        const geom = derivePlanGeometry(doc);
        const before = structuredClone({
            doc,
            rooms: geom.rooms,
            walls: geom.walls,
        });
        buildPlanDrawing(doc, geom, opts);
        expect({ doc, rooms: geom.rooms, walls: geom.walls }).toEqual(before);
    });
});

describe('door symbols agree with the swing sectors', () => {
    function expectArcsMatchSectors(doc: PlanDocument, tol: number): number {
        const geom = derivePlanGeometry(doc);
        const drawing = buildPlanDrawing(doc, geom, opts);
        const near = (
            a: { x: number; y: number },
            b: { x: number; y: number },
        ) => Math.hypot(a.x - b.x, a.y - b.y) <= tol;
        let checked = 0;
        for (const { openingId, polygon } of doorSwingSectors(doc, geom)) {
            const group = drawing.layers.OPENINGS.find(
                (g) => g.entityId === openingId,
            )!;
            // polygon = hinge, then the arc from one end to the other.
            const hinge = polygon[0]!;
            const ends = [polygon[1]!, polygon[polygon.length - 1]!];
            const match = arcsOf(group).some((arc) => {
                const at = (deg: number) => ({
                    x: arc.c.x + arc.r * Math.cos((deg * Math.PI) / 180),
                    y: arc.c.y + arc.r * Math.sin((deg * Math.PI) / 180),
                });
                const a = at(arc.startDeg);
                const b = at(arc.endDeg);
                return (
                    near(arc.c, hinge) &&
                    ((near(a, ends[0]!) && near(b, ends[1]!)) ||
                        (near(a, ends[1]!) && near(b, ends[0]!)))
                );
            });
            expect(match, `arc of ${openingId}`).toBe(true);
            checked += 1;
        }
        return checked;
    }

    it('matches every swing door of the HDB plan within 0.01 mm', () => {
        expect(
            expectArcsMatchSectors(buildHdb3Room(), 0.01),
        ).toBeGreaterThanOrEqual(8);
    });

    it('matches every swing door of the brochure plan within 0.01 mm', () => {
        expect(
            expectArcsMatchSectors(buildBrochure2Bhk(), 0.01),
        ).toBeGreaterThanOrEqual(7);
    });

    it('matches doors on a diagonal wall and double doors', () => {
        const doc = emptyPlan();
        doc.nodes['n_0000000001'] = { id: 'n_0000000001', x: 0, y: 0 };
        doc.nodes['n_0000000002'] = { id: 'n_0000000002', x: 3000, y: 4000 };
        doc.walls['w_0000000001'] = {
            id: 'w_0000000001',
            a: 'n_0000000001',
            b: 'n_0000000002',
            thickness: 115,
            height: 2700,
            kind: 'interior',
            justification: 'center',
            material: 'brick',
            colorHex: null,
        };
        addOpening(doc, 'w_0000000001', {
            offset: 1000,
            width: 900,
            hinge: 'end',
            swing: 'left',
        });
        addOpening(doc, 'w_0000000001', {
            offset: 2500,
            width: 1200,
            type: 'double_swing',
        });
        addOpening(doc, 'w_0000000001', {
            offset: 4000,
            width: 1000,
            kind: 'window',
            type: 'french_window',
            swing: 'right',
        });
        // Coordinates round to 0.01 mm, so the diagonal leaves drift a little.
        expect(expectArcsMatchSectors(doc, 0.02)).toBe(1 + 2 + 2);
    });

    it('tolerates zero-width openings anywhere in the drawing', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        addRoomMeta(doc, { x: 2500, y: 2000 });
        for (const type of [
            'single_swing',
            'double_swing',
            'sliding',
        ] as const) {
            addOpening(doc, 'w_0000000001', { type, width: 0, offset: 500 });
        }
        addOpening(doc, 'w_0000000001', {
            kind: 'window',
            type: 'bay',
            width: 0,
        });
        addOpening(doc, 'w_0000000001', {
            kind: 'opening',
            type: 'opening',
            width: 0,
        });
        const d = build(doc);
        expect(numbersIn(d).every(({ n }) => Number.isFinite(n))).toBe(true);
    });
});
