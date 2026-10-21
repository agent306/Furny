/**
 * Property test of the command invariants (04 §6.8): random command
 * sequences drawn from every plan command, with random in-range params, on
 * `makeGridPlan(3, 3)`. After every successful command the set of
 * `validatePlan` errors may only shrink, the document still parses as a
 * plan, and the history stays within 200 entries; undoing a whole sequence
 * restores the start document exactly. A refusal is fine: only successful
 * commands are checked. About 10 % of the ids are unknown, to exercise
 * `not_found`.
 */
import { describe, expect, it } from 'vitest';
import { testIds } from '../../../testing/ids';
import { mulberry32 } from '../../../testing/random';
import { derivePlanGeometry } from '../../derive';
import { FIXTURE_KEYS } from '../../fixtures';
import { ROOM_TYPES } from '../../roomTypes';
import {
    DOOR_TYPES,
    FLOOR_FINISHES,
    PlanDocumentSchema,
    WALL_KINDS,
    WALL_MATERIALS,
    WINDOW_TYPES,
} from '../../schema';
import type { PlanDocument } from '../../schema';
import { makeGridPlan } from '../../testing/fixtures';
import { planBus } from '../../testing/graph';
import { planErrorKeys, validatePlan } from '../../validate';
import type { PlanFragment } from '../fragment';
import { PLAN_COMMANDS, type PlanCommandType } from '../registry';

const SEED = 1234;
const SEQUENCES = 500;
const MAX_LENGTH = 8;
const HISTORY_CAP = 200;
const MAX_COORD = 1_000_000;
/** Fewest document-changing successes every command must have in the random phase. */
const MIN_CHANGES = 5;

// ---- random values -------------------------------------------------------------

class Rand {
    private readonly next: () => number;

    constructor(seed: number) {
        this.next = mulberry32(seed);
    }

    real(lo: number, hi: number): number {
        return lo + this.next() * (hi - lo);
    }

    /** An integer in `[lo, hi]`. */
    int(lo: number, hi: number): number {
        return lo + Math.floor(this.next() * (hi - lo + 1));
    }

    chance(p: number): boolean {
        return this.next() < p;
    }

    pick<T>(items: readonly T[]): T {
        return items[Math.floor(this.next() * items.length)]!;
    }

    /** A whole or fractional millimetre value in `[lo, hi]`. */
    mm(lo: number, hi: number): number {
        const v = this.real(lo, hi);
        return this.chance(0.7) ? Math.round(v) : Math.round(v * 10) / 10;
    }

    /** Usually on or around the 9 m grid, sometimes anywhere in range. */
    coord(): number {
        return this.chance(0.9)
            ? this.mm(-1500, 10_500)
            : this.mm(-MAX_COORD, MAX_COORD);
    }

    point(): { x: number; y: number } {
        return { x: this.coord(), y: this.coord() };
    }

    near(p: { x: number; y: number }, spread: number) {
        return {
            x: Math.round(p.x + this.real(-spread, spread)),
            y: Math.round(p.y + this.real(-spread, spread)),
        };
    }

    /** `undefined` (the key left out) or the value. */
    maybe<T>(make: () => T, p = 0.5): T | undefined {
        return this.chance(p) ? make() : undefined;
    }

    /** A random subset (at least one) of `items`, at most `max` long. */
    some<T>(items: readonly T[], max: number): T[] {
        if (items.length === 0) return [];
        const count = this.int(1, Math.min(max, items.length));
        const pool = [...items];
        const out: T[] = [];
        while (out.length < count) {
            out.push(pool.splice(this.int(0, pool.length - 1), 1)[0]!);
        }
        return out;
    }

    text(lo: number, hi: number): string {
        const glyphs = ['a', 'B', ' ', '7', 'é', '😀', 'Ж', '-'];
        let s = '';
        const n = this.int(lo, hi);
        for (let i = 0; i < n; i += 1) s += this.pick(glyphs);
        return s;
    }

    colour(): string {
        return `#${this.int(0, 0xffffff).toString(16).padStart(6, '0')}`;
    }
}

