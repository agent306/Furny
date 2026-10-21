import { describe, expect, it } from 'vitest';
import { cyrb53 } from '../hash';

/** Reference implementation pasted from 04 §4.6. */
function referenceCyrb53(str: string, seed = 0): number {
    let h1 = 0xdeadbeef ^ seed,
        h2 = 0x41c6ce57 ^ seed;
    for (let i = 0; i < str.length; i++) {
        const ch = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 =
        Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
        Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 =
        Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
        Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

describe('cyrb53', () => {
    it('matches the 04 §4.6 reference implementation', () => {
        for (const s of ['w_a|w_b', '', 'a', 'w_1|w_2|w_3', 'ünï|çode']) {
            expect(cyrb53(s)).toBe(referenceCyrb53(s));
        }
        expect(cyrb53('w_a|w_b', 7)).toBe(referenceCyrb53('w_a|w_b', 7));
    });

    it('pins a golden value so the algorithm cannot drift with the reference', () => {
        expect(cyrb53('w_a|w_b')).toBe(1_468_347_857_554_891);
    });

    it('distinguishes the empty string from other input', () => {
        expect(cyrb53('')).not.toBe(cyrb53('a'));
    });

    it('is deterministic and depends on the seed', () => {
        expect(cyrb53('abc')).toBe(cyrb53('abc'));
        expect(cyrb53('abc', 1)).not.toBe(cyrb53('abc', 0));
    });

    it('returns a non-negative safe integer (53 bits)', () => {
        for (const s of ['', 'a', 'w_a|w_b', 'x'.repeat(200)]) {
            const h = cyrb53(s);
            expect(Number.isSafeInteger(h)).toBe(true);
            expect(h).toBeGreaterThanOrEqual(0);
        }
    });
});
