import type { IdPrefix } from '../../ids';
import type {
    FLOOR_FINISHES,
    Opening,
    PlanDocument,
    RoomMeta,
    Wall,
} from '../schema';
import { emptyPlan } from './fixtures';

/**
 * Reference plan fixtures (03 §6, 04 §9): simplified recreations of the two
 * reference blueprints in `vision/tests/fixtures/reference/`. Test-only, not
 * exported from the engine index; the committed JSON copies live in
 * `database/fixtures/plans/` and are asserted equal to these builders.
 *
 * Coordinates are centre lines in integer mm. Walls are exterior (230),
 * interior (115) unless a row says otherwise.
 */

const WALL_HEIGHT = 2600;
const HALF_WALL_HEIGHT = 1000;
const DOOR_HEIGHT = 2100;
const WINDOW_HEIGHT = 1200;
const WINDOW_SILL = 900;
const VENT_HEIGHT = 600;
const VENT_SILL = 1500;

type Point = readonly [label: string, x: number, y: number];
type WallRow = readonly [
    a: string,
    b: string,
    thickness: number,
    kind: Wall['kind'],
    height?: number,
];
type OpeningRow = readonly [
    wall: string,
    kind: Opening['kind'],
    type: Opening['type'],
    offset: number,
    width: number,
    height: number,
    sillHeight: number,
    /** Side of the wall the leaf swings into; defaults to `'left'` (+normal). */
    swing?: Opening['swing'],
];
type FloorFinish = (typeof FLOOR_FINISHES)[number];
type RoomRow = readonly [
    name: string,
    type: RoomMeta['type'],
    x: number,
    y: number,
    floorFinish: FloorFinish,
];

const ext = (a: string, b: string): WallRow => [a, b, 230, 'exterior'];
const int = (a: string, b: string): WallRow => [a, b, 115, 'interior'];
const half = (a: string, b: string): WallRow => [
    a,
    b,
    115,
    'half',
    HALF_WALL_HEIGHT,
];

/** `offset` is the opening centre measured from the first node of `wall`. */
const door = (
    wall: string,
    type: Extract<
        Opening['type'],
        'single_swing' | 'main_entrance' | 'sliding'
    >,
    offset: number,
    width: number,
    swing: Opening['swing'] = 'left',
): OpeningRow => [wall, 'door', type, offset, width, DOOR_HEIGHT, 0, swing];
const gap = (wall: string, offset: number, width: number): OpeningRow => [
    wall,
    'opening',
    'opening',
    offset,
    width,
    DOOR_HEIGHT,
    0,
];
const casement = (
    wall: string,
    offset: number,
    width: number,
    height = WINDOW_HEIGHT,
    sill = WINDOW_SILL,
): OpeningRow => [wall, 'window', 'casement', offset, width, height, sill];
const ventilator = (
    wall: string,
    offset: number,
    width: number,
): OpeningRow => [
    wall,
    'window',
    'ventilator',
    offset,
    width,
    VENT_HEIGHT,
    VENT_SILL,
];

interface PlanTable {
    /** Id tag: `n_{tag}0000001`, ... (the id body is exactly 10 characters). */
    tag: string;
    nodes: readonly Point[];
    walls: readonly WallRow[];
    openings: readonly OpeningRow[];
    rooms: readonly RoomRow[];
}

/** `{prefix}_{tag}{7 digits}`, counting up per prefix in table order. */
function tableIds(tag: string): (prefix: IdPrefix) => string {
    const counters = new Map<IdPrefix, number>();
    return (prefix) => {
        const next = (counters.get(prefix) ?? 0) + 1;
        counters.set(prefix, next);
        return `${prefix}_${tag}${String(next).padStart(7, '0')}`;
    };
}

function lookup<T>(map: ReadonlyMap<string, T>, key: string): T {
    const value = map.get(key);
    if (value === undefined) throw new Error(`reference plan: no ${key}`);
    return value;
}

function buildFromTable(table: PlanTable): PlanDocument {
    const newId = tableIds(table.tag);
    const doc = emptyPlan({ defaultWallHeight: WALL_HEIGHT });

    const nodeIds = new Map<string, string>();
    for (const [label, x, y] of table.nodes) {
        const id = newId('n');
        doc.nodes[id] = { id, x, y };
        nodeIds.set(label, id);
    }

    const wallIds = new Map<string, string>();
    for (const [a, b, thickness, kind, height] of table.walls) {
        const id = newId('w');
        doc.walls[id] = {
            id,
            a: lookup(nodeIds, a),
            b: lookup(nodeIds, b),
            thickness,
            height: height ?? WALL_HEIGHT,
            kind,
            justification: 'center',
            material: 'brick',
            colorHex: null,
        };
        wallIds.set(`${a}-${b}`, id);
    }

    for (const row of table.openings) {
        const [wall, kind, type, offset, width, height, sillHeight, swing] =
            row;
        const id = newId('o');
        doc.openings[id] = {
            id,
            wallId: lookup(wallIds, wall),
            kind,
            type,
            offset,
            width,
            height,
            sillHeight,
            hinge: 'start',
            swing: swing ?? 'left',
            label: null,
        };
    }

    for (const [name, type, x, y, floorFinish] of table.rooms) {
        const id = newId('r');
        doc.rooms[id] = {
            id,
            anchor: { x, y },
            name,
            type,
            floorFinish,
            floorColorHex: null,
            labelOffset: null,
            showArea: true,
        };
    }
    return doc;
}

