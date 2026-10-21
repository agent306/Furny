# Task 19 report: input components (Currency, Phone, Length placeholder, Percent, Address)

Status: DONE_WITH_CONCERNS. Commit `e7354b3` (base `a2df666`).

## Implemented

Components (`resources/js/components/inputs/`):
- `CurrencyInput.vue` (15 §9.22): minor-unit model; text parsed only by `format.ts parseMajorToMinor` (no second parser), shown with a new `formatMoneyAmount` (grouped number, no symbol) and prefixed with `currencySymbol`. Works for 0/2/3-decimal currencies (JPY/INR/BHD tested). Live emit while typing, errors on blur/Enter, focus drops grouping for editing, `allowNegative`, min/max errors.
- `PhoneInput.vue` (15 §9.25): `libphonenumber-js/min`; emits E.164 or null; a pasted `+...` number switches the country; national format once blurred; error `phone.errors.invalid`; error linked by `aria-describedby`; `type="tel" inputmode="tel" autocomplete="tel-national"`. Country selector = Popover + shadcn `Command` (searchable list, flag + name + calling code; business country first, then IN, AE, SG, GB, US, rest by name). Items are `min-h-11` on small screens.
- `LengthInput.vue` (15 §9.7): integer mm, `role="spinbutton"` with `aria-valuenow/valuetext/valuemin/valuemax`, `inputmode="text"`, Enter/blur parse + commit, Escape reverts (swallowed only when it undoes something), ArrowUp/Down +-step, Shift x10, Alt x0.1 (min 1 mm), PageUp/Down x10, stepping clamped to min/max. Props `id`, `ariaLabel`, `disabled` declared as in the spec.
- `PercentInput.vue` (15 §9.23): basis points, `decimals` 0|1|2, exact string arithmetic via `parseMajorToMinor`, trailing `%` tolerated.
- `AddressFields.vue` (15 §9.26): label 60, line1 200, line2 200, city 100, region 100, postalCode 20; `errors` + `errorPrefix`; empty `countryCode` becomes `business.defaultCountryCode` (shown and emitted); country `Select`.
- `lib/lengthAdapter.ts`: `parseLengthInput` / `formatLengthValue` with the brief's exact signatures. Metric only; imperial input returns `unsupported`. Exact decimal shifting in string/BigInt, round half away from zero, 04 §1.2 step 6 comma rules.
- `types/forms.ts` `AddressFormData`; helpers `lib/countries.ts`, `lib/fieldAttrs.ts`, `composables/useBusinessCountry.ts`, `composables/useLengthUnit.ts`, `useFormatContext()` in `useFormat.ts`.
- `format.ts` additions (reusing its Intl cache): `formatMoneyAmount`, `currencySymbol`, `currencyFractionDigits`.
- Lang: `units.errors.*` (invalid_length, out_of_range, too_small, too_large, unsupported), `money.errors.*` (invalid, invalid_percent, out_of_range, too_small, too_large), `phone.*` (errors.invalid, country, search_country, no_country), `common.address.*`. `i18n:export` regenerated.

Leftovers:
- (a) `DateText` gets `dateStyle` (wins over `style`; `style` stays for the spec and is then free for inline CSS). Documented in the component comment as the preferred prop. Later tasks: use `date-style`.
- (b) `DialogContent`, `DialogScrollContent`, `SheetContent` sr-only labels and the `DialogFooter` close button use `t('common.actions.close')` (key already existed).

## Decisions / rulings applied

- Thousands paste: `2,400 mm` is 2400 (master §6.1 / 04 §1.2 step 6: thousands groups first, else one comma is a decimal comma, any other comma is invalid). `3 200` is invalid. Tested.
- Rounding: half away from zero on the exact decimal digits (not float multiply: `1.0005 m` is 1001).
- Negatives: the adapter returns the signed mm; `LengthInput` enforces a floor of `min ?? 0`, so a negative needs a negative `min`. NaN, Infinity, `1e3`, `0x10`, unsafe integers are invalid.
- Touch targets: every control uses `useControlSize` (`lg` = h-11 = 44 px in comfortable density, the default and what AppShell gives below 768 px); the phone country trigger is a size-matched `Button`.
- Task text said "country selector UI per 15 §9.23"; §9.23 is PercentInput, the PhoneInput section is §9.25 (Combobox), which I followed.
- `libphonenumber-js ^1.12` was already in `package.json` / `yarn.lock` from the scaffold (1.13.15 installed); no dependency change was needed.

## Tests (TDD)

RED (before implementation), `yarn vitest run <file>`:
- DateText: `× dateStyle (the preferred prop) picks the style` (unknown prop fell through as an attribute).
- closeLabel: 4 failing, `expected 'Close' to be 'Schliessen'` for DialogContent / DialogScrollContent / SheetContent / DialogFooter.
- lengthAdapter, CurrencyInput, PercentInput, LengthInput, PhoneInput, AddressFields: written first; run failed with `Failed to resolve import "@/lib/lengthAdapter"` / `"@/components/inputs/<X>.vue"`. Later REDs inside the cycle: lengthAdapter bare-fraction in imperial unit (`expected invalid to equal unsupported`), LengthInput stepping/clamp (`expected [2410, 2390] to deeply equal [2410, 2400, 2390]`), Phone selector (`Injection CommandGroupContext not found`), Address country default.

