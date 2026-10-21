// @vitest-environment node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { derivePlanGeometry } from '../derive';
import { PlanDocumentSchema, type PlanDocument } from '../schema';
import { buildBrochure2Bhk, buildHdb3Room } from '../testing/referencePlans';
import { planSummary } from '../summary';
import { validatePlan } from '../validate';

/**
 * Reference plans (03 §6, 04 §9). All net numbers below are derived by hand
 * from the centre-line coordinates: a room's net span along an axis is the
 * face span minus half the thickness of the wall on each side (exterior 230 ->
 * 115, interior 115 -> 57.5, the 230 mm interior wall N7-N26 / A7-A6 -> 115,
 * the `half` 115 mm walls -> 57.5). Wall thicknesses are listed per wall in
 * `referencePlans.ts`.
 *
 * HDB 3-room (11 000 mm envelope). Controller ruling C8: the drawing's "7600"
 * (living) and "3100" (bedroom 3) are net spans, which cannot both hold on
 * centre lines inside the 11 000 envelope, so N13 and N20 sit at x = 7773.
 *   Kitchen    x 0..1600  y 0..3300   -> (1600-115-57.5) x (3300-115-57.5)
 *                                       = 1427.5 x 3127.5      = 4 464 506.25
 *   Toilet 1   x 1600..2900 y 0..1900 -> 1185 x 1727.5        = 2 047 087.5
 *   Bedroom 1  L: x 2900..4700 y 0..3300 plus x 1600..2900 y 1900..3300
 *              = 1685 x 3127.5 + 1300 x 1285                  = 6 940 337.5
 *   Toilet 2   x 4700..5900 y 0..1900 -> 1085 x 1727.5        = 1 874 337.5
 *   Bedroom 2  L: x 5900..8300 y 0..3300 plus x 4700..5900 y 1900..3300
 *              = 2285 x 3127.5 + 1200 x 1285                  = 8 688 337.5
 *   Toilet 3   x 9700..11000 y -600..1900 (N7-N26 is 230 thick)
 *              = (11000-115-9700-115) x (1900-57.5+600-115)
 *              = 1070 x 2327.5                                = 2 490 425
 *   Dress      L: x 8300..9700 y 0..1900 plus x 8300..11000 y 1900..3300
 *              = 1227.5 x 3127.5 + 1300 x 1285                = 5 509 506.25
 *   Living     x 0..7773 y 3300..7400
 *              = (7773-57.5-115) x (7400-115-3357.5)
 *              = 7600.5 x 3927.5                              = 29 850 963.75
 *   Bedroom 3  x 7773..11000 y 3300..7400
 *              = (11000-115-7830.5) x 3927.5
 *              = 3054.5 x 3927.5                              = 11 996 548.75
 *   Balcony    x 4100..7700 y 7400..8300 (bottom wall is `half`)
 *              = (7700-115-4215) x (8300-57.5-7515)
 *              = 3370 x 727.5                                 = 2 451 675
 * Moving the wall from x = 7900 to 7773 only trades 127 mm between Living and
 * Bedroom 3, which have the same depth, so the exact total stays 76 313 725
 * (the engine sums whole-mm rooms: 76 313 727; the brief's 76 313 726 +-5).
 *
 * Brochure 2BHK. The y = 3530 row is at 3525 and wall A7-A6 is 230 thick, so
 * the bottom face of Bedroom 2 is uniform (115) and Bedroom 1 is 3047.5 x 3352.5.
 *   Bedroom 1  x 0..3220 y 0..3525 -> (3220-115-57.5) x (3525-115-57.5)
 *                                   = 3047.5 x 3352.5     = 10 216 743.75
 *   Deck       x 3220..6410 y 0..1390 (top wall is `half`)
 *                                   = (3190-115) x (1390-57.5-57.5)
 *                                   = 3075 x 1275          = 3 920 625
 *   Bedroom 2  x 6410..9630 y 0..3525 -> (9630-115-6467.5) x (3525-115-115)
 *                                   = 3047.5 x 3295        = 10 041 512.5
 *   Toilet 1   x 0..2580 y 3525..5170 -> (2580-115-57.5) x (5170-57.5-3582.5)
 *                                   = 2407.5 x 1530        = 3 683 475
 *   W/M        x 2580..3220 y 3525..5170 -> 525 x 1530     = 803 250
 *   Kitchen    x 0..3220 y 5170..8120 -> 3047.5 x (8005-5227.5)
 *                                   = 3047.5 x 2777.5      = 8 464 431.25
 *   Living/Dining x 3220..6410 y 1390..8120: left face 57.5; right face 57.5
 *              down to y = 5880 (interior walls), 115 below (exterior A9-A10)
 *              = 3075 x (5880-1447.5) + 3017.5 x (8005-5880)
 *              = 3075 x 4432.5 + 3017.5 x 2125                = 20 042 125
 *   Toilet 2   x 6410..8010 y 3525..5880 -> (8010-115-6467.5) x (5765-3640)
 *                                   = 1427.5 x 2125        = 3 033 437.5
 * Exact total 60 205 600 (engine sum of whole-mm rooms: 60 205 601).
 */

