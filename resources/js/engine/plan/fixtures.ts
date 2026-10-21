/**
 * Fixture library (05 §9): 35 entries of normative data, each with a default
 * size, a 2D symbol and a 3D primitive list in normalised fixture space.
 *
 * Normalised space: x in [-0.5, 0.5] across the width (left to right seen from
 * the front), y in [0, 1] from back (0) to front (1), z in [0, 1] up as a
 * fraction of the height. A few 3D parts (sink basin, hob burners, bathtub
 * water) deliberately rise slightly above z = 1. 2D coordinates never leave
 * the footprint.
 */

export const FIXTURE_KEYS = [
    'bed_single',
    'bed_double',
    'bed_queen',
    'bed_king',
    'bedside_table',
    'wardrobe_generic',
    'dresser',
    'sofa_2',
    'sofa_3',
    'sofa_l',
    'armchair',
    'coffee_table',
    'tv',
    'rug',
    'plant',
    'dining_table_4',
    'dining_table_6',
    'chair',
    'desk_generic',
    'office_chair',
    'kitchen_counter',
    'kitchen_counter_l',
    'sink',
    'hob',
    'fridge',
    'dishwasher',
    'wc',
    'basin',
    'shower',
    'bathtub',
    'washing_machine',
    'water_heater',
    'stairs_straight',
    'column',
    'car',
] as const;

export type FixtureKey = (typeof FIXTURE_KEYS)[number];

export type FixtureCategory =
    | 'bedroom'
    | 'living'
    | 'dining'
    | 'study'
    | 'kitchen'
    | 'bathroom'
    | 'utility'
    | 'structure'
    | 'outdoor';

export type FixtureMaterialKey =
    | 'wood'
    | 'fabric'
    | 'mattress'
    | 'pillow'
    | 'white'
    | 'ceramic'
    | 'metal'
    | 'dark'
    | 'stone'
    | 'glass'
    | 'plant'
    | 'rug'
    | 'paint'
    | 'water';

export type Fixture2DItem =
    | {
          t: 'rect';
          x0: number;
          x1: number;
          y0: number;
          y1: number;
          detail?: boolean;
          dashed?: boolean;
          fill?: string;
      }
    | {
          t: 'ellipse';
          cx: number;
          cy: number;
          rx: number;
          ry: number;
          detail?: boolean;
          /** Not in the 05 §9.1 type, but `water_heater` needs a dashed ellipse (05 §9.4). */
          dashed?: boolean;
      }
    | {
          t: 'line';
          x0: number;
          y0: number;
          x1: number;
          y1: number;
          detail?: boolean;
          dashed?: boolean;
      }
    | {
          t: 'polyline';
          pts: Array<[number, number]>;
          closed: boolean;
          detail?: boolean;
      };

export interface FixturePrimitive {
    shape: 'box' | 'cylinder' | 'sphere';
    x: [number, number];
    y: [number, number];
    z: [number, number];
    mat: FixtureMaterialKey;
}

export interface FixtureDef {
    key: FixtureKey;
    category: FixtureCategory;
    /** `plan_editor.fixtures.<key>` */
    nameKey: string;
    /** Default size and elevation in mm. */
    width: number;
    depth: number;
    height: number;
    elevation: number;
    /** Excluded from furniture/fixture conflict checks (04 §5.9). */
    noConflict: boolean;
    symbol2d(w: number, d: number): Fixture2DItem[];
    primitives3d(w: number, d: number, h: number): FixturePrimitive[];
}

// ---------------------------------------------------------------------------
// Builders: 2D notation R / E / L / P of 05 §9.4. Items after the first are
// detail items unless the spec says "outline style".
// ---------------------------------------------------------------------------

type Opts = { detail?: boolean; dashed?: boolean; fill?: string };

/** R(x0, x1, y0, y1) */
const R = (
    x0: number,
    x1: number,
    y0: number,
    y1: number,
    o: Opts = {},
): Fixture2DItem => ({ t: 'rect', x0, x1, y0, y1, ...o });

