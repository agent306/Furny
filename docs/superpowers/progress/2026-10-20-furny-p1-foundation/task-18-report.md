# Task 18 report: common and display components, status badges, Intl formatting

Status: DONE_WITH_CONCERNS. Commits: 12770aa `fix(ui): sliding theme cookie refresh and reka-ui floor for DrawerRoot` (Task 17 leftovers a, b), 7b0ad32 `feat(ui): common/display components, status badges and Intl formatting`. Not pushed.

## Implemented
- **lib/format.ts** (15 §15.6): `formatMoney, minorToMajorString, parseMajorToMinor, formatNumber, formatPercent, formatBps, formatDateTime, formatDate, formatRelative, formatFileSize, formatDuration, todayInBusinessTz` plus `formatTime` (needed by `DateText kind="time"`). `createFormat(context | () => context)` returns the bound set; module-level exports use a context set by `setFormatContext()` (defaults en-IN / INR / Asia/Kolkata). `useFormat()` = `createFormat(() => ctx from page props)`, so it follows prop changes; props are read through a local minimal type (shared props are typed in Task 20, preflight I9).
- **statusTones.ts**: `ORDER_STATE_TONE`, `ORDER_STATE_ICON` (registry names), `IMPORT/QUOTE/PROPOSAL/PROPOSAL_DECISION/ISSUE/NEGOTIATION_STATUS_TONE`, each `Record<EnumUnion, Tone>` (a new backend value is a compile error) and a runtime test against `generated.d.ts`. `types/ui.ts` gains `Tone`; new `types/domain.ts` aliases the generated enums (they live in the global `App.Domain.*` namespace, `generated.d.ts` is not a module).
- **icons.ts**: added arrow-left, check, copy, file-pen, handshake, messages-square, package-check, receipt, send, wrench (state icons use the existing `x-circle` / `pause-circle` registry names).
- **Lang**: `orders.states.*` (09 §1 label), `orders.states_customer.*` (09 §1 "customer sees as"), `orders.states_customer_short.*` (15 §9.3); `common` (copy, copied, loading, confirm.type_to_confirm, screen_too_small.*, unsaved_changes, validation.reason_required/note_required); `errors` (load_failed, status_code, copy_failed); `money.approximately`. `ENUM_KEY_PATTERNS` has the three orders patterns -> `OrderStateKey`. `i18n:export` regenerated and committed.
- **Components**: common (PageHeader, EmptyState, GrainMotif, ConfirmDialog, ConfirmHost, ReasonDialog, ErrorState, LoadingState, ScreenTooSmall, InputError, FormSection, StickyActionBar, CopyButton), display (MoneyDisplay, RelativeTime, DateText, UserAvatar, KeyValueList), orders (StatusBadge, StatusPill). **useConfirm** with module-level state.

## Money (parseMajorToMinor) and the engine
08 §1 specifies only the integer helpers (`roundHalfUpDiv`, ...), not parsing, so the rules are the brief's plus these choices:
- More fraction digits than allowed -> `null`, never rounded (`'1.005'`, `'12.500'` with 2 digits, `'12.0'` with 0).
- BigInt/string maths only; result > `Number.MAX_SAFE_INTEGER` -> `null`.
- Grouping: western (`1,234,567`) or lakh (`1,23,456`); anything else (`12,34`, `1,,000`, `,5`, `0,123`) -> `null`. `.` is the only decimal separator; a second `.` or a `,` after `.` -> `null`.
- Surrounding whitespace (incl. NBSP) trimmed; inner whitespace, currency symbols, non-ASCII digits, `1e3`, `NaN`, empty, lone `.`/sign -> `null`. `.5` and `5.` accepted.
- One leading `+`, `-` or U+2212 accepted; `-0` returns `0`, never `-0`. 08 says nothing about negatives, so `CurrencyInput` (Task 19) enforces `allowNegative` on the result.
- `formatMoney` gives `Intl.NumberFormat` the exact decimal string from `minorToMajorString`, not `minor / 100`; non-safe-integer input throws `RangeError`.
- **Divergence from engine/money:** none in behaviour (no rounding anywhere here). There is no `engine/money.ts` in this branch yet (`resources/js/engine` has only `index.ts`, `version.ts`), so nothing overlaps; the parser/formatter are display-side only. Dedupe note for merge: `formatMoney`/`minorToMajorString`/`parseMajorToMinor` live only in `lib/format.ts`.

