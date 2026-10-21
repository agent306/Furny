/**
 * Integer minor-unit money helpers (spec 08 §1, master §6.4).
 *
 * All multiplication and division runs in BigInt so intermediate products
 * never lose precision; results are converted back to `number` and must not
 * exceed Number.MAX_SAFE_INTEGER. Inputs must be safe integers; anything else
 * throws a RangeError. PHP `MinorMath` mirrors these semantics and runs the
 * same fixtures in tests/fixtures/money/minor-math.json.
 */

const BPS_BASE = 10_000n;
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE = -MAX_SAFE;

function int(value: number, name: string): bigint {
    if (!Number.isSafeInteger(value)) {
        throw new RangeError(`${name} must be a safe integer, got ${value}`);
    }
    return BigInt(value);
}

function toNumber(value: bigint): number {
    if (value > MAX_SAFE || value < MIN_SAFE) {
        throw new RangeError(
            `result ${value} is outside the safe integer range`,
        );
    }
    return Number(value);
}

/** Half away from zero; `d` must already be validated as > 0. */
function divRound(n: bigint, d: bigint): bigint {
    const negative = n < 0n;
    const abs = negative ? -n : n;
    let q = abs / d;
    if (2n * (abs % d) >= d) q += 1n;
    return negative ? -q : q;
}

function positive(value: number, name: string): bigint {
    const v = int(value, name);
    if (v <= 0n) {
        throw new RangeError(`${name} must be > 0, got ${value}`);
    }
    return v;
}

/** n / d rounded half away from zero (HALF_UP in brick/money). d > 0. */
export function roundHalfUpDiv(n: number, d: number): number {
    return toNumber(divRound(int(n, 'n'), positive(d, 'd')));
}

/** ceil(n / d) for n >= 0, d > 0. */
export function ceilDiv(n: number, d: number): number {
    const bn = int(n, 'n');
    if (bn < 0n) throw new RangeError(`n must be >= 0, got ${n}`);
    const bd = positive(d, 'd');
    return toNumber((bn + bd - 1n) / bd);
}

/** roundHalfUpDiv(amount x bps, 10000) */
export function applyBps(amountMinor: number, bps: number): number {
    return toNumber(
        divRound(int(amountMinor, 'amountMinor') * int(bps, 'bps'), BPS_BASE),
    );
}

/** Amount including tax: roundHalfUpDiv(amount x (10000 + rateBps), 10000). */
export function grossUp(amountMinor: number, rateBps: number): number {
    return toNumber(
        divRound(
            int(amountMinor, 'amountMinor') *
                (BPS_BASE + int(rateBps, 'rateBps')),
            BPS_BASE,
        ),
    );
}

/** Net from a tax-inclusive amount: roundHalfUpDiv(gross x 10000, 10000 + rateBps). */
export function netFromGross(grossMinor: number, rateBps: number): number {
    const divisor = BPS_BASE + int(rateBps, 'rateBps');
    if (divisor <= 0n) {
        throw new RangeError(`rateBps must be > -10000, got ${rateBps}`);
    }
    return toNumber(
        divRound(int(grossMinor, 'grossMinor') * BPS_BASE, divisor),
    );
}

/** step <= 1 returns the amount; otherwise ceilDiv(amount, step) x step (amount >= 0). */
export function roundUpToStep(amountMinor: number, step: number): number {
    const amount = int(amountMinor, 'amountMinor');
    const s = int(step, 'step');
    if (s <= 1n) return toNumber(amount);
    if (amount < 0n) {
        throw new RangeError(`amountMinor must be >= 0, got ${amountMinor}`);
    }
    return toNumber(((amount + s - 1n) / s) * s);
}

/** roundHalfUpDiv(qtyHundredths x unitMinor, 100) */
export function costFromHundredths(
    qtyHundredths: number,
    unitMinor: number,
): number {
    return toNumber(
        divRound(
            int(qtyHundredths, 'qtyHundredths') * int(unitMinor, 'unitMinor'),
            100n,
        ),
    );
}

/** roundHalfUpDiv(qtyMilli x unitMinor, 1000) */
export function costFromMilli(qtyMilli: number, unitMinor: number): number {
    return toNumber(
        divRound(
            int(qtyMilli, 'qtyMilli') * int(unitMinor, 'unitMinor'),
            1000n,
        ),
    );
}

/**
 * Display helper (master §6.4), not part of the shared PHP fixtures:
 * roundHalfUpDiv(amount x round(factor x 1e6), 1e6). Pricing never uses it.
 */
export function multiplyMinor(amountMinor: number, factor: number): number {
    if (!Number.isFinite(factor)) {
        throw new RangeError(`factor must be finite, got ${factor}`);
    }
    const scaled = int(Math.round(factor * 1e6), 'factor x 1e6');
    return toNumber(
        divRound(int(amountMinor, 'amountMinor') * scaled, 1_000_000n),
    );
}