GREEN, full gate on the final tree:
- `yarn lint` 0, `yarn format:check` clean, `yarn typecheck` 0.
- `yarn vitest run`: 44 files, 833 tests passed, no stderr (was 536 before Task 18's fix round; this task adds the input, adapter, countries, format, DateText and close-label tests).
- Gates-Gen: `typescript:transform` and `i18n:export` run, `git diff --exit-code` on generated files clean (after staging); `vendor/bin/pest tests/Feature/I18n` 7 passed; `pint --test resources/lang` passed.

New tests: CurrencyInput 35, PercentInput 31, LengthInput 68, PhoneInput 41, AddressFields 20, lengthAdapter 82, countries 8, format +4, DateText +3, closeLabel 5.

## Concerns for the reviewer

1. `units.errors.invalid_length` is the spec's text verbatim ("Enter a length like 2400, 240cm or 7'10\"."), which suggests feet-inches that the P1 adapter rejects (the user then sees `units.errors.unsupported`, which says so). It becomes accurate when P4 swaps in the engine; I kept the verbatim string so the lang does not change in P4.
2. In P1 an `ftin`/`in` LengthInput falls back to millimetres (shown and parsed in mm, suffix `mm`); imperial users see this until P4.
3. Added keys not in the spec: `units.errors.too_small/too_large/unsupported`, `money.errors.out_of_range/too_small/too_large/invalid_percent`, `phone.country/search_country/no_country`, `common.address.*` (needed for one-sided ranges, percent, selector chrome, address labels). `PercentInput.modelValue` accepts `null` (spec says `number`) for an empty field.
4. CurrencyInput relies on `parseMajorToMinor`'s grammar: `.` decimal and `,` grouping only (en-IN). A locale with decimal comma would need `format.ts` to change, not this component.
5. Other vendored `ui/` components still carry hard-coded English (`PaginationEllipsis` "More pages", `BreadcrumbEllipsis` "More", `SidebarTrigger` "Toggle sidebar", `SidebarRail`, `Spinner` aria-label "Loading", `Breadcrumb` aria-label). Not in this task; carry to the next shell task.
6. `AddressFields` mounts all ~245 `SelectItem`s even when closed (reka keeps them to resolve the value); I override `SelectValue` so this is not needed for display, but reka still renders them. Fine per instance; revisit if a page shows many address forms.
7. Tests in happy-dom select a reka Select item with a `pointerup` (mouse) event and open the Select with ArrowDown; useId in two separately mounted apps collides (test-only; one app per page is fine).

## Fix round 1

Commits: `2f6dedf` (separators, composable, paste, Enter) and `d47e75c` (minors). Tests were written first and run RED (21 failing in Currency/Percent; 6 failing in Length/Phone/Pagination/Address) before each change.

1. Locale-aware separators. `format.ts`: `numberSeparators(locale)` (from `Intl.NumberFormat(locale).formatToParts(12345.6)`; en-IN `. ,`, de-DE `, .`, fr-FR `, U+202F`, ru `, U+00A0`, de-CH `. U+2019`; bad locale falls back to `. ,`). `parseMajorToMinor(text, digits, separators = { decimal: '.', group: ',' })`: grammar regexes are built per separator pair and cached; a space-like group accepts a plain space, NBSP or narrow NBSP; the keyboard `'` stands for `U+2019`. Tests: de-DE `1.234,56` -> 123456, `1,234.56` / `1,234` / `12.34` -> null; fr-FR `1 234,56` with space, NBSP and narrow NBSP -> 123456, `12 34,56` and `1  234` -> null; lakh still works (en-IN and `1.23.456,78` in de); defaults and old tests unchanged. Display (`formatMoneyAmount`, percent text, focus edit text) uses the same locale; messages already used it.
2. `composables/useDecimalField.ts`: text, focused, error, onInput, onFocus, onBlur, onEnter, refresh and the model/separator watchers. `CurrencyInput` and `PercentInput` now only supply `read`, `show`, `edit`, `emit`.
3. Paste with symbols: `format.ts` `currencyTokens()` (symbol, narrow symbol, ISO code) and `stripCurrencyTokens()`. Tested `'₹ 12,345.67'`, `'INR 12,345.67'`, trailing symbol/code, lower-case code, NBSP and narrow NBSP around it, sign before or after the symbol; USD, a foreign symbol, doubled or both-ends tokens stay invalid; follows the `currency` prop and de-DE/fr-FR `€`.
4. Enter commits (emit, error) but leaves the text alone while focused; blur re-groups. Tested for both inputs.
5. PhoneInput: removed the `aria-haspopup="listbox"`, `aria-expanded` and `aria-controls` overrides; the popover trigger now carries Reka's own `aria-haspopup="dialog"`, `aria-expanded` and an `aria-controls` that resolves to the open popup (tested).
6. AddressFields: no emit on mount (tested: nothing emitted, country still displayed); documented that the parent should start the form with the business default. `autocomplete="country"` and a `name` on the Select so Reka renders its native `<select>` inside a `<form>` (tested there; Reka renders it only with a form and a name).
7. `countries.ts` header corrected. Server-side validation of `country_code` must accept AC, TA and XK (libphonenumber regions that are not ISO-3166-1 alpha-2) and should not assume every ISO code is listed; the UI will emit them.
8. `PaginationPrevious` / `PaginationNext`: visible text through `t('common.pagination.previous|next')` (keys added) and also an `aria-label`, because the text is `hidden sm:block` and the button had no name below sm (tested).
9. `LengthInput` `aria-valuemin` is the effective floor (`min ?? 0`); `aria-valuemax` is still omitted without a max (tested).

Run on the final tree: `yarn lint`, `yarn format:check`, `yarn typecheck` all 0; `yarn vitest run` 44 files, 878 tests passed, no stderr; Gates-Gen clean (`typescript:transform`, `i18n:export`, `git diff --exit-code` on generated files); `pest tests/Feature/I18n` 7 passed; `pint --test resources/lang` passed.