## Dates and time zones
- `YYYY-MM-DD` is validated as a real calendar date (`2026-02-30` -> `—`), held as UTC midnight and only formatted with `timeZone: 'UTC'`. Tested with user zones America/Los_Angeles, Pacific/Kiritimati, UTC, Asia/Kolkata, and with the process `TZ` itself set to Los Angeles and Kiritimati (guarded by a `getTimezoneOffset()` assertion so the test is not vacuous).
- A datetime without an offset is read as UTC (app zone), never the browser's. `formatDateTime('2026-10-20')` prints the date only.
- Unreadable input prints `—` (never throws). `todayInBusinessTz(now?)` uses the business zone (not the user's); `formatRelative(iso, now?)` takes an injectable clock.

## useConfirm (documented in code)
Concurrent `confirm()` calls QUEUE first in first out; one dialog is on screen, each promise settles when its own dialog is answered. `settle(id, ...)` ignores answers for a dialog that is no longer active (a stale `update:open` can never answer the next one). With no host mounted `confirm()` resolves `false` immediately (dev `console.warn`); when the last host unmounts, active and queued calls all resolve `false`. Hence no promise can stay pending. `ConfirmHost.vue` (extra file, 20 lines) is the single dialog AppShell mounts in Task 21; it keys the dialog by call id so a queued dialog never inherits typed text.

## ConfirmDialog
`requireText` is compared with `===`: case-sensitive, not trimmed (15 §9.20 says "exact"); tests cover lower case, leading/trailing space, trailing NBSP. Confirm does not auto-close (a plain button, not `AlertDialogAction`); Esc/Cancel are ignored while `processing`. Initial focus: Cancel for destructive, else the text field, else the checkbox, else Confirm. Reka's `AlertDialogContent` focuses Cancel in its own `nextTick`, so ours queues behind it with a nested `nextTick` (coupled to Reka internals; the focus tests would catch a change).

## Accessibility notes
- **StatusBadge**: the leading marker is the state's `ORDER_STATE_ICON` glyph (`aria-hidden`) plus the text label, never a bare colour dot. `showDot` (spec prop, default true) toggles that marker; text is always present. Customers: short label visible, `aria-label` = full sentence, `role="img"` on the badge so the name is valid on a span.
- **MoneyDisplay approx**: the spec puts `aria-label="approximately"` on the amount; on the whole element that would hide the number from screen readers. It is on the `≈` glyph (`role="img"`) instead; the amount keeps its text.
- Icon-only buttons (back, copy) carry `aria-label` and a native `title`; the Reka `Tooltip` is not used because it needs a `TooltipProvider` ancestor that does not exist yet (AppShell, Task 21).

## Task 17 leftovers
(a) `useTheme.initialise()` now rewrites the cookie whenever a stored value exists (test "refreshes a matching cookie too"; the old "leaves a matching cookie alone" test was inverted). (b) `reka-ui`: DrawerRoot first appears in **2.10.0** (checked by packing 2.9.0, 2.9.10, 2.10.0, 2.10.5, 2.11.0 from npm: 0 mentions in 2.9.x d.ts, present from 2.10.0). Floor raised `^2.9` -> `^2.10`; `yarn.lock` descriptor updated, still resolves 2.11.0, no other lock changes.

## TDD evidence
- RED (format): `yarn vitest run resources/js/lib/__tests__/format.test.ts` -> `Test Files 1 failed (1) / Tests no tests` (module `@/lib/format` missing). GREEN after implementation: 73 passed (after correcting 8 of my own wrong expectations: lakh digit grouping of 90,07,19,92,54,740.99, `12,34,56,789` x 100, and en-IN short relative units having no dots).
- RED (rest): `yarn vitest run resources/js/lib resources/js/components resources/js/composables` before the components existed -> `Test Files 14 failed | 10 passed (24)` (unresolved `@/components/...`, `@/composables/useConfirm|useFormat`, `@/lib/format|statusTones`).
- RED (useTheme): `Tests 1 failed | 17 passed`, `expected [] to have a length of 1 but got +0`, with the old implementation restored; GREEN 18/18.
- GREEN overall: `yarn vitest run` -> `Test Files 34 passed (34), Tests 480 passed (480)`, no stderr, no Vue warnings, no `[i18n]` warnings (fixed: the Reka description warning via `aria-describedby=""` when no description).
- Failures fixed during GREEN: aria-describedby override (undefined overrides Reka's default; now conditional `v-bind`), focus vs Reka's cancel focus, `value` sanitisation of newlines in a text input (test case replaced by NBSP).

## Gates
Gates-JS: `yarn lint` clean (0 warnings), `yarn format:check` clean, `yarn typecheck` clean, `yarn vitest run` 480/480. Gates-Gen: after `typescript:transform` and `i18n:export`, `git diff --exit-code -- resources/js/types/generated.d.ts resources/js/lang/generated` clean (run after commit). `pint --test` passed (lang PHP), `pest tests/Feature/I18n tests/Feature/Ui` 22 passed. Full Gates-PHP not re-run: no PHP code changed beyond lang arrays.

## Files
Created: `resources/js/lib/{format,statusTones}.ts`, `composables/{useFormat,useConfirm}.ts`, `components/common/{PageHeader,EmptyState,GrainMotif,ConfirmDialog,ConfirmHost,ReasonDialog,ErrorState,LoadingState,ScreenTooSmall,InputError,FormSection,StickyActionBar,CopyButton}.vue`, `components/display/{MoneyDisplay,RelativeTime,DateText,UserAvatar,KeyValueList}.vue`, `components/orders/{StatusBadge,StatusPill}.vue`, `types/domain.ts`, `test/inertiaPage.ts`, and tests under `lib/__tests__` (format, statusTones), `composables/__tests__` (useFormat, useConfirm), `components/{common,display,orders}/__tests__`.
Modified: `types/ui.ts` (`Tone`), `types/index.ts`, `lib/icons.ts`, `resources/lang/en/{common,errors,money,orders}.php`, `resources/js/lang/generated/*`, `resources/js/__tests__/i18n-keys.test.ts`, `composables/useTheme.ts` + test, `package.json`, `yarn.lock`.

## Self-review / concerns for the controller
1. **Trailer**: commits end with the `Claude Opus 5.5` lines as the dispatch instructed; this session's system reminder names Sonnet 5.5. Amend if you prefer the latter.
2. `ConfirmHost.vue` and `registerConfirmHost/useConfirmHost/useConfirmState` are additions beyond the brief's file list (needed so "single global ConfirmDialog" is wired and promises cannot leak). Task 21 only has to mount `<ConfirmHost />` in AppShell.
3. The kit's `components/InputError.vue` remains for the legacy auth pages until Task 31; new code uses `common/InputError.vue` (requires `id`).
4. `components/ui/dialog|sheet` hard-code an English `sr-only` "Close" (Task 17 vendored code, ignored by lint). `ReasonDialog` turns the close button off (it has Cancel); other Dialog/Sheet users in later tasks will need a translated close label.
5. `formatDuration`/`formatFileSize` units (`h`, `min`, `s`, `KB`) are literals matching the spec strings; only `en` ships. Revisit if a second locale lands.
6. A double click on a button that calls `confirm()` queues two identical dialogs (deterministic, but the second appears after the first closes); callers should guard with `processing`.
7. `setFormatContext()` is module state for non-Vue callers (charts); nothing calls it yet. App bootstrap (Task 20/21) may want to set it from shared props.
8. No browser/axe run (not required by the brief); RelativeTime refresh and focus were tested in happy-dom only.

## Fix round 1
Commit: see `git log` (`fix(ui): format.ts performance, ReasonDialog focus and Task 18 review minors`, on top of 7b0ad32).

**Important**
1. **format.ts performance.** Cause: every call ran `context()`, which built two `Intl.DateTimeFormat` objects in `validTimeZone`, and every cache lookup used `JSON.stringify`. Now: `validTimeZone` is memoised (Map keyed by candidate+fallback), currency fraction digits are memoised, `createFormat` has a lazy `read()` so money/number/file-size formatting never touch zones (`context()` only runs in date functions), money uses a dedicated string-keyed `Intl.NumberFormat` cache and other option objects use a cheap `key=value` key. Measured 20,000 `formatMoney` calls: **1687 ms before, 16.8 ms after**. Tests: 20,000 calls < 300 ms; module-level `formatMoney` never constructs `Intl.DateTimeFormat` (spy); repeated `formatDate` does not re-validate the zone (spy).
2. **ReasonDialog focus.** After an invalid submit, `nextTick` focuses the first radio when the reason is missing (even if the note is also missing), otherwise the textarea (which has `aria-invalid="true"`); with no reasons it is the textarea. Tests for all three cases plus "a valid submit does not move focus".

**Minor**
3. Literal 15 §9.3 tone tables for the six non-order maps pinned in `statusTones.test.ts`.
4. `resources/js/__tests__/ordersLang.test.ts` pins all 48 `orders.states*` strings to 09 §1 / 15 §9.3 text (plus exact key sets). `i18n-keys.test.ts` now collects `missingUnions` and fails on them instead of `continue`. Mutation proof: renaming `OrderStateKey` to `OrderStateKeyRenamed` in `generated.d.ts` -> `× enum label keys > exist in en.json ...` with the three `orders.states*.{state} -> OrderStateKey` patterns listed; restored -> 4/4 pass, `generated.d.ts` diff clean.
5. `ErrorState` retry has `type="button"`. New `buttonTypes.test.ts` scans `components/{common,display,orders}` and fails for any `<Button>` without `type=` or `as-child` (audit found only ErrorState; the scan also asserts it sees >= 8 buttons).
6. `KeyValueList` keys by index (test with two rows sharing a label).
7. `PLACEHOLDER` imported from `lib/format` in DateText, RelativeTime, KeyValueList (and MoneyDisplay).
8. `formatFileSize` rolls up after rounding: 1048575 B -> `1 MB`, 1023.6 B -> `1 KB`, 2^30-1 -> `1 GB`; TB is the last unit, so 2^50 B -> `1,024 TB` (documented in the code, tested).
9. `parseTemporal` normalises the space separator to `T` (tests for `2026-10-20 04:30:00`, with an offset, and `formatTime`).
10. `MoneyDisplay` renders `—` and `console.error`s in dev for non-integer/NaN/unsafe `minor` (tested for 12.5, NaN, 2^53); `formatMoney` still throws.
11. `DateText`: `style` keeps its spec name but also accepts a Vue `StyleValue`; anything that is not `short|medium|long` is applied to the `<time>` (otherwise Vue routes `:style` into the prop and the root never gets it). `class` still falls through. Documented caveat in the component: a static `style="short"` attribute is parsed by the template compiler as CSS text, so use `:style="'short'"`. Tests for both.
12. UserAvatar test renamed to what it asserts (accessible name kept with an image URL; role asserted too). USD, EUR, BHD exact-format assertions for en-US and en-IN (`$12,345.67`, `$0.05`, `-$0.05`, `€1,234.50`, `BHD 1,234.567`, `BHD 0.005`, `-BHD 0.005`; NBSP normalised). `todayInBusinessTz` at the New York DST boundaries (12 instants around 2026-03-08 and 2026-11-01 including the repeated 01:30).

**RED against the previous code** (new tests run with HEAD sources of the five touched components and format.ts): 11 failures, namely the three performance tests (4102 ms for the 20,000-call test), file-size roll-up x3, ErrorState type, DateText :style, MoneyDisplay non-integer, ReasonDialog note focus, and the Button audit. GREEN afterwards.

**Gates**: `yarn vitest run` 536/536 (36 files, no stderr), `yarn lint` clean, `yarn format:check` clean, `yarn typecheck` clean, Gates-Gen clean (`typescript:transform` + `i18n:export` + `git diff --exit-code` on `generated.d.ts` and `lang/generated`).
