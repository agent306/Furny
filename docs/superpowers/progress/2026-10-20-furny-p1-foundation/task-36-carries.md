# Task 36 — carries (binding)

1. Preflight a77: the onboarding gate uses spec 14's `CUS0` route group (not an EXEMPT list) — same behaviour; prefer 14's group. EnsureCustomerOnboarded (Task 23) exists — reuse/adjust.
2. Ledger (Task 28/29 correction): onboarding route is `customer.onboarding.show` (plus whatever 14 names for the steps).
3. Task 34 built AccountPage/forms (ProfileForm with phone section #phone, PhoneVerifyDialog from Task 29, UpdateDisplayPreferences); reuse form components/actions for onboarding steps instead of duplicating them.
4. Task 34 test: a not-onboarded customer hitting account pages — keep behaviour consistent with the CUS0 group.
