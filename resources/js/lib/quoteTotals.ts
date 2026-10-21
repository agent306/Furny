/**
 * Quote totals (spec 08 §6.3). Identical formulas and shared fixtures
 * (tests/fixtures/quotes/*.json) with the PHP QuoteCalculator.
 *
 * Display bundling of hidden lines (08 §6.4) is not part of totals: the optional
 * `isVisibleToCustomer` / `orderItemId` fields are accepted and ignored.
 */
import { applyBps, costFromMilli, netFromGross } from '@/engine';

export type QuoteLineKind =
    | 'furniture'
    | 'materials'
    | 'hardware'
    | 'labour'
    | 'finishing'
    | 'installation'
    | 'delivery'
    | 'discount'
    | 'custom';

export interface QuoteTotalsLine {
    kind: QuoteLineKind;
    /** Decimal string, at most 3 decimals. */
    quantity: string;
    unitPriceMinor: number;
    taxRateId: string | null;
    isVisibleToCustomer?: boolean;
    orderItemId?: string | null;
}

export interface QuoteTaxRate {
    id: string;
    name: string;
    rateBps: number;
}

export interface QuoteTotalsInput {
    pricesIncludeTax: boolean;
    taxRates: QuoteTaxRate[];
    lines: QuoteTotalsLine[];
}

export interface QuoteTaxBreakdownRow {
    taxRateId: string;
    name: string;
    rateBps: number;
    taxableMinor: number;
    taxMinor: number;
}

export interface QuoteTotals {
    amounts: number[];
    subtotal: number;
    discount: number;
    tax: number;
    total: number;
    taxBreakdown: QuoteTaxBreakdownRow[];
}

export type QuoteTotalsResult =
    | { ok: true; totals: QuoteTotals }
    | { ok: false; code: 'discount_exceeds_subtotal' };

const QUANTITY_PATTERN = /^(\d+)(?:\.(\d{1,3}))?$/;

/** Exact decimal-string parse to thousandths; no floats. */
export function parseQuantityMilli(q: string): number {
    const m = QUANTITY_PATTERN.exec(q);
    if (!m) {
        throw new RangeError(
            `quantity must be a non-negative decimal with at most 3 decimals, got "${q}"`,
        );
    }
    const milli = Number(m[1]) * 1000 + Number((m[2] ?? '').padEnd(3, '0'));
    if (!Number.isSafeInteger(milli)) {
        throw new RangeError(`quantity "${q}" is outside the safe range`);
    }
    return milli;
}

interface Group {
    taxRateId: string | null;
    rateBps: number;
    sum: bigint;
    base: bigint;
    remainder: bigint;
}

// taxRateId asc, null last (08 §6.3 allocation ties).
function byRateId(a: Group, b: Group): number {
    if (a.taxRateId === b.taxRateId) return 0;
    if (a.taxRateId === null) return 1;
    if (b.taxRateId === null) return -1;
    return a.taxRateId < b.taxRateId ? -1 : 1;
}

function cmp(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
}

export function computeQuoteTotals(input: QuoteTotalsInput): QuoteTotalsResult {
    const rates = new Map(input.taxRates.map((r) => [r.id, r]));
    const priced = input.lines.map((line) => ({
        line,
        amount: costFromMilli(
            parseQuantityMilli(line.quantity),
            line.unitPriceMinor,
        ),
    }));
    const amounts = priced.map((p) => p.amount);

    let subtotal = 0n;
    let discount = 0n;
    const groupMap = new Map<string | null, Group>();
    for (const { line, amount: n } of priced) {
        const amount = BigInt(n);
        if (line.kind === 'discount') {
            discount -= amount;
            continue;
        }
        subtotal += amount;
        let group = groupMap.get(line.taxRateId);
        if (!group) {
            const rate =
                line.taxRateId === null ? null : rates.get(line.taxRateId);
            if (line.taxRateId !== null && !rate) {
                throw new RangeError(`unknown tax rate "${line.taxRateId}"`);
            }
            group = {
                taxRateId: line.taxRateId,
                rateBps: rate?.rateBps ?? 0,
                sum: 0n,
                base: 0n,
                remainder: 0n,
            };
            groupMap.set(line.taxRateId, group);
        }
        group.sum += amount;
    }

    if (discount > subtotal) {
        return { ok: false, code: 'discount_exceeds_subtotal' };
    }

    const groups = [...groupMap.values()].sort(byRateId);
    if (subtotal > 0n) {
        for (const g of groups) {
            g.base = (discount * g.sum) / subtotal;
            g.remainder = (discount * g.sum) % subtotal;
        }
        let left = discount - groups.reduce((s, g) => s + g.base, 0n);
        // Array#sort is stable, so equal remainders keep the byRateId order.
        const byRemainder = [...groups].sort((a, b) =>
            a.remainder === b.remainder
                ? 0
                : a.remainder > b.remainder
                  ? -1
                  : 1,
        );
        for (const g of byRemainder) {
            if (left <= 0n) break;
            g.base += 1n;
            left -= 1n;
        }
    }

    let tax = 0n;
    const taxBreakdown: QuoteTaxBreakdownRow[] = [];
    for (const g of groups) {
        const taxable = Number(g.sum - g.base);
        let net = taxable;
        let groupTax: number;
        if (input.pricesIncludeTax) {
            net = netFromGross(taxable, g.rateBps);
            groupTax = taxable - net;
        } else {
            groupTax = applyBps(taxable, g.rateBps);
        }
        tax += BigInt(groupTax);
        if (g.taxRateId !== null) {
            taxBreakdown.push({
                taxRateId: g.taxRateId,
                name: rates.get(g.taxRateId)?.name ?? '',
                rateBps: g.rateBps,
                taxableMinor: net,
                taxMinor: groupTax,
            });
        }
    }
    taxBreakdown.sort(
        (a, b) =>
            b.rateBps - a.rateBps ||
            cmp(a.name, b.name) ||
            cmp(a.taxRateId, b.taxRateId),
    );

    const total = input.pricesIncludeTax
        ? subtotal - discount
        : subtotal - discount + tax;
    const max = BigInt(Number.MAX_SAFE_INTEGER);
    if (subtotal > max || tax > max || total > max) {
        throw new RangeError('quote total exceeds the safe integer range');
    }
    return {
        ok: true,
        totals: {
            amounts,
            subtotal: Number(subtotal),
            discount: Number(discount),
            tax: Number(tax),
            total: Number(total),
            taxBreakdown,
        },
    };
}
