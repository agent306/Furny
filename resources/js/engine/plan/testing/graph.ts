import { create, type Draft } from 'mutative';
import {
    CommandAbort,
    type CommandOutput,
    type ExecuteResult,
} from '../../commands/types';
import type { IdPrefix } from '../../ids';
import { testIds } from '../../testing/ids';
import { createPlanBus } from '../commands/registry';
import type { WallProps } from '../commands/helpers';
import type {
    BackgroundImage,
    DimensionAnnotation,
    FurniturePlacement,
    Opening,
    PlanDocument,
    RoomMeta,
} from '../schema';
import { emptyPlan } from './fixtures';

/**
 * Test-only builders shared by the plan command tests (helpers, walls,
 * moves). Not exported from the engine index.
 */

export type NewId = (prefix: IdPrefix) => string;
export type GraphDoc = Draft<PlanDocument>;
export type GraphOut = CommandOutput<unknown>;

export const PROPS: WallProps = {
    thickness: 115,
    height: 2700,
    kind: 'interior',
    justification: 'center',
    material: 'brick',
    colorHex: null,
};

/** A placement's footprint for every design id. */
export const FOOTPRINT = { width: 1000, depth: 500, height: 700 };

/** Builds a wall graph by hand; ids come from the factory the bus or helper will use. */
export class Graph {
    readonly ids: NewId = testIds();
    doc: PlanDocument = emptyPlan();

    node(x: number, y: number): string {
        const id = this.ids('n');
        this.doc.nodes[id] = { id, x, y };
        return id;
    }

    wall(a: string, b: string, props: Partial<WallProps> = {}): string {
        const id = this.ids('w');
        this.doc.walls[id] = { ...PROPS, ...props, id, a, b };
        return id;
    }

    opening(
        wallId: string,
        offset: number,
        width: number,
        over: Partial<Opening> = {},
    ): string {
        const id = this.ids('o');
        this.doc.openings[id] = {
            id,
            wallId,
            kind: 'door',
            type: 'single_swing',
            offset,
            width,
            height: 2100,
            sillHeight: 0,
            hinge: 'start',
            swing: 'left',
            label: null,
            ...over,
        };
        return id;
    }

    placement(
        wallId: string,
        side: 'left' | 'right',
        x: number,
        y: number,
    ): string {
        const id = this.ids('f');
        const p: FurniturePlacement = {
            id,
            designId: 'des_x',
            x,
            y,
            rotation: 0,
            elevation: 0,
            mirrored: false,
            wallAttachment: { wallId, side },
        };
        this.doc.placements[id] = p;
        return id;
    }

    dimension(
        wallId: string,
        face: 'left' | 'right' | 'center' = 'left',
    ): string {
        const id = this.ids('d');
        const d: DimensionAnnotation = {
            id,
            a: { x: 0, y: 0 },
            b: { x: 1, y: 1 },
            offset: 300,
            attachedTo: { kind: 'wall', wallId, face },
        };
        this.doc.annotations.dimensions[id] = d;
        return id;
    }

    meta(name: string, x: number, y: number): string {
        const id = this.ids('r');
        const m: RoomMeta = {
            id,
            anchor: { x, y },
            name,
            type: 'other',
            floorFinish: 'tile',
            floorColorHex: null,
            labelOffset: null,
            showArea: true,
        };
        this.doc.rooms[id] = m;
        return id;
    }

    /** An unlocked 1000 x 800 px background at 10 mm per pixel, top-left at the origin. */
    background(over: Partial<BackgroundImage> = {}): BackgroundImage {
        const background: BackgroundImage = {
            importId: null,
            mediaUuid: 'media-1',
            pixelWidth: 1000,
            pixelHeight: 800,
            mmPerPixel: 10,
            position: { x: 0, y: 0 },
            rotation: 0,
            opacity: 0.5,
            visible: true,
            locked: false,
            ...over,
        };
        this.doc.background = background;
        return background;
    }

    /** The graph after `recipe` ran on a mutative draft with this factory. */
    run<T>(recipe: (d: GraphDoc, ctx: { newId: NewId }, out: GraphOut) => T): {
        doc: PlanDocument;
        value: T;
        out: GraphOut;
    } {
        const out: GraphOut = {
            result: undefined,
            warnings: [],
            deletedIds: [],
        };
        let value!: T;
        const doc = create(this.doc, (d) => {
            value = recipe(d as GraphDoc, { newId: this.ids }, out);
        });
        return { doc, value, out };
    }

