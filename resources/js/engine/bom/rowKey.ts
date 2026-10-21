/**
 * Cut list row keys (08 §3.4): a 32-bit FNV-1a hash of the row identity, the
 * fields that make two parts interchangeable on the saw.
 */
import { cmpId } from '../compare';
import type { Part } from '../furniture/types';

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** 32-bit FNV-1a over UTF-16 code units, unsigned. */
export function fnv1a32(str: string): number {
    let hash = FNV_OFFSET_BASIS;
    for (let i = 0; i < str.length; i++) {
        hash = Math.imul(hash ^ str.charCodeAt(i), FNV_PRIME) >>> 0;
    }
    return hash >>> 0;
}

const pair = (a: string | null, b: string | null): string =>
    [a ?? '-', b ?? '-'].sort(cmpId).join(',');

/**
 * Row identity of a part: material, thickness, finished size, grain, and the
 * long and short edge bands as unordered pairs (a part banded on `L2` instead
 * of `L1` is the same panel flipped).
 */
export function rowIdentity(part: Part): string {
    const { edges } = part;
    return [
        part.materialCode,
        part.thickness,
        part.length,
        part.width,
        part.grain,
        pair(edges.L1, edges.L2),
        pair(edges.W1, edges.W2),
    ].join('|');
}

/** `r` + the hash of a row identity as 8 lower-case hex digits. */
export function rowKeyOfIdentity(identity: string): string {
    return 'r' + fnv1a32(identity).toString(16).padStart(8, '0');
}

/**
 * Row key of a part without the collision suffix, which only `computeBom`
 * can assign (it sees every identity).
 */
export function rowKeyFor(part: Part): string {
    return rowKeyOfIdentity(rowIdentity(part));
}