/** Keeps undefined-valued keys out, so a param left out is really absent. */
function defined<T extends Record<string, unknown>>(o: T): Partial<T> {
    return Object.fromEntries(
        Object.entries(o).filter(([, v]) => v !== undefined),
    ) as Partial<T>;
}

// ---- ids ----------------------------------------------------------------------

const unknownId = (prefix: string): string => `${prefix}_zzzzzzzzzz`;

/** An id of `record`, or (10 %, or when it is empty) an unknown one. */
function idOf(r: Rand, record: object, prefix: string): string {
    const ids = Object.keys(record).sort();
    return ids.length === 0 || r.chance(0.1) ? unknownId(prefix) : r.pick(ids);
}

function idsOf(r: Rand, record: object, prefix: string, max = 3): string[] {
    const ids = Object.keys(record).sort();
    if (ids.length === 0 || r.chance(0.1)) {
        return [...r.some(ids, max), unknownId(prefix)];
    }
    return r.some(ids, max);
}

/** Every entity id of the document, `'background'` included when there is one. */
function allIds(doc: PlanDocument): string[] {
    return [
        ...Object.keys(doc.nodes),
        ...Object.keys(doc.walls),
        ...Object.keys(doc.openings),
        ...Object.keys(doc.rooms),
        ...Object.keys(doc.placements),
        ...Object.keys(doc.fixtures),
        ...Object.keys(doc.annotations.dimensions),
        ...Object.keys(doc.annotations.labels),
        ...(doc.background === null ? [] : ['background']),
    ].sort();
}

function selection(r: Rand, doc: PlanDocument): string[] {
    const ids = r.some(allIds(doc), 4);
    if (r.chance(0.1)) ids.push(unknownId(r.pick(['w', 'n', 'f'])));
    return ids;
}

const lengthOf = (doc: PlanDocument, wallId: string): number => {
    const w = doc.walls[wallId];
    const a = w && doc.nodes[w.a];
    const b = w && doc.nodes[w.b];
    return a && b ? Math.hypot(b.x - a.x, b.y - a.y) : 3000;
};

const nodeAt = (doc: PlanDocument, id: string) =>
    doc.nodes[id] ?? { x: 4500, y: 4500 };

// ---- params per command ---------------------------------------------------------------

type Gen = (doc: PlanDocument, r: Rand) => unknown;

const endpoint = (doc: PlanDocument, r: Rand) =>
    r.chance(0.4)
        ? { nodeId: idOf(r, doc.nodes, 'n') }
        : { point: r.chance(0.5) ? r.point() : r.near(r.point(), 0) };

const wallFields = (r: Rand) =>
    defined({
        thickness: r.maybe(() => r.mm(50, 1000), 0.3),
        height: r.maybe(() => r.mm(300, 10_000), 0.3),
        kind: r.maybe(() => r.pick(WALL_KINDS), 0.3),
        material: r.maybe(() => r.pick(WALL_MATERIALS), 0.3),
    });

const openingType = (r: Rand) =>
    r.pick([...DOOR_TYPES, ...WINDOW_TYPES, 'opening'] as const);

const attachment = (doc: PlanDocument, r: Rand) => ({
    wallId: idOf(r, doc.walls, 'w'),
    side: r.pick(['left', 'right'] as const),
});

const dimensionAttachment = (doc: PlanDocument, r: Rand) => ({
    kind: 'wall' as const,
    wallId: idOf(r, doc.walls, 'w'),
    face: r.pick(['left', 'right', 'center'] as const),
});