const FIXTURE_DIR = '../../../../../database/fixtures/plans/';
const fixtureUrl = (file: string): URL =>
    new URL(`${FIXTURE_DIR}${file}`, import.meta.url);

const UPDATE = process.env['UPDATE_FIXTURES'] === '1';

function readFixture(file: string): unknown {
    return JSON.parse(readFileSync(fixtureUrl(file), 'utf8'));
}

function syncFixture(file: string, doc: PlanDocument): void {
    if (!UPDATE) return;
    mkdirSync(fileURLToPath(new URL('./', fixtureUrl(file))), {
        recursive: true,
    });
    writeFileSync(
        fixtureUrl(file),
        `${JSON.stringify(doc, null, 2)}\n`,
        'utf8',
    );
}

function expectWithin(actual: number, expected: number, tol: number): void {
    expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol);
}

/** Derived rooms keyed by their meta name. */
function roomsByName(doc: PlanDocument) {
    const derived = derivePlanGeometry(doc);
    const byName = new Map<string, (typeof derived.rooms)[number]>();
    for (const room of derived.rooms) {
        expect(room.metaId).not.toBeNull();
        const meta = room.metaId === null ? undefined : doc.rooms[room.metaId];
        if (!meta) throw new Error('room without a meta');
        byName.set(meta.name, room);
    }
    return byName;
}

function wallLength(doc: PlanDocument, wallId: string): number {
    const wall = doc.walls[wallId];
    const a = wall && doc.nodes[wall.a];
    const b = wall && doc.nodes[wall.b];
    if (!a || !b) throw new Error(`broken wall ${wallId}`);
    return Math.hypot(b.x - a.x, b.y - a.y);
}

function commonChecks(
    file: string,
    build: () => PlanDocument,
    counts: { walls: number; openings: number; rooms: number },
): void {
    const doc = build();
    syncFixture(file, doc);

    it('is deterministic', () => {
        expect(build()).toEqual(doc);
    });

    it('matches the committed JSON fixture', () => {
        expect(readFixture(file)).toEqual(doc);
    });

    it('parses with PlanDocumentSchema', () => {
        expect(PlanDocumentSchema.safeParse(doc).success).toBe(true);
    });

    it('has no validation errors', () => {
        const issues = validatePlan(doc);
        expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
    });

    it('has every opening inside its wall (offset is the centre)', () => {
        for (const o of Object.values(doc.openings)) {
            const length = wallLength(doc, o.wallId);
            expect(o.offset - o.width / 2).toBeGreaterThanOrEqual(0);
            expect(o.offset + o.width / 2).toBeLessThanOrEqual(length);
        }
    });

    it('has the documented entity counts and a meta on every room', () => {
        expect(Object.keys(doc.walls)).toHaveLength(counts.walls);
        expect(Object.keys(doc.openings)).toHaveLength(counts.openings);
        const derived = derivePlanGeometry(doc);
        expect(derived.rooms).toHaveLength(counts.rooms);
        expect(Object.keys(doc.rooms)).toHaveLength(counts.rooms);
        for (const room of derived.rooms) {
            expect(room.metaId).not.toBeNull();
        }
    });

    it('uses the documented meta and heights', () => {
        expect(doc.meta.defaultWallHeight).toBe(2600);
        expect(doc.meta.createdWith).toBe('editor');
        for (const wall of Object.values(doc.walls)) {
            expect(wall.height).toBe(wall.kind === 'half' ? 1000 : 2600);
        }
    });
}

