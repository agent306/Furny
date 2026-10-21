/**
 * Furniture and fixture footprints (04 §5.8). A footprint is the CW
 * rectangle a placement or fixture occupies in plan space; `mirrored` never
 * changes it (03 §1: mirroring affects rendering only).
 */
import { add, frontVector, rot, scale, sub, type Vec2 } from '../geometry/vec2';
import type { Fixture, FurniturePlacement } from './schema';

export { frontVector, rotationFromFront } from '../geometry/vec2';

export interface FootprintSize {
    width: number;
    depth: number;
    height: number;
}

/** Looks up the size of a furniture design; `null` for an unknown design. */
export type FootprintProvider = (designId: string) => FootprintSize | null;

export interface Footprint {
    /**
     * CW on screen (`signedArea > 0`): back-left, back-right, front-right,
     * front-left, as seen from the front.
     */
    corners: [Vec2, Vec2, Vec2, Vec2];
    backCenter: Vec2;
    center: Vec2;
    /** Middle of the front edge (`backCenter + front·depth`). */
    front: Vec2;
    width: number;
    depth: number;
    /** Clockwise degrees, as stored on the placement or fixture. */
    rotation: number;
}

/** Normalises `-0` so equal footprints compare equal and hash alike. */
const clean = (p: Vec2): Vec2 => ({
    x: p.x === 0 ? 0 : p.x,
    y: p.y === 0 ? 0 : p.y,
});

function build(
    backCenter: Vec2,
    width: number,
    depth: number,
    rotation: number,
): Footprint {
    const f = frontVector(rotation);
    const r = rot({ x: 1, y: 0 }, (rotation * Math.PI) / 180);
    const halfW = scale(r, width / 2);
    const depthVec = scale(f, depth);
    const backLeft = sub(backCenter, halfW);
    const backRight = add(backCenter, halfW);
    return {
        corners: [
            clean(backLeft),
            clean(backRight),
            clean(add(backRight, depthVec)),
            clean(add(backLeft, depthVec)),
        ],
        backCenter: clean(backCenter),
        center: clean(add(backCenter, scale(f, depth / 2))),
        front: clean(add(backCenter, depthVec)),
        width,
        depth,
        rotation,
    };
}

/** Footprint of a placement; `p.x, p.y` is the centre of the back edge (master §6.2). */
export function placementFootprint(
    p: FurniturePlacement,
    size: FootprintSize,
): Footprint {
    return build({ x: p.x, y: p.y }, size.width, size.depth, p.rotation);
}

/** Footprint of a fixture; `f.x, f.y` is the footprint centre (03). */
export function fixtureFootprint(f: Fixture): Footprint {
    const front = frontVector(f.rotation);
    const center = { x: f.x, y: f.y };
    const footprint = build(
        sub(center, scale(front, f.depth / 2)),
        f.width,
        f.depth,
        f.rotation,
    );
    return { ...footprint, center: clean(center) };
}
