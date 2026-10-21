import type { IdPrefix } from '../../ids';
import { testIds } from '../../testing/ids';
import type {
    Opening,
    PlanDocument,
    PlanMeta,
    Wall,
    WallNode,
} from '../schema';

/**
 * Test-only plan document builders (04 §9). Not exported from the engine index.
 * Every builder takes an id factory so the output is deterministic.
 */

type NewId = (prefix: IdPrefix) => string;

const WALL_HEIGHT = 2700;
const DOOR_HEIGHT = 2100;
const WINDOW_SILL = 900;
const WINDOW_HEIGHT = 1200;

const DEFAULT_META: PlanMeta = {
    defaultWallHeight: WALL_HEIGHT,
    defaultWallThickness: 115,
    floorThickness: 150,
    northAngle: null,
    createdWith: 'editor',
};

/** A document with no entities. */
export function emptyPlan(meta: Partial<PlanMeta> = {}): PlanDocument {
    return {
        schemaVersion: 1,
        meta: { ...DEFAULT_META, ...meta },
        nodes: {},
        walls: {},
        openings: {},
        rooms: {},
        placements: {},
        fixtures: {},
        annotations: { dimensions: {}, labels: {} },
        background: null,
        view: { mode2d: null, mode3d: null, lastMode: '2d' },
    };
}

function at<T>(items: readonly T[], index: number): T {
    const item = items[index];
    if (item === undefined) throw new Error(`no item at index ${index}`);
    return item;
}

/** Mutating helpers shared by the builders (the document is built locally). */
function addNode(
    doc: PlanDocument,
    newId: NewId,
    x: number,
    y: number,
): string {
    const id = newId('n');
    const node: WallNode = { id, x, y };
    doc.nodes[id] = node;
    return id;
}

function addWall(
    doc: PlanDocument,
    newId: NewId,
    a: string,
    b: string,
    thickness: number,
    kind: Wall['kind'],
): string {
    const id = newId('w');
    doc.walls[id] = {
        id,
        a,
        b,
        thickness,
        height: WALL_HEIGHT,
        kind,
        justification: 'center',
        material: 'brick',
        colorHex: null,
    };
    return id;
}

function addOpening(
    doc: PlanDocument,
    newId: NewId,
    wallId: string,
    spec: Pick<
        Opening,
        'kind' | 'type' | 'offset' | 'width' | 'height' | 'sillHeight'
    >,
): string {
    const id = newId('o');
    doc.openings[id] = {
        id,
        wallId,
        ...spec,
        hinge: 'start',
        swing: 'left',
        label: null,
    };
    return id;
}

function addDoor(
    doc: PlanDocument,
    newId: NewId,
    wallId: string,
    type: Extract<Opening['type'], 'single_swing' | 'main_entrance'>,
    offset: number,
    width: number,
): string {
    return addOpening(doc, newId, wallId, {
        kind: 'door',
        type,
        offset,
        width,
        height: DOOR_HEIGHT,
        sillHeight: 0,
    });
}

function addWindow(
    doc: PlanDocument,
    newId: NewId,
    wallId: string,
    offset: number,
    width: number,
): string {
    return addOpening(doc, newId, wallId, {
        kind: 'window',
        type: 'casement',
        offset,
        width,
        height: WINDOW_HEIGHT,
        sillHeight: WINDOW_SILL,
    });
}

/** Adds a closed loop of nodes and exterior walls `p[i] -> p[i+1]`; returns wall ids. */
function addExteriorLoop(
    doc: PlanDocument,
    newId: NewId,
    points: ReadonlyArray<readonly [number, number]>,
    thickness: number,
): { nodeIds: string[]; wallIds: string[] } {
    const nodeIds = points.map(([x, y]) => addNode(doc, newId, x, y));
    const wallIds = nodeIds.map((a, i) =>
        addWall(
            doc,
            newId,
            a,
            at(nodeIds, (i + 1) % nodeIds.length),
            thickness,
            'exterior',
        ),
    );
    return { nodeIds, wallIds };
}

/** A `w` x `h` rectangular room; walls run (0,0)->(w,0)->(w,h)->(0,h)->(0,0). */
export function makeRectPlan(
    w: number,
    h: number,
    t: number,
    newId: NewId = testIds(),
): PlanDocument {
    const doc = emptyPlan();
    addExteriorLoop(
        doc,
        newId,
        [
            [0, 0],
            [w, 0],
            [w, h],
            [0, h],
        ],
        t,
    );
    return doc;
}

/** L-shaped flat (8000 x 6000 with a notch), one interior wall, two doors, two windows. */
export function makeLPlan(newId: NewId = testIds()): PlanDocument {
    const doc = emptyPlan();
    const { nodeIds, wallIds } = addExteriorLoop(
        doc,
        newId,
        [
            [0, 0],
            [5000, 0],
            [8000, 0],
            [8000, 3500],
            [5000, 3500],
            [5000, 6000],
            [0, 6000],
        ],
        230,
    );
    const interior = addWall(
        doc,
        newId,
        at(nodeIds, 1),
        at(nodeIds, 4),
        115,
        'interior',
    );
    addDoor(doc, newId, interior, 'single_swing', 1750, 900);
    addDoor(doc, newId, at(wallIds, 5), 'main_entrance', 2500, 1000);
    addWindow(doc, newId, at(wallIds, 0), 2500, 1500);
    addWindow(doc, newId, at(wallIds, 2), 1750, 1200);
    return doc;
}