function fragmentOf(doc: PlanDocument, r: Rand): PlanFragment {
    const pickSome = <T extends object>(
        record: Record<string, T>,
        max: number,
    ): Record<string, T> => {
        const keys = Object.keys(record).sort();
        if (keys.length === 0 || r.chance(0.3)) return {};
        return Object.fromEntries(
            r.some(keys, max).map((k) => [k, record[k]!]),
        );
    };
    const walls = pickSome(doc.walls, 4);
    const nodes: PlanFragment['nodes'] = {};
    for (const wall of Object.values(walls)) {
        for (const id of [wall.a, wall.b]) {
            if (doc.nodes[id]) nodes[id] = doc.nodes[id];
        }
    }
    const openings = Object.fromEntries(
        Object.entries(doc.openings).filter(([, o]) => o.wallId in walls),
    );
    return {
        nodes,
        walls,
        openings,
        placements: pickSome(doc.placements, 2),
        fixtures: pickSome(doc.fixtures, 2),
        dimensions: pickSome(doc.annotations.dimensions, 2),
        labels: pickSome(doc.annotations.labels, 2),
        rooms: pickSome(doc.rooms, 1),
    };
}

/** Nodes joining exactly two walls that run straight on (what `mergeCollinearWalls` merges at). */
function straightNodes(doc: PlanDocument): string[] {
    const at = new Map<string, string[]>();
    for (const w of Object.values(doc.walls)) {
        for (const id of [w.a, w.b]) at.set(id, [...(at.get(id) ?? []), w.id]);
    }
    const out: string[] = [];
    for (const [nodeId, wallIds] of at) {
        if (wallIds.length !== 2 || !doc.nodes[nodeId]) continue;
        const dirs = wallIds.map((id) => {
            const w = doc.walls[id]!;
            const far = doc.nodes[w.a === nodeId ? w.b : w.a];
            const here = doc.nodes[nodeId]!;
            return far ? { x: far.x - here.x, y: far.y - here.y } : null;
        });
        const [p, q] = dirs;
        if (!p || !q) continue;
        const cos =
            (p.x * q.x + p.y * q.y) /
            (Math.hypot(p.x, p.y) * Math.hypot(q.x, q.y));
        if (cos < -0.9999) out.push(nodeId);
    }
    return out.sort();
}

/**
 * Setup steps every sequence starts with (inside the invariant, like any
 * other step): something for every entity command to act on, and a split
 * wall for `mergeCollinearWalls`. The bus' footprint provider knows every
 * design id.
 */
const SETUP: Array<[PlanCommandType, Gen]> = [
    [
        'setBackground',
        (_doc, r) => ({
            background: {
                importId: null,
                mediaUuid: 'media-1',
                pixelWidth: r.int(500, 3000),
                pixelHeight: r.int(500, 3000),
                mmPerPixel: r.real(2, 10),
                position: { x: r.mm(-2000, 0), y: r.mm(-2000, 0) },
                rotation: 0,
                opacity: 0.5,
                visible: true,
                locked: false,
            },
        }),
    ],
    [
        'addPlacement',
        (_doc, r) => ({
            designId: 'des_x',
            x: r.mm(500, 8500),
            y: r.mm(500, 8500),
            rotation: r.real(0, 360),
        }),
    ],
    [
        'addPlacement',
        (doc, r) => ({
            designId: 'des_y',
            x: r.mm(500, 8500),
            y: r.mm(500, 8500),
            rotation: 0,
            wallAttachment: {
                wallId: r.pick(Object.keys(doc.walls).sort()),
                side: r.pick(['left', 'right'] as const),
            },
        }),
    ],
    [
        'addFixture',
        (_doc, r) => ({
            libraryKey: r.pick(FIXTURE_KEYS),
            x: r.mm(500, 8500),
            y: r.mm(500, 8500),
        }),
    ],
    [
        'addDimension',
        (_doc, r) => {
            const a = { x: r.mm(0, 9000), y: r.mm(-1500, -500) };
            return {
                a,
                b: { x: a.x + r.mm(500, 3000), y: a.y },
                offset: r.mm(-1000, 1000),
                attachedTo: null,
            };
        },
    ],
    [
        'addDimension',
        (doc, r) => ({
            a: { x: 0, y: 0 },
            b: { x: 1000, y: 0 },
            offset: 300,
            attachedTo: {
                kind: 'wall',
                wallId: r.pick(Object.keys(doc.walls).sort()),
                face: r.pick(['left', 'right', 'center'] as const),
            },
        }),
    ],
    [
        'addLabel',
        (_doc, r) => ({
            position: { x: r.mm(0, 9000), y: r.mm(0, 9000) },
            text: r.text(1, 30).trim() || 'Room',
        }),
    ],
    [
        'setRoomMeta',
        (doc, r) => ({
            faceKey: r.pick(derivePlanGeometry(doc).rooms).faceKey,
            props: { name: r.text(1, 20) },
        }),
    ],
    [
        'splitWall',
        (doc, r) => {
            const wallId = r.pick(Object.keys(doc.walls).sort());
            const length = lengthOf(doc, wallId);
            // clear of the door centred on the first interior walls
            return { wallId, at: r.chance(0.5) ? 500 : length - 500 };
        },
    ],
];

