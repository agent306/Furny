import { describe, expect, it } from 'vitest';
import { circleOutline } from '../../furniture/table/outlines';
import { seedCatalog } from '../../testing/seedCatalog';
import {
    EDGE_ALLOWANCE_MM,
    EDGE_WASTE_PERMILLE,
    FINISH_AREA_STEP_MM2,
} from '../constants';
import { edgeBandLengths } from '../edgeBanding';
import { NO_EDGES, panel } from './panel';

const catalog = seedCatalog();

/** The Ø 1000 round top of 08 §10.3 (64-gon), banded on `L1`. */
function roundTop(qty = 1) {
    return panel({
        key: 'table.top',
        materialCode: 'PB25-WHITE',
        thickness: 25,
        length: 1000,
        width: 1000,
        qty,
        edges: { ...NO_EDGES, L1: 'EB20-WHITE' },
        geometry: {
            kind: 'extruded',
            outline: circleOutline(1000),
            plane: 'xz',
            y: 700,
            thickness: 25,
        },
    });
}

describe('edge banding constants (08 §0)', () => {
    it('pins the allowance, waste and finish step', () => {
        expect(EDGE_ALLOWANCE_MM).toBe(50);
        expect(EDGE_WASTE_PERMILLE).toBe(50);
        expect(FINISH_AREA_STEP_MM2).toBe(10_000);
    });
});

describe('edgeBandLengths (08 §3.3, §10.3)', () => {
    it('is empty for unbanded parts', () => {
        expect(edgeBandLengths([panel()], catalog)).toEqual([]);
    });

    it('adds 50 mm per banded edge segment, then 5 % waste rounded up', () => {
        // L1 (length 1000) and W1 (width 500), qty 2: raw 2 × (1050 + 550) = 3200 → 3360
        const part = panel({
            qty: 2,
            edges: { ...NO_EDGES, L1: 'EB08-WHITE', W1: 'EB08-WHITE' },
        });
        expect(edgeBandLengths([part], catalog)).toEqual([
            { edgeBandCode: 'EB08-WHITE', lengthMm: 3360 },
        ]);
    });

    it('sums per band code over all parts and sorts by code', () => {
        const a = panel({
            key: 'a',
            edges: { ...NO_EDGES, L2: 'EB20-WHITE', W2: 'EB08-WHITE' },
        });
        const b = panel({
            key: 'b',
            length: 700,
            width: 300,
            edges: { ...NO_EDGES, L1: 'EB08-WHITE', L2: 'EB08-WHITE' },
        });
        // EB08: 550 + 750 + 750 = 2050 → ceil(2152.5) = 2153; EB20: 1050 → 1102.5 → 1103
        expect(edgeBandLengths([a, b], catalog)).toEqual([
            { edgeBandCode: 'EB08-WHITE', lengthMm: 2153 },
            { edgeBandCode: 'EB20-WHITE', lengthMm: 1103 },
        ]);
    });

    it('bands an extruded round top Ø 1000 as one edge: round(P) + 50 = 3190 → 3350', () => {
        const outline = circleOutline(1000);
        expect(outline).toHaveLength(64);
        const perimeter = 64 * 1000 * Math.sin(Math.PI / 64);
        expect(Math.round(perimeter)).toBe(3140);
        expect(edgeBandLengths([roundTop()], catalog)).toEqual([
            // ceilDiv(3190 × 1050, 1000) = ceil(3349.5) = 3350
            { edgeBandCode: 'EB20-WHITE', lengthMm: 3350 },
        ]);
    });

    it('uses the first non-null of L1, L2, W1, W2 for an extruded part, × qty', () => {
        const top = roundTop(2);
        top.edges = {
            L1: null,
            L2: null,
            W1: 'EB08-WHITE',
            W2: 'EB20-WHITE',
        };
        // 2 × 3190 = 6380 → 6699
        expect(edgeBandLengths([top], catalog)).toEqual([
            { edgeBandCode: 'EB08-WHITE', lengthMm: 6699 },
        ]);
    });

    it('does not band an extruded part without a band code', () => {
        const top = roundTop();
        top.edges = { ...NO_EDGES };
        expect(edgeBandLengths([top], catalog)).toEqual([]);
    });
});