const GRID_DOOR_COUNT = 40;
const GRID_DOOR_WIDTH = 900;

/** `cols` x `rows` grid of `cell`-sized rooms; doors on the first 40 interior walls. */
export function makeGridPlan(
    cols: number,
    rows: number,
    cell = 3000,
    newId: NewId = testIds(),
): PlanDocument {
    const doc = emptyPlan();
    const nodeAt: string[][] = [];
    for (let j = 0; j <= rows; j += 1) {
        const row: string[] = [];
        for (let i = 0; i <= cols; i += 1) {
            row.push(addNode(doc, newId, i * cell, j * cell));
        }
        nodeAt.push(row);
    }
    const grid = (j: number, i: number): string => at(at(nodeAt, j), i);
    const wallKind = (boundary: boolean): [number, Wall['kind']] =>
        boundary ? [230, 'exterior'] : [115, 'interior'];
    const interiorWalls: string[] = [];
    const add = (a: string, b: string, boundary: boolean): void => {
        const [thickness, kind] = wallKind(boundary);
        const id = addWall(doc, newId, a, b, thickness, kind);
        if (!boundary) interiorWalls.push(id);
    };
    for (let j = 0; j <= rows; j += 1) {
        for (let i = 0; i < cols; i += 1) {
            add(grid(j, i), grid(j, i + 1), j === 0 || j === rows);
        }
    }
    for (let i = 0; i <= cols; i += 1) {
        for (let j = 0; j < rows; j += 1) {
            add(grid(j, i), grid(j + 1, i), i === 0 || i === cols);
        }
    }
    interiorWalls
        .sort()
        .slice(0, GRID_DOOR_COUNT)
        .forEach((wallId) => {
            addDoor(
                doc,
                newId,
                wallId,
                'single_swing',
                Math.round(cell / 2),
                GRID_DOOR_WIDTH,
            );
        });
    return doc;
}

/**
 * A rect plan polluted the way vision imports are (schema-valid but geometrically
 * dirty): (a) two interior walls crossing without a shared node, (b) a wall
 * collinear with and overlapping half of the top wall, (c) one orphan node,
 * (d) a window 200 mm past the end of its wall, (e) two distinct nodes at the
 * same coordinates, each with its own wall.
 */
export function makeDirtyPlan(newId: NewId = testIds()): PlanDocument {
    const doc = makeRectPlan(5000, 4000, 230, newId);
    const walls = Object.keys(doc.walls);

    // (a) crossing at (2500, 2000), no shared node
    const x1 = addNode(doc, newId, 1000, 1000);
    const x2 = addNode(doc, newId, 4000, 3000);
    const x3 = addNode(doc, newId, 1000, 3000);
    const x4 = addNode(doc, newId, 4000, 1000);
    addWall(doc, newId, x1, x2, 115, 'interior');
    addWall(doc, newId, x3, x4, 115, 'interior');

    // (b) overlaps the middle half of the top wall (0,0)-(5000,0)
    const c1 = addNode(doc, newId, 1250, 0);
    const c2 = addNode(doc, newId, 3750, 0);
    addWall(doc, newId, c1, c2, 115, 'interior');

    // (c) orphan node
    addNode(doc, newId, 6500, 500);

    // (d) right wall is 4000 long; a 1200 window at offset 3600 ends at 4200
    const rightWall = at(walls, 1);
    addWindow(doc, newId, rightWall, 3600, 1200);

    // (e) coincident nodes, each with its own wall
    const p = addNode(doc, newId, 4400, 3500);
    const q = addNode(doc, newId, 4400, 3500);
    const s1 = addNode(doc, newId, 4400, 3900);
    const s2 = addNode(doc, newId, 3600, 3500);
    addWall(doc, newId, p, s1, 115, 'interior');
    addWall(doc, newId, q, s2, 115, 'interior');

    return doc;
}

/**
 * `count` walls that all cross each other without sharing a node: `count / 2`
 * horizontal against `count / 2` vertical, so `(count / 2)^2` crossings. Has
 * no rooms. Test-only, for the work budget of `validatePlan`.
 */
export function makeCrossingPlan(
    count: number,
    newId: NewId = testIds(),
): PlanDocument {
    const doc = emptyPlan();
    const half = Math.floor(count / 2);
    const extent = (half + 1) * 40;
    for (let i = 1; i <= half; i += 1) {
        const pos = i * 40;
        for (const [ax, ay, bx, by] of [
            [0, pos, extent, pos],
            [pos, 0, pos, extent],
        ] as const) {
            addWall(
                doc,
                newId,
                addNode(doc, newId, ax, ay),
                addNode(doc, newId, bx, by),
                115,
                'interior',
            );
        }
    }
    return doc;
}
