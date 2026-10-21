# Task 34 — carries (binding; from progress.md)

1. Task 31 carry: staff AccountNav has a "Two-factor" item linking to the existing two-factor settings page built in Task 31 (find its route name in routes/admin.php / route-access.php; do not create a new one).
2. Task 31 carry: register the TermsCheckbox fragment strings (the TermsCheckbox component exists; its fragment strings are not yet in resources/lang/en/*.php — add them, run i18n:export).
3. Task 21 ruling: "UserMenu visible on phones until Task 34" — this task adds the account links to UserMenu; decide phone visibility per 15 §7.x (app shell / mobile nav) and record the decision.
4. Customer AccountNav "Delete account" points to Task 35's route, which does not exist yet: render it only when the route exists (Wayfinder import would fail) — or add the route name to the nav in Task 35. Prefer: leave the item out here and have Task 35 add it; record in the report.
5. Task 33 outputs to reuse: `ImageUploader`/`FileDropzone` (resources/js/components/media), `uploadWithIntent`, `MediaData` (App\Domain\Shared\Data), `ConsumeUploadIntent` purpose `avatar`. Upload API shapes are the C10 ones (201 UploadPresignData; UploadIntentStatusData).
6. Task 28 carry (final review, not this task unless trivial): unlink refusal is a ValidationException on field `google`; a coded-validation helper adding `code: last_login_method` (14 §1.9) is pending.
