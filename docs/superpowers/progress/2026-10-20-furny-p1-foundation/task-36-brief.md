### Task 36: Customer onboarding (steps 1–2)

**Files:**
- Create: `app/Http/Controllers/Customer/OnboardingController.php`; `app/Http/Requests/Customer/OnboardingRequest.php`; `app/Domain/Identity/Actions/CompleteOnboarding.php`; `resources/js/pages/Customer/Onboarding/Wizard.vue`
- Modify: `routes/customer.php` (`customer.onboarding.show` GET `/onboarding`, `customer.onboarding.store` POST `/onboarding`, `customer.onboarding.skip` POST `/onboarding/skip`), `app/Http/Controllers/WelcomeController.php` (un-onboarded customers → onboarding), `resources/lang/en/onboarding.php`, `route-access.php`
- Test: `tests/Feature/Customer/OnboardingTest.php`, `resources/js/pages/Customer/Onboarding/__tests__/Wizard.test.ts`

**Spec refs:** `10 §5.1–§5.3`; `13 §5.1` (staff-created customers, terms); `02 §1.1` (`onboarded_at`, `terms_accepted_at`); P1-D4

**Interfaces:**
- Consumes: Tasks 23, 29 (`PhoneVerifyDialog`), 34 (`UpdatePreferences`).
- Produces: page `Customer/Onboarding/Wizard` (AuthLayout `wide`) with props `{user: {name, email, phoneE164, phoneVerified, termsAccepted}, defaults: {unitSystem, lengthUnit, timezone}}` (P4 adds `propertyTypes`, `starters`, `credits`); `CompleteOnboarding::handle(User $u, string $name, UnitSystem $s, LengthUnit $l, string $tz, bool $acceptTerms): void` (sets `terms_accepted_at` when required, `onboarded_at`); store body `{name, terms?, unitSystem, lengthUnit, timezone}` → redirect `customer.dashboard` (P4 extends with `project`, `start`, `starterKey`); skip body `{terms?}`.

- [ ] **Step 1: Write the failing tests**
  - `OnboardingTest`: un-onboarded customer GET `customer.dashboard` → `/onboarding`; `GET /` → `/onboarding`; store with valid data sets `onboarded_at`, preferences and name, redirects to `customer.dashboard`; `termsPending()` user without `terms` → `onboarding.errors.terms_required`, with `terms` → `terms_accepted_at` set; empty name → `onboarding.errors.name_required`; `metric` + `ftin` → `account.errors.length_unit`; skip sets `onboarded_at` (and terms when sent) and the wizard never shows again; staff GET `/onboarding` → redirect `admin.dashboard`.
  - Vitest: Continue moves from step 1 to step 2 and Back returns; the terms checkbox renders only when `user.termsAccepted` is false; Skip opens a `ConfirmDialog` containing the terms checkbox when required; the phone card opens `PhoneVerifyDialog` when no verified phone.
- [ ] **Step 2: Run, expect FAIL** — `vendor/bin/pest tests/Feature/Customer/OnboardingTest.php && yarn vitest run resources/js/pages/Customer`
- [ ] **Step 3: Implement** — wizard header "Step {n} of {total}" + `Progress`; time-zone default from `Intl.DateTimeFormat().resolvedOptions().timeZone` when supported, else business default.
- [ ] **Step 4: Run tests, expect PASS** — same as Step 2.
- [ ] **Step 5: Quality gates** — Gates-PHP, Gates-JS, Gates-Gen.
- [ ] **Step 6: Commit** — `git add app routes/customer.php resources tests` → `feat(onboarding): customer onboarding gate and profile/units steps` + trailer.

