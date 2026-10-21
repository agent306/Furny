import type { IdPrefix } from '../../ids';
import { testIds } from '../../testing/ids';
import type { PlanDocument, RoomMeta, Wall } from '../schema';
import { emptyPlan } from './fixtures';

/**
 * Test-only builders for room reconciliation and pipeline tests. Not
 * exported from the engine index.
 */

export interface Strip {
    doc: PlanDocument;
    /** Interior wall id by cut x. */
    cutWall: Record<number, string>;
    /** Node id by `x,y`. */
    node: Record<string, string>;
    /** Exterior wall ids by side (`top` and `bottom` list left to right). */
    sides: { top: string[]; bottom: string[]; left: string; right: string };
}

export interface StripOptions {
    /** Wall thickness; default 115 (net face = centre-line face minus 57.5 mm per side). */
    thickness?: number;
    newId?: (prefix: IdPrefix) => string;
    /** Added to every x (and to the cuts), default 0. */
    originX?: number;
}

/**
 * A `width` x `height` strip of rooms: exterior walls around it and one
 * interior wall at every x in `cuts` (x measured from the strip's left edge).
 */
export function strip(
    width: number,
    height: number,
    cuts: number[],
    opts: StripOptions = {},
): Strip {
    const newId = opts.newId ?? testIds();
    const thickness = opts.thickness ?? 115;
    const ox = opts.originX ?? 0;
    const doc = emptyPlan();
    const node: Record<string, string> = {};
    const addNode = (x: number, y: number): string => {
        const id = newId('n');
        doc.nodes[id] = { id, x, y };
        node[`${x},${y}`] = id;
        return id;
    };
    const addWall = (a: string, b: string, kind: Wall['kind']): string => {
        const id = newId('w');
        doc.walls[id] = {
            id,
            a,
            b,
            thickness,
            height: 2700,
            kind,
            justification: 'center',
            material: 'brick',
            colorHex: null,
        };
        return id;
    };
    const xs = [0, ...cuts, width];
    const top = xs.map((x) => addNode(ox + x, 0));
    const bottom = xs.map((x) => addNode(ox + x, height));
    const sides: Strip['sides'] = { top: [], bottom: [], left: '', right: '' };
    for (let i = 0; i + 1 < xs.length; i += 1) {
        sides.top.push(addWall(top[i]!, top[i + 1]!, 'exterior'));
        sides.bottom.push(addWall(bottom[i]!, bottom[i + 1]!, 'exterior'));
    }
    sides.left = addWall(top[0]!, bottom[0]!, 'exterior');
    sides.right = addWall(top.at(-1)!, bottom.at(-1)!, 'exterior');
    const cutWall: Record<number, string> = {};
    cuts.forEach((x, i) => {
        cutWall[x] = addWall(top[i + 1]!, bottom[i + 1]!, 'interior');
    });
    return { doc, cutWall, node, sides };
}

/** A factory of RoomMetas with ids `r_0000000001`, `r_0000000002`, ... */
export function metaFactory(): (
    x: number,
    y: number,
    patch?: Partial<RoomMeta>,
) => RoomMeta {
    const rId = testIds();
    return (x, y, patch = {}) => {
        const id = rId('r');
        return {
            id,
            anchor: { x, y },
            name: id,
            type: 'bedroom',
            floorFinish: 'tile',
            floorColorHex: null,
            labelOffset: null,
            showArea: true,
            ...patch,
        };
    };
}