const GENERATORS: Record<PlanCommandType, Gen> = {
    addWall: (doc, r) => ({
        from: endpoint(doc, r),
        to: endpoint(doc, r),
        ...wallFields(r),
    }),
    addWallChain: (doc, r) => {
        const closed = r.chance(0.5);
        const points = Array.from({ length: r.int(closed ? 3 : 2, 5) }, () =>
            endpoint(doc, r),
        );
        return { points, closed, ...wallFields(r) };
    },
    splitWall: (doc, r) => {
        const wallId = idOf(r, doc.walls, 'w');
        return { wallId, at: r.mm(0, lengthOf(doc, wallId)) };
    },
    mergeCollinearWalls: (doc, r) => {
        const straight = straightNodes(doc);
        return {
            nodeId:
                straight.length > 0 && r.chance(0.9)
                    ? r.pick(straight)
                    : idOf(r, doc.nodes, 'n'),
        };
    },
    deleteWalls: (doc, r) => ({ wallIds: idsOf(r, doc.walls, 'w') }),
    deleteNode: (doc, r) => ({ nodeId: idOf(r, doc.nodes, 'n') }),
    setWallProps: (doc, r) => ({
        wallIds: idsOf(r, doc.walls, 'w'),
        props: defined({
            ...wallFields(r),
            colorHex: r.maybe(() => (r.chance(0.2) ? null : r.colour()), 0.3),
        }),
    }),
    moveNode: (doc, r) => {
        const nodeId = idOf(r, doc.nodes, 'n');
        return {
            nodeId,
            to: r.chance(0.8) ? r.near(nodeAt(doc, nodeId), 2000) : r.point(),
            finalize: r.chance(0.5),
        };
    },
    moveWall: (doc, r) => ({
        wallId: idOf(r, doc.walls, 'w'),
        distance: r.mm(-3000, 3000),
        finalize: r.chance(0.5),
    }),
    setWallLength: (doc, r) => ({
        wallId: idOf(r, doc.walls, 'w'),
        length: r.mm(10, 8000),
        anchor: r.pick(['a', 'b', 'auto'] as const),
    }),
    addOpening: (doc, r) => {
        const wallId = idOf(r, doc.walls, 'w');
        return defined({
            wallId,
            kind: r.pick(['door', 'window', 'opening'] as const),
            type: r.maybe(() => openingType(r), 0.3),
            offset: r.mm(0, lengthOf(doc, wallId)),
            width: r.maybe(() => r.mm(300, 2000)),
            height: r.maybe(() => r.mm(300, 2500), 0.3),
            sillHeight: r.maybe(() => r.mm(0, 1500), 0.3),
            hinge: r.maybe(() => r.pick(['start', 'end'] as const), 0.3),
            swing: r.maybe(() => r.pick(['left', 'right'] as const), 0.3),
            label: r.maybe(() => (r.chance(0.3) ? null : r.text(1, 16)), 0.3),
        });
    },
    moveOpening: (doc, r) => {
        const openingId = idOf(r, doc.openings, 'o');
        const wallId = r.maybe(() => idOf(r, doc.walls, 'w'), 0.3);
        const on = wallId ?? doc.openings[openingId]?.wallId ?? '';
        return defined({
            openingId,
            wallId,
            offset: r.mm(0, lengthOf(doc, on)),
        });
    },
    resizeOpening: (doc, r) =>
        defined({
            openingId: idOf(r, doc.openings, 'o'),
            width: r.maybe(() => r.mm(300, 2500)),
            height: r.maybe(() => r.mm(300, 2600), 0.3),
            sillHeight: r.maybe(() => r.mm(0, 1500), 0.3),
            keep: r.pick(['center', 'start', 'end'] as const),
        }),
    setOpeningProps: (doc, r) => ({
        openingIds: idsOf(r, doc.openings, 'o'),
        props: defined({
            kind: r.maybe(
                () => r.pick(['door', 'window', 'opening'] as const),
                0.3,
            ),
            type: r.maybe(() => openingType(r), 0.3),
            height: r.maybe(() => r.mm(300, 2600), 0.3),
            sillHeight: r.maybe(() => r.mm(0, 1500), 0.3),
            hinge: r.maybe(() => r.pick(['start', 'end'] as const), 0.3),
            swing: r.maybe(() => r.pick(['left', 'right'] as const), 0.3),
            label: r.maybe(() => (r.chance(0.3) ? null : r.text(1, 16)), 0.3),
        }),
    }),
    flipOpening: (doc, r) => ({
        openingIds: idsOf(r, doc.openings, 'o'),
        what: r.pick(['swing', 'hinge', 'both'] as const),
    }),
    deleteOpenings: (doc, r) => ({ openingIds: idsOf(r, doc.openings, 'o') }),
    setRoomMeta: (doc, r) => {
        const rooms = derivePlanGeometry(doc).rooms;
        const faceKey =
            rooms.length === 0 || r.chance(0.1)
                ? 'fk_unknown'
                : r.pick(rooms).faceKey;
        return {
            faceKey,
            props: defined({
                name: r.maybe(() => r.text(0, 80)),
                type: r.maybe(() => r.pick(ROOM_TYPES), 0.3),
                floorFinish: r.maybe(() => r.pick(FLOOR_FINISHES), 0.3),
                floorColorHex: r.maybe(
                    () => (r.chance(0.3) ? null : r.colour()),
                    0.3,
                ),
                labelOffset: r.maybe(
                    () =>
                        r.chance(0.3)
                            ? null
                            : { x: r.mm(-1500, 1500), y: r.mm(-1500, 1500) },
                    0.3,
                ),
                showArea: r.maybe(() => r.chance(0.5), 0.3),
            }),
        };
    },
    deleteRoomMeta: (doc, r) => ({ metaId: idOf(r, doc.rooms, 'r') }),
    addPlacement: (doc, r) =>
        defined({
            designId: 'des_x',
            x: r.coord(),
            y: r.coord(),
            rotation: r.real(-720, 720),
            elevation: r.maybe(() => r.mm(0, 10_000), 0.3),
            mirrored: r.maybe(() => r.chance(0.5), 0.3),
            wallAttachment: r.maybe(
                () => (r.chance(0.3) ? null : attachment(doc, r)),
                0.3,
            ),
        }),
    movePlacement: (doc, r) =>
        defined({
            placementId: idOf(r, doc.placements, 'f'),
            x: r.coord(),
            y: r.coord(),
            rotation: r.maybe(() => r.real(0, 360), 0.3),
            wallAttachment: r.chance(0.5) ? null : attachment(doc, r),
        }),
    rotatePlacement: (doc, r) => ({
        placementId: idOf(r, doc.placements, 'f'),
        rotation: r.real(-360, 720),
        pivot: r.pick(['center', 'back_center'] as const),
    }),
    setPlacementProps: (doc, r) => {
        const placementIds = idsOf(r, doc.placements, 'f');
        const first = doc.placements[placementIds[0]!];
        return {
            placementIds,
            props: r.chance(0.5)
                ? { mirrored: !(first?.mirrored ?? false) }
                : defined({
                      elevation: r.mm(0, 10_000),
                      mirrored: r.maybe(() => r.chance(0.5)),
                  }),
        };
    },
    deletePlacements: (doc, r) => ({
        placementIds: idsOf(r, doc.placements, 'f'),
    }),
    addFixture: (_doc, r) =>
        defined({
            libraryKey: r.pick(FIXTURE_KEYS),
            x: r.coord(),
            y: r.coord(),
            rotation: r.maybe(() => r.real(0, 360), 0.3),
            width: r.maybe(() => r.mm(50, 20_000), 0.3),
            depth: r.maybe(() => r.mm(50, 20_000), 0.3),
            height: r.maybe(() => r.mm(0, 10_000), 0.3),
            elevation: r.maybe(() => r.mm(0, 10_000), 0.3),
            label: r.maybe(() => (r.chance(0.3) ? null : r.text(1, 200)), 0.3),
        }),
    moveFixture: (doc, r) =>
        defined({
            fixtureId: idOf(r, doc.fixtures, 'x'),
            x: r.coord(),
            y: r.coord(),
            rotation: r.maybe(() => r.real(0, 360), 0.3),
        }),
    setFixtureProps: (doc, r) =>
        defined({
            fixtureIds: idsOf(r, doc.fixtures, 'x'),
            props: defined({
                libraryKey: r.maybe(() => r.pick(FIXTURE_KEYS), 0.3),
                width: r.maybe(() => r.mm(50, 20_000), 0.3),
                depth: r.maybe(() => r.mm(50, 20_000), 0.3),
                height: r.maybe(() => r.mm(0, 10_000), 0.3),
                elevation: r.maybe(() => r.mm(0, 10_000), 0.3),
                rotation: r.maybe(() => r.real(0, 360), 0.3),
                label: r.maybe(
                    () => (r.chance(0.3) ? null : r.text(1, 200)),
                    0.3,
                ),
            }),
            keep: r.maybe(() =>
                r.pick([
                    'center',
                    'back_left',
                    'back_right',
                    'front_left',
                    'front_right',
                ] as const),
            ),
        }),
    deleteFixtures: (doc, r) => ({ fixtureIds: idsOf(r, doc.fixtures, 'x') }),
    addDimension: (doc, r) => {
        const a = r.point();
        return {
            a,
            b: r.chance(0.7) ? r.near(a, 5000) : r.point(),
            offset: r.mm(-50_000, 50_000),
            attachedTo: r.chance(0.5) ? null : dimensionAttachment(doc, r),
        };
    },
    setDimension: (doc, r) =>
        defined({
            dimensionId: idOf(r, doc.annotations.dimensions, 'd'),
            a: r.maybe(() => r.point(), 0.3),
            b: r.maybe(() => r.point(), 0.3),
            offset: r.maybe(() => r.mm(-50_000, 50_000), 0.3),
            attachedTo: r.maybe(
                () => (r.chance(0.5) ? null : dimensionAttachment(doc, r)),
                0.3,
            ),
        }),
    deleteDimensions: (doc, r) => ({
        dimensionIds: idsOf(r, doc.annotations.dimensions, 'd'),
    }),
    addLabel: (_doc, r) =>
        defined({
            position: r.point(),
            text: r.text(1, 200),
            fontSize: r.maybe(() => r.mm(50, 5000)),
            rotation: r.maybe(() => r.real(0, 360)),
        }),
    setLabel: (doc, r) => ({
        labelId: idOf(r, doc.annotations.labels, 't'),
        props: defined({
            position: r.maybe(() => r.point()),
            text: r.maybe(() => r.text(1, 200)),
            fontSize: r.maybe(() => r.mm(50, 5000)),
            rotation: r.maybe(() => r.real(0, 360)),
        }),
    }),
    deleteLabels: (doc, r) => ({
        labelIds: idsOf(r, doc.annotations.labels, 't'),
    }),
    setBackground: (_doc, r) => ({
        background: {
            importId: r.chance(0.5) ? null : 'imp_1',
            mediaUuid: 'media-1',
            pixelWidth: r.int(1, 5000),
            pixelHeight: r.int(1, 5000),
            mmPerPixel: r.chance(0.8) ? r.real(1, 20) : r.real(0.01, 1000),
            position: r.point(),
            rotation: r.real(0, 359.9),
            opacity: r.real(0, 1),
            visible: r.chance(0.8),
            locked: r.chance(0.3),
        },
    }),
    setBackgroundProps: (_doc, r) => ({
        props: defined({
            position: r.maybe(() => r.point(), 0.4),
            rotation: r.maybe(() => r.real(0, 359.9), 0.4),
            opacity: r.maybe(() => r.real(0, 1), 0.4),
            visible: r.maybe(() => r.chance(0.5), 0.4),
            locked: r.maybe(() => r.chance(0.5), 0.4),
        }),
    }),
    calibrateBackground: (_doc, r) => {
        if (r.chance(0.5)) {
            const p1 = r.point();
            return {
                space: 'plan',
                p1,
                p2: r.near(p1, 5000),
                realDistance: r.mm(100, 20_000),
                scaleGeometry: r.chance(0.5),
            };
        }
        const a = { x: r.mm(0, 2000), y: r.mm(0, 2000) };
        return {
            space: 'image',
            a,
            b: r.near(a, 1000),
            distanceMm: r.mm(100, 20_000),
        };
    },
    rescalePlan: (_doc, r) => ({
        factor: r.chance(0.8) ? r.real(0.5, 2) : r.real(0.01, 100),
    }),
    removeBackground: () => ({}),
    setPlanMeta: (_doc, r) => ({
        props: defined({
            defaultWallHeight: r.maybe(() => r.mm(300, 10_000)),
            defaultWallThickness: r.maybe(() => r.mm(50, 1000)),
            floorThickness: r.maybe(() => r.mm(0, 1000)),
            northAngle: r.maybe(() =>
                r.chance(0.3) ? null : r.real(0, 359.9),
            ),
        }),
    }),
    translateEntities: (doc, r) => ({
        ids: selection(r, doc),
        dx: r.mm(-3000, 3000),
        dy: r.mm(-3000, 3000),
        finalize: r.chance(0.5),
    }),
    nudgeEntities: (doc, r) => ({
        ids: selection(r, doc),
        dx: r.pick([-100, -10, -1, 0, 1, 10, 100]),
        dy: r.pick([-100, -10, -1, 0, 1, 10, 100]),
    }),
    insertFragment: (doc, r) => ({
        fragment: fragmentOf(doc, r),
        dx: r.chance(0.3) ? 0 : r.mm(-6000, 6000),
        dy: r.chance(0.3) ? 0 : r.mm(-6000, 6000),
    }),
    deleteEntities: (doc, r) => ({ ids: selection(r, doc) }),
};