describe('buildHdb3Room', () => {
    commonChecks('hdb-3room.json', buildHdb3Room, {
        walls: 37,
        openings: 16,
        rooms: 10,
    });
    const doc = buildHdb3Room();

    it('uses fixed ids in table order', () => {
        expect(Object.keys(doc.nodes)[0]).toBe('n_hdb0000001');
        expect(Object.keys(doc.nodes)).toHaveLength(28);
        expect(Object.keys(doc.walls)[36]).toBe('w_hdb0000037');
        expect(Object.keys(doc.openings)[0]).toBe('o_hdb0000001');
        expect(Object.keys(doc.rooms)[9]).toBe('r_hdb0000010');
    });

    it('moves the interior wall to x = 7773 (ruling C8)', () => {
        expect(doc.nodes['n_hdb0000013']).toMatchObject({ x: 7773, y: 7400 });
        expect(doc.nodes['n_hdb0000020']).toMatchObject({ x: 7773, y: 3300 });
    });

    it('has the hand-derived net room areas', () => {
        const expected: Record<string, number> = {
            Kitchen: 1427.5 * 3127.5,
            'Toilet 1': 1185 * 1727.5,
            'Bedroom 1': 1685 * 3127.5 + 1300 * 1285,
            'Toilet 2': 1085 * 1727.5,
            'Bedroom 2': 2285 * 3127.5 + 1200 * 1285,
            'Toilet 3': 1070 * 2327.5,
            Dress: 1227.5 * 3127.5 + 1300 * 1285,
            'Living Room': 7600.5 * 3927.5,
            'Bedroom 3': 3054.5 * 3927.5,
            Balcony: 3370 * 727.5,
        };
        const rooms = roomsByName(doc);
        expect([...rooms.keys()].sort()).toEqual(Object.keys(expected).sort());
        for (const [name, area] of Object.entries(expected)) {
            expectWithin(rooms.get(name)?.areaMm2 ?? NaN, area, 1);
        }
        // the figures written out, for a reader
        expectWithin(rooms.get('Kitchen')?.areaMm2 ?? NaN, 4_464_506, 1);
        expectWithin(rooms.get('Toilet 1')?.areaMm2 ?? NaN, 2_047_088, 1);
        expectWithin(rooms.get('Bedroom 1')?.areaMm2 ?? NaN, 6_940_338, 1);
        expectWithin(rooms.get('Toilet 2')?.areaMm2 ?? NaN, 1_874_338, 1);
        expectWithin(rooms.get('Bedroom 2')?.areaMm2 ?? NaN, 8_688_338, 1);
        expectWithin(rooms.get('Toilet 3')?.areaMm2 ?? NaN, 2_490_425, 1);
        expectWithin(rooms.get('Dress')?.areaMm2 ?? NaN, 5_509_506, 1);
        expectWithin(rooms.get('Living Room')?.areaMm2 ?? NaN, 29_850_964, 1);
        expectWithin(rooms.get('Bedroom 3')?.areaMm2 ?? NaN, 11_996_549, 1);
        expectWithin(rooms.get('Balcony')?.areaMm2 ?? NaN, 2_451_675, 1);
    });

    it('has the living room net rect 7600.5 x 3927.5 (drawing: 7600)', () => {
        const living = roomsByName(doc).get('Living Room');
        const rect = living?.netRect;
        if (!rect) throw new Error('living room has no netRect');
        expectWithin(rect.width, 7600.5, 1e-6);
        expectWithin(rect.width, 7600, 1);
        expectWithin(rect.depth, 3927.5, 1e-6);
    });

    it('has the bedroom 3 net rect 3054.5 x 3927.5 (drawing: 3100)', () => {
        const rect = roomsByName(doc).get('Bedroom 3')?.netRect;
        if (!rect) throw new Error('bedroom 3 has no netRect');
        expectWithin(rect.width, 3054.5, 1e-6);
        expectWithin(rect.depth, 3927.5, 1e-6);
    });

    it('summarises to the documented totals and bounding box', () => {
        const summary = planSummary(doc);
        expect(summary.roomCount).toBe(10);
        expect(summary.wallCount).toBe(37);
        expectWithin(summary.totalAreaMm2, 76_313_726, 5);
        expect(summary.bbox).toEqual({
            min: { x: -115, y: -715 },
            max: { x: 11115, y: 8358 },
        });
    });

    it('attaches the named room metas', () => {
        const names = Object.values(doc.rooms).map((r) => r.name);
        expect(names).toEqual([
            'Kitchen',
            'Toilet 1',
            'Bedroom 1',
            'Toilet 2',
            'Bedroom 2',
            'Toilet 3',
            'Dress',
            'Living Room',
            'Bedroom 3',
            'Balcony',
        ]);
    });
});