    /** The abort `recipe` throws. */
    abortOf(
        recipe: (d: GraphDoc, ctx: { newId: NewId }, out: GraphOut) => unknown,
    ) {
        try {
            this.run(recipe);
        } catch (error) {
            if (error instanceof CommandAbort) return error.reason;
            throw error;
        }
        throw new Error('expected a CommandAbort');
    }
}

export function planBus(doc: PlanDocument, ids: NewId) {
    return createPlanBus({
        initial: doc,
        footprints: () => FOOTPRINT,
        newId: ids,
    });
}

export const busOf = (g: Graph) => planBus(g.doc, g.ids);

/** The value of a successful execute. */
export function ok<T>(
    r: ExecuteResult<T>,
): Extract<ExecuteResult<T>, { ok: true }> {
    if (!r.ok) throw new Error(`expected ok, got ${r.error.code}`);
    return r;
}

/** The error of a refused execute. */
export function refused<T>(r: ExecuteResult<T>) {
    if (r.ok) throw new Error('expected an error');
    return r.error;
}

/**
 * A horizontal wall (0,0)-(5000,0) with distinguishable properties
 * (exterior, 230 mm, concrete, coloured); `over` replaces some of them.
 */
export function oneWall(over: Partial<WallProps> = {}) {
    const g = new Graph();
    const a = g.node(0, 0);
    const b = g.node(5000, 0);
    const w = g.wall(a, b, {
        thickness: 230,
        kind: 'exterior',
        material: 'concrete',
        colorHex: '#aabbcc',
        ...over,
    });
    return { g, a, b, w };
}

/**
 * A closed 5000 x 3000 room at (1000, 500) with 200 mm walls, a door and a
 * window on its north wall, one of everything the scaling commands move, and a
 * background that is not at the origin. The north wall's right face (y = 600)
 * is the room side; a placement and a dimension are attached to it.
 */
export function scaleWorld() {
    const g = new Graph();
    const n1 = g.node(1000, 500);
    const n2 = g.node(6000, 500);
    const n3 = g.node(6000, 3500);
    const n4 = g.node(1000, 3500);
    const north = g.wall(n1, n2, { thickness: 200 });
    g.wall(n2, n3, { thickness: 200 });
    g.wall(n3, n4, { thickness: 200 });
    g.wall(n4, n1, { thickness: 200 });
    const door = g.opening(north, 1000, 900);
    const window = g.opening(north, 3500, 1200, {
        kind: 'window',
        type: 'casement',
        sillHeight: 900,
        height: 1200,
    });
    const attachedPlacement = g.placement(north, 'right', 2000, 600);
    const freePlacement = g.ids('f');
    g.doc.placements[freePlacement] = {
        id: freePlacement,
        designId: 'des_x',
        x: 3000,
        y: 2000,
        rotation: 90,
        elevation: 150,
        mirrored: false,
        wallAttachment: null,
    };
    const fixture = g.ids('x');
    g.doc.fixtures[fixture] = {
        id: fixture,
        libraryKey: 'wc',
        x: 5000,
        y: 3000,
        rotation: 0,
        width: 400,
        depth: 700,
        height: 800,
        elevation: 0,
        label: null,
    };
    const label = g.ids('t');
    g.doc.annotations.labels[label] = {
        id: label,
        position: { x: 2000, y: 1000 },
        text: 'Hall',
        fontSize: 250,
        rotation: 0,
    };
    const freeDimension = g.ids('d');
    g.doc.annotations.dimensions[freeDimension] = {
        id: freeDimension,
        a: { x: 1000, y: 4000 },
        b: { x: 6000, y: 4000 },
        offset: 300,
        attachedTo: null,
    };
    const attachedDimension = g.dimension(north, 'right');
    const meta = g.meta('Living', 3000, 2000);
    g.doc.rooms[meta]!.labelOffset = { x: 100, y: -200 };
    const background = g.background({ position: { x: 500, y: 200 } });
    return {
        g,
        nodes: [n1, n2, n3, n4],
        north,
        door,
        window,
        attachedPlacement,
        freePlacement,
        fixture,
        label,
        freeDimension,
        attachedDimension,
        meta,
        background,
    };
}
