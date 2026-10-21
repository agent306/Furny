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