/**
 * HDB 3-room flat (11 000 x 8 900 mm envelope).
 *
 * The drawing's "7600" (living) and "3100" (bedroom 3) are net spans, which
 * cannot both hold on centre lines inside the 11 000 envelope; the interior
 * wall N20-N13 therefore sits at x = 7773 (Living net 7600.5, Bedroom 3 net
 * 3054.5). N13-N14 is 73 mm long.
 */
const HDB_3ROOM: PlanTable = {
    tag: 'hdb',
    nodes: [
        ['N1', 0, 0],
        ['N2', 1600, 0],
        ['N3', 2900, 0],
        ['N4', 4700, 0],
        ['N5', 5900, 0],
        ['N6', 8300, 0],
        ['N7', 9700, 0],
        ['N8', 9700, -600],
        ['N9', 11000, -600],
        ['N10', 11000, 1900],
        ['N11', 11000, 3300],
        ['N12', 11000, 7400],
        ['N13', 7773, 7400],
        ['N14', 7700, 7400],
        ['N15', 4100, 7400],
        ['N16', 0, 7400],
        ['N17', 0, 3300],
        ['N18', 1600, 3300],
        ['N19', 4700, 3300],
        ['N20', 7773, 3300],
        ['N21', 8300, 3300],
        ['N22', 1600, 1900],
        ['N23', 2900, 1900],
        ['N24', 4700, 1900],
        ['N25', 5900, 1900],
        ['N26', 9700, 1900],
        ['N27', 4100, 8300],
        ['N28', 7700, 8300],
    ],
    walls: [
        ext('N1', 'N2'), // W1
        ext('N2', 'N3'), // W2
        ext('N3', 'N4'), // W3
        ext('N4', 'N5'), // W4
        ext('N5', 'N6'), // W5
        ext('N6', 'N7'), // W6
        ext('N7', 'N8'), // W7
        ext('N8', 'N9'), // W8
        ext('N9', 'N10'), // W9
        ext('N10', 'N11'), // W10
        ext('N11', 'N12'), // W11
        ext('N12', 'N13'), // W12
        ext('N13', 'N14'), // W13
        ext('N14', 'N15'), // W14
        ext('N15', 'N16'), // W15
        ext('N16', 'N17'), // W16
        ext('N17', 'N1'), // W17
        ext('N15', 'N27'), // W18
        half('N27', 'N28'), // W19, balcony railing
        ext('N28', 'N14'), // W20
        int('N17', 'N18'), // W21
        int('N18', 'N19'), // W22
        int('N19', 'N20'), // W23
        int('N20', 'N21'), // W24
        int('N21', 'N11'), // W25
        int('N2', 'N22'), // W26
        int('N22', 'N18'), // W27
        int('N4', 'N24'), // W28
        int('N24', 'N19'), // W29
        int('N6', 'N21'), // W30
        int('N20', 'N13'), // W31
        int('N22', 'N23'), // W32
        int('N3', 'N23'), // W33
        int('N24', 'N25'), // W34
        int('N5', 'N25'), // W35
        ['N7', 'N26', 230, 'interior'], // W36
        int('N26', 'N10'), // W37
    ],
    openings: [
        door('N16-N17', 'main_entrance', 800, 1000, 'right'), // W16, into Living Room
        door('N18-N19', 'single_swing', 2300, 900), // W22
        door('N19-N20', 'single_swing', 2400, 900), // W23
        door('N20-N13', 'single_swing', 700, 900), // W31
        door('N21-N11', 'single_swing', 600, 800), // W25
        door('N22-N23', 'single_swing', 650, 700), // W32
        door('N24-N25', 'single_swing', 600, 700), // W34
        door('N26-N10', 'single_swing', 650, 700), // W37
        gap('N17-N18', 800, 900), // W21
        door('N14-N15', 'sliding', 1800, 2400), // W14
        casement('N2-N3', 650, 600, VENT_HEIGHT, VENT_SILL), // W2
        casement('N3-N4', 900, 1200), // W3
        casement('N5-N6', 1200, 1500), // W5
        casement('N11-N12', 2050, 1500), // W11
        casement('N1-N2', 800, 900), // W1
        casement('N15-N16', 2050, 1800), // W15
    ],
    rooms: [
        ['Kitchen', 'kitchen', 800, 1650, 'tile'],
        ['Toilet 1', 'toilet', 2250, 950, 'tile'],
        ['Bedroom 1', 'bedroom', 3800, 2600, 'wood'],
        ['Toilet 2', 'toilet', 5300, 950, 'tile'],
        ['Bedroom 2', 'bedroom', 7000, 1650, 'wood'],
        ['Toilet 3', 'toilet', 10350, 650, 'tile'],
        ['Dress', 'dress', 9000, 2600, 'wood'],
        ['Living Room', 'living', 4000, 5350, 'tile'],
        ['Bedroom 3', 'bedroom', 9450, 5350, 'wood'],
        ['Balcony', 'balcony', 5900, 7850, 'tile'],
    ],
};

