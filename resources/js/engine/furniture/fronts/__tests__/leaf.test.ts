import { describe, expect, it } from 'vitest';
import { seedCatalog } from '../../../testing/seedCatalog';
import { createGenContext } from '../../context';
import { boxDocument } from '../../testing/docs';
import { glassLeaf, leafBody, solidLeaf, type LeafBox } from '../leaf';

const catalog = seedCatalog();
const B = 'EB08-WHITE';

const box: LeafBox = { x0: 10, x1: 410, y0: 20, y1: 720, z0: 560, z1: 578 };
const spec = {
    nameKey: 'parts.door',
    nameParams: { leaf: 3 },
    grainAxis: 'y',
} as const;

const newCtx = () =>
    createGenContext(
        boxDocument({ width: 600, height: 720, depth: 560 }),
        catalog,
    );

describe('solidLeaf (07 §4.2)', () => {
    it('pushes one front part banded on all four edges with two visible faces', () => {
        const ctx = newCtx();
        const body = solidLeaf(ctx, 'front.f.leaf.3', box, spec);
        expect(ctx.parts).toEqual(body.parts);
        expect(body.parts).toHaveLength(1);
        expect(body.parts[0]).toMatchObject({
            key: 'front.f.leaf.3',
            nameKey: 'parts.door',
            nameParams: { leaf: 3 },
            role: 'front',
            materialCode: 'PB18-WHITE',
            length: 700,
            width: 400,
            edges: { L1: B, L2: B, W1: B, W2: B },
            visibleFaces: 2,
        });
        expect(body.partKey).toBe('front.f.leaf.3');
    });

    it('answers every edge with the leaf itself', () => {
        const body = solidLeaf(newCtx(), 'k', box, spec);
        for (const edge of ['left', 'right', 'top', 'bottom'] as const) {
            expect(body.edgePart(edge)).toBe(body.parts[0]);
        }
    });
});

describe('glassLeaf and leafBody (07 §4.5)', () => {
    it('builds the frame and the glass under the leaf key', () => {
        const ctx = newCtx();
        const body = glassLeaf(ctx, 'front.f.leaf.3', box);
        expect(body.parts.map((p) => p.key)).toEqual([
            'front.f.leaf.3.stile.left',
            'front.f.leaf.3.stile.right',
            'front.f.leaf.3.rail.top',
            'front.f.leaf.3.rail.bottom',
            'front.f.leaf.3.glass',
        ]);
        expect(ctx.parts).toEqual(body.parts);
        expect(body.partKey).toBe('front.f.leaf.3.stile.left');
        expect(body.edgePart('right').key).toBe('front.f.leaf.3.stile.right');
        expect(body.edgePart('top').key).toBe('front.f.leaf.3.rail.top');
        expect(body.edgePart('bottom').key).toBe('front.f.leaf.3.rail.bottom');
    });

    it('leafBody picks the solid leaf or the glass frame', () => {
        const solid = leafBody(newCtx(), 'a', box, spec, false);
        expect(solid.parts.map((p) => p.key)).toEqual(['a']);
        const glass = leafBody(newCtx(), 'a', box, spec, true);
        expect(glass.parts).toHaveLength(5);
        expect(glass.parts.map((p) => p.key)).not.toContain('a');
    });
});
