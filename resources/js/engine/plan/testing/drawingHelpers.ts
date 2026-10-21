import type { Vec2 } from '../../geometry/vec2';
import type { DrawGroup, DrawItem, StyleKey } from '../drawing/types';
import type { Fixture, Opening, PlanDocument, RoomMeta } from '../schema';

/** Test-only helpers for the drawing tests. Not exported from the engine index. */

type Of<T extends DrawItem['t']> = Extract<DrawItem, { t: T }>;

const pick =
    <T extends DrawItem['t']>(t: T) =>
    (group: DrawGroup, style?: StyleKey): Array<Of<T>> =>
        group.items.filter(
            (i): i is Of<T> =>
                i.t === t &&
                (style === undefined ||
                    (i as { style?: StyleKey }).style === style),
        );

export const linesOf = pick('line');
export const polysOf = pick('poly');
export const arcsOf = pick('arc');
export const textsOf = pick('text');

let counter = 0;

/** Adds an opening to `doc` (default: a 900 mm single door on the wall `wallId`). */
export function addOpening(
    doc: PlanDocument,
    wallId: string,
    patch: Partial<Opening> = {},
): string {
    counter += 1;
    const id = patch.id ?? `o_${String(counter).padStart(10, '0')}`;
    doc.openings[id] = {
        id,
        wallId,
        kind: 'door',
        type: 'single_swing',
        offset: 2500,
        width: 900,
        height: 2100,
        sillHeight: 0,
        hinge: 'start',
        swing: 'right',
        label: null,
        ...patch,
    };
    return id;
}

export function addRoomMeta(
    doc: PlanDocument,
    anchor: Vec2,
    patch: Partial<RoomMeta> = {},
): string {
    counter += 1;
    const id = patch.id ?? `r_${String(counter).padStart(10, '0')}`;
    doc.rooms[id] = {
        id,
        anchor: { x: anchor.x, y: anchor.y },
        name: 'Living',
        type: 'living',
        floorFinish: 'tile',
        floorColorHex: null,
        labelOffset: null,
        showArea: true,
        ...patch,
    };
    return id;
}

export function addFixture(
    doc: PlanDocument,
    patch: Partial<Fixture> = {},
): string {
    counter += 1;
    const id = patch.id ?? `x_${String(counter).padStart(10, '0')}`;
    doc.fixtures[id] = {
        id,
        libraryKey: 'shower',
        x: 1000,
        y: 1000,
        rotation: 0,
        width: 900,
        depth: 900,
        height: 2000,
        elevation: 0,
        label: null,
        ...patch,
    };
    return id;
}

/** Every number found anywhere inside `value`, with its path. */
export function numbersIn(
    value: unknown,
    path = '$',
    out: Array<{ path: string; n: number }> = [],
): Array<{ path: string; n: number }> {
    if (typeof value === 'number') out.push({ path, n: value });
    else if (Array.isArray(value)) {
        value.forEach((v, i) => numbersIn(v, `${path}[${i}]`, out));
    } else if (value !== null && typeof value === 'object') {
        for (const [k, v] of Object.entries(value)) {
            numbersIn(v, `${path}.${k}`, out);
        }
    }
    return out;
}