/** E(cx, cy, rx, ry) */
const E = (
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    o: Pick<Opts, 'detail' | 'dashed'> = {},
): Fixture2DItem => ({ t: 'ellipse', cx, cy, rx, ry, ...o });

/** L(x0, y0, x1, y1) */
const L = (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    o: Pick<Opts, 'detail' | 'dashed'> = {},
): Fixture2DItem => ({ t: 'line', x0, y0, x1, y1, ...o });

/** P[pts] */
const P = (
    pts: Array<[number, number]>,
    closed: boolean,
    o: Pick<Opts, 'detail'> = {},
): Fixture2DItem => ({ t: 'polyline', pts, closed, ...o });

/** Marks items as `detail` (style `fixture_detail`). */
const det = (...items: Fixture2DItem[]): Fixture2DItem[] =>
    items.map((i) => ({ ...i, detail: true }));

// 3D notation B / C / S: x0, x1, y0, y1, z0, z1, material.
const prim =
    (shape: FixturePrimitive['shape']) =>
    (
        x0: number,
        x1: number,
        y0: number,
        y1: number,
        z0: number,
        z1: number,
        mat: FixtureMaterialKey,
    ): FixturePrimitive => ({
        shape,
        x: [x0, x1],
        y: [y0, y1],
        z: [z0, z1],
        mat,
    });
const B = prim('box');
const C = prim('cylinder');
const S = prim('sphere');

/** Legs(t, z1, mat): four t x t mm boxes at the footprint corners, z 0 to z1. */
function legs(
    t: number,
    z1: number,
    mat: FixtureMaterialKey,
    w: number,
    d: number,
): FixturePrimitive[] {
    const tx = t / w;
    const ty = t / d;
    return [
        B(-0.5, -0.5 + tx, 0, ty, 0, z1, mat),
        B(0.5 - tx, 0.5, 0, ty, 0, z1, mat),
        B(-0.5, -0.5 + tx, 1 - ty, 1, 0, z1, mat),
        B(0.5 - tx, 0.5, 1 - ty, 1, 0, z1, mat),
    ];
}

type Builders = Pick<FixtureDef, 'symbol2d' | 'primitives3d'>;

function def(
    key: FixtureKey,
    category: FixtureCategory,
    size: [width: number, depth: number, height: number],
    elevation: number,
    builders: Builders,
    noConflict = false,
): FixtureDef {
    return {
        key,
        category,
        nameKey: `plan_editor.fixtures.${key}`,
        width: size[0],
        depth: size[1],
        height: size[2],
        elevation,
        noConflict,
        ...builders,
    };
}

/** A fixture drawn as a single block: one outline rect (plus optional details) and one box. */
function block(
    details: Fixture2DItem[],
    mat: FixtureMaterialKey,
    zRange: [number, number] = [0, 1],
): Builders {
    return {
        symbol2d: () => [R(-0.5, 0.5, 0, 1), ...details],
        primitives3d: () => [B(-0.5, 0.5, 0, 1, zRange[0], zRange[1], mat)],
    };
}

// ---------------------------------------------------------------------------
// Beds
// ---------------------------------------------------------------------------

function bed(pillows: Array<[number, number]>): Builders {
    return {
        symbol2d: () => [
            R(-0.5, 0.5, 0, 1),
            ...det(
                R(-0.5, 0.5, 0, 0.04),
                ...pillows.map(([a, b]) => R(a, b, 0.05, 0.16)),
                L(-0.5, 0.38, 0.5, 0.38),
            ),
        ],
        primitives3d: () => [
            B(-0.5, 0.5, 0.03, 1, 0, 0.28, 'wood'),
            B(-0.48, 0.48, 0.04, 0.99, 0.28, 0.5, 'mattress'),
            B(-0.5, 0.5, 0, 0.03, 0, 1, 'wood'),
            ...pillows.map(([a, b]) =>
                B(a, b, 0.05, 0.16, 0.5, 0.58, 'pillow'),
            ),
            B(-0.49, 0.49, 0.38, 0.99, 0.5, 0.52, 'fabric'),
        ],
    };
}