describe('buildBrochure2Bhk', () => {
    commonChecks('brochure-2bhk.json', buildBrochure2Bhk, {
        walls: 27,
        openings: 13,
        rooms: 8,
    });
    const doc = buildBrochure2Bhk();

    it('uses fixed ids in table order', () => {
        expect(Object.keys(doc.nodes)[0]).toBe('n_bhk0000001');
        expect(Object.keys(doc.nodes)).toHaveLength(20);
        expect(Object.keys(doc.walls)[26]).toBe('w_bhk0000027');
        expect(Object.keys(doc.openings)[0]).toBe('o_bhk0000001');
        expect(Object.keys(doc.rooms)[7]).toBe('r_bhk0000008');
    });

    it('puts the y = 3530 node row at 3525 and thickens A7-A6 to 230', () => {
        for (const label of [5, 6, 7, 14, 15, 18]) {
            const id = `n_bhk${String(label).padStart(7, '0')}`;
            expect(doc.nodes[id]?.y).toBe(3525);
        }
        const a6 = 'n_bhk0000006';
        const a7 = 'n_bhk0000007';
        const wall = Object.values(doc.walls).find(
            (w) => w.a === a7 && w.b === a6,
        );
        expect(wall).toMatchObject({ thickness: 230, kind: 'interior' });
    });

    it('has the hand-derived net room areas', () => {
        const expected: Record<string, number> = {
            'Bedroom 1': 3047.5 * 3352.5,
            Deck: 3075 * 1275,
            'Bedroom 2': 3047.5 * 3295,
            'Toilet 1': 2407.5 * 1530,
            'W/M': 525 * 1530,
            Kitchen: 3047.5 * 2777.5,
            'Living/Dining': 3075 * 4432.5 + 3017.5 * 2125,
            'Toilet 2': 1427.5 * 2125,
        };
        const rooms = roomsByName(doc);
        expect([...rooms.keys()].sort()).toEqual(Object.keys(expected).sort());
        for (const [name, area] of Object.entries(expected)) {
            expectWithin(rooms.get(name)?.areaMm2 ?? NaN, area, 1);
        }
        // the figures written out, for a reader
        expectWithin(rooms.get('Bedroom 1')?.areaMm2 ?? NaN, 10_216_744, 1);
        expectWithin(rooms.get('Deck')?.areaMm2 ?? NaN, 3_920_625, 1);
        expectWithin(rooms.get('Bedroom 2')?.areaMm2 ?? NaN, 10_041_513, 1);
        expectWithin(rooms.get('Toilet 1')?.areaMm2 ?? NaN, 3_683_475, 1);
        expectWithin(rooms.get('W/M')?.areaMm2 ?? NaN, 803_250, 1);
        expectWithin(rooms.get('Kitchen')?.areaMm2 ?? NaN, 8_464_431, 1);
        expectWithin(rooms.get('Living/Dining')?.areaMm2 ?? NaN, 20_042_125, 1);
        expectWithin(rooms.get('Toilet 2')?.areaMm2 ?? NaN, 3_033_438, 1);
    });

    it('has bedroom 1 at 10\'0" x 11\'0" (spec 16 §7.1)', () => {
        const rect = roomsByName(doc).get('Bedroom 1')?.netRect;
        if (!rect) throw new Error('bedroom 1 has no netRect');
        expectWithin(rect.width, 3047.5, 1e-6);
        expectWithin(rect.depth, 3352.5, 1e-6);
        expectWithin(rect.width, 3048, 1);
        expectWithin(rect.depth, 3353, 1);
    });

    it('has a net rect for bedroom 2 (uniform bottom face)', () => {
        const rect = roomsByName(doc).get('Bedroom 2')?.netRect;
        expect(rect).not.toBeNull();
        expect(rect).toBeDefined();
        expectWithin(rect?.width ?? NaN, 3047.5, 1e-6);
        expectWithin(rect?.depth ?? NaN, 3295, 1e-6);
    });

    it('summarises to the documented totals and bounding box', () => {
        const summary = planSummary(doc);
        expect(summary.roomCount).toBe(8);
        expect(summary.wallCount).toBe(27);
        expectWithin(summary.totalAreaMm2, 60_205_600, 5);
        expect(summary.bbox).toEqual({
            min: { x: -115, y: -115 },
            max: { x: 9745, y: 8235 },
        });
    });

    it('attaches the named room metas', () => {
        expect(Object.values(doc.rooms).map((r) => r.name)).toEqual([
            'Bedroom 1',
            'Deck',
            'Bedroom 2',
            'Toilet 1',
            'W/M',
            'Kitchen',
            'Living/Dining',
            'Toilet 2',
        ]);
    });
});