const COMMANDS = Object.keys(PLAN_COMMANDS).sort() as PlanCommandType[];

const count = (record: object): number => Object.keys(record).length;

/**
 * What a command works on. A command whose collection is empty would only be
 * `not_found`, so it is usually drawn again (see `drawCommand`).
 */
const NEEDS: Partial<Record<PlanCommandType, (doc: PlanDocument) => boolean>> =
    {
        movePlacement: (doc) => count(doc.placements) > 0,
        rotatePlacement: (doc) => count(doc.placements) > 0,
        setPlacementProps: (doc) => count(doc.placements) > 0,
        deletePlacements: (doc) => count(doc.placements) > 0,
        moveFixture: (doc) => count(doc.fixtures) > 0,
        setFixtureProps: (doc) => count(doc.fixtures) > 0,
        deleteFixtures: (doc) => count(doc.fixtures) > 0,
        setDimension: (doc) => count(doc.annotations.dimensions) > 0,
        deleteDimensions: (doc) => count(doc.annotations.dimensions) > 0,
        setLabel: (doc) => count(doc.annotations.labels) > 0,
        deleteLabels: (doc) => count(doc.annotations.labels) > 0,
        deleteRoomMeta: (doc) => count(doc.rooms) > 0,
        setBackgroundProps: (doc) => doc.background !== null,
        calibrateBackground: (doc) => doc.background !== null,
    };

