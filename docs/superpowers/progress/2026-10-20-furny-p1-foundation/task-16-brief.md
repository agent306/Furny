### Task 16: Design tokens, fonts, theme

**Files:**
- Create/replace: `resources/css/app.css`; `resources/js/lib/theme/editorColors.ts`; `resources/js/lib/theme/meta.ts`; `resources/js/lib/zIndex.ts`; `resources/js/composables/useTheme.ts`
- Modify: `resources/views/app.blade.php` (server-side `dark` class from cookie `appearance`, inline theme script before CSS, `<meta name="theme-color">`), `bootstrap/app.php` (`encryptCookies(except: ['appearance'])`)
- Test: `resources/js/__tests__/tokens-contrast.test.ts`, `resources/js/__tests__/no-raw-palette.test.ts`, `resources/js/lib/theme/__tests__/editorColors.test.ts`, `resources/js/composables/__tests__/useTheme.test.ts`, `tests/Feature/Ui/AppearanceCookieTest.php`

**Spec refs:** `15 §1`, `§2`, `§3.1–§3.5`, `§11`, `§14.6`, `§16` (print rules + print token block); master D24, D26; `13 §12.2` (appearance cookie)

**Interfaces:**
- Consumes: Task 1.
- Produces: `app.css` exactly per `15 §3.1` (+ `@media print` rules of `15 §16` and the print copy of the light tokens); `EditorColorKey`, `readEditorColors()`, `EXPORT_PALETTE`, `cssColorToHex()`, `roomTypeToColorKey(type: EditorRoomType)` where `EditorRoomType` = the 19 room types of `15 §3.4` (P2's engine `RoomType` must equal this union; P4 switches the parameter type to the engine type); `useTheme(): { appearance: Ref<'light'|'dark'|'system'>; resolved: Ref<'light'|'dark'>; setAppearance(v): void }` (localStorage `fs:appearance` + cookie `appearance` 1 year `SameSite=Lax`, `Secure` on https; all storage access in try/catch); `THEME_COLOR = { light: '#fbfaf7', dark: '#1d1a17' }`; `Z` constants of `15 §3.3`.

- [ ] **Step 1: Write the failing tests**
  - `tokens-contrast.test.ts`: parses `:root` and `.dark` from `app.css`, converts with `culori`, asserts the `15 §14.6` pairs in both themes (foreground and muted-foreground on background/card/muted ≥ 4.5; primary-foreground/primary ≥ 4.5; each status foreground on its base and each subtle-foreground on its subtle ≥ 4.5; accent-foreground/accent ≥ 4.5; ring/background ≥ 3.0; border/background ≥ 1.3; room-label on all ten room fills ≥ 4.5; dimension-text/canvas-bg ≥ 4.5); the print token block equals `:root`.
  - `no-raw-palette.test.ts`: regex of `15 §3` over `resources/js/**/*.vue` excluding `components/ui/` finds no match.
  - `editorColors.test.ts`: `EXPORT_PALETTE` equals the `:root` values parsed from `app.css` for every `EditorColorKey`; `roomTypeToColorKey` dataset per `15 §3.4` (`master_bedroom → room-bedroom`, `toilet → room-bath`, `deck → room-outdoor`, `ots → room-utility`, `corridor → room-circulation`, `other → room-other`, …).
  - `useTheme.test.ts`: `setAppearance('dark')` adds `dark` to `<html>`, writes `localStorage['fs:appearance'] = 'dark'` and a cookie containing `appearance=dark`, `max-age=31536000`, `samesite=lax`; `system` follows a mocked `matchMedia('(prefers-color-scheme: dark)')` change; a throwing `localStorage` does not break it.
  - `AppearanceCookieTest`: request with cookie `appearance=dark` renders `<html` with class `dark` and `<meta name="theme-color" content="#1d1a17">`; the cookie is read unencrypted.
- [ ] **Step 2: Run, expect FAIL** — `yarn vitest run resources/js/__tests__ resources/js/lib/theme resources/js/composables && vendor/bin/pest tests/Feature/Ui`
- [ ] **Step 3: Implement** — tokens verbatim; if a contrast pair fails, adjust only the foreground token's L by the minimum (≤ 0.06) and mirror it into `EXPORT_PALETTE` (`15 §14.6`).
- [ ] **Step 4: Run tests, expect PASS** — same as Step 2.
- [ ] **Step 5: Quality gates** — Gates-JS, Gates-PHP.
- [ ] **Step 6: Commit** — `git add resources/css/app.css resources/js/lib resources/js/composables resources/views/app.blade.php bootstrap/app.php resources/js/__tests__ tests/Feature/Ui` → `feat(ui): design tokens, self-hosted fonts and theme switching` + trailer.

