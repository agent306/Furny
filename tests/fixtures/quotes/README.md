# Quote calculator fixtures

Shared contract (spec 08 §6.3, §10.6). Vitest runs every `*.json` here against `resources/js/lib/quoteTotals.ts`; from P7, Pest runs the same files against `App\Domain\Orders\Support\QuoteCalculator`. Both must produce `expected` exactly. Never change one side's numbers without the other.

Shape of each file:

```
{
  "description": string,
  "pricesIncludeTax": boolean,
  "taxRates": [{ "id": string, "name": string, "rateBps": int }],
  "lines": [{
    "kind": "furniture"|"materials"|"hardware"|"labour"|"finishing"|"installation"|"delivery"|"discount"|"custom",
    "quantity": "decimal string, at most 3 decimals",
    "unitPriceMinor": int (<= 0 for discount),
    "taxRateId": string | null,
    "isVisibleToCustomer"?: boolean,   // optional, ignored by totals (08 §6.4: hidden lines count)
    "orderItemId"?: string | null      // optional, ignored by totals (display bundling is P7 only)
  }],
  "expected": {
    "amounts": int[],                  // one per line, same order
    "subtotal": int, "discount": int, "tax": int, "total": int,
    "taxBreakdown": [{ "taxRateId", "name", "rateBps", "taxableMinor", "taxMinor" }]
  } | { "error": "discount_exceeds_subtotal" }
}
```

`taxBreakdown` is ordered `rateBps` desc, `name` asc; the untaxed (null) group is never listed. With `pricesIncludeTax`, `taxableMinor` is the net value. All money is integer minor units.