const SINGLE_PILLOW: Array<[number, number]> = [[-0.4, 0.4]];
const DOUBLE_PILLOWS: Array<[number, number]> = [
    [-0.45, -0.03],
    [0.03, 0.45],
];

// ---------------------------------------------------------------------------
// Sofas and armchair
// ---------------------------------------------------------------------------

function sofa(cushions: Array<[number, number]>): Builders {
    return {
        symbol2d: () => [
            R(-0.5, 0.5, 0, 1),
            ...det(
                R(-0.5, 0.5, 0, 0.22),
                R(-0.5, -0.38, 0.22, 1),
                R(0.38, 0.5, 0.22, 1),
                ...cushions.map(([a, b]) => R(a, b, 0.22, 0.95)),
            ),
        ],
        primitives3d: () => [
            B(-0.5, 0.5, 0, 0.22, 0, 1, 'fabric'),
            B(-0.5, -0.38, 0.22, 1, 0, 0.7, 'fabric'),
            B(0.38, 0.5, 0.22, 1, 0, 0.7, 'fabric'),
            B(-0.38, 0.38, 0.22, 0.98, 0, 0.5, 'fabric'),
        ],
    };
}

/** L-shaped sofa: arm depth `s` and back thickness `b` are absolute mm (05 §9.4). */
function sofaLDims(w: number, d: number) {
    const s = Math.min(900, 0.6 * Math.min(w, d));
    const b = 0.22 * s;
    return { sx: s / w, sy: s / d, bx: b / w, by: b / d };
}

const sofaL: Builders = {
    symbol2d: (w, d) => {
        const { sx, sy, bx, by } = sofaLDims(w, d);
        return [
            P(
                [
                    [-0.5, 0],
                    [0.5, 0],
                    [0.5, sy],
                    [-0.5 + sx, sy],
                    [-0.5 + sx, 1],
                    [-0.5, 1],
                ],
                true,
            ),
            ...det(
                R(-0.5, 0.5, 0, by),
                R(-0.5, -0.5 + bx, by, 1),
                R(-0.5 + bx, 0.5 - bx, by, sy),
                R(-0.5 + bx, -0.5 + sx, sy, 1),
                R(0.5 - bx, 0.5, by, sy),
            ),
        ];
    },
    primitives3d: (w, d) => {
        const { sx, sy, bx, by } = sofaLDims(w, d);
        return [
            B(-0.5, 0.5, 0, by, 0, 1, 'fabric'),
            B(-0.5, -0.5 + bx, by, 1, 0, 1, 'fabric'),
            B(-0.5 + bx, 0.5 - bx, by, sy, 0, 0.5, 'fabric'),
            B(-0.5 + bx, -0.5 + sx, sy, 1, 0, 0.5, 'fabric'),
            B(0.5 - bx, 0.5, by, sy, 0, 0.7, 'fabric'),
        ];
    },
};

const armchair: Builders = {
    symbol2d: () => [
        R(-0.5, 0.5, 0, 1),
        ...det(
            R(-0.5, 0.5, 0, 0.22),
            R(-0.5, -0.36, 0.22, 1),
            R(0.36, 0.5, 0.22, 1),
            R(-0.36, 0.36, 0.22, 0.95),
        ),
    ],
    primitives3d: () => [
        B(-0.5, 0.5, 0, 0.22, 0, 1, 'fabric'),
        B(-0.5, -0.36, 0.22, 1, 0, 0.7, 'fabric'),
        B(0.36, 0.5, 0.22, 1, 0, 0.7, 'fabric'),
        B(-0.36, 0.36, 0.22, 0.98, 0, 0.5, 'fabric'),
    ],
};

// ---------------------------------------------------------------------------
// Dining tables with chairs
// ---------------------------------------------------------------------------

