# Task 16 report: design tokens, fonts, theme

Status: DONE_WITH_CONCERNS. Commit eb61cb1 `feat(ui): design tokens, self-hosted fonts and theme switching`.

## Implemented
- `resources/css/app.css`: 15 §3.1 skeleton extracted programmatically from the spec (verbatim), plus the 15 §16 print rules and a print copy of the `:root` block (`@media print { :root, .dark {...} }`). Fonts via `@import "@fontsource-variable/inter|jetbrains-mono"`. Kit leftovers (`@source` pagination/storage views, `--color-gray-200` border compat, `@layer utilities` font hack, hsl tokens) removed.
- `.prettierignore` gains `resources/css/app.css`: Prettier rewrote OKLCH numbers (trailing zeros), wrapped values and broke the print-copy equality. The file stays diffable against the spec.
- `lib/theme/editorColors.ts`: `EDITOR_COLOR_KEYS`/`EditorColorKey` (42 keys), `EDITOR_ROOM_TYPES` (19) / `EditorRoomType`, `roomTypeToColorKey`, `EXPORT_PALETTE` (frozen; `var()` resolved for `opening-gap`), `readEditorColors()` (cached per resolved theme; falls back to the export palette where the CSS var is empty), `cssColorToHex()` (hex fast path, else 1x1 canvas).
- `lib/theme/meta.ts` (`THEME_COLOR`, `applyThemeColor`), `lib/zIndex.ts` (`Z`), `composables/useTheme.ts` (`useTheme`, `initializeTheme`). `useAppearance.ts` deleted (superseded; used only by `app.ts`, now imports `initializeTheme` from `useTheme`).
- `HandleAppearance` middleware: cookie allow-listed to light|dark|system (strict `in_array`, non-strings such as `appearance[]=x` fall back to `system`), shares `appearance`, `themeColor`, `themeColors`. Constants `THEME_COLOR` mirror `meta.ts` (Pest test keeps them in sync).
- `app.blade.php`: `<html class="dark">` from the allow-listed value, `<meta name="theme-color">` before the script, inline script (9 lines) before CSS using `@js($appearance)`; background style now uses the `--background` token of each theme.
- `bootstrap/app.php`: NOT modified. It already had `encryptCookies(except: ['appearance', 'sidebar_state'])` (Task 1). I kept `sidebar_state` because `HandleInertiaRequests` reads that kit cookie unencrypted; the brief's `except: ['appearance']` would break `sidebarOpen`. Remove it when Task 21 replaces the sidebar.
- Legacy kit Vue files that matched the raw-palette regex (`InputError`, `NavFooter`, `AppHeader`, `PlaceholderPattern`, `AuthSplitLayout`, `Login`, `VerifyEmail`, `ForgotPassword`) were switched to tokens (`text-destructive`, `text-success`, `text-muted-foreground`, `stroke-foreground/20`, `bg-primary`, ...), so the test needs no exemption beyond `components/ui/`. They are deleted by Tasks 21/31 anyway.

## Contrast adjustments (log in spec 19)
Exactly one pair failed: light `border` on `background` = 1.291 < 1.3. Changed `--border` L 0.90 -> 0.897 (`oklch(0.897 0.008 80)`, ratio 1.3035) in `:root` and its print copy. Dark theme untouched; no other pair failed. `border` is not an EditorColorKey, so `EXPORT_PALETTE` needs no mirror. `--sidebar-border` and `--chart-grid` keep 0.90 (not in the 14.6 pairs). Contrast uses culori `wcagContrast` on `clampRgb`-clipped sRGB.

## Concerns
1. Spec inconsistency: `THEME_COLOR.dark` `#1d1a17` (used verbatim per brief/15 §11) is not the dark `--background` (`oklch(0.18 0.008 60)` = `#14110e`; `#1d1a17` is nearer `--card`). Only the mobile browser chrome tint is affected. Light `#fbfaf7` matches exactly. Log in 19 or fix the constant (both `meta.ts` and `HandleAppearance::THEME_COLOR`; the sync test follows).
2. CSP nonce: no CSP middleware exists yet (13 §12.1 `SecurityHeaders`, shares `csp_nonce`). The inline script already renders `nonce="{{ $csp_nonce }}"` when that view variable is set (tested). Note for P9: the inline `<style>` in Blade relies on `style-src 'unsafe-inline'`, which 13 §12.1 specifies.
3. Color gamut: culori clips to sRGB; browsers gamut-map OKLCH. Differences are sub-0.01 for these in-gamut tokens, but real-browser axe runs (P1 Task 40+/16 §11) remain the ground truth.
4. `useTheme` is a module-level singleton (shared refs). Tests reset it with `vi.resetModules()`.

## TDD evidence
RED (before implementation): `yarn vitest run resources/js/__tests__ resources/js/lib/theme resources/js/composables` -> `Test Files 4 failed | 2 passed`, `Tests 42 failed | 26 passed` (tokens missing in kit app.css, no print block, modules absent). `vendor/bin/pest tests/Feature/Ui` -> `12 failed, 1 passed` (raw cookie rendered into the page, meta.ts absent, no theme-color meta).
Intermediate RED on the real spec data: the tokens-contrast test failed on `border on background` (1.291) with the verbatim tokens, which also shows the test is not vacuous. The no-raw-palette test failed on 10 legacy lines before the swaps, and its second case feeds an offending fixture (`text-red-600 dark:bg-neutral-800`) through the same matcher and asserts it is reported while a clean token string is not.
GREEN: `yarn vitest run` -> `Test Files 11 passed, Tests 131 passed`; `vendor/bin/pest tests/Feature/Ui` -> `14 passed (51 assertions)`.

## Gates
- Gates-JS: `yarn lint` clean, `yarn format:check` clean, `yarn typecheck` clean, `yarn vitest run` 131/131.
- Gates-PHP: `pint --test` passed, `phpstan` no errors, `pest tests/Unit tests/Feature` 1728 passed (6018 assertions) (run before the final Pint fix of the new test file, which only changed quote style; `tests/Feature/Ui` re-run after: 14 passed).
- `yarn vite build` succeeds; Inter/JetBrains woff2 subsets emitted into `public/build/assets`, no external font URL in the CSS.
- Browser tests not run (not required).

## Tests added
`__tests__/tokens-contrast.test.ts` (59), `__tests__/no-raw-palette.test.ts` (2), `lib/theme/__tests__/editorColors.test.ts` (29, pins 42 colour keys + 19 room types + 19 mappings), `composables/__tests__/useTheme.test.ts` (13), `lib/__tests__/zIndex.test.ts` (2), `tests/Feature/Ui/AppearanceCookieTest.php` (14, incl. XSS payloads, array cookie, nonce, PHP/TS constant sync). Helper: `resources/js/test/cssTokens.ts`.

## Files changed
See commit eb61cb1 (25 files): app.css, .prettierignore, app.blade.php, HandleAppearance.php, app.ts, useTheme.ts (useAppearance.ts removed), lib/theme/{editorColors,meta}.ts, lib/zIndex.ts, tests above, and the 8 legacy Vue files.
