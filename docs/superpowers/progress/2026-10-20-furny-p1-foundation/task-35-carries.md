# Task 35 — carries (binding)

1. Task 34: add the customer AccountNav "Delete account" item (it was left out pending this task's route). Use Wayfinder for the route; update AccountNav tests (customer nav item count).
2. Task 34 built: AccountPage/AccountNav layout, SecurityPage props, session registry (Task 24), recent-authentication (Task 29 `auth.reauthenticate`) — reuse recent-auth for destructive account actions per 13 spec.
3. PII rules (Global Constraints): masked in logs/audit (App\Support\Privacy\Mask); no PII in URLs, cache keys, job names, channel names. Anonymisation must cover every PII column the data model (02) lists for the user, plus media (avatar) and sessions (Redis session registry) and OAuth links.
4. Data export: if it produces a file, it goes through storage with a temporary URL (Task 33 pattern) — never a public URL; job names carry no PII.
5. Task 33 C10 shapes and MediaData exist; Task 32's ConsumeUploadIntent is the only upload path.
