# Task 2 report: money helpers

Status: DONE

## Implemented
- resources/js/engine/money.ts: roundHalfUpDiv, ceilDiv, applyBps, grossUp, netFromGross, roundUpToStep, costFromHundredths, costFromMilli, multiplyMinor. All arithmetic in BigInt, half-away-from-zero (q=|n|/d, q+=(2r>=d), sign re-applied). Inputs must be safe integers and d>0 (RangeError otherwise); ceilDiv needs n>=0; results beyond MAX_SAFE_INTEGER throw RangeError. Re-exported from engine/index.ts.
- tests/fixtures/money/minor-math.json: 22 cases, all 08 §10.1 values plus the extras from the brief.
- Ruling C12 applied: multiplyMinor(1000,1.005)=1005 is NOT in the shared JSON (the fixture holds only the eight 08 §1 functions with integer args, keeping PHP MinorMath parity). multiplyMinor is tested directly in money.test.ts (5 value cases + non-integer/non-finite rejection).
- money.test.ts: it.each over the JSON, a guard that every fn is exported and args are integers, RangeError cases (d=0, d<0, 1.5/2, NaN, ceilDiv negative, roundUpToStep non-integer, MAX_SAFE overflow).

## TDD evidence
- RED: `yarn vitest run --project engine resources/js/engine/__tests__/money.test.ts` -> "Failed to load url ../money ... Does the file exist?" (1 file failed, no tests), expected as money.ts did not exist.
- GREEN: same command -> 34 passed (34).

## Gates
- yarn eslint resources/js/engine: clean. yarn prettier --check resources/js/engine tests/fixtures/money: clean. yarn vue-tsc --noEmit: clean (after fixing one noUncheckedIndexedAccess error in the test). Full engine project: 7 files, 73 tests passing.

## Files
resources/js/engine/money.ts, resources/js/engine/index.ts, resources/js/engine/__tests__/money.test.ts, tests/fixtures/money/minor-math.json

## Notes / concerns
- Extra strictness beyond brief (consistent with 08 §1): ceilDiv rejects n<0; roundUpToStep rejects amount<0 when step>1; netFromGross rejects rateBps <= -10000.
- Comments avoid the purity-banned tokens.
