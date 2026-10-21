### Task 19: Input components (Currency, Phone, Length placeholder, Percent, Address)

**Files:**
- Create: `resources/js/components/inputs/{CurrencyInput,PhoneInput,LengthInput,PercentInput,AddressFields}.vue`, `resources/js/lib/lengthAdapter.ts`, `resources/js/types/forms.ts` (`AddressFormData`)
- Modify: `resources/lang/en/{units,money,phone,common}.php`
- Test: `resources/js/components/inputs/__tests__/{CurrencyInput,PhoneInput,LengthInput,PercentInput,AddressFields}.test.ts`, `resources/js/lib/__tests__/lengthAdapter.test.ts`

**Spec refs:** `15 §9.7`, `§9.22`, `§9.23`, `§9.25`, `§9.26`; master §6.1; `02 §1.2` (address lengths); P1-D3

**Interfaces:**
- Consumes: Tasks 17–18.
- Produces: components with props/emits exactly as `15 §9.x`; `lengthAdapter.ts`: `parseLengthInput(text: string, unit: LengthUnitKey): { ok: true; mm: number } | { ok: false; reason: 'invalid' | 'unsupported' }` and `formatLengthValue(mm: number, opts: { system: 'metric' | 'imperial'; unit: LengthUnitKey }): string` — **P1 placeholder**: metric units (`mm`, `cm`, `m`, bare numbers in the current unit, optional suffixes, decimal `.`), imperial input returns `unsupported`; P4 replaces the body with the engine's `parseLength`/`formatLength` (`04 §1`) without changing these signatures.

- [ ] **Step 1: Write the failing tests**
  - `CurrencyInput` (`INR`, `en-IN`): typing `12,345.67` + blur emits `1234567` and shows `12,345.67`; `12345.6` emits `1234560`; `abc` shows `money.errors.invalid` and emits `null`; `-5` with `allowNegative=false` is invalid; the prefix shows `₹`.
  - `PhoneInput` (Review Focus 2, `defaultCountry 'IN'`): `09876 543 210` → emits `'+919876543210'`; `+91-98765-43210` → `'+919876543210'`; `98765 43210` → `'+919876543210'`; pasting `+1 415 555 0100` switches the country to `US` and emits `'+14155550100'`; `12ab` emits `null` and shows `phone.errors.invalid`; national format when blurred; `inputmode="tel"`, `autocomplete="tel-national"`.
  - `LengthInput` (unit `mm`, min 300, max 6000): `2400`, `2400mm`, `240cm`, `2.4m` → emit 2400 on Enter; unit `cm` bare `240` → 2400; `100` → `aria-invalid="true"` + `units.errors.out_of_range`; `abc` → `units.errors.invalid_length`; ArrowUp +10, Shift+ArrowUp +100; Escape restores the last valid value; `role="spinbutton"` with `aria-valuenow`; `inputmode="text"`; `commit` emitted on blur with a valid value.
  - `lengthAdapter.test.ts`: `parseLengthInput("7'10\"", 'mm')` → `{ ok: false, reason: 'unsupported' }`; `parseLengthInput('3.2m', 'mm')` → `{ ok: true, mm: 3200 }`; `formatLengthValue(2400, { system: 'metric', unit: 'mm' }) === '2400'`.
  - `PercentInput`: `modelValue 1250` displays `12.50`; typing `35` emits `3500`.
  - `AddressFields`: `maxlength` label 60, line1 200, line2 200, city 100, region 100, postalCode 20; errors with `errorPrefix 'siteAddress.'` render under the right fields; countryCode defaults to `business.defaultCountryCode`.
- [ ] **Step 2: Run, expect FAIL** — `yarn vitest run resources/js/components/inputs resources/js/lib/__tests__/lengthAdapter.test.ts`
- [ ] **Step 3: Implement** — per `15 §9.x`; `PhoneInput` uses `libphonenumber-js/min`.
- [ ] **Step 4: Run tests, expect PASS** — same as Step 2.
- [ ] **Step 5: Quality gates** — Gates-JS, Gates-Gen.
- [ ] **Step 6: Commit** — `git add resources/js/components/inputs resources/js/lib resources/js/types resources/lang resources/js/lang` → `feat(ui): currency, phone, length (placeholder adapter), percent and address inputs` + trailer.