const NEAR_CHAIR_Y: [number, number] = [0.03, 0.24];
const FAR_CHAIR_Y: [number, number] = [0.76, 0.97];

function diningTable(chairXs: Array<[number, number]>): Builders {
    return {
        symbol2d: () => [
            R(-0.5, 0.5, 0.265, 0.735),
            ...det(
                ...[NEAR_CHAIR_Y, FAR_CHAIR_Y].flatMap(([y0, y1]) =>
                    chairXs.map(([x0, x1]) => R(x0, x1, y0, y1)),
                ),
            ),
        ],
        primitives3d: (w, d) => {
            const lx = 60 / w;
            const ly = 60 / d;
            return [
                B(-0.5, 0.5, 0.265, 0.735, 0.8, 0.84, 'wood'),
                B(-0.5, -0.5 + lx, 0.265, 0.265 + ly, 0, 0.8, 'wood'),
                B(0.5 - lx, 0.5, 0.265, 0.265 + ly, 0, 0.8, 'wood'),
                B(-0.5, -0.5 + lx, 0.735 - ly, 0.735, 0, 0.8, 'wood'),
                B(0.5 - lx, 0.5, 0.735 - ly, 0.735, 0, 0.8, 'wood'),
                // chair seats
                ...[NEAR_CHAIR_Y, FAR_CHAIR_Y].flatMap(([y0, y1]) =>
                    chairXs.map(([x0, x1]) =>
                        B(x0, x1, y0, y1, 0, 0.5, 'wood'),
                    ),
                ),
                // chair backs, on the outer edge of each chair
                ...chairXs.map(([x0, x1]) =>
                    B(x0, x1, 0.03, 0.06, 0.5, 1, 'wood'),
                ),
                ...chairXs.map(([x0, x1]) =>
                    B(x0, x1, 0.94, 0.97, 0.5, 1, 'wood'),
                ),
            ];
        },
    };
}

// ---------------------------------------------------------------------------
// Kitchen
// ---------------------------------------------------------------------------

/** L-shaped counter: arm width `a` is absolute mm (05 §9.4). */
function counterLDims(w: number, d: number) {
    const a = Math.min(600, 0.45 * Math.min(w, d));
    return { ax: a / w, ay: a / d };
}

const kitchenCounterL: Builders = {
    symbol2d: (w, d) => {
        const { ax, ay } = counterLDims(w, d);
        return [
            P(
                [
                    [-0.5, 0],
                    [0.5, 0],
                    [0.5, ay],
                    [-0.5 + ax, ay],
                    [-0.5 + ax, 1],
                    [-0.5, 1],
                ],
                true,
            ),
            P(
                [
                    [0.5, ay - 50 / d],
                    [-0.5 + ax - 50 / w, ay - 50 / d],
                    [-0.5 + ax - 50 / w, 1],
                ],
                false,
                { detail: true },
            ),
        ];
    },
    primitives3d: (w, d) => {
        const { ax, ay } = counterLDims(w, d);
        return [
            B(-0.5, 0.5, 0, ay, 0, 0.95, 'white'),
            B(-0.5, -0.5 + ax, ay, 1, 0, 0.95, 'white'),
            B(-0.5, 0.5, 0, ay, 0.95, 1, 'stone'),
            B(-0.5, -0.5 + ax, ay, 1, 0.95, 1, 'stone'),
        ];
    },
};

const HOB_BURNERS: Array<[number, number, number, number]> = [
    [-0.22, 0.27, 0.13, 0.15],
    [0.22, 0.27, 0.13, 0.15],
    [-0.22, 0.73, 0.13, 0.15],
    [0.22, 0.73, 0.13, 0.15],
];

const hob: Builders = {
    symbol2d: () => [
        R(-0.5, 0.5, 0, 1),
        ...HOB_BURNERS.map(([cx, cy, rx, ry]) =>
            E(cx, cy, rx, ry, { detail: true }),
        ),
    ],
    primitives3d: () => [
        B(-0.5, 0.5, 0, 1, 0, 1, 'dark'),
        ...HOB_BURNERS.map(([cx, cy, rx, ry]) =>
            C(cx - rx, cx + rx, cy - ry, cy + ry, 1, 1.5, 'metal'),
        ),
    ],
};