/**
 * Brochure 2BHK (912 sq.ft). The y = 3530 node row of the first sketch sits at
 * 3525 and A7-A6 is a 230 mm interior wall, so Bedroom 2's bottom face is
 * uniform (netRect non-null) and Bedroom 1 nets 3047.5 x 3352.5 (10'0" x 11'0").
 */
const BROCHURE_2BHK: PlanTable = {
    tag: 'bhk',
    nodes: [
        ['A1', 0, 0],
        ['A2', 3220, 0],
        ['A3', 6410, 0],
        ['A4', 9630, 0],
        ['A5', 9630, 3525],
        ['A6', 8010, 3525],
        ['A7', 6410, 3525],
        ['A8', 8010, 5880],
        ['A9', 6410, 5880],
        ['A10', 6410, 8120],
        ['A11', 3220, 8120],
        ['A12', 0, 8120],
        ['A13', 0, 5170],
        ['A14', 0, 3525],
        ['A15', 3220, 3525],
        ['A16', 3220, 1390],
        ['A17', 6410, 1390],
        ['A18', 2580, 3525],
        ['A19', 2580, 5170],
        ['A20', 3220, 5170],
    ],
    walls: [
        ext('A1', 'A2'),
        ext('A3', 'A4'),
        ext('A4', 'A5'),
        ext('A5', 'A6'),
        ext('A6', 'A8'),
        ext('A8', 'A9'),
        ext('A9', 'A10'),
        ext('A10', 'A11'),
        ext('A11', 'A12'),
        ext('A12', 'A13'),
        ext('A13', 'A14'),
        ext('A14', 'A1'),
        half('A2', 'A3'), // deck railing
        int('A2', 'A16'),
        int('A16', 'A15'),
        int('A3', 'A17'),
        int('A17', 'A7'),
        int('A16', 'A17'),
        int('A14', 'A18'),
        int('A18', 'A15'),
        ['A7', 'A6', 230, 'interior'],
        int('A7', 'A9'),
        int('A15', 'A20'),
        int('A20', 'A11'),
        int('A18', 'A19'),
        int('A13', 'A19'),
        int('A19', 'A20'),
    ],
    openings: [
        door('A10-A11', 'main_entrance', 1600, 1000, 'right'), // into Living/Dining
        door('A16-A15', 'single_swing', 1500, 800, 'right'), // into Bedroom 1
        door('A17-A7', 'single_swing', 1500, 800),
        door('A14-A18', 'single_swing', 1900, 700, 'right'), // into Toilet 1
        door('A7-A9', 'single_swing', 1200, 700),
        door('A16-A17', 'single_swing', 1595, 900),
        door('A19-A20', 'single_swing', 320, 500),
        gap('A20-A11', 1000, 900),
        casement('A1-A2', 1610, 1500),
        casement('A4-A5', 1765, 1500),
        casement('A12-A13', 1475, 1200),
        ventilator('A13-A14', 820, 600),
        ventilator('A6-A8', 1175, 600),
    ],
    rooms: [
        ['Bedroom 1', 'bedroom', 1600, 1800, 'wood'],
        ['Deck', 'deck', 4800, 700, 'tile'],
        ['Bedroom 2', 'bedroom', 8000, 1800, 'wood'],
        ['Toilet 1', 'toilet', 1300, 4350, 'tile'],
        ['W/M', 'utility', 2900, 4350, 'tile'],
        ['Kitchen', 'kitchen', 1600, 6650, 'tile'],
        ['Living/Dining', 'living', 4800, 4800, 'tile'],
        ['Toilet 2', 'toilet', 7200, 4700, 'tile'],
    ],
};

/** The HDB 3-room reference plan (fixed `hdb` ids; 37 walls, 16 openings, 10 rooms). */
export function buildHdb3Room(): PlanDocument {
    return buildFromTable(HDB_3ROOM);
}

/** The brochure 2BHK reference plan (fixed `bhk` ids; 27 walls, 13 openings, 8 rooms). */
export function buildBrochure2Bhk(): PlanDocument {
    return buildFromTable(BROCHURE_2BHK);
}
