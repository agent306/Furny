/** Pole of inaccessibility (04 §4.7), Mapbox polylabel with an inline binary max-heap. */
import {
    polygonCentroid,
    ringBBox,
    signedDistToPolygon,
    type PolygonWithHoles,
} from './polygon';
import type { Vec2 } from './vec2';

interface Cell {
    x: number;
    y: number;
    h: number;
    d: number;
    /** Best possible distance for any point inside the cell. */
    max: number;
    seq: number;
}

/** Binary max-heap on `max`; ties break on insertion order so results are deterministic. */
class CellQueue {
    private readonly items: Cell[] = [];

    get length(): number {
        return this.items.length;
    }

    private static before(a: Cell, b: Cell): boolean {
        return a.max > b.max || (a.max === b.max && a.seq < b.seq);
    }

    push(cell: Cell): void {
        const a = this.items;
        let i = a.length;
        a.push(cell);
        while (i > 0) {
            const p = (i - 1) >> 1;
            if (!CellQueue.before(a[i]!, a[p]!)) break;
            [a[i], a[p]] = [a[p]!, a[i]!];
            i = p;
        }
    }

    pop(): Cell | undefined {
        const a = this.items;
        const top = a[0];
        const last = a.pop();
        if (a.length > 0 && last) {
            a[0] = last;
            let i = 0;
            for (;;) {
                const l = 2 * i + 1;
                const r = l + 1;
                let m = i;
                if (l < a.length && CellQueue.before(a[l]!, a[m]!)) m = l;
                if (r < a.length && CellQueue.before(a[r]!, a[m]!)) m = r;
                if (m === i) break;
                [a[i], a[m]] = [a[m]!, a[i]!];
                i = m;
            }
        }
        return top;
    }
}

/**
 * The interior point farthest from the boundary and that distance. Search
 * stops when no cell can beat the best by more than `precision` mm.
 */
export function polylabel(
    p: PolygonWithHoles,
    precision = 10,
): { point: Vec2; distance: number } {
    const { min, max } = ringBBox(p.outer);
    const width = max.x - min.x;
    const height = max.y - min.y;
    const cellSize = Math.min(width, height);
    if (!(cellSize > 0))
        return { point: { x: min.x + 0, y: min.y + 0 }, distance: 0 };

    let seq = 0;
    const makeCell = (x: number, y: number, h: number): Cell => {
        const d = signedDistToPolygon({ x, y }, p);
        return { x, y, h, d, max: d + h * Math.SQRT2, seq: seq++ };
    };

    const queue = new CellQueue();
    const h0 = cellSize / 2;
    for (let x = min.x; x < max.x; x += cellSize)
        for (let y = min.y; y < max.y; y += cellSize)
            queue.push(makeCell(x + h0, y + h0, h0));

    const centroid = polygonCentroid(p);
    let best = makeCell(centroid.x, centroid.y, 0);
    const bboxCell = makeCell(min.x + width / 2, min.y + height / 2, 0);
    if (bboxCell.d > best.d) best = bboxCell;

    for (let cell = queue.pop(); cell; cell = queue.pop()) {
        if (cell.d > best.d) best = cell;
        if (cell.max - best.d <= precision) continue;
        const h = cell.h / 2;
        queue.push(makeCell(cell.x - h, cell.y - h, h));
        queue.push(makeCell(cell.x + h, cell.y - h, h));
        queue.push(makeCell(cell.x - h, cell.y + h, h));
        queue.push(makeCell(cell.x + h, cell.y + h, h));
    }

    return { point: { x: best.x + 0, y: best.y + 0 }, distance: best.d };
}