// ---------------------------------------------------------------------------
// Stairs
// ---------------------------------------------------------------------------

const STAIR_STEPS = 12;

const stairs: Builders = {
    symbol2d: () => [
        R(-0.5, 0.5, 0, 1),
        ...det(
            ...Array.from({ length: STAIR_STEPS - 1 }, (_, k) => {
                const y = (k + 1) / STAIR_STEPS;
                return L(-0.5, y, 0.5, y);
            }),
            P(
                [
                    [0, 0.95],
                    [0, 0.08],
                ],
                false,
            ),
            P(
                [
                    [-0.12, 0.2],
                    [0, 0.08],
                    [0.12, 0.2],
                ],
                false,
            ),
        ),
    ],
    primitives3d: () =>
        Array.from({ length: STAIR_STEPS }, (_, i) =>
            B(
                -0.5,
                0.5,
                1 - (i + 1) / STAIR_STEPS,
                1 - i / STAIR_STEPS,
                0,
                (i + 1) / STAIR_STEPS,
                'wood',
            ),
        ),
};

// ---------------------------------------------------------------------------
// The library, in 05 §9.4 table order
// ---------------------------------------------------------------------------

const DEFS: FixtureDef[] = [
    def('bed_single', 'bedroom', [900, 1900, 900], 0, bed(SINGLE_PILLOW)),
    def('bed_double', 'bedroom', [1400, 1900, 900], 0, bed(DOUBLE_PILLOWS)),
    def('bed_queen', 'bedroom', [1500, 2000, 900], 0, bed(DOUBLE_PILLOWS)),
    def('bed_king', 'bedroom', [1800, 2000, 900], 0, bed(DOUBLE_PILLOWS)),
    def(
        'bedside_table',
        'bedroom',
        [450, 400, 550],
        0,
        block([...det(L(-0.5, 0.3, 0.5, 0.3))], 'wood'),
    ),
    def(
        'wardrobe_generic',
        'bedroom',
        [1200, 600, 2100],
        0,
        block(
            [
                L(-0.45, 0.5, 0.45, 0.5, { detail: true, dashed: true }), // rod
                ...det(L(0, 0.93, 0, 1)),
            ],
            'wood',
        ),
    ),
    def(
        'dresser',
        'bedroom',
        [1000, 450, 800],
        0,
        block([...det(L(-0.5, 0.85, 0.5, 0.85))], 'wood'),
    ),

    def(
        'sofa_2',
        'living',
        [1500, 850, 800],
        0,
        sofa([
            [-0.38, 0],
            [0, 0.38],
        ]),
    ),
    def(
        'sofa_3',
        'living',
        [2100, 900, 800],
        0,
        sofa([
            [-0.38, -0.127],
            [-0.127, 0.127],
            [0.127, 0.38],
        ]),
    ),
    def('sofa_l', 'living', [2400, 1600, 800], 0, sofaL),
    def('armchair', 'living', [800, 800, 800], 0, armchair),
    def('coffee_table', 'living', [1000, 550, 420], 0, {
        symbol2d: () => [R(-0.5, 0.5, 0, 1)],
        primitives3d: (w, d) => [
            B(-0.5, 0.5, 0, 1, 0.9, 1, 'wood'),
            ...legs(50, 0.9, 'wood', w, d),
        ],
    }),
    def(
        'tv',
        'living',
        [1200, 80, 700],
        900,
        block([...det(L(-0.5, 1, 0.5, 1))], 'dark'), // screen side
    ),
    def(
        'rug',
        'living',
        [2000, 1400, 10],
        0,
        block(
            [R(-0.46, 0.46, 0.06, 0.94, { detail: true, dashed: true })],
            'rug',
        ),
        true,
    ),
    def('plant', 'living', [450, 450, 1200], 0, {
        symbol2d: () => [E(0, 0.5, 0.5, 0.5), ...det(E(0, 0.5, 0.22, 0.22))],
        primitives3d: () => [
            C(-0.25, 0.25, 0.25, 0.75, 0, 0.35, 'dark'),
            S(-0.5, 0.5, 0, 1, 0.3, 1, 'plant'),
        ],
    }),

    // Table top at 750 mm; chairs are included in the footprint.
    def(
        'dining_table_4',
        'dining',
        [1200, 1700, 900],
        0,
        diningTable([
            [-0.35, -0.05],
            [0.05, 0.35],
        ]),
    ),
    def(
        'dining_table_6',
        'dining',
        [1800, 1700, 900],
        0,
        diningTable([
            [-0.42, -0.2],
            [-0.11, 0.11],
            [0.2, 0.42],
        ]),
    ),
    def('chair', 'dining', [450, 500, 900], 0, {
        symbol2d: () => [R(-0.5, 0.5, 0.12, 1), ...det(R(-0.5, 0.5, 0, 0.12))],
        primitives3d: () => [
            B(-0.5, 0.5, 0.1, 1, 0, 0.5, 'wood'),
            B(-0.5, 0.5, 0, 0.1, 0, 1, 'wood'),
        ],
    }),

    def('desk_generic', 'study', [1200, 600, 750], 0, {
        symbol2d: () => [R(-0.5, 0.5, 0, 1)],
        primitives3d: () => [
            B(-0.5, 0.5, 0, 1, 0.95, 1, 'wood'),
            B(-0.5, -0.47, 0, 1, 0, 0.95, 'wood'),
            B(0.47, 0.5, 0, 1, 0, 0.95, 'wood'),
        ],
    }),
    def('office_chair', 'study', [600, 600, 1000], 0, {
        symbol2d: () => [
            E(0, 0.55, 0.45, 0.42),
            ...det(R(-0.35, 0.35, 0.02, 0.14)),
        ],
        primitives3d: () => [
            C(-0.08, 0.08, 0.47, 0.63, 0, 0.45, 'metal'),
            C(-0.45, 0.45, 0.15, 0.95, 0.45, 0.52, 'fabric'),
            B(-0.35, 0.35, 0.02, 0.12, 0.55, 1, 'fabric'),
        ],
    }),

    def('kitchen_counter', 'kitchen', [2400, 600, 900], 0, {
        symbol2d: () => [R(-0.5, 0.5, 0, 1), ...det(L(-0.5, 0.92, 0.5, 0.92))],
        primitives3d: () => [
            B(-0.5, 0.5, 0, 0.95, 0, 0.95, 'white'),
            B(-0.5, 0.5, 0, 1, 0.95, 1, 'stone'),
        ],
    }),
    def('kitchen_counter_l', 'kitchen', [2400, 1800, 900], 0, kitchenCounterL),
    def(
        'sink',
        'kitchen',
        [800, 500, 50],
        850,
        {
            symbol2d: () => [
                R(-0.5, 0.5, 0, 1),
                ...det(R(-0.42, 0.42, 0.12, 0.88), E(0, 0.07, 0.04, 0.04)),
            ],
            primitives3d: () => [
                B(-0.5, 0.5, 0, 1, 0, 1, 'metal'),
                B(-0.42, 0.42, 0.12, 0.88, 0.6, 1.02, 'dark'),
            ],
        },
        true,
    ),
    def('hob', 'kitchen', [600, 520, 20], 900, hob, true),
    def(
        'fridge',
        'kitchen',
        [700, 700, 1800],
        0,
        block([...det(L(-0.5, 0.93, 0.5, 0.93))], 'white'),
    ),
    def(
        'dishwasher',
        'kitchen',
        [600, 600, 850],
        0,
        block([...det(L(-0.5, 0.93, 0.5, 0.93))], 'white'),
    ),

    def('wc', 'bathroom', [380, 700, 780], 0, {
        symbol2d: () => [R(-0.5, 0.5, 0, 0.25), E(0, 0.62, 0.45, 0.36)],
        primitives3d: () => [
            B(-0.5, 0.5, 0, 0.25, 0.45, 1, 'ceramic'),
            C(-0.45, 0.45, 0.25, 0.98, 0, 0.52, 'ceramic'),
        ],
    }),
    def('basin', 'bathroom', [550, 450, 850], 0, {
        symbol2d: () => [
            R(-0.5, 0.5, 0, 0.1),
            E(0, 0.55, 0.45, 0.4),
            ...det(E(0, 0.55, 0.3, 0.26)),
        ],
        primitives3d: () => [
            C(-0.45, 0.45, 0.1, 0.95, 0.82, 1, 'ceramic'),
            C(-0.12, 0.12, 0.3, 0.6, 0, 0.82, 'ceramic'),
        ],
    }),
    def('shower', 'bathroom', [900, 900, 2000], 0, {
        symbol2d: () => [
            R(-0.5, 0.5, 0, 1),
            ...det(
                L(-0.5, 0, 0.5, 1),
                L(0.5, 0, -0.5, 1),
                E(0, 0.5, 0.04, 0.04),
            ),
        ],
        primitives3d: () => [
            B(-0.5, 0.5, 0, 1, 0, 0.015, 'ceramic'),
            B(-0.5, 0.5, 0.99, 1, 0.015, 1, 'glass'),
            B(0.49, 0.5, 0, 0.99, 0.015, 1, 'glass'),
        ],
    }),
    def('bathtub', 'bathroom', [1700, 750, 550], 0, {
        symbol2d: () => [R(-0.5, 0.5, 0, 1), ...det(E(0, 0.5, 0.44, 0.38))],
        primitives3d: () => [
            B(-0.5, 0.5, 0, 1, 0, 1, 'ceramic'),
            B(-0.44, 0.44, 0.12, 0.88, 0.92, 1.005, 'water'),
        ],
    }),

    def(
        'washing_machine',
        'utility',
        [600, 600, 850],
        0,
        block([...det(E(0, 0.6, 0.3, 0.3))], 'white'),
    ),
    // Wall-mounted.
    def('water_heater', 'utility', [450, 450, 700], 1600, {
        symbol2d: () => [E(0, 0.5, 0.5, 0.5, { dashed: true })],
        primitives3d: () => [C(-0.5, 0.5, 0, 1, 0, 1, 'white')],
    }),

    // Height is floor-to-floor.
    def('stairs_straight', 'structure', [1000, 3000, 3000], 0, stairs),
    def('column', 'structure', [300, 300, 2700], 0, {
        symbol2d: () => [R(-0.5, 0.5, 0, 1, { fill: '#3B3B3B' })],
        primitives3d: () => [B(-0.5, 0.5, 0, 1, 0, 1, 'paint')],
    }),

    def('car', 'outdoor', [1800, 4500, 1500], 0, {
        symbol2d: () => [
            R(-0.5, 0.5, 0, 1),
            ...det(R(-0.42, 0.42, 0.28, 0.62), L(-0.42, 0.36, 0.42, 0.36)),
        ],
        primitives3d: () => [
            B(-0.5, 0.5, 0, 1, 0.12, 0.5, 'metal'),
            B(-0.42, 0.42, 0.28, 0.65, 0.5, 1, 'glass'),
            C(-0.5, -0.42, 0.12, 0.25, 0, 0.25, 'dark'),
            C(0.42, 0.5, 0.12, 0.25, 0, 0.25, 'dark'),
            C(-0.5, -0.42, 0.75, 0.88, 0, 0.25, 'dark'),
            C(0.42, 0.5, 0.75, 0.88, 0, 0.25, 'dark'),
        ],
    }),
];

export const FIXTURE_LIBRARY = Object.fromEntries(
    DEFS.map((d) => [d.key, d]),
) as Record<FixtureKey, FixtureDef>;
