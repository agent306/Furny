/**
 * Exact integer products and sums for BOM totals (08 §1): every operand is
 * checked to be a safe integer and multiplied in BigInt, so an intermediate
 * product can never lose precision; only the final value is converted back,
 * and it must itself be a safe integer.
 */

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

/** Product of safe integers, exact. */
export function product(...factors: number[]): bigint {
    let out = 1n;
    for (const f of factors) {
        if (!Number.isSafeInteger(f)) {
            throw new RangeError(`operand must be a safe integer, got ${f}`);
        }
        out *= BigInt(f);
    }
    return out;
}

/** `value` as a number; throws when it is not a safe integer. */
export function toSafeNumber(value: bigint): number {
    if (value > MAX_SAFE || value < -MAX_SAFE) {
        throw new RangeError(
            `result ${value} is outside the safe integer range`,
        );
    }
    return Number(value);
}

/** ceil(n / d) for n ≥ 0, d > 0, as a safe integer. */
export function ceilDivBig(n: bigint, d: bigint): number {
    if (n < 0n) throw new RangeError(`n must be >= 0, got ${n}`);
    if (d <= 0n) throw new RangeError(`d must be > 0, got ${d}`);
    return toSafeNumber((n + d - 1n) / d);
}