/** A random command; one with nothing to work on is drawn again 85 % of the time. */
function drawCommand(r: Rand, doc: PlanDocument): PlanCommandType {
    for (;;) {
        const type = r.pick(COMMANDS);
        if (NEEDS[type]?.(doc) !== false || !r.chance(0.85)) return type;
    }
}

// ---- the property ------------------------------------------------------------------

interface Step {
    type: PlanCommandType;
    params: unknown;
    merge: boolean;
    sealed: boolean;
}

describe('command invariants (04 §6.8)', () => {
    it('has a params generator for every one of the 43 plan commands', () => {
        expect(COMMANDS).toHaveLength(43);
        expect(Object.keys(GENERATORS).sort()).toEqual(COMMANDS);
    });

    it('500 random sequences on makeGridPlan(3,3): no command adds a validatePlan error, documents stay plans, history stays capped and undo restores the start', () => {
        const r = new Rand(SEED);
        const failures: string[] = [];
        /** Random-phase successes that changed the document, per command. */
        const changed = new Map<string, number>(COMMANDS.map((t) => [t, 0]));

        for (let n = 0; n < SEQUENCES; n += 1) {
            const ids = testIds();
            const start = makeGridPlan(3, 3, 3000, ids);
            const bus = planBus(start, ids);
            const trace: Step[] = [];
            let failed = false;
            const fail = (what: string) => {
                failed = true;
                failures.push(
                    `sequence ${n}: ${what}\n${JSON.stringify(trace)}`,
                );
            };

            /** Runs one step and checks the invariants; whether it changed the document. */
            const step = (
                type: PlanCommandType,
                params: unknown,
                merge: boolean,
                sealed: boolean,
            ): boolean => {
                trace.push({ type, params, merge, sealed });
                if (sealed) bus.seal();
                const before = bus.getDoc();
                const known = planErrorKeys(validatePlan(before));
                let result;
                try {
                    result = bus.execute(type, params as never, { merge });
                } catch (error) {
                    fail(`${type} threw ${String(error)}`);
                    return false;
                }
                if (!result.ok) return false;
                const after = bus.getDoc();
                const added = [...planErrorKeys(validatePlan(after))].filter(
                    (key) => !known.has(key),
                );
                if (added.length > 0) {
                    fail(`${type} added ${added.join(' ')}`);
                }
                const parsed = PlanDocumentSchema.safeParse(after);
                if (!parsed.success) {
                    fail(`${type} broke the schema: ${parsed.error.message}`);
                }
                if (bus.history().undo.length > HISTORY_CAP) {
                    fail(`history holds ${bus.history().undo.length}`);
                }
                return after !== before;
            };

            for (const [type, make] of SETUP) {
                if (failed) break;
                step(type, make(bus.getDoc(), r), false, false);
            }
            const length = r.int(1, MAX_LENGTH);
            for (let s = 0; s < length && !failed; s += 1) {
                const type = drawCommand(r, bus.getDoc());
                const params = GENERATORS[type](bus.getDoc(), r);
                const merge =
                    PLAN_COMMANDS[type].mergeKey !== undefined && r.chance(0.5);
                if (step(type, params, merge, r.chance(0.2)) && !failed) {
                    changed.set(type, changed.get(type)! + 1);
                }
            }
            if (failed) continue;

            while (bus.undo()) {
                // back to the start
            }
            try {
                expect(bus.getDoc()).toEqual(start);
            } catch {
                fail('undoing the sequence did not restore the start document');
            }
        }

        expect(failures).toEqual([]);
        // not vacuous: every command changed the document several times
        const table = COMMANDS.map((t) => `${t} ${changed.get(t)}`).join(', ');
        const thin = COMMANDS.filter((t) => changed.get(t)! < MIN_CHANGES);
        expect(thin, table).toEqual([]);
    }, 60_000);

    it('never holds more than 200 history entries', () => {
        const ids = testIds();
        const bus = planBus(makeGridPlan(3, 3, 3000, ids), ids);
        for (let i = 0; i < 230; i += 1) {
            expect(
                bus.execute('addLabel', {
                    position: { x: i * 10, y: 0 },
                    text: `L${i}`,
                }).ok,
            ).toBe(true);
            expect(bus.history().undo.length).toBeLessThanOrEqual(HISTORY_CAP);
        }
        expect(bus.history().undo).toHaveLength(HISTORY_CAP);
    });
});
