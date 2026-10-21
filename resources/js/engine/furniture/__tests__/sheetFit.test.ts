import { describe, expect, it } from 'vitest';
import { seedCatalog } from '../../testing/seedCatalog';
import { indexCatalog } from '../catalogIndex';
import { fitsSheet } from '../sheetFit';

const idx = indexCatalog(seedCatalog());
const material = (code: string) => {
    const m = idx.material(code);
    if (!m) throw new Error(`no material ${code}`);
    return m;
};
const HDF3 = material('HDF3-WHITE'); // 2440 x 1220, no grain
const OAK = material('PB18-OAK'); // 2440 x 1220, grain
const TRIM = 10; // pricing.sheetTrimMm of the seed

describe('fitsSheet (07 §3.4.1)', () => {
    it('uses the seed trim of 10 mm', () => {
        expect(seedCatalog().pricing.sheetTrimMm).toBe(TRIM);
    });

    it('the wardrobe back 1978 x 1778 does not fit a 2440 x 1220 HDF sheet', () => {
        expect(fitsSheet(1978, 1778, HDF3, 'none', TRIM)).toBe(false);
    });

    it('the usable area is the sheet less the trim on every edge: 2420 x 1200', () => {
        expect(fitsSheet(2420, 1200, HDF3, 'none', TRIM)).toBe(true);
        expect(fitsSheet(2421, 1200, HDF3, 'none', TRIM)).toBe(false);
        expect(fitsSheet(2420, 1201, HDF3, 'none', TRIM)).toBe(false);
        expect(fitsSheet(2420, 1200, HDF3, 'none', 0)).toBe(true);
        expect(fitsSheet(2440, 1220, HDF3, 'none', 0)).toBe(true);
        expect(fitsSheet(2440, 1220, HDF3, 'none', TRIM)).toBe(false);
    });

    it('is symmetric in a and b for free rotation', () => {
        expect(fitsSheet(1200, 2420, HDF3, 'none', TRIM)).toBe(true);
        expect(fitsSheet(1201, 2420, HDF3, 'none', TRIM)).toBe(false);
    });

    it('without grain a grain direction is ignored', () => {
        expect(fitsSheet(2420, 1200, HDF3, 'length', TRIM)).toBe(true);
        expect(fitsSheet(1200, 2420, HDF3, 'width', TRIM)).toBe(true);
    });

    it('a grained material with grain "length" keeps the longer side along the sheet', () => {
        expect(fitsSheet(2420, 1200, OAK, 'length', TRIM)).toBe(true);
        expect(fitsSheet(2421, 1200, OAK, 'length', TRIM)).toBe(false);
    });

    it('a grained material with grain "width" puts the shorter side along the sheet length', () => {
        // the long side crosses the sheet (<= 1200), the short side runs along it
        expect(fitsSheet(2420, 1200, OAK, 'width', TRIM)).toBe(false);
        expect(fitsSheet(1200, 1000, OAK, 'width', TRIM)).toBe(true);
        expect(fitsSheet(1500, 1000, OAK, 'width', TRIM)).toBe(false);
        // the same part with the grain along its length fits (1500 < 2420, 1000 < 1200)
        expect(fitsSheet(1500, 1000, OAK, 'length', TRIM)).toBe(true);
    });

    it('a grained material with no grain preference rotates freely', () => {
        expect(fitsSheet(2420, 1200, OAK, 'none', TRIM)).toBe(true);
    });

    it('a trim larger than half the sheet fits nothing', () => {
        expect(fitsSheet(1, 1, HDF3, 'none', 700)).toBe(false);
    });
});
