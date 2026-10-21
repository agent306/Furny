import { describe, expect, it } from 'vitest';
import { fnv1a32, rowIdentity, rowKeyFor } from '../rowKey';
import { NO_EDGES, panel } from './panel';

describe('fnv1a32 (08 §3.4)', () => {
    it('matches the published FNV-1a 32-bit vectors', () => {
        expect(fnv1a32('')).toBe(0x811c9dc5);
        expect(fnv1a32('a')).toBe(0xe40c292c);
        expect(fnv1a32('foobar')).toBe(0xbf9cf968);
    });

    it('hashes UTF-16 code units and always returns an unsigned 32-bit integer', () => {
        for (const s of ['Ü', 'ß', '😀', 'PB18-WHITE|18|2000|582']) {
            const h = fnv1a32(s);
            expect(Number.isInteger(h)).toBe(true);
            expect(h).toBeGreaterThanOrEqual(0);
            expect(h).toBeLessThanOrEqual(0xffffffff);
        }
        // a surrogate pair is two code units: 0xd83d, 0xde00
        let h = 0x811c9dc5;
        for (const unit of [0xd83d, 0xde00]) {
            h = Math.imul(h ^ unit, 0x01000193) >>> 0;
        }
        expect(fnv1a32('😀')).toBe(h);
    });
});

describe('rowIdentity / rowKeyFor (08 §3.4)', () => {
    it('builds the identity from material, thickness, size, grain and edge pairs', () => {
        const part = panel({
            length: 2000,
            width: 582,
            edges: { L1: 'EB08-WHITE', L2: null, W1: 'EB08-WHITE', W2: null },
        });
        expect(rowIdentity(part)).toBe(
            'PB18-WHITE|18|2000|582|none|-,EB08-WHITE|-,EB08-WHITE',
        );
    });

    it('formats the key as r + 8 lower-case hex digits', () => {
        const key = rowKeyFor(panel());
        expect(key).toMatch(/^r[0-9a-f]{8}$/);
        expect(key).toBe(
            'r' + fnv1a32(rowIdentity(panel())).toString(16).padStart(8, '0'),
        );
    });

    it('pads a small hash to 8 digits', () => {
        // fnv1a32('PB18-WHITE|18|100|100|none|-,-|-,-') = 0x00e99e73
        expect(rowKeyFor(panel({ length: 100, width: 100 }))).toBe('r00e99e73');
    });

    it('gives a part banded on L2 instead of L1 the same key (and W2 instead of W1)', () => {
        const a = panel({ edges: { ...NO_EDGES, L1: 'EB08-WHITE' } });
        const b = panel({ edges: { ...NO_EDGES, L2: 'EB08-WHITE' } });
        const c = panel({
            edges: { ...NO_EDGES, L2: 'EB08-WHITE', W2: 'EB20-WHITE' },
        });
        const d = panel({
            edges: { ...NO_EDGES, L1: 'EB08-WHITE', W1: 'EB20-WHITE' },
        });
        expect(rowKeyFor(a)).toBe(rowKeyFor(b));
        expect(rowKeyFor(c)).toBe(rowKeyFor(d));
        expect(rowKeyFor(a)).not.toBe(rowKeyFor(c));
    });

    it('does not mix long and short edges', () => {
        const a = panel({ edges: { ...NO_EDGES, L1: 'EB08-WHITE' } });
        const b = panel({ edges: { ...NO_EDGES, W1: 'EB08-WHITE' } });
        expect(rowKeyFor(a)).not.toBe(rowKeyFor(b));
    });

    it('distinguishes material, thickness, size and grain', () => {
        const base = rowKeyFor(panel());
        expect(rowKeyFor(panel({ materialCode: 'PB18-OAK' }))).not.toBe(base);
        expect(rowKeyFor(panel({ thickness: 25 }))).not.toBe(base);
        expect(rowKeyFor(panel({ length: 1001 }))).not.toBe(base);
        expect(rowKeyFor(panel({ width: 501 }))).not.toBe(base);
        expect(rowKeyFor(panel({ grain: 'length' }))).not.toBe(base);
    });

    it('ignores key, name, quantity, role and operations', () => {
        const base = rowKeyFor(panel());
        expect(
            rowKeyFor(
                panel({
                    key: 'other',
                    nameKey: 'parts.shelf',
                    nameParams: { n: 3 },
                    qty: 4,
                    role: 'shelf',
                }),
            ),
        ).toBe(base);
    });
});
