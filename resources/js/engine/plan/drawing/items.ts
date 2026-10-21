/** Furniture, fixture and text label symbols (04 §8.2, 05 §9.1). */
import { add, frontVector, scale, type Vec2 } from '../../geometry/vec2';
import { FIXTURE_LIBRARY } from '../fixtures';
import {
    fixtureFootprint,
    placementFootprint,
    type Footprint,
} from '../footprint';
import type { Fixture, FurniturePlacement, TextLabel } from '../schema';
import { line, poly, text } from './shared';
import type { DrawGroup, DrawItem, DrawingOptions } from './types';

/** Side of the square drawn for a placement whose design is unknown (mm). */
const MISSING_SIZE = 600;
/** Front-edge arrow: base and height (mm). */
const ARROW_BASE = 150;
const ARROW_HEIGHT = 100;
/** Segments of a fixture ellipse polygon. */
const ELLIPSE_SEGMENTS = 24;

export function drawPlacement(
    p: FurniturePlacement,
    opts: DrawingOptions,
): DrawGroup {
    const group: DrawGroup = {
        entityId: p.id,
        entityKind: 'placement',
        items: [],
    };
    const size = opts.footprints(p.designId);
    if (size === null) {
        const fp = placementFootprint(p, {
            width: MISSING_SIZE,
            depth: MISSING_SIZE,
            height: 0,
        });
        group.items.push(
            poly(fp.corners, 'furniture_missing'),
            text(
                fp.center,
                opts.strings.missingDesign,
                opts.textSizeMm('furniture_label'),
                'furniture_label',
            ),
        );
        return group;
    }

    const fp = placementFootprint(p, size);
    group.items.push(
        poly(fp.corners, 'furniture'),
        line(fp.corners[3], fp.corners[2], 'furniture_front'),
        frontArrow(fp, p.rotation),
    );
    const name = opts.lod === 0 ? opts.designName(p.designId) : null;
    if (name !== null && name !== '') {
        group.items.push(
            text(
                fp.center,
                name,
                opts.textSizeMm('furniture_label'),
                'furniture_label',
            ),
        );
    }
    return group;
}

/** Isosceles triangle on the front-edge midpoint, pointing out of the footprint. */
function frontArrow(fp: Footprint, rotation: number): DrawItem {
    const front = frontVector(rotation);
    const right: Vec2 = { x: front.y, y: -front.x };
    const half = scale(right, ARROW_BASE / 2);
    return poly(
        [
            add(fp.front, scale(half, -1)),
            add(fp.front, half),
            add(fp.front, scale(front, ARROW_HEIGHT)),
        ],
        'furniture_front',
        { cw: true },
    );
}

/** Draws a fixture's library symbol mapped through its footprint (05 §9.1). */
export function drawFixture(f: Fixture, opts: DrawingOptions): DrawGroup {
    const fp = fixtureFootprint(f);
    const front = frontVector(f.rotation);
    const right: Vec2 = { x: front.y, y: -front.x };
    // Normalised x in [-0.5, 0.5] across the width, y in [0, 1] back to front.
    const map = (nx: number, ny: number): Vec2 =>
        add(
            fp.backCenter,
            add(scale(right, nx * f.width), scale(front, ny * f.depth)),
        );

    const items: DrawItem[] = [];
    for (const s of FIXTURE_LIBRARY[f.libraryKey].symbol2d(f.width, f.depth)) {
        if (s.detail && opts.lod > 0) continue;
        const style = s.detail ? 'fixture_detail' : 'fixture';
        switch (s.t) {
            case 'rect':
                items.push(
                    poly(
                        [
                            map(s.x0, s.y0),
                            map(s.x1, s.y0),
                            map(s.x1, s.y1),
                            map(s.x0, s.y1),
                        ],
                        style,
                        { fill: s.fill, dashed: s.dashed },
                    ),
                );
                break;
            case 'ellipse': {
                const ring: Vec2[] = [];
                for (let k = 0; k < ELLIPSE_SEGMENTS; k += 1) {
                    const a = (2 * Math.PI * k) / ELLIPSE_SEGMENTS;
                    ring.push(
                        map(
                            s.cx + s.rx * Math.cos(a),
                            s.cy + s.ry * Math.sin(a),
                        ),
                    );
                }
                items.push(poly(ring, style, { dashed: s.dashed }));
                break;
            }
            case 'line':
                items.push(
                    line(map(s.x0, s.y0), map(s.x1, s.y1), style, s.dashed),
                );
                break;
            case 'polyline':
                items.push(
                    poly(
                        s.pts.map(([x, y]) => map(x, y)),
                        style,
                        { closed: s.closed },
                    ),
                );
                break;
        }
    }
    return { entityId: f.id, entityKind: 'fixture', items };
}

/** Free text at model size: it scales with the zoom by design (03 §1). */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- uniform draw* signature (04 §8.1)
export function drawLabel(l: TextLabel, _opts: DrawingOptions): DrawGroup {
    return {
        entityId: l.id,
        entityKind: 'label',
        items:
            l.text === ''
                ? []
                : [
                      text(l.position, l.text, l.fontSize, 'label', {
                          rotationDeg: l.rotation,
                          anchor: 'start',
                      }),
                  ],
    };
}
