import { describe, expect, it } from 'vitest';
import { ENGINE_VERSION, isEntityId, newId, roundMm } from '../index';
import { testIds } from '../testing/ids';
import { mulberry32 } from '../testing/random';

describe('newId', () => {
    it('produces {prefix}_{10 chars of [0-9a-z]}', () => {
        expect(newId('n')).toMatch(/^n_[0-9a-z]{10}$/);
        expect(newId('fr')).toMatch(/^fr_[0-9a-z]{10}$/);
    });

    it('is unique across 1000 calls', () => {
        const ids = new Set(Array.from({ length: 1000 }, () => newId('w')));
        expect(ids.size).toBe(1000);
    });
});

describe('isEntityId', () => {
    it('accepts lowercase ids of the right prefix only', () => {
        expect(isEntityId('w_abc0000001', 'w')).toBe(true);
        expect(isEntityId('w_ABC0000001', 'w')).toBe(false);
        expect(isEntityId('w_abc0000001', 'n')).toBe(false);
        expect(isEntityId('fr_abc0000001', 'f')).toBe(false);
        expect(isEntityId('fr_abc0000001', 'fr')).toBe(true);
        expect(isEntityId('w_abc000000', 'w')).toBe(false);
    });

    it('recognises ids produced by newId', () => {
        expect(isEntityId(newId('h'), 'h')).toBe(true);
    });
});

describe('testIds', () => {
    it('counts independently per prefix', () => {
        const next = testIds();
        expect(next('s')).toBe('s_0000000001');
        expect(next('s')).toBe('s_0000000002');
        expect(next('fr')).toBe('fr_0000000001');
    });

    it('yields ids accepted by isEntityId', () => {
        expect(isEntityId(testIds()('o'), 'o')).toBe(true);
    });
});

describe('mulberry32', () => {
    it('is deterministic for a seed and stays in [0, 1)', () => {
        const a = mulberry32(42);
        const b = mulberry32(42);
        const first = [a(), a(), a()];
        expect(first).toEqual([b(), b(), b()]);
        for (const v of first) {
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThan(1);
        }
        expect(mulberry32(43)()).not.toBe(first[0]);
    });
});

describe('roundMm', () => {
    it('rounds half away from zero', () => {
        expect(roundMm(2.5)).toBe(3);
        expect(roundMm(-2.5)).toBe(-3);
        expect(roundMm(-0.4) + 0).toBe(0);
        expect(roundMm(2.4)).toBe(2);
    });
});

describe('ENGINE_VERSION', () => {
    it('is 1.0.0', () => {
        expect(ENGINE_VERSION).toBe('1.0.0');
    });
});
