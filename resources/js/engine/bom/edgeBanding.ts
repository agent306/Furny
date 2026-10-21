/**
 * Edge banding lengths (08 §3.3): every banded edge segment gets its finished
 * length plus `EDGE_ALLOWANCE_MM`, × qty; an extruded (non-rectangular) part
 * is one continuous edge around its outline. The total per band code gets
 * `EDGE_WASTE_PERMILLE` on top, rounded up.
 */
import type { CatalogSnapshot } from '../catalog/snapshot';
import { cmpId } from '../compare';
import { EDGE_IDS, type EdgeId } from '../furniture/schema';
import type { Part } from '../furniture/types';
import { EDGE_ALLOWANCE_MM, EDGE_WASTE_PERMILLE } from './constants';
import { ceilDivBig, product } from '../money';

const EDGE_LENGTH_OF: Record<EdgeId, 'length' | 'width'> = {
    L1: 'length',
    L2: 'length',
    W1: 'width',
    W2: 'width',
};

/** Sum of the segment lengths of a closed outline. */
function outlinePerimeter(outline: ReadonlyArray<[number, number]>): number {
    let sum = 0;
    for (let i = 0; i < outline.length; i++) {
        const [x1, z1] = outline[i]!;
        const [x2, z2] = outline[(i + 1) % outline.length]!;
        sum += Math.hypot(x2 - x1, z2 - z1);
    }
    return sum;
}

/** Raw band length (with allowance, without waste) of one part, per code. */
function rawContributions(part: Part): Array<[string, bigint]> {
    if (part.geometry.kind === 'extruded') {
        const code = EDGE_IDS.map((e) => part.edges[e]).find((c) => c !== null);
        if (code === undefined || code === null) return [];
        const perimeter = Math.round(outlinePerimeter(part.geometry.outline));
        return [[code, product(part.qty, perimeter + EDGE_ALLOWANCE_MM)]];
    }
    const out: Array<[string, bigint]> = [];
    for (const e of EDGE_IDS) {
        const code = part.edges[e];
        if (code === null) continue;
        const edgeLength = part[EDGE_LENGTH_OF[e]];
        out.push([code, product(part.qty, edgeLength + EDGE_ALLOWANCE_MM)]);
    }
    return out;
}

/**
 * Band length per code, including allowance and waste, sorted by code. The
 * catalog is not needed for the lengths; it is part of the 08 §0 signature.
 */
export function edgeBandLengths(
    parts: readonly Part[],
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- 08 §0 signature
    catalog: CatalogSnapshot,
): Array<{ edgeBandCode: string; lengthMm: number }> {
    const raw = new Map<string, bigint>();
    for (const part of parts) {
        for (const [code, length] of rawContributions(part)) {
            raw.set(code, (raw.get(code) ?? 0n) + length);
        }
    }
    return [...raw.keys()].sort(cmpId).map((code) => ({
        edgeBandCode: code,
        lengthMm: ceilDivBig(
            raw.get(code)! * BigInt(1000 + EDGE_WASTE_PERMILLE),
            1000n,
        ),
    }));
}
