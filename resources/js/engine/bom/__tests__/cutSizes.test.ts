import { describe, expect, it } from 'vitest';
import { seedCatalog } from '../../testing/seedCatalog';
import { cutSize } from '../cutSizes';
import { NO_EDGES, panel } from './panel';

const catalog = seedCatalog();

/** A 1000 × 500 panel banded as given; returns the cut-size deltas. */
function delta(
    edges: Partial<typeof NO_EDGES>,
    premillMm = 0,
): { length: number; width: number } {
    const part = panel({ edges: { ...NO_EDGES, ...edges } });
    const cut = cutSize(part, catalog, premillMm);
    return { length: cut.cutLength - 1000, width: cut.cutWidth - 500 };
}

describe('cutSize (08 §3.2, §10.3)', () => {
    it('keeps an unbanded part at its finished size', () => {
        expect(delta({})).toEqual({ length: 0, width: 0 });
    });

    it('one 0.8 band → −1', () => {
        expect(delta({ L1: 'EB08-WHITE' })).toEqual({ length: 0, width: -1 });
    });

    it('two 0.8 bands → −2 (1.6 rounds to 2)', () => {
        expect(delta({ L1: 'EB08-WHITE', L2: 'EB08-OAK' })).toEqual({
            length: 0,
            width: -2,
        });
    });

    it('two 2.0 bands → −4', () => {
        expect(delta({ W1: 'EB20-WHITE', W2: 'EB20-OAK' })).toEqual({
            length: -4,
            width: 0,
        });
    });

    it('two 0.4 bands → −1 (0.8 rounds to 1)', () => {
        expect(delta({ L1: 'EB04-WHITE', L2: 'EB04-WHITE' })).toEqual({
            length: 0,
            width: -1,
        });
    });

    it('one 0.4 band → 0 (0.4 rounds to 0)', () => {
        expect(delta({ W2: 'EB04-WHITE' })).toEqual({ length: 0, width: 0 });
    });

    it('pre-mill 1 + one 0.8 band → 0', () => {
        expect(delta({ L1: 'EB08-WHITE' }, 1)).toEqual({
            length: 0,
            width: 0,
        });
    });

    it('pre-mill 1 + two 2.0 bands → −2', () => {
        expect(delta({ L1: 'EB20-WHITE', L2: 'EB20-WHITE' }, 1)).toEqual({
            length: 0,
            width: -2,
        });
    });

    it('bands on W1/W2 shorten the length, bands on L1/L2 the width', () => {
        expect(
            delta({
                L1: 'EB20-WHITE',
                L2: 'EB08-WHITE',
                W1: 'EB08-WHITE',
                W2: null,
            }),
        ).toEqual({ length: -1, width: -3 });
    });

    it('pre-mill larger than the band adds length back (−0.6 per edge)', () => {
        // 2 × (400 − 1000) µm = −1200 µm → roundHalfUpDiv → −1 → cut is 1 mm larger
        expect(delta({ W1: 'EB04-WHITE', W2: 'EB04-WHITE' }, 1)).toEqual({
            length: 1,
            width: 0,
        });
    });

    it('treats an edge band code the catalog does not know as 0 mm thick', () => {
        expect(delta({ L1: 'EB-UNKNOWN' })).toEqual({ length: 0, width: 0 });
        expect(delta({ L1: 'EB-UNKNOWN' }, 1)).toEqual({
            length: 0,
            width: 1,
        });
    });
});
